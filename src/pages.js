// pages.js – alles rund um Seiten: Vorlagen-Menü, Seite hinzufügen, Seitenübersicht
//
// Bedienung (ähnlich wie Samsung Notes):
//   [+] oben              -> neue Seite nach der aktuellen
//   [Vorlage] oben        -> Menü: Linien, Abstand, Papierfarbe, dunkles Blatt
//   [1 / 3] oben          -> Seitenübersicht: alle Seiten als kleine Bilder
//       antippen          -> zu der Seite springen
//       lange drücken     -> Seite ziehen und woanders ablegen (Reihenfolge ändern)
//       "…"               -> einfügen, duplizieren, Vorlage, löschen
//   Unter der letzten Seite: großer "+ Seite"-Knopf
//
// Die eigentliche Arbeit (Seiten ändern, Rückgängig) macht main.js über "api".

import { TEMPLATES, PAPERS, hasSpacing, paperColor, drawThumbnail } from './templates.js';
import { paint } from './paint.js';
import { fillStroke, setInkTheme, inkTheme } from './ink.js';
import { PAGE_WIDTH } from './view.js';

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  before: '<svg viewBox="0 0 24 24"><rect x="6" y="10" width="12" height="11" rx="2"/><path d="M12 2.5v5M9.5 5h5"/></svg>',
  after: '<svg viewBox="0 0 24 24"><rect x="6" y="3" width="12" height="11" rx="2"/><path d="M12 16.5v5M9.5 19h5"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg>',
  template: '<svg viewBox="0 0 24 24"><rect x="4.5" y="3" width="15" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
};

const SPACINGS = [
  { v: 'S', name: 'Eng' },
  { v: 'M', name: 'Mittel' },
  { v: 'L', name: 'Weit' },
];

