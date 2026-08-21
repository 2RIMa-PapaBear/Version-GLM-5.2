/* ================================================================
 * TESTS UNITAIRES — Entrées/sorties de plan de vol (flight-plan-io)
 * Exécution : node --test test/flight-plan-io.test.mjs
 *
 * Fonctions pures testées : parseGpx, parseKml, buildGpx, buildKml,
 * parsePlanJson (round-trip). Les parties navigateur (file picker,
 * IndexedDB, restauration par événements) sont couvertes par la QA.
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Le module importe core.js/ui-module.js (DOM-free au chargement grâce aux
// gardes), on peut donc l'importer ici pour les fonctions pures.
import { parseGpx, parseKml, buildGpx, buildKml, parsePlanJson } from '../js/flight-plan-io.js';

describe('parseGpx', () => {
    test('extrait une route rte > rtept (nom + coordonnées)', () => {
        const gpx = `<?xml version="1.0"?>
<gpx xmlns="http://www.topografix.com/GPX/1/1">
  <rte><name>A-B</name>
    <rtept lat="45.5" lon="-73.6"><name>CYUL</name></rtept>
    <rtept lat="45.7" lon="-74.0"><name>CYMX</name></rtept>
  </rte>
</gpx>`;
        const pts = parseGpx(gpx);
        assert.equal(pts.length, 2);
        assert.deepEqual(pts[0], { lat: 45.5, lon: -73.6, name: 'CYUL' });
        assert.deepEqual(pts[1], { lat: 45.7, lon: -74.0, name: 'CYMX' });
    });

    test('fallback sur les wpt isolés (sans rte)', () => {
        const gpx = `<gpx><wpt lat="1.5" lon="2.5"><name>REP1</name></wpt><wpt lat="3.5" lon="4.5"><name>REP2</name></wpt></gpx>`;
        const pts = parseGpx(gpx);
        assert.equal(pts.length, 2);
        assert.equal(pts[0].name, 'REP1');
        assert.equal(pts[1].lat, 3.5);
    });

    test('rtept sans name → nom vide', () => {
        const pts = parseGpx(`<gpx><rte><rtept lat="10" lon="20"></rtept></rte></gpx>`);
        assert.equal(pts.length, 1);
        assert.equal(pts[0].name, '');
    });
});

describe('parseKml', () => {
    test('extrait les Placemark Point (lon,lat inversées en lat,lon)', () => {
        const kml = `<kml><Document>
  <Placemark><name>CYUL</name><Point><coordinates>-73.6,45.5,0</coordinates></Point></Placemark>
  <Placemark><name>CYMX</name><Point><coordinates>-74.0,45.7,0</coordinates></Point></Placemark>
</Document></kml>`;
        const pts = parseKml(kml);
        assert.equal(pts.length, 2);
        assert.deepEqual(pts[0], { lat: 45.5, lon: -73.6, name: 'CYUL' });
    });

    test('ignore la LineString (route) et ne garde que les Points', () => {
        const kml = `<kml><Document>
  <Placemark><name>A</name><Point><coordinates>1,2,0</coordinates></Point></Placemark>
  <Placemark><name>Route</name><LineString><coordinates>1,2,0 3,4,0</coordinates></LineString></Placemark>
  <Placemark><name>B</name><Point><coordinates>3,4,0</coordinates></Point></Placemark>
</Document></kml>`;
        const pts = parseKml(kml);
        assert.equal(pts.length, 2);
        assert.equal(pts[0].name, 'A');
    });
});

describe('buildGpx / buildKml (round-trip)', () => {
    const plan = {
        dep: 'AAAA', dest: 'BBBB',
        wps: ['CCCC', { name: 'Repère test', lat: 12.34, lon: -5.67 }],
    };
    // Coordonnées des codes : le module les résout via la base (absente en
    // Node) → on teste avec des repères uniquement pour le round-trip.
    const planRep = {
        dep: 'AAAA', dest: 'BBBB',
        wps: [{ name: 'R1', lat: 1.5, lon: 2.5 }, { name: 'R2', lat: 3.5, lon: 4.5 }],
    };

    test('GPX construit se relit : mêmes points, même ordre', () => {
        const gpx = buildGpx({ ...planRep, wps: planRep.wps });
        const pts = parseGpx(gpx);
        assert.equal(pts.length, 2);
        assert.equal(pts[0].name, 'R1');
        assert.equal(pts[1].lat, 3.5);
    });

    test('KML construit se relit : mêmes points, mêmes noms', () => {
        const kml = buildKml(planRep);
        const pts = parseKml(kml);
        assert.equal(pts.length, 2);
        assert.equal(pts[0].name, 'R1');
        assert.equal(pts[0].lon, 2.5);
    });

    test('GPX échappe les noms (& < >)', () => {
        const gpx = buildGpx({ dep: 'AAAA', dest: 'BBBB', wps: [{ name: 'A&B<C>', lat: 0, lon: 0 }] });
        assert.ok(gpx.includes('A&amp;B&lt;C&gt;'));
        const pts = parseGpx(gpx);
        assert.equal(pts[0].name, 'A&B<C>');
    });
});

describe('parsePlanJson', () => {
    test('accepte un plan natif valide', () => {
        const p = parsePlanJson(JSON.stringify({
            app: 'metar-taf-visualiseur', dep: 'CYMX', dest: 'CNU8',
            wps: ['CYQB', { name: 'Repère', lat: 45, lon: -74 }],
        }));
        assert.equal(p.dep, 'CYMX');
        assert.equal(p.dest, 'CNU8');
        assert.equal(p.wps.length, 2);
    });

    test('rejette un JSON étranger', () => {
        assert.equal(parsePlanJson('{"foo":1}'), null);
    });
});
