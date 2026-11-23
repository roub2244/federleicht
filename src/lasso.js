// lasso.js – Auswählen, Verschieben, Vergrößern, Drehen, Kopieren … (wie das Lasso in Samsung Notes)
//
// Bedienung:
//   - Werkzeug "Lasso" wählen und mit dem Stift eine Schlinge um Striche/Textfelder ziehen
//     (oder ein Rechteck aufziehen – im Lasso-Menü einstellbar)
//   - Einzelnen Strich oder ein Textfeld kurz antippen = nur das auswählen
//   - Auswahl ziehen = verschieben (auch auf eine andere Seite)
//   - Griffe an den Ecken = größer/kleiner (Ecken: Seitenverhältnis bleibt), an den Seiten = strecken
//   - Runder Griff oben = drehen (rastet bei 0°, 45°, 90° … ein)
//   - Leiste über der Auswahl: Ausschneiden, Kopieren, Duplizieren, Farbe, Nach vorne/hinten, Löschen
//   - Mit dem Lasso auf eine freie Stelle tippen, wenn etwas kopiert ist = "Einfügen"
//
// Was ausgewählt ist, bleibt ganz normal in page.strokes. Erst wenn du loslässt, ersetzen wir
// die Striche durch verwandelte Kopien (gleiches z = gleiche Reihenfolge). Das ist EIN Schritt
// zum Rückgängigmachen und wird gespeichert wie jede andere Änderung.
//
// Während du ziehst, wird nichts umgerechnet: Die ausgewählten Striche werden kurz aus dem
// Zwischenbild genommen und mit einer Matrix (siehe geometry.js) verschoben/gedreht darübergemalt.
// Das geht auch bei vielen Strichen flüssig.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { fillStroke, strokeHit, transformStroke, recolorStroke, withZ } from './ink.js';
import { textContentBox } from './text.js';
import {
  IDENTITY, compose, translate, rotate, scale, apply, isIdentity, pointInPolygon, boundsOf, unionBox, snapAngle, DEG,
} from './geometry.js';
import { COLOR_PAGES } from './tools.js';
import { paint } from './paint.js';
import { isLight } from './pens.js';

const PAD = 7;             // so viel Rand (Seiten-Einheiten) hat der Auswahlrahmen um die Striche
const TAP = 8;             // Bildschirm-Pixel: weniger Bewegung = Antippen
const PASTE_OFFSET = 24;   // Duplikate und Einfügungen landen etwas versetzt
const PALM_SIZE = 45;      // so große Berührungen sind der Handballen

const ICON = {
  cut: '<svg viewBox="0 0 24 24"><circle cx="6.5" cy="17.5" r="2.8"/><circle cx="17.5" cy="17.5" r="2.8"/><path d="M8.6 15.6 18 4M15.4 15.6 6 4"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/></svg>',
  paste: '<svg viewBox="0 0 24 24"><path d="M9 4.5h6v2.5H9z"/><path d="M15 5.5h1.8A2.2 2.2 0 0 1 19 7.7v11.1a2.2 2.2 0 0 1-2.2 2.2H7.2A2.2 2.2 0 0 1 5 18.8V7.7a2.2 2.2 0 0 1 2.2-2.2H9"/></svg>',
  duplicate: '<svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2.2"/><path d="M14 11.5v5M11.5 14h5M15.5 8.5V6.7a2.2 2.2 0 0 0-2.2-2.2H6.7a2.2 2.2 0 0 0-2.2 2.2v6.6a2.2 2.2 0 0 0 2.2 2.2h1.8"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4.5h6V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/></svg>',
  color: '<svg viewBox="0 0 24 24"><path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.3 0 2-.8 2-1.8 0-1.3-1.2-1.6-1.2-2.8 0-1 .8-1.6 1.9-1.6h2.2a3.6 3.6 0 0 0 3.6-3.6c0-4-3.8-7.2-8.5-7.2z"/><circle cx="7.8" cy="11.5" r="1.2" fill="currentColor"/><circle cx="10.5" cy="7.6" r="1.2" fill="currentColor"/><circle cx="15" cy="7.8" r="1.2" fill="currentColor"/></svg>',
  front: '<svg viewBox="0 0 24 24"><path d="M12 3.5 20 8l-8 4.5L4 8z"/><path d="m4 12.5 8 4.5 8-4.5" opacity=".45"/><path d="m4 16.5 8 4.5 8-4.5" opacity=".45"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M12 3.5 20 8l-8 4.5L4 8z" opacity=".45"/><path d="m4 12.5 8 4.5 8-4.5" opacity=".45"/><path d="m4 16.5 8 4.5 8-4.5"/></svg>',
  rotate: '<svg viewBox="0 0 24 24"><path d="M19 12a7 7 0 1 1-2.1-5"/><path d="M17.5 3.5v4h-4"/></svg>',
};

