// settings.js – Fenster "Einstellungen" (Aussehen, Startseite, Stundenplan)
// Alles wirkt sofort (siehe theme.js); "Fertig" schließt nur.

import { openDialog, esc } from './dialog.js';
import { getPrefs, setPref, resetPrefs, ACCENTS, isDark } from './theme.js';
import * as tt from './timetable.js';
import { paint } from './paint.js';

const ICON = {
  auto: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 3.5a8.5 8.5 0 0 0 0 17z" fill="currentColor"/></svg>',
  light: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/></svg>',
  dark: '<svg viewBox="0 0 24 24"><path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/></svg>',
};

const SECTIONS = [
  ['now', 'Jetzt-Karte', 'Welche Stunde gerade läuft, mit Restzeit'],
  ['day', 'Tagesplan', 'Stunden des Tages wie in EduPage, zum Blättern'],
  ['subjects', 'Fächer des Tages', 'Jedes Fach mit Ordner, letzter Notiz und „Neue Notiz“'],
  ['week', 'Wochenplan', 'Ganze Woche Mo–Fr mit A/B-Woche'],
];

// Kleine Vorschau (als Canvas gemalt, damit der Samsung-Dunkelmodus sie nicht verfälscht)
const LOOK = {
  light: { bg: '#eef1f6', side: '#f9fafc', card: '#ffffff', accent: '#4a6cf7' },
  dark: { bg: '#101216', side: '#22262e', card: '#191c22', accent: '#7b93ff' },
};
function preview(k) {
  const tiles = (c) => `<i>${paint(c.side)}</i><i>${paint(c.accent)}</i><i>${paint(c.card)}</i>`;
  if (k === 'auto') return `<span class="st-prev st-split"><span>${paint(LOOK.light.bg)}${tiles(LOOK.light)}</span><span>${paint(LOOK.dark.bg)}${tiles(LOOK.dark)}</span></span>`;
  return `<span class="st-prev"><span>${paint(LOOK[k].bg)}${tiles(LOOK[k])}</span></span>`;
}

