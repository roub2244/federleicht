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
import { drawText, transformText, recolorText } from './text.js';
import { apply as applyMatrix, scaleOf } from './geometry.js';
import { drawImageItem, transformImage } from './media.js';
import { thinPoints } from './steady.js';
import { drawFill, transformFill, fillContains } from './fill.js';

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
    thinning: 0.8, smoothing: 0.6, streamline: 0.4, cap: true,
    nib: true, taperStart: 1.2, taperEnd: 2.2, smoothPressure: 3,
    layers: [{ scale: 1, alpha: 1 }],
  },
  felt: {
    thinning: 0.03, smoothing: 0.7, streamline: 0.45, cap: true,
    layers: [{ scale: 1, grow: 1.4, alpha: 0.3 }, { scale: 1, alpha: 1 }],
  },
  brush: {
    thinning: 0.95, smoothing: 0.75, streamline: 0.4, cap: true, curve: 1.7,
    taperStart: 4, taperEnd: 6, smoothPressure: 2,
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
export function createStroke({ tool = 'pen', penType = 'ballpoint', color, size, opacity = 1, simulatePressure, z = 0, shape = null, fill = null, fillAlpha = 0 }) {
  return {
    shape,              // Form (z. B. 'rect', 'circle') oder null = freihand (siehe shapes.js)
    fill,               // Füllfarbe einer geschlossenen Form (oder null)
    fillAlpha,          // Deckkraft der Füllung (0 bis 1)
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
//
// Wichtig für ein sauberes Schriftbild: Der Füller wird NIE haarfein.
//   - Mindest-Druck NIB_FLOOR: auch ganz leichtes Schreiben gibt eine klare Linie
//   - Die Feder macht Querstriche höchstens auf NIB_MIN schmaler (nicht fast unsichtbar)
const NIB_FLOOR = 0.25;
const NIB_MIN = 0.55;
function applyNib(points, fixedPressure) {
  const n = points.length;
  const out = new Array(n);
  let factor = 0.8;
  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 2)];
    const b = points[Math.min(n - 1, i + 2)];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    if (dx * dx + dy * dy > 0.25) {
      const target = NIB_MIN + (1 - NIB_MIN) * Math.abs(Math.sin(Math.atan2(dy, dx) - NIB_ANGLE));
      factor += (target - factor) * 0.6; // weich überblenden, kein Springen in Kurven
    }
    const pressure = fixedPressure ?? points[i][2] ?? 0.5;
    const firm = NIB_FLOOR + (1 - NIB_FLOOR) * Math.min(1, pressure * 1.2);
    out[i] = [points[i][0], points[i][1], firm * factor];
  }
  return out;
}

// Druck leicht glätten (gleitender Durchschnitt über "radius" Nachbarn auf jeder Seite).
// Der Stift misst den Druck sehr genau – auch das Zittern. Ungeglättet "pumpt" die Linie.
function smoothPressure(points, radius) {
  const n = points.length;
  if (n < 3) return points;
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    let count = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(n - 1, i + radius); k++) {
      sum += points[k][2];
      count++;
    }
    out[i] = [points[i][0], points[i][1], sum / count];
  }
  return out;
}

// Gesamtlänge eines Strichs
function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
  }
  return length;
}

// Spitze Enden: höchstens ein Teil der Strichlänge. Sonst bestünden kurze Striche
// (i-Punkte, kleine Buchstaben) nur aus Spitze und wären fast unsichtbar – "Lücken".
function taperLength(factor, size, length, share) {
  // Ganz kurze Striche (Punkte, Kommas) bekommen gar keine Spitze, sondern runde Enden.
  // (Mit Spitze wäre JEDER Punkt des Strichs "Spitze" – und damit unsichtbar dünn.)
  if (!factor || length < size * 5) return 0;
  return Math.min(factor * size, length * share);
}

