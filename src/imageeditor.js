// imageeditor.js – Bild bearbeiten: zuschneiden, drehen, Arbeitsblatt geraderücken (Etappe 8)
//
// Öffnet sich über "Bearbeiten" in der Lasso-Leiste, wenn genau ein Bild ausgewählt ist.
//
//   Zuschneiden    Rahmen mit Ecken und Kanten: Ränder (z. B. der Tisch) wegschneiden
//   Geraderücken   die vier Ecken frei auf die Ecken des Arbeitsblatts ziehen – das Blatt wird
//                  danach so entzerrt, als hättest du es genau von oben fotografiert
//   Blatt finden   sucht das helle Blatt auf dunklerem Grund und setzt die Ecken automatisch
//   Drehen         in 90°-Schritten
//   Filter         Original, Scan (Hintergrund weiß, Schrift kräftig), Schwarzweiß
//
// Nichts geht verloren: Das Original bleibt gespeichert (item.src). Beim nächsten Bearbeiten
// startet man wieder vom ganzen Originalbild mit den alten Ecken – "Zurücksetzen" holt alles zurück.
//
// Alles, was man sieht, wird auf ein Canvas gemalt (auch Rahmen und Griffe). So kann der
// Dunkelmodus von Samsung Internet nichts verfälschen.

import { getBitmap, ensureLoaded, MAX_IMAGE } from './media.js';

const HANDLE_HIT = 34; // so nah (Bildschirm-Pixel) muss man einen Griff treffen
const LOUPE = 116;     // Durchmesser der Lupe beim Ziehen einer Ecke

const ICON = {
  rotate: '<svg viewBox="0 0 24 24"><path d="M5 12a7 7 0 1 0 2.1-5"/><path d="M6.5 3.5v4h4"/></svg>',
  crop: '<svg viewBox="0 0 24 24"><path d="M6.5 3v14.5H21"/><path d="M3 6.5h14.5V21"/></svg>',
  perspective: '<svg viewBox="0 0 24 24"><path d="M6 5.5 18.5 4 20 19.5 4 17.5z"/><circle cx="6" cy="5.5" r="1.6"/><circle cx="18.5" cy="4" r="1.6"/><circle cx="20" cy="19.5" r="1.6"/><circle cx="4" cy="17.5" r="1.6"/></svg>',
  auto: '<svg viewBox="0 0 24 24"><path d="M5 9V5h4M15 5h4v4M19 15v4h-4M9 19H5v-4"/><path d="m12 8 1.2 2.8L16 12l-2.8 1.2L12 16l-1.2-2.8L8 12l2.8-1.2z"/></svg>',
  reset: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3"/><path d="M4.5 4.5v4h4"/><path d="M12 8.5V12l2.5 1.5"/></svg>',
};

const FILTERS = [
  { id: 'none', name: 'Original' },
  { id: 'scan', name: 'Scan' },
  { id: 'bw', name: 'Schwarzweiß' },
];

// ---------- Kleine Rechenhilfen ----------

// Punkt im Originalbild (x, y) -> Punkt im gedrehten Bild (r Vierteldrehungen im Uhrzeigersinn)
function rotPoint([x, y], r, w, h) {
  switch (r & 3) {
    case 1: return [h - y, x];
    case 2: return [w - x, h - y];
    case 3: return [y, w - x];
    default: return [x, y];
  }
}
function unrotPoint([x, y], r, w, h) {
  switch (r & 3) {
    case 1: return [y, h - x];
    case 2: return [w - x, h - y];
    case 3: return [w - y, x];
    default: return [x, y];
  }
}

// Vier Punkte als Ecken sortieren: oben links, oben rechts, unten rechts, unten links
function orderCorners(pts) {
  const tl = pts.reduce((a, b) => (b[0] + b[1] < a[0] + a[1] ? b : a));
  const br = pts.reduce((a, b) => (b[0] + b[1] > a[0] + a[1] ? b : a));
  const rest = pts.filter((p) => p !== tl && p !== br);
  if (rest.length !== 2) return pts;
  const [p, q] = rest;
  const tr = p[0] - p[1] > q[0] - q[1] ? p : q;
  const bl = tr === p ? q : p;
  return [tl, tr, br, bl];
}

