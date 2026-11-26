// today.js – Startseite "Heute": Stundenplan, was gerade läuft, Hausaufgaben und Termine
//
//   ┌ Do, 26. November · B-Woche [A|B] ─────────────────────────────┐
//   │ JETZT  Deutsch · C10 · noch 23 min  ▓▓▓▓▓▓░░░                 │
//   │ Heute: 3 Deutsch  4 Deutsch  5 Geo  7 Geschichte (Stunden-Karten)│
//   ├ Hausaufgaben (aus allen Notizen + selbst eingetragen) ─────────┤
//   │ ○ S. 54 Nr. 3   Mathe · morgen                                 │
//   ├ Termine (Tests, Klausuren …) ──────────────────────────────────┤
//   └ Wochenplan (Mo–Fr), aktuelle Stunde leuchtet, Fach antippen = Ordner öffnen ┘
//
// Selbst eingetragene Hausaufgaben/Termine (ohne Notiz) stehen in localStorage (federleicht.tasks):
//   [{ id, kind: 'hw' | 'test' | 'event', subject: 'ma', text, due: 'JJJJ-MM-TT', done, doneAt }]
// Hausaufgaben aus Notizen stehen in der Notiz (note.homework, siehe homework.js).

import * as tt from './timetable.js';
import { collectHomework, groupHomework, dueLabel, daysUntil, dayKey, HW_ICON } from './homework.js';
import { openDialog, toast, esc } from './dialog.js';
import { uid } from './store.js';

