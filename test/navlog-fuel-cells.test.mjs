// Ligne carburant de la page « Calcul de navigation » (retour pilote 18/09 :
// les libellés « Dégagement », « Roulage + intégr. », « Réserve (35 min) »
// débordaient des olives en variante 5 cellules) : AUCUNE ligne de libellé
// ne doit dépasser la largeur utile de l'olive la plus étroite (~62 pt).
// Vérifié par traçage des textes du PDF rendu depuis la fixture réelle
// (dégagement présent → variante 5 cellules). `npm test`.
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
const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample.json'), 'utf8'));

describe('libellés des olives (page Calcul de navigation)', () => {
    test('aucun libellé ne déborde de sa cellule (variante 5 cellules avec dégagement)', () => {
        assert.ok(sample.calc.fuel.divIcao, 'fixture avec dégagement (variante 5 cellules)');
        const labels = [];
        // drawNavLogPdf construit SON document : on trace via un
        // constructeur dérivé dont chaque instance capture les libellés.
        const Patched = class extends jsPDF {
            constructor(opts) {
                super(opts);
                const dText = this.text.bind(this);
                this.text = (t, x, y, o) => {
                    const font = this.internal.getFont();
                    const size = this.internal.getFontSize();
                    if (font.fontName === 'helvetica' && font.fontStyle === 'bold' && size <= 6.5) {
                        const cs = o?.charSpace || 0;
                        const lignes = Array.isArray(t) ? t.map(String) : String(t).split('\n');
                        for (const ligne of lignes) {
                            if (ligne) labels.push({ ligne, w: this.getTextWidth(ligne) + ligne.length * cs });
                        }
                    }
                    return dText(t, x, y, o);
                };
            }
        };
        drawNavLogPdf(Patched, sample);
        // Largeurs 18/09 : Trajet ×0,8 (~59 pt → 47 utiles), Dégagement ×1,2
        // (~89 pt → 77 utiles, retour pilote : place rendue au libellé qui
        // porte le code du terrain), les trois autres ~74 pt (62 utiles).
        const FUEL = ['TRAJET', 'DÉGAGEMENT', 'ROULAGE', 'RÉSERVE', 'TOTAL REQUIS'];
        const BORNES = { 'TRAJET': 47.5, 'DÉGAGEMENT': 77.5, 'ROULAGE': 62.5, 'RÉSERVE': 62.5, 'TOTAL REQUIS': 62.5 };
        const fuel = labels.filter(l => FUEL.some(k => l.ligne.startsWith(k)));
        assert.ok(fuel.length >= 5, `libellés carburant trouvés (${fuel.length})`);
        const pire = fuel.reduce((a, b) => (b.w > a.w ? b : a), { ligne: '', w: 0 });
        console.log(`ligne carburant : ${fuel.length} libellés, le plus large « ${pire.ligne} » ${Math.round(pire.w)} pt (page entière : ${labels.length} lignes)`);
        for (const l of fuel) {
            const borne = BORNES[FUEL.find(k => l.ligne.startsWith(k))];
            assert.ok(l.w <= borne, `« ${l.ligne} » ${Math.round(l.w)} pt > ${borne} pt (sa cellule)`);
        }
        // Les libellés longs ne débordent plus : repliés ou réduits, jamais accolés.
        assert.ok(!fuel.some(l => /ROULAGE.*15 MIN/.test(l.ligne)), '« Roulage + intégr. » ne déborde plus (repli ou réduction)');
    });

    test('variante 6 olives (dégagement + inutilisable 19/09) : aucun libellé ne déborde', () => {
        const s6 = JSON.parse(JSON.stringify(sample));
        s6.calc.fuel.unusableL = 6;
        const labels = [];
        const Patched = class extends jsPDF {
            constructor(opts) {
                super(opts);
                const dText = this.text.bind(this);
                this.text = (t, x, y, o) => {
                    const font = this.internal.getFont();
                    const size = this.internal.getFontSize();
                    if (font.fontName === 'helvetica' && font.fontStyle === 'bold' && size <= 6.5) {
                        const cs = o?.charSpace || 0;
                        const lignes = Array.isArray(t) ? t.map(String) : String(t).split('\n');
                        for (const ligne of lignes) {
                            if (ligne) labels.push({ ligne, w: this.getTextWidth(ligne) + ligne.length * cs, x, y });
                        }
                    }
                    return dText(t, x, y, o);
                };
            }
        };
        drawNavLogPdf(Patched, s6);
        // Largeurs 6 olives PILOTE (19/09 soir) : Trajet 45, Dégagement 62,
        // Roulage 72→75, Réserve 72,3, Inut. 32, Total 60 ; gouttières 8 pt,
        // L = 16,4 → la ligne finit exactement à R = 402,7.
        const L = 16.4;
        const OLIVES = [
            { nom: 'Trajet', x0: L, largeur: 56, borne: 44.5 },
            { nom: 'Dégagement', x0: L + 63, largeur: 62, borne: 50.5 },
            { nom: 'Roulage + intégr.', x0: L + 132, largeur: 75, borne: 63.5 },
            { nom: 'Réserve', x0: L + 214, largeur: 66.3, borne: 54.8 },
            { nom: 'Inut.', x0: L + 287.3, largeur: 32, borne: 20.5 },
            { nom: 'Total requis', x0: L + 326.3, largeur: 60, borne: 48.5 },
        ].map(o => ({ ...o, x1: o.x0 + o.largeur }));
        // Bande verticale de la ligne carburant (les olives 29 pt vers y≈232).
        const fragments = labels.filter(l => l.y > 220 && l.y < 265);
        // Chaque olive a AU MOINS un fragment de libellé qui démarre dedans.
        for (const o of OLIVES) {
            const dans = fragments.filter(l => l.x >= o.x0 - 1 && l.x < o.x1);
            assert.ok(dans.length >= 1, `olive « ${o.nom} » : aucun libellé rendu`);
            for (const l of dans) {
                assert.ok(l.w <= o.borne, `« ${l.ligne} » ${Math.round(l.w)} pt > ${o.borne} pt (olive ${o.nom})`);
            }
        }
        // Libellés de départ présents (la preuve que chaque olive est la bonne).
        // « Total requis » : une ligne (« TOTAL REQUIS ») ou replié (« REQUIS »).
        for (const [nom, pref] of [['Trajet', 'TRAJET'], ['Dégagement', 'DÉGAGEMENT'], ['Roulage + intégr.', 'ROULAGE'],
                                   ['Réserve', 'RÉSERVE'], ['Inut.', 'INUT.'], ['Total requis', 'REQUIS']]) {
            const o = OLIVES.find(x => x.nom === nom);
            assert.ok(fragments.some(l => l.ligne.includes(pref) && l.x >= o.x0 - 1 && l.x < o.x1),
                `olive « ${nom} » : libellé « ${pref}… » absent`);
        }
        const pire = fragments.reduce((a, b) => (b.w > a.w ? b : a), { ligne: '', w: 0 });
        console.log(`ligne carburant 6 olives : ${fragments.length} fragments, le plus large « ${pire.ligne} » ${Math.round(pire.w)} pt`);
    });

    test('variante 5 olives (vol local : Trajet/Roulage/Réserve/Inut./Total) : pleine largeur, TOUT sur une ligne', () => {
        const s5 = JSON.parse(JSON.stringify(sample));
        delete s5.calc.fuel.divIcao;   // pas de dégagement → variante 5 olives
        delete s5.calc.fuel.diversionL;
        s5.calc.fuel.unusableL = 6;
        s5.calc.fuel.tripL = 32.1;     // 6 caractères : la valeur doit rester ENTIÈRE
        const labels = [];
        const valeurs = [];
        const Patched = class extends jsPDF {
            constructor(opts) {
                super(opts);
                const dText = this.text.bind(this);
                this.text = (t, x, y, o) => {
                    const font = this.internal.getFont();
                    const size = this.internal.getFontSize();
                    const cs = o?.charSpace || 0;
                    const lignes = Array.isArray(t) ? t.map(String) : String(t).split('\n');
                    if (font.fontName === 'helvetica' && font.fontStyle === 'bold' && size <= 6.5) {
                        for (const ligne of lignes) {
                            if (ligne) labels.push({ ligne, w: this.getTextWidth(ligne) + ligne.length * cs, x, y });
                        }
                    }
                    // Valeurs des olives : courier bold (9,5 → 12 pt) — pour
                    // vérifier qu'aucune n'est tronquée (retour pilote 20/09).
                    if (font.fontName === 'courier' && font.fontStyle === 'bold' && size >= 9) {
                        for (const ligne of lignes) {
                            if (ligne) valeurs.push({ ligne, x, y });
                        }
                    }
                    return dText(t, x, y, o);
                };
            }
        };
        drawNavLogPdf(Patched, s5);
        // LARGEURS PILOTE (rév. 20/09) : [56, 113, 90,3, 32, 67], gouttières 7
        // (comme les lignes du dessus), L = 16,4 → fin exacte à R = 402,7.
        const L = 16.4;
        const OLIVES5 = [
            { nom: 'Trajet', pref: 'TRAJET', x0: L, largeur: 56, borne: 44.5 },
            { nom: 'Roulage + intégr.', pref: 'ROULAGE', x0: L + 63, largeur: 113, borne: 101.5 },
            { nom: 'Réserve', pref: 'RÉSERVE', x0: L + 183, largeur: 90.3, borne: 78.8 },
            { nom: 'Inut.', pref: 'INUT.', x0: L + 280.3, largeur: 32, borne: 20.5 },
            { nom: 'Total requis', pref: 'REQUIS', x0: L + 319.3, largeur: 67, borne: 55.5 },
        ].map(o => ({ ...o, x1: o.x0 + o.largeur }));
        const fragments = labels.filter(l => l.y > 234 && l.y < 250);
        for (const o of OLIVES5) {
            const dans = fragments.filter(l => l.x >= o.x0 - 1 && l.x < o.x1);
            assert.ok(dans.length >= 1, `olive « ${o.nom} » : aucun libellé rendu`);
            // TOUT sur UNE ligne : un seul fragment par olive (pas de repli).
            assert.equal(dans.length, 1, `olive « ${o.nom} » : libellé repli (${dans.map(d => d.ligne).join(' / ')}) au lieu d'une ligne`);
            assert.ok(dans[0].w <= o.borne, `« ${dans[0].ligne} » ${Math.round(dans[0].w)} pt > ${o.borne} pt (olive ${o.nom})`);
        }
        // Pleine largeur : la dernière olive finit à R (± 0,5).
        const R = 402.7;
        assert.ok(Math.abs(OLIVES5[4].x1 - R) < 0.6, `la ligne finit à ${OLIVES5[4].x1.toFixed(1)} au lieu de ${R}`);
        // VALEURS ENTIÈRES (retour pilote 20/09) : « 32.1 L » et « 6 L »
        // visibles sans troncature — aucune ne doit porter de « … ».
        const valsFuel = valeurs.filter(v => v.y > 248 && v.y < 262);
        assert.ok(valsFuel.some(v => v.ligne === '32.1 L'), `valeur Trajet entière absente : ${JSON.stringify(valsFuel.map(v => v.ligne))}`);
        assert.ok(valsFuel.some(v => v.ligne === '6 L'), `valeur Inut. entière absente : ${JSON.stringify(valsFuel.map(v => v.ligne))}`);
        assert.ok(!valsFuel.some(v => v.ligne.includes('…')), `valeur tronquée : ${valsFuel.filter(v => v.ligne.includes('…')).map(v => v.ligne).join(', ')}`);
        console.log(`ligne carburant 5 olives : une ligne, pleine largeur, valeurs entières ✓ (${valsFuel.map(v => v.ligne).join(' · ')})`);
    });
});
