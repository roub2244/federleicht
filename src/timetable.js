// timetable.js – der Stundenplan (Daten, A/B-Wochen, "was ist jetzt?", "wann ist die nächste Stunde?")
//
// Gespeichert in localStorage (federleicht.timetable):
// {
//   periods: [{ from: '07:50', to: '08:35' }, …],               Stundenzeiten (Index = Stunde - 1)
//   subjects: { id: { name, short, color, folder? } },          Fächer (folder = Ordner-ID, sonst nach Namen)
//   lessons: [{ day: 1..5, period: 1.., len: 1|2, subject, room, teacher, weeks: 'AB' | 'A' | 'B' }],
//   abWeeks: true, anchor: { monday: 'JJJJ-MM-TT', week: 'A' | 'B' }   bekannte Woche zum Weiterzählen
// }
// A/B: Ab der bekannten Woche (anchor) wird abwechselnd weitergezählt. Nach Ferien kann man
// auf der Startseite mit einem Tipp umschalten ("Diese Woche ist A").

const KEY = 'federleicht.timetable';

// Robins Plan (Screenshots vom 26.11.2026, Stundenplan + EduPage). Die Woche 23.–27.11. war eine B-Woche,
// in der A-Woche fällt Mittwoch 7./8. Englisch weg. course = Kursname wie in EduPage,
// teachers = Kürzel -> voller Name (soweit bekannt).
const ROBIN = {
  periods: [
    { from: '07:50', to: '08:35' },
    { from: '08:35', to: '09:20' },
    { from: '09:35', to: '10:20' },
    { from: '10:25', to: '11:10' },
    { from: '11:35', to: '12:20' },
    { from: '12:45', to: '13:30' },
    { from: '13:35', to: '14:20' },
    { from: '14:25', to: '15:10' },
    { from: '15:15', to: '16:00' },
  ],
  subjects: {
    ph: { name: 'Physik', short: 'Ph', course: 'eA Ph', color: '#7048e8' },
    gg: { name: 'Geographie', short: 'GG', color: '#2f9e44' },
    ma: { name: 'Mathe', short: 'M', course: 'eA Ma 3', color: '#1c7ed6' },
    en: { name: 'Englisch', short: 'En', color: '#e8590c' },
    eth: { name: 'Ethik', short: 'Eth', color: '#0c8599' },
    if: { name: 'Informatik', short: 'If', color: '#495057' },
    sf: { name: 'Seminarfach', short: 'Sf', color: '#ae3ec9' },
    ges: { name: 'Geschichte', short: 'Ges', color: '#c92a2a' },
    de: { name: 'Deutsch', short: 'D', color: '#d6336c' },
    mu: { name: 'Musik', short: 'Mu', course: 'gA mu 1', color: '#f59f00' },
    sp: { name: 'Sport', short: 'Sp', course: 'gA sp 3', color: '#37b24d' },
  },
  lessons: [
    { day: 1, period: 3, len: 2, subject: 'ph', room: 'B11', teacher: 'Uxa' },
    { day: 1, period: 5, len: 2, subject: 'gg', room: 'S1', teacher: 'Neu, P.' },
    { day: 1, period: 7, len: 2, subject: 'ma', room: 'H8', teacher: 'Scho' },
    { day: 2, period: 1, len: 1, subject: 'en', room: 'C15', teacher: 'Sei' },
    { day: 2, period: 2, len: 1, subject: 'en', room: 'C15', teacher: 'Flu, Sei' },
    { day: 2, period: 3, len: 1, subject: 'eth', room: 'A12', teacher: 'Fis, Lei' },
    { day: 2, period: 4, len: 1, subject: 'eth', room: 'A12', teacher: 'Lei' },
    { day: 2, period: 5, len: 2, subject: 'if', room: 'C18', teacher: 'Kir' },
    { day: 2, period: 9, len: 1, subject: 'ph', room: 'B11', teacher: 'Uxa' },
    { day: 3, period: 1, len: 2, subject: 'ges', room: 'C14', teacher: 'Pen' },
    { day: 3, period: 3, len: 2, subject: 'gg', room: 'S1', teacher: 'Neu, P.' },
    { day: 3, period: 5, len: 1, subject: 'ma', room: 'H8', teacher: 'Scho' },
    { day: 3, period: 6, len: 1, subject: 'de', room: 'A10', teacher: 'Rot' },
    { day: 3, period: 7, len: 2, subject: 'en', room: 'A11', teacher: 'Sei', weeks: 'B' },
    { day: 4, period: 3, len: 1, subject: 'de', room: 'C10', teacher: 'Bur, Rot' },
    { day: 4, period: 4, len: 1, subject: 'de', room: 'C10', teacher: 'Rot' },
    { day: 4, period: 5, len: 1, subject: 'gg', room: 'S1', teacher: 'Neu, P.' },
    { day: 4, period: 7, len: 1, subject: 'ges', room: 'C14', teacher: 'Pen' },
    { day: 5, period: 1, len: 2, subject: 'ma', room: 'H6', teacher: 'Scho' },
    { day: 5, period: 3, len: 2, subject: 'mu', room: 'A8', teacher: 'Seb' },
    { day: 5, period: 5, len: 2, subject: 'ph', room: 'C18', teacher: 'Uxa' },
    { day: 5, period: 7, len: 2, subject: 'sp', room: 'TH', teacher: 'Geb' },
  ],
  teachers: {
    Scho: 'Gerhard Schott',
    Seb: 'Heike Sebastian',
    Uxa: 'Wolfgang Uxa',
    Geb: 'Max Gebhardt',
  },
  abWeeks: true,
  anchor: { monday: '2026-11-23', week: 'B' },
  version: 2,
};

