/* ================================================================
 * TESTS UNITAIRES — Olive météo des favoris (watchdog)
 * Exécution : node --test test/watchdog-badge.test.mjs
 *
 * Vérifie que l'état météo de chaque favori est peint dans
 * l'EMPLACEMENT RÉSERVÉ de la ligne (span .fav-status-badge devant le
 * code OACI) — l'olive unique, jamais écrasée par le nom — et que
 * applyFavoriteBadges() repeint les olives après un re-rendu de la
 * liste. Fetch réseau stubbé (METARs factices) : test hermétique.
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

// ---- Stubs minimaux localStorage / document / window (avant import) ----
const _ls = new Map();
globalThis.localStorage = {
    getItem: (k) => (_ls.has(k) ? _ls.get(k) : null),
    setItem: (k, v) => _ls.set(k, String(v)),
    removeItem: (k) => _ls.delete(k),
};

function makeEl() {
    return {
        className: '', style: {}, textContent: '', title: '', dataset: {},
        appendChild() {}, insertBefore() {}, remove() {}, addEventListener() {},
        setAttribute() {}, getAttribute: () => null,
        querySelector: () => null,
    };
}

// Liste de favoris factice : chaque item expose son olive réservée.
const badges = new Map();   // icao → élément .fav-status-badge (emplacement)
const items = new Map();    // icao → ligne du favori
for (const icao of ['LFRV', 'LFRC', 'LFOM']) {
    const badge = makeEl();
    const item = makeEl();
    item.querySelector = (sel) => (sel === '.fav-status-badge' ? badge : null);
    badges.set(icao, badge);
    items.set(icao, item);
}
const favList = {
    querySelector: (sel) => {
        const m = sel.match(/data-icao="(.+?)"/);
        return m ? items.get(m[1]) : null;
    },
};
globalThis.document = {
    getElementById: (id) => (id === 'favorites-list' ? favList : null),
    createElement: () => makeEl(),
    addEventListener() {}, dispatchEvent() { return true; },
    documentElement: { lang: 'fr' },
};
globalThis.window = { addEventListener() {}, dispatchEvent() {} };

// Fetch stubbé : METARs aux états GO / NO-GO / CAUTION (mêmes règles que
// watchdog._evaluateState : plafond & visi).
const METARS = [
    { icaoId: 'LFRV', rawOb: 'METAR LFRV 011630Z AUTO 27006KT CAVOK 21/10 Q1021' },
    { icaoId: 'LFRC', rawOb: 'METAR LFRC 011630Z 27006KT 9999 OVC002 15/14 Q1021' },
    { icaoId: 'LFOM', rawOb: 'METAR LFOM 011630Z 27006KT 6000 SCT030 18/12 Q1021' },
];
const jsonResponse = { ok: true, text: async () => JSON.stringify(METARS), json: async () => METARS };
globalThis.fetch = async () => jsonResponse;

const { checkNow, applyFavoriteBadges } = await import('../js/watchdog.js');

_ls.set('favorites', JSON.stringify(['LFRV', 'LFRC', 'LFOM']));
_ls.set('watchdog-settings', JSON.stringify({ enabled: true, intervalMin: 15, notify: false }));

describe('watchdog — voyant météo des favoris (emplacement réservé)', () => {

    test('checkNow peint UN voyant par favori, devant le code (pas en fin de ligne)', async () => {
        await checkNow();
        assert.equal(badges.get('LFRV').textContent, ' ');
        assert.equal(badges.get('LFRC').textContent, ' ');
        assert.equal(badges.get('LFOM').textContent, ' ');
    });

    test('couleurs d\'état : voyant PLEIN vert / rouge / orange, SANS texte', () => {
        assert.equal(badges.get('LFRV').style.background, '#10B981', 'GO en vert');
        assert.equal(badges.get('LFRC').style.background, '#EF4444', 'NO-GO en rouge');
        assert.equal(badges.get('LFOM').style.background, '#F59E0B', 'CAUTION en orange');
        assert.equal(badges.get('LFRV').style.borderColor, '#10B981');
    });

    test('infobulle explicite sur le voyant', () => {
        assert.ok(badges.get('LFRV').title.length > 3);
        assert.ok(badges.get('LFRC').title.includes('NO-GO'));
    });

    test('applyFavoriteBadges repeint les voyants après un re-rendu de la liste', () => {
        for (const b of badges.values()) { b.style.background = ''; }
        applyFavoriteBadges();
        assert.equal(badges.get('LFRV').style.background, '#10B981');
        assert.equal(badges.get('LFRC').style.background, '#EF4444');
        assert.equal(badges.get('LFOM').style.background, '#F59E0B');
        assert.equal(badges.get('LFRV').textContent, ' ');
    });
});

describe('watchdog — favori sans METAR (N4, audit 27/09)', () => {
    // Favori supplémentaire ABSENT du stub réseau : l'ancien code le sautait
    // (`if (!raw) continue;`) en laissant l'olive peinte d'un état périmé.
    const badgeN4 = makeEl();
    const itemN4 = makeEl();
    itemN4.querySelector = (sel) => (sel === '.fav-status-badge' ? badgeN4 : null);
    badges.set('LFER', badgeN4);
    items.set('LFER', itemN4);

    test('olive grise UNKNOWN + infobulle explicite (jamais de silence)', async () => {
        _ls.set('favorites', JSON.stringify(['LFRV', 'LFRC', 'LFOM', 'LFER']));
        await checkNow();
        assert.equal(badgeN4.style.background, '#9CA3AF', 'gris UNKNOWN');
        assert.match(badgeN4.title, /indisponible/);
        // Les favoris avec METAR restent jugés normalement.
        assert.equal(badges.get('LFRV').style.background, '#10B981');
        assert.equal(badges.get('LFRC').style.background, '#EF4444');
    });

    test('applyFavoriteBadges repeint le UNKNOWN après re-rendu', () => {
        badgeN4.style.background = '';
        applyFavoriteBadges();
        assert.equal(badgeN4.style.background, '#9CA3AF');
    });

    test('la donnée revenue n est pas une « dégradation » : olive réelle, pas d alerte', async () => {
        const withLFER = [
            ...METARS,
            { icaoId: 'LFER', rawOb: 'METAR LFER 011630Z 27006KT CAVOK 18/10 Q1021' },
        ];
        globalThis.fetch = async () => ({
            ok: true,
            text: async () => JSON.stringify(withLFER),
            json: async () => withLFER,
        });
        await checkNow();
        assert.equal(badgeN4.style.background, '#10B981', 'état réel retrouvé');
    });
});
