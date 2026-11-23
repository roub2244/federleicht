// pdfdoc.js – PDF-Dateien öffnen (mit pdf.js, liegt komplett in der App -> geht offline)
//
// Beim Importieren malen wir jede PDF-Seite einmal als Bild (RES Pixel pro Seiten-Einheit)
// und speichern es. Damit öffnet sich die Notiz später sofort, auch ohne pdf.js.
// Die Original-PDF heben wir auch auf: Zoomst du weit hinein, malt pdf.js genau den
// sichtbaren Ausschnitt nochmal gestochen scharf nach (scheduleSharp).
//
// pdf.js ist groß (gut 1 MB). Es wird erst geladen, wenn wirklich eine PDF gebraucht wird.

import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import * as store from './store.js';
import { bgRect, bgResolution, sharpTiles, canvasBlob } from './media.js';

export const RES = 2;              // Pixel pro Seiten-Einheit im gespeicherten Bild (2000 × 2828 bei A4)
const MAX_SIDE = 4096;             // größer malen wir kein Canvas (Speicher!)
const MAX_PIXELS = 16e6;
const SHARP_DELAY = 220;           // ms nach dem letzten Zoomen/Verschieben

// Ordner mit Schriften und Hilfsprogrammen von pdf.js (kopiert vite.config.js mit in die App)
const assetUrl = (path) => new URL(`pdfjs/${path}`, document.baseURI).href;

let libPromise = null;
function pdfjs() {
  if (!libPromise) {
    libPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = workerUrl;
      return lib;
    });
    libPromise.catch(() => (libPromise = null));
  }
  return libPromise;
}

async function openPdf(data) {
  const lib = await pdfjs();
  return lib.getDocument({
    data,
    standardFontDataUrl: assetUrl('standard_fonts/'),
    wasmUrl: assetUrl('wasm/'),
    isEvalSupported: false,
    enableXfa: false,
  }).promise;
}

// Geöffnete PDFs (nach Datei-Nummer), damit sie nicht bei jedem Zoomen neu geladen werden
const open = new Map(); // pdfId -> Promise<PDFDocumentProxy>
function getPdf(pdfId) {
  let p = open.get(pdfId);
  if (!p) {
    p = store.getBlob(pdfId).then(async (blob) => {
      if (!blob) throw new Error('PDF-Datei fehlt');
      return openPdf(new Uint8Array(await blob.arrayBuffer()));
    });
    p.catch(() => open.delete(pdfId));
    open.set(pdfId, p);
    // höchstens 3 PDFs offen halten
    while (open.size > 3) {
      const [oldId, old] = open.entries().next().value;
      open.delete(oldId);
      old.then((d) => d.loadingTask.destroy()).catch(() => {});
    }
  }
  return p;
}

// ---------- Importieren ----------
//
// file: die PDF-Datei. onProgress(fertig, gesamt). signal.cancelled = true bricht ab.
// Ergebnis: Liste von Hintergründen (page.bg) – eine pro PDF-Seite.
export async function importPdf(file, { onProgress = () => {}, signal = {} } = {}) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const pdfId = store.uid();
  await store.putBlob(pdfId, new Blob([bytes], { type: 'application/pdf' }));
  let pdf;
  try {
    pdf = await openPdf(bytes.slice()); // pdf.js "verbraucht" die Daten, darum eine Kopie
  } catch (err) {
    if (err?.name === 'PasswordException') throw new Error('Die PDF ist mit einem Passwort geschützt.');
    throw new Error('Die Datei ist keine lesbare PDF.');
  }
  const result = [];
  try {
    const n = pdf.numPages;
    onProgress(0, n);
    for (let i = 0; i < n; i++) {
      if (signal.cancelled) break;
      const page = await pdf.getPage(i + 1);
      const vp1 = page.getViewport({ scale: 1 }); // berücksichtigt gedrehte Seiten
      const bg = { blobId: store.uid(), w: vp1.width, h: vp1.height, pdfId, index: i };
      const rect = bgRect(bg);
      const canvas = await renderToCanvas(page, rect.w * RES / vp1.width);
      page.cleanup();
      const blob = await canvasBlob(canvas, 'image/webp', 0.86);
      canvas.width = canvas.height = 0; // Speicher sofort freigeben
      await store.putBlob(bg.blobId, blob);
      result.push(bg);
      onProgress(i + 1, n);
    }
  } finally {
    pdf.loadingTask.destroy();
  }
  return result;
}

// Eine ganze PDF-Seite in ein neues Canvas malen (scale = Pixel pro PDF-Punkt)
async function renderToCanvas(page, scale) {
  let vp = page.getViewport({ scale });
  const fit = Math.min(1, MAX_SIDE / Math.max(vp.width, vp.height), Math.sqrt(MAX_PIXELS / (vp.width * vp.height)));
  if (fit < 1) vp = page.getViewport({ scale: scale * fit });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(vp.width));
  canvas.height = Math.max(1, Math.floor(vp.height));
  const ctx = canvas.getContext('2d', { alpha: false });
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return canvas;
}

