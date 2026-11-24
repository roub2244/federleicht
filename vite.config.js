// vite.config.js – Einstellungen für Vite (unser Werkzeug zum Entwickeln und Bauen)
import { defineConfig } from 'vite';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Kleines eigenes Vite-Plugin:
// Nach dem Bauen schaut es nach, welche Dateien im Ordner "dist" liegen,
// und schreibt diese Liste in den Service Worker. So weiß der Service Worker
// genau, was er für den Offline-Betrieb speichern muss.
function serviceWorkerPlugin() {
  let outDir;
  return {
    name: 'federleicht-service-worker',
    apply: 'build', // nur beim "npm run build", nicht im Entwicklungsmodus
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      const files = listFiles(outDir).filter((f) => f !== 'sw.js');

      // Versionsnummer = Fingerabdruck aller Dateien. Ändert sich eine Datei,
      // ändert sich die Version, und das Tablet lädt das Update.
      const hash = createHash('sha256');
      for (const f of files) hash.update(f).update(readFileSync(join(outDir, f)));
      const version = hash.digest('hex').slice(0, 10);

      const precache = ['./', ...files.map((f) => './' + f)];
      const template = readFileSync(resolve('src/sw.js'), 'utf8');
      const sw = template
        .replace('__VERSION__', version)
        .replace('__PRECACHE__', JSON.stringify(precache, null, 2));
      writeFileSync(join(outDir, 'sw.js'), sw);
      console.log(`\n  Service Worker: ${precache.length} Dateien, Version ${version}`);
    },
  };
}

// Alle Dateien in einem Ordner (und Unterordnern) auflisten
function listFiles(dir, base = dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listFiles(full, base);
    return [relative(base, full).split('\\').join('/')];
  });
}

// pdf.js braucht ein paar Zusatzdateien (Standard-Schriften, Hilfsprogramme für Scans).
// Sie kommen als Ordner "pdfjs/" mit in die App, damit PDFs auch offline gehen.
const PDFJS_DIRS = ['standard_fonts', 'wasm'];
const PDFJS_ROOT = resolve('node_modules/pdfjs-dist');
const pdfjsWanted = (name) => !/^LICENSE|quickjs/.test(name); // JavaScript-in-PDFs brauchen wir nicht

function pdfjsAssetsPlugin() {
  return {
    name: 'federleicht-pdfjs-assets',
    // Beim Entwickeln: direkt aus node_modules ausliefern
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/pdfjs\/(standard_fonts|wasm)\/([\w.-]+)$/.exec((req.url || '').split('?')[0]);
        if (!m || !pdfjsWanted(m[2])) return next();
        try {
          const data = readFileSync(join(PDFJS_ROOT, m[1], m[2]));
          res.setHeader('Content-Type', m[2].endsWith('.wasm') ? 'application/wasm' : m[2].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
          res.end(data);
        } catch {
          next();
        }
      });
    },
    // Beim Bauen: in den Ordner dist/pdfjs/ kopieren
    generateBundle() {
      for (const dir of PDFJS_DIRS) {
        for (const name of readdirSync(join(PDFJS_ROOT, dir))) {
          if (!pdfjsWanted(name)) continue;
          this.emitFile({ type: 'asset', fileName: `pdfjs/${dir}/${name}`, source: readFileSync(join(PDFJS_ROOT, dir, name)) });
        }
      }
    },
  };
}

// Texterkennung für "Handschrift zu Text" (Tesseract, siehe src/convert.js).
// Drei Dateien kommen als Ordner "ocr/" mit in die App, damit es offline geht:
//   worker.min.js                     – das Hilfsprogramm, das im Hintergrund rechnet
//   tesseract-core-simd-lstm.wasm.js  – die eigentliche Erkennung (WebAssembly)
//   deu.traineddata.gz                – das deutsche Sprachmodell (mit Wörterbuch)
const OCR_FILES = {
  'worker.min.js': 'node_modules/tesseract.js/dist/worker.min.js',
  'tesseract-core-simd-lstm.wasm.js': 'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
  'deu.traineddata.gz': 'node_modules/@tesseract.js-data/deu/4.0.0_best_int/deu.traineddata.gz',
};

function ocrAssetsPlugin() {
  return {
    name: 'federleicht-ocr-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const m = /\/ocr\/([\w.-]+)$/.exec((req.url || '').split('?')[0]);
        if (!m || !OCR_FILES[m[1]]) return next();
        res.setHeader('Content-Type', m[1].endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
        res.end(readFileSync(resolve(OCR_FILES[m[1]])));
      });
    },
    generateBundle() {
      for (const [name, src] of Object.entries(OCR_FILES)) {
        this.emitFile({ type: 'asset', fileName: `ocr/${name}`, source: readFileSync(resolve(src)) });
      }
    },
  };
}

export default defineConfig({
  // "./" = relative Pfade. Dadurch läuft die App auch in einem Unterordner,
  // z. B. später auf GitHub Pages unter https://name.github.io/federleicht/
  base: './',
  plugins: [pdfjsAssetsPlugin(), ocrAssetsPlugin(), serviceWorkerPlugin()],
  // pdf.js ist groß, wird aber erst geladen, wenn eine PDF geöffnet wird -> Warnung erst ab 1,5 MB
  build: { chunkSizeWarningLimit: 1500 },
});
