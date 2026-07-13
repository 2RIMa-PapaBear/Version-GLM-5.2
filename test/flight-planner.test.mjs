/* ================================================================
 * TESTS UNITAIRES — Fonctions de calcul pures du flight planner
 * Exécution : node --test test/flight-planner.test.mjs
 *
 * On ne teste QUE les fonctions pures (sans dépendance réseau ni DOM) :
 *   - greatCircleDistanceNm
 *   - trueCourseDeg
 *   - windCorrection
 *   - trueToMagneticHdg
 *   - computeFuel
 *
 * computeFlightPlan() est exclu (dépend d'Open-Meteo + IndexedDB).
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    greatCircleDistanceNm,
    trueCourseDeg,
    windCorrection,
    trueToMagneticHdg,
    computeFuel,
    RESERVES,
} from '../js/flight-planner.js';

describe('greatCircleDistanceNm', () => {
    test('distance Paris → Lyon ≈ 240 NM', () => {
        // LFPG (49.00, 2.55) → LFLL (45.72, 5.93)
        const d = greatCircleDistanceNm(49.00, 2.55, 45.72, 5.93);
        // Valeur réelle ~240 NM (Pythagore à 47°N : 197+139 → 241 NM).
        assert.ok(d > 230 && d < 250, `distance ${d} NM hors plage attendue`);
    });

    test('distance nulle pour mêmes coordonnées', () => {
        assert.equal(greatCircleDistanceNm(45, 5, 45, 5), 0);
    });

    test('symétrie : A→B = B→A', () => {
        const ab = greatCircleDistanceNm(48, 2, 43, 5);
        const ba = greatCircleDistanceNm(43, 5, 48, 2);
        assert.ok(Math.abs(ab - ba) < 0.001);
    });
});

describe('trueCourseDeg', () => {
    test('cap Est pour déplacement vers l\'Est', () => {
        // Paris → Strasbourg : cap globalement vers l'Est (~080°).
        const tc = trueCourseDeg(48.85, 2.35, 48.58, 7.73);
        assert.ok(tc > 70 && tc < 95, `cap ${tc}° hors plage Est`);
    });

    test('cap Nord pour déplacement vers le Nord', () => {
        const tc = trueCourseDeg(45, 5, 48, 5);
        assert.ok(tc > 355 || tc < 5, `cap ${tc}° pas proche du Nord`);
    });

    test('cap Sud pour déplacement vers le Sud', () => {
        const tc = trueCourseDeg(48, 5, 45, 5);
        assert.ok(tc > 175 && tc < 185, `cap ${tc}° pas proche du Sud`);
    });

    test('résultat dans [0, 360[', () => {
        const tc = trueCourseDeg(-45, -120, 60, 170);
        assert.ok(tc >= 0 && tc < 360);
    });
});

describe('windCorrection', () => {
    test('vent nul → pas de dérive, GS = TAS', () => {
        const r = windCorrection(90, 100, null);
        assert.equal(r.wcaDeg, 0);
        assert.equal(r.gsKt, 100);
        assert.equal(r.crosswindKt, 0);
    });

    test('vent plein travers de la gauche → WCA positif (crab à droite)', () => {
        // Route vers l'Est (090°), vent du Nord (360°) à 20 kt, TAS 100.
        // Vent du Nord = vient de la GAUCHE par rapport à un cap Est.
        // Le vent pousse vers le Sud → il faut virer vers le Nord (à gauche,
        // WCA < 0) pour maintenir la route. crosswind < 0 (vent de la gauche).
        const r = windCorrection(90, 100, { dir: 360, speedKt: 20 });
        assert.ok(r.wcaDeg < 0, `WCA ${r.wcaDeg}° devrait être négatif (crab à gauche)`);
        assert.ok(r.crosswindKt < 0, `crosswind ${r.crosswindKt} devrait être négatif (vent de la gauche)`);
        assert.ok(r.gsKt < 100, `GS ${r.gsKt} devrait être < TAS (correction angulaire)`);
    });

    test('vent de face → GS réduit, pas de dérive', () => {
        // Route 090°, vent du 090° (plein face) à 20 kt.
        const r = windCorrection(90, 100, { dir: 90, speedKt: 20 });
        assert.ok(Math.abs(r.wcaDeg) < 0.5, `WCA ${r.wcaDeg}° devrait être ~0`);
        assert.equal(r.headwindKt, 20);
        assert.ok(r.gsKt < 85, `GS ${r.gsKt} devrait être ~80 (TAS*cos0 - HW)`);
    });

    test('vent arrière → GS augmenté', () => {
        // Route 090°, vent du 270° (plein arrière) à 20 kt.
        const r = windCorrection(90, 100, { dir: 270, speedKt: 20 });
        assert.equal(r.headwindKt, -20);  // -20 = vent arrière
        assert.ok(r.gsKt > 115, `GS ${r.gsKt} devrait être ~120`);
    });

    test('TAS ≤ 0 → pas de calcul (sécurité)', () => {
        const r = windCorrection(90, 0, { dir: 0, speedKt: 30 });
        assert.equal(r.gsKt, 0);
        assert.equal(r.wcaDeg, 0);
    });
});

describe('trueToMagneticHdg', () => {
    test('déclinaison 0 → cap identique', () => {
        assert.equal(trueToMagneticHdg(180, 0), 180);
    });

    test('déclinaison Est positive → cap magnétique inférieur', () => {
        // Déclinaison +10°E : Mag = Vrai - 10.
        assert.equal(trueToMagneticHdg(90, 10), 80);
    });

    test('déclinaison Ouest négative → cap magnétique supérieur', () => {
        // Déclinaison -13°W (New York) : Mag = Vrai + 13.
        assert.equal(trueToMagneticHdg(180, -13), 193);
    });

    test('wrap-around 360°→0°', () => {
        // Cap vrai 005°, déclinaison +10°E → Mag = 355°.
        assert.equal(trueToMagneticHdg(5, 10), 355);
    });
});

describe('computeFuel', () => {
    test('calcul simple sans réserve', () => {
        const f = computeFuel(60, 35, 0);
        assert.equal(f.tripFuelL, 35);
        assert.equal(f.reserveL, 0);
        assert.equal(f.totalL, 35);
    });

    test('réserve jour (30 min)', () => {
        // 1h de vol à 35 L/h + 30 min de réserve (17.5 L).
        const f = computeFuel(60, 35, RESERVES.DAY_MIN);
        assert.equal(f.tripFuelL, 35);
        assert.equal(f.reserveL, 17.5);
        assert.equal(f.totalL, 52.5);
    });

    test('réserve nuit (45 min) > réserve jour', () => {
        const f = computeFuel(60, 35, RESERVES.NIGHT_MIN);
        assert.ok(f.reserveL > 17.5);
        assert.equal(f.reserveL, 26.3);  // 45/60 * 35 = 26.25 arrondi à 26.3
    });

    test('vol court arrondi correctement', () => {
        const f = computeFuel(15, 35, 30);
        // Trip : 15/60 * 35 = 8.75 → 8.8
        assert.equal(f.tripFuelL, 8.8);
    });
});
