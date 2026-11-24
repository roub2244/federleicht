// moremenu.js – das ⋮-Menü oben rechts (wie "Mehr" in Samsung Notes)
//
// Hier steht alles, was nicht dauernd in der Leiste sein muss:
//   - Extras der Notiz (Sprachaufnahme, Mathe-Hilfe, Notiz sperren …) – main.js meldet sie an
//   - Knöpfe und Werkzeuge, die du in "Werkzeugleiste anpassen" aus der Leiste genommen hast
//   - "Werkzeugleiste anpassen" selbst
//
// api.sections()        -> [{ title, rows: [{ icon, label, hint, run, on, badge }] }]
// api.hiddenItems()     -> Knöpfe, die gerade nicht in der Leiste sind (siehe toolbarconfig.js)
// api.customize()       -> Fenster "Werkzeugleiste anpassen" öffnen
// api.closeOtherPopups()

const ICON = {
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  customize: '<svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg>',
};

export function setupMoreMenu(api) {
  const button = document.getElementById('btn-more');
  const popup = document.createElement('div');
  popup.className = 'popup media-popup more-popup';
  popup.hidden = true;
  document.body.appendChild(popup);
  let actions = [];

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

  function row(r) {
    const i = actions.push(r.run) - 1;
    return `<button class="mm-row${r.on ? ' on' : ''}" data-i="${i}"${r.disabled ? ' disabled' : ''}>${r.icon || ''}<span>${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span>${r.badge ? `<em class="mm-badge">${esc(r.badge)}</em>` : ''}</button>`;
  }

  function open() {
    api.closeOtherPopups();
    actions = [];
    const groups = api.sections().filter((g) => g.rows.length);
    const hidden = api.hiddenItems();
    if (hidden.length) {
      groups.push({
        title: 'Aus der Leiste',
        rows: hidden.map((h) => ({
          icon: h.icon.startsWith('<svg') ? h.icon : `<span class="mm-text-icon">${h.icon}</span>`,
          label: h.id === 'zoom' ? `Zoom zurücksetzen (${h.element.textContent.trim()})` : h.name,
          on: h.element.classList.contains('active') || h.element.classList.contains('on'),
          run: () => h.element.click(),
        })),
      });
    }
    popup.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">Mehr</span>
        <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
      </div>
      <div class="mm-list more-list">
        ${groups.map((g) => `${g.title ? `<div class="tp-group">${esc(g.title)}</div>` : ''}${g.rows.map(row).join('')}`).join('')}
        <div class="hm-sep"></div>
        ${row({ icon: ICON.customize, label: 'Werkzeugleiste anpassen', hint: 'Knöpfe ordnen, hinzufügen, entfernen', run: api.customize })}
      </div>`;
    popup.hidden = false;
    button.classList.add('active');
    const b = button.getBoundingClientRect();
    const w = popup.offsetWidth;
    popup.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, b.right - w))}px`;
    popup.style.top = `${b.bottom + 10}px`;
  }

  function close() {
    if (popup.hidden) return;
    popup.hidden = true;
    popup.innerHTML = '';
    button.classList.remove('active');
  }

  button.addEventListener('click', () => (popup.hidden ? open() : close()));
  popup.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('close' in b.dataset) return close();
    const run = actions[Number(b.dataset.i)];
    close();
    // Erst nach dem Schließen ausführen: ein Knopf aus der Leiste öffnet evtl. sein eigenes Menü
    if (run) setTimeout(run, 0);
  });

  // Daneben tippen schließt das Menü (auf der Seite wird dabei nichts gemalt)
  let swallowed = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (popup.hidden || popup.contains(e.target) || button.contains(e.target)) return;
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

  return { open, close, get isOpen() { return !popup.hidden; } };
}
