// Tests du module VFR MINIMA (js/vfr-minima.js) — partie pure :
// matrice d'évaluation contrôlé / non contrôlé / VFR spécial / nuit, et
// extraction visi-plafond d'un METAR brut. Tourne via `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateVfrMinima, metarVisiCeiling, VFR_MINIMA, tafVisiCeilingAt } from '../js/vfr-minima.js';

describe('evaluateVfrMinima (matrice réglementaire)', () => {
    test('contrôlé : visi ≥ 5 km et base ≥ 2500 ft (clearance D) → OK', () => {
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 9999, ceilingFt: 99999 }).level, 'ok');
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 5000, ceilingFt: 2500 }).level, 'ok');
    });

    test('contrôlé : plafond 1500–2500 ft → PRUDENCE (marge sous couche < 1000 ft — règle pilote 26/09)', () => {
        const v = evaluateVfrMinima({ controlled: true, visiM: 9999, ceilingFt: 1500 });
        assert.equal(v.level, 'caution');
        assert.equal(v.key, 'ctrl_clearance');
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 8000, ceilingFt: 2000 }).key, 'ctrl_clearance');
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 8000, ceilingFt: 2499 }).key, 'ctrl_clearance');
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 5000, ceilingFt: 2500 }).key, 'ctrl_ok', '2500 exactement = OK');
        // Visi insuffisante en même temps → toujours sp_needed.
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 4500, ceilingFt: 2000 }).key, 'sp_needed');
    });

    test('contrôlé : sous 5 km mais ≥ 1500 m et ≥ 600 ft → VFR SPÉCIAL (jour)', () => {
        const v = evaluateVfrMinima({ controlled: true, visiM: 4500, ceilingFt: 1200 });
        assert.equal(v.level, 'caution');
        assert.equal(v.key, 'sp_needed');
        // Limite exacte VFR spécial.
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 1500, ceilingFt: 600 }).key, 'sp_needed');
        // Plafond intermédiaire sous 1500 ft mais ≥ 600 ft.
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 8000, ceilingFt: 900 }).key, 'sp_needed');
    });

    test('contrôlé + NUIT : VFR spécial interdit → danger', () => {
        const v = evaluateVfrMinima({ controlled: true, visiM: 4500, ceilingFt: 1200, isNight: true });
        assert.equal(v.level, 'danger');
        assert.equal(v.key, 'sp_night');
        // La nuit ne change rien quand les minima pleins sont tenus.
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 9999, ceilingFt: 5000, isNight: true }).level, 'ok');
    });

    test('contrôlé : sous 1500 m ou sous 600 ft → sous les minima', () => {
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 1200, ceilingFt: 1200 }).key, 'ctrl_below');
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: 8000, ceilingFt: 400 }).key, 'ctrl_below');
    });

    test('non contrôlé : ≥ 1500 m et plafond STRICTEMENT > 500 ft → OK', () => {
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 2000, ceilingFt: 600 }).level, 'ok');
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 9999, ceilingFt: 99999 }).key, 'unctrl_ok');
    });

    test('FICHE n°8 : plafond 0–500 ft avec visi tenue → PRUDENCE (pas de plafond numérique en classe G)', () => {
        // SERA.5005 classe G : « hors nuages, en vue de la surface » — le
        // 500 ft est une garde SERA.3105 (hauteur minimale), pas un minima
        // VMC : légal mais très bas → caution, pas danger.
        const v = evaluateVfrMinima({ controlled: false, visiM: 2000, ceilingFt: 400 });
        assert.equal(v.level, 'caution');
        assert.equal(v.key, 'unctrl_lowceil');
        // 500 ft exactement : borne incluse dans la bande de prudence.
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 9999, ceilingFt: 500 }).key, 'unctrl_lowceil');
        // Nuit : même règle dès que la visi de table (5 km) est tenue.
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 6000, ceilingFt: 400, isNight: true }).key, 'unctrl_lowceil');
        // Sans visi tenue, rien n'est « légalisé ».
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 1200, ceilingFt: 400 }).key, 'unctrl_below');
    });

    test('non contrôlé : visi sous le minimum → sous les minima (plafond haut ou non)', () => {
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 1200, ceilingFt: 2000 }).key, 'unctrl_below');
        // (le plafond bas avec visi tenue relève de la fiche n°8 ci-dessus)
    });

    test('non contrôlé NUIT : la réduction à 1500 m est jour seulement — 5 km requis (fiche n°3, SERA.5005(b)(2))', () => {
        // 3000 m la nuit en G : sous la visi de table (5 km) → danger.
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 3000, ceilingFt: 3000, isNight: true }).key, 'unctrl_below');
        // 5 km la nuit → OK.
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 5000, ceilingFt: 3000, isNight: true }).key, 'unctrl_ok');
    });

    test('météo manquante → unknown (jamais de faux verdict)', () => {
        assert.equal(evaluateVfrMinima({ controlled: true, visiM: null, ceilingFt: null }).level, 'unknown');
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: NaN, ceilingFt: 1000 }).level, 'unknown');
    });

    test('constantes réglementaires intouchées', () => {
        assert.deepEqual(VFR_MINIMA, {
            CTRL_VISI_M: 5000, CTRL_CEIL_FT: 1500, CTRL_CLEARANCE_FT: 2500,
            SP_VISI_M: 1500, SP_CEIL_FT: 600,
            UNCTRL_VISI_M: 1500, UNCTRL_CEIL_FT: 500,
        });
    });
});

