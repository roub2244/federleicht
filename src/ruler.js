// ruler.js – Lineal und Geodreieck (mit Winkelmesser) zum Hinlegen aufs Blatt
//
// Wie ein echtes Lineal liegt es AUF der Seite (es wandert beim Scrollen mit dem Blatt mit):
//   1 Finger auf dem Lineal   -> verschieben
//   2 Finger auf dem Lineal   -> verschieben und drehen (Winkel steht groß in der Mitte;
//                                bei 0°, 15°, 30°, 45° … rastet es leicht ein)
//   Stift an einer Kante      -> die Linie läuft schnurgerade an der Kante entlang,
//                                dabei wird die Länge in cm angezeigt
//
// Zwei Formen:
//   'ruler'     Lineal, 16 cm lang, mit mm/cm-Skala an beiden langen Kanten
//   'triangle'  Geodreieck: lange Kante 16 cm mit Skala von der Mitte aus (wie in der Schule),
//               Winkelmesser 0–180° (zwei Zahlenreihen), Hilfslinien parallel zur langen Kante
//
// Alles wird in Seiten-Einheiten gerechnet (1 mm = MM Einheiten, siehe templates.js) und auf
// ein eigenes durchsichtiges Canvas über der Seite gemalt.

import { MM } from './templates.js';

const SNAP_PX = 26;         // so nah (Bildschirm-Pixel) an einer Kante rastet der Stift ein
const ANGLE_SNAP = 15;      // auf Vielfache davon (Grad) rastet das Drehen ein ...
const ANGLE_MAGNET = 1.6;   // ... wenn man so nah dran ist (Grad)
const KEY = 'federleicht.ruler';

