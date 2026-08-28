/* ================================================================
 * TESTS UNITAIRES — champ Waypoints en noms réels (flight-planner-ui)
 * Le champ affiche les VRAIS noms des repères libres (VOR/NDB/points
 * VFR, pseudo-codes ZZxx techniques) : parse inverse via le résolveur
 * injecté par regional-map (registre des repères posés sur la carte).
 * Exécution : node --test test/waypoints-field.test.mjs
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseWaypointsField, formatWaypointsField, registerFreeWpResolver } from '../js/flight-planner-ui.js';

// Registre factice façon regional-map : affichage / nom complet → code.
const fakeRegistry = new Map([
    ['ZZAA', { name: 'BNE (VOR)' }],
    ['ZZAB', { name: 'LOR (NDB)' }],
    ['ZZAC', { name: '4851N 00221W' }],
]);
registerFreeWpResolver((token) => {
    const t = String(token || '').trim().toUpperCase();
    for (const [code, wp] of fakeRegistry) {
        const first = String(wp.name).split(/\s+/)[0].replace(/[^\w-]/g, '').toUpperCase();
        if (first === t || String(wp.name).trim().toUpperCase() === t) return code;
    }
    return null;
});

describe('parseWaypointsField — noms affichés → codes', () => {
    test('codes OACI 4 caractères passent tels quels', () => {
        assert.deepEqual(parseWaypointsField('lfrz LFer'), ['LFRZ', 'LFER']);
    });

    test('noms de repères résolus en codes ZZxx', () => {
        assert.deepEqual(parseWaypointsField('LFRZ BNE LOR'), ['LFRZ', 'ZZAA', 'ZZAB']);
    });

    test('nom complet d\'un repère résolu aussi', () => {
        assert.deepEqual(parseWaypointsField('lor (ndb)'), ['ZZAB']);
    });

    test('tokens inconnus écartés, doublons dédupliqués', () => {
        assert.deepEqual(parseWaypointsField('LFRZ XYZ PARIS LFRZ bne'), ['LFRZ', 'ZZAA']);
    });

    test('valeur vide → liste vide', () => {
        assert.deepEqual(parseWaypointsField('   '), []);
    });

    test('codes à chiffres (CNU8) acceptés — convention OACI alphanumérique', () => {
        assert.deepEqual(parseWaypointsField('CNU8'), ['CNU8']);
    });
});

describe('formatWaypointsField — codes → valeur affichée', () => {
    test('codes OACI inchangés, ZZxx sans base locale → code (repli)', () => {
        // Sans base airports chargée (Node), _wpDisplayName rejette le code :
        // le repli DOIT être le code technique, jamais un undefined.
        const v = formatWaypointsField(['LFRZ', 'ZZAA']);
        assert.equal(v, 'LFRZ ZZAA');
        assert.ok(!v.includes('undefined'));
    });

    test('liste vide → chaîne vide', () => {
        assert.equal(formatWaypointsField([]), '');
        assert.equal(formatWaypointsField(null), '');
    });
});
