// QA géométrique du PDF « plan long » LFRV→LFRC (3 pages) : bornes,
// chevauchements (y compris étiquettes verticales de zones), contenu attendu
// du nouveau profil (limites SIV, PAS de FL/plafonds), cellule Waypoints.
// Usage : node test/qa-navlog-longroute.mjs
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;
const { drawNavLogPdf } = await import(pathToFileURL(path.join(root, 'js', 'navlog-pdf.js')).href);

let failures = 0;
const ko = (msg) => { failures++; console.log('KO  ' + msg); };
const ok = (msg) => console.log('OK  ' + msg);

function makeRecordingCtor(store) {
    return function RecordingCtor(opts) {
        const doc = new jsPDF(opts);
        const origText = doc.text.bind(doc);
        doc.text = (text, x, y, opt) => {
            const s = Array.isArray(text) ? text.join('\n') : String(text);
            const size = doc.getFontSize();
            let w = doc.getTextWidth(s);
            if (opt?.charSpace) w += opt.charSpace * Math.max(0, s.length - 1);
            let bx = x;
            if (opt?.align === 'right') bx = x - w;
            else if (opt?.align === 'center') bx = x - w / 2;
            if (opt?.angle) {
                store.push({ s, page: doc.internal.getCurrentPageInfo().pageNumber, x: x - size * 0.36, w: size * 0.72, size, top: y - w, bot: y, rot: true });
            } else {
                store.push({ s, page: doc.internal.getCurrentPageInfo().pageNumber, x: bx, w, size, top: y - size * 0.72, bot: y + size * 0.20 });
            }
            return origText(text, x, y, opt);
        };
        return doc;
    };
}

const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-longroute.json'), 'utf8'));
const calls = [];
drawNavLogPdf(makeRecordingCtor(calls), sample);
const byPage = (p) => calls.filter(c => c.page === p);
const texts = (p) => byPage(p).map(i => i.s);

for (const p of [1, 2, 3]) {
    const items = byPage(p).filter(i => i.s.trim());
    const inTitleBand = (i) => i.bot < 31;
    const oob = items.filter(i => !inTitleBand(i) && (i.x < 13.8 || i.x + i.w > 405.2 || i.top < 26.5 || i.bot > 593.5))
        .concat(items.filter(inTitleBand).filter(i => i.top < 13.5 || i.x < 13.8 || i.x + i.w > 405.2));
    oob.length ? ko(`p${p} hors bornes : ` + oob.map(i => `${JSON.stringify(i.s)} @x${i.x.toFixed(1)},y${i.top.toFixed(1)}`).slice(0, 4).join(' | '))
               : ok(`p${p} texte dans les bornes`);

    const ov = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.x < b.x + b.w - 1.2 && b.x < a.x + a.w - 1.2 && a.top < b.bot - 1.4 && b.top < a.bot - 1.4)
            ov.push(`${JSON.stringify(a.s)}/${JSON.stringify(b.s)}`);
    }
    ov.length ? ko(`p${p} chevauchements (${ov.length}) : ` + ov.slice(0, 8).join(' ; '))
              : ok(`p${p} aucun chevauchement`);
}

// ---- Page 3 : le nouveau profil ----
const t3 = texts(3).join(' | ');
for (const s of ['PROFIL D\'ÉLÉVATION — LFRV - LFRC', '3500 ft', 'LFRV', 'LFRC', 'LFER', 'LFTQ', 'LFOV', 'LFRW', 'LFOM']) {
    t3.includes(s) ? ok(`p3 contient ${JSON.stringify(s)}`) : ko(`p3 manque ${JSON.stringify(s)}`);
}
// Zones : étiquettes HORIZONTALES au-dessus du relief (design 01/09) —
// plus AUCUN texte vertical ; la fréquence peut être sur sa propre ligne
// (retour à la ligne entre les limites du secteur).
const rot = byPage(3).filter(i => i.rot);
rot.length === 0 ? ok('p3 plus aucun libellé vertical')
                 : ko(`p3 libellés verticaux résiduels : ${rot.map(i => JSON.stringify(i.s)).join(', ')}`);
const sivTxt = byPage(3).filter(i => /(^|\s)SIV/i.test(i.s));
const profFreqs = byPage(3).filter(i => /1[23]\d\.\d{3}/.test(i.s));
sivTxt.length >= 4 ? ok(`p3 ≥ 4 libellés SIV horizontaux (${sivTxt.length})`) : ko(`p3 seulement ${sivTxt.length} libellés SIV`);
profFreqs.length >= 4 ? ok(`p3 ≥ 4 fréquences de zones (${profFreqs.length})`) : ko(`p3 seulement ${profFreqs.length} fréquences`);
// Plus AUCUNE référence FL / plafond / SFC sur le profil.
const flRefs = byPage(3).filter(i => /(^|\s)(FL\d|> ?FL|SFC)/i.test(i.s));
flRefs.length ? ko(`p3 résidus FL/plafond : ` + flRefs.map(i => JSON.stringify(i.s)).join(', '))
              : ok('p3 aucun résidu FL/plafond/SFC');
// Les libellés SIV restent dans le graphe en x, et sur la page.
for (const i of sivTxt) {
    if (i.x < 55 || i.x + i.w > 401) ko(`libellé SIV hors graphe en x : ${JSON.stringify(i.s)} x=${i.x.toFixed(1)}`);
    if (i.top < 28 || i.bot > 594) ko(`libellé SIV hors page : ${JSON.stringify(i.s)}`);
}
ok('libellés SIV dans le graphe');

// ---- Page 2 : cellule Waypoints en noms réels + 7 tronçons ----
const t2 = texts(2).join(' | ');
for (const s of ['LFER LFTQ LFOV LFRW LFOM', 'DÉTAIL DES WAYPOINTS (6)', 'TOTAL']) {
    t2.includes(s) ? ok(`p2 contient ${JSON.stringify(s)}`) : ko(`p2 manque ${JSON.stringify(s)}`);
}
const zz = calls.filter(i => /ZZ[A-Z]{2}/.test(i.s));
zz.length ? ko(`codes ZZ** rendus : ` + zz.map(i => JSON.stringify(i.s)).join(', ')) : ok('aucun code ZZ** rendu');

// ---- Page 1 : 7 tronçons ----
const t1 = texts(1).join(' | ');
for (const s of ['LFRV-LFER', 'LFTQ-LFOV', 'LFOM-LFRC']) {
    t1.includes(s) ? ok(`p1 contient ${JSON.stringify(s)}`) : ko(`p1 manque ${JSON.stringify(s)}`);
}

console.log(failures ? `\nÉCHEC : ${failures} problème(s)` : '\nQA longroute : TOUT OK');
process.exit(failures ? 1 : 0);
