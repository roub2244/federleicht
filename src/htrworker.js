// htrworker.js – läuft im Hintergrund (Web Worker), damit die App beim Erkennen nicht hängt.
// Lädt einmal das Text-Modell und das Wörterbuch und erkennt dann Zeile für Zeile.
// Außerdem lernt er hier deine Schrift (siehe htradapt.js) – auch im Hintergrund.
import { loadModel, run, softmaxRows } from './nn.js';
import { buildLexicon, addWords, rescore, greedy } from './htrdecode.js';
import { adaptLinear, encode, forward } from './htradapt.js';

let ready = null;
const featCache = new Map(); // gelernte Zeilen: einmal ausrechnen reicht (pro Sitzung)
let personal = null; // { W, B } – an deine Schrift angepasste letzte Schicht
const LAST = 'lstm1'; // bis hierher rechnet das große Modell, danach kommt die letzte Schicht

function init(base) {
  if (!ready) {
    ready = Promise.all([loadModel(`${base}htr/text.bin`), fetch(`${base}htr/de-words.txt`).then((r) => r.text())]).then(([model, words]) => ({
      model,
      lex: buildLexicon(words),
      fc: model.layers.find((l) => l.name === 'fc'),
    }));
  }
  return ready;
}

function features(model, img, w, h) {
  return run(model, { c: 1, h, w, d: img }, LAST); // { T, n, d }
}

function probsFor(m, f) {
  const C = m.fc.out;
  const W = personal?.W || m.model.t['fc.w'];
  const B = personal?.B || m.model.t['fc.b'];
  const logits = forward({ F: f.d, T: f.T }, W, B, f.n, C);
  return { probs: softmaxRows(logits, f.T, C), C };
}

self.onmessage = async (e) => {
  const { id, base, type } = e.data;
  try {
    const m = await init(base);
    if (type === 'personal') {
      // gespeicherte Anpassung + eigene Wörter übernehmen
      const { W, B, words } = e.data;
      personal = W && B && W.length === m.model.t['fc.w'].length ? { W, B } : null;
      if (words?.length) addWords(m.lex, words);
      return self.postMessage({ id, ok: true });
    }
    if (type === 'adapt') {
      // samples: [{ img, w, h, text }]
      const n = m.model.layers.find((l) => l.name === LAST).hidden * 2;
      const C = m.fc.out;
      const feats = [];
      for (const s of e.data.samples) {
        const target = encode(s.text, m.model.meta.charset);
        if (!target.length) continue;
        let f = featCache.get(s.key);
        if (!f) {
          f = features(m.model, s.img, s.w, s.h);
          if (s.key) featCache.set(s.key, f);
        }
        if (f.T < target.length) continue;
        feats.push({ F: f.d, T: f.T, target });
      }
      if (!feats.length) return self.postMessage({ id, ok: true, W: null });
      const r = adaptLinear(feats, m.model.t['fc.w'], m.model.t['fc.b'], n, C, {
        epochs: Math.max(8, Math.min(25, Math.round(2400 / feats.length))),
        keep: 1e-3,
        lr: 5e-3,
        onProgress: (p) => self.postMessage({ id, progress: p }),
      });
      personal = { W: r.W, B: r.B };
      if (e.data.words?.length) addWords(m.lex, e.data.words);
      return self.postMessage({ id, ok: true, W: r.W, B: r.B, before: r.before, after: r.after, n: feats.length });
    }
    if (type === 'forget') {
      personal = null;
      featCache.clear();
      ready = null; // Wörterbuch frisch laden (ohne eigene Wörter)
      return self.postMessage({ id, ok: true });
    }
    const { img, w, h } = e.data;
    if (!img) return self.postMessage({ id, ok: true });
    const f = features(m.model, img, w, h);
    const { probs, C } = probsFor(m, f);
    const charset = m.model.meta.charset;
    const raw = greedy(probs, f.T, C, charset);
    const text = rescore(probs, f.T, C, charset, m.lex);
    self.postMessage({ id, ok: true, text, alts: [text, raw], raw });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
