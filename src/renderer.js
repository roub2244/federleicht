// renderer.js – alles, was auf das Canvas gemalt wird
//
// Trick für wenig Verzögerung:
//  1. Alle fertigen Striche malen wir in ein unsichtbares "Zwischenbild" (cache).
//  2. Während du schreibst, kopieren wir nur das kleine Stück vom Zwischenbild,
//     wo sich etwas ändert, und malen den aktuellen Strich darüber.
//  So muss pro Stiftbewegung nicht die ganze Seite neu gemalt werden.
//
// Es gibt mehrere Seiten untereinander (siehe document.js). Gemalt werden immer
// nur die Seiten, die gerade auf dem Bildschirm zu sehen sind.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { fillStroke, setInkTheme, finishStroke } from './ink.js';
import { partialStroke } from './audio.js';
import { drawTemplate, paperColor } from './templates.js';
import { drawBackground, pageDark } from './media.js';

export class Renderer {
  constructor(canvas, view, doc) {
    this.canvas = canvas;
    this.view = view;
    this.doc = doc;
    this.darkPaper = false; // dunkles Blatt? (wird von main.js gesetzt)

    // desynchronized: true = "Low-Latency-Modus". Der Browser darf das Bild
    // sofort anzeigen, ohne auf den nächsten Bildschirm-Takt zu warten.
    // alpha: false = das Canvas ist undurchsichtig, das macht es schneller.
    this.ctx = canvas.getContext('2d', { desynchronized: true, alpha: false });
    this.lowLatency = Boolean(this.ctx.getContextAttributes?.().desynchronized);

    this.cache = document.createElement('canvas');
    this.cacheCtx = this.cache.getContext('2d', { alpha: false });

    // Noch ein Zwischenbild nur mit Hintergrund + leeren Blättern mit Linien ("Papier").
    // Daraus können wir beim Radieren schnell kleine Stücke wiederherstellen.
    this.paper = document.createElement('canvas');
    this.paperCtx = this.paper.getContext('2d', { alpha: false });

    this.dpr = 1;          // devicePixelRatio: echte Pixel pro CSS-Pixel
    this.overlay = null;   // was gerade "über" der Seite liegt (aktueller Strich, Radierer-Kreis)
    this.lastBox = null;   // wo das Overlay zuletzt war
    this.frame = 0;
    this.onRender = null;  // wird nach jedem kompletten Neumalen aufgerufen
    this.strokeView = null; // beim Abspielen einer Aufnahme: wie wird ein Strich gemalt? (siehe audio.js)
    this.onBackgrounds = null; // bekommt die sichtbaren PDF-Seiten (zum scharf Nachmalen, siehe pdfdoc.js)
    this.readColors();
  }

  // Farben aus dem CSS lesen (damit Hell-/Dunkelmodus passt)
  readColors() {
    const css = getComputedStyle(document.documentElement);
    this.colors = {
      bg: css.getPropertyValue('--bg').trim() || '#eef1f6',
      shadow: css.getPropertyValue('--page-shadow').trim() || 'rgba(0,0,0,.15)',
    };
  }

  // Größe anpassen. Das Canvas bekommt so viele Pixel, wie das Display
  // wirklich hat – sonst sieht die Schrift unscharf aus.
  resize(width, height) {
    this.dpr = window.devicePixelRatio || 1;
    for (const c of [this.canvas, this.cache, this.paper]) {
      c.width = Math.round(width * this.dpr);
      c.height = Math.round(height * this.dpr);
    }
    this.renderNow();
  }

