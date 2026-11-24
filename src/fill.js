// fill.js – der Farbeimer: einen geschlossenen Bereich mit Farbe füllen (Etappe 8)
//
// So funktioniert es:
//   1. Die Seite wird unsichtbar auf ein Hilfs-Bild gemalt: alle Striche, Formen und Texte
//      sind "Wände". Auf Bildern und PDF-Arbeitsblättern zählt ein deutlicher Farbunterschied
//      als Wand (so kann man auch Kästchen auf einem Arbeitsblatt ausmalen).
//   2. Kleine Lücken in den Wänden werden zugemacht (die Wände werden etwas dicker gerechnet),
//      sonst läuft die Farbe bei jedem nicht ganz geschlossenen Kreis aus.
//   3. Von der angetippten Stelle aus breitet sich die Farbe aus, bis sie überall an eine Wand
//      stößt ("Flutfüllung"). Danach wächst sie ein kleines Stück unter die Striche, damit kein
//      weißer Spalt zwischen Strich und Farbe bleibt.
//   4. Aus dem Ergebnis wird ein Umriss (Vieleck) gemacht. Die Füllung ist dann ein ganz normales
//      Element auf der Seite: Lasso, Rückgängig, Export und Dunkelmodus funktionieren wie bei
//      Strichen. Sie liegt UNTER den Strichen, die sie umgeben – die Linien bleiben sichtbar.
//
//   { tool: 'fill', color, alpha, rings: [[x, y, x, y, ...], ...], z, box }
//     rings  ein oder mehrere Umrisse (Seiten-Einheiten). Innen-Umrisse sind Löcher
//            (z. B. ein Buchstabe mitten in der Fläche) – gemalt wird mit der "evenodd"-Regel.

import { PAGE_WIDTH, PAGE_HEIGHT } from './view.js';
import { fillStroke, finishStroke, inkTheme, setInkTheme } from './ink.js';
import { drawBackground, drawImageItem } from './media.js';
import { apply as applyMatrix } from './geometry.js';

// Pixel pro Seiten-Einheit beim Ausrechnen (2 = 2000 × 2828 Pixel für eine ganze Seite)
const RES = 1.5;
// So breite Lücken (Bildschirm-Pixel) werden noch als "geschlossen" behandelt.
// In Seiten-Einheiten umgerechnet und begrenzt (beim Rauszoomen nicht riesig).
const GAP_PX = 9;
const GAP_MIN = 3;
const GAP_MAX = 14;
// So weit wächst die Farbe unter die Striche (Seiten-Einheiten)
const UNDER = 0.9;
// Ab diesem Farbunterschied zählt ein Bild- oder PDF-Pixel als Wand (0 bis 765)
const IMAGE_TOLERANCE = 110;

// ---------- Ein Füll-Element ----------

export function createFill({ color, alpha = 1, rings, z }) {
  const item = { tool: 'fill', color, alpha, rings, z, box: null, path: null };
  updateFillBox(item);
  return item;
}

export function updateFillBox(item) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of item.rings) {
    for (let i = 0; i < r.length; i += 2) {
      if (r[i] < minX) minX = r[i];
      if (r[i] > maxX) maxX = r[i];
      if (r[i + 1] < minY) minY = r[i + 1];
      if (r[i + 1] > maxY) maxY = r[i + 1];
    }
  }
  item.box = minX <= maxX ? { minX, minY, maxX, maxY } : null;
  item.path = null;
  return item;
}

function pathOf(item) {
  if (item.path) return item.path;
  const path = new Path2D();
  for (const r of item.rings) {
    for (let i = 0; i < r.length; i += 2) {
      if (i === 0) path.moveTo(r[0], r[1]);
      else path.lineTo(r[i], r[i + 1]);
    }
    path.closePath();
  }
  item.path = path;
  return path;
}

export function drawFill(ctx, item, color) {
  ctx.save();
  ctx.globalAlpha = item.alpha ?? 1;
  ctx.fillStyle = color;
  ctx.fill(pathOf(item), 'evenodd');
  ctx.restore();
}

