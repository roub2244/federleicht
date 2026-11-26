// home.js – der Startbildschirm (wie bei Samsung Notes)
//
//   links:  Seitenleiste mit "Alle Notizen", "Favoriten", deinen Ordnern und dem Papierkorb
//   rechts: alle Notizen als Kärtchen mit Vorschaubild, Titel und Datum
//   unten rechts: runder [+]-Knopf = neue Notiz (im gerade offenen Ordner)
//
// Bedienung:
//   Notiz antippen              -> öffnen
//   "…" oder lange drücken      -> Umbenennen, Favorit, Verschieben, Duplizieren, Löschen
//   Ordner: "+" bei "Ordner"    -> neuer Ordner (Name, Farbe, Symbol), "…" am Ordner -> bearbeiten,
//                                 Unterordner, verschieben, löschen
//   Ordner liegen als große, farbige Kacheln über den Notizen; Unterordner im Ordner.
//   Notizen sind nach Datum gruppiert (Heute, Gestern, Diese Woche …), als Raster oder Liste.
//   Gelöschte Notizen landen 30 Tage im Papierkorb, bevor sie wirklich weg sind.
//
// main.js gibt uns über "api" das Öffnen und Anlegen von Notizen.

import * as store from './store.js';
import { askText, confirmBox, chooseFrom, toast, esc } from './dialog.js';
import { paint } from './paint.js';
import { drawThumbnail, DEFAULT_TEMPLATE } from './templates.js';
import { FOLDER_COLORS, badge, folderDialog, parentOf, descendants, pathOf, childrenOf, flatTree, guessIcon } from './folders.js';
import { setupToday } from './today.js';
import { openSettings } from './settings.js';
import { getPrefs, onPrefsChange } from './theme.js';
import { collectHomework } from './homework.js';
import * as lock from './lock.js';
import { needsIndex, indexNote, queryWords, searchNote, matchText, norm } from './searchindex.js';

export { FOLDER_COLORS };

const TRASH_DAYS = 30;
const LONG_PRESS_MS = 450;


const SORTS = [
  { id: 'updated', name: 'Zuletzt geändert' },
  { id: 'created', name: 'Erstellt' },
  { id: 'title', name: 'Titel (A–Z)' },
];

const ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/></svg>',
  notes: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2.5"/><path d="M9 8h6M9 12h6M9 16h3"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  folder: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg>',
  sort: '<svg viewBox="0 0 24 24"><path d="M7 4v16M3.5 16.5 7 20l3.5-3.5M17 20V4M13.5 7.5 17 4l3.5 3.5"/></svg>',
  menu: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8.5 19.5 4 20l.5-4.5z"/><path d="m13.5 6.5 4 4"/></svg>',
  rename: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 20H20"/></svg>',
  move: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M10 13.5h5M13 11l2.5 2.5L13 16"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h2"/></svg>',
  restore: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  backup: '<svg viewBox="0 0 24 24"><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 15V3M7.5 7.5 12 3l4.5 4.5"/><path d="M4.5 15.5v3a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-3"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  grid: '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="7" height="7" rx="1.6"/><rect x="13" y="4" width="7" height="7" rx="1.6"/><rect x="4" y="13" width="7" height="7" rx="1.6"/><rect x="13" y="13" width="7" height="7" rx="1.6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><rect x="3.5" y="5" width="3" height="3" rx=".8"/><rect x="3.5" y="10.5" width="3" height="3" rx=".8"/><rect x="3.5" y="16" width="3" height="3" rx=".8"/></svg>',
  chevron: '<svg viewBox="0 0 24 24"><path d="m9 6 6 6-6 6"/></svg>',
  sub: '<svg viewBox="0 0 24 24"><path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/><path d="M12 11v5M9.5 13.5h5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M12 11v6M9.5 14.5 12 17l2.5-2.5"/></svg>',
  lock: lock.LOCK_ICON,
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 6.8-1.2"/></svg>',
  ink: '<svg viewBox="0 0 24 24"><path d="M3 15c1.4-3.6 2.8-3.6 3.7-1s2.1 2.8 3.5-1 2.4-3.4 3.4-.2 2.2 2.6 3.6-.5"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
  key: '<svg viewBox="0 0 24 24"><circle cx="8" cy="15" r="4"/><path d="m11 12 8.5-8.5M16 7l2.5 2.5M14 9l2 2"/></svg>',
  today: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/><path d="M8 14h3v3H8z"/></svg>',
  timer: '<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="7.5"/><path d="M12 9v4l2.5 2M9.5 3h5"/></svg>',
};

