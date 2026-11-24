// straighten.js – gerade Linien durch "Stift kurz stehen lassen"
//
// So funktioniert es:
//  1. Du ziehst einen Strich und hältst den Stift am Ende still (Spitze bleibt unten).
//  2. Nach HOLD_MS Millisekunden ohne echte Bewegung wird aus dem Strich
//     eine gerade Strecke vom Anfangspunkt bis zur aktuellen Stiftposition.
//  3. Solange du die Spitze unten lässt, kannst du das Ende noch verschieben.
//     Beim Abheben ist die Linie fertig.

export const HOLD_MS = 650;        // so lange stillhalten (Millisekunden)
const HOLD_TOLERANCE = 6;          // so viele Bildschirm-Pixel darf die Hand dabei zittern
const MIN_LENGTH = 40;             // kürzere Striche (i-Punkte, l, t, 1 beim Schreiben) werden nicht begradigt

// Punkte auf einer geraden Strecke von a nach b erzeugen.
// perfect-freehand braucht mehrere Punkte, sonst wird die Linie ungleichmäßig.
export function linePoints(a, b, pressure) {
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const count = Math.max(2, Math.ceil(length / 4)); // etwa alle 4 Einheiten ein Punkt
  const points = [];
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1); // läuft von 0 bis 1
    points.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, pressure]);
  }
  return points;
}

// Durchschnittlicher Druck eines Strichs (damit die gerade Linie ähnlich dick wird)
export function averagePressure(points) {
  let sum = 0;
  for (const p of points) sum += p[2];
  return points.length ? sum / points.length : 0.5;
}

// Erkennt, ob der Stift stillsteht.
// Wichtig: Steht der Stift wirklich still, schickt der Browser KEINE Events mehr.
// Deshalb brauchen wir einen Timer (setTimeout), der nach HOLD_MS "klingelt".
export class HoldDetector {
  constructor(onHold) {
    this.onHold = onHold; // wird aufgerufen, wenn lange genug stillgehalten wurde
    this.anchor = null;   // Stelle, an der die Ruhephase angefangen hat
    this.timer = 0;
  }

  // Bei jeder Stiftbewegung aufrufen. point = [x, y] in Seiten-Einheiten
  moved(point, scale) {
    if (this.anchor) {
      const distance = Math.hypot(point[0] - this.anchor[0], point[1] - this.anchor[1]) * scale;
      if (distance < HOLD_TOLERANCE) return; // nur Zittern, Timer läuft weiter
    }
    // Echte Bewegung: neue Ruhestelle merken und Timer neu starten
    this.anchor = point;
    clearTimeout(this.timer);
    this.timer = setTimeout(this.onHold, HOLD_MS);
  }

  stop() {
    clearTimeout(this.timer);
    this.anchor = null;
  }
}

// Ist der Strich lang genug zum Begradigen? (in Bildschirm-Pixeln gemessen)
export function longEnough(a, b, scale) {
  return Math.hypot(b[0] - a[0], b[1] - a[1]) * scale >= MIN_LENGTH;
}
