// main.js – der Startpunkt: hier wird alles zusammengesteckt
import './style.css';
import './paint.js'; // Farbflächen auf Canvas (gegen den Dunkelmodus von Samsung Internet)
import { View, PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { NoteDocument, createPage, END_SPACE } from './document.js';
import { DEFAULT_TEMPLATE, drawThumbnail, paperColor } from './templates.js';
import { setupPages } from './pages.js';
import { Renderer } from './renderer.js';
import { createStroke, buildPath, finishStroke, fillStroke, strokeHit, cutStroke, inkTheme, setInkTheme, displayColor } from './ink.js';
import { setupInput } from './input.js';
import { HoldDetector, averagePressure, longEnough } from './straighten.js';
import { History } from './history.js';
import { LiftTracker } from './lift.js';
import { Steadier } from './steady.js';
import { setupTextEditor } from './texteditor.js';
import { loadFonts, onFontsChanged, updateTextBox } from './text.js';
import { loadTools, saveTools, activeStyle, settingsOf } from './tools.js';
import { setupToolbar } from './toolbar.js';
import { setupWheel } from './wheel.js';
import * as store from './store.js';
import { setupHome } from './home.js';
import { askText, toast, progressBox, chooseAction } from './dialog.js';
import { setupLasso } from './lasso.js';
import { recognizeShape, shapeFromDrag, densify, transformShape, FILL_MODES, fillable, fitsShape } from './shapes.js';
import { prepareImage, createImageItem, placeMatrix, remember, canvasBlob, onMediaLoaded, ensureLoaded, imageIdsOf, fileIdsOf, mediaSettings, pageDark } from './media.js';
import { importPdf, scheduleSharp } from './pdfdoc.js';
import { exportPdf, exportImage, renderPage, fileName, canShareFile, shareFile, downloadFile } from './export.js';
import { setupMediaMenu } from './mediamenu.js';
import { setupClaudeMenu } from './claudemenu.js';
import { computeFill, createFill } from './fill.js';
import { openImageEditor } from './imageeditor.js';
import { setupLaser } from './laser.js';
import { setupToolbarConfig } from './toolbarconfig.js';
import { setupMoreMenu } from './moremenu.js';
import { openOptions, closeOptions, optionsOpen } from './optionspopup.js';
import { setupAreaPick } from './areapick.js';
import { setupRuler } from './ruler.js';
import * as lock from './lock.js';
import { setupAssist } from './assist.js';
import { convertHandwriting } from './convert.js';
import { setupAudio } from './audio.js';
import { setupMathHelp, MATH_ICON } from './mathhelp.js';

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
const laser = setupLaser({ stage, view, tools }); // Laserpointer (siehe laser.js)
const areaPick = setupAreaPick({ stage, view, doc }); // Bereich wählen (Zu Text, Mathe-Hilfe)
const ruler = setupRuler({ stage, view, onChange: () => applyRulerButton() }); // Lineal und Geodreieck
// Sprachaufnahme mit Schrift-Sync (siehe audio.js)
const audio = setupAudio({
  stage,
  doc,
  view,
  renderer,
  getNote: () => note,
  onChanged(contentChanged) {
    if (contentChanged) markDirty([], true);
    applyRecordButton();
  },
  scrollToStroke(pageIndex, s) {
    // Nur scrollen, wenn der Strich gerade nicht (ganz) zu sehen ist
    const top = doc.top(pageIndex);
    const [, y0] = view.toScreen(s.box.minX, s.box.minY + top);
    const [, y1] = view.toScreen(s.box.maxX, s.box.maxY + top);
    if (y0 > 70 && y1 < view.height - 90) return;
    animateViewY(view.height * 0.4 - (top + (s.box.minY + s.box.maxY) / 2) * view.scale);
  },
});

let current = null;      // der Strich, der gerade geschrieben wird
let currentPage = null;  // ... auf dieser Seite
let currentTop = 0;      // Oberkante dieser Seite (Dokument-Koordinaten)
let lastErase = null;    // letzte Radierer-Position
let erasing = null;      // was beim aktuellen Radieren passiert ist: Seite -> { added: [], removed: [] }
let pages = null;        // Seiten-Menüs (siehe pages.js), wird weiter unten eingerichtet
let nextZ = 1;           // z-Nummer für den nächsten neuen Strich (höher = weiter oben)
let textEditor = null;   // Textfelder bearbeiten (siehe texteditor.js), wird weiter unten eingerichtet
let home = null;         // Startbildschirm (siehe home.js), wird weiter unten eingerichtet
let lasso = null;        // Lasso-Auswahl (siehe lasso.js), wird weiter unten eingerichtet
let shapeDrag = null;    // Formen-Werkzeug: Form wird gerade aufgezogen { start, end }
let swallowPen = false;  // dieser Stift-Strich hebt nur eine Auswahl auf (z. B. ein eingefügtes Bild) – nichts malen
let mediaMenu = null;    // Menüs "Einfügen" und "Teilen" (siehe mediamenu.js)
let claudeMenu = null;   // Claude-Knopf (siehe claudemenu.js)
let assist = null;       // Handschrifthilfe (siehe assist.js), wird weiter unten eingerichtet
let lasering = false;
let moreMenu = null;     // ⋮-Menü oben rechts (siehe moremenu.js)
let picking = false;     // Stift zieht gerade einen Rahmen (Bereich wählen, siehe areapick.js)    // Laserpointer: Stift liegt gerade auf (siehe laser.js)

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
// Glättet langsame Bewegungen, damit die Linie nicht zittert (siehe steady.js)
const steady = new Steadier();

// ---------- Was die App tun kann ----------
// input.js ruft diese Funktionen auf, je nachdem was Stift und Finger machen.
const app = {
  view,

  startStroke(point, pointerType) {
    liftedPointer = null;
    swallowPen = false;
    // Bereich wählen: der Stift zieht einen Rahmen statt zu zeichnen
    if (areaPick.active) {
      picking = true;
      return areaPick.down(point);
    }
    // Laserpointer: leuchtende Spur, die nicht gespeichert wird
    if (tools.tool === 'laser') {
      lasering = true;
      return laser.down(point);
    }
    // Etwas ausgewählt (z. B. gerade eingefügtes Bild) und daneben getippt: nur die Auswahl aufheben
    if (tools.tool !== 'lasso' && lasso.active) {
      lasso.clear();
      swallowPen = true;
      return;
    }
    // Lasso: statt zu zeichnen eine Auswahl-Schlinge ziehen (siehe lasso.js)
    if (tools.tool === 'lasso') return lasso.penDown(point);
    // Aufnahme wird abgespielt: Strich antippen springt zu der Stelle im Ton
    if (audio.playing && (tools.tool === 'pen' || tools.tool === 'highlighter')) {
      const i = doc.indexAt(point[1]);
      if (audio.tapSeek(doc.pages[i], [point[0], point[1] - doc.top(i)])) {
        swallowPen = true;
        return;
      }
    }
    // Der Strich gehört zu der Seite, auf der er anfängt (in der Lücke: die nähere)
    const index = doc.indexAt(point[1]);
    currentPage = doc.pages[index];
    currentTop = doc.top(index);
    if (tools.tool === 'shape') return beginShapeDrag(toLocal(point));
    if (tools.tool === 'fill') {
      // Farbeimer: Antippen füllt, der Rest dieser Berührung wird ignoriert
      swallowPen = true;
      fillAt(currentPage, toLocal(point));
      return;
    }
    beginStroke(toLocal(point), pointerType);
  },

  extendStroke(points, predicted) {
    if (points.length === 0 || swallowPen) return;
    if (picking) return areaPick.move(points[points.length - 1]);
    if (lasering) return laser.move(points);
    if (tools.tool === 'lasso') return lasso.penMove(points);
    if (shapeDrag) return updateShapeDrag(toLocal(points[points.length - 1]));
    points = points.map(toLocal);
    predicted = predicted.map(toLocal);

    // Nach einem erkannten Abheben: erst wieder richtig aufdrücken, dann neuer Strich
    if (!current) {
      if (!liftedPointer) return;
      const first = points.findIndex((p) => lift.isRetouch(p[2]));
      if (first < 0) return;
      beginStroke(points[first], liftedPointer);
      liftedPointer = null;
      points = points.slice(first + 1);
      if (points.length === 0) return drawCurrentStroke(predicted);
    }
    const last = points[points.length - 1];

    // Am Lineal: die Linie folgt dem Stift, aber immer genau an der Kante
    if (current.ruled) {
      const { snap, a, pressure } = current.ruled;
      const b = ruler.project(snap, toDoc(last));
      current.points = densify([toLocal(a), toLocal(b)], false, pressure, 2.5);
      ruler.showMeasure(a, b);
      drawCurrentStroke([]);
      return;
    }

    // Schon zur Form geworden? Dann folgt die Form dem Stift (Linie: das Ende; Kreis, Rechteck …:
    // größer/kleiner und drehen, solange die Spitze unten bleibt)
    if (current.straight) {
      applyShapeFit(last);
      drawCurrentStroke([]);
      return;
    }

    if (current.simulatePressure) {
      for (const raw of points) {
        const p = steady.add(raw, view.scale);
        if (p) current.points.push(p);
      }
    } else {
      // Echter Stift: jeden Punkt auf "eigentlich schon abgehoben" prüfen (siehe lift.js)
      for (let k = 0; k < points.length; k++) {
        const p = steady.add(points[k], view.scale);
        if (!p) continue; // noch zu nah am letzten Punkt (langsames Schreiben)
        current.points.push(inkPoint(p));
        const verdict = lift.add(p, current.points.length - 1, view.scale);
        if (verdict?.trimStart) {
          current.points.splice(0, verdict.trimStart);
        } else if (verdict?.cut !== undefined) {
          // Stift ist abgesetzt, liegt aber noch leicht auf: Strich hier beenden
          current.points.length = Math.max(1, verdict.cut);
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
    drawCurrentStroke(steady.predicted(predicted, view.scale));
  },

  endStroke() {
    liftedPointer = null;
    if (picking) {
      picking = false;
      return areaPick.up();
    }
    if (lasering) {
      lasering = false;
      return laser.up();
    }
    if (swallowPen) {
      swallowPen = false;
      return;
    }
    if (tools.tool === 'lasso') return lasso.penUp();
    if (shapeDrag) return finishShapeDrag();
    if (current && !current.straight) {
      // Der Strich endet genau dort, wo der Stift war (die Glättung hängt minimal hinterher)
      const end = steady.finish(view.scale);
      if (end) {
        if (current.simulatePressure) current.points.push(end);
        else {
          current.points.push(inkPoint(end));
          lift.add(end, current.points.length - 1, view.scale);
        }
      }
    }
    if (current && !current.simulatePressure && !current.straight) {
      // Leichte Punkte ganz am Ende (beim Abheben) weglassen -> kein Haken
      current.points.length = Math.max(1, lift.keepAtEnd(current.points.length));
    }
    finishCurrentStroke();
  },

  startErase(point) {
    lasso?.clear();
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

  // Stift schwebt über dem Blatt (Bildschirm-Position, null = weg): beim Laserpointer zeigt ein Punkt, wohin du zeigst
  penHover(pos) {
    if (tools.tool === 'laser' || !pos) laser.hover(tools.tool === 'laser' ? pos : null);
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

  // ---------- Lineal / Geodreieck (siehe ruler.js) ----------
  rulerHit(sx, sy) {
    return ruler.hitScreen(sx, sy);
  },
  // Finger auf dem Lineal: verschieben (Bildschirm-Pixel) und drehen (um den Finger-Mittelpunkt)
  rulerGesture(dx, dy, dAngle, cx, cy) {
    ruler.moveBy(dx / view.scale, dy / view.scale);
    if (dAngle) {
      const [px, py] = view.toPage(cx, cy);
      ruler.rotateBy(dAngle, px, py);
    }
  },
  rulerGestureEnd() {
    ruler.gestureEnd();
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
  assist?.strokeStarted(currentPage, point);
  current.recStart = audio.stamp(); // läuft eine Aufnahme? Dann merkt sich der Strich die Zeit
  // Am Lineal angesetzt? Dann läuft der Strich als gerade Linie an der Kante entlang
  const snap = ruler.on ? ruler.snapStart(toDoc(point), style.size) : null;
  if (snap) {
    const a = ruler.project(snap, toDoc(point));
    current.ruled = { snap, a, pressure: current.simulatePressure ? 0.5 : Math.max(0.45, point[2]) };
    current.straight = true;
    current.shape = 'line';
    current.points = densify([toLocal(a), toLocal(a)], false, current.ruled.pressure, 2.5);
    drawCurrentStroke([]);
    return;
  }
  lift.reset();
  steady.reset(point);
  current.points.push(inkPoint(point));
  if (!current.simulatePressure) lift.add(point, 0, view.scale);
  if (tools.straighten) hold.moved(point, view.scale);
  drawCurrentStroke([]);
}

// Den laufenden Strich abschließen und auf die Seite legen
function finishCurrentStroke() {
  hold.stop();
  if (!current) return;
  if (current.ruled) {
    ruler.showMeasure(null);
    delete current.ruled;
  }
  if (!current.simulatePressure) lift.learn();
  if (current.recStart) {
    const end = audio.stamp();
    if (end && end.id === current.recStart.id) current.rec = [end.id, current.recStart.t, Math.max(current.recStart.t, end.t)];
  }
  delete current.recStart;
  finishStroke(current);
  if (current.box && doc.pages.includes(currentPage)) {
    currentPage.strokes.push(current); // hat das höchste z, gehört also ans Ende
    renderer.commitStroke(current, doc.pages.indexOf(currentPage));
    history.push({ strokes: [{ page: currentPage, added: [current], removed: [] }] });
    pages.strokesChanged();
    markDirty([currentPage]);
    assist?.strokeAdded(currentPage, current);
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

// Wird vom HoldDetector aufgerufen, wenn der Stift lange genug stillstand:
// Aus dem Strich wird eine perfekte Form (siehe shapes.js) – oder wie bisher eine gerade Linie.
function straightenCurrentStroke() {
  if (!current || current.straight) return;
  const start = current.points[0];
  const end = current.points[current.points.length - 1];
  // Textmarker: nur gerade Linien (zum Unterstreichen und Markieren)
  const shape = recognizeShape(current.points, { onlyLine: current.tool === 'highlighter' });
  if (!shape) return;
  // Schrift bleibt Schrift: kurzes Stehenbleiben mitten im Wort macht keine Form daraus
  if (!fitsShape(current.points, shape)) return;
  if (shape.kind === 'line' && !longEnough(start, end, view.scale)) return;
  if (shape.closed) {
    const b = shape.pts.reduce((m, p) => Math.max(m, Math.hypot(p[0] - shape.pivot[0], p[1] - shape.pivot[1])), 0);
    if (b * 2 * view.scale < 24) return; // zu klein (z. B. ein "o" beim Schreiben)
  }

  current.straight = true;
  current.shape = shape.kind;
  current.linePressure = averagePressure(current.points);
  current.fit = { shape, ref: [end[0], end[1]] };
  applyShapeFit(end);
  drawCurrentStroke([]);
  navigator.vibrate?.(12); // kurzes Ruckeln als Rückmeldung (falls das Gerät es kann)
}

// Die erkannte Form an die Stiftposition anpassen.
// Linie: Das Ende folgt dem Stift. Andere Formen: so vergrößern und drehen, dass die Stelle,
// an der du stillgehalten hast, dem Stift folgt (Drehpunkt: Mitte bzw. Anfang der Form).
function applyShapeFit(pen) {
  const { shape, ref } = current.fit;
  let pts = shape.pts;
  if (shape.kind === 'line') {
    pts = [shape.pts[0], [pen[0], pen[1]]];
  } else {
    const pivot = shape.pivot;
    const v0 = [ref[0] - pivot[0], ref[1] - pivot[1]];
    const v1 = [pen[0] - pivot[0], pen[1] - pivot[1]];
    const l0 = Math.hypot(v0[0], v0[1]);
    if (l0 * view.scale > 8) {
      let factor = Math.hypot(v1[0], v1[1]) / l0;
      let angle = Math.atan2(v1[1], v1[0]) - Math.atan2(v0[1], v0[0]);
      angle = Math.atan2(Math.sin(angle), Math.cos(angle));
      if (Math.abs(angle) < 0.05 || shape.kind === 'circle') angle = 0; // kleines Zittern nicht drehen
      if (Math.abs(factor - 1) < 0.03) factor = 1;
      factor = Math.max(0.1, factor);
      if (factor !== 1 || angle !== 0) pts = transformShape(shape, pivot, factor, angle);
    }
  }
  current.points = densify(pts, shape.closed, current.linePressure, 2.5, shape.smooth);
}

// ---------- Formen-Werkzeug: Form aufziehen ----------
function beginShapeDrag(p) {
  hold.stop();
  shapeDrag = { start: [p[0], p[1]], end: [p[0], p[1]] };
}

// Die Striche der Form, wie sie gerade aufgezogen ist (meist einer, beim Koordinatensystem mehrere)
function shapeStrokes(drag) {
  const st = tools.shape;
  const fill = FILL_MODES.find((f) => f.id === st.fill) || FILL_MODES[0];
  return shapeFromDrag(st.kind, drag.start, drag.end, st.size).map((poly) => {
    const filled = poly.closed && fillable(st.kind) && fill.alpha > 0;
    const stroke = createStroke({
      tool: 'pen',
      penType: 'ballpoint',
      color: st.color,
      size: st.size,
      simulatePressure: false,
      shape: st.kind,
      fill: filled ? st.color : null,
      fillAlpha: filled ? fill.alpha : 0,
    });
    stroke.points = densify(poly.pts, poly.closed, 0.5, 2.5, poly.smooth);
    return finishStroke(stroke);
  });
}

function updateShapeDrag(p) {
  shapeDrag.end = [p[0], p[1]];
  const strokes = shapeStrokes(shapeDrag);
  const box = strokes.reduce((acc, s) => (s.box ? unionBox(acc, s.box) : acc), null);
  if (!box) return renderer.setOverlay(null);
  const [x0, y0] = view.toScreen(box.minX, box.minY + currentTop);
  const [x1, y1] = view.toScreen(box.maxX, box.maxY + currentTop);
  const index = doc.pages.indexOf(currentPage);
  renderer.setOverlay({
    box: { minX: x0, minY: y0, maxX: x1, maxY: y1 },
    draw(ctx, rend) {
      rend.enterPage(ctx, index);
      for (const s of strokes) fillStroke(ctx, s);
    },
  });
}

function finishShapeDrag() {
  const drag = shapeDrag;
  shapeDrag = null;
  const length = Math.hypot(drag.end[0] - drag.start[0], drag.end[1] - drag.start[1]) * view.scale;
  if (length < 12 || !doc.pages.includes(currentPage)) {
    renderer.setOverlay(null);
    if (length < 12) toast('Zum Zeichnen die Form mit dem Stift aufziehen');
    return;
  }
  const strokes = shapeStrokes(drag);
  for (const s of strokes) s.z = nextZ++;
  currentPage.strokes.push(...strokes); // höchstes z -> ans Ende
  renderer.setOverlay(null);
  renderer.renderNow();
  history.push({ strokes: [{ page: currentPage, added: strokes, removed: [] }] });
  pages.strokesChanged();
  markDirty([currentPage]);
}

// ---------- Farbeimer (siehe fill.js) ----------
function fillAt(page, [x, y]) {
  if (!doc.pages.includes(page)) return;
  let result;
  try {
    result = computeFill(page, x, y, view.scale);
  } catch (err) {
    console.warn('Füllen fehlgeschlagen', err);
    toast('Füllen hat nicht geklappt');
    return;
  }
  if (result.error === 'outside') return;
  if (result.error) {
    toast('Tippe in eine Fläche, nicht auf eine Linie');
    return;
  }
  const { color, alpha } = tools.fill;
  // Liegt hier schon eine Füllung derselben Fläche? Dann wird sie ersetzt (neue Farbe)
  const fresh = createFill({ color, alpha, rings: result.rings, z: 0 });
  const b = fresh.box;
  const same = (s) =>
    s.tool === 'fill' && s.box && fillContainsPoint(s, x, y) &&
    Math.abs(s.box.minX - b.minX) < 4 && Math.abs(s.box.maxX - b.maxX) < 4 && Math.abs(s.box.minY - b.minY) < 4 && Math.abs(s.box.maxY - b.maxY) < 4;
  const removed = page.strokes.filter(same);
  // Reihenfolge: UNTER die Striche, die die Fläche umgeben, aber über Bilder und ältere Füllungen
  const overlaps = (s) => s.box && s.box.maxX >= b.minX && s.box.minX <= b.maxX && s.box.maxY >= b.minY && s.box.minY <= b.maxY;
  const near = page.strokes.filter((s) => overlaps(s) && !removed.includes(s));
  const inkZ = near.filter((s) => s.tool !== 'fill' && s.tool !== 'image').map((s) => s.z);
  const lowZ = near.filter((s) => s.tool === 'fill' || s.tool === 'image').map((s) => s.z);
  if (!inkZ.length) fresh.z = nextZ++;
  else {
    const top = Math.min(...inkZ);
    const below = lowZ.filter((z) => z < top);
    fresh.z = below.length ? (Math.max(...below) + top) / 2 : top - 0.5;
  }
  commitChanges([{ page, added: [fresh], removed }]);
  navigator.vibrate?.(6);
  if (result.whole) toast('Die Fläche war nicht geschlossen – fast die ganze Seite wurde gefüllt', { label: 'Rückgängig', run: undo });
}

function fillContainsPoint(s, x, y) {
  return strokeHit(s, x, y, 0);
}

// Änderungen vom Lasso übernehmen: Striche ersetzen, als EIN Schritt rückgängig machbar, speichern
function commitChanges(changes) {
  for (const c of changes) {
    removeStrokes(c.page.strokes, c.removed);
    insertStrokes(c.page.strokes, c.added);
  }
  history.push({ strokes: changes });
  renderer.requestRender();
  pages.strokesChanged();
  markDirty([...new Set(changes.map((c) => c.page))]);
}

// Radieren an Stelle (x, y):
//   Modus "Strich löschen":  jeder berührte Strich verschwindet ganz
//   Modus "Bereich löschen": nur das Stück unter dem Radierer verschwindet (cutStroke)
function eraseAt(x, y) {
  const r = tools.eraser.size / view.scale; // Bildschirm-Pixel -> Seiten-Einheiten
  let area = null; // Bereich, in dem sich etwas geändert hat (Dokument-Koordinaten)
  const [first, last] = doc.range(y - r, y + r);
  // Erst Striche, Texte usw. – eine Füllung nur, wenn an dieser Stelle sonst nichts ist
  // (sonst wäre beim Radieren einer Linie in einer bunten Fläche gleich die ganze Farbe weg)
  for (const fillPass of [false, true]) {
  if (fillPass && area) break;
  for (let p = first; p <= last; p++) {
    const page = doc.pages[p];
    const top = doc.top(p);
    const ly = y - top; // Höhe auf dieser Seite
    if (ly < -r || ly > PAGE_HEIGHT + r) continue;
    const strokes = page.strokes;
    for (let i = strokes.length - 1; i >= 0; i--) {
      const stroke = strokes[i];
      if (tools.eraser.onlyHighlighter && stroke.tool !== 'highlighter') continue;
      if ((stroke.tool === 'fill') !== fillPass) continue;
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
  if (current || erasing || shapeDrag) return; // nicht mitten im Schreiben
  lasso.clear();
  assist.reset(); // nach Rückgängig nichts mehr automatisch geraderücken
  const action = history.undo();
  if (action) applyAction(action, false);
}

function redo() {
  if (textEditor?.active) return textEditor.undo(true);
  if (current || erasing || shapeDrag) return;
  lasso.clear();
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
  lasso.clear();
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
  if (original.bg) copy.bg = { ...original.bg }; // PDF-Hintergrund gehört dazu
  // Striche kopieren (die fertigen Formen darin ändern sich nie, die dürfen beide Seiten teilen)
  copy.strokes = original.strokes.map((s) => ({ ...s, z: nextZ++ }));
  changePages((list) => list.splice(i + 1, 0, copy));
}

function movePage(from, to) {
  changePages((list) => list.splice(to, 0, ...list.splice(from, 1)));
}

function setTemplate(indices, tpl) {
  // "Alle Seiten": PDF-Seiten behalten ihr leeres Blatt (sonst lägen Linien über dem Arbeitsblatt)
  if (indices.length > 1) indices = indices.filter((i) => !doc.pages[i].bg);
  if (!indices.length) return;
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

// Sanft zu einer Höhe scrollen (z. B. beim Abspielen einer Aufnahme der Schrift folgen)
function animateViewY(y) {
  if (current || viewLocked) return;
  stopScrollAnimation();
  const from = view.y;
  const saved = view.y;
  view.y = y;
  view.clamp();
  const target = view.y;
  view.y = saved;
  if (Math.abs(target - from) < 1) return;
  const start = performance.now();
  scrolling = true;
  const step = (now) => {
    const t = Math.min(1, (now - start) / 420);
    view.y = from + (target - from) * (1 - Math.pow(1 - t, 3));
    view.clamp();
    afterViewChange();
    if (t < 1) scrollFrame = requestAnimationFrame(step);
    else stopScrollAnimation();
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
  lasso?.place();
  laser.redraw();
  assist?.redraw();
  areaPick.redraw();
  ruler.redraw();
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

// ---------- Lasso (siehe lasso.js) ----------
lasso = setupLasso({
  stage,
  view,
  doc,
  renderer,
  tools,
  commit: commitChanges,
  newZ: () => nextZ++,
  currentIndex,
  toast,
  onEditImage: editImage,
  onConvert: (page, items) => convertInk(page, items),
});


// ======================================================================
// Bilder und PDFs (Etappe 7) – siehe media.js, pdfdoc.js, export.js
// ======================================================================

// Bild fertig geladen -> neu malen (Seite und Seitenübersicht)
onMediaLoaded(() => {
  renderer.requestRender();
  pages.strokesChanged();
});
// Beim Reinzoomen PDF-Seiten gestochen scharf nachmalen
renderer.onBackgrounds = (list) => scheduleSharp(list, () => renderer.requestRender());

mediaMenu = setupMediaMenu({
  insertImages: (files) => insertImages(files),
  insertPdf: (file) => insertPdf(file),
  exportNote: (kind, which) => exportNote(kind, which),
  pageCount: () => doc.count,
  currentPage: () => currentIndex(),
  closeOtherPopups() {
    toolbar.closePopup();
    pages.closePopup();
    claudeMenu?.close();
    moreMenu?.close();
  },
});

// ======================================================================
// Claude fragen – siehe claudemenu.js (Chat läuft im Federleicht-Helfer auf claude.ai)
// ======================================================================
claudeMenu = setupClaudeMenu({
  // Aktuelle Seite als PNG (helles Blatt). ~1200 Pixel breit reicht Claude völlig.
  async pageImage() {
    if (!note) throw new Error('keine Notiz offen');
    textEditor.finish();
    const canvas = await renderPage(doc.pages[currentIndex()], 1.2);
    const blob = await canvasBlob(canvas, 'image/png');
    canvas.width = canvas.height = 0;
    return blob;
  },
  pageLabel() {
    const title = note?.title || 'Notiz';
    return doc.count > 1 ? `${title} (Seite ${currentIndex() + 1})` : title;
  },
  closeOtherPopups() {
    toolbar.closePopup();
    pages.closePopup();
    mediaMenu?.close();
    moreMenu?.close();
  },
});

// Bilder einfügen: mittig in den sichtbaren Teil der aktuellen Seite (oder an Stelle "at" = Dokument-Punkt)
async function insertImages(files, at = null) {
  if (!note) return;
  const images = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i.test(f.name));
  if (!images.length) return toast('Das ist kein Bild');
  textEditor.finish();
  const index = at ? doc.indexAt(at[1]) : currentIndex();
  const page = doc.pages[index];
  const top = doc.top(index);
  // Sichtbarer Teil der Seite (Seiten-Koordinaten)
  const [vx0, vy0] = view.toPage(0, 0);
  const [vx1, vy1] = view.toPage(view.width, view.height);
  const vis = {
    x0: Math.max(0, vx0),
    y0: Math.max(0, vy0 - top),
    x1: Math.min(PAGE_WIDTH, vx1),
    y1: Math.min(PAGE_HEIGHT, vy1 - top),
  };
  if (vis.x1 - vis.x0 < 100 || vis.y1 - vis.y0 < 100) Object.assign(vis, { x0: 0, y0: 0, x1: PAGE_WIDTH, y1: PAGE_HEIGHT });
  let cx = at ? at[0] : (vis.x0 + vis.x1) / 2;
  let cy = at ? at[1] - top : (vis.y0 + vis.y1) / 2;

  const busy = images.length > 1 || images[0].size > 3e6 ? progressBox({ title: 'Bild wird eingefügt …' }) : null;
  busy?.update('Einen Moment', null);
  const added = [];
  try {
    for (const file of images) {
      if (busy?.signal.cancelled) break;
      const img = await prepareImage(file);
      const blobId = store.uid();
      await store.putBlob(blobId, img.blob); // erst die Datei sicher speichern, dann auf die Seite
      remember(blobId, img.bitmap);
      // Größe: höchstens 60 % des Sichtbaren, nie größer als das Bild selbst in Originalgröße
      const maxW = Math.min(PAGE_WIDTH * 0.8, (vis.x1 - vis.x0) * 0.6);
      const maxH = Math.min(PAGE_HEIGHT * 0.8, (vis.y1 - vis.y0) * 0.6);
      const k = Math.min(maxW / img.w, maxH / img.h, 1.6);
      const w = img.w * k;
      const h = img.h * k;
      const x = Math.max(w / 2, Math.min(PAGE_WIDTH - w / 2, cx));
      const y = Math.max(h / 2, Math.min(PAGE_HEIGHT - h / 2, cy));
      added.push(createImageItem({ blobId, iw: img.w, ih: img.h, m: placeMatrix(x, y, w, h), z: nextZ++ }));
      cx += 30; // mehrere Bilder leicht versetzt
      cy += 30;
    }
  } catch (err) {
    console.error(err);
    toast('Das Bild lässt sich nicht öffnen');
  } finally {
    busy?.close();
  }
  if (!added.length || !doc.pages.includes(page)) return;
  commitChanges([{ page, added, removed: [] }]);
  renderer.renderNow();
  lasso.select(page, added); // gleich ausgewählt: verschieben, größer/kleiner, drehen
  toast(added.length === 1 ? 'Bild eingefügt – ziehen zum Verschieben, Ecken für die Größe' : `${added.length} Bilder eingefügt`);
}

// Bild bearbeiten (zuschneiden, drehen, geraderücken, Filter – siehe imageeditor.js)
function editImage(page, item) {
  textEditor.finish();
  openImageEditor({
    item,
    toast,
    async onDone({ canvas, src, reset, center }) {
      if (!doc.pages.includes(page) || !page.strokes.includes(item)) return;
      let blobId = src.blobId;
      let w = src.iw;
      let h = src.ih;
      if (!reset) {
        const blob = await canvasBlob(canvas, 'image/webp', 0.9);
        blobId = store.uid();
        await store.putBlob(blobId, blob);
        w = canvas.width;
        h = canvas.height;
        remember(blobId, window.createImageBitmap ? await createImageBitmap(canvas) : canvas);
      }
      canvas.width = canvas.height = 0;
      // Größe: gleicher Maßstab wie bisher (Seiten-Einheiten pro Bildpunkt), Drehung bleibt
      const m = item.m;
      const lenX = Math.hypot(m[0], m[1]);
      const lenY = Math.hypot(m[2], m[3]);
      const ex = [m[0] / lenX, m[1] / lenX];
      const ey = [m[2] / lenY, m[3] / lenY];
      const k = lenX / item.iw;
      // Mitte: beim ersten Bearbeiten dort, wo der Ausschnitt im alten Bild lag, sonst die alte Mitte
      const c = item.src || reset ? [m[4] + (m[0] + m[2]) / 2, m[5] + (m[1] + m[3]) / 2] : [m[4] + m[0] * center[0] + m[2] * center[1], m[5] + m[1] * center[0] + m[3] * center[1]];
      let pw = w * k;
      let ph = h * k;
      // Nicht größer als die Seite
      const fit = Math.min(1, (PAGE_WIDTH * 0.95) / pw, (PAGE_HEIGHT * 0.95) / ph);
      pw *= fit;
      ph *= fit;
      const nm = [ex[0] * pw, ex[1] * pw, ey[0] * ph, ey[1] * ph, c[0] - (ex[0] * pw + ey[0] * ph) / 2, c[1] - (ex[1] * pw + ey[1] * ph) / 2];
      const fresh = createImageItem({ blobId, iw: w, ih: h, m: nm, z: item.z, src: reset ? null : src });
      commitChanges([{ page, added: [fresh], removed: [item] }]);
      renderer.renderNow();
      lasso.select(page, [fresh]);
      toast(reset ? 'Bild zurückgesetzt' : 'Bild bearbeitet');
    },
  });
}

// PDF einlesen: Fortschritt zeigen, Hintergründe zurückgeben (oder null)
async function readPdf(file) {
  if (!file) return null;
  if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) {
    toast('Das ist keine PDF-Datei');
    return null;
  }
  const busy = progressBox({ title: 'PDF wird geöffnet …', text: file.name });
  busy.update('pdf.js wird geladen …', null);
  try {
    const bgs = await importPdf(file, {
      signal: busy.signal,
      onProgress: (done, total) => busy.update(`Seite ${Math.min(done + 1, total)} von ${total}`, total ? done / total : null),
    });
    if (busy.signal.cancelled) {
      // Abgebrochen: Die Seiten, die schon fertig sind, trotzdem nehmen? Nein – lieber gar nichts.
      return null;
    }
    return bgs;
  } catch (err) {
    console.error(err);
    toast(err?.message || 'Die PDF lässt sich nicht öffnen');
    return null;
  } finally {
    busy.close();
  }
}

// Leere Vorlage für PDF-Seiten: weißes Blatt ohne Linien
const PDF_TEMPLATE = { kind: 'blank', spacing: 'M', paper: 'white' };

function pdfPages(bgs) {
  return bgs.map((bg) => ({ ...createPage(PDF_TEMPLATE), bg }));
}

// PDF in die offene Notiz einfügen (nach der aktuellen Seite). Ist die Notiz noch ganz leer,
// ersetzen die PDF-Seiten die leere Seite.
async function insertPdf(file) {
  if (!note) return;
  textEditor.finish();
  const bgs = await readPdf(file);
  if (!bgs?.length || !note) return;
  const fresh = pdfPages(bgs);
  const emptyNote = doc.pages.every((p) => p.strokes.length === 0 && !p.bg);
  const at = emptyNote ? 0 : currentIndex() + 1;
  changePages((list) => list.splice(at, emptyNote ? list.length : 0, ...fresh));
  if (emptyNote && /^Notiz vom /.test(note.title || '')) {
    note.title = file.name.replace(/\.pdf$/i, '');
    showTitle();
    markDirty([], true);
  }
  goTo(at, false);
  toast(`${fresh.length} ${fresh.length === 1 ? 'Seite' : 'Seiten'} eingefügt – einfach draufschreiben`);
}

// Neue Notiz aus einer PDF (vom Startbildschirm aus)
async function createNoteFromPdf(file, folderId = null) {
  const bgs = await readPdf(file);
  if (!bgs?.length) return;
  const list = pdfPages(bgs);
  const now = Date.now();
  const meta = {
    id: store.uid(),
    title: file.name.replace(/\.pdf$/i, '') || defaultTitle(),
    folderId,
    created: now,
    updated: now,
    favorite: false,
    deletedAt: null,
    pageIds: list.map((p) => p.id),
    pageCount: list.length,
    firstTemplate: { ...PDF_TEMPLATE },
    blobIds: fileIdsOf(list),
    thumbStale: true,
  };
  await store.saveNote(meta, list.map((p) => store.packPage(p, meta.id)));
  await openNote(meta.id);
}

// Exportieren: kind 'pdf' | 'png', which 'all' | 'page'
async function exportNote(kind, which) {
  if (!note) return;
  textEditor.finish();
  lasso.clear();
  const title = note.title || 'Notiz';
  const index = currentIndex();
  const list = which === 'all' ? [...doc.pages] : [doc.pages[index]];
  const busy = progressBox({ title: kind === 'pdf' ? 'PDF wird erstellt …' : 'Bild wird erstellt …' });
  busy.update('Einen Moment', null);
  let blob = null;
  try {
    if (kind === 'pdf') {
      blob = await exportPdf(list, {
        title,
        signal: busy.signal,
        onProgress: (done, total) => busy.update(`Seite ${Math.min(done + 1, total)} von ${total}`, done / total),
      });
    } else {
      blob = await exportImage(list[0]);
    }
  } catch (err) {
    console.error(err);
    toast('Exportieren hat nicht geklappt');
  } finally {
    busy.close();
  }
  if (!blob || busy.signal.cancelled) return;
  const suffix = which === 'page' && doc.count > 1 ? ` (Seite ${index + 1})` : '';
  const file = new File([blob], fileName(title + suffix, kind), { type: blob.type });
  const size = blob.size > 1e6 ? `${(blob.size / 1e6).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(blob.size / 1e3))} KB`;
  const share = canShareFile(file);
  // Erst jetzt fragen: Teilen braucht ein frisches Antippen (sonst blockt der Browser)
  const act = await chooseAction({
    title: kind === 'pdf' ? 'PDF ist fertig' : 'Bild ist fertig',
    text: `${file.name} · ${size}`,
    actions: share
      ? [
          { id: 'save', label: 'Speichern' },
          { id: 'share', label: 'Teilen', primary: true },
        ]
      : [{ id: 'save', label: 'Speichern', primary: true }],
  });
  if (act === 'share') {
    if (!(await shareFile(file, title))) {
      downloadFile(file);
      toast('Teilen ging nicht – in „Downloads“ gespeichert');
    }
  } else if (act === 'save') {
    downloadFile(file);
    toast('In „Downloads“ gespeichert');
  }
}

// Am PC (oder mit Tastatur): Bild aus der Zwischenablage einfügen
window.addEventListener('paste', (e) => {
  if (!note || home.open || textEditor.active || document.querySelector('.dlg-back')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (!files.length) return;
  e.preventDefault();
  if (files.some((f) => /pdf/.test(f.type))) insertPdf(files.find((f) => /pdf/.test(f.type)));
  else insertImages(files);
});

// Datei auf die Seite ziehen (Drag & Drop, z. B. aus "Eigene Dateien" im geteilten Bildschirm)
stage.addEventListener('dragover', (e) => {
  if (note && [...(e.dataTransfer?.types || [])].includes('Files')) e.preventDefault();
});
stage.addEventListener('drop', (e) => {
  const files = [...(e.dataTransfer?.files || [])];
  if (!note || !files.length) return;
  e.preventDefault();
  const pdf = files.find((f) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
  if (pdf) return insertPdf(pdf);
  const r = stage.getBoundingClientRect();
  insertImages(files, view.toPage(e.clientX - r.left, e.clientY - r.top));
});

// ---------- Werkzeugleiste ----------
let toolBeforeEraser = tools.tool === 'highlighter' ? 'highlighter' : 'pen';
const toolbar = setupToolbar({
  tools,
  // Radierer in der Leiste gewählt = Stift radiert ab jetzt auch ohne Knopf
  onToolChange(tool) {
    if (tool !== 'text') textEditor.finish();
    if (tool !== 'lasso') lasso.clear();
    if (tool !== 'eraser') toolBeforeEraser = tool;
    assist.finish();
    input.setStickyEraser(tool === 'eraser');
  },
  // "Seite leeren" leert die Seite, die gerade in der Mitte zu sehen ist
  onClear() {
    lasso.clear();
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
mediaSettings.darkPdf = readSetting('darkPdf', 'off') === 'on';

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
  darkPdfSetting: () => mediaSettings.darkPdf,
  setDarkPdfSetting(on) {
    mediaSettings.darkPdf = on;
    saveSetting('darkPdf', on ? 'on' : 'off');
    applyTheme();
  },
  closeOtherPopups() {
    toolbar.closePopup();
    mediaMenu?.close();
    claudeMenu?.close();
    moreMenu?.close();
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
      if (tools.tool === 'shape') tools.shape.color = id;
      else if (tools.tool === 'fill') tools.fill.color = id;
      else {
        if (!['pen', 'highlighter'].includes(tools.tool)) toolbar.setTool(toolBeforeEraser === 'highlighter' ? 'highlighter' : 'pen');
        settingsOf(tools, activeStyle(tools).type).color = id;
      }
    } else if (act === 'fav') {
      toolbar.applyFavorite(tools.favorites[Number(id)]);
    }
    saveTools(tools);
    toolbar.update();
  },
});

// ---------- Handschrifthilfe und Handschrift zu Text (siehe assist.js und convert.js) ----------
assist = setupAssist({
  stage,
  view,
  doc,
  renderer,
  commit: commitChanges,
  isOn: () => tools.assist,
  options: () => tools.assistOpts,
});
const assistButton = document.getElementById('btn-assist');
function applyAssistButton() {
  assistButton.classList.toggle('on', tools.assist);
  assistButton.setAttribute('aria-pressed', String(tools.assist));
}
function setAssist(on) {
  tools.assist = on;
  saveTools(tools);
  if (!on) assist.reset();
  applyAssistButton();
}
// Aus -> antippen schaltet an. An -> antippen öffnet die Einstellungen (wie bei den Stiften).
assistButton.addEventListener('click', () => {
  if (optionsOpen(assistButton)) return closeOptions();
  closeAllPopups();
  if (!tools.assist) {
    setAssist(true);
    toast('Handschrifthilfe an – nochmal antippen für Einstellungen');
    return;
  }
  openAssistOptions();
});
function openAssistOptions() {
  openOptions(assistButton, {
    title: 'Handschrifthilfe',
    rows: [
      { type: 'switch', key: 'on', main: true, label: 'Handschrifthilfe', hint: 'Hilft dir, ordentlich in der Zeile zu schreiben' },
      { type: 'title', text: 'Beim Schreiben' },
      { type: 'switch', key: 'guide', label: 'Hilfslinie zeigen', hint: 'Leeres Papier: gestrichelte Linie. Liniert/kariert: die Ziel-Linie leuchtet' },
      { type: 'title', text: 'Wenn die Zeile fertig ist' },
      { type: 'switch', key: 'straighten', label: 'Schräge Zeilen geraderücken', hint: 'Bergauf oder bergab Geschriebenes wird waagerecht' },
      { type: 'switch', key: 'snap', label: 'Auf die Linien des Papiers setzen', hint: 'Liniert, kariert, Mathe-Heft, Millimeter: Die Schrift steht genau auf der Linie' },
      { type: 'switch', key: 'fit', label: 'An die Zeilenhöhe anpassen', hint: 'Zu große Schrift wird kleiner, damit sie zwischen die Linien passt' },
      { type: 'seg', key: 'boxes', label: 'Zeilenhöhe auf Karopapier', options: [[1, '1 Kästchen'], [2, '2 Kästchen'], [3, '3 Kästchen']], when: () => tools.assistOpts.fit },
      { type: 'note', text: 'Einmal „Rückgängig“ holt deine Original-Schrift zurück.' },
    ],
    get: (key) => (key === 'on' ? tools.assist : tools.assistOpts[key]),
    set(key, value) {
      if (key === 'on') return setAssist(value);
      tools.assistOpts[key] = value;
      saveTools(tools);
      assist.redraw();
    },
  });
}
applyAssistButton();

// ---------- Lineal und Geodreieck (siehe ruler.js) ----------
const rulerButton = document.getElementById('btn-ruler');
function applyRulerButton() {
  rulerButton.classList.toggle('on', ruler.on);
  rulerButton.setAttribute('aria-pressed', String(ruler.on));
}
// Aus -> antippen legt es aufs Blatt. An -> antippen öffnet die Einstellungen.
rulerButton.addEventListener('click', () => {
  if (optionsOpen(rulerButton)) return closeOptions();
  closeAllPopups();
  if (!ruler.on) {
    ruler.show();
    toast(`${ruler.kind === 'ruler' ? 'Lineal' : 'Geodreieck'}: 1 Finger verschiebt, 2 Finger drehen – Stift an die Kante = gerade Linie`);
    return;
  }
  openOptions(rulerButton, {
    title: 'Lineal und Geodreieck',
    rows: [
      { type: 'switch', key: 'on', main: true, label: 'Auf dem Blatt', hint: '1 Finger verschiebt, 2 Finger drehen. Stift an die Kante setzen = gerade Linie mit Länge in cm' },
      { type: 'seg', key: 'kind', label: 'Form', options: [['triangle', 'Geodreieck'], ['ruler', 'Lineal']] },
      { type: 'button', key: 'level', label: 'Gerade hinlegen (0°)', closes: false, run: () => ruler.level() },
      { type: 'button', key: 'center', label: 'In die Mitte holen', run: () => ruler.center() },
      { type: 'note', text: 'Beim Drehen rastet es bei 0°, 15°, 30°, 45° … leicht ein. Der Winkel steht in der Mitte.' },
    ],
    get: (key) => (key === 'on' ? ruler.on : ruler.kind),
    set(key, value) {
      if (key === 'on') return value ? ruler.show() : ruler.hide();
      if (key === 'kind') ruler.setKind(value);
    },
  });
});
applyRulerButton();

// Handschrift in Text umwandeln: die Lasso-Auswahl, sonst alles auf der Seite in der Mitte
async function convertInk(page, strokes) {
  toolbar.closePopup();
  const items = await convertHandwriting({ page, strokes, commit: commitChanges, newZ: () => nextZ++ });
  if (items?.length) {
    toast('In Text umgewandelt – antippen mit dem Text-Werkzeug zum Bearbeiten', { label: 'Rückgängig', run: undo });
  }
}
// Knopf "Zu Text": Ist etwas mit dem Lasso ausgewählt, wird das umgewandelt.
// Sonst ziehst du mit dem Stift einen Rahmen um die Handschrift, die Text werden soll –
// oder wählst in der Leiste "Ganze Seite".
const convertButton = document.getElementById('btn-convert');
convertButton.addEventListener('click', async () => {
  closeAllPopups();
  const sel = lasso.selection;
  if (sel) {
    lasso.clear();
    return convertInk(sel.page, sel.items);
  }
  if (areaPick.active) return areaPick.cancel();
  convertButton.classList.add('on');
  const result = await areaPick.start({
    title: 'Handschrift zu Text',
    hint: 'Ziehe mit dem Stift einen Rahmen um die Handschrift, die Text werden soll',
    icon: convertButton.querySelector('svg').outerHTML,
    actions: [{ id: 'page', label: 'Ganze Seite' }],
  });
  convertButton.classList.remove('on');
  if (!result) return;
  if (result.action === 'page') {
    const page = doc.pages[currentIndex()];
    const ink = page.strokes.filter((s) => s.tool === 'pen' && !s.shape);
    if (!ink.length) return toast('Auf dieser Seite ist keine Handschrift');
    return convertInk(page, ink);
  }
  const ink = result.items.filter((s) => s.tool === 'pen' && !s.shape);
  if (!ink.length) return toast('Im Rahmen ist keine Handschrift – nochmal versuchen');
  convertInk(result.page, ink);
});

// ---------- Werkzeugleiste anpassen und ⋮-Menü (siehe toolbarconfig.js, moremenu.js) ----------
const toolbarConfig = setupToolbarConfig();
// Weitere Einträge im ⋮-Menü (Sprachaufnahme, Mathe-Hilfe, Notiz sperren …) melden sich hier an
const moreEntries = [];
moreMenu = setupMoreMenu({
  sections: () => {
    const groups = new Map();
    for (const e of moreEntries) {
      const row = e.row();
      if (!row) continue;
      if (!groups.has(e.group)) groups.set(e.group, []);
      groups.get(e.group).push(row);
    }
    return [...groups].map(([title, rows]) => ({ title, rows }));
  },
  hiddenItems: () => toolbarConfig.hiddenItems(),
  customize() {
    closeAllPopups();
    toolbarConfig.open();
  },
  closeOtherPopups() {
    toolbar.closePopup();
    pages.closePopup();
    mediaMenu?.close();
    claudeMenu?.close();
  },
});

// ⋮-Menü: Notiz mit PIN sperren (siehe lock.js)
const LOCK_ICON = '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/><path d="M12 14.6v2.4"/></svg>';
moreEntries.push({
  group: 'Notiz',
  row: () =>
    note && {
      icon: LOCK_ICON,
      label: note.locked ? 'Sperre entfernen' : 'Notiz mit PIN sperren',
      hint: note.locked ? 'Öffnen geht dann wieder ohne PIN' : 'Öffnen nur noch mit deiner PIN',
      on: Boolean(note.locked),
      async run() {
        if (!note) return;
        if (!note.locked) {
          if (!(await lock.ensurePin())) return;
          note.locked = true;
          toast('Notiz gesperrt – öffnen nur mit PIN');
        } else {
          if (!(await lock.unlock('Sperre entfernen'))) return;
          note.locked = false;
          toast('Sperre entfernt');
        }
        markDirty([], true);
      },
    },
});

// ---------- Sprachaufnahme (siehe audio.js) ----------
const recordButton = document.getElementById('btn-record');
const MIC_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>';
function applyRecordButton() {
  recordButton.classList.toggle('on', audio.recording);
  recordButton.classList.toggle('rec-live', audio.recording);
  recordButton.setAttribute('aria-pressed', String(audio.recording));
}
function openRecordPanel(anchor) {
  closeAllPopups();
  audio.openPanel(anchor);
}
recordButton.addEventListener('click', () => openRecordPanel(recordButton));
moreEntries.push({
  group: 'Extras',
  row: () =>
    note && {
      tool: 'record',
      icon: MIC_ICON,
      label: audio.recording ? 'Aufnahme läuft …' : 'Sprachaufnahme',
      hint: audio.recording
        ? 'Tippen für Aufnahmen und Einstellungen'
        : `Ton aufnehmen, die Schrift läuft beim Abspielen mit${note.recordings?.length ? ` · ${note.recordings.length} gespeichert` : ''}`,
      on: audio.recording,
      run: () => openRecordPanel(document.getElementById('btn-more')),
    },
});
applyRecordButton();

// ---------- Mathe-Hilfe (siehe mathhelp.js, mathink.js, mathsolve.js) ----------
const mathButton = document.getElementById('btn-math');
const mathHelp = setupMathHelp({
  commit: commitChanges,
  newZ: () => nextZ++,
  penColor: () => activeStyle(tools).color,
  // Eingetipptes Ergebnis: in die Mitte der sichtbaren Seite
  freeSpot() {
    if (!note) return null;
    const i = currentIndex();
    const [x, y] = view.toPage(view.width / 2, view.height / 2);
    return { page: doc.pages[i], x: Math.max(30, x - 160), y: y - doc.top(i) };
  },
  pickArea: () => startMath(true),
});
async function startMath(fromPanel = false) {
  if (!note) return;
  closeAllPopups();
  const sel = lasso.selection;
  if (sel && !fromPanel) {
    lasso.clear();
    return mathHelp.fromInk(sel.page, sel.items);
  }
  if (areaPick.active) return areaPick.cancel();
  mathButton.classList.add('on');
  const result = await areaPick.start({
    title: 'Mathe-Hilfe',
    hint: 'Ziehe mit dem Stift einen Rahmen um die Aufgabe (z. B. 3x + 5 = 20 oder 12 · 4 =)',
    icon: MATH_ICON,
    actions: [{ id: 'type', label: 'Eintippen' }],
  });
  mathButton.classList.remove('on');
  if (!result) return;
  if (result.action === 'type') return mathHelp.typed();
  mathHelp.fromInk(result.page, result.items);
}
mathButton.addEventListener('click', () => startMath());
moreEntries.push({
  group: 'Extras',
  row: () =>
    note && {
      tool: 'math',
      icon: MATH_ICON,
      label: 'Mathe-Hilfe',
      hint: 'Aufgabe einrahmen: ausrechnen, Gleichung lösen, mit Rechenweg',
      run: () => startMath(),
    },
});

// Alle kleinen Menüs oben zu
function closeAllPopups() {
  closeOptions();
  toolbar.closePopup();
  pages.closePopup();
  mediaMenu?.close();
  claudeMenu?.close();
  moreMenu?.close();
}

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

// Am PC: Entf, Strg+C/X/V/D und Esc für die Lasso-Auswahl
window.addEventListener('keydown', (e) => {
  if (home.open || document.querySelector('.dlg-back') || textEditor.active) return;
  if ((tools.tool === 'lasso' || lasso.active) && lasso.onKey(e)) e.preventDefault();
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
  lockButton.title = viewLocked ? 'Scroll-Sperre an: scrollen nur mit 2 Fingern (antippen zum Lösen)' : 'Scroll-Sperre';
}
lockButton.addEventListener('click', () => {
  viewLocked = !viewLocked;
  saveSetting('scrollLock', viewLocked ? 'on' : 'off');
  applyLock();
  stopScrollAnimation();
  toast(viewLocked ? 'Scroll-Sperre an: 1 Finger bewegt nichts mehr – scrollen mit 2 Fingern' : 'Scroll-Sperre aus');
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
    // diese Dateien (Bilder, PDFs, Aufnahmen) darf das Aufräumen nicht löschen
    target.blobIds = [...fileIdsOf(doc.pages), ...(target.recordings || []).map((r) => r.blobId)];
    target.thumbStale = thumbDirty; // merken, falls die App vor dem nächsten Vorschaubild beendet wird
  }
  let thumbs = null;
  if (thumbsNow) {
    thumbDirty = false;
    lastThumbAt = performance.now();
    thumbs = makeThumbs(); // wartet ggf. auf Bilder, malt dann und macht daraus Bilddateien
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
async function makeThumbs() {
  const page = doc.pages[0];
  await ensureLoaded(imageIdsOf([page])); // Bilder und PDF erst laden, sonst fehlen sie im Vorschaubild
  const saved = { ...inkTheme };
  const canvases = [false, true].map((darkMode) => {
    const dark = pageDark(page, darkMode);
    const c = document.createElement('canvas');
    setInkTheme(dark, paperColor(page.template.paper, dark));
    drawThumbnail(c, page.template, { dark, faint: true, strokes: page.strokes, fill: thumbStroke, width: THUMB_WIDTH, bg: page.bg });
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
  if (stroke.tool === 'highlighter' || stroke.tool === 'image' || !stroke.layers) return;
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

async function openNote(id, savedView = null, focus = null) {
  const meta = await store.getNote(id);
  if (!meta || meta.deletedAt) return false;
  // Gesperrte Notiz (oder in gesperrtem Ordner): erst PIN (siehe lock.js)
  if (lock.isNoteLocked(meta, await store.getAllFolders()) && !(await lock.unlock('Notiz gesperrt'))) return false;
  await leaveNote();
  const loaded = (await store.getPages(meta.pageIds || [])).map(store.unpackPage);

  stopScrollAnimation();
  toolbar.closePopup();
  pages.closeAll();
  lasso.clear();
  current = null;
  shapeDrag = null;
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
  if (focus && doc.pages[focus.pageIndex]) {
    // Aus der Suche: genau zur Fundstelle und sie kurz aufleuchten lassen
    view.fitToWidth();
    const top = doc.top(focus.pageIndex);
    const [, y0, , y1] = focus.box;
    view.y = view.height / 2 - (top + (y0 + y1) / 2) * view.scale;
    view.clamp();
  } else if (!restoreView(savedView)) {
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
  if (focus) flashFound(focus);
  return true;
}

// Fundstelle der Suche markieren (leuchtender Rahmen, verblasst nach ein paar Sekunden)
function flashFound({ pageIndex, box }) {
  const top = doc.top(pageIndex);
  const pad = 8;
  const [ax, ay] = view.toScreen(box[0] - pad, box[1] - pad + top);
  const [bx, by] = view.toScreen(box[2] + pad, box[3] + pad + top);
  const el = document.createElement('div');
  el.className = 'found-flash';
  Object.assign(el.style, { left: `${ax}px`, top: `${ay}px`, width: `${bx - ax}px`, height: `${by - ay}px` });
  stage.appendChild(el);
  const remove = () => el.remove();
  setTimeout(remove, 3200);
  stage.addEventListener('pointerdown', remove, { once: true });
}

// Neue Notiz (im gerade offenen Ordner) anlegen und gleich öffnen
async function createNote(folderId = null, folderName = null) {
  const tpl = loadJSON('pageTemplate', DEFAULT_TEMPLATE);
  const page = createPage(tpl);
  const now = Date.now();
  const meta = {
    id: store.uid(),
    title: defaultTitle(folderName),
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

// Automatischer Titel mit Datum. Im Ordner "Mathe" heißt eine neue Notiz z. B. "Mathe vom 24.11., 08:33".
function defaultTitle(prefix = null) {
  const d = new Date();
  return `${prefix || 'Notiz'} vom ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`;
}

// Notiz zumachen: alles speichern. Eine neue, leer gebliebene Notiz wird wieder gelöscht.
async function leaveNote() {
  if (!note) return;
  textEditor.finish();
  lasso.clear();
  assist.reset();
  laser.clear();
  areaPick.cancel();
  mathHelp.close();
  await audio.leave(); // läuft eine Aufnahme, wird sie jetzt gespeichert
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
  openNote: (id, focus) => openNote(id, null, focus),
  createNote,
  createNoteFromPdf,
  darkPaper: () => renderer.darkPaper,
});

document.getElementById('btn-home').addEventListener('click', goHome);

// Wieder gesperrt (App verlassen, "Jetzt sperren") und eine gesperrte Notiz ist offen -> zum Startbildschirm
lock.onLockChange(async (open) => {
  if (open || !note) return;
  if (lock.isNoteLocked(note, await store.getAllFolders())) goHome();
});

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
    // Dateien (Bilder/PDFs) wegräumen, die keine Notiz mehr braucht
    await store.cleanupBlobs().catch((err) => console.warn('Aufräumen ging nicht', err));
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

// Nur beim Entwickeln: von der Browser-Konsole aus hineinschauen können
if (import.meta.env.DEV) window.federleicht = { doc, tools, view, history, renderer, commitChanges, newZ: () => nextZ++ };
