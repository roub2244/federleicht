// text.js – Textfelder: getippter Text auf der Seite
//
// Ein Textfeld liegt wie ein Strich in page.strokes (mit tool: 'text').
// So bekommt es automatisch eine Reihenfolge (z), kann rückgängig gemacht,
// gespeichert und in den Vorschaubildern gezeigt werden.
//
// Aufbau eines Textfelds:
//   { tool: 'text', x, y, w, z, base, paras: [Absatz, ...], box }
//     x, y   linke obere Ecke auf der Seite (Seiten-Einheiten, Seite ist 1000 breit)
//     w      Breite – längere Zeilen werden umgebrochen
//     base   Grundgröße (für Einrückung von Listen)
//   Absatz: { a: 'left' | 'center' | 'right', l: null | 'bullet' | 'number', runs: [Stück, ...] }
//   Stück (Text mit EINEM Aussehen):
//     { t: 'Hallo', f: Schriftart, s: Größe, c: Farbe, b: fett, i: kursiv, u: unterstrichen, x: durchgestrichen, h: Hintergrund }
//
// Gemalt wird der Text direkt aufs Canvas (wie die Striche). Dafür brechen wir die Zeilen
// selbst um – genauso, wie es der Browser im Eingabefeld macht.
// Zum Tippen legt texteditor.js ein echtes Eingabefeld über das Textfeld.

import '@fontsource/nunito/latin-400.css';
import '@fontsource/nunito/latin-700.css';
import '@fontsource/nunito/latin-400-italic.css';
import '@fontsource/nunito/latin-700-italic.css';
import '@fontsource/merriweather/latin-400.css';
import '@fontsource/merriweather/latin-700.css';
import '@fontsource/merriweather/latin-400-italic.css';
import '@fontsource/merriweather/latin-700-italic.css';
import '@fontsource/caveat/latin-400.css';
import '@fontsource/caveat/latin-700.css';
import '@fontsource/patrick-hand/latin-400.css';

import { displayColor, highlighterColor, inkTheme } from './ink.js';

// Die Schriftarten. Die meisten liegen in der App selbst (funktionieren also offline).
export const FONTS = [
  { id: 'sans', name: 'Standard', css: 'system-ui, Roboto, "Segoe UI", sans-serif' },
  { id: 'round', name: 'Rund', css: '"Nunito", system-ui, sans-serif' },
  { id: 'serif', name: 'Buch', css: '"Merriweather", Georgia, serif' },
  { id: 'mono', name: 'Schreibmaschine', css: 'ui-monospace, "Roboto Mono", "Courier New", monospace' },
  { id: 'hand', name: 'Handschrift', css: '"Caveat", cursive' },
  { id: 'print', name: 'Druckschrift', css: '"Patrick Hand", cursive' },
];
const fontById = Object.fromEntries(FONTS.map((f) => [f.id, f]));
export const fontCss = (id) => (fontById[id] || FONTS[0]).css;

// Schriftgröße: angezeigt wird "pt" (wie in Word), gespeichert in Seiten-Einheiten
export const PT = 1.6;
export const SIZES_PT = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 42, 48, 60, 72, 96];

export const LINE_HEIGHT = 1.3;     // Zeilenhöhe = 1,3 × Schriftgröße
export const LIST_INDENT = 1.5;     // Einrückung von Listen (× Grundgröße)
export const MIN_WIDTH = 60;        // schmaler wird ein Textfeld nicht

export const DEFAULT_STYLE = { f: 'sans', s: 14 * PT, c: '#000000', b: false, i: false, u: false, x: false, h: null };

// ---------- Anlegen ----------

export function createTextItem({ x, y, w, z, style }) {
  const run = { ...DEFAULT_STYLE, ...style, t: '' };
  const item = { tool: 'text', x, y, w, z, base: run.s, paras: [{ a: 'left', l: null, runs: [run] }], box: null };
  updateTextBox(item);
  return item;
}

export function isEmptyText(item) {
  return item.paras.every((p) => p.runs.every((r) => !r.t.trim()) && !p.l);
}

