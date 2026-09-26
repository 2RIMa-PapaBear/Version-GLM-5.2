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
        // 500 ft exactement = plafond au minimum → refusé (> strict).
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 9999, ceilingFt: 500 }).key, 'unctrl_below');
    });

    test('non contrôlé : sous 1500 m ou plafond bas → sous les minima', () => {
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 1200, ceilingFt: 2000 }).key, 'unctrl_below');
        assert.equal(evaluateVfrMinima({ controlled: false, visiM: 9999, ceilingFt: 300 }).key, 'unctrl_below');
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
});
