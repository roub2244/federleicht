// splitpane.js – die App als eine Hälfte im Splitscreen (siehe split.js)
//
// ?pane=L oder ?pane=R in der Adresse: Diese App läuft links/rechts im Splitscreen.
// Dann hat sie ihre eigene Sitzung (federleicht.session.L / .R) und spricht mit dem Rahmen.

export const PANE = (() => {
  const p = new URLSearchParams(location.search).get('pane');
  return p === 'L' || p === 'R' ? p : null;
})();

// Name der gespeicherten Sitzung (ohne "federleicht.")
export const SESSION_KEY = PANE ? `session.${PANE}` : 'session';

// Auf welcher Seite liegt die andere Notiz? (für "mit dem Lasso rüberziehen")
export const otherSide = () => (PANE === 'L' ? 'right' : PANE === 'R' ? 'left' : null);

let otherId = null;
// Welche Notiz ist im anderen Fenster offen? (null = Startbildschirm)
export const otherNote = () => otherId;

export function send(msg) {
  if (PANE && window.parent !== window) window.parent.postMessage({ fl: 'split', ...msg }, location.origin);
}

// Im Fenster: auf den Rahmen hören
//   flush({ leave }) -> alles speichern (leave: Notiz auch schließen)
//   receive({ items, frame, x, y }) -> Rübergezogenes einfügen
export function setupPane({ flush, receive }) {
  if (!PANE) return;
  document.documentElement.classList.add('in-pane', `pane-${PANE}`);
  window.addEventListener('message', async (e) => {
    if (e.origin !== location.origin || e.source !== window.parent) return;
    const d = e.data;
    if (!d || d.fl !== 'split') return;
    if (d.act === 'other') otherId = d.id || null;
    else if (d.act === 'flush') {
      try {
        await flush({ leave: Boolean(d.leave) });
      } catch (err) {
        console.warn('Speichern im Splitscreen', err);
      }
      if (d.ask) send({ act: 'done', ask: d.ask });
    } else if (d.act === 'drop') receive(d);
  });
  send({ act: 'hello' });
}

// Normale App -> Splitscreen. Die offene Notiz kommt nach links,
// rechts erscheint die Notiz vom letzten Mal (oder der Startbildschirm zum Auswählen).
export function enterSplit(session) {
  write('federleicht.session.L', session);
  const right = read('federleicht.session.R');
  if (!right || (session.noteId && right.noteId === session.noteId)) write('federleicht.session.R', { screen: 'home' });
  location.replace(`${location.pathname}?split=1`);
}

// Fenster -> Splitscreen beenden, dieses Fenster bleibt offen
export function leaveSplit() {
  send({ act: 'close' });
}

function read(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function write(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* egal */
  }
}
