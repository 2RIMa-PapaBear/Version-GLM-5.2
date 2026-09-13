// Tests du calcul des vents en altitude (js/winds-aloft.js) —
// getWindAtAltitude est pur (interpolation) ; fetchWindsAloft (réseau)
// n'est pas testé ici.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { getWindAtAltitude } from '../js/winds-aloft.js';

const W = (altFt, speedKt, dir) => ({ altFt, speedKt, dir });
const WINDS = [W(262, 8, 180), W(3281, 20, 200), W(9843, 40, 220)];

test('getWindAtAltitude : croisière AMSL convertie en AGL via groundElevFt', () => {
    const w = WINDS.map(x => ({ ...x }));
    w.groundElevFt = 1500;
    // 3000 ft AMSL au-dessus d'un sol à 1500 ft = 1500 ft AGL :
    // interpolation entre 262 ft (8 kt / 180°) et 3281 ft (20 kt / 200°).
    const at = getWindAtAltitude(w, 3000);
    const t = (1500 - 262) / (3281 - 262);
    assert.equal(at.speedKt, Math.round(8 + 12 * t));
    assert.equal(at.dir, Math.round(180 + 20 * t));
    // Sans groundElevFt (donnée d'élévation absente) : 3000 lu tel quel.
    const brut = getWindAtAltitude(WINDS, 3000);
    assert.equal(brut.speedKt, Math.round(8 + 12 * (3000 - 262) / (3281 - 262)));
    assert.notEqual(at.speedKt, brut.speedKt, 'la conversion change le vent en relief');
});

test('getWindAtAltitude : bornes (sous le 1er niveau, au-dessus du dernier)', () => {
    const w = WINDS.map(x => ({ ...x }));
    w.groundElevFt = 1500;
    // 1000 ft AMSL - 1500 ft de sol = sous le niveau 80 m → niveau le plus bas.
    assert.deepEqual(getWindAtAltitude(w, 1000), { speedKt: 8, dir: 180 });
    assert.deepEqual(getWindAtAltitude(WINDS, 30000), { speedKt: 40, dir: 220 });
});

test('getWindAtAltitude : interpolation circulaire 350°→010° passe par 000°', () => {
    const w = [W(262, 10, 350), W(3281, 10, 10)];
    const mid = getWindAtAltitude(w, (262 + 3281) / 2);
    assert.equal(mid.dir, 0);
});

test('getWindAtAltitude : entrées invalides', () => {
    assert.equal(getWindAtAltitude([], 3000), null);
    assert.equal(getWindAtAltitude(null, 3000), null);
});
