// renderer.js – alles, was auf das Canvas gemalt wird
//
// Trick für wenig Verzögerung:
//  1. Alle fertigen Striche malen wir in ein unsichtbares "Zwischenbild" (cache).
//  2. Während du schreibst, kopieren wir nur das kleine Stück vom Zwischenbild,
//     wo sich etwas ändert, und malen den aktuellen Strich darüber.
//  So muss pro Stiftbewegung nicht die ganze Seite neu gemalt werden.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';

export class Renderer {
  constructor(canvas, view, strokes) {
    this.canvas = canvas;
    this.view = view;
    this.strokes = strokes;

    // desynchronized: true = "Low-Latency-Modus". Der Browser darf das Bild
    // sofort anzeigen, ohne auf den nächsten Bildschirm-Takt zu warten.
    // alpha: false = das Canvas ist undurchsichtig, das macht es schneller.
    this.ctx = canvas.getContext('2d', { desynchronized: true, alpha: false });
    this.lowLatency = Boolean(this.ctx.getContextAttributes?.().desynchronized);

    this.cache = document.createElement('canvas');
    this.cacheCtx = this.cache.getContext('2d', { alpha: false });

    // Noch ein Zwischenbild nur mit Hintergrund + leerem Blatt ("Papier").
    // Daraus können wir beim Radieren schnell kleine Stücke wiederherstellen.
    this.paper = document.createElement('canvas');
    this.paperCtx = this.paper.getContext('2d', { alpha: false });

    this.dpr = 1;          // devicePixelRatio: echte Pixel pro CSS-Pixel
    this.overlay = null;   // was gerade "über" der Seite liegt (aktueller Strich, Radierer-Kreis)
    this.lastBox = null;   // wo das Overlay zuletzt war
    this.frame = 0;
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
  // Danach können wir direkt in Seiten-Koordinaten malen.
  applyView(ctx) {
    const s = this.view.scale * this.dpr;
    ctx.setTransform(s, 0, 0, s, this.view.x * this.dpr, this.view.y * this.dpr);
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
    this.renderScene();
    this.copyFromCache(null);
    this.drawOverlay();
  }

  // Das Papier malen: Hintergrund und weißes Blatt mit weichem Schatten.
  // (Der Schatten ist aufwendig, darum nur nach Zoomen/Verschieben.)
  renderPaper() {
    const c = this.paperCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.colors.bg;
    c.fillRect(0, 0, this.paper.width, this.paper.height);
    this.applyView(c);
    c.save();
    c.shadowColor = this.colors.shadow;
    c.shadowBlur = 20 * this.dpr;
    c.shadowOffsetY = 4 * this.dpr;
    c.fillStyle = '#ffffff';
    c.fillRect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    c.restore();
  }

  // Das Zwischenbild komplett neu malen: Papier + alle sichtbaren Striche
  renderScene() {
    this.renderPaper();
    const c = this.cacheCtx;
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(this.paper, 0, 0);
    this.drawStrokes(c, null);
  }

  // Striche ins Zwischenbild malen – alle sichtbaren, oder nur die in einem Bereich (Seiten-Koordinaten)
  drawStrokes(c, area) {
    let [vx0, vy0] = this.view.toPage(0, 0);
    let [vx1, vy1] = this.view.toPage(this.view.width, this.view.height);
    if (area) {
      vx0 = Math.max(vx0, area.minX);
      vy0 = Math.max(vy0, area.minY);
      vx1 = Math.min(vx1, area.maxX);
      vy1 = Math.min(vy1, area.maxY);
    }
    c.save();
    this.applyView(c);
    this.clipToPage(c);
    for (const s of this.strokes) {
      const b = s.box;
      if (!b || b.maxX < vx0 || b.minX > vx1 || b.maxY < vy0 || b.minY > vy1) continue;
      c.fillStyle = s.color;
      c.fill(s.path);
    }
    c.restore();
  }

  // Nur einen Bereich neu malen (z. B. dort, wo der Radierer gerade einen Strich gelöscht hat).
  // Viel schneller als alles neu zu malen – darum folgt der Radierer flüssig dem Stift.
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

  clipToPage(ctx) {
    ctx.beginPath();
    ctx.rect(0, 0, PAGE_WIDTH, PAGE_HEIGHT);
    ctx.clip();
  }

  // Einen fertigen Strich ins Zwischenbild übernehmen (ohne alles neu zu malen)
  commitStroke(stroke) {
    const c = this.cacheCtx;
    c.save();
    this.applyView(c);
    this.clipToPage(c);
    c.fillStyle = stroke.color;
    c.fill(stroke.path);
    c.restore();
    this.setOverlay(null);
  }

  // Overlay setzen und SOFORT malen (wird direkt im Stift-Event aufgerufen).
  // overlay = { box: {minX, minY, maxX, maxY} in Bildschirm-Pixeln, draw(ctx) }
  setOverlay(overlay) {
    const newBox = overlay ? this.toDeviceBox(overlay.box) : null;
    const dirty = unionBox(this.lastBox, newBox);
    this.overlay = overlay;
    if (dirty) this.copyFromCache(dirty);
    this.drawOverlay();
  }

  drawOverlay() {
    if (!this.overlay) {
      this.lastBox = null;
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
