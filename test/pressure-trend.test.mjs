// Tests de la tendance de pression QNH (js/pressure-trend.js) —
// fetchPressureTrend passe par le relai réseau : le transport est
// STUBBÉ (pattern watchdog-badge.test.mjs — globalThis.fetch renvoie
// des METARs factices, aucune requête réelle n'est émise) pour tester
// le parsing des séries QNH ; evaluatePressureTrend est pur.
// state.lang vaut 'fr' par défaut : messages assertés en français.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// Fetch stubbé : METARs factices pilotés par série (JSON AviationWeather).
let STUB_DATA = [];
globalThis.fetch = async () => ({
    status: 200,
    ok: true,
    text: async () => JSON.stringify(STUB_DATA),
});

const { fetchPressureTrend, evaluatePressureTrend } = await import('../js/pressure-trend.js');

// Petit constructeur : METAR avec QNH hPa et heure d'observation ISO.
const M = (h, qnh) => ({
    rawOb: `LFLY 26${h}Z 24008KT CAVOK 10/05 ${qnh}`,
    observeTime: `2026-09-26T${h}:00:00.000Z`,
});

describe('pressure-trend — parsing des séries QNH (transport stubbé)', () => {

    test('baisse 1015 → 1009 en 2 h : pente −3 hPa/h exactement (borne danger)', async () => {
        // Trois METARs : 12:00 Q1015, 13:00 Q1012, 14:00 Q1009.
        // delta = 1009 − 1015 = −6 hPa sur 2 h → −6/2 = −3 hPa/h.
        STUB_DATA = [M('1200', 'Q1015'), M('1300', 'Q1012'), M('1400', 'Q1009')];
        const t = await fetchPressureTrend('LFLY');
        assert.equal(t.deltaHpa, -6);
        assert.equal(t.hoursSpan, 2);
        assert.equal(t.trendHpaPerHour, -3);
        assert.equal(t.currentQnh, 1009, 'QNH le plus récent');
        assert.equal(t.oldestQnh, 1015, 'QNH le plus ancien');
    });

    test('QNH en inHg (A2992) converti : 29,92 × 33,8639 = 1013,21 → 1013 hPa', async () => {
        // L'ancien METAR est en format américain A2992 :
        // 2992/100 = 29,92 inHg ; 29,92 × 33,8639 = 1013,2078… → 1013.
        // Le récent est en Q1007 : delta = 1007 − 1013 = −6 sur 2 h → −3/h.
        STUB_DATA = [
            { rawOb: 'KLAX 261200Z 24008KT FEW030 18/07 A2992', observeTime: '2026-09-26T12:00:00.000Z' },
            M('1400', 'Q1007'),
        ];
        const t = await fetchPressureTrend('KLAX');
        assert.equal(t.oldestQnh, 1013);
        assert.equal(t.deltaHpa, -6);
        assert.equal(t.trendHpaPerHour, -3);
    });

    test('séries inexploitables → null (vide, unique, sans QNH, recul < 0,5 h)', async () => {
        // Pas de terrain.
        assert.equal(await fetchPressureTrend(''), null);
        // Un seul METAR : impossible de tracer une pente.
        STUB_DATA = [M('1200', 'Q1015')];
        assert.equal(await fetchPressureTrend('LFLY'), null);
        // Aucun QNH exploitable dans les rawOb → points filtrés.
        STUB_DATA = [
            { rawOb: 'LFLY 261200Z 24008KT CAVOK 10/05', observeTime: '2026-09-26T12:00:00.000Z' },
            { rawOb: 'LFLY 261400Z 24008KT CAVOK 10/05', observeTime: '2026-09-26T14:00:00.000Z' },
        ];
        assert.equal(await fetchPressureTrend('LFLY'), null);
        // Deux observations 14:00 et 14:15 : span 0,25 h < 0,5 h de recul.
        STUB_DATA = [
            M('1400', 'Q1010'),
            { rawOb: 'LFLY 261415Z 24008KT CAVOK 10/05 Q1010', observeTime: '2026-09-26T14:15:00.000Z' },
        ];
        assert.equal(await fetchPressureTrend('LFLY'), null);
    });
});

