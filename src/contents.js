// contents.js – Inhaltsverzeichnis als Seitenleiste (links) + Hausaufgaben der Notiz
//
// Knopf "Inhalt" in der Leiste (oder im ⋮-Menü) öffnet links eine Leiste mit zwei Reitern:
//
//   Inhalt        Alle Seiten der Notiz mit ihren Überschriften. Die findet die App selbst:
//                 Was du größer schreibst als den Rest (z. B. "Photosynthese" über dem Hefteintrag),
//                 gilt als Überschrift. Dazu kommen eigene Kapitel ("+ Kapitel hier") und die
//                 Hausaufgaben. Antippen = hinscrollen. Die Seite, auf der du gerade bist, ist markiert.
//   Hausaufgaben  Die Hausaufgaben dieser Notiz: abhaken, Datum ändern, hinspringen,
//                 neue markieren (Rahmen um die Aufgabe ziehen, siehe homework.js).
//
// Die Handschrift liest die App dafür mit der Texterkennung (offline). Schon gelesene Seiten
// (für die Suche, siehe searchindex.js) werden wiederverwendet – nur Geändertes wird neu gelesen.
//
// Eigene Kapitel stehen in der Notiz: note.chapters = [{ id, pageId, y, title }]

import { readPage, pageSignature, plain } from './searchindex.js';
import { HW_ICON, dueLabel, daysUntil } from './homework.js';
import { askText, chooseAction, esc } from './dialog.js';
import { uid } from './store.js';

export const TOC_ICON =
  '<svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/></svg>';
const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  mark: '<svg viewBox="0 0 24 24"><path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  frame: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
};

// So viel größer als normale Zeilen muss eine Zeile sein, um als Überschrift zu zählen
const HEADING_RATIO = 1.38;
const MAX_HEADING_CHARS = 60;

