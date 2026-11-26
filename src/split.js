// split.js – Splitscreen: zwei Notizen nebeneinander
//
// Die Seite ist hier nur ein Rahmen: links und rechts je ein Fenster (iframe), in dem die
// ganze App läuft (?pane=L / ?pane=R, siehe splitpane.js). Dazwischen die Trennlinie:
//   ziehen        = Breite ändern (ganz an den Rand ziehen = diese Seite schließen)
//   antippen      = kleines Menü (Seiten tauschen, Hälfte/Hälfte, links/rechts schließen)
//   doppelt tippen = wieder Hälfte/Hälfte
// Die Fenster reden über postMessage mit diesem Rahmen:
//   note {id}       welche Notiz gerade offen ist (damit nicht beide dieselbe öffnen)
//   close           "Splitscreen beenden" in einem Fenster -> dieses Fenster bleibt
//   transfer {...}  mit dem Lasso Rübergezogenes -> geht als drop an das andere Fenster
//   done {ask}      Antwort auf flush (alles gespeichert)

const KEY = 'federleicht.split';
const MIN = 0.22; // schmaler als das wird eine Seite nicht (außer man schließt sie)
const CLOSE_AT = 0.12; // so nah am Rand losgelassen = Seite schließen

const state = { ratio: 0.5, ...readJSON(KEY) };
state.ratio = clamp(Number(state.ratio) || 0.5);
const notes = { L: null, R: null };

document.title = 'Federleicht – Splitscreen';
document.documentElement.className = 'split-shell';
const style = document.createElement('style');
style.textContent = `
  :root { color-scheme: light dark; --sp-bg: #e3e7ee; --sp-line: #c4cad6; --sp-grip: #7b8494; --sp-accent: #5b5bd6; --sp-card: #ffffff; --sp-text: #1d2129; }
  @media (prefers-color-scheme: dark) {
    :root { --sp-bg: #0b0c0f; --sp-line: #2b2f38; --sp-grip: #8a93a3; --sp-card: #22252c; --sp-text: #e8eaef; }
  }
  html.split-shell, html.split-shell body { margin: 0; height: 100%; overflow: hidden; background: var(--sp-bg);
    overscroll-behavior: none; touch-action: none; font: 15px/1.3 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: var(--sp-text); }
  .sp-wrap { position: fixed; inset: 0; display: flex; }
  .sp-pane { border: 0; height: 100%; display: block; min-width: 0; background: var(--sp-bg); }
  .sp-div { flex: 0 0 14px; position: relative; cursor: col-resize; touch-action: none; display: flex; align-items: center; justify-content: center; }
  .sp-div::before { content: ''; position: absolute; top: 0; bottom: 0; left: 50%; width: 1px; background: var(--sp-line); }
  .sp-div i { position: relative; width: 6px; height: 56px; border-radius: 3px; background: var(--sp-grip); transition: height .15s, background .15s; }
  .sp-div.drag i, .sp-div:hover i { height: 84px; background: var(--sp-accent); }
  .sp-shield { position: fixed; inset: 0; z-index: 5; cursor: col-resize; touch-action: none; }
  .sp-ghost { position: fixed; top: 0; bottom: 0; width: 4px; margin-left: -2px; background: var(--sp-accent); z-index: 6; border-radius: 2px; pointer-events: none; }
  .sp-shade { position: fixed; top: 0; bottom: 0; z-index: 5; background: rgba(91, 91, 214, .16); pointer-events: none; display: flex; align-items: center; justify-content: center; }
  .sp-shade span { background: var(--sp-card); padding: 10px 16px; border-radius: 999px; box-shadow: 0 6px 24px rgba(0,0,0,.25); font-weight: 600; }
  .sp-menu { position: fixed; z-index: 7; background: var(--sp-card); border-radius: 16px; padding: 6px; box-shadow: 0 10px 40px rgba(0,0,0,.3);
    display: flex; flex-direction: column; min-width: 220px; transform: translate(-50%, -50%); }
  .sp-menu button { all: unset; display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; cursor: pointer; }
  .sp-menu button:hover, .sp-menu button:focus-visible { background: rgba(127, 127, 127, .14); }
  .sp-menu svg { width: 22px; height: 22px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex: none; }
  .sp-busy { position: fixed; inset: 0; z-index: 8; display: flex; align-items: center; justify-content: center; background: rgba(0,0,0,.18); }
  .sp-busy span { background: var(--sp-card); padding: 12px 18px; border-radius: 12px; box-shadow: 0 6px 24px rgba(0,0,0,.25); }
`;
document.head.appendChild(style);

const base = location.pathname;
document.body.innerHTML = `
  <div class="sp-wrap">
    <iframe class="sp-pane" id="pane-L" src="${base}?pane=L" title="Linke Notiz" allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"></iframe>
    <div class="sp-div" role="separator" aria-label="Trennlinie: ziehen = Breite, antippen = Menü" tabindex="0"><i></i></div>
    <iframe class="sp-pane" id="pane-R" src="${base}?pane=R" title="Rechte Notiz" allow="clipboard-read; clipboard-write; microphone; camera; fullscreen"></iframe>
  </div>`;
