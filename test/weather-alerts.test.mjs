// Fiche 10 (audit 27/09) : décodage de la visi impériale des METAR US/Canada
// par analyzeWeatherAlerts (weather.js). Le nombre mixte « 1 1/2SM » s'écrit
// en DEUX groupes METAR, et le préfixe M signifie « moins de » (M1/4SM n'est
// PAS « 4 SM ») — l'ancienne regex locale sous-lisait les nombres mixtes
// (fausses alertes) et sur-lisait les préfixes M (dangers ratés). La
// conversion passe désormais par le parseur canonique parseVisiToMeters
// (core.js), comme engine._parseVisi. Pur — testé sous Node. `npm test`.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeWeatherAlerts } from '../js/weather.js';

const METAR_US = (visi) => `KXYZ 171753Z AUTO 18012KT ${visi} FEW031 OVC045 18/07 A2992 RMK AO2`;
const visiAlerts = (metar) => analyzeWeatherAlerts(metar).filter(a => a.category === 'visibility');

describe('analyzeWeatherAlerts — visi impériale (SM)', () => {
    test('nombre mixte « 1 1/2SM » ≈ 2414 m : warning, PAS danger', () => {
        const a = visiAlerts(METAR_US('1 1/2SM'));
        assert.equal(a.length, 1, `alertes visi : ${JSON.stringify(a)}`);
        assert.equal(a[0].level, 'warning');
        assert.ok(Math.abs(a[0].value - 2414) < 5, `valeur ${a[0].value} m`);
    });

    test('« M1/4SM » = moins de ¼ SM ≈ 402 m : danger (pas 4 SM)', () => {
        const a = visiAlerts(METAR_US('M1/4SM'));
        assert.equal(a.length, 1, `alertes visi : ${JSON.stringify(a)}`);
        assert.equal(a[0].level, 'danger');
        assert.ok(Math.abs(a[0].value - 402) < 5, `valeur ${a[0].value} m`);
    });

    test('« 1/4SM » ≈ 402 m : danger', () => {
        const a = visiAlerts(METAR_US('1/4SM'));
        assert.equal(a[0].level, 'danger');
        assert.ok(Math.abs(a[0].value - 402) < 5);
    });

    test('« P6SM » = plus de 6 SM : aucune alerte visi', () => {
        assert.equal(visiAlerts(METAR_US('P6SM')).length, 0);
    });
});

// Fiche n°15 (audit 27/09) : vent METAR en MPS/KMH (OACI Annexe 3 —
// Russie, Chine…). analyzeWeatherAlerts décode via le parseur canonique
// parseWindGroupToKt (core.js) : les seuils d'alerte (15/25 kt par défaut)
// s'appliquent à la valeur CONVERTIE, au lieu d'ignorer silencieusement le
// groupe vent d'un METAR non-KT.
describe('analyzeWeatherAlerts — vent MPS/KMH converti en kt', () => {
    const windAlerts = (metar) => analyzeWeatherAlerts(metar).filter(a => a.category === 'wind');

    test('20013MPS ≈ 25 kt : alerte vent DANGER déclenchée (avant : vent ignoré)', () => {
        const a = windAlerts('UUEE 270800Z 20013MPS 9999 SCT025 M07/M10 Q1013 NOSIG');
        assert.equal(a.length, 1, `alertes vent : ${JSON.stringify(a)}`);
        assert.equal(a[0].level, 'danger');
        assert.equal(a[0].value, 25);
    });

    test('31012KMH ≈ 6 kt : aucune alerte vent', () => {
        const a = windAlerts('ZBAA 270800Z 31012KMH 9999 NSW 22/12 Q1008 NOSIG');
        assert.equal(a.length, 0);
    });

    test('rafales MPS converties : 24010G20MPS → rafales 39 kt (danger)', () => {
        const a = analyzeWeatherAlerts('UUEE 270800Z 24010G20MPS 9999 SCT025 M07/M10 Q1013').filter(x => x.category === 'gusts');
        assert.equal(a.length, 1, `alertes rafales : ${JSON.stringify(a)}`);
        assert.equal(a[0].level, 'danger');
        assert.equal(a[0].value, 39);   // 20 × 1.94384 = 38.88
    });
});