export function setupLasso({ stage, view, doc, renderer, tools, commit, newZ, currentIndex, toast }) {
  // ---------- Bausteine auf dem Bildschirm ----------
  const layer = document.createElement('div');
  layer.className = 'sel-layer';
  layer.innerHTML = `
    <svg class="sel-svg"><path class="lasso-under"/><path class="lasso-path"/></svg>
    <div class="sel-box" hidden>
      <div class="sel-frame"></div>
      <span class="sel-rot-line"></span>
      ${['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((h) => `<i class="sel-h" data-h="${h}"></i>`).join('')}
      <button class="sel-rot" data-h="rot" aria-label="Drehen">${ICON.rotate}</button>
    </div>
    <div class="sel-angle" hidden></div>`;
  stage.appendChild(layer);
  const svgPaths = layer.querySelectorAll('.sel-svg path');
  const box = layer.querySelector('.sel-box');
  const angleLabel = layer.querySelector('.sel-angle');

  const bar = document.createElement('div');
  bar.className = 'sel-bar';
  bar.hidden = true;
  bar.innerHTML = [
    ['cut', 'Ausschneiden'],
    ['copy', 'Kopieren'],
    ['duplicate', 'Duplizieren'],
    ['color', 'Farbe'],
    ['front', 'Nach vorne'],
    ['back', 'Nach hinten'],
    ['trash', 'Löschen'],
  ]
    .map(([act, label]) => `<button class="sb-btn${act === 'trash' ? ' danger' : ''}" data-act="${act}">${ICON[act]}<span>${label}</span></button>`)
    .join('');
  document.body.appendChild(bar);

  const colors = document.createElement('div');
  colors.className = 'sel-colors';
  colors.hidden = true;
  document.body.appendChild(colors);

  const pasteBtn = document.createElement('button');
  pasteBtn.className = 'sel-paste';
  pasteBtn.hidden = true;
  pasteBtn.innerHTML = `${ICON.paste}<span>Einfügen</span>`;
  document.body.appendChild(pasteBtn);

  // ---------- Zustand ----------
  let sel = null;       // { page, items, frame: { cx, cy, w, h, angle }, hasText }
  let drawing = null;   // Lasso wird gerade gezogen: { page, pts, startClient, lastClient }
  let drag = null;      // Auswahl wird gerade verschoben/verändert
  let clipboard = null; // { items, frame }
  let pasteAt = null;   // wohin "Einfügen" (Dokument-Punkt)

  const indexOf = (page) => doc.pages.indexOf(page);
  const stageRect = () => stage.getBoundingClientRect();
  // Bildschirm (Fenster) -> Seiten-Koordinaten der Seite mit Nummer index
  const clientToLocal = (x, y, index) => {
    const r = stageRect();
    const [px, py] = view.toPage(x - r.left, y - r.top);
    return [px, py - doc.top(index)];
  };
  const localToScreen = (p, index) => view.toScreen(p[0], p[1] + doc.top(index));

  // ---------- Lasso ziehen (Stift auf der Seite, siehe main.js) ----------
  // Dokument-Punkt -> Fenster-Punkt (für Abstände in Pixeln und das "Einfügen"-Knöpfchen)
  const docToClient = (p) => {
    const r = stageRect();
    const [x, y] = view.toScreen(p[0], p[1]);
    return [x + r.left, y + r.top];
  };

  function penDown(point) {
    hidePaste();
    clear();
    const index = doc.indexAt(point[1]);
    const local = [point[0], point[1] - doc.top(index)];
    const client = docToClient(point);
    drawing = { page: doc.pages[index], pts: [local], start: local, startClient: client, lastClient: client, moved: false };
    drawPath();
  }

  function penMove(points) {
    if (!drawing || !points.length) return;
    const client = docToClient(points[points.length - 1]);
    drawing.lastClient = client;
    const index = indexOf(drawing.page);
    const top = doc.top(index);
    const minStep = 1.5 / view.scale;
    for (const p of points) {
      const local = [p[0], p[1] - top];
      const last = drawing.pts[drawing.pts.length - 1];
      if (Math.hypot(local[0] - last[0], local[1] - last[1]) >= minStep) drawing.pts.push(local);
    }
    if (Math.hypot(client[0] - drawing.startClient[0], client[1] - drawing.startClient[1]) > TAP) drawing.moved = true;
    drawPath();
  }

  function penUp() {
    if (!drawing) return;
    const d = drawing;
    const client = d.lastClient;
    drawing = null;
    drawPath();
    const index = indexOf(d.page);
    if (index < 0) return;

    if (!d.moved) {
      // Antippen: einzelnen Strich / Textfeld auswählen – oder "Einfügen" anbieten
      const p = d.start;
      const hit = hitItem(d.page, p[0], p[1]);
      if (hit) select(d.page, [hit]);
      else if (clipboard) showPaste(client, [p[0], p[1] + doc.top(index)]);
      return;
    }
    const poly = lassoPolygon(d);
    const items = d.page.strokes.filter((s) => wanted(s) && inside(s, poly));
    if (items.length) select(d.page, items);
    else toast('Nichts ausgewählt – einfach eine Schlinge um Striche oder Text ziehen');
  }

  // Die Form des Lassos: Freihand oder Rechteck (vom Anfangspunkt bis zum letzten Punkt)
  function lassoPolygon(d) {
    if (tools.lasso.mode !== 'rect') return d.pts;
    const a = d.start;
    const b = d.pts[d.pts.length - 1];
    return [a, [b[0], a[1]], b, [a[0], b[1]]];
  }

  function wanted(s) {
    if (tools.lasso.what === 'ink') return s.tool !== 'text';
    if (tools.lasso.what === 'text') return s.tool === 'text';
    return true;
  }

  // Liegt ein Strich "im Lasso"? Mindestens die Hälfte seiner Punkte muss drin sein.
  // Rechteck, das zählt: bei Textfeldern nur dort, wo wirklich Text steht
  const boxOf = (s) => (s.tool === 'text' ? textContentBox(s) : s.box);

  function inside(s, poly) {
    if (!s.box) return false;
    const b = boxOf(s);
    if (!b) return false;
    const pb = boundsOf(poly);
    if (b.maxX < pb.minX || b.minX > pb.maxX || b.maxY < pb.minY || b.minY > pb.maxY) return false;
    let samples;
    if (s.tool === 'text') {
      samples = [];
      for (let i = 0; i < 3; i++) {
        for (let k = 0; k < 3; k++) samples.push([b.minX + ((b.maxX - b.minX) * (i + 0.5)) / 3, b.minY + ((b.maxY - b.minY) * (k + 0.5)) / 3]);
      }
    } else {
      const step = Math.max(1, Math.floor(s.points.length / 40));
      samples = s.points.filter((_, i) => i % step === 0);
    }
    const count = samples.filter((p) => pointInPolygon(p, poly)).length;
    return count >= samples.length * 0.5;
  }

  // Oberstes Element an dieser Stelle (Seiten-Koordinaten)
  function hitItem(page, x, y) {
    const r = 9 / view.scale;
    for (let i = page.strokes.length - 1; i >= 0; i--) {
      const s = page.strokes[i];
      if (!wanted(s)) continue;
      if (s.tool === 'text' ? boxHit(boxOf(s), x, y, r) : strokeHit(s, x, y, r) || fillHit(s, x, y)) return s;
    }
    return null;
  }

  const boxHit = (b, x, y, r) => x >= b.minX - r && x <= b.maxX + r && y >= b.minY - r && y <= b.maxY + r;

  // Gefüllte Form: auch das Innere zählt beim Antippen
  function fillHit(s, x, y) {
    return Boolean(s.fillPath && s.box && x >= s.box.minX && x <= s.box.maxX && y >= s.box.minY && y <= s.box.maxY && pointInPolygon([x, y], s.points));
  }

  // Lasso-Linie zeichnen (gestrichelt, "marschierende Ameisen")
  function drawPath() {
    if (!drawing) {
      for (const p of svgPaths) p.setAttribute('d', '');
      return;
    }
    const index = indexOf(drawing.page);
    const pts = lassoPolygon(drawing).map((p) => localToScreen(p, index));
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join('') + (tools.lasso.mode === 'rect' ? 'Z' : '');
    for (const p of svgPaths) p.setAttribute('d', d);
  }

  // ---------- Auswahl ----------
  function select(page, items) {
    const boxes = items.filter((s) => s.box).map(boxOf);
    const b = boxes.reduce((acc, x) => unionBox(acc, x), null);
    if (!b) return;
    sel = {
      page,
      items,
      hasText: items.some((s) => s.tool === 'text'),
      frame: { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX + PAD * 2, h: b.maxY - b.minY + PAD * 2, angle: 0 },
    };
    box.classList.toggle('has-text', sel.hasText);
    navigator.vibrate?.(8);
    place();
  }

  function clear() {
    if (drag) endDrag(null, true);
    sel = null;
    closeColors();
    place();
  }

  // Rahmen, Griffe und Leiste an die Auswahl anpassen (auch nach Zoomen/Verschieben)
  function place() {
    drawPath();
    if (pasteAt && !pasteBtn.hidden) placePaste();
    if (!sel || indexOf(sel.page) < 0) {
      if (sel) sel = null;
      box.hidden = true;
      bar.hidden = true;
      closeColors();
      return;
    }
    const f = drag?.frame || sel.frame;
    const index = indexOf(sel.page);
    const [x, y] = localToScreen([f.cx, f.cy], index);
    const s = view.scale;
    box.hidden = false;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    box.style.width = `${f.w * s}px`;
    box.style.height = `${f.h * s}px`;
    box.style.transform = `translate(-50%, -50%) rotate(${f.angle}rad)`;
    box.classList.toggle('small', Math.min(f.w, f.h) * s < 90);
    box.classList.toggle('dragging', Boolean(drag));
    bar.hidden = Boolean(drag);
    if (!drag) placeBar(f, index);
  }

  // Leiste über (oder unter) die Auswahl
  function placeBar(f, index) {
    const corners = frameCorners(f).map((p) => localToScreen(p, index));
    const sb = boundsOf(corners);
    const r = stageRect();
    const w = bar.offsetWidth || 560;
    const h = bar.offsetHeight || 60;
    // Über dem Rahmen sitzt der Drehgriff – die Leiste muss noch darüber
    let top = r.top + sb.minY - h - (sel.hasText ? 22 : 72);
    if (top < r.top + 8) top = r.top + sb.maxY + 18;
    top = Math.min(top, window.innerHeight - h - 8);
    const left = Math.min(window.innerWidth - w - 8, Math.max(8, r.left + (sb.minX + sb.maxX) / 2 - w / 2));
    bar.style.left = `${left}px`;
    bar.style.top = `${Math.max(r.top + 8, top)}px`;
    if (!colors.hidden) placeColors();
  }

  function frameCorners(f) {
    const m = compose(translate(f.cx, f.cy), rotate(f.angle));
    return [[-f.w / 2, -f.h / 2], [f.w / 2, -f.h / 2], [f.w / 2, f.h / 2], [-f.w / 2, f.h / 2]].map((p) => apply(m, p));
  }

  // ---------- Ziehen: verschieben, vergrößern, drehen ----------
  box.addEventListener('pointerdown', (e) => {
    if (!sel || drag) return;
    if (e.pointerType === 'touch' && Math.max(e.width || 0, e.height || 0) > PALM_SIZE) return; // Handballen
    e.preventDefault();
    e.stopPropagation();
    closeColors();
    hidePaste();
    const handle = e.target.closest('[data-h]')?.dataset.h || 'move';
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    const index = indexOf(sel.page);
    drag = {
      id: e.pointerId,
      handle,
      index,
      start: clientToLocal(e.clientX, e.clientY, index),
      startClient: [e.clientX, e.clientY],
      from: { ...sel.frame },
      frame: { ...sel.frame },
      m: IDENTITY,
      shown: false,
    };
  });

  box.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = Math.hypot(e.clientX - drag.startClient[0], e.clientY - drag.startClient[1]);
    if (!drag.shown && moved < 3) return;
    if (!drag.shown) {
      // Ab jetzt die Auswahl "anheben": aus dem Zwischenbild nehmen und darübermalen
      drag.shown = true;
      for (const s of sel.items) s.hidden = true;
      renderer.renderNow();
    }
    const p = clientToLocal(e.clientX, e.clientY, drag.index);
    computeDrag(p);
    showPreview();
    place();
  });

  box.addEventListener('pointerup', (e) => {
    if (drag && e.pointerId === drag.id) endDrag(e);
  });
  box.addEventListener('pointercancel', (e) => {
    if (drag && e.pointerId === drag.id) endDrag(e, true);
  });
  box.addEventListener('contextmenu', (e) => e.preventDefault());

  function computeDrag(p) {
    const f = drag.from;
    const c = [f.cx, f.cy];
    let m = IDENTITY;
    let frame = { ...f };
    angleLabel.hidden = true;

    if (drag.handle === 'move') {
      m = translate(p[0] - drag.start[0], p[1] - drag.start[1]);
      frame = { ...f, cx: f.cx + m[4], cy: f.cy + m[5] };
    } else if (drag.handle === 'rot') {
      const a0 = Math.atan2(drag.start[1] - c[1], drag.start[0] - c[0]);
      const a1 = Math.atan2(p[1] - c[1], p[0] - c[0]);
      let total = f.angle + a1 - a0;
      total = Math.atan2(Math.sin(total), Math.cos(total)); // auf -180° … 180° bringen
      total = snapAngle(total, 45 * DEG, 4 * DEG);
      const delta = total - f.angle;
      m = compose(translate(c[0], c[1]), rotate(delta), translate(-c[0], -c[1]));
      frame = { ...f, angle: total };
      showAngle(total);
    } else {
      // Vergrößern: der gegenüberliegende Griff bleibt stehen ("Anker")
      const hx = drag.handle.includes('e') ? 1 : drag.handle.includes('w') ? -1 : 0;
      const hy = drag.handle.includes('s') ? 1 : drag.handle.includes('n') ? -1 : 0;
      const back = compose(rotate(-f.angle), translate(-c[0], -c[1]));
      const l = apply(back, p);
      const anchor = [(-hx * f.w) / 2, (-hy * f.h) / 2];
      const minSize = 16 / view.scale;
      let sx = 1;
      let sy = 1;
      if (hx && hy) {
        // Ecke: Seitenverhältnis bleibt
        const d = [hx * f.w, hy * f.h];
        const t = ((l[0] - anchor[0]) * d[0] + (l[1] - anchor[1]) * d[1]) / (d[0] * d[0] + d[1] * d[1]);
        sx = sy = Math.max(t, minSize / Math.min(f.w, f.h));
      } else if (hx) {
        sx = Math.max(((l[0] - anchor[0]) * hx) / f.w, minSize / f.w);
      } else {
        sy = Math.max(((l[1] - anchor[1]) * hy) / f.h, minSize / f.h);
      }
      m = compose(translate(c[0], c[1]), rotate(f.angle), translate(anchor[0], anchor[1]), scale(sx, sy), translate(-anchor[0], -anchor[1]), rotate(-f.angle), translate(-c[0], -c[1]));
      const nc = apply(m, c);
      frame = { cx: nc[0], cy: nc[1], w: f.w * sx, h: f.h * sy, angle: f.angle };
    }
    drag.m = m;
    drag.frame = frame;
  }

  function showAngle(angle) {
    let deg = Math.round(angle / DEG);
    if (deg <= -180) deg += 360;
    angleLabel.textContent = `${deg}°`;
    angleLabel.hidden = false;
    const [x, y] = localToScreen([drag.from.cx, drag.from.cy], drag.index);
    angleLabel.style.left = `${x}px`;
    angleLabel.style.top = `${y}px`;
  }

  // Die angehobene Auswahl mit der aktuellen Matrix darübermalen
  function showPreview() {
    const { m, index, frame } = drag;
    const items = sel.items;
    const corners = frameCorners(frame).map((p) => localToScreen(p, index));
    const b = boundsOf(corners);
    const pad = 12;
    renderer.setOverlay({
      box: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
      draw(ctx, rend) {
        rend.applyView(ctx);
        ctx.translate(0, doc.top(index));
        ctx.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
        rend.useInkOf(index);
        for (const s of items) fillStroke(ctx, s);
      },
    });
  }

  function endDrag(e, cancel = false) {
    const d = drag;
    drag = null;
    angleLabel.hidden = true;
    if (!sel) return;
    for (const s of sel.items) delete s.hidden;
    try {
      if (e) box.releasePointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    if (cancel || !d.shown || isIdentity(d.m)) {
      renderer.setOverlay(null);
      renderer.renderNow();
      place();
      return;
    }

    // Auf eine andere Seite gezogen? Dann gehört die Auswahl ab jetzt dieser Seite.
    let m = d.m;
    let frame = d.frame;
    let target = sel.page;
    if (d.handle === 'move') {
      const docY = doc.top(d.index) + frame.cy;
      const ti = doc.indexAt(docY);
      if (ti !== d.index) {
        const shift = doc.top(d.index) - doc.top(ti);
        m = compose(translate(0, shift), m);
        frame = { ...frame, cy: frame.cy + shift };
        target = doc.pages[ti];
      }
      // Nicht neben die Seite schieben (dort wäre es unsichtbar): Mitte bleibt auf dem Blatt
      const cx = Math.max(0, Math.min(PAGE_WIDTH, frame.cx));
      const cy = Math.max(0, Math.min(PAGE_HEIGHT, frame.cy));
      if (cx !== frame.cx || cy !== frame.cy) {
        m = compose(translate(cx - frame.cx, cy - frame.cy), m);
        frame = { ...frame, cx, cy };
      }
    }
    const fresh = sel.items.map((s) => transformStroke(s, m));
    const changes =
      target === sel.page
        ? [{ page: sel.page, added: fresh, removed: sel.items }]
        : [
            { page: sel.page, added: [], removed: sel.items },
            { page: target, added: fresh, removed: [] },
          ];
    renderer.setOverlay(null);
    commit(changes);
    renderer.renderNow();
    sel = { ...sel, page: target, items: fresh, frame };
    place();
  }

  // ---------- Befehle der Leiste ----------
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-act]');
    if (!btn || !sel) return;
    run(btn.dataset.act);
  });

  function run(act) {
    if (!sel) return;
    if (act === 'copy') {
      copy();
      toast(`${countText(sel.items.length)} kopiert – mit dem Lasso auf eine freie Stelle tippen zum Einfügen`);
    } else if (act === 'cut') {
      copy();
      remove();
      toast('Ausgeschnitten – mit dem Lasso auf eine freie Stelle tippen zum Einfügen');
    } else if (act === 'duplicate') {
      const page = sel.page;
      const items = place_(sel.items, page, PASTE_OFFSET, PASTE_OFFSET);
      commit([{ page, added: items, removed: [] }]);
      select(page, items);
    } else if (act === 'trash') {
      remove();
    } else if (act === 'color') {
      if (colors.hidden) openColors();
      else closeColors();
    } else if (act === 'front' || act === 'back') {
      reorder(act === 'front');
    }
  }

  function copy() {
    clipboard = { items: sel.items.slice().sort((a, b) => a.z - b.z), frame: { ...sel.frame }, page: sel.page };
  }

  function remove() {
    commit([{ page: sel.page, added: [], removed: sel.items }]);
    sel = null;
    place();
  }

  // Kopien der Elemente, verschoben um dx/dy, mit neuen z-Nummern (liegen also oben)
  function place_(items, page, dx, dy) {
    const m = translate(dx, dy);
    return items
      .slice()
      .sort((a, b) => a.z - b.z)
      .map((s) => withZ(transformStroke(s, m), newZ()));
  }

  function reorder(front) {
    const page = sel.page;
    const sorted = sel.items.slice().sort((a, b) => a.z - b.z);
    let fresh;
    if (front) fresh = sorted.map((s) => withZ(s, newZ()));
    else {
      const min = Math.min(...page.strokes.map((s) => s.z));
      fresh = sorted.map((s, i) => withZ(s, min - sorted.length + i));
    }
    commit([{ page, added: fresh, removed: sel.items }]);
    renderer.renderNow();
    sel = { ...sel, items: fresh };
    toast(front ? 'Nach vorne geholt' : 'Nach hinten gelegt');
  }

  // ---------- Farbe ändern ----------
  function openColors() {
    const list = [...COLOR_PAGES[0], ...COLOR_PAGES[1], ...tools.recent.slice(0, 8)];
    const unique = [...new Set(list)];
    colors.innerHTML = unique
      .map((c) => `<button class="swatch-btn${isLight(c) ? ' light' : ''}" data-color="${c}" aria-label="Farbe ${c}">${paint(c)}</button>`)
      .join('');
    colors.hidden = false;
    bar.querySelector('[data-act="color"]').classList.add('on');
    placeColors();
  }

  function closeColors() {
    colors.hidden = true;
    bar.querySelector('[data-act="color"]')?.classList.remove('on');
  }

  function placeColors() {
    const b = bar.getBoundingClientRect();
    const w = colors.offsetWidth || 300;
    const h = colors.offsetHeight || 100;
    const btn = bar.querySelector('[data-act="color"]').getBoundingClientRect();
    let top = b.top - h - 10;
    if (top < 8) top = b.bottom + 10;
    colors.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, btn.left + btn.width / 2 - w / 2))}px`;
    colors.style.top = `${top}px`;
  }

  colors.addEventListener('pointerdown', (e) => e.stopPropagation());
  colors.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-color]');
    if (!btn || !sel) return;
    const color = btn.dataset.color;
    const fresh = sel.items.map((s) => withZ(recolorStroke(s, color), s.z));
    commit([{ page: sel.page, added: fresh, removed: sel.items }]);
    renderer.renderNow();
    sel = { ...sel, items: fresh };
    closeColors();
  });

  // ---------- Einfügen ----------
  function showPaste(client, docPoint) {
    pasteAt = docPoint;
    pasteBtn.hidden = false;
    pasteBtn.dataset.x = client[0];
    pasteBtn.dataset.y = client[1];
    placePaste();
  }

  function placePaste() {
    const x = Number(pasteBtn.dataset.x);
    const y = Number(pasteBtn.dataset.y);
    const w = pasteBtn.offsetWidth || 120;
    pasteBtn.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, x - w / 2))}px`;
    pasteBtn.style.top = `${Math.max(8, y - 64)}px`;
  }

  function hidePaste() {
    pasteBtn.hidden = true;
    pasteAt = null;
  }

  pasteBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
  pasteBtn.addEventListener('click', () => {
    const at = pasteAt;
    hidePaste();
    paste(at);
  });

  // Einfügen: an Stelle "at" (Dokument-Punkt, Mitte der Einfügung) oder etwas versetzt zum Original
  function paste(at = null) {
    if (!clipboard) return false;
    let index;
    let dx;
    let dy;
    const f = clipboard.frame;
    if (at) {
      index = doc.indexAt(at[1]);
      dx = at[0] - f.cx;
      dy = at[1] - doc.top(index) - f.cy;
    } else {
      index = currentIndex();
      dx = PASTE_OFFSET;
      dy = PASTE_OFFSET;
      // Liegt die Stelle gerade nicht auf dem Bildschirm? Dann in die Mitte des Bildschirms.
      const [sx, sy] = localToScreen([f.cx + dx, f.cy + dy], index);
      if (sx < 0 || sy < 0 || sx > view.width || sy > view.height) {
        const [mx, my] = view.toPage(view.width / 2, view.height / 2);
        dx = mx - f.cx;
        dy = my - doc.top(index) - f.cy;
      }
    }
    // nicht ganz von der Seite rutschen
    dy = Math.max(-f.cy + 10, Math.min(PAGE_HEIGHT - 10 - f.cy, dy));
    const page = doc.pages[index];
    const items = place_(clipboard.items, page, dx, dy);
    commit([{ page, added: items, removed: [] }]);
    renderer.renderNow();
    select(page, items);
    return true;
  }

  // Daneben tippen (außerhalb von Leiste, Farben, Einfügen) schließt die kleinen Menüs
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!pasteBtn.hidden && !pasteBtn.contains(e.target)) hidePaste();
      if (!colors.hidden && !colors.contains(e.target) && !bar.contains(e.target)) closeColors();
    },
    { capture: true }
  );

  return {
    get active() {
      return Boolean(sel);
    },
    get drawing() {
      return Boolean(drawing);
    },
    get hasClipboard() {
      return Boolean(clipboard);
    },
    penDown,
    penMove,
    penUp,
    clear() {
      hidePaste();
      drawing = null;
      clear();
    },
    place,
    paste,
    run,
    // Tastatur am PC: Entf, Strg+C/X/V/D, Esc
    onKey(e) {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && key === 'v' && clipboard) return paste(), true;
      if (!sel) return false;
      if (key === 'delete' || key === 'backspace') run('trash');
      else if (key === 'escape') clear();
      else if (ctrl && key === 'c') run('copy');
      else if (ctrl && key === 'x') run('cut');
      else if (ctrl && key === 'd') run('duplicate');
      else return false;
      return true;
    },
  };
}

function countText(n) {
  return n === 1 ? '1 Element' : `${n} Elemente`;
}
