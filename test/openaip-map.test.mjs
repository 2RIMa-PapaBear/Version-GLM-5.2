// Tests du mapping openAIP → interne : étiquette A/A au lieu de UNK.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _mapAirport } from '../js/openaip.js';

const apt = (frequencies) => _mapAirport({
    name: 'PLOERMEL (LFRP)',
    country: 'France',
    elevation: { value: 100 },
    geometry: { coordinates: [-2.37, 48.0] },
    frequencies,
    runways: [],
});

test('fréquence openAIP type UNK nommée A/A → étiquette A/A', () => {
    const fs = apt([
        { type: 16, value: '118.255', name: 'A/A' },
        { type: 16, value: '123.5', name: 'AIR-AIR Ploermel' },
        { type: 16, value: '121.0', name: 'Autre service' },   // UNK sans nom A/A → reste UNK
        { type: 10, value: '118.4', name: 'TWR' },
    ]).frequencies;
    const at = (v) => fs.find(x => x.freq === v);   // le tri (primary, fréq) réordonne
    assert.equal(at(118.255).type, 'A/A', '« A/A » reconnu');
    assert.equal(at(123.5).type, 'A/A', '« AIR-AIR » reconnu');
    assert.equal(at(121.0).type, 'UNK', 'UNK sans indice de nom reste UNK');
    assert.equal(at(118.4).type, 'TWR', 'type réel inchangé');
});

test('fréquence openAIP sans type connu → COM (inchangé)', () => {
    const f = apt([{ type: 99, value: '130.0', name: 'X' }]).frequencies;
    assert.equal(f[0].type, 'COM');
});
