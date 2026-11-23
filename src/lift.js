// lift.js – merkt, wann der Stift "eigentlich" schon abgehoben ist
//
// Das Problem: Wenn du den Stift absetzt (z. B. nach dem Strich vom "i" zum Punkt),
// liegt die Spitze oft noch ganz leicht auf dem Display. Das Tablet meldet dann weiter
// "berührt" – nur mit winzigem Druck. Ohne Gegenmaßnahme wird daraus eine Linie.
//
// Die Lösung: Wir merken uns, wie fest du normalerweise schreibst. Fällt der Druck
// deutlich darunter (unter die "Abhebe-Schwelle"), sind diese Punkte erst mal verdächtig:
//   - Wird der Druck gleich wieder fester: war nur ein leichter Moment -> Punkte bleiben.
//   - Rutscht der Stift mit dem leichten Druck weiter als LIFT_DISTANCE Pixel:
//     du hast in Wahrheit abgesetzt -> der Strich endet dort, wo der Druck weg war.
//     Drückst du danach wieder richtig auf, beginnt ein NEUER Strich (der i-Punkt).
//   - Beim Abheben werden die leichten Punkte am Ende weggelassen (kein "Haken").
//   - Genauso am Anfang: leichtes Anschleifen vor dem eigentlichen Strich fällt weg.

// So weit (Bildschirm-Pixel) darf der Stift mit ganz leichtem Druck rutschen,
// bevor wir sagen: "Der ist abgesetzt."
const LIFT_DISTANCE = 6;
// Abhebe-Schwelle = so viel vom typischen Schreibdruck ...
const LIFT_RATIO = 0.25;
// ... aber nie weniger / mehr als das (Druck geht von 0 bis 1)
const LIFT_MIN = 0.015;
const LIFT_MAX = 0.05;
// Wieder aufsetzen (nach einem erkannten Abheben) braucht etwas mehr Druck – sonst flackert es
const RETOUCH_FACTOR = 1.5;
// Leichtes Anschleifen am Anfang: so viel (Pixel) davon bleibt vor dem ersten festen Punkt stehen
const START_KEEP = 2;

const STORAGE_KEY = 'federleicht.typicalPressure';

// Wie fest schreibst du normalerweise? Lernt mit jedem Strich ein bisschen dazu.
let typical = 0.3;
try {
  const saved = parseFloat(localStorage.getItem(STORAGE_KEY));
  if (saved > 0.05 && saved < 1) typical = saved;
} catch {
  /* ohne Speicher eben mit dem Standardwert */
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export class LiftTracker {
  constructor() {
    this.reset();
  }

  // Für jeden neuen Strich
  reset() {
    this.firmCount = 0;  // wie viele Punkte mit "richtigem" Druck
    this.firmSum = 0;
    this.lowStart = -1;  // ab welchem Punkt der Druck gerade zu leicht ist (-1 = gerade nicht)
    this.lowLength = 0;  // wie weit (Pixel) der Stift seitdem gerutscht ist
    this.prev = null;
  }

  // Aktuelle Abhebe-Schwelle. Nach ein paar Punkten zählt auch der Druck DIESES Strichs:
  // Schreibst du gerade leichter als sonst, wird die Schwelle kleiner (nie größer) –
  // so werden leichte Striche nicht aus Versehen zerschnitten.
  threshold() {
    const base = this.firmCount >= 6 ? Math.min(this.firmSum / this.firmCount, typical) : typical;
    return clamp(base * LIFT_RATIO, LIFT_MIN, LIFT_MAX);
  }

  // Druck reicht, um nach einem Abheben wieder einen Strich anzufangen?
  isRetouch(pressure) {
    return pressure >= this.threshold() * RETOUCH_FACTOR;
  }

  // Einen neuen Punkt (Index i im Strich) prüfen. scale = Zoom (Seite -> Bildschirm)
  // Antwort:
  //   null                     alles normal
  //   { cut: n }               Stift ist abgesetzt: Strich nach n Punkten beenden
  //   { trimStart: n }         die ersten n Punkte waren nur Anschleifen: weglassen
  add(point, i, scale) {
    const step = this.prev ? Math.hypot(point[0] - this.prev[0], point[1] - this.prev[1]) * scale : 0;
    this.prev = point;
    const pressure = point[2];

    if (pressure >= this.threshold()) {
      let result = null;
      // Vor dem ersten festen Punkt nur leicht angeschliffen und dabei weit gerutscht?
      if (this.firmCount === 0 && this.lowStart === 0 && this.lowLength > LIFT_DISTANCE) {
        result = { trimStart: this.keepFrom };
      }
      this.firmCount++;
      this.firmSum += pressure;
      this.lowStart = -1;
      this.lowLength = 0;
      return result;
    }

    // Zu leicht
    if (this.lowStart < 0) {
      this.lowStart = i;
      this.lowLength = 0;
      this.keepFrom = i;
      this.tail = [];
    } else {
      this.lowLength += step;
    }
    // Für das Anschleifen am Anfang: nur die letzten START_KEEP Pixel behalten
    if (this.firmCount === 0) {
      this.tail.push({ i, step });
      let len = 0;
      for (let k = this.tail.length - 1; k > 0; k--) {
        len += this.tail[k].step;
        if (len > START_KEEP) {
          this.keepFrom = this.tail[k].i;
          break;
        }
      }
    }
    if (this.firmCount > 0 && this.lowLength > LIFT_DISTANCE) return { cut: this.lowStart };
    return null;
  }

  // Beim Abheben: Wie viele Punkte bleiben? (die leichten Punkte am Ende fallen weg)
  keepAtEnd(length) {
    if (this.firmCount > 0 && this.lowStart > 0) return this.lowStart;
    return length;
  }

  // Strich fertig: typischen Schreibdruck nachführen
  learn() {
    if (this.firmCount < 8) return;
    const avg = this.firmSum / this.firmCount;
    typical = clamp(typical * 0.85 + avg * 0.15, 0.08, 0.9);
    try {
      localStorage.setItem(STORAGE_KEY, typical.toFixed(3));
    } catch {
      /* egal */
    }
  }
}
