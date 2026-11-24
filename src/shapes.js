// shapes.js – Formen: perfekte Linien, Pfeile, Rechtecke, Kreise, Dreiecke …
//
// Zwei Wege zu einer Form (wie in Samsung Notes):
//
//  1. Formen-Werkzeug: Form aussuchen und auf der Seite aufziehen (shapeFromDrag).
//  2. Formerkennung: Mit einem normalen Stift ungefähr zeichnen und am Ende den Stift
//     kurz stillhalten. recognizeShape() schaut sich den Strich an und macht daraus
//     die perfekte Form – Kreis, Ellipse, Rechteck, Dreieck, Vieleck, Pfeil, Winkel oder Linie.
//
// Eine Form ist am Ende ein ganz normaler Strich (Punkte mit Druck). Darum kann man sie
// radieren, mit dem Lasso verschieben, rückgängig machen und speichern wie alles andere.
// Geschlossene Formen können zusätzlich gefüllt sein (stroke.fill, siehe ink.js).

import { dist, pathLength, resample, simplify, segmentDistance, boundsOf, snapAngle, DEG } from './geometry.js';

// ---------- Die Formen des Formen-Werkzeugs ----------
// icon: kleines SVG-Bild (24 × 24) für das Menü
export const SHAPE_KINDS = [
  { id: 'line', name: 'Linie', icon: '<path d="M4 19 20 5"/>' },
  { id: 'arrow', name: 'Pfeil', icon: '<path d="M4 19 19 6M11 6h8v8"/>' },
  { id: 'double', name: 'Doppelpfeil', icon: '<path d="M5 19 19 5M5 12v7h7M12 5h7v7"/>' },
  { id: 'rect', name: 'Rechteck', icon: '<rect x="3.5" y="6" width="17" height="12" rx="1"/>' },
  { id: 'ellipse', name: 'Kreis / Ellipse', icon: '<ellipse cx="12" cy="12" rx="8.5" ry="7.5"/>' },
  { id: 'triangle', name: 'Dreieck', icon: '<path d="M12 4.5 20.5 19h-17z"/>' },
  { id: 'right', name: 'Rechtwinkliges Dreieck', icon: '<path d="M4.5 4.5v14.5h15z M4.5 15h4v4"/>' },
  { id: 'diamond', name: 'Raute', icon: '<path d="M12 3.5 20 12l-8 8.5L4 12z"/>' },
  { id: 'pentagon', name: 'Fünfeck', icon: '<path d="m12 3.5 8.5 6.2-3.2 10h-10.6l-3.2-10z"/>' },
  { id: 'hexagon', name: 'Sechseck', icon: '<path d="M7.5 4.5h9L21 12l-4.5 7.5h-9L3 12z"/>' },
  { id: 'star', name: 'Stern', icon: '<path d="m12 3 2.6 5.6 6 .7-4.5 4.1 1.2 6-5.3-3-5.3 3 1.2-6L3.4 9.3l6-.7z"/>' },
  { id: 'axes', name: 'Koordinatensystem', icon: '<path d="M4 12h16M12 20V4M17 9.5l3 2.5-3 2.5M9.5 7 12 4l2.5 3"/>' },
];

export const FILL_MODES = [
  { id: 'none', name: 'Ohne', alpha: 0 },
  { id: 'soft', name: 'Hell', alpha: 0.22 },
  { id: 'solid', name: 'Voll', alpha: 1 },
];

// Kann diese Form gefüllt werden?
export const fillable = (kind) => !['line', 'arrow', 'double', 'axes', 'angle'].includes(kind);

const ARROW_ANGLE = 28 * DEG; // so weit stehen die Spitzen-Striche vom Schaft ab