export function setupPages(api) {
  const { doc } = api;
  const popup = document.getElementById('page-popup');
  const templateBtn = document.getElementById('btn-template');
  const pagesBtn = document.getElementById('btn-pages');
  const addBtn = document.getElementById('btn-add-page');
  const addEnd = document.getElementById('add-page-end');
  const indicator = document.getElementById('page-indicator');
  const overview = document.getElementById('overview');

  let scope = 'page';   // Vorlage ändern für: 'page' (diese Seite) oder 'all' (alle Seiten)
  let popupPage = 0;    // für welche Seite ist das Vorlagen-Menü offen?
  let lastIndex = -1;
  let lastCount = -1;
  let indicatorTimer = 0;

  // ---------- Seite hinzufügen ----------
  addBtn.addEventListener('click', () => {
    const at = api.current() + 1;
    api.addPage(at);
    api.goTo(at);
  });
  addEnd.addEventListener('click', () => {
    api.addPage(doc.count);
    api.goTo(doc.count - 1);
  });

  // ---------- Vorlagen-Menü ----------
  templateBtn.addEventListener('click', () => {
    if (!popup.hidden) closePopup();
    else openPopup(api.current());
  });

  function openPopup(index) {
    api.closeOtherPopups();
    popupPage = index;
    popup.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">Seitenvorlage</span>
        <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
      </div>
      <div class="tpl-grid">
        ${TEMPLATES.map(
          (t) => `<button class="tpl" data-kind="${t.id}"><span class="tpl-thumb"><canvas></canvas></span><span class="tpl-name">${t.name}</span></button>`
        ).join('')}
      </div>
      <div class="sect" data-spacing-sect>
        <div class="sect-label">Linienabstand</div>
        <div class="tabs three" data-seg="spacing">
          ${SPACINGS.map((s) => `<button data-v="${s.v}">${s.name}</button>`).join('')}
        </div>
      </div>
      <div class="sect">
        <div class="sect-label">Papierfarbe</div>
        <div class="paper-row">
          ${PAPERS.map((p) => `<button class="paper-btn" data-paper="${p.id}" title="${p.name}" aria-label="${p.name}">${paint('#ffffff')}</button>`).join('')}
        </div>
      </div>
      <div class="sect">
        <div class="sect-label">Ändern für</div>
        <div class="tabs" data-seg="scope">
          <button data-v="page">Diese Seite</button>
          <button data-v="all">Alle Seiten</button>
        </div>
      </div>
      <label class="switch-row">
        <span>Dunkles Blatt im Dunkelmodus<small>Schwarz und Weiß werden getauscht</small></span>
        <input type="checkbox" class="switch" data-toggle="darkPaper" />
      </label>`;
    popup.hidden = false;
    place(popup, templateBtn);
    templateBtn.classList.add('active');
    refreshPopup();
  }

  function closePopup() {
    if (popup.hidden) return;
    popup.hidden = true;
    popup.innerHTML = '';
    templateBtn.classList.remove('active');
  }

  // Popup unter den Knopf setzen, aber nicht über den Bildschirmrand hinaus
  function place(el, button) {
    const b = button.getBoundingClientRect();
    const w = el.offsetWidth;
    el.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2))}px`;
    el.style.top = `${b.bottom + 12}px`;
  }

  function refreshPopup() {
    if (popup.hidden) return;
    const page = doc.pages[Math.min(popupPage, doc.count - 1)];
    const tpl = page.template;
    const dark = api.darkPaper();
    popup.querySelector('.popup-title').textContent = doc.count > 1 ? `Seitenvorlage · Seite ${popupPage + 1}` : 'Seitenvorlage';
    for (const b of popup.querySelectorAll('[data-kind]')) {
      b.classList.toggle('selected', b.dataset.kind === tpl.kind);
      drawThumbnail(b.querySelector('canvas'), { ...tpl, kind: b.dataset.kind }, { dark, crop: 0.4 });
    }
    popup.querySelector('[data-spacing-sect]').classList.toggle('off', !hasSpacing(tpl.kind));
    for (const b of popup.querySelectorAll('[data-seg="spacing"] button')) b.classList.toggle('selected', b.dataset.v === tpl.spacing);
    for (const b of popup.querySelectorAll('[data-seg="scope"] button')) b.classList.toggle('selected', b.dataset.v === scope);
    for (const b of popup.querySelectorAll('[data-paper]')) {
      b.classList.toggle('selected', b.dataset.paper === tpl.paper);
      b.querySelector('canvas').dataset.c = paperColor(b.dataset.paper, dark);
    }
    popup.querySelector('[data-toggle="darkPaper"]').checked = api.darkPaperSetting();
  }

  // Vorlage ändern: nur diese Seite oder alle
  function changeTemplate(changes) {
    const base = doc.pages[popupPage].template;
    const tpl = { ...base, ...changes };
    const indices = scope === 'all' ? doc.pages.map((_, i) => i) : [popupPage];
    api.setTemplate(indices, tpl);
  }

  popup.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('close' in d) return closePopup();
    if (d.kind) changeTemplate({ kind: d.kind });
    if (d.paper) changeTemplate({ paper: d.paper });
    const seg = b.closest('[data-seg]')?.dataset.seg;
    if (seg === 'spacing') changeTemplate({ spacing: d.v });
    if (seg === 'scope') {
      scope = d.v;
      // "Alle Seiten" gewählt: Die Vorlage dieser Seite gilt sofort überall
      if (scope === 'all') changeTemplate({});
    }
    refreshPopup();
  });
  popup.addEventListener('change', (e) => {
    if (e.target.dataset.toggle === 'darkPaper') api.setDarkPaperSetting(e.target.checked);
  });

  // Daneben tippen schließt das Menü (und malt dabei nicht aus Versehen)
  closeOnOutside(popup, () => !popup.hidden, closePopup, (t) => t.closest('#btn-template'));
  window.addEventListener('resize', closePopup);
  // Am PC: Esc schließt Menü und Übersicht
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!popup.hidden) closePopup();
    else if (!overview.hidden) closeOverview();
  });

  // ---------- Seitenübersicht ----------
  pagesBtn.addEventListener('click', () => (overview.hidden ? openOverview() : closeOverview()));

  let menuFor = -1; // für welche Seite ist das "…"-Menü offen?

  function openOverview() {
    closePopup();
    api.closeOtherPopups();
    overview.hidden = false;
    pagesBtn.classList.add('active');
    buildOverview();
    // zur aktuellen Seite scrollen
    const card = overview.querySelector(`.ov-card[data-i="${api.current()}"]`);
    card?.scrollIntoView({ block: 'center' });
  }

  function closeOverview() {
    overview.hidden = true;
    overview.innerHTML = '';
    pagesBtn.classList.remove('active');
    menuFor = -1;
  }

  function buildOverview() {
    const current = api.current();
    overview.innerHTML = `
      <div class="ov-head">
        <span class="ov-title">Seiten</span>
        <span class="ov-count">${doc.count} ${doc.count === 1 ? 'Seite' : 'Seiten'}</span>
        <button class="head-btn" data-ov-close title="Schließen">${ICON.close}</button>
      </div>
      <div class="ov-grid">
        ${doc.pages
          .map(
            (p, i) => `<div class="ov-card${i === current ? ' current' : ''}" data-i="${i}">
              <div class="ov-thumb"><canvas></canvas></div>
              <div class="ov-foot"><span class="ov-num">${i + 1}</span><button class="ov-more" data-more="${i}" aria-label="Mehr">${ICON.more}</button></div>
            </div>`
          )
          .join('')}
        <button class="ov-add" data-add aria-label="Seite hinzufügen"><span>${ICON.plus}</span>Seite hinzufügen</button>
      </div>
      <div class="ov-hint">Antippen zum Hinspringen · lange drücken und ziehen zum Verschieben</div>
      <div class="ov-menu" hidden></div>`;
    drawOverviewThumbs();
  }

  function drawOverviewThumbs() {
    const dark = api.darkPaper();
    const saved = { ...inkTheme };
    for (const card of overview.querySelectorAll('.ov-card')) {
      const page = doc.pages[Number(card.dataset.i)];
      setInkTheme(dark, paperColor(page.template.paper, dark));
      drawThumbnail(card.querySelector('canvas'), page.template, { dark, faint: true, strokes: page.strokes, fill: fillStroke });
    }
    setInkTheme(saved.dark, saved.paper);
  }

  overview.addEventListener('click', (e) => {
    if (dragJustEnded) return;
    const b = e.target.closest('button');
    const menu = overview.querySelector('.ov-menu');
    if (b && 'ovClose' in b.dataset) return closeOverview();
    if (b && 'add' in b.dataset) {
      api.addPage(doc.count);
      buildOverview();
      overview.querySelector('.ov-grid').lastElementChild.scrollIntoView({ block: 'end', behavior: 'smooth' });
      return;
    }
    if (b && b.dataset.more !== undefined) return openMenu(Number(b.dataset.more), b);
    if (b && b.dataset.act) return runMenu(b.dataset.act, b);
    if (!menu.hidden && !e.target.closest('.ov-menu')) {
      menu.hidden = true;
      menuFor = -1;
      return;
    }
    const card = e.target.closest('.ov-card');
    if (card) {
      api.goTo(Number(card.dataset.i), false);
      closeOverview();
    }
  });

  function openMenu(i, button) {
    menuFor = i;
    const menu = overview.querySelector('.ov-menu');
    const single = doc.count === 1;
    menu.innerHTML = `
      <button data-act="before">${ICON.before}Seite davor einfügen</button>
      <button data-act="after">${ICON.after}Seite danach einfügen</button>
      <button data-act="copy">${ICON.copy}Duplizieren</button>
      <button data-act="template">${ICON.template}Vorlage ändern</button>
      <button data-act="delete" class="danger"${single ? ' disabled' : ''}>${ICON.trash}Seite löschen</button>`;
    menu.hidden = false;
    const o = overview.getBoundingClientRect();
    const b = button.getBoundingClientRect();
    const w = menu.offsetWidth;
    const h = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(o.width - w - 8, b.right - o.left - w))}px`;
    const below = b.bottom - o.top + 6;
    menu.style.top = `${below + h > o.height - 8 ? b.top - o.top - h - 6 : below}px`;
  }

  let deleteArmed = false;
  function runMenu(act, button) {
    const i = menuFor;
    if (i < 0) return;
    if (act === 'delete') {
      // Zweimal tippen, damit nichts aus Versehen weg ist (Rückgängig geht aber auch)
      if (!deleteArmed) {
        deleteArmed = true;
        button.classList.add('armed');
        button.lastChild.textContent = 'Wirklich löschen?';
        setTimeout(() => (deleteArmed = false), 3000);
        return;
      }
      deleteArmed = false;
      api.deletePage(i);
    }
    if (act === 'before') api.addPage(i);
    if (act === 'after') api.addPage(i + 1);
    if (act === 'copy') api.duplicatePage(i);
    if (act === 'template') {
      closeOverview();
      api.goTo(i, false);
      openPopup(i);
      return;
    }
    menuFor = -1;
    buildOverview();
  }

  // ---------- Seiten per Ziehen umsortieren ----------
  // Lange drücken (350 ms), dann ziehen. Eine "Geisterkarte" folgt dem Finger,
  // an ihrer alten Stelle zeigt ein gestrichelter Platzhalter, wo sie landet.
  let press = null; // { id, card, x, y, timer }
  let drag = null;  // { id, from, to, ghost, card, dx, dy }
  let dragJustEnded = false;

  overview.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.ov-card');
    if (!card || e.target.closest('button') || drag) return;
    const timer = setTimeout(() => startDrag(e.pointerId), 350);
    press = { id: e.pointerId, card, x: e.clientX, y: e.clientY, timer };
  });

  function startDrag(pointerId) {
    if (!press || press.id !== pointerId) return;
    const { card, x, y } = press;
    press = null;
    const r = card.getBoundingClientRect();
    const ghost = card.cloneNode(true);
    ghost.classList.add('ov-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    // Das Vorschaubild ins Geisterbild kopieren (cloneNode kopiert Canvas-Inhalte nicht)
    const src = card.querySelector('canvas');
    const dst = ghost.querySelector('canvas');
    dst.width = src.width;
    dst.height = src.height;
    dst.getContext('2d').drawImage(src, 0, 0);
    document.body.appendChild(ghost);
    card.classList.add('ov-placeholder');
    const from = Number(card.dataset.i);
    drag = { id: pointerId, from, to: from, ghost, card, dx: x - r.left, dy: y - r.top };
    navigator.vibrate?.(15);
  }

  window.addEventListener('pointermove', (e) => {
    if (press && press.id === e.pointerId && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 10) {
      clearTimeout(press.timer); // bewegt, bevor die Zeit um war -> normales Scrollen
      press = null;
    }
    if (!drag || drag.id !== e.pointerId) return;
    drag.ghost.style.left = `${e.clientX - drag.dx}px`;
    drag.ghost.style.top = `${e.clientY - drag.dy}px`;

    // Neue Position: die Karte, deren Mitte am nächsten am Finger ist
    const grid = overview.querySelector('.ov-grid');
    const cards = [...grid.querySelectorAll('.ov-card')];
    let best = drag.card;
    let bestD = Infinity;
    for (const c of cards) {
      const r = c.getBoundingClientRect();
      const d = Math.hypot(r.left + r.width / 2 - e.clientX, r.top + r.height / 2 - e.clientY);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best !== drag.card) {
      const order = cards.indexOf(best);
      const mine = cards.indexOf(drag.card);
      grid.insertBefore(drag.card, order > mine ? best.nextSibling : best);
      drag.to = [...grid.querySelectorAll('.ov-card')].indexOf(drag.card);
    }

    // Am oberen/unteren Rand: automatisch weiterscrollen
    const g = grid.getBoundingClientRect();
    if (e.clientY < g.top + 60) grid.scrollTop -= 12;
    else if (e.clientY > g.bottom - 60) grid.scrollTop += 12;
  });

  const endPress = (e) => {
    if (press && press.id === e.pointerId) {
      clearTimeout(press.timer);
      press = null;
    }
    if (!drag || drag.id !== e.pointerId) return;
    drag.ghost.remove();
    const { from, to } = drag;
    drag = null;
    dragJustEnded = true;
    setTimeout(() => (dragJustEnded = false), 50);
    if (from !== to) api.movePage(from, to);
    buildOverview();
  };
  window.addEventListener('pointerup', endPress);
  window.addEventListener('pointercancel', endPress);
  // Während des Ziehens darf der Browser nicht scrollen
  window.addEventListener(
    'touchmove',
    (e) => {
      if (drag) e.preventDefault();
    },
    { passive: false }
  );
  overview.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Anzeige aktualisieren ----------
  // Nach jedem Verschieben/Zoomen: "+ Seite"-Knopf mitbewegen, Seitenzahl anzeigen
  function onViewChange() {
    const view = api.view;
    const [x0, yEnd] = view.toScreen(0, doc.height);
    const [x1] = view.toScreen(PAGE_WIDTH, 0);
    const y = yEnd + 18;
    const visible = y < view.height - 10;
    addEnd.hidden = !visible;
    if (visible) {
      addEnd.style.transform = `translate(${(x0 + x1) / 2}px, ${y}px) translateX(-50%)`;
    }

    const index = api.current();
    if (index !== lastIndex || doc.count !== lastCount) {
      pagesBtn.querySelector('span').textContent = `${index + 1} / ${doc.count}`;
      if (lastIndex !== -1 && doc.count > 1) flashIndicator(index);
      lastIndex = index;
      lastCount = doc.count;
    } else if (doc.count > 1 && api.isScrolling()) {
      flashIndicator(index);
    }
  }

  function flashIndicator(index) {
    indicator.textContent = `Seite ${index + 1} von ${doc.count}`;
    indicator.classList.add('show');
    clearTimeout(indicatorTimer);
    indicatorTimer = setTimeout(() => indicator.classList.remove('show'), 1100);
  }

  return {
    closePopup,
    onViewChange,
    // nach Änderungen an den Seiten (auch Rückgängig): Menüs neu anzeigen
    refresh() {
      if (popupPage >= doc.count) popupPage = doc.count - 1;
      refreshPopup();
      if (!overview.hidden && !drag) buildOverview();
      lastIndex = -2; // Seitenzahl neu schreiben
      onViewChange();
    },
    // Striche haben sich geändert: nur die Vorschaubilder neu malen
    strokesChanged() {
      if (!overview.hidden && !drag) drawOverviewThumbs();
    },
  };
}

// Daneben tippen schließt ein Menü. Auf der Zeichenfläche wird der Tipp "verschluckt",
// damit dabei kein Punkt gemalt wird.
function closeOnOutside(el, isOpen, close, isToggle) {
  let swallowed = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!isOpen() || el.contains(e.target) || isToggle(e.target)) return;
      close();
      if (e.target.id === 'canvas') {
        swallowed = e.pointerId;
        e.stopPropagation();
      }
    },
    { capture: true }
  );
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      (e) => {
        if (e.pointerId !== swallowed) return;
        e.stopPropagation();
        if (type !== 'pointermove') swallowed = null;
      },
      { capture: true }
    );
  }
}