// Andere Schreibweisen, unter denen ein Ordner zu einem Fach passt
const ALIASES = {
  ma: ['mathe', 'mathematik', 'math', 'em3', 'ma'],
  de: ['deutsch', 'gd1', 'de'],
  en: ['englisch', 'english', 'en'],
  ph: ['physik', 'ph'],
  gg: ['geographie', 'geografie', 'erdkunde', 'geo', 'gg'],
  ges: ['geschichte', 'ges', 'ge'],
  eth: ['ethik', 'eth'],
  if: ['informatik', 'info', 'if'],
  sf: ['seminarfach', 'seminar', 'sf'],
  mu: ['musik', 'mu'],
  sp: ['sport', 'sp'],
};

let data = load();
const listeners = new Set();

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY));
    if (saved?.lessons) return upgrade(saved);
  } catch {
    /* nichts gespeichert */
  }
  return structuredClone(ROBIN);
}

// Ältere gespeicherte Pläne um neue Angaben ergänzen (Kursnamen, volle Lehrernamen, 9. Stunde)
function upgrade(saved) {
  if ((saved.version || 1) >= ROBIN.version) return saved;
  saved.teachers = { ...ROBIN.teachers, ...(saved.teachers || {}) };
  for (const [id, s] of Object.entries(ROBIN.subjects)) {
    if (saved.subjects[id] && s.course && !saved.subjects[id].course) saved.subjects[id].course = s.course;
  }
  if (saved.periods.length < ROBIN.periods.length) saved.periods = [...saved.periods, ...ROBIN.periods.slice(saved.periods.length)];
  saved.version = ROBIN.version;
  return saved;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* egal */
  }
  for (const fn of listeners) fn();
}

export const timetable = () => data;
export const onChange = (fn) => listeners.add(fn);

// ---------- Zeit ----------
const toMin = (hhmm) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};
const pad = (n) => String(n).padStart(2, '0');
const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d) => {
  const day = (d.getDay() + 6) % 7; // Mo = 0
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
};
const parseDay = (key) => {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
};

// A oder B in der Woche von "date"
export function weekOf(date = new Date()) {
  if (!data.abWeeks) return null;
  const a = data.anchor || { monday: dayKey(mondayOf(new Date())), week: 'A' };
  const weeks = Math.round((mondayOf(date) - parseDay(a.monday)) / (7 * 86400000));
  const same = ((weeks % 2) + 2) % 2 === 0;
  return same ? a.week : a.week === 'A' ? 'B' : 'A';
}

