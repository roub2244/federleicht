// convert.js – Handschrift zu Text
//
// So funktioniert es:
//   1. Die ausgewählte Handschrift (oder alles auf der Seite) wird als schwarz-weißes Bild
//      gemalt – schön dick und gleichmäßig, so wie es eine Texterkennung mag.
//   2. Tesseract liest das Bild. Tesseract ist ein freies Texterkennungs-Programm (OCR),
//      das hier als WebAssembly direkt im Browser läuft – mit deutschem Wörterbuch.
//      Es läuft komplett auf dem Tablet: kein Internet, kein Konto, keine Kosten.
//      (Die Dateien dafür liegen in der App im Ordner ocr/, zusammen etwa 5 MB.)
//   3. Du siehst das Ergebnis in einem Fenster und kannst Fehler noch verbessern.
//      Dann wird die Handschrift durch ein ordentlich ausgerichtetes Textfeld ersetzt:
//      linksbündig, gleichmäßige Zeilen, Größe passend zur Handschrift – auf liniertem
//      Papier auf Wunsch genau auf den Linien.
//
// Gut zu wissen: Ordentliche Druckbuchstaben erkennt Tesseract am besten. Bei verbundener
// Schreibschrift gibt es mehr Fehler – dafür ist das Fenster zum Verbessern da.

import { createTextItem, updateTextBox, PT, SIZES_PT, LINE_HEIGHT, FONTS, fontCss } from './text.js';
import { ruling } from './templates.js';
import { openDialog, progressBox, toast, esc } from './dialog.js';
import { PAGE_WIDTH } from './view.js';
import { fitBaseline } from './assist.js';
import { recognizePolys, learnFrom, learnedLines, forgetLearned } from './htr.js';
import { prepare as prepareMath, recognize as recognizeMath } from './mathink.js';

const TARGET_HEIGHT = 34; // so hoch (Pixel) soll eine typische Buchstabenhöhe im Bild sein
const PAD = 24;           // weißer Rand ums Bild (Pixel)
const MAX_SIDE = 4200;    // größer malen wir das Bild nicht (Speicher)

// ---------- Die Texterkennung laden (nur einmal) ----------
let workerPromise = null;
let progressHook = null;

function ocrUrl(name) {
  return new URL(`./ocr/${name}`, document.baseURI).href;
}

function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker, OEM, PSM } = await import('tesseract.js');
      const worker = await createWorker('deu', OEM.LSTM_ONLY, {
        workerPath: ocrUrl('worker.min.js'),
        corePath: ocrUrl('tesseract-core-simd-lstm.wasm.js'),
        langPath: ocrUrl(''),
        gzip: true,
        workerBlobURL: false,
        logger: (m) => progressHook?.(m),
      });
      await worker.setParameters({
        tessedit_pageseg_mode: PSM.SINGLE_LINE, // wir geben immer genau eine Zeile
        preserve_interword_spaces: '1',
      });
      return worker;
    })().catch((err) => {
      workerPromise = null; // nächstes Mal neu versuchen
      throw err;
    });
  }
  return workerPromise;
}

// ---------- 1. Handschrift in Zeilen aufteilen ----------
// Die Striche liegen in der Reihenfolge, in der du sie geschrieben hast. Ein Strich gehört zu
// einer Zeile, wenn er senkrecht in ihr "Band" fällt (zwischen Oberlänge und Unterlänge).
// i-Punkte und Umlaut-Striche, die man oft erst am Ende setzt, finden so auch ihre Zeile.
export function splitLines(strokes) {
  const lines = [];
  for (const s of strokes) {
    const cx = (s.box.minX + s.box.maxX) / 2;
    const cy = (s.box.minY + s.box.maxY) / 2;
    let best = null;
    let bestD = Infinity;
    for (const line of lines) {
      const f = line.fit;
      const base = f.y0 + f.slope * (cx - f.x0);
      const top = base - f.h * 2.2;
      const bottom = base + f.h * 0.9;
      const near = cx > f.minX - f.h * 6 && cx < f.maxX + f.h * 12;
      if (cy > top && cy < bottom && near) {
        const d = Math.abs(cy - (base - f.h * 0.5));
        if (d < bestD) {
          bestD = d;
          best = line;
        }
      }
    }
    if (!best) {
      best = { strokes: [] };
      lines.push(best);
    }
    best.strokes.push(s);
    best.fit = fitBaseline(best.strokes);
  }
  // Zeilen aus nur 1–2 Strichen (verirrter Punkt, Schnörkel am Zeilenanfang) an die nächste Zeile hängen
  for (const line of [...lines]) {
    if (line.strokes.length > 2 || lines.length === 1) continue;
    const box = line.strokes.reduce((a, s) => ({ minY: Math.min(a.minY, s.box.minY), maxY: Math.max(a.maxY, s.box.maxY), cx: (s.box.minX + s.box.maxX) / 2 }), { minY: Infinity, maxY: -Infinity, cx: 0 });
    const cy = (box.minY + box.maxY) / 2;
    let other = null;
    let bestD = Infinity;
    for (const l of lines) {
      if (l === line || l.strokes.length <= 2) continue;
      const base = l.fit.y0 + l.fit.slope * (box.cx - l.fit.x0);
      const d = Math.abs(cy - (base - l.fit.h * 0.5));
      if (d < bestD) {
        bestD = d;
        other = l;
      }
    }
    if (!other || bestD > other.fit.h * 1.8) continue;
    other.strokes.push(...line.strokes);
    other.fit = fitBaseline(other.strokes);
    lines.splice(lines.indexOf(line), 1);
  }
  // von oben nach unten (bei gleicher Höhe von links nach rechts)
  for (const line of lines) line.base = line.fit.y0 + line.fit.slope * (line.fit.minX - line.fit.x0);
  lines.sort((a, b) => (Math.abs(a.base - b.base) < Math.min(a.fit.h, b.fit.h) ? a.fit.minX - b.fit.minX : a.base - b.base));
  return lines;
}