// Projektive Abbildung vom Einheitsquadrat auf ein Viereck (Ecken TL, TR, BR, BL)
function squareToQuad(q) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const det = dx1 * dy2 - dx2 * dy1;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0;
  const d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return [(a * u + b * v + c) / w, (d * u + e * v + f) / w];
  };
}

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function isAxisRect(q) {
  const eps = 0.5;
  return Math.abs(q[0][1] - q[1][1]) < eps && Math.abs(q[2][1] - q[3][1]) < eps && Math.abs(q[0][0] - q[3][0]) < eps && Math.abs(q[1][0] - q[2][0]) < eps;
}

// Ist das Viereck "ordentlich" (nicht verdreht, alle Ecken konvex)?
function convex(q) {
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const a = q[i], b = q[(i + 1) % 4], c = q[(i + 2) % 4];
    const z = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(z) < 1e-6) return false;
    if (!sign) sign = Math.sign(z);
    else if (Math.sign(z) !== sign) return false;
  }
  return true;
}

// ---------- Blatt automatisch finden ----------
// Verkleinert das Bild, trennt hell (Papier) von dunkel (Tisch) und sucht die größte helle Fläche
// um die Bildmitte. Ihre äußersten Punkte in den vier Diagonal-Richtungen sind die Ecken.
function detectSheet(source, w, h) {
  const k = Math.min(1, 320 / Math.max(w, h));
  const sw = Math.max(8, Math.round(w * k));
  const sh = Math.max(8, Math.round(h * k));
  const c = document.createElement('canvas');
  c.width = sw;
  c.height = sh;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, sw, sh);
  const data = ctx.getImageData(0, 0, sw, sh).data;
  const n = sw * sh;
  const lum = new Float32Array(n);
  const hist = new Array(256).fill(0);
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    // Papier ist hell UND ziemlich farblos -> Sättigung zieht etwas ab
    const l = 0.299 * r + 0.587 * g + 0.114 * b - (Math.max(r, g, b) - Math.min(r, g, b)) * 0.35;
    lum[i] = Math.max(0, Math.min(255, l));
    hist[lum[i] | 0]++;
  }
  // Otsu: die Schwelle, die hell und dunkel am besten trennt
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = n - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  const bright = new Uint8Array(n);
  for (let i = 0; i < n; i++) bright[i] = lum[i] > threshold ? 1 : 0;
  // Größte helle Fläche (bevorzugt die in der Mitte)
  const label = new Int32Array(n).fill(-1);
  let bestComp = null;
  for (let start = 0; start < n; start++) {
    if (!bright[start] || label[start] >= 0) continue;
    const stack = [start];
    label[start] = start;
    let count = 0, cx = 0, cy = 0;
    const pts = [];
    while (stack.length) {
      const i = stack.pop();
      const x = i % sw, y = (i / sw) | 0;
      count++;
      cx += x;
      cy += y;
      pts.push(i);
      const nb = [x > 0 ? i - 1 : -1, x < sw - 1 ? i + 1 : -1, y > 0 ? i - sw : -1, y < sh - 1 ? i + sw : -1];
      for (const j of nb) {
        if (j >= 0 && bright[j] && label[j] < 0) {
          label[j] = start;
          stack.push(j);
        }
      }
    }
    const dx = cx / count / sw - 0.5, dy = cy / count / sh - 0.5;
    const score = count * (1 - Math.min(0.8, Math.hypot(dx, dy)));
    if (!bestComp || score > bestComp.score) bestComp = { score, count, pts };
  }
  if (!bestComp || bestComp.count < n * 0.12 || bestComp.count > n * 0.985) return null;
  let tl = null, tr = null, br = null, bl = null;
  for (const i of bestComp.pts) {
    const x = i % sw, y = (i / sw) | 0;
    if (!tl || x + y < tl[0] + tl[1]) tl = [x, y];
    if (!br || x + y > br[0] + br[1]) br = [x, y];
    if (!tr || x - y > tr[0] - tr[1]) tr = [x, y];
    if (!bl || x - y < bl[0] - bl[1]) bl = [x, y];
  }
  const quad = [tl, tr, br, bl].map(([x, y]) => [Math.min(w, Math.max(0, (x + 0.5) / k)), Math.min(h, Math.max(0, (y + 0.5) / k))]);
  if (!convex(quad)) return null;
  return quad;
}