// ---------- Formen aufziehen ----------
//
// a = wo der Stift aufgesetzt hat, b = wo er gerade ist (Seiten-Koordinaten).
// size = Strichdicke (für die Größe der Pfeilspitzen).
// Ergebnis: Liste von Linienzügen { pts: [[x, y], …], closed } – meistens nur einer,
// beim Koordinatensystem mehrere (Achsen und Striche).
export function shapeFromDrag(kind, a, b, size = 2) {
  let [x0, y0] = a;
  let [x1, y1] = b;

  if (kind === 'line' || kind === 'arrow' || kind === 'double') {
    // Fast waagerecht, senkrecht oder 45°? Dann genau so.
    const angle = snapAngle(Math.atan2(y1 - y0, x1 - x0), 45 * DEG, 4 * DEG);
    const length = Math.hypot(x1 - x0, y1 - y0);
    const end = [x0 + Math.cos(angle) * length, y0 + Math.sin(angle) * length];
    if (kind === 'line') return [{ pts: [a, end], closed: false }];
    const head = headLength(length, size);
    if (kind === 'arrow') return [{ pts: arrowPath([x0, y0], end, head), closed: false }];
    return [{ pts: doubleArrowPath([x0, y0], end, head), closed: false }];
  }

  // Fast quadratisch? Dann genau quadratisch (bzw. ein Kreis)
  const w = Math.abs(x1 - x0);
  const h = Math.abs(y1 - y0);
  if (Math.abs(w - h) < Math.max(w, h) * 0.08) {
    const s = Math.max(w, h);
    x1 = x0 + Math.sign(x1 - x0 || 1) * s;
    y1 = y0 + Math.sign(y1 - y0 || 1) * s;
  }
  const minX = Math.min(x0, x1);
  const maxX = Math.max(x0, x1);
  const minY = Math.min(y0, y1);
  const maxY = Math.max(y0, y1);
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;

  switch (kind) {
    case 'rect':
      return [{ pts: [[minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY]], closed: true }];
    case 'ellipse':
      return [{ pts: ellipsePoints(cx, cy, rx, ry, 0), closed: true, smooth: true }];
    case 'triangle':
      return [{ pts: [[cx, minY], [maxX, maxY], [minX, maxY]], closed: true }];
    case 'right': {
      // Der rechte Winkel liegt in der Ecke, an der du angefangen hast
      const corner = [x0, y1];
      return [{ pts: [[x0, y0], corner, [x1, y1]], closed: true }];
    }
    case 'diamond':
      return [{ pts: [[cx, minY], [maxX, cy], [cx, maxY], [minX, cy]], closed: true }];
    case 'pentagon':
      return [{ pts: regularPolygon(5, cx, cy, rx, ry), closed: true }];
    case 'hexagon':
      return [{ pts: regularPolygon(6, cx, cy, rx, ry, 0), closed: true }];
    case 'star':
      return [{ pts: starPoints(cx, cy, rx, ry), closed: true }];
    case 'axes':
      return axesPaths(minX, minY, maxX, maxY, size);
    default:
      return [];
  }
}

function headLength(length, size) {
  return Math.min(length * 0.35, Math.max(14, size * 5.5));
}

// Pfeil von a nach b als EIN Linienzug: Schaft, dann die zwei Spitzen-Striche
function arrowPath(a, b, head) {
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) + Math.PI;
  const barb = (sign) => [b[0] + Math.cos(angle + sign * ARROW_ANGLE) * head, b[1] + Math.sin(angle + sign * ARROW_ANGLE) * head];
  return [a, b, barb(1), b, barb(-1)];
}

function doubleArrowPath(a, b, head) {
  const back = arrowPath(b, a, head); // [b, a, barb, a, barb]
  return [back[2], a, back[4], a, ...arrowPath(a, b, head).slice(1)];
}

function ellipsePoints(cx, cy, rx, ry, rot) {
  const n = Math.max(24, Math.min(160, Math.round((Math.PI * (rx + ry)) / 3)));
  const cos = Math.cos(rot);
  const sin = Math.sin(rot);
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const x = Math.cos(t) * rx;
    const y = Math.sin(t) * ry;
    pts.push([cx + x * cos - y * sin, cy + x * sin + y * cos]);
  }
  return pts;
}

// Regelmäßiges Vieleck im Rechteck (Spitze bzw. Kante oben)
function regularPolygon(n, cx, cy, rx, ry, start = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const t = start + (i / n) * Math.PI * 2;
    pts.push([Math.cos(t), Math.sin(t)]);
  }
  return fitInto(pts, cx, cy, rx, ry);
}

function starPoints(cx, cy, rx, ry) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const t = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 ? 0.4 : 1;
    pts.push([Math.cos(t) * r, Math.sin(t) * r]);
  }
  return fitInto(pts, cx, cy, rx, ry);
}

