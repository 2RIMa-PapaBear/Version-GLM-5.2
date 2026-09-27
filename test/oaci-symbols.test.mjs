// Tests de classification des icônes aérodromes « carte OACI »
// (js/oaci-symbols.js) — règles SIA : statut MIL → militaire, PRV/prive →
// privé, CAP/OFF/RST → civil ; revêtement (gazon/non revêtue → bande,
// sinon piste-dur) ; hors France/sans entrée SIA → null (à demander).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOaciSymbol, MIXTE_OVERRIDES, MANUAL_OVERRIDES, bearingDeg, oaciRunwayBearing, oaciIconRotation, oaciDurSymbolSvg, OACI_BAR_HEADING } from '../js/oaci-symbols.js';

const AF = (statut, prive = false) => ({ statut, prive });
const RW = surf => [{ d: '10/28', surf, main: true }];

describe('classifyOaciSymbol (règles SIA)', () => {
    test('civil, piste revêtue : asphalte/béton/revêtue → civil-piste-dur', () => {
        assert.equal(classifyOaciSymbol('LFBI', AF('CAP'), RW('asphalte')).icon, 'civil-piste-dur');
        assert.equal(classifyOaciSymbol('LFQB', AF('OFF'), RW('béton bitumineux')).icon, 'civil-piste-dur');
        assert.equal(classifyOaciSymbol('LFRN', AF('RST'), RW('revêtue')).icon, 'civil-piste-dur');
    });

    test('bande : gazon / non revêtue / terre', () => {
        assert.equal(classifyOaciSymbol('LFFH', AF('CAP'), RW('gazon')).icon, 'civil-bande');
        assert.equal(classifyOaciSymbol('LFXX', AF('CAP'), RW('non revêtue')).icon, 'civil-bande');
        assert.equal(classifyOaciSymbol('LFXY', AF('CAP'), RW('terre')).icon, 'civil-bande');
    });

    test('piste principale seule compte : principale en dur, secondaire en gazon', () => {
        const rws = [{ d: '09/27', surf: 'gazon' }, { d: '03/21', surf: 'asphalte', main: true }];
        assert.equal(classifyOaciSymbol('LFBI', AF('CAP'), rws).icon, 'civil-piste-dur');
    });

    test('sans revêtement renseigné → piste-dur par défaut', () => {
        assert.equal(classifyOaciSymbol('LFQZ', AF('CAP'), [{ d: '18/36', main: true }]).icon, 'civil-piste-dur');
        assert.equal(classifyOaciSymbol('LFQY', AF('CAP'), null).icon, 'civil-piste-dur');
    });

    test('militaire : statut MIL → militaire-<surface>', () => {
        assert.equal(classifyOaciSymbol('LFOA', AF('MIL'), RW('revêtue')).icon, 'militaire-piste-dur');
        assert.equal(classifyOaciSymbol('LFPR', AF('MIL'), RW('gazon')).icon, 'militaire-bande');
    });

    test('privé : statut PRV → prive ; drapeau prive seul (non fiable) → civil', () => {
        assert.equal(classifyOaciSymbol('LF01', AF('PRV'), RW('revêtue')).icon, 'prive');
        assert.equal(classifyOaciSymbol('LFPA', AF('CAP', true), RW('revêtue')).icon, 'civil-piste-dur');
    });

    test('hors France → null (pastille conservée)', () => {
        assert.equal(classifyOaciSymbol('EGKK', AF('CAP'), RW('asphalte')), null);
        assert.equal(classifyOaciSymbol('EBBR', null, null), null);
    });

    test('sans entrée sia-airfields ni override → null (à faire trancher par le pilote)', () => {
        assert.equal(classifyOaciSymbol('LFZZ', null, RW('gazon')), null);
    });

    test('MIXTE_OVERRIDES : table manuelle pilote → mixte-<surface>', () => {
        MIXTE_OVERRIDES.add('LFSL');
        try {
            assert.equal(classifyOaciSymbol('LFSL', AF('CAP'), RW('revêtue')).icon, 'mixte-piste-dur');
        } finally {
            MIXTE_OVERRIDES.delete('LFSL');
        }
    });
});

