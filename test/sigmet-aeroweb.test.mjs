// Tests C1 (14/09) : parse du XML AEROWEB « Messages SIGMET, GAMET, AIRMET »
// (source France via le relais Worker /sigmet — compte AEROWEB du pilote).
// + M5 (audit 27/09) : filtre géographique du GO/NO-GO.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAerowebSigmetXml, _extractCoords, evaluateSigmetAirmet, _sigmetNear } from '../js/sigmet.js';

// DOM factice (le parseur n'utilise que querySelectorAll + textContent —
// DOMParser n'existe pas sous Node).
const doc = (messages) => ({ querySelectorAll: () => messages.map(m => ({ textContent: m })) });

describe('parseAerowebSigmetXml (AEROWEB France)', () => {
    test('deux SIGMET dans un message FIR → deux entrées', () => {
        const r = parseAerowebSigmetXml('', doc([
            'FIR LFFF\nLFPW SIGMET A01 VALID 140900/141500 LFRR-\nLFRR BREST FIR SEV TURB FCST BLW FL100 AT N4800 W00400 MOV NE 25KT NC=',
            'FIR LFRR\nLFPW SIGMET B02 VALID 141500/142100 LFRR-\nLFRR BREST FIR SEV ICE FCST N4700 W00300 - N4800 W00200 BLW FL080=',
        ]));
        assert.equal(r.length, 2);
        assert.ok(r[0].raw.startsWith('LFPW SIGMET A01'));
        assert.ok(r[1].raw.includes('SEV ICE'));
        assert.equal(r[0].type, 'SIGMET');
    });

    test('plusieurs SIGMET dans un même bloc → un par émission (split LFPW)', () => {
        const r = parseAerowebSigmetXml('', doc([
            'FIR LFFF\nLFPW SIGMET A01 VALID 140900/141500 LFRR-\nLFRR FIR SEV TURB NC=\nLFPW SIGMET A03 VALID 141200/141800 LFEE-\nLFEE REIMS FIR OCNL TS=' ,
        ]));
        assert.equal(r.length, 2);
        assert.ok(r[1].raw.includes('OCNL TS'));
    });

    test('« pas de SIGMET » → vide (aucun repli US en France)', () => {
        const r = parseAerowebSigmetXml('', doc(['Pas de SIGMET, GAMET, AIRMET pour : LFFF']));
        assert.equal(r.length, 0);
    });

    test('XML réel AEROWEB sans messages (réponse vide du 14/09) → vide', () => {
        const xml = `<?xml version="1.0"?><root><request><firs><![CDATA[LFFF,LFRR]]></firs></request><params><title><![CDATA[Messages SIGMET, GAMET, AIRMET]]></title></params><fir><messages/><no_messages><message id="LFFF" type="FIR" prefixe="FIR "><name><![CDATA[FRANCE]]></name></message></no_messages></fir></root>`;
        // sans DOMParser sous Node → sortie vide silencieuse (comportement attendu)
        const r = parseAerowebSigmetXml(xml);
        assert.equal(r.length, 0);
    });

    test('entrée trop courte ignorée (bruit)', () => {
        const r = parseAerowebSigmetXml('', doc(['SIGMET court']));
        assert.equal(r.length, 0);
    });
});

