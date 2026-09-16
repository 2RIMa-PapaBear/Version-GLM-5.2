// Cartes VAC intégrées au dossier (option ②=B, pilote 16/09) : pages A5
// APRÈS la carte de vol — une page par page de VAC, bande titre terrain +
// AIRAC + i/n, image ajustée. Vérifié sur les placements d'images du flux.
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.self = globalThis;
globalThis.window = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = (0, eval)('typeof require === "function" ? require : null');
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;
const { drawVacPages } = await import('../js/navlog-pdf.js');

const JPEG1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/2gAMAwEAAhEDEQA/AKgA/9k=';

test('drawVacPages : pages A5 ajoutées, bande titre, image pleine zone', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawVacPages(doc, [
        { label: 'Départ LFRV', airac: '2026-09-03', pages: [{ data: JPEG1, w: 990, h: 1400 }, { data: JPEG1, w: 990, h: 1400 }] },
        { label: 'Dégagement LFEY', airac: '2026-09-03', pages: [{ data: JPEG1, w: 990, h: 1400 }] },
    ]);
    equal(doc.getNumberOfPages(), n0 + 3, '3 pages VAC (2 + 1)');
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('VAC · Départ LFRV'), 'bande titre départ');
    ok(raw.includes('VAC · Dégagement LFEY'), 'bande titre dégagement');
    ok(raw.includes('2026-09-03'), 'AIRAC affiché');
    ok(raw.includes('page 2/2'), 'numérotation i/n');
    // Aspect A5 (419.53×595.32) : l'image 990×1400 (≈ A5) doit remplir la
    // zone utile — largeur posée ≈ 387.5 pt (page − marges − bande).
    const places = [...raw.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/\w+ Do/g)]
        .map((m) => ({ w: +m[1], h: +m[2] }));
    equal(places.length, 3, '3 images posées');
    for (const p of places) {
        ok(p.w > 370 && p.h > 520, `image pleine page (${p.w.toFixed(0)}×${p.h.toFixed(0)} pt)`);
    }
});

test('drawVacPages : liste vide → aucune page', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawVacPages(doc, []);
    drawVacPages(doc, null);
    equal(doc.getNumberOfPages(), n0);
});
