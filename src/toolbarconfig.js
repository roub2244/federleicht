// toolbarconfig.js – Werkzeugleiste anpassen (wie "Verfügbare Tools" in Samsung Notes)
//
// Das Fenster füllt den ganzen Bildschirm:
//   oben       Vorschau der Leiste, genau so, wie sie gleich aussieht
//   darunter   "In der Leiste": Werkzeuge (Mitte) und Knöpfe (rechts)
//   ganz unten "Im ⋮-Menü": was nicht in der Leiste ist, findest du oben rechts unter ⋮
//
// Bedienung:
//   - Zeile am Griff (⇅) ziehen oder lange drücken und ziehen -> Reihenfolge ändern,
//     in "Im ⋮-Menü" ziehen = aus der Leiste nehmen, zurück nach oben ziehen = wieder hinein
//   - (−) / (+) links in der Zeile -> schnell herausnehmen / hinzufügen
//   - Zurücksetzen -> alles wie am Anfang
// Gespeichert wird im Browser (localStorage).

import { toast } from './dialog.js';

const KEY = 'federleicht.toolbar.v2';
const OLD_KEY = 'federleicht.toolbar.v1';

// Alle Knöpfe, die man anpassen kann. "sel" findet den Knopf im HTML (index.html).
// group: Knöpfe derselben Gruppe stehen ohne Trennstrich nebeneinander.
// off: im Standard nicht in der Leiste, sondern im ⋮-Menü.
export const SECTIONS = [
  {
    id: 'tools',
    name: 'Werkzeuge',
    hint: 'Stehen in der Mitte der Leiste',
    container: '.tools',
    items: [
      { id: 'pen', name: 'Stift', sel: '[data-tool="pen"]', group: 'draw' },
      { id: 'highlighter', name: 'Textmarker', sel: '[data-tool="highlighter"]', group: 'draw' },
      { id: 'eraser', name: 'Radierer', sel: '[data-tool="eraser"]', group: 'draw' },
      { id: 'lasso', name: 'Lasso', sel: '[data-tool="lasso"]', group: 'edit' },
      { id: 'shape', name: 'Formen', sel: '[data-tool="shape"]', group: 'edit' },
      { id: 'fill', name: 'Füllen', sel: '[data-tool="fill"]', group: 'edit' },
      { id: 'text', name: 'Text', sel: '[data-tool="text"]', group: 'edit' },
      { id: 'ruler', name: 'Lineal und Geodreieck', sel: '#btn-ruler', group: 'show' },
      { id: 'laser', name: 'Laserpointer', sel: '[data-tool="laser"]', group: 'show' },
      { id: 'assist', name: 'Handschrifthilfe', sel: '#btn-assist', group: 'help' },
      { id: 'convert', name: 'Handschrift zu Text', sel: '#btn-convert', group: 'help' },
      { id: 'math', name: 'Mathe-Hilfe', sel: '#btn-math', group: 'help', off: true },
      { id: 'record', name: 'Sprachaufnahme', sel: '#btn-record', group: 'help', off: true },
    ],
  },
  {
    id: 'actions',
    name: 'Knöpfe rechts',
    hint: 'Stehen rechts neben den Werkzeugen',
    container: '.actions',
    items: [
      { id: 'claude', name: 'Claude fragen', sel: '#btn-claude' },
      { id: 'insert', name: 'Einfügen (Bild, Foto, PDF)', sel: '#btn-insert' },
      { id: 'share', name: 'Teilen und Exportieren', sel: '#btn-share' },
      { id: 'addpage', name: 'Seite hinzufügen', sel: '#btn-add-page', off: true },
      { id: 'template', name: 'Seitenvorlage', sel: '#btn-template', off: true },
      { id: 'pages', name: 'Seitenübersicht', sel: '#btn-pages' },
      { id: 'lock', name: 'Scroll-Sperre', sel: '#btn-lock' },
      { id: 'zoom', name: 'Zoom zurücksetzen', sel: '#btn-zoom', off: true },
    ],
  },
];

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="m8 9 4-4 4 4M8 15l4 4 4-4"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M7 12h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M7 12h10M12 7v10"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="12" cy="5.5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="18.5" r="1.5"/></svg>',
};

const LONG_PRESS_MS = 320;

