// mathink.js – handgeschriebene Mathe-Aufgaben lesen (offline, ohne Internet)
//
// So geht es:
//   1. Wurzelzeichen und Bruchstriche finden (sie "umschließen" andere Zeichen).
//   2. Die übrigen Striche zu Zeichen zusammenfassen: Striche, die sich waagerecht
//      überlappen, gehören zusammen (z. B. die zwei Striche vom "+" oder vom "=").
//   3. Jedes Zeichen erkennen:
//        - einfache Formen direkt (Punkt, Strich, =, :, ÷, 1, /)
//        - alles andere mit dem "$P-Erkenner": Er vergleicht die Punktwolke des Zeichens
//          mit gespeicherten Mustern (0–9, +, x, Klammern, √ …) und nimmt das ähnlichste.
//   4. Hochzahlen an der Lage erkennen (kleiner und höher als das Zeichen davor).
//
// Lernen: Erkennt die App ein Zeichen falsch und du verbesserst es, merkt sie sich deine
// Schreibweise als neues Muster (localStorage). So wird sie mit der Zeit immer besser.

import { loadModel, run, softmaxRows } from './nn.js';

const KEY = 'federleicht.mathink';

// ---------- Das trainierte Zeichen-Modell (htr/math.bin) ----------
// Ein kleines neuronales Netz, trainiert mit Ziffern und Zeichen von über 3.000 Menschen.
// Ohne Modell (z. B. Datei fehlt) nehmen wir den einfachen $P-Erkenner von unten.
let symModel = null;
let symLoading = null;
export function prepare() {
  if (!symLoading) {
    const base = document.baseURI.replace(/[^/]*$/, '');
    symLoading = loadModel(`${base}htr/math.bin`)
      .then((m) => (symModel = m))
      .catch((err) => console.warn('Mathe-Modell fehlt', err));
  }
  return symLoading;
}
// Was die Mathe-Hilfe als Ergebnis zulässt (andere Buchstaben gibt es nur zum Verbessern)
const ALLOWED = new Set(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'x', '+', '(', ')', '√', '/', 'π', '<', '>', '≤', '≥', '[', ']', '%']);

// Zeichen als 32x32-Bild malen: wie im Training zugeschnitten, längste Seite 26 Pixel, Mitte
function renderSym(strokes) {
  const S = 32;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of strokes) for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  const lw = 2.2;
  const k = (26 - lw) / Math.max(1e-3, maxX - minX, maxY - minY);
  const SS = 4;
  const c = document.createElement('canvas');
  c.width = c.height = S * SS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = lw * SS;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const ox = (S - (maxX - minX) * k) / 2;
  const oy = (S - (maxY - minY) * k) / 2;
  for (const pts of strokes) {
    ctx.beginPath();
    ctx.moveTo(((pts[0][0] - minX) * k + ox) * SS, ((pts[0][1] - minY) * k + oy) * SS);
    if (pts.length === 1) ctx.lineTo(((pts[0][0] - minX) * k + ox) * SS + 1, ((pts[0][1] - minY) * k + oy) * SS);
    for (const [x, y] of pts) ctx.lineTo(((x - minX) * k + ox) * SS, ((y - minY) * k + oy) * SS);
    ctx.stroke();
  }
  const small = document.createElement('canvas');
  small.width = small.height = S;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(c, 0, 0, S, S);
  const px = sctx.getImageData(0, 0, S, S).data;
  const d = new Float32Array(S * S);
  for (let i = 0; i < d.length; i++) d[i] = px[i * 4] / 255;
  return { c: 1, h: S, w: S, d };
}

