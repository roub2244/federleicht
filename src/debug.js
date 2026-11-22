// debug.js – das Diagnose-Fenster
// Zeigt live an, was der S Pen an die App schickt. Damit kannst du mir
// genau sagen, was dein Tablet beim Drücken des Stiftknopfs meldet.

const BUTTON_NAMES = { 1: 'Spitze', 2: 'Knopf', 4: 'Mitte', 32: 'Radierer' };

// buttons = 3 -> "1+2 (Spitze, Knopf)"
function describeButtons(buttons) {
  const parts = Object.keys(BUTTON_NAMES).filter((bit) => buttons & bit);
  if (parts.length === 0) return '0';
  return `${buttons} (${parts.map((bit) => BUTTON_NAMES[bit]).join(', ')})`;
}

export class Debug {
  constructor(element, renderer) {
    this.el = element;
    this.renderer = renderer;
    this.latest = null;
    this.lines = [];        // Protokoll der letzten wichtigen Ereignisse
    this.lastSignature = '';
    this.frame = 0;
    this.moveTimes = [];    // für "Stift-Events pro Sekunde"
    // Zähler: Wie oft kam welches mögliche Knopf-Signal an?
    this.seen = { buttons2: 0, buttons32: 0, button2: 0, button5: 0, mouse: 0, keys: 0, menu: 0 };

    this.el.innerHTML = `
      <h3>Stift-Diagnose <span><button data-clear>Leeren</button> <button data-copy>Kopieren</button></span></h3>
      <dl>
        <dt>Gerät</dt><dd data-f="pointerType">–</dd>
        <dt>Ereignis</dt><dd data-f="type">–</dd>
        <dt>button</dt><dd data-f="button">–</dd>
        <dt>buttons</dt><dd data-f="buttons">–</dd>
        <dt>Druck</dt><dd><span data-f="pressure">–</span><div class="bar"><i data-f="pressureBar"></i></div></dd>
        <dt>Neigung</dt><dd data-f="tilt">–</dd>
        <dt>Größe</dt><dd data-f="size">–</dd>
        <dt>Punkte</dt><dd data-f="points">–</dd>
        <dt>Rate</dt><dd data-f="rate">–</dd>
        <dt>Modus</dt><dd class="mode" data-f="status">–</dd>
        <dt>Low-Latency</dt><dd>${renderer.lowLatency ? 'ja' : 'nein'}</dd>
        <dt>Knopf-Signale</dt><dd data-f="seen">noch keine</dd>
      </dl>
      <div class="log" data-f="log">Halte den Stift über das Blatt …</div>
      <textarea class="copy-box" data-f="copyBox" readonly hidden></textarea>`;

    this.fields = {};
    for (const node of this.el.querySelectorAll('[data-f]')) this.fields[node.dataset.f] = node;
    this.el.querySelector('[data-copy]').addEventListener('click', () => this.copy());
    this.el.querySelector('[data-clear]').addEventListener('click', () => this.clear());
    this.watchOtherEvents();
  }

  // Manche Stifte melden ihren Knopf nicht als Pointer Event, sondern z. B. als
  // Tastendruck oder Kontextmenü. Diese Events schreiben wir auch ins Protokoll.
  watchOtherEvents() {
    const types = ['keydown', 'keyup', 'contextmenu', 'auxclick', 'mousedown', 'mouseup'];
    for (const type of types) {
      window.addEventListener(type, (e) => this.recordOther(e), { capture: true });
    }
  }

  recordOther(e) {
    if (this.el.contains(e.target)) return; // Klicks im Diagnose-Fenster selbst ignorieren
    if (e.type.startsWith('key')) this.seen.keys++;
    if (e.type === 'contextmenu') this.seen.menu++;
    const details = e.type.startsWith('key')
      ? `key="${e.key}" code="${e.code}" keyCode=${e.keyCode}`
      : `button=${e.button} buttons=${e.buttons}`;
    this.addLine(`${e.type} ${details}`);
    if (!this.el.hidden) this.scheduleUpdate();
  }

  addLine(text) {
    const now = new Date();
    const time = now.toLocaleTimeString('de-DE') + '.' + String(now.getMilliseconds()).padStart(3, '0');
    this.lines.push(`${time} ${text}`);
    if (this.lines.length > 150) this.lines.shift();
  }

  clear() {
    this.lines = [];
    for (const key in this.seen) this.seen[key] = 0;
    this.fields.copyBox.hidden = true;
    this.fields.log.textContent = 'Geleert. Jetzt testen …';
    this.update();
  }

  setVisible(visible) {
    this.el.hidden = !visible;
    if (visible) this.scheduleUpdate();
  }

