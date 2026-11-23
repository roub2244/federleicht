// main.js – der Startpunkt: hier wird alles zusammengesteckt
import './style.css';
import './paint.js'; // Farbflächen auf Canvas (gegen den Dunkelmodus von Samsung Internet)
import { View, PAGE_HEIGHT } from './view.js';
import { NoteDocument, createPage, END_SPACE } from './document.js';
import { DEFAULT_TEMPLATE } from './templates.js';
import { setupPages } from './pages.js';
import { Renderer } from './renderer.js';
import { createStroke, buildPath, finishStroke, fillStroke, strokeHit, cutStroke } from './ink.js';
import { setupInput } from './input.js';
import { Debug } from './debug.js';
import { HoldDetector, linePoints, averagePressure, longEnough } from './straighten.js';
import { History } from './history.js';
import { loadTools, saveTools, activeStyle, settingsOf } from './tools.js';
import { setupToolbar } from './toolbar.js';
import { setupWheel } from './wheel.js';

// ---------- Einstellungen ----------
// Farbe, Dicke, Stiftart usw. kommen aus der Werkzeugleiste (siehe tools.js)
const tools = loadTools();

// ---------- Die Bausteine ----------
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const zoomButton = document.getElementById('btn-zoom');
const undoButton = document.getElementById('btn-undo');
const redoButton = document.getElementById('btn-redo');

// Die Notiz: mehrere Seiten, jede mit Vorlage und eigenen Strichen (sortiert nach z)
const doc = new NoteDocument(loadJSON('pageTemplate', DEFAULT_TEMPLATE));
const view = new View();                  // Zoom und Verschiebung
const renderer = new Renderer(canvas, view, doc);
const debug = new Debug(document.getElementById('debug'), renderer);

let current = null;      // der Strich, der gerade geschrieben wird
let currentPage = null;  // ... auf dieser Seite
let currentTop = 0;      // Oberkante dieser Seite (Dokument-Koordinaten)
let lastErase = null;    // letzte Radierer-Position
let erasing = null;      // was beim aktuellen Radieren passiert ist: Seite -> { added: [], removed: [] }
let pages = null;        // Seiten-Menüs (siehe pages.js), wird weiter unten eingerichtet
let nextZ = 1;           // z-Nummer für den nächsten neuen Strich (höher = weiter oben)

// Rückgängig/Wiederholen: bei jeder Änderung die Knöpfe an- oder ausgrauen
const history = new History(() => {
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
});

// Stift steht am Ende eines Strichs still -> Strich wird zur geraden Linie
const hold = new HoldDetector(straightenCurrentStroke);