// Für den Export: PDF-Seite frisch und scharf malen (k = Pixel pro Seiten-Einheit). null = geht nicht.
export async function renderBackground(bg, k) {
  if (!bg?.pdfId) return null;
  try {
    const pdf = await getPdf(bg.pdfId);
    const page = await pdf.getPage(bg.index + 1);
    const vp1 = page.getViewport({ scale: 1 });
    return await renderToCanvas(page, (bgRect(bg).w * k) / vp1.width);
  } catch (err) {
    console.warn('PDF-Seite lässt sich nicht scharf malen', err);
    return null;
  }
}

// ---------- Scharf nachmalen beim Reinzoomen ----------
//
// Der Renderer meldet nach jedem Neumalen, welche PDF-Seiten zu sehen sind (mit Zoom k und
// sichtbarem Bereich). Kurz nachdem du aufgehört hast zu zoomen/schieben, malt pdf.js den
// sichtbaren Teil (plus etwas Rand) in genau der Bildschirm-Auflösung. Danach: onReady().

let sharpTimer = 0;
let sharpJob = null; // { task, cancelled }
let wanted = [];

export function scheduleSharp(list, onReady) {
  // Ausschnitte von Seiten, die nicht mehr zu sehen sind, wegwerfen
  const ids = new Set(list.map((e) => e.page.id));
  for (const id of sharpTiles.keys()) if (!ids.has(id)) sharpTiles.delete(id);
  wanted = list.filter((e) => needsSharp(e));
  clearTimeout(sharpTimer);
  if (!wanted.length) return;
  sharpTimer = setTimeout(() => runSharp(onReady), SHARP_DELAY);
}

// Braucht diese Seite einen schärferen Ausschnitt?
function needsSharp({ page, k, vis }) {
  if (!page.bg?.pdfId) return false;
  const res = bgResolution(page);
  if (res && k <= res * 1.15) return false; // das gespeicherte Bild ist scharf genug
  const r = clipToBg(page.bg, vis);
  if (!r) return false;
  const tile = sharpTiles.get(page.id);
  if (!tile || Math.abs(tile.k - k) / k >= 0.02) return true;
  const t = tile.rect;
  return r.x < t.x - 0.5 || r.y < t.y - 0.5 || r.x + r.w > t.x + t.w + 0.5 || r.y + r.h > t.y + t.h + 0.5;
}

// Sichtbarer Bereich ∩ PDF-Fläche (Seiten-Einheiten)
function clipToBg(bg, vis, margin = 0) {
  const b = bgRect(bg);
  const mx = (vis.x1 - vis.x0) * margin;
  const my = (vis.y1 - vis.y0) * margin;
  const x0 = Math.max(b.x, vis.x0 - mx);
  const y0 = Math.max(b.y, vis.y0 - my);
  const x1 = Math.min(b.x + b.w, vis.x1 + mx);
  const y1 = Math.min(b.y + b.h, vis.y1 + my);
  if (x1 <= x0 || y1 <= y0) return null;
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

async function runSharp(onReady) {
  if (sharpJob) sharpJob.cancelled = true;
  sharpJob?.task?.cancel();
  const job = { cancelled: false, task: null };
  sharpJob = job;
  for (const entry of wanted.slice()) {
    if (job.cancelled) return;
    const { page, k } = entry;
    // Etwas mehr als sichtbar malen (dann muss beim kleinen Verschieben nicht neu gemalt werden),
    // aber nie mehr als MAX_PIXELS
    let r = clipToBg(page.bg, entry.vis, 0.35);
    if (!r) continue;
    if (r.w * k * r.h * k > MAX_PIXELS || Math.max(r.w, r.h) * k > MAX_SIDE) r = clipToBg(page.bg, entry.vis, 0);
    if (!r || r.w * k * r.h * k > MAX_PIXELS || Math.max(r.w, r.h) * k > MAX_SIDE) continue;
    try {
      const pdf = await getPdf(page.bg.pdfId);
      const p = await pdf.getPage(page.bg.index + 1);
      if (job.cancelled) return;
      const vp1 = p.getViewport({ scale: 1 });
      const b = bgRect(page.bg);
      const vp = p.getViewport({ scale: (b.w * k) / vp1.width });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(r.w * k);
      canvas.height = Math.ceil(r.h * k);
      const ctx = canvas.getContext('2d', { alpha: false });
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      job.task = p.render({
        canvasContext: ctx,
        viewport: vp,
        transform: [1, 0, 0, 1, -(r.x - b.x) * k, -(r.y - b.y) * k],
      });
      await job.task.promise;
      if (job.cancelled) return;
      // Gemalt wurde auf ganze Pixel aufgerundet -> Rechteck genau passend dazu
      sharpTiles.set(page.id, { canvas, k, rect: { x: r.x, y: r.y, w: canvas.width / k, h: canvas.height / k } });
      onReady();
    } catch (err) {
      if (err?.name !== 'RenderingCancelledException') console.warn('Scharf nachmalen ging nicht', err);
    }
  }
  if (sharpJob === job) sharpJob = null;
}
