// home.js – der Startbildschirm (wie bei Samsung Notes)
//
//   links:  Seitenleiste mit "Alle Notizen", "Favoriten", deinen Ordnern und dem Papierkorb
//   rechts: alle Notizen als Kärtchen mit Vorschaubild, Titel und Datum
//   unten rechts: runder [+]-Knopf = neue Notiz (im gerade offenen Ordner)
//
// Bedienung:
//   Notiz antippen              -> öffnen
//   "…" oder lange drücken      -> Umbenennen, Favorit, Verschieben, Duplizieren, Löschen
//   Ordner: "+" bei "Ordner"    -> neuer Ordner (Name + Farbe), "…" am Ordner -> umbenennen/löschen
//   Gelöschte Notizen landen 30 Tage im Papierkorb, bevor sie wirklich weg sind.
//
// main.js gibt uns über "api" das Öffnen und Anlegen von Notizen.

import * as store from './store.js';
import { askText, confirmBox, chooseFrom, toast, esc } from './dialog.js';
import { paint } from './paint.js';
import { drawThumbnail, DEFAULT_TEMPLATE } from './templates.js';

const TRASH_DAYS = 30;
const LONG_PRESS_MS = 450;

export const FOLDER_COLORS = ['#4a6cf7', '#7048e8', '#e64980', '#e03131', '#f08c00', '#fab005', '#2f9e44', '#0c8599', '#868e96'];

const SORTS = [
  { id: 'updated', name: 'Zuletzt geändert' },
  { id: 'created', name: 'Erstellt' },
  { id: 'title', name: 'Titel (A–Z)' },
];

const ICON = {
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
};