// Gespeichertes Textfeld (aus store.js) wieder herstellen – fehlende Werte ergänzen
export function reviveText(d) {
  const paras = (d.paras || []).map((p) => ({
    a: ['left', 'center', 'right'].includes(p.a) ? p.a : 'left',
    l: p.l === 'bullet' || p.l === 'number' ? p.l : null,
    runs: (p.runs?.length ? p.runs : [{ t: '' }]).map((r) => ({ ...DEFAULT_STYLE, ...r, t: String(r.t ?? '') })),
  }));
  const item = {
    tool: 'text',
    x: d.x || 0,
    y: d.y || 0,
    w: Math.max(MIN_WIDTH, d.w || 300),
    z: d.z || 0,
    base: d.base || DEFAULT_STYLE.s,
    paras: paras.length ? paras : [{ a: 'left', l: null, runs: [{ ...DEFAULT_STYLE, t: '' }] }],
    box: null,
  };
  updateTextBox(item);
  return item;
}

export function packText(item) {
  return { tool: 'text', x: item.x, y: item.y, w: item.w, z: item.z, base: item.base, paras: item.paras, box: item.box };
}

// ---------- Messen ----------

const measureCanvas = document.createElement('canvas');
const mctx = measureCanvas.getContext('2d');

export function fontString(run, size = run.s) {
  return `${run.i ? 'italic ' : ''}${run.b ? 700 : 400} ${size}px ${fontCss(run.f)}`;
}

// Ober- und Unterlänge einer Schrift (für die Zeilenhöhe)
const metricCache = new Map();
function metrics(run) {
  const key = `${run.f}|${run.b}|${run.i}`;
  let m = metricCache.get(key);
  if (!m) {
    mctx.font = fontString(run, 100);
    const t = mctx.measureText('Hgjä');
    const asc = t.fontBoundingBoxAscent ?? t.actualBoundingBoxAscent ?? 80;
    const desc = t.fontBoundingBoxDescent ?? t.actualBoundingBoxDescent ?? 20;
    m = { asc: asc / 100, desc: desc / 100 };
    metricCache.set(key, m);
  }
  return m;
}

function textWidth(run, text) {
  mctx.font = fontString(run);
  return mctx.measureText(text).width;
}

// ---------- Umbrechen ----------
//
// Ergebnis: Zeilen mit Stücken, jede Zeile weiß ihre Höhe und Grundlinie (baseline).

const layoutCache = new WeakMap();
let fontsVersion = 0;

// Wenn die eingebauten Schriften fertig geladen sind, müssen alle Texte neu vermessen werden
export function onFontsChanged(callback) {
  if (!document.fonts) return;
  document.fonts.addEventListener('loadingdone', () => {
    fontsVersion++;
    metricCache.clear();
    callback();
  });
}

// Alle eingebauten Schriften laden (Canvas lädt Schriften nicht von selbst)
export function loadFonts() {
  if (!document.fonts) return Promise.resolve();
  const jobs = [];
  for (const f of FONTS.slice(1)) {
    for (const style of ['', 'italic ']) {
      for (const weight of [400, 700]) jobs.push(document.fonts.load(`${style}${weight} 20px ${f.css}`).catch(() => {}));
    }
  }
  return Promise.all(jobs);
}

export function layoutText(item) {
  const cached = layoutCache.get(item);
  if (cached && cached.version === fontsVersion && cached.w === item.w) return cached;

  const lines = [];
  let y = 0;
  let number = 0;
  for (const para of item.paras) {
    number = para.l === 'number' ? number + 1 : 0;
    const indent = para.l ? LIST_INDENT * item.base : 0;
    const width = Math.max(10, item.w - indent);
    const first = para.runs[0] || DEFAULT_STYLE;
    const paraLines = wrapParagraph(para, width);
    paraLines.forEach((line, k) => {
      // Zeilenhöhe wie im Browser: jedes Stück bringt (Schrift + halber Zeilenabstand) mit,
      // dazu die Schrift des Absatzes selbst ("strut")
      let above = 0;
      let below = 0;
      const parts = line.segs.length ? line.segs.map((s) => s.run) : [line.emptyRun || first];
      for (const run of [first, ...parts]) {
        const m = metrics(run);
        const half = (LINE_HEIGHT * run.s - (m.asc + m.desc) * run.s) / 2;
        above = Math.max(above, m.asc * run.s + half);
        below = Math.max(below, m.desc * run.s + half);
      }
      const offset = para.a === 'right' ? width - line.width : para.a === 'center' ? (width - line.width) / 2 : 0;
      lines.push({
        top: y,
        baseline: y + above,
        height: above + below,
        x: indent + Math.max(0, offset),
        segs: line.segs,
        marker: k === 0 && para.l ? { text: para.l === 'bullet' ? '•' : `${number}.`, run: first, indent } : null,
      });
      y += above + below;
    });
  }
  const result = { version: fontsVersion, w: item.w, lines, height: Math.max(y, LINE_HEIGHT * item.base) };
  layoutCache.set(item, result);
  return result;
}