const frames = { L: document.getElementById('pane-L'), R: document.getElementById('pane-R') };
const divider = document.querySelector('.sp-div');
const other = (p) => (p === 'L' ? 'R' : 'L');

function layout() {
  frames.L.style.width = `calc(${state.ratio * 100}% - 7px)`;
  frames.R.style.width = `calc(${(1 - state.ratio) * 100}% - 7px)`;
}
layout();

// ---------- Nachrichten der beiden Fenster ----------
let askNo = 0;
const waiting = new Map();

function post(pane, msg) {
  frames[pane].contentWindow?.postMessage({ fl: 'split', ...msg }, location.origin);
}

window.addEventListener('message', (e) => {
  if (e.origin !== location.origin) return;
  const d = e.data;
  if (!d || d.fl !== 'split') return;
  const from = e.source === frames.L.contentWindow ? 'L' : e.source === frames.R.contentWindow ? 'R' : null;
  if (!from) return;
  if (d.act === 'hello') {
    // Fenster ist (neu) gestartet: sagen, was im anderen offen ist
    post(from, { act: 'other', id: notes[other(from)] });
  } else if (d.act === 'note') {
    notes[from] = d.id || null;
    post(other(from), { act: 'other', id: notes[from] });
  } else if (d.act === 'close') {
    exit(from);
  } else if (d.act === 'transfer') {
    // Fenster-Koordinaten umrechnen: Absender-Fenster -> Rahmen -> Ziel-Fenster
    const to = other(from);
    const a = frames[from].getBoundingClientRect();
    const b = frames[to].getBoundingClientRect();
    const msg = { act: 'drop', items: d.items, frame: d.frame };
    if (Number.isFinite(d.x) && Number.isFinite(d.y)) {
      msg.x = a.left + d.x - b.left;
      msg.y = a.top + d.y - b.top;
    }
    post(to, msg);
  } else if (d.act === 'done') {
    waiting.get(d.ask)?.();
  }
});

// Ein Fenster alles speichern lassen (leave: Notiz dort auch schließen). Höchstens 4 s warten.
function flush(pane, leave = false) {
  const ask = ++askNo;
  return new Promise((resolve) => {
    const finish = () => {
      waiting.delete(ask);
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, 4000);
    waiting.set(ask, finish);
    post(pane, { act: 'flush', ask, leave });
  });
}

function busy(text) {
  const el = document.createElement('div');
  el.className = 'sp-busy';
  el.innerHTML = `<span>${text}</span>`;
  document.body.appendChild(el);
  return el;
}

// Splitscreen beenden: "keep" bleibt als ganze App offen
let leaving = false;
async function exit(keep) {
  if (leaving) return;
  leaving = true;
  closeMenu();
  busy('Wird gespeichert …');
  await Promise.all([flush(keep), flush(other(keep), true)]);
  // Die bleibende Seite wird die normale Sitzung; die andere merken wir uns fürs nächste Mal
  const kept = readJSON(`federleicht.session.${keep}`);
  if (kept) writeJSON('federleicht.session', kept);
  if (keep === 'R') {
    // Die linke Seite wird beim nächsten Mal wieder rechts angezeigt
    const left = readJSON('federleicht.session.L');
    if (left) writeJSON('federleicht.session.R', left);
  }
  writeJSON(KEY, { ratio: state.ratio });
  location.replace(base);
}

async function swap() {
  if (leaving) return;
  leaving = true;
  closeMenu();
  busy('Wird getauscht …');
  await Promise.all([flush('L'), flush('R')]);
  const l = readJSON('federleicht.session.L');
  const r = readJSON('federleicht.session.R');
  writeJSON('federleicht.session.L', r || { screen: 'home' });
  writeJSON('federleicht.session.R', l || { screen: 'home' });
  state.ratio = 1 - state.ratio;
  writeJSON(KEY, { ratio: state.ratio });
  location.reload();
}

// ---------- Trennlinie ----------
let drag = null;
let lastTap = 0;

divider.addEventListener('pointerdown', (e) => {
  if (leaving) return;
  e.preventDefault();
  closeMenu();
  divider.setPointerCapture(e.pointerId);
  const shield = document.createElement('div');
  shield.className = 'sp-shield';
  const ghost = document.createElement('div');
  ghost.className = 'sp-ghost';
  ghost.hidden = true;
  const shade = document.createElement('div');
  shade.className = 'sp-shade';
  shade.hidden = true;
  shade.innerHTML = '<span></span>';
  document.body.append(shield, ghost, shade);
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, ratio: state.ratio, shield, ghost, shade };
  divider.classList.add('drag');
});

