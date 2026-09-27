// Tests du calcul des vents en altitude (js/winds-aloft.js) —
// getWindAtAltitude et weightedMeanWind sont purs ; fetchWindsAloftMulti
// (réseau) est testé avec un stub de fetch sur la VRAIE forme de la
// réponse Open-Meteo (hourly + surfaces isobariques — B1/M1, audit
// 27/09 : les anciens stubs encodaient windspeed_<n>m sous `current`,
// une réponse que l'API ne produit JAMAIS au-dessus de 1000 m).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { getWindAtAltitude, weightedMeanWind, fetchWindsAloftMulti, fetchWindsAloft, _clearCache } from '../js/winds-aloft.js';

const W = (altFt, speedKt, dir) => ({ altFt, speedKt, dir });
// Surfaces isobariques (altFt = altitude pression ISA ≈ AMSL, cf. HPA_TO_FT).
const WINDS = [W(363, 8, 180), W(1775, 14, 190), W(4786, 24, 210)];

test('getWindAtAltitude : interpolation directe entre surfaces AMSL (plus de conversion AGL)', () => {
    // 3000 ft AMSL : entre 1775 (14 kt / 190°) et 4786 (24 kt / 210°).
    const t = (3000 - 1775) / (4786 - 1775);
    const at = getWindAtAltitude(WINDS, 3000);
    assert.equal(at.speedKt, Math.round(14 + 10 * t));
    assert.equal(at.dir, Math.round(190 + 20 * t));
    // Référentiel unique : une propriété groundElevFt résiduelle (ancien
    // format en cache) ne décale PLUS la lecture (B1 : niveaux ≈ AMSL).
    const w = WINDS.map(x => ({ ...x }));
    w.groundElevFt = 1500;
    assert.deepEqual(getWindAtAltitude(w, 3000), at);
});

test('getWindAtAltitude : bornes (sous la 1re surface, au-dessus de la dernière)', () => {
    assert.deepEqual(getWindAtAltitude(WINDS, 100), { speedKt: 8, dir: 180 });
    assert.deepEqual(getWindAtAltitude(WINDS, 20000), { speedKt: 24, dir: 210 });
});

test('getWindAtAltitude : interpolation circulaire 350°→010° passe par 000°', () => {
    const w = [W(363, 10, 350), W(1775, 10, 10)];
    const mid = getWindAtAltitude(w, (363 + 1775) / 2);
    assert.equal(mid.dir, 0);
});

test('getWindAtAltitude : entrées invalides', () => {
    assert.equal(getWindAtAltitude([], 3000), null);
    assert.equal(getWindAtAltitude(null, 3000), null);
});

describe('weightedMeanWind — moyenne vectorielle pondérée (fiche 20)', () => {
    test('vent unique : identité', () => {
        assert.deepEqual(
            weightedMeanWind([{ wind: { speedKt: 12, dir: 270 }, weight: 40 }]),
            { speedKt: 12, dir: 270 });
    });

    test('vents opposés égaux : vitesse nulle (pas de vent de travers fantôme)', () => {
        const w = weightedMeanWind([
            { wind: { speedKt: 10, dir: 270 }, weight: 50 },
            { wind: { speedKt: 10, dir: 90 }, weight: 50 },
        ]);
        assert.equal(w.speedKt, 0);
    });

    test('diagonale : ouest + nord = de nord-ouest', () => {
        const w = weightedMeanWind([
            { wind: { speedKt: 10, dir: 270 }, weight: 1 },
            { wind: { speedKt: 10, dir: 360 }, weight: 1 },
        ]);
        assert.equal(w.speedKt, 7);            // hypot(10,-10)/2 = 7.07
        assert.equal(w.dir, 315);              // flux vers le sud-est → du nord-ouest
    });

    test('pondération par la distance : 3/4 contre 1/4 de face', () => {
        const w = weightedMeanWind([
            { wind: { speedKt: 20, dir: 270 }, weight: 3 },
            { wind: { speedKt: 20, dir: 90 }, weight: 1 },
        ]);
        assert.equal(w.speedKt, 10);
        assert.equal(w.dir, 270);
    });

    test('tronçons sans vent ignorés ; aucun valable → null', () => {
        assert.equal(weightedMeanWind([{ wind: null, weight: 40 }, { wind: null, weight: 10 }]), null);
        assert.equal(weightedMeanWind([]), null);
        // Un tronçon sans vent ne dilue pas les autres : le vent du
        // tronçon connu reste le vent du plan.
        assert.deepEqual(
            weightedMeanWind([{ wind: null, weight: 99 }, { wind: { speedKt: 8, dir: 45 }, weight: 1 }]),
            { speedKt: 8, dir: 45 });
    });
});

