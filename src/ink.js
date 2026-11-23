// ink.js – Striche: aus Stiftpunkten eine schöne, glatte Linie machen
//
// Ein Strich ist eine Liste von Punkten [x, y, druck].
// Die Bibliothek "perfect-freehand" macht daraus den Umriss einer Linie,
// die dort dicker ist, wo du fester drückst. Den Umriss füllen wir mit Farbe.
//
// Jede Stiftart bekommt eigene Einstellungen – und ein paar eigene Tricks:
//   Kugelschreiber: fast gleich dick, egal wie fest du drückst
//   Füller:         Druck macht ihn deutlich dicker, dazu eine schräge Feder
//                   (Abstriche dicker, Querstriche dünner), weiche Anfänge und Enden
//   Filzstift:      gleichmäßig breit, deckend, mit leicht weichem Rand
//   Pinsel:         leicht = haarfein, fest = sehr breit, spitze Enden, durchscheinender Rand
//   Textmarker:     breit, durchsichtig, gerade Enden, wird beim Übermalen nicht dunkler

import { getStroke } from 'perfect-freehand';

// thinning:   wie stark der Druck die Dicke ändert (0 = gar nicht, 1 = sehr stark)
// smoothing:  wie rund der Umriss wird
// streamline: wie stark Zittern ausgeglichen wird (hoch = glatter, aber "hinterher")
// curve:      Druck-Kurve (> 1: leichter Druck wirkt noch leichter)
// taperStart/taperEnd: wie lang die Spitze am Anfang/Ende ist (mal Dicke)
// layers:     mehrere Umrisse übereinander: scale = Dicke, grow = etwas breiter, alpha = Deckkraft
export const PEN_STYLES = {
  ballpoint: {
    thinning: 0.12, smoothing: 0.5, streamline: 0.42, cap: true,
    layers: [{ scale: 1, alpha: 1 }],
  },
  fountain: {
    thinning: 0.86, smoothing: 0.6, streamline: 0.35, cap: true, curve: 1.15,
    nib: true, taperStart: 2.2, taperEnd: 3.2,
    layers: [{ scale: 1, alpha: 1 }],
  },
  felt: {
    thinning: 0.03, smoothing: 0.7, streamline: 0.45, cap: true,
    layers: [{ scale: 1, grow: 1.4, alpha: 0.3 }, { scale: 1, alpha: 1 }],
  },
  brush: {
    thinning: 0.95, smoothing: 0.75, streamline: 0.4, cap: true, curve: 1.7,
    taperStart: 4, taperEnd: 6,
    layers: [{ scale: 1, alpha: 0.3 }, { scale: 0.72, alpha: 0.95 }],
  },
  highlighter: {
    thinning: 0, smoothing: 0.5, streamline: 0.5, cap: false,
    layers: [{ scale: 1, alpha: 1 }],
  },
};

// Winkel der schrägen Füller-Feder (wie beim Schönschreiben, etwa 40° nach rechts oben)
const NIB_ANGLE = (-40 * Math.PI) / 180;

function styleOf(stroke) {
  return PEN_STYLES[stroke.penType] || PEN_STYLES.ballpoint;
}

// Einen neuen, leeren Strich anlegen
export function createStroke({ tool = 'pen', penType = 'ballpoint', color, size, opacity = 1, simulatePressure, z = 0 }) {
  return {
    tool,               // 'pen' oder 'highlighter'
    penType,            // Schlüssel aus PEN_STYLES
    color,
    size,               // Dicke in Seiten-Einheiten (Seite ist 1000 breit)
    opacity,            // nur beim Textmarker (0 bis 1)
    simulatePressure,   // true bei Maus: Druck aus der Geschwindigkeit "raten"
    z,                  // Reihenfolge: Striche mit kleinerem z liegen weiter unten
    points: [],         // [[x, y, druck], ...]
    layers: null,       // fertige Formen zum Zeichnen: [{ path: Path2D, alpha }]
    box: null,          // umgebendes Rechteck {minX, minY, maxX, maxY}
  };
}

