// history.js – Rückgängig und Wiederholen
//
// Jede Änderung speichern wir als "Aktion". Eine Aktion kann enthalten:
//   strokes:   [{ page, added: [Striche dazu], removed: [Striche weg] }, ...]  (pro Seite)
//   pages:     { before: [Seiten vorher], after: [Seiten nachher] }        (Seiten hinzugefügt/gelöscht/verschoben)
//   templates: [{ page, before: alteVorlage, after: neueVorlage }, ...]     (Vorlage geändert)
//
// Beispiele:
//   Strich zeichnen      -> strokes: [{ page, added: [neuer Strich], removed: [] }]
//   Bereich radieren     -> strokes: [{ page, added: [Reststücke], removed: [alter Strich] }]
//   Seite löschen        -> pages: { before: [A, B, C], after: [A, C] }
//
// Rückgängig = die Aktion "umgekehrt" ausführen, Wiederholen = noch einmal ausführen
// (das macht main.js in applyAction).
//
// Zwei Stapel (wie ein Stapel Teller – man nimmt immer den obersten):
//   undoStack: was man rückgängig machen kann (oben = das Neueste)
//   redoStack: was man wiederholen kann

const LIMIT = 300; // so viele Schritte merken wir uns höchstens

export class History {
  constructor(onChange) {
    this.undoStack = [];
    this.redoStack = [];
    this.onChange = onChange; // wird aufgerufen, damit die Knöpfe aktualisiert werden
  }

  // Neue Aktion merken. Danach kann man nichts mehr "wiederholen".
  push(action) {
    if (isEmpty(action)) return; // nichts passiert
    this.undoStack.push(action);
    if (this.undoStack.length > LIMIT) this.undoStack.shift(); // ältesten Schritt vergessen
    this.redoStack.length = 0;
    this.onChange();
  }

  // Oberste Aktion vom Rückgängig-Stapel nehmen und auf den Wiederholen-Stapel legen.
  // Gibt die Aktion zurück (oder null, wenn es nichts gibt).
  undo() {
    const action = this.undoStack.pop();
    if (!action) return null;
    this.redoStack.push(action);
    this.onChange();
    return action;
  }

  // Genau andersherum
  redo() {
    const action = this.redoStack.pop();
    if (!action) return null;
    this.undoStack.push(action);
    this.onChange();
    return action;
  }

  get canUndo() {
    return this.undoStack.length > 0;
  }

  get canRedo() {
    return this.redoStack.length > 0;
  }
}

function isEmpty(action) {
  const strokes = (action.strokes || []).some((c) => c.added.length || c.removed.length);
  return !strokes && !action.pages && !(action.templates && action.templates.length);
}
