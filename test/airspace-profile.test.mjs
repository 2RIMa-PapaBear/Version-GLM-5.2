// Tests du calcul des zones aériennes traversées par la route
// (js/airspace-profile.js) — module pur, sans dépendance DOM/réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    limitToFt, routeBbox, pointInAirspace, crossedRanges,
    serviceDisplayName, serviceFreq, computeRouteAirspaces,
} from '../js/airspace-profile.js';

// Carré lon 1..2, lat 47..48.
const SQ = (lonMin, lonMax, latMin = 47, latMax = 48) => ({
    type: 'Polygon',
    coordinates: [[[lonMin, latMin], [lonMax, latMin], [lonMax, latMax], [lonMin, latMax], [lonMin, latMin]]],
});

// Route synthétique : 31 points, lon 0→3 (frac = lon/3), lat 47.5.
const ROUTE = Array.from({ length: 31 }, (_, i) => {
    const frac = i / 30;
    return { frac, lat: 47.5, lon: 3 * frac };
});

const zone = (name, freq, lo, up, geometry, freqName) => ({
    name,
    lowerLimit: { value: lo, unit: 1 },
    upperLimit: { value: up, unit: 1 },
    frequencies: freq ? [{ value: freq, name: freqName ?? name + ' INFORMATION' }] : [],
    geometry,
});

// ----------------------------------------------------------------
test('limitToFt : FL, ft, mètres, absent', () => {
    assert.equal(limitToFt({ value: 65, unit: 6 }), 6500);
    assert.equal(limitToFt({ value: 2500, unit: 1 }), 2500);
    assert.equal(limitToFt({ value: 1000, unit: 0 }), 3281);
    assert.equal(limitToFt(null), null);
    assert.equal(limitToFt({ value: 'x', unit: 1 }), null);
});

test('routeBbox : marges et cas vide', () => {
    assert.deepEqual(routeBbox([{ lat: 47, lon: 1 }, { lat: 48, lon: 2 }]),
        [46.6, 0.6, 48.4, 2.4]);
    assert.equal(routeBbox([]), null);
});

test('pointInAirspace : Polygon, MultiPolygon, Point+rayon, LineString', () => {
    assert.equal(pointInAirspace(47.5, 1.5, SQ(1, 2)), true);
    assert.equal(pointInAirspace(46.5, 1.5, SQ(1, 2)), false);
    assert.equal(pointInAirspace(47.5, 1.5, { type: 'MultiPolygon', coordinates: [[SQ(0, 0.5).coordinates[0], SQ(1, 2).coordinates[0]]] }), true);
    assert.equal(pointInAirspace(47.5, 1.5, { type: 'Point', coordinates: [1.5, 47.5] }, 5), true);
    assert.equal(pointInAirspace(47.5, 1.5, { type: 'Point', coordinates: [3, 47.5] }, 5), false);
    assert.equal(pointInAirspace(47.5, 1.5, { type: 'LineString', coordinates: [[1, 47], [2, 48]] }), false);
});

test('crossedRanges : tronçon du carré traversé, coin effleuré écarté', () => {
    // Route lon 0→3 : dans le carré 1..2 → frac 1/3..2/3.
    const r = crossedRanges(ROUTE, SQ(1, 2));
    assert.equal(r.length, 1);
    assert.ok(Math.abs(r[0][0] - 1 / 3) < 0.05 && Math.abs(r[0][1] - 2 / 3) < 0.05, JSON.stringify(r));

    // Route dense (pas 0.01 lon) : carré touché sur 0.02 lon (≈ 0.007 frac,
    // sous MIN_SPAN 0.012) → coin effleuré écarté.
    const DENSE = Array.from({ length: 301 }, (_, i) => ({ frac: i / 300, lat: 47.5, lon: 3 * i / 300 }));
    assert.deepEqual(crossedRanges(DENSE, SQ(1.0, 1.02)), []);
});

test('serviceDisplayName / serviceFreq : INFORMATION → INFO, majuscules', () => {
    assert.equal(serviceDisplayName(zone('SIV SEINE 6', '127.815', 0, 6500, null, 'SEINE INFORMATION')), 'SEINE INFO');
    assert.equal(serviceDisplayName(zone('LE BOURGET', null, 0, 4500, null)), 'LE BOURGET');
    assert.equal(serviceFreq(zone('X', '127.815', 0, 1, null)), '127.815');
    assert.equal(serviceFreq(zone('X', null, 0, 1, null)), null);
});