// Gespeicherte Einstellung laden; neue Knöpfe (aus späteren Updates) kommen an ihren Standardplatz
function load() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(KEY));
    if (!saved) {
      // Einstellung aus der alten Version übernehmen (dort gab es Schalter statt ⋮-Menü)
      saved = JSON.parse(localStorage.getItem(OLD_KEY));
      if (saved?.actions) {
        // die neuen Standards für "rechts" gelten trotzdem (die Leiste wurde aufgeräumt)
        delete saved.actions;
      }
    }
  } catch {
    /* nichts gespeichert */
  }
  saved = saved || {};
  const config = {};
  for (const sec of SECTIONS) {
    const list = Array.isArray(saved[sec.id]) ? saved[sec.id].filter((e) => sec.items.some((i) => i.id === e.id)) : [];
    sec.items.forEach((item, index) => {
      if (list.some((e) => e.id === item.id)) return;
      // nach dem Knopf einsortieren, der im Standard davor steht
      const before = sec.items.slice(0, index).reverse().find((i) => list.some((e) => e.id === i.id));
      const at = before ? list.findIndex((e) => e.id === before.id) + 1 : 0;
      list.splice(at, 0, { id: item.id, on: !item.off });
    });
    config[sec.id] = list;
  }
  return config;
}

function defaults() {
  const config = {};
  for (const sec of SECTIONS) config[sec.id] = sec.items.map((i) => ({ id: i.id, on: !i.off }));
  return config;
}

function save(config) {
  try {
    localStorage.setItem(KEY, JSON.stringify(config));
  } catch {
    /* egal */
  }
}

