// toolbar.js – die Werkzeugleiste oben und die Einstellungs-Popups
//
// Bedienung wie bei Samsung Notes:
//   - Werkzeug antippen        -> Werkzeug wählen
//   - Aktives Werkzeug nochmal -> Popup mit Einstellungen öffnen (Farbe, Dicke, Art …)
//   - Irgendwo daneben tippen  -> Popup schließen (dabei wird nicht gezeichnet)

import { createStroke, finishStroke, fillStroke } from './ink.js';
import { PEN_COLORS, HIGHLIGHTER_COLORS, PEN_TYPES, SIZE_RANGE, saveTools } from './tools.js';

const TITLES = { pen: 'Stift', highlighter: 'Textmarker', eraser: 'Radierer' };

export function setupToolbar({ tools, onToolChange, onSettingsChange, onClear }) {
  const buttons = [...document.querySelectorAll('.tool-btn')];
  const popup = document.getElementById('popup');
  let openFor = null; // für welches Werkzeug ist das Popup gerade offen?

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
    popup.innerHTML = `<div class="popup-title">${TITLES[tool]}</div>` + popupBody(tool);
    popup.hidden = false;
    popup.dataset.tool = tool;
    placePopup(buttons.find((b) => b.dataset.tool === tool));
    refresh();
  }

  function closePopup() {
    if (!openFor) return;
    openFor = null;
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
    popup.style.top = `${b.bottom + 10}px`;
  }

  // Der HTML-Inhalt des Popups (einmal beim Öffnen gebaut)
  function popupBody(tool) {
    if (tool === 'eraser') {
      return `
        <div class="segmented">
          <button data-mode="stroke"><b>Strich löschen</b><small>ganze Striche weg</small></button>
          <button data-mode="area"><b>Bereich löschen</b><small>nur, wo du radierst</small></button>
        </div>
        ${sizeRow()}
        <div class="eraser-preview"><i></i></div>
        <button class="danger-btn" data-clear>Seite leeren</button>`;
    }
    const colors = tool === 'pen' ? PEN_COLORS : HIGHLIGHTER_COLORS;
    const types =
      tool === 'pen'
        ? `<div class="types">${PEN_TYPES.map(
            (t) => `<button class="type-btn" data-type="${t.id}"><canvas></canvas><span>${t.name}</span></button>`
          ).join('')}</div>`
        : '';
    return `
      ${types}
      ${sizeRow()}
      <canvas class="preview"></canvas>
      <div class="swatches">
        ${colors.map((c) => `<button class="swatch-btn" data-color="${c}" style="--c:${c}" aria-label="Farbe ${c}"></button>`).join('')}
        <label class="swatch-btn custom" title="Eigene Farbe"><input type="color" data-custom /></label>
      </div>`;
  }

  function sizeRow() {
    return `<label class="size-row"><span>Dicke</span><input type="range" data-size /><output></output></label>`;
  }

  // Alles im Popup an die aktuellen Einstellungen anpassen (ohne neu zu bauen,
  // sonst würde z. B. der Schieberegler beim Ziehen "abreißen")
  function refresh() {
    updateButtons();
    const tool = openFor;
    if (!tool) return;
    const s = tools[tool];
    const range = SIZE_RANGE[tool];

    const slider = popup.querySelector('[data-size]');
    Object.assign(slider, range);
    slider.value = s.size;
    popup.querySelector('.size-row output').textContent = tool === 'eraser' ? `${s.size}` : s.size.toFixed(1);

    if (tool === 'eraser') {
      for (const b of popup.querySelectorAll('[data-mode]')) b.classList.toggle('selected', b.dataset.mode === s.mode);
      const circle = popup.querySelector('.eraser-preview i');
      circle.style.width = circle.style.height = `${s.size * 2}px`;
      return;
    }

    for (const b of popup.querySelectorAll('[data-color]')) b.classList.toggle('selected', b.dataset.color === s.color);
    const custom = popup.querySelector('.custom');
    custom.style.setProperty('--c', s.custom);
    custom.querySelector('input').value = s.custom;
    custom.classList.toggle('selected', s.color === s.custom && !colorsOf(tool).includes(s.color));

    for (const b of popup.querySelectorAll('[data-type]')) {
      b.classList.toggle('selected', b.dataset.type === s.type);
      drawSample(b.querySelector('canvas'), { tool, penType: b.dataset.type, color: s.color, size: 3.5 });
    }
    drawSample(popup.querySelector('.preview'), { tool, penType: s.type, color: s.color, size: s.size });
  }

  // Eine Einstellung ändern, speichern, Popup aktualisieren
  function change(fn) {
    fn(tools[openFor]);
    saveTools(tools);
    refresh();
    onSettingsChange();
  }

  // Ein Zuhörer für alle Knöpfe im Popup ("Event Delegation")
  let clearArmed = false;
  popup.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    if (target.dataset.color) change((s) => (s.color = target.dataset.color));
    if (target.dataset.type) change((s) => (s.type = target.dataset.type));
    if (target.dataset.mode) change((s) => (s.mode = target.dataset.mode));
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
    if (e.target.matches('[data-custom]')) change((s) => (s.custom = s.color = e.target.value));
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
  return { setTool, closePopup };
}

function colorsOf(tool) {
  return tool === 'pen' ? PEN_COLORS : HIGHLIGHTER_COLORS;
}

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
  const margin = Math.min(w / 4, 10 + size * scale);
  for (let i = 0; i <= 48; i++) {
    const t = i / 48;
    const x = margin + t * (w - margin * 2);
    const y = h / 2 - Math.sin(t * Math.PI * 2) * h * 0.18;
    const pressure = 0.2 + 0.75 * Math.sin(t * Math.PI); // in der Mitte fester drücken
    stroke.points.push([x, y, pressure]);
  }
  finishStroke(stroke);
  fillStroke(ctx, stroke);
}