// "Diese Woche ist A/B" (nach Ferien umstellen)
export function setThisWeek(week, date = new Date()) {
  data.anchor = { monday: dayKey(mondayOf(date)), week };
  save();
}

const inWeek = (lesson, week) => !lesson.weeks || lesson.weeks === 'AB' || !week || lesson.weeks === week;

// Stunden an einem Tag (Date), sortiert
export function lessonsOn(date) {
  const day = date.getDay();
  const week = weekOf(date);
  return data.lessons.filter((l) => l.day === day && inWeek(l, week)).sort((a, b) => a.period - b.period);
}

export function lessonTime(lesson) {
  const p0 = data.periods[lesson.period - 1];
  const p1 = data.periods[lesson.period - 1 + (lesson.len || 1) - 1] || p0;
  return { from: p0?.from || '', to: p1?.to || '' };
}

// Was läuft gerade / was kommt als Nächstes (heute)?
export function nowAndNext(now = new Date()) {
  const min = now.getHours() * 60 + now.getMinutes();
  const today = lessonsOn(now);
  let current = null;
  let next = null;
  for (const l of today) {
    const t = lessonTime(l);
    if (toMin(t.from) <= min && min < toMin(t.to)) current = current || l;
    else if (toMin(t.from) > min && !next) next = l;
  }
  return { current, next, today };
}

export const subjectOf = (lesson) => data.subjects[lesson?.subject] || null;

// ---------- Fach <-> Ordner ----------
const norm = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\b(ea|ga|kurs|lk|gk)\b/g, '')
    .replace(/[^a-z0-9]/g, '');

// Zu welchem Fach gehört ein Ordner-/Fachname? ("Mathematik eA Klasse 11" -> 'ma')
export function subjectIdFor(name) {
  if (!name) return null;
  const words = String(name).toLowerCase().split(/[^\p{L}\p{N}]+/u).map(norm).filter(Boolean);
  const whole = norm(name);
  for (const [id, s] of Object.entries(data.subjects)) {
    const names = [norm(s.name), ...(ALIASES[id] || [])];
    if (names.some((n) => n && (whole === n || words.includes(n) || (n.length >= 5 && whole.startsWith(n))))) return id;
  }
  return null;
}

// Nächste Stunde in diesem Fach nach "from" (nicht dieselbe Stunde, die gerade läuft) -> Date | null
export function nextLessonDate(subjectName, from = new Date()) {
  const id = subjectIdFor(subjectName);
  if (!id) return null;
  // Hausaufgaben sind nie für heute: ab morgen die erste Stunde in diesem Fach
  for (let i = 1; i < 22; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (lessonsOn(d).some((l) => l.subject === id)) return d;
  }
  return null;
}

// Die nächsten "count" Stunden in einem Fach ab "from" (ab morgen, wenn today = false) -> [{ date, lesson }]
export function upcomingLessons(subjectId, from = new Date(), count = 4, today = false) {
  const out = [];
  for (let i = today ? 0 : 1; i < 60 && out.length < count; i++) {
    const d = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    for (const l of lessonsOn(d)) if (l.subject === subjectId && out.length < count) out.push({ date: d, lesson: l });
  }
  return out;
}

// Lehrkraft lesbar machen: "Flu, Sei" -> "Flu, Sei" bzw. mit vollen Namen, wenn bekannt
export function teacherName(text, full = true) {
  if (!text || !full) return text || '';
  const map = data.teachers || {};
  return String(text)
    .split(/\s*,\s*/)
    .map((t) => map[t] || t)
    .join(', ');
}

// "3." oder "3./4."
export const periodLabel = (l) => (l.len > 1 ? `${l.period}./${l.period + l.len - 1}.` : `${l.period}.`);

export const WEEKDAYS = ['', 'Mo', 'Di', 'Mi', 'Do', 'Fr'];