export function setupToolbarConfig({ onChange } = {}) {
  let config = load();
  let root = null;

  const sectionOf = (id) => SECTIONS.find((s) => s.items.some((i) => i.id === id));
  const itemOf = (id) => sectionOf(id)?.items.find((i) => i.id === id);
  const elementOf = (item) => item && document.querySelector(`.topbar ${item.sel}`);

  // Leiste so umbauen, wie es eingestellt ist (Reihenfolge, sichtbar/im ⋮-Menü, Trennstriche)
  function apply() {
    for (const sec of SECTIONS) {
      const box = document.querySelector(`.topbar ${sec.container}`);
      box.querySelectorAll(':scope > .tb-sep').forEach((el) => el.remove());
      // Das, was immer am Ende bleiben soll (Favoriten, ⋮-Knopf)
      const tail = [...box.querySelectorAll(':scope > .keep-last')];
      let lastGroup = null;
      for (const entry of config[sec.id]) {
        const item = itemOf(entry.id);
        const el = elementOf(item);
        if (!el) continue;
        el.classList.toggle('tb-off', !entry.on);
        // Zwischen Gruppen (Schreiben | Bearbeiten | Zeigen | Helfer) ein feiner Trennstrich
        if (entry.on && item.group) {
          if (lastGroup && lastGroup !== item.group) {
            const sep = document.createElement('i');
            sep.className = 'tb-sep';
            box.appendChild(sep);
          }
          lastGroup = item.group;
        }
        box.appendChild(el);
      }
      for (const el of tail) box.appendChild(el);
    }
    onChange?.();
  }

  // Was gerade nicht in der Leiste ist (fürs ⋮-Menü): [{ id, name, icon, element, section }]
  function hiddenItems() {
    const out = [];
    for (const sec of SECTIONS) {
      for (const entry of config[sec.id]) {
        if (entry.on) continue;
        const item = itemOf(entry.id);
        const el = elementOf(item);
        if (el && !el.hidden) out.push({ id: item.id, name: item.name, icon: iconOf(item), element: el, section: sec.id });
      }
    }
    return out;
  }

  // ---------- Das Fenster zum Anpassen ----------
  function open() {
    if (root) return;
    root = document.createElement('div');
    root.className = 'tbc';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Werkzeugleiste anpassen');
    root.innerHTML = `
      <header class="tbc-head">
        <button class="tbc-round" data-act="close" aria-label="Fertig">${ICON.back}</button>
        <h2>Werkzeugleiste anpassen</h2>
        <button class="tbc-reset" data-act="reset">Zurücksetzen</button>
      </header>
      <div class="tbc-scroll">
        <div class="tbc-body">
          <div class="tbc-sub">Vorschau</div>
          <div class="tbc-preview"></div>
          <div class="tbc-lists"></div>
        </div>
      </div>`;
    document.body.appendChild(root);
    render();
    root.addEventListener('click', onClick);
    root.addEventListener('pointerdown', onRowDown);
    requestAnimationFrame(() => root?.classList.add('in'));
  }

  function close() {
    root?.remove();
    root = null;
  }

  // Symbol eines Knopfs aus der echten Leiste kopieren (dann sieht es genau gleich aus)
  function iconOf(item) {
    const el = elementOf(item);
    if (item.id === 'zoom') return '<span class="tbc-text">100 %</span>';
    if (item.id === 'pages') return el?.querySelector('svg')?.outerHTML || '';
    if (item.id === 'lock') return el?.querySelector('.lock-open')?.outerHTML || '';
    const svg = el?.querySelector('svg:not([hidden])');
    return svg ? svg.outerHTML : '';
  }

  function previewHTML() {
    const group = (sec) => {
      let last = null;
      return config[sec.id]
        .filter((e) => e.on && elementOf(itemOf(e.id)))
        .map((e) => {
          const item = itemOf(e.id);
          const sep = item.group && last && last !== item.group ? '<i class="tbc-prev-sep"></i>' : '';
          last = item.group || last;
          return `${sep}<span class="tbc-prev-btn" data-prev="${e.id}">${iconOf(item)}</span>`;
        })
        .join('');
    };
    return `<div class="tbc-prev-group tools">${group(SECTIONS[0])}</div>
      <div class="tbc-prev-group actions">${group(SECTIONS[1])}<span class="tbc-prev-btn">${ICON.more}</span></div>`;
  }

  function rowHTML(entry, inBar) {
    const item = itemOf(entry.id);
    if (!elementOf(item)) return '';
    const sec = sectionOf(entry.id);
    return `<div class="tbc-row" data-id="${entry.id}" data-sec="${sec.id}">
      <button class="tbc-pm ${inBar ? 'minus' : 'plus'}" data-pm="${entry.id}" aria-label="${inBar ? 'Aus der Leiste nehmen' : 'In die Leiste'}">${inBar ? ICON.minus : ICON.plus}</button>
      <span class="tbc-icon">${iconOf(item)}</span>
      <span class="tbc-name">${item.name}${!inBar ? `<small>${sec.id === 'tools' ? 'Werkzeug' : 'Knopf rechts'}</small>` : ''}</span>
      <span class="tbc-grip" data-grip aria-label="Ziehen zum Verschieben">${ICON.grip}</span>
    </div>`;
  }

  function render() {
    if (!root) return;
    root.querySelector('.tbc-preview').innerHTML = previewHTML();
    const off = SECTIONS.flatMap((sec) => config[sec.id].filter((e) => !e.on));
    root.querySelector('.tbc-lists').innerHTML =
      SECTIONS.map(
        (sec) => `<div class="tbc-sect"><b>${sec.name} in der Leiste</b><small>${sec.hint}. Ziehe die Tools, um sie zu entfernen oder neu anzuordnen.</small></div>
          <div class="tbc-list" data-zone="${sec.id}">${config[sec.id].filter((e) => e.on).map((e) => rowHTML(e, true)).join('')}</div>`
      ).join('') +
      `<div class="tbc-sect"><b>Im ⋮-Menü</b><small>Was nicht in der Leiste ist, findest du oben rechts unter ⋮. Hierher ziehen = aus der Leiste nehmen.</small></div>
       <div class="tbc-list off" data-zone="off">${off.map((e) => rowHTML(e, false)).join('') || '<div class="tbc-empty">Alles ist in der Leiste.</div>'}</div>`;
  }

  // Aktuelle Reihenfolge aus den Listen lesen und übernehmen
  function readLists() {
    const next = {};
    for (const sec of SECTIONS) {
      const ids = [...root.querySelectorAll(`.tbc-list[data-zone="${sec.id}"] .tbc-row`)].map((r) => r.dataset.id);
      const offIds = [...root.querySelectorAll('.tbc-list[data-zone="off"] .tbc-row')]
        .map((r) => r.dataset.id)
        .filter((id) => sectionOf(id) === sec);
      next[sec.id] = [...ids.map((id) => ({ id, on: true })), ...offIds.map((id) => ({ id, on: false }))];
      // Knöpfe, die es auf diesem Gerät gerade nicht gibt, behalten ihren Eintrag
      for (const e of config[sec.id]) if (!next[sec.id].some((x) => x.id === e.id)) next[sec.id].push(e);
    }
    return next;
  }

  function commit(next) {
    if (!next.tools.some((e) => e.on)) {
      toast('Ein Werkzeug muss in der Leiste bleiben');
      render();
      return;
    }
    config = next;
    save(config);
    apply();
    render();
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close') return close();
    if (act === 'reset') {
      config = defaults();
      save(config);
      apply();
      render();
      toast('Werkzeugleiste zurückgesetzt');
      return;
    }
    const pm = e.target.closest('[data-pm]')?.dataset.pm;
    if (pm) {
      const sec = sectionOf(pm);
      const next = { ...config, [sec.id]: config[sec.id].map((x) => (x.id === pm ? { ...x, on: !x.on } : x)) };
      // Hinzugefügt: ans Ende der Leiste (wie bei Samsung)
      const entry = next[sec.id].find((x) => x.id === pm);
      if (entry.on) next[sec.id] = [...next[sec.id].filter((x) => x.on && x !== entry), entry, ...next[sec.id].filter((x) => !x.on)];
      commit(next);
    }
  }

  // ---------- Ziehen zum Umordnen ----------
  // Am Griff sofort, sonst nach kurzem Gedrückthalten (damit man die Liste noch scrollen kann)
  function onRowDown(e) {
    const row = e.target.closest('.tbc-row');
    if (!row || e.target.closest('[data-pm]')) return;
    const onGrip = Boolean(e.target.closest('[data-grip]'));
    if (onGrip) {
      e.preventDefault();
      startDrag(row, e);
      return;
    }
    const x0 = e.clientX;
    const y0 = e.clientY;
    const id = e.pointerId;
    const timer = setTimeout(() => {
      cleanup();
      navigator.vibrate?.(15);
      startDrag(row, { clientX: x0, clientY: y0, pointerId: id, target: row });
    }, LONG_PRESS_MS);
    const move = (ev) => {
      if (ev.pointerId === id && Math.hypot(ev.clientX - x0, ev.clientY - y0) > 8) cleanup();
    };
    const cleanup = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', cleanup);
      window.removeEventListener('pointercancel', cleanup);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', cleanup);
    window.addEventListener('pointercancel', cleanup);
  }

  function startDrag(row, e) {
    const scroller = root.querySelector('.tbc-scroll');
    const secId = row.dataset.sec;
    const r = row.getBoundingClientRect();
    const grabY = e.clientY - r.top;
    // Schwebende Kopie folgt dem Finger, die echte Zeile zeigt, wo sie landen wird
    const ghost = row.cloneNode(true);
    ghost.classList.add('tbc-ghost');
    ghost.style.width = `${r.width}px`;
    ghost.style.left = `${r.left}px`;
    ghost.style.top = `${r.top}px`;
    root.appendChild(ghost);
    row.classList.add('placeholder');
    root.classList.add('dragging');
    let lastY = e.clientY;
    let raf = 0;

    const place = (y) => {
      ghost.style.top = `${y - grabY}px`;
      // Ziel-Liste: die eigene Leisten-Liste oder "Im ⋮-Menü"
      const lists = [...root.querySelectorAll(`.tbc-list[data-zone="${secId}"], .tbc-list[data-zone="off"]`)];
      let target = lists[0];
      let best = Infinity;
      for (const l of lists) {
        const b = l.getBoundingClientRect();
        const d = y < b.top ? b.top - y : y > b.bottom ? y - b.bottom : 0;
        if (d < best) {
          best = d;
          target = l;
        }
      }
      target.querySelector('.tbc-empty')?.remove();
      const rows = [...target.querySelectorAll('.tbc-row')].filter((x) => x !== row);
      const before = rows.find((x) => {
        const b = x.getBoundingClientRect();
        return y < b.top + b.height / 2;
      });
      if (before) {
        if (row.nextElementSibling !== before || row.parentElement !== target) target.insertBefore(row, before);
      } else if (row.parentElement !== target || row.nextElementSibling) target.appendChild(row);
    };

    // Am Rand des Fensters automatisch weiterscrollen
    const autoScroll = () => {
      raf = 0;
      const b = scroller.getBoundingClientRect();
      const edge = 70;
      let v = 0;
      if (lastY < b.top + edge) v = -Math.ceil((b.top + edge - lastY) / 6);
      else if (lastY > b.bottom - edge) v = Math.ceil((lastY - (b.bottom - edge)) / 6);
      if (v) {
        scroller.scrollTop += v;
        place(lastY);
        raf = requestAnimationFrame(autoScroll);
      }
    };

    const move = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      ev.preventDefault();
      lastY = ev.clientY;
      place(lastY);
      if (!raf) raf = requestAnimationFrame(autoScroll);
    };
    const up = (ev) => {
      if (ev.pointerId !== e.pointerId) return;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      cancelAnimationFrame(raf);
      ghost.remove();
      row.classList.remove('placeholder');
      root.classList.remove('dragging');
      commit(readLists());
    };
    window.addEventListener('pointermove', move, { passive: false });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  }

  apply();
  return {
    open,
    close,
    apply,
    hiddenItems,
    isHidden: (id) => config[sectionOf(id)?.id]?.find((e) => e.id === id)?.on === false,
    get isOpen() {
      return Boolean(root);
    },
  };
}

// Wo soll ein Menü erscheinen? Am Knopf – oder, wenn der gerade im ⋮-Menü steckt, am ⋮-Knopf
export function anchorRect(el) {
  const r = el?.getBoundingClientRect();
  if (r && r.width > 0) return r;
  return document.getElementById('btn-more').getBoundingClientRect();
}
