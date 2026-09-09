// DATA-AGE — badge d'âge de la dernière observation (demande pilote 09/09).
// Fonctions pures : calcul d'âge, seuils de fraîcheur, machine à états
// (une observation récente reste affichée comme « dernière connue » quand
// le réseau tombe — jamais de valeur périmée présentée comme courante).
import test from 'node:test';
import assert from 'node:assert/strict';
import { metarAgeMin, ageLevel, nextAgeState, AGE_THRESHOLDS } from '../js/data-age.js';

const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);   // 09/09/2026 12:00 UTC

test('metarAgeMin : minutes écoulées, jamais négatif', () => {
    assert.equal(metarAgeMin(NOW - 5 * 60000, NOW), 5);
    assert.equal(metarAgeMin(NOW - 90 * 60000, NOW), 90);
    assert.equal(metarAgeMin(NOW + 3 * 60000, NOW), 0, 'horloge en avance → 0');
    assert.equal(metarAgeMin(NaN, NOW), null);
    assert.equal(metarAgeMin(null, NOW), null);
});

test('ageLevel : seuils METAR (cycle horaire + SPECI)', () => {
    assert.equal(ageLevel(0), 'fresh');
    assert.equal(ageLevel(55), 'fresh');
    assert.equal(ageLevel(56), 'aging', 'au-delà d un cycle complet sans renouvellement');
    assert.equal(ageLevel(115), 'aging');
    assert.equal(ageLevel(116), 'old', 'près de deux cycles : périmé pour un briefing');
    assert.equal(ageLevel(24 * 60), 'old');
    assert.equal(ageLevel(null), null);
});

test('nextAgeState : échec réseau = on garde la dernière observation', () => {
    const loaded = nextAgeState(null, { obsTimeMs: NOW - 10 * 60000 });
    assert.equal(loaded.offline, false);
    const offline = nextAgeState(loaded, { offline: true });
    assert.deepEqual(offline, { obsTimeMs: NOW - 10 * 60000, offline: true },
        'l observation précédente est conservée, marquée offline');
    const recovered = nextAgeState(offline, { obsTimeMs: NOW - 60000 });
    assert.deepEqual(recovered, { obsTimeMs: NOW - 60000, offline: false },
        'retour du réseau : nouvelle observation, offline effacé');
});

test('nextAgeState : sans timestamp (TAF sans heure ?) → null propre', () => {
    assert.deepEqual(nextAgeState({ obsTimeMs: 123, offline: true }, {}), { obsTimeMs: null, offline: false });
});

test('seuils cohérents entre eux', () => {
    assert.ok(AGE_THRESHOLDS.freshMin < AGE_THRESHOLDS.agingMin);
});
