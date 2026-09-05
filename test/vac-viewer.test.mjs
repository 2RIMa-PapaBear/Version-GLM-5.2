// VAC viewer — construction d'URL officielle SIA (pure, testable Node).
import { test } from 'node:test';
import { ok, equal } from 'node:assert/strict';
const { vacUrl, chartKind, chartNum } = await import('../js/vac-viewer.js');

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

test('vacUrl : fichier de carte paramétrable (défaut ADC)', () => {
    equal(
        vacUrl('LFRS', '2026-08-06', 'AD_2_LFRS_MIA_TEXT_02.pdf'),
        'https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/html/eAIP/Cartes/LFRS/AD_2_LFRS_MIA_TEXT_02.pdf',
    );
});

test('vacUrl : entrées invalides → null', () => {
    equal(vacUrl('LFRV', null), null);
    equal(vacUrl('LFRV', 'pasunedate'), null);
    equal(vacUrl(null, '2026-08-06'), null);
    equal(vacUrl('LFR', '2026-08-06'), null);
});

test('chartKind : familles VFR reconnues, IFR écartées', () => {
    equal(chartKind('AD_2_LFRS_ADC_01.pdf').label, 'Aérodrome');
    equal(chartKind('AD_2_LFRS_MIA_TEXT_03.pdf').label, 'Insertion');
    equal(chartKind('AD_2_LFRS_APDC_01.pdf').label, 'Parking');
    equal(chartKind('AD_2_LFRS_GMC_02.pdf').label, 'Circulation au sol');
    equal(chartKind('AD_2_LFRS_ENV_01.pdf').label, 'Environnement');
    equal(chartKind('AD_2_LFRS_SID_RWY03_RNAV.pdf'), null, 'SID = IFR');
    equal(chartKind('AD_2_LFRS_IAC_RWY03_FNA_RNP.pdf'), null, 'IAC = IFR');
    equal(chartKind('AD_2_LFRS_DATA_01.pdf'), null, 'DATA = IFR');
    equal(chartKind('nimporte.pdf'), null);
});

test('chartNum : numéro terminal pour « Insertion 2 »', () => {
    equal(chartNum('AD_2_LFRS_MIA_TEXT_02.pdf'), 2);
    equal(chartNum('AD_2_LFRS_ADC_01.pdf'), 1);
    equal(chartNum('AD_2_LFRS_MIA_GRAPH.pdf'), null);
});
