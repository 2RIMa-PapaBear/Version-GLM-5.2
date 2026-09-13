// Micro-diagnostic (non listé) : vérifie que drawFileCover/drawWeatherPage
// + doc.movePage placent bien GARDE en p1 et MÉTÉO en p2.
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.resolve('vendor/jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, createRequire(import.meta.url));
const { jsPDF } = _m.exports;
const { drawFileCover, drawWeatherPage } = await import(pathToFileURL(path.resolve('js/navlog-pdf.js')).href);

const doc = new jsPDF({ unit: 'pt', format: [419.53, 595.32] });
doc.text('LOGPAGE1', 50, 50);
doc.addPage(); doc.text('LOGPAGE2', 50, 50);
const n0 = doc.getNumberOfPages();
drawFileCover(doc, { isFr: true, generatedLabel: 'test', routeLabel: 'A → B', aircraftLabel: 'X', rows: [], vac: [], vacAirac: '' });
drawWeatherPage(doc, { isFr: true, generatedLabel: 'test', blocks: [{ title: 'Arrivée LFOO — METAR', raw: 'LFOO 131950Z 31008KT NOSIG' }] });
const n1 = doc.getNumberOfPages();
doc.movePage(n0 + 1, 1);
doc.movePage(n1, 2);
for (let i = 1; i <= doc.getNumberOfPages(); i++) {
    const c = String(doc.internal.pages[i] || '');
    console.log('p' + i + ':',
        c.includes('Dossier de vol') ? 'GARDE'
        : c.includes('NOSIG') ? 'MÉTÉO'
        : c.includes('LOGPAGE') ? 'LOG' : '?');
}
