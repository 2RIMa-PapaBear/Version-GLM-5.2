// Tests de la distance d'ATTERRISSAGE corrigée (js/takeoff-performance.js,
// A5) — fonction pure : densité-altitude, vent longitudinal, revêtement ;
// et du calcul depuis un METAR BRUT (destination distante).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { correctedLandingDistance, evaluateLandingFromRaw } from '../js/takeoff-performance.js';

// Stub localStorage — lu PAR APPEL par la flotte (getFleet), pas au chargement.
const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

describe('correctedLandingDistance (A5 : performance atterrissage)', () => {
    test('références restituées à DA nulle, sans vent, piste dure sèche', () => {
        const c = correctedLandingDistance(0, 725, 1400, {});
        assert.equal(c.rollFt, 725);
        assert.equal(c.fiftyFt, 1400);
        assert.equal(c.windFactor, 1);
        assert.equal(c.surfaceFactor, 1);
    });

    test('vent DE FACE 10 kt : −10 % (plancher −30 % à 30 kt)', () => {
        const c10 = correctedLandingDistance(0, 1000, 2000, { headwindKt: 10 });
        assert.equal(c10.rollFt, 900);
        const c30 = correctedLandingDistance(0, 1000, 2000, { headwindKt: 30 });
        assert.equal(c30.rollFt, 700);
        const c60 = correctedLandingDistance(0, 1000, 2000, { headwindKt: 60 });
        assert.equal(c60.rollFt, 700, 'plancher −30 % au-delà de 30 kt de face');
    });

    test('vent ARRIÈRE 10 kt : +20 % (plafond +60 %)', () => {
        const c = correctedLandingDistance(0, 1000, 2000, { headwindKt: -10 });
        assert.equal(c.rollFt, 1200);
        const c40 = correctedLandingDistance(0, 1000, 2000, { headwindKt: -40 });
        assert.equal(c40.rollFt, 1600, 'plafond +60 % au-delà de 30 kt arrière');
    });

    test('densité-altitude 2000 ft : +20 %, se combine au vent', () => {
        const c = correctedLandingDistance(2000, 1000, 2000, { headwindKt: 0 });
        assert.equal(c.rollFt, 1200);
        const cw = correctedLandingDistance(2000, 1000, 2000, { headwindKt: 10 });
        assert.equal(cw.rollFt, Math.round(1000 * 1.2 * 0.9));
    });

    test('herbe humide : +25 % (mêmes facteurs maison que le décollage)', () => {
        const c = correctedLandingDistance(0, 1000, 2000, { surfaceCode: 'GRE', wet: true });
        assert.equal(c.rollFt, 1250);
    });

    test('références absentes ou invalides → null (section masquée)', () => {
        assert.equal(correctedLandingDistance(0, null, 1400, {}), null);
        assert.equal(correctedLandingDistance(0, 725, 0, {}), null);
    });
});

describe('evaluateLandingFromRaw (A5 : atterrissage de la destination, METAR brut)', () => {
    test('météo complète → distances corrigées, piste marquée PRÉVUE', () => {
        const l = evaluateLandingFromRaw('LFXX', {
            raw: 'LFXX 131200Z 31010KT 9999 FEW040 15/08 Q1013 NOSIG',
            qnh: 1013, oat: 15, elevationFt: 0,
        });
        assert.ok(l, 'calculé (C172 par défaut porte les refs POH)');
        assert.equal(l.forecast, true, 'piste PRÉVUE (destination distante, pas de rose des vents)');
        assert.ok(Math.abs(l.fiftyFt - 1400) <= 8, `fiftyFt ≈ 1400 à DA≈0, obtenu ${l.fiftyFt}`);
        assert.equal(l.runwayLength, null, 'longueur inconnue sous Node (base non chargée)');
        assert.equal(l.level, 'unknown');
    });

    test('qnh/oat manquants ou ICAO absent → null', () => {
        assert.equal(evaluateLandingFromRaw('LFXX', { raw: '', qnh: null, oat: 15, elevationFt: 0 }), null);
        assert.equal(evaluateLandingFromRaw(null, { raw: 'x', qnh: 1013, oat: 15 }), null);
    });
});
