// view.js – die "Kamera": Verschieben und Zoomen
//
// Es gibt zwei Arten von Koordinaten:
//  - Bildschirm: Pixel auf dem Tablet (ändern sich beim Zoomen)
//  - Dokument:   Punkte auf den Seiten (eine Seite ist immer 1000 breit,
//                die Seiten liegen untereinander, siehe document.js)
// Striche speichern wir in Seiten-Koordinaten. Dann bleiben sie an der
// richtigen Stelle, egal wie weit du hineinzoomst.
//
//   bildschirm = dokument * scale + offset

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414; // Verhältnis wie ein DIN-A4-Blatt

const MARGIN = 24;      // Abstand der Seite zum Rand (Bildschirm-Pixel)
const MIN_SCALE = 0.12; // so weit raus, dass man mehrere Seiten auf einmal sieht
const MAX_SCALE = 6;

export class View {
  constructor() {
    this.scale = 1;   // Zoomfaktor
    this.x = 0;       // Verschiebung nach rechts (Bildschirm-Pixel)
    this.y = 0;       // Verschiebung nach unten
    this.width = 0;   // Größe der Zeichenfläche
    this.height = 0;
    this.fitScale = 1;
    this.contentHeight = PAGE_HEIGHT; // Höhe aller Seiten (wird von main.js gesetzt)
  }

  // Bildschirm -> Dokument
  toPage(sx, sy) {
    return [(sx - this.x) / this.scale, (sy - this.y) / this.scale];
  }

  // Dokument -> Bildschirm
  toScreen(px, py) {
    return [px * this.scale + this.x, py * this.scale + this.y];
  }

  setSize(width, height) {
    const first = this.width === 0;
    const [, centerY] = this.toPage(this.width / 2, this.height / 2);
    this.width = width;
    this.height = height;
    this.fitScale = Math.min(1.5, (width - MARGIN * 2) / PAGE_WIDTH);
    if (first) {
      this.scale = this.fitScale;
      this.y = MARGIN;
      this.x = (width - PAGE_WIDTH * this.scale) / 2;
      this.clamp();
    } else {
      // Beim Drehen des Tablets: dieselbe Stelle bleibt in der Mitte
      this.y = height / 2 - centerY * this.scale;
      this.clamp();
    }
  }

  setContentHeight(h) {
    this.contentHeight = h;
    this.clamp();
  }

  // Seite so groß machen, dass sie genau in die Breite passt.
  // Die Stelle in der Mitte des Bildschirms bleibt dabei in der Mitte.
  fitToWidth() {
    const [, centerY] = this.toPage(this.width / 2, this.height / 2);
    this.scale = this.fitScale;
    this.x = (this.width - PAGE_WIDTH * this.scale) / 2;
    this.y = this.height / 2 - centerY * this.scale;
    this.clamp();
  }

  // Wohin müsste y, damit Dokument-Höhe docY oben am Bildschirm (plus Rand) steht?
  yFor(docY) {
    return MARGIN - docY * this.scale;
  }

  panBy(dx, dy) {
    this.x += dx;
    this.y += dy;
    this.clamp();
  }

  // Zoomen um einen Punkt (sx, sy) auf dem Bildschirm.
  // Der Punkt unter deinen Fingern bleibt dabei an derselben Stelle.
  zoomAt(sx, sy, factor) {
    const newScale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    const [px, py] = this.toPage(sx, sy);
    this.scale = newScale;
    this.x = sx - px * newScale;
    this.y = sy - py * newScale;
    this.clamp();
  }

  // Dafür sorgen, dass die Seiten nicht aus dem Bild verschwinden
  clamp() {
    const w = PAGE_WIDTH * this.scale;
    const h = this.contentHeight * this.scale;
    // Seite schmaler als der Bildschirm -> waagerecht zentrieren
    if (w + MARGIN * 2 <= this.width) this.x = (this.width - w) / 2;
    else this.x = Math.min(MARGIN, Math.max(this.width - w - MARGIN, this.x));
    // Alles niedriger als der Bildschirm -> senkrecht zentrieren
    if (h + MARGIN * 2 <= this.height) this.y = (this.height - h) / 2;
    else this.y = Math.min(MARGIN, Math.max(this.height - h - MARGIN, this.y));
  }
}