// ---------- 2. Eine Zeile als Bild malen ----------
// Schräge Zeilen werden dabei geradegedreht – so liest die Erkennung viel besser.
function renderLine(line) {
  return renderPolys(linePolys(line), line.fit.h);
}
function linePolys(line) {
  const f = line.fit;
  const angle = Math.abs(Math.atan(f.slope)) < (25 * Math.PI) / 180 ? Math.atan(f.slope) : 0;
  const cos = Math.cos(-angle);
  const sin = Math.sin(-angle);
  const px = f.minX;
  const py = f.y0 + f.slope * (px - f.x0);
  const turn = ([x, y]) => [px + (x - px) * cos - (y - py) * sin, py + (x - px) * sin + (y - py) * cos];
  // in Schreib-Reihenfolge von links nach rechts ist egal – das Bild zählt
  return line.strokes.map((s) => s.points.map(turn));
}

// Striche (Punktlisten) schwarz auf weiß malen, Buchstabenhöhe ≈ TARGET_HEIGHT Pixel
function renderPolys(polys, letter) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of polys) {
    for (const [x, y] of pts) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  let k = TARGET_HEIGHT / Math.max(3, letter);
  k = Math.min(k, (MAX_SIDE - PAD * 2) / Math.max(1, maxX - minX), (MAX_SIDE - PAD * 2) / Math.max(1, maxY - minY));
  const w = Math.ceil((maxX - minX) * k + PAD * 2);
  const h = Math.ceil((maxY - minY) * k + PAD * 2);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#000000';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  // Gleichmäßige Strichdicke: dünne Kuli-Striche werden dicker, dicke Pinsel-Striche dünner
  ctx.lineWidth = Math.max(2.2, TARGET_HEIGHT * 0.1);
  const X = (x) => (x - minX) * k + PAD;
  const Y = (y) => (y - minY) * k + PAD;
  for (const pts of polys) {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.1, Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  return canvas;
}

// Vorschau für das Fenster: alles so, wie es auf der Seite steht
function renderPreview(strokes) {
  const hs = strokes.map((s) => s.box.maxY - s.box.minY).sort((a, b) => a - b);
  return renderPolys(strokes.map((s) => s.points), hs[hs.length >> 1] || 10);
}

// ---------- 3. Erkennen (Zeile für Zeile) ----------
// Zuerst mit unserem eigenen Handschrift-Modell (htr.js). Klappt das nicht (z. B. Datei
// fehlt), nehmen wir wie früher Tesseract.
let useTesseract = false;
export async function recognizeLines(lines, onLine, imgs = null) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    onLine?.(i, lines.length);
    if (!useTesseract) {
      try {
        const r = await recognizePolys(linePolys(lines[i]));
        out.push(cleanLine(r.text));
        if (imgs) imgs[i] = r.img;
        continue;
      } catch (err) {
        console.warn('Handschrift-Modell geht nicht, nehme Tesseract', err);
        useTesseract = true;
      }
    }
    const worker = await getWorker();
    const { data } = await worker.recognize(renderLine(lines[i]));
    out.push(cleanLine(data.text.replace(/\n+/g, ' ')));
  }
  return out;
}

