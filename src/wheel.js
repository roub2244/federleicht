// wheel.js – das Schnellmenü (rund, wie das Stift-Menü in Samsung Notes)
//
// Öffnen: Stiftknopf in der Luft gedrückt halten (siehe input.js).
//
// Startansicht:
//   Mitte          = dein aktueller Stift (antippen -> alle Stifte)
//   oben links/rechts = Rückgängig / Wiederholen
//   rechts         = aktuelle Farbe (antippen -> Farben)
//   links          = Radierer an/aus
//   unten          = Favoriten | Stifte
// In den Unteransichten liegen die Auswahl-Knöpfe im Kreis um die Mitte,
// die Mitte bringt dich zurück. Daneben tippen schließt das Menü, ohne zu malen.
//
// Die Knöpfe liegen auf einem Kreis: Ein Punkt beim Winkel a (0° = oben, im Uhrzeigersinn)
// mit Abstand r von der Mitte liegt bei x = r·sin(a), y = −r·cos(a).

import { penSVG, isLight } from './pens.js';
import { PEN_TYPES, COLOR_PAGES, HIGHLIGHTER_COLORS, activeStyle, isActiveFavorite } from './tools.js';
import { penName } from './toolbar.js';

const SIZE = 280;  // Durchmesser in Pixeln
const RING = 92;   // Abstand der Knöpfe von der Mitte

const ICONS = {
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/></svg>',
  eraser:
    '<svg viewBox="0 0 24 24"><path d="M8.5 20H20"/><path d="M4.6 14.6 13.6 5.6a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L11 19.8H8.2l-3.6-3.6a1.2 1.2 0 0 1 0-1.6z"/><path d="m9 10.5 5.5 5.5"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8.5 19.5 4 20l.5-4.5z"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
};

function polar(r, deg) {
  const a = (deg * Math.PI) / 180;
  return [SIZE / 2 + r * Math.sin(a), SIZE / 2 - r * Math.cos(a)];
}

// Einen Knopf an Winkel/Abstand setzen
function at(deg, r, html, attrs, cls = '', color = '') {
  const [x, y] = polar(r, deg);
  return `<button class="wb ${cls}" style="left:${x}px;top:${y}px;${color ? `--c:${color}` : ''}" ${attrs}>${html}</button>`;
}

