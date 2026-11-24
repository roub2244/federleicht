// folders.js – Ordner: Farben, Symbole, Unterordner und das Fenster zum Bearbeiten
//
// Ein Ordner sieht so aus:
//   { id, name, color, icon, parentId, created }
//     icon      Symbol aus foldericons.js (z. B. 'flask') oder eigenes Zeichen ('e:📐')
//     parentId  in welchem Ordner er liegt (null = ganz oben)
// Ältere Ordner (vor Etappe 9) haben noch kein icon/parentId – dann gilt 'folder' bzw. null.

import { paint } from './paint.js';
import { openDialog, esc } from './dialog.js';
import { FOLDER_ICONS, isCustomIcon } from './foldericons.js';

export const FOLDER_COLORS = [
  '#4a6cf7', '#1971c2', '#0c8599', '#0ca678', '#2f9e44', '#74b816',
  '#f59f00', '#f76707', '#e03131', '#e64980', '#ae3ec9', '#7048e8', '#495057',
];

// Ordner-Symbol als HTML (ein Canvas, siehe paint.js "badge")
export function badge(folder, cls = 'f-badge') {
  const icon = folder?.icon || 'folder';
  return `<i class="${cls}">${paint(folder?.color || '#4a6cf7', 'badge', ` data-icon="${esc(icon)}"`)}</i>`;
}

// Passendes Symbol zum Namen vorschlagen ("Chemie" -> Kolben)
const GUESS = [
  [/mathe|mathematik|algebra|geometrie|analysis|stochastik/i, 'math'],
  [/deutsch|literatur|lesen|aufsatz/i, 'book'],
  [/englisch|english|spanisch|französisch|franz|latein|italienisch|russisch|sprache/i, 'speech'],
  [/bio/i, 'leaf'],
  [/chemie|chem/i, 'flask'],
  [/physik|phys/i, 'bolt'],
  [/erdkunde|geo|geographie|geografie/i, 'globe'],
  [/geschichte|gesch/i, 'columns'],
  [/politik|sozial|gesellschaft|pgw|sowi|gemeinschaftskunde/i, 'people'],
  [/musik/i, 'music'],
  [/kunst|zeichnen/i, 'palette'],
  [/sport/i, 'ball'],
  [/informatik|programm|code|info\b/i, 'code'],
  [/wirtschaft|wirt|bwl|vwl/i, 'chart'],
  [/religion|reli|ethik|philosophie/i, 'chapel'],
  [/schule|klasse|abitur|abi\b/i, 'cap'],
  [/aufgabe|hausaufgabe|hü|to-?do/i, 'clipboard'],
  [/termin|kalender|plan/i, 'calendar'],
  [/idee/i, 'bulb'],
  [/privat|tagebuch/i, 'heart'],
  [/arbeit|job|praktikum/i, 'brief'],
  [/reise|urlaub/i, 'plane'],
  [/foto|bild/i, 'camera'],
  [/training|fitness|gym/i, 'dumbbell'],
];
export function guessIcon(name) {
  for (const [re, id] of GUESS) if (re.test(name)) return id;
  return null;
}

// ---------- Baum-Helfer ----------
export const parentOf = (f) => f?.parentId || null;

// Alle Ordner unterhalb von id (Kinder, Enkel …)
export function descendants(folders, id) {
  const out = new Set();
  const walk = (pid) => {
    for (const f of folders) {
      if (parentOf(f) === pid && !out.has(f.id)) {
        out.add(f.id);
        walk(f.id);
      }
    }
  };
  walk(id);
  return out;
}

// Weg von oben bis zu diesem Ordner: [Oberordner, …, Ordner]
export function pathOf(folders, id) {
  const path = [];
  let f = folders.find((x) => x.id === id);
  const seen = new Set();
  while (f && !seen.has(f.id)) {
    seen.add(f.id);
    path.unshift(f);
    f = folders.find((x) => x.id === parentOf(f));
  }
  return path;
}

export const sortFolders = (list) => [...list].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'de', { numeric: true }));

export function childrenOf(folders, pid) {
  return sortFolders(folders.filter((f) => parentOf(f) === (pid || null)));
}

