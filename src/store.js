// store.js – der Speicher der App (IndexedDB)
//
// IndexedDB ist eine kleine Datenbank, die der Browser für jede Web-App mitbringt.
// Sie bleibt erhalten, wenn du die App schließt, das Tablet neu startest oder offline bist.
// (Weg ist sie nur, wenn du die App deinstallierst oder die Website-Daten löschst –
//  dafür gibt es die Sicherung, siehe exportAll/importAll.)
//
// Wir haben drei "Schubladen" (Object Stores):
//   notes    eine Zeile pro Notiz: Titel, Ordner, Datum, Reihenfolge der Seiten, Vorschaubild
//   pages    eine Zeile pro Seite: Vorlage und alle Striche
//   folders  eine Zeile pro Ordner: Name und Farbe
//   blobs    Dateien: eingefügte Bilder, PDF-Dateien und die gemalten PDF-Seiten (Etappe 7)
//
// Warum Seiten extra? Wenn du auf Seite 7 schreibst, speichern wir nur Seite 7 neu –
// nicht die ganze Notiz. Das geht auch bei dicken Heften schnell.
//
// Striche speichern wir platzsparend: Die Punkte [x, y, druck] kommen hintereinander
// in ein Float32Array (eine Liste von Kommazahlen mit je 4 Byte).

import { finishStroke } from './ink.js';
import { packText, reviveText } from './text.js';
import { packImage, reviveImage } from './media.js';
import { packFill, reviveFill } from './fill.js';

const DB_NAME = 'federleicht';
const DB_VERSION = 2; // 2: Schublade "blobs" für Bilder und PDFs

let dbPromise = null;

// Datenbank öffnen (beim ersten Mal werden die Schubladen angelegt)
export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) db.createObjectStore('pages', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('folders')) db.createObjectStore('folders', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs', { keyPath: 'id' });
    };
    req.onsuccess = () => {
      const db = req.result;
      // Eine neuere Version der App will die Datenbank umbauen -> loslassen
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('Datenbank ist noch in einem anderen Fenster offen');
  });
  // Den Browser bitten, unsere Daten nie von selbst zu löschen (z. B. wenn der Speicher knapp wird)
  navigator.storage?.persist?.().catch(() => {});
  return dbPromise;
}

// Kleiner Helfer: aus einer IndexedDB-Anfrage ein Promise machen
const done = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const finished = (tx) =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('abgebrochen'));
  });

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

// ---------- Notizen ----------

export async function getAllNotes() {
  return done((await store('notes')).getAll());
}

export async function getNote(id) {
  return (await done((await store('notes')).get(id))) || null;
}

export async function putNote(note) {
  const db = await openDB();
  const tx = db.transaction('notes', 'readwrite');
  tx.objectStore('notes').put(note);
  return finished(tx);
}

// Seiten einer Notiz laden (in der richtigen Reihenfolge, fehlende werden übersprungen)
export async function getPages(ids) {
  const db = await openDB();
  const tx = db.transaction('pages');
  const s = tx.objectStore('pages');
  const pages = await Promise.all(ids.map((id) => done(s.get(id))));
  return pages.filter(Boolean);
}

// Alles zu einer Notiz in EINEM Rutsch speichern ("Transaktion"):
// Entweder klappt alles oder gar nichts – es kann keine halbe Notiz entstehen.
export async function saveNote(note, pages, removedPageIds = []) {
  const db = await openDB();
  const tx = db.transaction(['notes', 'pages'], 'readwrite');
  const ps = tx.objectStore('pages');
  for (const p of pages) ps.put(p);
  for (const id of removedPageIds) ps.delete(id);
  tx.objectStore('notes').put(note);
  return finished(tx);
}

// Notiz endgültig löschen (mit allen Seiten)
export async function deleteNoteForever(note) {
  const db = await openDB();
  const tx = db.transaction(['notes', 'pages'], 'readwrite');
  const ps = tx.objectStore('pages');
  for (const id of note.pageIds) ps.delete(id);
  tx.objectStore('notes').delete(note.id);
  return finished(tx);
}

// ---------- Dateien (Bilder, PDFs) ----------
// Eine Zeile pro Datei: { id, blob, type, size, created }

