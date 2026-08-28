// Tests du module fréquences SIA + overrides (js/freq-sia.js) et du
// parseur eAIP (scripts/fetch-freq-sia.mjs, fonction pure exportée).
import test from 'node:test';
import assert from 'node:assert/strict';
import { getAirportFreqs, getServiceFreq, getSiaAirac, _setSources } from '../js/freq-sia.js';
import { parseAdFrequencies } from '../scripts/fetch-freq-sia.mjs';

const SIA = {
    airac: '2026-07-09',
    airports: {
        LFRV: [{ type: 'AFIS', name: 'VANNES Information', value: '122.605', hor: 'HO' }],
        LFPB: [{ type: 'TWR', name: 'LE BOURGET Tour', value: '118.405', hor: 'H24' }],
    },
};
const OVERRIDES = {
    airports: { LFQI: [{ type: 'AFIS', name: 'ALBERT Information', value: '119.250' }] },
    services: { 'RENNES INFORMATION': '134.000' },
};
_setSources(SIA, OVERRIDES);

test('getAirportFreqs : overrides > SIA > openAIP', () => {
    // Terrain corrigé manuellement : priorité maximale.
    const ov = getAirportFreqs('LFQI', []);
    assert.equal(ov.source, 'overrides');
    assert.equal(ov.freqs[0].freq, 119.25);
    assert.equal(ov.freqs[0].primary, true);

    // Terrain français dans l'eAIP : source SIA.
    const sia = getAirportFreqs('LFRV', [{ freq: 122.605, name: 'VANNES INFORMATION', type: 'AFIS', primary: true }]);
    assert.equal(sia.source, 'sia');
    assert.equal(sia.freqs[0].name, 'VANNES Information');
    assert.equal(sia.freqs[0].primary, true);   // AFIS = principal

    // Hors France / absent du SIA : openAIP inchangé.
    const oa = getAirportFreqs('EGJJ', [{ freq: 119.9, name: 'JERSEY', type: 'TWR', primary: true }]);
    assert.equal(oa.source, 'openaip');
    assert.equal(oa.freqs.length, 1);
});

test('getServiceFreq : correction SIV par indicatif (insensible à la casse)', () => {
    assert.equal(getServiceFreq('RENNES INFORMATION'), '134.000');
    assert.equal(getServiceFreq('rennes information'), '134.000');
    assert.equal(getServiceFreq('SEINE INFORMATION'), null);
    assert.equal(getServiceFreq(null), null);
});

test('getSiaAirac : cycle publié', () => {
    assert.equal(getSiaAirac(), '2026-07-09');
});

// ------------------------------------------------------------ parseur eAIP
const AD_HTML = `
<table><tr><td>Service</td><td>Indicatif</td><td>FREQ</td></tr>
<tr><td>AFIS</td><td>VANNES Information (FR)<br>VANNES Information (EN)</td><td>122.605 MHz</td><td>HO</td><td></td></tr>
<tr><td>A/A</td><td>VANNES (FR)</td><td>122.605&nbsp;MHz</td><td>HX</td><td>Absence ATS.</td></tr>
<tr><td>TWR</td><td>TOUR (FR)</td><td>118.400 MHz</td><td>H24</td><td></td></tr>
<tr><td></td><td>sans fréquence</td><td>NIL</td></tr>
</table>`;

test('parseAdFrequencies : lignes AD 2.18 → liste dédupliquée', () => {
    const out = parseAdFrequencies(AD_HTML);
    assert.equal(out.length, 3);
    assert.deepEqual(out[0], { type: 'AFIS', name: 'VANNES Information', value: '122.605', hor: 'HO' });
    assert.equal(out[2].type, 'TWR');
    assert.equal(out[2].value, '118.400');

    // Déduplique type+name+value identiques.
    const dup = parseAdFrequencies(AD_HTML + '<tr><td>AFIS</td><td>VANNES Information (FR)</td><td>122.605 MHz</td></tr>');
    assert.equal(dup.length, 3);
});