export function setupRuler({ stage, view, onChange }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'ruler-layer';
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1;

  // Zustand: Mitte (Dokument-Koordinaten), Winkel (Bogenmaß), Form
  let state = load();
  let on = false;
  let measure = null;   // { a, b } gerade gezogene Linie an der Kante (Dokument-Koordinaten) -> Länge zeigen
  let rotating = false; // gerade mit 2 Fingern gedreht -> Winkel groß zeigen

  new ResizeObserver(() => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    canvas.style.width = `${stage.clientWidth}px`;
    canvas.style.height = `${stage.clientHeight}px`;
    draw();
  }).observe(stage);

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && Number.isFinite(s.x)) return { kind: s.kind === 'triangle' ? 'triangle' : 'ruler', x: s.x, y: s.y, angle: s.angle || 0 };
    } catch {
      /* egal */
    }
    return { kind: 'triangle', x: 500, y: 400, angle: 0 };
  }
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      /* egal */
    }
  }

  // ---------- Form in lokalen Koordinaten (Mitte = 0,0, waagerecht) ----------
  // Lineal: Rechteck. Geodreieck: rechtwinklig-gleichschenklig, lange Kante unten (y = 0 ist die
  // lange Kante, die Spitze zeigt nach oben). Die "Mitte" (x, y) ist beim Geodreieck der Nullpunkt
  // der langen Kante – genau da, wo man beim Winkelmessen den Scheitel anlegt.
  const L = 160 * MM;          // Länge der langen Kante
  const RULER_W = 32 * MM;     // Breite des Lineals
  function polygon() {
    if (state.kind === 'ruler') return [[-L / 2, -RULER_W / 2], [L / 2, -RULER_W / 2], [L / 2, RULER_W / 2], [-L / 2, RULER_W / 2]];
    return [[-L / 2, 0], [L / 2, 0], [0, -L / 2]];
  }
  // Kanten, an denen man zeichnen kann: [Anfang, Ende, Außen-Normale] (lokal)
  function edges() {
    const p = polygon();
    const out = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length];
      // beim Lineal nur die zwei langen Kanten
      if (state.kind === 'ruler' && i % 2 === 1) continue;
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      // Außen-Normale: senkrecht zur Kante, weg von der Mitte der Form
      let n = [dy / len, -dx / len];
      const cx = p.reduce((s, q) => s + q[0], 0) / p.length;
      const cy = p.reduce((s, q) => s + q[1], 0) / p.length;
      const mx = (a[0] + b[0]) / 2 - cx;
      const my = (a[1] + b[1]) / 2 - cy;
      if (n[0] * mx + n[1] * my < 0) n = [-n[0], -n[1]];
      out.push({ a, b, n, len });
    }
    return out;
  }

  const cos = () => Math.cos(state.angle);
  const sin = () => Math.sin(state.angle);
  // lokal -> Dokument
  function toDoc([lx, ly]) {
    const c = cos();
    const s = sin();
    return [state.x + lx * c - ly * s, state.y + lx * s + ly * c];
  }
  // Dokument -> lokal
  function toLocal([x, y]) {
    const dx = x - state.x;
    const dy = y - state.y;
    const c = cos();
    const s = sin();
    return [dx * c + dy * s, -dx * s + dy * c];
  }

  function inside(p) {
    const q = toLocal(p);
    const poly = polygon();
    let hit = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > q[1] !== yj > q[1] && q[0] < ((xj - xi) * (q[1] - yi)) / (yj - yi) + xi) hit = !hit;
    }
    return hit;
  }

  // ---------- Stift an der Kante ----------
  // Welche Kante ist nah? Ergebnis: { edge, t0 } (t = Position entlang der Kante, lokal) oder null
  function snapStart(docPoint, size = 2) {
    if (!on) return null;
    const q = toLocal(docPoint);
    const maxD = SNAP_PX / view.scale;
    let best = null;
    for (const e of edges()) {
      const dir = [(e.b[0] - e.a[0]) / e.len, (e.b[1] - e.a[1]) / e.len];
      const rel = [q[0] - e.a[0], q[1] - e.a[1]];
      const t = rel[0] * dir[0] + rel[1] * dir[1];
      const d = rel[0] * e.n[0] + rel[1] * e.n[1]; // >0 außen, <0 innen
      if (t < -maxD || t > e.len + maxD) continue;
      if (d > maxD || d < -maxD * 0.8) continue;
      if (!best || Math.abs(d) < Math.abs(best.d)) best = { edge: e, dir, d, t };
    }
    if (!best) return null;
    return { edge: best.edge, dir: best.dir, t0: best.t, gap: size / 2 + 0.6 };
  }

  // Punkt an die Kante ziehen (Dokument-Koordinaten)
  function project(snap, docPoint) {
    const { edge, dir, gap } = snap;
    const q = toLocal(docPoint);
    const t = (q[0] - edge.a[0]) * dir[0] + (q[1] - edge.a[1]) * dir[1];
    const lp = [edge.a[0] + dir[0] * t + edge.n[0] * gap, edge.a[1] + dir[1] * t + edge.n[1] * gap];
    return toDoc(lp);
  }

  function showMeasure(a, b) {
    measure = a && b ? { a, b } : null;
    draw();
  }

  // ---------- Finger: verschieben und drehen ----------
  function moveBy(dx, dy) {
    state.x += dx;
    state.y += dy;
    draw();
  }
  // Drehen um den Punkt (cx, cy) (Dokument), dAngle in Bogenmaß
  let rawAngle = null;
  function rotateBy(dAngle, cx, cy) {
    if (rawAngle === null) rawAngle = state.angle;
    rawAngle += dAngle;
    let target = rawAngle;
    const deg = (target * 180) / Math.PI;
    const nearest = Math.round(deg / ANGLE_SNAP) * ANGLE_SNAP;
    if (Math.abs(deg - nearest) < ANGLE_MAGNET) target = (nearest * Math.PI) / 180;
    const d = target - state.angle;
    // Mitte um (cx, cy) mitdrehen
    const c = Math.cos(d);
    const s = Math.sin(d);
    const rx = state.x - cx;
    const ry = state.y - cy;
    state.x = cx + rx * c - ry * s;
    state.y = cy + rx * s + ry * c;
    state.angle = target;
    rotating = true;
    draw();
  }
  function gestureEnd() {
    rawAngle = null;
    rotating = false;
    save();
    draw();
  }

  // ---------- Malen ----------
  function draw() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!on) return;
    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    const k = view.scale;
    const [sx, sy] = view.toScreen(state.x, state.y);
    ctx.setTransform(dpr * k, 0, 0, dpr * k, sx * dpr, sy * dpr);
    ctx.rotate(state.angle);
    const ink = dark ? 'rgba(235, 240, 255, 0.92)' : 'rgba(20, 30, 60, 0.85)';
    const faint = dark ? 'rgba(235, 240, 255, 0.35)' : 'rgba(20, 30, 60, 0.3)';
    const px = 1 / k; // 1 Bildschirm-Pixel in Seiten-Einheiten

    // Körper: halb durchsichtig, damit man darunter noch sieht
    const poly = polygon();
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = dark ? 'rgba(120, 140, 200, 0.2)' : 'rgba(170, 190, 255, 0.22)';
    ctx.fill();
    ctx.lineWidth = 1.4 * px;
    ctx.strokeStyle = dark ? 'rgba(150, 170, 255, 0.9)' : 'rgba(74, 108, 247, 0.9)';
    ctx.stroke();

    ctx.font = `${Math.max(2.6 * MM, 10 * px)}px system-ui, sans-serif`;
    ctx.fillStyle = ink;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    if (state.kind === 'ruler') {
      // mm-Skala an beiden langen Kanten, 0 links
      for (const side of [-1, 1]) {
        const y0 = (side * RULER_W) / 2;
        for (let mm = 0; mm <= 160; mm++) {
          const x = -L / 2 + mm * MM;
          const len = mm % 10 === 0 ? 5 * MM : mm % 5 === 0 ? 3.5 * MM : 2 * MM;
          if (MM * k < 2.2 && mm % 5) continue; // ganz klein: nur jeden halben cm
          ctx.beginPath();
          ctx.moveTo(x, y0);
          ctx.lineTo(x, y0 - side * len);
          ctx.lineWidth = (mm % 10 ? 0.8 : 1.1) * px;
          ctx.strokeStyle = mm % 10 ? faint : ink;
          ctx.stroke();
          if (mm % 10 === 0 && side === 1) ctx.fillText(String(mm / 10), x, y0 - 8 * MM);
        }
      }
    } else {
      drawTriangle(ink, faint, px);
    }

    // Winkel in der Mitte (immer lesbar, nie auf dem Kopf)
    const deg = normDeg((state.angle * 180) / Math.PI);
    ctx.save();
    const cy = state.kind === 'ruler' ? 0 : -L / 2 + 30 * MM;
    ctx.translate(0, state.kind === 'ruler' ? 0 : -24 * MM);
    if (Math.cos(state.angle) < 0) ctx.rotate(Math.PI);
    ctx.font = `600 ${(rotating ? 7 : 4.6) * MM}px system-ui, sans-serif`;
    ctx.fillStyle = rotating ? (dark ? '#9fb2ff' : '#4a6cf7') : ink;
    ctx.fillText(`${deg}°`, 0, state.kind === 'ruler' ? 0 : 0);
    ctx.restore();
    void cy;

    // Länge der gerade gezogenen Linie
    if (measure) {
      const len = Math.hypot(measure.b[0] - measure.a[0], measure.b[1] - measure.a[1]) / MM / 10;
      const [mx, my] = view.toScreen(measure.b[0], measure.b[1]);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const text = `${len.toFixed(1).replace('.', ',')} cm`;
      ctx.font = '600 14px system-ui, sans-serif';
      const w = ctx.measureText(text).width + 18;
      ctx.fillStyle = dark ? 'rgba(40, 46, 60, 0.95)' : 'rgba(255, 255, 255, 0.96)';
      roundRect(ctx, mx + 14, my - 36, w, 26, 13);
      ctx.fill();
      ctx.fillStyle = dark ? '#e8ebf2' : '#1d2433';
      ctx.textAlign = 'left';
      ctx.fillText(text, mx + 23, my - 22.5);
    }
  }

  // Geodreieck: Skala von der Mitte, Winkelmesser, Parallelen
  function drawTriangle(ink, faint, px) {
    const k = view.scale;
    // cm-Skala an der langen Kante, 0 in der Mitte (wie beim echten Geodreieck)
    for (let mm = -75; mm <= 75; mm++) {
      if (MM * k < 2.2 && mm % 5) continue;
      const x = mm * MM;
      const len = mm % 10 === 0 ? 3.6 * MM : mm % 5 === 0 ? 2.6 * MM : 1.6 * MM;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, -len);
      ctx.lineWidth = (mm % 10 ? 0.8 : 1.1) * px;
      ctx.strokeStyle = mm % 10 ? faint : ink;
      ctx.stroke();
      if (mm % 10 === 0 && mm !== 0) ctx.fillText(String(Math.abs(mm / 10)), x, -5.6 * MM);
    }
    // Nullpunkt-Markierung
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -10 * MM);
    ctx.lineWidth = 1.6 * px;
    ctx.strokeStyle = ink;
    ctx.stroke();

    // Winkelmesser: Halbkreis um den Nullpunkt, Striche jedes Grad, Zahlen alle 10°
    const R = 55 * MM;
    ctx.beginPath();
    ctx.arc(0, 0, R, Math.PI, 0);
    ctx.lineWidth = 1 * px;
    ctx.strokeStyle = faint;
    ctx.stroke();
    for (let d = 0; d <= 180; d++) {
      const a = Math.PI + (d * Math.PI) / 180; // 0° rechts unten ... 180° links
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      const len = d % 10 === 0 ? 4 * MM : d % 5 === 0 ? 2.8 * MM : 1.6 * MM;
      if (MM * k < 2.2 && d % 5) continue;
      ctx.beginPath();
      ctx.moveTo(-ca * R, sa * R);
      ctx.lineTo(-ca * (R - len), sa * (R - len));
      ctx.lineWidth = (d % 10 ? 0.7 : 1) * px;
      ctx.strokeStyle = d % 10 ? faint : ink;
      ctx.stroke();
      if (d % 10 === 0 && d > 10 && d < 170) {
        // zwei Zahlenreihen: außen 0→180 von rechts, innen 180→0
        const r1 = R - 7 * MM;
        const r2 = R - 12 * MM;
        ctx.save();
        ctx.font = `${Math.max(2.3 * MM, 9 * px)}px system-ui, sans-serif`;
        ctx.fillStyle = ink;
        ctx.fillText(String(d), -ca * r1, sa * r1);
        ctx.fillStyle = faint;
        ctx.fillText(String(180 - d), -ca * r2, sa * r2);
        ctx.restore();
      }
    }
    // Parallelen zur langen Kante (alle 1 cm, nur innerhalb des Dreiecks)
    ctx.setLineDash([2 * MM, 2 * MM]);
    for (let h = 10; h <= 70; h += 10) {
      const y = -h * MM;
      const half = L / 2 - h * MM;
      ctx.beginPath();
      ctx.moveTo(-half + 3 * MM, y);
      ctx.lineTo(-R * 0.15, y);
      ctx.moveTo(R * 0.15, y);
      ctx.lineTo(half - 3 * MM, y);
      ctx.lineWidth = 0.7 * px;
      ctx.strokeStyle = faint;
      if (h > 50) ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // ---------- An / aus ----------
  function show(kind) {
    if (kind) state.kind = kind;
    // In die Mitte des Bildschirms holen, falls es nicht zu sehen ist
    const [sx, sy] = view.toScreen(state.x, state.y);
    if (!on || sx < 0 || sy < 0 || sx > view.width || sy > view.height) center();
    on = true;
    save();
    draw();
    onChange?.(on);
  }
  function center() {
    const [x, y] = view.toPage(view.width / 2, view.height / 2 + (state.kind === 'triangle' ? 40 : 0));
    state.x = x;
    state.y = y;
  }
  function hide() {
    on = false;
    measure = null;
    draw();
    onChange?.(on);
  }

  return {
    get on() {
      return on;
    },
    get kind() {
      return state.kind;
    },
    get angle() {
      return normDeg((state.angle * 180) / Math.PI);
    },
    show,
    hide,
    toggle: () => (on ? hide() : show()),
    setKind(kind) {
      state.kind = kind;
      save();
      draw();
    },
    center() {
      center();
      save();
      draw();
    },
    level() {
      state.angle = 0;
      save();
      draw();
    },
    // Bildschirm-Punkt auf dem Lineal?
    hitScreen(sx, sy) {
      return on && inside(view.toPage(sx, sy));
    },
    snapStart,
    project,
    showMeasure,
    moveBy,
    rotateBy,
    gestureEnd,
    redraw: draw,
  };
}

function normDeg(d) {
  let x = Math.round(d) % 360;
  if (x < 0) x += 360;
  // 0–180 reicht zum Ablesen (ein gedrehtes Lineal um 190° hat dieselbe Kante wie 10°)
  return x > 180 ? x - 180 : x;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
