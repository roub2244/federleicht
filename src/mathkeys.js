// mathkeys.js – Mathe-Schreibmenü: Sonderzeichen für Mathe schnell eintippen
//
// Erscheint im Text-Werkzeug (Knopf "∑" in der Format-Leiste). Antippen fügt das Zeichen
// an der Cursor-Stelle ein. Dazu gibt es "Hochstellen" und "Tiefstellen": Ist das an,
// werden getippte Ziffern und Buchstaben automatisch hoch- bzw. tiefgestellt (x² , a₁).

export const SUP = { 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹', '+': '⁺', '-': '⁻', '−': '⁻', '=': '⁼', '(': '⁽', ')': '⁾', n: 'ⁿ', i: 'ⁱ', x: 'ˣ', y: 'ʸ', a: 'ᵃ', b: 'ᵇ', c: 'ᶜ', d: 'ᵈ', e: 'ᵉ', f: 'ᶠ', g: 'ᵍ', h: 'ʰ', j: 'ʲ', k: 'ᵏ', l: 'ˡ', m: 'ᵐ', o: 'ᵒ', p: 'ᵖ', r: 'ʳ', s: 'ˢ', t: 'ᵗ', u: 'ᵘ', v: 'ᵛ', w: 'ʷ', z: 'ᶻ' };
export const SUB = { 0: '₀', 1: '₁', 2: '₂', 3: '₃', 4: '₄', 5: '₅', 6: '₆', 7: '₇', 8: '₈', 9: '₉', '+': '₊', '-': '₋', '−': '₋', '=': '₌', '(': '₍', ')': '₎', a: 'ₐ', e: 'ₑ', h: 'ₕ', i: 'ᵢ', j: 'ⱼ', k: 'ₖ', l: 'ₗ', m: 'ₘ', n: 'ₙ', o: 'ₒ', p: 'ₚ', r: 'ᵣ', s: 'ₛ', t: 'ₜ', u: 'ᵤ', v: 'ᵥ', x: 'ₓ' };

// Gruppen: [Name, [[Zeichen, Beschreibung], …]]
export const MATH_TABS = [
  ['Rechnen', [['·', 'mal'], ['×', 'mal (Kreuz)'], [':', 'geteilt'], ['÷', 'geteilt'], ['±', 'plus minus'], ['−', 'minus'], ['=', 'gleich'], ['≠', 'ungleich'], ['≈', 'ungefähr'], ['<', 'kleiner'], ['>', 'größer'], ['≤', 'kleiner gleich'], ['≥', 'größer gleich'], ['%', 'Prozent'], ['‰', 'Promille'], ['°', 'Grad'], ['∞', 'unendlich'], ['π', 'Pi'], ['√', 'Wurzel'], ['∛', '3. Wurzel'], ['½', 'ein halb'], ['⅓', 'ein Drittel'], ['¼', 'ein Viertel'], ['¾', 'drei Viertel'], ['|', 'Betrag'], ['∝', 'proportional']]],
  ['Hoch/Tief', [['²', 'hoch 2'], ['³', 'hoch 3'], ['ⁿ', 'hoch n'], ['⁻¹', 'hoch −1'], ['ˣ', 'hoch x'], ['⁰', ''], ['¹', ''], ['⁴', ''], ['⁵', ''], ['⁶', ''], ['⁷', ''], ['⁸', ''], ['⁹', ''], ['⁺', ''], ['⁻', ''], ['₀', 'tief 0'], ['₁', 'tief 1'], ['₂', 'tief 2'], ['₃', 'tief 3'], ['ₙ', 'tief n'], ['ₓ', 'tief x'], ['⁄', 'Bruchstrich (z. B. ³⁄₄)']]],
  ['Mengen', [['ℕ', 'natürliche Zahlen'], ['ℤ', 'ganze Zahlen'], ['ℚ', 'rationale Zahlen'], ['ℝ', 'reelle Zahlen'], ['ℂ', 'komplexe Zahlen'], ['∈', 'Element von'], ['∉', 'nicht Element'], ['⊂', 'Teilmenge'], ['⊆', 'Teilmenge oder gleich'], ['∪', 'vereinigt'], ['∩', 'geschnitten'], ['∖', 'ohne'], ['∅', 'leere Menge'], ['{', ''], ['}', ''], ['𝕃', 'Lösungsmenge'], ['∀', 'für alle'], ['∃', 'es gibt']]],
  ['Logik', [['⇒', 'daraus folgt'], ['⇔', 'genau dann wenn'], ['→', 'Pfeil'], ['↦', 'wird abgebildet auf'], ['∧', 'und'], ['∨', 'oder'], ['¬', 'nicht'], ['∴', 'also'], ['✓', 'Haken'], ['↑', ''], ['↓', ''], ['↔', '']]],
  ['Geometrie', [['∠', 'Winkel'], ['⊥', 'senkrecht'], ['∥', 'parallel'], ['△', 'Dreieck'], ['□', 'Quadrat'], ['○', 'Kreis'], ['≅', 'kongruent'], ['~', 'ähnlich'], ['°', 'Grad'], ['′', 'Strich (f′)'], ['″', 'Doppelstrich (f″)'], ['⌀', 'Durchmesser'], ['̅', 'Strecke (Strich über)']]],
  ['Analysis', [['∑', 'Summe'], ['∏', 'Produkt'], ['∫', 'Integral'], ['∂', 'partiell'], ['Δ', 'Delta'], ['lim', 'Grenzwert'], ['→', 'gegen'], ['f′', 'f Strich'], ['f″', 'f zwei Strich'], ['∞', 'unendlich'], ['log', ''], ['ln', ''], ['sin', ''], ['cos', ''], ['tan', ''], ['e', '']]],
  ['Griechisch', [['α', 'alpha'], ['β', 'beta'], ['γ', 'gamma'], ['δ', 'delta'], ['ε', 'epsilon'], ['λ', 'lambda'], ['μ', 'my'], ['π', 'pi'], ['ρ', 'rho'], ['σ', 'sigma'], ['τ', 'tau'], ['φ', 'phi'], ['ω', 'omega'], ['Δ', 'Delta'], ['Σ', 'Sigma'], ['Ω', 'Omega'], ['Φ', 'Phi'], ['Λ', 'Lambda']]],
];

// Getippten Text hoch-/tiefstellen (Zeichen ohne Gegenstück bleiben)
export function shift(text, mode) {
  const map = mode === 'sup' ? SUP : mode === 'sub' ? SUB : null;
  if (!map) return text;
  return [...text].map((c) => map[c] ?? map[c.toLowerCase()] ?? c).join('');
}

// HTML für das Menü (tab = Index der Gruppe, mode = 'sup' | 'sub' | null)
export function mathPopHTML(tab, mode) {
  return `
    <div class="mk-head">
      <div class="mk-tabs">${MATH_TABS.map(([name], i) => `<button class="mk-tab${i === tab ? ' on' : ''}" data-mk-tab="${i}">${name}</button>`).join('')}</div>
      <div class="mk-modes">
        <button class="mk-mode${mode === 'sup' ? ' on' : ''}" data-mk-mode="sup" title="Getippte Zeichen hochstellen">x<sup>n</sup> Hoch</button>
        <button class="mk-mode${mode === 'sub' ? ' on' : ''}" data-mk-mode="sub" title="Getippte Zeichen tiefstellen">x<sub>n</sub> Tief</button>
      </div>
    </div>
    <div class="mk-grid">${MATH_TABS[tab][1]
      .map(([c, d]) => `<button class="mk-key${c.length > 2 ? ' wide' : ''}" data-mk="${c}" title="${d}">${c === '̅' ? 'A̅B̅' : c}</button>`)
      .join('')}</div>
    <p class="mk-note">${mode ? `${mode === 'sup' ? 'Hochstellen' : 'Tiefstellen'} ist an: Was du jetzt tippst, wird ${mode === 'sup' ? 'hoch' : 'tief'}gestellt. Nochmal antippen = aus.` : 'Tipp: „Hoch“ anmachen und z. B. 2 tippen → ²'}</p>`;
}