// Aus den Punkten die Umrisse berechnen.
// extraPoints: vorhergesagte Punkte (nur fürs Anzeigen, werden nicht gespeichert)
// finished: true, wenn der Stift wieder abgehoben wurde
export function buildPath(stroke, extraPoints = [], finished = false) {
  const style = styleOf(stroke);
  // Viel zu dicht liegende Punkte zusammenfassen (sonst wackelt langsam Geschriebenes, siehe steady.js)
  let points = stroke.shape ? stroke.points : thinPoints(stroke.points, Math.max(0.5, stroke.size * 0.12));
  if (extraPoints.length) points = points.concat(extraPoints);
  let simulate = stroke.simulatePressure && style.thinning > 0;
  if (style.smoothPressure && !stroke.simulatePressure) points = smoothPressure(points, style.smoothPressure);
  if (style.nib) {
    points = applyNib(points, stroke.simulatePressure ? 0.5 : undefined);
    simulate = false; // der Füller rechnet den Druck selbst aus
  }
  const curve = style.curve || 1;
  // Formen: Punkte genau so nehmen, wie sie sind (kein Glätten, das die Ecken abrunden würde), keine Spitzen
  const isShape = Boolean(stroke.shape);
  const length = !isShape && (style.taperStart || style.taperEnd) ? pathLength(points) : 0;

  const layers = [];
  let box = null;
  for (const layer of style.layers) {
    const size = stroke.size * layer.scale + (layer.grow || 0);
    const outline = getStroke(points, {
      size,
      thinning: style.thinning,
      smoothing: isShape ? 0.35 : style.smoothing,
      streamline: isShape ? 0 : style.streamline,
      easing: (p) => Math.pow(p, curve),
      simulatePressure: simulate,
      start: { cap: style.cap, taper: taperLength(style.taperStart, size, length, 0.2) },
      // Die Spitze am Ende erst beim Abheben – sonst "zuckt" das Ende beim Schreiben
      end: { cap: style.cap, taper: finished ? taperLength(style.taperEnd, size, length, 0.25) : 0 },
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
  stroke.fillPath = stroke.fill && stroke.fillAlpha > 0 ? polygonPath(stroke.points) : null;
  return stroke;
}

// Füllung einer geschlossenen Form: einfach die Punkte als Vieleck
function polygonPath(points) {
  const path = new Path2D();
  points.forEach((p, i) => (i ? path.lineTo(p[0], p[1]) : path.moveTo(p[0], p[1])));
  path.closePath();
  return path;
}

// ---------- Verschieben, drehen, vergrößern (Lasso) ----------
// Eine verwandelte KOPIE eines Strichs (oder Textfelds) machen. m = Matrix (siehe geometry.js)
// Die Dicke wächst mit, wenn man vergrößert – wie in Samsung Notes.
export function transformStroke(stroke, m) {
  if (stroke.tool === 'text') return transformText(stroke, m);
  if (stroke.tool === 'image') return transformImage(stroke, m);
  if (stroke.tool === 'fill') return transformFill(stroke, m);
  const k = scaleOf(m);
  const copy = {
    ...stroke,
    points: stroke.points.map((p) => {
      const [x, y] = applyMatrix(m, p);
      return [x, y, p[2]];
    }),
    size: stroke.size * k,
    layers: null,
    box: null,
  };
  delete copy.hidden;
  return finishStroke(copy);
}

// Kopie mit anderen Eigenschaften (z. B. Farbe), Form wird neu berechnet
export function recolorStroke(stroke, color) {
  if (stroke.tool === 'text') return recolorText(stroke, color);
  if (stroke.tool === 'image') return { ...stroke }; // Bilder behalten ihre Farben
  if (stroke.tool === 'fill') return { ...stroke, color };
  const copy = { ...stroke, color, layers: null, box: null };
  if (copy.fill) copy.fill = color;
  return finishStroke(copy);
}

// Kopie mit neuer z-Nummer (Reihenfolge: weiter vorne oder hinten)
export function withZ(stroke, z) {
  const copy = { ...stroke, z };
  if (stroke.tool === 'text') return copy;
  return copy; // die fertige Form (layers) darf geteilt werden, sie ändert sich nie
}

// ---------- Helles oder dunkles Blatt ----------
// Der Renderer stellt das vor dem Malen jeder Seite ein:
//   dark   dunkles Blatt (Dunkelmodus)
//   paper  Farbe des Blatts (zum Mischen für den Textmarker)
export const inkTheme = { dark: false, paper: '#ffffff' };

export function setInkTheme(dark, paper) {
  inkTheme.dark = dark;
  inkTheme.paper = paper;
}

const rgbOf = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const hexOf = (r, g, b) => '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);

// Auf dem dunklen Blatt: Schwarz wird Weiß und Weiß wird Schwarz – wie bei Samsung Notes.
// Graue Farben werden umgedreht, sehr dunkle bunte Farben etwas aufgehellt,
// alle anderen Farben bleiben genau so, wie du sie ausgesucht hast.
const darkCache = new Map();
export function displayColor(hex) {
  if (!inkTheme.dark || !hex || hex[0] !== '#' || hex.length !== 7) return hex;
  let out = darkCache.get(hex);
  if (out) return out;
  const [r, g, b] = rgbOf(hex);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max - min < 28) {
    // Grau (auch Schwarz und Weiß): Helligkeit umdrehen
    const v = Math.round(Math.min(255, Math.max(0, 238 - light * 0.88)));
    const shift = (c) => Math.min(255, Math.max(0, v + (c - light) * 0.5));
    out = hexOf(shift(r), shift(g), shift(b));
  } else if (light < 70) {
    // Sehr dunkle Farbe (z. B. Dunkelblau) wäre auf dunklem Papier kaum zu sehen: aufhellen
    const t = (70 - light) / 70 * 0.55;
    out = hexOf(...[r, g, b].map((c) => Math.round(c + (255 - c) * t)));
  } else {
    out = hex;
  }
  darkCache.set(hex, out);
  return out;
}

// Textmarker-Farbe: so sieht der Marker auf dem Papier aus.
// opacity 1 = volle Farbe, 0 = Papierfarbe
export function highlighterColor(hex, opacity, paper = '#ffffff') {
  const [r, g, b] = rgbOf(hex);
  const [pr, pg, pb] = rgbOf(paper);
  const mix = (c, p) => Math.round(p + (c - p) * opacity);
  return `rgb(${mix(r, pr)}, ${mix(g, pg)}, ${mix(b, pb)})`;
}

// Einen Strich auf einen Zeichen-Kontext malen. built = Ergebnis von buildPath (Standard: der fertige Strich)
//
// Der Textmarker malt auf hellem Papier mit "darken" (abdunkeln): Pro Farbkanal gewinnt der dunklere Wert.
//  - Schrift darunter ist dunkler -> bleibt genau so sichtbar
//  - zweimal derselbe Marker übereinander -> gleich dunkel, wird NICHT dunkler (wie gewünscht)
// Auf dunklem Papier ist es genau andersherum: "lighten" (aufhellen) – die helle Schrift bleibt oben.
export function fillStroke(ctx, stroke, built = stroke) {
  // Textfelder liegen mit in der Liste der Striche, malen sich aber selbst (siehe text.js)
  if (stroke.tool === 'text') return drawText(ctx, stroke);
  if (stroke.tool === 'image') return drawImageItem(ctx, stroke);
  if (stroke.tool === 'fill') return drawFill(ctx, stroke, displayColor(stroke.color));
  // Frisch geladene Striche bekommen ihre Form erst, wenn sie zum ersten Mal zu sehen sind
  if (!built.layers && built === stroke && stroke.points.length) finishStroke(stroke);
  if (!built.layers) return;
  ctx.save();
  if (stroke.fillPath && built === stroke) {
    // Füllung zuerst, der Rand kommt darüber
    ctx.fillStyle = displayColor(stroke.fill);
    ctx.globalAlpha = stroke.fillAlpha;
    ctx.fill(stroke.fillPath);
    ctx.globalAlpha = 1;
  }
  if (stroke.tool === 'highlighter') {
    const opacity = stroke.opacity ?? 0.45;
    if (inkTheme.dark) {
      ctx.globalCompositeOperation = 'lighten';
      ctx.fillStyle = highlighterColor(stroke.color, 0.3 + opacity * 0.7, inkTheme.paper); // auf Dunkel etwas kräftiger
    } else {
      ctx.globalCompositeOperation = 'darken';
      ctx.fillStyle = highlighterColor(stroke.color, opacity, inkTheme.paper);
    }
  } else {
    ctx.fillStyle = displayColor(stroke.color);
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
  // Text und Bilder radiert man nicht weg, man löscht sie mit dem Lasso
  if (stroke.tool === 'text' || stroke.tool === 'image') return false;
  // Füllungen: getroffen, wenn der Radierer mitten in der Fläche ist
  if (stroke.tool === 'fill') return fillContains(stroke, x, y);
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
  if (stroke.tool === 'text' || stroke.tool === 'image') return null;
  if (stroke.tool === 'fill') return fillContains(stroke, x, y) ? [] : null; // Füllung ganz weg
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
    .map((pts) => finishStroke({ ...stroke, points: pts, layers: null, box: null, fill: null, fillAlpha: 0, fillPath: null }));
}
