// audio.js – Sprachaufnahme mit Schrift-Sync (wie in Samsung Notes)
//
// Aufnehmen: Im ⋮-Menü "Sprachaufnahme" -> "Aufnahme starten". Während der Aufnahme merkt sich
// jeder Strich, WANN du ihn geschrieben hast (stroke.rec = [aufnahmeId, anfang, ende] in ms).
//
// Abspielen: Die Striche erscheinen genau in dem Moment, in dem du sie beim Aufnehmen
// geschrieben hast – so hörst du zur Mitschrift, was der Lehrer dazu gesagt hat.
// Tippst du beim Abspielen mit dem Stift auf einen Strich, springt die Aufnahme dorthin.
//
// Die Aufnahme liegt als Datei im Speicher der App (IndexedDB, wie Bilder und PDFs), offline.
// In der Notiz steht nur die Liste: note.recordings = [{ id, blobId, name, created, duration, mime }]
//
// Viele Einstellungen (Qualität, Rauschunterdrückung, was beim Abspielen mit noch nicht
// Geschriebenem passiert …) gibt es unten im Aufnahme-Fenster.

import * as store from './store.js';
import { finishStroke } from './ink.js';
import { anchorRect } from './toolbarconfig.js';
import { toast, askText, confirmBox, esc } from './dialog.js';
import { canShareFile, shareFile, downloadFile } from './export.js';

const KEY = 'federleicht.audio';
export const DEFAULTS = {
  quality: 'standard',   // 'speech' (klein) | 'standard' | 'high'
  noise: true,           // Rauschunterdrückung
  echo: true,            // Echo-Unterdrückung
  gain: true,            // automatische Lautstärke
  sync: true,            // Striche mit der Aufnahme verknüpfen
  future: 'faint',       // noch nicht Geschriebenes beim Abspielen: 'hide' | 'faint' | 'show'
  others: false,         // Striche ohne Bezug zur Aufnahme beim Abspielen abblenden
  tapSeek: true,         // Strich antippen springt zur Stelle
  follow: true,          // beim Abspielen mitscrollen
  skip: 10,              // Sprung zurück/vor (Sekunden)
  speed: 1,              // Geschwindigkeit
  wake: true,            // Bildschirm bleibt an, solange aufgenommen wird
};
const BITRATE = { speech: 24000, standard: 64000, high: 128000 };
const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const ICON = {
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M8 5v14M16 5v14" stroke-width="3"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7L4 8.5"/><path d="M4 4v4.5h4.5"/></svg>',
  fwd: '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.4-5.7L20 8.5"/><path d="M20 4v4.5h-4.5"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>',
  more: '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/></svg>',
  list: '<svg viewBox="0 0 24 24"><path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.5" cy="6.5" r="1"/><circle cx="4.5" cy="12" r="1"/><circle cx="4.5" cy="17.5" r="1"/></svg>',
};

export function loadAudioSettings() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY)) };
  } catch {
    return { ...DEFAULTS };
  }
}

const fmt = (ms) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
};