// api: { stage, doc, note(), currentIndex(), scrollTo(pageIndex, y), markHomework(), editHomework(hw),
//        toggleHomework(hw), saveNoteMeta(), onToggle?(open) }
export function setupContents(api) {
  const cache = new Map(); // Seiten-ID -> { sig, lines }
  let panel = null;
  let tab = 'toc';
  let reading = null; // { stop } solange gelesen wird
  let lastCurrent = -1;

  // ---------- Öffnen / Schließen ----------
  function open(which = tab) {
    tab = which;
    if (!panel) build();
    render();
    readMissing();
  }

  function close() {
    if (!panel) return;
    if (reading) reading.stop = true;
    reading = null;
    panel.classList.add('out');
    const p = panel;
    panel = null;
    setTimeout(() => p.remove(), 180);
    api.onToggle?.(false);
  }

  function toggle(which) {
    if (panel && (!which || which === tab)) close();
    else open(which);
  }

  function build() {
    panel = document.createElement('aside');
    panel.className = 'toc-panel';
    panel.innerHTML = `
      <div class="toc-head">
        <div class="toc-tabs" role="tablist">
          <button class="toc-tab" data-tab="toc">${TOC_ICON}<span>Inhalt</span></button>
          <button class="toc-tab" data-tab="hw">${HW_ICON}<span>Hausaufgaben</span><b class="toc-count"></b></button>
        </div>
        <button class="toc-close" data-act="close" aria-label="Schließen">${ICON.close}</button>
      </div>
      <div class="toc-body"></div>
      <div class="toc-foot"></div>`;
    api.stage.appendChild(panel);
    panel.addEventListener('click', onClick);
    // Nicht durch die Leiste hindurch auf der Seite zeichnen/scrollen
    for (const t of ['pointerdown', 'pointermove', 'pointerup']) panel.addEventListener(t, (e) => e.stopPropagation());
    api.onToggle?.(true);
  }

  // ---------- Anzeigen ----------
  function render() {
    if (!panel) return;
    const note = api.note();
    for (const b of panel.querySelectorAll('.toc-tab')) b.classList.toggle('on', b.dataset.tab === tab);
    const open = (note?.homework || []).filter((h) => !h.done).length;
    panel.querySelector('.toc-count').textContent = open || '';
    const body = panel.querySelector('.toc-body');
    const foot = panel.querySelector('.toc-foot');
    const scroll = body.scrollTop;
    if (tab === 'hw') {
      body.innerHTML = homeworkHTML(note);
      foot.innerHTML = `<button class="toc-btn primary" data-act="mark-hw">${ICON.frame}<span>Hausaufgabe markieren</span></button>`;
    } else {
      body.innerHTML = contentsHTML(note);
      foot.innerHTML = `<button class="toc-btn" data-act="chapter">${ICON.mark}<span>Kapitel hier einfügen</span></button>`;
    }
    body.scrollTop = scroll;
    lastCurrent = -1;
    updateCurrent();
  }

  // Alle Einträge einer Seite: Überschriften, eigene Kapitel, Hausaufgaben – nach Höhe sortiert
  function entriesOf(note, page, median) {
    const out = [];
    const lines = cache.get(page.id)?.lines || [];
    for (const l of lines) {
      if (isHeading(l, median)) out.push({ kind: 'h', y: l.b[1], title: l.t });
    }
    // Textfelder mit großer oder fetter erster Zeile
    for (const s of page.strokes) {
      if (s.tool !== 'text' || !s.box || !s.paras?.length) continue;
      const first = s.paras[0];
      const t = first.runs.map((r) => r.t).join('').trim();
      const size = Math.max(...first.runs.map((r) => r.s || s.base || 0));
      const big = size >= (s.base || size) * 1.25 || first.runs.every((r) => r.b || !r.t.trim());
      if (t && t.length <= MAX_HEADING_CHARS && (big || s.paras.length === 1) && !out.some((e) => e.title === t)) {
        if (big) out.push({ kind: 'h', y: s.box.minY, title: t });
      }
    }
    for (const c of note?.chapters || []) if (c.pageId === page.id) out.push({ kind: 'c', y: c.y, title: c.title, id: c.id });
    for (const hw of note?.homework || []) if (hw.pageId === page.id) out.push({ kind: 'hw', y: hw.box[1], title: hw.text || 'Hausaufgabe', hw });
    return out.sort((a, b) => a.y - b.y);
  }

  // Titel einer Seite: erste Überschrift, sonst die erste gelesene Zeile
  function pageTitle(page, entries) {
    const h = entries.find((e) => e.kind !== 'hw');
    if (h) return h.title;
    const lines = cache.get(page.id)?.lines || [];
    const first = [...lines].sort((a, b) => a.b[1] - b.b[1])[0];
    if (first) return first.t;
    const text = page.strokes.find((s) => s.tool === 'text' && s.paras);
    if (text) return plain(text).split('\n')[0].trim();
    return '';
  }

  function contentsHTML(note) {
    const doc = api.doc;
    const median = medianHeight();
    const rows = doc.pages.map((page, i) => {
      const entries = entriesOf(note, page, median);
      const title = pageTitle(page, entries);
      const readingThis = !cache.has(page.id) && hasInk(page);
      const empty = !page.strokes.length;
      const sub = entries
        .filter((e) => !(e.kind === 'h' && e.title === title && e === entries[0]))
        .map(
          (e) => `<button class="toc-row toc-${e.kind}" data-page="${i}" data-y="${Math.round(e.y)}"${e.id ? ` data-chapter="${e.id}"` : ''}${e.hw ? ` data-hw="${e.hw.id}"` : ''}>
              <span class="toc-ic">${e.kind === 'hw' ? HW_ICON : e.kind === 'c' ? ICON.mark : ''}</span>
              <span class="toc-t">${esc(short(e.title))}</span>
              ${e.hw ? `<small class="toc-due${dueClass(e.hw)}">${e.hw.done ? 'erledigt' : esc(dueLabel(e.hw.due))}</small>` : ''}
              ${e.id ? `<span class="toc-more" data-chapter-more="${e.id}" role="button" aria-label="Kapitel bearbeiten">${ICON.more}</span>` : ''}
            </button>`
        )
        .join('');
      return `<div class="toc-page" data-index="${i}">
          <button class="toc-row toc-p" data-page="${i}" data-y="0">
            <span class="toc-num">${i + 1}</span>
            <span class="toc-t">${title ? esc(short(title)) : `<i>${empty ? 'Leere Seite' : readingThis ? 'wird gelesen …' : 'Seite ' + (i + 1)}</i>`}</span>
          </button>
          ${sub}
        </div>`;
    });
    const busy = reading ? '<div class="toc-busy"><span class="toc-spin"></span>Handschrift wird gelesen …</div>' : '';
    return busy + rows.join('') + '<p class="toc-tip">Überschriften findet die App selbst: Schreib sie einfach etwas größer als den Rest.</p>';
  }

  function homeworkHTML(note) {
    const list = [...(note?.homework || [])].sort((a, b) => Number(a.done) - Number(b.done) || (a.due || '').localeCompare(b.due || ''));
    if (!list.length) {
      return `<div class="toc-empty">${HW_ICON}<p>Noch keine Hausaufgaben in dieser Notiz.</p>
        <p class="toc-tip">Tippe unten auf „Hausaufgabe markieren“ und zieh mit dem Stift einen Rahmen um die Aufgabe. Die App liest sie und trägt sie bis zur nächsten Stunde ein.</p></div>`;
    }
    const pageIndex = (hw) => api.doc.pages.findIndex((p) => p.id === hw.pageId);
    return list
      .map(
        (hw) => `<div class="hw-row${hw.done ? ' done' : ''}">
          <button class="hw-check${hw.done ? ' on' : ''}" data-hw-toggle="${hw.id}" aria-label="Erledigt">${ICON.check}</button>
          <button class="hw-main" data-hw="${hw.id}" data-page="${pageIndex(hw)}" data-y="${Math.round(hw.box[1])}">
            <span class="hw-t">${esc(hw.text || 'Hausaufgabe')}</span>
            <small class="toc-due${dueClass(hw)}">${hw.done ? 'erledigt' : 'bis ' + esc(dueLabel(hw.due, { long: true }))} · Seite ${pageIndex(hw) + 1}</small>
          </button>
          <button class="hw-edit" data-hw-edit="${hw.id}" aria-label="Bearbeiten">${ICON.edit}</button>
        </div>`
      )
      .join('');
  }

  const dueClass = (hw) => (hw.done ? ' done' : daysUntil(hw.due) < 0 ? ' late' : daysUntil(hw.due) <= 1 ? ' soon' : '');
  const short = (t) => (t.length > 70 ? t.slice(0, 68) + '…' : t);
  const hasInk = (page) => page.strokes.some((s) => s.tool === 'pen' && !s.shape);

  function isHeading(line, median) {
    if (line.k !== 'ink' || !median) return false;
    const h = line.b[3] - line.b[1];
    return h >= median * HEADING_RATIO && line.t.length <= MAX_HEADING_CHARS && /\p{L}{2}/u.test(line.t);
  }

  // Typische Zeilenhöhe der Handschrift in der ganzen Notiz
  function medianHeight() {
    const hs = [];
    for (const page of api.doc.pages) for (const l of cache.get(page.id)?.lines || []) if (l.k === 'ink') hs.push(l.b[3] - l.b[1]);
    if (hs.length < 3) return 0;
    hs.sort((a, b) => a - b);
    return hs[Math.floor(hs.length / 2)];
  }

  // Die Seite markieren, auf der du gerade bist (wird beim Scrollen aufgerufen)
  function updateCurrent() {
    if (!panel || tab !== 'toc') return;
    const i = api.currentIndex();
    if (i === lastCurrent) return;
    lastCurrent = i;
    for (const el of panel.querySelectorAll('.toc-page')) el.classList.toggle('current', Number(el.dataset.index) === i);
  }

  // ---------- Handschrift lesen (nur Seiten, die noch nicht gelesen sind) ----------
  async function readMissing() {
    if (reading) return;
    const note = api.note();
    const known = note?.index?.pages || {};
    const todo = [];
    for (const page of api.doc.pages) {
      const sig = pageSignature(page);
      if (cache.get(page.id)?.sig === sig) continue;
      if (known[page.id]?.sig === sig) {
        cache.set(page.id, { sig, lines: known[page.id].lines });
        continue;
      }
      if (!hasInk(page)) {
        cache.set(page.id, { sig, lines: [] });
        continue;
      }
      todo.push({ page, sig });
    }
    if (!todo.length) return render();
    const job = { stop: false };
    reading = job;
    render();
    // Zuerst die Seite, auf der du gerade bist, dann die anderen
    const cur = api.doc.pages[api.currentIndex()];
    todo.sort((a, b) => (b.page === cur) - (a.page === cur));
    for (const { page, sig } of todo) {
      const lines = await readPage(page, () => job.stop);
      if (job.stop || !lines) break;
      cache.set(page.id, { sig, lines });
      if (panel && reading === job) render();
    }
    if (reading === job) {
      reading = null;
      render();
    }
  }

  // ---------- Bedienen ----------
  async function onClick(e) {
    const t = e.target;
    if (t.closest('[data-act=close]')) return close();
    const tabBtn = t.closest('[data-tab]');
    if (tabBtn) {
      tab = tabBtn.dataset.tab;
      return render();
    }
    if (t.closest('[data-act=mark-hw]')) return api.markHomework();
    if (t.closest('[data-act=chapter]')) return addChapter();
    const chMore = t.closest('[data-chapter-more]');
    if (chMore) return chapterMenu(chMore.dataset.chapterMore);
    const toggleBtn = t.closest('[data-hw-toggle]');
    if (toggleBtn) {
      const hw = findHw(toggleBtn.dataset.hwToggle);
      if (hw) api.toggleHomework(hw);
      return;
    }
    const editBtn = t.closest('[data-hw-edit]');
    if (editBtn) {
      const hw = findHw(editBtn.dataset.hwEdit);
      if (hw) api.editHomework(hw);
      return;
    }
    const row = t.closest('[data-page]');
    if (row) {
      const i = Number(row.dataset.page);
      if (i < 0) return;
      api.scrollTo(i, Number(row.dataset.y) || 0, row.dataset.hw ? findHw(row.dataset.hw) : null);
      // Auf schmalen Bildschirmen verdeckt die Leiste die Seite -> zumachen
      if (window.innerWidth < 900) close();
    }
  }

  const findHw = (id) => (api.note()?.homework || []).find((h) => h.id === id);

  // Kapitel an der Stelle, die gerade oben/mittig zu sehen ist
  async function addChapter() {
    const note = api.note();
    if (!note) return;
    const { pageIndex, y } = api.viewSpot();
    const page = api.doc.pages[pageIndex];
    // Vorschlag: die gelesene Zeile, die dort steht
    const lines = cache.get(page.id)?.lines || [];
    const near = [...lines].sort((a, b) => Math.abs(a.b[1] - y) - Math.abs(b.b[1] - y))[0];
    const title = await askText({ title: 'Kapitel hier einfügen', value: near && Math.abs(near.b[1] - y) < 260 ? near.t : '', placeholder: 'Name des Kapitels', ok: 'Einfügen' });
    if (!title) return;
    note.chapters = [...(note.chapters || []), { id: uid(), pageId: page.id, y: Math.max(0, Math.round(near && Math.abs(near.b[1] - y) < 260 ? near.b[1] : y)), title }];
    api.saveNoteMeta();
    tab = 'toc';
    render();
  }

  async function chapterMenu(id) {
    const note = api.note();
    const ch = note?.chapters?.find((c) => c.id === id);
    if (!ch) return;
    const a = await chooseAction({ title: ch.title, actions: [{ id: 'delete', label: 'Löschen' }, { id: 'rename', label: 'Umbenennen', primary: true }] });
    if (a === 'rename') {
      const title = await askText({ title: 'Kapitel umbenennen', value: ch.title });
      if (title) ch.title = title;
    } else if (a === 'delete') {
      note.chapters = note.chapters.filter((c) => c.id !== id);
    } else return;
    api.saveNoteMeta();
    render();
  }

  // Notiz gewechselt: Gelesenes vergessen
  function reset() {
    cache.clear();
    if (reading) reading.stop = true;
    reading = null;
    close();
  }

  return {
    open,
    close,
    toggle,
    reset,
    refresh: () => {
      if (!panel) return;
      render();
      readMissing();
    },
    updateCurrent,
    get isOpen() {
      return Boolean(panel);
    },
    get tab() {
      return tab;
    },
  };
}
