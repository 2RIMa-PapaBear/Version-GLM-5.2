// VAC viewer — construction d'URL officielle SIA (pure, testable Node).
import { test } from 'node:test';
import { ok, equal } from 'node:assert/strict';
const { vacUrl } = await import('../js/vac-viewer.js');

test('vacUrl : cycle AIRAC → dossier eAIP_<JJ_MMM_AAAA>', () => {
    equal(
        vacUrl('LFRV', '2026-08-06'),
        'https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/html/eAIP/Cartes/LFRV/AD_2_LFRV_ADC_01.pdf',
    );
    equal(
        vacUrl('LFPO', '2026-01-02'),
        'https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_02_JAN_2026/FRANCE/AIRAC-2026-01-02/html/eAIP/Cartes/LFPO/AD_2_LFPO_ADC_01.pdf',
    );
});

test('vacUrl : entrées invalides → null', () => {
    equal(vacUrl('LFRV', null), null);
    equal(vacUrl('LFRV', 'pasunedate'), null);
    equal(vacUrl(null, '2026-08-06'), null);
    equal(vacUrl('LFR', '2026-08-06'), null);
});
