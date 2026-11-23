// toolbar.js – die Werkzeugleiste oben und die Einstellungs-Popups
//
// Bedienung wie bei Samsung Notes:
//   - Werkzeug antippen        -> Werkzeug wählen
//   - Aktives Werkzeug nochmal -> Popup mit Einstellungen öffnen (Stiftart, Dicke, Farbe …)
//   - Irgendwo daneben tippen  -> Popup schließen (dabei wird nicht gezeichnet)

import { createStroke, finishStroke, fillStroke } from './ink.js';
import { PEN_COLORS, HIGHLIGHTER_COLORS, PEN_TYPES, SIZE_RANGE, saveTools } from './tools.js';
import { penSVG } from './pens.js';
import { createColorPicker } from './colorpicker.js';

const TITLES = { pen: 'Stift', highlighter: 'Textmarker', eraser: 'Radierer' };
const RECENT_MAX = 6;

export function colorsOf(tool) {
  return tool === 'highlighter' ? HIGHLIGHTER_COLORS : PEN_COLORS;
}

// Eine Farbe aus der Palette in "Zuletzt benutzt" aufnehmen (vorne, ohne Doppelte)
export function rememberColor(settings, tool, color) {
  if (colorsOf(tool).includes(color)) return;
  settings.recent = [color, ...(settings.recent || []).filter((c) => c !== color)].slice(0, RECENT_MAX);
}

