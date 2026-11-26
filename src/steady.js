// steady.js – ruhige Striche, auch wenn du ganz langsam schreibst
//
// Das Problem: Bewegst du den Stift sehr langsam, liegen die gemessenen Punkte nur
// Bruchteile eines Pixels auseinander. Der Stift misst dabei immer ein winziges Zittern mit.
// Bei so kleinen Schritten zeigt dann jeder zweite Schritt "rückwärts".
// Die Zeichen-Bibliothek (perfect-freehand) hält jedes Zurückzucken für eine scharfe Ecke
// und malt dort einen kleinen runden Bogen – die Linie wackelt sichtbar hin und her.
//
// Die Lösung, zwei Schritte:
//   1. Glätten je nach Tempo: Ist der neue Punkt nah am bisherigen, ist das fast nur
//      Zittern -> wir gehen nur ein kleines Stück darauf zu. Ist er weit weg (schnelles
//      Schreiben), folgen wir sofort, ohne Verzögerung. So bleibt schnelle Schrift genau.
//   2. Mindestabstand: Ein neuer Punkt kommt erst dazu, wenn er etwas Abstand zum letzten hat.
//      Winzige Schritte (mit zufälliger Richtung) gibt es damit nicht mehr.

// Unter diesem Abstand (Bildschirm-Pixel) wird geglättet, darüber folgt der Strich sofort
const FOLLOW_PX = 2;
// So stark wird höchstens geglättet (Anteil, um den wir auf den neuen Punkt zugehen)
const MIN_FOLLOW = 0.12;
// Mindestabstand zwischen zwei gespeicherten Punkten (Bildschirm-Pixel)
const MIN_STEP_PX = 1.1;

export class Steadier {
  // Neuer Strich beginnt bei point
  reset(point) {
    this.f = [point[0], point[1]];
    this.kept = [point[0], point[1]];
    this.raw = null;
  }

  // Einen gemessenen Punkt [x, y, druck] verarbeiten. scale = Zoom (Seite -> Bildschirm).
  // Antwort: der Punkt, der in den Strich kommt – oder null (noch zu nah am letzten)
  add(point, scale) {
    const dx = point[0] - this.f[0];
    const dy = point[1] - this.f[1];
    const d = Math.hypot(dx, dy) * scale;
    const a = Math.min(1, Math.max(MIN_FOLLOW, d / FOLLOW_PX));
    this.f[0] += dx * a;
    this.f[1] += dy * a;
    this.raw = point;
    if (Math.hypot(this.f[0] - this.kept[0], this.f[1] - this.kept[1]) * scale < MIN_STEP_PX) return null;
    this.kept = [this.f[0], this.f[1]];
    this.raw = null;
    return [this.f[0], this.f[1], point[2]];
  }

  // Beim Abheben: Der Strich soll genau dort enden, wo der Stift war.
  // Gibt den letzten echten Punkt zurück (oder null, wenn er schon drin ist / zu nah liegt)
  finish(scale) {
    const p = this.raw;
    this.raw = null;
    if (!p) return null;
    if (Math.hypot(p[0] - this.kept[0], p[1] - this.kept[1]) * scale < MIN_STEP_PX) return null;
    this.kept = [p[0], p[1]];
    return p;
  }
}

// Für schon gespeicherte (ältere) Striche: Punkte, die viel zu dicht beieinanderliegen,
// zusammenfassen. So wackeln auch Notizen nicht mehr, die vor diesem Fix geschrieben wurden.
// minStep in Seiten-Einheiten. Erster und letzter Punkt bleiben immer erhalten.
export function thinPoints(points, minStep) {
  const n = points.length;
  if (n < 3) return points;
  const out = [points[0]];
  let sx = 0, sy = 0, sp = 0, count = 0;
  let ref = points[0];
  for (let i = 1; i < n - 1; i++) {
    const p = points[i];
    sx += p[0]; sy += p[1]; sp += p[2]; count++;
    const ax = sx / count, ay = sy / count;
    if (Math.hypot(ax - ref[0], ay - ref[1]) >= minStep) {
      ref = [ax, ay, sp / count];
      out.push(ref);
      sx = sy = sp = count = 0;
    }
  }
  const lastPoint = points[n - 1];
  if (out.length > 1 && Math.hypot(lastPoint[0] - ref[0], lastPoint[1] - ref[1]) < minStep * 0.5) out.pop();
  out.push(lastPoint);
  return out;
}
