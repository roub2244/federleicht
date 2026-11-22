// ink.js – Striche: aus Stiftpunkten eine schöne, glatte Linie machen
//
// Ein Strich ist einfach eine Liste von Punkten [x, y, druck].
// Die Bibliothek "perfect-freehand" macht daraus den Umriss einer Linie,
// die dort dicker ist, wo du fester drückst. Den Umriss füllen wir dann
// mit Farbe – so entsteht eine Linie, die wie mit echter Tinte aussieht.

import { getStroke } from 'perfect-freehand';

// Stiftarten: Jede Art ist nur eine andere Einstellung für perfect-freehand.
//   thinning:   wie stark der Druck die Dicke ändert (0 = gar nicht, 1 = sehr stark)
//   smoothing:  wie rund der Umriss wird
//   streamline: wie stark Zittern ausgeglichen wird (hoch = glatter, aber "hinterher")
//   cap:        runde Enden (true) oder gerade abgeschnitten (false)
export const PEN_STYLES = {
  fountain: { thinning: 0.6, smoothing: 0.55, streamline: 0.3, cap: true },   // Füller
  ballpoint: { thinning: 0.15, smoothing: 0.5, streamline: 0.35, cap: true }, // Kugelschreiber
  brush: { thinning: 0.9, smoothing: 0.65, streamline: 0.3, cap: true },      // Pinsel
  highlighter: { thinning: 0, smoothing: 0.5, streamline: 0.45, cap: false }, // Textmarker
};

function styleOf(stroke) {
  return PEN_STYLES[stroke.penType] || PEN_STYLES.fountain;
}

// Einen neuen, leeren Strich anlegen
export function createStroke({ tool = 'pen', penType = 'fountain', color, size, simulatePressure, z = 0 }) {
  return {
    tool,               // 'pen' oder 'highlighter'
    penType,            // Schlüssel aus PEN_STYLES
    color,
    size,               // Dicke in Seiten-Einheiten (Seite ist 1000 breit)
    simulatePressure,   // true bei Maus: Druck aus der Geschwindigkeit "raten"
    z,                  // Reihenfolge: Striche mit kleinerem z liegen weiter unten
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
  const style = styleOf(stroke);
  const outline = getStroke(points, {
    thinning: style.thinning,
    smoothing: style.smoothing,
    streamline: style.streamline,
    start: { cap: style.cap, taper: 0 },
    end: { cap: style.cap, taper: 0 },
    size: stroke.size,
    simulatePressure: stroke.simulatePressure && style.thinning > 0,
    last: finished,
  });
  return outlineToPath(outline);
}

// Strich fertig machen: endgültige Form berechnen und speichern
export function finishStroke(stroke) {
  const { path, box } = buildPath(stroke, [], true);
  stroke.path = path;
  stroke.box = box;
  return stroke;
}

// Einen Strich auf einen Zeichen-Kontext malen.
// Der Textmarker malt mit "multiply" (multiplizieren): Weiß wird zur Markerfarbe,
// Schwarz bleibt schwarz. So bleibt Schrift unter dem Marker gut lesbar – wie echt.
export function fillStroke(ctx, stroke, path = stroke.path) {
  ctx.fillStyle = stroke.color;
  if (stroke.tool === 'highlighter') {
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fill(path);
    ctx.restore();
  } else {
    ctx.fill(path);
  }
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

// ---------- Bereichs-Radierer ----------

// Zwischen weit auseinanderliegenden Punkten neue Punkte einfügen (alle "step" Einheiten).
// Sonst könnte der Radierer zwischen zwei Punkten nichts treffen.
function densify(points, step) {
  const result = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      result.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
    }
  }
  return result;
}

// Ein Loch (Kreis um x/y mit Radius r) in einen Strich radieren.
// Gibt die übrig gebliebenen Stücke als neue, fertige Striche zurück
// (leere Liste = alles weg) oder null, wenn der Kreis den Strich gar nicht berührt.
export function cutStroke(stroke, x, y, r) {
  // Runde Enden ragen eine halbe Dicke über den letzten Punkt hinaus
  const reach = r + (styleOf(stroke).cap ? stroke.size / 2 : 0);
  const step = Math.max(0.5, Math.min(r, stroke.size) / 3);
  const points = densify(stroke.points, step);

  const pieces = [];
  let piece = [];
  let removedAny = false;
  for (const p of points) {
    if (Math.hypot(p[0] - x, p[1] - y) < reach) {
      removedAny = true;
      if (piece.length) pieces.push(piece);
      piece = [];
    } else {
      piece.push(p);
    }
  }
  if (piece.length) pieces.push(piece);
  if (!removedAny) return null;

  return pieces
    .filter((pts) => pts.length >= 2) // winzige Krümel weglassen
    .map((pts) => finishStroke({ ...stroke, points: pts, path: null, box: null }));
}