// Fiche 24 (27/09) : la regex d'origine ne connaissait QUE le format
// inverse chiffres-lettres « 4800N 00400W » — or AEROWEB (avertissement
// explicite « conforme Annexe 3 OACI ») et tous les SIGMET européens
// écrivent la lettre cardinale AVANT : « N4945 W00350 ». Résultat : aucun
// polygone SIGMET France jamais tracé sur la carte régionale.
describe('_extractCoords (OACI lettre-puis-chiffres + variantes)', () => {
    test('format OACI Annexe 3 — SIGMET européen réel (Milan/Londres)', () => {
        const raw = 'LIMM MILANO FIR SEV TURB FCST WI N4945 W00330 - N4940 W00430 - N5000 W00500 - N5130 W00600';
        const c = _extractCoords(raw);
        assert.equal(c.length, 4);
        assert.deepEqual(c[0], { lat: 49.75, lon: -3.5 });   // 49°45 N 003°30 W
        assert.deepEqual(c[2], { lat: 50, lon: -5 });
    });

    test('SIGMET France type AEROWEB : polygone 4 points → tracable', () => {
        const raw = 'LFXX SIGMET 3 VALID 271300/271700 LFRR-\nLFRR BREST FIR SEV TURB FCST WI N5000 W00600 - N5000 W00000 - N4700 W00000 - N4700 W00600 - FL180/FL360 MOV E 15KT NC=';
        const c = _extractCoords(raw);
        assert.equal(c.length, 4);
        assert.deepEqual(c[0], { lat: 50, lon: -6 });
        assert.deepEqual(c[3], { lat: 47, lon: -6 });
    });

    test('degrés seuls : N54 W020, et W004 lu 4° (ancien parseur : 0°04)', () => {
        const c = _extractCoords('WI N54 W020 - N50 W004');
        assert.deepEqual(c[0], { lat: 54, lon: -20 });
        assert.deepEqual(c[1], { lat: 50, lon: -4 });
    });

    test('hémisphères sud/est : S3400 E01830', () => {
        assert.deepEqual(_extractCoords('WI S3400 E01830'), [{ lat: -34, lon: 18.5 }]);
    });

    test('format inverse chiffres-puis-lettres, espacé ou collé (héritage)', () => {
        assert.deepEqual(_extractCoords('4700N 00300W'), [{ lat: 47, lon: -3 }]);
        assert.deepEqual(_extractCoords('AT 4800N00400W'), [{ lat: 48, lon: -4 }]);
    });

    test('aucune fausse paire sur validités, FL, vents', () => {
        const raw = 'VALID 271200/271600 LFFF- FL180/FL360 MOV NE 25KT NC= 240/15KT Q1013 101200/101600';
        assert.deepEqual(_extractCoords(raw), []);
    });
});

describe('M5 (audit 27/09) : filtre géographique du GO/NO-GO SIGMET', () => {
    // Polygone pyrénéen (rectangle ~42 NM de haut vers Tarbes/Lourdes).
    const pyrenees = { hazard: 'TS', coords: [
        { lat: 43.2, lon: 0.0 }, { lat: 43.2, lon: 1.2 },
        { lat: 42.5, lon: 1.2 }, { lat: 42.5, lon: 0.0 },
    ] };

    test('SIGMET pyrénéen : Lille → aucune alerte, Tarbes (dans la zone) → alerte', () => {
        const lille = [{ lat: 50.57, lon: 3.22 }];
        assert.equal(evaluateSigmetAirmet([pyrenees], lille).length, 0,
            'un orage SIGMÉT sur les Pyrénées ne met plus Lille en NO-GO');
        const tarbes = [{ lat: 43.19, lon: 0.07 }];
        assert.equal(evaluateSigmetAirmet([pyrenees], tarbes).length, 1,
            'le terrain sous le SIGMET reste alerté');
    });

    test('route passant à ~26 NM au nord : arête proche → concerne le vol', () => {
        // Toulouse → Carcassonne : au nord du polygone, à ~26 NM de son
        // arête lat 43.2 — les milieux des arêtes doivent le détecter.
        const route = [{ lat: 43.6, lon: 1.4 }, { lat: 43.6, lon: 2.3 }];
        assert.ok(_sigmetNear(pyrenees, route), 'arête à ≤ 40 NM de la route');
    });

    test('conservateur : sans position OU sans géométrie → SIGMET retenu', () => {
        assert.equal(evaluateSigmetAirmet([pyrenees]).length, 1,
            'pas de position fournie → tout SIGMET alerte (ancien comportement)');
        const sansCoords = { hazard: 'TS', coords: [] };
        assert.equal(evaluateSigmetAirmet([sansCoords], [{ lat: 50.57, lon: 3.22 }]).length, 1,
            'SIGMET sans géométrie extraite → conservateur');
    });
});
