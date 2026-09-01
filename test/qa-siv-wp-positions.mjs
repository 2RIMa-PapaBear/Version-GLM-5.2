// Vérification positionnelle ciblée (consignes pilote 01/09, tour 2) :
//  1) codes OACI des waypoints AU-DESSUS DU CADRE (bande sous le titre) ;
//  2) étiquettes SIV entièrement AU-DESSUS DU POINT LE PLUS HAUT du relief,
//     ancrées ~12 pt au-dessus (consigne 10-15 px).
// Usage : node test/qa-siv-wp-positions.mjs
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

function record(sample) {
    const calls = [];
    function RecordingCtor(opts) {
        const doc = new jsPDF(opts);
        const origText = doc.text.bind(doc);
        doc.text = (text, x, y, opt) => {
            const s = Array.isArray(text) ? text.join('\n') : String(text);
            const size = doc.getFontSize();
            let w = doc.getTextWidth(s);
            let bx = x;
            if (opt?.align === 'right') bx = x - w;
            else if (opt?.align === 'center') bx = x - w / 2;
            calls.push({ s, x: bx, w, size, top: y - size * 0.72, bot: y + size * 0.20, y });
            return origText(text, x, y, opt);
        };
        return doc;
    }
    drawNavLogPdf(RecordingCtor, sample);
    return calls;
}

for (const fx of ['fixtures-navlog-sample.json', 'fixtures-navlog-sample-10wp.json', 'fixtures-navlog-vannes-cherbourg.json']) {
    const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', fx), 'utf8'));
    const pr = sample.perf?.profile;
    if (!pr) { console.log(`SKIP ${fx} (pas de profil)`); continue; }
    const items = record(sample).filter(i => i.s.trim());
    const ko = (m) => { failures++; console.log(`KO  [${fx}] ${m}`); };

    // Repères géométriques (réplique de _drawElevationChart) : _section
    // dessine le titre à ys+11 et retourne ys+16 → yTopSection = titre + 5.
    const title = items.find(i => i.s.startsWith('PROFIL D'));
    if (!title) { ko('titre section introuvable'); continue; }
    const yTopSection = title.y + 5;
    const yT = yTopSection + 19;
    const yB = yT + 128;
    // Éléments de la SEULE section profil (les fréquences/codes des pages
    // 1-2 au même y relatif ne doivent pas polluer).
    const band = items.filter(i => i.y > title.y - 8 && i.y < yB + 14);
    const yMin = Math.min(pr.minFt, pr.cruiseAltFt) - 200;
    const yMax = Math.max(pr.maxFt, pr.cruiseAltFt) + 600;
    const yOf = (e) => yT + (1 - (e - yMin) / (yMax - yMin)) * 128;
    const ySommet = yOf(pr.maxFt);

    // 1) Codes waypoints au-dessus du cadre.
    const wps = (pr.waypoints || []).filter(w => w.frac > 0 && w.frac < 1);
    for (const wp of wps) {
        const hits = band.filter(i => i.s === (wp.name || wp.icao));
        if (!hits.length) { ko(`code ${wp.icao} introuvable`); continue; }
        // la position AU-DESSUS DU CADRE = la plus haute occurrence du code
        const top = hits.reduce((a, b) => (b.y < a.y ? b : a));
        if (!(top.y > yTopSection + 1.5 && top.y < yTopSection + 16)) {
            ko(`code ${wp.icao} hors bande au-dessus du cadre (y=${top.y.toFixed(1)}, attendu ${yTopSection.toFixed(1)}–${(yTopSection + 16).toFixed(1)})`);
        } else if (top.bot > yT - 0.5) {
            ko(`code ${wp.icao} empiète sur le cadre (bot ${top.bot.toFixed(1)} ≥ ${yT.toFixed(1)})`);
        }
    }

    // 2) Étiquettes SIV au-dessus du point le plus haut du relief.
    const sivNames = new Set();
    for (const g of pr.routeAirspaces || []) {
        for (const s of g.segs || []) {
            const zone = (s.zone && s.zone.toUpperCase() !== g.name.toUpperCase()) ? s.zone : g.name.replace(/ INFO$/, '');
            if (/^SIV/i.test(zone)) {
                const words = zone.replace(/\s+partie\s+/i, ' ').split(/\s+/);
                if (g.freq) words.push(String(g.freq));
                sivNames.add(words[0]);   // 1er mot (« SIV ») : repère souple ci-dessous
            }
        }
    }
    const sivItems = band.filter(i => /(^|\s)SIV\s/.test(i.s) || /^\d{3}\.\d{3}$/.test(i.s.trim()));
    if (!sivItems.length) { ko('aucune étiquette SIV trouvée'); }
    let minGap = Infinity;
    for (const it of sivItems) {
        if (it.bot >= ySommet - 9) ko(`« ${it.s} » touche/chevauche le relief (bot ${it.bot.toFixed(1)} vs sommet ${ySommet.toFixed(1)})`);
        const gap = ySommet - it.y;
        if (gap > 0 && gap < minGap) minGap = gap;
        if (it.top < yT) ko(`« ${it.s} » au-dessus du cadre (top ${it.top.toFixed(1)} < ${yT.toFixed(1)})`);
    }
    if (Number.isFinite(minGap) && !(minGap >= 10 && minGap <= 16)) {
        ko(`ancre SIV hors consigne 10-15 px : plus proche ligne à ${minGap.toFixed(1)} pt sous le sommet`);
    }
    // 3) Départ et arrivée à la MÊME hauteur (rangée du sol, consigne pilote).
    const depHit = band.filter(i => i.s === pr.fromIcao).reduce((a, b) => (b.y < a.y ? b : a), { y: Infinity });
    const arrHit = band.filter(i => i.s === pr.toIcao).reduce((a, b) => (b.y < a.y ? b : a), { y: Infinity });
    if (!Number.isFinite(depHit.y) || !Number.isFinite(arrHit.y)) {
        ko(`code départ/arrivée introuvable (dep=${depHit.y}, arr=${arrHit.y})`);
    } else if (Math.abs(depHit.y - arrHit.y) > 0.2) {
        ko(`départ (${depHit.y.toFixed(1)}) et arrivée (${arrHit.y.toFixed(1)}) à des hauteurs différentes`);
    }

    console.log(`OK  [${fx}] ${wps.length} codes au-dessus du cadre, ${sivItems.length} lignes SIV, ancre la plus basse à ${Number.isFinite(minGap) ? minGap.toFixed(1) : '?'} pt au-dessus du sommet (${Math.round(pr.maxFt)} ft), dep/arr à la même hauteur`);
}

console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