// -> { ranked: [[label, wahrscheinlichkeit], …], emb }
function cnnRank(strokes) {
  const emb = run(symModel, renderSym(strokes), 'emb');
  const e = emb.d.slice();
  const outL = symModel.layers.find((l) => l.name === 'out');
  const logits = new Float32Array(outL.out);
  const W = symModel.t['out.w'], B = symModel.t['out.b'];
  for (let j = 0; j < outL.out; j++) {
    let s = B[j];
    for (let i = 0; i < e.length; i++) s += W[j * e.length + i] * e[i];
    logits[j] = s;
  }
  softmaxRows(logits, 1, outL.out);
  const syms = symModel.meta.symbols;
  const ranked = [...logits].map((p, i) => [syms[i], p]).sort((a, b) => b[1] - a[1]);
  return { ranked, emb: normalize(e) };
}
function normalize(v) {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  return Array.from(v, (x) => x / n);
}
const dot = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
const N = 32; // Punkte pro Zeichen beim Vergleichen

// ---------- Muster (in einem Kästchen 0..1, y nach unten) ----------
function arc(cx, cy, rx, ry, a0, a1, n = 14) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = ((a0 + ((a1 - a0) * i) / n) * Math.PI) / 180;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}
const L = (...pts) => pts;

const BASE = {
  0: [[arc(0.3, 0.5, 0.3, 0.5, -90, 270, 24)], [arc(0.3, 0.5, 0.27, 0.5, -60, 290, 24)]],
  1: [[L([0.3, 0], [0.3, 1])], [L([0.08, 0.25], [0.32, 0], [0.32, 1])], [L([0.08, 0.25], [0.32, 0], [0.32, 1]), L([0.05, 1], [0.6, 1])]],
  2: [
    [[...arc(0.3, 0.28, 0.28, 0.28, 195, 380), [0.02, 1], [0.62, 1]]],
    [[...arc(0.3, 0.3, 0.28, 0.3, 200, 360), [0.3, 0.7], [0.02, 1], [0.62, 1]]],
    [[...arc(0.3, 0.28, 0.28, 0.28, 195, 380), [0.02, 1], ...arc(0.12, 0.9, 0.1, 0.1, 180, 360, 5), [0.62, 1]]],
  ],
  3: [
    [[...arc(0.28, 0.25, 0.25, 0.25, 200, 450), ...arc(0.28, 0.74, 0.27, 0.26, 270, 520)]],
    [[[0.02, 0], [0.55, 0], [0.22, 0.42], ...arc(0.28, 0.7, 0.28, 0.3, 280, 520)]],
  ],
  4: [
    [L([0.45, 1], [0.45, 0], [0, 0.68], [0.65, 0.68])],
    [L([0.25, 0], [0.02, 0.62], [0.65, 0.62]), L([0.48, 0.3], [0.48, 1])],
    [L([0.2, 0], [0.05, 0.6], [0.65, 0.6]), L([0.5, 0], [0.5, 1])],
  ],
  5: [
    [[[0.58, 0], [0.12, 0], [0.08, 0.42], ...arc(0.28, 0.69, 0.3, 0.3, 245, 520)]],
    [[[0.12, 0], [0.08, 0.42], ...arc(0.28, 0.69, 0.3, 0.3, 245, 520)], L([0.12, 0.02], [0.6, 0])],
  ],
  6: [
    [[[0.52, 0], [0.32, 0.12], [0.14, 0.36], [0.05, 0.62], [0.09, 0.86], [0.28, 1], [0.48, 0.92], [0.56, 0.72], [0.46, 0.55], [0.26, 0.53], [0.08, 0.68]]],
    [[[0.45, 0], [0.2, 0.25], [0.06, 0.55], ...arc(0.3, 0.75, 0.25, 0.25, 180, 540, 18)]],
  ],
  7: [[L([0, 0], [0.62, 0], [0.22, 1])], [L([0, 0], [0.62, 0], [0.22, 1]), L([0.12, 0.5], [0.55, 0.5])], [L([0, 0.12], [0, 0], [0.62, 0], [0.25, 1])]],
  8: [
    [[[0.5, 0.1], [0.3, 0], [0.1, 0.1], [0.12, 0.3], [0.3, 0.46], [0.5, 0.62], [0.56, 0.85], [0.3, 1], [0.05, 0.85], [0.1, 0.62], [0.3, 0.46], [0.48, 0.3], [0.5, 0.1]]],
    [arc(0.3, 0.24, 0.22, 0.24, 0, 360, 16), arc(0.3, 0.73, 0.27, 0.27, 0, 360, 16)],
  ],
  9: [
    [[...arc(0.28, 0.27, 0.28, 0.27, 0, 360, 18), [0.56, 0.6], [0.52, 1]]],
    [[...arc(0.28, 0.27, 0.28, 0.27, 0, 360, 18), [0.55, 0.6], [0.4, 0.9], [0.15, 1]]],
    [arc(0.28, 0.27, 0.28, 0.27, 0, 360, 18), L([0.56, 0.2], [0.56, 1])],
  ],
  '+': [[L([0.5, 0], [0.5, 1]), L([0, 0.5], [1, 0.5])]],
  x: [
    [L([0, 0], [0.8, 1]), L([0.8, 0], [0, 1])],
    [arc(0.05, 0.5, 0.35, 0.5, -70, 70, 8), arc(0.75, 0.5, 0.35, 0.5, 110, 250, 8)],
  ],
  '(': [[arc(0.4, 0.5, 0.4, 0.55, 115, 245, 12)]],
  ')': [[arc(0, 0.5, 0.4, 0.55, -65, 65, 12)]],
  '√': [[L([0, 0.6], [0.12, 0.5], [0.3, 1], [0.45, 0], [1.2, 0])], [L([0, 0.65], [0.15, 0.55], [0.3, 1], [0.45, 0])]],
};