export function setupWheel({ tools, onPick }) {
  let root = null;
  let mode = 'main'; // 'main' | 'pens' | 'colors' | 'favorites'

  function currentType() {
    return tools.tool === 'highlighter' ? 'highlighter' : tools.penType;
  }

  function center() {
    if (mode !== 'main') {
      return `<button class="wheel-center back" data-act="back" data-label="Zurück">${ICONS.back}</button>`;
    }
    const s = activeStyle(tools);
    const art = tools.tool === 'eraser' ? `<span class="big-icon">${ICONS.eraser}</span>` : penSVG(s.type, s.color);
    return `<button class="wheel-center" data-act="mode" data-mode="pens" data-label="Stift wechseln">${art}</button>`;
  }

  function ring() {
    if (mode === 'main') {
      const s = activeStyle(tools);
      return [
        at(-42, RING, ICONS.undo, 'data-act="undo" data-label="Rückgängig"'),
        at(42, RING, ICONS.redo, 'data-act="redo" data-label="Wiederholen"'),
        at(90, RING, '', 'data-act="mode" data-mode="colors" data-label="Farbe"', `color big${isLight(s.color) ? ' light' : ''}`, s.color),
        at(-90, RING, ICONS.eraser, `data-act="eraser" data-label="Radierer"`, tools.tool === 'eraser' ? 'on' : ''),
        `<div class="wheel-pill">
          <button class="wb-pill" data-act="mode" data-mode="favorites" data-label="Favoriten">${ICONS.star}</button>
          <button class="wb-pill" data-act="mode" data-mode="pens" data-label="Stifte">${ICONS.pen}</button>
        </div>`,
      ].join('');
    }
    if (mode === 'pens') {
      const list = [...PEN_TYPES.map((t) => t.id), 'highlighter', 'eraser'];
      const step = 360 / list.length;
      return list
        .map((id, i) => {
          const active = id === 'eraser' ? tools.tool === 'eraser' : tools.tool !== 'eraser' && currentType() === id;
          const color = id === 'highlighter' ? tools.highlighter.color : tools.pens[id]?.color;
          const html = id === 'eraser' ? ICONS.eraser : penSVG(id, color);
          return at(i * step, RING, html, `data-act="pen" data-id="${id}" data-label="${penName(id)}"`, `pen${active ? ' on' : ''}`);
        })
        .join('');
    }
    if (mode === 'colors') {
      const type = currentType();
      const colors = type === 'highlighter' ? HIGHLIGHTER_COLORS : [...COLOR_PAGES[0], ...COLOR_PAGES[1].slice(0, 4)];
      const current = activeStyle(tools).color;
      const step = 360 / colors.length;
      return colors
        .map((c, i) =>
          at(i * step, RING, '', `data-act="color" data-id="${c}" data-label="Farbe"`, `color${c === current ? ' on' : ''}${isLight(c) ? ' light' : ''}`, c)
        )
        .join('');
    }
    // Favoriten
    if (tools.favorites.length === 0) {
      return '<p class="wheel-empty">Noch keine Favoriten.<br>Tippe im Stift-Menü auf den Stern.</p>';
    }
    const step = 360 / Math.max(tools.favorites.length, 4);
    return tools.favorites
      .map((f, i) =>
        at(i * step, RING, penSVG(f.type, f.color), `data-act="fav" data-id="${i}" data-label="${penName(f.type)}"`, `pen${isActiveFavorite(tools, f) ? ' on' : ''}`)
      )
      .join('');
  }

  function render() {
    if (!root) return;
    root.querySelector('.wheel').innerHTML = `<div class="wheel-disc"></div><div class="wheel-items mode-${mode}">${ring()}${center()}</div>`;
    root.querySelector('.wheel-tip').textContent = mode === 'main' ? penName(tools.tool === 'eraser' ? 'eraser' : currentType()) : '';
  }

  // Rad an Bildschirm-Position x/y öffnen (wird so verschoben, dass es ganz sichtbar ist)
  function open(x, y) {
    close();
    mode = 'main';
    root = document.createElement('div');
    root.className = 'wheel-backdrop';
    const half = SIZE / 2 + 10;
    const cx = Math.min(window.innerWidth - half, Math.max(half, x));
    const cy = Math.min(window.innerHeight - half, Math.max(half + 40, y));
    root.innerHTML = `<div class="wheel" style="left:${cx}px;top:${cy}px"></div><div class="wheel-tip" style="left:${cx}px;top:${cy - SIZE / 2 - 14}px"></div>`;
    document.body.append(root);
    render();

    const tip = root.querySelector('.wheel-tip');
    // Stift schwebt über einem Knopf -> Name oben anzeigen
    root.addEventListener('pointerover', (e) => {
      const target = e.target.closest('[data-label]');
      if (target) tip.textContent = target.dataset.label;
    });

    root.addEventListener('click', (e) => {
      const target = e.target.closest('[data-act]');
      if (!target) return;
      const { act, id } = target.dataset;
      if (act === 'mode') mode = target.dataset.mode;
      else if (act === 'back') mode = 'main';
      else {
        onPick({ act, id });
        if (act !== 'undo' && act !== 'redo') mode = 'main';
      }
      render();
    });

    // Daneben tippen: erst beim Abheben schließen. So landen auch die Bewegungen
    // dazwischen auf dem (unsichtbaren) Hintergrund und nicht auf dem Blatt -> kein Strich.
    root.addEventListener('pointerdown', (e) => {
      if (e.target !== root) return;
      try {
        root.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
    });
    root.addEventListener('pointerup', (e) => {
      if (e.target === root) close();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  function close() {
    root?.remove();
    root = null;
  }

  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });

  return {
    open,
    close,
    get isOpen() {
      return root !== null;
    },
  };
}
