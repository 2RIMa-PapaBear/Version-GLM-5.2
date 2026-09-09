// GPS-VOLS — exports et utilitaires purs (extrait de gps.js, item ⑥ 09/09).
import test from 'node:test';
import assert from 'node:assert/strict';
import { volName, toGpx, toKml, volDurMs } from '../js/gps-vols.js';

const VOL = {
    id: Date.UTC(2026, 8, 9, 14, 30),
    pts: [
        { t: Date.UTC(2026, 8, 9, 14, 30, 0), lat: 48.769, lon: 2.105, alt: 200, spd: 12.5, hdg: 90.0 },
        { t: Date.UTC(2026, 8, 9, 14, 31, 0), lat: 48.800, lon: 2.160, alt: 350, spd: 51.4, hdg: 78.3 },
    ],
};

test('volName : horodatage lisible AAAAMMJJ-HHMM (heure locale)', () => {
    const d = new Date(VOL.id);
    const p = (n) => String(n).padStart(2, '0');
    const attendu = 'vol-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
    assert.equal(volName(VOL), attendu);
});

test('toGpx : trkpts avec ele/time/speed/course', () => {
    const g = toGpx(VOL);
    assert.ok(g.includes('<gpx version="1.1"'));
    assert.ok(g.includes('lat="48.769000" lon="2.105000"'));
    assert.ok(g.includes('<ele>200.0</ele>'));
    assert.ok(g.includes('<speed>12.5</speed>'));
    assert.ok(g.includes('<course>78.3</course>'));
    assert.ok(g.includes('<time>2026-09-09T14:31:00.000Z</time>'));
    assert.equal((g.match(/<trkpt /g) || []).length, 2);
});

test('toKml : LineString absolu, lon,lat,alt', () => {
    const k = toKml(VOL);
    assert.ok(k.includes('<kml'));
    assert.ok(k.includes('<altitudeMode>absolute</altitudeMode>'));
    assert.ok(k.includes('2.105000,48.769000,200.0'));
    assert.ok(k.includes('2.160000,48.800000,350.0'));
});

test('volDurMs : dernier point − départ de session', () => {
    assert.equal(volDurMs(VOL), 60000);
    assert.equal(volDurMs({ id: 5, pts: [] }), 0);
});
