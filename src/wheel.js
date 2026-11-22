// wheel.js – das Schnellmenü (ein Rad wie ein "Waffenrad")
//
// Öffnen: Stiftknopf in der Luft gedrückt halten (siehe input.js).
// Innen:  Stiftarten, Textmarker, Radierer, Rückgängig, Wiederholen
// Außen:  Farben
// In der Mitte steht, was du gerade mit dem Stift berührst bzw. ausgewählt hast.
// Daneben tippen schließt das Rad – ohne einen Strich zu malen.
//
// Das Rad ist ein SVG. Die Stücke ("Sektoren") rechnen wir mit Sinus und Kosinus aus:
// Ein Punkt auf einem Kreis mit Radius r beim Winkel a liegt bei (r·cos a, r·sin a).

import { penSVG } from './pens.js';
import { PEN_TYPES } from './tools.js';
import { colorsOf } from './toolbar.js';

const R_CENTER = 48;  // Mitte
const R_INNER = 56;   // Sektoren von hier ...
const R_OUTER = 130;  // ... bis hier
const R_COLORS = 152; // Kreis der Farben
const SIZE = 344;     // Breite/Höhe des Rads in Pixeln

const ICONS = {
  eraser: `<path d="M8.5 20H20"/><path d="M4.6 14.6 13.6 5.6a2 2 0 0 1 2.8 0l3 3a2 2 0 0 1 0 2.8L11 19.8H8.2l-3.6-3.6a1.2 1.2 0 0 1 0-1.6z"/><path d="m9 10.5 5.5 5.5"/>`,
  undo: `<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>`,
  redo: `<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>`,
};

// Punkt auf dem Kreis. Winkel in Grad, 0° = oben, im Uhrzeigersinn
function polar(r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r * Math.cos(a), r * Math.sin(a)];
}

// Ein Ring-Stück von Winkel a0 bis a1 zwischen Radius r0 und r1
function sectorPath(r0, r1, a0, a1) {
  const [x0, y0] = polar(r1, a0);
  const [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1);
  const [x3, y3] = polar(r0, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M${x0} ${y0}A${r1} ${r1} 0 ${big} 1 ${x1} ${y1}L${x2} ${y2}A${r0} ${r0} 0 ${big} 0 ${x3} ${y3}Z`;
}

export function setupWheel({ tools, onPick }) {
  let root = null; // das offene Rad (oder null)

  function items() {
    return [
      ...PEN_TYPES.map((t) => ({ id: t.id, label: t.name, kind: 'type' })),
      { id: 'highlighter', label: 'Textmarker', kind: 'tool' },
      { id: 'eraser', label: tools.eraser.mode === 'area' ? 'Radierer (Bereich)' : 'Radierer', kind: 'tool' },
      { id: 'undo', label: 'Rückgängig', kind: 'action' },
      { id: 'redo', label: 'Wiederholen', kind: 'action' },
    ];
  }

  // Ist dieser Eintrag gerade ausgewählt?
  function isActive(item) {
    if (item.kind === 'type') return tools.tool === 'pen' && tools.pen.type === item.id;
    if (item.kind === 'tool') return tools.tool === item.id;
    return false;
  }

  function currentLabel() {
    if (tools.tool === 'pen') return PEN_TYPES.find((t) => t.id === tools.pen.type)?.name ?? 'Stift';
    return tools.tool === 'highlighter' ? 'Textmarker' : 'Radierer';
  }

  function colorTool() {
    return tools.tool === 'highlighter' ? 'highlighter' : 'pen';
  }

  function build() {
    const list = items();
    const step = 360 / list.length;
    const ct = colorTool();
    const color = tools[ct].color;

    const sectors = list
      .map((item, i) => {
        const mid = i * step;
        const [ix, iy] = polar((R_INNER + R_OUTER) / 2, mid);
        let icon;
        if (item.kind === 'type' || item.id === 'highlighter') {
          // kleines Stift-Bild, aufrecht
          const art = penSVG(item.id, item.kind === 'type' ? tools.pen.color : tools.highlighter.color)
            .replace('<svg ', `<svg x="${ix - 11}" y="${iy - 34}" width="22" height="68" `);
          icon = art;
        } else {
          icon = `<g class="wheel-icon" transform="translate(${ix - 15} ${iy - 15}) scale(1.25)">${ICONS[item.id]}</g>`;
        }
        return `<g class="wheel-seg${isActive(item) ? ' active' : ''}" data-kind="${item.kind}" data-id="${item.id}" data-label="${item.label}" style="--i:${i}">
          <path class="seg-bg" d="${sectorPath(R_INNER, R_OUTER, mid - step / 2 + 1.2, mid + step / 2 - 1.2)}"/>
          ${icon}
        </g>`;
      })
      .join('');

    const colors = colorsOf(ct);
    const cstep = 360 / colors.length;
    const dots = colors
      .map((c, i) => {
        const [x, y] = polar(R_COLORS, i * cstep + cstep / 2);
        return `<circle class="wheel-color${c === color ? ' active' : ''}" cx="${x}" cy="${y}" r="12" fill="${c}" data-color="${c}" data-label="Farbe"/>`;
      })
      .join('');

    return `
      <div class="wheel-glass"></div>
      <svg class="wheel-svg" viewBox="${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}">
        ${sectors}
        ${dots}
        <g class="wheel-center" data-close>
          <circle r="${R_CENTER}"/>
          <circle class="wheel-current" cx="0" cy="-14" r="9" fill="${color}"/>
          <text class="wheel-label" y="12">${currentLabel()}</text>
        </g>
      </svg>`;
  }

  // Rad an Bildschirm-Position x/y öffnen (wird so verschoben, dass es ganz sichtbar ist)
  function open(x, y) {
    close();
    root = document.createElement('div');
    root.className = 'wheel-backdrop';
    const wheel = document.createElement('div');
    wheel.className = 'wheel';
    const half = SIZE / 2 + 6;
    wheel.style.left = `${Math.min(window.innerWidth - half, Math.max(half, x))}px`;
    wheel.style.top = `${Math.min(window.innerHeight - half, Math.max(half, y))}px`;
    wheel.innerHTML = build();
    root.append(wheel);
    document.body.append(root);

    // Auf das Rad zeigen (Stift schwebt darüber) -> Name in der Mitte anzeigen
    wheel.addEventListener('pointerover', (e) => {
      const target = e.target.closest('[data-label]');
      root.querySelector('.wheel-label').textContent = target ? target.dataset.label : currentLabel();
    });

    wheel.addEventListener('click', (e) => {
      const target = e.target.closest('[data-kind], [data-color], [data-close]');
      if (!target) return;
      if (target.hasAttribute('data-close')) return close();
      const pick = target.dataset.color
        ? { kind: 'color', id: target.dataset.color }
        : { kind: target.dataset.kind, id: target.dataset.id };
      onPick(pick);
      if (pick.kind === 'action') {
        rebuild(); // bei Rückgängig/Wiederholen bleibt das Rad offen
      } else {
        close();
      }
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

  function rebuild() {
    if (!root) return;
    root.querySelector('.wheel').innerHTML = build();
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
