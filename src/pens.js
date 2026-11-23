// pens.js – kleine Bilder der Stifte (als SVG gezeichnet)
//
// Die Stifte stehen senkrecht, die Spitze zeigt nach oben – wie in einem Stifthalter.
// Gehäuse in dunklem Grafit, die Teile, die die Farbe zeigen (Spitze, Ring, Borsten),
// bekommen die eingestellte Farbe.
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

// Ist die Farbe hell? (dann brauchen helle Teile einen dunklen Rand)
export function isLight(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lum = 0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255);
  return lum > 200;
}

// Waagerechter Verlauf, der einen Zylinder rund aussehen lässt
function cylinder(id, color) {
  return `<linearGradient id="${id}" x1="0" x2="1" y1="0" y2="0">
    <stop offset="0" stop-color="${shade(color, -0.3)}"/>
    <stop offset="0.3" stop-color="${shade(color, 0.32)}"/>
    <stop offset="0.55" stop-color="${color}"/>
    <stop offset="1" stop-color="${shade(color, -0.5)}"/>
  </linearGradient>`;
}

// Die einzelnen Stifte. g(name) = Verweis auf einen Verlauf
const DRAWINGS = {
  ballpoint: (g) => `
    <path d="M24 5 30.5 36H17.5Z" fill="${g('silver')}"/>
    <circle cx="24" cy="6" r="2.2" fill="${g('ink')}"/>
    <rect x="15" y="36" width="18" height="26" rx="3" fill="${g('grip')}"/>
    <rect x="14" y="62" width="20" height="10" fill="${g('ink')}"/>
    <rect x="14" y="72" width="20" height="83" rx="3" fill="${g('body')}"/>`,

  fountain: (g) => `
    <path d="M24 3C27.5 13 33 22 33 38H15C15 22 20.5 13 24 3Z" fill="${g('silver')}"/>
    <path d="M24 8V28" stroke="#3b3f47" stroke-width="1.3" stroke-linecap="round"/>
    <circle cx="24" cy="29" r="2" fill="#3b3f47"/>
    <rect x="15" y="38" width="18" height="22" rx="2" fill="${g('grip')}"/>
    <rect x="13" y="60" width="22" height="7" rx="1.5" fill="${g('ink')}"/>
    <rect x="13" y="67" width="22" height="88" rx="4" fill="${g('body')}"/>`,

  felt: (g) => `
    <path d="M19.5 28V15Q24 2 28.5 15V28Z" fill="${g('ink')}"/>
    <path d="M15 42 19 28H29L33 42Z" fill="${g('silver')}"/>
    <rect x="13" y="42" width="22" height="12" rx="2" fill="${g('ink')}"/>
    <rect x="13" y="54" width="22" height="101" rx="4" fill="${g('body')}"/>`,

  brush: (g) => `
    <path d="M24 2C30 15 33 30 31 46H17C15 30 18 15 24 2Z" fill="${g('ink')}"/>
    <path d="M17 46H31L32 66H16Z" fill="${g('silver')}"/>
    <path d="M16.5 52H31.5M16.8 58H31.2" stroke="#7c828d" stroke-width="1"/>
    <path d="M16 66H32L30 155H18Z" fill="${g('body')}"/>
    <rect x="16.4" y="74" width="15.2" height="6" fill="${g('ink')}"/>`,

  highlighter: (g) => `
    <path d="M16.5 8 31.5 18V32H16.5Z" fill="${g('ink')}"/>
    <path d="M12 46 16 32H32L36 46Z" fill="${g('grip')}"/>
    <rect x="10" y="46" width="28" height="109" rx="5" fill="${g('marker')}"/>
    <rect x="10" y="46" width="28" height="6" fill="${g('ink')}" opacity=".9"/>`,
};

// SVG-Text für einen Stift. type: ballpoint | fountain | felt | brush | highlighter
export function penSVG(type, color) {
  const id = `pen${counter++}`;
  // Ganz helle Farben (z. B. Weiß) bekommen einen dunklen Rand, sonst sieht man sie nicht
  const outline = isLight(color) ? ` stroke="#9aa0aa" stroke-width="0.8"` : '';
  const colors = {
    ink: color,
    silver: '#c9ced6',
    grip: '#2e3138',
    body: '#43474f',
    marker: shade(color, -0.15),
  };
  const defs = Object.entries(colors)
    .map(([name, c]) => cylinder(`${id}-${name}`, c))
    .join('');
  const g = (name) => `url(#${id}-${name})`;
  return `<svg class="pen-art" viewBox="0 0 48 155" aria-hidden="true"><defs>${defs}</defs><g${outline}>${DRAWINGS[type](g)}</g></svg>`;
}