  // Die Kamera (Zoom + Verschiebung) auf einen Zeichen-Kontext anwenden.
  // Danach können wir direkt in Dokument-Koordinaten malen.
  applyView(ctx) {
    const s = this.view.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.view.x * this.dpr, this.view.y * this.dpr);
  }

  // Wie applyView, aber (0, 0) ist die linke obere Ecke von Seite i.
  // Außerdem wird alles außerhalb der Seite abgeschnitten und die Tinte auf das Papier eingestellt.
  enterPage(ctx, i) {
    this.applyView(ctx);
    ctx.translate(0, this.doc.top(i));
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.clip();
    this.useInkOf(i);
  }

  useInkOf(i) {
    const page = this.doc.pages[i];
    const dark = pageDark(page, this.darkPaper); // PDF-Seiten bleiben (meist) hell
    setInkTheme(dark, paperColor(page?.template.paper, dark));
  }

  // Welche Seiten sind (teilweise) zu sehen? Optional nur in einem Bereich (Dokument-Koordinaten)
  visibleArea(area) {
    let [x0, y0] = this.view.toPage(0, 0);
    let [x1, y1] = this.view.toPage(this.view.width, this.view.height);
    if (area) {
      x0 = Math.max(x0, area.minX);
      y0 = Math.max(y0, area.minY);
      x1 = Math.min(x1, area.maxX);
      y1 = Math.min(y1, area.maxY);
    }
    return { x0, y0, x1, y1 };
  }

  // Neu malen beim nächsten Bild (für Zoomen/Verschieben: höchstens 1x pro Bild)
  requestRender() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.renderNow();
    });
  }

  renderNow() {
    if (this.frame) {
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    }
    this.renderScene();
    this.copyFromCache(null);
    this.drawOverlay();
    this.onRender?.();
  }

  // Das Papier malen: Hintergrund, Blätter mit weichem Schatten, Linien der Vorlage.
  // (Der Schatten ist aufwendig, darum nur nach Zoomen/Verschieben.)
  renderPaper() {
    const c = this.paperCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.colors.bg;
    c.fillRect(0, 0, this.paper.width, this.paper.height);

    const vis = this.visibleArea(null);
    const [first, last] = this.doc.range(vis.y0, vis.y1);
    const px = this.view.scale * this.dpr; // echte Pixel pro Seiten-Einheit
    const backgrounds = [];
    for (let i = first; i <= last; i++) {
      const page = this.doc.pages[i];
      const top = this.doc.top(i);
      const dark = pageDark(page, this.darkPaper);
      this.applyView(c);
      c.translate(0, top);
      c.save();
      c.shadowColor = this.colors.shadow;
      c.shadowBlur = 20 * this.dpr;
      c.shadowOffsetY = 4 * this.dpr;
      c.fillStyle = paperColor(page.template.paper, dark);
      c.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      c.restore();
      if (dark) {
        // Auf dunklem Hintergrund sieht man den Schatten kaum: feiner heller Rand
        c.strokeStyle = 'rgba(255, 255, 255, 0.07)';
        c.lineWidth = 1 / px;
        c.strokeRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      }
      c.save();
      c.beginPath();
      c.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
      c.clip();
      const local = { x0: vis.x0, y0: vis.y0 - top, x1: vis.x1, y1: vis.y1 - top };
      if (page.bg) {
        drawBackground(c, page, dark, px); // PDF-Seite (Etappe 7)
        backgrounds.push({ page, k: px, vis: local });
      }
      drawTemplate(c, page.template, local, px, dark);
      c.restore();
    }
    this.onBackgrounds?.(backgrounds);
  }

  // Das Zwischenbild komplett neu malen: Papier + alle sichtbaren Striche
  renderScene() {
    this.renderPaper();
    const c = this.cacheCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.paper, 0, 0);
    this.drawStrokes(c, null);
  }

  // Striche ins Zwischenbild malen – alle sichtbaren, oder nur die in einem Bereich (Dokument-Koordinaten)
  drawStrokes(c, area) {
    const vis = this.visibleArea(area);
    if (vis.x0 > vis.x1 || vis.y0 > vis.y1) return;
    const [first, last] = this.doc.range(vis.y0, vis.y1);
    for (let i = first; i <= last; i++) {
      const top = this.doc.top(i);
      const y0 = vis.y0 - top;
      const y1 = vis.y1 - top;
      c.save();
      this.enterPage(c, i);
      for (const s of this.doc.pages[i].strokes) {
        const b = s.box;
        if (!b || s.hidden || b.maxX < vis.x0 || b.minX > vis.x1 || b.maxY < y0 || b.minY > y1) continue;
        const sv = this.strokeView?.(s);
        if (sv) drawViewed(c, s, sv);
        else fillStroke(c, s);
      }
      // Zusätzliches auf der Seite (Hausaufgaben-Fähnchen, siehe homework.js)
      this.decorate?.(c, i, this.view.scale * this.dpr);
      c.restore();
    }
  }

  // Nur einen Bereich neu malen (z. B. dort, wo der Radierer gerade einen Strich gelöscht hat).
  // area in Dokument-Koordinaten. Viel schneller als alles neu zu malen.
  redrawArea(area) {
    const [x0, y0] = this.view.toScreen(area.minX, area.minY);
    const [x1, y1] = this.view.toScreen(area.maxX, area.maxY);
    const box = this.toDeviceBox({ minX: x0, minY: y0, maxX: x1, maxY: y1 });
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w <= 0 || h <= 0) return;

    const c = this.cacheCtx;
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.beginPath();
    c.rect(box.minX, box.minY, w, h);
    c.clip();
    c.drawImage(this.paper, box.minX, box.minY, w, h, box.minX, box.minY, w, h);
    this.drawStrokes(c, area);
    c.restore();

    // Aufs sichtbare Canvas: Bereich + Overlay (Radierer-Kreis) neu
    this.copyFromCache(unionBox(box, this.lastBox));
    this.drawOverlay();
  }

  // Einen fertigen Strich von Seite i ins Zwischenbild übernehmen (ohne alles neu zu malen).
  // tail (Bildschirm-Rechteck, optional): nur dort unterscheidet sich der fertige Strich von dem,
  // was beim Schreiben schon zu sehen war (Spitze am Ende). Dann wird nur das neu kopiert.
  commitStroke(stroke, i, tail = null) {
    const c = this.cacheCtx;
    c.save();
    this.enterPage(c, i);
    fillStroke(c, stroke);
    c.restore();
    this.setOverlay(null, tail);
  }

  // Overlay setzen und SOFORT malen (wird direkt im Stift-Event aufgerufen).
  // overlay = { box: {minX, minY, maxX, maxY} in Bildschirm-Pixeln, draw(ctx) }
  //
  // Wichtig im Low-Latency-Modus: Das Bild geht OHNE Warten direkt auf den Bildschirm.
  // Früher haben wir erst die Stelle gelöscht (Zwischenbild drüber) und dann den Strich neu
  // gemalt – zeigte das Display genau dazwischen ein Bild, war der Strich kurz weg oder halb
  // gemalt: Die Schrift flackerte und "zuckte" beim Schreiben.
  // Jetzt bauen wir das Stück fertig in einem unsichtbaren Hilfsbild zusammen und kopieren es
  // in EINEM Schritt auf den Bildschirm. Es gibt nur noch "vorher" oder "nachher".
  //
  // tail (Bildschirm-Rechteck, optional) = beim Schreiben: Nur hier hat sich seit dem letzten Mal
  // etwas geändert (das Ende des Strichs, siehe ink.js tailBox). Dann kopieren und malen wir nur
  // dieses kleine Stück statt des ganzen Strichs. Früher wurde bei jeder Stiftbewegung das ganze
  // Rechteck um den Strich neu gemalt – bei großen Strichen fast der ganze Bildschirm, viele Male
  // pro Sekunde. Das Tablet kam nicht mehr hinterher, und die Linie lief dem Stift nach.
  setOverlay(overlay, tail = null) {
    const newBox = overlay ? this.toDeviceBox(overlay.box) : null;
    const tailBox = tail ? this.toDeviceBox(tail) : null;
    // Nur-das-Ende geht nur, wenn vorher schon derselbe Strich zu sehen war
    const dirty = tailBox && this.liveTail ? unionBox(this.liveTail, tailBox) : unionBox(this.lastBox, newBox);
    this.liveTail = overlay && tailBox ? tailBox : null;
    this.overlay = overlay;
    if (!dirty) return this.drawOverlay();
    const w = dirty.maxX - dirty.minX;
    const h = dirty.maxY - dirty.minY;
    if (w <= 0 || h <= 0) {
      this.lastBox = newBox;
      return;
    }
    const s = this.scratchFor(w, h);
    s.ctx.setTransform(1, 0, 0, 1, 0, 0);
    s.ctx.drawImage(this.cache, dirty.minX, dirty.minY, w, h, 0, 0, w, h);
    if (overlay) {
      s.ctx.save();
      // Nur im benutzten Stück malen (das Hilfsbild kann größer sein)
      s.ctx.beginPath();
      s.ctx.rect(0, 0, w, h);
      s.ctx.clip();
      // Wie auf dem echten Canvas malen, nur um die Ecke des Stücks verschoben
      overlay.draw(shifted(s.ctx, dirty.minX, dirty.minY), this);
      s.ctx.restore();
    }
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(s.canvas, 0, 0, w, h, dirty.minX, dirty.minY, w, h);
    this.lastBox = newBox;
  }

  // Hilfsbild (wächst bei Bedarf, wird nie kleiner)
  scratchFor(w, h) {
    if (!this.scratch) {
      const canvas = document.createElement('canvas');
      this.scratch = { canvas, ctx: canvas.getContext('2d', { alpha: false }) };
    }
    const c = this.scratch.canvas;
    if (c.width < w || c.height < h) {
      c.width = Math.max(c.width, w);
      c.height = Math.max(c.height, h);
    }
    return this.scratch;
  }

  drawOverlay() {
    if (!this.overlay) {
      this.lastBox = null;
      this.liveTail = null;
      return;
    }
    this.ctx.save();
    this.overlay.draw(this.ctx, this);
    this.ctx.restore();
    this.lastBox = this.toDeviceBox(this.overlay.box);
  }

  // Zwischenbild aufs sichtbare Canvas kopieren – ganz oder nur ein Stück
  copyFromCache(box) {
    const ctx = this.ctx;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (!box) {
      ctx.drawImage(this.cache, 0, 0);
      return;
    }
    const w = box.maxX - box.minX;
    const h = box.maxY - box.minY;
    if (w > 0 && h > 0) ctx.drawImage(this.cache, box.minX, box.minY, w, h, box.minX, box.minY, w, h);
  }

  // Bildschirm-Rechteck -> echte Pixel, etwas größer und auf ganze Zahlen gerundet
  toDeviceBox(box) {
    if (!box) return null;
    const pad = 3;
    const d = this.dpr;
    return {
      minX: Math.max(0, Math.floor((box.minX - pad) * d)),
      minY: Math.max(0, Math.floor((box.minY - pad) * d)),
      maxX: Math.min(this.canvas.width, Math.ceil((box.maxX + pad) * d)),
      maxY: Math.min(this.canvas.height, Math.ceil((box.maxY + pad) * d)),
    };
  }
}

