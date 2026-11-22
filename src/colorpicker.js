// colorpicker.js – Farbpalette zum freien Auswählen einer Farbe
//
// Eine Farbe kann man auf verschiedene Arten beschreiben:
//   HEX:  "#4a6cf7"  (Rot, Grün, Blau als Zahlen von 00 bis ff)
//   HSV:  Farbton (hue, 0–360°), Sättigung (0–1), Helligkeit (value, 0–1)
// Für eine Palette ist HSV praktisch:
//   - der Regenbogen-Balken wählt den Farbton
//   - das große Feld wählt Sättigung (nach rechts) und Helligkeit (nach oben)

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

// Baut die Palette in "container" ein. onChange(hex) wird beim Ziehen laufend aufgerufen,
// onCommit(hex) einmal am Ende (Stift/Finger losgelassen) – dann merken wir uns die Farbe.
export function createColorPicker(container, initialHex, onChange, onCommit) {
  container.innerHTML = `
    <div class="cp-field"><div class="cp-thumb"></div></div>
    <div class="cp-hue"><div class="cp-thumb"></div></div>
    <div class="cp-info"><i class="cp-preview"></i><input class="cp-hex" maxlength="7" spellcheck="false" /></div>`;
  const field = container.querySelector('.cp-field');
  const hue = container.querySelector('.cp-hue');
  const preview = container.querySelector('.cp-preview');
  const hexInput = container.querySelector('.cp-hex');

  let hsv = hexToHsv(initialHex);

  function render() {
    const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    field.style.setProperty('--hue', hsv.h);
    field.firstElementChild.style.left = `${hsv.s * 100}%`;
    field.firstElementChild.style.top = `${(1 - hsv.v) * 100}%`;
    field.firstElementChild.style.background = hex;
    hue.firstElementChild.style.left = `${(hsv.h / 360) * 100}%`;
    hue.firstElementChild.style.background = `hsl(${hsv.h} 100% 50%)`;
    preview.style.background = hex;
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
      hsv = hexToHsv(value.startsWith('#') ? value : '#' + value);
      onChange(render());
      onCommit(hsvToHex(hsv.h, hsv.s, hsv.v));
    }
  });

  render();
  return {
    set(hex) {
      hsv = hexToHsv(hex);
      render();
    },
  };
}
