// today.js – Startseite "Heute": dein Stundenplan auf einen Blick
//
//   ┌ Kopf: Datum · A/B-Woche, "Guten Morgen, Robin", Jetzt-/Als-Nächstes-Karte │ 3 Kacheln ┐
//   ├ Tagesplan wie in EduPage (‹ Freitag 04.12. ›) mit Tagesleiste │ Fächer des Tages      │
//   └ Wochenplan Mo–Fr mit A/B-Umschalter                                                  ┘
//
// Hausaufgaben und Tests stehen bewusst NICHT hier (die laufen über EduPage).
// Stunde oder Fach antippen = Stunden-Blatt mit den Notizen des Fachs, "Neue Notiz", Ordner.
// Was angezeigt wird, steht in den Einstellungen (theme.js, settings.js).

import * as tt from './timetable.js';
import { daysUntil, dayKey, parseDay } from './homework.js';
import { openDialog, toast, esc } from './dialog.js';
import { getPrefs } from './theme.js';

const ICON = {
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
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
  flag: '<svg viewBox="0 0 24 24"><path d="M5.5 21V4.5M5.5 4.5h11l-2.5 4 2.5 4h-11"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 14.5a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5v.2a2 2 0 1 1-4 0V20a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.2a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1h.2a2 2 0 1 1 0 4h-.2a1.6 1.6 0 0 0-1.5 1z"/></svg>',
};
const DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const DAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const pad = (n) => String(n).padStart(2, '0');
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const toMin = (hhmm) => {
  const [h, m] = String(hhmm || '0:0').split(':').map(Number);
  return h * 60 + m;
};
const minutesNow = (d = new Date()) => d.getHours() * 60 + d.getMinutes();
// 245 -> "4 h 5 min"
const dur = (min) => (min >= 60 ? `${Math.floor(min / 60)} h${min % 60 ? ` ${min % 60} min` : ''}` : `${min} min`);
// "Fr, 27.11."
const fmtDay = (d) => `${DAYS_SHORT[d.getDay()]}, ${d.getDate()}.${d.getMonth() + 1}.`;
// "heute", "morgen", "Montag", "Mo, 7.12."
function relDay(d, now = new Date()) {
  const n = daysUntil(dayKey(d), now);
  if (n === 0) return 'heute';
  if (n === 1) return 'morgen';
  if (n > 1 && n < 7) return DAYS_LONG[d.getDay()];
  return fmtDay(d);
}
// "vor 2 Tagen" für Notizen
function ago(ts) {
  if (!ts) return '';
  const n = -daysUntil(dayKey(new Date(ts)));
  if (n <= 0) return 'heute';
  if (n === 1) return 'gestern';
  if (n < 7) return `vor ${n} Tagen`;
  const d = new Date(ts);
  return `${d.getDate()}.${d.getMonth() + 1}.`;
}