export function setupToolbar({ tools, onToolChange, onClear }) {
  const buttons = [...document.querySelectorAll('.tool-btn')];
  const popup = document.getElementById('popup');
  let openFor = null;      // für welches Werkzeug ist das Popup gerade offen?
  let colorTab = 'swatches'; // 'swatches' (Farbkreise) oder 'palette' (freie Farbwahl)
  let picker = null;

  // ---------- Werkzeug wählen ----------
  function setTool(tool) {
    if (tools.tool === tool) return;
    tools.tool = tool;
    saveTools(tools);
    updateButtons();
    closePopup();
    onToolChange(tool);
  }

  // Aktives Werkzeug hervorheben und die Farbpunkte unter den Symbolen setzen
  function updateButtons() {
    for (const btn of buttons) {
      const tool = btn.dataset.tool;
      btn.classList.toggle('active', tool === tools.tool);
      btn.setAttribute('aria-pressed', tool === tools.tool);
      if (tools[tool].color) btn.style.setProperty('--swatch', tools[tool].color);
    }
  }

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tools.tool !== tool) setTool(tool);
      else if (openFor === tool) closePopup();
      else openPopup(tool);
    });
  }

  // ---------- Popup ----------
  function openPopup(tool) {
    openFor = tool;
    popup.innerHTML = popupBody(tool);
    popup.hidden = false;
    popup.dataset.tool = tool;
    if (tool !== 'eraser') {
      picker = createColorPicker(
        popup.querySelector('.palette'),
        tools[tool].color,
        (hex) => change((s) => (s.color = hex), { fromPicker: true }),
        (hex) => change((s) => rememberColor(s, tool, hex), { fromPicker: true })
      );
    }
    placePopup(buttons.find((b) => b.dataset.tool === tool));
    refresh();
  }

  function closePopup() {
    if (!openFor) return;
    openFor = null;
    picker = null;
    popup.hidden = true;
    popup.innerHTML = '';
    clearArmed = false;
  }

  // Popup mittig unter den Knopf setzen, aber nicht über den Bildschirmrand hinaus
  function placePopup(button) {
    const b = button.getBoundingClientRect();
    const w = popup.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2));
    popup.style.left = `${left}px`;
    popup.style.top = `${b.bottom + 12}px`;
  }

  // Der HTML-Inhalt des Popups (einmal beim Öffnen gebaut)
  function popupBody(tool) {
    const head = `<div class="popup-head"><span class="popup-title">${TITLES[tool]}</span><span class="popup-sub"></span></div>`;
    if (tool === 'eraser') {
      return `${head}
        <div class="segmented">
          <button data-mode="stroke">${ICON_STROKE}<b>Strich löschen</b><small>ganze Striche weg</small></button>
          <button data-mode="area">${ICON_AREA}<b>Bereich löschen</b><small>nur, wo du radierst</small></button>
        </div>
        ${sizeRow('Größe')}
        <div class="eraser-preview"><i></i></div>
        <button class="danger-btn" data-clear>Seite leeren</button>`;
    }
    // Stifte nebeneinander wie in einem Stiftehalter
    const slots = tool === 'pen' ? PEN_TYPES : [{ id: 'highlighter', name: 'Textmarker' }];
    return `${head}
      <div class="pen-shelf ${tool === 'pen' ? '' : 'single'}">
        ${slots.map((t) => `<button class="pen-slot" data-type="${t.id}" aria-label="${t.name}"><span class="pen-holder"></span></button>`).join('')}
      </div>
      ${sizeRow('Dicke')}
      <canvas class="preview"></canvas>
      <div class="tabs">
        <button data-tab="swatches">Farben</button>
        <button data-tab="palette">Palette</button>
      </div>
      <div class="color-panel" data-panel="swatches">
        <div class="swatches">
          ${colorsOf(tool).map((c) => swatch(c)).join('')}
        </div>
        <div class="recent"></div>
      </div>
      <div class="color-panel palette" data-panel="palette"></div>`;
  }

  function sizeRow(label) {
    return `<label class="size-row"><span>${label}</span><input type="range" data-size /><output></output></label>`;
  }

  // Alles im Popup an die aktuellen Einstellungen anpassen (ohne neu zu bauen,
  // sonst würde z. B. der Schieberegler beim Ziehen "abreißen")
  function refresh({ fromPicker = false } = {}) {
    updateButtons();
    const tool = openFor;
    if (!tool) return;
    const s = tools[tool];
    const range = SIZE_RANGE[tool];

    const slider = popup.querySelector('[data-size]');
    Object.assign(slider, range);
    slider.value = s.size;
    // --fill: wie weit der Regler gefüllt ist (für die Farbe links vom Knopf)
    slider.style.setProperty('--fill', `${((s.size - range.min) / (range.max - range.min)) * 100}%`);
    popup.querySelector('.size-row output').textContent = tool === 'eraser' ? `${s.size}` : s.size.toFixed(1);

    if (tool === 'eraser') {
      popup.querySelector('.popup-sub').textContent = s.mode === 'area' ? 'Bereich' : 'Ganze Striche';
      for (const b of popup.querySelectorAll('[data-mode]')) b.classList.toggle('selected', b.dataset.mode === s.mode);
      const circle = popup.querySelector('.eraser-preview i');
      circle.style.width = circle.style.height = `${s.size * 2}px`;
      return;
    }

    const type = tool === 'pen' ? s.type : 'highlighter';
    popup.querySelector('.popup-sub').textContent =
      tool === 'pen' ? PEN_TYPES.find((t) => t.id === s.type)?.name ?? '' : '';
    popup.style.setProperty('--current', s.color);

    // Stifte im Halter in der aktuellen Farbe zeichnen, der gewählte steht weiter oben
    for (const b of popup.querySelectorAll('[data-type]')) {
      b.classList.toggle('selected', b.dataset.type === type);
      b.firstElementChild.innerHTML = penSVG(b.dataset.type, s.color);
    }

    // Farben
    for (const b of popup.querySelectorAll('[data-color]')) b.classList.toggle('selected', b.dataset.color === s.color);
    const recent = s.recent || [];
    popup.querySelector('.recent').innerHTML = recent.length
      ? `<span>Zuletzt</span><div class="swatches">${recent.map((c) => swatch(c, c === s.color)).join('')}</div>`
      : '';
    for (const b of popup.querySelectorAll('[data-tab]')) b.classList.toggle('selected', b.dataset.tab === colorTab);
    for (const p of popup.querySelectorAll('[data-panel]')) p.hidden = p.dataset.panel !== colorTab;
    if (picker && !fromPicker) picker.set(s.color);

    drawSample(popup.querySelector('.preview'), { tool, penType: type, color: s.color, size: s.size });
  }

  // Eine Einstellung ändern, speichern, Popup aktualisieren
  function change(fn, options) {
    fn(tools[openFor]);
    saveTools(tools);
    refresh(options);
  }

  // Ein Zuhörer für alle Knöpfe im Popup ("Event Delegation")
  let clearArmed = false;
  popup.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.dataset.color) change((s) => (s.color = target.dataset.color));
    if (target.dataset.type && openFor === 'pen') change((s) => (s.type = target.dataset.type));
    if (target.dataset.mode) change((s) => (s.mode = target.dataset.mode));
    if (target.dataset.tab) {
      colorTab = target.dataset.tab;
      refresh();
    }
    if (target.hasAttribute('data-clear')) {
      // Zweimal tippen, damit nichts aus Versehen weg ist
      if (!clearArmed) {
        clearArmed = true;
        target.textContent = 'Wirklich leeren? Nochmal tippen';
        target.classList.add('armed');
        setTimeout(() => {
          if (!target.isConnected) return;
          clearArmed = false;
          target.textContent = 'Seite leeren';
          target.classList.remove('armed');
        }, 3000);
      } else {
        onClear();
        closePopup();
      }
    }
  });

  popup.addEventListener('input', (e) => {
    if (e.target.matches('[data-size]')) change((s) => (s.size = Number(e.target.value)));
  });

  // ---------- Daneben tippen schließt das Popup ----------
  // Wir hören in der "capture"-Phase auf dem ganzen Fenster zu. Dann kommen wir VOR der
  // Zeichenfläche dran und können das Event mit stopPropagation() verschlucken.
  let swallowedPointer = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!openFor || popup.contains(e.target) || e.target.closest('.tool-btn')) return;
      closePopup();
      if (e.target.id === 'canvas') {
        swallowedPointer = e.pointerId; // auch die folgenden move/up dieses Stifts verschlucken
        e.stopPropagation();
      }
    },
    { capture: true }
  );
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      (e) => {
        if (e.pointerId !== swallowedPointer) return;
        e.stopPropagation();
        if (type !== 'pointermove') swallowedPointer = null;
      },
      { capture: true }
    );
  }
  window.addEventListener('resize', closePopup);

  updateButtons();
  return {
    setTool,
    closePopup,
    // nach Änderungen von außen (z. B. aus dem Schnellmenü) alles neu anzeigen
    update() {
      updateButtons();
      if (openFor) refresh();
    },
  };
}

