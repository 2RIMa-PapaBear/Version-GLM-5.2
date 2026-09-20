// Tests du démarrage géolocalisé : station la plus proche d'un point
// (js/core.js — pur ; la liste est fournie par l'appelant).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getNearestAirport } from '../js/core.js';

const BASE = [
    { icao: 'LFRV', name: 'Vannes-Meucon', lat: 47.7199, lon: -2.7497, longestRunway: 1285 },
    { icao: 'LFRN', name: 'Rennes', lat: 48.07, lon: -1.7343, longestRunway: 2100 },
    { icao: 'LFPO', name: 'Orly', lat: 48.7233, lon: 2.3794, longestRunway: 3650 },
    // Pièges : un strip SANS code OACI (plus proche de tout), une entrée
    // sans coordonnées et un terrain ULM à piste courte — les trois doivent
    // être ignorés (le dernier seulement quand minRunwayM est actif).
    { icao: '', name: 'strip sans OACI', lat: 47.35, lon: -2.85 },
    { icao: 'LFXX', name: 'sans coordonnées' },
    { icao: 'LFEZ', name: 'ULM à piste courte', lat: 47.35, lon: -2.85, longestRunway: 600 },
];

describe('getNearestAirport (démarrage géolocalisé)', () => {
    test('renvoie le terrain OACI le plus proche', () => {
        assert.equal(getNearestAirport(47.3, -2.9, BASE).icao, 'LFEZ');
        assert.equal(getNearestAirport(48.05, -1.7, BASE).icao, 'LFRN');
        assert.equal(getNearestAirport(48.7, 2.4, BASE).icao, 'LFPO');
    });

    test('minRunwayM 1000 : piste courte écartée, LFRV redevient le plus proche', () => {
        assert.equal(getNearestAirport(47.3, -2.9, BASE, 1000).icao, 'LFRV');
        assert.equal(getNearestAirport(47.3, -2.9, BASE, 1000).km <= 100, true);
    });

    test('sans minRunwayM (0 par défaut) : aucun filtre de piste', () => {
        assert.equal(getNearestAirport(47.3, -2.9, BASE, 0).icao, 'LFEZ');
    });

    test('minRunwayM 1000 sans candidat qualifié → null (pas de repli caché)', () => {
        const petitesPistes = BASE.filter(a => !['LFPO', 'LFRN', 'LFRV'].includes(a.icao));
        assert.equal(getNearestAirport(47.3, -2.9, petitesPistes, 1000), null);
    });

    test('ignore les entrées sans OACI exploitable ni coordonnées', () => {
        // Point quasi sur le strip sans OACI : le plus proche doit rester LFEZ.
        assert.equal(getNearestAirport(47.35, -2.85, BASE).icao, 'LFEZ');
    });

    test('renvoie icao, name et la distance en km arrondie', () => {
        const r = getNearestAirport(47.3, -2.9, BASE);
        assert.equal(r.name, 'ULM à piste courte');
        assert.ok(Number.isFinite(r.km) && r.km > 0 && r.km < 100, `km ${r?.km}`);
    });

    test('entrées invalides, liste vide ou absente, coordonnées invalides → null', () => {
        assert.equal(getNearestAirport(NaN, -2.9, BASE), null);
        assert.equal(getNearestAirport(47.3, -2.9, []), null);
        assert.equal(getNearestAirport(47.3, -2.9), null);
        assert.equal(getNearestAirport(47.3, -2.9, [{ icao: 'LFRV', name: 'sans coords' }]), null);
    });
});
