// DATA-AGE — badge d'âge de la dernière observation (demande pilote 09/09).
// Fonctions pures : calcul d'âge, seuils de fraîcheur, machine à états
// (une observation récente reste affichée comme « dernière connue » quand
// le réseau tombe — jamais de valeur périmée présentée comme courante).
import test from 'node:test';
import assert from 'node:assert/strict';
import { metarAgeMin, ageLevel, nextAgeState, AGE_THRESHOLDS, thresholdsFor, fmtAge } from '../js/data-age.js';

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
    assert.deepEqual(offline, { obsTimeMs: NOW - 10 * 60000, offline: true, type: 'metar' },
        'l observation précédente est conservée, marquée offline');
    const recovered = nextAgeState(offline, { obsTimeMs: NOW - 60000 });
    assert.deepEqual(recovered, { obsTimeMs: NOW - 60000, offline: false, type: 'metar' },
        'retour du réseau : nouvelle observation, offline effacé');
});

test('nextAgeState : sans timestamp (TAF sans heure ?) → null propre', () => {
    assert.deepEqual(nextAgeState({ obsTimeMs: 123, offline: true, type: 'taf' }, {}), { obsTimeMs: null, offline: false, type: 'metar' });
});

test('seuils cohérents entre eux, pour chaque type', () => {
    for (const [type, th] of Object.entries(AGE_THRESHOLDS)) {
        assert.ok(th.freshMin < th.agingMin, type);
    }
    assert.ok(AGE_THRESHOLDS.taf.freshMin > AGE_THRESHOLDS.metar.agingMin,
        'le TAF vit plus longtemps que le METAR (cycle 6 h vs 1 h)');
    assert.deepEqual(thresholdsFor('inconnu'), AGE_THRESHOLDS.metar);
});


// ---- Type TAF (retour pilote 10/09 : cycle d'émission ~6 h, pas horaire) ----
test('ageLevel : seuils TAF adaptés au cycle d emission (~6 h)', () => {
    assert.equal(ageLevel(300, 'taf'), 'fresh', '5 h = TAF parfaitement normal');
    assert.equal(ageLevel(389, 'taf'), 'fresh');
    assert.equal(ageLevel(390, 'taf'), 'aging', 'au-delà de 6 h 30 : cycle routine manqué');
    assert.equal(ageLevel(700, 'taf'), 'aging');
    assert.equal(ageLevel(720, 'taf'), 'old', '12 h sans émission : périmé');
});

test('ageLevel : METAR inchangé par défaut, TAF ≠ METAR à âge égal', () => {
    assert.equal(ageLevel(90), 'aging');            // metar par défaut
    assert.equal(ageLevel(90, 'metar'), 'aging');
    assert.equal(ageLevel(90, 'taf'), 'fresh', 'un TAF de 1 h 30 est frais');
    assert.equal(ageLevel(400, 'inconnu'), 'old', 'type inconnu → seuils metar');
});

test('fmtAge : minutes puis heures', () => {
    assert.equal(fmtAge(45), '45 min');
    assert.equal(fmtAge(60), '1 h');
    assert.equal(fmtAge(95), '1 h 35');
    assert.equal(fmtAge(390), '6 h 30');
    assert.equal(fmtAge(NaN), '—');
});

test('nextAgeState : le type est porté et survit à une panne réseau', () => {
    const taf = nextAgeState(null, { obsTimeMs: 1000, type: 'taf' });
    assert.equal(taf.type, 'taf');
    const offline = nextAgeState(taf, { offline: true });
    assert.equal(offline.type, 'taf', 'panne : on reste sur le libellé TAF');
    const metar = nextAgeState(offline, { obsTimeMs: 2000, type: 'metar' });
    assert.equal(metar.type, 'metar');
});
