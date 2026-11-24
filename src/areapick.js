// areapick.js – "Bereich wählen": mit dem Stift einen Rahmen um etwas ziehen
//
// Benutzt von "Handschrift zu Text" (nur das umwandeln, was im Rahmen steht) und der Mathe-Hilfe.
// Während der Bereich gewählt wird, zeichnet der Stift nicht, sondern zieht einen Rahmen.
// Mit dem Finger kannst du weiter scrollen und zoomen, um die richtige Stelle zu finden.
//
//   const result = await areaPick.start({ title, hint, icon, actions: [{ id, label }] })
//   result: { page, index, rect: {minX, minY, maxX, maxY} (Seiten-Koordinaten), items }
//           oder { action: 'id' } (ein Knopf in der Leiste, z. B. "Ganze Seite")
//           oder null (abgebrochen)

const CLOSE = '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6 6 18"/></svg>';
const MIN_SIZE = 14; // kleiner (Bildschirm-Pixel) zählt als Antippen, nicht als Rahmen

export function setupAreaPick({ stage, view, doc, onChange }) {
  let session = null; // { resolve, bar, rect, start, end, index }

  function start({ title, hint, icon = '', actions = [] }) {
    cancel();
    return new Promise((resolve) => {
      const bar = document.createElement('div');
      bar.className = 'area-bar';
      bar.innerHTML = `
        <span class="area-icon">${icon}</span>
        <span class="area-text"><b>${title}</b><small>${hint}</small></span>
        ${actions.map((a) => `<button class="area-btn" data-action="${a.id}">${a.label}</button>`).join('')}
        <button class="area-close" data-action="cancel" aria-label="Abbrechen">${CLOSE}</button>`;
      const rect = document.createElement('div');
      rect.className = 'area-rect';
      rect.hidden = true;
      stage.append(rect, bar);
      stage.classList.add('area-picking');
      bar.addEventListener('click', (e) => {
        const a = e.target.closest('[data-action]')?.dataset.action;
        if (!a) return;
        if (a === 'cancel') return finish(null);
        finish({ action: a });
      });
      session = { resolve, bar, rect, start: null, end: null, index: -1 };
      onChange?.(true);
    });
  }

  function finish(result) {
    if (!session) return;
    const s = session;
    session = null;
    s.bar.remove();
    s.rect.remove();
    stage.classList.remove('area-picking');
    onChange?.(false);
    s.resolve(result);
  }

  function cancel() {
    finish(null);
  }

  // ---------- Stift (Dokument-Koordinaten) ----------
  function down(point) {
    if (!session) return;
    session.start = point;
    session.end = point;
    session.index = doc.indexAt(point[1]);
    draw();
  }

  function move(point) {
    if (!session?.start) return;
    session.end = point;
    draw();
  }

  function up() {
    if (!session?.start) return;
    const { start, end, index } = session;
    session.start = null;
    const [ax, ay] = view.toScreen(start[0], start[1]);
    const [bx, by] = view.toScreen(end[0], end[1]);
    if (Math.abs(ax - bx) < MIN_SIZE || Math.abs(ay - by) < MIN_SIZE) {
      session.rect.hidden = true;
      return;
    }
    const top = doc.top(index);
    const page = doc.pages[index];
    const rect = {
      minX: Math.min(start[0], end[0]),
      maxX: Math.max(start[0], end[0]),
      minY: Math.min(start[1], end[1]) - top,
      maxY: Math.max(start[1], end[1]) - top,
    };
    finish({ page, index, rect, items: itemsIn(page, rect) });
  }

  // Rahmen auf dem Bildschirm zeigen
  function draw() {
    if (!session) return;
    const { start, end, rect } = session;
    if (!start || !end) {
      rect.hidden = true;
      return;
    }
    const [ax, ay] = view.toScreen(start[0], start[1]);
    const [bx, by] = view.toScreen(end[0], end[1]);
    rect.hidden = false;
    rect.style.left = `${Math.min(ax, bx)}px`;
    rect.style.top = `${Math.min(ay, by)}px`;
    rect.style.width = `${Math.abs(ax - bx)}px`;
    rect.style.height = `${Math.abs(ay - by)}px`;
  }

  return {
    start,
    cancel,
    down,
    move,
    up,
    redraw: draw,
    get active() {
      return Boolean(session);
    },
  };
}

// Was liegt im Rahmen? Ein Strich zählt, wenn mindestens die Hälfte seiner Punkte drin ist
// (so wird ein Wort, das nur knapp über den Rand ragt, trotzdem mitgenommen).
export function itemsIn(page, r) {
  const inside = (p) => p[0] >= r.minX && p[0] <= r.maxX && p[1] >= r.minY && p[1] <= r.maxY;
  return page.strokes.filter((s) => {
    if (!s.box || s.hidden) return false;
    const b = s.box;
    if (b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY) return false;
    if (!s.points?.length) return inside([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
    let n = 0;
    for (const p of s.points) if (inside(p)) n++;
    return n >= s.points.length / 2;
  });
}
