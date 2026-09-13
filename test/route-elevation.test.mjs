// Tests de la marge au relief AVEC obstacles (js/route-elevation.js, A6) —
// un sommet d'obstacle du couloir devient le pire point quand il approche
// plus la croisière que le terrain.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClearance } from '../js/route-elevation.js';

const PROF = {
    points: [
        { frac: 0, lat: 47, lon: -3, elevFt: 500 },
        { frac: 0.5, lat: 47.2, lon: -2.8, elevFt: 1200 },
        { frac: 1, lat: 47.4, lon: -2.6, elevFt: 300 },
    ],
};

describe('evaluateClearance avec obstacles (A6)', () => {
    test('sans obstacle : marge au relief seul', () => {
        const r = evaluateClearance(PROF, 2500, 1000);
        assert.equal(r.minClearanceFt, 1300);
        assert.equal(r.level, 'ok');
        assert.equal(r.worstObstacle, null);
    });

    test('pylône sous la croisière à moins de 1000 ft → CAUTION et pire point', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.5, topFt: 2100, type: 'Pylône' }]);
        assert.equal(r.minClearanceFt, 400);
        assert.equal(r.level, 'caution');
        assert.equal(r.worstObstacle.type, 'Pylône');
    });

    test('sommet au-dessus de la croisière → DANGER', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.2, topFt: 2600, type: 'Éolienne' }]);
        assert.equal(r.level, 'danger');
        assert.equal(r.worstObstacle.topFt, 2600);
    });

    test('obstacle moins critique que le relief : sans effet', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.5, topFt: 1000, type: 'Mât' }]);
        assert.equal(r.minClearanceFt, 1300);
        assert.equal(r.worstObstacle, null);
    });

    test('entrées invalides', () => {
        const r = evaluateClearance(null, 2500, 1000, [{ topFt: 2600 }]);
        assert.equal(r.minClearanceFt, null);
        assert.equal(r.level, 'ok');
    });
});