function swatch(color, selected = false) {
  return `<button class="swatch-btn${selected ? ' selected' : ''}" data-color="${color}" style="--c:${color}" aria-label="Farbe ${color}"></button>`;
}

// Kleine Symbole für die Radierer-Modi
const ICON_STROKE = `<svg viewBox="0 0 48 28" aria-hidden="true"><path d="M4 18C12 6 18 6 24 14S36 22 44 10" stroke-dasharray="3 4"/></svg>`;
const ICON_AREA = `<svg viewBox="0 0 48 28" aria-hidden="true"><path d="M4 18C9 10 13 8 17 10M31 18C35 20 39 16 44 10"/><circle cx="24" cy="14" r="7" class="hole"/></svg>`;

// Eine Beispiel-Welle mit den echten Stift-Einstellungen in ein kleines Canvas malen
function drawSample(canvas, { tool, penType, color, size }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const scale = 1.2; // ungefähr so groß wie auf dem Blatt bei normalem Zoom
  const stroke = createStroke({ tool, penType, color, size: size * scale, simulatePressure: false });
  const margin = Math.min(w / 4, 14 + size * scale);
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = margin + t * (w - margin * 2);
    const y = h / 2 - Math.sin(t * Math.PI * 2) * h * 0.2;
    const pressure = 0.2 + 0.75 * Math.sin(t * Math.PI); // in der Mitte fester drücken
    stroke.points.push([x, y, pressure]);
  }
  finishStroke(stroke);
  fillStroke(ctx, stroke);
}
