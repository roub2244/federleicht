// optionspopup.js – kleines Einstellungs-Menü unter einem Knopf (Schalter und Auswahl-Knöpfe)
//
// Wird z. B. von der Handschrifthilfe benutzt (Knopf nochmal antippen).
//
//   openOptions(button, {
//     title: 'Handschrifthilfe',
//     rows: [
//       { type: 'switch', key: 'guide', label: 'Hilfslinie', hint: 'Erklärung …' },
//       { type: 'seg', key: 'boxes', label: 'Zeilenhöhe', options: [[1, '1 Kästchen'], [2, '2 Kästchen']] },
//       { type: 'note', text: 'Kleiner Hinweis' },
//     ],
//     get: (key) => wert,
//     set: (key, wert) => { … },
//   })

import { anchorRect } from './toolbarconfig.js';

const CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
let current = null;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function closeOptions() {
  if (!current) return;
  current.el.remove();
  current.button?.classList.remove('menu-open');
  window.removeEventListener('pointerdown', current.outside, true);
  current.onClose?.();
  current = null;
}

export function optionsOpen(button) {
  return Boolean(current && current.button === button);
}

export function openOptions(button, spec) {
  closeOptions();
  const el = document.createElement('div');
  el.className = 'popup options-popup';
  document.body.appendChild(el);

  const render = () => {
    el.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">${esc(spec.title)}</span>
        <button class="head-btn" data-close title="Schließen">${CLOSE}</button>
      </div>
      <div class="op-list">${spec.rows
        .filter((r) => !r.when || r.when())
        .map((r) => {
          if (r.type === 'switch') {
            return `<label class="switch-row op-row${r.main ? ' op-main' : ''}"><span>${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span>
              <input type="checkbox" class="switch" data-key="${r.key}" ${spec.get(r.key) ? 'checked' : ''} /></label>`;
          }
          if (r.type === 'seg') {
            const v = spec.get(r.key);
            return `<div class="op-row op-seg-row"><span>${esc(r.label)}${r.hint ? `<small>${esc(r.hint)}</small>` : ''}</span>
              <div class="op-seg">${r.options
                .map(([val, label]) => `<button data-seg="${r.key}" data-val="${esc(JSON.stringify(val))}" class="${val === v ? 'on' : ''}">${esc(label)}</button>`)
                .join('')}</div></div>`;
          }
          if (r.type === 'button') return `<button class="op-btn${r.danger ? ' danger' : ''}" data-btn="${r.key}">${esc(r.label)}</button>`;
          if (r.type === 'title') return `<div class="tp-group">${esc(r.text)}</div>`;
          return `<p class="op-note">${esc(r.text)}</p>`;
        })
        .join('')}</div>`;
  };
  render();

  el.addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key) return;
    spec.set(key, e.target.checked);
    render();
  });
  el.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) return closeOptions();
    const seg = e.target.closest('[data-seg]');
    if (seg) {
      spec.set(seg.dataset.seg, JSON.parse(seg.dataset.val));
      render();
    }
    const btn = e.target.closest('[data-btn]');
    if (btn) {
      const row = spec.rows.find((r) => r.key === btn.dataset.btn);
      if (row?.closes !== false) closeOptions();
      row?.run?.();
    }
  });

  // Unter den Knopf setzen
  const b = anchorRect(button);
  const w = el.offsetWidth;
  el.style.left = `${Math.min(window.innerWidth - w - 8, Math.max(8, b.left + b.width / 2 - w / 2))}px`;
  el.style.top = `${b.bottom + 12}px`;
  button?.classList.add('menu-open');

  // Daneben tippen schließt (auf der Seite wird dabei nichts gemalt)
  const outside = (e) => {
    if (el.contains(e.target) || button?.contains(e.target)) return;
    const onCanvas = e.target.id === 'canvas';
    closeOptions();
    if (onCanvas) {
      e.stopPropagation();
      const id = e.pointerId;
      const swallow = (ev) => {
        if (ev.pointerId !== id) return;
        ev.stopPropagation();
        if (ev.type !== 'pointermove') {
          window.removeEventListener('pointermove', swallow, true);
          window.removeEventListener('pointerup', swallow, true);
          window.removeEventListener('pointercancel', swallow, true);
        }
      };
      window.addEventListener('pointermove', swallow, true);
      window.addEventListener('pointerup', swallow, true);
      window.addEventListener('pointercancel', swallow, true);
    }
  };
  window.addEventListener('pointerdown', outside, true);
  current = { el, button, outside, onClose: spec.onClose, render };
  return { el, render, close: closeOptions };
}
