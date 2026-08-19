// Tests des étiquettes de tronçons sur la carte régionale :
// direction d'écran selon le cap (côté droit du sens de vol) + format du temps.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _tooltipDirForTrack } from '../js/route-weather.js';

test('cap au nord (000) → étiquette à droite de l\'écran (côté droit du vol)', () => {
    assert.equal(_tooltipDirForTrack(0), 'right');
    assert.equal(_tooltipDirForTrack(10), 'right');
    assert.equal(_tooltipDirForTrack(350), 'right');
});

test('cap à l\'est (090) → étiquette en dessous (le sud est à droite du vol)', () => {
    assert.equal(_tooltipDirForTrack(90), 'bottom');
    assert.equal(_tooltipDirForTrack(45), 'bottom');
    assert.equal(_tooltipDirForTrack(134), 'bottom');
});

test('cap au sud (180) → étiquette à gauche (l\'ouest est à droite du vol)', () => {
    assert.equal(_tooltipDirForTrack(180), 'left');
    assert.equal(_tooltipDirForTrack(200), 'left');
    assert.equal(_tooltipDirForTrack(224), 'left');
});

test('cap à l\'ouest (270) → étiquette au-dessus (le nord est à droite du vol)', () => {
    assert.equal(_tooltipDirForTrack(270), 'top');
    assert.equal(_tooltipDirForTrack(226), 'top');
    assert.equal(_tooltipDirForTrack(314), 'top');
});