// ---------- Was die App tun kann ----------
// input.js ruft diese Funktionen auf, je nachdem was Stift und Finger machen.
const app = {
  view,
  debug,

  startStroke(point, pointerType) {
    // Die Einstellungen des aktuellen Stifts (beim Radierer: der Stift davor)
    const style = activeStyle(tools);
    // Der Strich gehört zu der Seite, auf der er anfängt (in der Lücke: die nähere)
    const index = doc.indexAt(point[1]);
    currentPage = doc.pages[index];
    currentTop = doc.top(index);
    current = createStroke({
      tool: style.type === 'highlighter' ? 'highlighter' : 'pen',
      penType: style.type,
      color: style.color,
      size: style.size,
      opacity: style.opacity,
      simulatePressure: pointerType !== 'pen',
      z: nextZ++,
    });
    point = toLocal(point);
    current.points.push(point);
    if (tools.straighten) hold.moved(point, view.scale);
    drawCurrentStroke([]);
  },

  extendStroke(points, predicted) {
    if (!current || points.length === 0) return;
    points = points.map(toLocal);
    predicted = predicted.map(toLocal);
    const last = points[points.length - 1];

    // Schon begradigt? Dann folgt nur noch das Ende der Linie dem Stift.
    if (current.straight) {
      current.points = linePoints(current.points[0], last, current.linePressure);
      drawCurrentStroke([]);
      return;
    }

    current.points.push(...points);
    if (tools.straighten) hold.moved(last, view.scale);
    drawCurrentStroke(predicted);
  },

  endStroke() {
    hold.stop();
    if (!current) return;
    finishStroke(current);
    if (current.box && doc.pages.includes(currentPage)) {
      currentPage.strokes.push(current); // hat das höchste z, gehört also ans Ende
      renderer.commitStroke(current, doc.pages.indexOf(currentPage));
      history.push({ strokes: [{ page: currentPage, added: [current], removed: [] }] });
      pages.strokesChanged();
    } else {
      renderer.setOverlay(null);
    }
    current = null;
  },

  startErase(point) {
    erasing = new Map();
    lastErase = point;
    eraseAt(point[0], point[1]);
  },

  // Zwischen zwei Radierer-Positionen auch die Punkte dazwischen prüfen,
  // sonst "springt" der Radierer bei schnellen Bewegungen über Striche hinweg.
  eraseAlong(points) {
    const step = tools.eraser.size / view.scale / 2;
    for (const p of points) {
      const from = lastErase || p;
      const distance = Math.hypot(p[0] - from[0], p[1] - from[1]);
      const steps = Math.max(1, Math.ceil(distance / step));
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        eraseAt(from[0] + (p[0] - from[0]) * t, from[1] + (p[1] - from[1]) * t);
      }
      lastErase = p;
    }
  },

  endErase() {
    lastErase = null;
    // das ganze Radieren ist EIN Schritt zum Rückgängigmachen (auch über mehrere Seiten)
    if (erasing) history.push({ strokes: [...erasing].map(([page, c]) => ({ page, ...c })) });
    if (erasing?.size) pages.strokesChanged();
    erasing = null;
  },

  // Radierer-Kreis an Bildschirm-Position [x, y] zeigen (null = ausblenden)
  showEraser(pos) {
    if (!pos) return renderer.setOverlay(null);
    const [x, y] = pos;
    const r = tools.eraser.size;
    renderer.setOverlay({
      box: { minX: x - r - 2, minY: y - r - 2, maxX: x + r + 2, maxY: y + r + 2 },
      draw(ctx, rend) {
        ctx.setTransform(rend.dpr, 0, 0, rend.dpr, 0, 0);
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(74, 108, 247, 0.12)';
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = '#4a6cf7';
        ctx.stroke();
      },
    });
  },

  // Knopf-Klick beim Schweben schaltet den Radierer an/aus -> Werkzeugleiste anpassen
  setEraserMode(on) {
    if (on && tools.tool !== 'eraser') {
      toolBeforeEraser = tools.tool;
      toolbar.setTool('eraser');
    } else if (!on && tools.tool === 'eraser') {
      toolbar.setTool(toolBeforeEraser);
    }
  },

  // Stiftknopf in der Luft lange gehalten -> Schnellmenü-Rad an dieser Stelle öffnen
  openQuickMenu(x, y) {
    toolbar.closePopup();
    wheel.open(x, y);
  },

  panBy(dx, dy) {
    view.panBy(dx, dy);
    afterViewChange();
  },

  // Finger mit Schwung losgelassen -> weiterrollen und langsam abbremsen
  fling(vx, vy) {
    startFling(vx, vy);
  },

  stopFling() {
    stopScrollAnimation();
  },

  zoomAt(x, y, factor) {
    view.zoomAt(x, y, factor);
    afterViewChange();
  },
};

// Den Strich, der gerade entsteht, sofort anzeigen
function drawCurrentStroke(predicted) {
  const built = buildPath(current, predicted, false);
  const { box } = built;
  if (!box) return;
  const [x0, y0] = view.toScreen(box.minX, box.minY + currentTop);
  const [x1, y1] = view.toScreen(box.maxX, box.maxY + currentTop);
  const stroke = current;
  const index = doc.pages.indexOf(currentPage);
  renderer.setOverlay({
    box: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    draw(ctx, rend) {
      rend.enterPage(ctx, index);
      fillStroke(ctx, stroke, built);
    },
  });
}

// Dokument-Punkt -> Punkt auf der aktuellen Seite
function toLocal(p) {
  return [p[0], p[1] - currentTop, p[2]];
}

// Wird vom HoldDetector aufgerufen, wenn der Stift lange genug stillstand
function straightenCurrentStroke() {
  if (!current || current.straight) return;
  const start = current.points[0];
  const end = current.points[current.points.length - 1];
  if (!longEnough(start, end, view.scale)) return;

  current.straight = true;
  current.linePressure = averagePressure(current.points);
  current.points = linePoints(start, end, current.linePressure);
  drawCurrentStroke([]);
  navigator.vibrate?.(12); // kurzes Ruckeln als Rückmeldung (falls das Gerät es kann)
}

