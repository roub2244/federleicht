// templates.js – Seitenvorlagen: leer, liniert, kariert, gepunktet …
//
// Eine Vorlage ist ein kleines Objekt: { kind: 'grid', spacing: 'M', paper: 'white' }
//   kind     welche Linien (siehe TEMPLATES)
//   spacing  Linienabstand: 'S' eng, 'M' mittel, 'L' weit
//   paper    Papierfarbe (siehe PAPERS)
//
// Die Linien werden NICHT gespeichert, sondern jedes Mal frisch gemalt –
// nur der sichtbare Teil. Deshalb bleiben sie beim Zoomen gestochen scharf.
//
// Maße: Die Seite ist 1000 Einheiten breit, ein DIN-A4-Blatt 210 mm.
// Also ist 1 mm = 1000 / 210 ≈ 4,76 Einheiten.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';

export const MM = PAGE_WIDTH / 210;

// Linienabstand in mm, je nach Vorlage und Stufe
const SPACING = {
  lined: { S: 6, M: 8, L: 10 },
  college: { S: 6, M: 8, L: 10 },
  cornell: { S: 6, M: 8, L: 10 },
  grid: { S: 4, M: 5, L: 7 },
  math: { S: 4, M: 5, L: 6 },
  dots: { S: 4, M: 5, L: 7 },
  music: { S: 1.7, M: 2.1, L: 2.6 }, // Abstand der 5 Notenlinien
};

export const TEMPLATES = [
  { id: 'blank', name: 'Leer' },
  { id: 'lined', name: 'Liniert' },
  { id: 'college', name: 'Collegeblock' },
  { id: 'grid', name: 'Kariert' },
  { id: 'math', name: 'Mathe-Heft' },
  { id: 'dots', name: 'Gepunktet' },
  { id: 'mm', name: 'Millimeter' },
  { id: 'cornell', name: 'Cornell' },
  { id: 'music', name: 'Notenlinien' },
];

export const hasSpacing = (kind) => Boolean(SPACING[kind]);

// Papierfarben: hell (normal) und dunkel (dunkles Blatt im Dunkelmodus)
export const PAPERS = [
  { id: 'white', name: 'Weiß', light: '#ffffff', dark: '#1f2228' },
  { id: 'cream', name: 'Creme', light: '#fbf5e6', dark: '#26231d' },
  { id: 'gray', name: 'Grau', light: '#eef0f3', dark: '#17191d' },
  { id: 'blue', name: 'Blau', light: '#edf3ff', dark: '#1b2131' },
  { id: 'green', name: 'Grün', light: '#ecf7ee', dark: '#1a251e' },
  { id: 'rose', name: 'Rosa', light: '#fceff2', dark: '#2a1e23' },
];

export const DEFAULT_TEMPLATE = { kind: 'grid', spacing: 'M', paper: 'white' };

export function paperColor(paper, dark) {
  const p = PAPERS.find((x) => x.id === paper) || PAPERS[0];
  return dark ? p.dark : p.light;
}

// Farben der Linien: im Hellen dunkelgrau-blau, im Dunklen hellgrau, jeweils durchsichtig
function inks(dark) {
  return dark
    ? {
        line: 'rgba(205, 215, 240, 0.17)',
        strong: 'rgba(205, 215, 240, 0.3)',
        margin: 'rgba(255, 120, 120, 0.45)',
        mmThin: 'rgba(255, 170, 120, 0.12)',
        mmMid: 'rgba(255, 170, 120, 0.22)',
        mmBold: 'rgba(255, 170, 120, 0.36)',
        hole: 'rgba(0, 0, 0, 0.35)',
      }
    : {
        line: 'rgba(60, 75, 110, 0.24)',
        strong: 'rgba(60, 75, 110, 0.42)',
        margin: 'rgba(225, 60, 60, 0.5)',
        mmThin: 'rgba(225, 110, 50, 0.18)',
        mmMid: 'rgba(225, 110, 50, 0.32)',
        mmBold: 'rgba(225, 110, 50, 0.5)',
        hole: 'rgba(30, 40, 70, 0.08)',
      };
}