// api: { openNote(id), openFolder(id), createFolder(name, color) -> folder, createNote(folderId, name), refresh(), openSettings() }
export function setupToday(api) {
  let showWeek = null; // im Wochenplan angezeigte Woche ('A' | 'B'), null = aktuelle
  let pickedDay = null; // im Tagesplan gezeigter Tag ('JJJJ-MM-TT'), null = automatisch
  let ticker = 0;

  // Ordner, der zu einem Fach gehört
  const folderFor = (subjectId, folders) => folders.find((f) => tt.subjectIdFor(f.name) === subjectId) || null;
  // Notizen eines Fachs (im Fach-Ordner und seinen Unterordnern), neueste zuerst
  function notesFor(subjectId, notes, folders) {
    const f = folderFor(subjectId, folders);
    if (!f) return [];
    const ids = new Set([f.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const x of folders) if (x.parentId && ids.has(x.parentId) && !ids.has(x.id)) (ids.add(x.id), (grew = true));
    }
    return notes.filter((n) => ids.has(n.folderId)).sort((a, b) => (b.updated || 0) - (a.updated || 0));
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
  const shownDay = (now) => (pickedDay ? parseDay(pickedDay) : autoDay(now));

  function html({ notes, folders }) {
    const P = getPrefs();
    const S = P.sections;
    const now = new Date();
    const day = S.day ? dayHtml(now, P) : '';
    const subj = S.subjects ? subjectsHtml(now, notes, folders, P) : '';
    const main = day || subj ? `<div class="td-main${day && subj ? '' : ' single'}">${day}${subj}</div>` : '';
    return `<div class="td">${heroHtml(now, P)}${main}${S.week ? weekGrid(now) : ''}</div>`;
  }

  // ---------- Kopf ----------
  function heroHtml(now, P) {
    const week = tt.weekOf(now);
    const h = now.getHours();
    const hello = h < 5 ? 'Gute Nacht' : h < 11 ? 'Guten Morgen' : h < 17 ? 'Hallo' : h < 22 ? 'Guten Abend' : 'Gute Nacht';
    const name = (P.name || '').trim();
    const { current, next, today } = tt.nowAndNext(now);
    const weekend = now.getDay() === 0 || now.getDay() === 6;
    const min = minutesNow(now);
    const doneToday = today.filter((l) => toMin(tt.lessonTime(l).to) <= min).length;
    const pct = today.length ? doneToday / today.length : 0;
    const ring = `<svg class="td-ring" viewBox="0 0 36 36"><circle cx="18" cy="18" r="15.5"/><circle class="on" cx="18" cy="18" r="15.5" stroke-dasharray="${(pct * 97.4).toFixed(1)} 97.4"/></svg>`;
    const end = today.length ? toMin(tt.lessonTime(today.at(-1)).to) : 0;
    const start = today.length ? toMin(tt.lessonTime(today[0]).from) : 0;

    // Kachel 2: Schulschluss
    let endTile;
    if (today.length && min < end) {
      endTile = `<div class="td-stat" style="--k:#f08c00"><span class="td-stat-ic">${ICON.flag}</span>
        <b>${tt.lessonTime(today.at(-1)).to}</b><span>Schulschluss</span>
        <small>${min < start ? `Start um ${tt.lessonTime(today[0]).from}` : `noch ${dur(end - min)}`}</small></div>`;
    } else {
      endTile = `<div class="td-stat" style="--k:#2f9e44"><span class="td-stat-ic">${ICON.sun}</span>
        <b>Frei</b><span>${weekend ? 'Wochenende' : today.length ? 'Schule ist aus' : 'kein Unterricht'}</span>
        <small>${today.length ? `seit ${tt.lessonTime(today.at(-1)).to} Uhr` : 'Zeit für dich'}</small></div>`;
    }
    // Kachel 3: nächster Schultag
    const nd = schoolDay(now, 1);
    const nl = nd ? tt.lessonsOn(nd) : [];
    const names = [...new Set(nl.map((l) => tt.subjectOf(l)?.name || l.subject))];
    const nextTile = nd
      ? `<button class="td-stat" data-td="pick-day" data-day="${dayKey(nd)}" style="--k:var(--accent)"><span class="td-stat-ic">${ICON.cal}</span>
        <b>${tt.lessonTime(nl[0]).from}</b><span>Beginn ${relDay(nd, now) === 'morgen' ? 'morgen' : DAYS_LONG[nd.getDay()]}</span>
        <small>${esc(names.join(', '))}</small></button>`
      : '';

    // Knopf: Notiz für die laufende (oder nächste) Stunde
    const focus = current || next;
    const fs = focus ? tt.subjectOf(focus) : null;
    const noteBtn = focus
      ? `<button class="td-primary" data-td="new-note" data-subject="${esc(focus.subject)}">${ICON.pen}<span>Notiz in ${esc(fs?.name || focus.subject)}</span></button>`
      : '';

    return `<section class="td-hero">
      <div class="td-hero-main">
        <div class="td-kicker">${DAYS_LONG[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}
          ${week ? `<button class="td-week" data-td="switch-week" title="A/B-Woche umstellen (z. B. nach den Ferien)">${week}-Woche ${ICON.swap}</button>` : ''}</div>
        <h2 class="td-hello">${hello}${name ? `, ${esc(name)}` : ''}</h2>
        ${P.sections.now ? nowCard(current, next, today, weekend, now) : ''}
        <div class="td-hero-btns">
          ${noteBtn}
          <button class="td-ghost" data-td="settings" aria-label="Einstellungen" title="Einstellungen">${ICON.gear}</button>
        </div>
      </div>
      <div class="td-stats">
        ${
          today.length
            ? `<div class="td-stat ring" style="--k:var(--accent)">
          ${ring}
          <b>${doneToday}/${today.length}</b><span>Blöcke geschafft</span>
          <small>${doneToday === today.length ? 'Feierabend!' : `${Math.round(pct * 100)} % vom Schultag`}</small></div>`
            : ''
        }
        ${endTile}
        ${nextTile}
      </div>
    </section>`;
  }

  // Karte "Jetzt" / "Als Nächstes"
  function nowCard(current, next, today, weekend, now) {
    const lessons = tt.timetable().lessons;
    const fmt = (l) => {
      const s = tt.subjectOf(l);
      return `<b>${esc(s?.name || l.subject)}</b>${l.room ? ` <span class="td-now-room">${ICON.room}${esc(l.room)}</span>` : ''}`;
    };
    const min = minutesNow(now);
    if (current) {
      const t = tt.lessonTime(current);
      const start = toMin(t.from);
      const end = toMin(t.to);
      const pct = Math.round(((min - start) / Math.max(1, end - start)) * 100);
      const s = tt.subjectOf(current);
      return `<button class="td-now" data-td="lesson" data-day="${dayKey(now)}" data-i="${lessons.indexOf(current)}" style="--c:${s?.color || 'var(--accent)'}">
          <span class="td-now-label">Jetzt · ${tt.periodLabel(current)} Stunde · bis ${t.to}</span>
          <span class="td-now-text">${fmt(current)}<span class="td-now-left">noch ${dur(Math.max(0, end - min))}</span></span>
          ${next ? `<span class="td-now-next">Danach ${esc(tt.subjectOf(next)?.name || next.subject)} um ${tt.lessonTime(next).from}${next.room ? ` in ${esc(next.room)}` : ''}</span>` : '<span class="td-now-next">Danach: Schluss für heute 🎉</span>'}
          <span class="td-bar"><i style="width:${pct}%"></i></span>
        </button>`;
    }
    if (next) {
      const t = tt.lessonTime(next);
      const s = tt.subjectOf(next);
      const wait = toMin(t.from) - min;
      return `<button class="td-now soon" data-td="lesson" data-day="${dayKey(now)}" data-i="${lessons.indexOf(next)}" style="--c:${s?.color || 'var(--accent)'}">
          <span class="td-now-label">${today.indexOf(next) === 0 ? 'Erste Stunde' : 'Pause · als Nächstes'} · ${tt.periodLabel(next)} Stunde</span>
          <span class="td-now-text">${fmt(next)}<span class="td-now-left">${wait <= 90 ? `in ${dur(wait)}` : `um ${t.from}`}</span></span>
          ${next.teacher ? `<span class="td-now-next">${esc(tt.teacherName(next.teacher, getPrefs().fullTeacher))} · ${t.from}–${t.to}</span>` : ''}
        </button>`;
    }
    const msg = weekend ? ['Wochenende', 'Keine Schule 😎'] : today.length ? ['Schule ist aus', 'Für heute geschafft 💪'] : ['Heute', 'Kein Unterricht'];
    return `<div class="td-now free"><span class="td-now-label">${msg[0]}</span><span class="td-now-text"><b>${msg[1]}</b></span></div>`;
  }

  // ---------- Tagesplan (wie EduPage) ----------
  function dayHtml(now, P) {
    const data = tt.timetable();
    const date = shownDay(now);
    const key = dayKey(date);
    const lessons = tt.lessonsOn(date);
    const n = daysUntil(key, now);
    const rel = n === 0 ? 'Heute' : n === 1 ? 'Morgen' : n === -1 ? 'Gestern' : '';
    const week = tt.weekOf(date);
    const isToday = n === 0;
    const min = minutesNow(now);
    const { current } = tt.nowAndNext(now);

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
      const past = isToday && toMin(t.to) <= min;
      const on = isToday && l === current;
      const pct = on ? Math.round(((min - toMin(t.from)) / Math.max(1, toMin(t.to) - toMin(t.from))) * 100) : 0;
      rows.push(`<button class="td-row${on ? ' now' : ''}${past ? ' past' : ''}" data-td="lesson" data-day="${key}" data-i="${data.lessons.indexOf(l)}" style="--c:${s?.color || '#868e96'}">
          <span class="td-row-n">${l.len > 1 ? `${l.period}<small>–${l.period + l.len - 1}</small>` : l.period}</span>
          <span class="td-row-main">
            <span class="td-row-title"><b>${esc(s?.name || l.subject)}</b>${s?.course ? `<em>${esc(s.course)}</em>` : ''}${l.weeks && l.weeks !== 'AB' ? `<em class="ab">nur ${l.weeks}</em>` : ''}${on ? '<em class="live">läuft</em>' : ''}</span>
            ${l.teacher ? `<small>${ICON.person}${esc(tt.teacherName(l.teacher, P.fullTeacher))}</small>` : ''}
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
            <small>${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()}${week ? ` · ${week}-Woche` : ''}${lessons.length ? ` · ${tt.lessonTime(lessons[0]).from}–${tt.lessonTime(lessons.at(-1)).to}` : ''}</small>
          </button>
          <button class="td-nav-btn" data-td="day" data-dir="1" aria-label="Tag vor">${ICON.right}</button>
        </header>
        ${lessons.length ? dayStrip(lessons, isToday ? min : null, key) : ''}
        <div class="td-tl">${body}</div>
      </section>`;
  }

  // Tagesleiste: der Schultag als farbiger Streifen, mit Strich für "jetzt"
  function dayStrip(lessons, min, key) {
    const data = tt.timetable();
    const a = toMin(tt.lessonTime(lessons[0]).from);
    const b = toMin(tt.lessonTime(lessons.at(-1)).to);
    const span = Math.max(1, b - a);
    const pos = (m) => (((m - a) / span) * 100).toFixed(2);
    const blocks = lessons
      .map((l) => {
        const t = tt.lessonTime(l);
        const s = tt.subjectOf(l);
        const x0 = toMin(t.from);
        const x1 = toMin(t.to);
        const past = min != null && x1 <= min;
        return `<button class="td-strip-b${past ? ' past' : ''}" data-td="lesson" data-day="${key}" data-i="${data.lessons.indexOf(l)}" title="${esc(s?.name || l.subject)} ${t.from}–${t.to}"
            style="left:${pos(x0)}%;width:calc(${(((x1 - x0) / span) * 100).toFixed(2)}% - 3px);--c:${s?.color || '#868e96'}"><span>${esc(s?.short || l.subject)}</span></button>`;
      })
      .join('');
    const mark = min != null && min >= a && min <= b ? `<i class="td-strip-now" style="left:${pos(min)}%"></i>` : '';
    return `<div class="td-strip">${blocks}${mark}</div>
      <div class="td-strip-t"><span>${tt.lessonTime(lessons[0]).from}</span><span>${tt.lessonTime(lessons.at(-1)).to}</span></div>`;
  }

  // ---------- Fächer des Tages: mit den Notizen dazu ----------
  function subjectsHtml(now, notes, folders, P) {
    const date = shownDay(now);
    const lessons = tt.lessonsOn(date);
    const isToday = daysUntil(dayKey(date), now) === 0;
    const min = minutesNow(now);
    const seen = new Map();
    for (const l of lessons) {
      if (!seen.has(l.subject)) seen.set(l.subject, []);
      seen.get(l.subject).push(l);
    }
    const cards = [...seen.entries()]
      .map(([id, ls]) => {
        const s = tt.timetable().subjects[id];
        const f = folderFor(id, folders);
        const list = notesFor(id, notes, folders);
        const last = list[0];
        const over = isToday && ls.every((l) => toMin(tt.lessonTime(l).to) <= min);
        const when = ls.map((l) => `${tt.periodLabel(l)} · ${tt.lessonTime(l).from}${l.room ? ` · ${esc(l.room)}` : ''}`).join('<br>');
        const nxt = tt.upcomingLessons(id, date, 1)[0];
        return `<div class="td-sj${over ? ' over' : ''}" style="--c:${s?.color || '#868e96'}">
            <button class="td-sj-main" data-td="subject" data-subject="${esc(id)}">
              <span class="td-sj-ic">${ICON.folder}</span>
              <span class="td-sj-t"><b>${esc(s?.name || id)}</b>${s?.course ? `<em>${esc(s.course)}</em>` : ''}</span>
              <small class="td-sj-when">${when}</small>
              <small class="td-sj-meta">${list.length ? `${list.length} ${list.length === 1 ? 'Notiz' : 'Notizen'} · ` : ''}${nxt ? `wieder ${esc(relDay(nxt.date, now))}` : ''}</small>
            </button>
            <div class="td-sj-foot">
              ${last ? `<button class="td-sj-last" data-td="open-note" data-id="${esc(last.id)}">${ICON.note}<span>${esc(last.title || 'Ohne Titel')}</span><small>${esc(ago(last.updated))}</small></button>` : `<span class="td-sj-none">${f ? 'Noch keine Notiz' : 'Noch kein Ordner'}</span>`}
              <button class="td-sj-new" data-td="new-note" data-subject="${esc(id)}" aria-label="Neue Notiz in ${esc(s?.name || id)}" title="Neue Notiz">${ICON.plus}</button>
            </div>
          </div>`;
      })
      .join('');
    const n = daysUntil(dayKey(date), now);
    const title = n === 0 ? 'Fächer heute' : n === 1 ? 'Fächer morgen' : `Fächer am ${DAYS_LONG[date.getDay()]}`;
    return `<section class="td-card td-subjects">
        <header class="td-card-head"><span class="td-card-title">${ICON.folder}${title}</span><small class="td-card-sub">${seen.size} ${seen.size === 1 ? 'Fach' : 'Fächer'}</small></header>
        ${cards ? `<div class="td-sj-list">${cards}</div>` : '<p class="td-empty">An diesem Tag ist kein Unterricht.</p>'}
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
    if (act === 'new-note') {
      await newNoteIn(el.dataset.subject, folders);
      return true;
    }
    if (act === 'open-note') {
      api.openNote(el.dataset.id);
      return true;
    }
    if (act === 'day') {
      const d = schoolDay(shownDay(new Date()), Number(el.dataset.dir));
      if (d) pickedDay = dayKey(d);
      api.refresh();
      return true;
    }
    if (act === 'pick-day') {
      pickedDay = el.dataset.day;
      api.refresh();
      requestAnimationFrame(() => document.querySelector('.td-day')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
      return true;
    }
    if (act === 'day-today') {
      pickedDay = null;
      api.refresh();
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
    return false;
  }

  // Ordner zum Fach – gibt es ihn nicht, wird er (mit der Fachfarbe) angelegt
  async function ensureFolder(id, folders) {
    const f = folderFor(id, folders);
    if (f) return f;
    const s = tt.timetable().subjects[id];
    const folder = await api.createFolder(s?.name || id, s?.color);
    if (folder) toast(`Ordner „${s?.name || id}“ angelegt`);
    return folder;
  }

  async function newNoteIn(id, folders) {
    const f = await ensureFolder(id, folders);
    if (f) api.createNote(f.id, f.name);
  }

  async function openSubjectFolder(id, folders) {
    const f = folderFor(id, folders);
    if (f) return api.openFolder(f.id);
    const s = tt.timetable().subjects[id];
    const ok = await openDialog({
      html: `<div class="dlg-title">Ordner „${esc(s?.name || id)}“ anlegen?</div>
        <div class="dlg-text">Für dieses Fach gibt es noch keinen Ordner. Notizen darin erscheinen dann hier bei den Fächern und im Stunden-Blatt.</div>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button><button class="dlg-btn primary" data-dlg="ok">Anlegen</button></div>`,
      result: () => true,
    });
    if (ok) {
      const folder = await ensureFolder(id, folders);
      if (folder) api.openFolder(folder.id);
    }
  }

  // ---------- Stunden-Blatt: eine Stunde antippen ----------
  async function lessonSheet(l, date, { notes, folders }) {
    const P = getPrefs();
    const s = tt.subjectOf(l);
    const t = tt.lessonTime(l);
    const now = new Date();
    const upcoming = tt.upcomingLessons(l.subject, date, 2);
    const folder = folderFor(l.subject, folders);
    const list = notesFor(l.subject, notes, folders).slice(0, 5);
    const isToday = daysUntil(dayKey(date), now) === 0;
    const min = minutesNow(now);
    const state = isToday ? (toMin(t.to) <= min ? 'vorbei' : toMin(t.from) <= min ? `läuft · noch ${dur(toMin(t.to) - min)}` : `in ${dur(toMin(t.from) - min)}`) : '';
    // Alle Stunden des Fachs in der Woche
    const weekly = tt
      .timetable()
      .lessons.filter((x) => x.subject === l.subject)
      .sort((a, b) => a.day - b.day || a.period - b.period)
      .map((x) => `<span class="ls-wk${x === l ? ' on' : ''}">${tt.WEEKDAYS[x.day]} ${tt.periodLabel(x)}${x.weeks && x.weeks !== 'AB' ? ` <i>${x.weeks}</i>` : ''}</span>`)
      .join('');
    const result = await openDialog({
      wide: true,
      enter: false,
      html: `
        <div class="ls-head" style="--c:${s?.color || '#868e96'}">
          <div class="ls-course">${esc(s?.course || s?.short || '')}${l.weeks && l.weeks !== 'AB' ? ` · nur ${l.weeks}-Woche` : ''}${state ? ` · ${state}` : ''}</div>
          <div class="ls-title">${esc(s?.name || l.subject)}</div>
          <div class="ls-when">${DAYS_LONG[date.getDay()]}, ${date.getDate()}. ${MONTHS[date.getMonth()]} · ${tt.periodLabel(l)} Stunde</div>
        </div>
        <div class="ls-info">
          <span>${ICON.clock}${t.from} – ${t.to}</span>
          ${l.room ? `<span>${ICON.room}Raum ${esc(l.room)}</span>` : ''}
          ${l.teacher ? `<span>${ICON.person}${esc(tt.teacherName(l.teacher, P.fullTeacher))}</span>` : ''}
        </div>
        <div class="ls-sec"><div class="ls-sec-t">${ICON.cal}Jede Woche</div><div class="ls-wks">${weekly}</div>
          ${upcoming.length ? `<p class="ls-none">Nächste Stunden: ${upcoming.map((u) => `${esc(fmtDay(u.date))} ${tt.periodLabel(u.lesson)}`).join(' · ')}</p>` : ''}</div>
        <div class="ls-sec"><div class="ls-sec-t">${ICON.note}Notizen${folder ? ` in „${esc(folder.name)}“` : ''}</div>
          ${
            list.length
              ? list.map((n) => `<button class="ls-item ls-note" data-ls-note="${esc(n.id)}"><span class="ls-kind">${ICON.note}</span><span><b>${esc(n.title || 'Ohne Titel')}</b><small>${esc(ago(n.updated))}</small></span><span class="ls-edit">${ICON.right}</span></button>`).join('')
              : `<p class="ls-none">${folder ? 'Noch keine Notiz in diesem Fach.' : 'Noch kein Ordner für dieses Fach – „Neue Notiz“ legt ihn an.'}</p>`
          }</div>
        <div class="ls-actions">
          <button class="ls-act" data-ls="new" style="--k:${s?.color || 'var(--accent)'}">${ICON.pen}<span><b>Neue Notiz</b><small>in ${esc(folder?.name || s?.name || l.subject)}</small></span></button>
          <button class="ls-act" data-ls="folder" style="--k:${s?.color || 'var(--accent)'}">${ICON.folder}<span><b>${folder ? 'Ordner öffnen' : 'Ordner anlegen'}</b><small>${folder ? 'alle Notizen im Fach' : 'für Notizen in diesem Fach'}</small></span></button>
        </div>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Schließen</button></div>`,
      onReady(card, close) {
        card.addEventListener('click', (e) => {
          const a = e.target.closest('[data-ls]');
          if (a) return close({ act: a.dataset.ls });
          const n = e.target.closest('[data-ls-note]');
          if (n) return close({ act: 'note', id: n.dataset.lsNote });
        });
      },
      result: () => null,
    });
    if (!result) return;
    if (result.act === 'new') await newNoteIn(l.subject, folders);
    else if (result.act === 'folder') await openSubjectFolder(l.subject, folders);
    else if (result.act === 'note') api.openNote(result.id);
  }

  // Jede Minute auffrischen (die "Jetzt"-Karte und die Balken laufen mit)
  function startTicker(refresh) {
    stopTicker();
    ticker = setInterval(refresh, 60 * 1000);
  }
  function stopTicker() {
    clearInterval(ticker);
    ticker = 0;
  }

  return { html, click, startTicker, stopTicker };
}