// Alle Zeichen, die man beim Verbessern auswählen kann
export const SYMBOLS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', '-', '·', ':', '=', 'x', '(', ')', ',', '√', '/', 'π', '<', '>', '≤', '≥', '%', '[', ']'];

// ---------- $P-Erkenner (Vatavu, Anthony, Wobbrock 2012) ----------
function cloud(strokes) {
  const pts = [];
  strokes.forEach((s, id) => s.forEach((p) => pts.push([p[0], p[1], id])));
  if (pts.length === 1) pts.push([pts[0][0] + 0.001, pts[0][1], 0]);
  const r = resample(pts, N);
  // gleichmäßig skalieren (Seitenverhältnis bleibt!) und Schwerpunkt in die Mitte
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of r) {
    minX = Math.min(minX, p[0]);
    maxX = Math.max(maxX, p[0]);
    minY = Math.min(minY, p[1]);
    maxY = Math.max(maxY, p[1]);
  }
  const size = Math.max(maxX - minX, maxY - minY) || 1;
  let cx = 0, cy = 0;
  const out = r.map((p) => [(p[0] - minX) / size, (p[1] - minY) / size]);
  for (const p of out) {
    cx += p[0];
    cy += p[1];
  }
  cx /= out.length;
  cy /= out.length;
  return out.map((p) => [p[0] - cx, p[1] - cy]);
}

function resample(pts, n) {
  let len = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i][2] === pts[i - 1][2]) len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  const I = len / (n - 1) || 1e-6;
  const src = pts.map((p) => [...p]);
  const out = [src[0]];
  let D = 0;
  for (let i = 1; i < src.length; i++) {
    if (src[i][2] !== src[i - 1][2]) continue;
    const d = Math.hypot(src[i][0] - src[i - 1][0], src[i][1] - src[i - 1][1]);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d;
      const q = [src[i - 1][0] + t * (src[i][0] - src[i - 1][0]), src[i - 1][1] + t * (src[i][1] - src[i - 1][1]), src[i][2]];
      out.push(q);
      src.splice(i, 0, q);
      D = 0;
    } else D += d;
  }
  while (out.length < n) out.push(src[src.length - 1]);
  return out.slice(0, n);
}