// Die Linien einer Vorlage malen.
//   ctx   ist schon so verschoben, dass (0, 0) die linke obere Ecke der Seite ist
//   vis   der sichtbare Teil der Seite { x0, y0, x1, y1 } (in Seiten-Einheiten)
//   px    wie viele echte Bildschirm-Pixel eine Seiten-Einheit gerade hat
//   dark  dunkles Blatt?
export function drawTemplate(ctx, tpl, vis, px, dark) {
  const kind = tpl.kind || 'blank';
  if (kind === 'blank') return;
  const c = inks(dark);
  // Linienbreite: etwa 1 echter Pixel – beim Hineinzoomen wird sie nur langsam dicker
  const hair = (1 / px) * Math.max(1, Math.sqrt(px / 3));
  const step = (SPACING[kind]?.[tpl.spacing] ?? SPACING[kind]?.M ?? 5) * MM;
  const pen = { ctx, vis, hair };

  ctx.save();
  ctx.lineCap = 'butt';
  // Weit herausgezoomt liegen die Linien so eng, dass nur grauer Brei bleibt: dann ausblenden
  const gap = step * px; // Linienabstand in echten Pixeln
  if (kind !== 'mm' && gap < 7) ctx.globalAlpha *= Math.max(0.15, (gap - 1.5) / 5.5);
  switch (kind) {
    case 'lined': {
      hLines(pen, 22 * MM, PAGE_HEIGHT - 10 * MM, step, 0, PAGE_WIDTH, c.line, 1);
      break;
    }
    case 'college': {
      // Kopfzeile für Datum/Thema, darunter Linien, links ein roter Rand und Lochung
      line(pen, 0, 16 * MM, PAGE_WIDTH, 16 * MM, c.strong, 1);
      hLines(pen, 16 * MM + step, PAGE_HEIGHT - 10 * MM, step, 0, PAGE_WIDTH, c.line, 1);
      line(pen, 26 * MM, 0, 26 * MM, PAGE_HEIGHT, c.margin, 1.2);
      holes(pen, c.hole);
      break;
    }
    case 'grid': {
      // Wie bei Samsung Notes: Karos über die ganze Seite, mittig ausgerichtet
      const ox = (PAGE_WIDTH % step) / 2;
      const oy = (PAGE_HEIGHT % step) / 2;
      vLines(pen, ox, PAGE_WIDTH, step, 0, PAGE_HEIGHT, c.line, 1);
      hLines(pen, oy, PAGE_HEIGHT, step, 0, PAGE_WIDTH, c.line, 1);
      break;
    }
    case 'math': {
      // Rechenheft: Karos mit Rand rundherum (rechts breiter, für Korrekturen)
      const cols = Math.floor((PAGE_WIDTH - 12 * MM - 22 * MM) / step);
      const rows = Math.floor((PAGE_HEIGHT - 14 * MM - 12 * MM) / step);
      const x0 = 12 * MM;
      const y0 = 14 * MM;
      const x1 = x0 + cols * step;
      const y1 = y0 + rows * step;
      vLines(pen, x0, x1 + 0.1, step, y0, y1, c.line, 1);
      hLines(pen, y0, y1 + 0.1, step, x0, x1, c.line, 1);
      rect(pen, x0, y0, x1, y1, c.strong, 1.4);
      break;
    }
    case 'dots': {
      const ox = (PAGE_WIDTH % step) / 2;
      const oy = (PAGE_HEIGHT % step) / 2;
      const r = Math.max(hair * 1.3, 0.55);
      ctx.fillStyle = dark ? 'rgba(205, 215, 240, 0.4)' : 'rgba(60, 75, 110, 0.5)';
      ctx.beginPath();
      const ky0 = Math.max(0, Math.floor((vis.y0 - oy) / step));
      const ky1 = Math.ceil((vis.y1 - oy) / step);
      const kx0 = Math.max(0, Math.floor((vis.x0 - ox) / step));
      const kx1 = Math.ceil((vis.x1 - ox) / step);
      for (let ky = ky0; ky <= ky1; ky++) {
        const y = oy + ky * step;
        if (y > PAGE_HEIGHT) break;
        for (let kx = kx0; kx <= kx1; kx++) {
          const x = ox + kx * step;
          if (x > PAGE_WIDTH) break;
          ctx.moveTo(x + r, y);
          ctx.arc(x, y, r, 0, Math.PI * 2);
        }
      }
      ctx.fill();
      break;
    }
    case 'mm': {
      // Millimeterpapier: 1 mm fein, 5 mm mittel, 1 cm kräftig. Rand 10 mm.
      const x0 = 10 * MM;
      const y0 = 12 * MM;
      const x1 = x0 + 190 * MM;
      const y1 = y0 + 270 * MM;
      // feine Linien nur, wenn sie nicht zu einem grauen Brei verschwimmen
      if (MM * px > 4) {
        vLines(pen, x0, x1, MM, y0, y1, c.mmThin, 1, 5);
        hLines(pen, y0, y1, MM, x0, x1, c.mmThin, 1, 5);
      }
      vLines(pen, x0 + 5 * MM, x1, 10 * MM, y0, y1, c.mmMid, 1);
      hLines(pen, y0 + 5 * MM, y1, 10 * MM, x0, x1, c.mmMid, 1);
      vLines(pen, x0, x1 + 0.1, 10 * MM, y0, y1, c.mmBold, 1.3);
      hLines(pen, y0, y1 + 0.1, 10 * MM, x0, x1, c.mmBold, 1.3);
      break;
    }
    case 'cornell': {
      // Cornell-Notizen: oben Titel, links Stichworte, rechts Notizen, unten Zusammenfassung
      const head = 22 * MM;
      const cue = 62 * MM;
      const summary = PAGE_HEIGHT - 52 * MM;
      line(pen, 0, head, PAGE_WIDTH, head, c.strong, 1.4);
      line(pen, cue, head, cue, summary, c.strong, 1.4);
      line(pen, 0, summary, PAGE_WIDTH, summary, c.strong, 1.4);
      hLines(pen, head + step, summary - step * 0.5, step, cue, PAGE_WIDTH, c.line, 1);
      break;
    }
    case 'music': {
      const g = step; // Abstand der Linien eines Systems
      const staff = g * 4;
      const between = 13 * MM;
      for (let y = 20 * MM; y + staff < PAGE_HEIGHT - 12 * MM; y += staff + between) {
        if (y > vis.y1 || y + staff < vis.y0) continue;
        for (let k = 0; k < 5; k++) line(pen, 15 * MM, y + k * g, PAGE_WIDTH - 15 * MM, y + k * g, c.strong, 0.9);
        line(pen, 15 * MM, y, 15 * MM, y + staff, c.strong, 1);
        line(pen, PAGE_WIDTH - 15 * MM, y, PAGE_WIDTH - 15 * MM, y + staff, c.strong, 1);
      }
      break;
    }
  }
  ctx.restore();
}

