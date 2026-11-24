// htradapt.js – „Lernt deine Schrift“: die Erkennung an deine Handschrift anpassen
//
// Wenn du im Fenster „Handschrift zu Text“ einen Fehler verbesserst, merkt sich die App die
// Zeile (als kleines Bild) und den richtigen Text. Daraus lernt sie – direkt auf dem Tablet,
// offline:
//   Das Modell besteht aus zwei Teilen. Der große vordere Teil (Faltungen + LSTM) „sieht“ die
//   Schrift und beschreibt jede schmale Spalte mit 256 Zahlen. Der kleine letzte Teil (eine
//   Tabelle 256 × Zeichen) entscheidet daraus, welcher Buchstabe das ist. Nur diesen letzten
//   Teil passen wir an: Dann lernt er z. B., dass dein „s“ (das ein bisschen wie ein „r“
//   aussieht) eben ein „s“ ist. Der vordere Teil bleibt, wie er ist – das ist schnell (ein paar
//   Sekunden) und kann nichts kaputt machen, weil wir nah am Original bleiben.
//
// Gelernt wird mit „CTC“: Das Modell sagt pro Spalte Wahrscheinlichkeiten, und CTC rechnet
// aus, wie gut alle möglichen Anordnungen zusammen den richtigen Text ergeben – ohne dass
// jemand sagen muss, wo genau welcher Buchstabe steht.

const NEG = -1e30;
const lse2 = (a, b) => (a === NEG ? b : b === NEG ? a : a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)));

// logits: Float32Array T*C (roh), target: Zeichen-Nummern (1..C-1, 0 = leer)
// -> { loss, grad } mit grad = d(loss)/d(logits)
export function ctcLossGrad(logits, T, C, target) {
  const L = target.length;
  const S = 2 * L + 1;
  const lab = new Int32Array(S);
  for (let i = 0; i < L; i++) lab[2 * i + 1] = target[i];
  // log-softmax
  const lp = new Float64Array(T * C);
  const y = new Float64Array(T * C);
  for (let t = 0; t < T; t++) {
    let mx = -Infinity;
    for (let k = 0; k < C; k++) mx = Math.max(mx, logits[t * C + k]);
    let s = 0;
    for (let k = 0; k < C; k++) s += Math.exp(logits[t * C + k] - mx);
    const z = mx + Math.log(s);
    for (let k = 0; k < C; k++) {
      lp[t * C + k] = logits[t * C + k] - z;
      y[t * C + k] = Math.exp(lp[t * C + k]);
    }
  }
  if (T < L) return { loss: 0, grad: new Float32Array(T * C), ok: false };
  const skip = (s) => s >= 2 && lab[s] !== 0 && lab[s] !== lab[s - 2];
  const alpha = new Float64Array(T * S).fill(NEG);
  alpha[0] = lp[lab[0]];
  if (S > 1) alpha[1] = lp[lab[1]];
  for (let t = 1; t < T; t++) {
    for (let s = 0; s < S; s++) {
      let a = alpha[(t - 1) * S + s];
      if (s >= 1) a = lse2(a, alpha[(t - 1) * S + s - 1]);
      if (skip(s)) a = lse2(a, alpha[(t - 1) * S + s - 2]);
      alpha[t * S + s] = a === NEG ? NEG : a + lp[t * C + lab[s]];
    }
  }
  // beta ohne die Ausgabe zum Zeitpunkt t selbst
  const beta = new Float64Array(T * S).fill(NEG);
  beta[(T - 1) * S + S - 1] = 0;
  if (S > 1) beta[(T - 1) * S + S - 2] = 0;
  for (let t = T - 2; t >= 0; t--) {
    for (let s = 0; s < S; s++) {
      let b = beta[(t + 1) * S + s] + lp[(t + 1) * C + lab[s]];
      if (s + 1 < S) b = lse2(b, beta[(t + 1) * S + s + 1] + lp[(t + 1) * C + lab[s + 1]]);
      if (s + 2 < S && skip(s + 2)) b = lse2(b, beta[(t + 1) * S + s + 2] + lp[(t + 1) * C + lab[s + 2]]);
      beta[t * S + s] = b < NEG / 2 ? NEG : b;
    }
  }
  let logP = alpha[(T - 1) * S + S - 1];
  if (S > 1) logP = lse2(logP, alpha[(T - 1) * S + S - 2]);
  if (!(logP > NEG / 2)) return { loss: 0, grad: new Float32Array(T * C), ok: false };
  const grad = new Float32Array(T * C);
  for (let t = 0; t < T; t++) {
    for (let k = 0; k < C; k++) grad[t * C + k] = y[t * C + k];
    for (let s = 0; s < S; s++) {
      const a = alpha[t * S + s] + beta[t * S + s];
      if (a > NEG / 2) grad[t * C + lab[s]] -= Math.exp(a - logP);
    }
  }
  return { loss: -logP, grad, ok: true };
}