function cleanLine(t) {
  return String(t || '')
    .replace(/[|]/g, 'I')
    .replace(/[“”„]/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,.!?;:])/g, '$1')
    .trim();
}

// Zeilen zu Absätzen/Blöcken zusammenfassen: großer Abstand nach unten oder ganz anderer
// Zeilenanfang = neuer Block (eigenes Textfeld)
function groupBlocks(lines) {
  const blocks = [];
  let cur = null;
  for (const line of lines) {
    const h = line.fit.h;
    const prev = cur?.lines[cur.lines.length - 1];
    const gap = prev ? line.base - prev.base : 0;
    const sameBlock = prev && gap > -h && gap < Math.max(prev.fit.h, h) * 4.2 && Math.abs(line.fit.minX - cur.minX) < h * 8;
    if (!sameBlock) {
      cur = { lines: [], minX: line.fit.minX };
      blocks.push(cur);
    }
    cur.lines.push(line);
    cur.minX = Math.min(cur.minX, line.fit.minX);
  }
  for (const b of blocks) {
    b.maxX = Math.max(...b.lines.map((l) => l.fit.maxX));
  }
  return blocks;
}

// ---------- 4. Textfelder bauen (sauber ausgerichtet) ----------
// Größe: so groß wie die Handschrift (auf die nächste übliche Schriftgröße gerundet),
// erste Grundlinie genau dort, wo du geschrieben hast; alle Zeilen linksbündig untereinander.
// Auf liniertem Papier (onLines): Zeilenabstand = Linienabstand, Grundlinien auf den Linien.
function buildItems({ blocks, texts, page, color, font, onLines, newZ }) {
  const r = onLines ? ruling(page.template) : null;
  const items = [];
  blocks.forEach((block, i) => {
    const lines = texts[i];
    if (!lines.length) return;
    let s;
    let y;
    const base = block.lines[0].base;
    if (r) {
      s = r.step / LINE_HEIGHT;
      const k = Math.max(0, Math.round((base - r.y0) / r.step));
      y = r.y0 + k * r.step - s * 1.0; // erste Grundlinie ≈ 1,0 × Schriftgröße unter der Oberkante
    } else {
      // Höhe der Großbuchstaben/Oberlängen ≈ 0,72 × Schriftgröße
      const caps = block.lines.map((l) => capHeight(l)).sort((a, b) => a - b);
      let units = caps[caps.length >> 1] / 0.72;
      // Mehrere Zeilen: Zeilenabstand wie in der Handschrift (nicht größer)
      if (block.lines.length > 1) {
        const gaps = block.lines.slice(1).map((l, k) => l.base - block.lines[k].base).sort((a, b) => a - b);
        units = Math.min(units, gaps[gaps.length >> 1] / LINE_HEIGHT);
      }
      s = nearestSize(units);
      y = base - s * 1.0;
    }
    const x = Math.max(0, block.minX);
    // bis zum rechten Rand: Zeilen werden nur umgebrochen, wenn sie wirklich nicht passen
    const w = Math.max(120, PAGE_WIDTH - 24 - x);
    const empty = createTextItem({ x, y, w, z: newZ(), style: { f: font, s, c: color } });
    // neues Objekt (das leere Feld hat sein Layout schon zwischengespeichert)
    const item = { ...empty, paras: lines.map((t) => ({ a: 'left', l: null, runs: [{ ...empty.paras[0].runs[0], t }] })), box: null };
    updateTextBox(item);
    items.push(item);
  });
  return items;
}

// Sieht das eher nach einer Rechnung aus? (viele Ziffern und Rechenzeichen, kaum Wörter)
function looksLikeMath(text) {
  const t = text.replace(/\s/g, '');
  if (!t) return false;
  const math = (t.match(/[0-9+\-=()/:x·²³]/g) || []).length;
  const words = (text.match(/\p{L}{3,}/gu) || []).length;
  return math / t.length > 0.55 && words <= 1;
}

// Lernt deine Schrift: Hast du im Fenster etwas verbessert, merkt sich die App die Zeilen
// (Bild + richtiger Text) und passt die Erkennung im Hintergrund an. Das geht nur, wenn die
// Zeilen noch zueinander passen (gleich viele Blöcke und Zeilen wie erkannt).
function learnFromDialog(blocks, imgs, text) {
  const parts = text.split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean));
  if (parts.length !== blocks.length || parts.some((p, i) => p.length !== blocks[i].texts.length)) return;
  const pairs = [];
  let n = 0;
  blocks.forEach((b, i) => b.texts.forEach((orig, j) => {
    const fixed = parts[i][j];
    pairs.push({ img: imgs[n++], text: fixed, changed: fixed !== orig });
  }));
  if (!pairs.some((p) => p.changed && p.img)) return;
  learnFrom(pairs)
    .then((r) => r && toast(`Gemerkt: Die Erkennung kennt deine Schrift jetzt besser (${r.lines} Zeilen gelernt)`))
    .catch((err) => console.warn('Lernen hat nicht geklappt', err));
}

