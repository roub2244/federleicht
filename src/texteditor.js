// texteditor.js – Textfelder bearbeiten: Eingabefeld über der Seite + Format-Leiste
//
// So funktioniert's:
//   - Werkzeug "Text" wählen und auf die Seite tippen -> neues Textfeld, Tastatur geht auf
//   - Auf ein vorhandenes Textfeld tippen -> es wird bearbeitet (Cursor an der Stelle)
//   - Oben erscheint die Format-Leiste: Schriftart, Größe, fett, kursiv, unterstrichen,
//     durchgestrichen, Farbe, Hintergrund, Ausrichtung, Listen
//   - Griff links oben = Textfeld verschieben, Griff rechts = breiter/schmaler machen
//   - Daneben tippen oder "Fertig" -> Text wird auf die Seite gemalt
//
// Zum Tippen benutzen wir ein echtes Eingabefeld des Browsers (contenteditable).
// Das kann Autokorrektur, Kopieren/Einfügen, Auswählen mit dem Finger, Samsung-Tastatur usw.
// Beim Fertigwerden lesen wir aus dem Eingabefeld heraus, wie jedes Stück Text aussieht,
// und speichern es in unserem eigenen Format (siehe text.js).

import { pageDark } from './media.js';
import {
  FONTS, FONT_GROUPS, fontCss, PT, SIZES_PT, LINE_HEIGHT, LIST_INDENT, MIN_WIDTH, DEFAULT_STYLE,
  createTextItem, updateTextBox, isEmptyText, textHit, textHighlight,
} from './text.js';
import { displayColor, setInkTheme } from './ink.js';
import { COLOR_PAGES, HIGHLIGHTER_COLORS, saveTools, rememberColor } from './tools.js';
import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { paint } from './paint.js';
import { isLight } from './pens.js';
import { createColorPicker } from './colorpicker.js';
import { paperColor } from './templates.js';
import { mathPopHTML, shift } from './mathkeys.js';

