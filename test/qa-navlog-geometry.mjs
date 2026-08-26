// QA géométrie du log de nav PDF, sous Node pur : enveloppe le constructeur
// jsPDF pour enregistrer chaque doc.text() (chaîne, position, taille, page),
// puis vérifie bornes, chevauchements, contenu attendu et pied de page.
// Tourne sur les DEUX fixtures (2 et 10 waypoints) — la variante 10 wp
// verrouille la tenue du tableau des waypoints sur la page 2 compactée.
// Usage : node test/qa-navlog-geometry.mjs
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

// Contenu attendu par page (identique pour les deux variantes, sauf tableau).
const EXPECT = {
    1: ['VFR Flight Log', 'Pilote / Détail vol', 'Piste en service', 'Check Croisière', 'LFPB-LFOB'],
    2: ['Calcul de navigation', 'CAP MAGNÉTIQUE', 'VENT À 3500 FT', 'TOTAL', 'DÉTAIL DES WAYPOINTS'],
    3: ['Performances et terrain', 'PERFORMANCES DE DÉCOLLAGE — LFPB · RWY 28', 'ROULEMENT', 'FRANCH. 50 FT',
        'DENSITÉ-ALT.', 'RÉF. AVION (M)', 'LONGUEUR PISTE', 'REVÊTEMENT', 'Herbe +15 %', 'MARGE (50 FT)',
        '+605 m', 'Roulement 280 m', 'Franch. 50 ft : 495 m', 'Marge +605 m · piste 1100 m',
        'PROFIL D’ÉLÉVATION — LFPB - LFRM'.replace('’', "'"), 'ALTERNATES LE LONG DE LA ROUTE (± 50 NM)',
        'Terrain', 'LFPT', 'Pontoise-Cormeilles', '14 NM D', 'LFOB', '3500 ft'],
};

// Passe ANGLAISE : même fixture avec isFr=false partout → page 1 doit être
// intégralement traduite (libellés, transpondeur, en-têtes ETA/ATA, checks).
const EXPECT_EN = {
    1: ['VFR Flight Log', 'Pilot / Flight details', 'Aircraft', 'Parameters', 'Pilot:', 'Hobbs end:',
        'Flight time:', 'Reg:', 'Runway:', 'Diversion', 'Radio failure', 'Airfield', 'Distress',
        'Notes:', 'MSA', 'ETA', 'ATA', 'Cruise check', 'Turning point check', 'Downwind check', 'Fuel'],
    2: ['Flight plan', 'MAGNETIC HEADING', 'WIND AT 3500 FT', 'TOTAL', 'LEG DETAILS'],
    3: ['Performance & terrain', 'TAKEOFF PERFORMANCE — LFPB · RWY 28', 'GROUND ROLL', '50 FT OBSTACLE',
        'DENSITY ALT.', 'Roll 280 m', '50 ft obstacle : 495 m', 'Margin +605 m · runway 1100 m',
        'ELEVATION PROFILE — LFPB - LFRM', 'EN-ROUTE ALTERNATES (± 50 NM)',
        'AIRFIELD', '14 NM D', '3500 ft'],
};

// ---- Constructeur enregistrant les appels text() ----
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
                // Texte tourné (angle 90 : étiquettes de zones verticales) :
                // il progresse vers le HAUT depuis l'ancre (matrice Tm 0 1 -1 0).
                store.push({
                    s, page: doc.internal.getCurrentPageInfo().pageNumber,
                    x: x - size * 0.36, w: size * 0.72, size,
                    top: y - w, bot: y,
                });
            } else {
                store.push({
                    s, page: doc.internal.getCurrentPageInfo().pageNumber,
                    x: bx, w, size,
                    top: y - size * 0.72, bot: y + size * 0.20,   // boîte approchée autour de la baseline
                });
            }
            return origText(text, x, y, opt);
        };
        return doc;
    };
}