// Radieren an Stelle (x, y):
//   Modus "Strich löschen":  jeder berührte Strich verschwindet ganz
//   Modus "Bereich löschen": nur das Stück unter dem Radierer verschwindet (cutStroke)
function eraseAt(x, y) {
  const r = tools.eraser.size / view.scale; // Bildschirm-Pixel -> Seiten-Einheiten
  let area = null; // Bereich, in dem sich etwas geändert hat (Dokument-Koordinaten)
  const [first, last] = doc.range(y - r, y + r);
  for (let p = first; p <= last; p++) {
    const page = doc.pages[p];
    const top = doc.top(p);
    const ly = y - top; // Höhe auf dieser Seite
    if (ly < -r || ly > PAGE_HEIGHT + r) continue;
    const strokes = page.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (tools.eraser.onlyHighlighter && stroke.tool !== 'highlighter') continue;
      if (!strokeHit(stroke, x, ly, r)) continue;

      let pieces = [];
      if (tools.eraser.mode === 'area') {
        pieces = cutStroke(stroke, x, ly, r);
        if (!pieces) continue; // doch nicht getroffen
      }
      const b = stroke.box;
      area = unionBox(area, { minX: b.minX, minY: b.minY + top, maxX: b.maxX, maxY: b.maxY + top });
      strokes.splice(i, 1, ...pieces); // Strich durch seine Reststücke ersetzen (gleiche Stelle = gleiches z)
      noteErased(page, stroke, pieces);
    }
  }
  // Sofort nur diesen Bereich neu malen (nicht erst beim nächsten Bild alles)
  if (area) renderer.redrawArea(area);
}

// Fürs Rückgängigmachen mitschreiben, was beim Radieren passiert
function noteErased(page, stroke, pieces) {
  if (!erasing) erasing = new Map();
  if (!erasing.has(page)) erasing.set(page, { added: [], removed: [] });
  const change = erasing.get(page);
  const index = change.added.indexOf(stroke);
  if (index >= 0) {
    // Ein Reststück, das erst in diesem Radiervorgang entstanden ist: einfach wieder vergessen
    change.added.splice(index, 1);
  } else {
    change.removed.push(stroke);
  }
  change.added.push(...pieces);
}

// ---------- Rückgängig / Wiederholen ----------
function removeStrokes(strokes, list) {
  for (const stroke of list) {
    const index = strokes.indexOf(stroke);
    if (index >= 0) strokes.splice(index, 1);
  }
}

// Striche wieder einfügen – an der richtigen Stelle, damit die Reihenfolge (z) stimmt.
// Wichtig z. B. beim Textmarker: Er soll wieder unter bzw. über denselben Strichen liegen.
function insertStrokes(strokes, list) {
  for (const stroke of list) {
    let index = strokes.length;
    while (index > 0 && strokes[index - 1].z > stroke.z) index--;
    strokes.splice(index, 0, stroke);
  }
}

// Eine Aktion ausführen (forward = true) oder rückgängig machen (forward = false)
function applyAction(action, forward) {
  if (action.pages) {
    doc.pages.splice(0, doc.pages.length, ...(forward ? action.pages.after : action.pages.before));
  }
  for (const t of action.templates || []) t.page.template = { ...(forward ? t.after : t.before) };
  for (const c of action.strokes || []) {
    removeStrokes(c.page.strokes, forward ? c.removed : c.added);
    insertStrokes(c.page.strokes, forward ? c.added : c.removed);
  }
  pagesChanged();
}

function undo() {
  if (current || erasing) return; // nicht mitten im Schreiben
  const action = history.undo();
  if (action) applyAction(action, false);
}

function redo() {
  if (current || erasing) return;
  const action = history.redo();
  if (action) applyAction(action, true);
}

// ---------- Seiten ----------
// Welche Seite ist gerade "dran"? Die in der Mitte des Bildschirms.
function currentIndex() {
  return doc.indexAt(view.toPage(view.width / 2, view.height / 2)[1]);
}

// Seiten hinzufügen/löschen/verschieben: immer als EIN Schritt zum Rückgängigmachen
function changePages(fn) {
  const before = [...doc.pages];
  fn(doc.pages);
  history.push({ pages: { before, after: [...doc.pages] } });
  pagesChanged();
}

// Nach jeder Änderung an den Seiten: Höhe neu, neu malen, Menüs aktualisieren
function pagesChanged() {
  view.setContentHeight(doc.height + END_SPACE);
  renderer.requestRender();
  afterViewChange();
  pages.refresh();
}

// Neue Seite an Stelle "at" – mit derselben Vorlage wie die Seite davor
function addPage(at) {
  const like = doc.pages[Math.max(0, Math.min(at - 1, doc.count - 1))];
  changePages((list) => list.splice(at, 0, createPage(like.template)));
}

function deletePage(i) {
  if (doc.count <= 1) return;
  changePages((list) => list.splice(i, 1));
}

