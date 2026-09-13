// Tests B1 v1 : statuts des tuiles du « Dossier de vol » (js/flight-file.js — pur).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { computeFileTiles } from '../js/flight-file.js';

const BASE = {
    metarAgeMin: 30, tafState: 'loaded', arrWeather: null,
    notamCount: 40, notamAgeMin: 5,
    vac: [{ icao: 'LFRV', hasVac: true, consulted: true }],
    fuelRequired: 60, fuelOnBoard: 65, diversion: true,
    takeoffLevel: 'ok', landingLevel: 'ok', wbLevel: 'ok',
};

describe('computeFileTiles (B1 v1)', () => {
    test('dossier complet → toutes les tuiles au vert', () => {
        const t = computeFileTiles(BASE);
        for (const k of ['weather', 'notam', 'vac', 'fuel', 'perf', 'wb']) {
            assert.equal(t[k].status, 'ok', k);
        }
    });

    test('METAR périmé / absent → météo ambre/rouge', () => {
        assert.equal(computeFileTiles({ ...BASE, metarAgeMin: 90 }).weather.status, 'warn');
        assert.equal(computeFileTiles({ ...BASE, metarAgeMin: 180 }).weather.status, 'danger');
        assert.equal(computeFileTiles({ ...BASE, metarAgeMin: null }).weather.status, 'danger');
    });

    test('TAF non consulté → ambre ; terrain SANS TAF (« none ») → sans objet, vert', () => {
        assert.equal(computeFileTiles({ ...BASE, tafState: null }).weather.status, 'warn');
        assert.equal(computeFileTiles({ ...BASE, tafState: 'none' }).weather.status, 'ok');
    });

    test('météo d\u2019arrivée indisponible → ambre', () => {
        assert.equal(computeFileTiles({ ...BASE, arrWeather: false }).weather.status, 'warn');
    });

    test('NOTAM : jamais chargé → rouge ; périmé (>30 min) → ambre', () => {
        assert.equal(computeFileTiles({ ...BASE, notamCount: 0 }).notam.status, 'danger');
        assert.equal(computeFileTiles({ ...BASE, notamAgeMin: 45 }).notam.status, 'warn');
    });

    test('VAC : à consulter → ambre ; terrain sans VAC publiée → sans objet (vert)', () => {
        assert.equal(computeFileTiles({ ...BASE, vac: [{ icao: 'LFRV', hasVac: true, consulted: false }] }).vac.status, 'warn');
        assert.equal(computeFileTiles({ ...BASE, vac: [{ icao: 'LFXX', hasVac: false }] }).vac.status, 'ok');
    });

    test('carburant : insuffisant → rouge ; devis inconnu → ambre ; sans dégagement reste OK (détail seul)', () => {
        assert.equal(computeFileTiles({ ...BASE, fuelOnBoard: 50 }).fuel.status, 'danger');
        assert.equal(computeFileTiles({ ...BASE, fuelRequired: null }).fuel.status, 'warn');
        // Retour pilote 13/09 : embarqué ≥ requis = VERT même sans dégagement
        // choisi — l'absence de dégagement ne dégrade plus la pastille.
        const f = computeFileTiles({ ...BASE, diversion: false }).fuel;
        assert.equal(f.status, 'ok');
        assert.equal(f.diversion, false, 'dégagement absent porté dans le détail');
    });

    test('perfs : le pire niveau gagne ; non calculé → ambre', () => {
        assert.equal(computeFileTiles({ ...BASE, landingLevel: 'danger' }).perf.status, 'danger');
        assert.equal(computeFileTiles({ ...BASE, landingLevel: 'caution' }).perf.status, 'warn');
        assert.equal(computeFileTiles({ ...BASE, takeoffLevel: null }).perf.status, 'warn');
    });

    test('centrage : hors limites → rouge ; non configuré → ambre', () => {
        assert.equal(computeFileTiles({ ...BASE, wbLevel: 'out' }).wb.status, 'danger');
        assert.equal(computeFileTiles({ ...BASE, wbLevel: null }).wb.status, 'warn');
    });
});