// ---------- Filter (auf ImageData) ----------
function applyFilter(canvas, filter) {
  if (filter === 'none') return;
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  // Hintergrund schätzen: stark verkleinert und weichgezeichnet (Schrift verschwindet, Schatten bleiben)
  const bw = Math.max(4, Math.round(w / 28)), bh = Math.max(4, Math.round(h / 28));
  const small = document.createElement('canvas');
  small.width = bw;
  small.height = bh;
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(canvas, 0, 0, bw, bh);
  // Dunkle Stellen (Schrift) aus dem Hintergrund entfernen: Maximum der Nachbarn nehmen
  const sd = sctx.getImageData(0, 0, bw, bh);
  const src = sd.data.slice();
  for (let y = 0; y < bh; y++) {
    for (let x = 0; x < bw; x++) {
      const o = (y * bw + x) * 4;
      for (let ch = 0; ch < 3; ch++) {
        let m = 0;
        for (let yy = Math.max(0, y - 1); yy <= Math.min(bh - 1, y + 1); yy++) {
          for (let xx = Math.max(0, x - 1); xx <= Math.min(bw - 1, x + 1); xx++) m = Math.max(m, src[(yy * bw + xx) * 4 + ch]);
        }
        sd.data[o + ch] = m;
      }
    }
  }
  sctx.putImageData(sd, 0, 0);
  const bg = document.createElement('canvas');
  bg.width = w;
  bg.height = h;
  const bctx = bg.getContext('2d', { willReadFrequently: true });
  bctx.imageSmoothingQuality = 'high';
  bctx.drawImage(small, 0, 0, w, h);
  const B = bctx.getImageData(0, 0, w, h).data;
  const img = ctx.getImageData(0, 0, w, h);
  const D = img.data;
  for (let i = 0; i < D.length; i += 4) {
    let r = Math.min(255, (D[i] * 255) / Math.max(40, B[i]));
    let g = Math.min(255, (D[i + 1] * 255) / Math.max(40, B[i + 1]));
    let b = Math.min(255, (D[i + 2] * 255) / Math.max(40, B[i + 2]));
    if (filter === 'bw') {
      const l = 0.299 * r + 0.587 * g + 0.114 * b;
      const v = l > 205 ? 255 : l < 125 ? Math.max(0, l - 60) : ((l - 125) / 80) * 255;
      r = g = b = v;
    } else {
      // Scan: Kontrast hoch, fast weißes Papier ganz weiß
      const s = (c) => Math.max(0, Math.min(255, (c - 28) * 1.22));
      r = s(r);
      g = s(g);
      b = s(b);
      if (r > 238 && g > 238 && b > 238) r = g = b = 255;
    }
    D[i] = r;
    D[i + 1] = g;
    D[i + 2] = b;
  }
  ctx.putImageData(img, 0, 0);
  bg.width = bg.height = 0;
}

