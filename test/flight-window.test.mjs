/* ================================================================
 * TESTS UNITAIRES — Fenêtre de vol jour = crépuscules civils (M6)
 * Exécution : node --test test/flight-window.test.mjs
 *
 * Avant le correctif : computeFlightWindow posait aeroStart/aeroEnd à
 * lever −30 min / coucher +30 min (« heures aéronautiques »), jamais
 * les crépuscules civils −6° de FCL.010 / SERA.2010 — écart jusqu'à
 * ~4 min aux équinoxes, dans les DEUX sens, dont des minutes de
 * « fenêtre ouverte » affichées alors que la nuit réglementaire avait
 * commencé (audit 27/09, M6 ; la matrice de conformité la croyait
 * conforme).
 *
 * SunCalc est STUBBÉ : dates fixes au solstice d'été, zéro dépendance
 * à la vraie astronomie ni au réseau. Les stubs document/window sont
 * posés AVANT l'import dynamique (motif du test de course fiche 19) :
 * la chaîne ui-module s'évalue mal sans navigateur.
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

const doc = new EventTarget();
doc.getElementById = () => null;
globalThis.document = doc;
globalThis.window = new EventTarget();
const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

// Absorption des timers pendant l'import dynamique (des modules de la
// chaîne ui-module s'arment au niveau module dès que window existe).
const _realSetTimeout = globalThis.setTimeout;
const _realSetInterval = globalThis.setInterval;
let computeFlightWindow;
globalThis.setTimeout = () => 0;
globalThis.setInterval = () => 0;
try {
    ({ computeFlightWindow } = await import('../js/flight-window.js'));
} finally {
    globalThis.setTimeout = _realSetTimeout;
    globalThis.setInterval = _realSetInterval;
}

// Solstice d'été à 47°N : crépuscule civil ≈ 46 min — le cas où
// l'ancien ±30 min se trompait le plus (il coupait la fin de journée).
const T = (h, m) => new Date(Date.UTC(2026, 5, 21, h, m, 0));
const TIMES = { dawn: T(3, 14), sunrise: T(4, 0), sunset: T(21, 30), dusk: T(22, 16) };
globalThis.SunCalc = { getTimes: () => ({ ...TIMES }) };

describe('computeFlightWindow — crépuscules civils (M6, audit 27/09)', () => {
    test('aeroStart/aeroEnd = aube et fin de crépuscule civils, PAS lever/coucher ±30 min', () => {
        const w = computeFlightWindow(47.2, -1.6, T(12, 0));
        assert.equal(w.aeroStart.getTime(), TIMES.dawn.getTime());
        assert.equal(w.aeroEnd.getTime(), TIMES.dusk.getTime());
        assert.equal(w.civil, true);
        // L'ANCIEN code posait 03:30 / 22:00 — faux de ±16 min au solstice.
        assert.notEqual(w.aeroStart.getTime(), T(3, 30).getTime());
        assert.notEqual(w.aeroEnd.getTime(), T(22, 0).getTime());
    });

    test('statuts : before avant l\'aube, open dans la fenêtre, night après le crépuscule', () => {
        const before = computeFlightWindow(47.2, -1.6, T(2, 0));
        assert.equal(before.status, 'before');
        assert.equal(before.minutesLeft, Math.round((TIMES.dawn - T(2, 0)) / 60000));
        const open = computeFlightWindow(47.2, -1.6, T(12, 0));
        assert.equal(open.status, 'open');
        assert.equal(open.minutesLeft, Math.round((TIMES.dusk - T(12, 0)) / 60000));
        assert.equal(computeFlightWindow(47.2, -1.6, T(23, 0)).status, 'night');
    });

    test('« closing » dans la dernière demi-heure de jour civil', () => {
        assert.equal(computeFlightWindow(47.2, -1.6, T(21, 59)).status, 'closing');
        assert.equal(computeFlightWindow(47.2, -1.6, T(21, 30)).status, 'open');
    });

    test('repli « heures aéro » ±30 min si dawn/dusk indisponibles (haute latitude)', () => {
        globalThis.SunCalc = { getTimes: () => ({ ...TIMES, dawn: new Date('invalide'), dusk: new Date('invalide') }) };
        const w = computeFlightWindow(70, 20, T(12, 0));
        assert.equal(w.aeroStart.getTime(), T(3, 30).getTime());
        assert.equal(w.aeroEnd.getTime(), T(22, 0).getTime());
        assert.equal(w.civil, false);
    });

    test('SunCalc absent ou coordonnées nulles → null', () => {
        const had = globalThis.SunCalc;
        delete globalThis.SunCalc;
        assert.equal(computeFlightWindow(47.2, -1.6, T(12, 0)), null);
        globalThis.SunCalc = had;
        assert.equal(computeFlightWindow(null, null, T(12, 0)), null);
    });
});
