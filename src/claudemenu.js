// claudemenu.js – der Claude-Knopf oben rechts: Claude zur aktuellen Seite fragen
//
// Federleicht hat keinen eigenen Server und keinen (kostenpflichtigen) API-Schlüssel.
// Deshalb läuft der Chat im "Federleicht-Helfer" auf claude.ai – über Robins normales
// Claude-Konto, ohne Extrakosten. Der Knopf macht die Brücke:
//
//   1. Die aktuelle Seite wird als Bild in die Zwischenablage kopiert,
//   2. der Helfer öffnet sich (immer im selben Tab, nicht jedes Mal ein neuer),
//   3. dort: lange drücken -> Einfügen -> fragen.
//
// Zweiter Weg: Seite direkt an die Claude-App teilen (Android-Teilen-Menü).
// Offline geht beides nicht – dann zeigt das Menü nur einen Hinweis.
//
// main.js liefert über "api":
//   api.pageImage()        -> Promise<Blob>  (aktuelle Seite als PNG, helles Blatt)
//   api.pageLabel()        -> z. B. "Bio (Seite 2)" für den Dateinamen
//   api.closeOtherPopups()

import { esc, toast } from './dialog.js';
import { canShareFile, shareFile, downloadFile, fileName } from './export.js';

// Der Federleicht-Helfer (Claude-Artifact). Nur für Robin freigegeben.
export const HELPER_URL = 'https://claude.ai/artifact/5GLD5XCqVVmmL4egANLL7p';
const HELPER_WINDOW = 'federleicht-claude'; // gleicher Name = derselbe Tab wird wiederverwendet

export const CLAUDE_ICON =
  '<svg viewBox="0 0 24 24"><path d="M12 3.2 13.7 9l5.8 2.1-5.8 2.1L12 19l-1.7-5.8-5.8-2.1L10.3 9z"/><path d="M18.6 3.2v3.2M17 4.8h3.2M5.6 16.6v2.8M4.2 18h2.8" stroke-width="1.5"/></svg>';

