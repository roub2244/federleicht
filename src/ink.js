// ink.js – Striche: aus Stiftpunkten eine schöne, glatte Linie machen
//
// Ein Strich ist einfach eine Liste von Punkten [x, y, druck].
// Die Bibliothek "perfect-freehand" macht daraus den Umriss einer Linie,
// die dort dicker ist, wo du fester drückst. Den Umriss füllen wir dann
// mit Farbe – so entsteht eine Linie, die wie mit echter Tinte aussieht.

import { getStroke } from 'perfect-freehand';

// Einstellungen für die Glättung (probier ruhig andere Werte aus!)
const FREEHAND_OPTIONS = {
  thinning: 0.6,    // wie stark der Druck die Dicke ändert (0 = gar nicht)
  smoothing: 0.55,  // wie rund der Umriss wird
  streamline: 0.3,  // wie stark Zittern ausgeglichen wird (hoch = glatter, aber "hinterher")
  start: { cap: true, taper: 0 },
  end: { cap: true, taper: 0 },
};

// Einen neuen, leeren Strich anlegen
export function createStroke({ color, size, simulatePressure }) {
  return {
    color,
    size,               // Dicke in Seiten-Einheiten (Seite ist 1000 breit)
    simulatePressure,   // true bei Maus: Druck aus der Geschwindigkeit "raten"
    points: [],         // [[x, y, druck], ...]
    path: null,         // fertige Form zum Zeichnen (Path2D)
    box: null,          // umgebendes Rechteck {minX, minY, maxX, maxY}
  };
}

// Aus den Punkten den Umriss berechnen.
// extraPoints: vorhergesagte Punkte (nur fürs Anzeigen, werden nicht gespeichert)
// finished: true, wenn der Stift wieder abgehoben wurde
export function buildPath(stroke, extraPoints = [], finished = false) {
  const points = extraPoints.length ? stroke.points.concat(extraPoints) : stroke.points;
  const outline = getStroke(points, {
    ...FREEHAND_OPTIONS,
    size: stroke.size,
    simulatePressure: stroke.simulatePressure,
    last: finished,
  });
  return outlineToPath(outline);
}

// Den Umriss (viele Eckpunkte) in eine glatte Form mit Kurven umwandeln.
// Trick: Wir zeichnen Kurven durch die Mitten zwischen den Punkten.
function outlineToPath(outline) {
  if (outline.length < 2) return { path: new Path2D(), box: null };

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let d = `M${outline[0][0].toFixed(2)},${outline[0][1].toFixed(2)} Q`;

  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i];
    const [x1, y1] = outline[(i + 1) % outline.length];
    d += `${x0.toFixed(2)},${y0.toFixed(2)} ${((x0 + x1) / 2).toFixed(2)},${((y0 + y1) / 2).toFixed(2)} `;
    if (x0 < minX) minX = x0;
    if (y0 < minY) minY = y0;
    if (x0 > maxX) maxX = x0;
    if (y0 > maxY) maxY = y0;
  }
  d += 'Z';

  return { path: new Path2D(d), box: { minX, minY, maxX, maxY } };
}

// ---------- Radierer ----------

// Abstand eines Punktes (px, py) zu einer Strecke von a nach b
function distanceToSegment(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t)); // auf die Strecke begrenzen
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// Berührt ein Radierer-Kreis (Mitte x/y, Radius r) diesen Strich?
export function strokeHit(stroke, x, y, r) {
  const b = stroke.box;
  if (!b) return false;
  // Schneller Vortest: liegt der Kreis überhaupt in der Nähe?
  if (x < b.minX - r || x > b.maxX + r || y < b.minY - r || y > b.maxY + r) return false;

  const reach = r + stroke.size / 2;
  const pts = stroke.points;
  if (pts.length === 1) return Math.hypot(x - pts[0][0], y - pts[0][1]) <= reach;
  for (let i = 1; i < pts.length; i++) {
    if (distanceToSegment(x, y, pts[i - 1], pts[i]) <= reach) return true;
  }
  return false;
}
