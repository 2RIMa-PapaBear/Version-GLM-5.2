// Tests B2 (AZBA) — parsing des plages d'activation NOTAM (item D RÉELS de
// la capture SOFIA du 12/09) + rapprochement NOTAM ↔ zone SIA + statut.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseItemD, notamZoneKeys, zoneActivation, zoneActiveToday } from '../js/azba.js';

// Item NOTAM plat (structure js/notam.js), validité septembre 2026.
const N = (over = {}) => ({
    series: 'P', number: 123, year: 2026,
    startValidity: '2026-09-01T00:00:00Z', endValidity: '2026-09-30T23:59:00Z',
    itemD: '', itemE: '', ...over,
});

describe('parseItemD (formats réels SOFIA 12/09)', () => {
    test('plage quotidienne simple (« 0600-1900 », « 0630-1530 »)', () => {
        for (const s of ['0600-1900', '0630-1530']) {
            const g = parseItemD(s);
            assert.equal(g.length, 1, s);
            assert.equal(g[0].from, s.slice(0, 4), s);
            assert.equal(g[0].to, s.slice(5), s);
            assert.equal(g[0].days, null, s);
            assert.equal(g[0].weekdays, null, s);
        }
    });

    test('groupes de jours du mois séparés par virgules', () => {
        const g = parseItemD('06 12 20 0700-1600, 09 16 0700-1030, 08 10 15 17 1200-1600');
        assert.equal(g.length, 3);
        assert.deepEqual([...g[0].days].sort((a, b) => a - b), [6, 12, 20]);
        assert.equal(g[0].from, '0700');
        assert.equal(g[0].to, '1600');
        assert.deepEqual([...g[2].days].sort((a, b) => a - b), [8, 10, 15, 17]);
        assert.equal(g[1].to, '1030');
    });

    test('SR-SS et MON-FRI 1200-SS', () => {
        const g1 = parseItemD('SR-SS');
        assert.equal(g1[0].from, 'SR');
        assert.equal(g1[0].to, 'SS');
        const g2 = parseItemD('MON-FRI 1200-SS');
        assert.deepEqual([...g2[0].weekdays].sort((a, b) => a - b), [1, 2, 3, 4, 5]);
        assert.equal(g2[0].from, '1200');
        assert.equal(g2[0].to, 'SS');
    });

    test('vide / H24 → null (activation permanente sur la validité)', () => {
        assert.equal(parseItemD(''), null);
        assert.equal(parseItemD(null), null);
        assert.equal(parseItemD('H24'), null);
    });
});

describe('notamZoneKeys (désignateurs cités dans l item E)', () => {
    test('formats espacé, collé, avec lettre, préfixe LF-', () => {
        assert.ok(notamZoneKeys(N({ itemE: 'ZONE R 71 ACTIVE PAR NOTAM' })).has('R71'));
        assert.ok(notamZoneKeys(N({ itemE: 'D56B ACT TIR' })).has('D56B'));
        const k3 = notamZoneKeys(N({ itemE: 'P 23 / LF-R278A' }));
        assert.ok(k3.has('P23') && k3.has('R278A'), [...k3].join(','));
    });

    test('sans désignateur → ensemble vide', () => {
        assert.equal(notamZoneKeys(N({ itemE: 'RWY 04 CLSD WIP' })).size, 0);
    });
});

describe('zoneActivation (statut du jour)', () => {
    // 13 septembre 2026 = DIMANCHE, 10h00 locales (heure du runner).
    const now = new Date('2026-09-13T10:00:00').getTime();

    test('plage quotidienne couvrant 10h → ACTIVE 0600-1900', () => {
        const r = zoneActivation('R71', [N({ itemD: '0600-1900', itemE: 'R 71' })], now);
        assert.equal(r.status, 'ACTIVE');
        assert.equal(r.detail, '0600-1900');
        assert.equal(r.notam.series, 'P');
    });

    test('plage à venir aujourd\u2019hui → PLANIFIEE', () => {
        const r = zoneActivation('R71', [N({ itemD: '1400-1700', itemE: 'R 71' })], now);
        assert.equal(r.status, 'PLANIFIEE');
        assert.equal(r.detail, '1400-1700');
    });

    test('jour du mois non prévu (13 absent de 06 12 20) → null', () => {
        assert.equal(zoneActivation('R71', [N({ itemD: '06 12 20 0700-1600', itemE: 'R 71' })], now), null);
    });

    test('DIMANCHE hors MON-FRI → null', () => {
        assert.equal(zoneActivation('R71', [N({ itemD: 'MON-FRI 1200-SS', itemE: 'R 71' })], now), null);
    });

    test('sans item D → ACTIVE H24 pendant la validité', () => {
        const r = zoneActivation('R71', [N({ itemE: 'R 71 ACT TIR' })], now);
        assert.equal(r.status, 'ACTIVE');
        assert.equal(r.detail, 'H24');
    });

    test('validité échue ou à venir → ignoré', () => {
        const echu = zoneActivation('R71', [N({ itemD: '0600-1900', itemE: 'R 71', startValidity: '2026-08-01T00:00:00Z', endValidity: '2026-09-01T00:00:00Z' })], now);
        assert.equal(echu, null);
        const futur = zoneActivation('R71', [N({ itemD: '0600-1900', itemE: 'R 71', startValidity: '2026-09-20T00:00:00Z', endValidity: '2026-09-30T00:00:00Z' })], now);
        assert.equal(futur, null);
    });

    test('zone sans NOTAM correspondant dans le dossier → null', () => {
        assert.equal(zoneActivation('D99', [N({ itemD: '0600-1900', itemE: 'R 71' })], now), null);
        assert.equal(zoneActivation('R71', [], now), null);
    });
});

describe('zoneActiveToday (B2 v2 : trait plein / pointillé)', () => {
    const now = new Date('2026-09-13T10:00:00').getTime();   // dimanche 13/09, 10h
    const NACT = (over = {}) => N({ itemD: '0600-1900', itemE: 'R 71', ...over });

    test('hor=NOTAM avec activation du jour (même à venir) → PLEIN', () => {
        assert.equal(zoneActiveToday({ hor: 'NOTAM', key: 'R71' }, [NACT()], now), true);
        assert.equal(zoneActiveToday({ hor: 'NOTAM', key: 'R71' }, [NACT({ itemD: '1400-1700' })], now), true, 'plage à venir aujourd\u2019hui = zone active CE JOUR');
    });

    test('hor=NOTAM sans activation ce jour (06 12 20 alors qu\u2019on est le 13) → POINTILLÉ', () => {
        assert.equal(zoneActiveToday({ hor: 'NOTAM', key: 'R71' }, [NACT({ itemD: '06 12 20 0700-1600' })], now), false);
    });

    test('hor=NOTAM mais dossier vide ou sans correspondance → PLEIN (pas d\u2019info ≠ inactive)', () => {
        assert.equal(zoneActiveToday({ hor: 'NOTAM', key: 'R71' }, [], now), true);
        assert.equal(zoneActiveToday({ hor: 'NOTAM', key: 'R71' }, [NACT({ itemE: 'D 42' })], now), true);
    });

    test('H24, HX, hor absent, zone non R/D/P → PLEIN (statu quo)', () => {
        assert.equal(zoneActiveToday({ hor: 'H24', key: 'R71' }, [NACT({ itemD: '06 12 20 0700-1600' })], now), true);
        assert.equal(zoneActiveToday({ hor: 'HX', key: 'R71' }, [NACT({ itemD: '06 12 20 0700-1600' })], now), true);
        assert.equal(zoneActiveToday({ hor: null, key: null }, [NACT()], now), true);
    });
});
