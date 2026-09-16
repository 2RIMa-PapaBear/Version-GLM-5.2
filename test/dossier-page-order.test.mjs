// Ordre des pages du dossier — ORDRE PILOTE 16/09 :
//   garde / log / météo (départ, déroutement, arrivée) / NOTAM / carte.
// L'ordre découle de la GÉNÉRATION (log → garde+météo → annexe NOTAM →
// carte) avec une SEULE remontée (la garde en page 1) : plus aucune
// gymnastique movePage multi-pages (l'ancienne boucle montait la
// dernière page du log en position 2 quand la météo paginait — PDF
// pilote LFRV-LFRZ « les pages 2 et 3 n'ont rien à faire là »).
// L'ordre est vérifié sur le /Kids du PDF (ordre réel des pages) via le
// marqueur '(MARK) Tj' de chaque flux de contenu.
import test from 'node:test';
import { deepEqual, ok } from 'node:assert/strict';
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

function pageOrder(raw) {
    const kidsMatch = raw.match(/\/Kids \[([^\]]+)\]/);
    ok(kidsMatch, 'Kids trouvé');
    const kids = [...kidsMatch[1].matchAll(/(\d+) 0 R/g)].map((m) => +m[1]);
    const obj = (id) => {
        const re = new RegExp(`${id} 0 obj([\\s\\S]*?)endobj`);
        const m = raw.match(re);
        return m ? m[1] : '';
    };
    return kids.map((id) => {
        const pageObj = obj(id);
        const c = pageObj.match(/\/Contents (\d+) 0 R/);
        const stream = c ? obj(+c[1]) : pageObj;
        const mark = stream.match(/\((LOG\d|GARDE|WX\d|NOTAM\d|CARTE)\) Tj/);
        return mark ? mark[1] : '?';
    });
}

/** Reproduit la SÉQUENCE de flight-planner-ui.js : log, puis (dossier)
 *  garde + météo avec UNE remontée de la garde, puis annexe NOTAM, puis
 *  carte de vol. logPages/meteoPages/notamPages : marqueurs. */
function buildDossier(logPages, meteoPages, notamPages) {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const page = (mk, first) => {
        if (!first) doc.addPage();
        doc.setFontSize(20);
        doc.text(mk, 50, 50);
    };
    logPages.forEach((mk, i) => page(mk, i === 0));
    const n0 = doc.getNumberOfPages();
    // bloc dossier : garde puis météo, remontée UNIQUE de la garde
    page('GARDE');
    meteoPages.forEach((mk) => page(mk));
    doc.movePage(n0 + 1, 1);
    // annexe NOTAM (générée APRÈS la météo → elle la suit naturellement)
    notamPages.forEach((mk) => page(mk));
    // carte de vol : dernière page
    page('CARTE');
    return doc;
}

test('ordre complet : garde / log / météo / NOTAM / carte', () => {
    const doc = buildDossier(['LOG1', 'LOG2', 'LOG3'], ['WX1', 'WX2'], ['NOTAM1', 'NOTAM2']);
    const order = pageOrder(Buffer.from(doc.output('arraybuffer')).toString('latin1'));
    deepEqual(order, ['GARDE', 'LOG1', 'LOG2', 'LOG3', 'WX1', 'WX2', 'NOTAM1', 'NOTAM2', 'CARTE']);
});

test('météo sur une seule page, sans annexe NOTAM', () => {
    const doc = buildDossier(['LOG1'], ['WX1'], []);
    deepEqual(pageOrder(Buffer.from(doc.output('arraybuffer')).toString('latin1')),
        ['GARDE', 'LOG1', 'WX1', 'CARTE']);
});

test('météo sur 3 pages (pagination graphiques) : l ordre tient', () => {
    const doc = buildDossier(['LOG1', 'LOG2'], ['WX1', 'WX2', 'WX3'], ['NOTAM1']);
    deepEqual(pageOrder(Buffer.from(doc.output('arraybuffer')).toString('latin1')),
        ['GARDE', 'LOG1', 'LOG2', 'WX1', 'WX2', 'WX3', 'NOTAM1', 'CARTE']);
});
