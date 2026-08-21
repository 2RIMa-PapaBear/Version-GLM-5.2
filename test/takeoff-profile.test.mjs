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

test('layout : piste pleine largeur (du bord gauche au bord droit)', () => {
    for (const name of ['ok', 'caution', 'danger']) {
        for (const width of [340, 770]) {
            const L = takeoffProfileLayout(CASES[name], width);
            assert.equal(L.x0, 0, `${name}@${width}: départ au bord gauche`);
            assert.equal(L.rwyEndX, L.xR, `${name}@${width}: fin de piste au bord droit`);
            assert.equal(L.xR, width, `${name}@${width}: largeur = conteneur`);
        }
    }
});

test('layout : ordre seuil < rotation < 50ft', () => {
    for (const [name, r] of Object.entries(CASES)) {
        const L = takeoffProfileLayout(r);
        assert.ok(L.liftX > 2, `${name}: rotation après le seuil`);
        assert.ok(L.liftX < L.fiftyDrawX, `${name}: 50ft (dessiné) après la rotation`);
        assert.ok(L.fiftyDrawX <= L.xR - 1.5, `${name}: point dessiné dans le cadre`);
    }
});

test('layout : position du 50ft selon le verdict', () => {
    const ok = takeoffProfileLayout(CASES.ok);
    assert.ok(ok.fiftyX < ok.xR, 'ok : 50ft atteint avant le bord (fin de piste)');
    const caution = takeoffProfileLayout(CASES.caution);
    assert.ok(caution.fiftyX < caution.xR, 'caution : 50ft encore dans le cadre');
    const danger = takeoffProfileLayout(CASES.danger);
    assert.ok(danger.fiftyX > danger.xR, 'danger : 50ft au-delà du cadre');
    assert.ok(Math.abs(danger.fiftyDrawX - (danger.xR - 2)) < 0.01, 'danger : montée tronquée au bord');
    assert.equal(takeoffProfileLayout(CASES.unknown).rwyEndX, null, 'unknown : pas de fin de piste');
});

test('layout : échelle proportionnelle aux distances réelles', () => {
    // Le 50ft tombe à (fiftyFt/runwayLength)×100 % de la largeur, la
    // rotation à (groundRoll/runwayLength)×100 % — invariants conservés
    // de l'époque où la barre « plan » servait de référence.
    const W = 770;
    for (const name of ['ok', 'caution', 'danger']) {
        const r = CASES[name];
        const L = takeoffProfileLayout(r, W);
        const expected = (r.fiftyFt / r.runwayLength) * W;
        assert.ok(Math.abs(L.fiftyX - expected) < 0.5, `${name}: position 50ft proportionnelle`);
        const expectedRoll = Math.min(r.groundRoll / r.runwayLength * W, W - 30);
        assert.ok(Math.abs(L.liftX - expectedRoll) < 0.5, `${name}: position rotation proportionnelle`);
    }
});

test('layout : étiquettes et assiette', () => {
    for (const [name, r] of Object.entries(CASES)) {
        const L = takeoffProfileLayout(r);
        assert.ok(L.labelLiftX >= 24, `${name}: étiquette pas sur le bord gauche`);
        assert.ok(L.labelLiftX <= L.xR - 46, `${name}: étiquette dans le cadre`);
        assert.ok(L.climbAngle > 0 && L.climbAngle < 45, `${name}: pente de montée plausible (${L.climbAngle.toFixed(1)}°)`);
        assert.ok(L.planeScale >= 1.18 && L.planeScale <= 1.18 * 1.5, `${name}: taille avion bornée`);
    }
});

test('layout : garde-fou roulement ≥ 50ft ou ≥ piste (données incohérentes)', () => {
    const L = takeoffProfileLayout({ groundRoll: 2000, fiftyFt: 1500, runwayLength: 3000, margin: 1500, level: 'ok' });
    assert.ok(L.liftX <= L.fiftyDrawX, 'rotation clampée avant le point 50ft');
    const X = takeoffProfileLayout({ groundRoll: 1100, fiftyFt: 1680, runwayLength: 1000, margin: -680, level: 'danger' });
    assert.ok(X.liftX <= X.xR - 30, 'rotation clampée avant le bord droit');
});

test('svg : distances attendues présentes, pas de NaN/undefined', () => {
    for (const [name, r] of Object.entries(CASES)) {
        for (const isFr of [true, false]) {
            const svg = takeoffProfileSvg(r, isFr);
            assert.match(svg, new RegExp(`${ftToM(Math.min(r.groundRoll, r.fiftyFt))} m`), `${name}/fr=${isFr}: distance roulement`);
            assert.doesNotMatch(svg, /NaN|undefined/, `${name}/fr=${isFr}: pas de valeurs invalides`);
            assert.match(svg, /role="img"/, `${name}/fr=${isFr}: aria`);
        }
    }
});

test('svg : étiquette 50 ft affichée seulement si le point est dans le cadre', () => {
    for (const name of ['ok', 'caution']) {
        assert.match(takeoffProfileSvg(CASES[name], true), /50 ft ·/, `${name}: étiquette 50ft`);
    }
    assert.doesNotMatch(takeoffProfileSvg(CASES.danger, true), /50 ft ·/, 'danger : pas d\'étiquette 50ft (hors cadre)');
});

test('layout : étiquette 50 ft bascule à gauche si elle déborderait', () => {
    // Cas nominal : point 50ft assez loin du seuil → ancre à droite.
    const nom = takeoffProfileLayout(CASES.ok, 354);
    assert.equal(nom.fiftyLblAnchor, 'end');
    // Piste très longue, point 50ft proche du seuil → ancre à gauche.
    const far = takeoffProfileLayout({ groundRoll: 700, fiftyFt: 1250, runwayLength: 8000, margin: 6750, level: 'ok' }, 354);
    assert.equal(far.fiftyLblAnchor, 'start', 'bascule d ancrage');
    assert.equal(far.fiftyLblX, 2, 'collée au bord gauche');
    assert.ok(far.fiftyLblX >= 0 && far.fiftyLblX < far.fiftyX, 'à gauche du point 50ft');
});

test('svg : invite de saisie si piste inconnue', () => {
    assert.match(takeoffProfileSvg(CASES.unknown, true), /longueur piste \?/, 'invite FR');
    assert.match(takeoffProfileSvg(CASES.unknown, false), /runway length \?/, 'invite EN');
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
