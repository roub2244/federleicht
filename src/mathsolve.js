// mathsolve.js – Rechnen für die Mathe-Hilfe (komplett offline)
//
// Bekommt eine Aufgabe als Text (aus der Handschrift erkannt oder eingetippt), z. B.
//   "3*4+5="       -> rechnen               = 17
//   "3x+5=x+9"     -> nach x auflösen       x = 2 (mit Rechenweg: Äquivalenzumformungen)
//   "x^2-5x+6=0"   -> quadratisch (pq-Formel) x₁ = 2, x₂ = 3
//   "(2x+1)^2"     -> Term vereinfachen     4x² + 4x + 1
//   "7*8=56"       -> prüfen                stimmt
//
// Teile:
//   parse(text)   -> Baum (AST)            toHTML(baum) -> schön gesetzt (Brüche, Hochzahlen, Wurzeln)
//   solve(text)   -> { kind, html, answer, insert, steps }

export const DEFAULT_MATH = {
  digits: 4,          // Nachkommastellen
  fractions: true,    // Ergebnis als Bruch, wenn es einer ist (1/3 statt 0,3333)
  steps: true,        // Rechenweg gleich aufgeklappt
  angle: 'deg',       // sin/cos/tan in Grad ('deg') oder Bogenmaß ('rad')
  xIsTimes: false,    // "x" zwischen zwei Zahlen heißt "mal" (sonst immer Variable)
  font: 'hand',       // Schrift des eingefügten Ergebnisses
  color: 'pen',       // Farbe: 'pen' (wie die Schrift) oder eine Farbe
};

// ---------- Zerlegen (Tokens) ----------
const FUNCS = ['sqrt', 'sin', 'cos', 'tan', 'ln', 'log', 'abs'];
const SUP = { '²': '2', '³': '3', '¹': '1', '⁰': '0', '⁴': '4', '⁵': '5', '⁶': '6', '⁷': '7', '⁸': '8', '⁹': '9' };

function tokenize(src) {
  const s = src.replace(/\s+/g, '');
  const out = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/[0-9.,]/.test(c)) {
      let j = i;
      while (j < s.length && /[0-9.,]/.test(s[j])) j++;
      const raw = s.slice(i, j).replace(',', '.');
      if (!/^\d*\.?\d+$|^\d+\.$/.test(raw)) throw new Error(`Zahl „${s.slice(i, j)}“ verstehe ich nicht`);
      out.push({ k: 'num', v: parseFloat(raw), raw: s.slice(i, j).replace('.', ',') });
      i = j;
      continue;
    }
    if (SUP[c]) {
      let j = i;
      let d = '';
      while (j < s.length && SUP[s[j]]) d += SUP[s[j++]];
      out.push({ k: 'op', v: '^' }, { k: 'num', v: +d, raw: d });
      i = j;
      continue;
    }
    const word = /^[a-zA-Zπ√]+/.exec(s.slice(i))?.[0];
    if (word) {
      // bekannte Funktionen, pi, sonst einzelne Buchstaben (x = Variable)
      let w = word.toLowerCase();
      let used = 0;
      while (w.length) {
        const f = FUNCS.find((n) => w.startsWith(n));
        if (f) {
          out.push({ k: 'fn', v: f });
          used = f.length;
        } else if (w.startsWith('pi')) {
          out.push({ k: 'const', v: 'π' });
          used = 2;
        } else if (w[0] === 'π') {
          out.push({ k: 'const', v: 'π' });
          used = 1;
        } else if (w[0] === '√') {
          out.push({ k: 'fn', v: 'sqrt' });
          used = 1;
        } else if (w[0] === 'x') {
          out.push({ k: 'var' });
          used = 1;
        } else if (w[0] === 'e') {
          out.push({ k: 'const', v: 'e' });
          used = 1;
        } else throw new Error(`„${word[0]}“ kenne ich nicht (nur x als Variable)`);
        w = w.slice(used);
      }
      i += word.length;
      continue;
    }
    const map = { '*': '*', '·': '*', '×': '*', '⋅': '*', '/': '/', ':': ':', '÷': ':', '+': '+', '-': '-', '−': '-', '–': '-', '^': '^', '(': '(', ')': ')', '[': '(', ']': ')', '=': '=' };
    if (map[c]) {
      out.push(c === '(' || c === '[' ? { k: '(' } : c === ')' || c === ']' ? { k: ')' } : c === '=' ? { k: '=' } : { k: 'op', v: map[c] });
      i++;
      continue;
    }
    throw new Error(`Das Zeichen „${c}“ verstehe ich nicht`);
  }
  return out;
}

