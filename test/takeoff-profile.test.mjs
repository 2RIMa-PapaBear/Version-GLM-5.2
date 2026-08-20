/* QA géométrique du schéma de décollage en coupe (takeoff-profile.js).
 * Vérifie les invariants de layout (positions px) et le SVG produit
 * (textes, ids uniques, pas de NaN) sur les 4 verdicts + cas limites. */

import test from 'node:test';
import assert from 'node:assert/strict';
import { takeoffProfileSvg, takeoffProfileLayout } from '../js/takeoff-profile.js';

const FT_TO_M = 0.3048;
const ftToM = (ft) => Math.round(ft * FT_TO_M);

const CASES = {
    // C172 par chaleur (DA élevée), piste confortable.
    ok: { groundRoll: 950, fiftyFt: 1680, runwayLength: 3300, margin: 1620, level: 'ok' },
    // Marge < seuil de prudence.
    caution: { groundRoll: 950, fiftyFt: 1680, runwayLength: 1900, margin: 220, level: 'caution' },
    // 50 ft au-delà de la piste.
    danger: { groundRoll: 950, fiftyFt: 1680, runwayLength: 1500, margin: -180, level: 'danger' },
    // Longueur de piste non renseignée.
    unknown: { groundRoll: 950, fiftyFt: 1680, runwayLength: null, margin: null, level: 'unknown' },
};

test('layout : ordre seuil < rotation < 50ft dans le cadre', () => {
    for (const [name, r] of Object.entries(CASES)) {
        const L = takeoffProfileLayout(r);
        assert.ok(L.x0 < L.liftX, `${name}: rotation après le seuil`);
        assert.ok(L.liftX < L.fiftyX, `${name}: 50ft après la rotation`);
        assert.ok(L.fiftyX <= L.xR + 0.5, `${name}: 50ft dans le cadre (${L.fiftyX} ≤ ${L.xR})`);
        if (L.rwyEndX != null) {
            assert.ok(L.x0 < L.rwyEndX && L.rwyEndX <= L.xR + 0.5, `${name}: fin de piste dans le cadre`);
        }
    }
});

test('layout : position relative piste vs 50ft selon le verdict', () => {
    const ok = takeoffProfileLayout(CASES.ok);
    assert.ok(ok.fiftyX < ok.rwyEndX, 'ok : 50ft atteint avant la fin de piste');
    const danger = takeoffProfileLayout(CASES.danger);
    assert.ok(danger.fiftyX > danger.rwyEndX, 'danger : 50ft au-delà de la fin de piste');
    assert.equal(takeoffProfileLayout(CASES.unknown).rwyEndX, null, 'unknown : pas de fin de piste');
});

test('layout : étiquette de rotation bornée (pas de chevauchement)', () => {
    for (const [name, r] of Object.entries(CASES)) {
        const L = takeoffProfileLayout(r);
        const rightBound = (L.rwyEndX != null ? Math.min(L.rwyEndX, L.xR) : L.xR) - 26;
        assert.ok(L.labelLiftX >= L.x0 + 20, `${name}: étiquette pas sur le « 0 »`);
        assert.ok(L.labelLiftX <= rightBound, `${name}: étiquette pas sur la fin de piste`);
    }
});

test('layout : étiquette de longueur de piste bornée au cadre', () => {
    for (const [name, r] of Object.entries(CASES)) {
        const L = takeoffProfileLayout(r);
        if (L.labelLenX == null) continue;
        assert.ok(L.labelLenX <= L.xR, `${name}: ancre « end » dans le cadre`);
        assert.ok(L.labelLenX >= L.labelLiftX + 20, `${name}: séparée de l'étiquette de rotation`);
    }
});

test('layout : garde-fou roulement > 50ft (données incohérentes)', () => {
    const L = takeoffProfileLayout({ groundRoll: 2000, fiftyFt: 1500, runwayLength: 3000, margin: 1500, level: 'ok' });
    assert.ok(L.liftX <= L.fiftyX, 'rotation clampée au point 50ft');
});

test('svg : distances attendues présentes, pas de NaN/undefined', () => {
    for (const [name, r] of Object.entries(CASES)) {
        for (const isFr of [true, false]) {
            const svg = takeoffProfileSvg(r, isFr);
            assert.match(svg, new RegExp(`${ftToM(r.fiftyFt)} m`), `${name}/fr=${isFr}: distance 50ft`);
            assert.match(svg, /50 ft/, `${name}/fr=${isFr}: repère 50 ft`);
            assert.match(svg, new RegExp(`${ftToM(Math.min(r.groundRoll, r.fiftyFt))} m`), `${name}/fr=${isFr}: distance roulement`);
            assert.doesNotMatch(svg, /NaN|undefined/, `${name}/fr=${isFr}: pas de valeurs invalides`);
            assert.match(svg, /role="img"/, `${name}/fr=${isFr}: aria`);
        }
    }
});

test('svg : longueur de piste / demande de saisie selon le cas', () => {
    assert.match(takeoffProfileSvg(CASES.ok, true), new RegExp(`${ftToM(3300)} m`), 'longueur affichée si connue');
    assert.match(takeoffProfileSvg(CASES.unknown, true), /longueur piste \?/, 'invite FR si inconnue');
    assert.match(takeoffProfileSvg(CASES.unknown, false), /runway length \?/, 'invite EN si inconnue');
});

test('svg : verdicts danger et marge', () => {
    assert.match(takeoffProfileSvg(CASES.danger, true), new RegExp(`manque ${ftToM(180)} m`), 'manque FR');
    assert.match(takeoffProfileSvg(CASES.danger, false), new RegExp(`short ${ftToM(180)} m`), 'manque EN');
    assert.match(takeoffProfileSvg(CASES.ok, true), new RegExp(`\\+${ftToM(1620)} m`), 'marge positive');
});

test('svg : ids de pattern uniques entre instances', () => {
    const a = takeoffProfileSvg(CASES.ok, true);
    const b = takeoffProfileSvg(CASES.ok, true);
    const idsA = [...a.matchAll(/id="(tp\d+)"/g)].map((m) => m[1]);
    const idsB = [...b.matchAll(/id="(tp\d+)"/g)].map((m) => m[1]);
    assert.equal(idsA.length, 1);
    assert.equal(idsB.length, 1);
    assert.notEqual(idsA[0], idsB[0]);
    assert.match(a, new RegExp(`url\\(#${idsA[0]}\\)`), 'le rect référence bien son pattern');
});
