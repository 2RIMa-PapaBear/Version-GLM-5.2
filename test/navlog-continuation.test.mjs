// Page de continuation du tableau waypoints (> 10 tronçons, retour pilote
// 06/09) : un calcul à 14 tronçons doit produire UNE page de plus, avec le
// reste des tronçons et la ligne TOTAL — la page 2 principale montre
// « page suivante » au lieu du total.
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
globalThis.self = globalThis;
globalThis.window = globalThis;
const jspdfMod = await import('../vendor/jspdf.umd.min.js');
const jsPDF = jspdfMod.default?.jsPDF || globalThis.jspdf?.jsPDF;
const { drawNavLogPdf } = await import('../js/navlog-pdf.js');

const legs = [];
for (let i = 0; i < 14; i++) {
    legs.push({ from: `LFA${i}`, to: `LFB${i}`, dist: 10 + i, hdg: 90 + i, eteLabel: '0:12', fuelL: 2 + i, freq: '123.500' });
}

// 7 tronçons → pas de continuation (2 pages : p1 + p2).
const court = drawNavLogPdf(jsPDF, {
    isFr: true, fromIcao: 'LFRV', toIcao: 'LFRC',
    calc: { isFr: true, isMultiLeg: true, legs: legs.slice(0, 7), distanceNm: 80, timeLabel: '1:00', fuel: { tripL: 12 } },
});
equal(court.getNumberOfPages(), 2, '7 tronçons = 2 pages (pas de continuation)');

// 14 tronçons → p1 + p2 (10 + mention) + p2-bis (4 + TOTAL).
const long = drawNavLogPdf(jsPDF, {
    isFr: true, fromIcao: 'LFRV', toIcao: 'LFRC',
    calc: { isFr: true, isMultiLeg: true, legs, distanceNm: 160, timeLabel: '2:00', fuel: { tripL: 25 } },
});
equal(long.getNumberOfPages(), 3, '14 tronçons = 3 pages (continuation insérée)');

// Contenu via un constructeur enregistreur (pattern qa-navlog-geometry).
const store = [];
function RecordingCtor(opts) {
    const doc = new jsPDF(opts);
    const origText = doc.text.bind(doc);
    doc.text = (text, x, y, opt) => { store.push({ s: String(text), page: doc.getCurrentPageInfo().pageNumber }); return origText(text, x, y, opt); };
    return doc;
}
drawNavLogPdf(RecordingCtor, {
    isFr: true, fromIcao: 'LFRV', toIcao: 'LFRC',
    calc: { isFr: true, isMultiLeg: true, legs, distanceNm: 160, timeLabel: '2:00', fuel: { tripL: 25 } },
});
const byPage = (n) => store.filter(t => t.page === n).map(t => t.s).join(' | ');
ok(/page suivante/.test(byPage(2)), 'page 2 : mention « page suivante »');
ok(/DÉTAIL DES WAYPOINTS \(SUITE\)/i.test(byPage(3)), 'page 3 : titre « Détail des waypoints (suite) »');
ok(byPage(3).includes('LFB13'), 'page 3 : tronçons de la suite présents');
ok(/TOTAL/.test(byPage(3)), 'page 3 : ligne TOTAL');
// (la p2 contient légitimement des 'TOTAL' du bloc carburant — critère : le TOTAL DU TABLEAU est en p3, vérifié ci-dessus)
