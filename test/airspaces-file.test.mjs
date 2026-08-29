// Tests de la source FICHIER des espaces aériens (data/airspaces/cells/) :
// expansion du format compact en forme openAIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _expandFileItem, _decodeType } from '../js/airspaces.js';

test('_expandFileItem : polygone compact → forme openAIP complète', () => {
    const c = {
        i: 'abc', n: 'SIV RENNES SUD A', ty: 33, ic: null,
        lo: [0, 1], up: [115, 6], f: [{ value: '134.000', name: 'RENNES INFORMATION' }],
        g: { t: 1, c: [[[-1.5, 48.1], [-1.4, 48.1], [-1.4, 48.2], [-1.5, 48.2], [-1.5, 48.1]]] },
    };
    const it = _expandFileItem(c);
    assert.equal(it._id, 'abc');
    assert.equal(it.name, 'SIV RENNES SUD A');
    assert.equal(it.type, 33);
    assert.deepEqual(it.lowerLimit, { value: 0, unit: 1 });
    assert.deepEqual(it.upperLimit, { value: 115, unit: 6 });
    assert.equal(it.geometry.type, 'Polygon');
    assert.equal(it.geometry.coordinates[0].length, 5);
    assert.equal(it.frequencies[0].value, '134.000');
});

test('_expandFileItem : Point+rayon et champs absents', () => {
    const pt = _expandFileItem({ i: 'x', n: 'Z', ty: 7, lo: null, up: [25, 6], f: null, r: [5], g: { t: 0, c: [2.5, 49.0] } });
    assert.equal(pt.geometry.type, 'Point');
    assert.deepEqual(pt.geometry.coordinates, [2.5, 49.0]);
    assert.equal(pt.radius.value, 5);
    assert.equal(pt.lowerLimit, null);
    assert.deepEqual(pt.frequencies, []);

    const vide = _expandFileItem({ i: 'y', n: 'W', ty: 0, lo: null, up: null, f: null, g: null });
    assert.equal(vide.geometry, null);
});

// Tests du décodage type → famille. Les cellules openAIP stockent le type
// BRUT openAIP ; la base SIA (data/sia-airspaces.json) une numérotation
// PROPRE qui collisionne (SIA 5=TMA vs openAIP 5=TMZ…) — d'où le marqueur
// _sia qui aiguille vers la bonne table.
test('_decodeType : numérotation openAIP (cellules, sans _sia)', () => {
    assert.equal(_decodeType({ type: 6,  name: 'RMZ CHERBOURG' }),  'RMZ');
    assert.equal(_decodeType({ type: 5,  name: 'TMZ SEINE 9' }),    'TMZ');
    assert.equal(_decodeType({ type: 13, name: 'ZARAGOZA ATZ' }),   'ATZ');
    assert.equal(_decodeType({ type: 14, name: 'WITTERING' }),      'ATZ');   // MATZ
    assert.equal(_decodeType({ type: 25, name: 'TWELVE MILE EAST MOA' }), 'RESTRICTED');
    assert.equal(_decodeType({ type: 26, name: 'PONCE CLASS E5' }), 'CTA');
    assert.equal(_decodeType({ type: 28, name: 'BROWN DZ' }),       'DROP');
    assert.equal(_decodeType({ type: 4,  name: 'ZARAGOZA CTR' }),   'CTR');
    assert.equal(_decodeType({ type: 7,  name: 'TMA ZARAGOZA-1' }), 'TMA');
    assert.equal(_decodeType({ type: 33, name: 'SIV AJACCIO' }),    'SIV');
});

test('_decodeType : numérotation SIA (items marqués _sia)', () => {
    assert.equal(_decodeType({ _sia: true, type: 5,  name: 'TMA RENNES' }),     'TMA');
    assert.equal(_decodeType({ _sia: true, type: 33, name: 'SIV RENNES SUD A' }), 'SIV');
    assert.equal(_decodeType({ _sia: true, type: 11, name: 'TMZ SEINE' }),      'TMZ');
    assert.equal(_decodeType({ _sia: true, type: 12, name: 'RMZ ANNECY' }),     'RMZ');
    assert.equal(_decodeType({ _sia: true, type: 6,  name: 'ATZ' }),            'ATZ');
    assert.equal(_decodeType({ _sia: true, type: 14, name: 'TrPla' }),          'GLIDER');
    assert.equal(_decodeType({ _sia: true, type: 1,  name: 'Pje' }),            'DROP');
});

test('_decodeType : repli sur le nom quand le type manque', () => {
    assert.equal(_decodeType({ name: 'RMZ ANGOULEME' }),  'RMZ');
    assert.equal(_decodeType({ name: 'ATZ DEAUVILLE' }),  'ATZ');
    assert.equal(_decodeType({ name: 'TMZ PARIS' }),      'TMZ');
});
