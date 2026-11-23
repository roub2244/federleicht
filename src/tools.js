// tools.js – die Werkzeuge und ihre Einstellungen
//
// Alles, was du in der Werkzeugleiste einstellst, steht in EINEM Objekt ("tools").
// Es wird im Browser gespeichert (localStorage), damit beim nächsten Öffnen
// wieder dein Lieblingsstift ausgewählt ist.

export const PEN_COLORS = [
  '#1f2a44', // Tinte (dunkelblau)
  '#000000', // Schwarz
  '#868e96', // Grau
  '#e03131', // Rot
  '#f76707', // Orange
  '#2f9e44', // Grün
  '#1971c2', // Blau
  '#6741d9', // Violett
  '#c2255c', // Pink
  '#8d5524', // Braun
];

export const HIGHLIGHTER_COLORS = [
  '#ffe066', // Gelb
  '#8ce99a', // Grün
  '#74c0fc', // Blau
  '#faa2c1', // Pink
  '#ffc078', // Orange
  '#b197fc', // Violett
];

export const PEN_TYPES = [
  { id: 'fountain', name: 'Füller' },
  { id: 'ballpoint', name: 'Kugelschreiber' },
  { id: 'felt', name: 'Filzstift' },
  { id: 'brush', name: 'Pinsel' },
];

// Grenzen für die Schieberegler
export const SIZE_RANGE = {
  pen: { min: 1, max: 14, step: 0.2 },        // Seiten-Einheiten (Seite ist 1000 breit)
  highlighter: { min: 8, max: 40, step: 1 },
  eraser: { min: 6, max: 50, step: 1 },       // Bildschirm-Pixel (Radius)
};

const DEFAULTS = {
  tool: 'pen', // 'pen' | 'highlighter' | 'eraser'
  pen: { type: 'fountain', color: '#1f2a44', size: 3.2, recent: [] },
  highlighter: { color: '#ffe066', size: 18, recent: [] },
  eraser: { mode: 'stroke', size: 12 }, // mode: 'stroke' (ganzer Strich) | 'area' (Bereich)
};

const KEY = 'federleicht.tools';

// Gespeicherte Einstellungen laden. Fehlt etwas (z. B. nach einem Update), nehmen wir den Standard.
export function loadTools() {
  let saved = {};
  try {
    saved = JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    /* nichts gespeichert oder kaputt -> Standard */
  }
  return {
    tool: ['pen', 'highlighter', 'eraser'].includes(saved.tool) ? saved.tool : DEFAULTS.tool,
    pen: { ...DEFAULTS.pen, ...saved.pen },
    highlighter: { ...DEFAULTS.highlighter, ...saved.highlighter },
    eraser: { ...DEFAULTS.eraser, ...saved.eraser },
  };
}

export function saveTools(tools) {
  try {
    localStorage.setItem(KEY, JSON.stringify(tools));
  } catch {
    /* egal – dann eben nicht gemerkt */
  }
}
