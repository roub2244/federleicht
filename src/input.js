// input.js – Stift, Finger und Maus auseinanderhalten
//
// Der Browser schickt uns für ALLES "Pointer Events": pointerdown (aufsetzen),
// pointermove (bewegen), pointerup (abheben). Jedes Event verrät uns:
//   e.pointerType  "pen" (S Pen), "touch" (Finger/Handballen) oder "mouse"
//   e.buttons      welche Knöpfe gerade gedrückt sind (als Bitmaske, siehe unten)
//   e.pressure     wie fest gedrückt wird (0 bis 1)
//
// Unsere Regeln:
//   Stift        -> zeichnen (mit gedrücktem Knopf: radieren)
//   1 Finger     -> verschieben
//   2 Finger     -> zoomen
//   Handballen   -> ignorieren

// Wie lange nach einer Stift-Aktivität Finger ignoriert werden (Millisekunden).
// Grund: Wenn du schreibst, liegt deine Hand auf dem Display.
const PEN_GRACE_MS = 600;
// Berührungen, die größer sind als das (in Pixeln), sind vermutlich der Handballen
const PALM_SIZE = 45;

// ---------- Die zwei wichtigsten Funktionen für den S Pen ----------
//
// "buttons" ist eine Bitmaske: jede Taste hat ein eigenes Bit.
//   1  = Spitze berührt das Display (bzw. linke Maustaste)
//   2  = Seitenknopf am Stift        (bzw. rechte Maustaste)
//   32 = Radierer (z. B. Radier-Ende mancher Stifte)
// Mit "&" prüfen wir, ob ein bestimmtes Bit gesetzt ist:
//   buttons = 3  ->  3 & 2 = 2 (wahr: Knopf gedrückt)  3 & 1 = 1 (wahr: Spitze unten)

// Soll gerade radiert werden?
export function isEraserButton(e) {
  if (e.buttons & 32) return true; // Radierer-Bit
  if (e.buttons & 2) return true;  // Seitenknopf (so meldet es Chrome auf Android meistens)
  // Beim Aufsetzen verrät "button", WELCHE Taste das Event ausgelöst hat:
  // 5 = Radierer, 2 = Seitenknopf
  if (e.type === 'pointerdown' && (e.button === 5 || e.button === 2)) return true;
  return false;
}

// Berührt der Stift gerade das Display (oder schwebt er nur darüber)?
export function isTouchingScreen(e) {
  if (e.buttons & 1) return true;  // Spitze unten
  if (e.buttons & 32) return true; // Radierer unten
  // Manche Geräte melden "Knopf gedrückt + Spitze unten" nur als buttons = 2.
  // Schwebt der Stift nur, ist der Druck 0 – daran erkennen wir den Unterschied.
  if ((e.buttons & 2) && e.pressure > 0) return true;
  return false;
}

// ---------- Alles verbinden ----------

