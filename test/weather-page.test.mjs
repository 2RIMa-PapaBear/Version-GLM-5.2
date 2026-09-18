// Page « Météo au dossier » v7 — REMPLACE la règle v5 du 16/09 (« graphiques
// pleine hauteur, jamais réduits, page continuée ») : retour pilote 17/09
// nuit — mise en page d'avant CONSERVÉE (METAR puis les graphiques à la
// suite), les 2 graphiques TAF empilés l'un SOUS l'autre sur la MÊME page
// météo, PLEINE LARGEUR A5 conservée (363,5 pt), hauteur réduite pour que
// TOUT tienne sur la page ; un graphique seul garde sa hauteur naturelle.
// Vérification géométrique par traçage des appels text/addImage. `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
globalThis.self = globalThis; globalThis.window = globalThis;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = (0, eval)('typeof require === "function" ? require : null');
const _m = { exports: {} };
new Function('module', 'exports', 'require', fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8'))(_m, _m.exports, require);
const { jsPDF } = _m.exports;
const { drawWeatherPage } = await import('../js/navlog-pdf.js');

const PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

/** Instrumente le doc : chaque texte et image avec son numéro de page. */
function tracer(doc) {
    const evts = [];
    const page = () => doc.internal.getCurrentPageInfo().pageNumber;
    const dText = doc.text.bind(doc);
    doc.text = (t, x, y, o) => { evts.push({ page: page(), type: 'text', t: String(t) }); return dText(t, x, y, o); };
    const dImg = doc.addImage.bind(doc);
    doc.addImage = (data, fmt, x, y, w, h) => { evts.push({ page: page(), type: 'img', w, h }); return dImg(data, fmt, x, y, w, h); };
    const dPage = doc.addPage.bind(doc);
    doc.addPage = (...a) => { const r = dPage(...a); evts.push({ page: page(), type: 'addPage' }); return r; };
    return evts;
}

describe('page Météo v6 (2 TAF sur la même page)', () => {
test('déroutement et arrivée : MÊME page, pleine largeur, hauteur réduite', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const evts = tracer(doc);
    drawWeatherPage(doc, {
        isFr: true, generatedLabel: 'test 17/09',
        dep: { title: 'DÉPART · LFRV', raw: 'LFRV 171900Z AUTO 33008KT 9999NDZ SCT043 17/08 Q1019=', decode: true },
        terrains: [
            { label: 'DÉROUTEMENT · LFRD', chart: PX, chartRatio: 1.42, chartFmt: 'PNG' },
            { label: 'ARRIVÉE · LFOO', chart: PX, chartRatio: 1.42, chartFmt: 'PNG' },
        ],
    });
    const pg = e => e.page;
    const metar = evts.find(e => e.type === 'text' && /LFRV 171900Z/.test(e.t));
    const bandeDer = evts.find(e => e.type === 'text' && /D.ROUTEMENT/.test(e.t));
    const bandeArr = evts.find(e => e.type === 'text' && /ARRIV/.test(e.t) && /TAF/.test(e.t));
    const imgs = evts.filter(e => e.type === 'img');
    const nPages = doc.internal.getNumberOfPages();
    console.log(`2 graphiques : ${nPages} pages · METAR p${metar?.page} · déroutement p${bandeDer?.page} · arrivée p${bandeArr?.page} · images ${imgs.map(i => `${Math.round(i.w)}×${Math.round(i.h)} p${i.page}`).join(' + ')}`);
    assert.ok(metar && bandeDer && bandeArr, 'éléments tracés');
    assert.equal(nPages, 2, 'page météo UNIQUE (2 = page blanche initiale du doc de test + 1)');
    assert.equal(bandeDer?.page, bandeArr?.page, 'les 2 bandeaux TAF sur la même page');
    assert.equal(metar?.page, bandeDer?.page, 'METAR sur la même page que les TAF');
    assert.equal(imgs.length, 2);
    assert.equal(imgs[0].page, imgs[1].page, 'les 2 graphiques sur la même page');
    imgs.forEach(i => assert.equal(Math.round(i.w), 364, 'largeur pleine page (364 pt)'));
    imgs.forEach(i => assert.ok(i.h > 100 && i.h < 250, `hauteur réduite pour que tout tienne (${Math.round(i.h)})`));
});

test('graphique TAF seul : hauteur naturelle conservée', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const evts = tracer(doc);
    drawWeatherPage(doc, {
        isFr: true, generatedLabel: 'test',
        dep: { title: 'DÉPART · LFRV', raw: 'LFRV 171900Z 9999NDZ SCT043=', decode: false },
        terrains: [{ label: 'ARRIVÉE · LFOO', chart: PX, chartRatio: 1.42, chartFmt: 'PNG' }],
    });
    const img = evts.find(e => e.type === 'img');
    assert.ok((img?.h || 0) > 460, `hauteur naturelle conservée (${Math.round(img?.h || 0)} pt)`);
    assert.equal(Math.round(img?.w || 0), 364);
});
});
