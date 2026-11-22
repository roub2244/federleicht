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
// Kurz bevor die Spitze aufsetzt, meldet das Tablet "Knopf los" (buttons = 0).
// Deshalb zählt ein Knopf, der vor weniger als ARM_MS losgelassen wurde, noch als gedrückt.
const ARM_MS = 400;

// ---------- Die zwei wichtigsten Funktionen für den S Pen ----------
//
// "buttons" ist eine Bitmaske: jede Taste hat ein eigenes Bit.
//   1  = Spitze berührt das Display (bzw. linke Maustaste)
//   2  = Seitenknopf am Stift        (bzw. rechte Maustaste)
//   32 = Radierer (z. B. Radier-Ende mancher Stifte)
// Mit "&" prüfen wir, ob ein bestimmtes Bit gesetzt ist:
//   buttons = 3  ->  3 & 2 = 2 (wahr: Knopf gedrückt)  3 & 1 = 1 (wahr: Spitze unten)
//
// THEORIE UND PRAXIS: Laut Standard sollte der Stiftknopf das Bit 2 setzen.
// Robins Galaxy Tab S10 FE macht es anders (das hat die Diagnose gezeigt):
//   - Während die Spitze das Display berührt, sieht man den Knopf GAR NICHT.
//   - Beim SCHWEBEN mit gedrücktem Knopf kommt buttons = 1, aber Druck = 0.
//     (buttons = 1 heißt eigentlich "Spitze unten" – der Druck 0 verrät aber,
//      dass der Stift in Wahrheit schwebt.)
//   - Direkt vor dem Aufsetzen kommt noch ein Schwebe-Event mit buttons = 0.
// Deshalb merken wir uns beim Schweben, ob (und wann zuletzt) der Knopf gedrückt war,
// und entscheiden beim Aufsetzen: zeichnen oder radieren.

// Meldet das Event ein Radierer-Signal nach Standard? (andere Stifte, Maus)
export function isEraserButton(e) {
  if (e.buttons & 32) return true; // Radierer-Bit
  if (e.buttons & 2) return true;  // Seitenknopf bzw. rechte Maustaste
  // Beim Aufsetzen verrät "button", WELCHE Taste das Event ausgelöst hat:
  // 5 = Radierer, 2 = Seitenknopf / rechte Maustaste
  if (e.type === 'pointerdown' && (e.button === 5 || e.button === 2)) return true;
  return false;
}

