// Tests du démarrage géolocalisé : station la plus proche d'un point
// (js/core.js — pur ; la liste est fournie par l'appelant).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getNearestAirport } from '../js/core.js';

const BASE = [
    { icao: 'LFRV', name: 'Vannes-Meucon', lat: 47.7199, lon: -2.7497 },
    { icao: 'LFRN', name: 'Rennes', lat: 48.07, lon: -1.7343 },
    { icao: 'LFPO', name: 'Orly', lat: 48.7233, lon: 2.3794 },
    // Pièges : un strip SANS code OACI (plus proche de tout) et une entrée
    // sans coordonnées — les deux doivent être ignorés.
    { icao: '', name: 'strip sans OACI', lat: 47.35, lon: -2.85 },
    { icao: 'LFXX', name: 'sans coordonnées' },
];

describe('getNearestAirport (démarrage géolocalisé)', () => {
    test('renvoie le terrain OACI le plus proche', () => {
        assert.equal(getNearestAirport(47.3, -2.9, BASE).icao, 'LFRV');
        assert.equal(getNearestAirport(48.05, -1.7, BASE).icao, 'LFRN');
        assert.equal(getNearestAirport(48.7, 2.4, BASE).icao, 'LFPO');
    });

    test('ignore les entrées sans OACI exploitable ni coordonnées', () => {
        // Point quasi sur le strip sans OACI : le plus proche doit rester LFRV.
        assert.equal(getNearestAirport(47.35, -2.85, BASE).icao, 'LFRV');
    });

    test('renvoie icao, name et la distance en km arrondie', () => {
        const r = getNearestAirport(47.3, -2.9, BASE);
        assert.equal(r.name, 'Vannes-Meucon');
        assert.ok(Number.isFinite(r.km) && r.km > 0 && r.km < 100, `km ${r?.km}`);
    });

    test('entrées invalides, liste vide ou absente, coordonnées invalides → null', () => {
        assert.equal(getNearestAirport(NaN, -2.9, BASE), null);
        assert.equal(getNearestAirport(47.3, -2.9, []), null);
        assert.equal(getNearestAirport(47.3, -2.9), null);
        assert.equal(getNearestAirport(47.3, -2.9, [{ icao: 'LFRV', name: 'sans coords' }]), null);
    });
});
