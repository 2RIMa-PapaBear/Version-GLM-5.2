/* GEOMAG WMM2025 (audit N13, migré le 01/10/2026) — deux gardes :
 *  1. POINTS DE TEST OFFICIELS NOAA (WMM2025_TestValues.txt, domaine public
 *     US Gov, extraits variés : années 2025→2029.5, altitudes 8→65 km,
 *     latitudes -63→65) — la lib doit restituer la déclinaison à ±0,011°
 *     (elle arrondit à 2 décimales : le demi-chiffre publié + un poil).
 *  2. DÉCLINAISONS OFFICIELLES SIA (AdMagVar millésime 2025, embarquées dans
 *     data/sia-airfields.json) À L'ÉPOQUE COMMUNE 2025.0 : mesuré le
 *     01/10/2026 → biais 0,017°, RMSE 0,019°, max 0,030° sur 444 terrains.
 *     Tolérances larges (0,1°) : elles verrouillent le MODÈLE et l'ÉPOQUE
 *     sans pourrir avec le temps (date FIXÉE à 2025.0).
 * Pur — la lib UMD est chargée par vm avec le shim self de Node. `npm test`. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';

globalThis.self = globalThis;
vm.runInThisContext(fs.readFileSync(new URL('../vendor/geomag.js', import.meta.url), 'utf8'));
const geomag = globalThis.geomag;

// année décimale → ms (même convention 365,25 j que la lib)
const E25 = Date.UTC(2025, 0, 1);
const anneeVersMs = (y) => E25 + (y - 2025) * 365.25 * 86400e3;

describe('geomag WMM2025 — points de test officiels NOAA', () => {
    // [année décimale, altitude km, lat, lon, déclinaison attendue°]
    const PTS = [
        [2025.0, 65, 43, 93, 0.50],
        [2025.5, 8, -52, -75, 14.91],
        [2026.5, 14, 0, 80, -3.10],
        [2027.0, 12, -63, 178, 57.87],
        [2028.0, 45, -46, -41, -11.68],
        [2029.5, 31, 13, -132, 9.04],
    ];
    for (const [an, altKm, lat, lon, dec] of PTS) {
        test(`${an} ${lat}/${lon} alt ${altKm} km → ${dec}°`, () => {
            const got = geomag.field(lat, lon, altKm, anneeVersMs(an)).declination;
            assert.ok(Math.abs(got - dec) <= 0.011, `obtenu ${got}°, attendu ${dec}° (±0,011)`);
        });
    }
    test('altitude en KILOMÈTRES (analyse dimensionnelle du code + preuve empirique)', () => {
        // 33 km ≈ 0,0052 rayon terrestre : si la lib attendait des rayons,
        // ces deux appels différeraient nettement — ils ne diffèrent que de
        // l'effet physique des 33 km (~0,02° ici), pas d'un facteur 6371.
        const a0 = geomag.field(17, 5, 0, anneeVersMs(2029.5)).declination;
        const a33 = geomag.field(17, 5, 33, anneeVersMs(2029.5)).declination;
        assert.ok(Math.abs(a33 - a0) < 0.2, `Δ(${a33 - a0}°) = effet km, pas rayons`);
    });
});

describe('geomag WMM2025 vs déclinaisons OFFICIELLES SIA (2025.0)', () => {
    test('444 terrains : biais ≤ 0,1°, RMSE ≤ 0,1°, max ≤ 0,15°', () => {
        const sia = JSON.parse(fs.readFileSync(new URL('../data/sia-airfields.json', import.meta.url), 'utf8')).items;
        const ds = [];
        for (const a of sia) {
            if (typeof a.magVar !== 'number' || !Number.isFinite(a.lat)) continue;
            ds.push(geomag.field(a.lat, a.lon, 0, E25).declination - a.magVar);
        }
        assert.ok(ds.length > 300, `échantillon SIA exploitable (${ds.length} terrains)`);
        const mean = ds.reduce((x, y) => x + y, 0) / ds.length;
        const rmse = Math.sqrt(ds.reduce((x, y) => x + y * y, 0) / ds.length);
        const max = Math.max(...ds.map(Math.abs));
        assert.ok(Math.abs(mean) <= 0.1, `biais ${mean.toFixed(3)}° — modèle ou époque faux ?`);
        assert.ok(rmse <= 0.1, `RMSE ${rmse.toFixed(3)}°`);
        assert.ok(max <= 0.15, `max ${max.toFixed(3)}°`);
    });
});