divider.addEventListener('pointermove', (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  if (!drag.moved && Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) < 6) return;
  drag.moved = true;
  const w = window.innerWidth;
  const r = Math.min(1, Math.max(0, e.clientX / w));
  drag.ratio = r;
  drag.ghost.hidden = false;
  drag.ghost.style.left = `${clamp(r) * w}px`;
  // Ganz an den Rand: Hinweis, dass die Seite dort zugeht
  const closing = r < CLOSE_AT ? 'L' : r > 1 - CLOSE_AT ? 'R' : null;
  drag.shade.hidden = !closing;
  if (closing) {
    Object.assign(drag.shade.style, closing === 'L' ? { left: '0', right: 'auto', width: `${w * 0.5}px` } : { right: '0', left: 'auto', width: `${w * 0.5}px` });
    drag.shade.firstChild.textContent = closing === 'L' ? 'Loslassen: linke Notiz schließen' : 'Loslassen: rechte Notiz schließen';
  }
});

function endDrag(e, cancel = false) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  divider.classList.remove('drag');
  d.shield.remove();
  d.ghost.remove();
  d.shade.remove();
  if (cancel) return;
  if (!d.moved) {
    // Antippen: doppelt = Hälfte/Hälfte, einmal = Menü
    const now = Date.now();
    if (now - lastTap < 350) {
      lastTap = 0;
      closeMenu();
      state.ratio = 0.5;
      layout();
      writeJSON(KEY, { ratio: state.ratio });
      return;
    }
    lastTap = now;
    openMenu(e.clientY);
    return;
  }
  if (d.ratio < CLOSE_AT) return exit('R');
  if (d.ratio > 1 - CLOSE_AT) return exit('L');
  state.ratio = clamp(d.ratio);
  layout();
  writeJSON(KEY, { ratio: state.ratio });
}
divider.addEventListener('pointerup', (e) => endDrag(e));
divider.addEventListener('pointercancel', (e) => endDrag(e, true));
divider.addEventListener('keydown', (e) => {
  const step = e.key === 'ArrowLeft' ? -0.05 : e.key === 'ArrowRight' ? 0.05 : 0;
  if (!step) return;
  state.ratio = clamp(state.ratio + step);
  layout();
  writeJSON(KEY, { ratio: state.ratio });
});

// ---------- Menü an der Trennlinie ----------
const ICONS = {
  swap: '<svg viewBox="0 0 24 24"><path d="M7 7h12l-3.5-3.5M17 17H5l3.5 3.5"/></svg>',
  half: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15"/></svg>',
  left: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15M5.5 9.5l4 5M9.5 9.5l-4 5"/></svg>',
  right: '<svg viewBox="0 0 24 24"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><path d="M12 4.5v15M14.5 9.5l4 5M18.5 9.5l-4 5"/></svg>',
};
let menu = null;
function openMenu(y) {
  closeMenu();
  menu = document.createElement('div');
  menu.className = 'sp-menu';
  menu.innerHTML = [
    ['swap', 'Seiten tauschen'],
    ['half', 'Hälfte / Hälfte'],
    ['left', 'Linke Notiz schließen'],
    ['right', 'Rechte Notiz schließen'],
  ]
    .map(([act, label]) => `<button data-act="${act}">${ICONS[act]}<span>${label}</span></button>`)
    .join('');
  const shield = document.createElement('div');
  shield.className = 'sp-shield';
  shield.style.cursor = 'default';
  shield.addEventListener('pointerdown', closeMenu);
  menu.shield = shield;
  document.body.append(shield, menu);
  const w = window.innerWidth;
  const x = state.ratio * w;
  const mw = menu.offsetWidth;
  const mh = menu.offsetHeight;
  menu.style.left = `${Math.min(w - mw / 2 - 8, Math.max(mw / 2 + 8, x))}px`;
  menu.style.top = `${Math.min(window.innerHeight - mh / 2 - 8, Math.max(mh / 2 + 8, y))}px`;
  menu.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'swap') swap();
    else if (act === 'half') {
      state.ratio = 0.5;
      layout();
      writeJSON(KEY, { ratio: state.ratio });
      closeMenu();
    } else if (act === 'left') exit('R');
    else if (act === 'right') exit('L');
  });
}
function closeMenu() {
  if (!menu) return;
  menu.shield.remove();
  menu.remove();
  menu = null;
}

// Beim Schließen der App: beide Seiten speichern lassen (die Fenster machen das selbst, das hier ist nur doppelt hält besser)
window.addEventListener('pagehide', () => {
  if (!leaving) for (const p of ['L', 'R']) post(p, { act: 'flush', ask: 0 });
});

function clamp(r) {
  return Math.min(1 - MIN, Math.max(MIN, r));
}
function readJSON(key) {
  try {
    const v = JSON.parse(localStorage.getItem(key));
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null;
  }
}
function writeJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* egal */
  }
}
