# Federleicht – Etappe 2

Deine eigene Notiz-App für das Galaxy Tab S10 FE mit S Pen.
Etappe 1: **installierbare Offline-App + Zeichenfläche**, auf der du flüssig mit dem Stift schreibst.
Etappe 2: **Werkzeugleiste** wie bei Samsung Notes: Stift, Textmarker, Radierer, Rückgängig und Wiederholen.

Was schon geht:

- Nur der **S Pen** zeichnet, die Linie wird dicker, wenn du fester drückst
- **Stiftknopf gedrückt halten = Radierer** (löscht ganze Striche, ein blauer Kreis zeigt den Radierer).
  Wichtig: Den Knopf **vor** dem Aufsetzen drücken. Der blaue Kreis erscheint schon beim Schweben, dann weißt du, dass der Radierer bereit ist.
- **Knopf kurz klicken (beim Schweben) = Radierer bleibt an**, bis du wieder klickst. In der Werkzeugleiste ist dann der Radierer gewählt.
- **Werkzeugleiste oben:** Stift, Textmarker, Radierer. **Aktives Werkzeug nochmal antippen** öffnet die Einstellungen:
  - Stift: Art (Füller, Kugelschreiber, Pinsel), Dicke, 10 Farben + eigene Farbe
  - Textmarker: Dicke, 6 Farben + eigene Farbe. Er färbt wie echter Marker: Schrift darunter bleibt lesbar.
  - Radierer: **Strich löschen** (ganzer Strich) oder **Bereich löschen** (nur wo du radierst), Größe, „Seite leeren“.
    Der Stiftknopf benutzt dieselben Radierer-Einstellungen.
  - Daneben tippen schließt das Popup, ohne zu zeichnen. Deine Einstellungen werden gemerkt.
- **Rückgängig / Wiederholen** (Pfeile oben links, am PC auch Strg+Z / Strg+Y). Auch „Seite leeren“ kann man rückgängig machen.
- **Gerade Linien:** Strich ziehen und den Stift am Ende kurz stillhalten (etwa eine halbe Sekunde).
  Dann wird daraus eine gerade Strecke vom Anfang bis zum Ende. Solange die Spitze unten bleibt, kannst du das Ende noch verschieben.
- **1 Finger** verschiebt die Seite, **2 Finger** zoomen
- **Handballen** werden ignoriert, solange der Stift in der Nähe ist
- **Stift-Diagnose** (Knopf mit der Zickzack-Linie oben rechts): zeigt, was der Stift an die App meldet
- **Offline**: Nach dem ersten Öffnen läuft die App ohne Internet
- **Installierbar**: eigener Name, eigenes Icon, startet ohne Browser-Leiste

Noch nicht: Speichern (kommt in Etappe 4). Wenn du die App schließt, ist das Blatt wieder leer.

---

## Starten auf dem PC

