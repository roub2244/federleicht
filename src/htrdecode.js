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
    const w = line.slice(0, tab).toLowerCase();
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

// Eigene Wörter (aus deinen Verbesserungen) dazunehmen: gelten als ziemlich häufig
export function addWords(lex, words) {
  for (const w of words) {
    if (!w || w.length < 2 || !/^\p{L}+$/u.test(w)) continue;
    let node = lex;
    for (const ch of w.toLowerCase()) {
      let next = node.c.get(ch);
      if (!next) node.c.set(ch, (next = { c: new Map(), z: 0 }));
      node = next;
    }
    node.z = Math.max(node.z, 5);
  }
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

// ---------- Wort für Wort nachprüfen (die eigentliche Stärke) ----------
// Das Modell liest z. B. „Ipuache“, gemeint war „Sprache“. Ein reiner Buchstaben-Vergleich
// würde das kaum finden. Wir machen es genauer: Für jedes gelesene Wort suchen wir im
// Wörterbuch ähnliche Wörter (bis zu 1–3 Buchstaben anders) und rechnen für jeden Kandidaten
// aus, wie gut er zu dem passt, was das Modell an dieser Stelle der Zeile WIRKLICH gesehen hat
// (alle Wahrscheinlichkeiten, nicht nur der beste Buchstabe). Dazu kommt, wie häufig das Wort
// ist. „Sprache“ gewinnt, weil das Modell an der Stelle vom „S“ auch ein bisschen „S“ gesehen
// hat und „Sprache“ ein häufiges Wort ist. Auch Wörter, die das Modell auseinandergerissen
// hat („Ein-an keit“), werden wieder zusammengesetzt, wenn das besser passt.

// Log-Wahrscheinlichkeit, dass die Spalten [t0, t1) genau den Text `ids` zeigen (CTC)
function ctcScore(logp, C, t0, t1, ids) {
  const L = ids.length;
  const S = 2 * L + 1;
  const T = t1 - t0;
  if (T <= 0) return L ? NEG : 0;
  let prev = new Float64Array(S).fill(NEG);
  let cur = new Float64Array(S);
  const lab = (s) => (s & 1 ? ids[s >> 1] : 0);
  prev[0] = logp[t0 * C];
  if (S > 1) prev[1] = logp[t0 * C + lab(1)];
  for (let t = 1; t < T; t++) {
    const row = (t0 + t) * C;
    // nur erreichbare Stellen (spart Zeit)
    const lo = Math.max(0, S - 2 * (T - t) - 1);
    const hi = Math.min(S - 1, 2 * t + 1);
    cur.fill(NEG);
    for (let s = lo; s <= hi; s++) {
      let a = prev[s];
      if (s >= 1) a = lse(a, prev[s - 1]);
      if (s >= 2 && s & 1 && ids[s >> 1] !== ids[(s >> 1) - 1]) a = lse(a, prev[s - 2]);
      if (a !== NEG) cur[s] = a + logp[row + lab(s)];
    }
    [prev, cur] = [cur, prev];
  }
  return S > 1 ? lse(prev[S - 1], prev[S - 2]) : prev[0];
}

// Wörter im Wörterbuch mit höchstens `maxD` Änderungen (Levenshtein), über den Baum gesucht
function fuzzy(lex, word, maxD, limit = 400) {
  const w = [...word];
  const out = [];
  const first = Array.from({ length: w.length + 1 }, (_, i) => i);
  const walk = (node, prefix, row) => {
    if (out.length >= limit) return;
    if (node.z > 0 && row[w.length] <= maxD) out.push([prefix, node.z, row[w.length]]);
    if (Math.min(...row) > maxD) return;
    for (const [ch, next] of node.c) {
      const r = [row[0] + 1];
      for (let j = 1; j <= w.length; j++) r[j] = Math.min(r[j - 1] + 1, row[j] + 1, row[j - 1] + (w[j - 1] === ch ? 0 : 1));
      walk(next, prefix + ch, r);
    }
  };
  walk(lex, '', first);
  return out;
}

const caseForms = (w, raw) => {
  const cap = w[0].toUpperCase() + w.slice(1);
  const forms = new Set([w, cap]);
  if (raw.length > 1 && raw === raw.toUpperCase() && /\p{Lu}/u.test(raw)) forms.add(w.toUpperCase());
  return [...forms];
};

export function rescore(probs, T, C, charset, lex, { lm = 1.0, oovZ = 0.6, maxCand = 400 } = {}) {
  const chars = [...charset];
  const idx = new Map(chars.map((c, i) => [c, i + 1]));
  const logp = new Float64Array(T * C);
  for (let i = 0; i < T * C; i++) logp[i] = Math.log(Math.max(1e-12, probs[i]));
  const space = idx.get(' ');
  // bester Pfad -> Wörter mit ihren Spalten
  const best = new Int32Array(T);
  for (let t = 0; t < T; t++) {
    let b = 0;
    for (let k = 1; k < C; k++) if (probs[t * C + k] > probs[t * C + b]) b = k;
    best[t] = b;
  }
  const toks = []; // { t0, t1, text }
  let t0 = 0, text = '', prev = 0;
  const flush = (t1) => {
    if (text) toks.push({ t0, t1, text });
    text = '';
  };
  for (let t = 0; t < T; t++) {
    const k = best[t];
    if (k === space) {
      flush(t);
      while (t + 1 < T && best[t + 1] === space) t++;
      t0 = t + 1;
      prev = space;
      continue;
    }
    if (k && k !== prev) text += chars[k - 1];
    prev = k;
  }
  flush(T);
  if (!toks.length || !lex) return toks.map((x) => x.text).join(' ');
  const LN10 = Math.LN10;
  const enc = (s) => [...s].map((c) => idx.get(c) || 0);
  const lmScore = (z) => lm * LN10 * (z - 6);
  // bestes Wort für die Spalten [a, b) mit dem gelesenen Text raw
  const bestFor = (a, b, raw) => {
    const m = raw.match(/^([^\p{L}]*)([\p{L}][\p{L}\-]*?)([^\p{L}]*)$/u);
    const rawScore = ctcScore(logp, C, a, b, enc(raw)) + lmScore(lookup(lex, raw.replace(/[^\p{L}]/gu, '')) || oovZ);
    let top = { text: raw, score: rawScore };
    if (!m) return top;
    const [, pre, core, post] = m;
    if (/\d/.test(core)) return top;
    const len = [...core].length;
    const maxD = len <= 2 ? 1 : len <= 5 ? 2 : 3;
    const cands = fuzzy(lex, core.toLowerCase(), maxD, maxCand);
    // auch ohne die Satzzeichen davor/danach probieren (oft nur Krümel)
    const pres = pre ? [pre, ''] : [''];
    const posts = post ? [post, ''] : [''];
    for (const [w, z] of cands) {
      for (const f of caseForms(w, core)) {
        for (const p of pres) for (const q of posts) {
          const s = ctcScore(logp, C, a, b, enc(p + f + q)) + lmScore(z);
          if (s > top.score) top = { text: p + f + q, score: s };
        }
      }
    }
    return top;
  };
  // Dynamische Programmierung: jedes Wort einzeln oder zwei Nachbarn zusammen
  const n = toks.length;
  const dp = new Array(n + 1).fill(null);
  dp[0] = { score: 0, out: [] };
  const single = toks.map((tk) => bestFor(tk.t0, tk.t1, tk.text));
  // Leerzeichen-Spalten zwischen zwei Wörtern: so wahrscheinlich war die Lücke
  const gapScore = (i) => {
    let s = 0;
    for (let t = toks[i].t1; t < toks[i + 1].t0; t++) s += Math.log(Math.max(1e-12, probs[t * C + space] + probs[t * C]));
    return s;
  };
  for (let i = 1; i <= n; i++) {
    const a = dp[i - 1];
    let cand = { score: a.score + single[i - 1].score + (i > 1 ? gapScore(i - 2) : 0), out: [...a.out, single[i - 1].text] };
    if (i >= 2) {
      const m = bestFor(toks[i - 2].t0, toks[i - 1].t1, toks[i - 2].text + toks[i - 1].text);
      const b = dp[i - 2];
      const s = b.score + m.score + (i > 2 ? gapScore(i - 3) : 0);
      if (lookup(lex, m.text.replace(/[^\p{L}]/gu, '')) && s > cand.score) cand = { score: s, out: [...b.out, m.text] };
    }
    dp[i] = cand;
  }
  return dp[n].out.join(' ');
}
