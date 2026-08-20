// Tests du module centrage (js/wb-core.js) sous Node, avec un stub
// localStorage (persistance des chargements). Tourne via `npm test`.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
};

const wb = await import('../js/wb-core.js');
const fleet = await import('../js/aircraft-fleet.js');

// Jeu de référence = maquette validée (DR400-like, valeurs fictives).
const AC_WB = {
    units: { mass: 'kg', arm: 'mm' },
    emptyMassKg: 628, emptyArmMm: 295, mtowKg: 1100, fuelDensity: 0.72,
    envelope: [[740, 180], [1000, 228], [1100, 245], [1100, 490], [740, 520]],
    stations: [
        { name: 'Pilote', armMm: 340, maxKg: null, fuel: false },
        { name: 'Passager 1', armMm: 340, maxKg: null, fuel: false },
        { name: 'Passager 2', armMm: 1050, maxKg: null, fuel: false },
        { name: 'Passager 3', armMm: 1050, maxKg: null, fuel: false },
        { name: 'Bagages', armMm: 1600, maxKg: 40, fuel: false },
        { name: 'Carburant', armMm: 300, maxKg: null, fuel: true },
    ],
};
const LOADS = {
    masses: { 'Pilote': 82, 'Passager 1': 70, 'Passager 2': 78, 'Passager 3': 65, 'Bagages': 15 },
    fuelL: 100, burnL: 41,
};

beforeEach(() => { _store.clear(); });

describe('wb — conversions d\'unités (facteurs exacts)', () => {
    test('bras : mm/m/ft/in aller-retours exacts', () => {
        assert.equal(wb.armToMm(10, 'in'), 254);
        assert.equal(wb.armToMm(1, 'ft'), 304.8);
        assert.equal(wb.armToMm(0.5, 'm'), 500);
        assert.equal(wb.armFromMm(wb.armToMm(37.7, 'in'), 'in'), 37.7);
        assert.equal(wb.armFromMm(wb.armToMm(1.234, 'ft'), 'ft'), 1.234);
    });
    test('masse : kg/lbs aller-retour', () => {
        assert.ok(Math.abs(wb.massToKg(100, 'lbs') - 45.359237) < 1e-6);
        assert.ok(Math.abs(wb.massFromKg(wb.massToKg(890, 'lbs'), 'lbs') - 890) < 1e-9);
        assert.equal(wb.massToKg(890, 'kg'), 890);
    });
});

describe('wb — géométrie de l\'enveloppe', () => {
    test('pointInEnvelope : dedans / dehors / bordure masse hors plage', () => {
        assert.equal(wb.pointInEnvelope(AC_WB.envelope, 1010, 428), true);
        assert.equal(wb.pointInEnvelope(AC_WB.envelope, 1010, 200), false);   // trop avant
        assert.equal(wb.pointInEnvelope(AC_WB.envelope, 1010, 510), false);   // trop arrière
        assert.equal(wb.pointInEnvelope(AC_WB.envelope, 500, 400), false);    // masse sous l'enveloppe
    });
    test('armLimitsAt : limites interpolées avant/arrière', () => {
        const { fwdMm, aftMm } = wb.armLimitsAt(AC_WB.envelope, 1010);
        assert.ok(Math.abs(fwdMm - 229.7) < 0.1);   // arête (1000,228)-(1100,245)
        assert.ok(Math.abs(aftMm - 497.5) < 0.1);   // arête (1100,490)-(740,520)
        const none = wb.armLimitsAt(AC_WB.envelope, 1200);
        assert.equal(none.fwdMm, null);
    });
});

describe('wb — calcul des points (jeu de la maquette)', () => {
    test('décollage / arrivée / ZFW : masses et CG attendus', () => {
        const r = wb.computeWb(AC_WB, LOADS);
        assert.equal(r.takeoff.massKg, 1010);           // 628+82+70+78+65+15+72
        assert.ok(Math.abs(r.takeoff.cgMm - 428.4) < 0.1);
        assert.equal(r.zfw.massKg, 938);
        assert.ok(Math.abs(r.zfw.cgMm - 438.26) < 0.1);
        assert.ok(Math.abs(r.arrival.massKg - 980.48) < 0.01);   // 938 + (72-29,52)
        assert.ok(Math.abs(r.arrival.cgMm - 432.2) < 0.1);
        assert.equal(r.fuelKg, 72);
        assert.ok(Math.abs(r.burnKg - 29.52) < 0.01);
    });
    test('verdict : les 3 points dedans → ok, marges positives', () => {
        const r = wb.computeWb(AC_WB, LOADS);
        assert.equal(r.level, 'ok');
        assert.equal(r.mtowOk, true);                    // 1010 ≤ 1100
        for (const p of ['takeoff', 'arrival', 'zfw']) {
            assert.equal(r.points[p].inside, true, p);
            assert.ok(r.points[p].fwdMm > 0 && r.points[p].aftMm > 0, p);
        }
        assert.ok(Math.abs(r.points.takeoff.fwdMm - 198.7) < 0.1);
        assert.ok(Math.abs(r.points.takeoff.aftMm - 69.1) < 0.1);
    });
    test('hors enveloppe : bagages massifs → danger + marges négatives', () => {
        const bad = { ...LOADS, masses: { ...LOADS.masses, 'Bagages': 120 } };
        const r = wb.computeWb(AC_WB, bad);
        assert.equal(r.points.zfw.inside, false);
        assert.equal(r.level, 'danger');
        assert.ok(r.points.zfw.aftMm < 0);
    });
    test('MTOW dépassé → danger même dans l\'enveloppe', () => {
        // Cas nominal (tout dans la plage de masse de l'enveloppe) : ok.
        const r = wb.computeWb(AC_WB, { masses: { 'Pilote': 82, 'Passager 1': 70, 'Bagages': 60 }, fuelL: 100, burnL: 41 });
        assert.equal(r.takeoff.massKg, 912);
        assert.equal(r.mtowOk, true);
        assert.equal(r.level, 'ok');
        // Carburant délirant : masse décollage > MTOW → danger.
        const r2 = wb.computeWb(AC_WB, { masses: {}, fuelL: 660, burnL: 0 }); // 475 kg de carburant
        assert.ok(r2.takeoff.massKg > 1100);
        assert.equal(r2.mtowOk, false);
        assert.equal(r2.level, 'danger');
    });
    test('essence consommée clampée au carburant embarqué', () => {
        const r = wb.computeWb(AC_WB, { masses: {}, fuelL: 50, burnL: 200 });
        assert.ok(Math.abs(r.arrival.massKg - r.zfw.massKg) < 1e-9);
        assert.ok(Math.abs(r.arrivalFuelKg) < 1e-9);
    });
    test('chargement vide : ZFW = masse à vide, CG = bras à vide', () => {
        const r = wb.computeWb(AC_WB, { masses: {}, fuelL: 0, burnL: 0 });
        assert.equal(r.zfw.massKg, 628);
        assert.equal(r.zfw.cgMm, 295);
        assert.equal(r.takeoff.massKg, 628);
    });
});

