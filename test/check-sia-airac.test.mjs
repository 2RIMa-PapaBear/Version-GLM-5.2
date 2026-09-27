/* QA du garde-fou AIRAC de la base XML SIA (scripts/check-sia-airac.mjs) —
 * fonction pure : référence = SÉRIE CALENDAIRE AIRAC (M15, audit 27/09 —
 * freq-sia n'est plus la référence mais une base CONTRÔLÉE : son retard,
 * invisible le 03/09/2026, fait désormais ÉCHOUER la garde), alerte sur
 * retard/base absente, tolérance aux éditions en avance. Chaque base du
 * XML (terrains/horaires, pistes, espaces, fréquences, VAC) + freq-sia
 * est contrôlée individuellement.
 * Exécution : node --test test/check-sia-airac.test.mjs */

import test from 'node:test';
import { ok, equal, deepEqual, match } from 'node:assert';
import { checkSiaAirac, airacInForce, SIA_XML_BASES } from '../scripts/check-sia-airac.mjs';

// 2026-08-29T12:00Z — série SIA : 2026-09-03 non encore en vigueur → 2026-08-06.
const NOW = Date.parse('2026-08-29T12:00:00Z');
const aJour = { airac: '2026-08-06' };
const toutesAJour = Object.fromEntries(Object.keys(SIA_XML_BASES).map(k => [k, aJour]));
// (toutesAJour inclut vac-sia/index ET freq-sia : même contrat {airac}.)
ok(Object.keys(SIA_XML_BASES).includes('freq-sia'), 'freq-sia fait partie des bases contrôlées (M15)');

test('à jour et en avance → OK', () => {
    ok(checkSiaAirac(toutesAJour, NOW).ok, 'égalité → ok');
    const avance = Object.fromEntries(Object.keys(SIA_XML_BASES).map(k => [k, { airac: '2026-09-03' }]));
    ok(checkSiaAirac(avance, NOW).ok, 'en avance → ok');
});

test('UNE seule base en retard → ALERTE (les autres listées)', () => {
    const bases = { ...toutesAJour, 'sia-airfields': { airac: '2026-07-09' } };
    const r = checkSiaAirac(bases, NOW);
    ok(!r.ok);
    match(r.message, /EN RETARD/);
    match(r.message, /XML_SIA/);
    equal(r.details.find(d => d.base === 'sia-airfields').etat, 'RETARD (2026-07-09 < 2026-08-06)');
    equal(r.details.filter(d => /à jour/.test(d.etat)).length, Object.keys(SIA_XML_BASES).length - 1);
});

test('base absente/vide → ALERTE', () => {
    const r = checkSiaAirac({ ...toutesAJour, 'sia-runways': null }, NOW);
    ok(!r.ok);
    equal(r.details.find(d => d.base === 'sia-runways').etat, 'absente/vide');
});

test('M15 : référence = CALENDRIER ; freq-sia en retard → ALERTE (incident 03/09/2026)', () => {
    equal(checkSiaAirac(toutesAJour, NOW).reference, '2026-08-06', 'référence = série 28 j, pas freq-sia');
    // L'incident : cycle 09-03 en vigueur, tout le XML à jour, freq-sia
    // resté au 08-06 — l'ancienne garde (référence = freq-sia) restait
    // verte ; la nouvelle échoue sur SA base en retard.
    const incident = Object.fromEntries(Object.keys(SIA_XML_BASES).map(k => [k, { airac: '2026-09-03' }]));
    incident['freq-sia'] = { airac: '2026-08-06' };
    const r = checkSiaAirac(incident, Date.parse('2026-09-04T00:00:00Z'));
    ok(!r.ok, 'freq-sia en retard → garde en échec');
    equal(r.reference, '2026-09-03');
    equal(r.details.find(d => d.base === 'freq-sia').etat, 'RETARD (2026-08-06 < 2026-09-03)');
});

test('airacInForce : série SIA ancrée 2026-07-09, pas de 28 j', () => {
    equal(airacInForce(NOW), '2026-08-06');
    equal(airacInForce(Date.parse('2026-09-04T00:00:00Z')), '2026-09-03');
});
