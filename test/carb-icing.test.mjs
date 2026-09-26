// Tests du givrage carburateur (js/carb-icing.js) — digitisation de
// l'abaque T° extérieure / point de rosée. Module pur sans import :
// bornes EXACTES des zones sévère / descente / léger / nul telles
// qu'implémentées dans evaluateCarbIcing.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { CARB_DROP_MIN_C, CARB_DROP_MAX_C, estimateCarbTempC, evaluateCarbIcing } from '../js/carb-icing.js';

describe('carb-icing — température carburateur estimée', () => {

    test('estimateCarbTempC : OAT − [20 ; 35] °C (chute vaporisation + détente)', () => {
        // Constantes documentées : chute min 20 °C, max 35 °C.
        assert.equal(CARB_DROP_MIN_C, 20);
        assert.equal(CARB_DROP_MAX_C, 35);
        // OAT 10 °C → T° carbu entre 10 − 35 = −25 et 10 − 20 = −10 °C.
        assert.deepEqual(estimateCarbTempC(10), { min: -25, max: -10 });
        // OAT 0 °C → [−35 ; −20] : le maximum de risque (≈ −5) est couvert.
        assert.deepEqual(estimateCarbTempC(0), { min: -35, max: -20 });
        // OAT 30 °C → [−5 ; 10] : la descente peut encore givrer en été.
        assert.deepEqual(estimateCarbTempC(30), { min: -5, max: 10 });
    });

    test('estimateCarbTempC : entrées non numériques → null', () => {
        assert.equal(estimateCarbTempC('10'), null);
        assert.equal(estimateCarbTempC(NaN), null);
        assert.equal(estimateCarbTempC(null), null);
        assert.equal(estimateCarbTempC(undefined), null);
    });
});

describe('carb-icing — zones de l\'abaque (T, écart S = T − Td)', () => {

    test('zone SÉVÈRE À TOUTES PUISSANCES : bornes exactes des trois branches', () => {
        // Branche air froid et humide : T ∈ [−15 ; 0], S ≤ 8.
        // T = −15 (borne inclusive), Td = −23 → S = 8 (borne inclusive).
        assert.equal(evaluateCarbIcing(-15, -23).level, 'serious');
        // T = 0 (borne inclusive), S = 8 : encore sévère.
        assert.equal(evaluateCarbIcing(0, -8).level, 'serious');
        // Branche air très humide : 0 < T ≤ 5, S ≤ 5.
        // T = 5 (borne), Td = 0 → S = 5 (borne).
        assert.equal(evaluateCarbIcing(5, 0).level, 'serious');
        // Branche quasi saturé : 0 < T ≤ 12, S ≤ 3.
        // T = 12 (borne), Td = 9 → S = 3 (borne).
        assert.equal(evaluateCarbIcing(12, 9).level, 'serious');
    });

    test('zone SÉVÈRE EN DESCENTE : bornes exactes (T ≤ 20, S ≤ 12 ; T ≤ 25, S ≤ 4)', () => {
        // Air doux et humide : T = 10, Td = 0 → S = 10 ≤ 12 → sévère en descente.
        assert.equal(evaluateCarbIcing(10, 0).level, 'descent');
        // Bornes hautes inclusives : T = 20, Td = 8 → S = 12 exactement.
        assert.equal(evaluateCarbIcing(20, 8).level, 'descent');
        // Quasi saturé chaud : T = 25 (borne), Td = 21 → S = 4 (borne).
        assert.equal(evaluateCarbIcing(25, 21).level, 'descent');
        // Transition documentée : T = 0 avec S = 8,1 sort du sévère
        // (S > 8) mais retombe en descente (S ≤ 12).
        assert.equal(evaluateCarbIcing(0, -8.1).level, 'descent');
    });

    test('zone LÉGER / À SURVEILLER : marge autour des zones sévères', () => {
        // T = −15, Td = −23,5 → S = 8,5 : trop espread pour le sévère,
        // mais S ≤ 15 avec T ≤ 15 → léger.
        assert.equal(evaluateCarbIcing(-15, -23.5).level, 'light');
        // Air chaud peu couvert : T = 28, Td = 24 → S = 4 ≤ 10 → léger
        // (au-delà des branches descente T ≤ 20 / T ≤ 25).
        assert.equal(evaluateCarbIcing(28, 24).level, 'light');
        // Borne haute inclusive de la marge : T = 30, S = 10 → léger.
        assert.equal(evaluateCarbIcing(30, 20).level, 'light');
    });

    test('zone FAIBLE OU NUL : air très froid, air sec ou très chaud', () => {
        // T < −15 : air trop sec, givrage carbu improbable (commentaire du module).
        // T = −16, Td = −16 → S = 0 pourtant saturé → nul.
        assert.equal(evaluateCarbIcing(-16, -16).level, 'none');
        // Air sec : T = 10, Td = −10 → S = 20 > 15 → nul.
        assert.equal(evaluateCarbIcing(10, -10).level, 'none');
        // Très chaud : T = 31 (au-delà de la borne 30), S = 0 → nul.
        assert.equal(evaluateCarbIcing(31, 31).level, 'none');
    });

    test('structure du résultat : spread arrondi au 1/10, bornes T° carbu', () => {
        // T = 10, Td = 7,25 → S = 2,75 ; Math.round(27,5) = 28 → spread 2,8.
        const r = evaluateCarbIcing(10, 7.25);
        assert.equal(r.level, 'serious', 'S = 2,75 ≤ 3 et 0 < 10 ≤ 12');
        assert.equal(r.spread, 2.8);
        assert.equal(r.carbMin, -25, '10 − 35');
        assert.equal(r.carbMax, -10, '10 − 20');
        // Spread entier passé tel quel : T = 10, Td = 0 → S = 10.
        assert.equal(evaluateCarbIcing(10, 0).spread, 10);
    });

    test('entrées invalides → null', () => {
        assert.equal(evaluateCarbIcing(null, 5), null);
        assert.equal(evaluateCarbIcing(10, null), null);
        assert.equal(evaluateCarbIcing(NaN, 5), null);
        assert.equal(evaluateCarbIcing(10, '5'), null);
        assert.equal(evaluateCarbIcing(undefined, undefined), null);
    });
});
