// main.js – der Startpunkt: hier wird alles zusammengesteckt
import './style.css';
import './paint.js'; // Farbflächen auf Canvas (gegen den Dunkelmodus von Samsung Internet)
import { View, PAGE_HEIGHT } from './view.js';
import { NoteDocument, createPage, END_SPACE } from './document.js';
import { DEFAULT_TEMPLATE, drawThumbnail, paperColor } from './templates.js';
import { setupPages } from './pages.js';
import { Renderer } from './renderer.js';
import { createStroke, buildPath, finishStroke, fillStroke, strokeHit, cutStroke, inkTheme, setInkTheme, displayColor } from './ink.js';
import { setupInput } from './input.js';
import { Debug } from './debug.js';
import { HoldDetector, linePoints, averagePressure, longEnough } from './straighten.js';
import { History } from './history.js';
import { LiftTracker } from './lift.js';
import { setupTextEditor } from './texteditor.js';
import { loadFonts, onFontsChanged, updateTextBox } from './text.js';
import { loadTools, saveTools, activeStyle, settingsOf } from './tools.js';
import { setupToolbar } from './toolbar.js';
import { setupWheel } from './wheel.js';
import * as store from './store.js';
import { setupHome } from './home.js';
import { askText, toast } from './dialog.js';

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
let textEditor = null;   // Textfelder bearbeiten (siehe texteditor.js), wird weiter unten eingerichtet
let home = null;         // Startbildschirm (siehe home.js), wird weiter unten eingerichtet

// Rückgängig/Wiederholen: bei jeder Änderung die Knöpfe an- oder ausgrauen
const history = new History(() => {
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
});

// Stift steht am Ende eines Strichs still -> Strich wird zur geraden Linie
const hold = new HoldDetector(straightenCurrentStroke);

// Erkennt, wann der Stift beim Absetzen nur noch ganz leicht aufliegt (siehe lift.js)
const lift = new LiftTracker();
let liftedPointer = null; // nach erkanntem Abheben: Stift liegt noch leicht auf ('pen'), sonst null
const MIN_INK_PRESSURE = 0.04;

