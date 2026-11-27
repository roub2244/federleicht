// theme.js – Aussehen und Einstellungen der Startseite
//
// Gespeichert in localStorage (federleicht.prefs):
//   theme:    'auto' (wie das Tablet) | 'light' (weiß) | 'dark'
//   accent:   Akzentfarbe (siehe ACCENTS)
//   start:    'today' | 'all' | 'last'  – was beim Öffnen der App kommt
//   name:     Vorname für die Begrüßung ("Guten Morgen, Robin")
//   sections: { now, day, subjects, week } – welche Teile die Startseite "Heute" zeigt
//   fullTeacher: Lehrkräfte mit vollem Namen (statt Kürzel)
//   breaks:   Pausen im Tagesplan anzeigen
//
// Dunkel/Hell: html[data-theme] = 'light' | 'dark' (bei 'auto' fehlt es, dann gilt das Tablet).

const KEY = 'federleicht.prefs';

export const ACCENTS = {
  blue: { name: 'Blau', light: '#4a6cf7', dark: '#7b93ff', softLight: '#e7ecff', softDark: '#252c47', grad: ['#6d8bff', '#7c4dff'] },
  violet: { name: 'Violett', light: '#7048e8', dark: '#9775fa', softLight: '#efe9ff', softDark: '#2d2547', grad: ['#9775fa', '#cc5de8'] },
  teal: { name: 'Türkis', light: '#0c8599', dark: '#3bc9db', softLight: '#e3f6f8', softDark: '#173238', grad: ['#22b8cf', '#20c997'] },
  green: { name: 'Grün', light: '#2b8a3e', dark: '#51cf66', softLight: '#e6f6e9', softDark: '#1b3322', grad: ['#40c057', '#94d82d'] },
  orange: { name: 'Orange', light: '#e8590c', dark: '#ff922b', softLight: '#fff0e4', softDark: '#3a2617', grad: ['#ff922b', '#f76707'] },
  pink: { name: 'Pink', light: '#d6336c', dark: '#f06595', softLight: '#fde8ef', softDark: '#3d1f2b', grad: ['#f06595', '#cc5de8'] },
};

const DEFAULTS = {
  theme: 'auto',
  accent: 'blue',
  start: 'today',
  name: '',
  sections: { now: true, day: true, subjects: true, week: true },
  fullTeacher: true,
  breaks: true,
};

let prefs = load();
const listeners = new Set();
const mq = matchMedia('(prefers-color-scheme: dark)');

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved && typeof saved === 'object') return { ...DEFAULTS, ...saved, sections: { ...DEFAULTS.sections, ...(saved.sections || {}) } };
  } catch {
    /* nichts gespeichert */
  }
  return structuredClone(DEFAULTS);
}

export const getPrefs = () => prefs;

export function setPref(key, value) {
  prefs = { ...prefs, [key]: value };
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch {
    /* egal */
  }
  applyTheme();
  for (const fn of listeners) fn(key);
}

export function resetPrefs() {
  prefs = structuredClone(DEFAULTS);
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* egal */
  }
  applyTheme();
  for (const fn of listeners) fn('all');
}

// Ist gerade der dunkle Look aktiv?
export const isDark = () => (prefs.theme === 'auto' ? mq.matches : prefs.theme === 'dark');

// fn(key) bei jeder Änderung; 'theme' auch, wenn das Tablet Hell/Dunkel wechselt
export function onPrefsChange(fn) {
  listeners.add(fn);
}

export function applyTheme() {
  const root = document.documentElement;
  if (prefs.theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = prefs.theme;
  // Dem Browser sagen, welche Farben die Seite hat (Formularfelder, Scrollbalken)
  const meta = document.querySelector('meta[name="color-scheme"]');
  if (meta) meta.content = prefs.theme === 'auto' ? 'light dark' : prefs.theme === 'dark' ? 'dark' : 'only light';
  const a = ACCENTS[prefs.accent] || ACCENTS.blue;
  const dark = isDark();
  if (prefs.accent === 'blue') {
    for (const v of ['--accent', '--accent-soft', '--accent-grad']) root.style.removeProperty(v);
  } else {
    root.style.setProperty('--accent', dark ? a.dark : a.light);
    root.style.setProperty('--accent-soft', dark ? a.softDark : a.softLight);
    root.style.setProperty('--accent-grad', `linear-gradient(135deg, ${a.grad[0]}, ${a.grad[1]})`);
  }
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) m.content = dark ? '#16181d' : '#f5f7fb';
}

mq.addEventListener?.('change', () => {
  if (prefs.theme !== 'auto') return;
  applyTheme();
  for (const fn of listeners) fn('theme');
});

// Im Splitscreen: Änderung im anderen Fenster gleich übernehmen
window.addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  prefs = load();
  applyTheme();
  for (const fn of listeners) fn('all');
});

applyTheme();
