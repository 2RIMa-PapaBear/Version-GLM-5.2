// Fiche n°17 (audit 27/09) — géométrie du couloir METAR de route :
// la distance station→route doit être un écart de route sphérique en NM
// (cross-track), pas une distance euclidienne en degrés bruts. Sans le
// facteur 1/cos(lat) sur la composante est-ouest, le couloir était une
// ellipse (~48 NM nord-sud pour ~32 NM est-ouest à 47°N) qui pouvait
// masquer un METAR latéral.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _distToRouteNm } from '../js/route-weather.js';

const NM_PER_DEG_LAT = 60;
const cosDeg = d => Math.cos(d * Math.PI / 180);

// Route nord-sud sur le méridien -3° (un méridien EST un grand cercle :
// mesures absolues sans bombement orthodromique).
const ROUTE_NS = [[47, -3, 'CCCC'], [49, -3, 'DDDD']];
// Route est-ouest courte (1° de long) à 47°N : bombement du grand cercle
// ~0,1 NM seulement, négligeable pour comparer aux offsets nord-sud.
const ROUTE_EW_1DEG = [[47, -1.5, 'AAAA'], [47, -0.5, 'BBBB']];
// Route est-ouest à 47°N, 2° de long, arrivée à -3° : stations au-delà
// des extrémités A/B.
const ROUTE_EW_SHORT = [[47, -1, 'AAAA'], [47, -3, 'BBBB']];
// Route à deux tronçons : est-ouest puis nord-sud.
const ROUTE_2LEGS = [[47, -1, 'AAAA'], [47, -3, 'EEEE'], [49, -3, 'DDDD']];

test('couloir isotrope : 36 NM vrais vers l\'est et vers le nord → même distance', () => {
    // Station à 36 NM vrais à l'EST de la jambe nord-sud, contre station à
    // 36 NM (0,6° de latitude) au NORD de la jambe est-ouest. L'ancien code
    // en degrés bruts voyait 0,600° contre 0,896° (écart ~18 NM une fois
    // converti) : la zone de recherche était une ellipse. Le cross-track
    // sphérique rend les deux mesures égales.
    const lonOff = 36 / (NM_PER_DEG_LAT * cosDeg(48));
    const dEast = _distToRouteNm(48, -3 + lonOff, ROUTE_NS);
    const dNorth = _distToRouteNm(47.6, -1, ROUTE_EW_1DEG);
    assert.ok(Math.abs(dEast - dNorth) < 0.3, `dEast=${dEast.toFixed(2)} dNorth=${dNorth.toFixed(2)}`);
    for (const d of [dEast, dNorth]) {
        assert.ok(d > 35 && d < 37, `distance attendue dans [35, 37], obtenue ${d.toFixed(2)}`);
    }
});

test('régression du METAR masqué : station 44 NM à l\'est désormais incluse', () => {
    // 44 NM vers l'est = 1,096° en degrés bruts > seuil historique 0,8°
    // → exclu par l'ancienne ellipse (~33 NM effectifs est-ouest à 48°N),
    // inclus par le couloir isotrope de 48 NM.
    const lonOff = 44 / (NM_PER_DEG_LAT * cosDeg(48));
    const d = _distToRouteNm(48, -3 + lonOff, ROUTE_NS);
    assert.ok(d < 48, `44 NM doit être dans le couloir 48 NM, obtenu ${d.toFixed(2)}`);
    assert.ok(d > 43 && d < 45, `distance attendue ~44, obtenue ${d.toFixed(2)}`);
});

test('écart latéral exact sur un méridien : 0,2° de longitude = 8,03 NM à 48°N', () => {
    const d = _distToRouteNm(48, -3.2, ROUTE_NS);
    const expected = NM_PER_DEG_LAT * cosDeg(48) * 0.2;
    assert.ok(Math.abs(d - expected) < 0.15, `attendu ${expected.toFixed(2)}, obtenu ${d.toFixed(2)}`);
});

test('au-delà des extrémités : distance orthodromique à l\'aérodrome le plus proche', () => {
    const halfDegLonNm = NM_PER_DEG_LAT * cosDeg(47) * 0.5; // 20,46 NM
    // Station 0,5° à l'ouest de l'arrivée B (47,-3) : projection hors
    // segment → haversine station→B, pas la perpendiculaire au tronçon.
    const dBeyondB = _distToRouteNm(47, -3.5, ROUTE_EW_SHORT);
    assert.ok(Math.abs(dBeyondB - halfDegLonNm) < 0.2, `au-delà de B : attendu ${halfDegLonNm.toFixed(2)}, obtenu ${dBeyondB.toFixed(2)}`);
    // Idem derrière le départ A (47,-1).
    const dBeforeA = _distToRouteNm(47, -0.5, ROUTE_EW_SHORT);
    assert.ok(Math.abs(dBeforeA - halfDegLonNm) < 0.2, `derrière A : attendu ${halfDegLonNm.toFixed(2)}, obtenu ${dBeforeA.toFixed(2)}`);
});

test('route multi-tronçons : minimum sur les deux jambes', () => {
    // Près du tronçon nord-sud (8 NM), loin du tronçon est-ouest (~60 NM).
    const dNearLeg2 = _distToRouteNm(48, -3.2, ROUTE_2LEGS);
    assert.ok(Math.abs(dNearLeg2 - NM_PER_DEG_LAT * cosDeg(48) * 0.2) < 0.15,
        `attendu ~8,03, obtenu ${dNearLeg2.toFixed(2)}`);
    // Près du tronçon est-ouest : 0,1° de latitude au nord de la parallèle.
    const dNearLeg1 = _distToRouteNm(47.1, -2, ROUTE_2LEGS);
    assert.ok(dNearLeg1 > 5.5 && dNearLeg1 < 6.5, `attendu ~6, obtenu ${dNearLeg1.toFixed(2)}`);
});
