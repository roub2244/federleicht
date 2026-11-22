// sw.js – der Service Worker
// Ein Service Worker ist ein kleines Programm, das der Browser im Hintergrund
// zwischen deine App und das Internet schaltet. Er speichert alle Dateien der
// App in einem Cache. Danach startet die App auch ohne Internet.

// Diese beiden Platzhalter füllt vite.config.js beim Bauen automatisch aus:
const VERSION = '__VERSION__';
const FILES = __PRECACHE__;

const CACHE_NAME = 'federleicht-' + VERSION;

// 1) "install": beim ersten Besuch (oder wenn es eine neue Version gibt)
//    alle Dateien herunterladen und in den Cache legen.
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(FILES))
      .then(() => self.skipWaiting()) // neue Version sofort übernehmen
  );
});

// 2) "activate": alte Caches von früheren Versionen löschen.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
      )
      .then(() => self.clients.claim())
  );
});

// 3) "fetch": Jede Anfrage der App läuft hier durch.
//    Wir antworten zuerst aus dem Cache ("cache first"). Nur wenn eine Datei
//    dort fehlt, fragen wir das Internet.
self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  // Öffnen der App (Navigation) -> immer die gespeicherte index.html
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html', { ignoreVary: true }).then((cached) => cached || fetch(request))
    );
    return;
  }

  // ignoreVary: Manche Server schicken "Vary"-Angaben mit, durch die der Cache
  // eine Datei sonst nicht wiedererkennt (dann ginge offline nichts).
  event.respondWith(
    caches
      .match(request, { ignoreSearch: true, ignoreVary: true })
      .then((cached) => cached || fetch(request))
  );
});
