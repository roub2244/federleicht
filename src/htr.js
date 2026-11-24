// htr.js – Handschrift lesen mit dem eigenen, selbst trainierten Modell (offline)
//
// Warum nicht mehr nur Tesseract? Tesseract ist für gedruckte Schrift gebaut und verwechselt
// Handschrift leicht ("ist" -> "IU"). Unser Modell wurde mit ca. 300.000 Zeilen echter und
// nachgemachter Handschrift trainiert (Buchstaben von über 3.000 Menschen, 128 Handschrift-
// Schriften inkl. deutscher Schulschriften) und kennt dazu 79.000 deutsche Wörter.
//
// Ablauf pro Zeile: Striche geradegedreht und gleichmäßig dick als kleines Bild (40 Pixel hoch)
// malen -> Modell (im Hintergrund-Worker) -> jedes Wort mit dem Wörterbuch nachprüfen
// (htrdecode.js, rescore) -> Text. Trainiert wurde auch mit Robins echter Schrift, und die App
// lernt weiter dazu, wenn du im Fenster „Handschrift zu Text“ etwas verbesserst (htradapt.js).

import { getBlob, putBlob, deleteBlob } from './store.js';

const H = 40;
let worker = null;
let seq = 0;
const waiting = new Map();

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./htrworker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => {
      const p = waiting.get(e.data.id);
      if (!p) return;
      if (e.data.progress != null) return p.onProgress?.(e.data.progress);
      waiting.delete(e.data.id);
      e.data.ok ? p.resolve(e.data) : p.reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      for (const p of waiting.values()) p.reject(new Error(e.message || 'Worker-Fehler'));
      waiting.clear();
      worker = null;
    };
  }
  return worker;
}

function post(msg, transfer = [], onProgress = null) {
  const id = ++seq;
  const w = getWorker();
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject, onProgress });
    w.postMessage({ id, base: document.baseURI.replace(/[^/]*$/, ''), ...msg }, transfer);
  });
}

// Vor der ersten Frage an einen (neuen) Worker: deine gelernte Schrift mitgeben
let personalFor = null;
let personalP = null;
async function ask(msg, transfer = [], onProgress = null) {
  getWorker();
  if (personalFor !== worker) {
    personalFor = worker;
    personalP = sendPersonal();
  }
  await personalP;
  return post(msg, transfer, onProgress);
}

// ---------- Lernt deine Schrift ----------
// Gespeichert in der App-Datenbank (Schublade "blobs", Namen mit "sys-" werden nie aufgeräumt
// und kommen mit in die Sicherung):
//   sys-htr-samples: deine verbesserten Zeilen (Bild + richtiger Text) und deine eigenen Wörter
//   sys-htr-adapt:   die daraus gelernte letzte Modell-Schicht
const SAMPLES = 'sys-htr-samples';
const ADAPT = 'sys-htr-adapt';
const MAX_SAMPLES = 250;

async function readJSON(id) {
  try {
    const b = await getBlob(id);
    return b ? JSON.parse(await b.text()) : null;
  } catch {
    return null;
  }
}

async function sendPersonal() {
  try {
    const [data, ad] = await Promise.all([readJSON(SAMPLES), getBlob(ADAPT)]);
    let W = null, B = null;
    if (ad) {
      const all = new Float32Array(await ad.arrayBuffer());
      const nb = all[0] | 0;
      B = all.slice(1, 1 + nb);
      W = all.slice(1 + nb);
    }
    if (W || data?.words?.length) await post({ type: 'personal', W, B, words: data?.words || [] });
  } catch (err) {
    console.warn('Eigene Schrift konnte nicht geladen werden', err);
  }
}

// Wie viele Zeilen hat die App schon von dir gelernt?
export async function learnedLines() {
  return (await readJSON(SAMPLES))?.samples?.length || 0;
}

