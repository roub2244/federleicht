// toolbar.js – die Werkzeugleiste oben, die Einstellungs-Popups und die Favoriten
//
// Bedienung wie bei Samsung Notes:
//   - Werkzeug antippen        -> Werkzeug wählen
//   - Aktives Werkzeug nochmal -> Popup mit Einstellungen (Stiftart, Dicke, Farbe …)
//   - Irgendwo daneben tippen  -> Popup schließen (dabei wird nicht gezeichnet)
//   - Stern im Popup           -> aktuellen Stift als Favorit oben in die Leiste legen
//   - Favorit lange drücken    -> Favorit entfernen

import { createStroke, finishStroke, fillStroke, inkTheme, setInkTheme } from './ink.js';
import {
  PEN_TYPES, COLOR_PAGES, HIGHLIGHTER_COLORS, SIZE_RANGE, MAX_FAVORITES,
  saveTools, activeStyle, settingsOf, rememberColor, isActiveFavorite,
} from './tools.js';
import { penSVG, isLight } from './pens.js';
import { createColorPicker } from './colorpicker.js';
import { paint } from './paint.js';
import { SHAPE_KINDS, FILL_MODES, shapeFromDrag, densify, fillable } from './shapes.js';

const NAMES = { highlighter: 'Textmarker', eraser: 'Radierer', shape: 'Formen', lasso: 'Lasso', fill: 'Füllen' };
for (const t of PEN_TYPES) NAMES[t.id] = t.name;
export const penName = (type) => NAMES[type] || type;

const ICON = {
  star: '<svg viewBox="0 0 24 24"><path d="m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  clock: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
  stroke: '<svg viewBox="0 0 24 24"><path d="M3 15c3-6 6-6 9-2s6 4 9-2" stroke-dasharray="2.5 3"/></svg>',
  area: '<svg viewBox="0 0 24 24"><path d="M3 15c2-4 3.5-5 5-4.5M16 13.5c1.6.6 3.3-.2 5-3.5"/><circle cx="12" cy="12" r="3.6" stroke-dasharray="1.5 1.5"/></svg>',
  free: '<svg viewBox="0 0 24 24"><path d="M12 4.5c4.4 0 7.5 2.1 7.5 4.9s-3.1 4.9-7.5 4.9-7.5-2.1-7.5-4.9S7.6 4.5 12 4.5z" stroke-dasharray="2.4 2.2"/><path d="M7.6 13.6c-.9 1.4-.8 3.2.8 4 1.5.6 1.7 2 1 3"/></svg>',
  rect: '<svg viewBox="0 0 24 24"><rect x="4" y="5.5" width="16" height="13" rx="1.5" stroke-dasharray="2.4 2.2"/></svg>',
  all: '<svg viewBox="0 0 24 24"><path d="M3 17.5c2-4.5 4-4.5 5.5-1.5s3.5 2.5 5-1"/><path d="M14 5.5h7M17.5 5.5v7"/></svg>',
  ink: '<svg viewBox="0 0 24 24"><path d="M3.5 15c3-6 6-6 8.5-2s5.5 4 8.5-2"/></svg>',
  text: '<svg viewBox="0 0 24 24"><path d="M5 7V5h14v2M12 5v14M9 19h6"/></svg>',
};

