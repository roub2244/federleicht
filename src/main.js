// main.js – der Startpunkt: hier wird alles zusammengesteckt
import './style.css';
import { View } from './view.js';
import { Renderer } from './renderer.js';
import { createStroke, buildPath, finishStroke, fillStroke, strokeHit, cutStroke } from './ink.js';
import { setupInput } from './input.js';
import { Debug } from './debug.js';
import { HoldDetector, linePoints, averagePressure, longEnough } from './straighten.js';
import { History } from './history.js';
import { loadTools } from './tools.js';
import { setupToolbar } from './toolbar.js';

// ---------- Einstellungen ----------
// Farbe, Dicke, Stiftart usw. kommen aus der Werkzeugleiste (siehe tools.js)
const tools = loadTools();

// ---------- Die Bausteine ----------
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const zoomButton = document.getElementById('btn-zoom');
const undoButton = document.getElementById('btn-undo');
const redoButton = document.getElementById('btn-redo');

const strokes = [];                       // alle fertigen Striche dieser Seite, sortiert nach z
const view = new View();                  // Zoom und Verschiebung
const renderer = new Renderer(canvas, view, strokes);
const debug = new Debug(document.getElementById('debug'), renderer);

let current = null;      // der Strich, der gerade geschrieben wird
let lastErase = null;    // letzte Radierer-Position
let erasing = null;      // was beim aktuellen Radieren passiert ist: { added: [], removed: [] }
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
    // Radierer gewählt, aber trotzdem gezeichnet (z. B. Maus)? Dann mit dem Stift.
    const tool = tools.tool === 'highlighter' ? 'highlighter' : 'pen';
    const settings = tools[tool];
    current = createStroke({
      tool,
      penType: tool === 'highlighter' ? 'highlighter' : settings.type,
      color: settings.color,
      size: settings.size,
      simulatePressure: pointerType !== 'pen',
      z: nextZ++,
    });
    current.points.push(point);
    hold.moved(point, view.scale);
    drawCurrentStroke([]);
  },

  extendStroke(points, predicted) {
    if (!current || points.length === 0) return;
    const last = points[points.length - 1];

    // Schon begradigt? Dann folgt nur noch das Ende der Linie dem Stift.
    if (current.straight) {
      current.points = linePoints(current.points[0], last, current.linePressure);
      drawCurrentStroke([]);
      return;
    }

    current.points.push(...points);
    hold.moved(last, view.scale);
    drawCurrentStroke(predicted);
  },

  endStroke() {
    hold.stop();
    if (!current) return;
    finishStroke(current);
    if (current.box) {
      strokes.push(current); // hat das höchste z, gehört also ans Ende
      renderer.commitStroke(current);
      history.push({ added: [current], removed: [] });
    } else {
      renderer.setOverlay(null);
    }
    current = null;
  },

  startErase(point) {
    erasing = { added: [], removed: [] };
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
    if (erasing) history.push(erasing); // das ganze Radieren ist EIN Schritt zum Rückgängigmachen
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

  panBy(dx, dy) {
    view.panBy(dx, dy);
    afterViewChange();
  },

  zoomAt(x, y, factor) {
    view.zoomAt(x, y, factor);
    afterViewChange();
  },
};

// Den Strich, der gerade entsteht, sofort anzeigen
function drawCurrentStroke(predicted) {
  const { path, box } = buildPath(current, predicted, false);
  if (!box) return;
  const [x0, y0] = view.toScreen(box.minX, box.minY);
  const [x1, y1] = view.toScreen(box.maxX, box.maxY);
  const stroke = current;
  renderer.setOverlay({
    box: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    draw(ctx, rend) {
      rend.applyView(ctx);
      rend.clipToPage(ctx);
      fillStroke(ctx, stroke, path);
    },
  });
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
  let area = null; // Bereich, in dem sich etwas geändert hat
  for (let i = strokes.length - 1; i >= 0; i--) {
    const stroke = strokes[i];
    if (!strokeHit(stroke, x, y, r)) continue;

    let pieces = [];
    if (tools.eraser.mode === 'area') {
      pieces = cutStroke(stroke, x, y, r);
      if (!pieces) continue; // doch nicht getroffen
    }
    area = unionBox(area, stroke.box);
    strokes.splice(i, 1, ...pieces); // Strich durch seine Reststücke ersetzen (gleiche Stelle = gleiches z)
    noteErased(stroke, pieces);
  }
  // Sofort nur diesen Bereich neu malen (nicht erst beim nächsten Bild alles)
  if (area) renderer.redrawArea(area);
}

// Fürs Rückgängigmachen mitschreiben, was beim Radieren passiert
function noteErased(stroke, pieces) {
  if (!erasing) erasing = { added: [], removed: [] };
  const index = erasing.added.indexOf(stroke);
  if (index >= 0) {
    // Ein Reststück, das erst in diesem Radiervorgang entstanden ist: einfach wieder vergessen
    erasing.added.splice(index, 1);
  } else {
    erasing.removed.push(stroke);
  }
  erasing.added.push(...pieces);
}

// ---------- Rückgängig / Wiederholen ----------
function removeStrokes(list) {
  for (const stroke of list) {
    const index = strokes.indexOf(stroke);
    if (index >= 0) strokes.splice(index, 1);
  }
}

// Striche wieder einfügen – an der richtigen Stelle, damit die Reihenfolge (z) stimmt.
// Wichtig z. B. beim Textmarker: Er soll wieder unter bzw. über denselben Strichen liegen.
function insertStrokes(list) {
  for (const stroke of list) {
    let index = strokes.length;
    while (index > 0 && strokes[index - 1].z > stroke.z) index--;
    strokes.splice(index, 0, stroke);
  }
}

function undo() {
  if (current || erasing) return; // nicht mitten im Schreiben
  const action = history.undo();
  if (!action) return;
  removeStrokes(action.added);
  insertStrokes(action.removed);
  renderer.requestRender();
}

function redo() {
  if (current || erasing) return;
  const action = history.redo();
  if (!action) return;
  removeStrokes(action.removed);
  insertStrokes(action.added);
  renderer.requestRender();
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
  onSettingsChange() {},
  onClear() {
    if (strokes.length === 0) return;
    history.push({ added: [], removed: [...strokes] }); // auch "Seite leeren" kann man rückgängig machen
    strokes.length = 0;
    renderer.requestRender();
  },
});
input.setStickyEraser(tools.tool === 'eraser');

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

// ---------- Größe der Zeichenfläche ----------
// ResizeObserver meldet sich, wenn sich die Größe ändert (z. B. Tablet drehen)
new ResizeObserver(() => {
  view.setSize(stage.clientWidth, stage.clientHeight);
  renderer.resize(stage.clientWidth, stage.clientHeight);
  input.updateRect();
  afterViewChange();
}).observe(stage);

// Hell-/Dunkelmodus gewechselt -> Farben neu lesen
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  renderer.readColors();
  renderer.requestRender();
});

// ---------- Knöpfe oben ----------
zoomButton.addEventListener('click', () => {
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