// ---------- kleine Mal-Helfer ----------

// Waagerechte Linien von y=from bis y=to im Abstand step (nur die sichtbaren).
// skip: jede skip-te Linie auslassen (beim Millimeterpapier malen das die dickeren)
function hLines({ ctx, vis, hair }, from, to, step, x0, x1, color, weight, skip = 0) {
  const a = Math.max(x0, vis.x0);
  const b = Math.min(x1, vis.x1);
  if (a >= b) return;
  ctx.beginPath();
  const k0 = Math.max(0, Math.floor((vis.y0 - from) / step));
  for (let k = k0; ; k++) {
    const y = from + k * step;
    if (y > to || y > vis.y1 + step) break;
    if (skip && k % skip === 0) continue;
    ctx.moveTo(a, y);
    ctx.lineTo(b, y);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = hair * weight;
  ctx.stroke();
}

function vLines({ ctx, vis, hair }, from, to, step, y0, y1, color, weight, skip = 0) {
  const a = Math.max(y0, vis.y0);
  const b = Math.min(y1, vis.y1);
  if (a >= b) return;
  ctx.beginPath();
  const k0 = Math.max(0, Math.floor((vis.x0 - from) / step));
  for (let k = k0; ; k++) {
    const x = from + k * step;
    if (x > to || x > vis.x1 + step) break;
    if (skip && k % skip === 0) continue;
    ctx.moveTo(x, a);
    ctx.lineTo(x, b);
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = hair * weight;
  ctx.stroke();
}

function line({ ctx, hair }, x0, y0, x1, y1, color, weight) {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.strokeStyle = color;
  ctx.lineWidth = hair * weight;
  ctx.stroke();
}

function rect({ ctx, hair }, x0, y0, x1, y1, color, weight) {
  ctx.strokeStyle = color;
  ctx.lineWidth = hair * weight;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}

// Vier angedeutete Löcher am linken Rand (wie beim Collegeblock)
function holes({ ctx }, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  for (const y of [0.2, 0.4, 0.6, 0.8]) {
    ctx.moveTo(9 * MM + 2.6 * MM, y * PAGE_HEIGHT);
    ctx.arc(9 * MM, y * PAGE_HEIGHT, 2.6 * MM, 0, Math.PI * 2);
  }
  ctx.fill();
}

// Eine Seite verkleinert auf ein Canvas malen (für Vorschaubilder).
//   crop     1 = ganze Seite, 0.4 = nur die linke obere Ecke (40 % der Breite), damit man die Linien erkennt
//   faint    Linien heller malen (bei ganz kleinen Bildern sonst nur grauer Brei)
//   strokes  Striche der Seite, fill = Funktion, die einen Strich malt
//   width    Breite in echten Pixeln (Standard: so breit, wie das Canvas angezeigt wird)
export function drawThumbnail(canvas, tpl, { dark = false, crop = 1, faint = false, strokes = [], fill = null, width = 0 } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const w = width || Math.max(1, Math.round((canvas.clientWidth || 80) * dpr));
  const h = Math.round((w * PAGE_HEIGHT) / PAGE_WIDTH);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  const s = w / (PAGE_WIDTH * crop);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = paperColor(tpl.paper, dark);
  ctx.fillRect(0, 0, w, h);
  ctx.setTransform(s, 0, 0, s, 0, 0);
  ctx.globalAlpha = faint ? 0.5 : 1;
  drawTemplate(ctx, tpl, { x0: 0, y0: 0, x1: PAGE_WIDTH * crop, y1: PAGE_HEIGHT * crop }, s, dark);
  ctx.globalAlpha = 1;
  if (fill) for (const stroke of strokes) fill(ctx, stroke);
}
