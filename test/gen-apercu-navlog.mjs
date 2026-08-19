// Aperçu PDF 2 pages du Log de nav — données d'exemple réalistes.
// Usage : node test/gen-apercu-navlog.mjs  →  Apercu_Log-nav_2pages.pdf (racine).
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

// Exemple : LFPB (Toussus) → LFOB (Beauvais) → LFRM (Le Mans), vent d'ouest.
const doc = drawNavLogPdf(jsPDF, {
    aircraftType: 'DR400-120', aircraftReg: 'F-GKAZ',
    qnh: 1013, windDir: 280, windKt: 14, runway: '28',
    distanceNm: 151, timeLabel: '1h32',
    metarRaw: 'LFPB 190830Z 28012KT 9999 FEW035 18/12 Q1013 NOSIG',
    rows: [
        { from: 'LFPB', to: 'LFOB', distRemain: 151, dist: 42, zSecu: 1500, zRet: 3500, rm: '331', cm: '329', tsv: 24, tav: 26 },
        { from: 'LFOB', to: 'LFRM', distRemain: 109, dist: 109, zSecu: 1200, zRet: 3500, rm: '264', cm: '261', tsv: 61, tav: 66 },
    ],
    calc: {
        isFr: true,
        fromIcao: 'LFPB', fromName: 'Toussus-le-Noble',
        toIcao: 'LFRM', toName: 'Le Mans-Arnage',
        waypoints: 'LFOB',
        cruiseAltFt: 3500, tasKt: 110, fuelBurnLph: 25, isNight: false,
        distanceNm: 151, distanceKm: 280,
        trueCourse: 332, magHeading: 329, declination: 1,
        wind: { dir: 280, speedKt: 22 }, driftDeg: -6,
        groundSpeed: 104, timeLabel: '1h32',
        fuel: { tripL: 21.4, reserveL: 8, totalL: 29.4, reserveMin: 30 },
        clearance: { maxFt: 660, minClearanceFt: 1840, level: 'ok' },
        isMultiLeg: true,
        legs: [
            { from: 'LFPB', to: 'LFOB', dist: 42, hdg: 329, eteLabel: '26 min', fuelL: 5.8, freq: '120.300 AFIS' },
            { from: 'LFOB', to: 'LFRM', dist: 109, hdg: 261, eteLabel: '1h06', fuelL: 15.6, freq: '121.100 TWR' },
        ],
    },
});

const out = path.join(root, 'Apercu_Log-nav_2pages.pdf');
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log(`OK : ${out} (${doc.getNumberOfPages()} pages)`);
