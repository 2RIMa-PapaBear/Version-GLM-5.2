// Tests de la méthode RÉFÉRENCE (js/takeoff-performance.js, arbitrage
// 15/09) — altitude pression + température séparées, facteurs ×, revêtement
// sur la distance totale, vent axial conservé (atterrissage).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { correctedTakeoffDistance, correctedLandingDistance , runwayLevel, _calcRunwaySlopePct } from '../js/takeoff-performance.js';
import { _importForTests as _siaForTests } from '../js/sia-data.js';

// Stub localStorage — lu PAR APPEL par la flotte (getFleet), pas au chargement.
const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

describe('correctedTakeoffDistance — MÉTHODE RÉFÉRENCE', () => {
    test('niveau mer ISA (Zp=0, T=ISA) : facteurs ×1,00 partout', () => {
        const c = correctedTakeoffDistance(0, 15, {});
        assert.equal(c.paFactor, 1);
        assert.equal(c.tempFactor, 1);
        assert.equal(c.surfaceFactor, 1);
        // C172 par défaut : groundRoll 830, fiftyFt 1400
        assert.equal(c.groundRoll, 830);
        assert.equal(c.fiftyFt, 1400);
    });

    test('Zp 2000 ft ISA : ×1,15² (facteur référence par 1000 ft Zp)', () => {
        const c = correctedTakeoffDistance(2000, 15 - 1.98 * 2, {});
        assert.ok(Math.abs(c.paFactor - 1.3225) < 0.01, `paFactor ${c.paFactor}`);
        assert.equal(c.tempFactor, 1);   // ISA → pas de correction T°
        // distance totale ×1,3225 (arrondi pt près par Math.round sur 1.32249…)
        assert.ok(Math.abs(c.fiftyFt - 1400 * 1.3225) <= 1, `fiftyFt ${c.fiftyFt} ≈ 1851`);
    });

    test('T° +20 °C au-dessus d\'ISA : ×1,10² (par tranches de 10 °C)', () => {
        const c = correctedTakeoffDistance(0, 35, {});   // ISA SL = 15, +20 °C
        assert.ok(Math.abs(c.tempFactor - 1.21) < 0.001, `tempFactor ${c.tempFactor}`);
        assert.equal(c.paFactor, 1);
    });

    test('Zp + T° se MULTIPLIENT (2 000 ft Zp + 20 °C au-dessus ISA)', () => {
        const isa2000 = 15 - 1.98 * 2;   // ≈ 11 °C
        const c = correctedTakeoffDistance(2000, isa2000 + 20, {});
        const attendu = 1.3225 * 1.21;
        assert.ok(Math.abs(c.factor - attendu) < 0.01, `factor ${c.factor} ≈ ${attendu}`);
        assert.equal(c.fiftyFt, Math.round(1400 * attendu));
    });

    test('REVÊTEMENT référence : herbe sèche ×1,20, mouillée ×1,30', () => {
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'GRE' }).surfaceFactor, 1.20);
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'GRE', wet: true }).surfaceFactor, 1.30);
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'GRE', contaminated: true }).surfaceFactor, 1.25);
    });

    test('REVÊTEMENT référence : piste dure mouillée ×1,00 au décollage', () => {
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'ASP', wet: true }).surfaceFactor, 1.00);
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'ASP', contaminated: true }).surfaceFactor, 1.25);
        assert.equal(correctedTakeoffDistance(0, 15, { surfaceCode: 'ASP' }).surfaceFactor, 1.00);
    });

    test('le revêtement s\'applique à la DISTANCE TOTALE (pas au roulement seul)', () => {
        const sec = correctedTakeoffDistance(0, 15, { surfaceCode: 'GRE' });
        const mouille = correctedTakeoffDistance(0, 15, { surfaceCode: 'GRE', wet: true });
        const ratioRoll = mouille.groundRoll / sec.groundRoll;
        const ratio50 = mouille.fiftyFt / sec.fiftyFt;
        assert.ok(Math.abs(ratioRoll - 1.30 / 1.20) < 0.01, `ratio roulement ${ratioRoll}`);
        assert.ok(Math.abs(ratio50 - 1.30 / 1.20) < 0.01, `ratio 50ft ${ratio50}`);
    });
});