describe('metarVisiCeiling (extraction METAR brut)', () => {
    test('visi 9999 + BKN012 → plafond 1200 ft (après le groupe vent)', () => {
        const vc = metarVisiCeiling('LFRV 171200Z 34009KT 9999 FEW035 BKN012 18/07 Q1018');
        assert.equal(vc.visiM, 9999);
        assert.equal(vc.ceilingFt, 1200);
    });

    test('CAVOK → 10 km, plafond illimité', () => {
        const vc = metarVisiCeiling('LFRV 171200Z 34009KT CAVOK 18/07 Q1018');
        assert.equal(vc.visiM, 10000);
        assert.ok(vc.ceilingFt >= 99999);
    });

    test('le QNH (1018) et le vent (34009KT) ne sont pas pris pour la visi', () => {
        const vc = metarVisiCeiling('LFST 171200Z 16004KT 9999 FEW048 SCT190 20/08 Q1018=');
        assert.equal(vc.visiM, 9999);
        assert.equal(vc.ceilingFt, 99999 - 99900 + 99900); // FEW/SCT ne font pas plafond → illimité
    });

    test('visi réduite 3500 m + OVC006', () => {
        const vc = metarVisiCeiling('LFxx 171200Z VRB03KT 3500 OVC006 12/10 Q1025');
        assert.equal(vc.visiM, 3500);
        assert.equal(vc.ceilingFt, 600);
    });

    test('METAR absent ou sans visi exploitable → null', () => {
        assert.equal(metarVisiCeiling(null), null);
        assert.equal(metarVisiCeiling(''), null);
        assert.equal(metarVisiCeiling('NO DATA'), null);
    });

    // Régression 17/09 (retour pilote /test/) : le format AUTO français
    // colle un suffixe à la visi (9999NDZ) — l'extracteur strict la ratait
    // et toutes les lignes Minima affichaient « météo indisponible ».
    test('format français AUTO : 9999NDZ + nuages à suffixe + « = » final', () => {
        const vc = metarVisiCeiling('LFRV 171520Z AUTO 33008KT 9999NDZ SCT043 BKN049SC 17/08 Q1019=');
        assert.equal(vc.visiM, 9999);
        assert.equal(vc.ceilingFt, 4900);
    });

    test('format français : visi réduite avec suffixe ND', () => {
        const vc = metarVisiCeiling('LFxx 171520Z AUTO 24010KT 3500ND BKN009 14/11 Q1015=');
        assert.equal(vc.visiM, 3500);
        assert.equal(vc.ceilingFt, 900);
    });

    test('vent illisible (/////KT) : la visi se lit quand même', () => {
        const vc = metarVisiCeiling('LFxx 171520Z AUTO /////KT 9999NDZ FEW030 12/09 Q1018=');
        assert.equal(vc.visiM, 9999);
    });

    // Fiche 10 (audit 27/09) : visi impériale des METAR US/Canada. Le nombre
    // mixte « 1 1/2SM » s'écrit en DEUX groupes, et le préfixe M signifie
    // « moins de » — l'ancienne regex locale y lisait ½ SM et... 4 SM.
    test('visi impériale SM : 1 1/2SM, 1/4SM, M1/4SM, 3SM', () => {
        const vc = metarVisiCeiling('KXYZ 171753Z AUTO 18012KT 1 1/2SM FEW031 18/07 A2992');
        assert.ok(Math.abs(vc.visiM - 2414) < 5, `1 1/2SM → ${vc.visiM} m`);
        const q = metarVisiCeiling('KXYZ 171753Z AUTO 18012KT 1/4SM FG VV002 18/07 A2992');
        assert.ok(Math.abs(q.visiM - 402) < 5, `1/4SM → ${q.visiM} m`);
        const m = metarVisiCeiling('KXYZ 171753Z AUTO 18012KT M1/4SM FG VV002 18/07 A2992');
        assert.ok(Math.abs(m.visiM - 402) < 5, `M1/4SM → ${m.visiM} m (pas 4 SM ≈ 6437 m)`);
        const t = metarVisiCeiling('KXYZ 171753Z AUTO 18012KT 3SM SKC 18/07 A2992');
        assert.ok(Math.abs(t.visiM - 4828) < 5, `3SM → ${t.visiM} m`);
    });
});