function cloudDistance(a, b, start) {
  const n = a.length;
  const matched = new Array(n).fill(false);
  let sum = 0;
  let i = start;
  do {
    let min = Infinity;
    let index = -1;
    for (let j = 0; j < n; j++) {
      if (matched[j]) continue;
      const d = (a[i][0] - b[j][0]) ** 2 + (a[i][1] - b[j][1]) ** 2;
      if (d < min) {
        min = d;
        index = j;
      }
    }
    matched[index] = true;
    const weight = 1 - ((i - start + n) % n) / n;
    sum += weight * Math.sqrt(min);
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}

function match(a, b) {
  const step = Math.floor(Math.pow(N, 0.5));
  let min = Infinity;
  for (let i = 0; i < N; i += step) min = Math.min(min, cloudDistance(a, b, i), cloudDistance(b, a, i));
  return min;
}

// Eingebaute Muster einmal vorbereiten
const BUILT_IN = [];
for (const [label, variants] of Object.entries(BASE)) for (const strokes of variants) BUILT_IN.push({ label, pts: cloud(strokes), n: strokes.length });

// ---------- Gelernte Muster ----------
let learned = null;
function loadLearned() {
  if (learned) return learned;
  try {
    learned = JSON.parse(localStorage.getItem(KEY) || '[]');
  } catch {
    learned = [];
  }
  return learned;
}
export function learnedCount() {
  return loadLearned().length;
}
export function forgetLearned() {
  learned = [];
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
}
// Ein Zeichen (seine Striche) als Muster für label merken
export function learn(sym, label) {
  if (!sym?.strokes?.length || (!BASE[label] && !ALLOWED.has(label))) return;
  const list = loadLearned();
  const entry = { label, pts: cloud(sym.strokes.map(localPts)).map((p) => [+p[0].toFixed(3), +p[1].toFixed(3)]), n: sym.strokes.length };
  if (symModel) entry.emb = cnnRank(sym.strokes.map(localPts)).emb.map((x) => +x.toFixed(3));
  list.push(entry);
  // höchstens 25 pro Zeichen, die ältesten fliegen raus
  const per = list.filter((t) => t.label === label);
  if (per.length > 25) list.splice(list.indexOf(per[0]), 1);
  learned = list;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* Speicher voll – dann eben nicht */
  }
}

function classifyCloud(strokes, allowed = null) {
  const c = cloud(strokes);
  const scores = new Map();
  const consider = (t, bonus) => {
    if (allowed && !allowed.includes(t.label)) return;
    const d = match(c, t.pts) * bonus;
    if (!scores.has(t.label) || d < scores.get(t.label)) scores.set(t.label, d);
  };
  for (const t of BUILT_IN) consider(t, 1);
  for (const t of loadLearned()) consider(t, 0.85); // deine eigene Schrift zählt mehr
  return [...scores].sort((a, b) => a[1] - b[1]); // [[label, abstand], …]
}

// ---------- Hilfen für Striche ----------
const localPts = (s) => s.points.map((p) => [p[0], p[1]]);
function boxOf(list) {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const s of list) {
    const q = s.box;
    b.minX = Math.min(b.minX, q.minX);
    b.minY = Math.min(b.minY, q.minY);
    b.maxX = Math.max(b.maxX, q.maxX);
    b.maxY = Math.max(b.maxY, q.maxY);
  }
  return b;
}
const W = (b) => b.maxX - b.minX;
const H = (b) => b.maxY - b.minY;
const cx = (b) => (b.minX + b.maxX) / 2;
const cy = (b) => (b.minY + b.maxY) / 2;

// Wie gerade ist ein Strich? 1 = ganz gerade
function straightness(s) {
  const p = s.points;
  let len = 0;
  for (let i = 1; i < p.length; i++) len += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  if (!len) return 1;
  return Math.hypot(p[p.length - 1][0] - p[0][0], p[p.length - 1][1] - p[0][1]) / len;
}
// Waagerechter Strich (Minus, Bruchstrich, Teil vom =)?
function isFlat(s, h) {
  const b = s.box;
  return W(b) > Math.max(H(b) * 3.2, h * 0.3) && (s.shape === 'line' || straightness(s) > 0.85);
}