// ---------- Was die App tun kann ----------
// input.js ruft diese Funktionen auf, je nachdem was Stift und Finger machen.
const app = {
  view,
  debug,

  startStroke(point, pointerType) {
    liftedPointer = null;
    // Der Strich gehört zu der Seite, auf der er anfängt (in der Lücke: die nähere)
    const index = doc.indexAt(point[1]);
    currentPage = doc.pages[index];
    currentTop = doc.top(index);
    beginStroke(toLocal(point), pointerType);
  },

  extendStroke(points, predicted) {
    if (points.length === 0) return;
    points = points.map(toLocal);
    predicted = predicted.map(toLocal);

    // Nach einem erkannten Abheben: erst wieder richtig aufdrücken, dann neuer Strich
    if (!current) {
      if (!liftedPointer) return;
      const first = points.findIndex((p) => lift.isRetouch(p[2]));
      if (first < 0) return;
      debug.addLine('Wieder aufgedrückt → neuer Strich');
      beginStroke(points[first], liftedPointer);
      liftedPointer = null;
      points = points.slice(first + 1);
      if (points.length === 0) return drawCurrentStroke(predicted);
    }
    const last = points[points.length - 1];

    // Schon begradigt? Dann folgt nur noch das Ende der Linie dem Stift.
    if (current.straight) {
      current.points = linePoints(current.points[0], last, current.linePressure);
      drawCurrentStroke([]);
      return;
    }

    if (current.simulatePressure) {
      current.points.push(...points);
    } else {
      // Echter Stift: jeden Punkt auf "eigentlich schon abgehoben" prüfen (siehe lift.js)
      for (let k = 0; k < points.length; k++) {
        const p = points[k];
        current.points.push(inkPoint(p));
        const verdict = lift.add(p, current.points.length - 1, view.scale);
        if (verdict?.trimStart) {
          current.points.splice(0, verdict.trimStart);
        } else if (verdict?.cut !== undefined) {
          // Stift ist abgesetzt, liegt aber noch leicht auf: Strich hier beenden
          current.points.length = Math.max(1, verdict.cut);
          debug.addLine(`Abheben erkannt (Druck ${p[2].toFixed(3)}) → Strich beendet`);
          finishCurrentStroke();
          liftedPointer = 'pen';
          // Falls in denselben Punkten schon wieder aufgedrückt wurde: gleich weitermachen
          const rest = points.slice(k + 1);
          if (rest.length) app.extendStroke(rest.map(toDoc), []);
          return;
        }
      }
    }
    if (tools.straighten) hold.moved(last, view.scale);
    drawCurrentStroke(predicted);
  },

  endStroke() {
    liftedPointer = null;
    if (current && !current.simulatePressure && !current.straight) {
      // Leichte Punkte ganz am Ende (beim Abheben) weglassen -> kein Haken
      current.points.length = Math.max(1, lift.keepAtEnd(current.points.length));
    }
    finishCurrentStroke();
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
    if (erasing?.size) {
      pages.strokesChanged();
      markDirty([...erasing.keys()]);
    }
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

  // ---------- Text ----------
  textMode() {
    return tools.tool === 'text';
  },
  textEditing() {
    return Boolean(textEditor?.active);
  },
  // Mit dem Text-Werkzeug getippt (point in Dokument-Koordinaten, client = Bildschirm-Punkt)
  textTap(point, client) {
    if (textEditor.active) {
      textEditor.finish(); // daneben getippt = fertig
      return;
    }
    if (tools.tool !== 'text') return;
    const index = doc.indexAt(point[1]);
    const page = doc.pages[index];
    const y = point[1] - doc.top(index);
    if (y < 0 || y > PAGE_HEIGHT || point[0] < 0 || point[0] > 1000) return;
    const hit = textEditor.hitTest(page, point[0], y, 10 / view.scale);
    if (hit) textEditor.open(page, hit, { at: client });
    else textEditor.create(page, point[0], y, nextZ++);
  },
  // Mit dem Text-Werkzeug gezogen: Textfeld von a bis b (so breit wie gezogen)
  textDrag(a, b) {
    if (textEditor.active) return textEditor.finish();
    if (tools.tool !== 'text') return;
    const index = doc.indexAt(a[1]);
    const page = doc.pages[index];
    const y = Math.min(a[1], b[1]) - doc.top(index);
    const x = Math.max(0, Math.min(a[0], b[0]));
    const w = Math.min(1000, Math.max(a[0], b[0])) - x;
    if (y < 0 || y > PAGE_HEIGHT || w < 40) return;
    textEditor.create(page, x, y, nextZ++, w, true);
  },

  // Scroll-Sperre an? (dann kein Zoomen und kein seitliches Verrutschen, siehe input.js)
  isLocked() {
    return viewLocked;
  },
};

// Einen neuen Strich anfangen (point in Seiten-Koordinaten der Seite, auf der er beginnt)
function beginStroke(point, pointerType) {
  // Die Einstellungen des aktuellen Stifts (beim Radierer: der Stift davor)
  const style = activeStyle(tools);
  current = createStroke({
    tool: style.type === 'highlighter' ? 'highlighter' : 'pen',
    penType: style.type,
    color: style.color,
    size: style.size,
    opacity: style.opacity,
    simulatePressure: pointerType !== 'pen',
    z: nextZ++,
  });
  lift.reset();
  current.points.push(inkPoint(point));
  if (!current.simulatePressure) lift.add(point, 0, view.scale);
  if (tools.straighten) hold.moved(point, view.scale);
  drawCurrentStroke([]);
}

// Den laufenden Strich abschließen und auf die Seite legen
function finishCurrentStroke() {
  hold.stop();
  if (!current) return;
  if (!current.simulatePressure) lift.learn();
  finishStroke(current);
  if (current.box && doc.pages.includes(currentPage)) {
    currentPage.strokes.push(current); // hat das höchste z, gehört also ans Ende
    renderer.commitStroke(current, doc.pages.indexOf(currentPage));
    history.push({ strokes: [{ page: currentPage, added: [current], removed: [] }] });
    pages.strokesChanged();
    markDirty([currentPage]);
  } else {
    renderer.setOverlay(null);
  }
  current = null;
}

// Punkt so speichern, wie er gezeichnet wird: ganz ohne Druck wäre er unsichtbar dünn
function inkPoint(p) {
  return [p[0], p[1], Math.max(MIN_INK_PRESSURE, p[2])];
}

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
function toDoc(p) {
  return [p[0], p[1] + currentTop, p[2]];
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
  const touched = [...(action.strokes || []), ...(action.templates || [])].map((c) => c.page);
  markDirty(touched, Boolean(action.pages));
}

function undo() {
  if (textEditor?.active) return textEditor.undo(); // beim Tippen: Tippen rückgängig
  if (current || erasing) return; // nicht mitten im Schreiben
  const action = history.undo();
  if (action) applyAction(action, false);
}

function redo() {
  if (textEditor?.active) return textEditor.undo(true);
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
  markDirty([], true);
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
  markDirty(templates.map((t) => t.page));
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
  textEditor?.place();
  zoomButton.textContent = `${Math.round((view.scale / view.fitScale) * 100)} %`;
  pages?.onViewChange();
  scheduleSession();
}

const input = setupInput(canvas, app);

// ---------- Textfelder (siehe text.js und texteditor.js) ----------
textEditor = setupTextEditor({
  stage,
  view,
  doc,
  renderer,
  tools,
  // Textfeld fertig: neu (old = null), geändert, oder gelöscht (next = null)
  onCommit(page, old, next) {
    const change = { page, added: next ? [next] : [], removed: old ? [old] : [] };
    if (old && next) page.strokes.splice(page.strokes.indexOf(old), 1, next); // gleiche Stelle = gleiches z
    else {
      removeStrokes(page.strokes, change.removed);
      insertStrokes(page.strokes, change.added);
    }
    history.push({ strokes: [change] });
    renderer.requestRender();
    pages.strokesChanged();
    markDirty([page]);
  },
  onEditingChange(on) {
    document.documentElement.classList.toggle('text-editing', on);
    undoButton.disabled = on ? false : !history.canUndo;
    redoButton.disabled = on ? false : !history.canRedo;
  },
  // Cursor nicht unter der Tastatur oder der Format-Leiste verstecken
  ensureVisible(rect) {
    if (!rect) return;
    const vv = window.visualViewport;
    const bottom = (vv ? vv.height + vv.offsetTop : window.innerHeight) - 24;
    const top = stage.getBoundingClientRect().top + 76;
    if (rect.bottom > bottom) app.panBy(0, bottom - rect.bottom - 40);
    else if (rect.top < top) app.panBy(0, top - rect.top + 20);
  },
});
// Beim Tippen auf Rückgängig/Wiederholen soll das Eingabefeld nicht den Fokus verlieren
for (const b of [undoButton, redoButton]) {
  b.addEventListener('pointerdown', (e) => {
    if (textEditor.active) e.preventDefault();
  });
}
// Eingebaute Schriften laden; wenn sie da sind, Texte neu vermessen und malen
onFontsChanged(() => {
  for (const page of doc.pages) for (const s of page.strokes) if (s.tool === 'text') updateTextBox(s);
  renderer.requestRender();
  textEditor.place();
});
loadFonts();

// ---------- Werkzeugleiste ----------
let toolBeforeEraser = tools.tool === 'highlighter' ? 'highlighter' : 'pen';
const toolbar = setupToolbar({
  tools,
  // Radierer in der Leiste gewählt = Stift radiert ab jetzt auch ohne Knopf
  onToolChange(tool) {
    if (tool !== 'text') textEditor.finish();
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
    markDirty([page]);
  },
});
input.setStickyEraser(tools.tool === 'eraser');

// ---------- Seiten: Vorlagen, Hinzufügen, Übersicht ----------
// Dunkles Blatt: nur wenn das Tablet im Dunkelmodus ist UND der Schalter an ist
const prefersDark = matchMedia('(prefers-color-scheme: dark)');
let darkPaperSetting = readSetting('darkPaper', 'on') === 'on';

function applyTheme() {
  textEditor.themeChanged();
  renderer.readColors();
  renderer.darkPaper = prefersDark.matches && darkPaperSetting;
  document.documentElement.classList.toggle('dark-paper', renderer.darkPaper);
  renderer.requestRender();
  pages?.refresh();
  home?.refresh();
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
      if (tools.tool === 'eraser' || tools.tool === 'text') toolbar.setTool(toolBeforeEraser === 'highlighter' ? 'highlighter' : 'pen');
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
  if (home.open || document.querySelector('.dlg-back') || textEditor.active) return; // beim Tippen macht das Eingabefeld selbst Strg+Z
  if (!(e.ctrlKey || e.metaKey)) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) undo();
  else if (key === 'y' || (key === 'z' && e.shiftKey)) redo();
  else return;
  e.preventDefault();
});

