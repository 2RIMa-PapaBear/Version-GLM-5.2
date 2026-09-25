// Tests B3 (14/09) : grille de flèches de vent (js/wind-layer.js — pur).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { buildWindGrid, windLayerAltFt, fetchWindGrid } from '../js/wind-layer.js';

describe('buildWindGrid (grille flèches de vent — pas adaptatif)', () => {
    test('COUVERTURE TOTALE de la vue : dernier point = coin NE', () => {
        const pts = buildWindGrid(46.8, -5.5, 48.9, -1.2);   // vue large Bretagne
        const last = pts[pts.length - 1];
        assert.ok(Math.abs(last.lat - 48.9) < 0.15, `dernier lat ${last.lat} ≈ 48,9`);
        assert.ok(Math.abs(last.lon - (-1.2)) < 0.15, `dernier lon ${last.lon} ≈ -1,2`);
        assert.ok(pts.length >= 40 && pts.length <= 96, `nb : ${pts.length}`);
    });

    test('vue France entière : couvre aussi, ~28-49 flèches', () => {
        const pts = buildWindGrid(42.5, -5.5, 51.2, 8.5);
        const last = pts[pts.length - 1];
        assert.ok(Math.abs(last.lat - 51.2) < 1.5 && Math.abs(last.lon - 8.5) < 1.5, `NE : ${JSON.stringify(last)}`);
        assert.ok(pts.length <= 96);
    });

    test('zoom serré : grille fine', () => {
        const pts = buildWindGrid(47.5, -3.0, 47.9, -2.4);
        assert.ok(pts.length >= 40, `${pts.length} flèches en zoom serré`);
    });

    test('garde-fou : plafonnée à maxPoints', () => {
        assert.ok(buildWindGrid(40, -10, 55, 15).length <= 96);
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
            // 360 = 0 = nord : Open-Meteo renvoie l'un ou l'autre selon le
            // point (donnée RÉELLE — la garde doit accepter les deux, le
            // rotate (dir+180)%360 de l'app les traite pareil).
            assert.ok(Number.isFinite(w.dir) && w.dir >= 0 && w.dir <= 360, `dir ${w.dir}`);
        }
    });

    test('fetchWindGrid : entrées invalides → null', async () => {
        assert.equal(await fetchWindGrid([], 2000), null);
        assert.equal(await fetchWindGrid(null, 2000), null);
    });
});
