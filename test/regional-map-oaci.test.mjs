// Tests des étiquettes aérodromes « carte OACI » (js/regional-map.js) :
// bloc code OACI / nom / altitude ft + fréquence Tour-AFIS-A/A, hiérarchie
// de la légende SCAN-OACI (TWR > AFIS > A/A — rien si aucune fréquence).
// _setSources alimente freq-sia en direct (aucun fetch, processus de test).
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { _oaciLabelHtml } from '../js/regional-map.js';
import { _setSources } from '../js/freq-sia.js';

const SIA = {
    airac: '2026-09-03',
    airports: {
        LFBI: [
            { type: 'FIS', name: 'POITIERS Information', value: '124.000', hor: 'HO' },
            { type: 'TWR', name: 'POITIERS Tour', value: '118.505', hor: 'HO' },
            { type: 'ATIS', name: 'POITIERS', value: '121.780', hor: 'HO' },
        ],
    },
};
const AA = {
    airports: {
        LFOI: [{ type: 'A/A', name: 'ABBEVILLE', value: '120.060', hor: '' }],
        LFQX: [
            { type: 'AFIS', name: 'MOISSY Information', value: '122.605', hor: '' },
            { type: 'A/A', name: 'MOISSY', value: '122.605', hor: '' },
        ],
    },
};
const resetSources = () => _setSources(SIA, null, AA);
resetSources();

describe('Étiquettes OACI (légende SCAN-OACI 1/500 000)', () => {
    test('LFBI : trois lignes — code, nom, altitude + fréquence TWR', () => {
        const html = _oaciLabelHtml('LFBI', 'Poitiers Biard', { elevation: 423 });
        assert.ok(html.includes('<div class="oaci-code">LFBI</div>'));
        assert.ok(html.includes('<div class="oaci-name">Poitiers Biard</div>'));
        assert.ok(html.includes('<div class="oaci-data">423 118.505</div>'));
    });

    test('fréquence à 3 décimales même si la source est moins précise', () => {
        _setSources({ airports: { LFXX: [{ type: 'TWR', name: 'X Tour', value: '118.5', hor: 'H24' }] } }, null, { airports: {} });
        assert.ok(_oaciLabelHtml('LFXX', 'X', { elevation: 100 }).includes('100 118.500'));
        resetSources();
    });

    test('AFIS avant A/A quand les deux existent (XML SIA)', () => {
        // LFQX : AFIS et A/A portent la même valeur ici — on vérifie la
        // PRÉSENCE de la fréquence AFIS retenue (122.605).
        const html = _oaciLabelHtml('LFQX', 'Moissy', { elevation: 260 });
        assert.ok(html.includes('<div class="oaci-data">260 122.605</div>'));
    });

    test('A/A seul (Abbeville) : altitude + A/A, sans unité', () => {
        const html = _oaciLabelHtml('LFOI', 'Abbeville', { elevation: 220 });
        assert.ok(html.includes('<div class="oaci-data">220 120.060</div>'));
    });

    test('terrain sans fréquence : altitude seule (LFAM Berck)', () => {
        const html = _oaciLabelHtml('LFAM', 'Berck Sur Mer', { elevation: 32 });
        assert.ok(html.includes('<div class="oaci-data">32</div>'));
        assert.ok(!html.includes('123.500'));   // règle générale, jamais imprimée
    });

    test('sans altitude : fréquence seule ; rien du tout : ligne data absente', () => {
        assert.ok(_oaciLabelHtml('LFOI', 'Abbeville', {}).includes('<div class="oaci-data">120.060</div>'));
        const vide = _oaciLabelHtml('LFZZ', 'Nulle Part', {});
        assert.ok(!vide.includes('oaci-data'));
        assert.ok(vide.includes('LFZZ') && vide.includes('Nulle Part'));
    });

    test('terrain MILITAIRE : classe oaci-mil — police au rouge du pictogramme (pilote 30/09)', () => {
        const html = _oaciLabelHtml('LFRH', 'Lorient Lann Bihoué', { elevation: 159 },
            { icon: 'militaire-piste-dur', statut: 'MIL (saisie pilote)' });
        assert.ok(html.includes('class="oaci-in oaci-mil"'));
        assert.ok(html.includes('<div class="oaci-code">LFRH</div>'));   // contenu inchangé
    });

    test('terrain MILITAIRE en bande : oaci-mil aussi (revêtement herbe)', () => {
        const html = _oaciLabelHtml('LFXX', 'Base Bande', { elevation: 300 },
            { icon: 'militaire-bande', statut: 'MIL' });
        assert.ok(html.includes('oaci-mil'));
    });

    test('terrain CIVIL ou MIXTE : pas de oaci-mil (police normale)', () => {
        assert.ok(!_oaciLabelHtml('LFBI', 'Poitiers Biard', { elevation: 423 },
            { icon: 'civil-piste-dur', statut: 'CAP' }).includes('oaci-mil'));
        assert.ok(!_oaciLabelHtml('LFRZ', 'Quimper', { elevation: 293 },
            { icon: 'mixte-piste-dur', statut: 'MIX' }).includes('oaci-mil'));
        assert.ok(!_oaciLabelHtml('LFZZ', 'Nulle Part', {}).includes('oaci-mil'));   // sans symbole
    });

    test('nom échappé (anti-XSS)', () => {
        const html = _oaciLabelHtml('LFBI', '<script>x</script>', { elevation: 423 });
        assert.ok(!html.includes('<script>'));
        assert.ok(html.includes('&lt;script&gt;'));
    });
});