// Wie hoch ragt die Schrift über die Grundlinie? (oberstes Zehntel weglassen: Ausreißer)
function capHeight(line) {
  const f = line.fit;
  const tops = line.strokes.map((s) => f.y0 + f.slope * ((s.box.minX + s.box.maxX) / 2 - f.x0) - s.box.minY).sort((a, b) => a - b);
  return Math.max(f.h * 0.8, tops[Math.floor(tops.length * 0.7)] || f.h);
}

function nearestSize(units) {
  const pt = units / PT;
  let best = SIZES_PT[0];
  for (const p of SIZES_PT) if (Math.abs(p - pt) < Math.abs(best - pt)) best = p;
  return Math.min(48, Math.max(10, best)) * PT;
}

// Häufigste Farbe der Striche (für das Textfeld)
function mainColor(strokes) {
  const count = new Map();
  for (const s of strokes) count.set(s.color, (count.get(s.color) || 0) + s.points.length);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000';
}

// ---------- Alles zusammen: Handschrift -> Fenster -> Textfeld ----------
// strokes: die Striche (nur Handschrift), page: ihre Seite.
// commit(changes): Änderung übernehmen (rückgängig machbar). newZ(): z-Nummer für Neues.
const FONT_CHOICES = ['sans', 'round', 'print', 'hand', 'school', 'serif'];
let lastFont = 'sans';
let lastOnLines = true;

