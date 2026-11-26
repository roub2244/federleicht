// nn.js – ein winziges "neuronales Netz"-Programm, ganz ohne Bibliothek
//
// Damit laufen die selbst trainierten Erkennungs-Modelle (Handschrift-Text und Mathe-Zeichen)
// direkt auf dem Tablet – offline. Die Modelle wurden am PC trainiert (PyTorch) und als
// Datei gespeichert: erst ein JSON-Kopf (welche Schichten, wie groß), dann alle Zahlen
// als 16-Bit-Kommazahlen (halb so groß wie normal, reicht völlig).
//
// Unterstützte Schichten: conv (3x3, BatchNorm schon eingerechnet) + relu, maxpool,
// lstm (zweiseitig), linear.

// ---------- Modell-Datei lesen ----------
export async function loadModel(url) {
  const buf = await (await fetch(url)).arrayBuffer();
  const view = new DataView(buf);
  const headLen = view.getUint32(0, true);
  const head = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, headLen)));
  const start = 4 + headLen;
  const half = new Uint16Array(buf.slice(start, start + head.count * 2));
  const all = f16ToF32(half);
  const tensors = {};
  for (const [name, [off, len]] of Object.entries(head.tensors)) tensors[name] = all.subarray(off, off + len);
  return { meta: head.meta, layers: head.layers, t: tensors };
}