// ---------- Erkennen ----------
// strokes: Striche einer Seite (mit box, points). Ergebnis:
//   { rows: [{ box, items, text }], symbols: [sym] }  sym = { label, strokes, box, alts }
export function recognize(strokes) {
  const ink = strokes.filter((s) => s.box && s.points?.length && (s.tool === 'pen' || s.tool === 'highlighter'));
  if (!ink.length) return { rows: [], symbols: [] };
  const h = typicalHeight(ink);
  const symbols = [];
  const rows = splitRows(ink, h).map((list) => {
    const items = parseRegion(list, h, symbols);
    return { box: boxOf(list), items, strokes: list };
  });
  for (const r of rows) {
    r.text = stringify(r.items);
    r.pretty = prettyMath(r.items).trim();
  }
  return { rows, symbols, h };
}

// Typische Zeichenhöhe: Mittel der höheren Striche (Punkte und Striche zählen nicht)
function typicalHeight(ink) {
  const hs = ink.map((s) => H(s.box)).sort((a, b) => a - b);
  const max = hs[hs.length - 1] || 1;
  const tall = hs.filter((v) => v > max * 0.3);
  return Math.max(4, tall[Math.floor(tall.length * 0.7)] || max);
}

// Zeilen: Striche, die (etwas vergrößert) senkrecht überlappen, gehören zu einer Zeile
function splitRows(ink, h) {
  const sorted = [...ink].sort((a, b) => a.box.minY - b.box.minY);
  const rows = [];
  for (const s of sorted) {
    const top = s.box.minY - h * 0.28;
    const row = rows[rows.length - 1];
    if (row && top < row.maxY) {
      row.list.push(s);
      row.maxY = Math.max(row.maxY, s.box.maxY + h * 0.28);
    } else rows.push({ list: [s], maxY: s.box.maxY + h * 0.28 });
  }
  return rows.map((r) => r.list);
}

// Einen Bereich (Liste von Strichen) in Teile zerlegen: [{ kind: 'sym'|'root'|'frac', box, … }]
function parseRegion(list, h, symbols) {
  let rest = [...list];
  const parts = [];

  // 1. Wurzeln: ein Strich wie ein Häkchen mit langem Dach, unter dem andere Zeichen stehen
  for (const s of [...rest].sort((a, b) => W(b.box) - W(a.box))) {
    if (!rest.includes(s) || W(s.box) < h * 0.9 || s.points.length < 4) continue;
    const b = s.box;
    const inner = rest.filter((o) => o !== s && cx(o.box) > b.minX + W(b) * 0.3 && cx(o.box) < b.maxX + h * 0.1 && cy(o.box) > b.minY && cy(o.box) < b.maxY + h * 0.2);
    if (!inner.length) continue;
    const ranked = classifyCloud([localPts(s)]);
    const root = ranked.find((r) => r[0] === '√');
    if (!root || root[1] > ranked[0][1] * 1.08 || !rootShape(s)) continue;
    rest = rest.filter((o) => o !== s && !inner.includes(o));
    parts.push({ kind: 'root', box: boxOf([s, ...inner]), inner: parseRegion(inner, h, symbols), stroke: s });
  }

  // 2. Bruchstriche: waagerechter Strich mit Zeichen darüber UND darunter
  for (const s of [...rest].sort((a, b) => W(b.box) - W(a.box))) {
    if (!rest.includes(s) || !isFlat(s, h)) continue;
    const b = s.box;
    const y = cy(b);
    const within = (o) => o !== s && cx(o.box) > b.minX - h * 0.15 && cx(o.box) < b.maxX + h * 0.15;
    const above = rest.filter((o) => within(o) && cy(o.box) < y && o.box.maxY < y + h * 0.2 && y - o.box.maxY < h * 1.2);
    const below = rest.filter((o) => within(o) && cy(o.box) > y && o.box.minY > y - h * 0.2 && o.box.minY - y < h * 1.2);
    const real = (arr) => arr.some((o) => !isFlat(o, h));
    if (!real(above) || !real(below)) continue;
    // Zeichen, die nur teilweise über dem Strich stehen, gehören auch dazu (alles in der Spalte)
    const num = growColumn(rest, above, s, -1, h);
    const den = growColumn(rest, below, s, 1, h);
    rest = rest.filter((o) => o !== s && !num.includes(o) && !den.includes(o));
    parts.push({ kind: 'frac', box: boxOf([s, ...num, ...den]), num: parseRegion(num, h * 0.9, symbols), den: parseRegion(den, h * 0.9, symbols), stroke: s });
  }

  // 3. Rest: Striche zu Zeichen zusammenfassen (waagerechte Überlappung)
  const groups = [];
  for (const s of [...rest].sort((a, b) => a.box.minX - b.box.minX)) {
    const g = groups.find((g) => overlaps(g, s, h));
    if (g) {
      g.strokes.push(s);
      g.box = boxOf(g.strokes);
    } else groups.push({ strokes: [s], box: { ...s.box } });
  }
  // Gruppen, die sich nach dem Zusammenfassen überlappen, nochmal verbinden
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) {
      if (overlapX(groups[i].box, groups[j].box) > 0.5 * Math.min(W(groups[i].box), W(groups[j].box)) && !separateStack(groups[i], groups[j], h)) {
        groups[i].strokes.push(...groups[j].strokes);
        groups[i].box = boxOf(groups[i].strokes);
        groups.splice(j, 1);
        j = i;
      }
    }
  }
  for (const g of groups) {
    const sym = classify(g, h, list);
    symbols.push(sym);
    parts.push({ kind: 'sym', box: sym.box, sym });
  }

  parts.sort((a, b) => a.box.minX - b.box.minX || a.box.minY - b.box.minY);
  markSuperscripts(parts, h);
  return parts;
}

