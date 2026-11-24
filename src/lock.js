// lock.js – Notizen und Ordner mit einer PIN sperren (wie "Notizen sperren" in Samsung Notes)
//
// So funktioniert es:
//   - Es gibt EINE PIN für alle gesperrten Notizen und Ordner (4 bis 8 Ziffern).
//   - Beim ersten Sperren legst du sie fest und bekommst einen Wiederherstellungs-Code.
//     Den schreibst du dir auf: Damit kannst du eine vergessene PIN neu setzen.
//   - Gesperrte Notizen zeigen auf dem Startbildschirm kein Vorschaubild, und die Suche
//     schaut nicht hinein. Öffnen geht nur mit PIN.
//   - Einmal entsperrt, bleibt alles offen, bis du die App verlässt (einstellbar: sofort,
//     nach 1 Minute, nach 5 Minuten) oder oben auf das Schloss "Jetzt sperren" tippst.
//
// Gespeichert wird nur ein "Hash" der PIN (PBKDF2 mit Salz), nie die PIN selbst.
// Wichtig: Die Sperre schützt vor neugierigen Blicken (z. B. wenn jemand dein Tablet in die Hand
// nimmt). Verschlüsselt werden die Notizen dabei nicht.

const KEY = 'federleicht.pin';
const ITERATIONS = 120000;
const ICON = {
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9.5" rx="2.2"/><path d="M8.5 11V7.5a3.5 3.5 0 0 1 7 0V11"/><path d="M12 14.6v2.4"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M20 12H8M12 7l-5 5 5 5"/></svg>',
};

let unlocked = false;
let hiddenAt = 0;
const listeners = new Set();

function readCfg() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || null;
  } catch {
    return null;
  }
}
function writeCfg(cfg) {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* egal */
  }
}

export const hasPin = () => Boolean(readCfg()?.hash);
export const isUnlocked = () => unlocked;
export function autoLockSetting() {
  return readCfg()?.auto ?? 'leave';
}
export function setAutoLock(value) {
  const cfg = readCfg();
  if (!cfg) return;
  cfg.auto = value;
  writeCfg(cfg);
}
export function onLockChange(fn) {
  listeners.add(fn);
}
function emit() {
  for (const fn of listeners) fn(unlocked);
}
export function lockNow() {
  if (!unlocked) return;
  unlocked = false;
  emit();
}

// App verlassen -> je nach Einstellung wieder sperren
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hiddenAt = Date.now();
  else if (unlocked && hiddenAt) {
    const auto = autoLockSetting();
    const away = Date.now() - hiddenAt;
    const limit = auto === '5min' ? 300000 : auto === '1min' ? 60000 : 0;
    if (away > limit) lockNow();
  }
});

// ---------- Hash ----------
function hex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
async function hash(secret, salt) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: enc.encode(salt), iterations: ITERATIONS, hash: 'SHA-256' }, key, 256);
  return hex(bits);
}
function randomSalt() {
  return hex(crypto.getRandomValues(new Uint8Array(16)));
}
function recoveryCode() {
  const abc = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // ohne 0/O und 1/I, damit man nichts verwechselt
  const r = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...r].map((x) => abc[x % abc.length]);
  return `${chars.slice(0, 4).join('')}-${chars.slice(4, 8).join('')}-${chars.slice(8).join('')}`;
}
const normCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

async function checkPin(pin) {
  const cfg = readCfg();
  if (!cfg) return false;
  return (await hash(pin, cfg.salt)) === cfg.hash;
}

async function savePin(pin, { newRecovery = true } = {}) {
  const old = readCfg() || {};
  const salt = randomSalt();
  const cfg = { ...old, salt, hash: await hash(pin, salt), len: pin.length, auto: old.auto || 'leave' };
  let code = null;
  if (newRecovery || !old.rhash) {
    code = recoveryCode();
    cfg.rsalt = randomSalt();
    cfg.rhash = await hash(normCode(code), cfg.rsalt);
  }
  writeCfg(cfg);
  return code;
}