function runQa(sample, label, extra, expect = EXPECT, wantPages = '1,2,3') {
    console.log(`\n===== ${label} =====`);
    const calls = [];
    drawNavLogPdf(makeRecordingCtor(calls), sample);

    const byPage = (p) => calls.filter(c => c.page === p);
    const pages = [...new Set(calls.map(c => c.page))].sort();
    console.log(`pages dessinées : ${pages.join(', ')}`);
    if (pages.join(',') !== wantPages) ko(`attendu ${wantPages} pages`);

    for (const p of pages) {
        const items = byPage(p).filter(i => i.s.trim());

        // 1. Bornes : cadre extérieur x [15..403.6] avec marge, page y [28..593.5].
        //    Le bandeau titre noir (baseline < 31) est AU-DESSUS du cadre, par design.
        const inTitleBand = (i) => i.bot < 31;
        const oob = items.filter(i => !inTitleBand(i) && (i.x < 13.8 || i.x + i.w > 405.2 || i.top < 26.5 || i.bot > 593.5))
            .concat(items.filter(inTitleBand).filter(i => i.top < 13.5 || i.x < 13.8 || i.x + i.w > 405.2));
        oob.length ? ko(`p${p} hors bornes : ` + oob.map(i => `${JSON.stringify(i.s)} @x${i.x.toFixed(1)},y${i.top.toFixed(1)}`).slice(0, 4).join(' | '))
                   : ok(`p${p} texte dans les bornes`);

        // 2. Chevauchements (rectangles rétrécis pour tolérancer les collages volontaires
        //    libellé/valeur d'une même cellule, qui se touchent sans se chevaucher).
        const ov = [];
        for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
            const a = items[i], b = items[j];
            if (a.x < b.x + b.w - 1.2 && b.x < a.x + a.w - 1.2 && a.top < b.bot - 1.4 && b.top < a.bot - 1.4)
                ov.push(`${JSON.stringify(a.s)}/${JSON.stringify(b.s)}`);
        }
        ov.length ? ko(`p${p} chevauchements (${ov.length}) : ` + ov.slice(0, 6).join(' ; '))
                  : ok(`p${p} aucun chevauchement`);

        // 3. Pied de page d'utilisation présent, sous le cadre (baseline 590.2).
        const foot = items.find(i => i.s.includes('généré automatiquement') || i.s.includes('Automatically generated'));
        foot ? (foot.bot < 595.3 && foot.top > 581.8 ? ok(`p${p} pied de page sous le cadre (y ${foot.top.toFixed(1)}–${foot.bot.toFixed(1)})`) : ko(`p${p} pied de page mal placé`))
             : ko(`p${p} pied de page ABSENT`);

        // 4. Contenu (hors pied de page) au-dessus du bas du cadre.
        const maxBot = Math.max(...items.filter(i => !i.s.includes('généré automatiquement') && !i.s.includes('Automatically generated')).map(i => i.bot));
        maxBot <= 582.5 ? ok(`p${p} contenu au-dessus du cadre (bas max ${maxBot.toFixed(1)} ≤ 582.5)`)
                        : ko(`p${p} contenu déborde du cadre : ${maxBot.toFixed(1)}`);

        // 5. Contenu attendu.
        for (const s of expect[p] || []) {
            if (!byPage(p).map(i => i.s).join(' ').includes(s)) ko(`p${p} texte manquant : ${JSON.stringify(s)}`);
        }
        ok(`p${p} contenu attendu vérifié (${(expect[p] || []).length} chaînes)`);
    }

    // 6. Extra : assertions spécifiques à la variante.
    if (extra) extra(byPage, ko, ok);

    // 7. Garde-fou typographique : aucun glyphe hors WinAnsi (le → des écrans
    //    n'existe pas dans les polices standard jsPDF — il s'affiche mal).
    const bad = calls.filter(c => /[→←↔△▲]/.test(c.s));
    bad.length ? ko('glyphe(s) non WinAnsi dessiné(s) : ' + bad.map(c => JSON.stringify(c.s)).slice(0, 3).join(', '))
               : ok('aucun glyphe non WinAnsi');
}

// ---- Variante 10 waypoints : le tableau (10 tronçons + TOTAL) tient dans la
// page 2 au-dessus de la zone de note (FOOT_TOP = 581.8 - 24 = 557.8) ----
function qa10wp(byPage, ko, ok) {
    const txt = byPage(2).map(i => i.s).join(' ');
    if (!txt.includes('DÉTAIL DES WAYPOINTS (10)')) ko('p2 titre waypoints (10) manquant');
    else ok('p2 titre « DÉTAIL DES WAYPOINTS (10) » présent');
    // Ligne TOTAL du tableau = dernier « TOTAL » de la page ; sa boîte doit
    // rester au-dessus de la zone réservée à la note de bas de page.
    const totalRows = byPage(2).filter(i => i.s === 'TOTAL');
    const lastTotal = totalRows[totalRows.length - 1];
    lastTotal && lastTotal.bot <= 558
        ? ok(`tableau 10 wp tient (bas ligne TOTAL à ${lastTotal.bot.toFixed(1)} ≤ 558)`)
        : ko(`tableau 10 wp déborde : bas TOTAL à ${lastTotal ? lastTotal.bot.toFixed(1) : '?'}`);
}

const base = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample.json'), 'utf8'));
const wp10 = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample-10wp.json'), 'utf8'));
runQa(base, 'FIXTURE 2 waypoints', null);
runQa(wp10, 'FIXTURE 10 waypoints', qa10wp);

// Passe EN : même document, isFr=false partout (page 1 comprise).
const en = JSON.parse(JSON.stringify(base));
en.isFr = false;
en.calc.isFr = false;
en.perf.isFr = false;
runQa(en, 'FIXTURE 2 waypoints — ANGLAIS', null, EXPECT_EN);

// Passe CENTRO : avion actif configuré (bloc wb) → 4e page « Centrage ».
const centro = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample-centro.json'), 'utf8'));
const EXPECT_CENTRO = {
    ...EXPECT,
    4: ['Centrage', 'CHARGEMENT', 'POSTE', 'BRAS (MM)', 'MASSE (KG)', 'MOMENT',
        'Masse à vide', 'TOTAL — CG décollage : 428 mm',
        'Essence consommée estimée (plan de nav) : 41 L',
        'CENTROGRAMME — ENVELOPPE DE CENTRAGE', 'Bras de levier (mm)', 'Masse (kg)',
        'Décollage 1 010 kg', 'Arrivée 980 kg', 'ZFW 938 kg',
        'MTOW 1 100 kg', 'CG DÉCOLLAGE', 'CG ARRIVÉE', 'CG ZÉRO CARBURANT',
        'MASSE DÉCOLLAGE', 'Dans les limites'],
};
runQa(centro, 'FIXTURE 2 waypoints — CENTRAGE (page 4)', null, EXPECT_CENTRO, '1,2,3,4');

console.log(failures ? `\n${failures} ÉCHEC(S)` : '\nTOUT OK');
process.exit(failures ? 1 : 0);
