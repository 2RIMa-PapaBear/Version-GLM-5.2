// Continuations du PDF (retours pilote 06/09) :
//  - log de nav : au-delà de 9 tronçons, une page « VFR Flight Log (suite) »
//    sur la MÊME trame (tableau à 18 lignes + checks Croisière / Point
//    Tournant / Vent Arrière conservés en bas de page) ;
//  - détail des waypoints : capacité DYNAMIQUE — le tableau remplit tout
//    l'espace utile de la page « Calcul de navigation » (jusqu'à la note de
//    bas de page) AVANT de créer une page « Détail des waypoints (suite) ».
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
globalThis.self = globalThis;
globalThis.window = globalThis;
const jspdfMod = await import('../vendor/jspdf.umd.min.js');
const jsPDF = jspdfMod.default?.jsPDF || globalThis.jspdf?.jsPDF;
const { drawNavLogPdf } = await import('../js/navlog-pdf.js');

const mk = (n) => {
    const legs = [], rows = [];
    for (let i = 0; i < n; i++) {
        legs.push({ from: `LFA${i}`, to: `LFB${i}`, dist: 10 + i, hdg: 90 + i, eteLabel: '0:12', fuelL: 2 + i, freq: '123.500' });
        rows.push({
            from: `LFA${i}`, to: `LFB${i}`, distRemain: 100, dist: 10 + i,
            zSecu: 1200, zRet: 3500, rm: '090', cm: '095', tsv: 12, tav: 13,
        });
    }
    return {
        isFr: true, fromIcao: 'LFRV', toIcao: 'LFRC', rows,
        calc: { isFr: true, isMultiLeg: true, legs, distanceNm: 160, timeLabel: '2:00', fuel: { tripL: 25 } },
    };
};

// Contenu via un constructeur enregistreur (pattern qa-navlog-geometry).
const store = [];
function RecordingCtor(opts) {
    const doc = new jsPDF(opts);
    const origText = doc.text.bind(doc);
    doc.text = (text, x, y, opt) => { store.push({ s: String(text), y, page: doc.getCurrentPageInfo().pageNumber }); return origText(text, x, y, opt); };
    return doc;
}

// 7 tronçons → pas de continuation (2 pages : p1 + Calcul).
equal(drawNavLogPdf(jsPDF, mk(7)).getNumberOfPages(), 2, '7 tronçons = 2 pages');

// 10 tronçons → p1(9) + suite log + Calcul COMPLET (capacité dynamique ≥ 10).
equal(drawNavLogPdf(jsPDF, mk(10)).getNumberOfPages(), 3, '10 tronçons = 3 pages (le détail tient sur la page Calcul)');

// 14 tronçons → 3 pages : le détail remplit la page Calcul, TOTAL présent,
// AUCUNE page suite inutile (retour pilote : remplir avant de paginer).
store.length = 0;
drawNavLogPdf(RecordingCtor, mk(14));
const byPage = (n) => store.filter(t => t.page === n).map(t => t.s).join(' | ');
equal(store.map(t => t.page).pop(), 3, '14 tronçons = 3 pages');
ok(/VFR FLIGHT LOG \(SUITE\)/i.test(byPage(2)), 'page 2 : bandeau « VFR Flight Log (suite) »');
ok(byPage(2).includes('LFA13-LFB13'), 'page 2 : les 5 tronçons au-delà de 9 présents');
ok(/Check Croisière/.test(byPage(2)) && /Check Point Tournant/.test(byPage(2)) && /Check Vent Arrière/.test(byPage(2)), 'page 2 : les 3 cadres Check conservés');
ok(/LFA13 ?- ?LFB13/.test(byPage(3)), 'page 3 : le détail des 14 tronçons tient ENTIER sur la page Calcul');
ok(/TOTAL/.test(byPage(3)), 'page 3 : ligne TOTAL (pas de renvoi)');
ok(!/page suivante/.test(byPage(3)), 'page 3 : pas de mention « page suivante » (tout tient)');

// 20 tronçons → 4 pages : Calcul rempli au maximum + 1 page suite détail.
store.length = 0;
drawNavLogPdf(RecordingCtor, mk(20));
const calcTxt = byPage(3);
ok(/page suivante/.test(calcTxt), 'page 3 (20 tronçons) : Calcul rempli puis mention suite');
const onCalc = calcTxt.match(/LFA\d+ ?- ?LFB/g) || [];
ok(onCalc.length >= 12, `page 3 : au moins 12 tronçons affichés avant coupure (${onCalc.length})`);
ok(/DÉTAIL DES WAYPOINTS \(SUITE\)/i.test(byPage(4)), 'page 4 : suite du détail');
ok(/LFA19 ?- ?LFB19/.test(byPage(4)), 'page 4 : dernier tronçon présent');
ok(/TOTAL/.test(byPage(4)), 'page 4 : ligne TOTAL');

// La page Calcul remplie reste au-dessus de la note de bas de page (FOOT_TOP
// = 557.8, baseline de la dernière ligne de tableau ≤ 555).
const lastRow = store.filter(t => t.page === 3 && /^LFA\d+ ?- ?LFB/.test(t.s)).pop();
ok(lastRow && lastRow.y <= 555, `dernière ligne du tableau Calcul à y=${lastRow?.y} ≤ 555 (au-dessus de la note)`);

// 28 tronçons → 5 pages (9 + 18 + 1 côté log, Calcul rempli, suite détail).
equal(drawNavLogPdf(jsPDF, mk(28)).getNumberOfPages(), 5, '28 tronçons = 5 pages');
// 80 tronçons → les pages suite détail se multiplient proprement (9+18×4+5 log,
// Calcul rempli, 64 tronçons de suite → 2 pages à 35 de capacité).
equal(drawNavLogPdf(jsPDF, mk(80)).getNumberOfPages(), 8, '80 tronçons = 8 pages');