export async function convertHandwriting({ page, strokes, commit, newZ }) {
  strokes = strokes.filter((s) => s.tool === 'pen' && !s.shape && s.box && s.points?.length);
  if (!strokes.length) {
    toast('Keine Handschrift gefunden – mit dem Lasso Handschrift auswählen');
    return;
  }

  // In Zeilen aufteilen und Zeile für Zeile erkennen (beim ersten Mal wird die Texterkennung geladen)
  const lines = splitLines(strokes);
  const progress = progressBox({ title: 'Handschrift zu Text', text: 'Handschrift wird gelesen …' });
  progressHook = (m) => {
    if (/load|initializ/.test(m.status)) progress.update('Texterkennung wird vorbereitet …', null);
  };
  let texts;
  const imgs = [];
  try {
    texts = await recognizeLines(lines, (i, n) => progress.update(`Handschrift wird gelesen … Zeile ${i + 1} von ${n}`, i / n), imgs);
  } catch (err) {
    console.error(err);
    progress.close();
    toast('Texterkennung konnte nicht geladen werden');
    return;
  } finally {
    progressHook = null;
  }
  if (progress.signal.cancelled) return;
  progress.close();
  // Zeilen ohne erkannten Text weglassen
  const kept = lines.filter((_, i) => texts[i]);
  const keptImgs = lines.map((_, i) => imgs[i]).filter((_, i) => texts[i]);
  texts = texts.filter(Boolean);
  if (!kept.length) {
    toast('Leider keinen Text erkannt – deutlicher (in Druckbuchstaben) schreiben hilft');
    return;
  }
  const blocks = groupBlocks(kept);
  let n = 0;
  for (const b of blocks) b.texts = b.lines.map(() => texts[n++]);

  const hasLines = Boolean(ruling(page.template));
  const choice = await openDialog({
    wide: true,
    enter: false,
    html: `
      <div class="dlg-title">Handschrift zu Text</div>
      <div class="cv-ink"></div>
      <div class="cv-mode-row">
        <label class="cv-label" for="cv-text">Erkannter Text – Fehler kannst du hier verbessern</label>
        <div class="op-seg cv-mode"><button data-mode="text" class="on">Text</button><button data-mode="math">Mathe</button></div>
      </div>
      <textarea id="cv-text" class="cv-text" spellcheck="true" lang="de">${esc(blocks.map((b) => b.texts.join('\n')).join('\n\n'))}</textarea>
      <div class="cv-learn" hidden><span class="cv-learn-txt"></span> <button class="cv-learn-forget" data-forget>Vergessen</button></div>
      <div class="cv-label">Schrift</div>
      <div class="cv-fonts">${FONT_CHOICES.map((id) => {
        const f = FONTS.find((x) => x.id === id);
        return `<button class="cv-font${id === lastFont ? ' on' : ''}" data-font="${id}" style="font-family:${esc(fontCss(id))}">${esc(f.name)}</button>`;
      }).join('')}</div>
      ${hasLines ? `<label class="switch-row cv-switch"><span>Genau auf die Linien setzen</span><input type="checkbox" class="switch" data-lines ${lastOnLines ? 'checked' : ''} /></label>` : ''}
      <div class="dlg-btns">
        <button class="dlg-btn" data-dlg="cancel">Abbrechen</button>
        <button class="dlg-btn" data-act="copy">Nur kopieren</button>
        <button class="dlg-btn primary" data-act="convert">In Text umwandeln</button>
      </div>`,
    onReady(card, close) {
      // Vorschau der Handschrift (so, wie die Erkennung sie sieht)
      const prev = renderPreview(strokes);
      prev.className = 'cv-preview';
      card.querySelector('.cv-ink').appendChild(prev);
      // Lernt deine Schrift: Hinweis, wie viel schon gelernt ist
      const learn = card.querySelector('.cv-learn');
      const showLearn = (n) => {
        learn.hidden = !keptImgs.some(Boolean);
        learn.querySelector('.cv-learn-txt').textContent = n
          ? `Lernt deine Schrift: ${n} ${n === 1 ? 'Zeile' : 'Zeilen'} gelernt. Verbesserst du hier etwas, wird die Erkennung für dich besser.`
          : 'Lernt deine Schrift: Verbesserst du hier etwas, merkt sich die App das und erkennt deine Schrift danach besser.';
        learn.querySelector('[data-forget]').hidden = !n;
      };
      learnedLines().then(showLearn, () => {});
      // Text oder Mathe: Mathe liest Brüche, Hochzahlen und Wurzeln und schreibt sie schön (x², ¾, √2)
      const area = card.querySelector('.cv-text');
      const asText = area.value;
      let mathText = null;
      const setMode = async (mode) => {
        for (const b of card.querySelectorAll('[data-mode]')) b.classList.toggle('on', b.dataset.mode === mode);
        card.dataset.mode = mode;
        if (mode === 'math') {
          if (mathText == null) {
            await prepareMath();
            mathText = recognizeMath(strokes).rows.map((r) => r.pretty).filter(Boolean).join('\n');
          }
          area.value = mathText;
        } else area.value = asText;
      };
      card.querySelector('.cv-mode').addEventListener('click', (e) => {
        const b = e.target.closest('[data-mode]');
        if (b && card.dataset.mode !== b.dataset.mode) setMode(b.dataset.mode);
      });
      card.dataset.mode = 'text';
      if (looksLikeMath(asText)) setMode('math');
      learn.querySelector('[data-forget]').addEventListener('click', async () => {
        await forgetLearned();
        showLearn(0);
        toast('Gelernte Schrift vergessen');
      });
      card.addEventListener('click', (e) => {
        const f = e.target.closest('[data-font]');
        if (f) {
          lastFont = f.dataset.font;
          for (const b of card.querySelectorAll('[data-font]')) b.classList.toggle('on', b === f);
        }
        const act = e.target.closest('[data-act]')?.dataset.act;
        if (act) {
          const lines = card.querySelector('[data-lines]');
          if (lines) lastOnLines = lines.checked;
          close({ act, text: card.querySelector('.cv-text').value, math: card.dataset.mode === 'math' });
        }
      });
    },
    result: () => undefined,
  });
  if (!choice) return;

  const text = choice.text.replace(/\r/g, '').trim();
  if (!text) return;
  if (!choice.math) learnFromDialog(blocks, keptImgs, text);
  if (choice.act === 'copy') {
    try {
      await navigator.clipboard.writeText(text);
      toast('Text kopiert');
    } catch {
      toast('Kopieren hat nicht geklappt');
    }
    return;
  }

  // Verbesserten Text wieder auf die Blöcke verteilen (Leerzeile = neuer Block).
  // Passt die Anzahl nicht mehr, wird alles ein einziges Textfeld.
  let parts = text.split(/\n\s*\n/).map((p) => p.split('\n').map((l) => l.trim()).filter(Boolean));
  let useBlocks = blocks;
  if (parts.length !== blocks.length) {
    useBlocks = [{ lines: blocks.flatMap((b) => b.lines), minX: Math.min(...blocks.map((b) => b.minX)), maxX: Math.max(...blocks.map((b) => b.maxX)) }];
    parts = [parts.flat()];
  }
  const items = buildItems({
    blocks: useBlocks,
    texts: parts,
    page,
    color: mainColor(strokes),
    font: lastFont,
    onLines: hasLines && lastOnLines,
    newZ,
  });
  if (!items.length) return;
  commit([{ page, added: items, removed: strokes }]);
  return items;
}