// Verbesserte Zeilen merken und daraus lernen (im Hintergrund).
// pairs: [{ img: { d, w }, text, changed }] – d: Float32Array 40*w
export async function learnFrom(pairs, onProgress) {
  pairs = pairs.filter((p) => p.img && p.text && p.text.trim());
  if (!pairs.some((p) => p.changed)) return null;
  const data = (await readJSON(SAMPLES)) || { samples: [], words: [] };
  const now = Date.now();
  for (const [i, p] of pairs.entries()) {
    const q = new Uint8Array(p.img.d.length);
    for (let i = 0; i < q.length; i++) q[i] = Math.round(p.img.d[i] * 255);
    data.samples.push({ w: p.img.w, text: p.text.trim(), img: bytesToB64(q), t: now + i });
  }
  if (data.samples.length > MAX_SAMPLES) data.samples = data.samples.slice(-MAX_SAMPLES);
  // eigene Wörter (Namen, Fachwörter): alles, was du selbst hingeschrieben hast
  const words = new Set(data.words);
  for (const p of pairs) if (p.changed) for (const w of p.text.match(/\p{L}{2,}/gu) || []) words.add(w);
  data.words = [...words].slice(-3000);
  await putBlob(SAMPLES, new Blob([JSON.stringify(data)], { type: 'application/json' }));
  const samples = data.samples.map((s) => {
    const q = b64ToBytes(s.img);
    const d = new Float32Array(q.length);
    for (let i = 0; i < q.length; i++) d[i] = q[i] / 255;
    return { img: d, w: s.w, h: H, text: s.text, key: `${s.t}:${s.text}` };
  });
  const r = await ask({ type: 'adapt', samples, words: data.words }, [], onProgress);
  if (r.W) {
    const all = new Float32Array(1 + r.B.length + r.W.length);
    all[0] = r.B.length;
    all.set(r.B, 1);
    all.set(r.W, 1 + r.B.length);
    await putBlob(ADAPT, new Blob([all.buffer], { type: 'application/octet-stream' }));
  }
  return { lines: data.samples.length, before: r.before, after: r.after };
}

// Alles Gelernte vergessen
export async function forgetLearned() {
  await deleteBlob(SAMPLES);
  await deleteBlob(ADAPT);
  if (worker) await post({ type: 'forget' });
}

function bytesToB64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(text) {
  const s = atob(text);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// Schon mal im Hintergrund laden (z. B. wenn "Zu Text" geöffnet wird)
export function warmUp() {
  return ask({}).catch(() => {});
}

// polys: Punktlisten (Seiten-Koordinaten, schon geradegedreht). Ergebnis: { text, alts, raw }
export async function recognizePolys(polys) {
  const img = renderInput(polys);
  if (!img) return { text: '', alts: [] };
  const keep = { d: img.d.slice(), w: img.w };
  const r = await ask({ img: img.d, w: img.w, h: H }, [img.d.buffer]);
  return { ...r, img: keep };
}

// Striche wie im Training malen: Tinte = 1, Hintergrund = 0, auf die Schrift zugeschnitten,
// 36 Pixel hoch (+2 Rand oben/unten), 4 Pixel Rand links/rechts
export function renderInput(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of polys) for (const [x, y] of pts) {
    minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
  }
  if (!Number.isFinite(minX)) return null;
  const inner = H - 4;
  const SS = 3; // erst 3x so groß malen, dann verkleinern (glatte Kanten)
  const lw = 2.3; // Strichdicke in Ziel-Pixeln
  const k = (inner - lw) / Math.max(1, maxY - minY);
  const w = Math.max(4, Math.min(1200, Math.round((maxX - minX) * k + lw)));
  const big = document.createElement('canvas');
  big.width = (w + 8) * SS;
  big.height = H * SS;
  const ctx = big.getContext('2d');
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, big.width, big.height);
  ctx.strokeStyle = '#fff';
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = lw * SS;
  const kk = Math.min(k, (1200 - lw) / Math.max(1, maxX - minX));
  const X = (x) => ((x - minX) * kk + 4 + lw / 2) * SS;
  const Y = (y) => ((y - minY) * kk + 2 + lw / 2) * SS;
  for (const pts of polys) {
    ctx.beginPath();
    ctx.moveTo(X(pts[0][0]), Y(pts[0][1]));
    if (pts.length === 1) ctx.lineTo(X(pts[0][0]) + 0.5, Y(pts[0][1]));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(X(pts[i][0]), Y(pts[i][1]));
    ctx.stroke();
  }
  const small = document.createElement('canvas');
  small.width = w + 8;
  small.height = H;
  const sctx = small.getContext('2d', { willReadFrequently: true });
  sctx.imageSmoothingQuality = 'high';
  sctx.drawImage(big, 0, 0, small.width, small.height);
  const px = sctx.getImageData(0, 0, small.width, H).data;
  const d = new Float32Array(small.width * H);
  for (let i = 0; i < d.length; i++) d[i] = px[i * 4] / 255;
  return { d, w: small.width };
}