export async function putBlob(id, blob) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').put({ id, blob, type: blob.type, size: blob.size, created: Date.now() });
  return finished(tx);
}

export async function getBlob(id) {
  const row = await done((await store('blobs')).get(id));
  return row?.blob || null;
}

export async function deleteBlob(id) {
  const db = await openDB();
  const tx = db.transaction('blobs', 'readwrite');
  tx.objectStore('blobs').delete(id);
  return finished(tx);
}

// Dateien aufräumen, die keine Notiz mehr braucht (auch nicht im Papierkorb).
// Jede Notiz merkt sich ihre Dateien in note.blobIds (siehe main.js, writeNote).
export async function cleanupBlobs() {
  const db = await openDB();
  const tx = db.transaction(['notes', 'blobs'], 'readwrite');
  const notes = await done(tx.objectStore('notes').getAll());
  const keep = new Set(notes.flatMap((n) => n.blobIds || []));
  const blobs = tx.objectStore('blobs');
  const ids = await done(blobs.getAllKeys());
  // "sys-…" gehört der App selbst (z. B. deine gelernte Handschrift), nie aufräumen
  const gone = ids.filter((id) => !keep.has(id) && !String(id).startsWith('sys-'));
  for (const id of gone) blobs.delete(id);
  await finished(tx);
  return gone.length;
}

// ---------- Ordner ----------

export async function getAllFolders() {
  return done((await store('folders')).getAll());
}

export async function putFolder(folder) {
  const db = await openDB();
  const tx = db.transaction('folders', 'readwrite');
  tx.objectStore('folders').put(folder);
  return finished(tx);
}

export async function deleteFolder(id) {
  const db = await openDB();
  const tx = db.transaction(['folders', 'notes'], 'readwrite');
  tx.objectStore('folders').delete(id);
  // Notizen aus dem Ordner landen in "Ohne Ordner" – es geht nichts verloren
  const notes = tx.objectStore('notes');
  const all = await done(notes.getAll());
  for (const n of all) {
    if (n.folderId === id) notes.put({ ...n, folderId: null });
  }
  return finished(tx);
}

// ---------- Striche ein- und auspacken ----------

const packCache = new WeakMap(); // fertige Striche ändern sich nie -> nur einmal einpacken

export function packStroke(s) {
  let packed = packCache.get(s);
  if (packed) return packed;
  if (s.tool === 'text' || s.tool === 'image' || s.tool === 'fill') {
    packed = s.tool === 'text' ? packText(s) : s.tool === 'image' ? packImage(s) : packFill(s);
    packCache.set(s, packed);
    return packed;
  }
  const pts = new Float32Array(s.points.length * 3);
  s.points.forEach((p, i) => {
    pts[i * 3] = p[0];
    pts[i * 3 + 1] = p[1];
    pts[i * 3 + 2] = p[2] ?? 0.5;
  });
  packed = {
    tool: s.tool,
    penType: s.penType,
    color: s.color,
    size: s.size,
    opacity: s.opacity,
    simulatePressure: Boolean(s.simulatePressure),
    z: s.z,
    pts,
    box: s.box,
  };
  // Formen (Etappe 6): nur speichern, was es gibt – alte Striche bleiben so klein wie vorher
  if (s.shape) packed.shape = s.shape;
  if (s.v) packed.v = s.v; // Strich-Version (siehe ink.js STROKE_VERSION)
  if (s.rec) packed.rec = s.rec; // Sprachaufnahme: [Aufnahme, Start-ms, Ende-ms]
  if (s.fill && s.fillAlpha > 0) {
    packed.fill = s.fill;
    packed.fillAlpha = s.fillAlpha;
  }
  packCache.set(s, packed);
  return packed;
}