// ---------- Ziffernblock ----------
// mode: 'enter' (PIN eingeben), 'new' (neue PIN festlegen, 2x), Ergebnis: PIN oder null
function pinPad({ title, text, mode = 'enter', check = null, forgot = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'pin-back';
    back.innerHTML = `
      <div class="pin-card" role="dialog" aria-modal="true">
        <div class="pin-icon">${ICON.lock}</div>
        <div class="pin-title"></div>
        <div class="pin-text"></div>
        <div class="pin-dots"></div>
        <div class="pin-pad">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-n="${n}">${n}</button>`).join('')}
          <button data-act="cancel" class="pin-soft">Abbrechen</button>
          <button data-n="0">0</button>
          <button data-act="del" class="pin-soft" aria-label="Löschen">${ICON.back}</button>
        </div>
        <div class="pin-foot">
          ${mode === 'new' ? '<button data-act="ok" class="pin-ok">Weiter</button>' : ''}
          ${forgot ? '<button data-act="forgot" class="pin-link">PIN vergessen?</button>' : ''}
        </div>
      </div>`;
    document.body.appendChild(back);
    const card = back.firstElementChild;
    const dots = card.querySelector('.pin-dots');
    const titleEl = card.querySelector('.pin-title');
    const textEl = card.querySelector('.pin-text');
    let pin = '';
    let first = null; // beim Festlegen: erste Eingabe
    let busy = false;
    const want = readCfg()?.len || 0;

    const show = (t, x) => {
      titleEl.textContent = t;
      textEl.textContent = x;
    };
    show(title, text);

    const paint = (state = '') => {
      const n = mode === 'enter' && want ? want : Math.max(4, pin.length);
      dots.className = `pin-dots ${state}`;
      dots.innerHTML = Array.from({ length: n }, (_, i) => `<i class="${i < pin.length ? 'on' : ''}"></i>`).join('');
    };
    paint();

    const done = (value) => {
      window.removeEventListener('keydown', onKey, true);
      back.classList.add('out');
      setTimeout(() => back.remove(), 160);
      resolve(value);
    };
    const shake = (msg) => {
      paint('wrong');
      navigator.vibrate?.([30, 40, 30]);
      if (msg) textEl.textContent = msg;
      setTimeout(() => {
        pin = '';
        paint();
      }, 450);
    };

    async function submit() {
      if (busy) return;
      if (mode === 'enter') {
        busy = true;
        const ok = await check(pin);
        busy = false;
        if (ok) return done(pin);
        return shake('Falsche PIN – nochmal versuchen');
      }
      // Neue PIN festlegen
      if (pin.length < 4) return shake('Mindestens 4 Ziffern');
      if (!first) {
        first = pin;
        pin = '';
        show('PIN wiederholen', 'Gib dieselbe PIN noch einmal ein');
        paint();
        return;
      }
      if (pin !== first) {
        first = null;
        show(title, text);
        return shake('Die beiden PINs waren verschieden – nochmal von vorn');
      }
      done(pin);
    }

    function press(n) {
      if (busy || pin.length >= 8) return;
      pin += n;
      paint();
      // Beim Eingeben: sobald die Länge stimmt, sofort prüfen
      if (mode === 'enter' && want && pin.length === want) submit();
    }
    card.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.n) return press(b.dataset.n);
      const act = b.dataset.act;
      if (act === 'del') {
        pin = pin.slice(0, -1);
        paint();
      } else if (act === 'cancel') done(null);
      else if (act === 'ok') submit();
      else if (act === 'forgot') {
        done(null);
        forgot();
      }
    });
    const onKey = (e) => {
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') {
        pin = pin.slice(0, -1);
        paint();
      } else if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') done(null);
      else return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
  });
}

// Einfaches Fenster mit Text (und optional Eingabefeld)
function infoBox({ title, html, ok = 'OK', input = null }) {
  return new Promise((resolve) => {
    const back = document.createElement('div');
    back.className = 'pin-back';
    back.innerHTML = `
      <div class="pin-card pin-info" role="dialog" aria-modal="true">
        <div class="pin-icon">${ICON.lock}</div>
        <div class="pin-title">${title}</div>
        <div class="pin-text">${html}</div>
        ${input ? `<input class="pin-input" placeholder="${input}" autocomplete="off" autocapitalize="characters" spellcheck="false" />` : ''}
        <div class="pin-foot">
          ${input ? '<button data-act="cancel" class="pin-link">Abbrechen</button>' : ''}
          <button data-act="ok" class="pin-ok">${ok}</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const field = back.querySelector('.pin-input');
    field?.focus();
    back.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      back.remove();
      resolve(act === 'ok' ? (field ? field.value : true) : null);
    });
  });
}

