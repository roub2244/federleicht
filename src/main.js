// main.js – der Startpunkt: hier wird alles zusammengesteckt
import './style.css';
import { View } from './view.js';
import { Renderer } from './renderer.js';
import { createStroke, buildPath, strokeHit } from './ink.js';
import { setupInput } from './input.js';
import { Debug } from './debug.js';

// ---------- Einstellungen ----------
const PEN = { color: '#1f2a44', size: 3.2 }; // dunkelblaue "Tinte"
const ERASER_RADIUS = 12;                    // Radierer-Größe in Bildschirm-Pixeln

// ---------- Die Bausteine ----------
const stage = document.getElementById('stage');
const canvas = document.getElementById('canvas');
const zoomButton = document.getElementById('btn-zoom');

const strokes = [];                       // alle fertigen Striche dieser Seite
const view = new View();                  // Zoom und Verschiebung
const renderer = new Renderer(canvas, view, strokes);
const debug = new Debug(document.getElementById('debug'), renderer);

let current = null;    // der Strich, der gerade geschrieben wird
let lastErase = null;  // letzte Radierer-Position

// ---------- Was die App tun kann ----------
// input.js ruft diese Funktionen auf, je nachdem was Stift und Finger machen.
const app = {
  view,
  debug,

  startStroke(point, pointerType) {
    current = createStroke({ ...PEN, simulatePressure: pointerType !== 'pen' });
    current.points.push(point);
    drawCurrentStroke([]);
  },

  extendStroke(points, predicted) {
    if (!current) return;
    current.points.push(...points);
    drawCurrentStroke(predicted);
  },

  endStroke() {
    if (!current) return;
    const { path, box } = buildPath(current, [], true);
    current.path = path;
    current.box = box;
    if (box) {
      strokes.push(current);
      renderer.commitStroke(current);
    } else {
      renderer.setOverlay(null);
    }
    current = null;
  },

  startErase(point) {
    lastErase = point;
    eraseAt(point[0], point[1]);
  },

  // Zwischen zwei Radierer-Positionen auch die Punkte dazwischen prüfen,
  // sonst "springt" der Radierer bei schnellen Bewegungen über Striche hinweg.
  eraseAlong(points) {
    const step = ERASER_RADIUS / view.scale / 2;
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
  },

  // Radierer-Kreis an Bildschirm-Position [x, y] zeigen (null = ausblenden)
  showEraser(pos) {
    if (!pos) return renderer.setOverlay(null);
    const [x, y] = pos;
    const r = ERASER_RADIUS;
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
  const color = current.color;
  renderer.setOverlay({
    box: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    draw(ctx, rend) {
      rend.applyView(ctx);
      rend.clipToPage(ctx);
      ctx.fillStyle = color;
      ctx.fill(path);
    },
  });
}

// Alle Striche löschen, die der Radierer an Stelle (x, y) berührt
function eraseAt(x, y) {
  const r = ERASER_RADIUS / view.scale; // Bildschirm-Pixel -> Seiten-Einheiten
  let removed = false;
  for (let i = strokes.length - 1; i >= 0; i--) {
    if (strokeHit(strokes[i], x, y, r)) {
      strokes.splice(i, 1);
      removed = true;
    }
  }
  if (removed) renderer.requestRender();
}

function afterViewChange() {
  renderer.requestRender();
  zoomButton.textContent = `${Math.round((view.scale / view.fitScale) * 100)} %`;
}

const input = setupInput(canvas, app);

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

// "Seite leeren" braucht zwei Tipps, damit nichts aus Versehen weg ist
const clearButton = document.getElementById('btn-clear');
let clearArmed = false;
clearButton.addEventListener('click', () => {
  if (!clearArmed) {
    clearArmed = true;
    clearButton.classList.add('active');
    clearButton.title = 'Nochmal tippen zum Leeren';
    setTimeout(() => {
      clearArmed = false;
      clearButton.classList.remove('active');
    }, 2500);
    return;
  }
  strokes.length = 0;
  clearArmed = false;
  clearButton.classList.remove('active');
  renderer.requestRender();
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
  navigator.serviceWorker.register('./sw.js');
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