function rootShape(s) {
  // Der tiefste Punkt liegt im linken Drittel, das Ende oben rechts
  const p = s.points;
  const b = s.box;
  let low = p[0];
  for (const q of p) if (q[1] > low[1]) low = q;
  const end = p[p.length - 1];
  const start = p[0];
  const rightTop = (q) => q[0] > b.minX + W(b) * 0.6 && q[1] < b.minY + H(b) * 0.3;
  return low[0] < b.minX + W(b) * 0.45 && (rightTop(end) || rightTop(start));
}

function growColumn(rest, seed, bar, dir, h) {
  const out = [...seed];
  let added = true;
  while (added) {
    added = false;
    const b = boxOf(out);
    for (const o of rest) {
      if (o === bar || out.includes(o)) continue;
      const side = dir < 0 ? cy(o.box) < cy(bar.box) : cy(o.box) > cy(bar.box);
      if (side && overlapX(o.box, b) > 0.3 * Math.min(W(o.box) || 1, W(b)) && o.box.minX > bar.box.minX - h * 0.3 && o.box.maxX < bar.box.maxX + h * 0.3) {
        out.push(o);
        added = true;
      }
    }
  }
  return out;
}

const overlapX = (a, b) => Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX);
function overlaps(g, s, h) {
  const ov = overlapX(g.box, s.box);
  const narrow = Math.max(h * 0.12, Math.min(W(g.box), W(s.box)));
  if (ov < narrow * 0.35) return false;
  return !separateStack(g, { strokes: [s], box: s.box }, h);
}
// Zwei Dinge übereinander, die NICHT zusammengehören (z. B. Hochzahl über einem Minus)? – nur wenn weit auseinander
function separateStack(a, b, h) {
  const gap = Math.max(a.box.minY, b.box.minY) - Math.min(a.box.maxY, b.box.maxY);
  return gap > h * 0.75;
}