// Liegt (x, y) in der Füllung?
export function fillContains(item, x, y) {
  const b = item.box;
  if (!b || x < b.minX || x > b.maxX || y < b.minY || y > b.maxY) return false;
  let inside = false;
  for (const r of item.rings) {
    const n = r.length;
    for (let i = 0, j = n - 2; i < n; j = i, i += 2) {
      const xi = r[i], yi = r[i + 1], xj = r[j], yj = r[j + 1];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// Ein paar Punkte der Füllung (fürs Lasso: "liegt sie in der Schlinge?")
export function fillSamples(item) {
  const out = [];
  for (const r of item.rings) {
    const step = Math.max(2, Math.floor(r.length / 2 / 30)) * 2;
    for (let i = 0; i < r.length; i += step) out.push([r[i], r[i + 1]]);
  }
  return out;
}

export function transformFill(item, m) {
  const rings = item.rings.map((r) => {
    const out = new Array(r.length);
    for (let i = 0; i < r.length; i += 2) {
      const [x, y] = applyMatrix(m, [r[i], r[i + 1]]);
      out[i] = x;
      out[i + 1] = y;
    }
    return out;
  });
  const copy = { ...item, rings };
  delete copy.hidden;
  return updateFillBox(copy);
}

export function packFill(item) {
  return { tool: 'fill', color: item.color, alpha: item.alpha, z: item.z, rings: item.rings.map((r) => Float32Array.from(r)) };
}

export function reviveFill(d) {
  const rings = (d.rings || []).map((r) => Array.from(r)).filter((r) => r.length >= 6);
  return createFill({ color: d.color || '#000000', alpha: d.alpha ?? 1, rings, z: d.z || 0 });
}

// ---------- Den Bereich ausrechnen ----------

// Gibt die Umrisse des Bereichs um (x, y) zurück (Seiten-Einheiten der Seite) – oder
// { error } mit einem Hinweis, warum es nicht geht.
export function computeFill(page, x, y, scale = 1) {
  if (x < 0 || y < 0 || x >= PAGE_WIDTH || y >= PAGE_HEIGHT) return { error: 'outside' };
  const W = Math.round(PAGE_WIDTH * RES);
  const H = Math.round(PAGE_HEIGHT * RES);
  const N = W * H;

  // 1. Wände
  const wall = new Uint8Array(N);
  const items = page.strokes.filter((s) => s.box && !s.hidden);
  // Wände: Striche, Formen und Texte (Textmarker nicht – der liegt nur durchsichtig darüber)
  const ink = items.filter((s) => s.tool !== 'image' && s.tool !== 'fill' && s.tool !== 'highlighter');
  {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    const saved = { ...inkTheme };
    setInkTheme(false, '#ffffff');
    try {
      for (const s of ink) {
        // Die Füllung von Formen zählt nicht als Wand – nur ihr Rand
        if (s.tool === 'text') {
          fillStroke(ctx, s);
          continue;
        }
        if (!s.layers) finishStroke(s);
        fillStroke(ctx, s, { layers: s.layers });
      }
    } finally {
      setInkTheme(saved.dark, saved.paper);
    }
    const data = ctx.getImageData(0, 0, W, H).data;
    for (let i = 0; i < N; i++) if (data[i * 4 + 3] > 70) wall[i] = 1;
    canvas.width = canvas.height = 0;
  }
  const images = items.filter((s) => s.tool === 'image');
  if (page.bg || images.length) {
    const canvas = makeCanvas(W, H);
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(RES, 0, 0, RES, 0, 0);
    if (page.bg) drawBackground(ctx, page, false);
    for (const s of images) drawImageItem(ctx, s);
    const data = ctx.getImageData(0, 0, W, H).data;
    const si = (Math.floor(y * RES) * W + Math.floor(x * RES)) * 4;
    const r0 = data[si], g0 = data[si + 1], b0 = data[si + 2];
    for (let i = 0; i < N; i++) {
      const k = i * 4;
      if (Math.abs(data[k] - r0) + Math.abs(data[k + 1] - g0) + Math.abs(data[k + 2] - b0) > IMAGE_TOLERANCE) wall[i] = 1;
    }
    canvas.width = canvas.height = 0;
  }

  // 2. Lücken schließen: Abstand jedes Pixels zur nächsten Wand
  const dist = distanceToWall(wall, W, H);
  const gap = Math.min(GAP_MAX, Math.max(GAP_MIN, GAP_PX / scale));
  const gapPx = (gap / 2) * RES;
  let sx = Math.floor(x * RES);
  let sy = Math.floor(y * RES);
  if (wall[sy * W + sx]) return { error: 'wall' };
  if (dist[sy * W + sx] <= gapPx) {
    // Ganz nah an einer Linie angetippt: den nächsten freien Punkt suchen
    const found = nearestFree(dist, W, H, sx, sy, gapPx, Math.ceil(gapPx * 3));
    if (!found) return { error: 'wall' };
    [sx, sy] = found;
  }

  // 3. Ausbreiten
  const region = new Uint8Array(N);
  floodFill(region, (i) => dist[i] > gapPx, W, H, sx, sy);
  // Die Farbe wieder bis an die Linien heranwachsen lassen – auch in spitze Ecken hinein.
  // Damit sie dabei nicht durch eine (zugemachte) Lücke nach draußen kriecht, wachsen innen und
  // außen gleichzeitig: Jedes Pixel gehört zu dem, der zuerst ankommt. In der Lücke treffen sich
  // beide genau in der Mitte – wie eine unsichtbare Tür.
  growAgainstOthers(region, dist, wall, W, H, gapPx, Math.ceil(gapPx * 3) + 2);
  // ... und ein kleines Stück darunter, damit kein heller Spalt bleibt
  grow(region, W, H, Math.max(1, Math.round(UNDER * RES)), () => true);

  let count = 0;
  let touchesEdge = false;
  for (let i = 0; i < N; i++) if (region[i]) count++;
  for (let xx = 0; xx < W && !touchesEdge; xx++) if (region[xx] || region[(H - 1) * W + xx]) touchesEdge = true;
  for (let yy = 0; yy < H && !touchesEdge; yy++) if (region[yy * W] || region[yy * W + W - 1]) touchesEdge = true;

  // 4. Umriss
  let rings = traceRings(region, W, H).map((ring) => simplifyRing(ring, 0.7)).filter((r) => r.length >= 6);
  for (const r of rings) for (let i = 0; i < r.length; i++) r[i] /= RES;
  // Winzige Löcher und Krümel (z. B. mitten unter einem dicken Strich) weglassen – unsichtbar, kosten nur Zeit
  rings = rings.filter((r) => Math.abs(ringArea(r)) > 4);
  if (!rings.length) return { error: 'empty' };
  return { rings, area: count / (RES * RES), touchesEdge, whole: count > N * 0.6 };
}

function ringArea(r) {
  let a = 0;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j] + r[i]) * (r[j + 1] - r[i + 1]);
  return a / 2;
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Abstand (in Pixeln, ungefähr) jedes Pixels zur nächsten Wand – "Chamfer"-Verfahren in zwei Durchgängen
function distanceToWall(wall, W, H) {
  const INF = 1e6;
  const d = new Float32Array(W * H);
  for (let i = 0; i < d.length; i++) d[i] = wall[i] ? 0 : INF;
  const A = 1, B = Math.SQRT2;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x > 0) v = Math.min(v, d[i - 1] + A);
      if (y > 0) {
        v = Math.min(v, d[i - W] + A);
        if (x > 0) v = Math.min(v, d[i - W - 1] + B);
        if (x < W - 1) v = Math.min(v, d[i - W + 1] + B);
      }
      d[i] = v;
    }
  }
  for (let y = H - 1; y >= 0; y--) {
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      let v = d[i];
      if (v === 0) continue;
      if (x < W - 1) v = Math.min(v, d[i + 1] + A);
      if (y < H - 1) {
        v = Math.min(v, d[i + W] + A);
        if (x < W - 1) v = Math.min(v, d[i + W + 1] + B);
        if (x > 0) v = Math.min(v, d[i + W - 1] + B);
      }
      d[i] = v;
    }
  }
  return d;
}

