/* QA du garde-fou AIRAC des obstacles (scripts/check-obstacles-airac.mjs) —
 * fonction pure : référence sondée (freq-sia) > repli série 28 j, alerte sur
 * retard/base absente/date absente, tolérance aux éditions en avance (le SIA
 * publie l'export OM un cycle avant l'entrée en vigueur).
 * Exécution : node --test test/check-obstacles-airac.test.mjs */

import test from 'node:test';
import { ok, equal, match } from 'node:assert';
import { checkObstaclesAirac, airacInForce } from '../scripts/check-obstacles-airac.mjs';

// 2026-08-29T12:00Z — série SIA : 2026-07-09 + 2×28 j = 2026-09-03 non encore
// en vigueur → cycle 2026-08-06.
const NOW = Date.parse('2026-08-29T12:00:00Z');

test('airacInForce : série SIA ancrée 2026-07-09, pas de 28 j', () => {
    equal(airacInForce(Date.parse('2026-08-05T00:00:00Z')), '2026-07-09');
    equal(airacInForce(NOW), '2026-08-06');
    equal(airacInForce(Date.parse('2026-09-04T00:00:00Z')), '2026-09-03');
});

test('à jour et en avance → OK (l\'avance SIA est normale)', () => {
    const obstacles = { airac: '2026-09-03', obstacles: [[0, 1, 2, 80, 300, 1, 'E', 'Eolienne(s)']] };
    const a = checkObstaclesAirac(obstacles, { airac: '2026-08-06' }, NOW);
    ok(a.ok, 'en avance → ok');
    equal(a.reference, '2026-08-06', 'référence = freq-sia sondée');
    const b = checkObstaclesAirac({ airac: '2026-08-06', obstacles: [[0, 1, 2, 80, 300, 1, 'E', 'Eolienne(s)']] }, { airac: '2026-08-06' }, NOW);
    ok(b.ok, 'égalité → ok');
});

test('en retard → ALERTE avec instructions', () => {
    const r = checkObstaclesAirac(
        { airac: '2026-08-06', obstacles: [[0, 1, 2, 80, 300, 1, 'E', 'Eolienne(s)']] },
        { airac: '2026-09-03' }, Date.parse('2026-09-05T00:00:00Z'));
    equal(r.ok, false);
    match(r.message, /EN RETARD.*2026-08-06.*2026-09-03/);
    match(r.message, /AIXM4\.5_all_FR_OM/);
});

test('base absente / vide / sans date AIRAC → ALERTE', () => {
    ok(!checkObstaclesAirac(null, { airac: '2026-08-06' }, NOW).ok, 'fichier absent');
    ok(!checkObstaclesAirac({ obstacles: [] }, { airac: '2026-08-06' }, NOW).ok, 'fichier vide');
    const r = checkObstaclesAirac({ airac: null, obstacles: [[0, 1, 2, 80, 300, 1, 'E', 'E']] }, { airac: '2026-08-06' }, NOW);
    ok(!r.ok && /sans date AIRAC/.test(r.message), 'sans date');
});

test('repli sans freq-sia.json : série SIA 28 j comme référence', () => {
    const r = checkObstaclesAirac({ airac: '2026-07-09', obstacles: [[0, 1, 2, 80, 300, 1, 'E', 'E']] }, null, NOW);
    equal(r.reference, '2026-08-06');
    ok(!r.ok, 'un cycle de retard → alerte');
});

test('état réel du dépôt : la base courante est valide (pas de fausse alerte)', async () => {
    const { readFile } = await import('node:fs/promises');
    const obstacles = JSON.parse(await readFile(new URL('../data/obstacles.json', import.meta.url), 'utf8'));
    let freqSia = null;
    try { freqSia = JSON.parse(await readFile(new URL('../data/freq-sia.json', import.meta.url), 'utf8')); } catch { }
    const r = checkObstaclesAirac(obstacles, freqSia);
    ok(r.ok, `la base livrée ne doit pas déclencher le garde-fou : ${r.message}`);
});
