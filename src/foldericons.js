// foldericons.js – Symbole für Ordner (z. B. ein Kolben für Chemie)
//
// Jedes Symbol ist eine Liste von SVG-Pfaden in einem 24 × 24-Feld (nur Linien, keine Flächen).
// Sie werden auf ein Canvas gemalt (siehe paint.js, Art "badge"), damit der Dunkelmodus von
// Samsung Internet die Farben nicht verfälscht.

export const FOLDER_ICONS = [
  { id: 'folder', name: 'Ordner', d: ['M3.5 7.5a2 2 0 0 1 2-2h4l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z'] },
  { id: 'math', name: 'Mathe', d: ['M5 6.5h6M8 3.5v6', 'M13.5 6.5h5.5', 'M5.5 15l4.5 4.5M10 15l-4.5 4.5', 'M13.5 15.5h5.5M13.5 19h5.5'] },
  { id: 'book', name: 'Deutsch', d: ['M5 4.5A1.5 1.5 0 0 1 6.5 3H19v14H6.5A1.5 1.5 0 0 0 5 18.5z', 'M5 18.5A1.5 1.5 0 0 0 6.5 20H19', 'M9 7.5h6'] },
  { id: 'speech', name: 'Sprachen', d: ['M4 5h16v10.5H10L5.5 19.5v-4H4z', 'M8 9h8M8 12h5'] },
  { id: 'flag', name: 'Fremdsprache', d: ['M5.5 21V3.5', 'M5.5 4h12l-2.5 4.25L17.5 12.5h-12'] },
  { id: 'leaf', name: 'Biologie', d: ['M5 19c0-8.5 5.5-14 14.5-14.5C19 13.5 13.5 19 5 19z', 'M5 19l8.5-8.5'] },
  { id: 'flask', name: 'Chemie', d: ['M9 3h6', 'M10 3v6.5l-5.2 8.7A1.9 1.9 0 0 0 6.4 21h11.2a1.9 1.9 0 0 0 1.6-2.8L14 9.5V3', 'M7.4 15h9.2'] },
  { id: 'bolt', name: 'Physik', d: ['M13.5 2.5 5.5 13.5h6l-1 8 8-11h-6z'] },
  { id: 'globe', name: 'Erdkunde', d: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M3 12h18', 'M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18'] },
  { id: 'columns', name: 'Geschichte', d: ['M3 9l9-5 9 5', 'M5.5 10v8M10 10v8M14 10v8M18.5 10v8', 'M3 20.5h18'] },
  { id: 'people', name: 'Politik', d: ['M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z', 'M3.5 20c0-3.3 2.5-5.5 5.5-5.5s5.5 2.2 5.5 5.5', 'M16 5.5a3 3 0 0 1 0 5.5M17.5 14.5c1.9.7 3 2.6 3 5.5'] },
  { id: 'music', name: 'Musik', d: ['M9 18V5.5l11-2V16', 'M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z', 'M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z'] },
  { id: 'palette', name: 'Kunst', d: ['M12 3a9 9 0 0 0 0 18c1.5 0 2-1 2-2s-1-1.5-1-2.5 1-1.5 2-1.5h2a4 4 0 0 0 4-4c0-4.4-4-8-9-8z', 'M7.5 11.5h.01M10 7.5h.01M15 7.5h.01'] },
  { id: 'ball', name: 'Sport', d: ['M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18z', 'M12 7.5l3.8 2.8-1.4 4.4H9.6l-1.4-4.4z', 'M12 3v4.5M15.8 10.3 20.5 9M14.4 14.7l2.6 4.3M9.6 14.7 7 19M8.2 10.3 3.5 9'] },
  { id: 'code', name: 'Informatik', d: ['M8 7l-5 5 5 5M16 7l5 5-5 5', 'M14 4l-4 16'] },
  { id: 'chart', name: 'Wirtschaft', d: ['M4 4v16h16', 'M8 16v-4M12 16V8M16 16v-6'] },
  { id: 'chapel', name: 'Religion', d: ['M12 2.5v5M9.5 5h5', 'M5.5 21v-9l6.5-4 6.5 4v9', 'M10 21v-4.5h4V21'] },
  { id: 'cap', name: 'Schule', d: ['M2.5 9 12 4.5 21.5 9 12 13.5z', 'M6.5 11v5c3 2.4 8 2.4 11 0v-5', 'M21.5 9v6'] },
  { id: 'clipboard', name: 'Aufgaben', d: ['M9 3.5h6v3H9z', 'M15 5h3v16H6V5h3', 'M9 13l2 2 4-4'] },
  { id: 'calendar', name: 'Termine', d: ['M4 6h16v14.5H4z', 'M4 10.5h16', 'M8 3.5v5M16 3.5v5'] },
  { id: 'bulb', name: 'Ideen', d: ['M9.5 18h5M10.5 21h3', 'M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3z'] },
  { id: 'star', name: 'Wichtig', d: ['m12 3.5 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z'] },
  { id: 'heart', name: 'Privat', d: ['M12 20s-7.5-4.6-7.5-10.2A4.2 4.2 0 0 1 12 7.3a4.2 4.2 0 0 1 7.5 2.5C19.5 15.4 12 20 12 20z'] },
  { id: 'pencil', name: 'Notizen', d: ['M15.5 4.5a2.1 2.1 0 0 1 3 0l1 1a2.1 2.1 0 0 1 0 3L8.5 19.5 4 20l.5-4.5z', 'M13.5 6.5l4 4'] },
  { id: 'brief', name: 'Arbeit', d: ['M3.5 8h17v11.5h-17z', 'M9 8V5h6v3', 'M3.5 13h17'] },
  { id: 'camera', name: 'Fotos', d: ['M4 7.5h3.5L9 5h6l1.5 2.5H20V19H4z', 'M12 16.5a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z'] },
  { id: 'plane', name: 'Reisen', d: ['M10.5 13.5 4 11l1.5-1.5 7 1 4-4c1-1 2.5-1.3 3-.8s.2 2-.8 3l-4 4 1 7L14.2 21l-2.5-6.5-3.2 3.2.3 2.3-1.3 1.3-1.3-3.2L3 16.8l1.3-1.3 2.3.3z'] },
  { id: 'dumbbell', name: 'Training', d: ['M3 9.5v5M6 7v10M18 7v10M21 9.5v5', 'M6 12h12'] },
];

const byId = Object.fromEntries(FOLDER_ICONS.map((i) => [i.id, i]));

// Ein Ordner-Symbol ist entweder eine ID aus der Liste oder ein eigenes Zeichen ("e:📐")
export function iconPaths(icon) {
  return (byId[icon] || byId.folder).d;
}
export const isCustomIcon = (icon) => typeof icon === 'string' && icon.startsWith('e:');
