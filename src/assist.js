// assist.js – Handschrifthilfe (wie in Samsung Notes)
//
// Ist die Handschrifthilfe an (Knopf oben in der Leiste), hilft die App beim ordentlichen Schreiben:
//
//   1. Hilfslinie: Während du eine Zeile schreibst, erscheint unter der Schrift eine feine,
//      gestrichelte Linie in Schreibrichtung – so bleibt die Zeile gerade (auf leerem oder
//      kariertem Papier; auf liniertem Papier gibt es ja schon Linien).
//   2. Zeile geraderücken: Sobald du eine Zeile fertig hast (in die nächste Zeile wechselst
//      oder kurz Pause machst), wird schräg Geschriebenes waagerecht gedreht.
//   3. Auf die Linie setzen: Auf liniertem Papier rutscht die Zeile genau auf die nächste Linie.
//      Schreibst du später in derselben Zeile weiter, kommt das Neue auf dieselbe Grundlinie.
//
// Das Geraderücken ist ein eigener Schritt beim Rückgängigmachen: Einmal "Rückgängig"
// stellt deine Original-Schrift wieder her.
//
// Wie finden wir die "Grundlinie" (die Linie, auf der die Buchstaben stehen)?
// Für jeden Strich nehmen wir seinen untersten Punkt. Durch diese Punkte legen wir eine
// Gerade – robust, also so, dass Unterlängen (g, j, p, q, y) nicht stören: Erst grob schätzen,
// dann alles weglassen, was deutlich darunter hängt, und nochmal schätzen.

import { transformStroke } from './ink.js';
import { compose, translate, rotate } from './geometry.js';
import { ruling } from './templates.js';
import { PAGE_WIDTH } from './view.js';

const IDLE_MS = 1600;        // so lange Pause -> Zeile gilt als fertig
const MAX_ANGLE = 22;        // stärker schräg (Grad) ist vermutlich Absicht (z. B. Beschriftung) -> nicht drehen
const MIN_ANGLE = 1.2;       // weniger schräg lohnt sich nicht
const MAX_TEXT_HEIGHT = 110; // höhere Striche (Seiten-Einheiten, ~23 mm) sind eher Zeichnung als Schrift

export function setupAssist({ stage, view, doc, renderer, commit, isOn }) {
  // Hilfslinie auf eigenem durchsichtigem Canvas
  const canvas = document.createElement('canvas');
  canvas.className = 'assist-layer';
  stage.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  let dpr = 1;
  new ResizeObserver(() => {
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(stage.clientWidth * dpr);
    canvas.height = Math.round(stage.clientHeight * dpr);
    canvas.style.width = `${stage.clientWidth}px`;
    canvas.style.height = `${stage.clientHeight}px`;
    drawGuide();
  }).observe(stage);

  let group = null;  // { page, strokes: [], fit } – die Zeile, die gerade geschrieben wird
  let last = null;   // die zuletzt fertige Zeile { page, y (Grundlinie am Ende), x1, h, at }
  let timer = 0;

  // ---------- Zeilen erkennen ----------

  // Passt ein neuer Strich (Anfangspunkt p, Seiten-Koordinaten) noch zur laufenden Zeile?
  function belongs(page, p) {
    if (!group || group.page !== page) return false;
    const f = group.fit;
    if (!f) return true;
    const base = f.y0 + f.slope * (p[0] - f.x0);
    const h = f.h;
    // senkrecht: zwischen Oberlänge und Unterlänge; waagerecht: nicht weit zurück und nicht weit weg
    return p[1] > base - h * 2.6 && p[1] < base + h * 1.4 && p[0] > f.minX - h * 3 && p[0] < f.maxX + h * 8;
  }

  function strokeStarted(page, point) {
    if (!isOn()) return;
    clearTimeout(timer);
    if (group && !belongs(page, point)) finish();
  }

  function strokeAdded(page, stroke) {
    if (!isOn()) return;
    if (!usable(stroke)) {
      finish();
      return;
    }
    if (!group || group.page !== page) {
      finish();
      group = { page, strokes: [] };
    }
    group.strokes.push(stroke);
    group.fit = fitBaseline(group.strokes);
    drawGuide();
    clearTimeout(timer);
    timer = setTimeout(finish, IDLE_MS);
  }

  // Nur normale Stift-Striche (keine Formen, keine Textmarker, nichts Gerades)
  function usable(s) {
    return s && s.tool === 'pen' && !s.shape && !s.straight && s.box && s.box.maxY - s.box.minY < MAX_TEXT_HEIGHT;
  }

  // ---------- Zeile fertig: geraderücken und auf die Linie setzen ----------
  function finish() {
    clearTimeout(timer);
    const g = group;
    group = null;
    drawGuide();
    if (!g || !isOn()) return;
    const strokes = g.strokes.filter((s) => g.page.strokes.includes(s)); // inzwischen radiert/rückgängig?
    if (strokes.length < 2 || !doc.pages.includes(g.page)) return;
    const f = fitBaseline(strokes);
    if (!f) return;
    const width = f.maxX - f.minX;
    if (width < f.h * 2.5) return; // ein einzelner Buchstabe oder ein Zeichen: lieber nichts ändern

    let angle = Math.atan(f.slope);
    const deg = Math.abs((angle * 180) / Math.PI);
    if (deg > MAX_ANGLE || deg < MIN_ANGLE) angle = 0;

    // Drehpunkt: Anfang der Zeile auf der Grundlinie
    const px = f.minX;
    const py = f.y0 + f.slope * (px - f.x0);
    let dy = 0;
    const r = ruling(g.page.template);
    if (r && f.h < r.step * 1.1) {
      // Nächste Linie suchen (auf liniertem Papier)
      const k = Math.round((py - r.y0) / r.step);
      const lineY = r.y0 + k * r.step;
      if (k >= 0 && lineY <= r.y1 && Math.abs(lineY - py) < r.step * 0.45) dy = lineY - py;
    } else if (last && last.page === g.page && Date.now() - last.at < 60000) {
      // Leeres Papier: Weiter in derselben Zeile geschrieben -> gleiche Grundlinie wie davor
      const near = Math.abs(last.y - py) < Math.max(f.h, last.h) * 0.6 && px > last.x0 - f.h;
      if (near) dy = last.y - py;
    }
    if (Math.abs(dy) < 0.6) dy = 0;

    last = { page: g.page, y: py + dy, x0: f.minX, h: f.h, at: Date.now() };
    if (angle === 0 && dy === 0) return;

    // erst um den Drehpunkt drehen, dann senkrecht verschieben
    const m = compose(translate(px, py + dy), rotate(-angle), translate(-px, -py));
    const added = strokes.map((s) => transformStroke(s, m));
    commit([{ page: g.page, added, removed: strokes }], 'Handschrift geradegerückt');
  }

  // ---------- Hilfslinie zeichnen ----------
  function drawGuide() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!group?.fit || group.strokes.length < 2 || !isOn()) return;
    if (ruling(group.page.template)) return; // liniertes Papier hat schon Linien
    const index = doc.pages.indexOf(group.page);
    if (index < 0) return;
    const top = doc.top(index);
    const f = group.fit;
    const yAt = (x) => f.y0 + f.slope * (x - f.x0) + top;
    const x0 = Math.max(0, f.minX - f.h);
    const x1 = PAGE_WIDTH - 10;
    const a = view.toScreen(x0, yAt(x0));
    const b = view.toScreen(x1, yAt(x1));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(74, 108, 247, 0.55)';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  return {
    strokeStarted,
    strokeAdded,
    finish,
    // Ansicht verschoben/gezoomt -> Hilfslinie mitbewegen
    redraw: drawGuide,
    // Werkzeug/Seite gewechselt, Notiz geschlossen: laufende Zeile vergessen
    reset() {
      clearTimeout(timer);
      group = null;
      last = null;
      drawGuide();
    },
  };
}