// Alle Ordner als eingerückte Liste (für Auswahl-Listen): [{ folder, depth }]
export function flatTree(folders, skip = new Set()) {
  const out = [];
  const walk = (pid, depth) => {
    for (const f of childrenOf(folders, pid)) {
      if (skip.has(f.id)) continue;
      out.push({ folder: f, depth });
      walk(f.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// ---------- Fenster: Ordner anlegen oder bearbeiten ----------
// Gibt { name, color, icon, parentId } zurück oder null (Abbrechen)
export function folderDialog({ title, folder = null, folders = [], parentId = null, ok = 'Speichern' }) {
  const editing = Boolean(folder);
  let color = folder?.color || nextColor(folders);
  let icon = folder?.icon || 'folder';
  let iconTouched = editing && icon !== 'folder';
  // Wohin darf der Ordner? Nicht in sich selbst und nicht in seine eigenen Unterordner
  const skip = folder ? new Set([folder.id, ...descendants(folders, folder.id)]) : new Set();
  const places = flatTree(folders, skip);
  const currentParent = folder ? parentOf(folder) : parentId;

  return openDialog({
    wide: true,
    html: `
      <div class="dlg-title">${esc(title)}</div>
      <div class="fd-top">
        <span class="fd-preview">${badge({ color, icon }, 'fd-badge')}</span>
        <input class="dlg-input fd-name" type="text" maxlength="60" value="${esc(folder?.name || '')}" placeholder="Name, z. B. Mathe"
          autocomplete="off" autocapitalize="sentences" spellcheck="false" />
      </div>
      <div class="fd-label">Farbe</div>
      <div class="dlg-colors fd-colors">${FOLDER_COLORS.map(
        (c) => `<button class="dlg-color${c === color ? ' selected' : ''}" data-color="${c}" aria-label="Farbe">${paint(c)}</button>`
      ).join('')}</div>
      <div class="fd-label">Symbol</div>
      <div class="fd-icons">${FOLDER_ICONS.map(
        (i) => `<button class="fd-icon${i.id === icon ? ' selected' : ''}" data-icon="${i.id}" title="${esc(i.name)}" aria-label="${esc(i.name)}">${badge({ color, icon: i.id }, 'fd-ibadge')}</button>`
      ).join('')}</div>
      <label class="fd-own"><span>Eigenes Zeichen</span>
        <input class="dlg-input fd-emoji" type="text" maxlength="8" placeholder="z. B. 📐 ∑ 🧪 A" value="${esc(isCustomIcon(icon) ? icon.slice(2) : '')}" autocomplete="off" />
      </label>
      ${
        places.length
          ? `<label class="fd-own"><span>Liegt in</span>
              <select class="dlg-input fd-parent">
                <option value="">Ganz oben (kein Oberordner)</option>
                ${places.map(({ folder: f, depth }) => `<option value="${f.id}"${f.id === currentParent ? ' selected' : ''}>${'\u00a0\u00a0\u00a0'.repeat(depth)}${depth ? '└ ' : ''}${esc(f.name)}</option>`).join('')}
              </select>
            </label>`
          : ''
      }
      <div class="dlg-btns">
        <button class="dlg-btn" data-dlg="cancel">Abbrechen</button>
        <button class="dlg-btn primary" data-dlg="ok">${esc(ok)}</button>
      </div>`,
    onReady(card) {
      const name = card.querySelector('.fd-name');
      const emoji = card.querySelector('.fd-emoji');
      const preview = card.querySelector('.fd-preview');
      const update = () => {
        preview.innerHTML = badge({ color, icon }, 'fd-badge');
        for (const b of card.querySelectorAll('[data-color]')) b.classList.toggle('selected', b.dataset.color === color);
        for (const b of card.querySelectorAll('.fd-icon')) {
          b.classList.toggle('selected', b.dataset.icon === icon);
          b.querySelector('canvas').dataset.c = color; // Symbole in der gewählten Farbe zeigen
        }
      };
      card.addEventListener('click', (e) => {
        const c = e.target.closest('[data-color]');
        if (c) {
          color = c.dataset.color;
          update();
        }
        const i = e.target.closest('.fd-icon');
        if (i) {
          icon = i.dataset.icon;
          iconTouched = true;
          emoji.value = '';
          update();
        }
      });
      emoji.addEventListener('input', () => {
        const text = firstGraphemes(emoji.value.trim(), 2);
        icon = text ? `e:${text}` : 'folder';
        iconTouched = Boolean(text);
        update();
      });
      // Beim Tippen des Namens ein passendes Symbol vorschlagen (bis man selbst eins wählt)
      name.addEventListener('input', () => {
        if (iconTouched) return;
        icon = guessIcon(name.value) || 'folder';
        update();
      });
      setTimeout(() => name.focus(), 60);
    },
    result(card) {
      const input = card.querySelector('.fd-name');
      const text = input.value.trim();
      if (!text) {
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
        return undefined;
      }
      const parent = card.querySelector('.fd-parent');
      return { name: text, color, icon, parentId: parent ? parent.value || null : currentParent || null };
    },
  });
}

function nextColor(folders) {
  const used = new Set(folders.map((f) => f.color));
  return FOLDER_COLORS.find((c) => !used.has(c)) || FOLDER_COLORS[folders.length % FOLDER_COLORS.length];
}

// Die ersten n "Zeichen" so, wie man sie sieht (ein Emoji kann aus mehreren Teilen bestehen)
function firstGraphemes(text, n) {
  if (window.Intl?.Segmenter) {
    const seg = new Intl.Segmenter('de', { granularity: 'grapheme' });
    return [...seg.segment(text)].slice(0, n).map((s) => s.segment).join('');
  }
  return [...text].slice(0, n).join('');
}
