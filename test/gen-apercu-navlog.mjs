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
const { drawNavLogPdf, drawFileCover, drawWeatherPage } = await import(pathToFileURL(path.join(root, 'js', 'navlog-pdf.js')).href);

const VARIANTS = [
    ['fixtures-navlog-sample.json', 'Apercu_Log-nav_3pages.pdf'],
    ['fixtures-navlog-sample-10wp.json', 'Apercu_Log-nav_3pages_10wp.pdf'],
    ['fixtures-navlog-sample-14wp.json', 'Apercu_Log-nav_14wp.pdf'],
    ['fixtures-navlog-sample-centro.json', 'Apercu_Log-nav_4pages_centro.pdf'],
];

for (const [fixture, outName] of VARIANTS) {
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', fixture), 'utf8'));
    const doc = drawNavLogPdf(jsPDF, sample);
    const out = path.join(root, outName);
    fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
    console.log(`OK : ${out} (${doc.getNumberOfPages()} pages) — ${fixture}`);
}

// ---- Aperçu du DOSSIER DE VOL complet (B1 phase 2) : log + garde + météo,
// pages de garde remontées en tête comme dans le générateur réel.
{
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample.json'), 'utf8'));
    const doc = drawNavLogPdf(jsPDF, sample);
    const n0 = doc.getNumberOfPages();
    drawFileCover(doc, {
        isFr: true,
        generatedLabel: 'sam. 13/09/2026 21:45',
        routeLabel: 'LFRV - LFOO · dégagement LFRD',
        aircraftLabel: 'Dynamic WT9 Club',
        rows: [
            { status: 'ok', label: 'Météo', detail: 'METAR 12 min · TAF OK · arrivée OK', ref: '21:33' },
            { status: 'ok', label: 'NOTAM', detail: '53 NOTAM · générés il y a 6 min', ref: '21:39' },
            { status: 'warn', label: 'VAC', detail: '1/2 consultées', ref: '2026-09-03' },
            { status: 'ok', label: 'Carburant', detail: 'requis 61 L · embarqué 70 L · dégagement LFRD', ref: '' },
            { status: 'warn', label: 'Perfs piste', detail: 'décollage OK · atterrissage !', ref: '' },
            { status: 'ok', label: 'Centrage', detail: 'dans l\u2019enveloppe', ref: '' },
        ],
        vac: [
            { icao: 'LFRV', ts: Date.now() - 3600e3 },
            { icao: 'LFOO', ts: null },
        ],
        vacAirac: '2026-09-03',
    });
    // Page météo v3 : pixel PNG 1×1 factice pour le chemin addImage (le
    // vrai graphique est capturé en navigateur — ici on valide le LAYOUT
    // une page + les 2 colonnes TAF).
    const PX1 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    drawWeatherPage(doc, {
        isFr: true,
        generatedLabel: 'sam. 13/09/2026 21:45',
        dep: { title: 'Départ LFRV - METAR', raw: 'LFRV 131950Z AUTO 23006KT 160V290 CAVOK 25/13 Q1025 NOSIG', decode: true },
        terrains: [
            { label: 'Déroutement LFRD',
              tafRaw: 'TAF LFRD 131100Z 1312/1412 VRB05KT CAVOK BECMG 1315/1317 01010KT TEMPO 1321/1324 BKN007 PROB30 TEMPO 1403/1407 0500 FG VV///',
              chart: PX1, chartRatio: 0.4 },
            { label: 'Arrivée LFOO', note: 'station LFRI, 20 NM',
              tafRaw: 'TAF LFRI 131100Z 1312/1412 24010KT CAVOK TX27/1315Z TN15/1406Z TEMPO 1403/1408 BKN006 PROB30 TEMPO 1403/1405 0800 FG BKN002',
              chart: PX1, chartRatio: 0.4 },
        ],
    });
    const n1 = doc.getNumberOfPages();
    if (n1 - n0 === 2) {
        doc.movePage(n0 + 1, 1);
        doc.movePage(n1, 2);
    }
    const out = path.join(root, 'Apercu_Dossier_LFRV-LFOO.pdf');
    fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
    const p1 = String(doc.internal.pages?.[1] || '');
    const p2 = String(doc.internal.pages?.[2] || '');
    const p1ok = /Dossier de vol/.test(p1) && !/VFR Flight Log/.test(p1);
    // p2 = météo : contient les METAR bruts (NOSIG) mais PAS la trame du log.
    const p2ok = /NOSIG/.test(p2) && !/VFR Flight Log/.test(p2);
    console.log(`OK : ${out} (${doc.getNumberOfPages()} pages, garde+météo en tête : ${n1 - n0 === 2 ? 'oui' : 'NON — movePage raté'}, p1=${p1ok ? 'GARDE' : '??'} p2=${p2ok ? 'MÉTÉO' : '??'})`);
}
