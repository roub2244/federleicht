// assist.js – Handschrifthilfe (wie in Samsung Notes)
//
// Ist die Handschrifthilfe an (Knopf oben in der Leiste), hilft die App beim ordentlichen Schreiben:
//
//   1. Hilfslinie: Während du eine Zeile schreibst, erscheint unter der Schrift eine feine,
//      gestrichelte Linie in Schreibrichtung – so bleibt die Zeile gerade (auf leerem oder
//      kariertem Papier; auf liniertem Papier gibt es ja schon Linien).
//   2. Zeile geraderücken: Sobald du eine Zeile fertig hast (in die nächste Zeile wechselst
//      oder kurz Pause machst), wird schräg Geschriebenes waagerecht gedreht.
//   3. Auf die Linie setzen: Auf liniertem, kariertem und Mathe-Papier rutscht die Zeile genau
//      auf die nächste Linie des Papiers (auf Karo-Papier: die nächste Kästchen-Linie).
//      Schreibst du später in derselben Zeile weiter, kommt das Neue auf dieselbe Grundlinie.
//   4. An die Zeilenhöhe anpassen: Ist die Schrift zu groß für die Zeile (oder für 1–2 Kästchen),
//      wird sie passend kleiner – so steht alles ordentlich zwischen den Linien.
//
// Was davon passiert, stellst du im Menü der Handschrifthilfe ein (Knopf nochmal antippen),
// siehe options(): { guide, straighten, snap, fit, boxes }.
//
// Das Geraderücken ist ein eigener Schritt beim Rückgängigmachen: Einmal "Rückgängig"
// stellt deine Original-Schrift wieder her.
//
// Wie finden wir die "Grundlinie" (die Linie, auf der die Buchstaben stehen)?
// Für jeden Strich nehmen wir seinen untersten Punkt. Durch diese Punkte legen wir eine
// Gerade – robust, also so, dass Unterlängen (g, j, p, q, y) nicht stören: Erst grob schätzen,
// dann alles weglassen, was deutlich darunter hängt, und nochmal schätzen.

import { transformStroke, finishStroke } from './ink.js';
import { compose, translate, rotate, scale } from './geometry.js';
import { paperLines } from './templates.js';
import { PAGE_WIDTH } from './view.js';

const IDLE_MS = 1600;        // so lange Pause -> Zeile gilt als fertig
const MAX_ANGLE = 22;        // stärker schräg (Grad) ist vermutlich Absicht (z. B. Beschriftung) -> nicht drehen
const MIN_ANGLE = 1.2;       // weniger schräg lohnt sich nicht
const MAX_TEXT_HEIGHT = 110; // höhere Striche (Seiten-Einheiten, ~23 mm) sind eher Zeichnung als Schrift