// Ein Zeichen erkennen
function classify(g, h, all) {
  const strokes = g.strokes;
  const b = g.box;
  const size = Math.max(W(b), H(b));
  const tiny = (s) => Math.max(W(s.box), H(s.box)) < h * 0.22;
  const sym = { strokes: strokes.map((s) => s), box: b, label: '?', alts: [] };
  const flats = strokes.filter((s) => isFlat(s, h));
  const dots = strokes.filter(tiny);

  // Punkte
  if (dots.length === strokes.length) {
    if (strokes.length >= 2) return set(sym, ':', ['·', ',']);
    // tief unten = Komma (Dezimalzahl), mittig = mal
    // Nachbarn (gleiche Zeile, links und rechts) bestimmen, wo oben und unten ist
    const near = all.filter((s) => !tiny(s) && Math.abs(cx(s.box) - cx(b)) < h * 2.5 && s.box.minY < b.maxY + h * 0.5 && s.box.maxY > b.minY - h * 0.5);
    const nb = near.length ? boxOf(near) : boxOf(all);
    const rel = (cy(b) - nb.minY) / (H(nb) || 1);
    return rel > 0.78 ? set(sym, ',', ['·']) : set(sym, '·', [',']);
  }
  // = (zwei waagerechte Striche übereinander), ÷ (Strich mit Punkten)
  if (flats.length === 2 && strokes.length === 2) return set(sym, '=', ['-', '+']);
  if (flats.length === 1 && strokes.length === 3 && dots.length === 2) return set(sym, ':', ['=']);
  if (flats.length === 1 && strokes.length === 1) return set(sym, '-', ['=', '1']);
  // Einzelner gerader Strich: 1 oder /
  if (strokes.length === 1 && straightness(strokes[0]) > 0.92 && size > h * 0.35) {
    const s = strokes[0];
    const p = s.points;
    const dx = p[p.length - 1][0] - p[0][0];
    const dy = p[p.length - 1][1] - p[0][1];
    const angle = (Math.atan2(Math.abs(dy), Math.abs(dx)) * 180) / Math.PI; // 0 = waagerecht, 90 = senkrecht
    if (angle < 22) return set(sym, '-', ['=']);
    if (angle > 68) return set(sym, '1', ['/', '(', ')']);
    if (dx * dy < 0) return set(sym, '/', ['1', 'x']); // von unten links nach oben rechts
  }
  let ranked;
  if (symModel) {
    const r = cnnRank(strokes.map(localPts));
    ranked = r.ranked.filter(([l]) => ALLOWED.has(l)).map(([l, p]) => [l, 1 - p]);
    // Deine eigene Schrift: sehr ähnlich zu einem Zeichen, das du schon verbessert hast?
    let best = null;
    for (const t of loadLearned()) {
      if (!t.emb) continue;
      const sim = dot(r.emb, t.emb);
      if (sim > 0.9 && (!best || sim > best.sim)) best = { sim, label: t.label };
    }
    if (best) ranked = [[best.label, 0], ...ranked.filter(([l]) => l !== best.label)];
  } else {
    ranked = classifyCloud(strokes.map(localPts), ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '+', 'x', '(', ')', '√']);
  }
  let label = ranked[0][0];
  // Klammern sind schmal und hoch – breite "Klammern" sind meist etwas anderes
  if ((label === '(' || label === ')') && W(b) > H(b) * 0.75) label = ranked.find((r) => r[0] !== '(' && r[0] !== ')')[0];
  // "0" mit zwei Strichen ist eher eine 8? – nein: eher ein x oder +; der Erkenner hat das schon gewogen
  return set(sym, label, ranked.slice(0, 5).map((r) => r[0]).filter((l) => l !== label));
}
function set(sym, label, alts) {
  sym.label = label;
  sym.alts = alts;
  return sym;
}

