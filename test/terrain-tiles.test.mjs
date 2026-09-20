// TERRAIN TILES (Terrarium/AWS) — source primaire du relief (choix pilote
// 20/09) : codage pixel et projection Mercator slippy. Pures, testées sous
// Node ; l'échantillonnage navigateur (canvas) est couvert par la QA.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { _decodeTerrarium, _lonToTileX, _latToTileY } from '../js/terrain-tiles.js';

describe('terrain-tiles : codage Terrarium', () => {
    test('formule (R×256 + G + B/256) − 32768 : altitudes de référence', () => {
        // 0 m : (R,G,B) = (128, 0, 0) → 128×256 − 32768 = 0.
        assert.equal(_decodeTerrarium(128, 0, 0), 0);
        // 256 m : (129, 0, 0).
        assert.equal(_decodeTerrarium(129, 0, 0), 256);
        // −1 m : B = 256 → 1/256 de pas… formule exacte : B/256 → 0.996…≈ arrondi
        assert.ok(Math.abs(_decodeTerrarium(127, 255, 255) - (-256 + 255 + 255 / 256)) < 1e-9);
        // ~4809 m (Mont-Blanc) : 32768+4809 = 37577 = 146×256 + 201.
        assert.equal(_decodeTerrarium(146, 201, 0), 37577 - 32768);
    });
});

describe('terrain-tiles : Mercator slippy', () => {
    test('longitude → X : 0° au centre du monde (z=1 → X=1), ±180 aux bords', () => {
        assert.ok(Math.abs(_lonToTileX(0, 1) - 1) < 1e-9);
        assert.ok(Math.abs(_lonToTileX(-180, 1)) < 1e-9);
        assert.ok(Math.abs(_lonToTileX(180, 2) - 4) < 1e-9);
    });
    test('latitude → Y : monotone décroissante, clampée aux pôles web-Mercator', () => {
        assert.ok(_latToTileY(50, 8) < _latToTileY(40, 8), 'plus au nord → Y plus petit');
        const yPole = _latToTileY(999, 4);       // au-delà du clamp
        const yMax = _latToTileY(85.051129, 4);
        assert.ok(Math.abs(yPole - yMax) < 1e-6, 'clamp à ±85,051129°');
    });
    test('France (Vannes) : tuiles z=11 cohérentes avec la grille mondiale', () => {
        const x = _lonToTileX(-2.76, 11), y = _latToTileY(47.65, 11);
        assert.ok(x > 1005 && x < 1012, `X plausible (${x})`);
        assert.ok(y > 710 && y < 718, `Y plausible (${y})`);
    });
});
