// today.js – Startseite "Heute": Stundenplan, was gerade läuft, Hausaufgaben und Termine
//
//   ┌ Kopf: Datum · A/B-Woche, "Guten Abend, Robin", Jetzt-/Als-Nächstes-Karte │ 3 Kacheln ┐
//   ├ Tagesplan wie in EduPage (‹ Freitag 04.12. ›): Stunden mit Raum, Lehrkraft, Zeit,  │
//   │   fälligen Hausaufgaben und Tests – Stunde antippen = Stunden-Blatt (eintragen!)   │
//   ├ Hausaufgaben (Offen / Erledigt, nach Fälligkeit gruppiert) │ Termine (Countdown)   │
//   └ Wochenplan Mo–Fr mit A/B-Umschalter                                                 ┘
//
// Selbst eingetragene Hausaufgaben/Termine (ohne Notiz) stehen in localStorage (federleicht.tasks):
//   [{ id, kind: 'hw' | 'test' | 'exam' | 'event', subject: 'ma', text, details, due: 'JJJJ-MM-TT',
//      period (Stunde, optional), given (Tag, an dem aufgegeben, optional), done, doneAt, created }]
// Hausaufgaben aus Notizen stehen in der Notiz (note.homework, siehe homework.js).
// Was angezeigt wird, steht in den Einstellungen (theme.js, settings.js).

import * as tt from './timetable.js';
import { collectHomework, daysUntil, dayKey, parseDay, HW_ICON } from './homework.js';
import { openDialog, toast, esc } from './dialog.js';
import { uid } from './store.js';
import { getPrefs } from './theme.js';

const TASKS_KEY = 'federleicht.tasks';
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  test: '<svg viewBox="0 0 24 24"><path d="M9 4.5h6M9.5 4.5v1.8a1 1 0 0 1-1 1H6.5v13h11v-13h-2a1 1 0 0 1-1-1V4.5"/><path d="m9 13 2 2 4-4.5"/></svg>',
  exam: '<svg viewBox="0 0 24 24"><path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M7 10.2v4.3c0 1.4 2.2 2.8 5 2.8s5-1.4 5-2.8v-4.3M20.5 8v5"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  room: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  person: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9.5 5.5 6.5 6.5-6.5 6.5"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M6 3.5h8.5l3.5 3.5v13.5H6z"/><path d="M14 3.5V7.5h4M9 12h6M9 15.5h4"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M15.5 4.5a2.1 2.1 0 0 1 3 3L8.5 17.5 4 19l1.5-4.5z"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0V20a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
