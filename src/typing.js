// typing.js – Tipp-Trainer auf der Startseite ("Tippen")
//
// Text abschreiben oder gegen die Uhr häufige Wörter tippen, wie bei 10FastFingers/Monkeytype:
//   - WPM = (richtig getippte Zeichen / 5) pro Minute, "roh" = alle getippten Zeichen
//   - Genauigkeit = richtige Anschläge / alle Anschläge (Fehler zählen, auch wenn verbessert)
//   - Uhr startet mit dem ersten Buchstaben
// Läuft mit Hardware-Tastatur und Bildschirmtastatur (über ein unsichtbares Eingabefeld, "input"-Ereignisse).
//
// Gespeichert in localStorage:
//   federleicht.typing  = { runs: [{ at, mode, src, wpm, raw, acc, secs, chars, errors }], texts: [{ id, title, text }], last: { src, secs } }

import { esc, toast, openDialog } from './dialog.js';

const KEY = 'federleicht.typing';

// Vorgegebene Texte (Robins Übungstexte)
export const BUILTIN_TEXTS = [
  {
    id: 'robin-1',
    title: 'Text 1 · Gender Roles',
    text: "\"Real men don't cry\" and \"a woman's place is in the home\" are sentences that many people associate with the 1950s. However, in recent years, so-called tradwives have become popular on social media by presenting exactly this lifestyle as an ideal. This trend raises the question of whether traditional gender roles still matter in a society that guarantees equal rights to men and women. In the following, I will discuss both sides of this question before coming to a conclusion.\n\nThe strongest argument against the importance of traditional roles is that equality is protected by law today. In Germany, Article 3 of the Basic Law states that men and women shall have equal rights. Women are allowed to vote, to study and to work in any profession they choose. For instance, until 1977 a married woman in Germany needed her husband's permission to take a job, which would be unthinkable today. Therefore, it can be argued that the traditional model of the male breadwinner has officially disappeared.\n\nFurthermore, younger generations increasingly reject old stereotypes. Many young men openly talk about their feelings, and more fathers take parental leave than ever before. In addition, the legalisation of same-sex marriage in 2017 shows that society has become more open to lifestyles that do not fit the traditional idea of a family.\n\nNevertheless, there are convincing reasons to believe that traditional roles still have a strong influence on our lives.\n\nFirstly, social media is making traditional roles popular again. Tradwife influencers such as \"Ballerina Farm\" reach millions of followers with glamorized videos of baking bread and raising children. At the same time, influencers like Andrew Tate promote an extreme image of masculinity in which men have to be dominant and must never show weakness. Since young users are easily impressionable, these ideas can shape how they see themselves and others.\n\nSecondly, traditional expectations harm men as well. The idea that men always have to be strong prevents many of them from seeking help when they have mental health problems. It should be emphasized that about three out of four suicides in Germany are committed by men. This shows that toxic masculinity is not just an outdated attitude but a serious problem.\n\nMost importantly, traditional roles still determine how families divide their work. Although most women are employed today, they are still expected to take care of the household and the children. Consequently, about half of all employed women in Germany work part-time, compared to only about one in nine men. This has long-term consequences: women earn around 16 percent less per hour than men and receive considerably lower pensions. Thus, the traditional model has not disappeared but has merely become less visible.\n\nTo sum up, equal rights have been achieved by law, and younger people are more open-minded than previous generations. However, I am convinced that traditional gender roles still matter, as they continue to influence family life, income and the mental health of men. Social media trends even risk bringing old ideals back. Only time will tell whether the next generation will overcome these roles, but this will only happen if men and women share paid and unpaid work equally.",
  },
  {
    id: 'robin-2',
    title: 'Text 2 · Tradwives',
    text: "Freshly baked bread, a spotless kitchen and smiling children: videos like these are shared by so-called tradwives, women who present their life as traditional homemakers on social media. Some of them have millions of followers. While their supporters see this lifestyle as a free choice, critics fear that it undermines decades of progress for women. This essay will discuss whether the tradwife movement is a step backwards for feminism.\n\nThe strongest argument in favour of the movement is that feminism is about freedom of choice. Feminism means that men and women should have the same rights and opportunities, and this includes the right to stay at home. Therefore, it would be contradictory to criticise a woman who freely decides to become a homemaker. In particular, a former tradwife in a talk show we watched in class pointed out that a career outside the home is not the only fulfilling path in life.\n\nMoreover, the movement shows that housework and raising children are demanding and valuable work. This kind of unpaid care work is often overlooked, although women worldwide do about three times as much of it as men. In this respect, tradwife content could lead to more recognition for homemakers.\n\nEven though these arguments deserve attention, I believe that the negative effects of the trend clearly outweigh the positive ones.\n\nFirstly, the lifestyle that is shown on social media is not authentic. The videos are staged, edited and often filtered, so the hard and repetitive parts of housework remain invisible. Ironically, many tradwives earn a lot of money as content creators, which means that their \"traditional\" life is actually a modern business.\n\nSecondly, this glamorized image sets up wrong expectations for young viewers. Teenagers are easily impressionable and may come to believe that being a homemaker is the only way for a woman to be happy. As a result, the trend reinforces stereotypes that the women's rights movement has fought against for more than a century, from the suffragettes to the fight for equal pay.\n\nAbove all, the tradwife model makes women financially dependent on their husbands. A woman without her own income is at the mercy of her partner, especially if the relationship ends. For example, roughly one in three marriages in Germany ends in divorce, and women already receive considerably lower pensions than men. For this reason, the former tradwife in the talk show advised women to invest in themselves and to have their own money.\n\nAll in all, every woman should have the right to choose how she wants to live, and the work of homemakers deserves more respect. Nevertheless, I strongly believe that the tradwife movement is a step backwards for feminism, because it presents an unrealistic ideal and hides the risk of financial dependence. It is hoped that young people will learn to view such content critically and understand that real freedom of choice requires financial independence.",
  },
];