describe('fetchWindsAloftMulti — isobare/horaire (B1+M1, audit 27/09)', () => {
    // Réponse Open-Meteo RÉELLE en forme : hourly.time (UTC) + une série
    // par surface isobarique. 10 kt/270° à 10 h, 20 kt/280° à 11 h,
    // 30 kt/290° à 12 h — la sélection horaire (M1) se lit sur speedKt.
    const LOC = (s10, s11, s12, dir, underground1000 = false) => ({
        hourly: {
            time: ['2026-09-27T10:00', '2026-09-27T11:00', '2026-09-27T12:00'],
            windspeed_1000hPa: [underground1000 ? null : s10, underground1000 ? null : s11, underground1000 ? null : s12],
            winddirection_1000hPa: [dir, dir, dir],
            windspeed_975hPa: [s10, s11, s12],
            winddirection_975hPa: [dir, dir, dir],
            windspeed_700hPa: [s10 * 2, s11 * 2, s12 * 2],
            winddirection_700hPa: [dir, dir, dir],
        },
    });
    const T1030 = Date.UTC(2026, 8, 27, 10, 30);
    const T1130 = Date.UTC(2026, 8, 27, 11, 30);

    test('une seule requête, URL isobare/horaire, réponse alignée, doublon, cache', async () => {
        _clearCache();
        const calls = [];
        const orig = globalThis.fetch;
        globalThis.fetch = async (url) => {
            calls.push(String(url));
            return { ok: true, status: 200, json: async () => [
                LOC(18.52, 37.04, 55.56, 270),   // Brest : 10/20/30 kt selon l'heure
                LOC(0, 18.52, 37.04, 90),        // Paris
            ] };
        };
        try {
            const A = { lat: 48.45, lon: -4.42 };
            const B = { lat: 48.85, lon: 2.35 };
            // A répété : même clé (0.1° + créneau) → une seule location.
            const out = await fetchWindsAloftMulti([A, B, A], T1130);

            assert.equal(calls.length, 1, 'une seule requête HTTP');
            assert.ok(calls[0].includes('hourly=windspeed_1000hPa'), 'variables isobariques (B1)');
            assert.ok(calls[0].includes('timezone=UTC'));
            assert.ok(!calls[0].includes('current='), 'plus de current= (null silencieux ≥1000 m)');
            assert.ok(calls[0].includes('latitude=48.45,48.85'), 'points regroupés en une URL multi-points');
            assert.equal(out.length, 3);
            // M1 : targetMs 11:30 → créneau 11 h → 20 kt (pas 10 kt « now »).
            const b975 = out[0].find(w => w.altFt === 1061);
            assert.equal(b975.speedKt, 20);
            assert.equal(b975.dir, 270);
            assert.strictEqual(out[0], out[2], 'le doublon partage le même objet décodé');

            // Même créneau : servi par le cache session, aucune requête.
            await fetchWindsAloftMulti([A, B, A], T1130);
            assert.equal(calls.length, 1, 'cache session sans nouvelle requête');
        } finally {
            globalThis.fetch = orig;
        }
    });

    test('M1 : deux créneaux horaires, deux lectures différentes (une seule réponse)', async () => {
        _clearCache();
        const calls = [];
        const orig = globalThis.fetch;
        globalThis.fetch = async (url) => {
            calls.push(String(url));
            return { ok: true, status: 200, json: async () => LOC(18.52, 37.04, 55.56, 180) };
        };
        try {
            const P = { lat: 47.25, lon: -1.55 };   // Nantes
            const h1030 = await fetchWindsAloft(P.lat, P.lon, T1030);
            const h1130 = await fetchWindsAloft(P.lat, P.lon, T1130);
            // Même URL (l'heure ne part pas sur le réseau) mais décodage
            // par créneau : 10 kt à 10h30, 20 kt à 11h30.
            assert.equal(calls.length, 1);
            assert.equal(h1030.find(w => w.altFt === 1061).speedKt, 10);
            assert.equal(h1130.find(w => w.altFt === 1061).speedKt, 20);
        } finally {
            globalThis.fetch = orig;
        }
    });

    test('surface isobare sous le sol (plateau) : null filtré, interpolation entre surfaces valides', async () => {
        _clearCache();
        const orig = globalThis.fetch;
        globalThis.fetch = async () =>
            ({ ok: true, status: 200, json: async () => LOC(18.52, 37.04, 55.56, 270, true) });
        try {
            const winds = await fetchWindsAloft(45.9, 7.0, T1130);   // Vallée d'Aoste
            assert.ok(Array.isArray(winds));
            assert.ok(!winds.some(w => w.altFt === 363), '1000 hPa sous le sol → absent');
            assert.equal(winds[0].altFt, 1061);
        } finally {
            globalThis.fetch = orig;
        }
    });

    test('réponse objet (un seul point) normalisée en tableau', async () => {
        _clearCache();
        const orig = globalThis.fetch;
        globalThis.fetch = async () =>
            ({ ok: true, status: 200, json: async () => LOC(18.52, 37.04, 55.56, 180) });
        try {
            const winds = await fetchWindsAloft(50.03, 3.21, T1130);   // Lille
            assert.ok(Array.isArray(winds));
            assert.equal(winds.find(w => w.altFt === 1061).speedKt, 20);
        } finally {
            globalThis.fetch = orig;
        }
    });

    test('échec réseau : null par point, sans exception levée', async () => {
        _clearCache();
        const orig = globalThis.fetch;
        globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => ({}) });
        try {
            const out = await fetchWindsAloftMulti([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], T1130);
            assert.deepEqual(out, [null, null]);
            assert.equal(await fetchWindsAloft(5, 6, T1130), null);
        } finally {
            globalThis.fetch = orig;
        }
    });
});