export const KIND = {
  hw: { label: 'Hausaufgabe', short: 'HA', icon: HW_ICON, color: '#f08c00' },
  test: { label: 'Test', short: 'Test', icon: ICON.test, color: '#1c7ed6' },
  exam: { label: 'Klausur', short: 'Klausur', icon: ICON.exam, color: '#e03131' },
  event: { label: 'Termin', short: 'Termin', icon: ICON.cal, color: '#7048e8' },
};
const DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};
// "Fr, 27.11."
const fmtDay = (d) => `${DAYS_SHORT[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
// "heute", "morgen", "Fr, 27.11."
function whenText(key) {
  const d = parseDay(key);
  if (!d) return 'ohne Datum';
  const n = daysUntil(key);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n === -1) return 'gestern';
  if (n > 1 && n < 7) return DAYS_LONG[d.getDay()];
  return fmtDay(d);
}

// ---------- Selbst eingetragene Aufgaben/Termine ----------
export function loadTasks() {
  try {
    const list = JSON.parse(localStorage.getItem(TASKS_KEY));
    return seed(Array.isArray(list) ? list : []);
  } catch {
    return [];
  }
}
function saveTasks(list) {
  try {
    localStorage.setItem(TASKS_KEY, JSON.stringify(list));
  } catch {
    /* egal */
  }
}
// Beim allerersten Mal: die Musik-Klausur aus Robins EduPage (Fr 04.12., 3./4. Stunde) schon eintragen
function seed(list) {
  try {
    if (localStorage.getItem('federleicht.tasksSeed')) return list;
    localStorage.setItem('federleicht.tasksSeed', '1');
  } catch {
    return list;
  }
  if (daysUntil('2026-12-04') >= 0) {
    list.push({ id: uid(), kind: 'exam', subject: 'mu', text: 'Klausur Musik', details: 'Schularbeit: Klausur Q 1', due: '2026-12-04', period: 3, done: false, created: Date.now() });
    saveTasks(list);
  }
  return list;
}

// api: { openNote(id, focus), openFolder(id), createFolder(name, color) -> folder, saveNoteMeta(note), refresh(), openSettings() }
export function setupToday(api) {
  let showWeek = null; // im Wochenplan angezeigte Woche ('A' | 'B'), null = aktuelle
  let pickedDay = null; // im Tagesplan gezeigter Tag ('JJJJ-MM-TT'), null = automatisch
  let hwTab = 'open';
  let ticker = 0;

  // Ordner, der zu einem Fach gehört
  const folderFor = (subjectId, folders) => folders.find((f) => tt.subjectIdFor(f.name) === subjectId) || null;
  // Fach einer Hausaufgabe aus einer Notiz (über den Ordnernamen)
  const subjectOfHw = (hw, note, folders) => tt.subjectIdFor(hw.subject) || tt.subjectIdFor(folders.find((f) => f.id === note.folderId)?.name);
  const subjectsInPlan = () => {
    const data = tt.timetable();
    return Object.entries(data.subjects).filter(([id]) => data.lessons.some((l) => l.subject === id));
  };

  // Alles einsammeln, was die Startseite braucht
  function gather(notes, folders) {
    const fromNotes = collectHomework(notes).map(({ hw, note }) => ({ hw, note, subject: subjectOfHw(hw, note, folders) }));
    const tasks = loadTasks();
    const own = tasks.filter((t) => t.kind === 'hw').map((t) => ({ hw: t, own: true, subject: t.subject }));
    const all = [...fromNotes, ...own];
    const open = all.filter((x) => !x.hw.done).sort((a, b) => (a.hw.due || '9').localeCompare(b.hw.due || '9') || (a.hw.created || 0) - (b.hw.created || 0));
    const done = all.filter((x) => x.hw.done).sort((a, b) => (b.hw.doneAt || 0) - (a.hw.doneAt || 0)).slice(0, 25);
    const events = tasks
      .filter((t) => t.kind !== 'hw' && daysUntil(t.due) >= 0)
      .sort((a, b) => a.due.localeCompare(b.due) || (a.period || 0) - (b.period || 0));
    return { all, open, done, events, tasks };
  }

  // Erster Tag mit Unterricht ab "from" in Richtung dir (+1/-1), höchstens 3 Wochen weit
  function schoolDay(from, dir) {
    for (let i = 1; i < 21; i++) {
      const d = addDays(from, dir * i);
      if (tt.lessonsOn(d).length) return d;
    }
    return null;
  }
  // Welcher Tag kommt automatisch? Heute, solange noch Unterricht ist – sonst der nächste Schultag
  function autoDay(now) {
    const { current, next, today } = tt.nowAndNext(now);
    if (today.length && (current || next)) return now;
    return schoolDay(now, 1) || now;
  }

  function html({ notes, folders }) {
    const P = getPrefs();
    const S = P.sections;
    const now = new Date();
    const g = gather(notes, folders);
    const hero = heroHtml(now, g, P);
    const day = S.day ? dayHtml(now, g, P) : '';
    const hw = S.hw ? hwHtml(g, P) : '';
    const ev = S.events ? eventsHtml(g) : '';
    const side = hw || ev ? `<div class="td-side">${hw}${ev}</div>` : '';
    const main = day || side ? `<div class="td-main${day && side ? '' : ' single'}">${day}${side}</div>` : '';
    return `<div class="td">${hero}${main}${S.week ? weekGrid(now) : ''}</div>`;
  }

  // ---------- Kopf ----------
  function heroHtml(now, g, P) {
    const week = tt.weekOf(now);
    const h = now.getHours();
    const hello = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
    const name = (P.name || '').trim();
    const { current, next, today } = tt.nowAndNext(now);
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const soon = g.open.filter((x) => daysUntil(x.hw.due) <= 1).length;
    const late = g.open.filter((x) => daysUntil(x.hw.due) < 0).length;
    const exam = g.events.find((e) => e.kind === 'exam' || e.kind === 'test');
    const doneToday = today.filter((l) => toMin(tt.lessonTime(l).to) <= now.getHours() * 60 + now.getMinutes()).length;
    const pct = today.length ? doneToday / today.length : 0;
    const ring = `<svg class="td-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="on" cx="18" cy="18" r="15.5" stroke-dasharray="${(pct * 97.4).toFixed(1)} 97.4"/></svg>`;
    const examTile = exam
      ? (() => {
          const n = daysUntil(exam.due);
          const s = tt.timetable().subjects[exam.subject];
          return `<button class="td-stat" data-td="task-open" data-id="${exam.id}" style="--k:${KIND[exam.kind].color}">
            <span class="td-stat-ic">${KIND[exam.kind].icon}</span>
            <b>${n === 0 ? 'Heute' : n === 1 ? 'Morgen' : `${n} Tage`}</b>
            <span>bis ${esc(KIND[exam.kind].label)}${s ? ` ${esc(s.name)}` : ''}</span>
            <small>${fmtDay(parseDay(exam.due))}${exam.period ? ` · ${exam.period}. Stunde` : ''}${exam.text && exam.text !== `${KIND[exam.kind].label} ${s?.name}` ? ` · ${esc(exam.text)}` : ''}</small></button>`;
        })()
      : `<div class="td-stat calm" style="--k:#2f9e44"><span class="td-stat-ic">${ICON.exam}</span><b>Frei</b><span>keine Tests eingetragen</span><small>Mit „Eintragen“ hinzufügen</small></div>`;
    return `<section class="td-hero">
      <div class="td-hero-main">
        <div class="td-kicker">${DAYS_LONG[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}
          ${week ? `<button class="td-week" data-td="switch-week" title="A/B-Woche umstellen (z. B. nach den Ferien)">${week}-Woche ${ICON.swap}</button>` : ''}</div>
        <h2 class="td-hello">${hello}${name ? `, ${esc(name)}` : ''}</h2>
        ${P.sections.now ? nowCard(current, next, today, weekend) : ''}
        <div class="td-hero-btns">
          <button class="td-primary" data-td="add" data-kind="hw">${ICON.plus}<span>Eintragen</span></button>
          <button class="td-ghost" data-td="settings" aria-label="Einstellungen" title="Einstellungen">${ICON.gear}</button>
        </div>
      </div>
      <div class="td-stats">
        <button class="td-stat" data-td="tab" data-tab="open" style="--k:${late ? '#e03131' : '#f08c00'}">
          <span class="td-stat-ic">${HW_ICON}</span>
          <b>${g.open.length}</b><span>${g.open.length === 1 ? 'Hausaufgabe offen' : 'Hausaufgaben offen'}</span>
          <small>${late ? `${late} überfällig` : soon ? `${soon} bis morgen` : g.open.length ? 'nichts Dringendes' : 'alles erledigt 🎉'}</small></button>
        ${examTile}
        <div class="td-stat ring" style="--k:var(--accent)">
          ${ring}
          <b>${today.length ? `${doneToday}/${today.length}` : '–'}</b><span>${today.length ? 'Stunden geschafft' : weekend ? 'Wochenende' : 'kein Unterricht'}</span>
          <small>${today.length ? (doneToday === today.length ? 'Feierabend!' : `bis ${tt.lessonTime(today.at(-1)).to} Uhr`) : 'Zeit für dich'}</small></div>
      </div>
    </section>`;
  }

  // Karte "Jetzt" / "Als Nächstes"
  function nowCard(current, next, today, weekend) {
    const fmt = (l) => {
      const s = tt.subjectOf(l);
      return `<b>${esc(s?.name || l.subject)}</b>${l.room ? ` <span class="td-now-room">${ICON.room}${esc(l.room)}</span>` : ''}`;
    };
    if (current) {
      const t = tt.lessonTime(current);
      const now = new Date();
      const start = toMin(t.from);
      const end = toMin(t.to);
      const min = now.getHours() * 60 + now.getMinutes();
      const left = Math.max(0, end - min);
      const pct = Math.round(((min - start) / Math.max(1, end - start)) * 100);
      const s = tt.subjectOf(current);
      return `<button class="td-now" data-td="lesson" data-day="${dayKey(now)}" data-i="${tt.timetable().lessons.indexOf(current)}" style="--c:${s?.color || 'var(--accent)'}">
          <span class="td-now-label">Jetzt · ${tt.periodLabel(current)} Stunde</span>
          <span class="td-now-text">${fmt(current)}<span class="td-now-left">noch ${left} min</span></span>
          ${next ? `<span class="td-now-next">Danach ${esc(tt.subjectOf(next)?.name || next.subject)} um ${tt.lessonTime(next).from}${next.room ? ` in ${esc(next.room)}` : ''}</span>` : '<span class="td-now-next">Danach: Schluss für heute</span>'}
          <span class="td-bar"><i style="width:${pct}%"></i></span>
        </button>`;
    }
    if (next) {
      const t = tt.lessonTime(next);
      const s = tt.subjectOf(next);
      const now = new Date();
      const wait = toMin(t.from) - (now.getHours() * 60 + now.getMinutes());
      return `<button class="td-now soon" data-td="lesson" data-day="${dayKey(now)}" data-i="${tt.timetable().lessons.indexOf(next)}" style="--c:${s?.color || 'var(--accent)'}">
          <span class="td-now-label">Als Nächstes · ${tt.periodLabel(next)} Stunde</span>
          <span class="td-now-text">${fmt(next)}<span class="td-now-left">${wait <= 60 ? `in ${wait} min` : `um ${t.from}`}</span></span>
        </button>`;
    }
    const msg = weekend ? ['Wochenende', 'Keine Schule 😎'] : today.length ? ['Schule ist aus', 'Für heute geschafft 💪'] : ['Heute', 'Kein Unterricht'];
    return `<div class="td-now free"><span class="td-now-label">${msg[0]}</span><span class="td-now-text"><b>${msg[1]}</b></span></div>`;
  }

  // ---------- Tagesplan (wie EduPage) ----------
  function dayHtml(now, g, P) {
    const data = tt.timetable();
    const date = pickedDay ? parseDay(pickedDay) : autoDay(now);
    const key = dayKey(date);
    const lessons = tt.lessonsOn(date);
    const n = daysUntil(key);
    const rel = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : '';
    const week = tt.weekOf(date);
    const isToday = n === 0;
    const min = now.getHours() * 60 + now.getMinutes();
    const { current } = tt.nowAndNext(now);

    // Was ist in welcher Stunde fällig? (mehrere Stunden im Fach an einem Tag -> zur ersten)
    const firstOf = new Map();
    for (const l of lessons) if (!firstOf.has(l.subject)) firstOf.set(l.subject, l);
    const itemsFor = (l) => {
      const hws = g.all.filter((x) => x.subject === l.subject && x.hw.due === key && firstOf.get(l.subject) === l);
      const evs = g.tasks.filter(
        (t) => t.kind !== 'hw' && t.subject === l.subject && t.due === key && (t.period ? t.period >= l.period && t.period < l.period + (l.len || 1) : firstOf.get(l.subject) === l)
      );
      return { hws, evs };
    };

    const rows = [];
    let prev = null;
    for (const l of lessons) {
      const t = tt.lessonTime(l);
      if (prev) {
        const gapFrom = l.period - (prev.period + (prev.len || 1));
        if (gapFrom > 0) rows.push(`<div class="td-free">${gapFrom === 1 ? `${prev.period + (prev.len || 1)}. Stunde frei` : `${prev.period + (prev.len || 1)}.–${l.period - 1}. Stunde frei`}</div>`);
        else if (P.breaks) {
          const gap = toMin(t.from) - toMin(tt.lessonTime(prev).to);
          if (gap >= 10) rows.push(`<div class="td-break"><span>Pause · ${gap} min</span></div>`);
        }
      }
      const s = tt.subjectOf(l);
      const { hws, evs } = itemsFor(l);
      const past = isToday && toMin(t.to) <= min;
      const on = isToday && l === current;
      const pct = on ? Math.round(((min - toMin(t.from)) / Math.max(1, toMin(t.to) - toMin(t.from))) * 100) : 0;
      const chips = [
        ...evs.map((e) => `<span class="td-chip" style="--k:${KIND[e.kind]?.color}">${KIND[e.kind]?.icon || ''}${esc(e.text || KIND[e.kind]?.label || '')}</span>`),
        ...hws.map((x) => `<span class="td-chip${x.hw.done ? ' done' : ''}" style="--k:${KIND.hw.color}">${HW_ICON}${x.hw.done ? '✓ ' : ''}${esc(x.hw.text || 'Hausaufgabe')}</span>`),
      ].join('');
      rows.push(`<button class="td-row${on ? ' now' : ''}${past ? ' past' : ''}" data-td="lesson" data-day="${key}" data-i="${data.lessons.indexOf(l)}" style="--c:${s?.color || '#868e96'}">
          <span class="td-row-n">${l.len > 1 ? `${l.period}<small>–${l.period + l.len - 1}</small>` : l.period}</span>
          <span class="td-row-main">
            <span class="td-row-title"><b>${esc(s?.name || l.subject)}</b>${s?.course ? `<em>${esc(s.course)}</em>` : ''}${l.weeks && l.weeks !== 'AB' ? `<em class="ab">nur ${l.weeks}</em>` : ''}</span>
            ${l.teacher ? `<small>${ICON.person}${esc(tt.teacherName(l.teacher, P.fullTeacher))}</small>` : ''}
            ${chips ? `<span class="td-row-chips">${chips}</span>` : ''}
          </span>
          <span class="td-row-side"><b>${esc(l.room || '')}</b><small>${t.from} – ${t.to}</small></span>
          ${on ? `<span class="td-row-bar"><i style="width:${pct}%"></i></span>` : ''}
        </button>`);
      prev = l;
    }
    const body = lessons.length ? rows.join('') : `<p class="td-empty">An diesem Tag ist kein Unterricht.</p>`;
    return `<section class="td-card td-day">
        <header class="td-day-nav">
          <button class="td-nav-btn" data-td="day" data-dir="-1" aria-label="Tag zurück">${ICON.left}</button>
          <button class="td-day-title" data-td="day-today" title="Zurück zu heute">
            <b>${rel ? `${rel} · ` : ''}${DAYS_LONG[date.getDay()]}</b>
            <small>${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}${week ? ` · ${week}-Woche` : ''}${lessons.length ? ` · ${lessons.length} ${lessons.length === 1 ? 'Block' : 'Blöcke'}, ${tt.lessonTime(lessons[0]).from}–${tt.lessonTime(lessons.at(-1)).to}` : ''}</small>
          </button>
          <button class="td-nav-btn" data-td="day" data-dir="1" aria-label="Tag vor">${ICON.right}</button>
        </header>
        <div class="td-tl">${body}</div>
        <p class="td-hint">Stunde antippen: Hausaufgabe oder Test eintragen, Ordner öffnen</p>
      </section>`;
  }

  // ---------- Hausaufgaben ----------
  function hwHtml(g, P) {
    const data = tt.timetable();
    const card = (x) => {
      const s = data.subjects[x.subject];
      const n = daysUntil(x.hw.due);
      const late = !x.hw.done && n < 0;
      const urgent = !x.hw.done && n >= 0 && n <= 1;
      const src = x.own ? `${ICON.pen}selbst eingetragen` : `${ICON.note}${esc(x.note.title || 'Notiz')}`;
      return `<div class="td-task${x.hw.done ? ' done' : ''}${late ? ' late' : ''}" style="--c:${s?.color || '#868e96'}">
        <button class="td-check${x.hw.done ? ' on' : ''}" data-td="hw-toggle" data-id="${x.hw.id}" aria-label="${x.hw.done ? 'Wieder offen' : 'Erledigt'}">${ICON.check}</button>
        <button class="td-task-main" data-td="hw-open" data-id="${x.hw.id}">
          <span class="td-task-t">${esc(x.hw.text || 'Hausaufgabe')}</span>
          ${x.hw.details ? `<span class="td-task-d">${esc(x.hw.details)}</span>` : ''}
          <span class="td-task-meta">${s ? `<i class="td-subj">${esc(s.name)}</i>` : ''}<span class="td-due${late ? ' late' : urgent ? ' soon' : ''}">${x.hw.done ? 'erledigt' : late ? `fällig seit ${esc(fmtDay(parseDay(x.hw.due)))}` : `bis ${esc(whenText(x.hw.due))}`}</span><span class="td-src">${src}</span></span>
        </button>
      </div>`;
    };
    let body;
    if (hwTab === 'done') {
      body = g.done.length ? `<div class="td-group">${g.done.map(card).join('')}</div>` : '<p class="td-empty">Noch nichts abgehakt.</p>';
    } else if (!g.open.length) {
      body = `<div class="td-allgood"><span>🎉</span><b>Alles erledigt!</b><small>Neue Hausaufgabe: oben „Eintragen“, eine Stunde im Tagesplan antippen oder in einer Notiz „Hausaufgabe markieren“.</small></div>`;
    } else {
      // Gruppen nach Fälligkeit, mit Datum im Titel ("Morgen · Fr, 27.11.")
      const groups = new Map();
      for (const x of g.open) {
        const n = daysUntil(x.hw.due);
        const d = parseDay(x.hw.due);
        const k = n < 0 ? 'late' : n <= 6 ? x.hw.due : 'later';
        const title = n < 0 ? 'Überfällig' : n === 0 ? `Heute · ${fmtDay(d)}` : n === 1 ? `Morgen · ${fmtDay(d)}` : n <= 6 ? `${DAYS_LONG[d.getDay()]} · ${d.getDate()}.${d.getMonth() + 1}.` : 'Später';
        if (!groups.has(k)) groups.set(k, { title, cls: n < 0 ? 'late' : n <= 1 ? 'soon' : '', items: [] });
        groups.get(k).items.push(x);
      }
      body = [...groups.values()].map((gr) => `<div class="td-group ${gr.cls}"><div class="td-g-title">${gr.title}<small>${gr.items.length}</small></div>${gr.items.map(card).join('')}</div>`).join('');
      if (P.showDone && g.done.length) body += `<button class="td-more" data-td="tab" data-tab="done">${g.done.length} erledigt ansehen</button>`;
    }
    return `<section class="td-card td-hwp">
        <header class="td-card-head">
          <span class="td-card-title">${HW_ICON}Hausaufgaben</span>
          <div class="td-seg">
            <button class="${hwTab === 'open' ? 'on' : ''}" data-td="tab" data-tab="open">Offen${g.open.length ? `<i>${g.open.length}</i>` : ''}</button>
            <button class="${hwTab === 'done' ? 'on' : ''}" data-td="tab" data-tab="done">Erledigt</button>
          </div>
          <button class="td-icon-add" data-td="add" data-kind="hw" aria-label="Hausaufgabe eintragen">${ICON.plus}</button>
        </header>
        ${body}
      </section>`;
  }

  // ---------- Termine ----------
  function eventsHtml(g) {
    const data = tt.timetable();
    const list = g.events.slice(0, 8);
    const body = list.length
      ? list
          .map((e) => {
            const s = data.subjects[e.subject];
            const d = parseDay(e.due);
            const n = daysUntil(e.due);
            const k = KIND[e.kind] || KIND.event;
            const lesson = e.period ? tt.lessonsOn(d).find((l) => l.subject === e.subject && e.period >= l.period && e.period < l.period + (l.len || 1)) : null;
            return `<button class="td-ev" data-td="task-open" data-id="${e.id}" style="--k:${k.color}">
              <span class="td-ev-date"><small>${DAYS_SHORT[d.getDay()]}</small><b>${d.getDate()}</b><small>${MONTHS_SHORT[d.getMonth()]}</small></span>
              <span class="td-ev-main"><span class="td-ev-kind">${k.icon}${k.label}</span><b>${esc(e.text || k.label)}</b>
                <small>${s ? esc(s.name) : ''}${lesson ? ` · ${tt.periodLabel(lesson)} Stunde${lesson.room ? `, ${esc(lesson.room)}` : ''}` : ''}${e.details ? ` · ${esc(e.details)}` : ''}</small></span>
              <span class="td-count${n <= 2 ? ' hot' : ''}">${n === 0 ? 'heute' : n === 1 ? 'morgen' : `in ${n} Tagen`}</span>
            </button>`;
          })
          .join('')
      : '<p class="td-empty">Keine Tests oder Termine. Eintragen geht oben oder über eine Stunde im Tagesplan.</p>';
    return `<section class="td-card td-evp">
        <header class="td-card-head"><span class="td-card-title">${ICON.cal}Tests &amp; Termine</span>
          <button class="td-icon-add" data-td="add" data-kind="test" aria-label="Test oder Termin eintragen">${ICON.plus}</button></header>
        ${body}
      </section>`;
  }

  // ---------- Wochenplan Mo–Fr ----------
  function weekGrid(now) {
    const data = tt.timetable();
    const thisWeek = tt.weekOf(now);
    const week = showWeek || thisWeek;
    // Montag der angezeigten Woche (andere Woche = nächste Woche)
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + (week !== thisWeek ? 7 : 0));
    const todayCol = week === thisWeek ? now.getDay() : -1;
    const { current } = tt.nowAndNext(now);
    const rows = data.periods.length;
    const cells = [];
    for (let day = 1; day <= 5; day++) {
      const date = addDays(monday, day - 1);
      const list = tt.lessonsOn(date);
      for (const l of list) {
        const s = tt.subjectOf(l);
        const on = l === current && week === thisWeek && day === todayCol;
        const stacked = list.filter((o) => o.period === l.period).length > 1;
        cells.push(`<button class="tw-cell${on ? ' now' : ''}${stacked ? ' half' : ''}" data-td="lesson" data-day="${dayKey(date)}" data-i="${data.lessons.indexOf(l)}"
            style="grid-column:${day + 1};grid-row:${l.period + 1} / span ${l.len || 1};--c:${s?.color || '#868e96'}">
            <b>${esc(s?.short || l.subject)}</b><small>${esc(l.room || '')}</small></button>`);
      }
    }
    const head = ['<span class="tw-corner"></span>']
      .concat(['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((d, i) => `<span class="tw-day${i + 1 === todayCol ? ' today' : ''}" style="grid-column:${i + 2}">${d}<small>${addDays(monday, i).getDate()}.${addDays(monday, i).getMonth() + 1}.</small></span>`))
      .join('');
    const times = data.periods.map((p, i) => `<span class="tw-time" style="grid-row:${i + 2}"><b>${i + 1}</b><small>${p.from}</small></span>`).join('');
    return `<section class="td-card tw">
        <header class="td-card-head"><span class="td-card-title">${ICON.cal}Wochenplan</span>
          ${thisWeek ? `<div class="td-seg">${['A', 'B'].map((w) => `<button class="${w === week ? 'on' : ''}" data-td="show-week" data-week="${w}">${w}-Woche${w === thisWeek ? ' · jetzt' : ''}</button>`).join('')}</div>` : ''}
        </header>
        <div class="tw-grid" style="grid-template-rows:auto repeat(${rows}, minmax(40px, auto))">${head}${times}${cells.join('')}</div>
      </section>`;
  }

  // ---------- Bedienen ----------
  async function click(e, { notes, folders }) {
    const el = e.target.closest('[data-td]');
    if (!el) return false;
    const act = el.dataset.td;
    if (act === 'settings') {
      api.openSettings?.();
      return true;
    }
    if (act === 'lesson') {
      const l = tt.timetable().lessons[Number(el.dataset.i)];
      if (l) await lessonSheet(l, parseDay(el.dataset.day), { notes, folders });
      return true;
    }
    if (act === 'subject') {
      await openSubjectFolder(el.dataset.subject, folders);
      return true;
    }
    if (act === 'day') {
      const base = pickedDay ? parseDay(pickedDay) : autoDay(new Date());
      const d = schoolDay(base, Number(el.dataset.dir));
      if (d) pickedDay = dayKey(d);
      api.refresh();
      return true;
    }
    if (act === 'day-today') {
      pickedDay = null;
      api.refresh();
      return true;
    }
    if (act === 'tab') {
      hwTab = el.dataset.tab;
      api.refresh();
      // Liste in Sicht holen (z. B. nach Tipp auf die Kachel)
      requestAnimationFrame(() => document.querySelector('.td-hwp')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      return true;
    }
    if (act === 'switch-week') {
      const w = tt.weekOf();
      tt.setThisWeek(w === 'A' ? 'B' : 'A');
      showWeek = null;
      toast(`Diese Woche ist jetzt eine ${w === 'A' ? 'B' : 'A'}-Woche`);
      api.refresh();
      return true;
    }
    if (act === 'show-week') {
      showWeek = el.dataset.week;
      api.refresh();
      return true;
    }
    if (act === 'add') {
      await addTask({ kind: el.dataset.kind });
      return true;
    }
    if (act === 'task-open') {
      await editOwn(el.dataset.id);
      return true;
    }
    const id = el.dataset.id;
    if (act === 'hw-toggle') {
      await toggleHw(id, notes);
      api.refresh();
      return true;
    }
    if (act === 'hw-open') {
      await openHw(id, notes);
      return true;
    }
    return false;
  }

  // Hausaufgabe öffnen: aus einer Notiz -> genau dorthin springen, selbst eingetragen -> bearbeiten
  async function openHw(id, notes) {
    const found = collectHomework(notes).find((x) => x.hw.id === id);
    if (found) {
      const pageIndex = Math.max(0, (found.note.pageIds || []).indexOf(found.hw.pageId));
      api.openNote(found.note.id, { pageIndex, box: found.hw.box });
    } else await editOwn(id);
  }

  async function addTask(preset) {
    const t = await editTask(preset);
    if (!t || t.remove) return;
    saveTasks([...loadTasks(), { id: uid(), done: false, created: Date.now(), ...t }]);
    toast(`${KIND[t.kind]?.label || 'Eintrag'} gespeichert`);
    api.refresh();
  }

  async function editOwn(id) {
    const list = loadTasks();
    const task = list.find((t) => t.id === id);
    if (!task) return;
    const t = await editTask(task);
    if (!t) return;
    if (t.remove) {
      saveTasks(list.filter((x) => x.id !== id));
      toast('Gelöscht', { label: 'Rückgängig', run: () => (saveTasks([...loadTasks(), task]), api.refresh()) });
    } else {
      Object.assign(task, t);
      saveTasks(list);
    }
    api.refresh();
  }

  async function toggleHw(id, notes) {
    const own = loadTasks();
    const task = own.find((t) => t.id === id);
    if (task) {
      task.done = !task.done;
      task.doneAt = task.done ? Date.now() : undefined;
      saveTasks(own);
      return task.done;
    }
    const found = collectHomework(notes).find((x) => x.hw.id === id);
    if (!found) return false;
    found.hw.done = !found.hw.done;
    found.hw.doneAt = found.hw.done ? Date.now() : undefined;
    await api.saveNoteMeta(found.note);
    return found.hw.done;
  }

  async function openSubjectFolder(id, folders) {
    const f = folderFor(id, folders);
    if (f) return api.openFolder(f.id);
    const s = tt.timetable().subjects[id];
    const ok = await openDialog({
      html: `<div class="dlg-title">Ordner „${esc(s?.name || id)}“ anlegen?</div>
        <div class="dlg-text">Für dieses Fach gibt es noch keinen Ordner. Neue Notizen darin bekommen automatisch das Fach – dann klappt auch „Abgabe = nächste Stunde“ bei den Hausaufgaben.</div>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button><button class="dlg-btn primary" data-dlg="ok">Anlegen</button></div>`,
      result: () => true,
    });
    if (ok) {
      const folder = await api.createFolder(s?.name || id, s?.color);
      if (folder) api.openFolder(folder.id);
    }
  }

  // ---------- Stunden-Blatt: eine Stunde antippen (wie in EduPage) ----------
  async function lessonSheet(l, date, { notes, folders }) {
    const P = getPrefs();
    const data = tt.timetable();
    const s = tt.subjectOf(l);
    const t = tt.lessonTime(l);
    const key = dayKey(date);
    const g = gather(notes, folders);
    const due = g.all.filter((x) => x.subject === l.subject && x.hw.due === key);
    const tests = g.tasks.filter((x) => x.kind !== 'hw' && x.subject === l.subject && x.due === key);
    const given = g.tasks.filter((x) => x.kind === 'hw' && x.subject === l.subject && x.given === key);
    const next = tt.upcomingLessons(l.subject, date, 1)[0];
    const folder = folderFor(l.subject, folders);
    const row = (x) => `<div class="ls-item${x.hw.done ? ' done' : ''}">
        <button class="td-check${x.hw.done ? ' on' : ''}" data-ls-toggle="${x.hw.id}" aria-label="Erledigt">${ICON.check}</button>
        <span><b>${esc(x.hw.text || 'Hausaufgabe')}</b>${x.hw.details ? `<small>${esc(x.hw.details)}</small>` : ''}<small>${x.own ? 'selbst eingetragen' : esc(x.note.title || 'Notiz')}${x.hw.due !== key ? ` · bis ${esc(whenText(x.hw.due))}` : ''}</small></span>
        <button class="ls-edit" data-ls-open="${x.hw.id}" aria-label="Öffnen">${ICON.right}</button>
      </div>`;
    const evRow = (e) => `<div class="ls-item" style="--k:${KIND[e.kind]?.color}">
        <span class="ls-kind">${KIND[e.kind]?.icon || ''}</span>
        <span><b>${esc(e.text || KIND[e.kind]?.label)}</b><small>${esc(KIND[e.kind]?.label || '')}${e.details ? ` · ${esc(e.details)}` : ''}</small></span>
        <button class="ls-edit" data-ls-task="${e.id}" aria-label="Bearbeiten">${ICON.right}</button>
      </div>`;
    const givenRows = given.map((x) => row({ hw: x, own: true }));
    const result = await openDialog({
      wide: true,
      enter: false,
      html: `
        <div class="ls-head" style="--c:${s?.color || '#868e96'}">
          <div class="ls-course">${esc(s?.course || s?.short || '')}${l.weeks && l.weeks !== 'AB' ? ` · nur ${l.weeks}-Woche` : ''}</div>
          <div class="ls-title">${esc(s?.name || l.subject)}</div>
          <div class="ls-when">${DAYS_LONG[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]} · ${tt.periodLabel(l)} Stunde</div>
        </div>
        <div class="ls-info">
          <span>${ICON.clock}${t.from} – ${t.to}</span>
          ${l.room ? `<span>${ICON.room}Raum ${esc(l.room)}</span>` : ''}
          ${l.teacher ? `<span>${ICON.person}${esc(tt.teacherName(l.teacher, P.fullTeacher))}</span>` : ''}
        </div>
        <div class="ls-sec"><div class="ls-sec-t">${HW_ICON}Bis zu dieser Stunde</div>
          ${due.length ? due.map(row).join('') : '<p class="ls-none">Keine Hausaufgabe fällig.</p>'}</div>
        ${tests.length ? `<div class="ls-sec"><div class="ls-sec-t">${ICON.exam}Tests &amp; Klausuren</div>${tests.map(evRow).join('')}</div>` : ''}
        ${givenRows.length ? `<div class="ls-sec"><div class="ls-sec-t">${ICON.pen}In dieser Stunde aufgegeben</div>${givenRows.join('')}</div>` : ''}
        <div class="ls-actions">
          <button class="ls-act" data-ls="hw" style="--k:${KIND.hw.color}">${HW_ICON}<span><b>Hausaufgabe aufgeben</b><small>${next ? `bis nächste Stunde: ${fmtDay(next.date)}` : 'mit Abgabedatum'}</small></span></button>
          <button class="ls-act" data-ls="test" style="--k:${KIND.exam.color}">${ICON.exam}<span><b>Test / Klausur</b><small>in dieser Stunde</small></span></button>
          <button class="ls-act" data-ls="folder" style="--k:${s?.color || 'var(--accent)'}">${ICON.folder}<span><b>${folder ? 'Ordner öffnen' : 'Ordner anlegen'}</b><small>${folder ? esc(folder.name) : 'für Notizen in diesem Fach'}</small></span></button>
        </div>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Schließen</button></div>`,
      onReady(card, close) {
        card.addEventListener('click', async (e) => {
          const a = e.target.closest('[data-ls]');
          if (a) return close({ act: a.dataset.ls });
          const tg = e.target.closest('[data-ls-toggle]');
          if (tg) {
            const done = await toggleHw(tg.dataset.lsToggle, notes);
            tg.classList.toggle('on', done);
            tg.closest('.ls-item')?.classList.toggle('done', done);
            card.dataset.changed = '1';
            return;
          }
          const op = e.target.closest('[data-ls-open]');
          if (op) return close({ act: 'open', id: op.dataset.lsOpen });
          const tk = e.target.closest('[data-ls-task]');
          if (tk) return close({ act: 'task', id: tk.dataset.lsTask });
        });
      },
      result: () => null,
    });
    api.refresh();
    if (!result) return;
    if (result.act === 'hw') await addTask({ kind: 'hw', subject: l.subject, given: key, due: next ? dayKey(next.date) : undefined, period: next?.lesson.period });
    else if (result.act === 'test') await addTask({ kind: 'exam', subject: l.subject, due: key, period: l.period });
    else if (result.act === 'folder') await openSubjectFolder(l.subject, folders);
    else if (result.act === 'task') await editOwn(result.id);
    else if (result.act === 'open') await openHw(result.id, notes);
  }

  // ---------- Fenster: Hausaufgabe / Test / Klausur / Termin eintragen ----------
  function editTask(task) {
    const data = tt.timetable();
    let kind = task.kind || 'hw';
    let subject = task.subject || '';
    let due = task.due || '';
    let period = task.period || null;
    const given = task.given || null;
    const subjects = subjectsInPlan();
    const isEdit = Boolean(task.id);

    // Vorschläge für das Datum: Stunden im Fach (wie EduPage) + Morgen / 1 Woche
    function options() {
      const opts = [];
      const base = given ? parseDay(given) : new Date();
      if (subject) {
        const upcoming = tt.upcomingLessons(subject, base, 3, kind !== 'hw' && !given);
        upcoming.forEach(({ date, lesson }, i) => {
          const label = kind === 'hw' ? (i === 0 ? 'Nächste Stunde' : i === 1 ? 'Übernächste' : 'In 3 Stunden') : i === 0 ? 'Nächste Stunde' : `${i + 1}. Stunde danach`;
          opts.push({ key: dayKey(date), period: lesson.period, label, sub: `${fmtDay(date)} · ${tt.periodLabel(lesson)}` });
        });
      }
      const today = new Date();
      for (const [n, label] of [
        [1, 'Morgen'],
        [7, 'In 1 Woche'],
      ]) {
        const d = addDays(today, n);
        if (!opts.some((o) => o.key === dayKey(d))) opts.push({ key: dayKey(d), period: null, label, sub: fmtDay(d) });
      }
      return opts;
    }

    return openDialog({
      enter: false,
      wide: true,
      html: `
        <div class="et">
          <div class="dlg-title">${isEdit ? 'Eintrag bearbeiten' : 'Neu eintragen'}</div>
          <div class="et-kinds">${Object.entries(KIND)
            .map(([k, v]) => `<button class="et-kind" data-kind="${k}" style="--k:${v.color}">${v.icon}<span>${v.label}</span></button>`)
            .join('')}</div>
          <div class="et-label">Fach</div>
          <div class="et-subjects">${subjects
            .map(([id, s]) => `<button class="et-subj" data-subj="${id}" style="--c:${s.color}"><i></i><span>${esc(s.name)}</span>${s.course ? `<small>${esc(s.course)}</small>` : ''}</button>`)
            .join('')}</div>
          <div class="et-label">Was?</div>
          <input class="dlg-input et-title" maxlength="140" value="${esc(task.text || '')}" />
          <textarea class="dlg-input et-details" rows="2" maxlength="600" placeholder="Details (optional): Seiten, Nummern, Material, Themen …">${esc(task.details || '')}</textarea>
          <div class="et-label">Bis wann? <small class="et-why"></small></div>
          <div class="et-dates"></div>
          <div class="et-preview"></div>
          <div class="dlg-btns">${isEdit ? `<button class="dlg-btn danger-text" data-et="remove">${ICON.trash}Löschen</button><span class="et-sp"></span>` : ''}
            <button class="dlg-btn" data-dlg="cancel">Abbrechen</button><button class="dlg-btn primary" data-dlg="ok">Speichern</button></div>
        </div>`,
      onReady(card, close) {
        const title = card.querySelector('.et-title');
        const draw = () => {
          for (const b of card.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
          for (const b of card.querySelectorAll('[data-subj]')) b.classList.toggle('on', b.dataset.subj === subject);
          title.placeholder =
            kind === 'hw' ? 'z. B. S. 54 Nr. 3 a–c' : kind === 'test' ? 'z. B. Vokabeltest Unit 4' : kind === 'exam' ? 'z. B. Klausur Q 1' : 'z. B. Referat abgeben, Exkursion';
          const opts = options();
          if (!due) {
            const first = opts[0];
            due = first.key;
            period = first.period;
          }
          const custom = !opts.some((o) => o.key === due);
          card.querySelector('.et-dates').innerHTML =
            opts
              .map((o) => `<button class="et-date${o.key === due && (!o.period || !period || o.period === period) ? ' on' : ''}" data-due="${o.key}" data-period="${o.period || ''}"><b>${esc(o.label)}</b><small>${esc(o.sub)}</small></button>`)
              .join('') + `<label class="et-date et-pick${custom ? ' on' : ''}"><b>Datum</b><input type="date" value="${due}" /></label>`;
          const s = data.subjects[subject];
          const d = parseDay(due);
          const lesson = d && subject ? tt.lessonsOn(d).find((l) => l.subject === subject && (!period || (period >= l.period && period < l.period + (l.len || 1)))) : null;
          card.querySelector('.et-why').textContent = subject && kind === 'hw' ? 'Abgabe meistens zur nächsten Stunde' : '';
          card.querySelector('.et-preview').innerHTML = d
            ? `<span style="--k:${KIND[kind].color}">${KIND[kind].icon}</span><span><b>${esc(KIND[kind].label)}${s ? ` in ${esc(s.name)}` : ''}</b><small>${kind === 'hw' ? 'bis ' : 'am '}${DAYS_LONG[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}${lesson ? ` · ${tt.periodLabel(lesson)} Stunde, ${tt.lessonTime(lesson).from}${lesson.room ? `, Raum ${esc(lesson.room)}` : ''}` : subject ? ' · an dem Tag kein Unterricht in dem Fach' : ''}</small></span>`
            : '';
        };
        draw();
        card.addEventListener('click', (e) => {
          if (e.target.closest('[data-et="remove"]')) return close({ remove: true });
          const k = e.target.closest('[data-kind]');
          const s = e.target.closest('[data-subj]');
          const d = e.target.closest('[data-due]');
          if (k) {
            kind = k.dataset.kind;
            if (!isEdit) due = '';
          }
          if (s) {
            subject = subject === s.dataset.subj ? '' : s.dataset.subj;
            if (!isEdit || !task.due) due = '';
          }
          if (d) {
            due = d.dataset.due;
            period = Number(d.dataset.period) || null;
          }
          if (k || s || d) draw();
        });
        card.addEventListener('change', (e) => {
          if (e.target.type === 'date' && e.target.value) {
            due = e.target.value;
            period = null;
            draw();
          }
        });
        setTimeout(() => (subject || kind !== 'hw' ? title : null)?.focus(), 80);
      },
      result(card) {
        const text = card.querySelector('.et-title').value.trim();
        const details = card.querySelector('.et-details').value.trim();
        if (!text && kind === 'hw') {
          card.querySelector('.et-title').classList.add('shake');
          setTimeout(() => card.querySelector('.et-title')?.classList.remove('shake'), 500);
          return undefined;
        }
        const out = { kind, subject, text: text || KIND[kind].label, details, due, period };
        if (given) out.given = given;
        return out;
      },
    });
  }

  // Jede Minute auffrischen (die "Jetzt"-Karte und der Balken laufen mit)
  function startTicker(refresh) {
    stopTicker();
    ticker = setInterval(refresh, 60 * 1000);
  }
  function stopTicker() {
    clearInterval(ticker);
    ticker = 0;
  }

  return { html, click, startTicker, stopTicker, addTask };
}
