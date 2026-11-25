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
export function conv3(x, W, B, cout, relu = true) {
  const { c: cin, h, w, d } = x;
  const out = new Float32Array(cout * h * w);
  const plane = h * w;
  for (let o = 0; o < cout; o++) {
    const dst = out.subarray(o * plane, (o + 1) * plane);
    dst.fill(B[o]);
    for (let i = 0; i < cin; i++) {
      const src = d.subarray(i * plane, (i + 1) * plane);
      const k = (o * cin + i) * 9;
      const k0 = W[k], k1 = W[k + 1], k2 = W[k + 2], k3 = W[k + 3], k4 = W[k + 4], k5 = W[k + 5], k6 = W[k + 6], k7 = W[k + 7], k8 = W[k + 8];
      for (let y = 0; y < h; y++) {
        const row = y * w;
        const up = y > 0 ? row - w : -1;
        const dn = y < h - 1 ? row + w : -1;
        for (let xx = 0; xx < w; xx++) {
          const l = xx > 0, r = xx < w - 1;
          let s = src[row + xx] * k4;
          if (l) s += src[row + xx - 1] * k3;
          if (r) s += src[row + xx + 1] * k5;
          if (up >= 0) {
            s += src[up + xx] * k1;
            if (l) s += src[up + xx - 1] * k0;
            if (r) s += src[up + xx + 1] * k2;
          }
          if (dn >= 0) {
            s += src[dn + xx] * k7;
            if (l) s += src[dn + xx - 1] * k6;
            if (r) s += src[dn + xx + 1] * k8;
          }
          dst[row + xx] += s;
        }
      }
    }
    if (relu) for (let j = 0; j < plane; j++) if (dst[j] < 0) dst[j] = 0;
  }
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
function lstmDir(seq, T, n, Wih, Whh, b, H, reverse) {
  const out = new Float32Array(T * H);
  const hs = new Float32Array(H);
  const cs = new Float32Array(H);
  const g = new Float32Array(4 * H);
  for (let step = 0; step < T; step++) {
    const t = reverse ? T - 1 - step : step;
    const xt = seq.subarray(t * n, (t + 1) * n);
    for (let j = 0; j < 4 * H; j++) {
      let s = b[j];
      const wi = j * n;
      for (let k = 0; k < n; k++) s += Wih[wi + k] * xt[k];
      const wh = j * H;
      for (let k = 0; k < H; k++) s += Whh[wh + k] * hs[k];
      g[j] = s;
    }
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
  for (let r = 0; r < rows; r++) {
    for (let j = 0; j < m; j++) {
      let s = B[j];
      const wj = j * n;
      const vr = r * n;
      for (let k = 0; k < n; k++) s += W[wj + k] * v[vr + k];
      out[r * m + j] = s;
    }
  }
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