Du brauchst [Node.js](https://nodejs.org) (Version 20 oder neuer).

```bash
npm install        # einmalig: lädt Vite und perfect-freehand in den Ordner node_modules
npm run dev        # startet die App zum Entwickeln
```

Dann im Browser `http://localhost:5173` öffnen. Am PC zeichnest du mit der linken Maustaste,
die **rechte Maustaste** ist der Radierer (sie meldet dasselbe Bit wie der Stiftknopf).

### Auf dem Tablet testen (gleiches WLAN)

`npm run dev` zeigt dir eine Zeile wie `Network: http://192.168.178.23:5173`.
Diese Adresse tippst du auf dem Tablet in Chrome ein. Zeichnen, Radieren und Zoomen kannst du so testen.

Installieren und Offline gehen so noch **nicht**, weil der Browser dafür eine sichere Verbindung (HTTPS)
verlangt. Das klappt, sobald die App auf GitHub Pages liegt (siehe unten).

### Fertige Version bauen

```bash
npm run build      # baut die fertige App in den Ordner dist/
npm run preview    # zeigt die fertige Version an (mit Service Worker)
```

---

## Wie der Code aufgebaut ist

| Datei | Was sie macht |
|---|---|
| `index.html` | Das Gerüst: obere Leiste, Canvas (die Zeichenfläche), Platz für die Diagnose |
| `src/style.css` | Das Aussehen: Farben als Variablen, Hell- und Dunkelmodus, runde Ecken |
| `src/main.js` | Der Startpunkt. Steckt alles zusammen und enthält die Aktionen der App: Strich anfangen, verlängern, beenden, radieren, zoomen |
| `src/tools.js` | Die Werkzeuge: Farben, Stiftarten, Standard-Einstellungen, Speichern im Browser |
| `src/toolbar.js` | Die Werkzeugleiste und die Einstellungs-Popups |
| `src/history.js` | Rückgängig und Wiederholen mit zwei Stapeln |
| `src/input.js` | **Das Herz für den S Pen.** Unterscheidet Stift, Finger und Handballen und erkennt den Stiftknopf |
| `src/ink.js` | Macht aus Stiftpunkten mit perfect-freehand eine glatte Linie (je Stiftart andere Einstellungen). Prüft, ob der Radierer trifft, und schneidet beim Bereichs-Radierer Löcher in Striche |
| `src/straighten.js` | Gerade Linien: erkennt mit einem Timer, ob der Stift stillsteht, und macht aus dem Strich eine Strecke |
| `src/view.js` | Die „Kamera": rechnet zwischen Bildschirm und Blatt um (Zoom und Verschieben) |
| `src/renderer.js` | Malt alles aufs Canvas, und zwar so, dass möglichst wenig neu gemalt werden muss |
| `src/debug.js` | Das Diagnose-Fenster |
| `src/sw.js` | Der Service Worker: speichert alle Dateien, damit die App offline läuft |
| `public/manifest.webmanifest` | Steckbrief der App: Name, Icon, Farben, „ohne Browser-Leiste" |
| `vite.config.js` | Einstellungen für Vite und ein kleines Plugin, das dem Service Worker die Dateiliste gibt |

### Die wichtigsten Ideen

**1. Pointer Events.** Der Browser meldet Stift, Finger und Maus alle gleich:
`pointerdown` (aufsetzen), `pointermove` (bewegen), `pointerup` (abheben).
An `e.pointerType` sehen wir, *was* es war: `"pen"`, `"touch"` oder `"mouse"`.
Im CSS steht `touch-action: none`. Damit sagen wir dem Browser: „Fass die Berührungen nicht selbst an, wir kümmern uns."

**2. Der Stiftknopf.** `e.buttons` ist eine *Bitmaske*: Jede Taste ist ein Bit.

```
Bit  1  (Wert 1)  = Spitze berührt das Display
Bit  2  (Wert 2)  = Seitenknopf gedrückt
Bit  6  (Wert 32) = Radierer
buttons = 3  bedeutet  1 + 2  =  Spitze unten UND Knopf gedrückt
```

Mit `e.buttons & 2` fragen wir: „Ist das Knopf-Bit gesetzt?" So steht es im Standard, und so machen es z. B. die Maus
(rechte Taste) und viele andere Stifte. Das prüft `isEraserButton()`.

**Aber:** Die Diagnose auf deinem Tab S10 FE hat gezeigt, dass Samsung es anders macht:

- Während die Spitze das Display berührt, sieht die App den Knopf **gar nicht**.
- Beim **Schweben** mit gedrücktem Knopf kommt `buttons = 1` mit Druck `0`. Eigentlich heißt `buttons = 1` „Spitze unten",
  der Druck 0 verrät aber, dass der Stift schwebt. Das erkennt `isButtonHeldWhileHovering()`.
- Direkt vor dem Aufsetzen kommt noch ein Schwebe-Event mit `buttons = 0`. Darum zählt ein Knopf, der vor weniger als
  0,4 Sekunden „losgelassen" wurde, noch als gedrückt (`ARM_MS`).

Deshalb merkt sich `input.js` beim Schweben, ob der Knopf gedrückt ist, und entscheidet beim **Aufsetzen**: zeichnen oder radieren.
Bis zum Abheben bleibt es dann dabei. Ob der Stift das Display berührt, erkennen wir nur noch an `pointerdown` und `pointerup`.
Das ist eine wichtige Programmier-Lektion: **Erst messen, dann programmieren.** Die Theorie (der Standard) und die Praxis (dein Gerät) sind nicht immer gleich.

**3. Handballen.** Wenn der Stift gerade schreibt oder vor weniger als 0,6 Sekunden in der Nähe war,
ignorieren wir Fingerberührungen. Sehr große Berührungen (> 45 px) sind auch verdächtig.

**4. Wenig Verzögerung.**
- `desynchronized: true` beim Canvas: Der Browser darf das Bild sofort zeigen.
- `getCoalescedEvents()`: Der S Pen misst öfter, als der Bildschirm Bilder zeigt. So bekommen wir alle Zwischenpunkte.
- `getPredictedEvents()`: Der Browser sagt voraus, wo der Stift gleich ist. Diese Punkte zeigen wir kurz mit an.
- Fertige Striche liegen in einem unsichtbaren Zwischenbild. Beim Schreiben wird nur das kleine Stück neu gemalt, wo sich etwas ändert.

**5. Seiten-Koordinaten.** Das Blatt ist immer 1000 Einheiten breit, egal wie weit du zoomst.
Striche werden in diesen Einheiten gespeichert. `view.js` rechnet um: `bildschirm = seite * scale + offset`.

**6. Service Worker.** Beim ersten Öffnen legt er alle Dateien in einen Cache. Danach beantwortet er jede Anfrage
aus diesem Cache, also auch ohne Internet. Nach einem Update öffnest du die App zweimal, dann ist die neue Version da.

**7. Rückgängig mit zwei Stapeln (Etappe 2).** Jede Änderung ist eine „Aktion“: `{ added: [...], removed: [...] }`.
Rückgängig nimmt die oberste Aktion vom `undoStack`, macht sie umgekehrt und legt sie auf den `redoStack`.
Jeder Strich hat eine Nummer `z`. Daran erkennen wir beim Wiedereinfügen, an welche Stelle er gehört (wichtig für den Textmarker).

**8. Bereichs-Radierer (Etappe 2).** Ein Strich ist eine Liste von Punkten. `cutStroke()` wirft alle Punkte weg, die im
Radierer-Kreis liegen. Was davor und dahinter übrig bleibt, wird zu neuen, kleineren Strichen.

---

## 🧠 Übung Etappe 2: Rückgängig aus dem Gedächtnis

1. Lies `src/history.js` genau durch.
2. **Lösch den Inhalt der beiden Methoden `undo()` und `redo()`** (nur das zwischen den geschweiften Klammern).
3. Schreib ihn aus dem Gedächtnis neu, ohne nachzuschauen.
4. Teste: Drei Striche zeichnen, zweimal Rückgängig (nur der erste bleibt), einmal Wiederholen (zwei sind da).
   Dann einen neuen Strich zeichnen: Der Wiederholen-Pfeil muss grau werden.
5. Schick mir deinen Code in den Chat, ich prüfe ihn.

Kleine Hilfe: `pop()`, `push()`, `this.onChange()` und `return`.

**Bonusfragen:** Warum wird der `redoStack` in `push()` geleert? Warum ist ein ganzes Radieren (Aufsetzen bis Abheben) nur EIN Schritt?

---

## 🧠 Übung Etappe 1: Aus dem Gedächtnis neu schreiben

1. Lies `src/input.js` von oben bis zu `setupInput` genau durch, vor allem die Bitmaske.
2. **Lösch die beiden Funktionen `isEraserButton(e)` und `isButtonHeldWhileHovering(e)` komplett.**
3. Schreib sie aus dem Gedächtnis neu, **ohne nachzuschauen**.
4. Teste: Am PC muss die linke Maustaste zeichnen und die rechte radieren. Auf dem Tablet muss beim Schweben mit
   gedrücktem Knopf der blaue Kreis erscheinen, und Aufsetzen mit gedrücktem Knopf muss radieren.
5. Schick mir deinen Code in den Chat. Ich prüfe ihn und stelle dir dazu Fragen.

Kleine Hilfe, falls du hängst: Es geht um die Werte `1`, `2`, `32`, `5`, den Operator `&` und den Druck `e.pressure`.

**Bonusfragen** (beantworte sie mir in eigenen Worten):

- Warum prüft `isButtonHeldWhileHovering` bei `buttons & 1` zusätzlich, ob der Druck 0 ist?
- Was würde passieren, wenn `touch-action: none` im CSS fehlt?
- Warum speichern wir Striche in Seiten-Koordinaten und nicht in Bildschirm-Pixeln?

---

## Ausblick: Online stellen mit GitHub Pages

GitHub Pages ist kostenloses Webhosting direkt aus einem GitHub-Repository, mit HTTPS.
Kurz gesagt: Code auf GitHub hochladen → eine kleine „GitHub Action" führt `npm run build` aus →
der Ordner `dist/` wird unter `https://DEINNAME.github.io/federleicht/` veröffentlicht →
auf dem Tablet in Chrome öffnen → Menü → **„App installieren"**.
Weil in `vite.config.js` `base: './'` steht, funktioniert die App auch in diesem Unterordner.
Die genauen Schritte machen wir in einem eigenen Thread.
