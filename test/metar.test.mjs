/* METAR.js — module de décodage UNIQUE (W11, audits 27/09 + 01/10).
 * Vent souple (brut + formaté), visibilité (o4 : vide = inconnue),
 * RVR (W12 : jamais extraite avant). Pur — testé sous Node. `npm test`. */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseWindLoose, parseWindGroupToKt, parseVisiToMeters, parseRvr } from '../js/metar.js';

describe('parseWindLoose — brut ET formaté (W11)', () => {
    test('groupe brut KT', () => {
        const w = parseWindLoose('21006KT 170V250');
        assert.equal(w.dir, 210); assert.equal(w.speed, 6);
        assert.equal(w.varFrom, 170); assert.equal(w.varTo, 250);
    });
    test('chaîne formatée du panneau : « 210° 06KT 170V250 »', () => {
        const w = parseWindLoose('210° 06KT 170V250');
        assert.equal(w.dir, 210); assert.equal(w.speed, 6);
        assert.equal(w.varFrom, 170); assert.equal(w.varTo, 250);
    });
    test('« 170° 15KT » simple', () => {
        const w = parseWindLoose('170° 15KT');
        assert.equal(w.dir, 170); assert.equal(w.speed, 15); assert.equal(w.gust, null);
    });
    test('« VRB 10G20KT » formatée', () => {
        const w = parseWindLoose('VRB 10G20KT');
        assert.equal(w.variable, true); assert.equal(w.dir, null);
        assert.equal(w.speed, 10); assert.equal(w.gust, 20);
    });
    test('variation COLLÉE derrière l’unité (formats affichés anciens)', () => {
        const w = parseWindLoose('210° 06KT170V250');
        assert.equal(w.varFrom, 170); assert.equal(w.varTo, 250);
    });
    test('MPS converti : « 12012MPS » = 23 kt (l’ancien parseur axial lisait 12 !)', () => {
        const w = parseWindLoose('12012MPS');
        assert.equal(w.speed, 23);
    });
    test('sans unité → null (pas de vent fantôme)', () => {
        assert.equal(parseWindLoose('90 8'), null);
        assert.equal(parseWindLoose(''), null);
        assert.equal(parseWindLoose(null), null);
    });
    test('VRB brut → dir null (le sous-ensemble axial garde sa forme)', () => {
        const w = parseWindLoose('VRB03KT');
        assert.deepEqual([w.dir, w.speed], [null, 3]);
    });
});

describe('parseVisiToMeters — vide = INCONNUE (o4, audit 01/10)', () => {
    test('chaîne vide / blanche → null (plus de 10 km implicite)', () => {
        assert.equal(parseVisiToMeters(''), null);
        assert.equal(parseVisiToMeters('   '), null);
        assert.equal(parseVisiToMeters(null), null);
    });
    test('valeurs inchangées : 9999/CAVOK/8000/SM', () => {
        assert.equal(parseVisiToMeters('9999'), 10000);
        assert.equal(parseVisiToMeters('CAVOK'), 10000);
        assert.equal(parseVisiToMeters('8000'), 8000);
        assert.equal(parseVisiToMeters('1 1/2SM'), 2414);
        assert.equal(parseVisiToMeters('M1/4SM'), 402);   // borne publiée
    });
});

describe('parseRvr — portée visuelle de piste (W12, audit 27/09)', () => {
    test('R26/0600 simple', () => {
        const r = parseRvr('LFOT 011230Z 24012KT 3000 R26/0600 OVC008 12/10 Q1013');
        assert.equal(r.length, 1);
        assert.deepEqual(r[0], { rwy: '26', minM: 600, maxM: 600, lessThan: false, moreThan: false, trend: null });
    });
    test('variable : R26L/0600V1200', () => {
        const r = parseRvr('... R26L/0600V1200 ...');
        assert.equal(r[0].rwy, '26L');
        assert.equal(r[0].minM, 600); assert.equal(r[0].maxM, 1200);
    });
    test('bornes M/P + tendance /U', () => {
        const m = parseRvr('R26/M0050/U');
        assert.equal(m[0].lessThan, true); assert.equal(m[0].minM, 50);
        assert.equal(m[0].trend, 'U');
        const p = parseRvr('R26/P2000');
        assert.equal(p[0].moreThan, true); assert.equal(p[0].minM, 2000);
    });
    test('plusieurs pistes, rien sans Rxx/', () => {
        const r = parseRvr('R26/0800 R08L/1100V1500 BKN005');
        assert.equal(r.length, 2);
        assert.equal(parseRvr('3000 BKN008 Q1013').length, 0);
    });
});