// onChange(key) wird bei jeder Änderung gerufen (z. B. Startseite neu malen)
export function openSettings({ onChange } = {}) {
  const changed = (key) => onChange?.(key);
  const render = (card) => {
    const P = getPrefs();
    const data = tt.timetable();
    const week = tt.weekOf();
    card.querySelector('.st-body').innerHTML = `
      <section class="st-sec">
        <h3>Aussehen</h3>
        <div class="st-themes">
          ${[
            ['auto', 'Wie das Tablet', 'hell oder dunkel'],
            ['light', 'Hell', 'weißer Hintergrund'],
            ['dark', 'Dunkel', 'immer dunkel'],
          ]
            .map(
              ([k, label, sub]) => `<button class="st-theme st-${k}${P.theme === k ? ' on' : ''}" data-st="theme" data-v="${k}">
                ${preview(k)}
                <span class="st-tl">${ICON[k]}<b>${label}</b></span><small>${sub}</small></button>`
            )
            .join('')}
        </div>
        ${P.theme === 'light' && matchMedia('(prefers-color-scheme: dark)').matches ? `<p class="st-note">Bleibt es trotzdem dunkel? Dann dunkelt Samsung Internet die Seite selbst ab: In Samsung Internet unter <b>Einstellungen → Erscheinungsbild → Dunkelmodus</b> „Webseiten“ ausschalten. Federleicht hat ja einen eigenen, schöneren Dunkelmodus.</p>` : ''}
        <div class="st-row"><span><b>Akzentfarbe</b><small>Knöpfe, Markierungen, Jetzt-Karte</small></span>
          <div class="st-accents">${Object.entries(ACCENTS)
            .map(([k, a]) => `<button class="st-accent${P.accent === k ? ' on' : ''}" data-st="accent" data-v="${k}" aria-label="${a.name}" title="${a.name}">${paint(isDark() ? a.dark : a.light)}</button>`)
            .join('')}</div></div>
      </section>
      <section class="st-sec">
        <h3>Startseite</h3>
        <div class="st-row"><span><b>Beim Öffnen</b><small>Was kommt, wenn du die App startest</small></span>
          <div class="st-seg">${[
            ['today', 'Heute'],
            ['all', 'Alle Notizen'],
            ['last', 'Wie zuletzt'],
          ]
            .map(([k, l]) => `<button class="${P.start === k ? 'on' : ''}" data-st="start" data-v="${k}">${l}</button>`)
            .join('')}</div></div>
        <label class="st-row"><span><b>Dein Name</b><small>Für die Begrüßung („Guten Morgen, …“)</small></span>
          <input class="dlg-input st-name" maxlength="30" placeholder="Name" value="${esc(P.name || '')}" /></label>
        <div class="st-sub">Was die Seite „Heute“ zeigt</div>
        ${SECTIONS.map(
          ([k, label, hint]) => `<label class="switch-row st-row"><span><b>${label}</b><small>${hint}</small></span>
            <input type="checkbox" class="switch" data-st="section" data-v="${k}" ${P.sections[k] ? 'checked' : ''} /></label>`
        ).join('')}
        <label class="switch-row st-row"><span><b>Pausen im Tagesplan</b><small>„Pause · 15 min“ zwischen den Stunden</small></span>
          <input type="checkbox" class="switch" data-st="breaks" ${P.breaks ? 'checked' : ''} /></label>
        <label class="switch-row st-row"><span><b>Volle Namen der Lehrkräfte</b><small>„Gerhard Schott“ statt „Scho“</small></span>
          <input type="checkbox" class="switch" data-st="fullTeacher" ${P.fullTeacher ? 'checked' : ''} /></label>
      </section>
      <section class="st-sec">
        <h3>Stundenplan</h3>
        <label class="switch-row st-row"><span><b>A/B-Wochen</b><small>Manche Stunden nur in A- oder B-Wochen</small></span>
          <input type="checkbox" class="switch" data-st="ab" ${data.abWeeks ? 'checked' : ''} /></label>
        ${
          data.abWeeks
            ? `<div class="st-row"><span><b>Diese Woche ist</b><small>Nach den Ferien hier umstellen</small></span>
          <div class="st-seg">${['A', 'B'].map((w) => `<button class="${week === w ? 'on' : ''}" data-st="week" data-v="${w}">${w}-Woche</button>`).join('')}</div></div>`
            : ''
        }
      </section>
      <button class="st-reset" data-st="reset">Einstellungen zurücksetzen</button>
      <p class="st-ver"></p>`;
    // Welche Version läuft? (Name des Caches vom Service Worker, siehe sw.js)
    window.caches
      ?.keys()
      .then((names) => {
        const v = names.find((n) => n.startsWith('federleicht-'))?.slice(12);
        const out = card.querySelector('.st-ver');
        if (out) out.textContent = `Federleicht · Version ${v || 'Entwicklung'}`;
      })
      .catch(() => {});
  };

  return openDialog({
    wide: true,
    enter: false,
    html: `<div class="st"><div class="dlg-title">Einstellungen</div><div class="st-body"></div>
      <div class="dlg-btns"><button class="dlg-btn primary" data-dlg="ok">Fertig</button></div></div>`,
    onReady(card) {
      render(card);
      card.addEventListener('click', (e) => {
        const b = e.target.closest('button[data-st]');
        if (!b) return;
        const k = b.dataset.st;
        const v = b.dataset.v;
        if (k === 'theme' || k === 'accent' || k === 'start') setPref(k, v);
        else if (k === 'week') tt.setThisWeek(v);
        else if (k === 'reset') resetPrefs();
        else return;
        render(card);
        changed(k);
      });
      card.addEventListener('change', (e) => {
        const el = e.target;
        const k = el.dataset?.st;
        if (!k) return;
        if (k === 'section') setPref('sections', { ...getPrefs().sections, [el.dataset.v]: el.checked });
        else if (k === 'ab') {
          tt.timetable().abWeeks = el.checked;
          tt.save();
          render(card);
        } else if (k === 'breaks' || k === 'fullTeacher') setPref(k, el.checked);
        changed(k);
      });
      card.addEventListener('input', (e) => {
        if (!e.target.classList.contains('st-name')) return;
        setPref('name', e.target.value.trim());
        changed('name');
      });
    },
    result: () => true,
  });
}
