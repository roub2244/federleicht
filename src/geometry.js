// geometry.js – kleine Mathe-Helfer für Formen und das Lasso
//
// Eine "Matrix" beschreibt, wie Punkte verschoben, gedreht und vergrößert werden.
// Wir benutzen dieselbe Schreibweise wie das Canvas (ctx.transform(a, b, c, d, e, f)):
//
//   x' = a·x + c·y + e
//   y' = b·x + d·y + f
//
// Mehrere Schritte (erst verschieben, dann drehen …) kann man zu EINER Matrix
// zusammenfassen ("multiplizieren"). Dann muss jeder Punkt nur einmal umgerechnet werden.

export const IDENTITY = [1, 0, 0, 1, 0, 0];

// Erst n, dann m anwenden (m · n)
export function multiply(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

// Mehrere Schritte von links nach rechts lesen: compose(A, B, C) = erst C, dann B, dann A
export function compose(...list) {
  return list.reduce((acc, m) => multiply(acc, m), IDENTITY);
}

export const translate = (x, y) => [1, 0, 0, 1, x, y];
export const scale = (sx, sy = sx) => [sx, 0, 0, sy, 0, 0];
export function rotate(angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, -s, c, 0, 0];
}

export function apply(m, p) {
  return [m[0] * p[0] + m[2] * p[1] + m[4], m[1] * p[0] + m[3] * p[1] + m[5]];
}

// Wie stark vergrößert die Matrix Flächen? (Wurzel daraus = "mittlerer" Vergrößerungsfaktor)
export function scaleOf(m) {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

// Um welchen Winkel dreht die Matrix?
export function angleOf(m) {
  return Math.atan2(m[1], m[0]);
}

export function isIdentity(m, eps = 1e-6) {
  return m.every((v, i) => Math.abs(v - IDENTITY[i]) < eps);
}

// ---------- Punkte und Linien ----------

export const dist = (a, b) => Math.hypot(b[0] - a[0], b[1] - a[1]);

export function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i++) length += dist(points[i - 1], points[i]);
  return length;
}

// Abstand eines Punktes p zur Strecke a–b
export function segmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lengthSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

// Liegt Punkt p innerhalb des Vielecks poly? ("Strahl-Methode": wie oft kreuzt ein Strahl nach rechts den Rand?)
export function pointInPolygon(p, poly) {
  let inside = false;
  const [x, y] = p;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Gleichmäßig verteilte Punkte entlang eines Strichs (n Stück)
export function resample(points, n) {
  const total = pathLength(points);
  if (points.length < 2 || total === 0) return points.map((p) => [p[0], p[1]]);
  const step = total / (n - 1);
  const out = [[points[0][0], points[0][1]]];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const d = dist(a, b);
    let t = step - carry;
    while (t <= d && out.length < n) {
      const f = t / d;
      out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
      t += step;
    }
    carry = d - (t - step);
  }
  while (out.length < n) out.push([points[points.length - 1][0], points[points.length - 1][1]]);
  return out;
}

// Douglas-Peucker: einen zittrigen Strich auf seine "Ecken" vereinfachen.
// Alle Punkte, die weniger als eps von der Linie zwischen zwei Ecken abweichen, fallen weg.
export function simplify(points, eps) {
  if (points.length < 3) return points.slice();
  let maxD = -1;
  let index = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i++) {
    const d = segmentDistance(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      index = i;
    }
  }
  if (maxD <= eps) return [a, b];
  const left = simplify(points.slice(0, index + 1), eps);
  const right = simplify(points.slice(index), eps);
  return left.slice(0, -1).concat(right);
}

export function boundsOf(points) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of points) {
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
  }
  return { minX, minY, maxX, maxY };
}

export function unionBox(a, b) {
  if (!a) return b ? { ...b } : null;
  if (!b) return { ...a };
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

// Winkel auf den nächsten "schönen" Winkel (Vielfaches von step) einrasten, wenn er nah genug dran ist
export function snapAngle(angle, step, tolerance) {
  const snapped = Math.round(angle / step) * step;
  return Math.abs(angle - snapped) < tolerance ? snapped : angle;
}

export const DEG = Math.PI / 180;