// Die häufigsten deutschen Wörter (für "Wörter gegen die Uhr")
const WORDS = (
  'der die und in den von zu das mit sich des auf für ist im dem nicht ein eine als auch es an werden aus er hat dass sie nach wird bei einer um am sind noch wie einem über einen so zum war haben nur oder aber vor zur bis mehr durch man sein wurde sei ' +
  'hatte kann gegen vom können schon wenn habe seine ihre dann unter wir soll ich eines jahr zwei jahre diese dieser wieder keine uhr seiner worden will zwischen immer was sagte gibt alle diesem seit muss wurden beim doch jetzt waren drei neue damit bereits da ihr ' +
  'seinen müssen ab ihrer ihren ihm sagt heute schule zeit tag woche stunde lehrer klasse aufgabe buch seite heft frage antwort beispiel ende anfang leben welt land stadt haus weg hand kopf auge wort satz ' +
  'gut neu groß klein lang kurz hoch alt jung schnell langsam leicht schwer früh spät viel wenig ganz richtig falsch gleich anders wichtig einfach möglich klar sicher genau ' +
  'machen sagen gehen kommen sehen geben stehen finden bleiben liegen denken nehmen tun dürfen halten lassen zeigen führen sprechen bringen leben fahren meinen fragen kennen gelten stellen spielen arbeiten brauchen folgen lernen schreiben lesen rechnen üben'
).split(' ');

const ICON = {
  keys: '<svg viewBox="0 0 24 24"><rect x="2.5" y="6" width="19" height="12" rx="2.5"/><path d="M6 9.5h.01M9 9.5h.01M12 9.5h.01M15 9.5h.01M18 9.5h.01M6 12.5h.01M18 12.5h.01M8.5 15h7"/></svg>',
  restart: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4h4"/></svg>',
  trophy: '<svg viewBox="0 0 24 24"><path d="M8 4.5h8v5a4 4 0 0 1-8 0zM8 6.5H4.5a3 3 0 0 0 3.5 3.5M16 6.5h3.5a3 3 0 0 1-3.5 3.5M12 13.5v3M8.5 20h7M10 16.5h4v3.5h-4z"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M5 12h14M12 5v14"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>',
  flag: '<svg viewBox="0 0 24 24"><path d="M5.5 21V4.5M5.5 4.5h11l-2.5 4 2.5 4h-11"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="m14.5 5.5-6.5 6.5 6.5 6.5"/></svg>',
};