describe('pressure-trend — evaluatePressureTrend (niveaux et messages)', () => {

    test('hausse (> 0,5 hPa/h) : toujours ok, icône trending-up', () => {
        // +6 hPa en 2 h → +3 hPa/h : le temps se stabilise.
        const h = evaluatePressureTrend({ trendHpaPerHour: 3 });
        assert.equal(h.level, 'ok');
        assert.equal(h.icon, 'trending-up');
        assert.equal(h.message, 'Pression en hausse (3.0 hPa/h) — temps stable');
        // Une hausse forte reste ok (aucun niveau d'alerte côté montée).
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: 2 }).level, 'ok');
        // 0,51 > 0,5 : déjà « en hausse ».
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: 0.51 }).icon, 'trending-up');
    });

    test('baisse : seuils exacts −3 danger, −2 baisse, −1 légère baisse', () => {
        // −3 hPa/h (borne inclusive ≥ 3) : alerte forte.
        const d = evaluatePressureTrend({ trendHpaPerHour: -3 });
        assert.equal(d.level, 'danger');
        assert.equal(d.icon, 'trending-down');
        assert.equal(d.message, 'Pression en forte baisse (-3.0 hPa/h) — dégradation imminente');
        // −2,5 : encore « baisse » (≥ 2), pas « forte ».
        const c2 = evaluatePressureTrend({ trendHpaPerHour: -2.5 });
        assert.equal(c2.level, 'caution');
        assert.equal(c2.message, 'Pression en baisse (-2.5 hPa/h) — dégradation probable');
        // −2 exact : borne inclusive de la zone « baisse ».
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: -2 }).message,
            'Pression en baisse (-2.0 hPa/h) — dégradation probable');
        // −1 exact : borne inclusive de la « légère baisse » (≥ 1).
        const c1 = evaluatePressureTrend({ trendHpaPerHour: -1 });
        assert.equal(c1.level, 'caution');
        assert.equal(c1.message, 'Pression en légère baisse (-1.0 hPa/h) — à surveiller');
        // −0,99 < 1 : retombe en stable.
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: -0.99 }).level, 'ok');
    });

    test('stable : |pente| < 1 → ok, icône minus (0,5 exclu de la hausse)', () => {
        // 0 hPa/h.
        const z = evaluatePressureTrend({ trendHpaPerHour: 0 });
        assert.equal(z.level, 'ok');
        assert.equal(z.icon, 'minus');
        assert.equal(z.message, 'Pression stable (0.0 hPa/h)');
        // 0,5 exact : la hausse exige STRICTEMENT plus de 0,5 → stable.
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: 0.5 }).icon, 'minus');
    });

    test('série stable de bout en bout (1013 → 1013 sur 2 h) : message « stable »', async () => {
        STUB_DATA = [M('1200', 'Q1013'), M('1400', 'Q1013')];
        const t = await fetchPressureTrend('LFLY');
        assert.equal(t.trendHpaPerHour, 0, 'delta 0 sur 2 h');
        const e = evaluatePressureTrend(t);
        assert.equal(e.level, 'ok');
        assert.equal(e.icon, 'minus');
        assert.ok(e.message.includes('Pression stable (0.0 hPa/h)'));
    });

    test('entrées invalides → null', () => {
        assert.equal(evaluatePressureTrend(null), null);
        assert.equal(evaluatePressureTrend(undefined), null);
        assert.equal(evaluatePressureTrend({}), null, 'trendHpaPerHour absent');
        assert.equal(evaluatePressureTrend({ trendHpaPerHour: null }), null);
    });

    test('comportement NaN : non filtré, toutes comparaisons fausses → « stable »', () => {
        // Contrairement à density-altitude, evaluatePressureTrend ne teste
        // pas isNaN : un NaN n'est pas == null et échoue toutes les bornes,
        // il retombe donc dans la branche stable. Cas théorique — en pratique
        // trendHpaPerHour provient d'entiers parsés (jamais NaN).
        const r = evaluatePressureTrend({ trendHpaPerHour: NaN });
        assert.notEqual(r, null);
        assert.equal(r.level, 'ok');
        assert.equal(r.icon, 'minus');
    });
});