// Punkte so strecken, dass sie das Rechteck genau ausfüllen
function fitInto(pts, cx, cy, rx, ry) {
  const b = boundsOf(pts);
  const sx = (2 * rx) / (b.maxX - b.minX || 1);
  const sy = (2 * ry) / (b.maxY - b.minY || 1);
  const mx = (b.minX + b.maxX) / 2;
  const my = (b.minY + b.maxY) / 2;
  return pts.map(([x, y]) => [cx + (x - mx) * sx, cy + (y - my) * sy]);
}

// Koordinatensystem: zwei Achsen mit Pfeilspitze, dazu kleine Striche als Einteilung
function axesPaths(minX, minY, maxX, maxY, size) {
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const head = Math.max(12, size * 5);
  const paths = [
    { pts: arrowPath([minX, cy], [maxX, cy], head), closed: false },
    { pts: arrowPath([cx, maxY], [cx, minY], head), closed: false },
  ];
  // Einteilung: etwa alle 40 Einheiten (bei 1000 Seitenbreite ≈ 1 Kästchen), nicht zu dicht
  const span = Math.max(maxX - minX, maxY - minY);
  const step = span > 600 ? 50 : 40;
  const tick = Math.max(5, size * 2.5);
  for (let x = cx + step; x < maxX - head * 1.2; x += step) paths.push(tickPath([x, cy - tick], [x, cy + tick]));
  for (let x = cx - step; x > minX + 2; x -= step) paths.push(tickPath([x, cy - tick], [x, cy + tick]));
  for (let y = cy - step; y > minY + head * 1.2; y -= step) paths.push(tickPath([cx - tick, y], [cx + tick, y]));
  for (let y = cy + step; y < maxY - 2; y += step) paths.push(tickPath([cx - tick, y], [cx + tick, y]));
  return paths;
}

const tickPath = (a, b) => ({ pts: [a, b], closed: false });

