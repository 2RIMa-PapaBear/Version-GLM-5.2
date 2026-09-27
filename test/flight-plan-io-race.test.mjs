/* ================================================================
 * TESTS UNITAIRES — Course d'initialisation a l'import (fiche 19)
 * Execution : node --test test/flight-plan-io-race.test.mjs
 *
 * Avant le correctif : importer un plan AVANT la premiere ouverture
 * du panneau carte mettait les reperes libres en file d'attente
 * (_pendingFreeWps de regional-map) - leurs codes n'etaient annonces
 * qu'a l'init de la carte, trop tard : buildSeq() + .filter(Boolean)
 * supprimaient les etapes sans prevenir (state.route reduit a
 * depart -> destination) et un GPX/KML a extremite libre voyait son
 * import echouer en silence (_resolveEndpoint -> null).
 *
 * Correctif : le repere est ENREGISTRE immediatement (registre
 * "terrains" + insertion au plan + annonce synchrone
 * 'free-waypoint-created'), seules les couches Leaflet attendent
 * l'init de la carte.
 *
 * Les stubs document/window sont poses AVANT les imports dynamiques :
 * les ecouteurs de niveau module (restore-free-waypoint cote
 * regional-map, free-waypoint-created cote flight-plan-io) ne
 * s'enregistrent que si document existe au chargement du module.
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---- Stubs navigateur : EventTarget natif = vraie distribution d'evenements
const doc = new EventTarget();
doc.getElementById = () => null;   // pas d'UI : _setDeparture/_setDestination no-op
const win = new EventTarget();
globalThis.document = doc;
globalThis.window = win;

const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

// Absorption des timers, a la demande : restorePlan() planifie un poll
// applySettings (1,5 s + 20 x 800 ms) et les IMPORTS ci-dessous declenchent
// du code de niveau module qui s'arme des que window/document existent
// (notam.js, via flight-planner-ui : sondage DOM 500 ms + garde 120 s —
// sans cela le process de test resterait vivant 2 minutes pour rien).
const _realSetTimeout = globalThis.setTimeout;
const _realSetInterval = globalThis.setInterval;
const _sansTimers = (fn) => {
    globalThis.setTimeout = () => 0;
    globalThis.setInterval = () => 0;
    try { return fn(); } finally {
        globalThis.setTimeout = _realSetTimeout;
        globalThis.setInterval = _realSetInterval;
    }
};

// Ordre d'import = ordre navigateur (app.js atteint regional-map AVANT
// flight-planner-ui) : le graphe est cyclique (flight-planner-ui ->
// frequencies-ui -> flight-mode -> regional-map -> flight-planner-ui)
// et partir de flight-plan-io evalue regional-map pendant la phase
// d'imports de flight-planner-ui -> TDZ sur _resolveFreeWpToken.
// NB : les imports dynamiques s'evaluent au 1er await interne — les
// timers neutralises le restent jusque la, puis sont restaures.
let restorePlan;
globalThis.setTimeout = () => 0;
globalThis.setInterval = () => 0;
try {
    await import('../js/regional-map.js');
    ({ restorePlan } = await import('../js/flight-plan-io.js'));
} finally {
    globalThis.setTimeout = _realSetTimeout;
    globalThis.setInterval = _realSetInterval;
}
const { state } = await import('../js/core.js');
const { getAirportByICAO } = await import('../js/ui-module.js');

// Aucune carte n'existera dans ces tests : Leaflet n'est pas charge, la
// variable _map de regional-map reste null TOUT le long - situation
// EXACTE de l'import avant premiere ouverture du panneau carte. Si le
// decouplage enregistrement/couches etait rompu, _createFreeWaypoint
// appellerait L.circleMarker sur L indefini et ces tests planteraient.

describe('Import de plan avant initialisation de la carte (fiche 19)', () => {

    test('restorePlan : les etapes libres entrent dans state.route (ordre du fichier)', () => {
        const plan = {
            app: 'metar-taf-visualiseur', version: 1,
            dep: 'ABCD', dest: 'EFGH',
            wps: [{ name: 'Repere un', lat: 47.6, lon: -3.1 }, { name: 'Balise', lat: 48.1, lon: -2.2 }],
        };
        let ok = false;
        _sansTimers(() => { ok = restorePlan(plan, null); });
        assert.equal(ok, true, "l'import doit reussir");
        assert.deepEqual(state.route, ['ABCD', 'REPERE', 'BALISE', 'EFGH'],
            'route complete : les reperes libres ne sont plus filtres en silence');
    });

    test('les reperes sont enregistres au registre (coordonnees fideles au fichier)', () => {
        const r1 = getAirportByICAO('REPERE');
        assert.ok(r1, 'REPERE resout via le registre enrichi');
        assert.equal(r1.freeWp, true);
        assert.equal(r1.lat, 47.6);
        assert.equal(r1.lon, -3.1);
        assert.equal(r1.name, 'Repere un');
        const r2 = getAirportByICAO('BALISE');
        assert.ok(r2, 'BALISE resout aussi');
        assert.equal(r2.lat, 48.1);
    });

    test("restorePlan(points) : extremites libres de GPX/KML resolues (plus d'echec silencieux)", () => {
        const pts = [
            { lat: 47.0, lon: -3.0, name: 'Depart libre' },
            { lat: 48.0, lon: -2.0, name: 'Arrivee libre' },
        ];
        let ok = false;
        _sansTimers(() => { ok = restorePlan(pts); });
        assert.equal(ok, true, 'avant correctif : _resolveEndpoint renvoyait null, import refuse sans prevenir');
        assert.deepEqual(state.route, ['DEPART', 'ARRIVEE'],
            'les extremites libres portent leur slug, meme sans carte');
    });
});
