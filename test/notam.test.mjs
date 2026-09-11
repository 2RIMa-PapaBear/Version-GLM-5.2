// NOTAM — helpers purs (test local 10/09, PIB SOFIA via relais).
import test from 'node:test';
import assert from 'node:assert/strict';
import { notamTitle, notamPeriod, notamBody, buildPibRequest } from '../js/notam.js';

const N = {
    series: 'P', number: 3953, year: 25,
    qLine: { code23: 'OB' },
    startValidityFormat: '25 11 2025 14:01', endValidityFormat: '25 09 2026 19:00',
    itemD: '0600-1900',
    itemE: 'OBST ORIGINAL',
    multiLanguage: { itemE: 'OBST TRADUIT FR' },
};

test('notamTitle : série/numéro/année + code Q', () => {
    assert.equal(notamTitle(N), 'P 3953/25 · OB');
    assert.equal(notamTitle({ series: 'A', number: 123, year: 2026 }), 'A 123/26');
});

test('notamPeriod : validités formatées + horaires item D', () => {
    assert.equal(notamPeriod(N), '25 11 2025 14:01 → 25 09 2026 19:00 (0600-1900)');
    assert.equal(notamPeriod({ startValidityFormat: 'x', endValidityFormat: 'y' }), 'x → y');
});

test('notamBody : traduction FR prioritaire, repli sur l original', () => {
    assert.equal(notamBody(N), 'OBST TRADUIT FR');
    assert.equal(notamBody({ itemE: 'ORIGINAL SEUL' }), 'ORIGINAL SEUL');
});

test('buildPibRequest : route nettoyée + paramètres par défaut', () => {
    const r = buildPibRequest(['lfrn', ' LFAT ', 'XX', 'K6RE']);
    assert.deepEqual(r.route, ['LFRN', 'LFAT', 'K6RE'], 'minuscules normalisées, invalide écarté');
    assert.equal(r.flLower, 0); assert.equal(r.flUpper, 999);
    assert.equal(r.widthNm, 15); assert.equal(r.radiusAdNm, 30);
    assert.ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(r.validFrom));
});

// Groupes complets + filtre VFR + FL du plan (retours pilote 10/09)
import { isVfrNotam } from '../js/notam.js';

test('isVfrNotam : IFR pur écarté, V et IV conservés, absent toléré', () => {
    assert.equal(isVfrNotam({ qLine: { traffic: 'V' } }), true);
    assert.equal(isVfrNotam({ qLine: { traffic: 'IV' } }), true);
    assert.equal(isVfrNotam({ qLine: { traffic: 'I' } }), false, 'NOTAM IFR pur : exclu');
    assert.equal(isVfrNotam({ qLine: {} }), true, 'sans info traffic : conservé (prudence)');
    assert.equal(isVfrNotam({}), true);
});

test('buildPibRequest : traffic V envoyé au serveur + FL du plan', () => {
    const r = buildPibRequest(['LFRV', 'LFRC'], { flUpper: 45 });
    assert.equal(r.traffic, 'V');
    assert.equal(r.flUpper, 45);
    assert.equal(buildPibRequest(['LFRV']).flUpper, 999);
});

// FIR aplati + legs des points de passage (retour pilote 10/09)
import { flattenFirList, waypointLegs } from '../js/notam.js';

test('flattenFirList : catégories FIR imbriquées → liste plate', () => {
    const fir = [{ sortedNotamsByImpactedAerodromes: [
        { code: 'EGTT', sortedNotamsByPurpose: [
            { purpose: 'NBO', notam: [{ series: 'U', number: 1, qLine: { traffic: 'V' } }] },
            { purpose: 'BO', notam: [{ series: 'U', number: 2, qLine: { traffic: 'V' } }] },
        ] },
        { code: 'LFRR', sortedNotamsByPurpose: [{ purpose: 'NBO', notam: [{ series: 'A', number: 3, qLine: { traffic: 'V' } }] }] },
    ] }];
    const flat = flattenFirList(fir);
    assert.equal(flat.length, 3);
    assert.deepEqual(flat.map(n => n.number), [1, 2, 3]);
    assert.deepEqual(flattenFirList([]), []);
    assert.deepEqual(flattenFirList(null), []);
});