// ---------- Aus Ecken einen Strich machen ----------
//
// perfect-freehand (siehe ink.js) braucht viele Punkte, damit die Linie überall gleich dick ist.
// Darum setzen wir alle "step" Einheiten einen Punkt. Bei geschlossenen Formen fangen wir
// in der Mitte einer Kante an – so sieht man nicht, wo der Strich anfängt und aufhört.
export function densify(poly, closed, pressure = 0.5, step = 2.5, smooth = false) {
  let pts = poly;
  if (closed && !smooth && pts.length > 2) {
    const mid = [(pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2];
    pts = [mid, ...pts.slice(1), pts[0], mid];
  } else if (closed) {
    pts = [...pts, pts[0], pts[1] || pts[0]];
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    if (i === 0) {
      out.push([a[0], a[1], pressure]);
      continue;
    }
    const prev = pts[i - 1];
    const n = smooth ? 1 : Math.max(1, Math.ceil(dist(prev, a) / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push([prev[0] + (a[0] - prev[0]) * t, prev[1] + (a[1] - prev[1]) * t, pressure]);
    }
  }
  return out;
}

// ---------- Formerkennung ----------
//
// points: der gezeichnete Strich ([x, y, druck], Seiten-Koordinaten)
// Ergebnis: { kind, pts, closed, smooth, pivot } oder null (= nichts erkannt).
//   pivot: Punkt, um den die Form beim Nachjustieren (Stift weiter unten lassen) gedreht/vergrößert wird
//
// Vorgehen:
//   1. Strich gleichmäßig neu abtasten (resample) – dann zählt jede Stelle gleich viel.
//   2. Geschlossen? (Ende kommt wieder in die Nähe vom Anfang)
//   3a. Geschlossen: Ecken suchen (simplify). 3–5 deutliche Ecken = Vieleck, sonst Ellipse/Kreis.
//   3b. Offen: Pfeil? Winkel (zwei Strecken)? Sonst eine gerade Linie.
//   4. "Aufräumen": fast waagerecht -> waagerecht, fast quadratisch -> Quadrat, fast rund -> Kreis …
export function recognizeShape(points, { onlyLine = false } = {}) {
  if (points.length < 2) return null;
  const start = points[0];
  const end = points[points.length - 1];
  const line = () => ({ kind: 'line', pts: [[start[0], start[1]], [end[0], end[1]]], closed: false, pivot: [start[0], start[1]] });
  // Gerade Linie nur, wenn der Strich wirklich ungefähr gerade war – eine Kurve oder ein
  // fast fertiger Kreis wird NICHT zur Linie (das wäre komisch).
  if (onlyLine) return isStraightish(resample(points, 64), 0.12) ? line() : null;

  const pts = resample(points, 96);
  const box = boundsOf(pts);
  const diag = Math.hypot(box.maxX - box.minX, box.maxY - box.minY);
  if (diag < 1) return null;
  const total = pathLength(pts);

  // ---- 2. Geschlossen? ----
  // Das Ende darf etwas über den Anfang hinausgehen ("Überschwinger") – das schneiden wir ab.
  let closeAt = -1;
  let gap = Infinity;
  for (let i = Math.floor(pts.length * 0.6); i < pts.length; i++) {
    const d = dist(pts[i], pts[0]);
    if (d < gap) {
      gap = d;
      closeAt = i;
    }
  }
  const closed = total > 1.6 * diag && gap < 0.2 * diag;
  if (closed) return recognizeClosed(pts.slice(0, closeAt + 1), diag);
  const open = recognizeOpen(pts, diag, total);
  if (open) return open;
  if (isStraightish(pts, 0.09)) return line();
  // Fast einmal rundherum (mindestens ~3/4 Kreis), aber nicht ganz geschlossen: Kreis/Ellipse daraus machen
  if (Math.abs(totalTurn(pts)) > 260 * DEG && total > 1.5 * diag) {
    const round = recognizeClosed(pts, diag);
    if (round && (round.kind === 'circle' || round.kind === 'ellipse')) return round;
  }
  return null; // zu kurvig für eine Linie -> Strich bleibt, wie er ist
}

// Ist der Strich "gerade genug" für eine Linie?
//  - Weg kaum länger als die direkte Strecke (Kurven und Schleifen sind viel länger)
//  - kein Punkt weiter als maxDev × Länge von der Strecke Anfang–Ende entfernt
// Ein leicht wackliger Strich ist ok, ein Bogen (z. B. Viertelkreis) nicht.
export function isStraightish(pts, maxDev = 0.15) {
  if (pts.length < 2) return false;
  const a = pts[0];
  const b = pts[pts.length - 1];
  const chord = dist(a, b);
  if (chord < 1e-6) return false;
  if (chord < pathLength(pts) * 0.85) return false;
  let worst = 0;
  for (const p of pts) worst = Math.max(worst, segmentDistance(p, a, b));
  return worst <= chord * maxDev;
}

// Wie weit dreht sich der Strich insgesamt? (Bogenmaß, Kreis = 2π)
function totalTurn(pts) {
  let sum = 0;
  let prev = null;
  for (let i = 1; i < pts.length; i++) {
    const dx = pts[i][0] - pts[i - 1][0];
    const dy = pts[i][1] - pts[i - 1][1];
    if (Math.hypot(dx, dy) < 1e-6) continue;
    const ang = Math.atan2(dy, dx);
    if (prev !== null) sum += Math.atan2(Math.sin(ang - prev), Math.cos(ang - prev));
    prev = ang;
  }
  return sum;
}

// ---------- Geschlossene Formen ----------
function recognizeClosed(loop, diag) {
  const n = loop.length;
  // Mittelpunkt
  let cx = 0, cy = 0;
  for (const p of loop) {
    cx += p[0];
    cy += p[1];
  }
  cx /= n;
  cy /= n;

  // --- Ellipse: Hauptachsen über die "Streuung" der Punkte finden ---
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of loop) {
    sxx += (x - cx) * (x - cx);
    syy += (y - cy) * (y - cy);
    sxy += (x - cx) * (y - cy);
  }
  let rot = 0.5 * Math.atan2(2 * sxy, sxx - syy); // Richtung der längsten Achse
  // Ausdehnung entlang der beiden Achsen (aus den äußersten Punkten)
  const cos = Math.cos(rot), sin = Math.sin(rot);
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of loop) {
    const u = (x - cx) * cos + (y - cy) * sin;
    const v = -(x - cx) * sin + (y - cy) * cos;
    u0 = Math.min(u0, u);
    u1 = Math.max(u1, u);
    v0 = Math.min(v0, v);
    v1 = Math.max(v1, v);
  }
  let rx = (u1 - u0) / 2;
  let ry = (v1 - v0) / 2;
  const ecx = cx + ((u0 + u1) / 2) * cos - ((v0 + v1) / 2) * sin;
  const ecy = cy + ((u0 + u1) / 2) * sin + ((v0 + v1) / 2) * cos;
  // Wie gut passt die Ellipse? Mittlerer Abstand der Punkte zur Ellipse (grob)
  let ellErr = 0;
  for (const [x, y] of loop) {
    const u = (x - ecx) * cos + (y - ecy) * sin;
    const v = -(x - ecx) * sin + (y - ecy) * cos;
    const r = Math.hypot(u / (rx || 1), v / (ry || 1));
    ellErr += Math.abs(r - 1) * Math.sqrt(rx * ry);
  }
  ellErr /= n * diag;

  // --- Vieleck: Ecken suchen ---
  // Anfangen an dem Punkt, der am weitesten vom Mittelpunkt weg ist (der ist sicher eine Ecke)
  let far = 0;
  for (let i = 1; i < n; i++) if (dist(loop[i], [cx, cy]) > dist(loop[far], [cx, cy])) far = i;
  const ring = [...loop.slice(far), ...loop.slice(0, far)];
  ring.push(ring[0]);
  let corners = simplify(ring, diag * 0.055).slice(0, -1);
  corners = mergeFlatCorners(corners, 32 * DEG);
  const polyErr = polygonError(loop, corners) / diag;
  const sharp = corners.length >= 3 && minTurn(corners) > 32 * DEG;

  const isPolygon = corners.length >= 3 && corners.length <= 5 && sharp && polyErr < 0.03 && polyErr < ellErr * 1.15;
  if (isPolygon) return cleanPolygon(corners, diag);

  if (ellErr < 0.09) {
    // Fast rund -> Kreis. Fast gerade Achsen -> gerade.
    if (Math.min(rx, ry) / Math.max(rx, ry) > 0.85) {
      const r = (rx + ry) / 2;
      rx = ry = r;
      rot = 0;
    } else {
      rot = snapAngle(rot, 90 * DEG, 12 * DEG);
    }
    return { kind: rx === ry ? 'circle' : 'ellipse', pts: ellipsePoints(ecx, ecy, rx, ry, rot), closed: true, smooth: true, pivot: [ecx, ecy] };
  }
  if (corners.length >= 3 && corners.length <= 6 && polyErr < 0.035) return cleanPolygon(corners, diag);
  return null;
}

