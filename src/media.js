// media.js – Bilder und PDF-Hintergründe auf den Seiten (Etappe 7)
//
// BILDER liegen wie Striche und Textfelder in page.strokes (mit tool: 'image').
// So kann man sie mit dem Lasso verschieben, drehen, vergrößern, kopieren, nach vorne/hinten
// legen – und mit dem Stift darauf schreiben (Striche mit höherem z liegen darüber).
//
//   { tool: 'image', blobId, iw, ih, m: [a, b, c, d, e, f], z, box }
//     blobId  unter dieser Nummer liegt die Bilddatei in der Datenbank (store.js, Schublade "blobs")
//     iw, ih  Größe der Bilddatei in Pixeln
//     m       Matrix: macht aus dem Einheits-Quadrat (0..1 × 0..1) das Bild auf der Seite.
//             Damit kann das Bild verschoben, gedreht und (auch verzerrt) vergrößert werden.
//
// PDF-SEITEN: Eine Seite kann einen Hintergrund haben (page.bg). Er ist fest – das Lasso und
// der Radierer kommen nicht dran, man schreibt einfach darauf (wie in Samsung Notes).
//
//   page.bg = { blobId, w, h, pdfId, index }
//     blobId  fertig gemaltes Bild der PDF-Seite (für schnelles Anzeigen, Vorschaubilder, Export)
//     w, h    Größe der PDF-Seite (pt) – bestimmt das Seitenverhältnis
//     pdfId   die Original-PDF-Datei (zum gestochen scharfen Nachmalen beim Reinzoomen)
//     index   Seitennummer in der PDF (0 = erste)
//
// Die Bilddateien selbst laden wir erst, wenn sie gebraucht werden, und behalten nur so viele im
// Speicher, wie es vernünftig ist (BUDGET). Bis ein Bild da ist, zeigen wir eine hellgraue Fläche.

import * as store from './store.js';
import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { apply, multiply } from './geometry.js';

const BUDGET = 60e6;          // so viele Bildpunkte dürfen gleichzeitig ausgepackt im Speicher sein
export const MAX_IMAGE = 2400; // längere Bildseiten werden beim Einfügen verkleinert (Pixel)

// ---------- Bilddateien laden (mit Zwischenspeicher) ----------

const cache = new Map(); // blobId -> { bitmap, pixels, used, promise, failed }
const listeners = new Set();
let notifyFrame = 0;

// Wird aufgerufen, sobald ein Bild fertig geladen ist (dann muss neu gemalt werden)
export function onMediaLoaded(fn) {
  listeners.add(fn);
}

function notify() {
  if (notifyFrame) return;
  notifyFrame = requestAnimationFrame(() => {
    notifyFrame = 0;
    for (const fn of listeners) fn();
  });
}

function load(id) {
  let entry = cache.get(id);
  if (entry) return entry;
  entry = { bitmap: null, pixels: 0, used: performance.now(), failed: false, promise: null };
  cache.set(id, entry);
  entry.promise = (async () => {
    try {
      const blob = await store.getBlob(id);
      if (!blob) throw new Error('Bild fehlt');
      const bitmap = await decode(blob);
      if (cache.get(id) !== entry) {
        bitmap.close?.();
        return null;
      }
      entry.bitmap = bitmap;
      entry.pixels = bitmap.width * bitmap.height;
      evict();
      notify();
      return bitmap;
    } catch (err) {
      console.warn('Bild lässt sich nicht laden', id, err);
      entry.failed = true;
      notify();
      return null;
    }
  })();
  return entry;
}