function duplicatePage(i) {
  const original = doc.pages[i];
  const copy = createPage(original.template);
  // Striche kopieren (die fertigen Formen darin ändern sich nie, die dürfen beide Seiten teilen)
  copy.strokes = original.strokes.map((s) => ({ ...s, z: nextZ++ }));
  changePages((list) => list.splice(i + 1, 0, copy));
}

function movePage(from, to) {
  changePages((list) => list.splice(to, 0, ...list.splice(from, 1)));
}

function setTemplate(indices, tpl) {
  const templates = indices.map((i) => ({ page: doc.pages[i], before: { ...doc.pages[i].template }, after: { ...tpl } }));
  for (const t of templates) t.page.template = { ...tpl };
  history.push({ templates });
  saveJSON('pageTemplate', tpl); // die nächste neue Notiz fängt mit dieser Vorlage an
  pagesChanged();
}

// ---------- Weiches Scrollen ----------
let scrollFrame = 0;
let scrolling = false; // läuft gerade eine Scroll-Animation (für die Seitenanzeige)?

function stopScrollAnimation() {
  cancelAnimationFrame(scrollFrame);
  scrollFrame = 0;
  scrolling = false;
}

// Schwung: Geschwindigkeit (Pixel pro ms) nimmt mit jedem Bild ab
function startFling(vx, vy) {
  stopScrollAnimation();
  let last = performance.now();
  scrolling = true;
  const step = (now) => {
    const dt = Math.min(32, now - last);
    last = now;
    const decay = Math.pow(0.9965, dt);
    vx *= decay;
    vy *= decay;
    const bx = view.x;
    const by = view.y;
    view.panBy(vx * dt, vy * dt);
    afterViewChange();
    const stuck = Math.abs(view.x - bx) < 0.01 && Math.abs(view.y - by) < 0.01;
    if (Math.hypot(vx, vy) < 0.03 || stuck) return stopScrollAnimation();
    scrollFrame = requestAnimationFrame(step);
  };
  scrollFrame = requestAnimationFrame(step);
}

// Zu Seite i springen (Oberkante der Seite oben am Bildschirm)
function goTo(i, animate = true) {
  stopScrollAnimation();
  const from = view.y;
  const target = (() => {
    const saved = view.y;
    view.y = view.yFor(doc.top(i));
    view.clamp();
    const t = view.y;
    view.y = saved;
    return t;
  })();
  if (!animate || Math.abs(target - from) < 1) {
    view.y = target;
    afterViewChange();
    return;
  }
  const start = performance.now();
  const duration = 360;
  scrolling = true;
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    const ease = 1 - Math.pow(1 - t, 3);
    view.y = from + (target - from) * ease;
    view.clamp();
    afterViewChange();
    if (t < 1) scrollFrame = requestAnimationFrame(step);
    else stopScrollAnimation();
  };
  scrollFrame = requestAnimationFrame(step);
}