test('waypointLegs : tronçons partant de chaque point intermédiaire', () => {
    assert.deepEqual(waypointLegs(['LFRV', 'LFRP', 'LFEB', 'LFRW', 'LFOM', 'LFRC']),
        [['LFRP', 'LFEB'], ['LFEB', 'LFRW'], ['LFRW', 'LFOM'], ['LFOM', 'LFRC']]);
    assert.deepEqual(waypointLegs(['LFRV', 'LFRC']), [], 'A→B direct : pas de point de passage');
    assert.deepEqual(waypointLegs([]), []);
});

test('notamPeriod : repli sur dates ISO brutes (NOTAM FIR sans champs formatés)', () => {
    const p = notamPeriod({ startValidity: '2026-09-10T10:11:00Z', endValidity: '2026-09-12T10:11:00Z' });
    assert.ok(/10\/09 10:11Z → 12\/09 10:11Z/.test(p), p);
});

// Mode vol local : DMS SOFIA + collecte zone (retour pilote 10/09)
import { decToSofiaDms, collectFlatLocal } from '../js/notam.js';

test('decToSofiaDms : décimal → « 4739N » / « 00243W »', () => {
    assert.deepEqual(decToSofiaDms(47.66, -2.72), { lat: '4740N', long: '00243W' });
    assert.deepEqual(decToSofiaDms(48.0, 2.0), { lat: '4800N', long: '00200E' });
    assert.deepEqual(decToSofiaDms(-0.99, 179.99), { lat: '0059S', long: '17959E' });
    // report de minute : 47.999999 → 48°00'
    assert.equal(decToSofiaDms(47.999999, 0).lat, '4800N');
});

test('collectFlatLocal : zone 30 NM + FIR + Autres, annotés', () => {
    const pib = { listnotams: {
        ADSur: { obstacles: [{ id: 1, qLine: { traffic: 'V' } }, { id: 2, qLine: { traffic: 'I' } }] },
        FIR: {},
        Other: { autres_info: [{ id: 3, qLine: { traffic: 'V' } }] },
    } };
    const flat = collectFlatLocal(pib, ['LFRV']);
    assert.equal(flat.length, 2, 'le NOTAM IFR pur est écarté');
    assert.ok(flat[0]._grp.startsWith('Zone 30 NM'));
    assert.ok(flat[1]._grp.startsWith('Autres'));
});

// Vol local : anneau des terrains à moins de 30 NM (retour pilote 10/09)
import { airfieldsWithinNm } from '../js/notam.js';

const APS = [
    { icao: 'LFRV', lat: 47.66, lon: -2.72 },   // centre
    { icao: 'LFRN', lat: 47.75, lon: -2.07 },   // ~26 NM
    { icao: 'LFEB', lat: 48.05, lon: -2.63 },   // ~24 NM
    { icao: 'LFOT', lat: 47.80, lon: -4.42 },   // ~68 NM → hors zone
];

test('airfieldsWithinNm : centre + voisins 30 NM, hors zone écarté, tri par distance', () => {
    const ring = airfieldsWithinNm(47.66, -2.72, 30, APS);
    assert.deepEqual(ring, ['LFRV', 'LFEB', 'LFRN'], 'centre en tête, LFOT écarté');
    assert.deepEqual(airfieldsWithinNm(47.66, -2.72, 30, []), []);
    // plafond du nombre de terrains
    const many = Array.from({ length: 20 }, (_, i) => ({ icao: 'LF' + String(i).padStart(2, '0'), lat: 47.7, lon: -2.7 + i * 0.01 }));
    assert.ok(airfieldsWithinNm(47.66, -2.72, 30, many, 5).length <= 5);
});

// Rayon zone locale (retour pilote 11/09) : 20 par défaut, borné 10-40
import { clampRadiusNm, NOTAM_RADIUS_DEFAULT } from '../js/notam.js';

test('clampRadiusNm : defaut 20, bornes 10-40', () => {
    assert.equal(NOTAM_RADIUS_DEFAULT, 20);
    assert.equal(clampRadiusNm('15'), 15);
    assert.equal(clampRadiusNm(7), 10);
    assert.equal(clampRadiusNm(99), 40);
    assert.equal(clampRadiusNm('abc'), 20);
    assert.equal(clampRadiusNm(null), 20);
});
