// homework.js – Hausaufgaben-Marker
//
// So geht's: In der Notiz "Hausaufgabe markieren" wählen und mit dem Stift einen Rahmen um die
// Aufgabe ziehen (z. B. "S. 54 Nr. 3a–c"). Die App
//   - liest den Text im Rahmen (Handschrift-Erkennung, offline),
//   - erkennt das Fach am Ordner der Notiz (Ordner "Mathe" -> Fach Mathe),
//   - schlägt als Abgabe die NÄCHSTE STUNDE in diesem Fach vor (aus dem Stundenplan, sobald es
//     einen gibt – sonst den nächsten Schultag),
//   - und malt einen farbigen Rahmen mit Fähnchen ("HA · Mo 30.11.") an die Stelle.
// Alle Hausaufgaben aus allen Notizen stehen auf der Startseite unter "Hausaufgaben":
// abhaken, Datum ändern, antippen = genau zu der Stelle in der Notiz springen.
//
// Gespeichert wird in der Notiz selbst: note.homework = [{ id, pageId, box: [x0, y0, x1, y1],
//   text, due: 'JJJJ-MM-TT', done, created, doneAt }]

import { openDialog, esc } from './dialog.js';
import { uid } from './store.js';

export const HW_ICON =
  '<svg viewBox="0 0 24 24"><path d="M6 3.5h9l3.5 3.5v13.5H6z"/><path d="M14.5 3.5V7.5h4"/><path d="m9 13.5 2 2 4-4.5"/></svg>';
export const HW_COLOR = '#f08c00';
const DONE_COLOR = '#2b8a3e';

// ---------- Datum ----------
const pad = (n) => String(n).padStart(2, '0');
export const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export function parseDay(key) {
  const [y, m, d] = String(key || '').split('-').map(Number);
  return y && m && d ? new Date(y, m - 1, d) : null;
}
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const WEEKDAY = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// Wie viele Tage bis zum Abgabetag? (negativ = überfällig)
export function daysUntil(key, now = new Date()) {
  const d = parseDay(key);
  if (!d) return Infinity;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((d - today) / 86400000);
}

// "heute", "morgen", "Mo 30.11." …
export function dueLabel(key, { long = false } = {}) {
  const d = parseDay(key);
  if (!d) return 'ohne Datum';
  const n = daysUntil(key);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  const short = `${WEEKDAY[d.getDay()]} ${pad(d.getDate())}.${pad(d.getMonth() + 1)}.`;
  if (n < 0) return long ? `seit ${short}` : short;
  return short;
}

// Nächster Schultag (Mo–Fr) nach "from"
export function nextSchoolDay(from = new Date()) {
  let d = addDays(from, 1);
  while (d.getDay() === 0 || d.getDay() === 6) d = addDays(d, 1);
  return d;
}

// Der Stundenplan (timetable.js) meldet sich hier an: (fach, ab) -> Date der nächsten Stunde | null
let lessonFinder = null;
export function setLessonFinder(fn) {
  lessonFinder = fn;
}

// Vorschlag für den Abgabetag: nächste Stunde in diesem Fach, sonst nächster Schultag
export function suggestDue(subject, from = new Date()) {
  const next = subject && lessonFinder ? lessonFinder(subject, from) : null;
  if (next) return { due: dayKey(next), why: `nächste ${subject}-Stunde` };
  return { due: dayKey(nextSchoolDay(from)), why: 'nächster Schultag' };
}

// ---------- Daten ----------
export function createHomework({ pageId, box, text, due }) {
  return { id: uid(), pageId, box: box.map((v) => Math.round(v * 10) / 10), text: text || '', due, done: false, created: Date.now() };
}

// Alle Hausaufgaben aus allen Notizen (für die Startseite), mit Notiz dazu
export function collectHomework(notes) {
  const out = [];
  for (const note of notes) {
    if (note.deletedAt || !Array.isArray(note.homework)) continue;
    for (const hw of note.homework) out.push({ hw, note });
  }
  return out;
}

