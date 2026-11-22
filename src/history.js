// history.js – Rückgängig und Wiederholen
//
// Jede Änderung an der Seite speichern wir als "Aktion":
//   { added: [Striche, die dazugekommen sind], removed: [Striche, die weg sind] }
//
// Beispiele:
//   Strich zeichnen      -> { added: [neuer Strich], removed: [] }
//   Strich radieren      -> { added: [],             removed: [alter Strich] }
//   Bereich radieren     -> { added: [Reststücke],   removed: [alter Strich] }
//   Seite leeren         -> { added: [],             removed: [alle Striche] }
//
// Rückgängig = die Aktion "umgekehrt" ausführen: added entfernen, removed wieder einfügen.
// Wiederholen = die Aktion noch einmal ausführen: removed entfernen, added einfügen.
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
    if (action.added.length === 0 && action.removed.length === 0) return; // nichts passiert
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