// Einen Absatz in Zeilen aufteilen (Wort für Wort, notfalls mitten im Wort)
function wrapParagraph(para, width) {
  const lines = [];
  let segs = [];
  let x = 0;
  let trailing = 0; // Breite der Leerzeichen am Zeilenende (zählen nicht mit)

  const push = (run, text, w) => {
    const last = segs[segs.length - 1];
    if (last && last.run === run) {
      last.text += text;
      last.w += w;
    } else segs.push({ run, text, x, w });
    x += w;
  };
  const newLine = () => {
    lines.push({ segs, width: x - trailing });
    segs = [];
    x = 0;
    trailing = 0;
  };

  let lastRun = null;
  for (const run of para.runs) {
    lastRun = run;
    if (!run.t) continue;
    for (const token of run.t.split(/(\s+)/)) {
      if (!token) continue;
      const w = textWidth(run, token);
      if (/^\s+$/.test(token)) {
        push(run, token, w);
        trailing += w;
        continue;
      }
      if (x - trailing + w > width + 0.01 && x > 0) {
        // Wort passt nicht mehr: neue Zeile (Leerzeichen am Ende bleiben hängen)
        newLine();
      }
      if (w > width + 0.01) {
        // Ein Wort länger als die ganze Zeile: Buchstabe für Buchstabe umbrechen
        for (const ch of token) {
          const cw = textWidth(run, ch);
          if (x + cw > width + 0.01 && x > 0) newLine();
          push(run, ch, cw);
        }
        trailing = 0;
        continue;
      }
      push(run, token, w);
      trailing = 0;
    }
  }
  lines.push({ segs, width: x - trailing, emptyRun: segs.length ? null : lastRun });
  return lines;
}

// Umgebendes Rechteck neu berechnen (nach jeder Änderung)
export function updateTextBox(item) {
  const { height } = layoutText(item);
  item.box = { minX: item.x, minY: item.y, maxX: item.x + item.w, maxY: item.y + height };
  return item;
}

// ---------- Malen ----------

export function drawText(ctx, item) {
  if (item.editing) return; // gerade im Eingabefeld – dort ist er schon zu sehen
  const layout = layoutText(item);
  if (item.box.maxY - item.box.minY !== layout.height) updateTextBox(item); // Schrift wurde nachgeladen
  ctx.save();
  ctx.translate(item.x, item.y);
  ctx.textBaseline = 'alphabetic';
  for (const line of layout.lines) {
    if (line.marker) {
      const { run, text, indent } = line.marker;
      ctx.font = fontString({ ...run, u: false, x: false });
      ctx.fillStyle = displayColor(run.c);
      ctx.textAlign = 'right';
      ctx.fillText(text, indent - 0.35 * run.s, line.baseline);
      ctx.textAlign = 'left';
    }
    for (const seg of line.segs) {
      const run = seg.run;
      const x = line.x + seg.x;
      const m = metrics(run);
      if (run.h) {
        ctx.fillStyle = textHighlight(run.h);
        ctx.fillRect(x, line.baseline - m.asc * run.s, seg.w, (m.asc + m.desc) * run.s);
      }
      ctx.font = fontString(run);
      const color = displayColor(run.c);
      ctx.fillStyle = color;
      ctx.fillText(seg.text, x, line.baseline);
      if (run.u || run.x) {
        const thick = Math.max(0.6, run.s / 15);
        // Leerzeichen am Zeilenende nicht unterstreichen
        const w = /\s+$/.test(seg.text) && seg === line.segs[line.segs.length - 1] ? textWidth(run, seg.text.trimEnd()) : seg.w;
        if (run.u) ctx.fillRect(x, line.baseline + run.s * 0.1, w, thick);
        if (run.x) ctx.fillRect(x, line.baseline - run.s * 0.3, w, thick);
      }
    }
  }
  ctx.restore();
}

// Hintergrundfarbe (Text-Markierung) passend zum Blatt
export function textHighlight(hex) {
  return highlighterColor(hex, inkTheme.dark ? 0.55 : 0.5, inkTheme.paper);
}

// Liegt der Punkt (Seiten-Koordinaten) auf diesem Textfeld? pad = etwas Spielraum
export function textHit(item, x, y, pad = 0) {
  const b = item.box;
  return x >= b.minX - pad && x <= b.maxX + pad && y >= b.minY - pad && y <= b.maxY + pad;
}
