// mathhelp.js – die Mathe-Hilfe (im ⋮-Menü und als Knopf in der Leiste)
//
// Rahmen um eine handgeschriebene Aufgabe ziehen (oder mit dem Lasso auswählen) ->
// die App liest sie (mathink.js), rechnet sie aus oder löst sie (mathsolve.js) und zeigt
// das Ergebnis mit Rechenweg. "Einfügen" schreibt das Ergebnis direkt neben das "=" bzw.
// unter die Gleichung. Falsch gelesene Zeichen antippen und verbessern – die App lernt
// dabei deine Schrift. Man kann die Aufgabe auch einfach eintippen (Taschenrechner).

import { recognize, stringify, learn, SYMBOLS, learnedCount, forgetLearned, xAsTimes } from './mathink.js';
import { solve, DEFAULT_MATH } from './mathsolve.js';
import { createTextItem, updateTextBox, PT, SIZES_PT } from './text.js';
import { PAGE_WIDTH } from './view.js';
import { toast, confirmBox, esc } from './dialog.js';

const KEY = 'federleicht.math';
export const MATH_ICON = '<svg viewBox="0 0 24 24"><path d="M3 13.5h2.2l2.3 5.5 4-14h9.5"/><path d="m13.5 10.5 5 6M18.5 10.5l-5 6"/></svg>';
const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  edit: '<svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/></svg>',
  insert: '<svg viewBox="0 0 24 24"><path d="M12 4v11M7 10l5 5 5-5"/><path d="M5 20h14"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2.5"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/></svg>',
  frame: '<svg viewBox="0 0 24 24"><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/></svg>',
  keyboard: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M8 14h8"/></svg>',
};
const COLORS = { pen: null, blue: '#2f6bff', red: '#e5484d', green: '#1f9d55' };

export function loadMathSettings() {
  try {
    return { ...DEFAULT_MATH, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULT_MATH };
  }
}

