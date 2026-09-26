// Tests du calculateur de densité altitude (js/density-altitude.js) —
// formules pures (pressureAltitude / isaTemp / densityAltitude) et
// niveaux d'alerte de evaluateDensityAltitude. getPerformanceData
// dépend de l'état applicatif (dernier METAR parsé) : non testé ici.
// localStorage est stubbé (pattern gps-vols.test.mjs) pour rendre
// déterministe le seuil persisté utilisé par evaluateDensityAltitude.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Stub localStorage (Map en mémoire) — avant tout appel au module.
const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

const { pressureAltitude, isaTemp, densityAltitude, evaluateDensityAltitude, getDaThreshold, setDaThreshold } =
    await import('../js/density-altitude.js');

describe('density-altitude — formules documentées', () => {

    test('pressureAltitude : PA = élévation + 27 × (1013,25 − QNH), pente 27 ft/hPa', () => {
        // QNH standard : aucune correction, PA = élévation.
        // 2000 + 27 × (1013,25 − 1013,25) = 2000 + 0 = 2000 ft
        assert.equal(pressureAltitude(2000, 1013.25), 2000);
        // Dépression de 30 hPa (983,25) : 27 × 30 = 810 ft de plus.
        // 0 + 27 × (1013,25 − 983,25) = 0 + 810 = 810 ft
        assert.equal(pressureAltitude(0, 983.25), 810);
        // Anticyclone +20 hPa (1033,25) : la PA passe SOUS l'élévation.
        // 500 + 27 × (1013,25 − 1033,25) = 500 − 540 = −40 ft
        assert.equal(pressureAltitude(500, 1033.25), -40);
    });

    test('isaTemp : 15 °C au niveau mer, −1,98 °C par 1000 ft', () => {
        // ISA niveau mer = 15 °C.
        assert.equal(isaTemp(0), 15);
        // 15 − 1,98 × 1 = 13,02 °C à 1000 ft
        assert.ok(Math.abs(isaTemp(1000) - 13.02) < 1e-9);
        // 15 − 1,98 × 2 = 11,04 °C à 2000 ft (le commentaire du module
        // arrondit à 11 °C pour l'estimation de tête).
        assert.ok(Math.abs(isaTemp(2000) - 11.04) < 1e-9);
        // 15 − 1,98 × 5 = 5,1 °C à 5000 ft
        assert.ok(Math.abs(isaTemp(5000) - 5.1) < 1e-9);
    });

    test("densityAltitude : exemple du commentaire (2000 ft, QNH 1013, OAT 30 °C)", () => {
        const r = densityAltitude(2000, 1013, 30);
        // PA = 2000 + 27 × (1013,25 − 1013) = 2000 + 6,75 = 2006,75 ft
        assert.equal(r.pa, 2006.75);
        // ISA à 2006,75 ft = 15 − 1,98 × 2,00675 = 15 − 3,973365 = 11,026635 °C
        assert.ok(Math.abs(r.isaT - 11.026635) < 1e-6);
        // DA = 2006,75 + 118,8 × (30 − 11,026635)
        //    = 2006,75 + 118,8 × 18,973365
        //    = 2006,75 + 2254,035762 = 4260,785762 ft
        // (le commentaire du module annonce ≈ 4257 ft en arrondissant
        // PA → 2000 et ISA → 11 : cohérent au calcul exact près.)
        assert.ok(Math.abs(r.da - 4260.785762) < 0.01);
        assert.equal(r.oat, 30);
        // L'avion « se comporte comme à » plus de 4200 ft : bien au-delà
        // du seuil d'alerte par défaut de 3000 ft (couverture croisée
        // avec evaluateDensityAltitude ci-dessous).
        assert.ok(r.da > 3000);
    });

    test('densityAltitude : entrées nulles ou non numériques → null', () => {
        assert.equal(densityAltitude(null, 1013, 20), null);
        assert.equal(densityAltitude(2000, null, 20), null);
        assert.equal(densityAltitude(2000, 1013, null), null);
        assert.equal(densityAltitude(2000, NaN, 20), null);
        assert.equal(densityAltitude(2000, 1013, undefined), null);
        // Chaîne non numérique : isNaN('abc') → true → null.
        assert.equal(densityAltitude(2000, 1013, 'abc'), null);
    });
});

describe('density-altitude — évaluation du risque', () => {

    test('evaluateDensityAltitude : seuils ok / caution / danger (défaut 3000 ft, +1500)', () => {
        // Stockage vide → seuil par défaut 3000 ft (constante du module).
        // Niveaux : < 3000 = ok ; 3000..4499 = caution ; ≥ 4500 = danger.
        assert.equal(evaluateDensityAltitude(2999).level, 'ok');
        assert.equal(evaluateDensityAltitude(3000).level, 'caution', 'borne basse inclusive');
        assert.equal(evaluateDensityAltitude(4499).level, 'caution');
        assert.equal(evaluateDensityAltitude(4500).level, 'danger', '3000 + 1500 = 4500, borne inclusive');
        assert.equal(evaluateDensityAltitude(0).level, 'ok');
    });

    test('evaluateDensityAltitude : message en français avec DA arrondie', () => {
        // DA exacte de l'exemple : 4260,785762 → arrondie 4261 dans le message.
        // 4260,79 < 4500 → niveau « à surveiller ».
        const r = evaluateDensityAltitude(4260.785762);
        assert.equal(r.level, 'caution');
        assert.ok(r.message.includes('4261 ft'), `message: ${r.message}`);
        assert.ok(r.message.includes('surveiller'));
        // Au-dessus de 4500 ft : alerte forte.
        const d = evaluateDensityAltitude(5123.6);
        assert.equal(d.level, 'danger');
        assert.ok(d.message.includes('5124 ft'), 'Math.round(5123,6) = 5124');
        assert.ok(d.message.includes('ÉLEVÉE'));
    });

    test('evaluateDensityAltitude : entrées invalides → null', () => {
        assert.equal(evaluateDensityAltitude(null), null);
        assert.equal(evaluateDensityAltitude(NaN), null);
        assert.equal(evaluateDensityAltitude('abc'), null);
    });

    test('getDaThreshold / setDaThreshold : défaut 3000, persistance, valeur aberrante', () => {
        // Stockage vide → défaut 3000 ft.
        assert.equal(getDaThreshold(), 3000);
        // Persistance via localStorage (stub) : 2500 relu tel quel.
        setDaThreshold(2500);
        assert.equal(getDaThreshold(), 2500);
        // Le seuil personnalisé décale bien les niveaux : 2600 ≥ 2500 → caution.
        assert.equal(evaluateDensityAltitude(2600).level, 'caution');
        // Valeur non numérique stockée → parseInt → NaN → retour au défaut.
        setDaThreshold('pas-un-nombre');
        assert.equal(getDaThreshold(), 3000);
    });
});