function nearestFree(dist, W, H, sx, sy, gapPx, radius) {
  let best = null;
  let bestD = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const x = sx + dx, y = sy + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dd = dx * dx + dy * dy;
      if (dd < bestD && dist[y * W + x] > gapPx) {
        bestD = dd;
        best = [x, y];
      }
    }
  }
  return best;
}

// Flutfüllung Zeile für Zeile (schnell und ohne tiefe Rekursion)
function floodFill(region, free, W, H, sx, sy) {
  const stack = [sx, sy];
  while (stack.length) {
    const y = stack.pop();
    let x = stack.pop();
    let i = y * W + x;
    if (region[i] || !free(i)) continue;
    while (x > 0 && !region[i - 1] && free(i - 1)) {
      x--;
      i--;
    }
    let upOpen = false;
    let downOpen = false;
    while (x < W && !region[i] && free(i)) {
      region[i] = 1;
      if (y > 0) {
        const u = i - W;
        const ok = !region[u] && free(u);
        if (ok && !upOpen) stack.push(x, y - 1);
        upOpen = ok;
      }
      if (y < H - 1) {
        const dn = i + W;
        const ok = !region[dn] && free(dn);
        if (ok && !downOpen) stack.push(x, y + 1);
        downOpen = ok;
      }
      x++;
      i++;
    }
  }
}