// Gruppen für die Liste: Überfällig, Heute, Morgen, Diese Woche, Später, Erledigt
export function groupHomework(items, now = new Date()) {
  const groups = [
    { id: 'late', title: 'Überfällig', items: [] },
    { id: 'today', title: 'Heute', items: [] },
    { id: 'tomorrow', title: 'Morgen', items: [] },
    { id: 'week', title: 'Nächste Tage', items: [] },
    { id: 'later', title: 'Später', items: [] },
    { id: 'done', title: 'Erledigt', items: [] },
  ];
  const by = Object.fromEntries(groups.map((g) => [g.id, g]));
  for (const it of items) {
    if (it.hw.done) {
      by.done.items.push(it);
      continue;
    }
    const n = daysUntil(it.hw.due, now);
    by[n < 0 ? 'late' : n === 0 ? 'today' : n === 1 ? 'tomorrow' : n <= 7 ? 'week' : 'later'].items.push(it);
  }
  for (const g of groups) {
    if (g.id === 'done') g.items.sort((a, b) => (b.hw.doneAt || 0) - (a.hw.doneAt || 0));
    else g.items.sort((a, b) => (a.hw.due || '').localeCompare(b.hw.due || '') || a.hw.created - b.hw.created);
  }
  by.done.items = by.done.items.slice(0, 15); // ältere Erledigte nicht ewig anzeigen
  return groups.filter((g) => g.items.length);
}

// ---------- Fenster: Hausaufgabe eintragen / bearbeiten ----------
// Antwort: { text, due } | { remove: true } | null (abgebrochen)
export function editHomework({ text = '', due, subject = '', why = '', isNew = true }) {
  let picked = due;
  const today = new Date();
  const chips = [];
  if (subject && lessonFinder) {
    const s = suggestDue(subject, today);
    if (s.why.startsWith('nächste')) chips.push({ key: s.due, label: `Nächste Stunde (${dueLabel(s.due)})` });
  }
  chips.push({ key: dayKey(addDays(today, 1)), label: `Morgen` });
  chips.push({ key: dayKey(nextSchoolDay(addDays(today, 1))), label: dueLabel(dayKey(nextSchoolDay(addDays(today, 1)))) });
  chips.push({ key: dayKey(addDays(today, 7)), label: 'in 1 Woche' });
  // doppelte Tage weglassen
  const seen = new Set();
  const list = chips.filter((c) => (seen.has(c.key) ? false : seen.add(c.key)));

  return openDialog({
    enter: false,
    html: `
      <div class="dlg-title">${isNew ? 'Hausaufgabe eintragen' : 'Hausaufgabe'}${subject ? ` <span class="hw-subj">${esc(subject)}</span>` : ''}</div>
      <textarea class="dlg-input hw-text" rows="3" maxlength="300" placeholder="Was ist zu tun? (z. B. S. 54 Nr. 3a–c)">${esc(text)}</textarea>
      <div class="hw-due-title">Bis wann?${why ? ` <small>Vorschlag: ${esc(why)}</small>` : ''}</div>
      <div class="hw-chips">
        ${list.map((c) => `<button class="hw-chip${c.key === picked ? ' on' : ''}" data-due="${c.key}">${esc(c.label)}</button>`).join('')}
        <label class="hw-chip hw-date"><input type="date" value="${esc(picked)}" /></label>
      </div>
      <div class="dlg-btns">
        ${isNew ? '' : '<button class="dlg-btn danger-text" data-act="remove">Entfernen</button>'}
        <button class="dlg-btn" data-dlg="cancel">Abbrechen</button>
        <button class="dlg-btn primary" data-dlg="ok">${isNew ? 'Eintragen' : 'Speichern'}</button>
      </div>`,
    onReady(card, close) {
      const date = card.querySelector('input[type=date]');
      const mark = () => {
        for (const b of card.querySelectorAll('[data-due]')) b.classList.toggle('on', b.dataset.due === picked);
        date.value = picked;
        card.querySelector('.hw-date').classList.toggle('on', !list.some((c) => c.key === picked));
      };
      mark();
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-due]');
        if (b) {
          picked = b.dataset.due;
          mark();
        }
        if (e.target.closest('[data-act=remove]')) close({ remove: true });
      });
      date.addEventListener('change', () => {
        if (date.value) picked = date.value;
        mark();
      });
      if (!text) setTimeout(() => card.querySelector('textarea').focus(), 60);
    },
    result(card) {
      return { text: card.querySelector('textarea').value.trim(), due: picked };
    },
  });
}