export function setupHome(api) {
  const root = document.getElementById('home');

  let notes = [];
  let folders = [];
  // Was wird gerade angezeigt? { kind: 'all' | 'fav' | 'trash' | 'folder', id }
  let filter = readJSON('homeFilter', { kind: 'all' });
  let sort = readJSON('homeSort', 'updated');
  let search = '';
  let drawerOpen = false;
  const bitmaps = new Map(); // Vorschaubilder: Notiz-ID -> { key, bitmap }

  root.innerHTML = `
    <div class="h-scrim" data-act="drawer"></div>
    <aside class="h-side">
      <div class="h-brand"><img src="./icons/icon.svg" alt="" width="30" height="30" /><span>Federleicht</span></div>
      <nav class="h-nav"></nav>
      <div class="h-side-foot">
        <button class="h-link" data-act="backup">${ICON.backup}<span>Sicherung</span></button>
      </div>
    </aside>
    <section class="h-main">
      <header class="h-head">
        <button class="h-icon h-menu" data-act="drawer" aria-label="Ordner">${ICON.menu}</button>
        <div class="h-title-wrap">
          <h1 class="h-title"></h1>
          <span class="h-count"></span>
        </div>
        <label class="h-search">${ICON.search}<input type="search" placeholder="Notizen suchen" autocomplete="off" /></label>
        <button class="h-icon" data-act="sort" aria-label="Sortieren" title="Sortieren">${ICON.sort}</button>
        <button class="h-chip" data-act="empty-trash" hidden>Papierkorb leeren</button>
      </header>
      <div class="h-scroll">
        <div class="h-grid"></div>
        <div class="h-empty" hidden></div>
      </div>
      <button class="h-fab" data-act="new" aria-label="Neue Notiz" title="Neue Notiz">${ICON.pen}<b>${ICON.plus}</b></button>
    </section>
    <div class="h-menu-pop" hidden></div>`;

  const nav = root.querySelector('.h-nav');
  const grid = root.querySelector('.h-grid');
  const empty = root.querySelector('.h-empty');
  const pop = root.querySelector('.h-menu-pop');
  const searchInput = root.querySelector('.h-search input');

  // ---------- Daten laden ----------
  async function reload() {
    [notes, folders] = await Promise.all([store.getAllNotes(), store.getAllFolders()]);
    // Alte Notizen im Papierkorb endgültig löschen
    const limit = Date.now() - TRASH_DAYS * 24 * 3600 * 1000;
    for (const n of notes.filter((n) => n.deletedAt && n.deletedAt < limit)) {
      await store.deleteNoteForever(n);
    }
    notes = notes.filter((n) => !(n.deletedAt && n.deletedAt < limit));
    folders.sort((a, b) => a.created - b.created);
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

  function render() {
    renderNav();
    const list = visibleNotes();
    root.querySelector('.h-title').textContent = titleOfFilter();
    root.querySelector('.h-count').textContent = `${list.length} ${list.length === 1 ? 'Notiz' : 'Notizen'}`;
    root.querySelector('[data-act="empty-trash"]').hidden = filter.kind !== 'trash' || list.length === 0;
    root.querySelector('[data-act="new"]').hidden = filter.kind === 'trash';
    root.classList.toggle('drawer-open', drawerOpen);

    grid.innerHTML = list
      .map((n) => {
        const f = folderOf(n.folderId);
        const pages = n.pageCount || n.pageIds?.length || 1;
        const when = filter.kind === 'trash' ? `Gelöscht ${formatDate(n.deletedAt)}` : formatDate(n.updated);
        return `<div class="n-card" data-id="${n.id}">
          <div class="n-thumb"><canvas></canvas>${pages > 1 ? `<span class="n-pages">${pages}</span>` : ''}${n.favorite ? `<span class="n-star">${ICON.star}</span>` : ''}</div>
          <div class="n-info">
            <div class="n-title">${esc(n.title || 'Ohne Titel')}</div>
            <div class="n-meta">${f && filter.kind !== 'folder' ? `<i class="n-dot">${paint(f.color)}</i>` : ''}<span>${esc(when)}</span></div>
          </div>
          <button class="n-more" data-more aria-label="Mehr">${ICON.more}</button>
        </div>`;
      })
      .join('');

    empty.hidden = list.length > 0;
    if (!list.length) empty.innerHTML = emptyText();
    drawThumbs(list);
  }

  function emptyText() {
    if (search.trim()) return `<div class="h-empty-icon">${ICON.search}</div><b>Nichts gefunden</b><span>Keine Notiz heißt so.</span>`;
    if (filter.kind === 'trash') return `<div class="h-empty-icon">${ICON.trash}</div><b>Papierkorb ist leer</b><span>Gelöschte Notizen bleiben hier 30 Tage.</span>`;
    if (filter.kind === 'fav') return `<div class="h-empty-icon">${ICON.star}</div><b>Noch keine Favoriten</b><span>Über „…“ an einer Notiz markierst du sie mit Stern.</span>`;
    return `<div class="h-empty-icon">${ICON.notes}</div><b>Noch keine Notizen</b><span>Tippe auf den Stift unten rechts, um loszuschreiben.</span>`;
  }

  function renderNav() {
    const count = (fn) => live().filter(fn).length;
    const item = (kind, id, icon, label, n, extra = '') => {
      const on = filter.kind === kind && (kind !== 'folder' || filter.id === id);
      return `<button class="h-item${on ? ' on' : ''}" data-filter="${kind}"${id ? ` data-id="${id}"` : ''}>
        ${icon}<span>${esc(label)}</span><small>${n || ''}</small>${extra}</button>`;
    };
    nav.innerHTML = `
      ${item('all', '', ICON.notes, 'Alle Notizen', live().length)}
      ${item('fav', '', ICON.star, 'Favoriten', count((n) => n.favorite))}
      <div class="h-sect"><span>Ordner</span><button class="h-sect-add" data-act="new-folder" aria-label="Neuer Ordner" title="Neuer Ordner">${ICON.plus}</button></div>
      ${folders
        .map((f) =>
          item('folder', f.id, `<i class="h-fdot">${paint(f.color)}</i>`, f.name, count((n) => n.folderId === f.id),
            `<span class="h-fmore" data-fmore="${f.id}" role="button" aria-label="Ordner bearbeiten">${ICON.more}</span>`)
        )
        .join('')}
      ${folders.length ? '' : '<div class="h-hint">Ordner für deine Fächer, z. B. Mathe, Bio, Deutsch</div>'}
      <div class="h-sep"></div>
      ${item('trash', '', ICON.trash, 'Papierkorb', notes.length - live().length)}`;
  }

  // Vorschaubilder malen: gespeichertes Bild der ersten Seite (hell oder dunkel),
  // oder – wenn es noch keins gibt – nur die leere Vorlage.
  async function drawThumbs(list) {
    const dark = api.darkPaper();
    for (const n of list) {
      const canvas = grid.querySelector(`.n-card[data-id="${n.id}"] canvas`);
      if (!canvas) continue;
      const blob = dark ? n.thumbDark : n.thumbLight;
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
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'drawer') {
      drawerOpen = !drawerOpen;
      return render();
    }
    if (act === 'new') return api.createNote(filter.kind === 'folder' ? filter.id : null);
    if (act === 'new-folder') return newFolder();
    if (act === 'sort') return openSortMenu(t.closest('button'));
    if (act === 'backup') return openBackupMenu(t.closest('button'));
    if (act === 'empty-trash') return emptyTrash();

    const fmore = t.closest('[data-fmore]');
    if (fmore) return openFolderMenu(fmore.dataset.fmore, fmore);

    const navItem = t.closest('[data-filter]');
    if (navItem) {
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
    const card = e.target.closest('.n-card, .h-item[data-filter="folder"]');
    if (!card || e.target.closest('button.n-more, [data-fmore]')) return;
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
        else openFolderMenu(card.dataset.id, card);
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
      '-',
      { icon: ICON.trash, label: 'Löschen', danger: true, run: () => trash(note) },
    ]);
  }

  function openFolderMenu(id, anchor) {
    const folder = folderOf(id);
    if (!folder) return;
    showMenu(anchor, [
      { icon: ICON.rename, label: 'Umbenennen / Farbe', run: () => editFolder(folder) },
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
      ...folders.map((f) => ({ id: f.id, label: f.name, color: f.color, current: f.id === note.folderId })),
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
  }

  async function newFolder(open = true) {
    const used = new Set(folders.map((f) => f.color));
    const color = FOLDER_COLORS.find((c) => !used.has(c)) || FOLDER_COLORS[0];
    const res = await askText({ title: 'Neuer Ordner', placeholder: 'z. B. Mathe', ok: 'Anlegen', colors: FOLDER_COLORS, color });
    if (!res) return null;
    const folder = { id: store.uid(), name: res.text, color: res.color, created: Date.now() };
    await store.putFolder(folder);
    folders.push(folder);
    if (open) {
      filter = { kind: 'folder', id: folder.id };
      saveJSON('homeFilter', filter);
      drawerOpen = false;
    }
    render();
    return folder;
  }

  async function editFolder(folder) {
    const res = await askText({ title: 'Ordner bearbeiten', value: folder.name, colors: FOLDER_COLORS, color: folder.color });
    if (!res) return;
    folder.name = res.text;
    folder.color = res.color;
    await store.putFolder(folder);
    render();
  }

  async function removeFolder(folder) {
    const n = live().filter((x) => x.folderId === folder.id).length;
    const ok = await confirmBox({
      title: `Ordner „${folder.name}“ löschen?`,
      text: n ? `Die ${n === 1 ? 'Notiz darin bleibt' : `${n} Notizen darin bleiben`} erhalten (unter „Alle Notizen“).` : '',
      ok: 'Ordner löschen',
      danger: true,
    });
    if (!ok) return;
    await store.deleteFolder(folder.id);
    if (filter.kind === 'folder' && filter.id === folder.id) filter = { kind: 'all' };
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
    },
    hide() {
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
