// mediamenu.js – die Menüs "Einfügen" (Bild, Foto, PDF) und "Teilen" (PDF, Bild) oben rechts
//
// Die eigentliche Arbeit macht main.js über "api":
//   api.insertImages(files)   api.insertPdf(file)   api.exportNote(kind, how)

import { anchorRect } from './toolbarconfig.js';

const ICON = {
  image: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17.5 5-4.5 4 3.5 2.5-2 4.5 3.5"/></svg>',
  camera: '<svg viewBox="0 0 24 24"><path d="M4 8.5a2 2 0 0 1 2-2h2l1.5-2h5L16 6.5h2a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5"/></svg>',
  pdf: '<svg viewBox="0 0 24 24"><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M8.6 17v-4.4h1.3a1.3 1.3 0 0 1 0 2.6H8.6M12.6 17v-4.4h.9a2.2 2.2 0 0 1 0 4.4zM16.4 12.6h-1.4V17M15 14.8h1.2" stroke-width="1.25"/></svg>',
  pages: '<svg viewBox="0 0 24 24"><rect x="7" y="3" width="12" height="15" rx="2"/><path d="M5 6.5V19a2 2 0 0 0 2 2h9.5"/></svg>',
  page: '<svg viewBox="0 0 24 24"><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
};

export function setupMediaMenu(api) {
  const insertBtn = document.getElementById('btn-insert');
  const shareBtn = document.getElementById('btn-share');
  const popup = document.getElementById('media-popup');
  let openFor = null; // 'insert' | 'share' | null

  // Unsichtbare Datei-Auswahl (öffnet die Galerie, Kamera oder "Eigene Dateien")
  const picker = (accept, { multiple = false, capture = null } = {}) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.hidden = true;
    document.body.appendChild(input);
    return input;
  };
  const galleryInput = picker('image/*', { multiple: true });
  const cameraInput = picker('image/*', { capture: 'environment' });
  const pdfInput = picker('application/pdf,.pdf');

  galleryInput.addEventListener('change', () => takeFiles(galleryInput, (files) => api.insertImages(files)));
  cameraInput.addEventListener('change', () => takeFiles(cameraInput, (files) => api.insertImages(files)));
  pdfInput.addEventListener('change', () => takeFiles(pdfInput, (files) => api.insertPdf(files[0])));

  function takeFiles(input, run) {
    const files = [...input.files];
    input.value = ''; // dieselbe Datei nochmal wählen können
    if (files.length) run(files);
  }

  function row(act, icon, label, hint) {
    return `<button class="mm-row" data-act="${act}">${icon}<span>${label}<small>${hint}</small></span></button>`;
  }

  function openInsert() {
    popup.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">Einfügen</span>
        <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
      </div>
      <div class="mm-list">
        ${row('gallery', ICON.image, 'Bild', 'Aus der Galerie oder den Dateien')}
        ${row('camera', ICON.camera, 'Foto aufnehmen', 'Tafel, Buchseite, Arbeitsblatt …')}
        ${row('pdf', ICON.pdf, 'PDF', 'Seiten nach dieser Seite einfügen und darauf schreiben')}
      </div>`;
    show('insert', insertBtn);
  }

  function openShare() {
    const many = api.pageCount() > 1;
    popup.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">Teilen und Exportieren</span>
        <button class="head-btn" data-close title="Schließen">${ICON.close}</button>
      </div>
      <div class="mm-list">
        ${row('pdf-all', ICON.pages, many ? `Ganze Notiz als PDF` : 'Als PDF', many ? `Alle ${api.pageCount()} Seiten` : 'Zum Abgeben, Drucken, Verschicken')}
        ${many ? row('pdf-page', ICON.pdf, 'Diese Seite als PDF', `Nur Seite ${api.currentPage() + 1}`) : ''}
        ${row('png-page', ICON.image, many ? 'Diese Seite als Bild' : 'Als Bild', 'PNG – z. B. für WhatsApp')}
      </div>
      <div class="popup-hint">Wird immer mit hellem Blatt exportiert – wie auf Papier.</div>`;
    show('share', shareBtn);
  }

  function show(kind, button) {
    api.closeOtherPopups();
    openFor = kind;
    popup.hidden = false;
    insertBtn.classList.toggle('active', kind === 'insert');
    shareBtn.classList.toggle('active', kind === 'share');
    const b = anchorRect(button);
    const w = popup.offsetWidth;
    popup.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2))}px`;
    popup.style.top = `${b.bottom + 12}px`;
  }

  function close() {
    if (popup.hidden) return;
    popup.hidden = true;
    popup.innerHTML = '';
    openFor = null;
    insertBtn.classList.remove('active');
    shareBtn.classList.remove('active');
  }

  insertBtn.addEventListener('click', () => (openFor === 'insert' ? close() : openInsert()));
  shareBtn.addEventListener('click', () => (openFor === 'share' ? close() : openShare()));

  popup.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if ('close' in b.dataset) return close();
    const act = b.dataset.act;
    close();
    if (act === 'gallery') galleryInput.click();
    else if (act === 'camera') cameraInput.click();
    else if (act === 'pdf') pdfInput.click();
    else if (act === 'pdf-all') api.exportNote('pdf', 'all');
    else if (act === 'pdf-page') api.exportNote('pdf', 'page');
    else if (act === 'png-page') api.exportNote('png', 'page');
  });

  // Daneben tippen schließt das Menü (auf der Seite wird dabei nichts gemalt)
  let swallowed = null;
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (popup.hidden || popup.contains(e.target) || insertBtn.contains(e.target) || shareBtn.contains(e.target)) return;
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

  return {
    close,
    pickPdf: () => pdfInput.click(),
  };
}
