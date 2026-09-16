// Page Météo du dossier (drawWeatherPage) — exigence pilote 16/09 : les
// graphiques TAF sont TOUJOURS posés à la LARGEUR DE PAGE A5 (INNER
// = 419.53 − 2×28 = 363.53 pt), jamais réduits ; la page se CONTINUE
// s'il n'y a pas la place. Vérifié sur les placements `cm … Do` du flux
// jsPDF (non compressé).
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
const { drawWeatherPage } = await import('../js/navlog-pdf.js');

const JPEG1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/2gAMAwEAAhEDEQA/AKgA/9k=';

// Placements d'images dans le flux : "w 0 0 h x y cm /Name Do".
function imagePlacements(raw) {
    return [...raw.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/\w+ Do/g)]
        .map((m) => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4] }));
}

test('graphiques TAF : PLEINE LARGEUR A5, jamais réduits', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawWeatherPage(doc, {
        isFr: true, generatedLabel: 'test',
        dep: { title: 'Départ LFRV - METAR', raw: 'LFRV 160900Z 32008KT 9999 FEW030 Q1018', decode: true },
        terrains: [
            { label: 'Déroutement LFRD', tafRaw: 'x', chart: JPEG1, chartRatio: 0.43, chartFmt: 'JPEG' },
            { label: 'Arrivée LFOO', tafRaw: 'x', chart: JPEG1, chartRatio: 0.5, chartFmt: 'JPEG' },
        ],
    });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const places = imagePlacements(raw);
    ok(places.length >= 2, `${places.length} graphiques posés`);
    for (const p of places) {
        ok(Math.abs(p.w - 363.53) < 1.5, `largeur ${p.w.toFixed(1)} pt = pleine page (363.5)`);
    }
});

test('place insuffisante → la page Météo CONTINUE (pas de réduction)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    // METAR long (multi-lignes) + 2 graphiques hauts : impossible en une page.
    const longRaw = 'LFRV 160900Z 32008KT 9999 FEW030 SCT120 BKN200 1234/5678 8000 -RA BR ' + 'NOSIG '.repeat(12);
    drawWeatherPage(doc, {
        isFr: true, generatedLabel: 'test',
        dep: { title: 'Départ LFRV - METAR', raw: longRaw, decode: true },
        terrains: [
            { label: 'Arrivée LFOO', tafRaw: 'x', chart: JPEG1, chartRatio: 0.62, chartFmt: 'JPEG' },
            { label: 'Déroutement LFRD', tafRaw: 'x', chart: JPEG1, chartRatio: 0.62, chartFmt: 'JPEG' },
        ],
    });
    const pages = doc.getNumberOfPages() - n0;
    ok(pages >= 2, `${pages} page(s) météo (continuation au lieu de réduire)`);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    for (const p of imagePlacements(raw)) {
        ok(Math.abs(p.w - 363.53) < 1.5, `largeur ${p.w.toFixed(1)} pt maintenue en continuation`);
    }
});

test('sans graphique : une seule page, texte brut seul', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawWeatherPage(doc, {
        isFr: true, generatedLabel: 'test',
        dep: { title: 'Départ LFRV - METAR', raw: 'LFRV 160900Z 32008KT 9999 Q1018', decode: false },
        terrains: [{ label: 'Arrivée LFOO', tafRaw: 'TAF…' }],
    });
    equal(doc.getNumberOfPages() - n0, 1);
});
