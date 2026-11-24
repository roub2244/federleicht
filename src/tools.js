// tools.js – die Werkzeuge und ihre Einstellungen
//
// Alles, was du einstellst, steht in EINEM Objekt ("tools") und wird im Browser
// gespeichert (localStorage). Jede Stiftart merkt sich ihre eigene Farbe und Dicke.

// Die Stiftarten in der Reihenfolge, wie sie im Stifthalter stehen
export const PEN_TYPES = [
  { id: 'ballpoint', name: 'Kugelschreiber' },
  { id: 'fountain', name: 'Füller' },
  { id: 'felt', name: 'Filzstift' },
  { id: 'brush', name: 'Pinsel' },
];

// Farb-Seiten (wie in Samsung Notes: Punkte unter der Farbreihe wechseln die Seite)
export const COLOR_PAGES = [
  // Grundfarben – inkl. Weiß und Schwarz
  ['#000000', '#ffffff', '#e03131', '#f08c00', '#fab005', '#2f9e44', '#1971c2', '#7048e8'],
  // Tinten-Töne
  ['#1f2a44', '#495057', '#868e96', '#c2255c', '#0c8599', '#5c940d', '#8d5524', '#e8590c'],
  // Pastell
  ['#ffa8a8', '#ffd8a8', '#ffec99', '#b2f2bb', '#a5d8ff', '#d0bfff', '#fcc2d7', '#dee2e6'],
];

export const HIGHLIGHTER_COLORS = [
  '#ffd400', // Gelb
  '#51cf66', // Grün
  '#f06595', // Pink
  '#339af0', // Blau
  '#ff922b', // Orange
  '#9775fa', // Violett
  '#ff6b6b', // Rot
  '#20c997', // Türkis
];

// Dicke: kleinster und größter Wert (in Seiten-Einheiten, die Seite ist 1000 breit)
export const SIZE_RANGE = {
  ballpoint: { min: 0.8, max: 6 },
  fountain: { min: 1.5, max: 10 },
  felt: { min: 2.5, max: 16 },
  brush: { min: 4, max: 32 },
  highlighter: { min: 8, max: 44 },
  shape: { min: 0.8, max: 12 },
  laser: { min: 2, max: 24 }, // Bildschirm-Pixel (Breite des Leuchtstrahls)
  eraser: { min: 6, max: 50 }, // Bildschirm-Pixel (Radius)
};

// Laserpointer: kräftige, leuchtende Farben
export const LASER_COLORS = ['#ff2d55', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#0a84ff', '#bf5af2', '#ffffff'];

// Wie lange die Laser-Spur nach dem Abheben stehen bleibt, bevor sie verblasst (Sekunden)
export const LASER_DURATIONS = [
  { value: 0.5, name: 'Kurz' },
  { value: 1.5, name: 'Mittel' },
  { value: 4, name: 'Lang' },
];

export const MAX_FAVORITES = 5;
const MAX_RECENT = 8;

const DEFAULTS = {
  tool: 'pen',            // 'pen' | 'highlighter' | 'eraser' | 'text' | 'shape' | 'lasso' | 'fill' | 'laser'
  penType: 'ballpoint',   // Kuli ist der Standard-Stift
  pens: {
    ballpoint: { color: '#000000', size: 1.8 },
    fountain: { color: '#1f2a44', size: 3.6 },
    felt: { color: '#1971c2', size: 6 },
    brush: { color: '#e03131', size: 12 },
  },
  highlighter: { color: '#ffd400', size: 20, opacity: 0.45 },
  eraser: { mode: 'stroke', size: 12, onlyHighlighter: false },
  text: { f: 'sans', s: 22.4, c: '#000000' },
  shape: { kind: 'rect', color: '#1971c2', size: 2.4, fill: 'none' }, // Formen-Werkzeug (siehe shapes.js)
  fill: { color: '#fab005', alpha: 1 },  // Farbeimer (siehe fill.js)
  laser: { color: '#ff2d55', size: 7, mode: 'trail', duration: 1.5 }, // Laserpointer (siehe laser.js): 'trail' = Spur, 'dot' = nur Punkt
  lasso: { mode: 'free', what: 'all' },  // Lasso: Freihand oder Rechteck; alles, nur Handschrift oder nur Text // Schrift für neue Textfelder (s in Seiten-Einheiten, 22,4 = 14 pt)
  straighten: true,       // gerade Linien durch Stillhalten am Strichende
  assist: false,          // Handschrifthilfe: Zeilen geraderücken, Hilfslinie (siehe assist.js)
  recent: [],             // zuletzt benutzte eigene Farben
  favorites: [],          // Lieblingsstifte: { type, color, size, opacity? }
};

const KEY = 'federleicht.tools.v2';
export const TOOL_IDS = ['pen', 'highlighter', 'eraser', 'text', 'shape', 'lasso', 'fill', 'laser'];

// Gespeicherte Einstellungen laden. Fehlt etwas (z. B. nach einem Update), nehmen wir den Standard.
export function loadTools() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    /* nichts gespeichert oder kaputt -> Standard */
  }
  const pens = {};
  for (const { id } of PEN_TYPES) pens[id] = { ...DEFAULTS.pens[id], ...saved.pens?.[id] };
  return {
    ...DEFAULTS,
    ...saved,
    tool: TOOL_IDS.includes(saved.tool) ? saved.tool : DEFAULTS.tool,
    penType: pens[saved.penType] ? saved.penType : DEFAULTS.penType,
    pens,
    highlighter: { ...DEFAULTS.highlighter, ...saved.highlighter },
    eraser: { ...DEFAULTS.eraser, ...saved.eraser },
    text: { ...DEFAULTS.text, ...saved.text },
    shape: { ...DEFAULTS.shape, ...saved.shape },
    lasso: { ...DEFAULTS.lasso, ...saved.lasso },
    fill: { ...DEFAULTS.fill, ...saved.fill },
    laser: { ...DEFAULTS.laser, ...saved.laser },
    recent: Array.isArray(saved.recent) ? saved.recent : [],
    favorites: Array.isArray(saved.favorites) ? saved.favorites : [],
  };
}

export function saveTools(tools) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tools));
  } catch {
    /* egal – dann eben nicht gemerkt */
  }
}

// Die Einstellungen des gerade benutzten Stifts (Stiftart oder Textmarker).
// Ist der Radierer an, nehmen wir den Stift, den man davor hatte.
export function activeStyle(tools) {
  if (tools.tool === 'highlighter') return { type: 'highlighter', ...tools.highlighter };
  return { type: tools.penType, ...tools.pens[tools.penType] };
}

// Das Einstellungs-Objekt zu einer Stiftart ('highlighter' oder eine aus PEN_TYPES)
export function settingsOf(tools, type) {
  if (type === 'shape') return tools.shape;
  if (type === 'fill') return tools.fill;
  if (type === 'laser') return tools.laser;
  return type === 'highlighter' ? tools.highlighter : tools.pens[type];
}

// Eine eigene Farbe vorne in "Zuletzt" aufnehmen (ohne Doppelte)
export function rememberColor(tools, color) {
  tools.recent = [color, ...tools.recent.filter((c) => c !== color)].slice(0, MAX_RECENT);
}

// Ist dieser Favorit genau der Stift, der gerade eingestellt ist?
export function isActiveFavorite(tools, fav) {
  if (!['pen', 'highlighter'].includes(tools.tool)) return false;
  const s = activeStyle(tools);
  return fav.type === s.type && fav.color === s.color && Math.abs(fav.size - s.size) < 0.01;
}