export function setupHome(api) {
  const root = document.getElementById('home');

  let notes = [];
  let folders = [];
  // Was wird gerade angezeigt? { kind: 'all' | 'fav' | 'trash' | 'folder', id }
  let filter = readJSON('homeFilter', { kind: 'today' });
  // Neu: Startseite "Heute" (Stundenplan) – beim ersten Mal nach dem Update direkt dorthin
  if (!readJSON('todayIntro', false)) {
    filter = { kind: 'today' };
    saveJSON('todayIntro', true);
    saveJSON('homeFilter', filter);
  }
  // Einstellung "Beim Öffnen" (siehe settings.js)
  const startPref = getPrefs().start;
  if (startPref === 'today') filter = { kind: 'today' };
  else if (startPref === 'all' && filter.kind === 'today') filter = { kind: 'all' };
  let sort = readJSON('homeSort', 'updated');
  let search = '';
  let drawerOpen = false;
  let viewMode = readJSON('homeView', 'grid');                // 'grid' | 'list'
  const expanded = new Set(readJSON('homeExpanded', []));    // aufgeklappte Ordner in der Seitenleiste
  const bitmaps = new Map(); // Vorschaubilder: Notiz-ID -> { key, bitmap }
  const indexer = { running: false, pending: 0, stop: false }; // Handschrift für die Suche lesen
  // Startseite "Heute": Stundenplan, Hausaufgaben, Termine (siehe today.js)
  const today = setupToday({
    openNote: (id, focus) => api.openNote(id, focus),
    openFolder: (id) => openFolder(id),
    async createFolder(name, color) {
      const folder = { id: store.uid(), name, color: color || FOLDER_COLORS[0], icon: guessIcon(name) || 'folder', parentId: null, created: Date.now() };
      await store.putFolder(folder);
      folders.push(folder);
      return folder;
    },
    saveNoteMeta: (note) => store.putNote(note),
    refresh: () => render(),
    openSettings: () => showSettings(),
  });
  const showSettings = () => openSettings({ onChange: () => !root.hidden && render() });
  onPrefsChange(() => {
    if (!root.hidden) render();
  });

  // Gesperrt? (Notiz selbst oder ein Ordner darüber) – und gerade nicht entsperrt
  const lockedNote = (n) => lock.isNoteLocked(n, folders);
  const hiddenNote = (n) => lockedNote(n) && !lock.isUnlocked();
  const hiddenFolder = (f) => lock.isFolderLocked(f, folders) && !lock.isUnlocked();
  lock.onLockChange(() => {
    if (!root.hidden) render();
  });

  root.innerHTML = `
    <div class="h-scrim" data-act="drawer"></div>
    <aside class="h-side">
      <div class="h-brand"><img src="./icons/icon.svg" alt="" width="30" height="30" /><span>Federleicht</span></div>
      <nav class="h-nav"></nav>
      <div class="h-side-foot">
        <button class="h-link" data-act="settings">${ICON.gear}<span>Einstellungen</span></button>
        <button class="h-link" data-act="backup">${ICON.backup}<span>Sicherung</span></button>
        <button class="h-link" data-act="pin">${ICON.key}<span>PIN und Sperre</span></button>
      </div>
    </aside>
    <section class="h-main">
      <header class="h-head">
        <button class="h-icon h-menu" data-act="drawer" aria-label="Ordner">${ICON.menu}</button>
        <div class="h-title-wrap">
          <nav class="h-crumbs" aria-label="Ordnerpfad"></nav>
          <div class="h-title-row"><span class="h-title-badge"></span><h1 class="h-title"></h1><span class="h-count"></span></div>
        </div>
        <label class="h-search">${ICON.search}<input type="search" placeholder="Suchen – auch in Handschrift" autocomplete="off" /></label>
        <button class="h-icon h-lockbtn" data-act="lock" hidden></button>
        <button class="h-icon" data-act="sort" aria-label="Sortieren" title="Sortieren">${ICON.sort}</button>
        <button class="h-icon" data-act="view" aria-label="Ansicht wechseln" title="Raster oder Liste"></button>
        <button class="h-chip h-pdf" data-act="import-pdf" title="PDF öffnen und darauf schreiben">${ICON.pdf}<span>PDF öffnen</span></button>
        <button class="h-chip" data-act="empty-trash" hidden>Papierkorb leeren</button>
      </header>
      <div class="h-scroll">
        <div class="h-content"></div>
        <div class="h-empty" hidden></div>
      </div>
      <button class="h-fab" data-act="new" aria-label="Neue Notiz" title="Neue Notiz">${ICON.pen}<b>${ICON.plus}</b></button>
    </section>
    <div class="h-menu-pop" hidden></div>`;

  const nav = root.querySelector('.h-nav');
  const grid = root.querySelector('.h-content');
  const empty = root.querySelector('.h-empty');
  const pop = root.querySelector('.h-menu-pop');
  const searchInput = root.querySelector('.h-search input');

  // PDF öffnen: wird eine neue Notiz (im gerade offenen Ordner), auf deren Seiten man schreiben kann
  const pdfInput = document.createElement('input');
  pdfInput.type = 'file';
  pdfInput.accept = 'application/pdf,.pdf';
  pdfInput.hidden = true;
  root.appendChild(pdfInput);
  pdfInput.addEventListener('change', () => {
    const file = pdfInput.files[0];
    pdfInput.value = '';
    if (file) api.createNoteFromPdf(file, filter.kind === 'folder' ? filter.id : null);
  });

  // ---------- Daten laden ----------
  async function reload() {
    [notes, folders] = await Promise.all([store.getAllNotes(), store.getAllFolders()]);
    // Alte Notizen im Papierkorb endgültig löschen
    const limit = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
    for (const n of notes.filter((n) => n.deletedAt && n.deletedAt < limit)) {
      await store.deleteNoteForever(n);
    }
    notes = notes.filter((n) => !(n.deletedAt && n.deletedAt < limit));
    folders.sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }));
    if (filter.kind === 'folder' && !folders.some((f) => f.id === filter.id)) filter = { kind: 'all' };
    render();
  }

  // ---------- Anzeigen ----------
  const live = () => notes.filter((n) => !n.deletedAt);
  const folderOf = (id) => folders.find((f) => f.id === id);

  function visibleNotes() {
    let list;
    if (filter.kind === 'trash') list = notes.filter((n) => n.deletedAt);
    else if (filter.kind === 'fav') list = live().filter((n) => n.favorite);
    else if (filter.kind === 'folder') list = live().filter((n) => n.folderId === filter.id);
    else list = live();
    const q = search.trim().toLowerCase();
    if (q) list = list.filter((n) => (n.title || '').toLowerCase().includes(q));
    const by = {
      updated: (a, b) => b.updated - a.updated,
      created: (a, b) => b.created - a.created,
      title: (a, b) => (a.title || '').localeCompare(b.title || '', 'de', { numeric: true }),
    }[sort] || ((a, b) => b.updated - a.updated);
    if (filter.kind === 'trash') return list.sort((a, b) => b.deletedAt - a.deletedAt);
    return list.sort(by);
  }

  function titleOfFilter() {
    if (filter.kind === 'trash') return 'Papierkorb';
    if (filter.kind === 'fav') return 'Favoriten';
    if (filter.kind === 'folder') return folderOf(filter.id)?.name || 'Ordner';
    return 'Alle Notizen';
  }

  // Notizen in diesem Ordner UND allen Unterordnern
  function deepNotes(id) {
    const ids = new Set([id, ...descendants(folders, id)]);
    return live().filter((n) => ids.has(n.folderId));
  }

  function render() {
    renderNav();
    renderLockButton();
    if (search.trim() && filter.kind !== 'trash') return renderSearch();
    root.classList.toggle('today-view', filter.kind === 'today');
    if (filter.kind === 'today') return renderToday();
    today.stopTicker();
    const list = visibleNotes();
    const inFolder = filter.kind === 'folder';
    root.querySelector('.h-title').textContent = titleOfFilter();
    root.querySelector('.h-title-badge').innerHTML = inFolder ? badge(folderOf(filter.id), 'h-tbadge') : '';
    // Pfad über dem Titel: Alle Notizen › Schule › Mathe
    const path = inFolder ? pathOf(folders, filter.id).slice(0, -1) : [];
    root.querySelector('.h-crumbs').innerHTML = inFolder
      ? [`<button data-crumb="">Alle Notizen</button>`, ...path.map((f) => `<button data-crumb="${f.id}">${esc(f.name)}</button>`)].join(`<i>${ICON.chevron}</i>`)
      : '';
    root.querySelector('.h-count').textContent = `${list.length} ${list.length === 1 ? 'Notiz' : 'Notizen'}`;
    root.querySelector('[data-act="empty-trash"]').hidden = filter.kind !== 'trash' || list.length === 0;
    root.querySelector('[data-act="new"]').hidden = filter.kind === 'trash';
    root.querySelector('[data-act="import-pdf"]').hidden = filter.kind === 'trash';
    root.querySelector('[data-act="view"]').innerHTML = viewMode === 'grid' ? ICON.list : ICON.grid;
    root.classList.toggle('drawer-open', drawerOpen);

    // Ordner-Kacheln: in "Alle Notizen" die obersten Ordner, in einem Ordner seine Unterordner
    let html = '';
    const showFolders = !search.trim() && (filter.kind === 'all' || inFolder);
    const sub = showFolders ? childrenOf(folders, inFolder ? filter.id : null) : [];
    if (showFolders && (sub.length || inFolder || folders.length === 0)) {
      html += `<section class="h-sec"><div class="h-sec-head"><span>${inFolder ? 'Unterordner' : 'Ordner'}</span>${sub.length ? `<small>${sub.length}</small>` : ''}</div>
        <div class="f-tiles">${sub.map(folderTile).join('')}
          <button class="f-tile f-new" data-act="new-folder-here">${ICON.plus}<span>${inFolder ? 'Unterordner' : 'Neuer Ordner'}</span></button>
        </div></section>`;
    }

    // Notizen, nach Datum gruppiert (bei Sortierung nach Datum)
    if (list.length) {
      const groups = sort === 'title' || filter.kind === 'trash' ? [{ name: sub.length ? 'Notizen' : '', notes: list }] : groupByDate(list, sort === 'created' ? 'created' : 'updated');
      for (const g of groups) {
        html += `<section class="h-sec">${g.name ? `<div class="h-sec-head"><span>${esc(g.name)}</span><small>${g.notes.length}</small></div>` : ''}
          <div class="${viewMode === 'list' ? 'n-list' : 'h-grid'}">${g.notes.map(viewMode === 'list' ? noteRow : noteCard).join('')}</div></section>`;
      }
    }
    grid.innerHTML = html;
    empty.hidden = list.length > 0 || (showFolders && sub.length > 0);
    if (!empty.hidden) empty.innerHTML = emptyText();
    drawThumbs(list);
  }

  function renderToday() {
    root.querySelector('.h-title').textContent = 'Heute';
    root.querySelector('.h-title-badge').innerHTML = '';
    root.querySelector('.h-crumbs').innerHTML = '';
    root.querySelector('.h-count').textContent = '';
    root.querySelector('[data-act="empty-trash"]').hidden = true;
    root.querySelector('[data-act="new"]').hidden = false;
    root.classList.toggle('drawer-open', drawerOpen);
    const visible = live().filter((n) => !hiddenNote(n));
    grid.innerHTML = today.html({ notes: visible, folders });
    empty.hidden = true;
    today.startTicker(() => {
      if (!root.hidden && filter.kind === 'today' && !search.trim()) renderToday();
    });
  }

  function folderTile(f) {
    const notesIn = deepNotes(f.id);
    const last = notesIn.reduce((m, n) => Math.max(m, n.updated || 0), 0);
    const subs = childrenOf(folders, f.id).length;
    const parts = [`${notesIn.length} ${notesIn.length === 1 ? 'Notiz' : 'Notizen'}`];
    if (subs) parts.push(`${subs} ${subs === 1 ? 'Ordner' : 'Ordner'}`);
    return `<div class="f-tile" data-folder="${f.id}" role="button" tabindex="0">
      <span class="f-tint">${paint(f.color)}</span>
      ${badge(f, 'f-tbadge')}${f.locked ? `<span class="f-lock">${ICON.lock}</span>` : ''}
      <span class="f-text"><b>${esc(f.name)}</b><small>${parts.join(' · ')}</small>
        <small class="f-date">${last ? `Geändert ${esc(formatDate(last))}` : 'Noch leer'}</small></span>
      <button class="f-more" data-fmore="${f.id}" aria-label="Ordner bearbeiten">${ICON.more}</button>
    </div>`;
  }

  function folderChip(n) {
    const f = folderOf(n.folderId);
    return f && !(filter.kind === 'folder' && filter.id === f.id) ? `<span class="n-folder">${badge(f, 'n-fbadge')}<span>${esc(f.name)}</span></span>` : '';
  }

  function noteCard(n) {
    const pages = n.pageCount || n.pageIds?.length || 1;
    const when = filter.kind === 'trash' ? `Gelöscht ${formatDate(n.deletedAt)}` : formatDate(sort === 'created' ? n.created : n.updated);
    const locked = lockedNote(n);
    return `<div class="n-card${locked ? ' locked' : ''}${hiddenNote(n) ? ' sealed' : ''}" data-id="${n.id}">
      <div class="n-thumb"><canvas></canvas>${pages > 1 ? `<span class="n-pages">${pages}</span>` : ''}${n.favorite ? `<span class="n-star">${ICON.star}</span>` : ''}${locked ? `<span class="n-lock">${ICON.lock}</span>` : ''}</div>
      <div class="n-info">
        <div class="n-title">${esc(n.title || 'Ohne Titel')}</div>
        <div class="n-meta"><span>${esc(when)}</span></div>
        ${folderChip(n)}
      </div>
      <button class="n-more" data-more aria-label="Mehr">${ICON.more}</button>
    </div>`;
  }

  // Listen-Ansicht: kleine Vorschau, Titel, Ordner, erstellt/geändert, Seiten
  function noteRow(n) {
    const pages = n.pageCount || n.pageIds?.length || 1;
    return `<div class="n-card n-row${hiddenNote(n) ? ' sealed' : ''}" data-id="${n.id}">
      <div class="n-thumb"><canvas></canvas></div>
      <div class="n-rinfo">
        <div class="n-title">${lockedNote(n) ? `<span class="n-rlock">${ICON.lock}</span>` : ''}${n.favorite ? `<span class="n-rstar">${ICON.star}</span>` : ''}${esc(n.title || 'Ohne Titel')}</div>
        <div class="n-rmeta">${folderChip(n)}<span>${pages} ${pages === 1 ? 'Seite' : 'Seiten'}</span></div>
      </div>
      <div class="n-dates">
        ${filter.kind === 'trash' ? `<span>Gelöscht ${esc(formatDate(n.deletedAt))}</span>` : `<span>Geändert ${esc(formatDate(n.updated))}</span><span>Erstellt ${esc(fullDate(n.created))}</span>`}
      </div>
      <button class="n-more" data-more aria-label="Mehr">${ICON.more}</button>
    </div>`;
  }

  function emptyText() {
    if (search.trim()) return `<div class="h-empty-icon">${ICON.search}</div><b>Nichts gefunden</b><span>Keine Notiz heißt so.</span>`;
    if (filter.kind === 'trash') return `<div class="h-empty-icon">${ICON.trash}</div><b>Papierkorb ist leer</b><span>Gelöschte Notizen bleiben hier 30 Tage.</span>`;
    if (filter.kind === 'fav') return `<div class="h-empty-icon">${ICON.star}</div><b>Noch keine Favoriten</b><span>Über „…“ an einer Notiz markierst du sie mit Stern.</span>`;
    return `<div class="h-empty-icon">${ICON.notes}</div><b>Noch keine Notizen</b><span>Tippe auf den Stift unten rechts, um loszuschreiben.</span>`;
  }

  function renderNav() {
    const count = (fn) => live().filter(fn).length;
    const item = (kind, id, icon, label, n, extra = '', depth = 0) => {
      const on = filter.kind === kind && (kind !== 'folder' || filter.id === id);
      return `<button class="h-item${on ? ' on' : ''}" data-filter="${kind}"${id ? ` data-id="${id}"` : ''}${depth ? ` style="padding-left:${14 + depth * 18}px"` : ''}>
        ${icon}<span>${esc(label)}</span><small>${n || ''}</small>${extra}</button>`;
    };
    // Ordner als Baum: Pfeil klappt Unterordner auf und zu
    const tree = (pid, depth) =>
      childrenOf(folders, pid)
        .map((f) => {
          const kids = childrenOf(folders, f.id).length > 0;
          const open = expanded.has(f.id) || (filter.kind === 'folder' && pathOf(folders, filter.id).some((p) => p.id === f.id && p.id !== filter.id));
          const toggle = kids
            ? `<span class="h-twist${open ? ' open' : ''}" data-twist="${f.id}" role="button" aria-label="Unterordner zeigen">${ICON.chevron}</span>`
            : '<span class="h-twist none"></span>';
          return (
            item('folder', f.id, toggle + badge(f, 'h-fbadge'), f.name, deepNotes(f.id).length,
              `<span class="h-fmore" data-fmore="${f.id}" role="button" aria-label="Ordner bearbeiten">${ICON.more}</span>`, depth) +
            (kids && open ? tree(f.id, depth + 1) : '')
          );
        })
        .join('');
    nav.innerHTML = `
      ${item('today', '', ICON.today, 'Heute', collectHomework(live()).filter((x) => !x.hw.done).length)}
      ${item('all', '', ICON.notes, 'Alle Notizen', live().length)}
      ${item('fav', '', ICON.star, 'Favoriten', count((n) => n.favorite))}
      <div class="h-sect"><span>Ordner</span><button class="h-sect-add" data-act="new-folder" aria-label="Neuer Ordner" title="Neuer Ordner">${ICON.plus}</button></div>
      ${tree(null, 0)}
      ${folders.length ? '' : '<div class="h-hint">Ordner für deine Fächer, z. B. Mathe, Bio, Deutsch – mit Farbe und Symbol</div>'}
      <div class="h-sep"></div>
      ${item('trash', '', ICON.trash, 'Papierkorb', notes.length - live().length)}`;
  }

  // Vorschaubilder malen: gespeichertes Bild der ersten Seite (hell oder dunkel),
  // oder – wenn es noch keins gibt – nur die leere Vorlage.
  async function drawThumbs(list) {
    const dark = api.darkPaper();
    for (const n of list) {
      const canvas = grid.querySelector(`.n-card[data-id="${n.id}"] .n-thumb canvas`);
      if (!canvas) continue;
      const blob = hiddenNote(n) ? null : dark ? n.thumbDark : n.thumbLight;
      const tpl = n.firstTemplate || DEFAULT_TEMPLATE;
      if (!blob) {
        drawThumbnail(canvas, tpl, { dark, faint: true });
        continue;
      }
      const key = `${n.thumbAt}|${dark}`;
      let cached = bitmaps.get(n.id);
      if (!cached || cached.key !== key) {
        try {
          cached = { key, bitmap: await createImageBitmap(blob) };
          bitmaps.set(n.id, cached);
        } catch {
          drawThumbnail(canvas, tpl, { dark, faint: true });
          continue;
        }
      }
      // Bild auf ein Canvas malen (Bilder würde der Dunkelmodus von Samsung Internet verfälschen)
      const dpr = window.devicePixelRatio || 1;
      const w = Math.max(1, Math.round(canvas.clientWidth * dpr));
      const h = Math.round((w * 1414) / 1000);
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(cached.bitmap, 0, 0, w, h);
    }
  }

  // ---------- Antippen ----------
  root.addEventListener('click', async (e) => {
    if (suppressClick) return;
    const t = e.target;
    if (filter.kind === 'today' && t.closest('[data-td]') && (await today.click(e, { notes: live().filter((n) => !hiddenNote(n)), folders }))) return;
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'drawer') {
      drawerOpen = !drawerOpen;
      return render();
    }
    if (act === 'new') return api.createNote(filter.kind === 'folder' ? filter.id : null, filter.kind === 'folder' ? folderOf(filter.id)?.name : null);
    if (act === 'new-folder-here') return newFolder(true, filter.kind === 'folder' ? filter.id : null);
    if (act === 'view') {
      viewMode = viewMode === 'grid' ? 'list' : 'grid';
      saveJSON('homeView', viewMode);
      return render();
    }
    if (act === 'import-pdf') return pdfInput.click();
    if (act === 'new-folder') return newFolder();
    if (act === 'sort') return openSortMenu(t.closest('button'));
    if (act === 'settings') return showSettings();
    if (act === 'backup') return openBackupMenu(t.closest('button'));
    if (act === 'pin') return openPinMenu(t.closest('button'));
    if (act === 'lock') {
      if (lock.isUnlocked()) {
        lock.lockNow();
        toast('Gesperrt');
      } else await lock.unlock('Entsperren');
      return;
    }
    const hit = t.closest('[data-hit]');
    if (hit) {
      const [id, pageIndex, x0, y0, x1, y1] = hit.dataset.hit.split(',');
      return api.openNote(id, { pageIndex: Number(pageIndex), box: [x0, y0, x1, y1].map(Number), words: queryWords(search) });
    }
    if (act === 'empty-trash') return emptyTrash();

    const fmore = t.closest('[data-fmore]');
    if (fmore) return openFolderMenu(fmore.dataset.fmore, fmore);

    // Pfeil in der Seitenleiste: Unterordner auf-/zuklappen
    const twist = t.closest('[data-twist]');
    if (twist) {
      const id = twist.dataset.twist;
      if (twist.classList.contains('open')) expanded.delete(id);
      else expanded.add(id);
      saveJSON('homeExpanded', [...expanded]);
      return renderNav();
    }

    // Pfad oben ("Alle Notizen › Schule ›") oder Ordner-Kachel antippen
    const crumb = t.closest('[data-crumb]');
    const tile = t.closest('[data-folder]');
    if (crumb || tile) {
      const id = crumb ? crumb.dataset.crumb : tile.dataset.folder;
      const f = id && folderOf(id);
      if (f && hiddenFolder(f) && !(await lock.unlock('Ordner gesperrt'))) return;
      openFolder(id || null);
      return;
    }

    const navItem = t.closest('[data-filter]');
    if (navItem) {
      const f = navItem.dataset.filter === 'folder' && folderOf(navItem.dataset.id);
      if (f && hiddenFolder(f) && !(await lock.unlock('Ordner gesperrt'))) return;
      filter = navItem.dataset.filter === 'folder' ? { kind: 'folder', id: navItem.dataset.id } : { kind: navItem.dataset.filter };
      saveJSON('homeFilter', filter);
      drawerOpen = false;
      root.querySelector('.h-scroll').scrollTop = 0;
      return render();
    }

    const card = t.closest('.n-card');
    if (card) {
      if (t.closest('[data-more]')) return openNoteMenu(card.dataset.id, t.closest('[data-more]'));
      const note = notes.find((n) => n.id === card.dataset.id);
      if (note?.deletedAt) return openNoteMenu(note.id, card.querySelector('[data-more]'));
      if (note && hiddenNote(note) && !(await lock.unlock('Notiz gesperrt'))) return;
      return api.openNote(card.dataset.id);
    }
  });

  searchInput.addEventListener('input', () => {
    search = searchInput.value;
    render();
  });

  // Lange drücken auf eine Notiz = Menü (wie "…")
  let press = null;
  let suppressClick = false;
  root.addEventListener('pointerdown', (e) => {
    const card = e.target.closest('.n-card, .h-item[data-filter="folder"], .f-tile[data-folder]');
    if (!card || e.target.closest('button.n-more, [data-fmore], [data-twist]')) return;
    press = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => {
        press = null;
        suppressClick = true;
        setTimeout(() => (suppressClick = false), 400);
        navigator.vibrate?.(12);
        if (card.classList.contains('n-card')) openNoteMenu(card.dataset.id, card.querySelector('[data-more]'));
        else openFolderMenu(card.dataset.id || card.dataset.folder, card);
      }, LONG_PRESS_MS),
    };
  });
  const cancelPress = (e) => {
    if (!press || press.id !== e.pointerId) return;
    if (e.type === 'pointermove' && Math.hypot(e.clientX - press.x, e.clientY - press.y) < 10) return;
    clearTimeout(press.timer);
    press = null;
  };
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) root.addEventListener(type, cancelPress);
  root.addEventListener('contextmenu', (e) => e.preventDefault());

  function openFolder(id) {
    filter = id ? { kind: 'folder', id } : { kind: 'all' };
    if (id) for (const p of pathOf(folders, id).slice(0, -1)) expanded.add(p.id);
    saveJSON('homeFilter', filter);
    saveJSON('homeExpanded', [...expanded]);
    drawerOpen = false;
    root.querySelector('.h-scroll').scrollTop = 0;
    render();
  }

  // ---------- Kleine Menüs ----------
  function showMenu(anchor, items) {
    pop.innerHTML = items
      .map((it, i) =>
        it === '-' ? '<div class="hm-sep"></div>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${it.icon || ''}<span>${esc(it.label)}</span></button>`
      )
      .join('');
    pop.hidden = false;
    const r = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    pop.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w))}px`;
    const below = r.bottom + 6;
    pop.style.top = `${below + h > window.innerHeight - 8 ? Math.max(8, r.top - h - 6) : below}px`;
    pop.onclick = (e) => {
      const b = e.target.closest('[data-i]');
      if (!b) return;
      closeMenu();
      items[Number(b.dataset.i)].run();
    };
  }

  function closeMenu() {
    pop.hidden = true;
    pop.innerHTML = '';
  }

  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!pop.hidden && !pop.contains(e.target)) closeMenu();
    },
    { capture: true }
  );

  function openNoteMenu(id, anchor) {
    const note = notes.find((n) => n.id === id);
    if (!note) return;
    if (note.deletedAt) {
      return showMenu(anchor, [
        { icon: ICON.restore, label: 'Wiederherstellen', run: () => update(note, { deletedAt: null }, 'Notiz wiederhergestellt') },
        { icon: ICON.trash, label: 'Endgültig löschen', danger: true, run: () => deleteForever(note) },
      ]);
    }
    showMenu(anchor, [
      { icon: ICON.rename, label: 'Umbenennen', run: () => renameNote(note) },
      { icon: ICON.star, label: note.favorite ? 'Kein Favorit mehr' : 'Als Favorit markieren', run: () => update(note, { favorite: !note.favorite }) },
      { icon: ICON.move, label: 'In Ordner verschieben', run: () => moveNote(note) },
      { icon: ICON.copy, label: 'Duplizieren', run: () => duplicate(note) },
      note.locked
        ? { icon: ICON.unlock, label: 'Sperre entfernen', run: () => setLocked(note, false) }
        : { icon: ICON.lock, label: 'Mit PIN sperren', run: () => setLocked(note, true) },
      '-',
      { icon: ICON.trash, label: 'Löschen', danger: true, run: () => trash(note) },
    ]);
  }

  function openFolderMenu(id, anchor) {
    const folder = folderOf(id);
    if (!folder) return;
    showMenu(anchor, [
      { icon: ICON.rename, label: 'Bearbeiten (Name, Farbe, Symbol)', run: () => editFolder(folder) },
      { icon: ICON.sub, label: 'Unterordner anlegen', run: () => newFolder(true, folder.id) },
      { icon: ICON.move, label: 'Verschieben', run: () => moveFolder(folder) },
      folder.locked
        ? { icon: ICON.unlock, label: 'Sperre entfernen', run: () => setFolderLocked(folder, false) }
        : { icon: ICON.lock, label: 'Ordner mit PIN sperren', run: () => setFolderLocked(folder, true) },
      '-',
      { icon: ICON.trash, label: 'Ordner löschen', danger: true, run: () => removeFolder(folder) },
    ]);
  }

  function openSortMenu(anchor) {
    showMenu(
      anchor,
      SORTS.map((s) => ({
        label: (s.id === sort ? '✓ ' : ' ') + s.name,
        run() {
          sort = s.id;
          saveJSON('homeSort', sort);
          render();
        },
      }))
    );
  }

  function openBackupMenu(anchor) {
    showMenu(anchor, [
      { icon: ICON.backup, label: 'Sicherung speichern (Datei)', run: exportBackup },
      { icon: ICON.upload, label: 'Sicherung laden', run: importBackup },
    ]);
  }

  // ---------- Sperren (siehe lock.js) ----------
  async function setLocked(note, on) {
    if (on) {
      if (!(await lock.ensurePin())) return;
      await update(note, { locked: true }, 'Notiz gesperrt – öffnen nur mit PIN');
    } else {
      if (!(await lock.unlock('Sperre entfernen'))) return;
      await update(note, { locked: false }, 'Sperre entfernt');
    }
  }

  async function setFolderLocked(folder, on) {
    if (on) {
      if (!(await lock.ensurePin())) return;
    } else if (!(await lock.unlock('Sperre entfernen'))) return;
    folder.locked = on;
    await store.putFolder(folder);
    render();
    toast(on ? `„${folder.name}“ gesperrt – mit allen Notizen und Unterordnern` : 'Sperre entfernt');
  }

  function renderLockButton() {
    const btn = root.querySelector('[data-act="lock"]');
    const any = notes.some((n) => n.locked && !n.deletedAt) || folders.some((f) => f.locked);
    btn.hidden = !any || !lock.hasPin();
    btn.innerHTML = lock.isUnlocked() ? ICON.unlock : ICON.lock;
    btn.title = lock.isUnlocked() ? 'Jetzt sperren' : 'Entsperren';
    btn.classList.toggle('open', lock.isUnlocked());
  }

  function openPinMenu(anchor) {
    const auto = lock.autoLockSetting();
    const label = { leave: 'beim Verlassen der App', '1min': '1 Minute nach dem Verlassen', '5min': '5 Minuten nach dem Verlassen' };
    if (!lock.hasPin()) {
      return showMenu(anchor, [{ icon: ICON.key, label: 'PIN festlegen', run: () => lock.ensurePin().then(render) }]);
    }
    showMenu(anchor, [
      lock.isUnlocked()
        ? { icon: ICON.lock, label: 'Jetzt sperren', run: () => lock.lockNow() }
        : { icon: ICON.unlock, label: 'Entsperren', run: () => lock.unlock('Entsperren') },
      { icon: ICON.key, label: 'PIN ändern', run: () => lock.changePin() },
      { icon: ICON.restore, label: 'PIN vergessen? (Code)', run: () => lock.recover() },
      '-',
      ...Object.entries(label).map(([id, text]) => ({
        icon: ICON.timer,
        label: `${id === auto ? '✓ ' : ''}Sperren ${text}`,
        run: () => {
          lock.setAutoLock(id);
          toast(`Wird ${text} wieder gesperrt`);
        },
      })),
    ]);
  }

  // ---------- Suche (auch in Handschrift, siehe searchindex.js) ----------
  function renderSearch() {
    const words = queryWords(search);
    const pool = live();
    // 1. Titel und Ordnernamen
    const byTitle = pool.filter((n) => matchText(`${n.title || ''} ${folderOf(n.folderId)?.name || ''}`, words));
    // 2. Inhalt: Text und Handschrift (gesperrte Notizen nur, wenn entsperrt)
    const inside = [];
    let skippedLocked = 0;
    for (const n of pool) {
      if (hiddenNote(n)) {
        if (n.index) skippedLocked++;
        continue;
      }
      const hits = searchNote(n, words);
      if (hits.length) inside.push({ note: n, hits });
    }
    inside.sort((a, b) => b.hits.length - a.hits.length || b.note.updated - a.note.updated);
    const total = new Set([...byTitle.map((n) => n.id), ...inside.map((r) => r.note.id)]).size;

    root.querySelector('.h-title').textContent = 'Suche';
    root.querySelector('.h-title-badge').innerHTML = '';
    root.querySelector('.h-crumbs').innerHTML = '';
    root.querySelector('.h-count').textContent = `${total} ${total === 1 ? 'Notiz' : 'Notizen'}`;
    root.querySelector('[data-act="empty-trash"]').hidden = true;

    let html = '';
    if (indexer.pending > 0) {
      html += `<div class="s-status"><span class="s-spin"></span>Handschrift wird für die Suche gelesen … noch ${indexer.pending} ${indexer.pending === 1 ? 'Notiz' : 'Notizen'}</div>`;
    }
    if (byTitle.length) {
      html += `<section class="h-sec"><div class="h-sec-head"><span>Titel und Ordner</span><small>${byTitle.length}</small></div>
        <div class="${viewMode === 'list' ? 'n-list' : 'h-grid'}">${byTitle.map(viewMode === 'list' ? noteRow : noteCard).join('')}</div></section>`;
    }
    if (inside.length) {
      html += `<section class="h-sec"><div class="h-sec-head"><span>In deinen Notizen</span><small>${inside.length}</small></div>
        <div class="s-results">${inside.map(({ note, hits }) => resultRow(note, hits, words)).join('')}</div></section>`;
    }
    if (skippedLocked) html += `<div class="s-note">${ICON.lock}<span>${skippedLocked} gesperrte ${skippedLocked === 1 ? 'Notiz wurde' : 'Notizen wurden'} nicht durchsucht – erst entsperren.</span></div>`;
    grid.innerHTML = html;
    empty.hidden = total > 0;
    if (!empty.hidden) {
      empty.innerHTML = `<div class="h-empty-icon">${ICON.search}</div><b>Nichts gefunden</b><span>${
        indexer.pending ? 'Ein paar Notizen werden noch gelesen – gleich nochmal schauen.' : 'Weder im Titel noch im Text oder in der Handschrift.'
      }</span>`;
    }
    drawThumbs([...byTitle, ...inside.map((r) => r.note)]);
  }

  function resultRow(note, hits, words) {
    const pages = new Set(hits.map((h) => h.pageIndex)).size;
    const shown = hits.slice(0, 4);
    return `<div class="s-result n-card" data-id="${note.id}">
      <div class="n-thumb"><canvas></canvas></div>
      <div class="s-body">
        <div class="s-head"><b>${esc(note.title || 'Ohne Titel')}</b><small>${hits.length} ${hits.length === 1 ? 'Treffer' : 'Treffer'}${pages > 1 ? ` auf ${pages} Seiten` : ''}${folderOf(note.folderId) ? ` · ${esc(folderOf(note.folderId).name)}` : ''}</small></div>
        ${shown
          .map(
            (h) => `<button class="s-hit" data-hit="${note.id},${h.pageIndex},${h.line.b.join(',')}">
              <span class="s-kind" title="${h.line.k === 'ink' ? 'Handschrift' : 'Text'}">${h.line.k === 'ink' ? ICON.ink : ICON.text}</span>
              <span class="s-page">S. ${h.pageIndex + 1}</span>
              <span class="s-text">${highlight(h.line.t, h.spans)}</span></button>`
          )
          .join('')}
        ${hits.length > shown.length ? `<small class="s-more">+ ${hits.length - shown.length} weitere</small>` : ''}
      </div>
    </div>`;
  }

  // Treffer im Text hervorheben (spans beziehen sich auf den vereinfachten Text, siehe norm())
  function highlight(text, spans) {
    const sorted = [...spans].sort((a, b) => a[0] - b[0]);
    let out = '';
    let at = 0;
    for (const [a, b] of sorted) {
      if (a < at) continue;
      out += esc(text.slice(at, a)) + `<mark>${esc(text.slice(a, b))}</mark>`;
      at = b;
    }
    return out + esc(text.slice(at));
  }

  // Im Hintergrund Notizen lesen, die neu sind oder sich geändert haben (die neuesten zuerst).
  // Läuft nur, solange der Startbildschirm offen ist – beim Schreiben soll nichts bremsen.
  async function runIndexer() {
    if (indexer.running) return;
    indexer.running = true;
    indexer.stop = false;
    try {
      for (;;) {
        const todo = notes.filter(needsIndex).sort((a, b) => b.updated - a.updated);
        indexer.pending = todo.length;
        if (!todo.length || indexer.stop || root.hidden) break;
        const n = todo[0];
        let ix = null;
        try {
          ix = await indexNote(n, { stop: () => indexer.stop || root.hidden });
        } catch (err) {
          console.warn('Lesen für die Suche ging nicht', err);
          ix = { v: 1, at: Date.now(), pages: n.index?.pages || {}, failed: true };
        }
        if (!ix) break;
        // Frisch aus dem Speicher holen, damit nichts anderes überschrieben wird
        const latest = await store.getNote(n.id);
        if (!latest) continue;
        if ((latest.updated || 0) > ix.at) ix.at = 0; // inzwischen geändert -> nächstes Mal nochmal
        latest.index = ix;
        await store.putNote(latest);
        n.index = ix;
        if (search.trim()) render();
      }
    } finally {
      indexer.running = false;
      indexer.pending = notes.filter(needsIndex).length;
      if (search.trim() && !root.hidden) render();
    }
  }

  // ---------- Aktionen ----------
  async function update(note, changes, message) {
    Object.assign(note, changes);
    await store.putNote(note);
    render();
    if (message) toast(message);
  }

  async function renameNote(note) {
    const text = await askText({ title: 'Notiz umbenennen', value: note.title || '', placeholder: 'Titel' });
    if (text) update(note, { title: text });
  }

  async function moveNote(note) {
    const options = [
      { id: '__none', label: 'Ohne Ordner', current: !note.folderId },
      ...flatTree(folders).map(({ folder: f, depth }) => ({ id: f.id, label: f.name, icon: badge(f, 'dlg-badge'), depth, current: f.id === note.folderId })),
      { id: '__new', label: '+ Neuer Ordner …' },
    ];
    let target = await chooseFrom({ title: 'Verschieben nach', options });
    if (!target) return;
    if (target === '__new') {
      const f = await newFolder(false);
      if (!f) return;
      target = f.id;
    }
    const folderId = target === '__none' ? null : target;
    const name = folderId ? folderOf(folderId)?.name : 'Ohne Ordner';
    update(note, { folderId }, `Verschoben nach „${name}“`);
  }

  async function duplicate(note) {
    const pages = await store.getPages(note.pageIds);
    const copies = pages.map((p) => ({ ...p, id: store.uid() }));
    const now = Date.now();
    const copy = {
      ...note,
      id: store.uid(),
      title: `${note.title || 'Ohne Titel'} (Kopie)`,
      created: now,
      updated: now,
      favorite: false,
      pageIds: copies.map((p) => p.id),
      pageCount: copies.length,
    };
    await store.saveNote(copy, copies.map((p) => ({ ...p, noteId: copy.id })));
    notes.push(copy);
    render();
    toast('Notiz dupliziert');
  }

  async function trash(note) {
    await update(note, { deletedAt: Date.now() });
    toast('In den Papierkorb gelegt', { label: 'Rückgängig', run: () => update(note, { deletedAt: null }) });
  }

  async function deleteForever(note) {
    const ok = await confirmBox({
      title: 'Endgültig löschen?',
      text: `„${note.title || 'Ohne Titel'}“ ist danach wirklich weg.`,
      ok: 'Löschen',
      danger: true,
    });
    if (!ok) return;
    await store.deleteNoteForever(note);
    notes = notes.filter((n) => n !== note);
    render();
    store.cleanupBlobs().catch(() => {}); // Bilder/PDFs der Notiz wegräumen
  }

  async function emptyTrash() {
    const list = notes.filter((n) => n.deletedAt);
    const ok = await confirmBox({
      title: 'Papierkorb leeren?',
      text: `${list.length} ${list.length === 1 ? 'Notiz wird' : 'Notizen werden'} endgültig gelöscht.`,
      ok: 'Leeren',
      danger: true,
    });
    if (!ok) return;
    for (const n of list) await store.deleteNoteForever(n);
    notes = notes.filter((n) => !n.deletedAt);
    render();
    store.cleanupBlobs().catch(() => {});
  }

  async function newFolder(open = true, parentId = null) {
    const res = await folderDialog({ title: parentId ? 'Neuer Unterordner' : 'Neuer Ordner', folders, parentId, ok: 'Anlegen' });
    if (!res) return null;
    const folder = { id: store.uid(), name: res.name, color: res.color, icon: res.icon, parentId: res.parentId, created: Date.now() };
    await store.putFolder(folder);
    folders.push(folder);
    if (folder.parentId) expanded.add(folder.parentId);
    saveJSON('homeExpanded', [...expanded]);
    if (open) {
      filter = { kind: 'folder', id: folder.id };
      saveJSON('homeFilter', filter);
      drawerOpen = false;
    }
    render();
    return folder;
  }

  async function editFolder(folder) {
    const res = await folderDialog({ title: 'Ordner bearbeiten', folder, folders });
    if (!res) return;
    Object.assign(folder, { name: res.name, color: res.color, icon: res.icon, parentId: res.parentId });
    await store.putFolder(folder);
    render();
  }

  // Ordner in einen anderen Ordner legen (nicht in sich selbst oder seine Unterordner)
  async function moveFolder(folder) {
    const skip = new Set([folder.id, ...descendants(folders, folder.id)]);
    const target = await chooseFrom({
      title: `„${folder.name}“ verschieben nach`,
      options: [
        { id: '__top', label: 'Ganz oben (kein Oberordner)', current: !parentOf(folder) },
        ...flatTree(folders, skip).map(({ folder: f, depth }) => ({ id: f.id, label: f.name, icon: badge(f, 'dlg-badge'), depth, current: f.id === parentOf(folder) })),
      ],
    });
    if (!target) return;
    folder.parentId = target === '__top' ? null : target;
    if (folder.parentId) expanded.add(folder.parentId);
    saveJSON('homeExpanded', [...expanded]);
    await store.putFolder(folder);
    render();
    toast(folder.parentId ? `Verschoben nach „${folderOf(folder.parentId)?.name}“` : 'Ordner liegt jetzt ganz oben');
  }

  // Ordner löschen: Notizen und Unterordner darin rutschen eine Ebene nach oben – nichts geht verloren
  async function removeFolder(folder) {
    const n = live().filter((x) => x.folderId === folder.id).length;
    const kids = childrenOf(folders, folder.id);
    const up = parentOf(folder) ? `„${folderOf(parentOf(folder))?.name}“` : '„Alle Notizen“';
    const parts = [];
    if (n) parts.push(n === 1 ? 'Die Notiz darin' : `Die ${n} Notizen darin`);
    if (kids.length) parts.push(kids.length === 1 ? 'der Unterordner' : `die ${kids.length} Unterordner`);
    const ok = await confirmBox({
      title: `Ordner „${folder.name}“ löschen?`,
      text: parts.length ? `${parts.join(' und ')} ${n + kids.length === 1 ? 'bleibt' : 'bleiben'} erhalten (in ${up}).` : '',
      ok: 'Ordner löschen',
      danger: true,
    });
    if (!ok) return;
    const parent = parentOf(folder);
    for (const k of kids) {
      k.parentId = parent;
      await store.putFolder(k);
    }
    for (const note of notes.filter((x) => x.folderId === folder.id)) {
      note.folderId = parent;
      await store.putNote(note);
    }
    await store.deleteFolder(folder.id);
    if (filter.kind === 'folder' && filter.id === folder.id) filter = parent ? { kind: 'folder', id: parent } : { kind: 'all' };
    await reload();
  }

  // ---------- Sicherung ----------
  async function exportBackup() {
    try {
      const data = await store.exportAll();
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      const date = new Date().toISOString().slice(0, 10);
      const name = `federleicht-sicherung-${date}.json`;
      const file = new File([blob], name, { type: 'application/json' });
      // Am Tablet: Teilen-Menü (z. B. in Google Drive oder "Eigene Dateien" speichern), sonst Download
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: 'Federleicht-Sicherung' });
          return;
        } catch (err) {
          if (err.name === 'AbortError') return;
        }
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      toast(`Sicherung gespeichert (${data.notes.length} Notizen)`);
    } catch (err) {
      console.error(err);
      toast('Sicherung hat nicht geklappt');
    }
  }

  function importBackup() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const count = await store.importAll(JSON.parse(await file.text()));
        drawerOpen = false;
        filter = { kind: 'all' };
        await reload();
        toast(`${count} ${count === 1 ? 'Notiz' : 'Notizen'} geladen`);
      } catch (err) {
        console.error(err);
        toast('Das ist keine Federleicht-Sicherung');
      }
    };
    input.click();
  }

  // ---------- Nach außen ----------
  return {
    async show() {
      root.hidden = false;
      document.documentElement.classList.add('home-open');
      closeMenu();
      await reload();
      // Kurz warten (Startbildschirm soll erst flüssig erscheinen), dann für die Suche lesen
      setTimeout(runIndexer, 1500);
    },
    hide() {
      indexer.stop = true;
      today.stopTicker();
      root.hidden = true;
      document.documentElement.classList.remove('home-open');
      closeMenu();
      drawerOpen = false;
    },
    get open() {
      return !root.hidden;
    },
    // Hell/Dunkel gewechselt -> Vorschaubilder neu
    refresh() {
      if (!root.hidden) render();
    },
    currentFolder: () => (filter.kind === 'folder' ? filter.id : null),
  };
}

// "Heute, 14:05" / "Gestern, 9:30" / "Mo., 14:05" / "23. Nov." / "23.11.2025"
export function formatDate(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const now = new Date();
  const time = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  const startOfDay = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (days === 0) return `Heute, ${time}`;
  if (days === 1) return `Gestern, ${time}`;
  if (days > 1 && days < 7) return `${d.toLocaleDateString('de-DE', { weekday: 'short' })}, ${time}`;
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('de-DE', { day: 'numeric', month: 'short' });
  return d.toLocaleDateString('de-DE');
}

// Ganzes Datum: "24.11.2026"
export function fullDate(ms) {
  if (!ms) return '';
  return new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

// Notizen nach Datum gruppieren: Heute, Gestern, Diese Woche, Letzte Woche, dann nach Monaten
export function groupByDate(list, key = 'updated') {
  const now = new Date();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const today = day(now);
  const weekday = (now.getDay() + 6) % 7; // Montag = 0
  const weekStart = today - weekday * 86400000;
  const groups = [];
  const byName = new Map();
  for (const n of list) {
    const t = n[key] || 0;
    const d = new Date(t);
    let name;
    if (t >= today) name = 'Heute';
    else if (t >= today - 86400000) name = 'Gestern';
    else if (t >= weekStart) name = 'Diese Woche';
    else if (t >= weekStart - 7 * 86400000) name = 'Letzte Woche';
    else if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) name = 'Diesen Monat';
    else name = d.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
    if (!byName.has(name)) {
      const g = { name, notes: [] };
      byName.set(name, g);
      groups.push(g);
    }
    byName.get(name).notes.push(n);
  }
  return groups;
}

function readJSON(key, fallback) {
  try {
    const v = JSON.parse(localStorage.getItem('federleicht.' + key));
    return v ?? fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem('federleicht.' + key, JSON.stringify(value));
  } catch {
    /* egal */
  }
}
