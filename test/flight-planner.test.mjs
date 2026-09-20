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
    computeDiversionLeg,
    cheapestWaypointInsertion,
    RESERVES,
    TAXI_MIN_DEP, TAXI_MIN_ARR, INTEGRATION_MIN,
    computeLeg2Fuel,
    withUnusableFuel,
    _fallbackProfile,
} from '../js/flight-planner.js';

describe('withUnusableFuel (inutilisable du manuel de vol — 19/09, navigations)', () => {
    test('0 ou absent : total inchangé, unusableL 0', () => {
        const f0 = withUnusableFuel({ tripFuelL: 18, reserveL: 4.5, groundL: 3, totalL: 25.5 }, 0);
        assert.equal(f0.totalL, 25.5);
        assert.equal(f0.unusableL, 0);
        const fU = withUnusableFuel({ tripFuelL: 18, reserveL: 4.5, groundL: 3, totalL: 25.5 }, undefined);
        assert.equal(fU.totalL, 25.5);
        assert.equal(fU.unusableL, 0);
    });

    test('6 L : total +6 (pilote : 1 h à 18 L/h → 18 + 3 + 4,5 + 6 = 31,5 L)', () => {
        const f = withUnusableFuel(computeFuel(60, 18, 15, 10), 6);
        assert.equal(f.tripFuelL, 18);
        assert.equal(f.groundL, 3);
        assert.equal(f.reserveL, 4.5);
        assert.equal(f.unusableL, 6);
        assert.equal(f.totalL, 31.5);
    });

    test('compose après la branche dégagement (total déjà majoré : 30,4 + 6 = 36,4)', () => {
        const f = withUnusableFuel({ totalL: 30.4, diversionL: 5 }, 6);
        assert.equal(f.totalL, 36.4);
        assert.equal(f.diversionL, 5);
    });
});

describe('computeDiversionLeg (branche dégagement du devis carburant)', () => {
    test('distance / temps / carburant depuis la destination (0,5° lat ≈ 30 NM)', () => {
        const d = computeDiversionLeg(47.0, -3.0, 47.5, -3.0, 30, 100);
        assert.equal(d.distNm, 30);   // 0,5° × 60 NM
        assert.equal(d.timeMin, 23);  // 30 NM / 100 kt × 60 + 5 min d'intégration
        assert.equal(d.fuelL, 11.5);  // 23 min / 60 × 30 L/h
    });

    test('sans GS ni conso → distance seule ; coordonnées invalides → null', () => {
        const d = computeDiversionLeg(47, -3, 47.5, -3, 0, 0);
        assert.equal(d.distNm, 30);
        assert.equal(d.timeMin, null);
        assert.equal(d.fuelL, null);
        assert.equal(computeDiversionLeg(null, -3, 47.5, -3, 30, 100), null);
    });
});

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