export function setupAudio({ stage, doc, view, renderer, getNote, onChanged, scrollToStroke }) {
  const settings = loadAudioSettings();
  const saveSettings = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(settings));
    } catch {
      /* egal */
    }
  };

  // ======================================================================
  // Aufnehmen
  // ======================================================================
  let rec = null; // { id, recorder, stream, chunks, startedAt, pausedTotal, pausedAt, ctx, analyser, wake, mime }

  function supported() {
    return Boolean(navigator.mediaDevices?.getUserMedia && window.MediaRecorder);
  }

  function pickMime() {
    for (const m of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
      if (MediaRecorder.isTypeSupported?.(m)) return m;
    }
    return '';
  }

  async function startRecording() {
    if (rec) return;
    if (!getNote()) return;
    if (!supported()) return toast('Aufnehmen geht in diesem Browser leider nicht');
    stopPlayback();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { noiseSuppression: settings.noise, echoCancellation: settings.echo, autoGainControl: settings.gain },
      });
    } catch (err) {
      console.warn(err);
      return toast('Kein Zugriff aufs Mikrofon – in den Website-Einstellungen erlauben');
    }
    const mime = pickMime();
    const recorder = new MediaRecorder(stream, { mimeType: mime || undefined, audioBitsPerSecond: BITRATE[settings.quality] });
    rec = { id: store.uid(), recorder, stream, chunks: [], startedAt: performance.now(), pausedTotal: 0, pausedAt: 0, mime: recorder.mimeType || mime || 'audio/webm', note: getNote() };
    recorder.ondataavailable = (e) => e.data.size && rec?.chunks.push(e.data);
    recorder.start(1000); // jede Sekunde ein Stück (geht dann auch bei einem Absturz nicht alles verloren)
    // Pegel-Anzeige
    try {
      rec.ctx = new AudioContext();
      const src = rec.ctx.createMediaStreamSource(stream);
      rec.analyser = rec.ctx.createAnalyser();
      rec.analyser.fftSize = 512;
      src.connect(rec.analyser);
    } catch {
      /* ohne Pegel */
    }
    if (settings.wake) navigator.wakeLock?.request('screen').then((w) => rec && (rec.wake = w)).catch(() => {});
    showRecBar();
    onChanged?.();
  }

  // Zeit in der Aufnahme (ms), Pausen zählen nicht
  function recTime() {
    if (!rec) return 0;
    const now = rec.pausedAt || performance.now();
    return now - rec.startedAt - rec.pausedTotal;
  }

  function togglePause() {
    if (!rec) return;
    if (rec.pausedAt) {
      rec.pausedTotal += performance.now() - rec.pausedAt;
      rec.pausedAt = 0;
      rec.recorder.resume();
    } else {
      rec.pausedAt = performance.now();
      rec.recorder.pause();
    }
    updateRecBar();
  }

  // Aufnahme beenden und speichern
  async function stopRecording() {
    if (!rec) return;
    const r = rec;
    const duration = recTime();
    rec = null;
    hideRecBar();
    const done = new Promise((resolve) => (r.recorder.onstop = resolve));
    try {
      r.recorder.stop();
    } catch {
      /* war schon aus */
    }
    await Promise.race([done, new Promise((res) => setTimeout(res, 1500))]);
    r.stream.getTracks().forEach((t) => t.stop());
    r.ctx?.close().catch(() => {});
    r.wake?.release().catch(() => {});
    if (!r.chunks.length || duration < 500) {
      toast('Aufnahme war zu kurz');
      onChanged?.();
      return;
    }
    const blob = new Blob(r.chunks, { type: r.mime.split(';')[0] });
    const blobId = `rec-${r.id}`;
    await store.putBlob(blobId, blob);
    const note = r.note;
    note.recordings = note.recordings || [];
    const d = new Date();
    note.recordings.push({
      id: r.id,
      blobId,
      name: `Aufnahme ${note.recordings.length + 1} – ${d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' })}, ${d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}`,
      created: Date.now(),
      duration: Math.round(duration),
      mime: blob.type,
    });
    onChanged?.(true);
    toast(`Aufnahme gespeichert (${fmt(duration)})`);
  }

  // Für main.js: beim Strich-Anfang und -Ende die Aufnahme-Zeit holen (null = keine Aufnahme)
  function stamp() {
    if (!rec || rec.pausedAt || !settings.sync || rec.note !== getNote()) return null;
    return { id: rec.id, t: Math.round(recTime()) };
  }

  // ---------- Aufnahme-Leiste (unten in der Mitte) ----------
  let recBar = null;
  let meterFrame = 0;
  function showRecBar() {
    recBar = document.createElement('div');
    recBar.className = 'rec-bar';
    recBar.innerHTML = `
      <span class="rec-dot"></span>
      <span class="rec-time">0:00</span>
      <canvas class="rec-meter" width="120" height="28"></canvas>
      <button class="rec-btn" data-a="pause" title="Pause">${ICON.pause}</button>
      <button class="rec-btn stop" data-a="stop" title="Aufnahme beenden und speichern">${ICON.stop}</button>`;
    stage.appendChild(recBar);
    recBar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (a === 'pause') togglePause();
      if (a === 'stop') stopRecording();
    });
    const meter = recBar.querySelector('canvas');
    const mctx = meter.getContext('2d');
    const data = new Uint8Array(256);
    const bars = new Array(24).fill(0);
    let last = 0;
    const tick = (t) => {
      meterFrame = requestAnimationFrame(tick);
      if (!rec) return;
      if (t - last < 60) return;
      last = t;
      recBar.querySelector('.rec-time').textContent = fmt(recTime());
      let level = 0;
      if (rec.analyser && !rec.pausedAt) {
        rec.analyser.getByteTimeDomainData(data);
        for (const v of data) level = Math.max(level, Math.abs(v - 128) / 128);
      }
      bars.shift();
      bars.push(level);
      const dpr = window.devicePixelRatio || 1;
      if (meter.width !== 120 * dpr) {
        meter.width = 120 * dpr;
        meter.height = 28 * dpr;
      }
      mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      mctx.clearRect(0, 0, 120, 28);
      mctx.fillStyle = '#ff5a5f';
      bars.forEach((b, i) => {
        const h = Math.max(2, Math.min(26, b * 60));
        mctx.globalAlpha = 0.45 + 0.55 * (i / bars.length);
        mctx.fillRect(i * 5, 14 - h / 2, 3, h);
      });
    };
    meterFrame = requestAnimationFrame(tick);
    updateRecBar();
  }
  function updateRecBar() {
    if (!recBar || !rec) return;
    recBar.classList.toggle('paused', Boolean(rec.pausedAt));
    const b = recBar.querySelector('[data-a="pause"]');
    b.innerHTML = rec.pausedAt ? ICON.mic : ICON.pause;
    b.title = rec.pausedAt ? 'Weiter aufnehmen' : 'Pause';
  }
  function hideRecBar() {
    cancelAnimationFrame(meterFrame);
    recBar?.remove();
    recBar = null;
  }

  // ======================================================================
  // Abspielen mit Schrift-Sync
  // ======================================================================
  let play = null; // { r (Aufnahme), audio, url, frame, bar, lastFollow }

  async function startPlayback(r) {
    stopPlayback();
    const blob = await store.getBlob(r.blobId);
    if (!blob) return toast('Die Aufnahme-Datei fehlt');
    const url = URL.createObjectURL(blob);
    const audio = new Audio(url);
    audio.preload = 'auto';
    audio.playbackRate = settings.speed;
    play = { r, audio, url, frame: 0, bar: null, lastFollow: null, t: 0 };
    audio.addEventListener('ended', () => {
      if (!play) return;
      play.t = r.duration;
      updatePlayBar();
      renderer.requestRender();
    });
    showPlayBar();
    renderer.strokeView = strokeView;
    try {
      await audio.play();
    } catch (err) {
      console.warn(err);
    }
    loop();
  }

  function currentT() {
    if (!play) return 0;
    const t = play.audio.currentTime * 1000;
    return Number.isFinite(t) ? Math.min(t, play.r.duration) : 0;
  }

  function loop() {
    if (!play) return;
    play.frame = requestAnimationFrame(loop);
    const t = currentT();
    if (Math.abs(t - play.t) < 1 && play.audio.paused) return;
    play.t = t;
    updatePlayBar();
    renderer.requestRender();
    if (settings.follow && !play.audio.paused) follow(t);
  }

  // Mitscrollen: Wird gerade ein Strich geschrieben, der nicht zu sehen ist, dorthin scrollen
  function follow(t) {
    for (let i = 0; i < doc.pages.length; i++) {
      for (const s of doc.pages[i].strokes) {
        if (!s.rec || s.rec[0] !== play.r.id || t < s.rec[1] || t > s.rec[2] + 200) continue;
        if (play.lastFollow === s) return;
        play.lastFollow = s;
        scrollToStroke(i, s);
        return;
      }
    }
  }

  // So soll der Renderer einen Strich während des Abspielens malen
  function strokeView(s) {
    if (!play) return null;
    const mine = s.rec && s.rec[0] === play.r.id;
    if (!mine) return settings.others ? { alpha: 0.25 } : null;
    const t = play.t;
    const [, t0, t1] = s.rec;
    if (t >= t1) return null;
    if (t < t0) return settings.future === 'hide' ? { hide: true } : settings.future === 'faint' ? { alpha: 0.16 } : null;
    return { partial: t1 > t0 ? (t - t0) / (t1 - t0) : 1, alpha: settings.future === 'faint' ? 0.16 : 0 };
  }

  function seek(ms) {
    if (!play) return;
    play.audio.currentTime = Math.max(0, Math.min(play.r.duration, ms)) / 1000;
    play.t = currentT();
    play.lastFollow = null;
    updatePlayBar();
    renderer.requestRender();
  }

  function togglePlay() {
    if (!play) return;
    if (play.audio.paused) {
      if (play.t >= play.r.duration - 50) seek(0);
      play.audio.play().catch(() => {});
    } else play.audio.pause();
    updatePlayBar();
  }

  function stopPlayback() {
    if (!play) return;
    cancelAnimationFrame(play.frame);
    play.audio.pause();
    URL.revokeObjectURL(play.url);
    play.bar?.remove();
    play = null;
    renderer.strokeView = null;
    renderer.requestRender();
  }

  // Stift tippt beim Abspielen auf einen Strich -> dorthin springen. true = erledigt
  function tapSeek(page, p) {
    if (!play || !settings.tapSeek) return false;
    let best = null;
    let bestD = 18 / view.scale;
    for (const s of page.strokes) {
      if (!s.rec || s.rec[0] !== play.r.id || !s.box) continue;
      const b = s.box;
      if (p[0] < b.minX - bestD || p[0] > b.maxX + bestD || p[1] < b.minY - bestD || p[1] > b.maxY + bestD) continue;
      for (const q of s.points) {
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < bestD) {
          bestD = d;
          best = s;
        }
      }
    }
    if (!best) return false;
    seek(Math.max(0, best.rec[1] - 1500)); // etwas davor, damit man den Satz ganz hört
    if (play.audio.paused) togglePlay();
    return true;
  }

  // ---------- Abspiel-Leiste ----------
  function showPlayBar() {
    const bar = document.createElement('div');
    bar.className = 'play-bar';
    bar.innerHTML = `
      <button class="rec-btn" data-a="list" title="Alle Aufnahmen">${ICON.list}</button>
      <button class="rec-btn" data-a="back" title="Zurück"><span class="skip">${ICON.back}<b></b></span></button>
      <button class="rec-btn big" data-a="play" title="Abspielen / Pause"></button>
      <button class="rec-btn" data-a="fwd" title="Vor"><span class="skip">${ICON.fwd}<b></b></span></button>
      <div class="play-mid">
        <div class="play-name"></div>
        <div class="play-track"><i class="play-fill"></i><i class="play-knob"></i></div>
        <div class="play-times"><span class="pt-now">0:00</span><span class="pt-total"></span></div>
      </div>
      <button class="play-speed" data-a="speed" title="Geschwindigkeit"></button>
      <button class="rec-btn" data-a="close" title="Schließen">${ICON.close}</button>`;
    stage.appendChild(bar);
    play.bar = bar;
    bar.addEventListener('click', (e) => {
      const a = e.target.closest('[data-a]')?.dataset.a;
      if (!a) return;
      if (a === 'play') togglePlay();
      if (a === 'back') seek(play.t - settings.skip * 1000);
      if (a === 'fwd') seek(play.t + settings.skip * 1000);
      if (a === 'close') stopPlayback();
      if (a === 'list') openPanel(bar.querySelector('[data-a="list"]'));
      if (a === 'speed') {
        const i = SPEEDS.indexOf(play.audio.playbackRate);
        play.audio.playbackRate = SPEEDS[(i + 1) % SPEEDS.length];
        updatePlayBar();
      }
    });
    // Spulen: auf der Leiste tippen oder ziehen
    const track = bar.querySelector('.play-track');
    track.addEventListener('pointerdown', (e) => {
      track.setPointerCapture(e.pointerId);
      const to = (ev) => {
        const r = track.getBoundingClientRect();
        seek(((ev.clientX - r.left) / r.width) * play.r.duration);
      };
      to(e);
      const move = (ev) => to(ev);
      const up = () => {
        track.removeEventListener('pointermove', move);
        track.removeEventListener('pointerup', up);
        track.removeEventListener('pointercancel', up);
      };
      track.addEventListener('pointermove', move);
      track.addEventListener('pointerup', up);
      track.addEventListener('pointercancel', up);
    });
    updatePlayBar();
  }

  function updatePlayBar() {
    if (!play?.bar) return;
    const bar = play.bar;
    const f = play.r.duration ? play.t / play.r.duration : 0;
    bar.querySelector('.play-fill').style.width = `${f * 100}%`;
    bar.querySelector('.play-knob').style.left = `${f * 100}%`;
    bar.querySelector('.pt-now').textContent = fmt(play.t);
    bar.querySelector('.pt-total').textContent = fmt(play.r.duration);
    bar.querySelector('.play-name').textContent = play.r.name;
    bar.querySelector('[data-a="play"]').innerHTML = play.audio.paused ? ICON.play : ICON.pause;
    bar.querySelector('.play-speed').textContent = `${String(play.audio.playbackRate).replace('.', ',')}×`;
    for (const b of bar.querySelectorAll('.skip b')) b.textContent = settings.skip;
  }

  // ======================================================================
  // Das Fenster "Sprachaufnahme" (aus dem ⋮-Menü)
  // ======================================================================
  let panel = null;

  function openPanel(anchorEl) {
    closePanel();
    panel = document.createElement('div');
    panel.className = 'popup media-popup rec-panel';
    document.body.appendChild(panel);
    renderPanel();
    const b = anchorRect(anchorEl || document.getElementById('btn-record'));
    const w = panel.offsetWidth;
    panel.style.left = `${Math.max(8, Math.min(window.innerWidth - w - 8, b.right - w))}px`;
    if (b.top > window.innerHeight / 2) {
      panel.style.top = 'auto';
      panel.style.bottom = `${window.innerHeight - b.top + 12}px`;
    } else panel.style.top = `${b.bottom + 10}px`;
    panel.addEventListener('click', onPanelClick);
    panel.addEventListener('change', onPanelChange);
    setTimeout(() => window.addEventListener('pointerdown', outside, true), 0);
  }

  function outside(e) {
    if (!panel || panel.contains(e.target) || e.target.closest('.h-menu-pop, .rec-menu, .dlg-back')) return;
    closePanel();
    if (e.target.id === 'canvas') swallow(e);
  }

  function swallow(e) {
    e.stopPropagation();
    const id = e.pointerId;
    const stop = (ev) => {
      if (ev.pointerId !== id) return;
      ev.stopPropagation();
      if (ev.type !== 'pointermove') ['pointermove', 'pointerup', 'pointercancel'].forEach((t) => window.removeEventListener(t, stop, true));
    };
    ['pointermove', 'pointerup', 'pointercancel'].forEach((t) => window.addEventListener(t, stop, true));
  }

  function closePanel() {
    window.removeEventListener('pointerdown', outside, true);
    panel?.remove();
    panel = null;
    menu?.remove();
    menu = null;
  }

  const seg = (key, options) =>
    `<div class="op-seg">${options.map(([v, l]) => `<button data-seg="${key}" data-val='${JSON.stringify(v)}' class="${settings[key] === v ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const sw = (key, label, hint) =>
    `<label class="switch-row op-row"><span>${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="checkbox" class="switch" data-key="${key}" ${settings[key] ? 'checked' : ''} /></label>`;

  function renderPanel() {
    if (!panel) return;
    const note = getNote();
    const list = note?.recordings || [];
    const linked = (r) => doc.pages.reduce((n, p) => n + p.strokes.filter((s) => s.rec?.[0] === r.id).length, 0);
    panel.innerHTML = `
      <div class="popup-head">
        <span class="popup-title">Sprachaufnahme</span>
        <button class="head-btn" data-a="close" title="Schließen">${ICON.close}</button>
      </div>
      <div class="rp-scroll">
        ${rec
          ? `<button class="rp-big recording" data-a="stop">${ICON.stop}<span>Aufnahme beenden<small>Läuft seit ${fmt(recTime())} – wird gespeichert</small></span></button>`
          : `<button class="rp-big" data-a="record"${supported() ? '' : ' disabled'}>${ICON.mic}<span>Aufnahme starten<small>${supported() ? 'Was du jetzt schreibst, wird mit dem Ton verknüpft' : 'Geht in diesem Browser nicht'}</small></span></button>`}
        <div class="tp-group">Aufnahmen in dieser Notiz</div>
        ${list.length
          ? `<div class="rp-list">${list
              .map(
                (r) => `<div class="rp-item${play?.r.id === r.id ? ' on' : ''}" data-id="${r.id}">
                  <button class="rp-play" data-a="play" title="Abspielen">${play?.r.id === r.id && !play.audio.paused ? ICON.pause : ICON.play}</button>
                  <span class="rp-info"><b>${esc(r.name)}</b><small>${fmt(r.duration)} · ${linked(r)} Striche verknüpft</small></span>
                  <button class="rp-more" data-a="item" title="Mehr">${ICON.more}</button>
                </div>`
              )
              .join('')}</div>`
          : '<p class="op-note">Noch keine Aufnahme. Tipp: Starte die Aufnahme am Anfang der Stunde und schreib ganz normal mit.</p>'}
        <details class="rp-settings">
          <summary>Einstellungen</summary>
          <div class="tp-group">Aufnehmen</div>
          <div class="op-row op-seg-row"><span>Qualität<small>Höher = besserer Klang, aber größere Datei</small></span>${seg('quality', [['speech', 'Sprache'], ['standard', 'Standard'], ['high', 'Hoch']])}</div>
          ${sw('noise', 'Rauschunterdrückung', 'Lüfter, Rascheln und Gemurmel leiser')}
          ${sw('echo', 'Echo-Unterdrückung', 'Hilft in halligen Räumen')}
          ${sw('gain', 'Automatische Lautstärke', 'Leise Stimmen werden angehoben')}
          ${sw('sync', 'Schrift mit Aufnahme verknüpfen', 'Jeder Strich merkt sich, wann du ihn geschrieben hast')}
          ${sw('wake', 'Bildschirm bleibt an', 'Während der Aufnahme geht das Display nicht aus')}
          <div class="tp-group">Abspielen</div>
          <div class="op-row op-seg-row"><span>Noch nicht Geschriebenes<small>Was zu dieser Zeit noch nicht auf der Seite stand</small></span>${seg('future', [['hide', 'Ausblenden'], ['faint', 'Blass'], ['show', 'Normal']])}</div>
          ${sw('others', 'Andere Striche abblenden', 'Was nicht zur Aufnahme gehört, wird blass')}
          ${sw('tapSeek', 'Strich antippen = dorthin springen', 'Mit dem Stift auf einen Strich tippen')}
          ${sw('follow', 'Mitscrollen', 'Die Seite folgt der Schrift beim Abspielen')}
          <div class="op-row op-seg-row"><span>Sprung zurück/vor</span>${seg('skip', [[5, '5 s'], [10, '10 s'], [15, '15 s'], [30, '30 s']])}</div>
          <div class="op-row op-seg-row"><span>Geschwindigkeit</span>${seg('speed', SPEEDS.map((v) => [v, `${String(v).replace('.', ',')}×`]))}</div>
        </details>
        <p class="op-note">Die Aufnahmen bleiben auf dem Tablet (offline) und sind in der Sicherung mit drin.</p>
      </div>`;
    if (panelSettingsOpen) panel.querySelector('details').open = true;
    panel.querySelector('details').addEventListener('toggle', (e) => (panelSettingsOpen = e.target.open));
  }
  let panelSettingsOpen = false;

  function onPanelChange(e) {
    const key = e.target.dataset.key;
    if (!key) return;
    settings[key] = e.target.checked;
    saveSettings();
    renderer.requestRender();
  }

  function onPanelClick(e) {
    const segBtn = e.target.closest('[data-seg]');
    if (segBtn) {
      settings[segBtn.dataset.seg] = JSON.parse(segBtn.dataset.val);
      saveSettings();
      if (segBtn.dataset.seg === 'speed' && play) play.audio.playbackRate = settings.speed;
      renderer.requestRender();
      updatePlayBar();
      return renderPanel();
    }
    const a = e.target.closest('[data-a]')?.dataset.a;
    if (!a) return;
    const id = e.target.closest('[data-id]')?.dataset.id;
    const r = getNote()?.recordings?.find((x) => x.id === id);
    if (a === 'close') return closePanel();
    if (a === 'record') {
      closePanel();
      return startRecording();
    }
    if (a === 'stop') {
      closePanel();
      return stopRecording();
    }
    if (a === 'play' && r) {
      if (play?.r.id === r.id) togglePlay();
      else startPlayback(r);
      return setTimeout(renderPanel, 50);
    }
    if (a === 'item' && r) return openItemMenu(e.target.closest('[data-a]'), r);
  }

  // Kleines Menü an einer Aufnahme: umbenennen, teilen, löschen
  let menu = null;
  function openItemMenu(anchor, r) {
    menu?.remove();
    menu = document.createElement('div');
    menu.className = 'h-menu-pop rec-menu';
    menu.innerHTML = `
      <button data-m="rename"><span>Umbenennen</span></button>
      <button data-m="share"><span>Teilen / Speichern (Audio-Datei)</span></button>
      <button data-m="delete" class="danger"><span>Löschen</span></button>`;
    document.body.appendChild(menu);
    const b = anchor.getBoundingClientRect();
    menu.style.left = `${Math.max(8, b.right - menu.offsetWidth)}px`;
    menu.style.top = `${b.bottom + 6}px`;
    menu.addEventListener('click', async (e) => {
      const m = e.target.closest('[data-m]')?.dataset.m;
      if (!m) return;
      menu.remove();
      menu = null;
      const note = getNote();
      if (m === 'rename') {
        const name = await askText({ title: 'Aufnahme umbenennen', value: r.name, placeholder: 'Name' });
        if (name) {
          r.name = name;
          onChanged?.(true);
        }
      } else if (m === 'share') {
        const blob = await store.getBlob(r.blobId);
        if (!blob) return toast('Datei fehlt');
        const ext = blob.type.includes('mp4') ? 'm4a' : blob.type.includes('ogg') ? 'ogg' : 'webm';
        const file = new File([blob], `${r.name.replace(/[\\/:*?"<>|]+/g, '-')}.${ext}`, { type: blob.type });
        if (!(canShareFile(file) && (await shareFile(file, r.name)))) downloadFile(file);
      } else if (m === 'delete') {
        const ok = await confirmBox({ title: 'Aufnahme löschen?', text: `„${r.name}“ wird gelöscht. Die Schrift bleibt.`, ok: 'Löschen', danger: true });
        if (!ok) return;
        if (play?.r.id === r.id) stopPlayback();
        note.recordings = note.recordings.filter((x) => x.id !== r.id);
        // Verknüpfung an den Strichen lassen wir stehen (schadet nicht, kostet kaum Platz)
        onChanged?.(true);
      }
      renderPanel();
    });
  }

  return {
    get recording() {
      return Boolean(rec);
    },
    get playing() {
      return Boolean(play);
    },
    supported,
    stamp,
    startRecording,
    stopRecording,
    openPanel,
    closePanel,
    tapSeek,
    stopPlayback,
    // Notiz wird geschlossen: Aufnahme speichern, Abspielen beenden
    async leave() {
      closePanel();
      stopPlayback();
      if (rec) await stopRecording();
    },
  };
}

// Teil eines Strichs (für "wird gerade geschrieben" beim Abspielen)
export function partialStroke(s, f) {
  const n = Math.max(2, Math.ceil(s.points.length * Math.min(1, f)));
  if (n >= s.points.length) return s;
  return finishStroke({ ...s, points: s.points.slice(0, n), layers: null, box: null, fillPath: null, fill: null, fillAlpha: 0 });
}