// ---------- Auf der Seite malen ----------
// Rahmen um die Aufgabe + Fähnchen oben rechts: "HA · morgen" (erledigt: grün mit Haken)
// ctx ist schon auf die Seite eingestellt (Seiten-Einheiten), k = echte Pixel pro Seiten-Einheit
export function drawHomework(ctx, list, pageId, k) {
  for (const hw of list) {
    if (hw.pageId !== pageId) continue;
    const [x0, y0, x1, y1] = hw.box;
    const color = hw.done ? DONE_COLOR : HW_COLOR;
    const late = !hw.done && daysUntil(hw.due) < 0;
    ctx.save();
    // Rahmen
    ctx.globalAlpha = hw.done ? 0.35 : 0.75;
    ctx.strokeStyle = late ? '#e03131' : color;
    ctx.lineWidth = 1.6 / Math.max(k, 0.3) + 0.6;
    ctx.setLineDash([6, 4]);
    roundRect(ctx, x0, y0, x1 - x0, y1 - y0, 6);
    ctx.stroke();
    ctx.setLineDash([]);
    // leicht gefärbt
    ctx.globalAlpha = hw.done ? 0.04 : 0.07;
    ctx.fillStyle = color;
    ctx.fill();
    // Fähnchen
    const f = badgeRect(hw);
    ctx.globalAlpha = hw.done ? 0.7 : 1;
    ctx.fillStyle = late ? '#e03131' : color;
    roundRect(ctx, f.x, f.y, f.w, f.h, f.h / 2);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `600 ${f.h * 0.62}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(badgeText(hw), f.x + f.h * 0.45, f.y + f.h / 2 + 0.5);
    ctx.restore();
  }
}

function badgeText(hw) {
  return hw.done ? '✓ HA erledigt' : `HA · ${dueLabel(hw.due)}`;
}

// Wo liegt das Fähnchen? (Seiten-Einheiten) – oben rechts am Rahmen, ragt etwas heraus
export function badgeRect(hw) {
  const [, y0, x1] = hw.box;
  const h = 17;
  const w = 12 + badgeText(hw).length * h * 0.36;
  return { x: Math.max(0, x1 - w + 6), y: Math.max(0, y0 - h * 0.75), w, h };
}

// Liegt (x, y) (Seiten-Einheiten) auf einem Fähnchen? -> die Hausaufgabe
export function hitHomework(list, pageId, x, y) {
  for (const hw of list || []) {
    if (hw.pageId !== pageId) continue;
    const f = badgeRect(hw);
    if (x >= f.x - 4 && x <= f.x + f.w + 4 && y >= f.y - 4 && y <= f.y + f.h + 4) return hw;
  }
  return null;
}

// Bereich (Seiten-Einheiten), den eine Hausaufgabe samt Fähnchen bedeckt (zum Neumalen)
export function homeworkArea(hw) {
  const f = badgeRect(hw);
  const [x0, y0, x1, y1] = hw.box;
  return { minX: Math.min(x0, f.x) - 4, minY: Math.min(y0, f.y) - 4, maxX: Math.max(x1, f.x + f.w) + 4, maxY: y1 + 4 };
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
