// toolbarconfig.js – Werkzeugleiste anpassen (wie "Verfügbare Tools" in Samsung Notes)
//
// Oben im Fenster siehst du eine Vorschau der Leiste. Darunter stehen alle Knöpfe:
//   - Schalter     -> Knopf in der Leiste zeigen oder ausblenden
//   - ⇅ ziehen     -> Reihenfolge ändern
//   - Zurücksetzen -> alles wie am Anfang
// Es gibt zwei Bereiche: die Werkzeuge in der Mitte und die Knöpfe rechts.
// Gespeichert wird die Einstellung im Browser (localStorage).

import { toast } from './dialog.js';

const KEY = 'federleicht.toolbar.v1';

// Alle Knöpfe, die man anpassen kann. "sel" findet den Knopf im HTML (index.html).
export const SECTIONS = [
  {
    id: 'tools',
    name: 'Werkzeuge (Mitte)',
    container: '.tools',
    items: [
      { id: 'pen', name: 'Stift', sel: '[data-tool="pen"]' },
      { id: 'highlighter', name: 'Textmarker', sel: '[data-tool="highlighter"]' },
      { id: 'eraser', name: 'Radierer', sel: '[data-tool="eraser"]' },
      { id: 'lasso', name: 'Lasso', sel: '[data-tool="lasso"]' },
      { id: 'shape', name: 'Formen', sel: '[data-tool="shape"]' },
      { id: 'fill', name: 'Füllen', sel: '[data-tool="fill"]' },
      { id: 'text', name: 'Text', sel: '[data-tool="text"]' },
      { id: 'laser', name: 'Laserpointer', sel: '[data-tool="laser"]' },
      { id: 'assist', name: 'Handschrifthilfe', sel: '#btn-assist' },
      { id: 'convert', name: 'Handschrift zu Text', sel: '#btn-convert' },
    ],
  },
  {
    id: 'actions',
    name: 'Knöpfe rechts',
    container: '.actions',
    items: [
      { id: 'claude', name: 'Claude fragen', sel: '#btn-claude' },
      { id: 'insert', name: 'Einfügen (Bild, Foto, PDF)', sel: '#btn-insert' },
      { id: 'share', name: 'Teilen und Exportieren', sel: '#btn-share' },
      { id: 'addpage', name: 'Seite hinzufügen', sel: '#btn-add-page' },
      { id: 'template', name: 'Seitenvorlage', sel: '#btn-template' },
      { id: 'pages', name: 'Seitenübersicht', sel: '#btn-pages' },
      { id: 'lock', name: 'Scroll-Sperre', sel: '#btn-lock' },
      { id: 'zoom', name: 'Zoom (100 %)', sel: '#btn-zoom' },
      { id: 'debug', name: 'Stift-Diagnose', sel: '#btn-debug' },
    ],
  },
];

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  grip: '<svg viewBox="0 0 24 24"><path d="m8 9 4-4 4 4M8 15l4 4 4-4"/></svg>',
};

