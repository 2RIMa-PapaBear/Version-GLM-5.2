// Tests du module flotte (js/aircraft-fleet.js) sous Node, avec un stub
// localStorage. Tourne via `npm test`.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage (aircraft-fleet.js y persiste la flotte).
const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
};

const fleet = await import('../js/aircraft-fleet.js');

beforeEach(() => { _store.clear(); });

describe('flotte — vitesse/conso de croisière', () => {
    test('avion par défaut (C172) : champs perf présents', () => {
        const ac = fleet.getActiveAircraft();
        assert.equal(ac.cruiseSpeedKt, 110);
        assert.equal(ac.fuelBurnLph, 35);
    });

    test('addAircraft enregistre la perf ; valeurs invalides → null', () => {
        const ac = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 105, fuelBurnLph: 22 });
        assert.equal(ac.cruiseSpeedKt, 105);
        assert.equal(ac.fuelBurnLph, 22);
        const bad = fleet.addAircraft({ name: 'X', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 'abc', fuelBurnLph: -5 });
        assert.equal(bad.cruiseSpeedKt, null);
        assert.equal(bad.fuelBurnLph, null);
    });

    test('updateAircraft PARTIEL : préserve nom/immat/distances, met à jour la perf', () => {
        const ac = fleet.addAircraft({ name: 'DR400', registration: 'F-GKAZ', groundRoll: 500, fiftyFt: 1100, cruiseSpeedKt: 105 });
        const up = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 115, fuelBurnLph: 24 });
        assert.equal(up.name, 'DR400');
        assert.equal(up.registration, 'F-GKAZ');
        assert.equal(up.groundRoll, 500);
        assert.equal(up.fiftyFt, 1100);
        assert.equal(up.cruiseSpeedKt, 115);
        assert.equal(up.fuelBurnLph, 24);
    });

    test('updateAircraft partiel : champ perf absent reste null', () => {
        const ac = fleet.addAircraft({ name: 'X', groundRoll: 500, fiftyFt: 1100 });
        const up = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 95 });
        assert.equal(up.cruiseSpeedKt, 95);
        assert.equal(up.fuelBurnLph, null);
    });
});
