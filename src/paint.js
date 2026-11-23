// paint.js – Farbflächen, die immer echt aussehen
//
// Samsung Internet hat einen eigenen Dunkelmodus: Er dunkelt Webseiten selbst ab,
// auch wenn sie schon dunkel sind. Dabei werden unsere Farbpunkte matschig
// (Weiß wird Grau, Rot wird Braun, Schwarz wird sogar Weiß).
// Was auf einem <canvas> gemalt ist, lässt er aber in Ruhe – das Blatt sieht ja richtig aus.
// Darum malen wir jede Farbfläche auf ein kleines Canvas.
//
// Benutzung: paint('#ff0000') liefert HTML für so ein Canvas. Es füllt sein Elternelement
// (das braucht position: relative). Ändert man data-c, wird automatisch neu gemalt.
//   data-paint="rainbow"  Regenbogen-Kreis
//   data-paint="hue"      Farbton-Balken von Rot bis Rot
//   data-paint="field"    Feld für Sättigung/Helligkeit, data-hue = Farbton
//   data-paint="checker"  Schachbrett, darüber Verlauf zu data-c (Deckkraft-Regler)
//   data-paint="check"    Farbe data-c mit Häkchen (ausgewählte Farbe)

import { isLight } from './pens.js';

export function paint(color = '', kind = '', extra = '') {
  const c = color ? ` data-c="${color}"` : '';
  const k = kind ? ` data-paint="${kind}"` : '';
  return `<canvas class="paint" width="1" height="1"${c}${k}${extra} aria-hidden="true"></canvas>`;
}

// Wie groß das Canvas intern ist (gestreckt wird es per CSS)
function sizeOf(canvas, kind) {
  if (kind === 'rainbow') return [64, 64];
  if (kind === 'hue') return [360, 1];
  if (kind === 'field') return [128, 128];
  if (kind === 'check') return [64, 64];
  if (kind === 'checker') {
    const dpr = window.devicePixelRatio || 1;
    return [Math.round((canvas.clientWidth || 240) * dpr), Math.round((canvas.clientHeight || 34) * dpr)];
  }
  return [1, 1];
}

export function draw(canvas) {
  const kind = canvas.dataset.paint || '';
  const color = canvas.dataset.c;
  const [w, h] = sizeOf(canvas, kind);
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, w, h);

  if (kind === 'rainbow') {
    const g = ctx.createConicGradient(-Math.PI / 2, w / 2, h / 2);
    ['#ff4d4d', '#ffb31a', '#ffe14d', '#4dd964', '#4dc3ff', '#5a6bff', '#c04dff', '#ff4d4d'].forEach((c, i, a) =>
      g.addColorStop(i / (a.length - 1), c)
    );
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // weiße Mitte
    const r = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w * 0.3);
    r.addColorStop(0, '#fff');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = r;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'hue') {
    const g = ctx.createLinearGradient(0, 0, w, 0);
    ['#f00', '#ff0', '#0f0', '#0ff', '#00f', '#f0f', '#f00'].forEach((c, i, a) => g.addColorStop(i / (a.length - 1), c));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'field') {
    const hue = Number(canvas.dataset.hue) || 0;
    const across = ctx.createLinearGradient(0, 0, w, 0);
    across.addColorStop(0, '#fff');
    across.addColorStop(1, `hsl(${hue} 100% 50%)`);
    ctx.fillStyle = across;
    ctx.fillRect(0, 0, w, h);
    const down = ctx.createLinearGradient(0, 0, 0, h);
    down.addColorStop(0, 'rgba(0,0,0,0)');
    down.addColorStop(1, '#000');
    ctx.fillStyle = down;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (kind === 'checker') {
    const cell = Math.max(4, Math.round(h / 4));
    for (let y = 0; y < h; y += cell) {
      for (let x = 0; x < w; x += cell) {
        ctx.fillStyle = ((x + y) / cell) % 2 ? '#c9cdd4' : '#8a8f99';
        ctx.fillRect(x, y, cell, cell);
      }
    }
    const g = ctx.createLinearGradient(0, 0, w, 0);
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, color || '#ffd400');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    return;
  }
  if (color) {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
  }
  if (kind === 'check') {
    ctx.strokeStyle = color && color.startsWith('#') && isLight(color) ? '#222' : '#fff';
    ctx.lineWidth = 6;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(20, 33);
    ctx.lineTo(28, 41);
    ctx.lineTo(45, 23);
    ctx.stroke();
  }
}

// Neue Farb-Canvas oder geänderte Farben automatisch malen
const observer = new MutationObserver((list) => {
  for (const m of list) {
    if (m.type === 'attributes') {
      if (m.target.matches?.('canvas.paint')) draw(m.target);
      continue;
    }
    for (const node of m.addedNodes) {
      if (node.nodeType !== 1) continue;
      if (node.matches('canvas.paint')) draw(node);
      for (const c of node.querySelectorAll('canvas.paint')) draw(c);
    }
  }
});
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  attributeFilter: ['data-c', 'data-hue'],
});
for (const c of document.querySelectorAll('canvas.paint')) draw(c);
