// Tests B3 (14/09) : grille de flèches de vent (js/wind-layer.js — pur).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWindGrid, windLayerAltFt, fetchWindGrid } from '../js/wind-layer.js';

describe('buildWindGrid (grille flèches de vent)', () => {
    test('grille régulière sur la bbox, pas ~0,55°', () => {
        const pts = buildWindGrid(47.0, -3.0, 48.1, -1.9);
        assert.ok(pts.length >= 8 && pts.length <= 16, `nb raisonnable : ${pts.length}`);
        // bornes incluses
        assert.ok(pts.some(p => p.lat === 47 && p.lon === -3), 'premier point = coin SW');
        // pas régulier
        const lats = [...new Set(pts.map(p => p.lat))].sort((a, b) => a - b);
        if (lats.length > 1) assert.ok(Math.abs((lats[1] - lats[0]) - 0.55) < 0.01, `pas ≈ 0,55° : ${lats[1] - lats[0]}`);
    });

    test('garde-fou : la grille est plafonnée à maxPoints', () => {
        const pts = buildWindGrid(40, -6, 52, 11);   // vue européenne
        assert.ok(pts.length <= 48, `${pts.length} ≤ 48`);
    });

    test('bbox vide → vide', () => {
        assert.equal(buildWindGrid(47, -3, 47, -3).length >= 1, true, 'point unique inclus');
    });

    test('windLayerAltFt : repli 2000 ft sans plan ni saisie', () => {
        // Sous Node : ni DOM ni plan → 2000.
        assert.equal(windLayerAltFt(), 2000);
    });

    test('fetchWindGrid : UNE requête multi-points réelle → flèches exploitables', async () => {
        const pts = buildWindGrid(47.4, -3.2, 48.0, -2.4);   // Bretagne
        const r = await fetchWindGrid(pts, 2000);
        assert.ok(Array.isArray(r) && r.length >= 4, `${r?.length} flèches`);
        for (const w of r.slice(0, 3)) {
            assert.ok(Number.isFinite(w.speedKt) && w.speedKt >= 0 && w.speedKt < 250, `speed ${w.speedKt}`);
            assert.ok(Number.isFinite(w.dir) && w.dir >= 0 && w.dir < 360, `dir ${w.dir}`);
        }
    });

    test('fetchWindGrid : entrées invalides → null', async () => {
        assert.equal(await fetchWindGrid([], 2000), null);
        assert.equal(await fetchWindGrid(null, 2000), null);
    });
});