// ---------- Grundlinie schätzen ----------
// Ergebnis: { x0, y0, slope, h, minX, maxX } – Grundlinie y = y0 + slope · (x − x0),
// h = typische Buchstabenhöhe (Seiten-Einheiten)
export function fitBaseline(strokes) {
  if (!strokes.length) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  const all = strokes.map((s) => {
    minX = Math.min(minX, s.box.minX);
    maxX = Math.max(maxX, s.box.maxX);
    // unterster Punkt des Strichs
    let bx = 0;
    let by = -Infinity;
    for (const p of s.points) {
      if (p[1] > by) {
        by = p[1];
        bx = p[0];
      }
    }
    return { p: [bx, by], h: Math.max(s.box.maxY - s.box.minY, (s.box.maxX - s.box.minX) * 0.5) };
  });
  // Winzige Striche (i-Punkte, Umlaut-Punkte, Kommas) zählen weder für die Höhe noch für die Grundlinie
  const tallest = Math.max(...all.map((a) => a.h));
  const real = all.filter((a) => a.h >= tallest * 0.3);
  const h = Math.max(4, median(real.map((a) => a.h)));
  const pts = real.map((a) => a.p);
  // Bei wenigen, eng beieinander liegenden Strichen (z. B. nur ein Großbuchstabe) ist eine
  // Schräge nicht zu messen -> waagerecht annehmen
  if (maxX - minX < h * 4 || pts.length < 3) {
    return { x0: minX, y0: median(pts.map((p) => p[1])), slope: 0, h, minX, maxX };
  }
  let line = theilSen(pts);
  // Unterlängen (deutlich unter der Linie) und Ausreißer weglassen, dann nochmal
  const keep = pts.filter(([x, y]) => Math.abs(y - (line.y0 + line.slope * (x - line.x0))) < h * 0.35);
  if (keep.length >= 2) line = theilSen(keep);
  line.slope = Math.max(-0.47, Math.min(0.47, line.slope)); // höchstens ~25° schräg
  return { ...line, h, minX, maxX };
}

// Robuste Gerade: Median aller Steigungen zwischen Punktpaaren (Theil-Sen)
function theilSen(pts) {
  if (pts.length === 1) return { x0: pts[0][0], y0: pts[0][1], slope: 0 };
  const slopes = [];
  for (let i = 0; i < pts.length; i++) {
    for (let j = i + 1; j < pts.length; j++) {
      const dx = pts[j][0] - pts[i][0];
      if (Math.abs(dx) > 2) slopes.push((pts[j][1] - pts[i][1]) / dx);
    }
  }
  const slope = slopes.length ? median(slopes) : 0;
  const x0 = median(pts.map((p) => p[0]));
  const y0 = median(pts.map((p) => p[1] - slope * (p[0] - x0)));
  return { x0, y0, slope };
}

function median(list) {
  const a = [...list].sort((x, y) => x - y);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