function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY));
    if (d && typeof d === 'object') return { runs: [], texts: [], last: {}, ...d };
  } catch {
    /* nichts gespeichert */
  }
  return { runs: [], texts: [], last: {} };
}
function save(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* egal */
  }
}

// Absätze eines Textes (getrennt durch Leerzeilen)
const paragraphs = (text) => String(text || '').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);

// Text vereinheitlichen: typografische Zeichen, die auf der Tastatur schwer zu finden sind, ersetzen
function tidy(text) {
  return String(text || '')
    .replace(/[‘’‚]/g, "'")
    .replace(/[“”„«»]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function shuffleWords(n) {
  const out = [];
  let prev = '';
  while (out.length < n) {
    const w = WORDS[Math.floor(Math.random() * WORDS.length)];
    if (w !== prev) out.push(w);
    prev = w;
  }
  return out.join(' ');
}

const fmtTime = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function setupTyping() {
  const data = load();
  const el = document.createElement('div');
  el.className = 'ty';
  // Zustand
  let src = data.last.src || 'robin-1'; // Text-ID oder 'words'
  let secs = data.last.secs || 60; // Dauer bei 'words'
  let part = data.last.part || 'all'; // 'all' oder Absatz-Nummer (0, 1, …) bei Texten
  let target = '';
  let typed = '';
  let started = 0;
  let finished = null; // Ergebnis
  let keystrokes = 0;
  let wrongStrokes = 0;
  let missByChar = new Map(); // Zeichen -> wie oft falsch
  let samples = []; // [{ t, wpm, err }] einmal pro Sekunde
  let timer = 0;
  let screen = 'test'; // 'test' | 'result'

  const allTexts = () => [...BUILTIN_TEXTS, ...data.texts];
  const textOf = (id) => allTexts().find((t) => t.id === id);

  function newTarget() {
    if (src === 'words') target = shuffleWords(Math.max(80, Math.round(secs * 2.5)));
    else {
      const paras = paragraphs(textOf(src)?.text || BUILTIN_TEXTS[0].text);
      if (part !== 'all' && !paras[part]) part = 'all';
      target = tidy(part === 'all' ? paras.join(' ') : paras[part]);
    }
  }

  function reset() {
    clearInterval(timer);
    timer = 0;
    typed = '';
    started = 0;
    finished = null;
    keystrokes = 0;
    wrongStrokes = 0;
    missByChar = new Map();
    samples = [];
    screen = 'test';
    newTarget();
    draw();
    focusInput();
  }

  // ---------- Zahlen ----------
  // Wortweise wie bei 10FastFingers: Leertaste springt zum nächsten Wort, ein fehlender
  // Buchstabe verschiebt nicht den ganzen Rest. Gezählt: Zeichen richtiger Wörter (+ Leerzeichen)
  // und beim aktuellen Wort der richtige Anfang.
  const tWords = () => target.split(' ');
  function correctChars() {
    const tw = tWords();
    const uw = typed.split(' ');
    let n = 0;
    for (let i = 0; i < uw.length; i++) {
      const last = i === uw.length - 1;
      if (!last) {
        if (uw[i] === tw[i]) n += uw[i].length + 1;
      } else if (tw[i] && tw[i].startsWith(uw[i])) n += uw[i].length;
    }
    return n;
  }
  const elapsed = () => (started ? (performance.now() - started) / 1000 : 0);
  function stats(t = elapsed()) {
    const min = Math.max(t, 1) / 60;
    const ok = correctChars();
    return {
      wpm: Math.round(ok / 5 / min),
      raw: Math.round(typed.length / 5 / min),
      acc: keystrokes ? Math.round(((keystrokes - wrongStrokes) / keystrokes) * 1000) / 10 : 100,
      ok,
      t,
    };
  }

  // ---------- Aufbau ----------
  function draw() {
    if (screen === 'result') return drawResult();
    const best = bestFor(src);
    el.innerHTML = `
      <div class="ty-top">
        <div class="ty-pick">
          ${allTexts()
            .map((t) => `<button class="ty-chip${src === t.id ? ' on' : ''}" data-ty="src" data-v="${esc(t.id)}">${esc(t.title)}</button>`)
            .join('')}
          <button class="ty-chip${src === 'words' ? ' on' : ''}" data-ty="src" data-v="words">Wörter</button>
          <button class="ty-chip add" data-ty="add" title="Eigenen Text hinzufügen" aria-label="Eigenen Text hinzufügen">${ICON.plus}</button>
        </div>
        ${
          src === 'words'
            ? `<div class="ty-seg">${[15, 30, 60, 120].map((s) => `<button class="${secs === s ? 'on' : ''}" data-ty="secs" data-v="${s}">${s < 60 ? `${s} s` : `${s / 60} min`}</button>`).join('')}</div>`
            : partsHtml()
        }
      </div>
      <div class="ty-live">
        <div class="ty-num big"><b data-live="wpm">0</b><small>WPM</small></div>
        <div class="ty-num"><b data-live="acc">100</b><small>% genau</small></div>
        <div class="ty-num"><b data-live="time">${src === 'words' ? fmtTime(secs) : '0:00'}</b><small>${src === 'words' ? 'übrig' : 'Zeit'}</small></div>
        <div class="ty-num"><b data-live="prog">0</b><small>% geschafft</small></div>
        ${best ? `<div class="ty-best">${ICON.trophy}Bestwert <b>${best.wpm}</b> WPM</div>` : ''}
      </div>
      <div class="ty-box" data-ty="focus">
        <div class="ty-view"><div class="ty-text"></div></div>
        <div class="ty-hint">Einfach lostippen – die Zeit startet mit dem ersten Buchstaben.</div>
        <textarea class="ty-input" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Hier tippen"></textarea>
      </div>
      <div class="ty-actions">
        <button class="ty-btn" data-ty="restart">${ICON.restart}Neu starten <kbd>Esc</kbd></button>
        ${src !== 'words' ? `<button class="ty-btn" data-ty="stop">${ICON.flag}Hier beenden</button>` : ''}
        <span class="ty-meta">${src === 'words' ? 'Häufige deutsche Wörter' : `${target.split(' ').length} Wörter · ${target.length} Zeichen`}</span>
      </div>
      ${historyHtml()}`;
    renderText();
    const input = el.querySelector('.ty-input');
    input.addEventListener('input', onInput);
    input.addEventListener('keydown', onKey);
    input.addEventListener('focus', () => el.querySelector('.ty-box').classList.add('focus'));
    input.addEventListener('blur', () => el.querySelector('.ty-box')?.classList.remove('focus'));
  }

  // Auswahl: ganzer Text oder ein Absatz (bei langen Texten)
  function partsHtml() {
    const paras = paragraphs(textOf(src)?.text);
    const del = textOf(src) && !BUILTIN_TEXTS.some((b) => b.id === src) ? `<button class="ty-del" data-ty="del" title="Text löschen">${ICON.trash}</button>` : '';
    if (paras.length < 2) return del;
    const words = (p) => p.split(/\s+/).length;
    return `<div class="ty-seg ty-parts"><button class="${part === 'all' ? 'on' : ''}" data-ty="part" data-v="all" title="${words(paras.join(' '))} Wörter">Ganz</button>${paras
      .map((p, i) => `<button class="${part === i ? 'on' : ''}" data-ty="part" data-v="${i}" title="${words(p)} Wörter">${i + 1}</button>`)
      .join('')}</div>${del}`;
  }

  // Text als Wörter (Zeilenumbruch nur zwischen Wörtern), jedes Wort wird einzeln neu gemalt
  function renderText() {
    const box = el.querySelector('.ty-text');
    if (!box) return;
    box.innerHTML = tWords()
      .map((w, i) => `<span class="ty-w" data-w="${i}"></span>`)
      .join('<span class="ty-sp"> </span>');
    const n = tWords().length;
    for (let i = 0; i < n; i++) paintWord(i);
    follow();
  }

  function paintWord(i) {
    const node = el.querySelector(`.ty-w[data-w="${i}"]`);
    if (!node) return;
    const want = tWords()[i] || '';
    const uw = typed.split(' ');
    const cur = uw.length - 1;
    const got = i <= cur ? uw[i] : null;
    let html = '';
    for (let j = 0; j < want.length; j++) {
      const cls = got == null || j >= got.length ? (i < cur ? 'miss' : '') : got[j] === want[j] ? 'ok' : 'bad';
      html += `<i class="${cls}${i === cur && j === got.length ? ' cur' : ''}">${esc(want[j])}</i>`;
    }
    // zu viel getippt: rot hinten dran
    if (got && got.length > want.length) html += `<i class="extra">${esc(got.slice(want.length))}</i>`;
    if (i === cur && got.length >= want.length) html += '<i class="cur end"></i>';
    node.innerHTML = html;
    node.classList.toggle('wrong', i < cur && got !== want);
  }

  // aktuelle Zeile immer als zweite Zeile zeigen
  function follow() {
    const box = el.querySelector('.ty-text');
    const cur = box?.querySelector('.cur');
    if (!cur) return;
    const w = cur.closest('.ty-w');
    const lh = w.offsetHeight || 40;
    box.style.transform = `translateY(${-Math.max(0, w.offsetTop - lh * 0.98)}px)`;
  }
  function onKey(e) {
    if (e.key === 'Escape' || (e.key === 'Enter' && finished)) {
      e.preventDefault();
      reset();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      reset();
    }
  }

  function onInput(e) {
    if (screen !== 'test' || finished) return;
    const input = e.target;
    // Zeilenumbruch = Leerzeichen, keine doppelten Leerzeichen, nicht mit Leerzeichen anfangen
    let v = input.value.replace(/\n/g, ' ').replace(/ {2,}/g, ' ').replace(/^ /, '');
    const tw = tWords();
    // nicht über das letzte Wort hinaus
    if (v.split(' ').length > tw.length) v = v.split(' ').slice(0, tw.length).join(' ');
    const prev = typed;
    if (!started && v.length) start();
    // Neue Anschläge zählen (nur was dazukommt; Löschen zählt nicht)
    if (v.length > prev.length && v.startsWith(prev)) {
      for (let k = prev.length; k < v.length; k++) {
        keystrokes++;
        const before = v.slice(0, k).split(' ');
        const wi = before.length - 1;
        const ci = before[wi].length;
        const want = tw[wi] || '';
        let wrong;
        let ch;
        if (v[k] === ' ') {
          wrong = before[wi] !== want; // Wort unvollständig oder falsch abgeschickt
          ch = '␣';
        } else {
          wrong = v[k] !== want[ci];
          ch = want[ci] ?? '+';
        }
        if (wrong) {
          wrongStrokes++;
          missByChar.set(ch, (missByChar.get(ch) || 0) + 1);
        }
      }
    } else if (v.length > prev.length) keystrokes++;
    typed = v;
    if (input.value !== v) input.value = v;
    // betroffene Wörter neu malen
    const a = Math.max(0, prev.split(' ').length - 2);
    const b = v.split(' ').length;
    for (let i = a; i <= Math.max(b, prev.split(' ').length); i++) paintWord(i);
    follow();
    tick();
    const uw = v.split(' ');
    if (src !== 'words' && uw.length === tw.length && uw.at(-1).length >= tw.at(-1).length) return finish();
    // Wörter-Modus: rechtzeitig Nachschub
    if (src === 'words' && tw.length - uw.length < 25) {
      target += ' ' + shuffleWords(40);
      renderText();
    }
  }

  function start() {
    started = performance.now();
    el.querySelector('.ty-hint')?.classList.add('gone');
    timer = setInterval(() => {
      const t = elapsed();
      const s = stats(t);
      samples.push({ t: Math.round(t), wpm: s.wpm, raw: s.raw, err: wrongStrokes });
      tick();
      if (src === 'words' && t >= secs) finish();
    }, 1000);
  }

  function tick() {
    const s = stats();
    const set = (k, v) => {
      const n = el.querySelector(`[data-live="${k}"]`);
      if (n) n.textContent = v;
    };
    set('wpm', started ? s.wpm : 0);
    set('acc', String(s.acc).replace('.', ','));
    set('time', src === 'words' ? fmtTime(Math.max(0, secs - s.t)) : fmtTime(s.t));
    set('prog', src === 'words' ? Math.min(100, Math.round((s.t / secs) * 100)) : Math.min(100, Math.round((correctChars() / target.length) * 100)));
  }

  function finish() {
    clearInterval(timer);
    timer = 0;
    const t = src === 'words' ? secs : elapsed();
    const s = stats(t);
    // Wörter auswerten
    const tw = tWords();
    const uw = typed.split(' ');
    let wordsOk = 0;
    let wordsBad = 0;
    const missedWords = new Map();
    uw.forEach((got, i) => {
      const w = tw[i];
      // das letzte, angefangene Wort nur zählen, wenn es fertig ist
      if (!w || (i === uw.length - 1 && got.length < w.length)) return;
      if (got === w) wordsOk++;
      else {
        wordsBad++;
        const clean = w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '') || w;
        missedWords.set(clean, (missedWords.get(clean) || 0) + 1);
      }
    });
    const prevBest = bestFor(src);
    finished = {
      ...s,
      t,
      wordsOk,
      wordsBad,
      errors: wrongStrokes,
      missedWords: [...missedWords.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      missedChars: [...missByChar.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8),
      samples: samples.slice(),
      record: !prevBest || s.wpm > prevBest.wpm,
      prevBest: prevBest?.wpm || 0,
    };
    // Nur zählen, wenn wirklich getippt wurde
    if (typed.length >= 10 && t >= 3) {
      data.runs.push({ at: Date.now(), mode: src === 'words' ? 'words' : 'text', src, wpm: s.wpm, raw: s.raw, acc: s.acc, secs: Math.round(t), chars: typed.length, errors: wrongStrokes });
      if (data.runs.length > 300) data.runs = data.runs.slice(-300);
    }
    data.last = { src, secs, part };
    save(data);
    screen = 'result';
    draw();
  }

  function bestFor(id) {
    return data.runs.filter((r) => r.src === id).sort((a, b) => b.wpm - a.wpm)[0] || null;
  }

  // ---------- Ergebnis ----------
  function drawResult() {
    const r = finished;
    const title = src === 'words' ? `Wörter · ${secs < 60 ? `${secs} s` : `${secs / 60} min`}` : `${textOf(src)?.title || 'Text'}${part === 'all' ? '' : ` · Absatz ${part + 1}`}`;
    const grade = r.wpm >= 70 ? ['Wahnsinn!', '🚀'] : r.wpm >= 55 ? ['Sehr schnell!', '🔥'] : r.wpm >= 40 ? ['Gut dabei!', '💪'] : ['Weiter üben!', '🌱'];
    el.innerHTML = `
      <div class="ty-res">
        <div class="ty-res-head">
          <span class="ty-res-kicker">${esc(title)} · ${grade[0]} ${grade[1]}</span>
          ${r.record ? `<span class="ty-record">${ICON.trophy}Neuer Bestwert${r.prevBest ? ` (vorher ${r.prevBest})` : ''}</span>` : ''}
        </div>
        <div class="ty-res-main">
          <div class="ty-res-wpm"><b>${r.wpm}</b><span>WPM</span></div>
          <div class="ty-res-grid">
            <div><b>${String(r.acc).replace('.', ',')} %</b><small>Genauigkeit</small></div>
            <div><b>${r.raw}</b><small>WPM roh</small></div>
            <div><b>${fmtTime(r.t)}</b><small>Zeit</small></div>
            <div><b>${r.errors}</b><small>Tippfehler</small></div>
            <div><b>${r.wordsOk}</b><small>Wörter richtig</small></div>
            <div><b>${r.wordsBad}</b><small>Wörter falsch</small></div>
          </div>
        </div>
        ${chart(r.samples)}
        ${
          r.missedWords.length || r.missedChars.length
            ? `<div class="ty-miss">
          ${r.missedChars.length ? `<div><div class="ty-sub">Am häufigsten vertippt</div><div class="ty-keys">${r.missedChars.map(([c, n]) => `<span class="ty-key"><b>${esc(c)}</b><small>${n}×</small></span>`).join('')}</div></div>` : ''}
          ${r.missedWords.length ? `<div><div class="ty-sub">Wörter zum Üben</div><div class="ty-words">${r.missedWords.map(([w]) => `<span>${esc(w)}</span>`).join('')}</div></div>` : ''}
        </div>`
            : '<p class="ty-perfect">Kein einziger Fehler – perfekt! ✨</p>'
        }
        <div class="ty-actions">
          <button class="ty-btn primary" data-ty="restart">${ICON.restart}Nochmal <kbd>Enter</kbd></button>
          <button class="ty-btn" data-ty="src" data-v="${src === 'words' ? allTexts()[0].id : 'words'}">${src === 'words' ? 'Text abschreiben' : 'Wörter gegen die Uhr'}</button>
        </div>
        <textarea class="ty-input" aria-hidden="true" tabindex="-1"></textarea>
      </div>
      ${historyHtml()}`;
    const input = el.querySelector('.ty-input');
    input.addEventListener('keydown', onKey);
    focusInput();
  }

  // WPM-Verlauf während des Tests (SVG)
  function chart(list) {
    if (list.length < 3) return '';
    const W = 600;
    const H = 120;
    const maxT = list.at(-1).t || 1;
    const maxV = Math.max(20, ...list.map((s) => s.raw)) * 1.1;
    const x = (t) => ((t / maxT) * W).toFixed(1);
    const y = (v) => (H - (v / maxV) * H).toFixed(1);
    const line = (k) => list.map((s, i) => `${i ? 'L' : 'M'}${x(s.t)} ${y(s[k])}`).join(' ');
    // Fehler-Punkte: Sekunden, in denen neue Fehler dazukamen
    const errs = list.filter((s, i) => i && s.err > list[i - 1].err).map((s) => `<circle cx="${x(s.t)}" cy="${y(s.wpm)}" r="4"/>`).join('');
    return `<div class="ty-chart">
        <div class="ty-sub">Tempo während des Tests <span class="ty-legend"><i class="a"></i>WPM <i class="b"></i>roh <i class="c"></i>Fehler</span></div>
        <svg viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none">
          <path class="raw" d="${line('raw')}"/>
          <path class="area" d="${line('wpm')} L${W} ${H} L0 ${H} Z"/>
          <path class="wpm" d="${line('wpm')}"/>
          <g class="err">${errs}</g>
        </svg>
      </div>`;
  }

  // Verlauf: Bestwert, Schnitt der letzten 10, kleine Kurve, letzte Läufe
  function historyHtml() {
    const runs = data.runs;
    if (!runs.length) return '';
    const last10 = runs.slice(-10);
    const avg = Math.round(last10.reduce((a, r) => a + r.wpm, 0) / last10.length);
    const avgAcc = (last10.reduce((a, r) => a + r.acc, 0) / last10.length).toFixed(1).replace('.', ',');
    const best = runs.reduce((m, r) => (r.wpm > m.wpm ? r : m), runs[0]);
    const first = runs.slice(0, 5);
    const startAvg = Math.round(first.reduce((a, r) => a + r.wpm, 0) / first.length);
    const pts = runs.slice(-30);
    const max = Math.max(...pts.map((r) => r.wpm), 10) * 1.1;
    const W = 300;
    const H = 60;
    const path = pts.map((r, i) => `${i ? 'L' : 'M'}${((i / Math.max(1, pts.length - 1)) * W).toFixed(1)} ${(H - (r.wpm / max) * H).toFixed(1)}`).join(' ');
    const name = (r) => (r.src === 'words' ? `Wörter ${r.secs < 60 ? `${r.secs} s` : `${Math.round(r.secs / 60)} min`}` : textOf(r.src)?.title || 'Text');
    const when = (ts) => {
      const d = new Date(ts);
      const today = new Date();
      const same = d.toDateString() === today.toDateString();
      return same ? `heute ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : `${d.getDate()}.${d.getMonth() + 1}.`;
    };
    return `<section class="ty-hist">
        <div class="ty-hist-stats">
          <div><b>${best.wpm}</b><small>Bestwert WPM</small></div>
          <div><b>${avg}</b><small>Schnitt (letzte ${last10.length})</small></div>
          <div><b>${avgAcc} %</b><small>Genauigkeit</small></div>
          <div><b>${runs.length >= 6 ? `${avg - startAvg >= 0 ? '+' : ''}${avg - startAvg}` : runs.length}</b><small>${runs.length >= 6 ? 'WPM seit Beginn' : 'Läufe'}</small></div>
          ${pts.length > 1 ? `<svg class="ty-spark" viewBox="0 0 ${W} ${H + 4}" preserveAspectRatio="none"><path d="${path}"/></svg>` : ''}
        </div>
        <div class="ty-runs">${runs
          .slice(-6)
          .reverse()
          .map((r) => `<div class="ty-run"><b>${r.wpm}</b><span>WPM</span><small>${String(r.acc).replace('.', ',')} % · ${esc(name(r))} · ${when(r.at)}</small></div>`)
          .join('')}</div>
      </section>`;
  }

  function focusInput() {
    requestAnimationFrame(() => el.querySelector('.ty-input')?.focus({ preventScroll: true }));
  }

  // Eigenen Text hinzufügen
  async function addText() {
    const res = await openDialog({
      wide: true,
      enter: false,
      html: `<div class="dlg-title">Eigenen Text hinzufügen</div>
        <input class="dlg-input ty-new-title" maxlength="40" placeholder="Name, z. B. Text 3" />
        <textarea class="dlg-input ty-new-text" rows="7" placeholder="Text hier einfügen …"></textarea>
        <div class="dlg-btns"><button class="dlg-btn" data-dlg="cancel">Abbrechen</button><button class="dlg-btn primary" data-dlg="ok">Hinzufügen</button></div>`,
      onReady(card) {
        setTimeout(() => card.querySelector('.ty-new-text')?.focus(), 60);
      },
      result(card) {
        const text = tidy(card.querySelector('.ty-new-text').value);
        if (text.length < 10) return undefined;
        return { title: card.querySelector('.ty-new-title').value.trim() || `Text ${allTexts().length + 1}`, text };
      },
    });
    if (!res) return focusInput();
    const t = { id: `own-${Date.now().toString(36)}`, ...res };
    data.texts.push(t);
    save(data);
    src = t.id;
    toast('Text hinzugefügt');
    reset();
  }

  el.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ty]');
    if (!b) return focusInput();
    const k = b.dataset.ty;
    if (k === 'src') {
      src = b.dataset.v;
      part = 'all';
      data.last = { src, secs, part };
      save(data);
      reset();
    } else if (k === 'part') {
      part = b.dataset.v === 'all' ? 'all' : Number(b.dataset.v);
      data.last = { src, secs, part };
      save(data);
      reset();
    } else if (k === 'stop') {
      if (started && !finished) finish();
    } else if (k === 'secs') {
      secs = Number(b.dataset.v);
      data.last = { src, secs, part };
      save(data);
      reset();
    } else if (k === 'restart') reset();
    else if (k === 'focus') focusInput();
    else if (k === 'add') await addText();
    else if (k === 'del') {
      data.texts = data.texts.filter((t) => t.id !== src);
      src = BUILTIN_TEXTS[0].id;
      save(data);
      toast('Text gelöscht');
      reset();
    }
  });

  newTarget();
  draw();

  return {
    // In die Startseite einhängen (das Element bleibt bestehen, ein laufender Test geht nicht verloren)
    mount(parent) {
      if (el.parentNode !== parent) parent.replaceChildren(el);
      if (screen === 'test') requestAnimationFrame(follow);
      focusInput();
    },
    // Startseite verlassen / anderer Bereich: laufenden Test abbrechen
    leave() {
      if (started && !finished) reset();
    },
  };
}
