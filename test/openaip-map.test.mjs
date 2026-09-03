// Tests du mapping openAIP → interne : JAMAIS d'étiquette « UNK » à
// l'affichage — le nom désigne le vrai rôle (A/A, TWR…) sinon pas
// d'étiquette (la valeur de fréquence reste fiable, le rôle community non).
import test from 'node:test';
import assert from 'node:assert/strict';
import { _mapAirport, _relabelUnk } from '../js/openaip.js';

const apt = (frequencies) => _mapAirport({
    name: 'PLOERMEL (LFRP)',
    country: 'France',
    elevation: { value: 100 },
    geometry: { coordinates: [-2.37, 48.0] },
    frequencies,
    runways: [],
});

test('fréquence openAIP type UNK : rôle déduit du nom, sinon PAS d\u2019étiquette', () => {
    const fs = apt([
        { type: 16, value: '118.255', name: 'A/A' },
        { type: 16, value: '123.5', name: 'AIR-AIR Ploermel' },
        { type: 16, value: '121.0', name: 'Autre service' },   // sans rôle décelable
        { type: 16, value: '119.9', name: 'TWR Ploermel' },
        { type: 16, value: '120.5', name: 'AFIS' },
        { type: 16, value: '121.5', name: 'Approche' },
        { type: 10, value: '118.4', name: 'TWR' },
    ]).frequencies;
    const at = (v) => fs.find(x => x.freq === v);   // le tri (primary, fréq) réordonne
    assert.equal(at(118.255).type, 'A/A', '« A/A » reconnu');
    assert.equal(at(123.5).type, 'A/A', '« AIR-AIR » reconnu');
    assert.equal(at(121.0).type, '', 'sans rôle décelable → PAS d\u2019étiquette (jamais UNK)');
    assert.equal(at(119.9).type, 'TWR', '« TWR » dans le nom → TWR');
    assert.equal(at(120.5).type, 'AFIS', '« AFIS » dans le nom → AFIS');
    assert.equal(at(121.5).type, 'APP', '« Approche » dans le nom → APP');
    assert.equal(at(118.4).type, 'TWR', 'type réel inchangé');
});

test('fréquence openAIP sans type connu → COM (inchangé)', () => {
    const f = apt([{ type: 99, value: '130.0', name: 'X' }]).frequencies;
    assert.equal(f[0].type, 'COM');
});

test('aucune fréquence ne sort jamais étiquetée UNK', () => {
    const fs = apt([
        { type: 16, value: '118.255', name: 'A/A' },
        { type: 16, value: '121.0', name: 'Radio locale' },
        { type: 16, value: '122.0', name: '' },
        { type: 5, value: '118.4', name: 'AFIS' },
    ]).frequencies;
    assert.ok(fs.every(x => x.type !== 'UNK'), 'zéro UNK dans la sortie');
});

test('_relabelUnk : helper du cache IDB (rôles déduits du nom)', () => {
    assert.equal(_relabelUnk('A/A'), 'A/A');
    assert.equal(_relabelUnk('AIR-AIR Ploermel'), 'A/A');
    assert.equal(_relabelUnk('Tour de contrôle'), 'TWR');
    assert.equal(_relabelUnk('TOWER'), 'TWR');
    assert.equal(_relabelUnk('AFIS'), 'AFIS');
    assert.equal(_relabelUnk('Approche'), 'APP');
    assert.equal(_relabelUnk('Radio locale'), '');
    assert.equal(_relabelUnk(''), '');
});
