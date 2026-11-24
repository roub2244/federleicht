// htr.js – Handschrift lesen mit dem eigenen, selbst trainierten Modell (offline)
//
// Warum nicht mehr nur Tesseract? Tesseract ist für gedruckte Schrift gebaut und verwechselt
// Handschrift leicht ("ist" -> "IU"). Unser Modell wurde mit ca. 300.000 Zeilen echter und
// nachgemachter Handschrift trainiert (Buchstaben von über 3.000 Menschen, 128 Handschrift-
// Schriften inkl. deutscher Schulschriften) und kennt dazu 79.000 deutsche Wörter.
//
// Ablauf pro Zeile: Striche geradegedreht und gleichmäßig dick als kleines Bild (40 Pixel hoch)
// malen -> Modell (im Hintergrund-Worker) -> Text mit Wörterbuch-Hilfe.

const H = 40;
let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./htrworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      waiting.delete(e.data.id);
      e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of waiting.values()) p.reject(new Error(e.message || 'Worker-Fehler'));
      waiting.clear();
      worker = null;
    };
  }
  return worker;
}

function ask(msg, transfer = []) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject });
    getWorker().postMessage({ id, base: document.baseURI.replace(/[^/]*$/, ''), ...msg }, transfer);
  });
}

// Schon mal im Hintergrund laden (z. B. wenn "Zu Text" geöffnet wird)
export function warmUp() {
  return ask({}).catch(() => {});
}

// polys: Punktlisten (Seiten-Koordinaten, schon geradegedreht). Ergebnis: { text, alts, raw }
export async function recognizePolys(polys) {
  const img = renderInput(polys);
  if (!img) return { text: '', alts: [] };
  return ask({ img: img.d, w: img.w, h: H }, [img.d.buffer]);
}

// Striche wie im Training malen: Tinte = 1, Hintergrund = 0, auf die Schrift zugeschnitten,
// 36 Pixel hoch (+2 Rand oben/unten), 4 Pixel Rand links/rechts
export function renderInput(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of polys) for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  const inner = H - 4;
  const SS = 3; // erst 3x so groß malen, dann verkleinern (glatte Kanten)
  const lw = 2.3; // Strichdicke in Ziel-Pixeln
  const k = (inner - lw) / Math.max(1, maxY - minY);
  const w = Math.max(4, Math.min(1200, Math.round((maxX - minX) * k + lw)));
  const big = document.createElement('canvas');
  big.width = (w + 8) * SS;
  big.height = H * SS;
  const ctx = big.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw * SS;
  const kk = Math.min(k, (1200 - lw) / Math.max(1, maxX - minX));
  const X = (x) => ((x - minX) * kk + 4 + lw / 2) * SS;
  const Y = (y) => ((y - minY) * kk + 2 + lw / 2) * SS;
  for (const pts of polys) {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.5, Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  const small = document.createElement('canvas');
  small.width = w + 8;
  small.height = H;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(big, 0, 0, small.width, small.height);
  const px = sctx.getImageData(0, 0, small.width, H).data;
  const d = new Float32Array(small.width * H);
  for (let i = 0; i < d.length; i++) d[i] = px[i * 4] / 255;
  return { d, w: small.width };
}
