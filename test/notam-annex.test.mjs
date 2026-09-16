// Annexe NOTAM : ① elle peut être générée APRÈS la page Météo, qui se
// termine en BLANC (bandeaux) — retour pilote 16/09 « les NOTAM
// n'apparaissent pas, pages blanches » : l'annexe doit FORCER une couleur
// d'encre sombre sur chaque page, indépendamment de l'état hérité.
// ② les titres longs (item D « 16 17 19 27 1530-1830, … ») doivent être
// REPLIÉS sur la largeur utile (retour pilote 16/09 : débordement + superposition)
// et la flèche → remplacée (absente de la police PDF → glyphe cassé « !' »).
import test from 'node:test';
import { ok } from 'node:assert/strict';
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
const { drawNotamAnnex } = await import('../js/navlog-pdf.js');

const NOTAM = {
    _grp: 'AD',
    series: 'P', number: '3953', year: '2025', qLine: { code23: 'OBST' },
    startValidity: '2026-09-10T00:00:00Z', endValidity: '2026-10-10T00:00:00Z',
    itemD: 'SEP 10-31 0600-1700',
    itemE: 'GRUE 320M QFU 180 1.2NM SSE AD AVERTISSEUR BALISE LUMINEUX.',
};

test('annexe NOTAM : encre sombre FORCÉE même après une page laissée en blanc', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    // Héritage BLANC (ce que laisse la page Météo via ses bandeaux).
    doc.setTextColor(255, 255, 255);
    drawNotamAnnex(doc, [NOTAM, { ...NOTAM, _grp: 'OBST', number: '12' }], true);
    ok(doc.getNumberOfPages() === n0 + 1 || doc.getNumberOfPages() === n0 + 2, 'page(s) annexe');
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('NOTAM sélectionnés'), 'titre annexe présent');
    ok(raw.includes('GRUE 320M'), 'corps NOTAM présent');
    // L'encre sombre (INK #111827 ≈ 0.07 0.09 0.15) doit être posée dans le
    // flux AVANT le premier texte de l'annexe — c'est le reset forcé.
    const firstTj = raw.indexOf(') Tj');
    const darkRg = raw.slice(0, firstTj).match(/0\.0\d+ 0\.0\d+ 0\.1\d+ rg/g);
    ok(darkRg && darkRg.length > 0, 'couleur d encre sombre forcée avant le premier texte');
});

test('annexe NOTAM : titre long (item D plages) REPLIÉ, sans glyphe cassé', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const LONG_D = '16 17 19 27 1530-1830, 13 18 22 1730-1830, 11 12 25 0800-1830, 15 0930-1830';
    drawNotamAnnex(doc, [{ ...NOTAM, series: 'F', number: '1869', year: '2026', qLine: { code23: 'SE' }, itemD: LONG_D }], true);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('F 1869/26'), 'titre présent');
    // La flèche U+2192 ne doit PAS partir dans le flux (octets UTF-8 « â† »)
    // — remplacée par un tiret, comme les bandeaux de la page Météo.
    ok(!raw.includes('â†'), 'flèche remplacée (aucun octet UTF-8 parasite)');
    ok(raw.includes('15 0930-1830'), 'plages item D complètes (le replié ne tronque pas)');
    // Aucune ligne de texte ne dépasse la largeur utile (363.5 pt) :
    // chaque ligne repliée est un Tj distinct dont on mesure la largeur.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    const tjs = [...raw.matchAll(/\(([^)]{4,})\) Tj/g)].map((m) => m[1]);
    const tooLong = tjs.filter((t) => doc.getTextWidth(t) > 363.5);
    ok(tooLong.length === 0, 'aucune ligne plus large que la zone utile (363.5 pt)'
        + (tooLong.length ? ' — ex : « ' + tooLong[0].slice(0, 40) + ' »' : ''));
});