// Letzte Schicht anpassen.
// feats: [{ F: Float32Array T*n, T, target: Int32Array }], W0: C*n, B0: C
// -> { W, B, before, after } (durchschnittlicher Fehler pro Zeichen vorher/nachher)
export function adaptLinear(feats, W0, B0, n, C, { epochs = 12, lr = 2e-3, keep = 3e-3, onProgress } = {}) {
  const W = Float32Array.from(W0);
  const B = Float32Array.from(B0);
  const mW = new Float32Array(W.length), vW = new Float32Array(W.length);
  const mB = new Float32Array(C), vB = new Float32Array(C);
  const gW = new Float32Array(W.length), gB = new Float32Array(C);
  const b1 = 0.9, b2 = 0.999;
  let step = 0;
  const lossOf = () => {
    let s = 0, m = 0;
    for (const f of feats) {
      const r = ctcLossGrad(forward(f, W, B, n, C), f.T, C, f.target);
      if (r.ok) { s += r.loss / f.target.length; m++; }
    }
    return m ? s / m : 0;
  };
  const before = lossOf();
  const order = feats.map((_, i) => i);
  for (let ep = 0; ep < epochs; ep++) {
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    for (let bi = 0; bi < order.length; bi += 8) {
      gW.fill(0);
      gB.fill(0);
      const batch = order.slice(bi, bi + 8);
      for (const idx of batch) {
        const f = feats[idx];
        const r = ctcLossGrad(forward(f, W, B, n, C), f.T, C, f.target);
        if (!r.ok) continue;
        const sc = 1 / (f.target.length * batch.length);
        for (let t = 0; t < f.T; t++) {
          const ft = f.F.subarray(t * n, (t + 1) * n);
          for (let k = 0; k < C; k++) {
            const g = r.grad[t * C + k] * sc;
            if (g > -1e-6 && g < 1e-6) continue;
            gB[k] += g;
            const row = k * n;
            for (let j = 0; j < n; j++) gW[row + j] += g * ft[j];
          }
        }
      }
      // nah am Original bleiben (sonst vergisst es, was es schon konnte)
      for (let j = 0; j < W.length; j++) gW[j] += keep * (W[j] - W0[j]);
      for (let k = 0; k < C; k++) gB[k] += keep * (B[k] - B0[k]);
      step++;
      const c1 = 1 - b1 ** step, c2 = 1 - b2 ** step;
      for (let j = 0; j < W.length; j++) {
        mW[j] = b1 * mW[j] + (1 - b1) * gW[j];
        vW[j] = b2 * vW[j] + (1 - b2) * gW[j] * gW[j];
        W[j] -= (lr * mW[j]) / c1 / (Math.sqrt(vW[j] / c2) + 1e-8);
      }
      for (let k = 0; k < C; k++) {
        mB[k] = b1 * mB[k] + (1 - b1) * gB[k];
        vB[k] = b2 * vB[k] + (1 - b2) * gB[k] * gB[k];
        B[k] -= (lr * mB[k]) / c1 / (Math.sqrt(vB[k] / c2) + 1e-8);
      }
    }
    onProgress?.((ep + 1) / epochs);
  }
  return { W, B, before, after: lossOf() };
}

export function forward(f, W, B, n, C) {
  const out = new Float32Array(f.T * C);
  for (let t = 0; t < f.T; t++) {
    const ft = f.F.subarray(t * n, (t + 1) * n);
    for (let k = 0; k < C; k++) {
      let s = B[k];
      const row = k * n;
      for (let j = 0; j < n; j++) s += W[row + j] * ft[j];
      out[t * C + k] = s;
    }
  }
  return out;
}

// Text -> Zeichen-Nummern (unbekannte Zeichen fallen weg)
export function encode(text, charset) {
  const chars = [...charset];
  const map = new Map(chars.map((c, i) => [c, i + 1]));
  const out = [];
  for (const ch of text.replace(/[“”„]/g, '"').replace(/[‚‘’]/g, "'")) if (map.has(ch)) out.push(map.get(ch));
  return Int32Array.from(out);
}