// ---------- Ergebnis berechnen ----------
// source: Originalbild, quad: Ecken im GEDREHTEN Bild, r: Drehung, filter
export function renderEdit(source, sw, sh, quad, r, filter) {
  const rect = isAxisRect(quad);
  let outW = Math.round((dist(quad[0], quad[1]) + dist(quad[3], quad[2])) / 2);
  let outH = Math.round((dist(quad[0], quad[3]) + dist(quad[1], quad[2])) / 2);
  if (!rect) {
    // Schräg fotografiert: Das Blatt wirkt verkürzt. Das echte Seitenverhältnis aus der Perspektive
    // zurückrechnen (Verfahren von Zhang & He für Tafel-Fotos), sonst wäre A4 hinterher zu breit.
    const ratio = trueAspect(quad, r & 1 ? sh : sw, r & 1 ? sw : sh);
    if (ratio) {
      const area = outW * outH;
      outW = Math.round(Math.sqrt(area * ratio));
      outH = Math.round(Math.sqrt(area / ratio));
    }
  }
  const k = Math.min(1, MAX_IMAGE / Math.max(outW, outH));
  outW = Math.max(1, Math.round(outW * k));
  outH = Math.max(1, Math.round(outH * k));
  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d', { willReadFrequently: true });
  // Erst das Originalbild gedreht auf ein Hilfs-Canvas (dann stimmen die Ecken direkt)
  const rw = r & 1 ? sh : sw;
  const rh = r & 1 ? sw : sh;
  if (rect) {
    ctx.imageSmoothingQuality = 'high';
    ctx.save();
    const x0 = quad[0][0], y0 = quad[0][1];
    const qw = quad[1][0] - x0, qh = quad[3][1] - y0;
    ctx.scale(outW / qw, outH / qh);
    ctx.translate(-x0, -y0);
    drawRotated(ctx, source, sw, sh, r);
    ctx.restore();
  } else {
    const rot = document.createElement('canvas');
    rot.width = rw;
    rot.height = rh;
    const rctx = rot.getContext('2d', { willReadFrequently: true });
    drawRotated(rctx, source, sw, sh, r);
    const S = rctx.getImageData(0, 0, rw, rh).data;
    rot.width = rot.height = 0;
    const map = squareToQuad(quad);
    const img = ctx.createImageData(outW, outH);
    const D = img.data;
    for (let y = 0; y < outH; y++) {
      const v = (y + 0.5) / outH;
      for (let x = 0; x < outW; x++) {
        let [sx, sy] = map((x + 0.5) / outW, v);
        sx -= 0.5;
        sy -= 0.5;
        const ix = Math.floor(sx), iy = Math.floor(sy);
        const fx = sx - ix, fy = sy - iy;
        const x0 = Math.max(0, Math.min(rw - 1, ix)), x1 = Math.max(0, Math.min(rw - 1, ix + 1));
        const y0 = Math.max(0, Math.min(rh - 1, iy)), y1 = Math.max(0, Math.min(rh - 1, iy + 1));
        const a = (y0 * rw + x0) * 4, b = (y0 * rw + x1) * 4, c = (y1 * rw + x0) * 4, d = (y1 * rw + x1) * 4;
        const o = (y * outW + x) * 4;
        for (let ch = 0; ch < 4; ch++) {
          const top = S[a + ch] + (S[b + ch] - S[a + ch]) * fx;
          const bot = S[c + ch] + (S[d + ch] - S[c + ch]) * fx;
          D[o + ch] = top + (bot - top) * fy;
        }
      }
    }
    ctx.putImageData(img, 0, 0);
  }
  applyFilter(out, filter);
  return out;
}

// Breite / Höhe des echten Rechtecks, das schräg fotografiert dieses Viereck ergibt (oder null).
// Annahme: Die Bildmitte ist die Mitte der Kamera.
function trueAspect(q, w, h) {
  const u0 = w / 2, v0 = h / 2;
  const P = (p) => [p[0] - u0, p[1] - v0, 1];
  const m1 = P(q[0]), m2 = P(q[1]), m3 = P(q[3]), m4 = P(q[2]); // TL, TR, BL, BR
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const k2 = dot(cross(m1, m4), m3) / dot(cross(m2, m4), m3);
  const k3 = dot(cross(m1, m4), m2) / dot(cross(m3, m4), m2);
  const n2 = [k2 * m2[0] - m1[0], k2 * m2[1] - m1[1], k2 * m2[2] - m1[2]];
  const n3 = [k3 * m3[0] - m1[0], k3 * m3[1] - m1[1], k3 * m3[2] - m1[2]];
  if (Math.abs(n2[2]) < 1e-9 || Math.abs(n3[2]) < 1e-9) return null; // fast genau von oben: nichts zu korrigieren
  const f2 = -(n2[0] * n3[0] + n2[1] * n3[1]) / (n2[2] * n3[2]);
  if (!(f2 > 0) || !Number.isFinite(f2)) return null;
  const len = (n) => (n[0] * n[0] + n[1] * n[1]) / f2 + n[2] * n[2];
  const ratio = Math.sqrt(len(n2) / len(n3));
  if (!Number.isFinite(ratio) || ratio < 0.2 || ratio > 5) return null;
  return ratio;
}

function drawRotated(ctx, source, sw, sh, r) {
  ctx.save();
  if ((r & 3) === 1) {
    ctx.translate(sh, 0);
    ctx.rotate(Math.PI / 2);
  } else if ((r & 3) === 2) {
    ctx.translate(sw, sh);
    ctx.rotate(Math.PI);
  } else if ((r & 3) === 3) {
    ctx.translate(0, sw);
    ctx.rotate(-Math.PI / 2);
  }
  ctx.drawImage(source, 0, 0, sw, sh);
  ctx.restore();
}

