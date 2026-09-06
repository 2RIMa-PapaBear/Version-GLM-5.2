// Tests de la géométrie « alternates le long de la route », de la
// substitution METAR (terrain sans émission → station la plus proche) et de
// la détection humidité/contamination par tokens METAR (page 3 du log de nav).
import test from 'node:test';
import { ok, equal } from 'node:assert';
import assert from 'node:assert/strict';
import { _distToSegmentNm, _attachMetars, _pickSpread } from '../js/alternates.js';
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

// ---------------------------------------------------------------- substitution METAR
const METARS = { LFPB: 'LFPB 260800Z 27010KT 9999 FEW040 22/12 Q1018', LFRM: 'LFRM 260800Z 00000KT 8000 SCT030 20/11 Q1017' };
const POOL = [
    { code: 'LFPB', lat: 48.97, lon: 2.44 },
    { code: 'LFRM', lat: 47.95, lon: 0.26 },
];

test('terrain émetteur → son propre METAR, sans marque de substitution', () => {
    const rows = _attachMetars([{ code: 'LFPB', name: 'LE BOURGET', lat: 48.97, lon: 2.44, offsetNm: 3, side: 1 }], METARS, POOL);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].raw, METARS.LFPB);
    assert.equal(rows[0].metarFrom, null);
    assert.equal(rows[0].metarDistNm, null);
});

test('terrain SANS METAR (petit terrain sans code) → METAR de la station la plus proche, marquée', () => {
    const rows = _attachMetars([{ code: '', name: 'LOGNES', lat: 48.83, lon: 2.63, offsetNm: 5, side: -1 }], METARS, POOL);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].metarFrom, 'LFPB');          // Le Bourget est plus proche que Le Mans
    assert.equal(rows[0].raw, METARS.LFPB);
    assert.ok(rows[0].metarDistNm > 5 && rows[0].metarDistNm < 15, `dist=${rows[0].metarDistNm}`);
});

test('aucune station émettrice disponible → candidat écarté', () => {
    assert.deepEqual(_attachMetars([{ code: '', name: 'X', lat: 48, lon: 2, offsetNm: 1, side: 1 }], {}, []), []);
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


// ---- Répartition le long du trajet (retour pilote 06/09) ----------------------
test('_pickSpread : la sélection couvre le MILIEU, pas seulement les extrémités', () => {
    const VFR = { cat: { cat: 'VFR' } }, MVFR = { cat: { cat: 'MVFR' } };
    // Route de 240 NM. Grappe dense de VFR sur le 1er et le dernier tronçon
    // (8 terrains), milieu plus pauvre (3 MVFR sur les tronçons 3-4).
    const rows = [
        { code: 'AAAA', ...VFR, offsetNm: 3, atdNm: 5 },
        { code: 'AAAB', ...VFR, offsetNm: 4, atdNm: 10 },
        { code: 'AAAC', ...VFR, offsetNm: 5, atdNm: 15 },
        { code: 'AAAD', ...VFR, offsetNm: 6, atdNm: 20 },
        { code: 'ZZZA', ...VFR, offsetNm: 3, atdNm: 220 },
        { code: 'ZZZB', ...VFR, offsetNm: 4, atdNm: 228 },
        { code: 'ZZZC', ...VFR, offsetNm: 5, atdNm: 234 },
        { code: 'ZZZD', ...VFR, offsetNm: 6, atdNm: 238 },
        { code: 'MMMM', ...MVFR, offsetNm: 8, atdNm: 110 },
        { code: 'MMMN', ...MVFR, offsetNm: 9, atdNm: 130 },
        { code: 'MMMS', ...MVFR, offsetNm: 10, atdNm: 150 },
    ];
    const picks = _pickSpread(rows, 6, 240);
    // Au moins un alternate du tiers CENTRAL (80-160 NM) est retenu…
    ok(picks.some(r => r.atdNm >= 80 && r.atdNm <= 160), 'le milieu de route est couvert');
    // …et le résultat est dans l'ordre du vol.
    const pos = picks.map(r => r.atdNm);
    ok(pos.every((v, i) => i === 0 || v > pos[i - 1]), 'ordre du vol (positions croissantes)');
    ok(picks.length <= 6, 'max 6');
});

test('_pickSpread : tronçon sans candidat — le complément prend les meilleurs restants', () => {
    const VFR = { cat: { cat: 'VFR' } };
    const rows = [
        { code: 'AAAA', ...VFR, offsetNm: 2, atdNm: 10 },
        { code: 'BBBB', ...VFR, offsetNm: 3, atdNm: 70 },
        { code: 'CCCC', ...VFR, offsetNm: 4, atdNm: 190 },
        { code: 'DDDD', ...VFR, offsetNm: 5, atdNm: 12 },
        { code: 'EEEE', ...VFR, offsetNm: 6, atdNm: 72 },
    ];
    const picks = _pickSpread(rows, 6, 200);
    equal(picks.length, 5, 'tout est retenu quand il y a de la place');
    ok(picks.some(r => r.code === 'DDDD') && picks.some(r => r.code === 'AAAA'), 'complément après le 1er passage');
});
