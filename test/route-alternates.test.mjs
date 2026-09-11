// Tests de la géométrie « alternates le long de la route », de la
// substitution METAR (terrain sans émission → station la plus proche) et de
// la détection humidité/contamination par tokens METAR (page 3 du log de nav).
import test from 'node:test';
import { ok, equal } from 'node:assert';
import assert from 'node:assert/strict';
import { _distToSegmentNm, _attachMetars, _pickEvenSpread } from '../js/alternates.js';
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


// ---- Répartition régulière le long du trajet (retour pilote 11/09 :
// 8 terrains les plus proches, espacés régulièrement, météo sans rôle) --------
test('_pickEvenSpread : la sélection couvre le MILIEU, pas seulement les extrémités', () => {
    // Route de 240 NM → 8 ancres aux centres de secteur : 15, 45, …, 225 NM.
    // Grappe dense de VFR sur les extrémités, milieu plus pauvre (3 MVFR).
    const rows = [
        { code: 'AAAA', offsetNm: 3, atdNm: 5 },
        { code: 'AAAB', offsetNm: 4, atdNm: 10 },
        { code: 'AAAC', offsetNm: 5, atdNm: 15 },
        { code: 'AAAD', offsetNm: 6, atdNm: 20 },
        { code: 'ZZZA', offsetNm: 3, atdNm: 220 },
        { code: 'ZZZB', offsetNm: 4, atdNm: 228 },
        { code: 'ZZZC', offsetNm: 5, atdNm: 234 },
        { code: 'ZZZD', offsetNm: 6, atdNm: 238 },
        { code: 'MMMM', offsetNm: 8, atdNm: 110 },
        { code: 'MMMN', offsetNm: 9, atdNm: 130 },
        { code: 'MMMS', offsetNm: 10, atdNm: 150 },
    ];
    const picks = _pickEvenSpread(rows, 8, 240);
    // Le tiers CENTRAL (80-160 NM) est couvert malgré la grappe VFR des extrémités…
    ok(picks.filter(r => r.atdNm >= 80 && r.atdNm <= 160).length >= 2, 'le milieu de route est couvert');
    // …et le résultat est dans l'ordre du vol.
    const pos = picks.map(r => r.atdNm);
    ok(pos.every((v, i) => i === 0 || v > pos[i - 1]), 'ordre du vol (positions croissantes)');
    ok(picks.length <= 8, 'max 8');
});

test('_pickEvenSpread : une grappe dense ne colonise pas plusieurs secteurs', () => {
    // 6 terrains quasi confondus près du départ + 1 au milieu + 1 vers la fin.
    // L'ancien complément « tous tronçons confondus » agglutinait la grappe ;
    // les ancres ne prennent qu'un terrain chacune → 2 au plus pour la grappe.
    const rows = [
        { code: 'GR01', offsetNm: 2, atdNm: 10 },
        { code: 'GR02', offsetNm: 3, atdNm: 11 },
        { code: 'GR03', offsetNm: 4, atdNm: 12 },
        { code: 'GR04', offsetNm: 5, atdNm: 13 },
        { code: 'GR05', offsetNm: 6, atdNm: 14 },
        { code: 'GR06', offsetNm: 7, atdNm: 15 },
        { code: 'MID1', offsetNm: 4, atdNm: 130 },
        { code: 'END1', offsetNm: 5, atdNm: 200 },
    ];
    const picks = _pickEvenSpread(rows, 8, 200);
    equal(picks.filter(r => r.code.startsWith('GR')).length, 2, 'la grappe fournit 2 alternates au plus (secteurs 1-2)');
    ok(picks.some(r => r.code === 'MID1') && picks.some(r => r.code === 'END1'), 'milieu et fin couverts');
});

test('_pickEvenSpread : la météo ne joue AUCUN rôle — le plus proche de l’ancre gagne', () => {
    // Dans le même secteur : un IFR à 2 NM de la route et un VFR à 10 NM.
    // L'ancien tri par viabilité préférait le VFR ; la sélection pilote veut
    // le terrain le PLUS PROCHE, sa catégorie n'est qu'une info affichée.
    const rows = [
        { code: 'IFR1', cat: { cat: 'IFR' }, offsetNm: 2, atdNm: 120 },
        { code: 'VFR1', cat: { cat: 'VFR' }, offsetNm: 10, atdNm: 125 },
    ];
    const picks = _pickEvenSpread(rows, 8, 200);
    ok(picks.some(r => r.code === 'IFR1'), 'le terrain le plus proche est retenu même IFR');
});

test('_pickEvenSpread : moins de candidats que de secteurs → tout est retenu', () => {
    const rows = [
        { code: 'AAAA', offsetNm: 2, atdNm: 10 },
        { code: 'BBBB', offsetNm: 3, atdNm: 70 },
        { code: 'CCCC', offsetNm: 4, atdNm: 130 },
        { code: 'DDDD', offsetNm: 5, atdNm: 190 },
    ];
    const picks = _pickEvenSpread(rows, 8, 200);
    equal(picks.length, 4, 'chaque terrain prend une ancre, aucun rejet');
});

test('_pickEvenSpread : alternates équidistants sur trajet équilibré', () => {
    // Un terrain tous les 25 NM sur 200 NM : les 8 plus proches des 8 ancres
    // (12.5, 37.5, …, 187.5) sont exactement un par secteur.
    const rows = Array.from({ length: 8 }, (_, i) => ({ code: `T${i}`, offsetNm: 5, atdNm: 12.5 + i * 25 }));
    const picks = _pickEvenSpread(rows, 8, 200);
    equal(picks.length, 8, '8 terrains retenus');
    const gaps = picks.slice(1).map((r, i) => r.atdNm - picks[i].atdNm);
    ok(gaps.every(g => Math.abs(g - 25) < 1), `espacement régulier (~25 NM) : ${gaps.join(',')}`);
});
