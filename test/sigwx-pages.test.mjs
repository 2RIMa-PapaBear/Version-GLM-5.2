// Pages TEMSI/WinTEM/fronts du dossier (pilote 02/10) : une page PLEINE
// par carte — TEMSI en PAYSAGE, WinTEM et fronts en PORTRAIT — image
// ajustée SANS DÉFORMATION, page HORODATÉE (bande de titre : couche +
// échéance UTC/locale + date). Vérifié sur les MediaBox et les
// placements d'images du flux PDF (même méthode que vac-pages.test.mjs).
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
const { drawSigwxPages } = await import('../js/navlog-pdf.js');

const JPEG1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/2gAMAwEAAhEDEQA/AKgA/9k=';

// Dimensions natives réelles des cartes AEROWEB (relevées 02/10) :
// TEMSI 1160×827 (paysage), WinTEM 1024×1800 (portrait), fronts 600×539.
const CHARTS = [
    { kind: 'temsi', title: 'TEMSI SFC -FL 150', when: 'Valable 15h00 UTC (17h00) · ven. 02/10', img: JPEG1, w: 1160, h: 827 },
    { kind: 'wintem', title: 'WINTEM FL 020 - 100', when: 'Valable 18h00 UTC (20h00) · ven. 02/10', img: JPEG1, w: 1024, h: 1800 },
    { kind: 'fronts', title: 'Fronts · Europe ouest', when: 'Valable 12h00 UTC (14h00) · ven. 02/10', img: JPEG1, w: 600, h: 539 },
];

const mediaBoxes = (raw) =>
    [...raw.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map(m => [ +m[1], +m[2] ]);
const placements = (raw) =>
    [...raw.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/\w+ Do/g)]
        .map(m => ({ w: +m[1], h: +m[2], x: +m[3], y: +m[4] }));
// Les ( ) des textes PDF sont échappés \( \) dans le flux.
const hasText = (raw, s) => raw.includes(s.replace(/\(/g, '\\(').replace(/\)/g, '\\)'));

test('drawSigwxPages : TEMSI paysage, WinTEM et fronts portrait — une page par carte', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawSigwxPages(doc, CHARTS);
    equal(doc.getNumberOfPages(), n0 + 3, '3 pages de cartes');
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const boxes = mediaBoxes(raw).slice(n0);
    equal(boxes.length, 3, 'MediaBox des pages ajoutées');
    ok(Math.abs(boxes[0][0] - 595.32) < 0.5 && Math.abs(boxes[0][1] - 419.53) < 0.5,
        `TEMSI paysage 595×419 (${boxes[0][0]}×${boxes[0][1]})`);
    ok(Math.abs(boxes[1][0] - 419.53) < 0.5 && Math.abs(boxes[1][1] - 595.32) < 0.5,
        `WinTEM portrait 419×595 (${boxes[1][0]}×${boxes[1][1]})`);
    ok(Math.abs(boxes[2][0] - 419.53) < 0.5 && Math.abs(boxes[2][1] - 595.32) < 0.5,
        `fronts portrait 419×595 (${boxes[2][0]}×${boxes[2][1]})`);
});

