// htrdecode.js – aus den Wahrscheinlichkeiten des Erkennungs-Modells den Text machen
//
// Das Modell sagt für jede schmale Spalte der Zeile, welcher Buchstabe dort wie
// wahrscheinlich ist (oder "nichts"). Daraus suchen wir die besten ganzen Sätze
// ("Beam-Suche"), und ein deutsches Wörterbuch (60.000 Wörter mit Häufigkeit) hilft:
// "ist" ist ein sehr häufiges Wort, "IU" keins – also gewinnt "ist", wenn die Schrift
// es auch nur halbwegs hergibt. Unbekannte Wörter (Namen, Fachwörter) gehen trotzdem,
// sie brauchen nur etwas deutlichere Schrift.

const LETTER = /[\p{L}]/u;

// ---------- Wörterbuch ----------
// Datei: eine Zeile pro Wort: "wort<TAB>häufigkeit" (Zipf-Skala 1–8, ×10)
export function buildLexicon(text) {
  const root = { c: new Map(), z: 0 };
  let n = 0;
  for (const line of text.split('\n')) {
    const tab = line.indexOf('\t');
    if (tab < 1) continue;
    const w = line.slice(0, tab);
    const z = Number(line.slice(tab + 1)) / 10;
    let node = root;
    for (const ch of w) {
      let next = node.c.get(ch);
      if (!next) node.c.set(ch, (next = { c: new Map(), z: 0 }));
      node = next;
    }
    node.z = Math.max(node.z, z);
    n++;
  }
  root.size = n;
  return root;
}

export function lookup(lex, word) {
  let node = lex;
  for (const ch of word.toLowerCase()) {
    node = node.c.get(ch);
    if (!node) return 0;
  }
  return node.z;
}

// ---------- Beam-Suche ----------
const NEG = -1e30;
const lse = (a, b) => (a === NEG ? b : b === NEG ? a : a > b ? a + Math.log1p(Math.exp(b - a)) : b + Math.log1p(Math.exp(a - b)));

// probs: Float32Array T*C (Softmax), charset: String (Index 0 = leer/blank, Index i = charset[i-1])
export function decode(probs, T, C, charset, lex, { beam = 14, alpha = 0.55, oov = -3.2, top = 3 } = {}) {
  const chars = [...charset];
  // Wortwert: häufige Wörter belohnen, unbekannte bestrafen
  const wordScore = (node, word) => {
    if (!lex || !word) return 0;
    if (/^\p{L}$/u.test(word)) return node?.z ? alpha * (node.z - 4) : alpha * oov; // einzelner Buchstabe
    if (node && node.z > 0) return alpha * Math.min(3, node.z - 3);
    return alpha * oov;
  };
  // Beam-Eintrag: { text, pb, pnb, node (Wörterbuch-Stelle des angefangenen Worts), word, lm, last }
  let beams = new Map([['', { text: '', pb: 0, pnb: NEG, node: lex, word: '', lm: 0, last: -1 }]]);
  const total = (b) => lse(b.pb, b.pnb) + b.lm + (b.word && lex ? (b.node ? 0 : alpha * oov * 0.5) : 0);

  for (let t = 0; t < T; t++) {
    const row = probs.subarray(t * C, (t + 1) * C);
    const pBlank = Math.log(Math.max(1e-12, row[0]));
    // nur Zeichen, die hier überhaupt in Frage kommen
    const cand = [];
    for (let k = 1; k < C; k++) if (row[k] > 0.002) cand.push(k);
    const next = new Map();
    const get = (b, text, extend) => {
      let e = next.get(text);
      if (!e) {
        e = { ...extend, text, pb: NEG, pnb: NEG };
        next.set(text, e);
      }
      return e;
    };
    for (const b of beams.values()) {
      const p = lse(b.pb, b.pnb);
      // 1. leer: Text bleibt gleich
      const same = get(b, b.text, b);
      same.pb = lse(same.pb, p + pBlank);
      // 2. letztes Zeichen wiederholt (ohne Leerstelle dazwischen): bleibt gleich
      if (b.last > 0) same.pnb = lse(same.pnb, b.pnb + Math.log(Math.max(1e-12, row[b.last])));
      // 3. neues Zeichen anhängen
      for (const k of cand) {
        const ch = chars[k - 1];
        const lp = Math.log(row[k]);
        const from = k === b.last ? b.pb : p; // gleiches Zeichen nochmal nur nach Leerstelle
        if (from === NEG) continue;
        const text = b.text + ch;
        let e = next.get(text);
        if (!e) {
          let node = b.node, word = b.word, lm = b.lm;
          if (LETTER.test(ch)) {
            word += ch;
            node = node ? node.c.get(ch.toLowerCase()) || null : null;
          } else {
            // Wort zu Ende: bewerten
            lm += wordScore(node, word);
            word = '';
            node = lex;
          }
          e = { text, pb: NEG, pnb: NEG, node, word, lm, last: k };
          next.set(text, e);
        }
        e.pnb = lse(e.pnb, from + lp);
      }
    }
    beams = new Map([...next.values()].sort((a, b) => total(b) - total(a)).slice(0, beam).map((b) => [b.text, b]));
  }
  // Am Ende das letzte Wort bewerten
  const done = [...beams.values()].map((b) => ({ text: b.text, score: lse(b.pb, b.pnb) + b.lm + wordScore(b.node, b.word) }));
  done.sort((a, b) => b.score - a.score);
  return done.slice(0, top).map((d) => ({ text: fixCase(d.text, lex), score: d.score }));
}

// Groß/klein innerhalb bekannter Wörter glätten: "iSt" -> "ist", "BAUM" bleibt
function fixCase(text, lex) {
  return text.replace(/\p{L}+/gu, (w) => {
    if (w.length < 2 || !lex || !lookup(lex, w)) return w;
    const rest = w.slice(1);
    if (rest === rest.toUpperCase() && w.length > 2 && w === w.toUpperCase()) return w; // ALLES GROSS
    return w[0] + rest.toLowerCase();
  });
}

// Ohne Wörterbuch: einfach das wahrscheinlichste Zeichen pro Spalte
export function greedy(probs, T, C, charset) {
  const chars = [...charset];
  let out = '';
  let prev = 0;
  for (let t = 0; t < T; t++) {
    let best = 0;
    for (let k = 1; k < C; k++) if (probs[t * C + k] > probs[t * C + best]) best = k;
    if (best !== prev && best !== 0) out += chars[best - 1];
    prev = best;
  }
  return out;
}
