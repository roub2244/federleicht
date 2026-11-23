// pens.js – kleine Bilder der Stifte (als SVG gezeichnet)
//
// Die Stifte stehen senkrecht, die Spitze zeigt nach oben – wie in Samsung Notes.
// Der Teil, der die Farbe zeigt (Griff, Spitze, Borsten …), bekommt die gewählte Farbe.
// Der "runde" 3D-Eindruck kommt von einem Farbverlauf von links nach rechts:
// links etwas heller (Licht), rechts dunkler (Schatten).

let counter = 0; // damit jede Grafik eigene Verlaufs-Namen (ids) bekommt

// Farbe heller (amount > 0) oder dunkler (amount < 0) machen. amount von -1 bis 1.
export function shade(hex, amount) {
  const n = parseInt(hex.slice(1), 16);
  const channels = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
  );
  return '#' + channels.map((c) => c.toString(16).padStart(2, '0')).join('');
}

// Waagerechter Verlauf, der einen Zylinder rund aussehen lässt
function cylinder(id, color) {
  return `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="${shade(color, -0.25)}"/>
    <stop offset="0.28" stop-color="${shade(color, 0.35)}"/>
    <stop offset="0.55" stop-color="${color}"/>
    <stop offset="1" stop-color="${shade(color, -0.45)}"/>
  </linearGradient>`;
}

// Die einzelnen Stifte. ink = gewählte Farbe, g(name) = Verweis auf einen Verlauf
const DRAWINGS = {
  fountain: (g) => `
    <path d="M24 4C27 14 33 22 33 36H15C15 22 21 14 24 4Z" fill="${g('metal')}"/>
    <path d="M24 9V27" stroke="#5c4a1e" stroke-width="1.2" stroke-linecap="round"/>
    <circle cx="24" cy="28" r="1.8" fill="#5c4a1e"/>
    <rect x="15" y="36" width="18" height="24" rx="2" fill="${g('ink')}"/>
    <rect x="13" y="60" width="22" height="5" rx="1.5" fill="${g('metal')}"/>
    <rect x="13" y="65" width="22" height="90" rx="4" fill="${g('dark')}"/>`,

  ballpoint: (g) => `
    <path d="M24 5 31 32H17Z" fill="${g('silver')}"/>
    <circle cx="24" cy="6.5" r="1.6" fill="#333"/>
    <rect x="15" y="32" width="18" height="30" rx="3" fill="${g('ink')}"/>
    <rect x="14" y="62" width="20" height="93" rx="4" fill="${g('white')}"/>
    <rect x="30" y="72" width="5" height="50" rx="2.5" fill="${g('ink')}"/>`,

  felt: (g) => `
    <path d="M19 27V15Q24 1 29 15V27Z" fill="${g('ink')}"/>
    <path d="M15 42 19 27H29L33 42Z" fill="${g('silver')}"/>
    <rect x="13" y="42" width="22" height="22" rx="3" fill="${g('ink')}"/>
    <rect x="13" y="64" width="22" height="91" rx="4" fill="${g('white')}"/>
    <rect x="13" y="100" width="22" height="4" fill="${g('ink')}" opacity=".8"/>`,

  brush: (g) => `
    <path d="M24 2C30 16 33 30 31 46H17C15 30 18 16 24 2Z" fill="${g('ink')}"/>
    <path d="M17 46H31L32 66H16Z" fill="${g('silver')}"/>
    <path d="M16.5 52H31.5M16.8 58H31.2" stroke="#8a919e" stroke-width="1"/>
    <path d="M16 66H32L29.5 155H18.5Z" fill="${g('wood')}"/>`,

  highlighter: (g) => `
    <path d="M17 8 31 17V32H17Z" fill="${g('ink')}"/>
    <path d="M13 44 17 32H31L35 44Z" fill="${g('silver')}"/>
    <rect x="11" y="44" width="26" height="111" rx="6" fill="${g('marker')}"/>
    <rect x="11" y="44" width="26" height="22" rx="4" fill="${g('ink')}"/>
    <rect x="16" y="84" width="16" height="40" rx="3" fill="#fff" opacity=".55"/>`,
};

// SVG-Text für einen Stift. type: fountain | ballpoint | felt | brush | highlighter
export function penSVG(type, color) {
  const id = `pen${counter++}`;
  const colors = {
    ink: color,
    metal: '#d8b25c',
    silver: '#c3c8d2',
    dark: '#2b3040',
    white: '#f1f3f7',
    wood: '#c98d5a',
    marker: shade(color, 0.35),
  };
  const defs = Object.entries(colors)
    .map(([name, c]) => cylinder(`${id}-${name}`, c))
    .join('');
  const g = (name) => `url(#${id}-${name})`;
  return `<svg class="pen-art" viewBox="0 0 48 155" aria-hidden="true"><defs>${defs}</defs>${DRAWINGS[type](g)}</svg>`;
}
