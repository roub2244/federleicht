// dialog.js – kleine Fenster in der Mitte: Name eingeben, Ordner wählen, nachfragen
//
// Statt der grauen Browser-Fenster (prompt/confirm) bauen wir eigene, die zur App passen.
// Jede Funktion gibt ein Promise zurück: Es liefert die Antwort, oder null bei "Abbrechen".
//
//   const name = await askText({ title: 'Umbenennen', value: 'Bio' });
//   if (await confirmBox({ title: 'Löschen?', ok: 'Löschen', danger: true })) …

import { paint } from './paint.js';

const esc = (t) => String(t ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// Grundgerüst: Hintergrund + Karte. build(card) füllt die Karte, result(card) liest die Antwort.
export function openDialog(options) {
  return open(options);
}

function open({ html, onReady, result, wide = false, enter = true }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'dlg-back';
    back.innerHTML = `<div class="dlg${wide ? ' wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    document.body.appendChild(back);
    const card = back.firstElementChild;

    const close = (value) => {
      window.removeEventListener('keydown', onKey, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 160);
      resolve(value);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close(null);
      } else if (e.key === 'Enter' && !e.shiftKey && enter) {
        e.preventDefault();
        e.stopPropagation();
        const v = result(card);
        if (v !== undefined) close(v);
      }
    };
    window.addEventListener('keydown', onKey, true);
    // Daneben tippen = Abbrechen
    back.addEventListener('pointerdown', (e) => {
      if (e.target === back) close(null);
    });
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-dlg]');
      if (!b) return;
      if (b.dataset.dlg === 'cancel') return close(null);
      if (b.dataset.dlg === 'ok') {
        const v = result(card);
        if (v !== undefined) close(v);
      }
    });
    onReady?.(card, close);
  });
}

function buttons(ok, danger, cancel = 'Abbrechen') {
  return `<div class="dlg-btns">
    <button class="dlg-btn" data-dlg="cancel">${esc(cancel)}</button>
    <button class="dlg-btn primary${danger ? ' danger' : ''}" data-dlg="ok">${esc(ok)}</button>
  </div>`;
}

// Text eingeben (z. B. Name einer Notiz). colors: Liste von Farben zum Auswählen (für Ordner)
export function askText({ title, value = '', placeholder = '', ok = 'Speichern', colors = null, color = null }) {
  let picked = color || colors?.[0];
  return open({
    html: `
      <div class="dlg-title">${esc(title)}</div>
      <input class="dlg-input" type="text" maxlength="80" value="${esc(value)}" placeholder="${esc(placeholder)}"
        autocomplete="off" autocapitalize="sentences" spellcheck="false" />
      ${
        colors
          ? `<div class="dlg-colors">${colors
              .map((c) => `<button class="dlg-color${c === picked ? ' selected' : ''}" data-color="${c}" aria-label="Farbe">${paint(c)}</button>`)
              .join('')}</div>`
          : ''
      }
      ${buttons(ok)}`,
    onReady(card) {
      const input = card.querySelector('input');
      // kurz warten, sonst springt die Bildschirmtastatur manchmal nicht auf
      setTimeout(() => {
        input.focus();
        input.select();
      }, 60);
      card.querySelector('.dlg-colors')?.addEventListener('click', (e) => {
        const b = e.target.closest('[data-color]');
        if (!b) return;
        picked = b.dataset.color;
        for (const x of card.querySelectorAll('[data-color]')) x.classList.toggle('selected', x === b);
      });
    },
    result(card) {
      const text = card.querySelector('input').value.trim();
      if (!text) {
        card.querySelector('input').classList.add('shake');
        setTimeout(() => card.querySelector('input')?.classList.remove('shake'), 400);
        return undefined; // leer -> Fenster bleibt offen
      }
      return colors ? { text, color: picked } : text;
    },
  });
}

// Ja/Nein-Frage
export function confirmBox({ title, text = '', ok = 'OK', danger = false, cancel = 'Abbrechen' }) {
  return open({
    html: `
      <div class="dlg-title">${esc(title)}</div>
      ${text ? `<div class="dlg-text">${esc(text)}</div>` : ''}
      ${buttons(ok, danger, cancel)}`,
    result: () => true,
  }).then(Boolean);
}

// Aus einer Liste auswählen. options: [{ id, label, color?, current? }]
export function chooseFrom({ title, options }) {
  return open({
    html: `
      <div class="dlg-title">${esc(title)}</div>
      <div class="dlg-list">
        ${options
          .map(
            (o, i) => `<button class="dlg-item${o.current ? ' current' : ''}" data-i="${i}">
              <i class="dlg-dot">${o.color ? paint(o.color) : ''}</i><span>${esc(o.label)}</span>
              ${o.current ? '<small>aktuell</small>' : ''}
            </button>`
          )
          .join('')}
      </div>
      <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button></div>`,
    onReady(card, close) {
      card.querySelector('.dlg-list').addEventListener('click', (e) => {
        const b = e.target.closest('[data-i]');
        if (b) close(options[Number(b.dataset.i)].id);
      });
    },
    result: () => undefined,
  });
}

// Fortschritt (z. B. "PDF wird geladen … 3 von 12"). Gibt { update, close, signal } zurück.
// signal.cancelled wird true, wenn auf "Abbrechen" getippt wurde.
export function progressBox({ title, text = '' }) {
  const signal = { cancelled: false };
  let card = null;
  let closeFn = null;
  let finished = false;
  open({
    html: `
      <div class="dlg-title">${esc(title)}</div>
      <div class="dlg-text dlg-progress-text">${esc(text)}</div>
      <div class="dlg-bar"><i></i></div>
      <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button></div>`,
    onReady(c, close) {
      card = c;
      closeFn = close;
    },
    result: () => undefined,
  }).then(() => {
    if (!finished) signal.cancelled = true; // "Abbrechen" getippt
  });
  return {
    signal,
    update(message, fraction = null) {
      if (!card) return;
      card.querySelector('.dlg-progress-text').textContent = message;
      const bar = card.querySelector('.dlg-bar i');
      bar.style.width = fraction === null ? '' : `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
      bar.parentElement.classList.toggle('busy', fraction === null);
    },
    close() {
      finished = true;
      closeFn?.(null);
    },
  };
}

// Mehrere Knöpfe zur Auswahl (z. B. "Teilen" oder "Speichern"). actions: [{ id, label, primary? }]
export function chooseAction({ title, text = '', actions }) {
  return open({
    html: `
      <div class="dlg-title">${esc(title)}</div>
      ${text ? `<div class="dlg-text">${esc(text)}</div>` : ''}
      <div class="dlg-btns">
        <button class="dlg-btn" data-dlg="cancel">Abbrechen</button>
        ${actions.map((a) => `<button class="dlg-btn${a.primary ? ' primary' : ''}" data-act="${esc(a.id)}">${esc(a.label)}</button>`).join('')}
      </div>`,
    onReady(card, close) {
      card.addEventListener('click', (e) => {
        const b = e.target.closest('[data-act]');
        if (b) close(b.dataset.act);
      });
    },
    result: () => actions.find((a) => a.primary)?.id,
  });
}

// Kurze Meldung unten ("Notiz gelöscht" mit "Rückgängig")
let toastTimer = 0;
export function toast(text, action = null) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    document.body.appendChild(el);
  }
  el.innerHTML = `<span>${esc(text)}</span>${action ? `<button>${esc(action.label)}</button>` : ''}`;
  if (action) {
    el.querySelector('button').onclick = () => {
      el.classList.remove('show');
      action.run();
    };
  }
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), action ? 4500 : 2200);
}

export { esc };
