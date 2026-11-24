// searchindex.js – Suche in allen Notizen, auch in der Handschrift
//
// Damit die Suche schnell ist, liest die App deine Notizen schon VORHER (im Hintergrund,
// während der Startbildschirm offen ist) und merkt sich den Text in jeder Notiz:
//   - Textfelder: ihr Text
//   - Handschrift: wird mit der Texterkennung (Tesseract, offline, siehe convert.js) gelesen
//
// Gespeichert wird das in der Notiz selbst (note.index):
//   { v, at, pages: { [seitenId]: { sig, lines: [{ t: 'Text', b: [x0, y0, x1, y1], k: 'ink' | 'text' }] } } }
// sig ist ein "Fingerabdruck" der Seite: Ändert sich nichts, wird die Seite nicht nochmal gelesen.
//
// Gesucht wird dann nur noch in diesem Text – fehlertolerant, denn die Texterkennung liest
// Handschrift nicht immer perfekt (ein Buchstabe Unterschied wird bei längeren Wörtern verziehen).

import * as store from './store.js';
import { splitLines, recognizeLines } from './convert.js';

const VERSION = 1;

// ---------- Fingerabdruck einer Seite ----------
function signature(page) {
  let h = page.strokes.length;
  for (const s of page.strokes) {
    const b = s.box;
    h = (h * 31 + (s.z || 0)) % 1e9;
    if (b) h = (h * 31 + Math.round(b.minX + b.maxY * 3 + b.maxX * 7 + b.minY * 13)) % 1e9;
    if (s.tool === 'text') h = (h * 31 + plain(s).length) % 1e9;
  }
  return String(h);
}

// Reiner Text eines Textfelds (Absätze als Zeilen)
export function plain(item) {
  return (item.paras || []).map((p) => p.runs.map((r) => r.t).join('')).join('\n');
}

// Braucht diese Notiz ein (neues) Lesen?
export function needsIndex(note) {
  if (note.deletedAt) return false;
  const ix = note.index;
  return !ix || ix.v !== VERSION || (note.updated || 0) > (ix.at || 0);
}

// Eine Notiz lesen. stop() -> true bricht ab (z. B. weil eine Notiz geöffnet wurde).
// Gibt das neue Verzeichnis zurück (oder null, wenn abgebrochen).
export async function indexNote(note, { stop = () => false, onProgress } = {}) {
  const startedAt = Date.now();
  const old = note.index?.v === VERSION ? note.index.pages || {} : {};
  const packed = await store.getPages(note.pageIds || []);
  const pages = {};
  for (const d of packed) {
    if (stop()) return null;
    const page = store.unpackPage(d);
    const sig = signature(page);
    if (old[page.id]?.sig === sig) {
      pages[page.id] = old[page.id];
      continue;
    }
    const lines = [];
    // Textfelder
    for (const s of page.strokes) {
      if (s.tool !== 'text' || !s.box) continue;
      const t = plain(s).replace(/\s+/g, ' ').trim();
      if (t) lines.push({ t, b: box(s.box), k: 'text' });
    }
    // Handschrift: in Zeilen teilen und lesen
    const ink = page.strokes.filter((s) => s.tool === 'pen' && !s.shape && s.box && s.points?.length);
    if (ink.length) {
      const inkLines = splitLines(ink).filter((l) => l.strokes.length >= 2 || l.fit.maxX - l.fit.minX > l.fit.h * 1.5);
      onProgress?.();
      // Zeile für Zeile, damit wir zwischendurch aufhören können
      for (const line of inkLines) {
        if (stop()) return null;
        const [text] = await recognizeLines([line]);
        if (stop()) return null;
        if (text && /[\p{L}\p{N}]/u.test(text)) {
          const b = line.strokes.reduce(
            (a, s) => [Math.min(a[0], s.box.minX), Math.min(a[1], s.box.minY), Math.max(a[2], s.box.maxX), Math.max(a[3], s.box.maxY)],
            [Infinity, Infinity, -Infinity, -Infinity]
          );
          lines.push({ t: text, b: b.map(Math.round), k: 'ink' });
        }
      }
    }
    pages[page.id] = { sig, lines };
  }
  return { v: VERSION, at: startedAt, pages };
}

const box = (b) => [Math.round(b.minX), Math.round(b.minY), Math.round(b.maxX), Math.round(b.maxY)];

// ---------- Suchen ----------

// Kleinbuchstaben, ß -> ss, Akzente weg (Umlaute bleiben erkennbar: ä -> a passt auch)
export function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

// Wie viele Buchstaben muss man ändern, um a in b zu verwandeln? (Levenshtein, früh abbrechen)
function editDistance(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

// Passt das Suchwort q (schon normalisiert) zu diesem Text? Ergebnis: Trefferstellen [[start, ende]] oder null
export function matchText(text, words, { fuzzy = false } = {}) {
  const n = norm(text);
  const spans = [];
  for (const w of words) {
    let i = n.indexOf(w);
    if (i >= 0) {
      spans.push([i, i + w.length]);
      continue;
    }
    if (!fuzzy || w.length < 4) return null;
    // fehlertolerant: ein Wort im Text, das fast gleich ist
    const allowed = w.length >= 8 ? 2 : 1;
    let found = null;
    const re = /[\p{L}\p{N}]+/gu;
    let m;
    while ((m = re.exec(n))) {
      const word = m[0];
      // auch Wortanfänge prüfen ("Photosynth" findet "Photosynthese")
      const cand = word.length > w.length + allowed ? word.slice(0, w.length) : word;
      if (editDistance(w, cand, allowed) <= allowed) {
        found = [m.index, m.index + cand.length];
        break;
      }
    }
    if (!found) return null;
    spans.push(found);
  }
  return spans;
}

export function queryWords(q) {
  return norm(q).split(/\s+/).filter(Boolean);
}

// Alle Treffer in einer Notiz: [{ pageIndex, pageId, line, spans }]
export function searchNote(note, words) {
  const hits = [];
  const ix = note.index;
  if (!ix?.pages) return hits;
  (note.pageIds || []).forEach((pid, pageIndex) => {
    for (const line of ix.pages[pid]?.lines || []) {
      const spans = matchText(line.t, words, { fuzzy: line.k === 'ink' });
      if (spans) hits.push({ pageIndex, pageId: pid, line, spans });
    }
  });
  return hits;
}