const ICON = {
  chat: '<svg viewBox="0 0 24 24"><path d="M5 5.5h14a1.8 1.8 0 0 1 1.8 1.8v8.4a1.8 1.8 0 0 1-1.8 1.8h-7.6L7 20.5v-3H5a1.8 1.8 0 0 1-1.8-1.8V7.3A1.8 1.8 0 0 1 5 5.5z"/><path d="M12 8.2l.8 2.5 2.5.8-2.5.8-.8 2.5-.8-2.5-2.5-.8 2.5-.8z"/></svg>',
  share: '<svg viewBox="0 0 24 24"><circle cx="17.5" cy="5.5" r="2.5"/><circle cx="6.5" cy="12" r="2.5"/><circle cx="17.5" cy="18.5" r="2.5"/><path d="m8.7 10.8 6.6-4M8.7 13.2l6.6 4"/></svg>',
  offline: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18"/><path d="M8.5 16.5a5 5 0 0 1 7 0M5 12.8a10 10 0 0 1 4.2-2.4M19 12.8a10 10 0 0 0-2.6-1.8M2 9.3a15 15 0 0 1 4.4-2.7M22 9.3A15 15 0 0 0 11 5.6"/><circle cx="12" cy="20" r=".6" fill="currentColor"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

export function setupClaudeMenu(api) {
  const button = document.getElementById('btn-claude');
  const popup = document.getElementById('claude-popup');
  let open = false;
  let pending = null; // Promise<Blob>: Seitenbild, wird schon beim Öffnen des Menüs vorbereitet
  let prepared = null; // fertiges Blob (für das Teilen-Menü, das ein frisches Antippen braucht)

  const online = () => navigator.onLine !== false;

  function row(act, icon, label, hint, disabled = false) {
    return `<button class="mm-row" data-act="${act}"${disabled ? ' disabled' : ''}>${icon}<span>${esc(label)}<small>${esc(hint)}</small></span></button>`;
  }

  function render() {
    const off = !online();
    const canShare = 'share' in navigator && canShareFile(new File([new Blob()], 'x.png', { type: 'image/png' }));
    popup.innerHTML = `
      <div class="popup-head">
        <span class="popup-title"><i class="claude-mark">${CLAUDE_ICON}</i>Claude fragen</span>
        <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
      </div>
      ${off ? `<div class="claude-offline">${ICON.offline}<span>Du bist offline. Claude geht nur mit Internet – sobald du wieder WLAN hast, klappt es.</span></div>` : ''}
      <div class="mm-list">
        ${canShare ? row('share', ICON.share, 'An die Claude-App schicken', 'Dann „Claude“ antippen – die Seite hängt schon dran', off) : ''}
        ${row('helper', ICON.chat, 'Im Federleicht-Helfer fragen', 'Seite wird kopiert – dort lange drücken → Einfügen', off)}
      </div>
      <div class="popup-hint">Tipp: Geteilter Bildschirm – links die Notiz, rechts Claude.<br>
      Kostet nichts extra, läuft über dein Claude-Konto.</div>`;
  }

  function show() {
    api.closeOtherPopups();
    render();
    open = true;
    popup.hidden = false;
    button.classList.add('active');
    const b = button.getBoundingClientRect();
    const w = popup.offsetWidth;
    popup.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2))}px`;
    popup.style.top = `${b.bottom + 12}px`;
    // Seitenbild schon jetzt im Hintergrund malen, damit Kopieren/Teilen beim Antippen sofort geht
    prepared = null;
    if (online()) {
      pending = api.pageImage();
      pending.then((blob) => (prepared = blob)).catch(() => {});
    }
  }

  function close() {
    if (!open) return;
    open = false;
    popup.hidden = true;
    popup.innerHTML = '';
    button.classList.remove('active');
  }

  // Seite in die Zwischenablage. Wichtig: write() sofort im Antippen aufrufen und das Bild als
  // Promise übergeben – sonst verweigert der Browser das Kopieren ("kein frisches Antippen").
  async function copyPage(blobPromise) {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return false;
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blobPromise })]);
      return true;
    } catch {
      // Ältere Browser kennen kein Promise im ClipboardItem: mit fertigem Bild nochmal versuchen
      try {
        const blob = await blobPromise;
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
        return true;
      } catch {
        return false;
      }
    }
  }

  function openHelper() {
    const win = window.open(HELPER_URL, HELPER_WINDOW);
    if (win) {
      try { win.focus(); } catch { /* fremder Tab */ }
    }
    return !!win;
  }

  async function talk() {
    const blobPromise = pending || api.pageImage();
    const copying = copyPage(blobPromise);
    // Den Helfer im selben Antippen öffnen (sonst blockt der Browser das neue Fenster)
    const opened = openHelper();
    const copied = await copying;
    if (copied) {
      toast(opened ? 'Seite kopiert – im Helfer lange drücken → Einfügen' : 'Seite kopiert');
    } else {
      // Kein Kopieren möglich: Bild speichern, im Helfer dann "Bild wählen"
      try {
        const blob = await blobPromise;
        downloadFile(new File([blob], fileName(api.pageLabel(), 'png'), { type: 'image/png' }));
        toast('Bild in „Downloads“ gespeichert – im Helfer „Bild wählen“');
      } catch {
        toast('Die Seite ließ sich nicht kopieren');
      }
    }
    if (!opened) {
      toast('Helfer ließ sich nicht öffnen', { label: 'Nochmal', run: openHelper });
    }
  }

  async function share() {
    let blob = prepared;
    if (!blob) {
      // Noch nicht fertig gemalt: kurz warten. Danach braucht Teilen evtl. ein zweites Antippen.
      try {
        blob = await pending;
      } catch {
        return toast('Die Seite ließ sich nicht vorbereiten');
      }
    }
    const file = new File([blob], fileName(api.pageLabel(), 'png'), { type: 'image/png' });
    const ok = await shareFile(file, 'Frage zu meiner Notiz', 'Schau dir meine Notizseite an: ');
    if (!ok) toast('Teilen ging nicht – nimm „Im Federleicht-Helfer fragen“');
  }

  button.addEventListener('click', () => (open ? close() : show()));

  popup.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b || b.disabled) return;
    if ('close' in b.dataset) return close();
    const act = b.dataset.act;
    close();
    if (act === 'helper') talk();
    else if (act === 'share') share();
  });

  // Online/Offline wechselt, während das Menü offen ist
  window.addEventListener('online', () => open && render());
  window.addEventListener('offline', () => open && render());

  // Daneben tippen schließt das Menü (auf der Seite wird dabei nichts gemalt)
  let swallowed = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!open || popup.contains(e.target) || button.contains(e.target)) return;
      close();
      if (e.target.id === 'canvas') {
        swallowed = e.pointerId;
        e.stopPropagation();
      }
    },
    { capture: true }
  );
  for (const type of ['pointermove', 'pointerup', 'pointercancel']) {
    window.addEventListener(
      type,
      (e) => {
        if (e.pointerId !== swallowed) return;
        e.stopPropagation();
        if (type !== 'pointermove') swallowed = null;
      },
      { capture: true }
    );
  }

  return { close };
}
