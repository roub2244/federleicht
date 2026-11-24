// laser.js – der Laserpointer: zum Zeigen und Erklären, ohne etwas auf die Seite zu schreiben
//
// Was du mit dem Laserpointer malst, wird NICHT gespeichert. Die leuchtende Spur bleibt kurz
// stehen und verblasst dann von selbst (wie bei Samsung Notes). Gut, um z. B. einem Freund
// am Tablet etwas zu zeigen: "Hier, diese Formel …".
//
// Zwei Arten:
//   'trail'  leuchtende Linie, die nach dem Abheben verblasst
//   'dot'    nur ein leuchtender Punkt (mit ganz kurzem Schweif), der dem Stift folgt
//
// Gemalt wird auf ein eigenes, durchsichtiges Canvas über der Seite. So muss die Seite selbst
// nie neu gemalt werden, und wir können 60-mal pro Sekunde die Spur verblassen lassen.
// Die Punkte merken wir uns in Dokument-Koordinaten: scrollst oder zoomst du, wandert die
// Spur mit dem Blatt mit.

const FADE_S = 0.45;      // so lange (Sekunden) dauert das Verblassen selbst
const DOT_TAIL_S = 0.14;  // Punkt-Modus: so lang ist der kurze Schweif
const HOVER_HIDE_MS = 350; // Schwebe-Punkt ausblenden, wenn so lange nichts vom Stift kam

export function setupLaser({ stage, view, tools }) {
  const canvas = document.createElement('canvas');
  canvas.className = 'laser-layer';
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  let width = 0;
  let height = 0;

  let trails = [];   // { pts: [[x, y, t], ...], color, size, mode, duration, endedAt }
  let active = null; // die Spur, die gerade gemalt wird
  let hover = null;  // { x, y } Bildschirm: Stift schwebt (kleiner Zielpunkt)
  let hoverTimer = 0;
  let frame = 0;

  function resize() {
    dpr = window.devicePixelRatio || 1;
    width = stage.clientWidth;
    height = stage.clientHeight;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    request();
  }
  new ResizeObserver(resize).observe(stage);

  const now = () => performance.now() / 1000;

  function request() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  // Wie sichtbar ist diese Spur gerade? (1 = voll, 0 = weg)
  function alphaOf(trail, t) {
    if (!trail.endedAt) return 1;
    const age = t - trail.endedAt - trail.duration;
    if (age <= 0) return 1;
    return Math.max(0, 1 - age / FADE_S);
  }

  function draw() {
    frame = 0;
    const t = now();
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    trails = trails.filter((tr) => alphaOf(tr, t) > 0);
    let busy = false;
    for (const tr of trails) {
      const a = alphaOf(tr, t);
      if (tr.endedAt) busy = true; // verblasst noch -> weiter animieren
      let pts = tr.pts;
      if (tr.mode === 'dot') {
        // Punkt-Modus: nur der kurze Schweif der letzten Bruchteile einer Sekunde
        const last = pts[pts.length - 1];
        const from = (tr.endedAt || t) - DOT_TAIL_S;
        pts = pts.filter((p) => p[2] >= from);
        if (pts.length === 0) pts = [last];
        if (!tr.endedAt) busy = true; // Schweif schrumpft auch, wenn der Stift stillsteht
      }
      drawBeam(pts.map((p) => view.toScreen(p[0], p[1])), tr.color, tr.size, a, tr.mode === 'dot' || !tr.endedAt);
    }

    // Schweben: kleiner leuchtender Punkt, damit man sieht, wohin man zeigt
    if (hover && !active) drawDot(hover.x, hover.y, tools.laser.color, tools.laser.size * 0.8, 0.75);

    if (busy || trails.some((tr) => !tr.endedAt)) request();
  }

  // Eine leuchtende Linie: außen farbiger Schein, innen fast weißer Kern
  function drawBeam(pts, color, size, alpha, withHead) {
    if (pts.length === 0) return;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const path = smoothPath(pts);
    // 1) breiter, weicher Schein
    ctx.shadowColor = color;
    ctx.shadowBlur = size * 2.2;
    ctx.strokeStyle = color;
    ctx.lineWidth = size;
    ctx.stroke(path);
    // 2) nochmal ohne Schatten, damit die Farbe kräftig bleibt
    ctx.shadowBlur = 0;
    ctx.stroke(path);
    // 3) heller Kern
    ctx.strokeStyle = mix(color, '#ffffff', 0.7);
    ctx.lineWidth = Math.max(1.2, size * 0.36);
    ctx.stroke(path);
    ctx.restore();
    if (withHead) {
      const [x, y] = pts[pts.length - 1];
      drawDot(x, y, color, size, alpha);
    }
  }

  // Leuchtender Punkt (Spitze des Laserstrahls)
  function drawDot(x, y, color, size, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    const r = Math.max(4, size * 0.95);
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.4);
    g.addColorStop(0, mix(color, '#ffffff', 0.85));
    g.addColorStop(0.3, color);
    g.addColorStop(1, withAlpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Weiche Linie durch die Punkte (Mittelpunkte als Kurven-Stützpunkte)
  function smoothPath(pts) {
    const path = new Path2D();
    path.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) {
      path.lineTo(pts[0][0] + 0.01, pts[0][1]);
      return path;
    }
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i][0] + pts[i + 1][0]) / 2;
      const my = (pts[i][1] + pts[i + 1][1]) / 2;
      path.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
    }
    const last = pts[pts.length - 1];
    path.lineTo(last[0], last[1]);
    return path;
  }

  return {
    // Stift aufgesetzt (Punkt in Dokument-Koordinaten)
    down(point) {
      const s = tools.laser;
      active = { pts: [[point[0], point[1], now()]], color: s.color, size: s.size, mode: s.mode, duration: s.duration, endedAt: 0 };
      trails.push(active);
      hover = null;
      request();
    },
    move(points) {
      if (!active) return;
      const t = now();
      for (const p of points) {
        const last = active.pts[active.pts.length - 1];
        // Punkte, die fast auf dem letzten liegen, brauchen wir nicht (spart Arbeit beim Malen)
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) * view.scale < 1.2) {
          last[2] = t;
          continue;
        }
        active.pts.push([p[0], p[1], t]);
      }
      request();
    },
    up() {
      if (!active) return;
      active.endedAt = now();
      active = null;
      request();
    },
    // Stift schwebt über dem Blatt (Bildschirm-Position) oder ist weg (null)
    hover(pos) {
      clearTimeout(hoverTimer);
      hover = pos ? { x: pos[0], y: pos[1] } : null;
      if (pos) hoverTimer = setTimeout(() => {
        hover = null;
        request();
      }, HOVER_HIDE_MS);
      request();
    },
    // Beim Scrollen/Zoomen die Spur mitbewegen
    redraw: request,
    clear() {
      trails = [];
      active = null;
      hover = null;
      request();
    },
  };
}

// ---------- Farben mischen ----------
function rgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a, b, t) {
  const A = rgb(a);
  const B = rgb(b);
  const c = A.map((v, i) => Math.round(v + (B[i] - v) * t));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}
function withAlpha(hex, alpha) {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