export function setupInput(canvas, app) {
  let rect = canvas.getBoundingClientRect();
  let penMode = 'none';      // 'draw' | 'erase' | 'none'
  let eraserShown = false;   // wird gerade der Radierer-Kreis angezeigt?
  let lastPenTime = -Infinity;
  const touches = new Map(); // aktive Finger: pointerId -> [x, y]
  const ignored = new Set(); // als Handballen erkannte Berührungen

  // "Pointer Capture": alle weiteren Events dieses Stifts/Fingers kommen bei uns an,
  // auch wenn er kurz über den Rand der Zeichenfläche rutscht.
  const capture = (id) => {
    try {
      canvas.setPointerCapture(id);
    } catch {
      /* klappt nicht immer – dann eben ohne */
    }
  };

  // Position eines Events relativ zur Zeichenfläche (Bildschirm-Pixel)
  const screenPos = (ev) => [ev.clientX - rect.left, ev.clientY - rect.top];

  // Event -> Punkt auf der Seite: [x, y, druck]
  const pagePoint = (ev) => {
    const [x, y] = app.view.toPage(...screenPos(ev));
    const pressure = ev.pointerType === 'pen' && ev.pressure > 0 ? ev.pressure : 0.5;
    return [x, y, pressure];
  };

  // ---------- Stift (und Maus) ----------
  function handlePen(e) {
    lastPenTime = e.timeStamp;

    // Der Stift hat Vorrang: Liegt schon ein "Finger" (= Handballen) auf, ignorieren wir ihn ab jetzt.
    if (e.pointerType === 'pen' && touches.size) {
      for (const id of touches.keys()) ignored.add(id);
      touches.clear();
    }

    if (e.type === 'pointerdown') capture(e.pointerId);

    const ended = e.type === 'pointerup' || e.type === 'pointercancel';
    const eraser = isEraserButton(e);
    const touching = !ended && isTouchingScreen(e);
    const wanted = touching ? (eraser ? 'erase' : 'draw') : 'none';

    // 0. Radierer-Kreis ausblenden, wenn der Knopf losgelassen wurde
    if (eraserShown && (!eraser || ended)) {
      app.showEraser(null);
      eraserShown = false;
    }

    // 1. Neue Punkte zum laufenden Strich / Radiervorgang hinzufügen.
    //    getCoalescedEvents(): Der Stift misst öfter, als der Bildschirm Bilder zeigt.
    //    Hier bekommen wir ALLE Zwischenpunkte -> glattere Linien.
    if (e.type === 'pointermove' || e.type === 'pointerup') {
      let events = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
      if (events.length === 0) events = [e];
      const points = events.map(pagePoint);

      if (penMode === 'draw') {
        // getPredictedEvents(): Der Browser schätzt, wo der Stift gleich sein wird.
        // Diese Punkte zeigen wir nur kurz an, damit sich die Linie schneller anfühlt.
        const predicted = wanted === 'draw' && e.getPredictedEvents ? e.getPredictedEvents().map(pagePoint) : [];
        app.extendStroke(points, predicted);
      } else if (penMode === 'erase' && wanted === 'erase') {
        app.eraseAlong(points);
      }
    }

    // 2. Hat sich der Modus geändert? (z. B. Knopf mitten im Strich gedrückt)
    if (wanted !== penMode) {
      if (penMode === 'draw') app.endStroke();
      if (penMode === 'erase') app.endErase();
      if (wanted === 'draw') app.startStroke(pagePoint(e), e.pointerType);
      if (wanted === 'erase') app.startErase(pagePoint(e));
      penMode = wanted;
    }

    // 3. Radierer-Kreis anzeigen – auch schon beim Schweben mit gedrücktem Knopf
    if (eraser && !ended) {
      app.showEraser(screenPos(e));
      eraserShown = true;
    }

    if (penMode === 'draw') return 'Zeichnen';
    if (penMode === 'erase') return 'Radieren';
    return eraser ? 'Schweben (Radierer)' : 'Schweben';
  }

  // ---------- Finger ----------
  function handleTouch(e) {
    const id = e.pointerId;
    const ended = e.type === 'pointerup' || e.type === 'pointercancel';

    if (e.type === 'pointerdown') {
      const penNearby = penMode !== 'none' || e.timeStamp - lastPenTime < PEN_GRACE_MS;
      const tooBig = Math.max(e.width || 0, e.height || 0) > PALM_SIZE;
      if (penNearby || tooBig) {
        ignored.add(id);
        return 'Handballen ignoriert';
      }
      capture(id);
      touches.set(id, screenPos(e));
      return 'Finger';
    }

    if (ignored.has(id)) {
      if (ended) ignored.delete(id);
      return 'Handballen ignoriert';
    }
    if (!touches.has(id)) return 'Finger';

    if (ended) {
      touches.delete(id);
      return 'Finger';
    }

    // Geste: Mitte und Abstand der Finger vorher und nachher vergleichen
    const before = gesture(touches);
    touches.set(id, screenPos(e));
    const after = gesture(touches);

    app.panBy(after.cx - before.cx, after.cy - before.cy); // Mitte bewegt -> verschieben
    if (before.dist > 0 && after.dist > 0) {
      app.zoomAt(after.cx, after.cy, after.dist / before.dist); // Abstand geändert -> zoomen
    }
    return touches.size > 1 ? 'Zoomen' : 'Verschieben';
  }

  // ---------- Events anmelden ----------
  function onPointerEvent(e) {
    const status = e.pointerType === 'touch' ? handleTouch(e) : handlePen(e);
    app.debug.record(e, status);
  }

  for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel']) {
    canvas.addEventListener(type, onPointerEvent);
  }

  // Stift verlässt den Schwebe-Bereich -> Radierer-Kreis weg
  canvas.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'touch' && eraserShown && penMode === 'none') {
      app.showEraser(null);
      eraserShown = false;
    }
  });

  // Kein Kontextmenü bei langem Drücken oder Stiftknopf
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  // Am PC: Mausrad = scrollen, Strg + Mausrad = zoomen
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const [x, y] = screenPos(e);
      if (e.ctrlKey) app.zoomAt(x, y, Math.exp(-e.deltaY * 0.01));
      else app.panBy(-e.deltaX, -e.deltaY);
    },
    { passive: false }
  );

  return {
    // nach einer Größenänderung neu messen, wo das Canvas liegt
    updateRect() {
      rect = canvas.getBoundingClientRect();
    },
  };
}

// Mitte (cx, cy) und Abstand (dist) der ersten zwei Finger
function gesture(touches) {
  const pts = [...touches.values()];
  if (pts.length === 1) return { cx: pts[0][0], cy: pts[0][1], dist: 0 };
  const [a, b] = pts;
  return {
    cx: (a[0] + b[0]) / 2,
    cy: (a[1] + b[1]) / 2,
    dist: Math.hypot(a[0] - b[0], a[1] - b[1]),
  };
}
