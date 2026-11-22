// view.js – die "Kamera": Verschieben und Zoomen
//
// Es gibt zwei Arten von Koordinaten:
//  - Bildschirm: Pixel auf dem Tablet (ändern sich beim Zoomen)
//  - Seite:      Punkte auf dem Blatt (die Seite ist immer 1000 breit)
// Striche speichern wir in Seiten-Koordinaten. Dann bleiben sie an der
// richtigen Stelle, egal wie weit du hineinzoomst.
//
//   bildschirm = seite * scale + offset

export const PAGE_WIDTH = 1000;
export const PAGE_HEIGHT = 1414; // Verhältnis wie ein DIN-A4-Blatt

const MARGIN = 24;      // Abstand der Seite zum Rand (Bildschirm-Pixel)
const MIN_SCALE = 0.25;
const MAX_SCALE = 6;

export class View {
  constructor() {
    this.scale = 1;   // Zoomfaktor
    this.x = 0;       // Verschiebung nach rechts (Bildschirm-Pixel)
    this.y = 0;       // Verschiebung nach unten
    this.width = 0;   // Größe der Zeichenfläche
    this.height = 0;
    this.fitScale = 1;
  }

  // Bildschirm -> Seite
  toPage(sx, sy) {
    return [(sx - this.x) / this.scale, (sy - this.y) / this.scale];
  }

  // Seite -> Bildschirm
  toScreen(px, py) {
    return [px * this.scale + this.x, py * this.scale + this.y];
  }

  setSize(width, height) {
    const first = this.width === 0;
    this.width = width;
    this.height = height;
    this.fitScale = Math.min(1.5, (width - MARGIN * 2) / PAGE_WIDTH);
    if (first) this.fitToWidth();
    else this.clamp();
  }

  // Seite so groß machen, dass sie genau in die Breite passt
  fitToWidth() {
    this.scale = this.fitScale;
    this.x = (this.width - PAGE_WIDTH * this.scale) / 2;
    this.y = MARGIN;
    this.clamp();
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

  // Dafür sorgen, dass die Seite nicht aus dem Bild verschwindet
  clamp() {
    const w = PAGE_WIDTH * this.scale;
    const h = PAGE_HEIGHT * this.scale;
    // Seite schmaler als der Bildschirm -> waagerecht zentrieren
    if (w + MARGIN * 2 <= this.width) this.x = (this.width - w) / 2;
    else this.x = Math.min(MARGIN, Math.max(this.width - w - MARGIN, this.x));
    // Seite niedriger als der Bildschirm -> senkrecht zentrieren
    if (h + MARGIN * 2 <= this.height) this.y = (this.height - h) / 2;
    else this.y = Math.min(MARGIN, Math.max(this.height - h - MARGIN, this.y));
  }
}
