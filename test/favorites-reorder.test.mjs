// Classement des favoris à la souris : la logique d'ordre (orderFavorites)
// est pure + persiste dans localStorage — testée ici sous Node avec le même
// stub que fleet.test.mjs. Tourne via `npm test`.
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const _store = new Map();
globalThis.localStorage = {
    getItem: (k) => (_store.has(k) ? _store.get(k) : null),
    setItem: (k, v) => _store.set(k, String(v)),
    removeItem: (k) => _store.delete(k),
};

const { orderFavorites } = await import('../js/ui-module.js');

const setFavs = (list) => _store.set('favorites', JSON.stringify(list));
const favs = () => JSON.parse(_store.get('favorites'));

describe('favoris — orderFavorites (drag souris)', () => {
    beforeEach(() => setFavs(['LFRV', 'LFRN', 'LFRO', 'LFRT']));

    test('dépose APRÈS une cible plus bas : réinsère dessous', () => {
        const out = orderFavorites('LFRV', 'LFRO', true);
        assert.deepEqual(out, ['LFRN', 'LFRO', 'LFRV', 'LFRT']);
        assert.deepEqual(favs(), ['LFRN', 'LFRO', 'LFRV', 'LFRT']);
    });

    test('dépose AVANT une cible plus bas : réinsère dessus', () => {
        const out = orderFavorites('LFRV', 'LFRO', false);
        assert.deepEqual(out, ['LFRN', 'LFRV', 'LFRO', 'LFRT']);
    });

    test('remonte un favori vers le haut (after=false sur cible au-dessus)', () => {
        assert.deepEqual(orderFavorites('LFRT', 'LFRN', false), ['LFRV', 'LFRT', 'LFRN', 'LFRO']);
    });

    test('remonte avec after=true : passe juste après la cible', () => {
        assert.deepEqual(orderFavorites('LFRT', 'LFRN', true), ['LFRV', 'LFRN', 'LFRT', 'LFRO']);
    });

    test('cible = source : no-op', () => {
        assert.deepEqual(orderFavorites('LFRN', 'LFRN', true), ['LFRV', 'LFRN', 'LFRO', 'LFRT']);
    });

    test('ICAO inconnu (hors liste / suppression concurrente) : liste inchangée', () => {
        assert.deepEqual(orderFavorites('LFXX', 'LFRN', true), ['LFRV', 'LFRN', 'LFRO', 'LFRT']);
        assert.deepEqual(orderFavorites('LFRV', 'LFXX', true), ['LFRV', 'LFRN', 'LFRO', 'LFRT']);
    });

    test('le dernier peut passer premier (montée intégrale)', () => {
        assert.deepEqual(orderFavorites('LFRT', 'LFRV', false), ['LFRT', 'LFRV', 'LFRN', 'LFRO']);
    });
});
