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

test('layout : étiquette 50 ft à droite du repère, repli à gauche si débordement', () => {
    // Cas nominal : de la place à droite → texte au bout du repère,
    // juste au-dessus de son extrémité haute (y = fiftyY + 5).
    const nom = takeoffProfileLayout(CASES.ok, 354);
    assert.equal(nom.fiftyLblAnchor, 'start', 'ancre début (droite)');
    assert.ok(Math.abs(nom.fiftyLblX - (nom.fiftyX + 6)) < 0.01, 'collée à droite du repère');
    assert.equal(nom.fiftyLblY, 31, 'hauteur = bout du repère (fiftyY+5)');
    // Marge faible : point 50ft près du bord droit → repli à gauche,
    // SOUS la montée sur la rangée du bas (même hauteur que la marge).
    const caut = takeoffProfileLayout(CASES.caution, 354);
    assert.equal(caut.fiftyLblAnchor, 'end', 'bascule d ancrage');
    assert.equal(caut.fiftyLblY, 64, 'repli sous la montée (rwyY−12)');
    assert.ok(caut.fiftyLblX <= caut.fiftyX - 3 + 0.01 && caut.fiftyLblX - 81 > 0, 'à gauche du point, dans le cadre');
    // Piste très longue, point proche du seuil : reste à droite, en bas.
    const far = takeoffProfileLayout({ groundRoll: 700, fiftyFt: 1250, runwayLength: 8000, margin: 6750, level: 'ok' }, 354);
    assert.equal(far.fiftyLblAnchor, 'start', 'pas de bascule');
    assert.ok(far.fiftyLblX > far.fiftyX, 'à droite du point 50ft');
    assert.equal(far.fiftyLblY, 31, 'hauteur = bout du repère');
});

test('svg : invite de saisie si piste inconnue', () => {
    assert.match(takeoffProfileSvg(CASES.unknown, true), /longueur piste \?/, 'invite FR');
    assert.match(takeoffProfileSvg(CASES.unknown, false), /runway length \?/, 'invite EN');
});

