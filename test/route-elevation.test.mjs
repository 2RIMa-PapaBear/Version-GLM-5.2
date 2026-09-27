// Tests de la marge au relief AVEC obstacles (js/route-elevation.js, A6) —
// un sommet d'obstacle du couloir devient le pire point quand il approche
// plus la croisière que le terrain.
// + Fiche 12 : échantillonnage du relief le long de l'orthodromie.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateClearance, _greatCirclePoints } from '../js/route-elevation.js';

const PROF = {
    points: [
        { frac: 0, lat: 47, lon: -3, elevFt: 500 },
        { frac: 0.5, lat: 47.2, lon: -2.8, elevFt: 1200 },
        { frac: 1, lat: 47.4, lon: -2.6, elevFt: 300 },
    ],
};

describe('evaluateClearance avec obstacles (A6)', () => {
    test('sans obstacle : marge au relief seul', () => {
        const r = evaluateClearance(PROF, 2500, 1000);
        assert.equal(r.minClearanceFt, 1300);
        assert.equal(r.level, 'ok');
        assert.equal(r.worstObstacle, null);
    });

    test('pylône sous la croisière à moins de 1000 ft → CAUTION et pire point', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.5, topFt: 2100, type: 'Pylône' }]);
        assert.equal(r.minClearanceFt, 400);
        assert.equal(r.level, 'caution');
        assert.equal(r.worstObstacle.type, 'Pylône');
    });

    test('sommet au-dessus de la croisière → DANGER', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.2, topFt: 2600, type: 'Éolienne' }]);
        assert.equal(r.level, 'danger');
        assert.equal(r.worstObstacle.topFt, 2600);
    });

    test('obstacle moins critique que le relief : sans effet', () => {
        const r = evaluateClearance(PROF, 2500, 1000, [{ frac: 0.5, topFt: 1000, type: 'Mât' }]);
        assert.equal(r.minClearanceFt, 1300);
        assert.equal(r.worstObstacle, null);
    });

    test('entrées invalides', () => {
        const r = evaluateClearance(null, 2500, 1000, [{ topFt: 2600 }]);
        assert.equal(r.minClearanceFt, null);
        assert.equal(r.level, 'ok');
    });
});

// ---------------------------------------------------------------------------
// Fiche 12 — le relief doit être échantillonné sur l'ORTHODROMIE (même
// géométrie que greatCircleDistanceNm / trueCourseDeg), pas sur une droite
// lat/lon loxodromique qui s'en écarte de ~0,4 NM sur une étape de 100 NM.
// ---------------------------------------------------------------------------
// Vecteur unitaire 3D du point (lat, lon en degrés) — construit dans le test,
// indépendamment du code prod.
const u = (lat, lon) => {
    const f = lat * Math.PI / 180, l = lon * Math.PI / 180;
    return [Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)];
};
const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
// Distance du grand cercle en radians, recalculée dans le test.
const angle = (a, b) => Math.atan2(Math.hypot(...cross(a, b)), dot(a, b));

describe('_greatCirclePoints (F12 : échantillonnage orthodromique)', () => {
    // Brest → Strasbourg : segment ~est-ouest, là où l'écart loxo/ortho est
    // maximal à nos latitudes (~0,14° de bombé vers le pôle au milieu).
    const A = { lat: 48.4, lon: -4.5 };
    const B = { lat: 48.55, lon: 7.75 };
    const N = 41;
    const pts = _greatCirclePoints(A.lat, A.lon, B.lat, B.lon, N);

    test('extrémités exactes', () => {
        assert.ok(Math.abs(pts[0].lat - A.lat) < 1e-9 && Math.abs(pts[0].lon - A.lon) < 1e-9);
        assert.ok(Math.abs(pts[N - 1].lat - B.lat) < 1e-9 && Math.abs(pts[N - 1].lon - B.lon) < 1e-9);
    });

    test('tous les points sont dans le plan du grand cercle (produit mixte nul)', () => {
        const n = cross(u(A.lat, A.lon), u(B.lat, B.lon));
        for (const p of pts) {
            assert.ok(Math.abs(dot(n, u(p.lat, p.lon))) < 1e-9,
                `point (${p.lat}, ${p.lon}) hors du grand cercle`);
        }
    });

    test('le milieu bombe vers le pôle — la loxodromie (48.475) est rejetée', () => {
        const mid = pts[Math.floor(N / 2)];
        const loxoMid = (A.lat + B.lat) / 2;   // droite lat/lon : 48.475
        assert.ok(mid.lat > loxoMid + 0.05, `lat milieu ${mid.lat} <= loxodromie + 0.05`);
        assert.ok(mid.lat < 48.7, 'bombé polaire irréaliste');
    });

    test('équirépartition : distance parcourue proportionnelle au rang', () => {
        const uA = u(A.lat, A.lon), uB = u(B.lat, B.lon);
        const total = angle(uA, uB);
        for (let i = 0; i < N; i++) {
            const got = angle(uA, u(pts[i].lat, pts[i].lon)) / total;
            assert.ok(Math.abs(got - i / (N - 1)) < 1e-9, `point ${i} : ${got}`);
        }
    });

    test('antiméridien : 179E → 179O passe par 180, pas par 0', () => {
        const p = _greatCirclePoints(10, 179, 10, -179, 3)[1];
        assert.ok(Math.abs(Math.abs(p.lon) - 180) < 1e-6, `lon milieu ${p.lon}`);
        assert.ok(Math.abs(p.lat - 10) < 0.01);
    });

    test('garde : segment nul et petits n', () => {
        assert.deepEqual(_greatCirclePoints(5, 5, 5, 5, 7).filter(p =>
            p.lat !== 5 || p.lon !== 5), []);
        assert.equal(_greatCirclePoints(5, 5, 6, 6, 1).length, 1);
        assert.deepEqual(_greatCirclePoints(5, 5, 6, 6, 0), []);
    });
});