describe('tafVisiCeilingAt (heure sur l\'axe du TAF)', () => {
    test('TAF fictif : prend la valeur de l\'échéance, pas la première', () => {
        const taf = {
            startYear: 2026, startMonth: 9, startDay: 17,
            base: {
                visi: [{ start: 0, end: 24, val: '9999' }, { start: 24, end: 48, val: '3500' }],
                nuage: [{ start: 0, end: 24, val: 'FEW030' }, { start: 24, end: 48, val: 'BKN008' }],
            },
        };
        const hier = tafVisiCeilingAt(taf, Date.UTC(2026, 8, 17, 10));   // jour J 10h
        assert.equal(hier.visiM, 10000);   // 9999 → 10000 (convention du parseur)
        const demain = tafVisiCeilingAt(taf, Date.UTC(2026, 8, 18, 10)); // J+1 10h → heure 34
        assert.equal(demain.visiM, 3500);
        assert.equal(demain.ceilingFt, 800);
    });

    test('TAF illisible → null', () => {
        assert.equal(tafVisiCeilingAt(null, Date.now()), null);
        assert.equal(tafVisiCeilingAt({}, Date.now()), null);
    });

    test('M4 (audit 27/09) : heure hors validité (TAF périmé / ETA au-delà) → null, pas de « >10 km/CAVOK » fabriqué', () => {
        const taf = {
            startYear: 2026, startMonth: 9, startDay: 17,
            base: {
                visi: [{ start: 0, end: 24, val: '9999' }, { start: 24, end: 48, val: '3500' }],
                nuage: [{ start: 0, end: 24, val: 'FEW030' }, { start: 24, end: 48, val: 'BKN008' }],
            },
        };
        // ETA à J+2 10h = heure 58 : AUCUN bloc ne couvre → inconnu (le
        // repli METAR du caller peut s'armer), pas 10 km de visi inventés.
        assert.equal(tafVisiCeilingAt(taf, Date.UTC(2026, 8, 19, 10)), null);
        // Symétrique : heure négative (cible avant l'émission).
        assert.equal(tafVisiCeilingAt(taf, Date.UTC(2026, 8, 16, 18)), null);
    });

    test('M7 (audit 27/09) : TEMPO actif à l\'heure cible → on retient le plus pénalisant', () => {
        const taf = {
            startYear: 2026, startMonth: 9, startDay: 17,
            base: {
                visi: [{ start: 0, end: 24, val: '9999' }],
                nuage: [{ start: 0, end: 24, val: 'BKN030' }],
            },
            tempo: [
                { start: 10, end: 12, visi: '4000', nuage: 'BKN012', type: 'TEMPO', prob: '' },
            ],
        };
        const enTempo = tafVisiCeilingAt(taf, Date.UTC(2026, 8, 17, 11));   // heure 11
        assert.equal(enTempo.visiM, 4000, 'TEMPO 4000 → 4000 m, pas le 9999 de la base');
        assert.equal(enTempo.ceilingFt, 1200, 'BKN012 → 1200 ft, pas le SCT030 de la base');
        const horsTempo = tafVisiCeilingAt(taf, Date.UTC(2026, 8, 17, 14)); // heure 14
        assert.equal(horsTempo.visiM, 10000);
        assert.equal(horsTempo.ceilingFt, 3000);
    });
});