export function setupToolbar({ tools, onToolChange, onClear }) {
  const buttons = [...document.querySelectorAll('.tool-btn')];
  const favBar = document.getElementById('favorites');
  const popup = document.getElementById('popup');
  let openFor = null;  // für welches Werkzeug ist das Popup gerade offen?
  let colorPage = 1;   // welche Farbseite (0 = Zuletzt)
  let pickerOpen = false;
  let picker = null;

  // Welche Stift-Einstellungen bearbeitet das offene Popup?
  const editType = () => (openFor === 'highlighter' || openFor === 'shape' || openFor === 'fill' ? openFor : tools.penType);
  const edited = () => settingsOf(tools, editType());

  // ---------- Werkzeug wählen ----------
  function setTool(tool) {
    if (tools.tool === tool) return;
    tools.tool = tool;
    saveTools(tools);
    closePopup();
    updateBar();
    onToolChange(tool);
  }

  // Werkzeugleiste aktualisieren: aktives Werkzeug, Farbstriche, Favoriten
  function updateBar() {
    for (const btn of buttons) {
      const tool = btn.dataset.tool;
      btn.classList.toggle('active', tool === tools.tool);
      btn.setAttribute('aria-pressed', tool === tools.tool);
      const color =
        tool === 'pen' ? tools.pens[tools.penType].color : tool === 'highlighter' ? tools.highlighter.color : tool === 'shape' ? tools.shape.color : tool === 'fill' ? tools.fill.color : '';
      if (color) {
        btn.style.setProperty('--swatch', color);
        btn.querySelector('.swatch canvas').dataset.c = color;
      }
    }
    favBar.innerHTML = tools.favorites
      .map(
        (f, i) =>
          `<button class="fav${isActiveFavorite(tools, f) ? ' active' : ''}${isLight(f.color) ? ' light' : ''}${f.type === 'highlighter' ? ' hl' : ''}"
            data-fav="${i}" title="${penName(f.type)} – lange drücken zum Entfernen">${paint(f.color)}</button>`
      )
      .join('');
    favBar.hidden = tools.favorites.length === 0;
  }

  for (const btn of buttons) {
    btn.addEventListener('click', () => {
      const tool = btn.dataset.tool;
      if (tools.tool !== tool) setTool(tool);
      else if (tool === 'text') return; // Text hat kein eigenes Popup – die Format-Leiste kommt beim Tippen
      else if (openFor === tool) closePopup();
      else openPopup(tool);
    });
  }

  // ---------- Favoriten ----------
  function applyFavorite(f) {
    if (f.type === 'highlighter') {
      Object.assign(tools.highlighter, { color: f.color, size: f.size, opacity: f.opacity ?? tools.highlighter.opacity });
      tools.tool = 'highlighter';
    } else {
      tools.penType = f.type;
      Object.assign(tools.pens[f.type], { color: f.color, size: f.size });
      tools.tool = 'pen';
    }
    saveTools(tools);
    closePopup();
    updateBar();
    onToolChange(tools.tool);
  }

  function toggleFavorite() {
    const s = activeStyle({ ...tools, tool: openFor === 'highlighter' ? 'highlighter' : 'pen' });
    const index = tools.favorites.findIndex((f) => f.type === s.type && f.color === s.color && Math.abs(f.size - s.size) < 0.01);
    if (index >= 0) tools.favorites.splice(index, 1);
    else {
      tools.favorites.push({ type: s.type, color: s.color, size: s.size, opacity: s.opacity });
      if (tools.favorites.length > MAX_FAVORITES) tools.favorites.shift(); // ältesten Favoriten ersetzen
    }
    saveTools(tools);
    refresh();
  }

  // Tippen = Favorit benutzen, lange drücken = Favorit entfernen
  let pressTimer = 0;
  let longPressed = false;
  favBar.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn) return;
    longPressed = false;
    clearTimeout(pressTimer);
    pressTimer = setTimeout(() => {
      longPressed = true;
      tools.favorites.splice(Number(btn.dataset.fav), 1);
      saveTools(tools);
      navigator.vibrate?.(20);
      updateBar();
    }, 600);
  });
  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    favBar.addEventListener(type, () => clearTimeout(pressTimer));
  }
  favBar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-fav]');
    if (!btn || longPressed) return;
    applyFavorite(tools.favorites[Number(btn.dataset.fav)]);
  });
  favBar.addEventListener('contextmenu', (e) => e.preventDefault());

  // ---------- Popup ----------
  function openPopup(tool) {
    openFor = tool;
    pickerOpen = false;
    colorPage = 1;
    popup.innerHTML = popupBody(tool);
    popup.hidden = false;
    popup.dataset.tool = tool;
    if (tool !== 'eraser' && tool !== 'lasso') {
      picker = createColorPicker(
        popup.querySelector('.picker'),
        edited().color,
        (hex) => change((s) => (s.color = hex), { fromPicker: true }),
        (hex) => {
          rememberColor(tools, hex);
          saveTools(tools);
          refresh({ fromPicker: true });
        }
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

  // Popup unter den Knopf setzen, aber nicht über den Bildschirmrand hinaus
  function placePopup(button) {
    const b = button.getBoundingClientRect();
    const w = popup.offsetWidth;
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2));
    popup.style.left = `${left}px`;
    popup.style.top = `${b.bottom + 12}px`;
  }

  function head(title, withStar) {
    return `<div class="popup-head">
      ${withStar ? `<button class="head-btn" data-star title="Als Favorit in die Leiste legen">${ICON.star}</button>` : ''}
      <span class="popup-title">${title}</span>
      <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
    </div>`;
  }

  // Der HTML-Inhalt des Popups (einmal beim Öffnen gebaut)
  function popupBody(tool) {
    if (tool === 'eraser') {
      return `${head('Radierer', false)}
        <div class="radio-list">
          <button data-mode="stroke"><i class="radio"></i>${ICON.stroke}<span>Strich löschen</span></button>
          <button data-mode="area"><i class="radio"></i>${ICON.area}<span>Bereich löschen</span></button>
        </div>
        ${stepper('size')}
        <div class="eraser-preview"><i></i></div>
        ${toggle('onlyHighlighter', 'Nur Textmarker löschen')}
        <button class="danger-btn" data-clear>Seite leeren</button>`;
    }
    if (tool === 'lasso') {
      return `${head('Lasso', false)}
        <div class="sect-label">Form der Auswahl</div>
        <div class="radio-list">
          <button data-lmode="free"><i class="radio"></i>${ICON.free}<span>Freihand</span></button>
          <button data-lmode="rect"><i class="radio"></i>${ICON.rect}<span>Rechteck</span></button>
        </div>
        <div class="sect-label">Was auswählen?</div>
        <div class="radio-list">
          <button data-lwhat="all"><i class="radio"></i>${ICON.all}<span>Alles</span></button>
          <button data-lwhat="ink"><i class="radio"></i>${ICON.ink}<span>Nur Handschrift und Formen</span></button>
          <button data-lwhat="text"><i class="radio"></i>${ICON.text}<span>Nur Textfelder</span></button>
        </div>
        <p class="popup-hint">Kurz antippen wählt einen einzelnen Strich. Etwas Kopiertes fügst du ein, indem du mit dem Lasso auf eine freie Stelle tippst.</p>`;
    }
    if (tool === 'shape') {
      return `${head('Formen', false)}
        <div class="shape-grid">
          ${SHAPE_KINDS.map((k) => `<button class="shape-btn" data-shape="${k.id}" title="${k.name}" aria-label="${k.name}"><svg viewBox="0 0 24 24">${k.icon}</svg></button>`).join('')}
        </div>
        <canvas class="preview"></canvas>
        ${stepper('size')}
        <div class="seg-row"><span>Füllung</span><div class="seg">
          ${FILL_MODES.map((f) => `<button data-fill="${f.id}">${f.name}</button>`).join('')}
        </div></div>
        <div class="color-row"></div>
        <div class="page-dots"></div>
        <div class="picker" hidden></div>
        <p class="popup-hint">Tipp: Mit jedem Stift ungefähr zeichnen und am Ende den Stift kurz stillhalten – die Form wird von selbst perfekt.</p>`;
    }
    if (tool === 'fill') {
      return `${head('Füllen', false)}
        <canvas class="preview fill-preview"></canvas>
        <div class="seg-row"><span>Deckkraft</span><div class="seg">
          ${FILL_ALPHAS.map((f) => `<button data-falpha="${f.value}">${f.name}</button>`).join('')}
        </div></div>
        <div class="color-row"></div>
        <div class="page-dots"></div>
        <div class="picker" hidden></div>
        <p class="popup-hint">In eine Fläche tippen, die rundherum von Linien umschlossen ist – auch auf Fotos und PDF-Arbeitsblättern. Kleine Lücken in der Linie sind kein Problem.</p>`;
    }
    const slots = tool === 'pen' ? PEN_TYPES : [{ id: 'highlighter', name: 'Textmarker' }];
    return `${head('', true)}
      <div class="pen-shelf ${tool === 'pen' ? '' : 'single'}">
        ${slots.map((t) => `<button class="pen-slot" data-type="${t.id}" aria-label="${t.name}"><span class="pen-holder"></span></button>`).join('')}
      </div>
      <canvas class="preview"></canvas>
      ${stepper('size')}
      ${tool === 'highlighter' ? stepper('opacity') : ''}
      ${toggle('straighten', tool === 'pen' ? 'Formen erkennen' : 'Linien begradigen', tool === 'pen' ? 'Am Strichende kurz stillhalten: Linie, Kreis, Rechteck, Dreieck, Pfeil …' : 'Am Strichende den Stift kurz stillhalten')}
      <div class="color-row"></div>
      <div class="page-dots"></div>
      <div class="picker" hidden></div>`;
  }

  // Regler wie in Samsung Notes: − [Spur mit Punkten und Knopf mit Zahl] +
  function stepper(kind) {
    return `<div class="stepper" data-stepper="${kind}">
      <button data-step="-1" aria-label="weniger">${ICON.minus}</button>
      <div class="st-track ${kind}">${kind === 'opacity' ? paint('', 'checker') : ''}<span class="st-thumb"></span></div>
      <button data-step="1" aria-label="mehr">${ICON.plus}</button>
    </div>`;
  }

  function toggle(key, label, hint = '') {
    return `<label class="switch-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" data-toggle="${key}" /></label>`;
  }

  // ---------- Regler: Wert <-> Position (0 bis 1) ----------
  const STEPS = 49; // 50 Stufen, angezeigt als 1 bis 50
  function stepperInfo(kind) {
    if (kind === 'opacity') {
      return {
        get: () => (tools.highlighter.opacity - 0.15) / 0.75,
        set: (t) => (tools.highlighter.opacity = Math.round((0.15 + t * 0.75) * 100) / 100),
        label: () => Math.round(tools.highlighter.opacity * 100),
      };
    }
    const type = openFor === 'eraser' ? 'eraser' : editType();
    const range = SIZE_RANGE[type];
    const s = openFor === 'eraser' ? tools.eraser : edited();
    return {
      get: () => (s.size - range.min) / (range.max - range.min),
      set: (t) => (s.size = Math.round((range.min + t * (range.max - range.min)) * 100) / 100),
      label: () => Math.round(1 + ((s.size - range.min) / (range.max - range.min)) * STEPS),
    };
  }

  function setStepper(kind, t) {
    stepperInfo(kind).set(Math.min(1, Math.max(0, t)));
    saveTools(tools);
    refresh();
  }

  // Ziehen auf der Spur
  popup.addEventListener('pointerdown', (e) => {
    const track = e.target.closest('.st-track');
    if (!track) return;
    const kind = track.closest('[data-stepper]').dataset.stepper;
    try {
      track.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    const move = (ev) => {
      const r = track.getBoundingClientRect();
      const t = (ev.clientX - r.left - 14) / (r.width - 28); // 14 = halbe Knopfbreite
      setStepper(kind, Math.round(t * STEPS) / STEPS);
    };
    move(e);
    track.addEventListener('pointermove', move);
    const stop = () => {
      track.removeEventListener('pointermove', move);
      track.removeEventListener('pointerup', stop);
      track.removeEventListener('pointercancel', stop);
    };
    track.addEventListener('pointerup', stop);
    track.addEventListener('pointercancel', stop);
  });

  // Alles im Popup an die aktuellen Einstellungen anpassen (ohne neu zu bauen,
  // sonst würde z. B. ein Regler beim Ziehen "abreißen")
  function refresh({ fromPicker = false } = {}) {
    updateBar();
    const tool = openFor;
    if (!tool) return;

    for (const st of popup.querySelectorAll('[data-stepper]')) {
      const info = stepperInfo(st.dataset.stepper);
      st.style.setProperty('--t', info.get());
      st.querySelector('.st-thumb').textContent = info.label();
    }
    for (const sw of popup.querySelectorAll('[data-toggle]')) {
      sw.checked = sw.dataset.toggle === 'straighten' ? tools.straighten : tools.eraser[sw.dataset.toggle];
    }

    if (tool === 'lasso') {
      for (const b of popup.querySelectorAll('[data-lmode]')) b.classList.toggle('selected', b.dataset.lmode === tools.lasso.mode);
      for (const b of popup.querySelectorAll('[data-lwhat]')) b.classList.toggle('selected', b.dataset.lwhat === tools.lasso.what);
      return;
    }
    if (tool === 'eraser') {
      for (const b of popup.querySelectorAll('[data-mode]')) b.classList.toggle('selected', b.dataset.mode === tools.eraser.mode);
      const circle = popup.querySelector('.eraser-preview i');
      circle.style.width = circle.style.height = `${tools.eraser.size * 2}px`;
      return;
    }

    const type = editType();
    const s = edited();
    popup.querySelector('.popup-title').textContent = penName(type);
    popup.style.setProperty('--current', s.color);
    if (tool === 'highlighter') popup.querySelector('.st-track.opacity canvas').dataset.c = s.color;

    // Stern gefüllt, wenn dieser Stift schon ein Favorit ist
    const fav = tools.favorites.some((f) => f.type === type && f.color === s.color && Math.abs(f.size - s.size) < 0.01);
    popup.querySelector('[data-star]')?.classList.toggle('on', fav);
    for (const b of popup.querySelectorAll('[data-shape]')) b.classList.toggle('selected', b.dataset.shape === tools.shape.kind);
    for (const b of popup.querySelectorAll('[data-falpha]')) b.classList.toggle('selected', Number(b.dataset.falpha) === tools.fill.alpha);
    for (const b of popup.querySelectorAll('[data-fill]')) {
      b.classList.toggle('selected', b.dataset.fill === tools.shape.fill);
      b.disabled = !fillable(tools.shape.kind);
    }

    // Stifte im Halter in ihrer eigenen Farbe zeichnen, der gewählte steht weiter oben
    for (const b of popup.querySelectorAll('[data-type]')) {
      b.classList.toggle('selected', b.dataset.type === type);
      const color = settingsOf(tools, b.dataset.type).color;
      if (b.dataset.drawn !== color) {
        b.dataset.drawn = color; // nur neu zeichnen, wenn sich die Farbe geändert hat
        b.firstElementChild.innerHTML = penSVG(b.dataset.type, color);
      }
    }

    // Farbreihe: aktuelle Seite + Regenbogen-Knopf für die Palette
    const pages = tool === 'highlighter' ? [tools.recent, HIGHLIGHTER_COLORS] : [tools.recent, ...COLOR_PAGES];
    colorPage = Math.min(colorPage, pages.length - 1);
    const colors = pages[colorPage].slice(0, 8);
    popup.querySelector('.color-row').innerHTML =
      colors.map((c) => swatch(c, c === s.color)).join('') +
      (colors.length === 0 ? '<span class="empty">Noch keine eigenen Farben</span>' : '') +
      `<button class="rainbow${pickerOpen ? ' selected' : ''}" data-rainbow aria-label="Eigene Farbe">${paint('', 'rainbow')}</button>`;
    popup.querySelector('.page-dots').innerHTML = pages
      .map((_, i) => `<button data-page="${i}" class="${i === colorPage ? 'selected' : ''}" aria-label="Farbseite ${i}">${i === 0 ? ICON.clock : ''}</button>`)
      .join('');
    popup.querySelector('.picker').hidden = !pickerOpen;
    if (picker && !fromPicker) picker.set(s.color);

    if (tool === 'shape') drawShapeSample(popup.querySelector('.preview'), tools.shape);
    else if (tool === 'fill') drawFillSample(popup.querySelector('.preview'), tools.fill);
    else drawSample(popup.querySelector('.preview'), { type, ...s });
  }

  // Eine Einstellung ändern, speichern, Popup aktualisieren
  function change(fn, options) {
    fn(edited());
    saveTools(tools);
    refresh(options);
  }

  // Ein Zuhörer für alle Knöpfe im Popup ("Event Delegation")
  let clearArmed = false;
  popup.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const d = target.dataset;
    if (d.color) change((s) => (s.color = d.color));
    if (d.type && openFor === 'pen') {
      tools.penType = d.type;
      saveTools(tools);
      refresh();
    }
    if (d.mode) {
      tools.eraser.mode = d.mode;
      saveTools(tools);
      refresh();
    }
    if (d.shape || d.fill || d.lmode || d.lwhat || d.falpha) {
      if (d.falpha) tools.fill.alpha = Number(d.falpha);
      if (d.shape) tools.shape.kind = d.shape;
      if (d.fill) tools.shape.fill = d.fill;
      if (d.lmode) tools.lasso.mode = d.lmode;
      if (d.lwhat) tools.lasso.what = d.lwhat;
      saveTools(tools);
      refresh();
    }
    if (d.page) {
      colorPage = Number(d.page);
      refresh();
    }
    if (d.step) {
      const kind = target.closest('[data-stepper]').dataset.stepper;
      setStepper(kind, stepperInfo(kind).get() + Number(d.step) / STEPS);
    }
    if ('rainbow' in d) {
      pickerOpen = !pickerOpen;
      refresh();
    }
    if ('star' in d) toggleFavorite();
    if ('close' in d) closePopup();
    if ('clear' in d) {
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

  popup.addEventListener('change', (e) => {
    const key = e.target.dataset.toggle;
    if (!key) return;
    if (key === 'straighten') tools.straighten = e.target.checked;
    else tools.eraser[key] = e.target.checked;
    saveTools(tools);
  });

  // Farbreihe wischen = Farbseite wechseln
  let swipeStart = null;
  popup.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.color-row')) swipeStart = e.clientX;
  });
  popup.addEventListener('pointerup', (e) => {
    if (swipeStart === null) return;
    const dx = e.clientX - swipeStart;
    swipeStart = null;
    if (Math.abs(dx) > 40) {
      const pages = popup.querySelectorAll('[data-page]').length;
      colorPage = Math.min(pages - 1, Math.max(0, colorPage + (dx < 0 ? 1 : -1)));
      refresh();
    }
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

  updateBar();
  return {
    setTool,
    closePopup,
    applyFavorite,
    // nach Änderungen von außen (z. B. aus dem Schnellmenü) alles neu anzeigen
    update() {
      updateBar();
      if (openFor) refresh();
    },
  };
}

// Deckkraft der Füllung
const FILL_ALPHAS = [
  { value: 1, name: 'Deckend' },
  { value: 0.6, name: 'Mittel' },
  { value: 0.3, name: 'Leicht' },
];

// Vorschau Farbeimer: eine Wolke mit Rand, innen gefüllt
function drawFillSample(canvas, { color, alpha }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const cx = w / 2;
  const cy = h / 2;
  const r = Math.min(w / 3.2, h * 0.36);
  const path = new Path2D();
  for (let i = 0; i <= 72; i++) {
    const a = (i / 72) * Math.PI * 2;
    const rr = r * (1 + 0.08 * Math.sin(a * 5));
    const x = cx + Math.cos(a) * rr * 1.5;
    const y = cy + Math.sin(a) * rr;
    if (i) path.lineTo(x, y);
    else path.moveTo(x, y);
  }
  path.closePath();
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.fill(path);
  ctx.globalAlpha = 1;
  ctx.lineWidth = 2.2;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = '#1f2430';
  ctx.stroke(path);
}

function swatch(color, selected) {
  return `<button class="swatch-btn${selected ? ' selected' : ''}${isLight(color) ? ' light' : ''}" data-color="${color}" aria-label="Farbe ${color}">${paint(color, selected ? 'check' : '')}</button>`;
}

// Eine Beispiel-Schleife mit den echten Stift-Einstellungen in ein kleines Canvas malen
export function drawSample(canvas, { type, color, size, opacity }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  // Die Vorschau zeigt immer die echte Farbe (auch wenn das Blatt gerade dunkel ist)
  const savedTheme = { ...inkTheme };
  setInkTheme(false, '#ffffff');
  ctx.fillStyle = isLight(color) && type !== 'highlighter' ? '#2b2e35' : '#ffffff'; // Weiß auf dunklem Papier zeigen
  ctx.fillRect(0, 0, w, h);

  const scale = 1.25; // ungefähr so groß wie auf dem Blatt bei normalem Zoom
  const stroke = createStroke({
    tool: type === 'highlighter' ? 'highlighter' : 'pen',
    penType: type,
    color,
    size: size * scale,
    opacity,
    simulatePressure: false,
  });
  // Eine Schreibschrift-artige Welle mit Auf- und Abstrichen, Druck schwankt wie beim echten Schreiben
  const margin = 18 + size * scale;
  const n = 90;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = margin + t * (w - margin * 2) + Math.sin(t * Math.PI * 6) * 10;
    const y = h / 2 - Math.cos(t * Math.PI * 6) * h * 0.22;
    const pressure = 0.35 + 0.55 * Math.sin(t * Math.PI) * (0.6 + 0.4 * Math.sin(t * Math.PI * 6 + 1));
    stroke.points.push([x, y, pressure]);
  }
  if (type === 'highlighter') {
    // Textmarker: erst etwas "Schrift" (Kuli), dann zwei Marker-Striche, die sich überlappen.
    // So sieht man: die Schrift bleibt lesbar, und doppelt markiert wird es nicht dunkler.
    const text = createStroke({ penType: 'ballpoint', color: '#1f2a44', size: 2, simulatePressure: false });
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      text.points.push([margin + t * (w - margin * 2) + Math.sin(t * 60) * 3, h / 2 + Math.cos(t * 60) * 6, 0.5]);
    }
    fillStroke(ctx, finishStroke(text));
    const line = (x0, x1, y) => {
      const pts = [];
      for (let i = 0; i <= 20; i++) pts.push([x0 + (i / 20) * (x1 - x0), y, 0.5]);
      return pts;
    };
    const second = { ...stroke, points: line(w * 0.45, w - margin, h / 2 + 4) };
    stroke.points = line(margin, w * 0.62, h / 2 - 2);
    fillStroke(ctx, finishStroke(second));
  }
  finishStroke(stroke);
  fillStroke(ctx, stroke);
  setInkTheme(savedTheme.dark, savedTheme.paper);
}