// Ausgepackter Strich: Die fertige Form (layers) berechnet ink.js erst, wenn er gemalt wird.
// So öffnet sich auch ein volles Heft schnell.
export function unpackStroke(d) {
  if (d.tool === 'text') return reviveText(d);
  if (d.tool === 'image') return reviveImage(d);
  if (d.tool === 'fill') return reviveFill(d);
  const pts = d.pts instanceof Float32Array ? d.pts : Float32Array.from(d.pts || []);
  const points = [];
  for (let i = 0; i + 2 < pts.length; i += 3) points.push([pts[i], pts[i + 1], pts[i + 2]]);
  const stroke = {
    tool: d.tool || 'pen',
    penType: d.penType || 'ballpoint',
    color: d.color || '#000000',
    size: d.size || 2,
    opacity: d.opacity ?? 1,
    simulatePressure: Boolean(d.simulatePressure),
    z: d.z || 0,
    points,
    layers: null,
    box: d.box || null,
    shape: d.shape || null,
    fill: d.fill || null,
    fillAlpha: d.fillAlpha || 0,
  };
  if (d.rec) stroke.rec = d.rec;
  if (d.v) stroke.v = d.v;
  if (!stroke.box && points.length) finishStroke(stroke); // ohne Rechteck würde er nie gemalt
  // Die gespeicherte Form ist schon "eingepackt" -> beim nächsten Speichern wiederverwenden
  if (d.pts instanceof Float32Array) packCache.set(stroke, d);
  return stroke;
}

export function packPage(page, noteId) {
  const packed = { id: page.id, noteId, template: { ...page.template }, strokes: page.strokes.map(packStroke) };
  if (page.bg) packed.bg = { ...page.bg }; // PDF-Hintergrund
  return packed;
}

export function unpackPage(d) {
  const page = { id: d.id, template: { ...d.template }, strokes: (d.strokes || []).map(unpackStroke) };
  if (d.bg?.blobId && d.bg.w > 0 && d.bg.h > 0) page.bg = { ...d.bg };
  return page;
}

// ---------- Sicherung (Datei) ----------
// Alles in eine Datei: Ordner, Notizen, Seiten. Die Punkte als Base64-Text (kompakt).

function bytesToBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function base64ToBytes(text) {
  const s = atob(text);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
}

function toBase64(f32) {
  return bytesToBase64(new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength));
}

function fromBase64(text) {
  return new Float32Array(base64ToBytes(text).buffer);
}

export async function exportAll() {
  const db = await openDB();
  const tx = db.transaction(['notes', 'pages', 'folders', 'blobs']);
  const [notes, pages, folders, blobs] = await Promise.all([
    done(tx.objectStore('notes').getAll()),
    done(tx.objectStore('pages').getAll()),
    done(tx.objectStore('folders').getAll()),
    done(tx.objectStore('blobs').getAll()),
  ]);
  // Bilder und PDFs als Text (Base64) mit in die Datei
  const files = [];
  for (const b of blobs) {
    files.push({ id: b.id, type: b.blob.type, data: bytesToBase64(new Uint8Array(await b.blob.arrayBuffer())) });
  }
  return {
    app: 'federleicht',
    version: 2,
    files,
    exported: new Date().toISOString(),
    folders,
    // Vorschaubilder lassen wir weg, die malt die App beim nächsten Öffnen neu
    notes: notes.map(({ thumbLight, thumbDark, ...n }) => n),
    pages: pages.map((p) => ({ ...p, strokes: p.strokes.map((s) => (s.pts ? { ...s, pts: toBase64(s.pts) } : s)) })),
  };
}

// Sicherung einlesen. Vorhandenes bleibt, gleiche Notizen werden durch die Sicherung ersetzt.
export async function importAll(data) {
  if (!data || data.app !== 'federleicht' || !Array.isArray(data.notes)) throw new Error('Keine Federleicht-Sicherung');
  const db = await openDB();
  const tx = db.transaction(['notes', 'pages', 'folders', 'blobs'], 'readwrite');
  for (const f of data.files || []) {
    const blob = new Blob([base64ToBytes(f.data)], { type: f.type || '' });
    tx.objectStore('blobs').put({ id: f.id, blob, type: blob.type, size: blob.size, created: Date.now() });
  }
  for (const f of data.folders || []) tx.objectStore('folders').put(f);
  for (const n of data.notes) tx.objectStore('notes').put({ ...n, thumbStale: true });
  for (const p of data.pages || []) {
    tx.objectStore('pages').put({ ...p, strokes: p.strokes.map((s) => (s.pts ? { ...s, pts: fromBase64(s.pts) } : s)) });
  }
  await finished(tx);
  return data.notes.length;
}

// Eindeutige Nummer für Notizen, Seiten und Ordner
export function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}