async function decode(blob) {
  if (window.createImageBitmap) return createImageBitmap(blob);
  // Ganz alte Browser: über ein <img>
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Zu viele Bilder im Speicher? Die am längsten nicht gebrauchten wieder freigeben.
// (Was in den letzten 2 Sekunden gemalt wurde, bleibt – sonst würde es ständig neu geladen.)
function evict() {
  let total = 0;
  for (const e of cache.values()) total += e.pixels;
  if (total <= BUDGET) return;
  const now = performance.now();
  const old = [...cache.entries()].filter(([, e]) => e.bitmap && now - e.used > 2000).sort((a, b) => a[1].used - b[1].used);
  for (const [id, e] of old) {
    if (total <= BUDGET) break;
    total -= e.pixels;
    e.bitmap.close?.();
    cache.delete(id);
  }
}

// Bild sofort holen, falls es schon geladen ist (sonst null – es wird im Hintergrund geladen)
export function getBitmap(id) {
  if (!id) return null;
  const e = load(id);
  e.used = performance.now();
  return e.bitmap;
}

export function bitmapFailed(id) {
  return Boolean(cache.get(id)?.failed);
}

// Warten, bis alle diese Bilder geladen sind (für Vorschaubilder und den Export)
export async function ensureLoaded(ids) {
  await Promise.all([...new Set(ids)].filter(Boolean).map((id) => load(id).promise));
}

// Alle Bilder, die auf diesen Seiten vorkommen (Bilder und PDF-Hintergründe)
export function imageIdsOf(pages) {
  const ids = [];
  for (const p of pages) {
    if (p.bg?.blobId) ids.push(p.bg.blobId);
    for (const s of p.strokes) if (s.tool === 'image') ids.push(s.blobId);
  }
  return ids;
}

// Alle Dateien, die diese Seiten brauchen (Bilder + Original-PDFs) – die darf das Aufräumen nicht löschen
export function fileIdsOf(pages) {
  const ids = imageIdsOf(pages);
  for (const p of pages) {
    if (p.bg?.pdfId) ids.push(p.bg.pdfId);
    // Bearbeitete Bilder: das Original bleibt auch gespeichert (zum erneuten Bearbeiten)
    for (const s of p.strokes) if (s.tool === 'image' && s.src?.blobId) ids.push(s.src.blobId);
  }
  return [...new Set(ids)];
}

// Frisch eingefügtes Bild gleich in den Zwischenspeicher legen (muss nicht nochmal geladen werden)
export function remember(id, bitmap) {
  cache.set(id, { bitmap, pixels: bitmap.width * bitmap.height, used: performance.now(), failed: false, promise: Promise.resolve(bitmap) });
  evict();
}

// ---------- Bild einfügen: Datei vorbereiten ----------
//
// Fotos von der Kamera sind riesig (12 Megapixel und mehr). Für eine Notiz reicht viel weniger:
// Wir verkleinern auf höchstens MAX_IMAGE Pixel und speichern als WebP (klein, mit Transparenz).
export async function prepareImage(file) {
  const source = await decode(file); // dreht Handyfotos automatisch richtig herum (EXIF)
  const w0 = source.width;
  const h0 = source.height;
  if (!w0 || !h0) throw new Error('Kein Bild');
  const k = Math.min(1, MAX_IMAGE / Math.max(w0, h0));
  const w = Math.max(1, Math.round(w0 * k));
  const h = Math.max(1, Math.round(h0 * k));
  let blob = file;
  let bitmap = source;
  const small = file.size < 600_000 && k === 1 && /^image\/(png|jpeg|webp|gif)$/.test(file.type);
  if (!small) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, w, h);
    blob = await canvasBlob(canvas, 'image/webp', 0.9);
    source.close?.();
    bitmap = window.createImageBitmap ? await createImageBitmap(canvas) : canvas;
  }
  return { blob, bitmap, w, h };
}

// Canvas -> Datei (WebP, falls der Browser das kann, sonst PNG/JPEG)
export function canvasBlob(canvas, type = 'image/webp', quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => {
      if (b && b.type === type) return resolve(b);
      const fallback = type === 'image/webp' ? 'image/png' : 'image/jpeg';
      canvas.toBlob((b2) => (b2 ? resolve(b2) : reject(new Error('Bild lässt sich nicht speichern'))), fallback, quality);
    }, type, quality);
  });
}

// ---------- Bild-Elemente ----------

// src (nur bei bearbeiteten Bildern): { blobId, iw, ih, quad, rot, filter } – Original + Einstellungen (siehe imageeditor.js)
export function createImageItem({ blobId, iw, ih, m, z, src = null }) {
  const item = { tool: 'image', blobId, iw, ih, m, z, box: null };
  if (src) item.src = src;
  return updateImageBox(item);
}

// Bild der Größe (w × h Seiten-Einheiten) mit der Mitte bei (cx, cy)
export function placeMatrix(cx, cy, w, h) {
  return [w, 0, 0, h, cx - w / 2, cy - h / 2];
}

export function imageCorners(item) {
  return [[0, 0], [1, 0], [1, 1], [0, 1]].map((p) => apply(item.m, p));
}

export function updateImageBox(item) {
  const c = imageCorners(item);
  const xs = c.map((p) => p[0]);
  const ys = c.map((p) => p[1]);
  item.box = { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
  return item;
}

// Lasso: verwandelte Kopie (Matrix davorhängen)
export function transformImage(item, m) {
  const copy = { ...item, m: multiply(m, item.m), box: null };
  delete copy.hidden;
  return updateImageBox(copy);
}

// Liegt der Punkt auf dem Bild? (Auch bei gedrehten Bildern genau)
export function imageHit(item, x, y, pad = 0) {
  const b = item.box;
  if (!b || x < b.minX - pad || x > b.maxX + pad || y < b.minY - pad || y > b.maxY + pad) return false;
  const inv = invert(item.m);
  if (!inv) return false;
  const [u, v] = apply(inv, [x, y]);
  // pad in Bild-Einheiten umrechnen (ungefähr)
  const pu = pad / Math.hypot(item.m[0], item.m[1]);
  const pv = pad / Math.hypot(item.m[2], item.m[3]);
  return u >= -pu && u <= 1 + pu && v >= -pv && v <= 1 + pv;
}

// Ein paar Punkte, die gleichmäßig auf dem Bild liegen (fürs Lasso: "liegt es in der Schlinge?")
export function imageSamples(item) {
  const pts = [];
  for (let i = 0; i < 4; i++) for (let k = 0; k < 4; k++) pts.push(apply(item.m, [(i + 0.5) / 4, (k + 0.5) / 4]));
  return pts;
}

function invert(m) {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < 1e-12) return null;
  return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det, (m[2] * m[5] - m[3] * m[4]) / det, (m[1] * m[4] - m[0] * m[5]) / det];
}