const TASKS_KEY = 'federleicht.tasks';
const ICON = {
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  test: '<svg viewBox="0 0 24 24"><path d="M12 3.5 3.5 8 12 12.5 20.5 8z"/><path d="M7 10.2v4.3c0 1.4 2.2 2.8 5 2.8s5-1.4 5-2.8v-4.3M20.5 8v5"/></svg>',
  cal: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/></svg>',
  pin: '<svg viewBox="0 0 24 24"><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/></svg>',
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h12l-3-3M17 17H5l3 3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};
const KIND = {
  hw: { label: 'Hausaufgabe', icon: HW_ICON },
  test: { label: 'Test / Klausur', icon: ICON.test },
  event: { label: 'Termin', icon: ICON.cal },
};
const DAYS_LONG = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ---------- Selbst eingetragene Aufgaben/Termine ----------
export function loadTasks() {
  try {
    const list = JSON.parse(localStorage.getItem(TASKS_KEY));
    return Array.isArray(list) ? list : [];
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

// api: { openNote(id, focus), openFolder(id), createFolder(name, color) -> folder, saveNoteMeta(note), refresh() }
export function setupToday(api) {
  let showWeek = null; // im Wochenplan angezeigte Woche ('A' | 'B'), null = aktuelle
  let ticker = 0;

  // Ordner, der zu einem Fach gehört
  const folderFor = (subjectId, folders) => folders.find((f) => tt.subjectIdFor(f.name) === subjectId) || null;
  // Fach einer Hausaufgabe aus einer Notiz (über den Ordnernamen)
  const subjectOfHw = (hw, note, folders) => tt.subjectIdFor(hw.subject) || tt.subjectIdFor(folders.find((f) => f.id === note.folderId)?.name);

  function html({ notes, folders }) {
    const data = tt.timetable();
    const now = new Date();
    const week = tt.weekOf(now);
    const { current, next, today } = tt.nowAndNext(now);
    const weekend = now.getDay() === 0 || now.getDay() === 6;

    // Alle Hausaufgaben: aus Notizen + selbst eingetragene
    const fromNotes = collectHomework(notes).map(({ hw, note }) => ({ hw, note, subject: subjectOfHw(hw, note, folders) }));
    const tasks = loadTasks();
    const own = tasks.filter((t) => t.kind === 'hw').map((t) => ({ hw: t, own: true, subject: t.subject }));
    const groups = groupHomework([...fromNotes, ...own], now);
    const events = tasks.filter((t) => t.kind !== 'hw' && daysUntil(t.due) >= 0).sort((a, b) => a.due.localeCompare(b.due));
    const openHw = [...fromNotes, ...own].filter((x) => !x.hw.done);

    // Was steht für einen Tag an? (für Stunden-Karten: "2 HA fällig")
    const dueCount = (subject, date) => openHw.filter((x) => x.subject === subject && x.hw.due === dayKey(date)).length;
    const testOn = (subject, date) => events.find((e) => e.subject === subject && e.due === dayKey(date));

    // ---- Kopf: Datum, A/B, jetzt / als nächstes ----
    const head = `
      <div class="td-head">
        <div class="td-date"><b>${DAYS_LONG[now.getDay()]}, ${now.getDate()}. ${MONTHS[now.getMonth()]}</b>
          ${week ? `<button class="td-week" data-td="switch-week" title="A/B-Woche umstellen (z. B. nach den Ferien)">${week}-Woche ${ICON.swap}</button>` : ''}
        </div>
        ${nowCard(current, next, today, weekend, folders)}
      </div>`;

    // ---- Heutige (bzw. nächste) Stunden als Karten ----
    let dayDate = now;
    let dayLessons = today;
    let dayTitle = 'Heute';
    const after = today.length && !current && !next; // Schule für heute vorbei
    if (!today.length || after || weekend) {
      for (let i = 1; i < 8; i++) {
        const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
        const l = tt.lessonsOn(d);
        if (l.length) {
          dayDate = d;
          dayLessons = l;
          dayTitle = i === 1 ? 'Morgen' : DAYS_LONG[d.getDay()];
          break;
        }
      }
    }
    const cards = dayLessons
      .map((l) => {
        const s = tt.subjectOf(l);
        const t = tt.lessonTime(l);
        const n = dueCount(l.subject, dayDate);
        const test = testOn(l.subject, dayDate);
        const on = l === current;
        const periods = l.len > 1 ? `${l.period}./${l.period + l.len - 1}.` : `${l.period}.`;
        return `<button class="td-lesson${on ? ' now' : ''}" data-td="subject" data-subject="${l.subject}" style="--c:${s?.color || '#868e96'}">
          <span class="td-l-time">${periods} · ${t.from}</span>
          <b>${esc(s?.name || l.subject)}</b>
          <span class="td-l-room">${esc(l.room || '')}</span>
          ${n ? `<span class="td-l-hw">${HW_ICON}${n} HA</span>` : ''}${test ? `<span class="td-l-test">${ICON.test}${esc(test.text || 'Test')}</span>` : ''}
        </button>`;
      })
      .join('');
    const day = dayLessons.length
      ? `<section class="td-sec"><div class="td-sec-head"><span>${dayTitle}</span><small>${dayLessons.length} ${dayLessons.length === 1 ? 'Stunde' : 'Stunden'}</small></div>
          <div class="td-lessons">${cards}</div></section>`
      : '';

    // ---- Hausaufgaben ----
    const hwRow = (x) => {
      const s = data.subjects[x.subject];
      const late = !x.hw.done && daysUntil(x.hw.due) < 0;
      const soon = !x.hw.done && daysUntil(x.hw.due) <= 1;
      const where = x.own ? '' : ` · ${esc(x.note.title || 'Notiz')}`;
      return `<div class="td-hw${x.hw.done ? ' done' : ''}">
        <button class="hw-check${x.hw.done ? ' on' : ''}" data-td="hw-toggle" data-id="${x.hw.id}" aria-label="Erledigt">${ICON.check}</button>
        <button class="td-hw-main" data-td="hw-open" data-id="${x.hw.id}">
          <span class="td-hw-t">${esc(x.hw.text || 'Hausaufgabe')}</span>
          <small>${s ? `<i class="td-dot" style="--c:${s.color}"></i>${esc(s.name)} · ` : ''}<span class="${late ? 'late' : soon ? 'soon' : ''}">${x.hw.done ? 'erledigt' : esc(dueLabel(x.hw.due, { long: true }))}</span>${where}</small>
        </button>
        ${x.own ? `<button class="td-del" data-td="task-del" data-id="${x.hw.id}" aria-label="Löschen">${ICON.trash}</button>` : ''}
      </div>`;
    };
    const hw = `<section class="td-sec td-hws">
        <div class="td-sec-head"><span>${HW_ICON}Hausaufgaben</span><small>${openHw.length ? `${openHw.length} offen` : ''}</small>
          <button class="td-add" data-td="add" data-kind="hw">${ICON.plus}<span>Eintragen</span></button></div>
        ${
          groups.length
            ? groups.map((g) => `<div class="td-group td-g-${g.id}"><div class="td-g-title">${g.title}</div>${g.items.map(hwRow).join('')}</div>`).join('')
            : `<p class="td-empty">Keine Hausaufgaben 🎉<br><small>In einer Notiz: Knopf „Hausaufgabe markieren“ und einen Rahmen um die Aufgabe ziehen.</small></p>`
        }
      </section>`;

    // ---- Termine ----
    const ev = `<section class="td-sec td-events">
        <div class="td-sec-head"><span>${ICON.cal}Termine</span><small>${events.length || ''}</small>
          <button class="td-add" data-td="add" data-kind="test">${ICON.plus}<span>Test / Termin</span></button></div>
        ${
          events.length
            ? events
                .map((e) => {
                  const s = data.subjects[e.subject];
                  const n = daysUntil(e.due);
                  return `<div class="td-ev">
                    <span class="td-ev-ic${e.kind === 'test' ? ' test' : ''}">${KIND[e.kind]?.icon || ICON.cal}</span>
                    <span class="td-ev-main"><b>${esc(e.text || KIND[e.kind]?.label)}</b>
                      <small>${s ? `${esc(s.name)} · ` : ''}${esc(dueLabel(e.due))}${n > 1 ? ` · in ${n} Tagen` : ''}</small></span>
                    <button class="td-del" data-td="task-del" data-id="${e.id}" aria-label="Löschen">${ICON.trash}</button>
                  </div>`;
                })
                .join('')
            : '<p class="td-empty"><small>Tests, Klausuren, Abgaben – mit „+“ eintragen.</small></p>'
        }
      </section>`;

    return `<div class="td">${head}${day}<div class="td-cols">${hw}${ev}</div>${weekGrid(now, current, folders)}</div>`;
  }

  // Karte "Jetzt" / "Als Nächstes"
  function nowCard(current, next, today, weekend, folders) {
    const fmt = (l) => {
      const s = tt.subjectOf(l);
      return `<b style="--c:${s?.color || 'var(--accent)'}">${esc(s?.name || l.subject)}</b>${l.room ? ` · ${esc(l.room)}` : ''}`;
    };
    if (current) {
      const t = tt.lessonTime(current);
      const now = new Date();
      const [fh, fm] = t.from.split(':').map(Number);
      const [th, tm] = t.to.split(':').map(Number);
      const start = fh * 60 + fm;
      const end = th * 60 + tm;
      const min = now.getHours() * 60 + now.getMinutes();
      const left = Math.max(0, end - min);
      const pct = Math.round(((min - start) / Math.max(1, end - start)) * 100);
      return `<button class="td-now" data-td="subject" data-subject="${current.subject}">
          <span class="td-now-label">Jetzt</span><span class="td-now-text">${fmt(current)} · noch ${left} min</span>
          ${next ? `<span class="td-now-next">danach ${fmt(next)} um ${tt.lessonTime(next).from}</span>` : ''}
          <span class="td-bar"><i style="width:${pct}%"></i></span>
        </button>`;
    }
    if (next) {
      const t = tt.lessonTime(next);
      return `<button class="td-now soon" data-td="subject" data-subject="${next.subject}">
          <span class="td-now-label">Als Nächstes</span><span class="td-now-text">${fmt(next)} um ${t.from}</span>
        </button>`;
    }
    if (weekend) return '<div class="td-now free"><span class="td-now-label">Wochenende</span><span class="td-now-text">Keine Schule 😎</span></div>';
    if (today.length) return '<div class="td-now free"><span class="td-now-label">Schule ist aus</span><span class="td-now-text">Für heute geschafft</span></div>';
    return '<div class="td-now free"><span class="td-now-label">Heute</span><span class="td-now-text">Kein Unterricht</span></div>';
  }

  // Wochenplan Mo–Fr
  function weekGrid(now, current, folders) {
    const data = tt.timetable();
    const thisWeek = tt.weekOf(now);
    const week = showWeek || thisWeek;
    // Montag der angezeigten Woche (andere Woche = nächste Woche)
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7) + (week !== thisWeek ? 7 : 0));
    const todayCol = week === thisWeek ? now.getDay() : -1;
    const rows = data.periods.length;
    const cells = [];
    for (let day = 1; day <= 5; day++) {
      const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day - 1);
      for (const l of tt.lessonsOn(date)) {
        const s = tt.subjectOf(l);
        const on = l === current && week === thisWeek;
        const stacked = tt.lessonsOn(date).filter((o) => o.period === l.period).length > 1;
        cells.push(`<button class="tw-cell${on ? ' now' : ''}${stacked ? ' half' : ''}" data-td="subject" data-subject="${l.subject}"
            style="grid-column:${day + 1};grid-row:${l.period + 1} / span ${l.len || 1};--c:${s?.color || '#868e96'}">
            <b>${esc(s?.short || l.subject)}</b><small>${esc(l.room || '')}</small></button>`);
      }
    }
    const head = ['<span class="tw-corner"></span>']
      .concat(['Mo', 'Di', 'Mi', 'Do', 'Fr'].map((d, i) => `<span class="tw-day${i + 1 === todayCol ? ' today' : ''}" style="grid-column:${i + 2}">${d}</span>`))
      .join('');
    const times = data.periods.map((p, i) => `<span class="tw-time" style="grid-row:${i + 2}"><b>${i + 1}</b><small>${p.from}</small></span>`).join('');
    return `<section class="td-sec tw">
        <div class="td-sec-head"><span>${ICON.cal}Wochenplan</span>
          ${thisWeek ? `<div class="tw-ab">${['A', 'B'].map((w) => `<button class="${w === week ? 'on' : ''}" data-td="show-week" data-week="${w}">${w}${w === thisWeek ? ' · jetzt' : ''}</button>`).join('')}</div>` : ''}
        </div>
        <div class="tw-grid" style="grid-template-rows:auto repeat(${rows}, minmax(38px, auto))">${head}${times}${cells.join('')}</div>
        <p class="td-empty"><small>Fach antippen = Ordner öffnen. Gibt es noch keinen, legt die App ihn an.</small></p>
      </section>`;
  }

  // ---------- Bedienen ----------
  async function click(e, { notes, folders }) {
    const el = e.target.closest('[data-td]');
    if (!el) return false;
    const act = el.dataset.td;
    if (act === 'subject') {
      const id = el.dataset.subject;
      const f = folderFor(id, folders);
      if (f) api.openFolder(f.id);
      else {
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
      const t = await editTask({ kind: el.dataset.kind });
      if (t) {
        saveTasks([...loadTasks(), { id: uid(), done: false, created: Date.now(), ...t }]);
        api.refresh();
      }
      return true;
    }
    if (act === 'task-del') {
      const list = loadTasks();
      const t = list.find((x) => x.id === el.dataset.id);
      saveTasks(list.filter((x) => x.id !== el.dataset.id));
      api.refresh();
      if (t) toast('Gelöscht', { label: 'Rückgängig', run: () => (saveTasks([...loadTasks(), t]), api.refresh()) });
      return true;
    }
    const id = el.dataset.id;
    const own = loadTasks();
    const ownTask = own.find((t) => t.id === id);
    const found = ownTask ? null : collectHomework(notes).find((x) => x.hw.id === id);
    if (act === 'hw-toggle') {
      if (ownTask) {
        ownTask.done = !ownTask.done;
        ownTask.doneAt = ownTask.done ? Date.now() : undefined;
        saveTasks(own);
      } else if (found) {
        found.hw.done = !found.hw.done;
        found.hw.doneAt = found.hw.done ? Date.now() : undefined;
        await api.saveNoteMeta(found.note);
      }
      api.refresh();
      return true;
    }
    if (act === 'hw-open') {
      if (found) {
        const pageIndex = Math.max(0, (found.note.pageIds || []).indexOf(found.hw.pageId));
        api.openNote(found.note.id, { pageIndex, box: found.hw.box });
      } else if (ownTask) {
        const t = await editTask(ownTask);
        if (t) {
          Object.assign(ownTask, t);
          saveTasks(own);
          api.refresh();
        }
      }
      return true;
    }
    return false;
  }

  // Fenster: Hausaufgabe / Test / Termin selbst eintragen
  function editTask(task) {
    const data = tt.timetable();
    let kind = task.kind || 'hw';
    let subject = task.subject || '';
    let due = task.due || dayKey(new Date(Date.now() + 86400000));
    const subjects = Object.entries(data.subjects).filter(([id]) => data.lessons.some((l) => l.subject === id));
    return openDialog({
      enter: false,
      html: `
        <div class="dlg-title">${task.id ? 'Bearbeiten' : 'Eintragen'}</div>
        <div class="hw-chips td-kinds">${Object.entries(KIND).map(([k, v]) => `<button class="hw-chip" data-kind="${k}">${v.label}</button>`).join('')}</div>
        <textarea class="dlg-input hw-text" rows="2" maxlength="300" placeholder="Was? (z. B. S. 54 Nr. 3, Vokabeltest Unit 4)">${esc(task.text || '')}</textarea>
        <div class="hw-due-title">Fach</div>
        <div class="hw-chips">${subjects.map(([id, s]) => `<button class="hw-chip td-subj" data-subj="${id}" style="--c:${s.color}">${esc(s.name)}</button>`).join('')}</div>
        <div class="hw-due-title">Wann? <small class="td-why"></small></div>
        <div class="hw-chips td-dates"></div>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button><button class="dlg-btn primary" data-dlg="ok">Speichern</button></div>`,
      onReady(card) {
        const draw = () => {
          for (const b of card.querySelectorAll('[data-kind]')) b.classList.toggle('on', b.dataset.kind === kind);
          for (const b of card.querySelectorAll('[data-subj]')) b.classList.toggle('on', b.dataset.subj === subject);
          const opts = [];
          const next = subject ? tt.nextLessonDate(data.subjects[subject]?.name) : null;
          if (next) opts.push({ key: dayKey(next), label: `Nächste Stunde (${dueLabel(dayKey(next))})` });
          const base = new Date();
          for (const n of [1, 2, 7]) {
            const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + n);
            opts.push({ key: dayKey(d), label: n === 7 ? 'in 1 Woche' : dueLabel(dayKey(d)) });
          }
          const seen = new Set();
          card.querySelector('.td-dates').innerHTML =
            opts
              .filter((o) => (seen.has(o.key) ? false : seen.add(o.key)))
              .map((o) => `<button class="hw-chip${o.key === due ? ' on' : ''}" data-due="${o.key}">${esc(o.label)}</button>`)
              .join('') + `<label class="hw-chip hw-date${opts.some((o) => o.key === due) ? '' : ' on'}"><input type="date" value="${due}" /></label>`;
        };
        draw();
        card.addEventListener('click', (e) => {
          const k = e.target.closest('[data-kind]');
          const s = e.target.closest('[data-subj]');
          const d = e.target.closest('[data-due]');
          if (k) kind = k.dataset.kind;
          if (s) {
            subject = subject === s.dataset.subj ? '' : s.dataset.subj;
            const next = subject ? tt.nextLessonDate(data.subjects[subject]?.name) : null;
            if (next && kind === 'hw') due = dayKey(next);
          }
          if (d) due = d.dataset.due;
          if (k || s || d) draw();
        });
        card.addEventListener('change', (e) => {
          if (e.target.type === 'date' && e.target.value) {
            due = e.target.value;
            draw();
          }
        });
        setTimeout(() => card.querySelector('textarea').focus(), 60);
      },
      result(card) {
        const text = card.querySelector('textarea').value.trim();
        if (!text && kind === 'hw') {
          card.querySelector('textarea').classList.add('shake');
          return undefined;
        }
        return { kind, subject, text, due };
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

  return { html, click, startTicker, stopTicker };
}