describe('cheapestWaypointInsertion', () => {
    // Axe nord-sud : départ (0,0), destination (0,10) — distances en degrés.
    const coords = {
        DEP:  { lat: 0, lon: 0 },
        DEST: { lat: 0, lon: 10 },
        MID:  { lat: 0, lon: 5 },    // à mi-route
        NEAR: { lat: 0, lon: 2.5 },  // premier quart de route
        FAR:  { lat: 0, lon: 7.5 },  // dernier quart de route
        OFF:  { lat: 1, lon: 5 },    // hors axe, au milieu
    };
    const coordsOf = (code) => coords[code] || null;

    test('liste vide → seule position possible (0)', () => {
        assert.equal(cheapestWaypointInsertion('DEP', [], 'DEST', 'MID', coordsOf), 0);
    });

    test('étape intermédiaire insérée AVANT l\'étape lointaine', () => {
        // Route DEP → MID → DEST existante : NEAR (premier quart) doit se
        // glisser AVANT MID, pas s'empiler à la fin.
        const idx = cheapestWaypointInsertion('DEP', ['MID'], 'DEST', 'NEAR', coordsOf);
        assert.equal(idx, 0);
    });

    test('étape du dernier tronçon insérée APRÈS l\'étape existante', () => {
        // FAR (dernier quart) doit passer après MID.
        const idx = cheapestWaypointInsertion('DEP', ['MID'], 'DEST', 'FAR', coordsOf);
        assert.equal(idx, 1);
    });

    test('insertion au meilleur endroit parmi plusieurs étapes', () => {
        // Chaîne DEP → MID → DEST : OFF (hors axe mais au milieu) doit
        // s'insérer de part et d'autre de MID selon le trajet le plus court —
        // ici équidistant de MID vers l'avant ou l'arrière, le meilleur slot
        // reste déterminé par la distance totale minimale.
        const idx = cheapestWaypointInsertion('DEP', ['MID'], 'DEST', 'OFF', coordsOf);
        assert.ok(idx === 0 || idx === 1, `index inattendu : ${idx}`);
        // Vérifie par le calcul que l'index retenu est bien le plus court.
        const len = (codes) => {
            const pts = codes.map(c => coords[c]);
            let s = 0;
            for (let i = 0; i < pts.length - 1; i++) {
                s += greatCircleDistanceNm(pts[i].lat, pts[i].lon, pts[i + 1].lat, pts[i + 1].lon);
            }
            return s;
        };
        const withAt0 = len(['DEP', 'OFF', 'MID', 'DEST']);
        const withAt1 = len(['DEP', 'MID', 'OFF', 'DEST']);
        const best = withAt0 <= withAt1 ? 0 : 1;
        assert.equal(idx, best);
    });

    test('coordonnées manquantes → null (fallback ajout en fin)', () => {
        assert.equal(cheapestWaypointInsertion('DEP', ['MID'], 'DEST', 'XXX', coordsOf), null);
        assert.equal(cheapestWaypointInsertion('DEP', ['MID'], 'DEST', 'MID', () => null), null);
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

    // Forfaits au sol (roulage ×2 + intégration) — chantier devis détaillé 17/09.
    test('forfaits au sol : groundMin/groundL ajoutés au total', () => {
        const f = computeFuel(60, 18, 30, TAXI_MIN_DEP + TAXI_MIN_ARR + INTEGRATION_MIN);
        assert.equal(f.groundMin, 15);
        assert.equal(f.groundL, 4.5);        // 15/60 × 18
        assert.equal(f.tripFuelL, 18);
        assert.equal(f.reserveL, 9);
        assert.equal(f.totalL, 31.5);        // 18 + 4.5 + 9
    });

    test('sans forfaits (jambes du plan) : groundL nul, total inchangé', () => {
        const f = computeFuel(60, 35, 30);
        assert.equal(f.groundMin, 0);
        assert.equal(f.groundL, 0);
        assert.equal(f.totalL, 52.5);
    });

    test('constantes forfaits : 5 + 5 + 5 minutes', () => {
        assert.equal(TAXI_MIN_DEP, 5);
        assert.equal(TAXI_MIN_ARR, 5);
        assert.equal(INTEGRATION_MIN, 5);
    });
});

describe('computeLeg2Fuel (projet deux étapes sans plein)', () => {
    test('étape 2 navigation : nav sans vent au TAS + forfaits + réserve', () => {
        const l = computeLeg2Fuel({ distNm: 50, tasKt: 100, fuelBurnLph: 18, reserveMin: 35 });
        assert.equal(l.isLocal, false);
        assert.equal(l.navTimeMin, 30);      // 50 NM / 100 kt
        assert.equal(l.navL, 9);             // 30/60 × 18
        assert.equal(l.groundMin, 15);
        assert.equal(l.groundL, 4.5);
        assert.equal(l.reserveL, 10.5);      // 35/60 × 18
        assert.equal(l.totalL, 24);          // 9 + 4.5 + 10.5
    });

    test('étape 2 LOCALE : durée saisie + réserve 10 min', () => {
        const l = computeLeg2Fuel({ localMin: 30, tasKt: 100, fuelBurnLph: 18, reserveMin: 10 });
        assert.equal(l.isLocal, true);
        assert.equal(l.navTimeMin, 30);
        assert.equal(l.reserveL, 3);
        assert.equal(l.totalL, 16.5);        // 9 + 4.5 + 3
    });

    test('paramètres inutilisables → null', () => {
        assert.equal(computeLeg2Fuel({ distNm: 50, tasKt: 0, fuelBurnLph: 18, reserveMin: 30 }), null);
        assert.equal(computeLeg2Fuel({ tasKt: 100, fuelBurnLph: 18, reserveMin: 30 }), null);   // ni distance ni durée
        assert.equal(computeLeg2Fuel({ distNm: 0, localMin: 0, tasKt: 100, fuelBurnLph: 18, reserveMin: 30 }), null);
    });
});

// (20/09, retour pilote) Profil de REPLI « sans relief » : service
// d'élévation saturé (HTTP 429 Open-Meteo) → le profil reste affiché,
// interpolé entre les élévations officielles des terrains, drapeau
// noTerrain pour le bandeau de panne écran + PDF.
describe('_fallbackProfile (repli sans relief, 20/09)', () => {
    test('interpolation extrémités + étapes : points réguliers, lat/lon suivis, drapeau', () => {
        const pr = _fallbackProfile([
            { lat: 47.60, lon: -3.10, elevFt: 150 },
            { lat: 48.60, lon: -1.00, elevFt: 250 },
        ]);
        assert.equal(pr.noTerrain, true, 'drapeau posé');
        assert.ok(pr.points.length >= 8, `points réguliers (${pr.points.length})`);
        assert.ok(pr.points[0].frac === 0 && pr.points.at(-1).frac === 1, 'frac 0 → 1');
        assert.equal(pr.points[0].elevFt, 150);
        assert.equal(pr.points.at(-1).elevFt, 250);
        assert.ok(pr.points.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)),
            'lat/lon présents (zones aériennes calculables)');
        assert.equal(pr.minFt, 150); assert.equal(pr.maxFt, 250);
        assert.ok(pr.distTotalKm > 180 && pr.distTotalKm < 220, `distance LFRV→LFOO plausible (${pr.distTotalKm} km)`);
    });

    test('3 terrains (multi-étapes) : l’étape intermédiaire est un point du profil', () => {
        const pr = _fallbackProfile([
            { lat: 47.6, lon: -3.1, elevFt: 100 },
            { lat: 48.1, lon: -2.0, elevFt: 400 },
            { lat: 48.6, lon: -1.0, elevFt: 200 },
        ]);
        assert.equal(pr.maxFt, 400);
        const mid = pr.points.find(p => Math.abs(p.elevFt - 400) < 1 && p.frac > 0.2 && p.frac < 0.8);
        assert.ok(mid, 'sommet = l’étape intermédiaire');
    });
});
