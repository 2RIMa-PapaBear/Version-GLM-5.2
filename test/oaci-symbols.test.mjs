// Tests de classification des icônes aérodromes « carte OACI »
// (js/oaci-symbols.js) — règles SIA : statut MIL → militaire, PRV/prive →
// privé, CAP/OFF/RST → civil ; revêtement (gazon/non revêtue → bande,
// sinon piste-dur) ; hors France/sans entrée SIA → null (à demander).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyOaciSymbol, MIXTE_OVERRIDES, MANUAL_OVERRIDES, MILITARY_OVERRIDES, bearingDeg, oaciRunwayBearing, oaciIconRotation, oaciSymbolSvg, OACI_BAR_HEADING } from '../js/oaci-symbols.js';

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

describe('symboles SVG recomposés (cardinaux COLLÉS, cotes mesurées)', () => {
    test('piste-dur civil : 4 traits cardinaux collés (rects y=2, h=12) + canal pivoté + disque r36', () => {
        const svg = oaciSymbolSvg('civil-piste-dur', 133.5);
        assert.ok(svg.includes('rotate(133.5 50 50)'), 'canal pivoté au cap');
        assert.ok(svg.includes('<rect x="44.6" y="2" width="10.8" height="12"'), 'trait N collé (+1 px : largeur 10,8)');
        assert.equal((svg.match(/<rect /g) || []).length, 5, '4 cardinaux + canal');
        assert.ok(svg.includes('r="36" fill="#0040A0"'), 'disque');
        assert.ok(!svg.includes('r="25.6"'), 'civil : pas d anneau externe');
    });

    test('mixte : anneau externe r25,6 détaché, traits collés à l anneau ; militaire réduit (k=0,76) et rouge', () => {
        const mx = oaciSymbolSvg('mixte-piste-dur', 40);
        assert.ok(mx.includes('r="25.6"'));
        assert.ok(mx.includes('height="20.2"'), 'traits collés au bord externe de l anneau');
        const mil = oaciSymbolSvg('militaire-piste-dur', 90);
        assert.ok(mil.includes('#E03020') && mil.includes('r="36" fill="#E03020"'), 'militaire À LA MÊME TAILLE que civil (retour pilote)');
        assert.ok(mil.includes('width="10.8"'), 'traits militaire épaissis comme les autres');
    });

    test('bande : anneau FIN (r34 ép. 7), sans orientation', () => {
        const bande = oaciSymbolSvg('civil-bande', 90);
        assert.ok(bande.includes('r="34"') && bande.includes('stroke-width="7"'));
        assert.ok(!bande.includes('rotate('), 'bande : pas d orientation');
    });

    test('hélistation : H blanc (3 rects) ; hydro : ancre (arc A 15 13)', () => {
        const heli = oaciSymbolSvg('civil-helistation', null);
        assert.equal((heli.match(/<rect /g) || []).length, 7, '4 cardinaux + 2 montants + barre');
        assert.ok(oaciSymbolSvg('civil-hydro', null).includes('A 15 13'));
    });

    test('privé : P blanc sur disque r36 ; désaffecté : anneau noir barré X, sans cardinaux', () => {
        const p = oaciSymbolSvg('prive', null);
        assert.ok(p.includes('r="36" fill="#0040A0"') && p.includes('<circle cx="55" cy="37" r="14"'));
        const d = oaciSymbolSvg('desaffecte', null);
        assert.ok(d.includes('#141414') && (d.match(/<line /g) || []).length === 2, 'X sans cardinaux');
        assert.ok(!d.includes('<rect'), 'pas de traits cardinaux sur le désaffecté');
    });

    test('nom inconnu → null ; cap normalisé mod 180 ; repli pose légende', () => {
        assert.equal(oaciSymbolSvg('civil-foo', 90), null);
        assert.equal(oaciSymbolSvg('nimporte', 90), null);
        assert.ok(oaciSymbolSvg('civil-piste-dur', 313.5).includes('rotate(133.5 50 50)'));
        assert.ok(oaciSymbolSvg('civil-piste-dur', null).includes(`rotate(${OACI_BAR_HEADING} 50 50)`));
    });
});

describe('MILITARY_OVERRIDES (saisies pilote)', () => {
    test('LFRH Lorient Lann-Bihoué : militaire malgré statut SIA « RST »', () => {
        assert.ok(MILITARY_OVERRIDES.has('LFRH'));
        assert.equal(classifyOaciSymbol('LFRH', AF('RST'), RW('béton')).icon, 'militaire-piste-dur');
        // injection : sans override, RST resterait civil
        MILITARY_OVERRIDES.delete('LFRH');
        try {
            assert.equal(classifyOaciSymbol('LFRH', AF('RST'), RW('béton')).icon, 'civil-piste-dur');
        } finally {
            MILITARY_OVERRIDES.add('LFRH');
        }
    });
});
