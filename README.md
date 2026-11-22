# Federleicht – Etappe 1

Deine eigene Notiz-App für das Galaxy Tab S10 FE mit S Pen.
Etappe 1: **installierbare Offline-App + Zeichenfläche**, auf der du flüssig mit dem Stift schreibst.

Was schon geht:

- Nur der **S Pen** zeichnet, die Linie wird dicker, wenn du fester drückst
- **Stiftknopf gedrückt halten = Radierer** (löscht ganze Striche, ein blauer Kreis zeigt den Radierer)
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
| `src/input.js` | **Das Herz für den S Pen.** Unterscheidet Stift, Finger und Handballen und erkennt den Stiftknopf |
| `src/ink.js` | Macht aus Stiftpunkten mit perfect-freehand eine glatte Linie. Prüft, ob der Radierer einen Strich trifft |
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

Mit `e.buttons & 2` fragen wir: „Ist das Knopf-Bit gesetzt?" Weil nicht jedes Gerät gleich meldet,
prüft `isEraserButton()` alle Varianten (32, 2, und beim Aufsetzen `button === 5` oder `2`).
Und `isTouchingScreen()` unterscheidet „Stift berührt" von „Stift schwebt nur" – sonst würdest du schon beim Schweben radieren.

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

---

## 🧠 Übung: Aus dem Gedächtnis neu schreiben

1. Lies `src/input.js` von oben bis zu `setupInput` genau durch, vor allem die Bitmaske.
2. **Lösch die beiden Funktionen `isEraserButton(e)` und `isTouchingScreen(e)` komplett.**
3. Schreib sie aus dem Gedächtnis neu, **ohne nachzuschauen**.
4. Teste: Am PC muss die linke Maustaste zeichnen und die rechte radieren. Auf dem Tablet darf
   „Knopf gedrückt halten und nur schweben" noch **nichts** löschen, erst wenn die Spitze das Display berührt.
5. Schick mir deinen Code in den Chat. Ich prüfe ihn und stelle dir dazu Fragen.

Kleine Hilfe, falls du hängst: Es geht um die Werte `1`, `2`, `32` und den Operator `&`.

**Bonusfragen** (beantworte sie mir in eigenen Worten):

- Warum prüft `isTouchingScreen` bei `buttons & 2` zusätzlich den Druck?
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