export function setupAssist({ stage, view, doc, renderer, commit, isOn, options }) {
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

  // ---------- Zeile fertig: geraderücken, anpassen und auf die Linie setzen ----------
  function finish() {
    clearTimeout(timer);
    const g = group;
    group = null;
    drawGuide();
    if (!g || !isOn()) return;
    const opts = options();
    const strokes = g.strokes.filter((s) => g.page.strokes.includes(s)); // inzwischen radiert/rückgängig?
    if (strokes.length < 2 || !doc.pages.includes(g.page)) return;
    const f = fitBaseline(strokes);
    if (!f) return;
    const width = f.maxX - f.minX;
    if (width < f.h * 2.5) return; // ein einzelner Buchstabe oder ein Zeichen: lieber nichts ändern

    let angle = opts.straighten ? Math.atan(f.slope) : 0;
    const deg = Math.abs((angle * 180) / Math.PI);
    if (deg > MAX_ANGLE || deg < MIN_ANGLE) angle = 0;

    // Drehpunkt: Anfang der Zeile auf der Grundlinie
    const px = f.minX;
    const py = f.y0 + f.slope * (px - f.x0);
    const plan = planLine(g.page, f, px, py, opts);
    const dy = plan.dy;
    const k = plan.k;

    last = { page: g.page, y: py + dy, x0: f.minX, h: f.h * k, at: Date.now() };
    if (angle === 0 && dy === 0 && k === 1) return;

    // erst um den Drehpunkt drehen und verkleinern, dann senkrecht verschieben
    const m = compose(translate(px, py + dy), scale(k), rotate(-angle), translate(-px, -py));
    const added = strokes.map((s) => {
      const t = transformStroke(s, m);
      if (k === 1) return t;
      // Kleiner machen, aber gleich dick weiterschreiben (wie mit demselben Stift)
      t.size = s.size;
      t.layers = null;
      t.box = null;
      return finishStroke(t);
    });
    commit([{ page: g.page, added, removed: strokes }], k !== 1 ? 'Handschrift an die Zeile angepasst' : 'Handschrift geradegerückt');
  }

  // Wohin mit der Zeile? dy = senkrecht verschieben, k = verkleinern (1 = so lassen), lineY = Ziel-Linie
  function planLine(page, f, px, py, opts) {
    let dy = 0;
    let k = 1;
    let lineY = null;
    const lines = paperLines(page.template);
    if (lines && (opts.snap || opts.fit)) {
      // Platz pro Zeile: liniert eine Linie, kariert 1 oder 2 Kästchen
      const room = lines.kind === 'grid' ? lines.step * (opts.boxes || 2) : lines.step;
      if (opts.fit && f.h > room * 0.92) k = Math.max(0.35, (room * 0.72) / f.h);
      if (opts.snap) {
        const n = Math.round((py - lines.y0) / lines.step);
        const y = lines.y0 + n * lines.step;
        const near = Math.abs(y - py) < lines.step * (lines.kind === 'grid' ? 0.75 : 0.6);
        if (n >= 0 && y <= lines.y1 + 0.5 && near) {
          lineY = y;
          dy = y - py;
        }
      }
    } else if (last && last.page === page && Date.now() - last.at < 60000) {
      // Leeres Papier: Weiter in derselben Zeile geschrieben -> gleiche Grundlinie wie davor
      const near = Math.abs(last.y - py) < Math.max(f.h, last.h) * 0.6 && px > last.x0 - f.h;
      if (near) dy = last.y - py;
    }
    if (Math.abs(dy) < 0.6) dy = 0;
    return { dy, k, lineY };
  }

  // ---------- Hilfslinie zeichnen ----------
  // Leeres Papier: gestrichelte Linie in Schreibrichtung.
  // Papier mit Linien (und "Auf die Linien setzen" an): die Linie, auf der die Zeile landen wird, leuchtet.
  function drawGuide() {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!group?.fit || group.strokes.length < 2 || !isOn()) return;
    const opts = options();
    if (!opts.guide) return;
    const index = doc.pages.indexOf(group.page);
    if (index < 0) return;
    const top = doc.top(index);
    const f = group.fit;
    const lines = paperLines(group.page.template);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (lines) {
      if (!opts.snap) return; // Linien sind ja schon da
      const px = f.minX;
      const py = f.y0 + f.slope * (px - f.x0);
      const { lineY } = planLine(group.page, f, px, py, opts);
      if (lineY === null) return;
      const a = view.toScreen(Math.max(0, f.minX - f.h), lineY + top);
      const b = view.toScreen(PAGE_WIDTH - 10, lineY + top);
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      const grad = ctx.createLinearGradient(a[0], 0, b[0], 0);
      grad.addColorStop(0, 'rgba(74, 108, 247, 0.75)');
      grad.addColorStop(1, 'rgba(74, 108, 247, 0)');
      ctx.strokeStyle = grad;
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      return;
    }
    const yAt = (x) => f.y0 + f.slope * (x - f.x0) + top;
    const x0 = Math.max(0, f.minX - f.h);
    const x1 = PAGE_WIDTH - 10;
    const a = view.toScreen(x0, yAt(x0));
    const b = view.toScreen(x1, yAt(x1));
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = 'rgba(74, 108, 247, 0.55)';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
    ctx.setLineDash([]);
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