// Am PC: Bild auf/ab = Seite vor/zurück
window.addEventListener('keydown', (e) => {
  if (home.open || document.querySelector('.dlg-back') || textEditor.active) return;
  if (e.key === 'PageDown') goTo(Math.min(doc.count - 1, currentIndex() + 1));
  else if (e.key === 'PageUp') goTo(Math.max(0, currentIndex() - 1));
});

// ---------- Größe der Zeichenfläche ----------
// ResizeObserver meldet sich, wenn sich die Größe ändert (z. B. Tablet drehen)
view.setContentHeight(doc.height + END_SPACE);
let markSized;
const firstSize = new Promise((resolve) => (markSized = resolve));
new ResizeObserver(() => {
  if (!stage.clientWidth || !stage.clientHeight) return;
  view.setSize(stage.clientWidth, stage.clientHeight);
  renderer.resize(stage.clientWidth, stage.clientHeight);
  input.updateRect();
  afterViewChange();
  markSized();
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

// ---------- Scroll-Sperre ----------
// Schloss oben rechts: kein Zoomen, kein seitliches Verrutschen, senkrecht erst nach deutlichem Wisch
const lockButton = document.getElementById('btn-lock');
let viewLocked = readSetting('scrollLock', 'off') === 'on';
function applyLock() {
  lockButton.classList.toggle('active', viewLocked);
  lockButton.classList.toggle('locked', viewLocked);
  lockButton.setAttribute('aria-pressed', String(viewLocked));
  lockButton.title = viewLocked ? 'Scroll-Sperre an (antippen zum Lösen)' : 'Scroll-Sperre';
}
lockButton.addEventListener('click', () => {
  viewLocked = !viewLocked;
  saveSetting('scrollLock', viewLocked ? 'on' : 'off');
  applyLock();
  stopScrollAnimation();
  toast(viewLocked ? 'Scroll-Sperre an: kein Zoomen, nichts verrutscht' : 'Scroll-Sperre aus');
});
applyLock();

// ======================================================================
// Speichern (Etappe 4)
// ======================================================================
//
// Jede Änderung (Strich, Radieren, Seite, Vorlage, Rückgängig …) meldet sich bei markDirty().
// Kurz danach (SAVE_DELAY) speichern wir genau die geänderten Seiten in IndexedDB (store.js).
// Wird die App weggewischt oder vom System neu gestartet, speichern wir sofort.
// Dazu merken wir uns laufend, welche Notiz offen ist und wohin du gescrollt hast ("Sitzung").
// So geht es nach einem Neustart genau dort weiter, wo du warst.

const SAVE_DELAY = 300;     // ms nach der letzten Änderung
const THUMB_EVERY = 2500;   // Vorschaubild höchstens so oft neu malen (ms)
const THUMB_WIDTH = 360;    // Breite des Vorschaubilds (Pixel)

let note = null;                 // die offene Notiz (Titel, Ordner, Seitenliste …)
let savedPageIds = new Set();    // welche Seiten liegen schon im Speicher?
const dirtyPages = new Set();    // welche Seiten haben sich seit dem Speichern geändert?
let noteDirty = false;           // Titel/Seitenreihenfolge geändert?
let thumbDirty = false;          // Vorschaubild veraltet?
let saveTimer = 0;
let thumbTimer = 0;
let lastThumbAt = 0;
let saveChain = Promise.resolve();

const titleButton = document.getElementById('note-title');
const titleText = titleButton.querySelector('.nt-text');
const saveStateEl = titleButton.querySelector('.nt-state');
let saveStateTimer = 0;

function setSaveState(state) {
  clearTimeout(saveStateTimer);
  saveStateEl.dataset.state = state;
  saveStateEl.textContent = { saving: 'Speichert …', saved: 'Gespeichert', error: 'Nicht gespeichert!' }[state] || '';
  if (state === 'saved') saveStateTimer = setTimeout(() => (saveStateEl.dataset.state = 'idle'), 1600);
}

function markDirty(list, structure = false) {
  if (!note) return;
  for (const page of list) dirtyPages.add(page);
  if (structure) noteDirty = true;
  if (structure || list.includes(doc.pages[0])) thumbDirty = true;
  if (note.fresh) {
    delete note.fresh; // jetzt steht etwas drin -> beim Schließen nicht mehr wegräumen
    noteDirty = true;
  }
  setSaveState('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(), SAVE_DELAY);
}

// Speichern anstoßen. Mehrere Aufrufe laufen nacheinander, nie gleichzeitig.
function saveNow({ thumbs = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = 0;
  saveChain = saveChain
    .then(() => writeNote(thumbs))
    .catch((err) => {
      console.error('Speichern fehlgeschlagen', err);
      setSaveState('error');
      toast('Speichern hat nicht geklappt – Speicher voll?');
    });
  return saveChain;
}

async function writeNote(forceThumbs) {
  const target = note;
  if (!target) return;
  const content = dirtyPages.size > 0 || noteDirty;
  const thumbsNow = thumbDirty && (forceThumbs || performance.now() - lastThumbAt > THUMB_EVERY);
  if (!content && !thumbsNow) {
    if (!saveTimer) setSaveState(thumbDirty ? 'saving' : 'saved');
    if (thumbDirty) scheduleThumb();
    return;
  }

  // Jetzt sofort (ohne zu warten) festhalten, was gespeichert wird – danach darf weitergeschrieben werden
  const ids = doc.pages.map((p) => p.id);
  const toPut = doc.pages.filter((p) => dirtyPages.has(p) || !savedPageIds.has(p.id)).map((p) => store.packPage(p, target.id));
  const removed = [...savedPageIds].filter((id) => !ids.includes(id));
  dirtyPages.clear();
  noteDirty = false;
  if (content) {
    target.updated = Date.now();
    target.pageIds = ids;
    target.pageCount = ids.length;
    target.firstTemplate = { ...doc.pages[0].template };
    target.thumbStale = thumbDirty; // merken, falls die App vor dem nächsten Vorschaubild beendet wird
  }
  let thumbs = null;
  if (thumbsNow) {
    thumbDirty = false;
    lastThumbAt = performance.now();
    thumbs = makeThumbs(); // malt sofort, wartet nur noch auf die fertigen Bilddateien
  } else if (thumbDirty) scheduleThumb();

  if (thumbs) Object.assign(target, await thumbs, { thumbAt: Date.now(), thumbStale: false });
  await store.saveNote(target, toPut, removed);
  for (const id of removed) savedPageIds.delete(id);
  for (const p of toPut) savedPageIds.add(p.id);
  if (note === target && !saveTimer && !dirtyPages.size) setSaveState('saved');
}

function scheduleThumb() {
  if (thumbTimer) return;
  thumbTimer = setTimeout(() => {
    thumbTimer = 0;
    saveNow({ thumbs: true });
  }, THUMB_EVERY);
}

// Vorschaubild der ersten Seite – einmal mit hellem und einmal mit dunklem Blatt
function makeThumbs() {
  const page = doc.pages[0];
  const saved = { ...inkTheme };
  const canvases = [false, true].map((dark) => {
    const c = document.createElement('canvas');
    setInkTheme(dark, paperColor(page.template.paper, dark));
    drawThumbnail(c, page.template, { dark, faint: true, strokes: page.strokes, fill: thumbStroke, width: THUMB_WIDTH });
    return c;
  });
  setInkTheme(saved.dark, saved.paper);
  const blob = (c) =>
    new Promise((resolve) => c.toBlob((b) => (b && b.type === 'image/webp' ? resolve(b) : c.toBlob(resolve, 'image/png')), 'image/webp', 0.86));
  return Promise.all(canvases.map(blob)).then(([thumbLight, thumbDark]) => ({ thumbLight, thumbDark }));
}

// Im kleinen Vorschaubild wären dünne Striche kaum zu sehen: mit feinem Rand etwas kräftiger malen
function thumbStroke(ctx, stroke) {
  fillStroke(ctx, stroke);
  if (stroke.tool === 'highlighter' || !stroke.layers) return;
  ctx.save();
  ctx.strokeStyle = displayColor(stroke.color);
  ctx.lineWidth = 0.7 / ctx.getTransform().a; // etwa 0,7 Pixel im Vorschaubild
  ctx.lineJoin = 'round';
  for (const layer of stroke.layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.stroke(layer.path);
  }
  ctx.restore();
}

// ---------- Sitzung: offene Notiz und Ansicht merken ----------
let sessionTimer = 0;

function captureView() {
  const [left, top] = view.toPage(0, 0);
  return { left, top, zoom: view.scale / view.fitScale };
}

function restoreView(v) {
  if (!v || !Number.isFinite(v.top) || !Number.isFinite(v.zoom)) return false;
  view.scale = Math.min(6, Math.max(0.12, v.zoom * view.fitScale));
  view.x = -v.left * view.scale;
  view.y = -v.top * view.scale;
  view.clamp();
  return true;
}

function saveSession() {
  clearTimeout(sessionTimer);
  sessionTimer = 0;
  saveJSON('session', note ? { screen: 'note', noteId: note.id, view: captureView(), at: Date.now() } : { screen: 'home' });
}

function scheduleSession() {
  if (!note || sessionTimer) return;
  sessionTimer = setTimeout(saveSession, 400);
}

// App geht in den Hintergrund oder wird beendet/neu gestartet -> sofort alles sichern
function flushAll() {
  saveSession();
  if (note) saveNow({ thumbs: thumbDirty });
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushAll();
});
window.addEventListener('pagehide', flushAll);

// ---------- Notizen öffnen, anlegen, schließen ----------

function showTitle() {
  titleText.textContent = note?.title || 'Ohne Titel';
  document.title = note ? `${note.title || 'Ohne Titel'} – Federleicht` : 'Federleicht';
}

async function openNote(id, savedView = null) {
  await leaveNote();
  const meta = await store.getNote(id);
  if (!meta || meta.deletedAt) return false;
  const loaded = (await store.getPages(meta.pageIds || [])).map(store.unpackPage);

  stopScrollAnimation();
  toolbar.closePopup();
  pages.closeAll();
  current = null;
  erasing = null;
  note = meta;
  doc.load(loaded.length ? loaded : [createPage(meta.firstTemplate || DEFAULT_TEMPLATE)]);
  savedPageIds = new Set(loaded.map((p) => p.id));
  dirtyPages.clear();
  noteDirty = !loaded.length;
  // Vorschaubild fehlt oder ist veraltet (App wurde beendet, bevor es fertig war) -> gleich neu malen
  thumbDirty = !meta.thumbLight || Boolean(meta.thumbStale);
  nextZ = 1;
  for (const p of doc.pages) for (const st of p.strokes) nextZ = Math.max(nextZ, st.z + 1);
  history.clear();

  // Ansicht: wie beim letzten Mal, sonst Seite 1 in voller Breite
  view.setContentHeight(doc.height + END_SPACE);
  if (!restoreView(savedView)) {
    view.fitToWidth();
    view.y = view.yFor(0);
    view.clamp();
  }
  showTitle();
  setSaveState('idle');
  home.hide();
  pagesChanged();
  renderer.renderNow();
  saveSession();
  if (noteDirty || thumbDirty) saveNow({ thumbs: true });
  return true;
}

// Neue Notiz (im gerade offenen Ordner) anlegen und gleich öffnen
async function createNote(folderId = null) {
  const tpl = loadJSON('pageTemplate', DEFAULT_TEMPLATE);
  const page = createPage(tpl);
  const now = Date.now();
  const meta = {
    id: store.uid(),
    title: defaultTitle(),
    folderId,
    created: now,
    updated: now,
    favorite: false,
    deletedAt: null,
    pageIds: [page.id],
    pageCount: 1,
    firstTemplate: { ...tpl },
    fresh: true, // noch nie etwas hineingeschrieben (leere Notizen räumen wir beim Schließen weg)
  };
  await store.saveNote(meta, [store.packPage(page, meta.id)]);
  await openNote(meta.id);
}

function defaultTitle() {
  const d = new Date();
  return `Notiz vom ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

// Notiz zumachen: alles speichern. Eine neue, leer gebliebene Notiz wird wieder gelöscht.
async function leaveNote() {
  if (!note) return;
  textEditor.finish();
  if (current) app.endStroke();
  if (erasing) app.endErase();
  const leaving = note;
  await saveNow({ thumbs: true });
  if (leaving.fresh && doc.pages.every((p) => p.strokes.length === 0)) {
    await store.deleteNoteForever(leaving);
  }
  note = null;
  history.clear();
}

async function goHome() {
  await leaveNote();
  showTitle();
  saveSession();
  await home.show();
}

home = setupHome({
  openNote: (id) => openNote(id),
  createNote,
  darkPaper: () => renderer.darkPaper,
});

document.getElementById('btn-home').addEventListener('click', goHome);

titleButton.addEventListener('click', async () => {
  if (!note) return;
  const text = await askText({ title: 'Notiz umbenennen', value: note.title || '', placeholder: 'Titel' });
  if (!text || !note) return;
  note.title = text;
  showTitle();
  markDirty([], true);
});

// ---------- Start ----------
// Erst wenn die Zeichenfläche ihre Größe kennt, die letzte Sitzung wiederherstellen
async function boot() {
  await firstSize;
  const session = loadJSON('session', {});
  let opened = false;
  try {
    await store.openDB();
    if (session.screen === 'note' && session.noteId) opened = await openNote(session.noteId, session.view);
    if (!opened) await home.show();
  } catch (err) {
    console.error(err);
    toast('Der Speicher lässt sich nicht öffnen – Notizen werden nicht gespeichert!');
  }
  document.documentElement.classList.remove('booting');
}
boot();

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