// ---------- Baum bauen ----------
// Ausdruck := Summe ; Summe := Produkt (+|- Produkt)* ; Produkt := Potenz ((*|/|:| ) Potenz)*
// Potenz := Vorzeichen (^ Potenz)? ; implizites Mal: 3x, 2(…), (…)(…), x√2
export function parse(src) {
  const toks = tokenize(src);
  let p = 0;
  const peek = () => toks[p];
  const isOp = (v) => peek()?.k === 'op' && peek().v === v;

  function expr() {
    let a = product();
    while (isOp('+') || isOp('-')) {
      const op = toks[p++].v;
      a = { t: 'bin', op, a, b: product() };
    }
    return a;
  }
  function startsFactor(t) {
    return t && (t.k === 'num' || t.k === 'var' || t.k === 'const' || t.k === 'fn' || t.k === '(');
  }
  function product() {
    let a = unary();
    for (;;) {
      if (isOp('*') || isOp('/') || isOp(':')) {
        const op = toks[p++].v;
        a = { t: 'bin', op, a, b: unary() };
      } else if (startsFactor(peek())) {
        a = { t: 'bin', op: '*', a, b: power(), implicit: true };
      } else break;
    }
    return a;
  }
  function unary() {
    if (isOp('-')) {
      p++;
      return { t: 'neg', a: unary() };
    }
    if (isOp('+')) {
      p++;
      return unary();
    }
    return power();
  }
  function power() {
    const base = primary();
    if (isOp('^')) {
      p++;
      return { t: 'pow', a: base, b: unary() };
    }
    return base;
  }
  function primary() {
    const t = toks[p++];
    if (!t) throw new Error('Da fehlt noch etwas am Ende');
    if (t.k === 'num') return { t: 'num', v: t.v, raw: t.raw };
    if (t.k === 'var') return { t: 'var' };
    if (t.k === 'const') return { t: 'const', v: t.v };
    if (t.k === 'fn') {
      // Funktion: Klammer oder direkt die nächste Zahl/Potenz (√9, sin30)
      const arg = peek()?.k === '(' ? primary() : power();
      return { t: 'fn', f: t.v, a: arg };
    }
    if (t.k === '(') {
      const inner = expr();
      if (peek()?.k === ')') p++; // fehlende schließende Klammer verzeihen wir
      return { t: 'group', a: inner };
    }
    if (t.k === ')') throw new Error('Klammer zu ohne Klammer auf');
    throw new Error(`„${t.v || t.k}“ an dieser Stelle verstehe ich nicht`);
  }

  const out = expr();
  if (p < toks.length) {
    const t = toks[p];
    throw new Error(t.k === ')' ? 'Eine Klammer zu viel' : `„${t.v || t.k}“ an dieser Stelle verstehe ich nicht`);
  }
  return out;
}

export function hasVar(n) {
  if (!n) return false;
  if (n.t === 'var') return true;
  return hasVar(n.a) || hasVar(n.b);
}

// ---------- Ausrechnen ----------
export function evaluate(n, x = 0, opts = DEFAULT_MATH) {
  const rad = (v) => (opts.angle === 'deg' ? (v * Math.PI) / 180 : v);
  switch (n.t) {
    case 'num':
      return n.v;
    case 'var':
      return x;
    case 'const':
      return n.v === 'π' ? Math.PI : Math.E;
    case 'group':
      return evaluate(n.a, x, opts);
    case 'neg':
      return -evaluate(n.a, x, opts);
    case 'pow':
      return Math.pow(evaluate(n.a, x, opts), evaluate(n.b, x, opts));
    case 'fn': {
      const v = evaluate(n.a, x, opts);
      switch (n.f) {
        case 'sqrt':
          return Math.sqrt(v);
        case 'sin':
          return clean(Math.sin(rad(v)));
        case 'cos':
          return clean(Math.cos(rad(v)));
        case 'tan':
          return clean(Math.tan(rad(v)));
        case 'ln':
          return Math.log(v);
        case 'log':
          return Math.log10(v);
        case 'abs':
          return Math.abs(v);
      }
      return NaN;
    }
    case 'bin': {
      const a = evaluate(n.a, x, opts);
      const b = evaluate(n.b, x, opts);
      if (n.op === '+') return a + b;
      if (n.op === '-') return a - b;
      if (n.op === '*') return a * b;
      return a / b;
    }
  }
  return NaN;
}
// sin(180°) soll 0 sein, nicht 1,2e-16
const clean = (v) => (Math.abs(v) < 1e-12 ? 0 : Math.abs(v - Math.round(v)) < 1e-12 ? Math.round(v) : v);

