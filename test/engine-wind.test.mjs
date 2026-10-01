// Fiche n°15 (audit 27/09) : le groupe vent OACI peut être en KT, MPS
// (Russie, Chine…) ou KMH selon la région émettrice. _parseVent (engine.js)
// normalise désormais tout en KT via parseWindGroupToKt (metar.js, ex-core) ; ces
// tests vérifient le ROUND-TRIP complet analyserMETAR → parseWindLoose (metar.js),
// consommé par la rose des vents, la piste en service, le go-nogo et les
// widgets. Les largeurs de chiffres comptent : parseWindLoose exige
// 3 chiffres de direction et 2 de vitesse — « 90° 8KT » nettoyé en
// « 908KT » ne matcherait pas, d'où le re-padding après conversion.
// Pur — testé sous Node. `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyserMETAR } from '../js/engine.js';
import { parseWindLoose } from '../js/metar.js';   // W11 : décodeur unique

const ventBase = (metar) => analyserMETAR(metar).base.vent[0].val;

// M3 (audit 27/09) : suffixe visi français ND/NDZ — l'ancien regex exigeait
// un espace juste après les 4 chiffres : « 7000ND » laissait la visi VIDE
// sur la page principale (catégorie alors dégradée à l'inconnu).
describe('visi ND/NDZ française (M3, audit 27/09)', () => {
    test('7000ND → « 7000 m » (pas de visi vide)', () => {
        const r = analyserMETAR('LFRN 271030Z AUTO 24012KT 7000ND BKN012 16/12 Q1013');
        assert.equal(r.base.visi[0].val, '7000 m');
    });
    test('3500NDZ → « 3500 m »', () => {
        const r = analyserMETAR('LFRN 271030Z AUTO 24012KT 3500NDZ BKN012 16/12 Q1013');
        assert.equal(r.base.visi[0].val, '3500 m');
    });
});

describe('_parseVent → parseWindLoose — round-trip KT/MPS/KMH', () => {
    test('KT inchangé : 17015KT → « 170° 15KT »', () => {
        const v = ventBase('LFRB 270800Z 17015KT 9999 FEW030 18/07 Q1013 NOSIG');
        assert.equal(v, '170° 15KT');
        const w = parseWindLoose(v);
        assert.equal(w.dir, 170);
        assert.equal(w.speed, 15);
        assert.equal(w.gust, null);
    });

    test('MPS : 20004MPS → « 200° 08KT » (4 m/s = 7.78 kt arrondi)', () => {
        const v = ventBase('ULAA 270800Z 20004MPS 9999 SCT025 M07/M10 Q1013 NOSIG');
        assert.equal(v, '200° 08KT');
        const w = parseWindLoose(v);
        assert.equal(w.dir, 200);
        assert.equal(w.speed, 8);
    });

    test('KMH : 31012KMH → « 310° 06KT » (12 km/h = 6.48 kt arrondi)', () => {
        const v = ventBase('ZBAA 270800Z 31012KMH 9999 NSW 22/12 Q1008 NOSIG');
        assert.equal(v, '310° 06KT');
        const w = parseWindLoose(v);
        assert.equal(w.dir, 310);
        assert.equal(w.speed, 6);
    });

    test('MPS rafales + variation : 24012G24MPS 180V300 → 23G47 kt, 180V300', () => {
        const v = ventBase('UUEE 270800Z 24012G24MPS 180V300 9999 BKN025 M07/M10 Q1013');
        assert.equal(v, '240° 23G47KT 180V300');
        const w = parseWindLoose(v);
        assert.equal(w.speed, 23);
        assert.equal(w.gust, 47);
        assert.equal(w.varFrom, 180);
        assert.equal(w.varTo, 300);
    });

    test('direction < 100° en MPS : 09008MPS → « 090° 16KT » (3 chiffres)', () => {
        const v = ventBase('ULMM 270800Z 09008MPS 9999 OVC020 M05/M07 Q1015');
        assert.equal(v, '090° 16KT');
        const w = parseWindLoose(v);
        assert.equal(w.dir, 90);
        assert.equal(w.speed, 16);   // 8 × 1.94384 = 15.55
    });

    test('vent faible converti < 10 kt : VRB03MPS → « VRB 06KT » (padding 2 chiffres)', () => {
        const v = ventBase('UUEE 270800Z VRB03MPS 9999 SCT025 M07/M10 Q1013');
        assert.equal(v, 'VRB 06KT');
        const w = parseWindLoose(v);
        assert.equal(w.variable, true);
        assert.equal(w.dir, null);
        assert.equal(w.speed, 6);
    });

    test('sans vent lisible : chaîne vide, pas de couche vent fantôme', () => {
        const v = ventBase('LFRB 270800Z 9999 FEW030 18/07 Q1013 NOSIG');
        assert.equal(v, '');
    });
});