  // Wird bei jedem Pointer-Event aufgerufen. Muss sehr schnell sein!
  record(e, status) {
    const coalesced = e.getCoalescedEvents ? e.getCoalescedEvents().length : 0;
    const predicted = e.getPredictedEvents ? e.getPredictedEvents().length : 0;
    this.latest = {
      pointerType: e.pointerType,
      type: e.type,
      button: e.button,
      buttons: e.buttons,
      pressure: e.pressure,
      tiltX: e.tiltX,
      tiltY: e.tiltY,
      width: e.width,
      height: e.height,
      coalesced,
      predicted,
      status,
    };

    if (e.buttons & 2) this.seen.buttons2++;
    if (e.buttons & 32) this.seen.buttons32++;
    if (e.button === 2) this.seen.button2++;
    if (e.button === 5) this.seen.button5++;
    if (e.pointerType === 'mouse') this.seen.mouse++;

    if (e.type === 'pointermove' && e.pointerType === 'pen') {
      this.moveTimes.push(e.timeStamp);
      if (this.moveTimes.length > 30) this.moveTimes.shift();
    }

    // Ins Protokoll nur, wenn sich etwas Wichtiges ändert (nicht jede Bewegung)
    // (Druck wird grob gerundet: 0 = schwebt, sonst berührt)
    const touching = e.pressure > 0 ? 'unten' : 'schwebt';
    const signature = `${e.pointerType}|${e.pointerId}|${e.button}|${e.buttons}|${touching}|${status}`;
    if (e.type !== 'pointermove' || signature !== this.lastSignature) {
      this.lastSignature = signature;
      const name = e.type.replace('pointer', '');
      this.addLine(
        `${e.pointerType} ${name} id=${e.pointerId} button=${e.button} buttons=${e.buttons} druck=${e.pressure.toFixed(2)} → ${status}`
      );
    }

    if (!this.el.hidden) this.scheduleUpdate();
  }

  // Die Anzeige höchstens einmal pro Bild aktualisieren – das kostet sonst Zeit beim Zeichnen
  scheduleUpdate() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.update();
    });
  }

  update() {
    const d = this.latest;
    if (!d) return;
    const f = this.fields;
    f.pointerType.textContent = d.pointerType;
    f.type.textContent = d.type;
    f.button.textContent = d.button;
    f.buttons.textContent = describeButtons(d.buttons);
    f.pressure.textContent = d.pressure.toFixed(3);
    f.pressureBar.style.width = `${Math.round(d.pressure * 100)}%`;
    f.tilt.textContent = `${d.tiltX}° / ${d.tiltY}°`;
    f.size.textContent = `${d.width.toFixed(0)} × ${d.height.toFixed(0)} px`;
    f.points.textContent = `${d.coalesced} echt + ${d.predicted} vorhergesagt`;
    f.status.textContent = d.status;
    const n = this.seen;
    const parts = [];
    if (n.buttons2) parts.push(`buttons&2: ${n.buttons2}`);
    if (n.buttons32) parts.push(`buttons&32: ${n.buttons32}`);
    if (n.button2) parts.push(`button=2: ${n.button2}`);
    if (n.button5) parts.push(`button=5: ${n.button5}`);
    if (n.mouse) parts.push(`Maus: ${n.mouse}`);
    if (n.keys) parts.push(`Tasten: ${n.keys}`);
    if (n.menu) parts.push(`Menü: ${n.menu}`);
    f.seen.textContent = parts.length ? parts.join(', ') : 'noch keine';

    const t = this.moveTimes;
    if (t.length > 2) {
      const hz = ((t.length - 1) * 1000) / (t[t.length - 1] - t[0]);
      f.rate.textContent = `${Math.round(hz)} Events/s`;
    }

    f.log.textContent = this.lines.slice(-12).join('\n');
    f.log.scrollTop = f.log.scrollHeight;
  }

  // Protokoll in die Zwischenablage, damit du es mir schicken kannst
  async copy() {
    const text = [
      `Federleicht Stift-Diagnose`,
      `Browser: ${navigator.userAgent}`,
      `Low-Latency: ${this.renderer.lowLatency ? 'ja' : 'nein'}`,
      `Knopf-Signale: ${JSON.stringify(this.seen)}`,
      ...this.lines,
    ].join('\n');
    const button = this.el.querySelector('[data-copy]');
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = 'Kopiert ✓';
      setTimeout(() => (button.textContent = 'Kopieren'), 2000);
    } catch {
      // Kopieren nicht erlaubt -> Text in ein Feld schreiben, das man selbst markieren kann
      const box = this.fields.copyBox;
      box.value = text;
      box.hidden = false;
      box.focus();
      box.select();
      button.textContent = 'Text unten markieren';
    }
  }
}
