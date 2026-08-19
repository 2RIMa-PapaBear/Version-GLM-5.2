// Aperçus PDF 3 pages du Log de nav — données d'exemple réalistes.
// Usage : node test/gen-apercu-navlog.mjs
//   → Apercu_Log-nav_3pages.pdf      (2 waypoints)
//   → Apercu_Log-nav_3pages_10wp.pdf (10 waypoints — tenue de la page 2)
// Ce script n'est PAS exécuté par `npm test` (liste explicite des fichiers).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Le bundle UMD de jsPDF attend un contexte navigateur (self/exports) : on
// l'évalue dans un wrapper CommonJS avec self polyfillé (Node, pas de DOM).
globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;
const { drawNavLogPdf } = await import(pathToFileURL(path.join(root, 'js', 'navlog-pdf.js')).href);

const VARIANTS = [
    ['fixtures-navlog-sample.json', 'Apercu_Log-nav_3pages.pdf'],
    ['fixtures-navlog-sample-10wp.json', 'Apercu_Log-nav_3pages_10wp.pdf'],
];

for (const [fixture, outName] of VARIANTS) {
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', fixture), 'utf8'));
    const doc = drawNavLogPdf(jsPDF, sample);
    const out = path.join(root, outName);
    fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
    console.log(`OK : ${out} (${doc.getNumberOfPages()} pages) — ${fixture}`);
}