// Zeichen-Kontext, der alles um (ox, oy) echte Pixel nach links/oben verschiebt.
// So kann der Overlay-Code ganz normal "auf den Bildschirm" malen, landet aber im Hilfsbild.
function shifted(ctx, ox, oy) {
  const bound = new Map();
  return new Proxy(ctx, {
    get(target, prop) {
      if (prop === 'setTransform') {
        return (a, b, c, d, e, f) => {
          if (typeof a === 'object') target.setTransform(a.a, a.b, a.c, a.d, a.e - ox, a.f - oy);
          else target.setTransform(a, b, c, d, e - ox, f - oy);
        };
      }
      if (prop === 'resetTransform') return () => target.setTransform(1, 0, 0, 1, -ox, -oy);
      const v = target[prop];
      if (typeof v !== 'function') return v;
      let fn = bound.get(prop);
      if (!fn) bound.set(prop, (fn = v.bind(target)));
      return fn;
    },
    set(target, prop, value) {
      target[prop] = value;
      return true;
    },
  });
}

// Strich beim Abspielen einer Aufnahme: ausgeblendet, blass oder erst teilweise geschrieben
function drawViewed(c, s, sv) {
  if (sv.hide) return;
  const strokeLike = s.tool !== 'text' && s.tool !== 'image' && s.tool !== 'fill' && s.points?.length;
  if (!strokeLike) {
    if (sv.alpha) {
      c.save();
      c.globalAlpha = sv.alpha;
      fillStroke(c, s);
      c.restore();
    } else if (!sv.partial) fillStroke(c, s);
    return;
  }
  if (!s.layers) finishStroke(s);
  if (!s.layers) return;
  if (sv.alpha) fillStroke(c, s, { layers: s.layers.map((l) => ({ path: l.path, alpha: l.alpha * sv.alpha })) });
  if (sv.partial !== undefined && sv.partial > 0) fillStroke(c, partialStroke(s, sv.partial));
}

function unionBox(a, b) {
  if (!a) return b;
  if (!b) return a;
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}
