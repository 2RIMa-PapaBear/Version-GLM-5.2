/* QA du garde-fou AIRAC de la base XML SIA (scripts/check-sia-airac.mjs) —
 * fonction pure : référence sondée (freq-sia) > repli série 28 j, alerte sur
 * retard/base absente, tolérance aux éditions en avance. Chaque base du
 * XML (terrains/horaires, pistes, espaces, fréquences) est contrôlée
 * individuellement.
 * Exécution : node --test test/check-sia-airac.test.mjs */

import test from 'node:test';
import { ok, equal, deepEqual, match } from 'node:assert';
import { checkSiaAirac, airacInForce, SIA_XML_BASES } from '../scripts/check-sia-airac.mjs';

// 2026-08-29T12:00Z — série SIA : 2026-09-03 non encore en vigueur → 2026-08-06.
const NOW = Date.parse('2026-08-29T12:00:00Z');
const aJour = { airac: '2026-08-06' };
const toutesAJour = Object.fromEntries(Object.keys(SIA_XML_BASES).map(k => [k, aJour]));
// (toutesAJour inclut vac-sia/index : même contrat {airac}.)

test('à jour et en avance → OK', () => {
    ok(checkSiaAirac(toutesAJour, { airac: '2026-08-06' }, NOW).ok, 'égalité → ok');
    const avance = Object.fromEntries(Object.keys(SIA_XML_BASES).map(k => [k, { airac: '2026-09-03' }]));
    ok(checkSiaAirac(avance, { airac: '2026-08-06' }, NOW).ok, 'en avance → ok');
});

test('UNE seule base en retard → ALERTE (les autres listées)', () => {
    const bases = { ...toutesAJour, 'sia-airfields': { airac: '2026-07-09' } };
    const r = checkSiaAirac(bases, { airac: '2026-08-06' }, NOW);
    ok(!r.ok);
    match(r.message, /EN RETARD/);
    match(r.message, /XML_SIA/);
    equal(r.details.find(d => d.base === 'sia-airfields').etat, 'RETARD (2026-07-09 < 2026-08-06)');
    equal(r.details.filter(d => /à jour/.test(d.etat)).length, Object.keys(SIA_XML_BASES).length - 1);
});

test('base absente/vide → ALERTE', () => {
    const r = checkSiaAirac({ ...toutesAJour, 'sia-runways': null }, { airac: '2026-08-06' }, NOW);
    ok(!r.ok);
    equal(r.details.find(d => d.base === 'sia-runways').etat, 'absente/vide');
});

test('référence : freq-sia sondée prioritaire, repli série 28 j', () => {
    equal(checkSiaAirac(toutesAJour, { airac: '2026-08-06' }, NOW).reference, '2026-08-06');
    const sansFreq = checkSiaAirac(toutesAJour, null, Date.parse('2026-09-04T00:00:00Z'));
    equal(sansFreq.reference, '2026-09-03');
    ok(!sansFreq.ok, 'bases 08-06 vs cycle 09-03 → alerte');
});

test('airacInForce : série SIA ancrée 2026-07-09, pas de 28 j', () => {
    equal(airacInForce(NOW), '2026-08-06');
    equal(airacInForce(Date.parse('2026-09-04T00:00:00Z')), '2026-09-03');
});