// Schräge Feder: Der Druck wird je nach Schreibrichtung etwas kleiner oder größer.
// Bewegst du den Stift quer zur Feder, ist der Strich breit, entlang der Feder schmal.
// Die Richtung messen wir über ein paar Punkte hinweg, damit sie nicht zittert.
function applyNib(points, fixedPressure) {
  const n = points.length;
  const out = new Array(n);
  let factor = 0.75;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 2)];
    const b = points[Math.min(n - 1, i + 2)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx * dx + dy * dy > 0.25) {
      factor = 0.3 + 0.7 * Math.abs(Math.sin(Math.atan2(dy, dx) - NIB_ANGLE));
    }
    const pressure = fixedPressure ?? points[i][2] ?? 0.5;
    out[i] = [points[i][0], points[i][1], Math.min(1, pressure * factor * 1.5)];
  }
  return out;
}

// Aus den Punkten die Umrisse berechnen.
// extraPoints: vorhergesagte Punkte (nur fürs Anzeigen, werden nicht gespeichert)
// finished: true, wenn der Stift wieder abgehoben wurde
export function buildPath(stroke, extraPoints = [], finished = false) {
  const style = styleOf(stroke);
  let points = extraPoints.length ? stroke.points.concat(extraPoints) : stroke.points;
  let simulate = stroke.simulatePressure && style.thinning > 0;
  if (style.nib) {
    points = applyNib(points, stroke.simulatePressure ? 0.5 : undefined);
    simulate = false; // der Füller rechnet den Druck selbst aus
  }
  const curve = style.curve || 1;

  const layers = [];
  let box = null;
  for (const layer of style.layers) {
    const size = stroke.size * layer.scale + (layer.grow || 0);
    const outline = getStroke(points, {
      size,
      thinning: style.thinning,
      smoothing: style.smoothing,
      streamline: style.streamline,
      easing: (p) => Math.pow(p, curve),
      simulatePressure: simulate,
      start: { cap: style.cap, taper: style.taperStart ? style.taperStart * size : 0 },
      // Die Spitze am Ende erst beim Abheben – sonst "zuckt" das Ende beim Schreiben
      end: { cap: style.cap, taper: finished && style.taperEnd ? style.taperEnd * size : 0 },
      last: finished,
    });
    const shape = outlineToPath(outline);
    if (!shape.box) continue;
    layers.push({ path: shape.path, alpha: layer.alpha });
    box = box ? unionBox(box, shape.box) : shape.box;
  }
  return { layers, box };
}

function unionBox(a, b) {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// Strich fertig machen: endgültige Form berechnen und speichern
export function finishStroke(stroke) {
  const { layers, box } = buildPath(stroke, [], true);
  stroke.layers = layers;
  stroke.box = box;
  return stroke;
}

// Farbe mit Weiß mischen: so sieht der Textmarker auf weißem Papier aus.
// opacity 1 = volle Farbe, 0 = weiß
export function highlighterColor(hex, opacity) {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c) => Math.round(255 - (255 - c) * opacity);
  return `rgb(${mix((n >> 16) & 255)}, ${mix((n >> 8) & 255)}, ${mix(n & 255)})`;
}

// Einen Strich auf einen Zeichen-Kontext malen. built = Ergebnis von buildPath (Standard: der fertige Strich)
//
// Der Textmarker malt mit "darken" (abdunkeln): Pro Farbkanal gewinnt der dunklere Wert.
//  - Schrift darunter ist dunkler -> bleibt genau so sichtbar
//  - zweimal derselbe Marker übereinander -> gleich dunkel, wird NICHT dunkler (wie gewünscht)
export function fillStroke(ctx, stroke, built = stroke) {
  if (!built.layers) return;
  ctx.save();
  if (stroke.tool === 'highlighter') {
    ctx.globalCompositeOperation = 'darken';
    ctx.fillStyle = highlighterColor(stroke.color, stroke.opacity ?? 0.45);
  } else {
    ctx.fillStyle = stroke.color;
  }
  for (const layer of built.layers) {
    ctx.globalAlpha = layer.alpha;
    ctx.fill(layer.path);
  }
  ctx.restore();
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
    .map((pts) => finishStroke({ ...stroke, points: pts, layers: null, box: null }));
}