// ---------- Zahlen schön schreiben ----------
export function toFraction(v, maxDen = 1000) {
  if (!Number.isFinite(v)) return null;
  const sign = v < 0 ? -1 : 1;
  const a = Math.abs(v);
  let h1 = 1, h0 = 0, k1 = 0, k0 = 1, b = a;
  for (let i = 0; i < 30; i++) {
    const ai = Math.floor(b);
    [h1, h0] = [ai * h1 + h0, h1];
    [k1, k0] = [ai * k1 + k0, k1];
    if (k1 > maxDen) return null;
    if (Math.abs(a - h1 / k1) < 1e-9 * Math.max(1, a)) return { n: sign * h1, d: k1 };
    const r = b - ai;
    if (r < 1e-12) break;
    b = 1 / r;
  }
  return Math.abs(a - h1 / k1) < 1e-9 * Math.max(1, a) ? { n: sign * h1, d: k1 } : null;
}

export function fmtDec(v, digits) {
  if (!Number.isFinite(v)) return v > 0 ? '∞' : v < 0 ? '−∞' : 'nicht definiert';
  if (Math.abs(v) >= 1e12 || (Math.abs(v) < 1e-6 && v !== 0)) {
    const [m, e] = v.toExponential(digits).split('e');
    return `${trim(m).replace('.', ',').replace('-', '−')} · 10^${+e}`;
  }
  const s = trim(v.toFixed(digits));
  return (s === '-0' ? '0' : s).replace('.', ',').replace('-', '−');
}
const trim = (s) => (s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s);

// Zahl als { html, text } – Bruch, wenn sinnvoll, sonst Dezimalzahl (≈, wenn gerundet)
export function fmtNum(v, opts = DEFAULT_MATH) {
  const dec = fmtDec(v, opts.digits);
  const exact = Number.isFinite(v) && Math.abs(v - Number(v.toFixed(opts.digits))) < 1e-12;
  if (opts.fractions && Number.isFinite(v) && !Number.isInteger(v)) {
    const f = toFraction(v);
    if (f && f.d > 1 && f.d <= 1000) {
      const sign = f.n < 0 ? '−' : '';
      const html = `${sign}<span class="mf"><span>${Math.abs(f.n)}</span><span>${f.d}</span></span>`;
      const approx = exact ? `= ${dec}` : `≈ ${dec}`;
      return { bare: html, html: `${html}<span class="m-approx">${approx}</span>`, text: `${sign}${Math.abs(f.n)}/${f.d}`, short: `${sign}${Math.abs(f.n)}/${f.d}` };
    }
  }
  return { bare: dec, html: `${exact ? '' : '≈ '}${dec}`, text: `${exact ? '' : '≈ '}${dec}`, short: dec, approx: !exact };
}

// ---------- Schön setzen (HTML) ----------
const escH = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
const PREC = { bin: { '+': 1, '-': 1, '*': 2, '/': 2, ':': 2 }, neg: 1.5, pow: 3 };

