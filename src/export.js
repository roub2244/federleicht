// export.js – Notiz als PDF oder Bild weitergeben (Teilen, Herunterladen)
//
// Jede Seite wird in hoher Auflösung auf ein Canvas gemalt (immer mit hellem Blatt, wie auf
// Papier gedruckt). PDF-Hintergründe malt pdf.js dafür nochmal frisch und scharf.
// Aus den Seitenbildern bauen wir selbst eine kleine PDF-Datei – dafür braucht es keine
// zusätzliche Bibliothek: Eine PDF ist im Grunde Text mit eingebetteten JPEG-Bildern.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { drawTemplate, paperColor } from './templates.js';
import { fillStroke, inkTheme, setInkTheme } from './ink.js';
import { bgRect, drawBackground, ensureLoaded, imageIdsOf, canvasBlob } from './media.js';
import { renderBackground } from './pdfdoc.js';

export const EXPORT_RES = 2; // Pixel pro Seiten-Einheit: 2000 × 2828 Pixel pro Seite (≈ 240 dpi)

// Eine Seite fertig malen (hell, ohne Rand, ohne Schatten)
export async function renderPage(page, k = EXPORT_RES) {
  await ensureLoaded(imageIdsOf([page]));
  const sharpBg = page.bg?.pdfId ? await renderBackground(page.bg, k) : null;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(PAGE_WIDTH * k);
  canvas.height = Math.round(PAGE_HEIGHT * k);
  const ctx = canvas.getContext('2d', { alpha: false });
  const paper = paperColor(page.template.paper, false);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  if (sharpBg) {
    const r = bgRect(page.bg);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.drawImage(sharpBg, r.x, r.y, r.w, r.h);
    sharpBg.width = sharpBg.height = 0;
  } else if (page.bg) {
    drawBackground(ctx, page, false);
  }
  drawTemplate(ctx, page.template, { x0: 0, y0: 0, x1: PAGE_WIDTH, y1: PAGE_HEIGHT }, k, false);
  const saved = { ...inkTheme };
  setInkTheme(false, paper);
  try {
    for (const s of page.strokes) if (s.box) fillStroke(ctx, s);
  } finally {
    setInkTheme(saved.dark, saved.paper);
  }
  return canvas;
}

// Mehrere Seiten -> PDF (Blob). onProgress(fertig, gesamt), signal.cancelled bricht ab.
export async function exportPdf(pages, { title = '', onProgress = () => {}, signal = {} } = {}) {
  const images = [];
  onProgress(0, pages.length);
  for (let i = 0; i < pages.length; i++) {
    if (signal.cancelled) return null;
    const canvas = await renderPage(pages[i]);
    const blob = await canvasBlob(canvas, 'image/jpeg', 0.9);
    images.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height });
    canvas.width = canvas.height = 0;
    onProgress(i + 1, pages.length);
    await new Promise((r) => setTimeout(r, 0)); // kurz Luft holen, damit die Anzeige mitkommt
  }
  return buildPdf(images, title);
}

// Eine Seite als PNG-Bild
export async function exportImage(page) {
  const canvas = await renderPage(page);
  const blob = await canvasBlob(canvas, 'image/png');
  canvas.width = canvas.height = 0;
  return blob;
}

// ---------- Eine PDF-Datei von Hand bauen ----------
//
// Aufbau: Kopf, nummerierte "Objekte" (Katalog, Seitenliste, je Seite: Seite, Bild, Inhalt),
// am Ende ein Inhaltsverzeichnis (xref) mit der Byte-Position jedes Objekts.
const A4 = [595.28, 841.89]; // DIN A4 in PDF-Punkten (1/72 Zoll)

export function buildPdf(images, title = '') {
  const enc = new TextEncoder();
  const chunks = [];
  const offsets = [];
  let length = 0;
  const write = (part) => {
    const bytes = typeof part === 'string' ? enc.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  const object = (n, body, stream = null) => {
    offsets[n] = length;
    write(`${n} 0 obj\n${body}\n`);
    if (stream) {
      write('stream\n');
      write(stream);
      write('\nendstream\n');
    }
    write('endobj\n');
  };

  write('%PDF-1.4\n');
  write(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])); // "binäre" Markierung

  const pageNums = images.map((_, i) => 4 + i * 3); // Objekte: Seite, Bild, Inhalt
  object(1, '<< /Type /Catalog /Pages 2 0 R >>');
  object(2, `<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(' ')}] /Count ${images.length} >>`);
  object(3, `<< /Title ${pdfText(title || 'Federleicht')} /Producer (Federleicht) /CreationDate (D:${pdfDate()}) >>`);
  const [W, H] = A4;
  images.forEach((img, i) => {
    const n = pageNums[i];
    object(n, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 ${n + 1} 0 R >> >> /Contents ${n + 2} 0 R >>`);
    object(
      n + 1,
      `<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.bytes.length} >>`,
      img.bytes
    );
    const content = enc.encode(`q ${W} 0 0 ${H} 0 0 cm /Im0 Do Q`);
    object(n + 2, `<< /Length ${content.length} >>`, content);
  });

  const count = 4 + images.length * 3;
  const xref = length;
  let table = `xref\n0 ${count}\n0000000000 65535 f \n`;
  for (let n = 1; n < count; n++) table += `${String(offsets[n]).padStart(10, '0')} 00000 n \n`;
  write(table);
  write(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}

// Text für die PDF (Titel mit Umlauten): als UTF-16 in Hex-Schreibweise
function pdfText(text) {
  let hex = 'FEFF';
  for (const ch of String(text).slice(0, 200)) {
    const code = ch.codePointAt(0);
    const units = code > 0xffff ? [0xd800 + ((code - 0x10000) >> 10), 0xdc00 + ((code - 0x10000) & 0x3ff)] : [code];
    for (const u of units) hex += u.toString(16).padStart(4, '0').toUpperCase();
  }
  return `<${hex}>`;
}

function pdfDate() {
  const d = new Date();
  const p = (v) => String(v).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ---------- Weitergeben ----------

// Dateiname aus dem Titel (ohne Zeichen, die Dateisysteme nicht mögen)
export function fileName(title, ext) {
  const base = String(title || 'Notiz').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'Notiz';
  return `${base}.${ext}`;
}

export function canShareFile(file) {
  try {
    return Boolean(navigator.canShare?.({ files: [file] }));
  } catch {
    return false;
  }
}

// Über das Teilen-Menü von Android (WhatsApp, Mail, Drive, Classroom …)
export async function shareFile(file, title) {
  try {
    await navigator.share({ files: [file], title });
    return true;
  } catch (err) {
    if (err?.name === 'AbortError') return true; // selbst abgebrochen
    console.warn('Teilen ging nicht', err);
    return false;
  }
}

// In den Downloads speichern
export function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
