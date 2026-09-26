// GPS-VOLS — exports et utilitaires purs (extrait de gps.js, item ⑥ 09/09).
import test from 'node:test';
import assert from 'node:assert/strict';
import { volName, toGpx, toKml, toG1000Csv, volDurMs, exportPts } from '../js/gps-vols.js';

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

test('toKml : gx:Track absolu, heure + altitude + vitesse par point', () => {
    const k = toKml(VOL);
    assert.ok(k.includes('<kml'));
    assert.ok(k.includes('xmlns:gx="http://www.google.com/kml/ext/2.2"'));
    assert.ok(k.includes('<gx:Track>'));
    assert.ok(k.includes('<altitudeMode>absolute</altitudeMode>'));
    assert.ok(k.includes('<gx:coord>2.105000 48.769000 200.0</gx:coord>'));
    assert.ok(k.includes('<gx:coord>2.160000 48.800000 350.0</gx:coord>'));
    assert.ok(k.includes('<when>2026-09-09T14:30:00.000Z</when>'));
    assert.ok(k.includes('<gx:SimpleArrayData name="speed">'));
    assert.ok(k.includes('<gx:value>12.5</gx:value>'));
    assert.ok(k.includes('<gx:value>51.4</gx:value>'));
});

test('volDurMs : dernier point − départ de session', () => {
    assert.equal(volDurMs(VOL), 60000);
    assert.equal(volDurMs({ id: 5, pts: [] }), 0);
});

// Allègement à l'export (retour pilote 27/09) : le suivi tourne au parking
// avant le roulage et après l'arrivée — les points immobiles sont retirés,
// le premier (poste de départ) et le dernier (poste d'arrivée) restent.
test('exportPts : retire les points immobiles, garde premier + dernier', () => {
    const pts = [
        { t: 0, lat: 47.60, lon: -2.77, alt: 100, spd: 0.1 },   // parking départ → gardé (1er)
        { t: 1000, lat: 47.60, lon: -2.77, alt: 100, spd: 0.2 }, // immobile → VIRÉ
        { t: 2000, lat: 47.605, lon: -2.775, alt: 100, spd: null }, // ~700 m, sans capteur → gardé (distance)
        { t: 3000, lat: 47.610, lon: -2.780, alt: 900, spd: 45 },   // en vol → gardé
        { t: 4000, lat: 47.6101, lon: -2.7801, alt: 100, spd: 0.0 }, // s'arrête à ~15 m → VIRÉ
        { t: 5000, lat: 47.6101, lon: -2.7801, alt: 100, spd: 0.1 }, // parking fin → gardé (dernier)
    ];
    const f = exportPts(pts);
    assert.equal(f.length, 4);
    assert.equal(f[0], pts[0], 'premier point conservé');
    assert.equal(f[f.length - 1], pts[pts.length - 1], 'dernier point conservé');
    assert.ok(!f.includes(pts[1]) && !f.includes(pts[4]), 'points immobiles retirés');
    // Les exports GPX/KML branchent le même filtre (compteurs alignés).
    assert.equal((toGpx({ id: VOL.id, pts }).match(/<trkpt /g) || []).length, 4);
    const kml4 = toKml({ id: VOL.id, pts });
    assert.equal((kml4.match(/<gx:coord>/g) || []).length, 4);
    const arr = (n) => (kml4.split(`<gx:SimpleArrayData name="${n}">`)[1] || '').split('</gx:SimpleArrayData>')[0];
    assert.equal((arr('speed').match(/<gx:value>/g) || []).length, 4, 'vitesses alignées point à point');
    assert.equal((arr('vs').match(/<gx:value>/g) || []).length, 4, 'varios alignés point à point');
    // Vol vide : rien n'explose.
    assert.deepEqual(exportPts([]), []);
});

// Vario dérivé + précision GPS + route prévue (retour pilote 27/09).
test('toGpx/toKml : vario dérivé, précision GPS, route prévue', () => {
    const vol = {
        id: VOL.id,
        pts: [
            { t: VOL.pts[0].t, lat: 48.769, lon: 2.105, alt: 200, spd: 12.5, hdg: 90, acc: 12 },
            { t: VOL.pts[1].t, lat: 48.800, lon: 2.160, alt: 350, spd: 51.4, hdg: 78.3, acc: 9 },
        ],
    };
    const route = [
        { name: 'LFRV', lat: 47.60, lon: -2.70 },
        { name: 'LFEQ', lat: 48.55, lon: -4.28 },
    ];
    const g = toGpx(vol, route);
    // Vario : 150 m en 60 s = 2,5 m/s — extension maison par point.
    assert.ok(g.includes('<mfr:vs>2.5</mfr:vs>'), 'vario dérivé');
    assert.ok(g.includes('<mfr:accuracy>12</mfr:accuracy>'), 'précision GPS');
    // Route prévue en waypoints, avant la trace.
    assert.ok(g.includes('<wpt lat="47.600000" lon="-2.700000"><name>LFRV</name></wpt>'));
    assert.ok(g.includes('<wpt lat="48.550000" lon="-4.280000"><name>LFEQ</name></wpt>'));
    assert.ok(g.indexOf('<wpt ') < g.indexOf('<trk>'), 'wpt avant trk (schéma GPX)');
    // Sans précision enregistrée (anciens vols) : pas d'extension accuracy.
    assert.ok(!toGpx(VOL).includes('mfr:accuracy'));
    const k = toKml(vol, route, '(prévu)');
    assert.ok(k.includes('<gx:SimpleArrayData name="vs">'), 'vario en tableau KML');
    assert.ok(k.includes('(prévu)'), 'libellé route prévue');
    assert.ok(k.includes('fff8bd38'), 'ligne bleue route');
    assert.ok(k.includes('<LineString><coordinates>-2.700000,47.600000,0 -4.280000,48.550000,0'), 'coordonnées route');
});

