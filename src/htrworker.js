// htrworker.js – läuft im Hintergrund (Web Worker), damit die App beim Erkennen nicht hängt.
// Lädt einmal das Text-Modell und das Wörterbuch und erkennt dann Zeile für Zeile.
import { loadModel, run, softmaxRows } from './nn.js';
import { buildLexicon, decode, greedy } from './htrdecode.js';

let ready = null;
function init(base) {
  if (!ready) {
    ready = Promise.all([loadModel(`${base}htr/text.bin`), fetch(`${base}htr/de-words.txt`).then((r) => r.text())]).then(([model, words]) => ({
      model,
      lex: buildLexicon(words),
    }));
  }
  return ready;
}

self.onmessage = async (e) => {
  const { id, base, img, w, h } = e.data;
  try {
    const { model, lex } = await init(base);
    if (!img) return self.postMessage({ id, ok: true });
    const out = run(model, { c: 1, h, w, d: img });
    const C = out.n;
    const probs = softmaxRows(out.d, out.T, C);
    const charset = model.meta.charset;
    const best = decode(probs, out.T, C, charset, lex);
    self.postMessage({ id, ok: true, text: best[0]?.text ?? '', alts: best.map((b) => b.text), raw: greedy(probs, out.T, C, charset) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