describe('correctedLandingDistance — MÉTHODE RÉFÉRENCE', () => {
    test('niveau mer ISA : facteurs ×1,00', () => {
        const l = correctedLandingDistance(0, 15, 725, 1400, {});
        assert.equal(l.rollFt, 725);
        assert.equal(l.fiftyFt, 1400);
    });

    test('Zp 2000 ft ISA : ×1,05² (atterrissage moins sensible que décollage)', () => {
        const l = correctedLandingDistance(2000, 15 - 1.98 * 2, 725, 1400, {});
        assert.ok(Math.abs(l.paFactor - 1.1025) < 0.001, `paFactor ${l.paFactor}`);
    });

    test('T° +20 °C : ×1,05² ', () => {
        const l = correctedLandingDistance(0, 35, 725, 1400, {});
        assert.ok(Math.abs(l.tempFactor - 1.1025) < 0.001);
    });

    test('vent DE FACE 10 kt : −10 % (conservé, spécificité app)', () => {
        const l = correctedLandingDistance(0, 15, 1000, 2000, { headwindKt: 10 });
        assert.equal(l.windFactor, 0.90);
        assert.equal(l.rollFt, 900);
    });

    test('vent ARRIÈRE 10 kt : +20 %', () => {
        const l = correctedLandingDistance(0, 15, 1000, 2000, { headwindKt: -10 });
        assert.equal(l.windFactor, 1.20);
    });

    test('REVÊTEMENT atterrissage : dure mouillée ×1,15 (référence)', () => {
        const l = correctedLandingDistance(0, 15, 1000, 2000, { surfaceCode: 'ASP', wet: true });
        assert.equal(l.surfaceFactor, 1.15);
    });

    test('références absentes → null', () => {
        assert.equal(correctedLandingDistance(0, 15, null, 1400, {}), null);
        assert.equal(correctedLandingDistance(0, 15, 725, 0, {}), null);
    });
});

// ① (18/09) — VERDICT « PISTE LIMITATIVE » : brut tient dans la piste,
// marge +20 % non (niveau intermédiaire entre marge faible et interdit).
describe('runwayLevel (niveaux du verdict piste)', () => {
    test('brut > piste → danger (même sans marge)', () => {
        assert.equal(runwayLevel(1100, 1320, 1000), 'danger');
        assert.equal(runwayLevel(1001, 1201, 1000), 'danger');
    });
    test('brut tient, margined dépasse → limitative', () => {
        assert.equal(runwayLevel(900, 1080, 1000), 'limitative');
        assert.equal(runwayLevel(1000, 1200, 1000), 'limitative', 'brut exactement égal à la piste');
    });
    test('margined tient mais marge < seuil → caution', () => {
        assert.equal(runwayLevel(850, 1020, 1050, 20), 'caution');   // marge 2,9 %
        assert.equal(runwayLevel(840, 1008, 1200, 20), 'caution');   // marge 16 %
    });
    test('marge ≥ seuil → ok', () => {
        assert.equal(runwayLevel(700, 840, 1200, 20), 'ok');         // marge 30 %
    });
    test('les 4 niveaux forment un ordre croissant de sévérité', () => {
        // même avion (brut 900), pistes décroissantes → sévérité croissante.
        assert.deepEqual(
            [1500, 1100, 950, 850].map(r => runwayLevel(900, 1080, r)),
            ['ok', 'caution', 'limitative', 'danger']);
    });
});

// ② (26/09, audit) — PENTE DE PISTE DEPUIS LES SEUILS SIA : bug de
// précédence `!x != null` (toujours vrai) → la fonction retournait TOUJOURS
// null : le facteur ×1,05/1 % de la méthode de référence ne s'appliquait
// jamais. LFRV 04/22 : seuil 04 à 429 ft, seuil 22 à 437 ft, 1530 m
// → décollage 04 (montante) ≈ +0,2 %, décollage 22 (descendante) ≈ −0,2 %.
describe('_calcRunwaySlopePct (seuils SIA)', () => {
    test('LFRV 04 montante / 22 descendante (≈ ±0,2 %)', () => {
        _siaForTests({ LFRV: [{ d: '04/22', len: 1530, main: true, t1: { id: '04', altFt: 429 }, t2: { id: '22', altFt: 437 } }] });
        assert.equal(_calcRunwaySlopePct('LFRV', '04'), 0.2);
        assert.equal(_calcRunwaySlopePct('LFRV', '22'), -0.2);
        assert.equal(_calcRunwaySlopePct('LFRV', '04/22'), 0.2, 'paire donnée = sens t1→t2');
    });
    test('pente marquée : +50 ft sur 1000 ft = 5 %', () => {
        _siaForTests({ LFTST: [{ d: '18/36', len: 305, main: true, t1: { id: '18', altFt: 500 }, t2: { id: '36', altFt: 550 } }] });
        assert.equal(_calcRunwaySlopePct('LFTST', '18'), 5);
        assert.equal(_calcRunwaySlopePct('LFTST', '36'), -5);
    });
    test('sans données de seuils ou terrain inconnu → null', () => {
        _siaForTests({ LFNS: [{ d: '09/27', len: 800, main: true }] });   // pas de t1/t2
        assert.equal(_calcRunwaySlopePct('LFNS', '09'), null);
        assert.equal(_calcRunwaySlopePct('LZZZ', '04'), null);
        assert.equal(_calcRunwaySlopePct('', '04'), null);
        _siaForTests({});   // vide le registre pour les autres tests
    });
});