function unionBox(a, b) {
  if (!a) return { ...b };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function afterViewChange() {
  renderer.requestRender();
  zoomButton.textContent = `${Math.round((view.scale / view.fitScale) * 100)} %`;
  pages?.onViewChange();
}

const input = setupInput(canvas, app);

// ---------- Werkzeugleiste ----------
let toolBeforeEraser = tools.tool === 'highlighter' ? 'highlighter' : 'pen';
const toolbar = setupToolbar({
  tools,
  // Radierer in der Leiste gewählt = Stift radiert ab jetzt auch ohne Knopf
  onToolChange(tool) {
    if (tool !== 'eraser') toolBeforeEraser = tool;
    input.setStickyEraser(tool === 'eraser');
  },
  // "Seite leeren" leert die Seite, die gerade in der Mitte zu sehen ist
  onClear() {
    const page = doc.pages[currentIndex()];
    if (page.strokes.length === 0) return;
    history.push({ strokes: [{ page, added: [], removed: [...page.strokes] }] }); // kann man rückgängig machen
    page.strokes.length = 0;
    renderer.requestRender();
    pages.strokesChanged();
  },
});
input.setStickyEraser(tools.tool === 'eraser');

// ---------- Seiten: Vorlagen, Hinzufügen, Übersicht ----------
// Dunkles Blatt: nur wenn das Tablet im Dunkelmodus ist UND der Schalter an ist
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
let darkPaperSetting = readSetting('darkPaper', 'on') === 'on';

function applyTheme() {
  renderer.readColors();
  renderer.darkPaper = prefersDark.matches && darkPaperSetting;
  document.documentElement.classList.toggle('dark-paper', renderer.darkPaper);
  renderer.requestRender();
  pages?.refresh();
}

pages = setupPages({
  doc,
  view,
  current: currentIndex,
  isScrolling: () => scrolling,
  addPage,
  deletePage,
  duplicatePage,
  movePage,
  setTemplate,
  goTo,
  darkPaper: () => renderer.darkPaper,
  darkPaperSetting: () => darkPaperSetting,
  setDarkPaperSetting(on) {
    darkPaperSetting = on;
    saveSetting('darkPaper', on ? 'on' : 'off');
    applyTheme();
  },
  closeOtherPopups() {
    toolbar.closePopup();
  },
});

// ---------- Schnellmenü (Rad) ----------
const wheel = setupWheel({
  tools,
  onPick({ act, id }) {
    if (act === 'undo') undo();
    else if (act === 'redo') redo();
    else if (act === 'eraser') toolbar.setTool(tools.tool === 'eraser' ? toolBeforeEraser : 'eraser');
    else if (act === 'pen') {
      if (id === 'eraser' || id === 'highlighter') toolbar.setTool(id);
      else {
        tools.penType = id;
        toolbar.setTool('pen');
      }
    } else if (act === 'color') {
      // Farbe gilt für den aktuellen Stift. War der Radierer an, geht's zurück zum Stift.
      if (tools.tool === 'eraser') toolbar.setTool(toolBeforeEraser);
      settingsOf(tools, activeStyle(tools).type).color = id;
    } else if (act === 'fav') {
      toolbar.applyFavorite(tools.favorites[Number(id)]);
    }
    saveTools(tools);
    toolbar.update();
  },
});

undoButton.addEventListener('click', undo);
redoButton.addEventListener('click', redo);

// Am PC: Strg+Z = Rückgängig, Strg+Y oder Strg+Umschalt+Z = Wiederholen
window.addEventListener('keydown', (e) => {
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) undo();
  else if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
  else return;
  e.preventDefault();
});

// Am PC: Bild auf/ab = Seite vor/zurück
window.addEventListener('keydown', (e) => {
  if (e.key === 'PageDown') goTo(Math.min(doc.count - 1, currentIndex() + 1));
  else if (e.key === 'PageUp') goTo(Math.max(0, currentIndex() - 1));
});

// ---------- Größe der Zeichenfläche ----------
// ResizeObserver meldet sich, wenn sich die Größe ändert (z. B. Tablet drehen)
view.setContentHeight(doc.height + END_SPACE);
new ResizeObserver(() => {
  view.setSize(stage.clientWidth, stage.clientHeight);
  renderer.resize(stage.clientWidth, stage.clientHeight);
  input.updateRect();
  afterViewChange();
}).observe(stage);

// Hell-/Dunkelmodus gewechselt -> Farben neu lesen, Blatt hell oder dunkel
prefersDark.addEventListener('change', applyTheme);
applyTheme();

// ---------- Knöpfe oben ----------
zoomButton.addEventListener('click', () => {
  stopScrollAnimation();
  view.fitToWidth();
  afterViewChange();
});

// Diagnose ein/aus (die Einstellung wird gemerkt)
const debugButton = document.getElementById('btn-debug');
let debugVisible = readSetting('debug', 'on') === 'on';
function applyDebugVisible() {
  debug.setVisible(debugVisible);
  debugButton.classList.toggle('active', debugVisible);
}
debugButton.addEventListener('click', () => {
  debugVisible = !debugVisible;
  saveSetting('debug', debugVisible ? 'on' : 'off');
  applyDebugVisible();
});
applyDebugVisible();

// "App installieren": Chrome meldet mit "beforeinstallprompt", dass es geht
const installButton = document.getElementById('btn-install');
let installPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
  installButton.hidden = false;
});
installButton.addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  installButton.hidden = true;
});

// ---------- Offline-Fähigkeit ----------
// Den Service Worker nur in der fertigen Version anmelden (nicht beim Entwickeln)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  navigator.serviceWorker.register('./sw.js').catch((err) => console.warn('Kein Service Worker:', err));
}

// Kleine Helfer für gespeicherte Einstellungen (localStorage kann manchmal fehlen)
function readSetting(key, fallback) {
  try {
    return localStorage.getItem('federleicht.' + key) ?? fallback;
  } catch {
    return fallback;
  }
}
function saveSetting(key, value) {
  try {
    localStorage.setItem('federleicht.' + key, value);
  } catch {
    /* egal */
  }
}
function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem('federleicht.' + key));
    return value && typeof value === 'object' ? { ...fallback, ...value } : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  saveSetting(key, JSON.stringify(value));
}
