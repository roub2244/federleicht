// document.js – eine Notiz besteht aus mehreren Seiten
//
// Jede Seite hat ihre eigene Vorlage und ihre eigenen Striche.
// Die Striche speichern wir in den Koordinaten IHRER Seite (0 bis 1000 breit,
// 0 bis 1414 hoch). Dadurch kann man Seiten verschieben, einfügen oder löschen,
// ohne einen einzigen Strich umrechnen zu müssen.
//
// Auf dem Bildschirm liegen die Seiten untereinander, mit etwas Abstand (PAGE_GAP):
//
//   Seite 0:  y = 0      bis 1414
//   (Lücke)
//   Seite 1:  y = 1442   bis 2856   usw.
//
// "Dokument-Koordinaten" = Position auf diesem langen Streifen.

import { PAGE_HEIGHT } from './view.js';
import { uid } from './store.js';

export const PAGE_GAP = 28;     // Abstand zwischen zwei Seiten (Seiten-Einheiten)
export const END_SPACE = 170;   // Platz unter der letzten Seite für den "+ Seite"-Knopf

// Jede Seite bekommt eine eindeutige Nummer – darunter liegt sie im Speicher (store.js)
export function createPage(template) {
  return { id: uid(), template: { ...template }, strokes: [] };
}

export class NoteDocument {
  constructor(template) {
    this.pages = [createPage(template)];
  }

  // Eine andere Notiz öffnen: alle Seiten austauschen
  load(pages) {
    this.pages = pages.length ? pages : [createPage(this.pages[0]?.template)];
  }

  get count() {
    return this.pages.length;
  }

  // Oberkante von Seite i (Dokument-Koordinaten)
  top(i) {
    return i * (PAGE_HEIGHT + PAGE_GAP);
  }

  // Höhe aller Seiten zusammen
  get height() {
    return this.pages.length * (PAGE_HEIGHT + PAGE_GAP) - PAGE_GAP;
  }

  // Welche Seite liegt an Höhe y? (In der Lücke: die nähere der beiden)
  indexAt(y) {
    const i = Math.floor((y + PAGE_GAP / 2) / (PAGE_HEIGHT + PAGE_GAP));
    return Math.min(this.pages.length - 1, Math.max(0, i));
  }

  // Erste und letzte Seite, die zwischen y0 und y1 (teilweise) zu sehen sind
  range(y0, y1) {
    const step = PAGE_HEIGHT + PAGE_GAP;
    const first = Math.max(0, Math.floor(y0 / step));
    const last = Math.min(this.pages.length - 1, Math.floor(y1 / step));
    return [first, last];
  }
}
