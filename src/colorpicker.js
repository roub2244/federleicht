// colorpicker.js – Farbpalette zum freien Auswählen einer Farbe
//
// Eine Farbe kann man auf verschiedene Arten beschreiben:
//   HEX:  "#4a6cf7"  (Rot, Grün, Blau als Zahlen von 00 bis ff)
//   HSV:  Farbton (hue, 0–360°), Sättigung (0–1), Helligkeit (value, 0–1)
// Für eine Palette ist HSV praktisch:
//   - der Regenbogen-Balken wählt den Farbton
//   - das große Feld wählt Sättigung (nach rechts) und Helligkeit (nach oben)

import { paint } from './paint.js';

export function hsvToHex(h, s, v) {
  const f = (n) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToHsv(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  let h = 0;
  if (d) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max ? d / max : 0, v: max };
}

// Das Farbraster: oben Grautöne von Weiß bis Schwarz, darunter 12 Farbtöne
// in 7 Helligkeitsstufen. Einfach antippen – kein Mischen nötig.
function gridColors() {
  const rows = [];
  const grays = [];
  for (let i = 0; i < 12; i++) {
    const v = Math.round(255 - (255 * i) / 11);
    grays.push('#' + v.toString(16).padStart(2, '0').repeat(3));
  }
  rows.push(grays);
  const levels = [0.88, 0.76, 0.62, 0.5, 0.4, 0.3, 0.2]; // Helligkeit von hell nach dunkel
  for (const l of levels) {
    const row = [];
    for (let i = 0; i < 12; i++) row.push(hslToHex(i * 30, 0.85, l));
    rows.push(row);
  }
  return rows;
}

function hslToHex(h, s, l) {
  const a = s * Math.min(l, 1 - l);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
}

// Baut die Palette in "container" ein. onChange(hex) wird beim Ziehen laufend aufgerufen,
// onCommit(hex) einmal am Ende (Stift/Finger losgelassen) – dann merken wir uns die Farbe.
export function createColorPicker(container, initialHex, onChange, onCommit) {
  container.innerHTML = `
    <div class="tabs cp-tabs"><button data-cp="grid">Raster</button><button data-cp="spectrum">Spektrum</button></div>
    <div class="cp-grid" data-cp-panel="grid">
      ${gridColors()
        .map((row) => row.map((c) => `<button data-grid="${c}" aria-label="${c}">${paint(c)}</button>`).join(''))
        .join('')}
    </div>
    <div class="cp-spectrum" data-cp-panel="spectrum">
      <div class="cp-field">${paint('', 'field', ' data-hue="0"')}<div class="cp-thumb">${paint()}</div></div>
      <div class="cp-hue">${paint('', 'hue')}<div class="cp-thumb">${paint()}</div></div>
    </div>
    <div class="cp-info"><i class="cp-preview">${paint()}</i><input class="cp-hex" maxlength="7" spellcheck="false" /></div>`;

  // Umschalten zwischen Raster und Spektrum
  let mode = 'grid';
  function showMode() {
    for (const b of container.querySelectorAll('[data-cp]')) b.classList.toggle('selected', b.dataset.cp === mode);
    for (const p of container.querySelectorAll('[data-cp-panel]')) p.hidden = p.dataset.cpPanel !== mode;
  }
  container.addEventListener('click', (e) => {
    const tab = e.target.closest('[data-cp]');
    if (tab) {
      mode = tab.dataset.cp;
      showMode();
    }
    const cell = e.target.closest('[data-grid]');
    if (cell) {
      hsv = hexToHsv(cell.dataset.grid);
      onChange(render(cell.dataset.grid));
      onCommit(cell.dataset.grid);
    }
  });
  showMode();
  const field = container.querySelector('.cp-field');
  const hue = container.querySelector('.cp-hue');
  const preview = container.querySelector('.cp-preview');
  const hexInput = container.querySelector('.cp-hex');

  let hsv = hexToHsv(initialHex);

  // exact: genau diese HEX-Farbe anzeigen (Umrechnen nach HSV und zurück kann um 1 daneben liegen)
  function render(exact) {
    const hex = exact || hsvToHex(hsv.h, hsv.s, hsv.v);
    field.querySelector('[data-paint]').dataset.hue = Math.round(hsv.h);
    const fieldThumb = field.querySelector('.cp-thumb');
    fieldThumb.style.left = `${hsv.s * 100}%`;
    fieldThumb.style.top = `${(1 - hsv.v) * 100}%`;
    fieldThumb.firstElementChild.dataset.c = hex;
    const hueThumb = hue.querySelector('.cp-thumb');
    hueThumb.style.left = `${(hsv.h / 360) * 100}%`;
    hueThumb.firstElementChild.dataset.c = `hsl(${Math.round(hsv.h)} 100% 50%)`;
    preview.firstElementChild.dataset.c = hex;
    for (const cell of container.querySelectorAll('[data-grid]')) cell.classList.toggle('selected', cell.dataset.grid === hex);
    if (document.activeElement !== hexInput) hexInput.value = hex;
    return hex;
  }

  // Ziehen mit Stift oder Finger: Position im Element -> Wert zwischen 0 und 1
  function drag(element, update) {
    const move = (e) => {
      const r = element.getBoundingClientRect();
      const x = Math.min(1, Math.max(0, (e.clientX - r.left) / r.width));
      const y = Math.min(1, Math.max(0, (e.clientY - r.top) / r.height));
      update(x, y);
      onChange(render());
    };
    element.addEventListener('pointerdown', (e) => {
      try {
        element.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      move(e);
      element.addEventListener('pointermove', move);
    });
    const stop = () => {
      element.removeEventListener('pointermove', move);
      onCommit(hsvToHex(hsv.h, hsv.s, hsv.v));
    };
    element.addEventListener('pointerup', stop);
    element.addEventListener('pointercancel', stop);
  }

  drag(field, (x, y) => {
    hsv.s = x;
    hsv.v = 1 - y;
  });
  drag(hue, (x) => {
    hsv.h = Math.min(359.9, x * 360);
  });

  // HEX-Code direkt eintippen
  hexInput.addEventListener('input', () => {
    const value = hexInput.value.trim();
    if (/^#?[0-9a-f]{6}$/i.test(value)) {
      const hex = (value.startsWith('#') ? value : '#' + value).toLowerCase();
      hsv = hexToHsv(hex);
      onChange(render(hex));
      onCommit(hex);
    }
  });

  render(initialHex);
  return {
    set(hex) {
      hsv = hexToHsv(hex);
      render(hex);
    },
  };
}