// Innen (region = 1) und alles andere Freie wachsen gleichzeitig in den Streifen an den Linien
function growAgainstOthers(region, dist, wall, W, H, gapPx, steps) {
  const N = region.length;
  const label = new Uint8Array(N); // 1 = innen, 2 = andere Fläche, 0 = noch frei
  for (let i = 0; i < N; i++) {
    if (region[i]) label[i] = 1;
    else if (!wall[i] && dist[i] > gapPx) label[i] = 2;
  }
  let frontier = [];
  for (let i = 0; i < N; i++) {
    if (!label[i]) continue;
    const x = i % W;
    if ((x > 0 && !label[i - 1]) || (x < W - 1 && !label[i + 1]) || (i >= W && !label[i - W]) || (i < N - W && !label[i + W])) frontier.push(i);
  }
  for (let s = 0; s < steps && frontier.length; s++) {
    const next = [];
    for (const i of frontier) {
      const l = label[i];
      const x = i % W;
      const tryAdd = (j) => {
        if (!label[j] && !wall[j]) {
          label[j] = l;
          next.push(j);
        }
      };
      if (x > 0) tryAdd(i - 1);
      if (x < W - 1) tryAdd(i + 1);
      if (i >= W) tryAdd(i - W);
      if (i < N - W) tryAdd(i + W);
      if (s % 2) {
        // jeder zweite Schritt auch schräg – so wird die Ausbreitung ungefähr rund
        if (x > 0 && i >= W) tryAdd(i - W - 1);
        if (x < W - 1 && i >= W) tryAdd(i - W + 1);
        if (x > 0 && i < N - W) tryAdd(i + W - 1);
        if (x < W - 1 && i < N - W) tryAdd(i + W + 1);
      }
    }
    frontier = next;
  }
  for (let i = 0; i < N; i++) if (label[i] === 1) region[i] = 1;
}

