// VAC viewer — index/cartes Atlas-VAC locales (formes pures testables Node :
// sans fetch, l'index est absent → URL sans ?v=). Exécution : node --test.
import { test } from 'node:test';
import { ok, equal } from 'node:assert/strict';
globalThis.indexedDB = undefined;   // pas de cache en Node
const { vacUrl, hasVac, fetchVac } = await import('../js/vac-viewer.js');

test('vacUrl : fichier local data/vac-sia/<ICAO>.pdf (index absent → sans ?v=)', async () => {
    equal(await vacUrl('LFRV'), 'data/vac-sia/LFRV.pdf');
    equal(await vacUrl('lfrs'), 'data/vac-sia/LFRS.pdf', 'OACI normalisé');
});

test('hasVac / fetchVac : sans index disponible → false/null (repli portail)', async () => {
    equal(await hasVac('LFRV'), false);
    equal(await fetchVac('LFRV'), null);
});