// Bild malen (ctx ist schon auf die Seite eingestellt)
export function drawImageItem(ctx, item) {
  const bmp = getBitmap(item.blobId);
  ctx.save();
  const m = item.m;
  if (bmp) {
    ctx.transform(m[0] / bmp.width, m[1] / bmp.width, m[2] / bmp.height, m[3] / bmp.height, m[4], m[5]);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, 0, 0);
  } else {
    // Wird noch geladen (oder fehlt): helle Fläche mit Rahmen als Platzhalter
    ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
    ctx.fillStyle = 'rgba(128, 138, 160, 0.16)';
    ctx.fillRect(0, 0, 1, 1);
    if (bitmapFailed(item.blobId)) {
      ctx.strokeStyle = 'rgba(220, 60, 60, 0.6)';
      ctx.lineWidth = 0.01;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(1, 1);
      ctx.moveTo(1, 0);
      ctx.lineTo(0, 1);
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function packImage(item) {
  const out = { tool: 'image', blobId: item.blobId, iw: item.iw, ih: item.ih, m: item.m.slice(), z: item.z };
  if (item.src) out.src = { ...item.src, quad: item.src.quad?.map((p) => p.slice()) };
  return out;
}

export function reviveImage(d) {
  const m = Array.isArray(d.m) && d.m.length === 6 && d.m.every(Number.isFinite) ? d.m.slice() : [200, 0, 0, 200, 400, 600];
  const src = d.src && d.src.blobId ? { ...d.src } : null;
  return createImageItem({ blobId: d.blobId, iw: d.iw || 1, ih: d.ih || 1, m, z: d.z || 0, src });
}

// ---------- PDF-Hintergrund ----------

// Wo liegt die PDF-Seite auf unserer Seite? Eingepasst und mittig (Querformat: oben und unten Rand).
export function bgRect(bg) {
  const s = Math.min(PAGE_WIDTH / bg.w, PAGE_HEIGHT / bg.h);
  const w = bg.w * s;
  const h = bg.h * s;
  return { x: (PAGE_WIDTH - w) / 2, y: (PAGE_HEIGHT - h) / 2, w, h };
}

// Einstellung: PDF-Seiten im Dunkelmodus auch abdunkeln (Farben umdrehen)? Standard: nein –
// Arbeitsblätter bleiben weiß, die Tinte darauf ist dann ganz normal dunkel.
export const mediaSettings = { darkPdf: false };

// Ist diese Seite gerade "dunkel"? (Für Tinte und Papierfarbe)
export function pageDark(page, darkPaper) {
  if (page?.bg) return darkPaper && mediaSettings.darkPdf;
  return darkPaper;
}

// Scharfe Ausschnitte (siehe pdfdoc.js): Seiten-ID -> { canvas, k, rect }
export const sharpTiles = new Map();

// Hintergrund malen. ctx: (0, 0) = linke obere Ecke der Seite, in Seiten-Einheiten.
//   dark  Seite wird dunkel gezeigt -> PDF mit umgedrehten Farben
//   k     echte Pixel pro Seiten-Einheit (für scharfe Ausschnitte), 0 = egal
export function drawBackground(ctx, page, dark, k = 0) {
  const bg = page.bg;
  if (!bg) return;
  const r = bgRect(bg);
  const bmp = getBitmap(bg.blobId);
  ctx.save();
  if (dark) ctx.filter = 'invert(0.88) hue-rotate(180deg)';
  if (!dark) {
    // Weißer Grund hinter der PDF (falls die PDF selbst durchsichtig ist)
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  if (bmp) {
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(bmp, r.x, r.y, r.w, r.h);
  } else {
    ctx.fillStyle = 'rgba(128, 138, 160, 0.12)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
  }
  const tile = k ? sharpTiles.get(page.id) : null;
  if (tile && Math.abs(tile.k - k) / k < 0.02) {
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile.canvas, tile.rect.x, tile.rect.y, tile.rect.w, tile.rect.h);
  }
  ctx.restore();
}

// Wie scharf ist das gespeicherte Bild der PDF-Seite? (Pixel pro Seiten-Einheit)
export function bgResolution(page) {
  const bmp = cache.get(page.bg?.blobId)?.bitmap;
  if (!bmp) return 0;
  return bmp.width / bgRect(page.bg).w;
}
