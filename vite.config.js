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

export default defineConfig({
  // "./" = relative Pfade. Dadurch läuft die App auch in einem Unterordner,
  // z. B. später auf GitHub Pages unter https://name.github.io/federleicht/
  base: './',
  plugins: [serviceWorkerPlugin()],
});