describe('saisies pilote + orientation piste (27/09)', () => {
    test('MANUAL_OVERRIDES : LFVM/LFVP civil-dur, LFPI hélistation, LFPY désaffecté', () => {
        assert.equal(classifyOaciSymbol('LFVM', null, null).icon, 'civil-piste-dur');
        assert.equal(classifyOaciSymbol('LFVP', null, null).icon, 'civil-piste-dur');
        assert.equal(classifyOaciSymbol('LFPI', null, null).icon, 'civil-helistation');
        assert.equal(classifyOaciSymbol('LFPY', null, null).icon, 'desaffecte');
    });

    test('bearingDeg : plein Est = 90°, plein Nord = 0°', () => {
        const bE = bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
        const bN = bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 });
        assert.ok(Math.abs(bE - 90) < 0.01);
        assert.ok(Math.abs(bN - 0) < 0.01);
    });

    test('oaciRunwayBearing : seuils SIA t1/t2 (cap vrai) prioritaire sur brg', () => {
        const rws = [{ d: '09/27', main: true, brg: 275,
            t1: { lat: 0, lon: 0 }, t2: { lat: 0, lon: 1 } }];   // plein Est
        assert.ok(Math.abs(oaciRunwayBearing('LFXX', rws) - 90) < 0.01);
        const seulementBrg = [{ d: '11/29', main: true, brg: 112 }];
        assert.equal(oaciRunwayBearing('LFXX', seulementBrg), 112);
        assert.equal(oaciRunwayBearing('LFXX', null), null);
    });

    test('oaciIconRotation : canal piste dessiné à ~40° dans le pictogramme', () => {
        assert.equal(oaciIconRotation('civil-piste-dur', 40), 0);
        assert.equal(oaciIconRotation('civil-piste-dur', 220), 0);       // 220 ≡ 40 (mod 180)
        assert.equal(oaciIconRotation('civil-piste-dur', 50), 10);
        assert.equal(oaciIconRotation('civil-piste-dur', 320), -80);     // 320 mod 180 = 140 → 140−40 = 100 ≡ −80
        assert.equal(oaciIconRotation('civil-piste-dur', 133.5), 93.5 - 180);   // Le Touquet 13/31
        // pas de rotation hors famille « piste-dur »
        assert.equal(oaciIconRotation('civil-bande', 50), 0);
        assert.equal(oaciIconRotation('prive', 50), 0);
        assert.equal(oaciIconRotation('militaire-piste-dur', null), 0);
    });
});

describe('symbole SVG « piste en dur » (cardinaux fixes, piste pivotée)', () => {
    test('famille piste-dur : SVG avec 4 traits cardinaux + canal pivoté au cap', () => {
        const svg = oaciDurSymbolSvg('civil-piste-dur', 133.5);
        assert.ok(svg.includes('rotate(133.5 50 50)'), 'canal pivoté au cap');
        assert.equal((svg.match(/<line /g) || []).length, 4, '4 traits cardinaux N/E/S/W');
        assert.ok(svg.includes('#0040A0'));
        assert.ok(!svg.includes('<circle cx="50" cy="50" r="39"'), 'civil : pas d\'anneau externe');
    });

    test('mixte/militaire : anneau externe (double) ; rouge militaire', () => {
        assert.ok(oaciDurSymbolSvg('mixte-piste-dur', 40).includes('r="39"'));
        const mil = oaciDurSymbolSvg('militaire-piste-dur', 90);
        assert.ok(mil.includes('#E03020') && mil.includes('r="39"'));
    });

    test('hors famille → null (PNG extrait utilisé) ; cap normalisé mod 180', () => {
        assert.equal(oaciDurSymbolSvg('civil-bande', 90), null);
        assert.equal(oaciDurSymbolSvg('prive', 90), null);
        assert.ok(oaciDurSymbolSvg('civil-piste-dur', 313.5).includes('rotate(133.5 50 50)'));
        assert.ok(oaciDurSymbolSvg('civil-piste-dur', null).includes(`rotate(${OACI_BAR_HEADING} 50 50)`));
    });
});