// Vorschau im Formen-Menü: die gewählte Form mit Farbe, Dicke und Füllung
function drawShapeSample(canvas, { kind, color, size, fill }) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const savedTheme = { ...inkTheme };
  setInkTheme(false, '#ffffff');
  ctx.fillStyle = isLight(color) ? '#2b2e35' : '#ffffff';
  ctx.fillRect(0, 0, w, h);
  const s = size * 1.25;
  const m = 12 + s;
  // Linien quer, Flächen in der Mitte nicht zu breit
  const wide = ['line', 'arrow', 'double'].includes(kind);
  const bw = wide ? w - m * 2 : Math.min(w - m * 2, (h - m * 2) * 1.8);
  const a = wide ? [m, h - m] : [(w - bw) / 2, m];
  const b = wide ? [w - m, m] : [(w + bw) / 2, h - m];
  const alpha = (FILL_MODES.find((f) => f.id === fill) || FILL_MODES[0]).alpha;
  for (const poly of shapeFromDrag(kind, a, b, s)) {
    const filled = poly.closed && fillable(kind) && alpha > 0;
    const stroke = createStroke({ penType: 'ballpoint', color, size: s, simulatePressure: false, shape: kind, fill: filled ? color : null, fillAlpha: filled ? alpha : 0 });
    stroke.points = densify(poly.pts, poly.closed, 0.5, 2, poly.smooth);
    fillStroke(ctx, finishStroke(stroke));
  }
  setInkTheme(savedTheme.dark, savedTheme.paper);
}