test('svg : verdicts danger et marge', () => {
    assert.match(takeoffProfileSvg(CASES.danger, true), new RegExp(`manque ${ftToM(180)} m`), 'manque FR');
    assert.match(takeoffProfileSvg(CASES.danger, false), new RegExp(`short ${ftToM(180)} m`), 'manque EN');
    // « manque » AU-DESSUS de l'avion en vol (zone haute, dégagée).
    const yManque = takeoffProfileSvg(CASES.danger, true).match(/<text x="[\d.]+" y="([\d.]+)"[^>]*>manque/)?.[1];
    assert.ok(yManque != null && +yManque < 50, `manque au-dessus de l'avion (y=${yManque})`);
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

// ---- A5 : schéma d'ATTERRISSAGE (descente 50 ft → toucher → arrêt) ---------
import { landingProfileSvg, landingProfileLayout } from '../js/takeoff-profile.js';

const LDG = {
    // C172 POH 725/1400, piste confortable.
    ok: { rollFt: 725, fiftyFt: 1400, runwayLength: 3300, margin: 1900, level: 'ok' },
    // Marge faible (distance d'arrêt près de la fin).
    caution: { rollFt: 725, fiftyFt: 1400, runwayLength: 1600, margin: 200, level: 'caution' },
    // Distance d'arrêt AU-DELÀ de la piste.
    danger: { rollFt: 725, fiftyFt: 1400, runwayLength: 1200, margin: -200, level: 'danger' },
    unknown: { rollFt: 725, fiftyFt: 1400, runwayLength: null, margin: null, level: 'unknown' },
};

test('atterrissage layout : échelle fonctionnelle, arrêt ~2/3 de la largeur', () => {
    const L = landingProfileLayout(LDG.ok, 340);
    assert.equal(L.XR, 340, 'largeur = conteneur');
    assert.ok(L.known, 'piste connue');
    // Échelle : span = min(piste, arrêt × 1.6) — l'arrêt occupe ~62 %.
    const span = Math.min(LDG.ok.runwayLength, LDG.ok.fiftyFt * 1.6);
    const expectedStop = LDG.ok.fiftyFt / span * 340;
    assert.ok(Math.abs(L.stopX - expectedStop) < 1, `stopX ≈ ${expectedStop}, obtenu ${L.stopX}`);
    assert.ok(L.touchX > L.fiftyX, 'toucher après le seuil/50 ft');
    assert.ok(L.touchX < L.stopX, 'toucher avant l\u2019arrêt');
    assert.ok(L.descentAngle > 0, 'pente de descente positive');
    // Piste bien plus longue que l'arrêt : excédent tronqué, pas de jalon.
    assert.equal(L.rwyEndInFrame, false, 'fin de piste hors cadre (piste 3300 vs arrêt 1400)');
});

test('atterrissage layout : piste courte → piste entière dans le cadre, jalon au bord', () => {
    const L = landingProfileLayout(LDG.caution, 340);   // piste 1600 vs arrêt 1400
    assert.equal(L.rwyEndInFrame, true);
    assert.ok(Math.abs(L.rwyEndX - 340) < 1, 'fin de piste au bord droit');
    assert.ok(L.stopX / L.XR > 0.8, `arrêt en fin de piste (${Math.round(L.stopX / L.XR * 100)} %)`);
});

test('atterrissage étiquettes : « 50 ft » AVANT l\u2019avion en approche, « arrêt » AU-DESSUS de l\u2019avion posé', () => {
    const L = landingProfileLayout(LDG.ok, 340);
    // « 50 ft » : fin du texte au repère (anchor end), repère reculé du bord
    // gauche pour que le texte tienne — jamais sous l'avion qui descend.
    assert.equal(L.fiftyLblAnchor, 'end');
    assert.ok(L.fiftyLblX < L.fiftyX, 'étiquette 50 ft en amont du repère');
    assert.ok(L.fiftyLblX - 30 > 0, 'étiquette 50 ft dans le cadre');
    assert.ok(L.fiftyX >= 40, 'repère 50 ft écarté du bord gauche');
    // « arrêt » : au-dessus de la zone de l'avion posé (retour pilote 13/09).
    assert.ok(L.stopLblY < 50, `stopLblY au-dessus de l'avion posé (y=${L.stopLblY})`);
});

test('atterrissage layout : arrêt au-delà de la piste → tronqué au bord droit', () => {
    const L = landingProfileLayout(LDG.danger, 340);
    assert.equal(L.stopInFrame, false);
    assert.ok(L.stopX <= 338, 'arrêt dessiné borné au bord droit');
});

test('atterrissage svg : invariants de contenu sur les 4 verdicts', () => {
    for (const name of Object.keys(LDG)) {
        const svg = landingProfileSvg(LDG[name], true);
        assert.ok(!svg.includes('NaN'), `${name}: pas de NaN`);
        assert.ok(svg.includes('data-rwy="1"'), `${name}: ligne de piste`);
        assert.ok(svg.includes('>50 ft<'), `${name}: étiquette 50 ft au seuil`);
        assert.ok(/stroke="#10B981|#F59E0B|#EF4444|#38BDF8/.test(svg), `${name}: couleur de niveau`);
    }
    // Marge positive chiffrée, manque chiffré en danger, arrêt complet chiffré.
    assert.ok(landingProfileSvg(LDG.ok, true).includes(`+${ftToM(LDG.ok.margin)} m`), 'marge +X m');
    assert.ok(landingProfileSvg(LDG.danger, true).includes(`manque ${ftToM(Math.abs(LDG.danger.margin))} m`), 'manque X m');
    assert.ok(landingProfileSvg(LDG.ok, true).includes(`arrêt · ${ftToM(LDG.ok.fiftyFt)} m`), 'étiquette arrêt');
});