// Gespeicherte Reihenfolge laden; neue Knöpfe (aus späteren Updates) kommen an ihren Standardplatz
function load() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    /* nichts gespeichert */
  }
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

  const itemOf = (sec, id) => sec.items.find((i) => i.id === id);
  const elementOf = (item) => document.querySelector(`.topbar ${item.sel}`);

  // Leiste so umbauen, wie es eingestellt ist (Reihenfolge + sichtbar/unsichtbar)
  function apply() {
    for (const sec of SECTIONS) {
      const box = document.querySelector(`.topbar ${sec.container}`);
      // Das, was immer am Ende bleiben soll (Favoriten, Knopf "Leiste anpassen")
      const tail = [...box.querySelectorAll(':scope > .keep-last')];
      for (const entry of config[sec.id]) {
        const item = itemOf(sec, entry.id);
        const el = item && elementOf(item);
        if (!el) continue;
        el.classList.toggle('tb-off', !entry.on);
        box.appendChild(el);
      }
      for (const el of tail) box.appendChild(el);
    }
    onChange?.();
  }

  // ---------- Das Fenster zum Anpassen ----------
  function open() {
    root = document.createElement('div');
    root.className = 'tbc';
    root.innerHTML = `
      <div class="tbc-panel" role="dialog" aria-label="Werkzeugleiste anpassen">
        <header class="tbc-head">
          <button class="icon-btn" data-act="close" aria-label="Fertig">${ICON.back}</button>
          <h2>Werkzeugleiste anpassen</h2>
          <button class="tbc-reset" data-act="reset">Zurücksetzen</button>
        </header>
        <div class="tbc-sub">Vorschau</div>
        <div class="tbc-preview"></div>
        <div class="tbc-scroll"></div>
      </div>`;
    document.body.appendChild(root);
    render();
    root.addEventListener('click', onClick);
    root.addEventListener('change', onToggle);
    root.addEventListener('pointerdown', onGripDown);
  }

  function close() {
    root?.remove();
    root = null;
  }

  // Symbol eines Knopfs aus der echten Leiste kopieren (dann sieht es genau gleich aus)
  function iconOf(item) {
    const el = elementOf(item);
    const svg = el?.querySelector('svg:not([hidden])');
    if (item.id === 'zoom') return '<span class="tbc-text">100 %</span>';
    if (item.id === 'lock') return el?.querySelector('.lock-open')?.outerHTML || '';
    return svg ? svg.outerHTML : '';
  }

  function render() {
    if (!root) return;
    root.querySelector('.tbc-preview').innerHTML = SECTIONS.map(
      (sec) => `<div class="tbc-prev-group ${sec.id}">${config[sec.id]
        .filter((e) => e.on && elementOf(itemOf(sec, e.id)))
        .map((e) => `<span class="tbc-prev-btn">${iconOf(itemOf(sec, e.id))}</span>`)
        .join('')}</div>`
    ).join('');
    root.querySelector('.tbc-scroll').innerHTML = SECTIONS.map(
      (sec) => `<div class="tbc-sect">${sec.name}</div>
        <div class="tbc-list" data-sec="${sec.id}">${config[sec.id]
          .map((e) => {
            const item = itemOf(sec, e.id);
            if (!elementOf(item)) return '';
            return `<div class="tbc-row${e.on ? '' : ' off'}" data-id="${e.id}">
              <span class="tbc-icon">${iconOf(item)}</span>
              <span class="tbc-name">${item.name}</span>
              <input type="checkbox" class="switch" data-toggle="${e.id}" ${e.on ? 'checked' : ''} aria-label="${item.name} zeigen" />
              <span class="tbc-grip" data-grip aria-label="Ziehen zum Verschieben">${ICON.grip}</span>
            </div>`;
          })
          .join('')}</div>`
    ).join('') + '<p class="tbc-hint">Ausgeblendete Werkzeuge erreichst du weiter über das Schnellmenü (Stiftknopf in der Luft gedrückt halten).</p>';
  }

  function onClick(e) {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'close' || e.target === root) close();
    if (act === 'reset') {
      config = defaults();
      save(config);
      apply();
      render();
      toast('Werkzeugleiste zurückgesetzt');
    }
  }

  function onToggle(e) {
    const id = e.target.dataset.toggle;
    if (!id) return;
    const sec = SECTIONS.find((s) => s.items.some((i) => i.id === id));
    const entry = config[sec.id].find((x) => x.id === id);
    // Mindestens ein Werkzeug muss bleiben
    if (!e.target.checked && sec.id === 'tools' && config.tools.filter((x) => x.on).length <= 1) {
      e.target.checked = true;
      toast('Ein Werkzeug muss in der Leiste bleiben');
      return;
    }
    entry.on = e.target.checked;
    save(config);
    apply();
    render();
  }

  // ---------- Ziehen zum Umordnen ----------
  function onGripDown(e) {
    const grip = e.target.closest('[data-grip]');
    if (!grip) return;
    e.preventDefault();
    const row = grip.closest('.tbc-row');
    const list = row.parentElement;
    const secId = list.dataset.sec;
    const startY = e.clientY;
    const rowH = row.getBoundingClientRect().height;
    const rows = [...list.children];
    const from = rows.indexOf(row);
    let to = from;
    row.classList.add('dragging');
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    const move = (ev) => {
      const dy = ev.clientY - startY;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / rowH)));
      row.style.transform = `translateY(${dy}px)`;
      // Die anderen Zeilen machen Platz
      rows.forEach((r, i) => {
        if (r === row) return;
        let shift = 0;
        if (from < to && i > from && i <= to) shift = -rowH;
        if (from > to && i < from && i >= to) shift = rowH;
        r.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      grip.removeEventListener('pointercancel', up);
      const list2 = config[secId];
      const ids = rows.map((r) => r.dataset.id);
      const [moved] = ids.splice(from, 1);
      ids.splice(to, 0, moved);
      // Einträge ohne Knopf (z. B. noch nicht eingebaut) behalten ihren Platz am Ende
      const rest = list2.filter((x) => !ids.includes(x.id));
      config[secId] = [...ids.map((id) => list2.find((x) => x.id === id)), ...rest];
      save(config);
      apply();
      render();
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
    grip.addEventListener('pointercancel', up);
  }

  apply();
  return { open, close, apply, get isOpen() { return Boolean(root); } };
}
