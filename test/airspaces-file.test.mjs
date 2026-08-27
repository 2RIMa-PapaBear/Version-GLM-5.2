// Tests de la source FICHIER des espaces aériens (data/airspaces/cells/) :
// expansion du format compact en forme openAIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _expandFileItem } from '../js/airspaces.js';

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