test('drawSigwxPages : images pleine page SANS déformation (ratio préservé, ajustée puis centrée)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    drawSigwxPages(doc, CHARTS);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    const places = placements(raw);
    equal(places.length, 3, '3 images posées');
    // Zone utile (marges 14 pt + bande 13 + écart 5 + pied 9) :
    // paysage 567.32×364.53, portrait 391.53×540.32.
    const expect = [
        { w: Math.min(567.32 / 1160, 364.53 / 827) * 1160, h: Math.min(567.32 / 1160, 364.53 / 827) * 827 },
        { w: Math.min(391.53 / 1024, 540.32 / 1800) * 1024, h: Math.min(391.53 / 1024, 540.32 / 1800) * 1800 },
        { w: Math.min(391.53 / 600, 540.32 / 539) * 600, h: Math.min(391.53 / 600, 540.32 / 539) * 539 },
    ];
    CHARTS.forEach((c, i) => {
        const p = places[i];
        ok(Math.abs(p.w / p.h - c.w / c.h) < 0.005, `carte ${c.kind} : ratio préservé (${(p.w / p.h).toFixed(3)})`);
        ok(Math.abs(p.w - expect[i].w) < 1 && Math.abs(p.h - expect[i].h) < 1,
            `carte ${c.kind} pleine page (${p.w.toFixed(0)}×${p.h.toFixed(0)} pt attendu ${expect[i].w.toFixed(0)}×${expect[i].h.toFixed(0)})`);
        // Centrage : au moins un axe posé au bord de sa zone utile (y du
        // flux en origine BASSE → converti en origine haute).
        const [pw, ph] = c.kind === 'temsi' ? [595.32, 419.53] : [419.53, 595.32];
        const top = ph - p.y - p.h;
        const touches = Math.abs(p.x - 14) < 1.5 || Math.abs(p.x + p.w - (pw - 14)) < 1.5
            || Math.abs(top - 32) < 1.5 || Math.abs(top + p.h - (ph - 23)) < 1.5;
        ok(touches, `carte ${c.kind} : ajustée à la zone utile`);
    });
});

test('drawSigwxPages : pages HORODATÉES (bande titre : couche + échéance UTC/locale + date)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    drawSigwxPages(doc, CHARTS);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(hasText(raw, 'TEMSI SFC -FL 150'), 'titre de couche TEMSI');
    ok(hasText(raw, 'WINTEM FL 020 - 100'), 'titre de couche WinTEM');
    ok(hasText(raw, 'Fronts · Europe ouest'), 'titre fronts');
    for (const t of ['Valable 15h00 UTC (17h00)', 'Valable 18h00 UTC (20h00)', 'Valable 12h00 UTC (14h00)', 'ven. 02/10']) {
        ok(hasText(raw, t), `horodatage « ${t} »`);
    }
    ok(hasText(raw, 'Météo-France (AEROWEB)'), 'source en pied de page');
});

test('drawSigwxPages : liste vide → aucune page', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    drawSigwxPages(doc, []);
    drawSigwxPages(doc, null);
    equal(doc.getNumberOfPages(), n0);
});

// Fiche 21 (dimension dégénérée) : 0/NaN/±Infinity/négatif → repli pleine
// zone SANS corrompre le flux (« … NaN cm ») — même garde que les VAC.
test('drawSigwxPages : dimensions dégénérées → repli pleine zone, PDF sans NaN', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    drawSigwxPages(doc, [
        { kind: 'temsi', title: 'TEMSI', when: 'x', img: JPEG1, w: Infinity, h: Infinity },
        { kind: 'wintem', title: 'WinTEM', when: 'x', img: JPEG1, w: NaN, h: 1800 },
        { kind: 'fronts', title: 'Fronts', when: 'x', img: JPEG1, w: 0, h: 539 },
        { kind: 'fronts', title: 'Fronts', when: 'x', img: JPEG1, w: -600, h: 539 },
        { kind: 'fronts', title: 'Fronts', when: 'x', img: JPEG1 },
    ]);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(!raw.includes('NaN'), 'aucun NaN dans le flux PDF');
    ok(!/"-[\d.]+ 0 0/.test(raw), 'aucune dimension négative');
    const places = placements(raw);
    equal(places.length, 5, '5 pages posées malgré tout');
    for (const p of places) {
        const portrait = p.h > p.w;
        ok(Number.isFinite(p.w) && Number.isFinite(p.h)
            && (portrait ? (p.w > 380 && p.h > 530) : (p.w > 550 && p.h > 350)),
            `repli pleine zone (${p.w.toFixed(0)}×${p.h.toFixed(0)} pt)`);
    }
});
