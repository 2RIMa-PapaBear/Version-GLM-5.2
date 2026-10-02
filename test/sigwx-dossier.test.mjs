// Sélection des échéances TEMSI/WinTEM/fronts couvrant la TOTALITÉ du vol
// (pilote 02/10) — PUR : plages de validité par milieux voisins, un vol à
// cheval sur deux échéances retient les DEUX, repli sur la plus proche du
// milieu quand la liste ne recouvre rien (TEMSI à échéance unique).
// Fuseau-indépendant : toutes les heures sont construites en UTC explicite.
import test from 'node:test';
import { deepEqual, equal, ok } from 'node:assert/strict';
import { selectEcheancesForWindow, utc14ToMs } from '../js/sigwx-dossier.js';

const D = '20261002';   // jour du vol (échéances réelles AEROWEB relevées)
const u = (h, m = 0) => `${D}${String(h).padStart(2, '0')}${String(m).padStart(2, '0')}00`;
const ms = (h, m = 0) => Date.UTC(2026, 9, 2, h, m);

// Série WinTEM réelle (3 horaire) : 15, 18, 21 h puis 00, 03 h le lendemain.
const WINTEM = [u(15), u(18), u(21), '20261003000000', '20261003030000'];

test('utc14ToMs : format AEROWEB 14 chiffres', () => {
    equal(utc14ToMs('20261002150000'), Date.UTC(2026, 9, 2, 15), 'parse explicite UTC');
    ok(Number.isNaN(utc14ToMs('15h00')), 'format invalide → NaN');
});

test('vol DANS une plage : une seule carte retenue', () => {
    // Vol 15h00 → 16h00 UTC : la plage de la carte 15 h va de 13h30 à 16h30
    // (milieux avec les cartes 18 h voisines… extrémité = ±1h30).
    const sel = selectEcheancesForWindow(WINTEM, ms(15), ms(16));
    deepEqual(sel.map(e => e.utc), [u(15)], 'carte 15 h seule');
});

test('vol À CHEVAL sur deux plages : les DEUX cartes (totalité du vol)', () => {
    // Vol 15h00 → 17h00 : chevauche 13h30-16h30 ET 16h30-19h30.
    const sel = selectEcheancesForWindow(WINTEM, ms(15), ms(17));
    deepEqual(sel.map(e => e.utc), [u(15), u(18)], 'cartes 15 h + 18 h');
});

test('vol long sur série 3 h : 3 cartes, sans plafond', () => {
    // Vol 14h00 → 22h30 : plages 13h30-16h30, 16h30-19h30, 19h30-22h30.
    const sel = selectEcheancesForWindow(WINTEM, ms(14), ms(22, 30));
    deepEqual(sel.map(e => e.utc), [u(15), u(18), u(21)], '3 cartes WinTEM');
});

test('plafond fronts = 2 : première + dernière retenues', () => {
    const sel = selectEcheancesForWindow(WINTEM, ms(14), ms(22, 30), 2);
    deepEqual(sel.map(e => e.utc), [u(15), u(21)], 'bornes de couverture, milieu écarté');
});

test('TEMSI à échéance unique sans recouvrement : repli sur la seule carte', () => {
    // Un seul TEMSI 15 h émis (cas réel relevé) pour un vol du matin :
    // mieux vaut LA carte que rien — elle reste horodatée sur sa page.
    const sel = selectEcheancesForWindow([u(15)], ms(9), ms(10, 30));
    deepEqual(sel.map(e => e.utc), [u(15)], 'repli : la plus proche du milieu');
});

test('fronts 6-12 h : vol 20 h → analyse 12 h + prévision 00 h', () => {
    const FRONTS = [u(0), u(6), u(12), '20261003000000', '20261003120000', '20261004000000'];
    // Vol 02/10 10h00 → 03/10 06h00 : plages 09-18 h (carte 12 h) puis
    // 18 h-06 h (carte 00 h) — les DEUX couvrent, les autres non.
    const sel = selectEcheancesForWindow(FRONTS, ms(10), Date.UTC(2026, 9, 3, 6), 2);
    deepEqual(sel.map(e => e.utc), [u(12), '20261003000000']);
});

test('entrées [{utc}] désordonnées : retenues triées par heure', () => {
    const sel = selectEcheancesForWindow(
        [{ utc: u(21) }, { utc: u(15) }, { utc: u(18) }], ms(15), ms(17));
    deepEqual(sel.map(e => e.utc), [u(15), u(18)]);
});

test('liste vide ou invalide : aucune carte', () => {
    deepEqual(selectEcheancesForWindow([], ms(15), ms(17)), []);
    deepEqual(selectEcheancesForWindow(null, ms(15), ms(17)), []);
    deepEqual(selectEcheancesForWindow(['n/a', ''], ms(15), ms(17)), []);
});