const ICON = {
  move: '<svg viewBox="0 0 24 24"><path d="M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3"/></svg>',
  bold: '<svg viewBox="0 0 24 24"><path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" stroke-width="2.4"/></svg>',
  italic: '<svg viewBox="0 0 24 24"><path d="M10 5h8M6 19h8M14 5l-4 14"/></svg>',
  underline: '<svg viewBox="0 0 24 24"><path d="M7 4v7a5 5 0 0 0 10 0V4M5 20h14"/></svg>',
  strike: '<svg viewBox="0 0 24 24"><path d="M4 12h16M16.5 7.5C16 5.8 14.3 5 12 5c-2.8 0-4.5 1.3-4.5 3.2 0 1.4.9 2.3 2.6 2.9M7.5 16.3C8 18.1 9.8 19 12.2 19c2.8 0 4.6-1.3 4.6-3.3 0-.9-.4-1.6-1-2.1"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="M4 6h16M4 10h10M4 14h16M4 18h10"/></svg>',
  center: '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 10h10M4 14h16M7 18h10"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="M4 6h16M10 10h10M4 14h16M10 18h10"/></svg>',
  bullet: '<svg viewBox="0 0 24 24"><circle cx="5" cy="7" r="1.3" fill="currentColor"/><circle cx="5" cy="12" r="1.3" fill="currentColor"/><circle cx="5" cy="17" r="1.3" fill="currentColor"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/></svg>',
  number: '<svg viewBox="0 0 24 24"><path d="M10 7h10M10 12h10M10 17h10M4 5.5 5.5 4.8V9.5M4 14.3c.3-.8 2.5-1.2 2.5.3 0 1-2.5 2-2.5 2.9h2.6" stroke-width="1.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" stroke-width="2.2"/></svg>',
  minus: '<svg viewBox="0 0 24 24"><path d="M6 12h12"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M6 12h12M12 6v12"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m7 10 5 5 5-5"/></svg>',
  none: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="m6.5 17.5 11-11"/></svg>',
  undo: '<svg viewBox="0 0 24 24"><path d="M9 14 4 9l5-5" /><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" /></svg>',
  redo: '<svg viewBox="0 0 24 24"><path d="m15 14 5-5-5-5" /><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" /></svg>',
};

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// "rgb(1, 2, 3)" <-> "#010203"
function cssToHex(css) {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/.exec(css || '');
  if (!m) return null;
  if (m[4] !== undefined && Number(m[4]) === 0) return null; // durchsichtig
  return '#' + [m[1], m[2], m[3]].map((n) => Number(n).toString(16).padStart(2, '0')).join('');
}
function hexToCss(hex) {
  if (hex.startsWith('rgb')) return hex.replace(/\s+/g, ' ').replace(/,\s*/g, ', ');
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

export function setupTextEditor({ stage, view, doc, renderer, tools, onCommit, onEditingChange, ensureVisible }) {
  const bar = document.getElementById('textbar');
  const pop = document.getElementById('textbar-pop');

  let session = null; // { page, item, isNew, x, y, w, wrap, edit }
  let mathTab = 0;     // Mathe-Schreibmenü: gewählte Gruppe
  let mathMode = null; // 'sup' | 'sub' | null: getippte Zeichen hoch-/tiefstellen
  let pendingSize = null; // Größe, die beim nächsten Tippen gelten soll (Cursor ohne Auswahl)

  // Im Eingabefeld zeigen wir die Farben so, wie sie auf dem Blatt aussehen
  // (auf dem dunklen Blatt wird Schwarz zu Weiß). Beim Auslesen rechnen wir zurück.
  const colorBack = new Map();     // angezeigte Farbe (rgb) -> gewählte Farbe (#hex)
  const highlightBack = new Map(); // angezeigter Hintergrund (rgb) -> gewählte Farbe (#hex)
  const showColor = (hex) => {
    const shown = hexToCss(displayColor(hex));
    colorBack.set(shown, hex);
    return shown;
  };
  const showHighlight = (hex) => {
    const shown = hexToCss(textHighlight(hex));
    highlightBack.set(shown, hex);
    return shown;
  };

  // ---------- Format-Leiste ----------
  bar.innerHTML = `
    <button class="tb-btn tb-font" data-pop="font"><span class="tb-font-name">Standard</span>${ICON.down}</button>
    <div class="tb-size">
      <button class="tb-btn" data-act="smaller" aria-label="kleiner">${ICON.minus}</button>
      <button class="tb-btn tb-size-val" data-pop="size">14</button>
      <button class="tb-btn" data-act="bigger" aria-label="größer">${ICON.plus}</button>
    </div>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-act="bold" title="Fett">${ICON.bold}</button>
    <button class="tb-btn" data-act="italic" title="Kursiv">${ICON.italic}</button>
    <button class="tb-btn" data-act="underline" title="Unterstrichen">${ICON.underline}</button>
    <button class="tb-btn" data-act="strikeThrough" title="Durchgestrichen">${ICON.strike}</button>
    <span class="tb-sep"></span>
    <button class="tb-btn tb-color" data-pop="color" title="Schriftfarbe"><span class="tb-a">A</span><i class="tb-bar">${paint('#000000')}</i></button>
    <button class="tb-btn tb-color" data-pop="highlight" title="Hintergrund"><span class="tb-mark">ab</span><i class="tb-bar">${paint('')}</i></button>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-act="align" title="Ausrichtung">${ICON.left}</button>
    <button class="tb-btn" data-act="insertUnorderedList" title="Aufzählung">${ICON.bullet}</button>
    <button class="tb-btn" data-act="insertOrderedList" title="Nummerierung">${ICON.number}</button>
    <span class="tb-sep"></span>
    <button class="tb-btn tb-math" data-pop="math" title="Mathe-Zeichen (Hochstellen, Wurzel, Brüche …)"><span>∑</span></button>
    <span class="tb-sep"></span>
    <button class="tb-btn" data-act="delete" title="Textfeld löschen">${ICON.trash}</button>
    <button class="tb-done" data-act="done">${ICON.check}<span>Fertig</span></button>`;

  // Antippen der Leiste darf das Eingabefeld nicht verlassen (sonst ist die Auswahl weg)
  for (const el of [bar, pop]) {
    el.addEventListener('pointerdown', (e) => {
      if (!e.target.closest('.picker')) e.preventDefault();
    });
  }

  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !session) return;
    if (btn.dataset.pop) return togglePop(btn.dataset.pop, btn);
    closePop();
    const act = btn.dataset.act;
    if (act === 'done') return commit();
    if (act === 'delete') return commit({ remove: true });
    if (act === 'smaller' || act === 'bigger') return stepSize(act === 'bigger' ? 1 : -1);
    if (act === 'align') {
      const next = { left: 'justifyCenter', center: 'justifyRight', right: 'justifyLeft' }[currentState().align];
      return command(next);
    }
    command(act);
  });

  function command(name, value = null) {
    restoreSelection();
    document.execCommand('styleWithCSS', false, true);
    document.execCommand(name, false, value);
    afterChange();
  }

  // ---------- Schriftgröße ----------
  // Der Browser kennt nur Größen 1 bis 7. Trick: Größe 7 setzen und danach durch unsere ersetzen.
  function setSize(units) {
    restoreSelection();
    const sel = getSelection();
    tools.text.s = units;
    saveTools(tools);
    if (sel.isCollapsed) {
      pendingSize = units; // gilt für den Text, der gleich getippt wird
    }
    document.execCommand('styleWithCSS', false, true);
    document.execCommand('fontSize', false, '7');
    fixSizes(units);
    afterChange();
  }

  function fixSizes(units) {
    const edit = session?.edit;
    if (!edit) return;
    for (const el of edit.querySelectorAll('font[size], [style*="xxx-large"], [style*="-webkit-xxx-large"]')) {
      el.removeAttribute('size');
      el.style.fontSize = `${units}px`;
    }
  }

  function stepSize(dir) {
    const pt = currentState().size / PT;
    let index = SIZES_PT.findIndex((s) => s >= pt - 0.01);
    if (index < 0) index = SIZES_PT.length - 1;
    if (dir > 0 && SIZES_PT[index] <= pt + 0.01) index++;
    if (dir < 0) index--;
    index = Math.max(0, Math.min(SIZES_PT.length - 1, index));
    setSize(SIZES_PT[index] * PT);
  }

  // ---------- Kleine Menüs unter der Leiste ----------
  let popKind = null;
  let picker = null;
  function togglePop(kind, anchor) {
    if (popKind === kind) return closePop();
    popKind = kind;
    const st = currentState();
    if (kind === 'font') {
      // Schriften nach Art gruppiert (Klar / Mit Serifen / Handgeschrieben), Liste scrollbar
      pop.innerHTML = `<div class="tp-list tp-fonts">${FONT_GROUPS.map(
        (g) => `<div class="tp-group">${g.name}</div>${FONTS.filter((f) => f.group === g.id).map(
          (f) => `<button class="tp-item${f.id === st.font ? ' on' : ''}" data-font="${f.id}" style="font-family:${esc(f.css)}">${f.name}</button>`
        ).join('')}`
      ).join('')}</div>`;
      requestAnimationFrame(() => pop.querySelector('.tp-item.on')?.scrollIntoView({ block: 'center' }));
    } else if (kind === 'size') {
      pop.innerHTML = `<div class="tp-sizes">${SIZES_PT.map(
        (s) => `<button class="tp-size${Math.abs(s * PT - st.size) < 0.1 ? ' on' : ''}" data-size="${s}">${s}</button>`
      ).join('')}</div>`;
    } else if (kind === 'color') {
      const colors = [...new Set([...tools.recent.slice(0, 8), ...COLOR_PAGES.flat()])];
      pop.innerHTML = `<div class="tp-title">Schriftfarbe</div>
        <div class="tp-colors">${colors.map((c) => swatch(c, c === st.color, 'color')).join('')}
          <button class="tp-rainbow" data-custom title="Eigene Farbe">${paint('', 'rainbow')}</button></div>
        <div class="picker" hidden></div>`;
    } else if (kind === 'math') {
      pop.innerHTML = mathPopHTML(mathTab, mathMode);
    } else if (kind === 'highlight') {
      pop.innerHTML = `<div class="tp-title">Hintergrund</div>
        <div class="tp-colors">
          <button class="tp-none${st.highlight ? '' : ' on'}" data-highlight="" title="Kein Hintergrund">${ICON.none}</button>
          ${HIGHLIGHTER_COLORS.map((c) => swatch(c, c === st.highlight, 'highlight')).join('')}</div>`;
    }
    pop.hidden = false;
    pop.dataset.kind = kind;
    const b = anchor.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2))}px`;
    pop.style.top = `${b.bottom + 8}px`;
  }

  function swatch(c, on, kind) {
    return `<button class="swatch-btn${isLight(c) ? ' light' : ''}" data-${kind}="${c}">${paint(c, on ? 'check' : '')}</button>`;
  }

  function closePop() {
    popKind = null;
    picker = null;
    pop.hidden = true;
    pop.innerHTML = '';
  }

  pop.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || !session) return;
    const d = btn.dataset;
    if (d.mkTab) {
      mathTab = Number(d.mkTab);
      pop.innerHTML = mathPopHTML(mathTab, mathMode);
      return;
    }
    if (d.mkMode) {
      mathMode = mathMode === d.mkMode ? null : d.mkMode;
      pop.innerHTML = mathPopHTML(mathTab, mathMode);
      bar.querySelector('.tb-math').classList.toggle('on', Boolean(mathMode));
      return;
    }
    if (d.mk) {
      restoreSelection();
      document.execCommand('insertText', false, d.mk);
      afterChange();
      return;
    }
    if (d.font) {
      tools.text.f = d.font;
      saveTools(tools);
      command('fontName', fontCss(d.font));
      closePop();
    } else if (d.size) {
      setSize(Number(d.size) * PT);
      closePop();
    } else if (d.color) {
      setColor(d.color);
      closePop();
    } else if ('highlight' in d) {
      if (d.highlight) command('hiliteColor', showHighlight(d.highlight));
      else command('hiliteColor', 'transparent');
      closePop();
    } else if ('custom' in d) {
      const box = pop.querySelector('.picker');
      box.hidden = false;
      btn.hidden = true;
      picker = createColorPicker(box, currentState().color, () => {}, (hex) => {
        rememberColor(tools, hex);
        setColor(hex);
      });
    }
  });

  function setColor(hex) {
    tools.text.c = hex;
    saveTools(tools);
    command('foreColor', showColor(hex));
  }

  // ---------- Was ist an der Cursor-Stelle eingestellt? ----------
  let savedRange = null;
  function restoreSelection() {
    const edit = session?.edit;
    if (!edit) return;
    if (document.activeElement !== edit) edit.focus({ preventScroll: true });
    const sel = getSelection();
    if (savedRange && (!sel.rangeCount || !edit.contains(sel.anchorNode))) {
      sel.removeAllRanges();
      sel.addRange(savedRange);
    }
  }

  function currentState() {
    const edit = session.edit;
    const sel = getSelection();
    let node = sel.rangeCount && edit.contains(sel.focusNode) ? sel.focusNode : edit.lastChild || edit;
    let el = node.nodeType === 1 ? node : node.parentElement;
    if (!el || !edit.contains(el)) el = edit;
    const style = readStyle(el, edit);
    const block = blockOf(el, edit);
    const align = alignOf(block);
    const list = el.closest('ul') && edit.contains(el.closest('ul')) ? 'bullet' : el.closest('ol') && edit.contains(el.closest('ol')) ? 'number' : null;
    return { font: style.f, size: pendingSize || style.s, color: style.c, highlight: style.h, bold: style.b, italic: style.i, underline: style.u, strike: style.x, align, list };
  }

  function updateBar() {
    if (!session) return;
    const st = currentState();
    bar.querySelector('.tb-font-name').textContent = FONTS.find((f) => f.id === st.font)?.name || 'Standard';
    bar.querySelector('.tb-font-name').style.fontFamily = fontCss(st.font);
    bar.querySelector('.tb-size-val').textContent = Math.round((st.size / PT) * 10) / 10;
    const on = { bold: st.bold, italic: st.italic, underline: st.underline, strikeThrough: st.strike, insertUnorderedList: st.list === 'bullet', insertOrderedList: st.list === 'number' };
    for (const [act, value] of Object.entries(on)) bar.querySelector(`[data-act="${act}"]`).classList.toggle('on', Boolean(value));
    bar.querySelector('[data-act="align"]').innerHTML = ICON[st.align] || ICON.left;
    const [colorBar, markBar] = bar.querySelectorAll('.tb-bar canvas');
    colorBar.dataset.c = displayColor(st.color);
    markBar.dataset.c = st.highlight || '';
    markBar.parentElement.classList.toggle('empty', !st.highlight);
  }

  // ---------- Öffnen und Schließen ----------

  // Ein Textfeld bearbeiten. at = Bildschirm-Punkt, an den der Cursor soll (oder null = ans Ende)
  function open(page, item, { isNew = false, at = null } = {}) {
    if (session) commit();
    item.editing = true;
    renderer.requestRender();
    const wrap = document.createElement('div');
    wrap.className = 'tbox';
    wrap.innerHTML = `
      <div class="tbox-frame"></div>
      <div class="tbox-edit" contenteditable="true" spellcheck="true" autocapitalize="sentences" lang="de"></div>
      <button class="tbox-move" aria-label="Verschieben">${ICON.move}</button>
      <button class="tbox-size" aria-label="Breite ändern"><i></i></button>`;
    stage.appendChild(wrap);
    const edit = wrap.querySelector('.tbox-edit');
    session = { page, item, isNew, x: item.x, y: item.y, w: item.w, wrap, edit };
    pendingSize = null;
    colorBack.clear();
    highlightBack.clear();
    useInk();

    const base = item.base;
    edit.style.fontSize = `${base}px`;
    edit.style.fontFamily = fontCss(item.paras[0]?.runs[0]?.f || DEFAULT_STYLE.f);
    edit.style.lineHeight = String(LINE_HEIGHT);
    edit.style.color = showColor('#000000');
    edit.style.setProperty('--indent', `${LIST_INDENT * base}px`);
    edit.innerHTML = toHTML(item);

    new ResizeObserver(() => place()).observe(edit);
    place();
    bar.hidden = false;
    onEditingChange(true);

    edit.focus({ preventScroll: true });
    const sel = getSelection();
    let range = null;
    if (at && document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(at[0], at[1]);
      if (range && !edit.contains(range.startContainer)) range = null;
    }
    if (!range) {
      range = document.createRange();
      range.selectNodeContents(edit);
      range.collapse(false);
    }
    sel.removeAllRanges();
    sel.addRange(range);
    savedRange = range.cloneRange();
    updateBar();
    setTimeout(() => ensureVisible(caretRect()), 350); // nachdem die Tastatur aufgegangen ist

    edit.addEventListener('input', () => {
      if (pendingSize) fixSizes(pendingSize);
      afterChange();
    });
    edit.addEventListener('paste', onPaste);
    // Mathe-Schreibmenü: "Hoch"/"Tief" an -> getippte Zeichen hoch-/tiefstellen
    edit.addEventListener('beforeinput', (e) => {
      if (!mathMode || e.inputType !== 'insertText' || !e.data) return;
      const shifted = shift(e.data, mathMode);
      if (shifted === e.data) return;
      e.preventDefault();
      document.execCommand('insertText', false, shifted);
    });
    setupHandles(wrap);
  }

  function useInk() {
    // Farben für das Blatt dieser Seite (hell/dunkel) einstellen
    const dark = pageDark(session.page, renderer.darkPaper); // PDF-Seiten bleiben (meist) hell
    setInkTheme(dark, paperColor(session.page.template.paper, dark));
  }

  // Eingefügter Text: nur reiner Text (fremde Formatierungen würden alles durcheinanderbringen)
  function onPaste(e) {
    e.preventDefault();
    const text = e.clipboardData?.getData('text/plain') || '';
    document.execCommand('insertText', false, text);
  }

  function afterChange() {
    const sel = getSelection();
    if (session && sel.rangeCount && session.edit.contains(sel.anchorNode)) savedRange = sel.getRangeAt(0).cloneRange();
    updateBar();
    ensureVisible(caretRect());
  }

  // Tastatur geht auf oder zu: Cursor sichtbar halten
  window.visualViewport?.addEventListener('resize', () => {
    if (session) setTimeout(() => session && ensureVisible(caretRect()), 60);
  });

  document.addEventListener('selectionchange', () => {
    if (!session) return;
    const sel = getSelection();
    if (sel.rangeCount && session.edit.contains(sel.anchorNode)) {
      savedRange = sel.getRangeAt(0).cloneRange();
      if (!sel.isCollapsed) pendingSize = null;
      updateBar();
    }
  });

  // Wo ist der Cursor auf dem Bildschirm? (zum Hochschieben über die Tastatur)
  function caretRect() {
    if (!session) return null;
    const sel = getSelection();
    if (sel.rangeCount && session.edit.contains(sel.focusNode)) {
      const range = sel.getRangeAt(0).cloneRange();
      range.collapse(false);
      const r = range.getClientRects()[0] || range.getBoundingClientRect();
      if (r && (r.width || r.height)) return r;
      const el = sel.focusNode.nodeType === 1 ? sel.focusNode : sel.focusNode.parentElement;
      return el.getBoundingClientRect();
    }
    return session.wrap.getBoundingClientRect();
  }

  // Eingabefeld an die richtige Stelle über dem Canvas setzen (nach Zoomen/Verschieben)
  function place() {
    if (!session) return;
    const { wrap, edit, page } = session;
    const index = doc.pages.indexOf(page);
    if (index < 0) return commit();
    const s = view.scale;
    const [left, top] = view.toScreen(session.x, doc.top(index) + session.y);
    edit.style.width = `${session.w}px`;
    edit.style.transform = `scale(${s})`;
    wrap.style.left = `${left}px`;
    wrap.style.top = `${top}px`;
    wrap.style.width = `${session.w * s}px`;
    wrap.style.height = `${edit.offsetHeight * s}px`;
    wrap.style.setProperty('--s', s);
  }

  // ---------- Verschieben und Breite ändern ----------
  function setupHandles(wrap) {
    const drag = (handle, onMove) => {
      handle.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        handle.setPointerCapture(e.pointerId);
        const start = { x: e.clientX, y: e.clientY, sx: session.x, sy: session.y, sw: session.w };
        const move = (ev) => {
          if (!session) return;
          onMove((ev.clientX - start.x) / view.scale, (ev.clientY - start.y) / view.scale, start);
          place();
        };
        const up = () => {
          handle.removeEventListener('pointermove', move);
          handle.removeEventListener('pointerup', up);
          handle.removeEventListener('pointercancel', up);
          restoreSelection();
        };
        handle.addEventListener('pointermove', move);
        handle.addEventListener('pointerup', up);
        handle.addEventListener('pointercancel', up);
      });
    };
    drag(wrap.querySelector('.tbox-move'), (dx, dy, st) => {
      session.x = Math.max(-session.w + 40, Math.min(PAGE_WIDTH - 40, st.sx + dx));
      session.y = Math.max(0, Math.min(PAGE_HEIGHT - 20, st.sy + dy));
    });
    drag(wrap.querySelector('.tbox-size'), (dx, dy, st) => {
      session.w = Math.max(MIN_WIDTH, Math.min(PAGE_WIDTH - session.x, st.sw + dx));
    });
  }

  // Fertig: Eingabefeld auslesen und als Textfeld auf die Seite legen
  function commit({ remove = false } = {}) {
    if (!session) return;
    const { page, item, isNew, wrap, edit, x, y, w } = session;
    useInk();
    const paras = remove ? [] : readParas(edit);
    session = null;
    savedRange = null;
    pendingSize = null;
    closePop();
    bar.hidden = true;
    wrap.remove();
    delete item.editing;
    onEditingChange(false);

    const next = updateTextBox({ ...item, x, y, w, paras: paras.length ? paras : item.paras.slice(0, 1), box: null });
    delete next.editing;
    const empty = remove || paras.length === 0 || isEmptyText(next);
    const changed = isNew || JSON.stringify([x, y, w, paras]) !== JSON.stringify([item.x, item.y, item.w, item.paras]);
    if (empty) onCommit(page, isNew ? null : item, null);
    else if (changed) onCommit(page, isNew ? null : item, next);
    renderer.requestRender();
  }

  return {
    get active() {
      return Boolean(session);
    },
    open,
    finish: (o) => commit(o),
    // Mathe-Schreibmenü aufklappen (aus dem ⋮-Menü)
    openMath() {
      if (session && popKind !== 'math') togglePop('math', bar.querySelector('.tb-math'));
    },
    place,
    // Ein neues Textfeld an Seiten-Punkt (x, y) von Seite page anlegen
    // width: gewünschte Breite (gezogen), topAligned: y ist schon die Oberkante
    create(page, x, y, z, width = 0, topAligned = false) {
      const style = { ...tools.text };
      const size = style.s || DEFAULT_STYLE.s;
      let w = width ? Math.max(MIN_WIDTH, width) : Math.min(520, PAGE_WIDTH - x - 30);
      if (!width && w < 200) {
        w = 200;
        x = Math.max(10, PAGE_WIDTH - 30 - w);
      }
      // Angetippt: Die erste Zeile soll dort stehen, wo du getippt hast
      const top = topAligned ? y : y - size * 0.75;
      const item = createTextItem({ x, y: Math.max(0, top), w, z, style });
      open(page, item, { isNew: true });
    },
    // Liegt an dieser Stelle (Seiten-Koordinaten) ein Textfeld? Das oberste zurückgeben.
    hitTest(page, x, y, pad) {
      for (let i = page.strokes.length - 1; i >= 0; i--) {
        const s = page.strokes[i];
        if (s.tool === 'text' && textHit(s, x, y, pad)) return s;
      }
      return null;
    },
    undo(redo = false) {
      if (!session) return;
      restoreSelection();
      document.execCommand(redo ? 'redo' : 'undo');
      afterChange();
    },
    // Nach Hell/Dunkel-Wechsel: Farben im Eingabefeld neu (einfach fertig machen)
    themeChanged() {
      if (session) commit();
    },
  };

  // ---------- Unser Format -> Eingabefeld ----------
  function toHTML(item) {
    let html = '';
    let list = null;
    for (const p of item.paras) {
      if (p.l !== list) {
        if (list) html += list === 'bullet' ? '</ul>' : '</ol>';
        if (p.l) html += p.l === 'bullet' ? '<ul>' : '<ol>';
        list = p.l;
      }
      const tag = p.l ? 'li' : 'div';
      const align = p.a !== 'left' ? ` style="text-align:${p.a}"` : '';
      const runs = p.runs.filter((r) => r.t);
      const inner = runs.length
        ? runs.map((r) => `<span style="${runCss(r)}">${esc(r.t)}</span>`).join('')
        : `<span style="${runCss(p.runs[0] || DEFAULT_STYLE)}"><br></span>`;
      html += `<${tag}${align}>${inner}</${tag}>`;
    }
    if (list) html += list === 'bullet' ? '</ul>' : '</ol>';
    return html;
  }


  // So sieht ein Stück Text im Eingabefeld aus (Farben wie auf dem Blatt)
  function runCss(r) {
    const deco = [r.u && 'underline', r.x && 'line-through'].filter(Boolean).join(' ');
    return [
      `font-family:${fontCss(r.f).replace(/"/g, "'")}`,
      `font-size:${r.s}px`,
      `color:${showColor(r.c)}`,
      r.b && 'font-weight:700',
      r.i && 'font-style:italic',
      deco && `text-decoration-line:${deco}`,
      r.h && `background-color:${showHighlight(r.h)}`,
    ].filter(Boolean).join(';');
  }

  // ---------- Eingabefeld -> unser Format ----------

  function readParas(edit) {
    const paras = [];
    let cur = null;
    const start = (block) => {
      cur = { a: alignOf(block), l: listOf(block, edit), runs: [] };
      paras.push(cur);
    };
    const walk = (node, block) => {
      const kids = [...node.childNodes];
      kids.forEach((child, k) => {
        if (child.nodeType === 3) {
          const text = child.data.replace(/ /g, ' ').replace(/[\r\n]+/g, ' ').replace(/​/g, '');
          if (!text) return;
          if (!cur) start(block);
          const style = readStyle(child.parentElement, edit);
          const last = cur.runs[cur.runs.length - 1];
          if (last && sameStyle(last, style)) last.t += text;
          else cur.runs.push({ ...style, t: text });
        } else if (child.nodeType === 1) {
          const tag = child.tagName;
          if (tag === 'BR') {
            if (!cur) start(block);
            if (!cur.runs.length) cur.runs.push({ ...readStyle(child.parentElement, edit), t: '' });
            // Ein <br> am Ende eines Absatzes ist nur ein Platzhalter, sonst ein Zeilenumbruch
            const after = kids.slice(k + 1).some((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.length));
            if (after || hasContentAfter(child, block)) cur = null;
          } else if (/^(DIV|P|LI|UL|OL|H[1-6]|BLOCKQUOTE|PRE)$/.test(tag)) {
            cur = null;
            walk(child, tag === 'UL' || tag === 'OL' ? block : child);
            cur = null;
          } else {
            walk(child, block);
          }
        }
      });
    };
    walk(edit, edit);
    return paras.map((p) => (p.runs.length ? p : { ...p, runs: [{ ...DEFAULT_STYLE, t: '' }] }));
  }

  // Kommt nach diesem <br> (innerhalb desselben Absatzes, auch in Eltern-Elementen) noch etwas?
  function hasContentAfter(node, block) {
    let n = node;
    while (n && n !== block) {
      let s = n.nextSibling;
      while (s) {
        if (s.nodeType === 1 || (s.nodeType === 3 && s.data.length)) return true;
        s = s.nextSibling;
      }
      n = n.parentNode;
    }
    return false;
  }

  function readStyle(el, edit) {
    const cs = getComputedStyle(el);
    let u = false;
    let x = false;
    let h = null;
    // Unterstreichen und Hintergrund "erbt" man im Browser nicht – deshalb die Eltern mit ansehen
    for (let n = el; n && n !== edit.parentNode; n = n.parentElement) {
      const ns = n === el ? cs : getComputedStyle(n);
      const deco = ns.textDecorationLine || ns.textDecoration || '';
      if (deco.includes('underline')) u = true;
      if (deco.includes('line-through')) x = true;
      if (!h) {
        const bg = ns.backgroundColor;
        if (cssToHex(bg)) h = highlightBack.get(hexToCss(bg)) || cssToHex(bg);
      }
      if (n === edit) break;
    }
    const shown = hexToCss(cs.color);
    return {
      f: fontIdOf(cs.fontFamily),
      s: Math.round(parseFloat(cs.fontSize) * 100) / 100 || DEFAULT_STYLE.s,
      c: colorBack.get(shown) || cssToHex(cs.color) || '#000000',
      b: Number(cs.fontWeight) >= 600 || cs.fontWeight === 'bold',
      i: cs.fontStyle === 'italic' || cs.fontStyle.startsWith('oblique'),
      u,
      x,
      h,
    };
  }
}

function sameStyle(a, b) {
  return a.f === b.f && a.s === b.s && a.c === b.c && a.b === b.b && a.i === b.i && a.u === b.u && a.x === b.x && a.h === b.h;
}

// Erste Schrift aus "font-family" -> unsere Schrift-Nummer
const firstFamily = (css) => css.split(',')[0].trim().replace(/^["']|["']$/g, '').toLowerCase();
const FAMILY_TO_ID = new Map(FONTS.map((f) => [firstFamily(f.css), f.id]));
function fontIdOf(css) {
  return FAMILY_TO_ID.get(firstFamily(css || '')) || 'sans';
}

function blockOf(el, edit) {
  const block = el.closest('div:not(.tbox-edit), p, li, h1, h2, h3, blockquote');
  return block && edit.contains(block) ? block : edit;
}

function alignOf(block) {
  const a = getComputedStyle(block).textAlign;
  if (a === 'center' || a === '-webkit-center') return 'center';
  if (a === 'right' || a === 'end' || a === '-webkit-right') return 'right';
  return 'left';
}

function listOf(block, edit) {
  const li = block.closest?.('li');
  if (!li || !edit.contains(li)) return null;
  return li.parentElement?.tagName === 'OL' ? 'number' : 'bullet';
}