export function toHTML(n, opts = DEFAULT_MATH) {
  switch (n.t) {
    case 'num':
      return escH(n.raw ?? fmtDec(n.v, opts.digits));
    case 'var':
      return '<i>x</i>';
    case 'const':
      return n.v === 'π' ? 'π' : '<i>e</i>';
    case 'group':
      return `(${toHTML(n.a, opts)})`;
    case 'neg':
      return `−${toHTML(n.a, opts)}`;
    case 'pow':
      return `${toHTML(n.a, opts)}<sup>${toHTML(strip(n.b), opts)}</sup>`;
    case 'fn':
      if (n.f === 'sqrt') return `<span class="mroot">√<span>${toHTML(strip(n.a), opts)}</span></span>`;
      return `${n.f}${n.a.t === 'group' ? '' : ' '}${toHTML(n.a, opts)}`;
    case 'bin': {
      if (n.op === '/') return `<span class="mf"><span>${toHTML(strip(n.a), opts)}</span><span>${toHTML(strip(n.b), opts)}</span></span>`;
      const a = toHTML(n.a, opts);
      const b = toHTML(n.b, opts);
      if (n.op === '*') {
        // 3x, 2(…), x² ohne Punkt; Zahl mal Zahl mit Punkt
        if (n.implicit && !(n.b.t === 'num' || (n.b.t === 'pow' && n.b.a.t === 'num'))) return `${a}${b}`;
        return `${a} · ${b}`;
      }
      return `${a} ${n.op === '-' ? '−' : n.op} ${b}`;
    }
  }
  return '';
}
const strip = (n) => (n.t === 'group' ? n.a : n);

// ---------- Polynome (für Gleichungen und Terme mit x) ----------
// Sind f(x) ein Polynom bis Grad 4? Dann die Koeffizienten [a0, a1, a2, …] (sonst null)
function polyOf(f) {
  const xs = [0, 1, 2, 3, 4, 5, 6];
  const ys = xs.map(f);
  if (ys.some((y) => !Number.isFinite(y))) return null;
  // Newton-Interpolation durch die Punkte 0..6 (Grad höchstens 6), dann Grad bestimmen
  const coef = newtonToMonomial(xs, ys);
  let deg = coef.length - 1;
  const scale = Math.max(1, ...ys.map(Math.abs));
  while (deg > 0 && Math.abs(coef[deg]) < 1e-9 * scale) deg--;
  if (deg > 4) return null;
  const c = coef.slice(0, deg + 1).map(snap);
  // Gegenprobe an ganz anderen Stellen (fängt 1/x, √x, sin x usw. ab)
  for (const x of [-2.5, 7.25, -11.5, 0.37]) {
    const y = f(x);
    const py = c.reduce((s, a, i) => s + a * Math.pow(x, i), 0);
    if (!Number.isFinite(y) || Math.abs(y - py) > 1e-6 * Math.max(1, Math.abs(y))) return null;
  }
  return c;
}
function newtonToMonomial(xs, ys) {
  const n = xs.length;
  const d = [...ys];
  for (let j = 1; j < n; j++) for (let i = n - 1; i >= j; i--) d[i] = (d[i] - d[i - 1]) / (xs[i] - xs[i - j]);
  // p(x) = d0 + d1 (x-x0) + d2 (x-x0)(x-x1) + …  -> Koeffizienten
  let poly = [0];
  for (let i = n - 1; i >= 0; i--) {
    // poly = poly * (x - xs[i]) + d[i]
    const next = new Array(poly.length + 1).fill(0);
    for (let k = 0; k < poly.length; k++) {
      next[k + 1] += poly[k];
      next[k] -= poly[k] * xs[i];
    }
    next[0] += d[i];
    poly = next;
  }
  return poly;
}
const snap = (v) => {
  const r = Math.round(v);
  if (Math.abs(v - r) < 1e-9 * Math.max(1, Math.abs(v))) return r;
  const f = toFraction(v, 10000);
  return f ? f.n / f.d : v;
};

