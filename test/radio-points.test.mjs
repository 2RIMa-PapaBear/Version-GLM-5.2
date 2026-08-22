/* QA du module radio-points (radiophares VOR/NDB + points VFR mondiaux).
 * Fonctions pures + chargeur avec fetch injecté (IndexedDB absent sous
 * Node : les branches de repli sont exercées aussi). */

import test from 'node:test';
import assert from 'node:test';
import { strictEqual, deepStrictEqual, ok, equal } from 'node:assert';
import {
    classifyNavaid, parseRadioPoints, filterBbox, visibleKinds,
    formatFreq, loadRadioPoints, WEEK_MS, LAYER_MIN_ZOOM,
} from '../js/radio-points.js';

test('classifyNavaid : bande kHz = NDB, bande 108-118 MHz = VOR', () => {
    equal(classifyNavaid(355, 1), 'NDB', '355 kHz');
    equal(classifyNavaid(323, 1), 'NDB', '323 kHz');
    equal(classifyNavaid(113.3, 2), 'VOR', '113.3 MHz');
    equal(classifyNavaid(114.3, 2), 'VOR', '114.3 MHz');
    equal(classifyNavaid(400, null), 'NDB', 'sans unité, plage kHz');
    equal(classifyNavaid(112, null), 'VOR', 'sans unité, plage MHz');
});

test('parseRadioPoints : séparation VOR/NDB/VRP et rejet des points invalides', () => {
    const parsed = parseRadioPoints({
        generatedAt: '2026-08-22T12:00:00.000Z',
        counts: { navaids: 4, vrps: 2 },
        navaids: [
            [4, 'LGL', 48.79056, 0.53028, 112.7, 2],
            [2, 'AN', 47.5, 3.2, 355, 1],
            [0, 'X', null, 2, 110, 2],            // lat invalide → rejet
            [1, 'Y', 10, 20, null, 2],            // freq absente → conservé
        ],
        vrps: [
            ['AC', 49.44806, 0.90528, 'FR'],
            ['', 49, 1, 'FR'],                    // sans nom → rejet
        ],
    });
    equal(parsed.vor.length, 2, '2 VOR');
    equal(parsed.ndb.length, 1, '1 NDB');
    equal(parsed.vrp.length, 1, '1 VRP');
    equal(parsed.vrp[0].cc, 'FR', 'pays conservé');
    equal(parsed.vor[1].freq, null, 'freq null tolérée');
    equal(parsed.generatedAt, '2026-08-22T12:00:00.000Z');
    equal(parseRadioPoints({}), null, 'format invalide → null');
    equal(parseRadioPoints(null), null, 'absence → null');
});

test('filterBbox : cadre simple et antiméridien (est < ouest)', () => {
    const pts = [
        { lat: 0, lon: 0 }, { lat: 0, lon: 10 },
        { lat: 0, lon: 178 }, { lat: 0, lon: -178 },
        { lat: 50, lon: 178 },                   // hors latitude
    ];
    deepStrictEqual(filterBbox(pts, -5, -5, 15, 5).map(p => p.lon), [0, 10], 'cadre simple');
    // Cadre traversant ±180° : [170,180] ∪ [-180,-170]
    deepStrictEqual(filterBbox(pts, 170, -5, -170, 5).map(p => p.lon), [178, -178], 'antiméridien');
});

test('visibleKinds : seuils de déclutter', () => {
    deepStrictEqual(visibleKinds(5), { vor: false, ndb: false, vrp: false }, 'z5 : rien');
    deepStrictEqual(visibleKinds(6), { vor: true, ndb: false, vrp: false }, 'z6 : VOR');
    deepStrictEqual(visibleKinds(8), { vor: true, ndb: true, vrp: false }, 'z8 : +NDB');
    deepStrictEqual(visibleKinds(10), { vor: true, ndb: true, vrp: true }, 'z10 : +points VFR');
    ok(LAYER_MIN_ZOOM.vrp > LAYER_MIN_ZOOM.ndb, 'VRP plus tardif que NDB');
});

test('formatFreq : kHz entiers, MHz à 1-2 décimales', () => {
    equal(formatFreq(355, 1), '355 kHz');
    equal(formatFreq(113.3, 2), '113.3 MHz');
    equal(formatFreq(110, 2), '110.0 MHz');
    equal(formatFreq(null, 2), '');
});

test('loadRadioPoints : fetch puis cache mémoire, repli sans réseau', async () => {
    const file = {
        generatedAt: '2026-08-22T00:00:00.000Z',
        navaids: [[1, 'AAA', 1, 2, 110, 2]],
        vrps: [['PP', 3, 4, 'FR']],
    };
    let calls = 0;
    const fetchImpl = async (url) => { calls++; return { ok: true, json: async () => file }; };
    const r1 = await loadRadioPoints({ fetchImpl, now: 1000 });
    equal(r1.vor.length, 1, 'VOR chargé');
    equal(r1.vrp[0].name, 'PP', 'VRP chargé');
    equal(r1.stale, false, 'frais');
    ok(calls === 1, 'un seul fetch');

    // Sans réseau et sans cache (Node) : null silencieux.
    const r2 = await loadRadioPoints({ fetchImpl: () => Promise.reject(new Error('off')), now: 2000 });
    equal(r2, null, 'échec sans cache → null');

    // URL : suffixe anti-cache après une semaine (vérifiée sur le fetch).
    let seenUrl = '';
    const fetchUrl = async (url) => { seenUrl = url; return { ok: true, json: async () => file }; };
    await loadRadioPoints({ fetchImpl: fetchUrl, now: 1000 });
    ok(!seenUrl.includes('?t='), 'frais : pas de contournement');
    await loadRadioPoints({ fetchImpl: fetchUrl, now: 1000 + WEEK_MS + 1 });
    ok(seenUrl.includes('?t='), 'périmé : contournement cache HTTP');
});

test('le fichier data/radio-points.json généré est conforme et mondial', async () => {
    const { readFile } = await import('node:fs/promises');
    const json = JSON.parse(await readFile(new URL('../data/radio-points.json', import.meta.url), 'utf8'));
    const parsed = parseRadioPoints(json);
    ok(parsed, 'parsable');
    ok(parsed.vor.length > 2000, `VOR mondiaux plausibles (${parsed.vor.length})`);
    ok(parsed.ndb.length > 1000, `NDB mondiaux plausibles (${parsed.ndb.length})`);
    ok(parsed.vrp.length > 5000, `points VFR mondiaux plausibles (${parsed.vrp.length})`);
    ok(parsed.generatedAt, 'horodatage présent');
    // Points VFR français présents (échantillon Pays de la Loire).
    const fr = parsed.vrp.filter(p => p.cc === 'FR');
    ok(fr.length > 400, `points VFR France plausibles (${fr.length})`);
});
