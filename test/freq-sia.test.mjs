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

test('base XML AFIS/A-A : toutes les fréquences A/A de France (LFRP/LFRW/LFOM/LFEV/LFEQ)', async () => {
    const { readFile } = await import('node:fs/promises');
    const d = JSON.parse(await readFile(new URL('../data/freq-aa-sia.json', import.meta.url), 'utf8'));
    const attendus = {
        LFRP: ['A/A', '118.255'], LFRW: ['A/A', '119.785'], LFEV: ['A/A', '118.840'],
        LFEQ: ['AFIS', '119.605'], LFRV: ['AFIS', '122.605'],
    };
    for (const [icao, [type, value]] of Object.entries(attendus)) {
        const hit = (d.airports[icao] || []).find(x => x.type === type && x.value === value);
        assert.ok(hit, `${icao} ${type} ${value} présent`);
    }
    // LFOM : LES DEUX A/A publiées (« SAINT LAURENT » 123.500 + « LESSAY » 128.930).
    const lfom = d.airports.LFOM.filter(x => x.type === 'A/A');
    assert.equal(lfom.length, 2);
    assert.ok(lfom.some(x => x.name === 'LESSAY' && x.value === '128.930'));
    // Volume : ≥ 240 A/A sur ≥ 250 terrains.
    const nAA = Object.values(d.airports).flat().filter(x => x.type === 'A/A').length;
    assert.ok(nAA >= 240 && Object.keys(d.airports).length >= 250, `volume plausible (${nAA} A/A / ${Object.keys(d.airports).length} terrains)`);
});

test('getAirportFreqs : fusion eAIP ⊕ XML AFIS/A-A, déduplication par fréquence', () => {
    _setSources(
        { airac: 'X', airports: { LFX: [{ type: 'AFIS', name: 'X Information', value: '120.000' }] } },
        { airports: {}, services: {} },
        { airac: 'X', airports: { LFX: [{ type: 'A/A', name: 'X', value: '120.000' }, { type: 'A/A', name: 'Y', value: '123.455' }] } },
    );
    const r = getAirportFreqs('LFX', []);
    assert.equal(r.source, 'sia');
    assert.equal(r.freqs.length, 2, '120.000 dédupliquée, 123.455 ajoutée');
    assert.deepEqual(r.freqs.map(f => f.freq), [120, 123.455]);
    assert.equal(r.freqs[0].primary, true, 'AFIS primaire');
    assert.equal(r.freqs[1].primary, false, 'A/A non primaire');
});