// Schwebt der Stift gerade mit gedrücktem Knopf? (nur für Schwebe-Events gedacht)
export function isButtonHeldWhileHovering(e) {
  if (isEraserButton(e)) return true;
  // So meldet es Robins Samsung-Tablet: "Spitze unten", aber ohne Druck
  if (e.pointerType === 'pen' && (e.buttons & 1) && e.pressure === 0) return true;
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
  const contacts = new Set();    // Stift-Pointer, die gerade das Display berühren
  const silentContacts = new Set(); // ...davon die, die ohne pointerdown aufgesetzt haben
  let buttonHeld = false;         // letzter bekannter Knopf-Zustand beim Schweben
  let buttonReleasedAt = -Infinity;

  // Knopf gerade gedrückt oder erst ganz kurz losgelassen?
  const eraserReady = (time) => buttonHeld || time - buttonReleasedAt < ARM_MS;

  function handlePen(e) {
    lastPenTime = e.timeStamp;
    const id = e.pointerId;

    // Der Stift hat Vorrang: Liegt schon ein "Finger" (= Handballen) auf, ignorieren wir ihn ab jetzt.
    if (e.pointerType === 'pen' && touches.size) {
      for (const fingerId of touches.keys()) ignored.add(fingerId);
      touches.clear();
    }

    // Liegt schon ein anderer Stift-Pointer auf dem Display, ignorieren wir alle anderen
    // (z. B. Schwebe-Events, die das Tablet manchmal nebenher schickt).
    if (contacts.size > 0 && !contacts.has(id) && e.type !== 'pointerdown') {
      return 'ignoriert (anderer Stift-Pointer)';
    }

    // Berührt der Stift das Display? Das entscheiden wir über pointerdown/pointerup,
    // nicht über "buttons" – denn das Tablet meldet buttons = 1 auch beim Schweben.
    let starting = e.type === 'pointerdown';
    let ended = e.type === 'pointerup' || e.type === 'pointercancel';

    // Sicherheitsnetz: Manche Geräte schicken beim Aufsetzen mit gedrücktem Knopf kein
    // pointerdown, sondern nur Bewegungen mit Druck > 0. Das zählt dann auch als Aufsetzen.
    if (e.type === 'pointermove' && e.pointerType === 'pen') {
      const pressing = (e.buttons & 1) && e.pressure > 0;
      if (!contacts.has(id) && pressing) {
        starting = true;
        silentContacts.add(id);
      } else if (silentContacts.has(id) && !pressing) {
        ended = true;
      }
    }

    if (starting) {
      capture(id);
      contacts.add(id);
    }
    const touching = contacts.has(id) && !ended;
    if (ended) {
      contacts.delete(id);
      silentContacts.delete(id);
    }

    let eraser;
    if (touching) {
      // Beim Aufsetzen: War der Knopf beim Schweben gedrückt?
      // Danach bleibt der Modus bis zum Abheben gleich (den Knopf sehen wir jetzt ja nicht mehr).
      eraser = isEraserButton(e) || penMode === 'erase' || (starting && eraserReady(e.timeStamp));
    } else if (contacts.size === 0 && !ended) {
      // Schweben: Knopf-Zustand merken
      const held = isButtonHeldWhileHovering(e);
      if (buttonHeld && !held) buttonReleasedAt = e.timeStamp;
      buttonHeld = held;
      eraser = eraserReady(e.timeStamp);
    } else {
      eraser = false;
    }
    const wanted = touching ? (eraser ? 'erase' : 'draw') : 'none';

    // 0. Radierer-Kreis ausblenden, wenn er nicht mehr gebraucht wird
    if (eraserShown && (!eraser || ended)) {
      app.showEraser(null);
      eraserShown = false;
    }

    // 1. Neue Punkte zum laufenden Strich / Radiervorgang hinzufügen.
    //    getCoalescedEvents(): Der Stift misst öfter, als der Bildschirm Bilder zeigt.
    //    Hier bekommen wir ALLE Zwischenpunkte -> glattere Linien.
    if (contacts.has(id) || ended) {
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
    }

    // 2. Hat sich der Modus geändert? (aufgesetzt, abgehoben, Knopf gedrückt)
    if (wanted !== penMode && (touching || ended || contacts.size === 0)) {
      if (penMode === 'draw') app.endStroke();
      if (penMode === 'erase') app.endErase();
      if (wanted === 'draw') app.startStroke(pagePoint(e), e.pointerType);
      if (wanted === 'erase') app.startErase(pagePoint(e));
      penMode = wanted;
    }

    // Nach dem Abheben neu anfangen: Der Knopf muss beim nächsten Schweben wieder gedrückt sein
    if (ended) {
      buttonHeld = false;
      buttonReleasedAt = -Infinity;
    }

    // 3. Radierer-Kreis anzeigen – auch schon beim Schweben mit gedrücktem Knopf
    if (eraser && !ended) {
      app.showEraser(screenPos(e));
      eraserShown = true;
    }

    if (penMode === 'draw') return 'Zeichnen';
    if (penMode === 'erase') return 'Radieren';
    return eraser ? 'Schweben mit Knopf (Radierer bereit)' : 'Schweben';
  }

  // Auf dem Samsung-Tablet löst der Knopf beim Schweben auch ein "contextmenu" aus.
  // Das nutzen wir als zusätzliches Signal (und verhindern das Menü).
  function onContextMenu(e) {
    e.preventDefault();
    if (e.timeStamp - lastPenTime < 1000) buttonReleasedAt = e.timeStamp;
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
  canvas.addEventListener('contextmenu', onContextMenu);

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