// Polynom schön: 3x² − 2x + 1
function polyHTML(c, opts) {
  const parts = [];
  for (let i = c.length - 1; i >= 0; i--) {
    const a = c[i];
    if (Math.abs(a) < 1e-12) continue;
    const neg = a < 0;
    const abs = Math.abs(a);
    let coef = abs === 1 && i > 0 ? '' : coefHTML(abs, opts);
    const xs = i === 0 ? '' : i === 1 ? '<i>x</i>' : `<i>x</i><sup>${i}</sup>`;
    parts.push({ neg, s: `${coef}${xs}` });
  }
  if (!parts.length) return '0';
  return parts.map((p, k) => (k === 0 ? (p.neg ? '−' : '') + p.s : ` ${p.neg ? '−' : '+'} ${p.s}`)).join('');
}
function coefHTML(v, opts) {
  if (Number.isInteger(v)) return String(v);
  const f = opts.fractions ? toFraction(v) : null;
  if (f && f.d <= 1000) return `<span class="mf"><span>${Math.abs(f.n)}</span><span>${f.d}</span></span>`;
  return fmtDec(v, opts.digits);
}
function polyText(c, opts) {
  const parts = [];
  for (let i = c.length - 1; i >= 0; i--) {
    const a = c[i];
    if (Math.abs(a) < 1e-12) continue;
    const abs = Math.abs(a);
    const coef = abs === 1 && i > 0 ? '' : fmtNum(abs, opts).short;
    const xs = i === 0 ? '' : i === 1 ? 'x' : `x${i === 2 ? '²' : i === 3 ? '³' : '⁴'}`;
    parts.push({ neg: a < 0, s: coef + xs });
  }
  if (!parts.length) return '0';
  return parts.map((p, k) => (k === 0 ? (p.neg ? '−' : '') + p.s : ` ${p.neg ? '−' : '+'} ${p.s}`)).join('');
}

// ---------- Lösen ----------
// Ergebnis: { kind, html (Aufgabe schön), answerHTML, insert (Text zum Einfügen), insertAfter (true = rechts neben "="),
//             steps: [{ html, note }] , error }
export function solve(src, opts = DEFAULT_MATH) {
  const text = String(src || '').trim();
  if (!text) return { kind: 'empty', error: 'Noch keine Aufgabe' };
  const sides = text.split('=');
  try {
    const trees = sides.map((s) => (s.trim() ? parse(s) : null));
    const html = trees.map((t) => (t ? toHTML(t, opts) : '')).join(' = ');
    const res = solveTrees(trees, opts);
    return { html, ...res };
  } catch (err) {
    return { kind: 'error', error: err.message || 'Das verstehe ich nicht' };
  }
}

function solveTrees(trees, opts) {
  const f = (t) => (x) => evaluate(t, x, opts);
  const filled = trees.filter(Boolean);
  if (!filled.length) return { kind: 'error', error: 'Noch keine Aufgabe' };

  // "12 · 3 =" oder einfach "12 · 3": ausrechnen
  if (trees.length === 1 || (trees.length === 2 && !trees[1])) {
    const t = trees[0];
    if (!t) return { kind: 'error', error: 'Vor dem = fehlt die Aufgabe' };
    const endsEq = trees.length === 2;
    if (!hasVar(t)) {
      const v = evaluate(t, 0, opts);
      if (!Number.isFinite(v)) return { kind: 'error', error: Number.isNaN(v) ? 'Nicht definiert (z. B. Wurzel aus einer negativen Zahl)' : 'Geteilt durch 0 geht nicht' };
      const n = fmtNum(v, opts);
      return { kind: 'value', answerHTML: `= ${n.html}`, insert: endsEq ? n.short : `= ${n.short}`, insertAfter: true, steps: [] };
    }
    // Term mit x: vereinfachen
    const c = polyOf(f(t));
    if (!c) return { kind: 'term', answerHTML: '<small>Term mit x – zum Auflösen ein = dazuschreiben (z. B. … = 0)</small>', steps: [] };
    return { kind: 'term', answerHTML: `= ${polyHTML(c, opts)}`, insert: `= ${polyText(c, opts)}`, insertAfter: true, steps: [] };
  }

  // Mehrere Seiten
  if (filled.length !== trees.length) return { kind: 'error', error: 'Auf einer Seite vom = fehlt etwas' };
  const anyVar = trees.some(hasVar);
  if (!anyVar) {
    // Prüfen: stimmt die Rechnung?
    const vals = trees.map((t) => evaluate(t, 0, opts));
    const ok = vals.every((v) => Math.abs(v - vals[0]) < 1e-9 * Math.max(1, Math.abs(vals[0])));
    if (ok) return { kind: 'check', ok: true, answerHTML: '<span class="m-ok">✓ Stimmt!</span>', steps: [] };
    const right = fmtNum(vals[0], opts);
    return {
      kind: 'check',
      ok: false,
      answerHTML: `<span class="m-bad">✗ Stimmt nicht</span> <small>richtig wäre ${right.html}</small>`,
      insert: right.short,
      insertBelow: true,
      steps: vals.map((v, i) => ({ html: `${i === 0 ? 'Links' : i === 1 ? 'Rechts' : `Teil ${i + 1}`}: ${fmtNum(v, opts).html}` })),
    };
  }
  if (trees.length > 2) return { kind: 'error', error: 'Gleichungen bitte mit genau einem =' };
  return solveEquation(trees[0], trees[1], opts);
}