function f16ToF32(h) {
  const out = new Float32Array(h.length);
  for (let i = 0; i < h.length; i++) {
    const x = h[i];
    const s = x & 0x8000 ? -1 : 1;
    const e = (x >> 10) & 0x1f;
    const m = x & 0x3ff;
    out[i] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  return out;
}

// ---------- Schichten ----------
// Bild/Merkmale: { c, h, w, d: Float32Array (c*h*w) }

// 3x3-Faltung mit Rand 1, danach (optional) ReLU
// Schnell gemacht: Das Eingabebild bekommt einen Rand aus Nullen (keine Abfragen am Rand nötig),
// und es werden immer 4 Ausgabe-Kanäle auf einmal gerechnet: Die 9 Nachbar-Pixel werden einmal
// gelesen und für alle 4 benutzt. Das ist auf dem Tablet etwa doppelt so schnell.
const Z9 = new Float32Array(9);
export function conv3(x, W, B, cout, relu = true) {
  const { c: cin, h, w, d } = x;
  const plane = h * w;
  const pw = w + 2, pplane = (h + 2) * pw;
  const pad = new Float32Array(cin * pplane);
  for (let i = 0; i < cin; i++) for (let y = 0; y < h; y++) pad.set(d.subarray(i * plane + y * w, i * plane + y * w + w), i * pplane + (y + 1) * pw + 1);
  const out = new Float32Array(cout * plane);
  for (let o = 0; o < cout; o++) out.fill(B[o], o * plane, (o + 1) * plane);
  for (let o0 = 0; o0 < cout; o0 += 4) {
    const n4 = Math.min(4, cout - o0);
    const D0 = out.subarray(o0 * plane, (o0 + 1) * plane);
    const D1 = n4 > 1 ? out.subarray((o0 + 1) * plane, (o0 + 2) * plane) : new Float32Array(plane);
    const D2 = n4 > 2 ? out.subarray((o0 + 2) * plane, (o0 + 3) * plane) : new Float32Array(plane);
    const D3 = n4 > 3 ? out.subarray((o0 + 3) * plane, (o0 + 4) * plane) : new Float32Array(plane);
    for (let i = 0; i < cin; i++) {
      const P = pad.subarray(i * pplane, (i + 1) * pplane);
      const wb0 = (o0 * cin + i) * 9;
      const W0 = W;
      const W1 = n4 > 1 ? W : Z9, wb1 = n4 > 1 ? ((o0 + 1) * cin + i) * 9 : 0;
      const W2 = n4 > 2 ? W : Z9, wb2 = n4 > 2 ? ((o0 + 2) * cin + i) * 9 : 0;
      const W3 = n4 > 3 ? W : Z9, wb3 = n4 > 3 ? ((o0 + 3) * cin + i) * 9 : 0;
      const a00 = W0[wb0 + 0];
      const a01 = W0[wb0 + 1];
      const a02 = W0[wb0 + 2];
      const a03 = W0[wb0 + 3];
      const a04 = W0[wb0 + 4];
      const a05 = W0[wb0 + 5];
      const a06 = W0[wb0 + 6];
      const a07 = W0[wb0 + 7];
      const a08 = W0[wb0 + 8];
      const a10 = W1[wb1 + 0];
      const a11 = W1[wb1 + 1];
      const a12 = W1[wb1 + 2];
      const a13 = W1[wb1 + 3];
      const a14 = W1[wb1 + 4];
      const a15 = W1[wb1 + 5];
      const a16 = W1[wb1 + 6];
      const a17 = W1[wb1 + 7];
      const a18 = W1[wb1 + 8];
      const a20 = W2[wb2 + 0];
      const a21 = W2[wb2 + 1];
      const a22 = W2[wb2 + 2];
      const a23 = W2[wb2 + 3];
      const a24 = W2[wb2 + 4];
      const a25 = W2[wb2 + 5];
      const a26 = W2[wb2 + 6];
      const a27 = W2[wb2 + 7];
      const a28 = W2[wb2 + 8];
      const a30 = W3[wb3 + 0];
      const a31 = W3[wb3 + 1];
      const a32 = W3[wb3 + 2];
      const a33 = W3[wb3 + 3];
      const a34 = W3[wb3 + 4];
      const a35 = W3[wb3 + 5];
      const a36 = W3[wb3 + 6];
      const a37 = W3[wb3 + 7];
      const a38 = W3[wb3 + 8];
      for (let y = 0; y < h; y++) {
        const o = y * w;
        const q0 = y * pw, q1 = q0 + pw, q2 = q1 + pw;
        for (let xx = 0; xx < w; xx++) {
          const b0 = q0 + xx, b1 = q1 + xx, b2 = q2 + xx;
            const v0 = P[b0 + 0];
            const v1 = P[b0 + 1];
            const v2 = P[b0 + 2];
            const v3 = P[b1 + 0];
            const v4 = P[b1 + 1];
            const v5 = P[b1 + 2];
            const v6 = P[b2 + 0];
            const v7 = P[b2 + 1];
            const v8 = P[b2 + 2];
            D0[o + xx] += a00 * v0 + a01 * v1 + a02 * v2 + a03 * v3 + a04 * v4 + a05 * v5 + a06 * v6 + a07 * v7 + a08 * v8;
            D1[o + xx] += a10 * v0 + a11 * v1 + a12 * v2 + a13 * v3 + a14 * v4 + a15 * v5 + a16 * v6 + a17 * v7 + a18 * v8;
            D2[o + xx] += a20 * v0 + a21 * v1 + a22 * v2 + a23 * v3 + a24 * v4 + a25 * v5 + a26 * v6 + a27 * v7 + a28 * v8;
            D3[o + xx] += a30 * v0 + a31 * v1 + a32 * v2 + a33 * v3 + a34 * v4 + a35 * v5 + a36 * v6 + a37 * v7 + a38 * v8;
        }
      }
    }
  }
  if (relu) for (let j = 0; j < out.length; j++) if (out[j] < 0) out[j] = 0;
  return { c: cout, h, w, d: out };
}

export function maxpool(x, ph, pw) {
  const { c, h, w, d } = x;
  const oh = Math.floor(h / ph), ow = Math.floor(w / pw);
  const out = new Float32Array(c * oh * ow);
  for (let ch = 0; ch < c; ch++) {
    for (let y = 0; y < oh; y++) {
      for (let xx = 0; xx < ow; xx++) {
        let m = -Infinity;
        for (let a = 0; a < ph; a++) for (let b = 0; b < pw; b++) m = Math.max(m, d[ch * h * w + (y * ph + a) * w + xx * pw + b]);
        out[ch * oh * ow + y * ow + xx] = m;
      }
    }
  }
  return { c, h: oh, w: ow, d: out };
}

// LSTM über eine Folge (T x n), eine Richtung. Gewichte wie PyTorch: Gates i, f, g, o
// Skalarprodukt mit 4 Teilsummen (der Prozessor kann sie gleichzeitig rechnen)
function dotp(W, wi, v, vi, n) {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0;
  let k = 0;
  for (; k + 3 < n; k += 4) {
    s0 += W[wi + k] * v[vi + k];
    s1 += W[wi + k + 1] * v[vi + k + 1];
    s2 += W[wi + k + 2] * v[vi + k + 2];
    s3 += W[wi + k + 3] * v[vi + k + 3];
  }
  for (; k < n; k++) s0 += W[wi + k] * v[vi + k];
  return s0 + s1 + s2 + s3;
}

function lstmDir(seq, T, n, Wih, Whh, b, H, reverse) {
  const out = new Float32Array(T * H);
  const hs = new Float32Array(H);
  const cs = new Float32Array(H);
  const G = 4 * H;
  // Eingabe-Anteil für alle Zeitschritte vorab (unabhängig voneinander)
  const xin = new Float32Array(T * G);
  for (let t = 0; t < T; t++) for (let j = 0; j < G; j++) xin[t * G + j] = b[j] + dotp(Wih, j * n, seq, t * n, n);
  const g = new Float32Array(G);
  for (let step = 0; step < T; step++) {
    const t = reverse ? T - 1 - step : step;
    for (let j = 0; j < G; j++) g[j] = xin[t * G + j] + dotp(Whh, j * H, hs, 0, H);
    for (let k = 0; k < H; k++) {
      const i = sigm(g[k]);
      const f = sigm(g[H + k]);
      const gg = Math.tanh(g[2 * H + k]);
      const o = sigm(g[3 * H + k]);
      cs[k] = f * cs[k] + i * gg;
      hs[k] = o * Math.tanh(cs[k]);
    }
    out.set(hs, t * H);
  }
  return out;
}
const sigm = (x) => 1 / (1 + Math.exp(-x));

export function bilstm(seq, T, n, t, prefix, H) {
  const f = lstmDir(seq, T, n, t[`${prefix}.wih`], t[`${prefix}.whh`], t[`${prefix}.b`], H, false);
  const r = lstmDir(seq, T, n, t[`${prefix}.wih_r`], t[`${prefix}.whh_r`], t[`${prefix}.b_r`], H, true);
  const out = new Float32Array(T * 2 * H);
  for (let i = 0; i < T; i++) {
    out.set(f.subarray(i * H, (i + 1) * H), i * 2 * H);
    out.set(r.subarray(i * H, (i + 1) * H), i * 2 * H + H);
  }
  return out;
}

export function linear(v, rows, n, W, B, m) {
  const out = new Float32Array(rows * m);
  for (let r = 0; r < rows; r++) for (let j = 0; j < m; j++) out[r * m + j] = B[j] + dotp(W, j * n, v, r * n, n);
  return out;
}

export function softmaxRows(v, rows, m) {
  for (let r = 0; r < rows; r++) {
    let mx = -Infinity;
    for (let j = 0; j < m; j++) mx = Math.max(mx, v[r * m + j]);
    let s = 0;
    for (let j = 0; j < m; j++) s += v[r * m + j] = Math.exp(v[r * m + j] - mx);
    for (let j = 0; j < m; j++) v[r * m + j] /= s;
  }
  return v;
}

// ---------- Ein ganzes Modell laufen lassen ----------
// Geht die Schichtliste aus der Datei durch. Gibt die letzte Ausgabe zurück
// (bei Bildern als { c, h, w, d }, nach "seq" als { T, n, d }).
export function run(model, input, stopAt = null) {
  let x = input;
  for (const L of model.layers) {
    if (L.type === 'conv') x = conv3(x, model.t[`${L.name}.w`], model.t[`${L.name}.b`], L.out, L.relu !== false);
    else if (L.type === 'pool') x = maxpool(x, L.ph, L.pw);
    else if (L.type === 'seq') {
      // c x 1 x w -> Folge der Länge w mit c Merkmalen
      const T = x.w;
      const n = x.c * x.h;
      const d = new Float32Array(T * n);
      for (let t = 0; t < T; t++) for (let c = 0; c < x.c; c++) for (let y = 0; y < x.h; y++) d[t * n + c * x.h + y] = x.d[(c * x.h + y) * x.w + t];
      x = { T, n, d };
    } else if (L.type === 'flatten') {
      x = { T: 1, n: x.d.length, d: x.d };
    } else if (L.type === 'lstm') {
      x = { T: x.T, n: 2 * L.hidden, d: bilstm(x.d, x.T, x.n, model.t, L.name, L.hidden) };
    } else if (L.type === 'linear') {
      const d = linear(x.d, x.T, x.n, model.t[`${L.name}.w`], model.t[`${L.name}.b`], L.out);
      if (L.relu) for (let i = 0; i < d.length; i++) if (d[i] < 0) d[i] = 0;
      x = { T: x.T, n: L.out, d };
    }
    if (stopAt && L.name === stopAt) return x;
  }
  return x;
}