// Den Bereich um bis zu "steps" Pixel wachsen lassen, aber nur in Pixel, für die allowed(i) gilt
function grow(region, W, H, steps, allowed) {
  let frontier = [];
  for (let i = 0; i < region.length; i++) {
    if (!region[i]) continue;
    const x = i % W;
    if ((x > 0 && !region[i - 1]) || (x < W - 1 && !region[i + 1]) || (i >= W && !region[i - W]) || (i < region.length - W && !region[i + W])) frontier.push(i);
  }
  for (let s = 0; s < steps && frontier.length; s++) {
    const next = [];
    for (const i of frontier) {
      const x = i % W;
      const tryAdd = (j) => {
        if (!region[j] && allowed(j)) {
          region[j] = 1;
          next.push(j);
        }
      };
      if (x > 0) tryAdd(i - 1);
      if (x < W - 1) tryAdd(i + 1);
      if (i >= W) tryAdd(i - W);
      if (i < region.length - W) tryAdd(i + W);
    }
    frontier = next;
  }
}

// Umrisse eines Pixel-Bereichs: entlang der Pixelkanten zwischen innen und außen laufen.
// Ergebnis: Liste von Umrissen, jeder als [x, y, x, y, ...] in Pixeln.
function traceRings(region, W, H) {
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && region[y * W + x] === 1;
  // Kanten so gerichtet, dass "innen" rechts liegt. Schlüssel: Startecke -> Liste von Endecken
  const VW = W + 1;
  const next = new Map();
  const add = (x0, y0, x1, y1) => {
    const k = y0 * VW + x0;
    const v = y1 * VW + x1;
    const list = next.get(k);
    if (list) list.push(v);
    else next.set(k, [v]);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!region[y * W + x]) continue;
      if (!inside(x, y - 1)) add(x, y, x + 1, y);         // oben: nach rechts
      if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1); // rechts: nach unten
      if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1); // unten: nach links
      if (!inside(x - 1, y)) add(x, y + 1, x, y);         // links: nach oben
    }
  }
  const rings = [];
  for (const [startKey, list] of next) {
    while (list.length) {
      const ring = [];
      let k = startKey;
      let prev = null;
      let guard = 0;
      do {
        const options = next.get(k);
        if (!options || !options.length) break;
        let pick = 0;
        if (options.length > 1 && prev !== null) {
          // An Stellen, wo sich zwei Pixel nur an der Ecke berühren: rechts abbiegen
          const px = prev % VW, py = (prev / VW) | 0, kx = k % VW, ky = (k / VW) | 0;
          const dx = kx - px, dy = ky - py;
          const want = (ky + dx) * VW + (kx - dy); // nach rechts gedreht
          const idx = options.indexOf(want);
          if (idx >= 0) pick = idx;
        }
        const v = options.splice(pick, 1)[0];
        ring.push(k % VW, (k / VW) | 0);
        prev = k;
        k = v;
      } while (k !== startKey && ++guard < 5e6);
      if (ring.length >= 6) rings.push(ring);
    }
  }
  return rings;
}

// Treppenstufen der Pixelkanten zu glatten Linien vereinfachen (Douglas-Peucker, ohne Rekursion)
function simplifyRing(ring, eps) {
  const n = ring.length / 2;
  if (n < 4) return ring;
  // Geschlossenen Umriss an zwei weit auseinanderliegenden Punkten aufteilen
  let far = 0, farD = -1;
  for (let i = 1; i < n; i++) {
    const d = (ring[i * 2] - ring[0]) ** 2 + (ring[i * 2 + 1] - ring[1]) ** 2;
    if (d > farD) {
      farD = d;
      far = i;
    }
  }
  const keep = new Uint8Array(n + 1);
  keep[0] = keep[far] = keep[n] = 1;
  const px = (i) => ring[(i % n) * 2];
  const py = (i) => ring[(i % n) * 2 + 1];
  const stack = [0, far, far, n];
  while (stack.length) {
    const b = stack.pop();
    const a = stack.pop();
    const ax = px(a), ay = py(a), bx = px(b), by = py(b);
    const dx = bx - ax, dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let maxD = -1, index = -1;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((px(i) - ax) * dy - (py(i) - ay) * dx) / len;
      if (d > maxD) {
        maxD = d;
        index = i;
      }
    }
    if (maxD > eps) {
      keep[index] = 1;
      stack.push(a, index, index, b);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(px(i), py(i));
  return out;
}