function solveEquation(L, R, opts) {
  const fl = (x) => evaluate(L, x, opts);
  const fr = (x) => evaluate(R, x, opts);
  const pl = polyOf(fl);
  const pr = polyOf(fr);
  const steps = [];
  if (pl && pr) {
    const n = Math.max(pl.length, pr.length);
    const d = Array.from({ length: n }, (_, i) => snap((pl[i] || 0) - (pr[i] || 0)));
    let deg = d.length - 1;
    while (deg > 0 && Math.abs(d[deg]) < 1e-12) deg--;
    if (deg === 0) {
      if (Math.abs(d[0]) < 1e-12) return { kind: 'solve', answerHTML: '<i>x</i> kann jede Zahl sein <small>(immer wahr)</small>', insert: 'L = ℝ', insertBelow: true, steps };
      return { kind: 'solve', answerHTML: 'Keine Lösung <small>(nie wahr)</small>', insert: 'L = { }', insertBelow: true, steps };
    }
    if (deg === 1) return linear(pl, pr, opts);
    if (deg === 2) return quadratic(d.slice(0, 3), pl, pr, opts);
  }
  // Sonst: Nullstellen von links − rechts zahlenmäßig suchen
  const g = (x) => fl(x) - fr(x);
  const roots = numericRoots(g);
  if (!roots.length) return { kind: 'solve', answerHTML: 'Keine Lösung gefunden <small>(gesucht von −1000 bis 1000)</small>', steps };
  const list = roots.map((r) => fmtNum(r, { ...opts, fractions: false }));
  return {
    kind: 'solve',
    answerHTML: roots.length === 1 ? `<i>x</i> ${list[0].approx ? '≈' : '='} ${list[0].short}` : `<i>x</i> ∈ { ${list.map((l) => l.short).join('; ')} }`,
    insert: roots.length === 1 ? `x ${list[0].approx ? '≈' : '='} ${list[0].short}` : `L = { ${list.map((l) => l.short).join('; ')} }`,
    insertBelow: true,
    steps: [{ html: 'Zahlenmäßig gesucht (Näherung)', note: 'Die Gleichung ist kein Polynom – darum eine Näherung' }],
  };
}

// a·x + b = c·x + d  ->  Äquivalenzumformungen wie im Heft
function linear(pl, pr, opts) {
  const [b, a = 0] = pl;
  const [d, c = 0] = pr;
  const steps = [];
  const P = (cs) => polyHTML(cs, opts);
  const num = (v) => fmtNum(v, opts).short.replace('-', '−');
  steps.push({ html: `${P(pl)} = ${P(pr)}` });
  let A = a, B = b, C = c, D = d;
  // x auf die linke Seite
  if (Math.abs(C) > 1e-12) {
    const term = Math.abs(C) === 1 ? '<i>x</i>' : `${coefHTML(Math.abs(C), opts)}<i>x</i>`;
    A = snap(A - C);
    C = 0;
    steps.push({ html: `${P([B, A])} = ${P([D])}`, note: `| ${c > 0 ? '−' : '+'} ${term}` });
  }
  // Zahl auf die rechte Seite
  if (Math.abs(B) > 1e-12) {
    D = snap(D - B);
    steps.push({ html: `${P([0, A])} = ${P([D])}`, note: `| ${B > 0 ? '−' : '+'} ${coefHTML(Math.abs(B), opts)}` });
    B = 0;
  }
  const x = snap(D / A);
  if (Math.abs(A - 1) > 1e-12) steps.push({ html: `<i>x</i> = ${fmtNum(x, opts).bare}`, note: `| : ${A < 0 ? `(${num(A)})` : num(A)}` });
  const r = fmtNum(x, opts);
  return { kind: 'solve', answerHTML: `<i>x</i> = ${r.html}`, insert: `x = ${r.short}`, insertBelow: true, steps };
}

