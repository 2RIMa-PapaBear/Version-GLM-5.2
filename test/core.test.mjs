/* ================================================================
 * TESTS UNITAIRES — Fonctions pures de core.js
 * Exécution : node --test test/core.test.mjs
 * (Utilise le runner natif Node.js, aucune dépendance externe.)
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseVisiToMeters,
    getCeiling,
    getFlightCategory,
    getWeatherIcon,
    findActiveValueAtHour
} from '../js/core.js';

describe('parseVisiToMeters', () => {
    test('retourne 10000 pour 9999', () => {
        assert.equal(parseVisiToMeters('9999'), 10000);
    });

    test('retourne 10000 pour CAVOK', () => {
        assert.equal(parseVisiToMeters('CAVOK'), 10000);
    });

    test('retourne 10000 pour null/vide', () => {
        assert.equal(parseVisiToMeters(''), 10000);
        assert.equal(parseVisiToMeters(null), 10000);
    });

    test('parse les mètres à 4 chiffres', () => {
        assert.equal(parseVisiToMeters('5000'), 5000);
        assert.equal(parseVisiToMeters('0500'), 500);
    });

    test('parse les miles-statute entiers', () => {
        // 1 SM ≈ 1609 m
        assert.ok(Math.abs(parseVisiToMeters('1SM') - 1609) < 5);
        // 5 SM ≈ 8047 m
        assert.ok(Math.abs(parseVisiToMeters('5SM') - 8047) < 5);
    });

    test('parse les miles fractionnaires', () => {
        // 1/2 SM ≈ 805 m
        assert.ok(Math.abs(parseVisiToMeters('1/2SM') - 805) < 5);
        // 1 1/4 SM = 1.25 SM ≈ 2012 m
        assert.ok(Math.abs(parseVisiToMeters('1 1/4SM') - 2012) < 5);
    });

    test('parse les préfixes P/M (plus/moins que)', () => {
        // P6SM → 6 SM
        assert.ok(Math.abs(parseVisiToMeters('P6SM') - 9656) < 5);
        // M1/4SM → 1/4 SM ≈ 402 m
        assert.ok(Math.abs(parseVisiToMeters('M1/4SM') - 402) < 5);
    });
});

describe('getCeiling', () => {
    test('retourne 999 (illimité) pour CAVOK/NSC/SKC/NCD', () => {
        assert.equal(getCeiling('CAVOK'), 999);
        assert.equal(getCeiling('NSC'), 999);
        assert.equal(getCeiling('SKC'), 999);
        assert.equal(getCeiling('NCD'), 999);
    });

    test('retourne 999 pour null/vide', () => {
        assert.equal(getCeiling(''), 999);
        assert.equal(getCeiling(null), 999);
    });

    test('retourne 0 pour ciel invisible VV///', () => {
        assert.equal(getCeiling('VV///'), 0);
    });

    test('retourne le plafond le plus bas (centaines de ft)', () => {
        // BKN010 = 1000 ft → 10 (centaines)
        assert.equal(getCeiling('BKN010'), 10);
        // OVC005 = 500 ft → 5 (centaines)
        assert.equal(getCeiling('OVC005'), 5);
    });

    test('ignore FEW et SCT (ne sont pas un plafond)', () => {
        // FEW030 SCT100 : aucun plafond → illimité
        assert.equal(getCeiling('FEW030 SCT100'), 999);
    });

    test('prend le plus bas entre plusieurs plafonds', () => {
        // BKN020 OVC010 → plafond à 1000 ft → 10
        assert.equal(getCeiling('BKN020 OVC010'), 10);
    });

    test('gère VV (vertical visibility) comme plafond', () => {
        // VV008 = 800 ft → 8 (centaines)
        assert.equal(getCeiling('VV008'), 8);
    });

    test('gère le format parsé "BKN 1000ft"', () => {
        assert.equal(getCeiling('BKN 1000ft'), 10);
        assert.equal(getCeiling('OVC 500ft'), 5);
    });
});

describe('getFlightCategory', () => {
    test('LIFR : plafond < 500 ft OU visi < 1600 m', () => {
        assert.deepEqual(getFlightCategory(1000, 3), { cat: 'LIFR', class: 'cat-lifr' });
        assert.deepEqual(getFlightCategory(1500, 5), { cat: 'LIFR', class: 'cat-lifr' });
    });

    test('IFR : plafond < 1000 ft OU visi < 4800 m', () => {
        assert.deepEqual(getFlightCategory(2000, 8), { cat: 'IFR', class: 'cat-ifr' });
        assert.deepEqual(getFlightCategory(3000, 12), { cat: 'IFR', class: 'cat-ifr' });
    });

    test('MVFR : plafond <= 3000 ft OU visi <= 8000 m', () => {
        // ceil=2500ft (25) ET visi=6000m → MVFR
        assert.deepEqual(getFlightCategory(6000, 25), { cat: 'MVFR', class: 'cat-mvfr' });
        // ceil=3000ft (30) exact, visi=5000m → MVFR (borne <= incluse)
        assert.deepEqual(getFlightCategory(5000, 30), { cat: 'MVFR', class: 'cat-mvfr' });
    });

    test('VFR : conditions claires', () => {
        // ceil=5000ft (>3000) ET visi=10000m (>8000) → VFR
        assert.deepEqual(getFlightCategory(10000, 50), { cat: 'VFR', class: 'cat-vfr' });
    });

    test('frontières exactes', () => {
        // Plafond = 900ft (9) → IFR (< 1000ft strict)
        assert.equal(getFlightCategory(10000, 9).cat, 'IFR');
        // Plafond = 1000ft (10) exact → MVFR (< est strict, <= MVFR)
        assert.equal(getFlightCategory(10000, 10).cat, 'MVFR');
        // Visi = 1600m exact → IFR (< 4800m) — pas LIFR car < 1600 est strict
        assert.equal(getFlightCategory(10000, 25).cat, 'MVFR');
    });
});

describe('getWeatherIcon', () => {
    test('orage', () => {
        assert.equal(getWeatherIcon(null, 'orage TS'), 'cloud-lightning');
        assert.equal(getWeatherIcon(null, 'thunderstorm'), 'cloud-lightning');
    });

    test('neige/grêle', () => {
        assert.equal(getWeatherIcon(null, 'neige'), 'cloud-snow');
        assert.equal(getWeatherIcon(null, 'snow'), 'cloud-snow');
        assert.equal(getWeatherIcon(null, 'grêle hail'), 'cloud-snow');
    });

    test('pluie', () => {
        assert.equal(getWeatherIcon(null, 'pluie'), 'cloud-rain');
        assert.equal(getWeatherIcon(null, 'rain'), 'cloud-rain');
    });

    test('brouillard', () => {
        assert.equal(getWeatherIcon(null, 'brouillard'), 'cloud-fog');
        assert.equal(getWeatherIcon(null, 'fog'), 'cloud-fog');
    });

    test('nuages (sans phénomène)', () => {
        assert.equal(getWeatherIcon('VV001', ''), 'cloud-fog');
        assert.equal(getWeatherIcon('OVC010', ''), 'cloud');
        assert.equal(getWeatherIcon('BKN010', ''), 'cloudy');
        assert.equal(getWeatherIcon('SCT030', ''), 'cloud-sun');
        assert.equal(getWeatherIcon('FEW030', ''), 'sun');
    });

    test('défaut : soleil', () => {
        assert.equal(getWeatherIcon('', ''), 'sun');
    });
});

describe('findActiveValueAtHour', () => {
    const blocks = [
        { start: 0, end: 6, val: 'Nuit' },
        { start: 6, end: 12, val: 'Matin' },
        { start: 12, end: 18, val: 'Après-midi' },
    ];

    test('retourne la valeur du bloc contenant l\'heure cible', () => {
        assert.equal(findActiveValueAtHour(blocks, 8), 'Matin');
        assert.equal(findActiveValueAtHour(blocks, 15), 'Après-midi');
        assert.equal(findActiveValueAtHour(blocks, 3), 'Nuit');
    });

    test('retourne null si aucune correspondance', () => {
        assert.equal(findActiveValueAtHour(blocks, 20), null);
    });

    test('retourne null pour tableau vide ou null', () => {
        assert.equal(findActiveValueAtHour([], 5), null);
        assert.equal(findActiveValueAtHour(null, 5), null);
    });

    test('ignore les blocs sans valeur', () => {
        const withEmpty = [{ start: 0, end: 10, val: '' }, { start: 5, end: 15, val: 'OK' }];
        assert.equal(findActiveValueAtHour(withEmpty, 7), 'OK');
    });

    test('borne start incluse, borne end exclue', () => {
        assert.equal(findActiveValueAtHour(blocks, 6), 'Matin');  // 6 ∈ [6,12)
        assert.equal(findActiveValueAtHour(blocks, 12), 'Après-midi'); // 12 ∈ [12,18)
        assert.equal(findActiveValueAtHour(blocks, 18), null);    // 18 ∉ [12,18)
    });
});
