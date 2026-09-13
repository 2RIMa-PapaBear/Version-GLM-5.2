// Tests C1 (14/09) : parse du XML AEROWEB « Messages SIGMET, GAMET, AIRMET »
// (source France via le relais Worker /sigmet — compte AEROWEB du pilote).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseAerowebSigmetXml } from '../js/sigmet.js';

// DOM factice (le parseur n'utilise que querySelectorAll + textContent —
// DOMParser n'existe pas sous Node).
const doc = (messages) => ({ querySelectorAll: () => messages.map(m => ({ textContent: m })) });

describe('parseAerowebSigmetXml (AEROWEB France)', () => {
    test('deux SIGMET dans un message FIR → deux entrées', () => {
        const r = parseAerowebSigmetXml('', doc([
            'FIR LFFF\nLFPW SIGMET A01 VALID 140900/141500 LFRR-\nLFRR BREST FIR SEV TURB FCST BLW FL100 AT 4800N00400W MOV NE 25KT NC=',
            'FIR LFRR\nLFPW SIGMET B02 VALID 141500/142100 LFRR-\nLFRR BREST FIR SEV ICE FCST 4700N00300W - 4800N00200W BLW FL080=',
        ]));
        assert.equal(r.length, 2);
        assert.ok(r[0].raw.startsWith('LFPW SIGMET A01'));
        assert.ok(r[1].raw.includes('SEV ICE'));
        assert.equal(r[0].type, 'SIGMET');
    });

    test('plusieurs SIGMET dans un même bloc → un par émission (split LFPW)', () => {
        const r = parseAerowebSigmetXml('', doc([
            'FIR LFFF\nLFPW SIGMET A01 VALID 140900/141500 LFRR-\nLFRR FIR SEV TURB NC=\nLFPW SIGMET A03 VALID 141200/141800 LFEE-\nLFEE REIMS FIR OCNL TS=' ,
        ]));
        assert.equal(r.length, 2);
        assert.ok(r[1].raw.includes('OCNL TS'));
    });

    test('« pas de SIGMET » → vide (aucun repli US en France)', () => {
        const r = parseAerowebSigmetXml('', doc(['Pas de SIGMET, GAMET, AIRMET pour : LFFF']));
        assert.equal(r.length, 0);
    });

    test('XML réel AEROWEB sans messages (réponse vide du 14/09) → vide', () => {
        const xml = `<?xml version="1.0"?><root><request><firs><![CDATA[LFFF,LFRR]]></firs></request><params><title><![CDATA[Messages SIGMET, GAMET, AIRMET]]></title></params><fir><messages/><no_messages><message id="LFFF" type="FIR" prefixe="FIR "><name><![CDATA[FRANCE]]></name></message></no_messages></fir></root>`;
        // sans DOMParser sous Node → sortie vide silencieuse (comportement attendu)
        const r = parseAerowebSigmetXml(xml);
        assert.equal(r.length, 0);
    });

    test('entrée trop courte ignorée (bruit)', () => {
        const r = parseAerowebSigmetXml('', doc(['SIGMET court']));
        assert.equal(r.length, 0);
    });
});