// Quadratisch: in Normalform bringen, dann pq-Formel
function quadratic(d, pl, pr, opts) {
  const [c0, b0, a0] = d;
  const steps = [];
  const P = (cs) => polyHTML(cs, opts);
  steps.push({ html: `${P(pl)} = ${P(pr)}` });
  if (pr.some((v) => Math.abs(v) > 1e-12)) steps.push({ html: `${P([c0, b0, a0])} = 0`, note: 'alles auf eine Seite' });
  const p = snap(b0 / a0);
  const q = snap(c0 / a0);
  if (Math.abs(a0 - 1) > 1e-12) steps.push({ html: `${P([q, p, 1])} = 0`, note: `| : ${fmtNum(a0, opts).short}` });
  const disc = snap((p / 2) * (p / 2) - q);
  const nf = (v) => fmtNum(v, opts).bare;
  steps.push({
    html: `<i>x</i><sub>1,2</sub> = −<span class="mf"><span><i>p</i></span><span>2</span></span> ± <span class="mroot">√<span>(<span class="mf"><span><i>p</i></span><span>2</span></span>)<sup>2</sup> − <i>q</i></span></span>`,
    note: `pq-Formel mit p = ${fmtNum(p, opts).short}, q = ${fmtNum(q, opts).short}`,
  });
  steps.push({ html: `<i>D</i> = (${nf(p / 2)})<sup>2</sup> − ${q < 0 ? `(${nf(q)})` : nf(q)} = ${nf(disc)}`, note: 'Diskriminante (was unter der Wurzel steht)' });
  if (disc < -1e-12) {
    return { kind: 'solve', answerHTML: 'Keine Lösung <small>(D &lt; 0)</small>', insert: 'L = { }', insertBelow: true, steps };
  }
  if (Math.abs(disc) < 1e-12) {
    const x = snap(-p / 2);
    const r = fmtNum(x, opts);
    steps.push({ html: `<i>x</i> = ${r.html}`, note: 'D = 0: genau eine Lösung' });
    return { kind: 'solve', answerHTML: `<i>x</i> = ${r.html}`, insert: `x = ${r.short}`, insertBelow: true, steps };
  }
  const s = Math.sqrt(disc);
  const x1 = snap(-p / 2 - s);
  const x2 = snap(-p / 2 + s);
  const r1 = fmtNum(x1, opts);
  const r2 = fmtNum(x2, opts);
  const rootNice = toFraction(s, 1000) ? nf(s) : `<span class="mroot">√<span>${nf(disc)}</span></span> ≈ ${fmtDec(s, opts.digits)}`;
  steps.push({ html: `<i>x</i><sub>1,2</sub> = ${nf(-p / 2)} ± ${rootNice}` });
  return {
    kind: 'solve',
    answerHTML: `<i>x</i><sub>1</sub> = ${r1.html}<span class="m-sep"></span><i>x</i><sub>2</sub> = ${r2.html}`,
    insert: `x₁ = ${r1.short};  x₂ = ${r2.short}`,
    insertBelow: true,
    steps,
  };
}

function numericRoots(g) {
  const roots = [];
  const push = (r) => {
    if (!roots.some((q) => Math.abs(q - r) < 1e-6 * Math.max(1, Math.abs(r)))) roots.push(Math.abs(r) < 1e-12 ? 0 : r);
  };
  let px = -1000;
  let py = g(px);
  const N = 40000;
  for (let i = 1; i <= N; i++) {
    const x = -1000 + (2000 * i) / N;
    const y = g(x);
    if (Number.isFinite(py) && Number.isFinite(y)) {
      if (y === 0) push(x);
      else if (py * y < 0) {
        let a = px, b = x, fa = py;
        for (let k = 0; k < 80; k++) {
          const m = (a + b) / 2;
          const fm = g(m);
          if (fa * fm <= 0) b = m;
          else {
            a = m;
            fa = fm;
          }
        }
        const r = (a + b) / 2;
        // Polstelle (1/x) ist keine Nullstelle
        if (Math.abs(g(r)) < 1e-6) push(snap(r));
      }
    }
    px = x;
    py = y;
    if (roots.length > 8) break;
  }
  return roots.sort((a, b) => a - b);
}
