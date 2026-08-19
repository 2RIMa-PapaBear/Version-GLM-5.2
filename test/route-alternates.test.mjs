// Tests de la géométrie « alternates le long de la route » et de la détection
// humidité/contamination par tokens METAR (évaluée pour la page 3 du log de nav).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _distToSegmentNm } from '../js/alternates.js';
import { _wetFromTokens } from '../js/takeoff-performance.js';

// ---------------------------------------------------------------- géométrie
// Segment ouest → est le long de l'équateur : 1° de lon = 60 NM.
const A = { lat: 0, lon: 0 }, B = { lat: 0, lon: 2 };

test('point au nord d\'un segment est-ouest → à gauche (~ 60 NM)', () => {
    const r = _distToSegmentNm({ lat: 1, lon: 1 }, A, B);
    assert.ok(Math.abs(r.nm - 60) < 1, `nm=${r.nm}`);
    assert.equal(r.side, -1);
});

test('point au sud d\'un segment est-ouest → à droite (~ 30 NM)', () => {
    const r = _distToSegmentNm({ lat: -0.5, lon: 0.5 }, A, B);
    assert.ok(Math.abs(r.nm - 30) < 1, `nm=${r.nm}`);
    assert.equal(r.side, 1);
});

test('point sur la route → distance ~0', () => {
    const r = _distToSegmentNm({ lat: 0, lon: 1 }, A, B);
    assert.ok(r.nm < 0.5, `nm=${r.nm}`);
});

test('point au-delà de l\'extrémité B → distance à B (pas perpendiculaire)', () => {
    // 1° plus à l'est que B, décalé de 0.25° au sud → dist ≈ sqrt(60² + 15²) ≈ 61.8.
    const r = _distToSegmentNm({ lat: -0.25, lon: 3 }, A, B);
    assert.ok(Math.abs(r.nm - 61.8) < 1.5, `nm=${r.nm}`);
});

test('point au-delà de l\'extrémité A → distance à A', () => {
    const r = _distToSegmentNm({ lat: 0, lon: -1 }, A, B);
    assert.ok(Math.abs(r.nm - 60) < 1, `nm=${r.nm}`);
});

test('segment oblique : côté cohérent avec le cap', () => {
    // Route vers le nord (0,0)→(2,0) ; un point à l'est est à DROITE du cap nord.
    const r = _distToSegmentNm({ lat: 1, lon: 1 }, { lat: 0, lon: 0 }, { lat: 2, lon: 0 });
    assert.equal(r.side, 1);
    assert.ok(Math.abs(r.nm - 60) < 1, `nm=${r.nm}`);
});

// ---------------------------------------------------------------- tokens METAR
test('METAR sec (FEW/TEMPS nc) → ni humide ni contaminé', () => {
    assert.deepEqual(_wetFromTokens('LFPB 190830Z 28012KT 9999 FEW035 18/12 Q1013 NOSIG'),
        { wet: false, contaminated: false });
});

test('pluie modérée RA → humide seulement', () => {
    assert.deepEqual(_wetFromTokens('LFRM 190830Z 28012KT 6000 RA BKN010 15/11 Q1013'),
        { wet: true, contaminated: false });
});

test('bruine DZ et brume BR → humide', () => {
    assert.deepEqual(_wetFromTokens('AAAA 190830Z 00000KT 3000 DZ BR OVC005 10/09 Q1015'),
        { wet: true, contaminated: false });
});

test('pluie forte +RA → contaminé', () => {
    assert.deepEqual(_wetFromTokens('AAAA 190830Z 28020KT 4000 +RA BKN012 16/12 Q1008'),
        { wet: false, contaminated: true });
});

test('averses SHRA / TSRA / FZRA → contaminé', () => {
    for (const wx of ['SHRA', 'TSRA', '-SHRA', 'FZRA']) {
        assert.equal(_wetFromTokens(`AAAA 190830Z 28015KT 5000 ${wx} BKN015 14/10 Q1011`).contaminated, true, wx);
    }
});

test('neige SN (toute intensité), grêle GR, grésil GS → contaminé', () => {
    for (const wx of ['SN', '-SN', '+SN', 'GR', 'GS', 'SG']) {
        assert.equal(_wetFromTokens(`AAAA 190830Z 28010KT 5000 ${wx} OVC020 02/01 Q1020`).contaminated, true, wx);
    }
});

test('NOSIG / CAVOK / nuages ne déclenchent rien', () => {
    for (const extra of ['NOSIG', 'CAVOK', 'SCT045 BKN120', 'VRB03KT']) {
        const r = _wetFromTokens(`AAAA 190830Z ${extra} 18/10 Q1013`);
        assert.deepEqual(r, { wet: false, contaminated: false }, extra);
    }
});