// api: { commit(changes), newZ(), penColor(), freeSpot() -> { page, x, y } | null, onInsert?() }
export function setupMathHelp(api) {
  const settings = loadMathSettings();
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* egal */
    }
  };
  let panel = null;
  let tasks = []; // { row, page, text, edited, res, editing }
  let palette = null;
  let settingsOpen = false;

  // ---------- Öffnen ----------
  // Aus Handschrift: page + Striche (aus dem Rahmen oder dem Lasso)
  function fromInk(page, strokes) {
    const r = recognize(strokes);
    if (!r.rows.length) {
      toast('Im Rahmen ist keine Handschrift – nochmal versuchen');
      return;
    }
    tasks = r.rows.map((row) => {
      const t = { row, page, h: r.h, text: readText(row), edited: false };
      t.res = run(t.text);
      return t;
    });
    // Leere Zeilen (z. B. nur ein Punkt) weglassen
    tasks = tasks.filter((t) => t.text.length);
    if (!tasks.length) return toast('Da habe ich keine Aufgabe gefunden');
    show();
  }

  // Eintippen (ohne Handschrift)
  function typed() {
    tasks = [{ row: null, page: null, text: '', edited: true, editing: true, res: run('') }];
    show();
    panel.querySelector('.mh-input')?.focus();
  }

  const readText = (row) => (settings.xIsTimes ? xAsTimes(row.text) : row.text);
  const run = (text) => solve(text, settings);

  // ---------- Fenster ----------
  function show() {
    closePalette();
    if (!panel) {
      panel = document.createElement('div');
      panel.className = 'math-panel';
      document.body.appendChild(panel);
      panel.addEventListener('click', onClick);
      panel.addEventListener('input', onInput);
      panel.addEventListener('change', onChange);
      panel.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && e.target.matches('.mh-input')) e.target.blur();
      });
    }
    render();
  }

  function close() {
    closePalette();
    panel?.remove();
    panel = null;
    tasks = [];
  }

  const sw = (key, label, hint) =>
    `<label class="switch-row op-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" data-key="${key}" ${settings[key] ? 'checked' : ''} /></label>`;
  const seg = (key, label, options) =>
    `<div class="op-row op-seg-row"><span>${label}</span><div class="op-seg">${options
      .map(([v, l]) => `<button data-seg="${key}" data-val='${JSON.stringify(v)}' class="${settings[key] === v ? 'on' : ''}">${l}</button>`)
      .join('')}</div></div>`;

  function render() {
    if (!panel) return;
    symList = [];
    const focused = document.activeElement?.closest?.('.mh-task')?.dataset.i;
    const caret = document.activeElement?.selectionStart;
    panel.innerHTML = `
      <div class="mh-head">
        <span class="mh-title">${MATH_ICON}<b>Mathe-Hilfe</b></span>
        <button class="head-btn" data-a="frame" title="Andere Aufgabe einrahmen">${ICON.frame}</button>
        <button class="head-btn" data-a="type" title="Aufgabe eintippen">${ICON.keyboard}</button>
        <button class="head-btn" data-a="close" title="Schließen">${ICON.close}</button>
      </div>
      <div class="mh-scroll">
        ${tasks.map(taskHTML).join('')}
        <details class="rp-settings mh-settings"${settingsOpen ? ' open' : ''}>
          <summary>Einstellungen</summary>
          ${seg('digits', 'Nachkommastellen', [[2, '2'], [3, '3'], [4, '4'], [6, '6'], [8, '8']])}
          ${sw('fractions', 'Ergebnis als Bruch', 'z. B. 1/3 statt 0,3333 (wenn es genau ein Bruch ist)')}
          ${sw('steps', 'Rechenweg gleich zeigen', 'Äquivalenzumformungen, pq-Formel …')}
          ${seg('angle', 'Winkel bei sin, cos, tan', [['deg', 'Grad'], ['rad', 'Bogenmaß']])}
          ${seg('xIsTimes', '„x“ zwischen zwei Zahlen heißt', [[false, 'Variable x'], [true, 'mal']])}
          <div class="tp-group">Eingefügtes Ergebnis</div>
          ${seg('font', 'Schrift', [['hand', 'Handschrift'], ['print', 'Druckschrift'], ['sans', 'Standard']])}
          ${seg('color', 'Farbe', [['pen', 'Wie Schrift'], ['blue', 'Blau'], ['red', 'Rot'], ['green', 'Grün']])}
          <div class="tp-group">Deine Schrift</div>
          <p class="op-note">Die Mathe-Hilfe hat sich ${learnedCount()} Zeichen von dir gemerkt. Falsch erkannt? Tippe oben auf das Zeichen und wähle das richtige – dann lernt sie dazu.</p>
          ${learnedCount() ? '<button class="op-btn danger" data-a="forget">Gelernte Zeichen vergessen</button>' : ''}
        </details>
        <p class="op-note">Alles wird auf dem Tablet gerechnet – offline und kostenlos.</p>
      </div>`;
    panel.querySelector('.mh-settings').addEventListener('toggle', (e) => (settingsOpen = e.target.open));
    if (focused !== undefined) {
      const inp = panel.querySelector(`.mh-task[data-i="${focused}"] .mh-input`);
      if (inp) {
        inp.focus();
        if (caret != null) inp.setSelectionRange(caret, caret);
      }
    }
  }

  function taskHTML(t, i) {
    const r = t.res;
    const chips = t.row && !t.edited ? chipsHTML(t.row.items) : '';
    const formula = r.error ? `<span class="mh-raw">${esc(t.text) || '…'}</span>` : r.html;
    const can = r.insert && (t.row || api.freeSpot);
    return `
      <div class="mh-task" data-i="${i}">
        <div class="mh-formula-row">
          <div class="mh-formula">${formula}</div>
          <button class="mh-edit${t.editing ? ' on' : ''}" data-a="edit" title="Aufgabe verbessern">${ICON.edit}</button>
        </div>
        ${t.editing ? `<input class="mh-input" value="${esc(t.text)}" placeholder="z. B. 3x + 5 = 20 oder 2^10 : 4" autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="text" />` : ''}
        ${chips ? `<div class="mh-chips"><small>Gelesen:</small>${chips}</div>` : ''}
        <div class="mh-answer${r.error ? ' err' : ''}">${r.error ? esc(r.error) : r.answerHTML || ''}</div>
        ${r.steps?.length ? `<details class="mh-steps"${settings.steps ? ' open' : ''}><summary>Rechenweg</summary>${r.steps.map((s) => `<div class="mh-step"><span>${s.html}</span>${s.note ? `<em>${s.note}</em>` : ''}</div>`).join('')}</details>` : ''}
        ${r.insert ? `<div class="mh-actions">
          ${can ? `<button class="mh-btn primary" data-a="insert">${ICON.insert}<span>Ergebnis einfügen</span></button>` : ''}
          <button class="mh-btn" data-a="copy">${ICON.copy}<span>Kopieren</span></button>
        </div>` : ''}
      </div>`;
  }

  // Die erkannten Zeichen als Knöpfe (zum Verbessern)
  function chipsHTML(items, sup = false) {
    let out = '';
    for (const p of items) {
      const cls = p.sup || sup ? ' sup' : '';
      if (p.kind === 'root') out += `<span class="mh-group${cls}">√(${chipsHTML(p.inner)})</span>`;
      else if (p.kind === 'frac') out += `<span class="mh-group mh-fracg${cls}"><span>${chipsHTML(p.num)}</span><span>${chipsHTML(p.den)}</span></span>`;
      else out += `<button class="mh-chip${cls}" data-sym="${symIndex(p.sym)}">${p.sym.label === '·' ? '·' : p.sym.label === '-' ? '−' : esc(p.sym.label)}</button>`;
    }
    return out;
  }
  let symList = [];
  function symIndex(sym) {
    let i = symList.indexOf(sym);
    if (i < 0) i = symList.push(sym) - 1;
    return i;
  }

  // ---------- Bedienung ----------
  function onClick(e) {
    const chip = e.target.closest('.mh-chip');
    if (chip) return openPalette(chip, symList[Number(chip.dataset.sym)], Number(chip.closest('.mh-task').dataset.i));
    const segBtn = e.target.closest('[data-seg]');
    if (segBtn) {
      settings[segBtn.dataset.seg] = JSON.parse(segBtn.dataset.val);
      save();
      return refreshAll();
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    const i = Number(e.target.closest('.mh-task')?.dataset.i);
    const t = tasks[i];
    if (a === 'close') return close();
    if (a === 'frame') return api.pickArea?.();
    if (a === 'type') {
      tasks.push({ row: null, page: null, text: '', edited: true, editing: true, res: run('') });
      render();
      const inputs = panel.querySelectorAll('.mh-input');
      inputs[inputs.length - 1]?.focus();
      return;
    }
    if (a === 'edit' && t) {
      t.editing = !t.editing;
      render();
      if (t.editing) panel.querySelector(`.mh-task[data-i="${i}"] .mh-input`)?.focus();
      return;
    }
    if (a === 'insert' && t) return insert(t);
    if (a === 'copy' && t) {
      const text = t.res.insert.replace(/^=\s*/, '');
      navigator.clipboard?.writeText(text).then(
        () => toast(`Kopiert: ${text}`),
        () => toast('Kopieren ging nicht')
      );
      return;
    }
    if (a === 'forget') {
      confirmBox({ title: 'Gelernte Zeichen vergessen?', text: 'Die Mathe-Hilfe benutzt dann wieder nur ihre eingebauten Muster.', ok: 'Vergessen', danger: true }).then((ok) => {
        if (!ok) return;
        forgetLearned();
        render();
      });
    }
  }

  function onInput(e) {
    if (!e.target.matches('.mh-input')) return;
    const i = Number(e.target.closest('.mh-task').dataset.i);
    const t = tasks[i];
    t.text = e.target.value;
    t.edited = true;
    t.res = run(t.text);
    // nur Formel und Ergebnis neu (das Eingabefeld bleibt, damit die Tastatur offen bleibt)
    const box = e.target.closest('.mh-task');
    const fresh = document.createElement('div');
    fresh.innerHTML = taskHTML(t, i);
    const n = fresh.firstElementChild;
    for (const sel of ['.mh-formula', '.mh-answer']) box.querySelector(sel).replaceWith(n.querySelector(sel));
    for (const sel of ['.mh-steps', '.mh-actions', '.mh-chips']) {
      box.querySelector(sel)?.remove();
      const add = n.querySelector(sel);
      if (add) box.appendChild(add);
    }
  }

  function onChange(e) {
    const key = e.target.dataset.key;
    if (!key) return;
    settings[key] = e.target.checked;
    save();
    refreshAll();
  }

  function refreshAll() {
    for (const t of tasks) {
      if (t.row && !t.edited) t.text = readText(t.row);
      t.res = run(t.text);
    }
    render();
  }

  // ---------- Zeichen verbessern ----------
  function openPalette(chip, sym, i) {
    closePalette();
    if (!sym) return;
    palette = document.createElement('div');
    palette.className = 'mh-palette';
    const first = [...new Set(sym.alts)].filter((l) => l !== sym.label).slice(0, 4);
    palette.innerHTML = `
      <div class="mh-pal-title">Was steht da?</div>
      ${first.length ? `<div class="mh-pal-row best">${first.map((l) => `<button data-l="${esc(l)}">${l === '-' ? '−' : esc(l)}</button>`).join('')}</div>` : ''}
      <div class="mh-pal-row">${SYMBOLS.map((l) => `<button data-l="${esc(l)}" class="${l === sym.label ? 'on' : ''}">${l === '-' ? '−' : esc(l)}</button>`).join('')}</div>
      <button class="mh-pal-del" data-l="">Kein Zeichen (weglassen)</button>`;
    document.body.appendChild(palette);
    const r = chip.getBoundingClientRect();
    const w = palette.offsetWidth;
    palette.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, r.left + r.width / 2 - w / 2))}px`;
    const hgt = palette.offsetHeight;
    palette.style.top = `${r.top - hgt - 8 > 8 ? r.top - hgt - 8 : r.bottom + 8}px`;
    palette.addEventListener('click', (e) => {
      const b = e.target.closest('[data-l]');
      if (!b) return;
      const label = b.dataset.l;
      const changed = sym.label !== label;
      sym.alts = [sym.label, ...sym.alts.filter((l) => l !== label)];
      sym.label = label || '?';
      if (changed && label) learn(sym, label);
      closePalette();
      const t = tasks[i];
      t.row.text = stringify(t.row.items);
      t.text = readText(t.row);
      t.res = run(t.text);
      render();
      if (changed && label) toast(`Gemerkt: so schreibst du „${label === '-' ? '−' : label}“`);
    });
    setTimeout(() => window.addEventListener('pointerdown', paletteOutside, true), 0);
  }
  function paletteOutside(e) {
    if (palette && !palette.contains(e.target)) closePalette();
  }
  function closePalette() {
    window.removeEventListener('pointerdown', paletteOutside, true);
    palette?.remove();
    palette = null;
  }

  // ---------- Ergebnis auf die Seite schreiben ----------
  function insert(t) {
    const r = t.res;
    let text = r.insert;
    let page = t.page;
    let x;
    let y;
    let s;
    if (t.row) {
      const b = t.row.box;
      const h = rowDigitHeight(t.row) || t.h;
      s = nearestSize(h / 0.72);
      if (r.insertAfter) {
        // Rechts neben die Aufgabe, auf derselben Höhe wie das "=" (bzw. die Zeichen)
        const eq = lastEquals(t.row.items);
        const mid = eq ? (eq.box.minY + eq.box.maxY) / 2 : midline(t.row);
        x = b.maxX + h * 0.3;
        y = mid - s * 0.64;
        if (!eq && !text.startsWith('=')) text = `= ${text}`;
      } else {
        // Gleichung: Lösung rechts daneben, wenn dort Platz ist – sonst darunter
        const w = text.length * s * 0.55 + 20;
        const right = { minX: b.maxX + h * 0.9, maxX: b.maxX + h * 0.9 + w, minY: b.minY, maxY: b.maxY };
        const below = { minX: b.minX, maxX: b.minX + w, minY: b.maxY + h * 0.2, maxY: b.maxY + h * 0.35 + s * 1.3 };
        if (right.maxX < PAGE_WIDTH - 8 && free(page, right)) {
          x = right.minX;
          y = midline(t.row) - s * 0.64;
        } else {
          x = b.minX;
          y = b.maxY + h * 0.35;
          if (!free(page, below) && right.maxX < PAGE_WIDTH - 8) {
            x = right.minX;
            y = midline(t.row) - s * 0.64;
          }
        }
      }
    } else {
      const spot = api.freeSpot?.();
      if (!spot) return;
      ({ page, x, y } = spot);
      s = 20 * PT;
      text = `${(r.html || t.text).replace(/<[^>]+>/g, '')} ${r.insertAfter ? (text.startsWith('=') ? text : `= ${text}`) : `→ ${text}`}`;
    }
    const color = COLORS[settings.color] || (t.row ? mainColor(t.row.strokes) : api.penColor());
    const w = Math.min(PAGE_WIDTH - x - 8, Math.max(80, text.length * s * 0.62 + 24));
    const empty = createTextItem({ x, y, w, z: api.newZ(), style: { f: settings.font, s, c: color } });
    const item = { ...empty, paras: [{ a: 'left', l: null, runs: [{ ...empty.paras[0].runs[0], t: text.replace(/-/g, '−') }] }], box: null };
    updateTextBox(item);
    api.commit([{ page, added: [item], removed: [] }]);
    toast('Ergebnis eingefügt – mit dem Text-Werkzeug verschiebbar');
    api.onInsert?.();
  }

  return {
    fromInk,
    typed,
    close,
    get open() {
      return Boolean(panel);
    },
  };
}

// Höhe der normalen Ziffern einer Zeile (ohne Brüche und Hochzahlen)
function rowDigitHeight(row) {
  const hs = [];
  for (const p of row.items) if (p.kind === 'sym' && !p.sup && /[0-9x]/.test(p.sym.label)) hs.push(p.box.maxY - p.box.minY);
  hs.sort((a, b) => a - b);
  return hs[hs.length >> 1] || 0;
}
// Ist in diesem Bereich der Seite noch nichts?
function free(page, r) {
  return !page.strokes.some((st) => st.box && !st.hidden && st.box.maxX > r.minX && st.box.minX < r.maxX && st.box.maxY > r.minY && st.box.minY < r.maxY);
}
function midline(row) {
  const ys = row.items.filter((p) => p.kind === 'sym' && !p.sup).map((p) => (p.box.minY + p.box.maxY) / 2).sort((a, b) => a - b);
  return ys[ys.length >> 1] ?? (row.box.minY + row.box.maxY) / 2;
}
function lastEquals(items) {
  for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'sym' && items[i].sym.label === '=') return items[i];
  return null;
}
function nearestSize(units) {
  const pt = units / PT;
  let best = SIZES_PT[0];
  for (const p of SIZES_PT) if (Math.abs(p - pt) < Math.abs(best - pt)) best = p;
  return Math.min(60, Math.max(10, best)) * PT;
}
function mainColor(strokes) {
  const count = new Map();
  for (const s of strokes) count.set(s.color, (count.get(s.color) || 0) + s.points.length);
  return [...count].sort((a, b) => b[1] - a[1])[0]?.[0] || '#000000';
}