describe('wb — chargement du jour (persistance + plan)', () => {
    test('readWbLoads/writeWbLoads aller-retour, null si absent', () => {
        assert.equal(wb.readWbLoads('ac_x'), null);
        wb.writeWbLoads('ac_x', LOADS);
        assert.deepEqual(wb.readWbLoads('ac_x'), LOADS);
    });
    test('resolveLoads : mémorisé prioritaire, sinon plan, sinon zéro', () => {
        assert.deepEqual(wb.resolveLoads('ac_y', { fuel: { totalL: 96.4, tripFuelL: 58.3 } }),
            { masses: {}, fuelL: 96, burnL: 58 });
        assert.equal(wb.resolveLoads('ac_y', null).fuelL, 0);
        wb.writeWbLoads('ac_y', { masses: { Pilote: 80 }, fuelL: 60, burnL: 20 });
        assert.deepEqual(wb.resolveLoads('ac_y', { fuel: { totalL: 96.4, tripFuelL: 58.3 } }),
            { masses: { Pilote: 80 }, fuelL: 60, burnL: 20 });
    });
});

describe('wb — SVG du centrogramme', () => {
    const r = wb.computeWb(AC_WB, LOADS);
    test('contient enveloppe, 4 points, axes, MTOW ; pas de NaN', () => {
        const svg = wb.wbChartSvg(AC_WB, r, true, 340);
        assert.ok(svg.includes('<polygon'));
        assert.ok(svg.includes('MTOW'));
        assert.ok(!svg.includes('NaN') && !svg.includes('undefined'));
        assert.equal((svg.match(/<circle/g) || []).length, 4);
        assert.ok(svg.includes('Bras de levier (mm)'));
        assert.ok(svg.includes('Masse (kg)'));
    });
    test('hidePointLabels : points sans étiquettes textuelles', () => {
        const svg = wb.wbChartSvg(AC_WB, r, true, 340, { hidePointLabels: true });
        assert.equal((svg.match(/<circle/g) || []).length, 4);
        assert.ok(!svg.includes('Décollage'));
    });
    test('unités lbs/in : axes et enveloppe convertis', () => {
        const acLbs = { ...AC_WB, units: { mass: 'lbs', arm: 'in' } };
        const svg = wb.wbChartSvg(acLbs, r, true, 340, { hidePointLabels: true });
        assert.ok(svg.includes('Bras de levier (in)'));
        assert.ok(svg.includes('Masse (lbs)'));
    });
});

describe('wb — intégration flotte (sanitize du bloc)', () => {
    test('addAircraft conserve un bloc wb valide, le rejette si invalide', () => {
        const ac = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100, wb: AC_WB });
        assert.equal(ac.wb.emptyMassKg, 628);
        assert.equal(ac.wb.units.mass, 'kg');
        // Enveloppe trop courte → bloc entier ignoré (null), pas d'avion cassé.
        const bad = fleet.addAircraft({
            name: 'X', groundRoll: 500, fiftyFt: 1100,
            wb: { emptyMassKg: 600, emptyArmMm: 300, envelope: [[700, 100], [700, 500]] },
        });
        assert.equal(bad.wb, null);
    });
    test('updateAircraft partiel : wb absent → préservé, wb null → effacé', () => {
        const ac = fleet.addAircraft({ name: 'DR400', groundRoll: 500, fiftyFt: 1100, wb: AC_WB });
        const kept = fleet.updateAircraft(ac.id, { cruiseSpeedKt: 115 });
        assert.equal(kept.wb.emptyMassKg, 628);
        const cleared = fleet.updateAircraft(ac.id, { wb: null });
        assert.equal(cleared.wb, null);
    });
    test('postes : un seul poste carburant conservé, bornes appliquées', () => {
        const ac = fleet.addAircraft({
            name: 'X', groundRoll: 500, fiftyFt: 1100,
            wb: { ...AC_WB, stations: [...AC_WB.stations, { name: 'Fuel 2', armMm: 300, fuel: true }] },
        });
        assert.equal(ac.wb.stations.filter(s => s.fuel).length, 1);
        assert.equal(ac.wb.stations[4].name, 'Bagages');
        assert.equal(ac.wb.stations[4].maxKg, 40);
    });
});
