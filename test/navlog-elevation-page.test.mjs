// PAGE DÉDIÉE AU PROFIL D'ÉLÉVATION (20/09, retour pilote) : format PAYSAGE,
// graphe sur TOUTE la largeur, insérée juste avant la carte de vol — et la
// page « Performances et terrain » ne porte PLUS la section relief.
// Vérifié par dimensions de pages et traçage des textes. `npm test`.
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
const { drawNavLogPdf, drawElevationProfilePage } = await import('../js/navlog-pdf.js');
const sample = JSON.parse(fs.readFileSync(path.join(root, 'test', 'fixtures-navlog-sample.json'), 'utf8'));

// Le profil du fixture doit exister (sinon la page dédiée n'a rien à tracer).
assert.ok(sample.perf?.profile?.points?.length >= 2, 'fixture avec profil d\u2019élévation');

describe('page dédiée profil d\u2019élévation (20/09)', () => {
    const texts = [];
    const Patched = class extends jsPDF {
        constructor(opts) {
            super(opts);
            const dText = this.text.bind(this);
            this.text = (t, x, y, o) => {
                const pw = this.internal.pageSize.getWidth();
                (Array.isArray(t) ? t.map(String) : String(t).split('\n')).forEach(l => {
                    if (l) texts.push({ l, x, y, pw });
                });
                return dText(t, x, y, o);
            };
        }
    };
    const doc = drawNavLogPdf(Patched, sample);
    drawElevationProfilePage(doc, sample.perf.profile);   // appelée par le générateur du dossier
    const n = doc.getNumberOfPages();

    test('la page dédiée est PAYSAGE, pleine largeur, en dernière position ajoutée', () => {
        // jsPDF : après addPage paysage, la taille courante suit la DERNIÈRE page.
        const pw = doc.internal.pageSize.getWidth(), ph = doc.internal.pageSize.getHeight();
        assert.ok(pw > ph, `page paysage attendue (${pw}×${ph})`);
        assert.ok(Math.abs(pw - 595.32) < 1 && Math.abs(ph - 419.53) < 1, 'format A5 paysage exact');
    });

    test('bandeau + en-tête route présents sur la page dédiée', () => {
        assert.ok(texts.some(t => /PROFIL D’ÉLÉVATION DE LA ROUTE/i.test(t.l) && t.pw > 500), 'titre du bandeau');
        assert.ok(texts.some(t => /km$/.test(t.l) && t.pw > 500), 'ligne route + distance');
    });

    test('le graphe occupe la pleine largeur : graduations à gauche, croisière à droite', () => {
        const ft = texts.filter(t => /\d+ ft$/.test(t.l) && t.pw > 500);
        const graduations = ft.filter(t => t.x < 80);
        assert.ok(graduations.length >= 4, `graduations altitude à gauche (${graduations.length})`);
        // Altitude de croisière : libellé près du bord droit du graphe.
        assert.ok(ft.some(t => t.x > 500), 'libellé croisière « X ft » au bord droit');
    });

    test('la page « Performances et terrain » ne porte PLUS la section relief', () => {
        // Page perfs = portrait (pw 419) ; l'ancien titre de section y est ABSENT.
        const portrait = texts.filter(t => t.pw < 500);
        assert.ok(!portrait.some(t => /PROFIL D'ÉLÉVATION —/i.test(t.l) || /ELEVATION PROFILE —/i.test(t.l)),
            'l\u2019ancienne section doit avoir disparu des pages portrait');
    });

    test('zones : tronçons CHEVAUCHANTS → chaque secteur étiqueté UNE fois (TMA LA ROCHELLE 1/3, retour pilote 20/09)', () => {
        // Reproduit le défaut : un organisme à 2 secteurs dont les tronçons
        // traversés se recouvrent ([.3,.55] et [.45,.7]) — chaque secteur
        // était étiqué deux fois, textes superposés.
        const pr = JSON.parse(JSON.stringify(sample.perf.profile));
        pr.routeAirspaces = [{
            name: 'LA ROCHELLE', up: 5500, lo: 1000, freq: null,
            ranges: [[0.3, 0.55], [0.45, 0.7]],
            segs: [
                { zone: 'TMA LA ROCHELLE 1', fa: 0.3, fb: 0.5 },
                { zone: 'TMA LA ROCHELLE 3', fa: 0.5, fb: 0.7 },
            ],
        }];
        const t2 = [];
        const P2 = class extends jsPDF {
            constructor(o) {
                super(o);
                const dT = this.text.bind(this);
                this.text = (t, x, y, op) => {
                    (Array.isArray(t) ? t.map(String) : String(t).split('\n')).forEach(l => { if (l) t2.push(l); });
                    return dT(t, x, y, op);
                };
            }
        };
        const d2 = drawNavLogPdf(P2, { ...sample, perf: { ...sample.perf, profile: pr } });
        drawElevationProfilePage(d2, pr);
        const n1 = t2.filter(l => l.includes('TMA LA ROCHELLE 1')).length;
        const n3 = t2.filter(l => l.includes('TMA LA ROCHELLE 3')).length;
        assert.equal(n1, 1, `« TMA LA ROCHELLE 1 » dessiné ${n1} fois (attendu 1)`);
        assert.equal(n3, 1, `« TMA LA ROCHELLE 3 » dessiné ${n3} fois (attendu 1)`);
    });

    test('zones : traversées DISJOINTES (sortie puis re-entrée) → 2 étiquettes conservées', () => {        const pr = JSON.parse(JSON.stringify(sample.perf.profile));
        pr.routeAirspaces = [{
            name: 'LA ROCHELLE', up: 5500, lo: 1000, freq: null,
            ranges: [[0.1, 0.3], [0.6, 0.8]],
            segs: [{ zone: 'TMA LA ROCHELLE 1', fa: 0.1, fb: 0.8 }],
        }];
        const t3 = [];
        const P3 = class extends jsPDF {
            constructor(o) {
                super(o);
                const dT = this.text.bind(this);
                this.text = (t, x, y, op) => {
                    (Array.isArray(t) ? t.map(String) : String(t).split('\n')).forEach(l => { if (l) t3.push(l); });
                    return dT(t, x, y, op);
                };
            }
        };
        const d3 = drawNavLogPdf(P3, { ...sample, perf: { ...sample.perf, profile: pr } });
        drawElevationProfilePage(d3, pr);
        assert.equal(t3.filter(l => l.includes('TMA LA ROCHELLE 1')).length, 2,
            'deux traversées disjointes = deux étiquettes (comportement conservé)');
    });

    test('activités LONGUES des zones R/D/P : repli sur 2 lignes MAX, jamais une seule ligne longue (retour pilote 20/09)', () => {
        const ACT = 'Activités spécifiques défense, tirs, bombardements, activités aériennes diverses';
        const pr = JSON.parse(JSON.stringify(sample.perf.profile));
        pr.routeAirspaces = [{
            name: 'R 147', up: 1500, lo: 800, freq: null,
            ranges: [[0.15, 0.45]],
            segs: [{ zone: 'R 147', fa: 0.15, fb: 0.45, act: ACT, hor: 'NOTAM' }],
        }];
        const subs = [];
        const P4 = class extends jsPDF {
            constructor(o) {
                super(o);
                const dT = this.text.bind(this);
                this.text = (t, x, y, op) => {
                    const f = this.internal.getFont();
                    const s = this.internal.getFontSize();
                    // Seconde ligne des cadres : helvetica normal 5,5 pt.
                    if (f.fontName === 'helvetica' && f.fontStyle === 'normal' && s === 5.5) {
                        (Array.isArray(t) ? t.map(String) : String(t).split('\n')).forEach(l => {
                            if (l) subs.push({ l, w: this.getTextWidth(l) });
                        });
                    }
                    return dT(t, x, y, op);
                };
            }
        };
        const d4 = drawNavLogPdf(P4, { ...sample, perf: { ...sample.perf, profile: pr } });
        drawElevationProfilePage(d4, pr);
        assert.ok(subs.length >= 1, 'activité rendue');
        assert.ok(!subs.some(x => x.l === `${ACT.toUpperCase()} · NOTAM`), 'le texte entier sur UNE ligne est interdit');
        // 2 lignes MAX, chacune bornée par la largeur du cadre (seg 0,15-0,45
        // sur le graphe dédié ≈ 154 pt ; tolérance 1 pt).
        assert.ok(subs.length <= 2, `plus de 2 lignes : ${JSON.stringify(subs.map(x => x.l))}`);
        assert.ok(subs.every(x => x.w <= 155), `ligne plus large que le cadre : ${JSON.stringify(subs)}`);
        // Le contenu est bien réparti : les mots-clés se retrouvent sur l'ensemble des lignes.
        assert.ok(/d[ée]fense|activit[ée]s/i.test(subs.map(x => x.l).join(' ')),
            `activité identifiable dans ${JSON.stringify(subs.map(x => x.l))}`);
    });
});
