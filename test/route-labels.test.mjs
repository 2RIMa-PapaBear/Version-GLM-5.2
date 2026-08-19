// Tests des étiquettes de tronçons sur la carte régionale : direction d'écran
// de la pilule — à DROITE d'un tronçon vertical, AU-DESSUS d'un tronçon
// horizontal (jamais dessous, jamais à gauche, jamais sur la ligne).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _tooltipDirForTrack } from '../js/route-weather.js';

test('tronçon vertical (cap nord/sud) → pilule à droite de la ligne', () => {
    assert.equal(_tooltipDirForTrack(0), 'right');
    assert.equal(_tooltipDirForTrack(10), 'right');
    assert.equal(_tooltipDirForTrack(180), 'right');
    assert.equal(_tooltipDirForTrack(190), 'right');
    assert.equal(_tooltipDirForTrack(350), 'right');
});

test('tronçon horizontal (cap est/ouest) → pilule au-dessus de la ligne', () => {
    assert.equal(_tooltipDirForTrack(90), 'top');
    assert.equal(_tooltipDirForTrack(45), 'top');
    assert.equal(_tooltipDirForTrack(134), 'top');
    assert.equal(_tooltipDirForTrack(270), 'top');
    assert.equal(_tooltipDirForTrack(226), 'top');
    assert.equal(_tooltipDirForTrack(314), 'top');
});