// Ecken, an denen der Strich kaum abknickt, weglassen
function mergeFlatCorners(corners, minAngle) {
  let list = corners.slice();
  let changed = true;
  while (changed && list.length > 3) {
    changed = false;
    for (let i = 0; i < list.length; i++) {
      if (turnAt(list, i) < minAngle) {
        list.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return list;
}

// Wie stark knickt der Linienzug an Ecke i ab? (0 = gar nicht, π = kehrt um)
function turnAt(list, i) {
  const a = list[(i - 1 + list.length) % list.length];
  const b = list[i];
  const c = list[(i + 1) % list.length];
  const a1 = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const a2 = Math.atan2(c[1] - b[1], c[0] - b[0]);
  let d = Math.abs(a2 - a1) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

function minTurn(list) {
  let m = Infinity;
  for (let i = 0; i < list.length; i++) m = Math.min(m, turnAt(list, i));
  return m;
}

function polygonError(loop, corners) {
  let sum = 0;
  for (const p of loop) {
    let best = Infinity;
    for (let i = 0; i < corners.length; i++) {
      best = Math.min(best, segmentDistance(p, corners[i], corners[(i + 1) % corners.length]));
    }
    sum += best;
  }
  return sum / loop.length;
}

// Ecken "aufräumen": Rechtecke rechtwinklig, Kanten gerade, Dreiecke gleichmäßig
function cleanPolygon(corners, diag) {
  let pts = corners.map((p) => [p[0], p[1]]);
  const center = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);

  if (pts.length === 4 && isRoughlyRectangle(pts)) {
    // Ausrichtung: Mittelwert der Kantenrichtungen (modulo 90°)
    let vx = 0, vy = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % 4];
      const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 4;
      const len = dist(a, b);
      vx += Math.cos(ang) * len;
      vy += Math.sin(ang) * len;
    }
    const rot = snapAngle(Math.atan2(vy, vx) / 4, 90 * DEG, 9 * DEG);
    const cos = Math.cos(rot), sin = Math.sin(rot);
    // Größe: über die Ecken gemittelt
    let w = 0, h = 0;
    const loc = pts.map(([x, y]) => [(x - center[0]) * cos + (y - center[1]) * sin, -(x - center[0]) * sin + (y - center[1]) * cos]);
    for (const [u, v] of loc) {
      w += Math.abs(u) / 4; // halbe Breite: Mittelwert über die 4 Ecken
      h += Math.abs(v) / 4;
    }
    if (Math.abs(w - h) < Math.max(w, h) * 0.1) w = h = (w + h) / 2; // fast quadratisch -> Quadrat
    const rect = [[-w, -h], [w, -h], [w, h], [-w, h]].map(([u, v]) => [center[0] + u * cos - v * sin, center[1] + u * sin + v * cos]);
    const kind = w !== h ? 'rect' : Math.abs(Math.abs(rot) - 45 * DEG) < 9 * DEG ? 'diamond' : 'square';
    return { kind, pts: rect, closed: true, pivot: center };
  }

  if (pts.length === 3) {
    const sides = [0, 1, 2].map((i) => dist(pts[i], pts[(i + 1) % 3]));
    const mean = (sides[0] + sides[1] + sides[2]) / 3;
    const base = straightenEdges(pts, 7 * DEG);
    pts = base;
    // Fast gleichseitig mit waagerechter Grundseite -> genau gleichseitig
    const flat = [0, 1, 2].find((i) => Math.abs(pts[i][1] - pts[(i + 1) % 3][1]) < 0.5);
    if (flat !== undefined && sides.every((s) => Math.abs(s - mean) < mean * 0.12)) {
      const a = pts[flat];
      const b = pts[(flat + 1) % 3];
      const c = pts[(flat + 2) % 3];
      const mx = (a[0] + b[0]) / 2;
      const side = Math.abs(b[0] - a[0]);
      const dir = Math.sign(c[1] - a[1]) || -1;
      pts[(flat + 2) % 3] = [mx, a[1] + dir * side * Math.sqrt(3) / 2];
    }
    return { kind: 'triangle', pts, closed: true, pivot: center };
  }

  if (pts.length === 5 || pts.length === 6) {
    // Fast regelmäßig -> regelmäßig (gleich lange Seiten), eine Ecke bzw. Kante oben
    const radii = pts.map((p) => dist(p, center));
    const r = radii.reduce((s, v) => s + v, 0) / radii.length;
    if (radii.every((v) => Math.abs(v - r) < r * 0.2)) {
      const start = pts.length === 5 ? -Math.PI / 2 : 0;
      const reg = [];
      for (let i = 0; i < pts.length; i++) {
        const t = start + (i / pts.length) * Math.PI * 2;
        reg.push([center[0] + Math.cos(t) * r, center[1] + Math.sin(t) * r]);
      }
      return { kind: pts.length === 5 ? 'pentagon' : 'hexagon', pts: reg, closed: true, pivot: center };
    }
  }

  return { kind: 'polygon', pts: straightenEdges(pts, 6 * DEG), closed: true, pivot: center };
}

function isRoughlyRectangle(pts) {
  for (let i = 0; i < 4; i++) {
    const t = turnAt(pts, i);
    if (Math.abs(t - Math.PI / 2) > 20 * DEG) return false;
  }
  return true;
}

// Kanten, die fast waagerecht oder senkrecht sind, genau gerade machen
function straightenEdges(pts, tolerance) {
  const out = pts.map((p) => [p[0], p[1]]);
  const n = out.length;
  for (let i = 0; i < n; i++) {
    const a = out[i];
    const b = out[(i + 1) % n];
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
    const s = snapAngle(ang, 90 * DEG, tolerance);
    if (s === ang) continue;
    if (Math.abs(Math.sin(s)) < 0.5) {
      const y = (a[1] + b[1]) / 2;
      a[1] = b[1] = y;
    } else {
      const x = (a[0] + b[0]) / 2;
      a[0] = b[0] = x;
    }
  }
  return out;
}

// ---------- Offene Formen ----------
function recognizeOpen(pts, diag, total) {
  const v = simplify(pts, Math.max(diag, total * 0.3) * 0.07);
  const start = v[0];

  // Pfeil: langer Schaft, dann kurze Striche, die alle nah bei der Spitze bleiben
  if (v.length >= 3) {
    const tip = v[1];
    const shaft = dist(start, tip);
    const rest = v.slice(2);
    const back = Math.PI - turnAt([start, tip, v[2]], 1); // Winkel zwischen Schaft (rückwärts) und erstem Spitzen-Strich
    const near = rest.every((p) => dist(p, tip) < shaft * 0.5);
    if (shaft > diag * 0.45 && near && back < 75 * DEG && back > 8 * DEG) {
      const far = rest.filter((p) => dist(p, tip) > shaft * 0.08);
      const head = far.length ? far.reduce((s, p) => s + dist(p, tip), 0) / far.length : shaft * 0.25;
      const angle = snapAngle(Math.atan2(tip[1] - start[1], tip[0] - start[0]), 45 * DEG, 5 * DEG);
      const end = [start[0] + Math.cos(angle) * shaft, start[1] + Math.sin(angle) * shaft];
      return { kind: 'arrow', pts: arrowPath([start[0], start[1]], end, Math.max(8, Math.min(head, shaft * 0.45))), closed: false, pivot: [start[0], start[1]] };
    }
  }

  // Winkel: zwei gerade Strecken mit einem deutlichen Knick
  if (v.length === 3) {
    const [a, b, c] = v;
    const l1 = dist(a, b);
    const l2 = dist(b, c);
    const turn = turnAt(v, 1);
    // Beide Schenkel müssen wirklich gerade sein (ein Bogen ist kein Winkel)
    const straightLegs = pts.every((p) => Math.min(segmentDistance(p, a, b), segmentDistance(p, b, c)) < diag * 0.04);
    if (straightLegs && l1 > total * 0.2 && l2 > total * 0.2 && turn > 30 * DEG && turn < 160 * DEG) {
      const pts2 = [a, b, c].map((p) => [p[0], p[1]]);
      // Fast waagerecht/senkrecht -> genau
      for (const [i, j] of [[0, 1], [1, 2]]) {
        const ang = Math.atan2(pts2[j][1] - pts2[i][1], pts2[j][0] - pts2[i][0]);
        const s = snapAngle(ang, 45 * DEG, 5 * DEG);
        if (s !== ang) {
          const len = dist(pts2[i], pts2[j]);
          if (i === 0) pts2[0] = [pts2[1][0] - Math.cos(s) * len, pts2[1][1] - Math.sin(s) * len];
          else pts2[2] = [pts2[1][0] + Math.cos(s) * len, pts2[1][1] + Math.sin(s) * len];
        }
      }
      return { kind: 'angle', pts: pts2, closed: false, pivot: pts2[0] };
    }
  }
  return null;
}

// Eine Form, deren Punkte um "pivot" gedreht und vergrößert werden (fürs Nachjustieren)
export function transformShape(shape, pivot, factor, angle) {
  const cos = Math.cos(angle) * factor;
  const sin = Math.sin(angle) * factor;
  return shape.pts.map(([x, y]) => {
    const dx = x - pivot[0];
    const dy = y - pivot[1];
    return [pivot[0] + dx * cos - dy * sin, pivot[1] + dx * sin + dy * cos];
  });
}

export const SHAPE_NAMES = {
  line: 'Linie', arrow: 'Pfeil', angle: 'Winkel', circle: 'Kreis', ellipse: 'Ellipse', rect: 'Rechteck',
  square: 'Quadrat', diamond: 'Raute', triangle: 'Dreieck', pentagon: 'Fünfeck', hexagon: 'Sechseck', polygon: 'Vieleck',
};
