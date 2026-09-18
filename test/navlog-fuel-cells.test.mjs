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
});