test('toG1000Csv : structure authentique (prologue + 70 colonnes, unités G1000)', async () => {
    // Avion actif identifiable : le system_id du prologue en dépend (stub
    // localStorage local au test — la flotte y est lue à chaque appel).
    const stub = new Map();
    globalThis.localStorage = {
        getItem: k => (stub.has(k) ? stub.get(k) : null),
        setItem: (k, v) => stub.set(k, String(v)),
        removeItem: k => stub.delete(k),
    };
    const fleetMod = await import('../js/aircraft-fleet.js');
    const ac = fleetMod.addAircraft({ name: 'QA2', registration: 'F-QA02', type: 'WT9-LSA', groundRoll: 150, fiftyFt: 400, safetyMargin: 10 });
    fleetMod.setActiveAircraft(ac.id);
    const c = toG1000Csv(VOL);
    assert.ok(c.includes('airframe_name="WT9-LSA"'), 'nom avion actif dans le prologue');
    const lines = c.trimEnd().split('\n');
    assert.equal(lines.length, 5, 'prologue×3 + 2 points');
    assert.ok(lines[0].startsWith('#airframe_info,'), 'ligne airframe');
    assert.ok(/system_id="[0-9]{1,9}"/.test(lines[0]), 'system_id présent (exigé par flysto)');
    assert.ok(lines[1].startsWith('#yyy-mm-dd,'), 'ligne unités');
    assert.ok(lines[2].startsWith('  Lcl Date,'), 'en-tête 70 colonnes');
    const hdr = lines[2].split(',').map(s => s.trim());
    assert.equal(hdr.length, 70, 'largeur G1000 réelle');
    assert.ok(hdr.includes('E1 CHT6') && hdr.includes('E1 TIT1'), 'colonnes moteur réelles');
    for (const l of lines.slice(3)) assert.equal(l.split(',').length, 70, 'lignes alignées');
    const at = (l, n) => l.split(',').map(s => s.trim())[hdr.indexOf(n)];
    assert.equal(at(lines[3], 'Lcl Date'), new Date(VOL.pts[0].t).toISOString().slice(0, 10));
    assert.match(at(lines[3], 'UTCOfst'), /^[+-]\d{2}:\d{2}$/, 'décalage UTC signé');
    assert.equal(at(lines[3], 'Latitude'), '48.7690000', '7 décimales');
    assert.equal(at(lines[3], 'AltMSL'), '656.2', '200 m → pieds');
    assert.equal(at(lines[3], 'GndSpd'), '24.30', '12,5 m/s → nœuds');
    assert.equal(at(lines[3], 'VSpd'), '492.13', 'vario 2,5 m/s → pieds/min');
    assert.equal(at(lines[3], 'VSpdG'), '492.13');
    assert.equal(at(lines[3], 'TRK'), '90.0');
    assert.equal(at(lines[3], 'HSIS'), 'GPS');
    assert.equal(at(lines[3], 'GPSfix'), '3D');
    assert.equal(at(lines[3], 'E1 RPM'), '', 'colonne moteur vide');
});

// Mention AVION dans les exports de trace (retour pilote 26/09) : type +
// immatriculation de l'avion ACTIF — stub localStorage puis vraies APIs
// de la flotte (le GPX porte metadata+desc, le KML la description).
test('toGpx/toKml portent le type + immatriculation de l avion actif', async () => {
    const stub = new Map();
    globalThis.localStorage = {
        getItem: (k) => (stub.has(k) ? stub.get(k) : null),
        setItem: (k, v) => stub.set(k, String(v)),
        removeItem: (k) => stub.delete(k),
    };
    const fleetMod = await import('../js/aircraft-fleet.js');
    const ac = fleetMod.addAircraft({ name: 'QA', registration: 'F-QA01', type: 'WT9-LSA', groundRoll: 150, fiftyFt: 400, safetyMargin: 10 });
    fleetMod.setActiveAircraft(ac.id);
    const g = toGpx(VOL), k = toKml(VOL);
    assert.ok(g.includes('<metadata><name>WT9-LSA · F-QA01</name></metadata>'), 'metadata GPX');
    assert.ok(g.includes('<desc>WT9-LSA · F-QA01</desc>'), 'desc GPX');
    // flysto.net scanne l'immat dans le NOM de la trace (convention ForeFlight).
    assert.ok(/<name>F-QA01 · vol-\d{8}-\d{4}<\/name>/.test(g), 'nom de trace préfixé immat');
    assert.ok(/<name>F-QA01 · vol-\d{8}-\d{4}<\/name>/.test(k), 'nom KML préfixé immat');
    assert.ok(k.includes('<description>WT9-LSA · F-QA01</description>'), 'description KML');
    // Les trkpts restent intacts (2 points, time/ele inchangés).
    assert.equal((g.match(/<trkpt /g) || []).length, 2);
});