// ---------- Der Bearbeiten-Bildschirm ----------
//
// openImageEditor({ item, onDone }) – item ist das Bild-Element.
// onDone({ canvas, src, crop }) bekommt das fertige Bild und die Einstellungen zum Merken:
//   src   { blobId, iw, ih, quad (Ecken im Original, 0..1), rot, filter }
//   crop  Mitte des Ausschnitts im bisher gezeigten Bild (0..1) – damit das Bild an seinem Platz bleibt
export async function openImageEditor({ item, onDone, toast }) {
  const src = item.src || { blobId: item.blobId, iw: item.iw, ih: item.ih, quad: null, rot: 0, filter: 'none' };
  await ensureLoaded([src.blobId]);
  const source = getBitmap(src.blobId);
  if (!source) {
    toast?.('Das Bild lässt sich nicht laden');
    return;
  }
  const sw = source.width;
  const sh = source.height;

  // Zustand: Ecken im gedrehten Bild (Pixel)
  let rot = src.rot || 0;
  const dims = () => (rot & 1 ? [sh, sw] : [sw, sh]);
  const fullQuad = () => {
    const [w, h] = dims();
    return [[0, 0], [w, 0], [w, h], [0, h]];
  };
  let quad = src.quad
    ? orderCorners(src.quad.map(([u, v]) => rotPoint([u * sw, v * sh], rot, sw, sh)))
    : fullQuad();
  let mode = src.quad && !isAxisRect(quad) ? 'perspective' : 'crop';
  let filter = src.filter || 'none';

  const root = document.createElement('div');
  root.className = 'img-editor';
  root.innerHTML = `
    <header class="ie-head">
      <button class="ie-text-btn" data-act="cancel">Abbrechen</button>
      <span class="ie-title">Bild bearbeiten</span>
      <button class="ie-text-btn ie-done" data-act="done">Fertig</button>
    </header>
    <div class="ie-stage"><canvas class="ie-canvas"></canvas><canvas class="ie-loupe" hidden></canvas></div>
    <div class="ie-hint"></div>
    <div class="ie-tools">
      <div class="ie-seg">
        <button data-mode="crop">${ICON.crop}<span>Zuschneiden</span></button>
        <button data-mode="perspective">${ICON.perspective}<span>Geraderücken</span></button>
      </div>
      <div class="ie-row">
        <button class="ie-btn" data-act="auto">${ICON.auto}<span>Blatt finden</span></button>
        <button class="ie-btn" data-act="rotate">${ICON.rotate}<span>Drehen</span></button>
        <button class="ie-btn" data-act="reset">${ICON.reset}<span>Zurücksetzen</span></button>
      </div>
      <div class="ie-filters">
        ${FILTERS.map((f) => `<button data-filter="${f.id}"><canvas class="ie-thumb"></canvas><span>${f.name}</span></button>`).join('')}
      </div>
    </div>`;
  document.body.appendChild(root);
  const canvas = root.querySelector('.ie-canvas');
  const loupe = root.querySelector('.ie-loupe');
  const stage = root.querySelector('.ie-stage');
  const hint = root.querySelector('.ie-hint');

  // Gedrehtes Bild als Canvas (für schnelles Malen und für die Lupe)
  let rotated = null;
  function buildRotated() {
    const [w, h] = dims();
    const k = Math.min(1, 1600 / Math.max(w, h)); // zum Anzeigen reicht eine kleinere Fassung
    if (!rotated) rotated = document.createElement('canvas');
    rotated.width = Math.round(w * k);
    rotated.height = Math.round(h * k);
    const ctx = rotated.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.scale(k, k);
    drawRotated(ctx, source, sw, sh, rot);
  }
  buildRotated();

  // Layout: Bild eingepasst in die Bühne
  let fit = { k: 1, x: 0, y: 0 };
  function layout() {
    const r = stage.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    canvas.style.width = `${r.width}px`;
    canvas.style.height = `${r.height}px`;
    const [w, h] = dims();
    const pad = 28;
    const k = Math.min((r.width - pad * 2) / w, (r.height - pad * 2) / h);
    fit = { k, x: (r.width - w * k) / 2, y: (r.height - h * k) / 2 };
    draw();
  }
  const toScreen = ([x, y]) => [fit.x + x * fit.k, fit.y + y * fit.k];
  const toImage = ([x, y]) => [(x - fit.x) / fit.k, (y - fit.y) / fit.k];

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0e1015';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const [w, h] = dims();
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(rotated, fit.x, fit.y, w * fit.k, h * fit.k);
    const pts = quad.map(toScreen);
    // Außerhalb abdunkeln
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.x, fit.y, w * fit.k, h * fit.k);
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.fillStyle = 'rgba(8, 10, 14, 0.62)';
    ctx.fill('evenodd');
    ctx.restore();
    // Rahmen
    ctx.save();
    ctx.beginPath();
    pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])));
    ctx.closePath();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ffffff';
    ctx.shadowColor = 'rgba(0,0,0,0.5)';
    ctx.shadowBlur = 4;
    ctx.stroke();
    ctx.restore();
    // Drittel-Hilfslinien (wie in Foto-Apps)
    if (mode === 'crop') {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1;
      const [a, b, , d] = pts;
      for (const t of [1 / 3, 2 / 3]) {
        ctx.beginPath();
        ctx.moveTo(a[0] + (b[0] - a[0]) * t, a[1]);
        ctx.lineTo(a[0] + (b[0] - a[0]) * t, d[1]);
        ctx.moveTo(a[0], a[1] + (d[1] - a[1]) * t);
        ctx.lineTo(b[0], a[1] + (d[1] - a[1]) * t);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Griffe: Ecken (Kreise) und Kanten-Mitten (Balken)
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2;
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(ang);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 5;
      roundRect(ctx, -13, -3.5, 26, 7, 3.5);
      ctx.fill();
      ctx.restore();
    }
    for (const p of pts) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(p[0], p[1], 11, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(123, 147, 255, 0.35)';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(p[0], p[1], 7, 0, Math.PI * 2);
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 5;
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#4a6cf7';
      ctx.stroke();
      ctx.restore();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function drawLoupe(imgPt, screenPt) {
    const dpr = window.devicePixelRatio || 1;
    loupe.hidden = false;
    loupe.width = loupe.height = Math.round(LOUPE * dpr);
    loupe.style.width = loupe.style.height = `${LOUPE}px`;
    const r = stage.getBoundingClientRect();
    // Lupe oberhalb des Fingers, am Rand nach unten ausweichen
    let lx = screenPt[0] - LOUPE / 2;
    let ly = screenPt[1] - LOUPE - 46;
    if (ly < 4) ly = screenPt[1] + 46;
    lx = Math.max(4, Math.min(r.width - LOUPE - 4, lx));
    loupe.style.left = `${lx}px`;
    loupe.style.top = `${ly}px`;
    const ctx = loupe.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#0e1015';
    ctx.fillRect(0, 0, LOUPE, LOUPE);
    const zoom = Math.max(2.5, fit.k * 3);
    const kr = rotated.width / dims()[0];
    ctx.save();
    ctx.translate(LOUPE / 2, LOUPE / 2);
    ctx.scale(zoom, zoom);
    ctx.translate(-imgPt[0], -imgPt[1]);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(rotated, 0, 0, rotated.width / kr, rotated.height / kr);
    ctx.restore();
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(LOUPE / 2 - 10, LOUPE / 2);
    ctx.lineTo(LOUPE / 2 + 10, LOUPE / 2);
    ctx.moveTo(LOUPE / 2, LOUPE / 2 - 10);
    ctx.lineTo(LOUPE / 2, LOUPE / 2 + 10);
    ctx.stroke();
  }

  // ---------- Griffe ziehen ----------
  let drag = null; // { kind: 'corner' | 'edge' | 'move', index, start, quad0, pointerId }
  function hitHandle(sp) {
    const pts = quad.map(toScreen);
    let best = null;
    let bestD = HANDLE_HIT;
    pts.forEach((p, i) => {
      const d = dist(p, sp);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'corner', index: i };
      }
    });
    if (best) return best;
    for (let i = 0; i < 4; i++) {
      const a = pts[i], b = pts[(i + 1) % 4];
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = dist(m, sp);
      if (d < bestD) {
        bestD = d;
        best = { kind: 'edge', index: i };
      }
    }
    if (best) return best;
    // Innen angefasst: ganzen Rahmen verschieben
    if (pointInQuad(sp, pts)) return { kind: 'move', index: -1 };
    return null;
  }

  function pointInQuad(p, q) {
    let inside = false;
    for (let i = 0, j = 3; i < 4; j = i++) {
      const [xi, yi] = q[i], [xj, yj] = q[j];
      if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  const MIN_SIZE = () => 24 / fit.k; // kleinster Ausschnitt (Bildschirm-Pixel)

  function applyDrag(sp) {
    const [w, h] = dims();
    const clampPt = ([x, y]) => [Math.max(0, Math.min(w, x)), Math.max(0, Math.min(h, y))];
    const p = toImage(sp);
    const d = [p[0] - drag.start[0], p[1] - drag.start[1]];
    const q0 = drag.quad0;
    let q = q0.map((pt) => pt.slice());
    if (drag.kind === 'move') {
      // ganzen Rahmen verschieben, ohne über den Bildrand zu gehen
      const xs = q0.map((pt) => pt[0]), ys = q0.map((pt) => pt[1]);
      const dx = Math.max(-Math.min(...xs), Math.min(w - Math.max(...xs), d[0]));
      const dy = Math.max(-Math.min(...ys), Math.min(h - Math.max(...ys), d[1]));
      q = q0.map(([x, y]) => [x + dx, y + dy]);
    } else if (mode === 'crop') {
      // Rechteck: x/y-Grenzen verschieben
      let x0 = q0[0][0], y0 = q0[0][1], x1 = q0[2][0], y1 = q0[2][1];
      const m = MIN_SIZE();
      const moveLeft = (v) => (x0 = Math.max(0, Math.min(x1 - m, v)));
      const moveRight = (v) => (x1 = Math.min(w, Math.max(x0 + m, v)));
      const moveTop = (v) => (y0 = Math.max(0, Math.min(y1 - m, v)));
      const moveBottom = (v) => (y1 = Math.min(h, Math.max(y0 + m, v)));
      const i = drag.index;
      if (drag.kind === 'corner') {
        if (i === 0 || i === 3) moveLeft(q0[i][0] + d[0]);
        else moveRight(q0[i][0] + d[0]);
        if (i === 0 || i === 1) moveTop(q0[i][1] + d[1]);
        else moveBottom(q0[i][1] + d[1]);
      } else {
        if (i === 0) moveTop(q0[0][1] + d[1]);
        if (i === 1) moveRight(q0[1][0] + d[0]);
        if (i === 2) moveBottom(q0[2][1] + d[1]);
        if (i === 3) moveLeft(q0[3][0] + d[0]);
      }
      q = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    } else {
      const i = drag.index;
      if (drag.kind === 'corner') q[i] = clampPt([q0[i][0] + d[0], q0[i][1] + d[1]]);
      else {
        const j = (i + 1) % 4;
        q[i] = clampPt([q0[i][0] + d[0], q0[i][1] + d[1]]);
        q[j] = clampPt([q0[j][0] + d[0], q0[j][1] + d[1]]);
      }
      if (!convex(q)) return; // verdrehte Vierecke nicht zulassen
    }
    quad = q;
    draw();
    if (drag.kind === 'corner') drawLoupe(quad[drag.index], toScreen(quad[drag.index]));
    else loupe.hidden = true;
  }

  const localPoint = (e) => {
    const r = stage.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  stage.addEventListener('pointerdown', (e) => {
    if (drag) return;
    const sp = localPoint(e);
    const hit = hitHandle(sp);
    if (!hit) return;
    e.preventDefault();
    try {
      stage.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    drag = { ...hit, start: toImage(sp), quad0: quad.map((p) => p.slice()), pointerId: e.pointerId };
    if (hit.kind === 'corner') drawLoupe(quad[hit.index], toScreen(quad[hit.index]));
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    applyDrag(localPoint(e));
  });
  const endDrag = (e) => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag = null;
    loupe.hidden = true;
    draw();
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  // ---------- Knöpfe ----------
  function setMode(m) {
    mode = m;
    if (m === 'crop' && !isAxisRect(quad)) {
      // Vom freien Viereck zum Rechteck: das umschließende Rechteck nehmen
      const xs = quad.map((p) => p[0]), ys = quad.map((p) => p[1]);
      const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
      quad = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    }
    hint.textContent =
      m === 'crop'
        ? 'Ecken oder Kanten ziehen, um die Ränder wegzuschneiden'
        : 'Jede Ecke auf eine Ecke des Blatts ziehen – das Blatt wird danach gerade gerückt';
    for (const b of root.querySelectorAll('[data-mode]')) b.classList.toggle('selected', b.dataset.mode === mode);
    draw();
  }

  function rotate() {
    const [w, h] = dims(); // vor dem Drehen
    // Ecken mitdrehen (im Uhrzeigersinn: (x, y) -> (h - y, x))
    quad = orderCorners(quad.map(([x, y]) => [h - y, x]));
    rot = (rot + 1) & 3;
    buildRotated();
    layout();
    updateThumbs();
    void w;
  }

  function auto() {
    const found = detectSheet(rotated, rotated.width, rotated.height);
    if (!found) {
      toast?.('Kein Blatt erkannt – zieh die Ecken einfach selbst');
      return;
    }
    const kr = rotated.width / dims()[0];
    quad = orderCorners(found.map(([x, y]) => [x / kr, y / kr]));
    setMode('perspective');
  }

  function reset() {
    quad = fullQuad();
    filter = 'none';
    setMode('crop');
    updateFilterButtons();
  }

  // Filter-Vorschaubilder
  function updateThumbs() {
    const base = document.createElement('canvas');
    const k = 120 / Math.max(rotated.width, rotated.height);
    base.width = Math.max(1, Math.round(rotated.width * k));
    base.height = Math.max(1, Math.round(rotated.height * k));
    base.getContext('2d').drawImage(rotated, 0, 0, base.width, base.height);
    for (const b of root.querySelectorAll('[data-filter]')) {
      const c = b.querySelector('canvas');
      const tmp = document.createElement('canvas');
      tmp.width = base.width;
      tmp.height = base.height;
      tmp.getContext('2d').drawImage(base, 0, 0);
      applyFilter(tmp, b.dataset.filter);
      c.width = 64 * 2;
      c.height = 64 * 2;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#2a2e38';
      ctx.fillRect(0, 0, c.width, c.height);
      const s = Math.max(c.width / tmp.width, c.height / tmp.height);
      ctx.drawImage(tmp, (c.width - tmp.width * s) / 2, (c.height - tmp.height * s) / 2, tmp.width * s, tmp.height * s);
    }
  }
  function updateFilterButtons() {
    for (const b of root.querySelectorAll('[data-filter]')) b.classList.toggle('selected', b.dataset.filter === filter);
  }

  function close() {
    window.removeEventListener('resize', layout);
    root.remove();
    if (rotated) rotated.width = rotated.height = 0;
  }

  let working = false;
  async function done() {
    if (working) return;
    working = true;
    root.classList.add('busy');
    await new Promise((r) => setTimeout(r, 30)); // "Einen Moment" anzeigen, dann rechnen
    try {
      const unchanged = rot === 0 && filter === 'none' && isAxisRect(quad) && quad[0][0] <= 0.5 && quad[0][1] <= 0.5 && quad[2][0] >= sw - 0.5 && quad[2][1] >= sh - 0.5;
      if (unchanged && !item.src) {
        close();
        return;
      }
      const out = renderEdit(source, sw, sh, quad, rot, filter);
      // Ecken fürs nächste Mal im ORIGINAL merken (0..1)
      const [w, h] = dims();
      const srcQuad = quad.map((p) => {
        const [x, y] = unrotPoint(p, rot, sw, sh);
        return [x / sw, y / sh];
      });
      void w;
      void h;
      const center = quad.reduce((acc, p) => [acc[0] + p[0] / 4, acc[1] + p[1] / 4], [0, 0]);
      const [ux, uy] = unrotPoint(center, rot, sw, sh);
      close();
      await onDone({
        canvas: out,
        src: { blobId: src.blobId, iw: sw, ih: sh, quad: srcQuad, rot, filter },
        reset: unchanged,
        // Mitte des Ausschnitts im Original (0..1) – fürs erste Bearbeiten, damit das Bild an seinem Platz bleibt
        center: [ux / sw, uy / sh],
      });
    } catch (err) {
      console.error(err);
      toast?.('Das Bild ließ sich nicht bearbeiten');
      close();
    }
  }

  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if (d.mode) setMode(d.mode);
    if (d.filter) {
      filter = d.filter;
      updateFilterButtons();
    }
    if (d.act === 'rotate') rotate();
    if (d.act === 'auto') auto();
    if (d.act === 'reset') reset();
    if (d.act === 'cancel') close();
    if (d.act === 'done') done();
  });
  // Die Zeichenfläche darunter bekommt nichts mit
  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'wheel', 'touchstart', 'touchmove']) {
    root.addEventListener(type, (e) => e.stopPropagation(), { passive: type.startsWith('touch') || type === 'wheel' });
  }

  window.addEventListener('resize', layout);
  setMode(mode);
  updateFilterButtons();
  updateThumbs();
  requestAnimationFrame(layout);
  if (!src.quad) {
    hint.textContent = 'Tipp: „Blatt finden“ setzt die Ecken bei einem fotografierten Arbeitsblatt automatisch';
  }
}