// Hochzahlen: kleineres Zeichen, deutlich höher als das Zeichen davor
function markSuperscripts(parts, h) {
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    // Basis: das letzte Zeichen davor, das selbst keine Hochzahl ist
    let j = i - 1;
    while (j >= 0 && parts[j].sup) j--;
    if (j < 0) continue;
    const base = parts[j];
    const bl = base.kind === 'sym' ? base.sym.label : 'x';
    if (!/[0-9x)]/.test(bl) && base.kind === 'sym') continue;
    const ph = H(p.box);
    // Bezugsgröße: Ziffern sind so hoch wie die Zeile, ein "x" nur halb – also mindestens fast h
    const bh = Math.max(H(base.box), h * 0.9);
    const foot = base.box.maxY; // Grundlinie der Basis
    // hochgestellt = deutlich kleiner UND der Fuß liegt über der Mitte der Basis
    const raised = cy(p.box) < foot - bh * 0.6 && p.box.maxY < foot - bh * 0.42;
    const prevSup = parts[i - 1].sup && cy(p.box) < foot - bh * 0.6 && p.box.maxY < foot - bh * 0.35;
    const flat = p.kind === 'sym' && /^[-−]$/.test(p.sym.label);
    if (flat && !(p.box.maxY < base.box.minY)) continue; // Minus auf Mitte = Rechenzeichen
    if ((raised && ph < bh * 0.8) || (prevSup && ph < bh * 0.8)) {
      if (p.kind === 'sym' && /^[=:,]$/.test(p.sym.label)) continue;
      p.sup = true;
    }
  }
}

// Teile -> Text für den Rechner, z. B. "3x^(2)+(1)/(2)=√(9)"
export function stringify(parts) {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.sup && !parts[i - 1]?.sup) {
      let k = i;
      const run = [];
      while (k < parts.length && parts[k].sup) run.push(parts[k++]);
      out += `^(${stringify(run.map((r) => ({ ...r, sup: false })))})`;
      i = k - 1;
      continue;
    }
    if (p.kind === 'root') out += `√(${stringify(p.inner)})`;
    else if (p.kind === 'frac') out += `(${stringify(p.num)})/(${stringify(p.den)})`;
    else {
      const l = p.sym.label;
      out += l === '·' ? '*' : l === '−' ? '-' : l === '?' ? '' : l;
    }
  }
  return out;
}

// "x" zwischen zwei Zahlen als "mal" lesen (Einstellung)
export function xAsTimes(text) {
  return text.replace(/(\d|\))x(?=\d|\()/g, '$1*');
}

// Teile -> schöner Text zum Weiterschreiben, z. B. "3x² + ½ = √9"
// (Hochzahlen als echte hochgestellte Zeichen, wenn es sie gibt; sonst x^(…))
const SUPS = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '(': '⁽', ')': '⁾', x: 'ˣ', n: 'ⁿ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', t: 'ᵗ' };
const SUBS = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉' };
const simple = (s) => /^[0-9a-zπ.,]+$/i.test(s);
export function prettyMath(parts) {
  let out = '';
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.sup && !parts[i - 1]?.sup) {
      let k = i;
      const run = [];
      while (k < parts.length && parts[k].sup) run.push(parts[k++]);
      const inner = prettyMath(run.map((r) => ({ ...r, sup: false }))).replace(/\s+/g, '');
      out += [...inner].every((c) => SUPS[c]) ? [...inner].map((c) => SUPS[c]).join('') : `^(${inner})`;
      i = k - 1;
      continue;
    }
    if (p.kind === 'root') {
      const inner = prettyMath(p.inner).trim();
      out += simple(inner) ? `√${inner}` : `√(${inner})`;
    } else if (p.kind === 'frac') {
      const a = prettyMath(p.num).trim();
      const b = prettyMath(p.den).trim();
      if (/^\d$/.test(a) && /^\d$/.test(b)) out += `${SUPS[a]}⁄${SUBS[b]}`;
      else out += `${simple(a) ? a : `(${a})`}/${simple(b) ? b : `(${b})`}`;
    } else {
      const l = p.sym.label;
      if (l === '?') continue;
      if (/^[=+<>≤≥±]$/.test(l)) out += ` ${l} `;
      else if (l === '-' || l === '−') out += out.trim() && !/[(=]\s*$/.test(out) ? ' − ' : '−';
      else if (l === '·' || l === '*') out += ' · ';
      else if (l === ':') out += ' : ';
      else out += l;
    }
  }
  return out.replace(/\s{2,}/g, ' ');
}
