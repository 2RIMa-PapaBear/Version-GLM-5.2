// Tests du niveau de congélation (js/freezing-level.js) —
// evaluateIcingRisk est pur (zones thermodynamiques T/Td + approche
// plafond vs isotherme 0°C) ; fetchFreezingLevel (réseau Open-Meteo)
// n'est pas testé ici. state.lang vaut 'fr' par défaut : les messages
// sont assertés en français.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { evaluateIcingRisk } from '../js/freezing-level.js';

describe('freezing-level — entrées invalides et rétro-compatibilité', () => {

    test('entrées invalides → null (isotherme absente ou nuageStr vide)', () => {
        assert.equal(evaluateIcingRisk(null, 'BKN010'), null);
        assert.equal(evaluateIcingRisk(NaN, 'BKN010'), null);
        assert.equal(evaluateIcingRisk(3000, ''), null);
        assert.equal(evaluateIcingRisk(3000, null), null);
    });

    test('sans données thermo NI plafond exploitable → null (comportement historique)', () => {
        // SKC/CAVOK → getCeiling = 999 → pas de nuage significatif ;
        // sans T° fournie, aucune des deux approches ne peut conclure.
        assert.equal(evaluateIcingRisk(5000, 'SKC'), null);
        assert.equal(evaluateIcingRisk(5000, 'CAVOK'), null);
    });
});

describe('freezing-level — analyse thermodynamique T / Td', () => {

    test('conversion m → ft : 2500 m × 3,28084 = 8202,10 → libellé « 8202 ft »', () => {
        // La conversion ×3,28084 vit dans fetchFreezingLevel (réseau) ;
        // on vérifie ici que la valeur en pieds, une fois convertie,
        // alimente le libellé arrondi : 2500 × 3,28084 = 8202,1 → 8202.
        // T = 10 > 2 → ok, ciel clair → message informatif.
        const r = evaluateIcingRisk(8202, 'SKC', 10, null);
        assert.equal(r.level, 'ok');
        assert.equal(r.message, 'Isotherme 0°C à 8202 ft — pas de risque détecté');
    });

    test('zone critique −2..+2 °C : danger en nuage, danger saturé, caution sinon', () => {
        // T = 0 dans la zone critique, BKN010 → plafond 1000 ft :
        // nuage significatif → GIVRAGE PROBABLE (sans Td fourni).
        const d = evaluateIcingRisk(3000, 'BKN010', 0, null);
        assert.equal(d.level, 'danger');
        assert.equal(d.message, 'GIVRAGE PROBABLE — T 0°C');
        // Ciel clair mais quasi saturé : T = 1, Td = −1 → spread 2 ≤ 2.
        const s = evaluateIcingRisk(3000, 'SKC', 1, -1);
        assert.equal(s.level, 'danger');
        assert.equal(s.message, 'GIVRAGE PROBABLE — T 1°C, Td -1°C');
        // Zone critique sans nuage NI saturation : T = 1, Td = −4 →
        // spread 5 (ni ≤ 2, ni > 5) → simple vigilance (le Td fourni
        // accompagne le T dans le message).
        const c = evaluateIcingRisk(3000, 'SKC', 1, -4);
        assert.equal(c.level, 'caution');
        assert.equal(c.message, 'Risque de givrage — T 1°C, Td -4°C');
    });

    test('air très sec (spread > 5 °C) : ok même dans la zone critique', () => {
        // T = 0, Td = −8 → spread 8 > 5 → « trop sec » l'emporte sur la
        // zone critique. Plafond 1000 ft SOUS l'isotherme 3000 ft → ok,
        // message « sous le plafond ».
        const r = evaluateIcingRisk(3000, 'BKN010', 0, -8);
        assert.equal(r.level, 'ok');
        assert.equal(r.message, 'Isotherme 0°C à 3000 ft — sous le plafond');
    });

    test('zone modérée −15..−2 °C : caution en nuage, ok sinon ; hors zone → ok', () => {
        // T = −10 en nuage → risque de givrage.
        const n = evaluateIcingRisk(3000, 'BKN010', -10, null);
        assert.equal(n.level, 'caution');
        assert.equal(n.message, 'Risque de givrage — T -10°C');
        // T = −10 sans nuage exploitable → ok.
        assert.equal(evaluateIcingRisk(3000, 'SKC', -10, null).level, 'ok');
        // T = −20 < −15 : air très froid, ok côté carburation.
        assert.equal(evaluateIcingRisk(3000, 'BKN010', -20, null).level, 'ok');
        // T = 10 > 2 : trop chaud, ok.
        assert.equal(evaluateIcingRisk(3000, 'BKN020', 10, null).level, 'ok');
    });
});

describe('freezing-level — approche plafond vs isotherme 0°C', () => {

    test('plafond au-dessus de l\'isotherme : marge < 2000 ft → danger, 2000 → caution', () => {
        // Sans donnée thermo, on retombe sur la logique historique.
        // Plafond BKN010 = 1000 ft ≥ isotherme 800 ft, marge 200 < 2000.
        const d = evaluateIcingRisk(800, 'BKN010', null, null);
        assert.equal(d.level, 'danger');
        assert.equal(d.message, 'GIVRAGE PROBABLE — plafond 1000 ft, Isotherme 0°C à 800 ft');
        // Marge EXACTEMENT 2000 ft : BKN030 = 3000 − 1000 = 2000, non < 2000
        // → caution (et pas danger).
        const c = evaluateIcingRisk(1000, 'BKN030', null, null);
        assert.equal(c.level, 'caution');
        assert.equal(c.message, 'Risque de givrage en nuage — Isotherme 0°C à 1000 ft');
    });

    test('plafond sous l\'isotherme : vol possible en air positif → ok', () => {
        // BKN010 = 1000 ft < isotherme 5000 ft : pas de chevauchement.
        const r = evaluateIcingRisk(5000, 'BKN010', null, null);
        assert.equal(r.level, 'ok');
        assert.equal(r.message, 'Isotherme 0°C à 5000 ft — sous le plafond');
    });

    test('fusion des approches : thermo danger prioritaire, thermo caution rehaussée', () => {
        // Thermo danger (T = 0 saturé) : le signal plafond est écarté
        // pour éviter le double message — on garde le message thermo.
        const t = evaluateIcingRisk(800, 'BKN010', 0, 0);
        assert.equal(t.level, 'danger');
        assert.equal(t.message, 'GIVRAGE PROBABLE — T 0°C, Td 0°C');
        // Thermo caution (zone MODÉRÉE T = −10 en nuage) + plafond 1000 ≥
        // isotherme 800 avec marge 200 < 2000 → rehaussé en danger par le
        // plafond (le seul chemin où la fusion croît d'un cran : en zone
        // critique, un nuage significatif donnerait déjà thermo danger).
        const m = evaluateIcingRisk(800, 'BKN010', -10, null);
        assert.equal(m.level, 'danger');
        assert.equal(m.message, 'GIVRAGE PROBABLE — plafond 1000 ft, Isotherme 0°C à 800 ft');
    });
});