// ---------- Öffentliche Abläufe ----------

// Sicherstellen, dass eine PIN existiert (beim ersten Sperren). true = bereit
export async function ensurePin() {
  if (hasPin()) return true;
  const pin = await pinPad({ title: 'PIN festlegen', text: '4 bis 8 Ziffern – damit öffnest du gesperrte Notizen und Ordner', mode: 'new' });
  if (!pin) return false;
  const code = await savePin(pin);
  unlocked = true;
  emit();
  await infoBox({
    title: 'Wiederherstellungs-Code',
    html: `Falls du die PIN vergisst, kannst du sie mit diesem Code neu festlegen. <b>Schreib ihn dir auf</b> (z. B. hinten ins Hausaufgabenheft):<div class="pin-code">${code}</div>Ohne PIN und ohne Code kommst du nicht mehr an gesperrte Notizen.`,
    ok: 'Habe ich aufgeschrieben',
  });
  return true;
}

// Entsperren (falls nötig). true = offen
export async function unlock(reason = 'Gesperrt') {
  if (unlocked) return true;
  if (!hasPin()) return true;
  const pin = await pinPad({ title: reason, text: 'PIN eingeben', check: checkPin, forgot: () => recover() });
  if (!pin) return false;
  unlocked = true;
  emit();
  return true;
}

// PIN mit dem Wiederherstellungs-Code neu festlegen
export async function recover() {
  const cfg = readCfg();
  if (!cfg?.rhash) return false;
  const code = await infoBox({ title: 'PIN vergessen', html: 'Gib deinen Wiederherstellungs-Code ein (er wurde beim Festlegen der PIN angezeigt).', ok: 'Weiter', input: 'XXXX-XXXX-XXXX' });
  if (!code) return false;
  if ((await hash(normCode(code), cfg.rsalt)) !== cfg.rhash) {
    await infoBox({ title: 'Code stimmt nicht', html: 'Dieser Wiederherstellungs-Code passt nicht. Achte auf die Schreibweise.' });
    return false;
  }
  const pin = await pinPad({ title: 'Neue PIN festlegen', text: '4 bis 8 Ziffern', mode: 'new' });
  if (!pin) return false;
  const fresh = await savePin(pin, { newRecovery: true });
  unlocked = true;
  emit();
  await infoBox({ title: 'Neuer Wiederherstellungs-Code', html: `Der alte Code gilt nicht mehr. Schreib dir den neuen auf:<div class="pin-code">${fresh}</div>`, ok: 'Habe ich aufgeschrieben' });
  return true;
}

// PIN ändern (alte PIN nötig)
export async function changePin() {
  if (!hasPin()) return ensurePin();
  const old = await pinPad({ title: 'PIN ändern', text: 'Erst die bisherige PIN eingeben', check: checkPin, forgot: () => recover() });
  if (!old) return false;
  const pin = await pinPad({ title: 'Neue PIN', text: '4 bis 8 Ziffern', mode: 'new' });
  if (!pin) return false;
  await savePin(pin, { newRecovery: false });
  unlocked = true;
  emit();
  return true;
}

// Ist diese Notiz gesperrt? (selbst, oder ein Ordner darüber)
export function isNoteLocked(note, folders) {
  if (note?.locked) return true;
  let id = note?.folderId;
  const seen = new Set();
  while (id && !seen.has(id)) {
    seen.add(id);
    const f = folders.find((x) => x.id === id);
    if (!f) break;
    if (f.locked) return true;
    id = f.parentId;
  }
  return false;
}

export function isFolderLocked(folder, folders) {
  let f = folder;
  const seen = new Set();
  while (f && !seen.has(f.id)) {
    if (f.locked) return true;
    seen.add(f.id);
    f = folders.find((x) => x.id === f.parentId);
  }
  return false;
}

export const LOCK_ICON = ICON.lock;