test('computeRouteAirspaces : nichage, fusion de secteurs, tri conteneur d\u2019abord', () => {
    const items = [
        zone('LTA FRANCE', null, 0, 99999, SQ(0, 3)),                            // admin → ignoré
        zone('HAUTE TMA', null, 8000, 99999, SQ(0, 3)),                          // plancher > 5000 → ignoré
        zone('SANS PLAFOND', null, 0, null, SQ(0, 3)),                           // plafond absent → ignoré
        zone('PARIS OUEST', '129.625', 0, 19500, SQ(0.4, 2.6), 'PARIS OUEST INFORMATION'),   // conteneur
        zone('SEINE 6', '127.815', 0, 6500, SQ(0.6, 1.0), 'SEINE INFORMATION'),  // secteurs à bord
        zone('SEINE 7', '127.815', 0, 8500, SQ(1.0, 1.5), 'SEINE INFORMATION'),  // partagé → fusionnés
        zone('LE BOURGET', '123.835', 0, 4500, SQ(1.2, 1.35), 'LE BOURGET INFORMATION'),    // imbriqué étroit
    ];
    const groups = computeRouteAirspaces(ROUTE, items);
    assert.ok(groups, 'groupes attendus');
    const names = groups.map(g => g.name);
    assert.ok(names.includes('PARIS OUEST INFO'));
    assert.ok(names.includes('SEINE INFO'));
    assert.ok(names.includes('LE BOURGET INFO'));
    assert.ok(!names.some(n => n.includes('LTA') || n.includes('HAUTE') || n.includes('SANS')));

    // Tri : le conteneur (plus large) avant ses imbriqués.
    assert.ok(names.indexOf('PARIS OUEST INFO') < names.indexOf('LE BOURGET INFO'));

    // SEINE : 1 seul groupe, 2 secteurs, plafond = max, 1 plage fusionnée
    // (secteurs jointifs ; un petit écart < seuil de fusion fusionne aussi).
    const seine = groups.find(g => g.name === 'SEINE INFO');
    assert.equal(seine.freq, '127.815');
    assert.equal(seine.up, 8500);
    assert.equal(seine.segs.length, 2);
    assert.equal(seine.ranges.length, 1);
    // Chaque tronçon porte le NOM openAIP de son secteur (survol précis :
    // « SIV RENNES SUD A » vs « RENNES INFO »).
    assert.equal(seine.segs[0].zone, 'SEINE 6');
    assert.equal(seine.segs[1].zone, 'SEINE 7');

    // Conteneur : plafond repris de sa limite haute.
    assert.equal(groups.find(g => g.name === 'PARIS OUEST INFO').up, 19500);
});

test('computeRouteAirspaces : deux plages distinctes non fusionnées', () => {
    // Deux secteurs éloignés (écart 0.5 lon ≫ seuil) → 2 plages.
    const items = [zone('X', '118.1', 0, 5000, SQ(0.5, 0.8), 'X INFORMATION'), zone('X', '118.1', 0, 6000, SQ(1.8, 2.2), 'X INFORMATION')];
    const g = computeRouteAirspaces(ROUTE, items)[0];
    assert.equal(g.name, 'X INFO');
    assert.equal(g.up, 6000);
    assert.equal(g.ranges.length, 2);
    assert.equal(g.segs.length, 2);
});

test('computeRouteAirspaces : entrées invalides → null', () => {
    assert.equal(computeRouteAirspaces(null, []), null);
    assert.equal(computeRouteAirspaces(ROUTE, null), null);
    assert.equal(computeRouteAirspaces(ROUTE, []), null);
});

test('computeRouteAirspaces : filtre altitude du vol (croisière 3500 ft)', () => {
    const items = [
        zone('CTR RENNES', '120.500', 0, 1500, SQ(0.5, 1.5), 'RENNES TWR'),        // SOUS le vol → écartée
        zone('SIV RENNES SUD A', '134.000', 0, 11500, SQ(0.5, 1.5), 'RENNES INFORMATION'),  // englobe 3500 → gardée
        zone('TMA HAUTE', '125.000', 5500, 11500, SQ(0.5, 1.5), 'HAUTE INFORMATION'),      // AU-DESSUS → écartée
        zone('TMA STRADDLE', '126.000', 2500, 4500, SQ(0.5, 1.5), 'STRADDLE INFORMATION'), // à cheval sur 3500 → gardée
    ];
    const names = computeRouteAirspaces(ROUTE, items, { cruiseAltFt: 3500 }).map(g => g.name);
    assert.ok(names.includes('RENNES INFO'));
    assert.ok(names.includes('STRADDLE INFO'));
    assert.ok(!names.includes('RENNES TWR'), 'CTR sous le vol ne doit pas apparaître');
    assert.ok(!names.some(n => n.includes('HAUTE')), 'zone au-dessus du vol ne doit pas apparaître');

    // Sans altitude (0/null) : tout est conservé (comportement antérieur —
    // TMA HAUTE reste écartée par le filtre plancher > 5000 ft, sans rapport).
    const all = computeRouteAirspaces(ROUTE, items).map(g => g.name);
    assert.equal(all.length, 3);
    assert.ok(all.includes('RENNES TWR'), 'sans altitude, la CTR est conservée');
    const zero = computeRouteAirspaces(ROUTE, items, { cruiseAltFt: 0 }).map(g => g.name);
    assert.equal(zero.length, 3);
});
