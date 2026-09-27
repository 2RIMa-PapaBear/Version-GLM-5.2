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

// Item D numérique = UTC (OACI Annexe 15) : azba.js convertit les plages
// en heure locale pour la comparaison ET le détail → l'attendu dépend du
// fuseau du runner (décalage = -getTimezoneOffset() à l'instant testé).
const locRange = (a, b, at) => {
    const shift = -new Date(at).getTimezoneOffset();
    const f = (s) => {
        const min = ((parseInt(s.slice(0, 2), 10) * 60 + parseInt(s.slice(2), 10) + shift) % 1440 + 1440) % 1440;
        return `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;
    };
    return `${f(a)}-${f(b)}`;
};

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
        assert.equal(r.detail, locRange('0600', '1900', now));
        assert.equal(r.notam.series, 'P');
    });

    test('plage à venir aujourd\u2019hui → PLANIFIEE', () => {
        const r = zoneActivation('R71', [N({ itemD: '1400-1700', itemE: 'R 71' })], now);
        assert.equal(r.status, 'PLANIFIEE');
        assert.equal(r.detail, locRange('1400', '1700', now));
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

describe('zoneActivation — item D en UTC (fiche audit n°1, 27/09)', () => {
    // Instants UTC FIXES (suffixe Z) : le statut ne doit dépendre que de
    // l'heure UTC, jamais du fuseau du runner. Avant correctif, un runner
    // UTC+2 déclarait une zone 0800-1000Z « libre » dès 08:01Z (heure
    // locale 10:01 ≥ fin lue comme locale).
    const Z = (s) => Date.parse(`2026-09-13T${s}:00Z`);

    test('0800-1000Z : ACTIVE à 08:30Z', () => {
        const r = zoneActivation('R71', [N({ itemD: '0800-1000', itemE: 'R 71' })], Z('08:30'));
        assert.equal(r?.status, 'ACTIVE');
    });

    test('0800-1000Z : terminée à 10:30Z → null', () => {
        assert.equal(zoneActivation('R71', [N({ itemD: '0800-1000', itemE: 'R 71' })], Z('10:30')), null);
    });

    test('1400-1700Z à 08:30Z → PLANIFIEE', () => {
        const r = zoneActivation('R71', [N({ itemD: '1400-1700', itemE: 'R 71' })], Z('08:30'));
        assert.equal(r?.status, 'PLANIFIEE');
    });

    test('plage traversant minuit UTC (1900-0600Z) : ACTIVE à 20:00Z', () => {
        const r = zoneActivation('R71', [N({ itemD: '1900-0600', itemE: 'R 71' })], Z('20:00'));
        assert.equal(r?.status, 'ACTIVE');
    });

    test('SR-SS : sunTimes en minutes locales → ACTIVE en pleine journée, détail local', () => {
        const r = zoneActivation('R71', [N({ itemD: 'SR-SS', itemE: 'R 71' })],
            new Date('2026-09-13T12:00:00').getTime(), { sr: 6 * 60 + 10, ss: 21 * 60 + 20 });
        assert.equal(r?.status, 'ACTIVE');
        assert.equal(r.detail, '0610-2120');
    });
});

describe('zoneActivation — bouclage minuit local (fiche audit n°27)', () => {
    // Instants UTC FIXES : une plage UTC tardive (précoce) devient une
    // plage locale du lendemain (de la veille) dès que |tzShift| > 0.
    // Avant correctif, 2300-2350Z en runner UTC+2 donnait a = 1500 :
    // nowMin ∈ [0,1440) ne pouvait jamais l'atteindre → zone vue
    // PLANIFIEE pendant toute son activation réelle (et clip en fuseau
    // négatif : a < 0). Les assertions tiennent dans TOUT fuseau.
    const Z = (s) => Date.parse(`2026-09-13T${s}:00Z`);

    test('2300-2350Z : ACTIVE à 23:15Z (heures locales du lendemain)', () => {
        const r = zoneActivation('R71', [N({ itemD: '2300-2350', itemE: 'R 71' })], Z('23:15'));
        assert.equal(r?.status, 'ACTIVE');
        assert.equal(r.detail, locRange('2300', '2350', Z('23:15')));
    });

    test('0000-0050Z : ACTIVE à 00:15Z (heures locales de la veille)', () => {
        const r = zoneActivation('R71', [N({ itemD: '0000-0050', itemE: 'R 71' })], Z('00:15'));
        assert.equal(r?.status, 'ACTIVE');
    });

    test('2200-0200Z : ACTIVE à 23:00Z (traversée minuit après bouclage)', () => {
        const r = zoneActivation('R71', [N({ itemD: '2200-0200', itemE: 'R 71' })], Z('23:00'));
        assert.equal(r?.status, 'ACTIVE');
    });

    test('2300-2350Z : PLANIFIEE à 22:30Z, terminée (null) à 23:55Z', () => {
        const avant = zoneActivation('R71', [N({ itemD: '2300-2350', itemE: 'R 71' })], Z('22:30'));
        assert.equal(avant?.status, 'PLANIFIEE');
        assert.equal(zoneActivation('R71', [N({ itemD: '2300-2350', itemE: 'R 71' })], Z('23:55')), null);
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
