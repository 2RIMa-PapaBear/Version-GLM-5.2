// Tests du calcul des seuils du critère vent traversier (js/go-nogo.js) —
// la limite de l'AVION ACTIF (flotte) prime sur les seuils génériques.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { xwindThresholds } from '../js/go-nogo.js';

describe('xwindThresholds (A3 : limite traversier par avion)', () => {
    test('sans limite avion → seuils génériques école 12/15 kt', () => {
        assert.deepEqual(xwindThresholds(null), { limit: null, caution: 12, danger: 15 });
        assert.deepEqual(xwindThresholds(undefined), { limit: null, caution: 12, danger: 15 });
    });

    test('limite avion 12 kt : PRUDENCE à 80 % (9.6 → 10), NO-GO à la limite', () => {
        const t = xwindThresholds(12);
        assert.equal(t.limit, 12);
        assert.equal(t.caution, Math.min(12, Math.round(9.6)));
        assert.equal(t.danger, 12);
    });

    test('limite basse 8 kt : PRUDENCE dès 6 kt (80 % de la limite < seuil école)', () => {
        const t = xwindThresholds(8);
        assert.equal(t.caution, 6);
        assert.equal(t.danger, 8);
    });

    test('limite haute 25 kt : PRUDENCE reste plafonnée à 12 kt, NO-GO à 25', () => {
        const t = xwindThresholds(25);
        assert.equal(t.caution, 12);
        assert.equal(t.danger, 25);
    });
});
