// DOSSIER PDF « VOL LOCAL » (19/09) : la page « Calcul de navigation » est
// SAUTÉE (calc.local), la page Performances porte la section ATTERRISSAGE
// (cellules + coupe de piste) sous celle de décollage, et le profil
// d'élévation — sans objet sans route — disparaît. Vérifié par traçage des
// textes du PDF rendu (même harnais que navlog-fuel-cells). `npm test`.
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
const { drawNavLogPdf } = await import('../js/navlog-pdf.js');

// Vol local type : LFRV terrain unique, tronçons vierges, atterrissage
// calculé (roulement 75 m, franchissement 50 ft majoré 336 m, piste 950 m).
const LOCAL = {
    isFr: true,
    aircraftType: 'WT9-LSA', aircraftReg: 'F-HVXJ',
    qnh: 1013, windDir: 340, windKt: 8, runway: '29',
    distanceNm: '', timeLabel: '60 min',
    metarRaw: 'LFRV 191200Z 34008KT 9999 FEW030 18/12 Q1013',
    rows: [],
    calc: {
        isFr: true, local: true, fromIcao: 'LFRV', toIcao: 'LFRV',
        fuel: { tripL: 18, reserveL: 4.5, totalL: 31.5, unusableL: 6 },
    },
    perf: {
        isFr: true, fromIcao: 'LFRV', toIcao: 'LFRV', runway: '29',
        takeoff: {
            da: 300, groundRollM: 165, fiftyFtM: 350, runwayLengthM: 950,
            marginM: 600, level: 'ok', message: '', refLabel: '165/350',
            surfaceLabel: 'Dur', surfaceSoft: false, surfacePct: 0,
        },
        landing: {
            da: 300, rollM: 75, fiftyM: 336, runwayLengthM: 950,
            marginM: 614, level: 'ok', message: '', headwindKt: 8,
            crosswindKt: 1, crosswindSide: 'D',
            rwy: '29', forecast: true, refLabel: '75/263',
        },
        profile: null, alternates: null,
    },
    centro: null,
};

function capture(d) {
    const texts = [];
    const Patched = class extends jsPDF {
        constructor(opts) {
            super(opts);
            const dText = this.text.bind(this);
            this.text = (t, x, y, o) => {
                const lignes = Array.isArray(t) ? t.map(String) : String(t).split('\n');
                for (const l of lignes) if (l) texts.push(l);
                return dText(t, x, y, o);
            };
        }
    };
    drawNavLogPdf(Patched, d);
    return texts;
}

describe('dossier PDF vol local (19/09)', () => {
    const texts = capture(LOCAL);
    test('page « Calcul de navigation » ABSENTE en vol local', () => {
        assert.ok(!texts.some(t => /calcul de navigation/i.test(t)), 'le bandeau calcul ne doit pas être dessiné');
    });
    test('en-tête de page « vol local » (terrain sans flèche)', () => {
        assert.ok(texts.some(t => /LFRV - vol local/.test(t)), JSON.stringify(texts.slice(0, 3)));
    });
    test('section ATTERRISSAGE sous le décollage (titres + cellules + coupe)', () => {
        assert.ok(texts.some(t => /Performances de d[eé]collage — LFRV/i.test(t)), 'section décollage');
        assert.ok(texts.some(t => /^ATTERRISSAGE — LFRV/.test(t)), 'section atterrissage (titre de section, majuscules)');
        // Ordre pilote (19/09 soir) : Franchissement 50 ft AVANT Roulement
        // (dans la section ATTERRISSAGE — le « ROULEMENT » du décollage
        // précède les deux dans le flux de dessin).
        const iFranch = texts.findIndex(t => /FRANCH\. 50 FT \(\+20 %\)/.test(t));
        const iRoll = texts.findIndex((t, i) => i > iFranch && /^ROULEMENT$/.test(t));
        assert.ok(iFranch >= 0 && iRoll >= 0, 'cellules franchissement/roulement présentes');
        assert.ok(iFranch < iRoll, 'Franch. 50 ft dessiné AVANT Roulement');
        // Vent combiné axial + traversier : « 8 kt de face / 1 kt de droite ».
        assert.ok(texts.some(t => /^VENT$/.test(t)), 'cellule Vent (libellé)');
        assert.ok(texts.some(t => /^8 kt de face \/ 1 kt de droite$/.test(t)), 'vent combiné face + travers');
        // Coupe miroir écran : étiquettes « 50 ft », roulement « 75 m »,
        // « arrêt · 336 m » au-dessus de l\u2019avion posé, marge « +614 m ».
        assert.ok(texts.some(t => /^50 ft$/.test(t)), 'étiquette 50 ft (avant le repère)');
        assert.ok(texts.some(t => /^75 m$/.test(t)), 'roulement 75 m (centré sous la piste)');
        assert.ok(texts.some(t => /^arrêt · 336 m$/.test(t)), 'étiquette arrêt · 336 m');
        assert.ok(texts.some(t => /^\+614 m$/.test(t)), 'marge +614 m (barre au-dessus de la piste)');
    });
    test('profil d\u2019élévation absent (sans route)', () => {
        assert.ok(!texts.some(t => /ÉLÉVATION —|ELEVATION PROFILE/i.test(t)), 'la section relief ne doit pas exister en local');
    });
    test('navigation (sans drapeau local) : la page calcul RESTE présente', () => {
        const navTexts = capture({
            ...LOCAL,
            calc: { ...LOCAL.calc, local: false },
            perf: {
                ...LOCAL.perf, fromIcao: 'LFRV', toIcao: 'LFOO',
                landing: null,   // collecté uniquement en vol local
            },
        });
        assert.ok(navTexts.some(t => /calcul de navigation/i.test(t)), 'page calcul conservée en nav');
        assert.ok(!navTexts.some(t => /^ATTERRISSAGE —/.test(t)), 'pas de section atterrissage en nav (non demandée)');
    });
});
