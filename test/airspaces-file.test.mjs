// Tests de la source FICHIER des espaces aériens (data/airspaces/cells/) :
// expansion du format compact en forme openAIP.
import test from 'node:test';
import assert from 'node:assert/strict';
import { _expandFileItem, _decodeType, _rdpKey, _dropOpenAipDuplicates, _isZrt } from '../js/airspaces.js';

test('_expandFileItem : polygone compact → forme openAIP complète', () => {
    const c = {
        i: 'abc', n: 'SIV RENNES SUD A', ty: 33, ic: null,
        lo: [0, 1], up: [115, 6], f: [{ value: '134.000', name: 'RENNES INFORMATION' }],
        g: { t: 1, c: [[[-1.5, 48.1], [-1.4, 48.1], [-1.4, 48.2], [-1.5, 48.2], [-1.5, 48.1]]] },
    };
    const it = _expandFileItem(c);
    assert.equal(it._id, 'abc');
    assert.equal(it.name, 'SIV RENNES SUD A');
    assert.equal(it.type, 33);
    assert.deepEqual(it.lowerLimit, { value: 0, unit: 1 });
    assert.deepEqual(it.upperLimit, { value: 115, unit: 6 });
    assert.equal(it.geometry.type, 'Polygon');
    assert.equal(it.geometry.coordinates[0].length, 5);
    assert.equal(it.frequencies[0].value, '134.000');
});

test('_expandFileItem : Point+rayon et champs absents', () => {
    const pt = _expandFileItem({ i: 'x', n: 'Z', ty: 7, lo: null, up: [25, 6], f: null, r: [5], g: { t: 0, c: [2.5, 49.0] } });
    assert.equal(pt.geometry.type, 'Point');
    assert.deepEqual(pt.geometry.coordinates, [2.5, 49.0]);
    assert.equal(pt.radius.value, 5);
    assert.equal(pt.lowerLimit, null);
    assert.deepEqual(pt.frequencies, []);

    const vide = _expandFileItem({ i: 'y', n: 'W', ty: 0, lo: null, up: null, f: null, g: null });
    assert.equal(vide.geometry, null);
});

// Tests du décodage type → famille. Les cellules openAIP stockent le type
// BRUT openAIP ; la base SIA (data/sia-airspaces.json) une numérotation
// PROPRE qui collisionne (SIA 5=TMA vs openAIP 5=TMZ…) — d'où le marqueur
// _sia qui aiguille vers la bonne table.
test('_decodeType : numérotation openAIP (cellules, sans _sia)', () => {
    assert.equal(_decodeType({ type: 6,  name: 'RMZ CHERBOURG' }),  'RMZ');
    assert.equal(_decodeType({ type: 5,  name: 'TMZ SEINE 9' }),    'TMZ');
    assert.equal(_decodeType({ type: 13, name: 'ZARAGOZA ATZ' }),   'ATZ');
    assert.equal(_decodeType({ type: 14, name: 'WITTERING' }),      'ATZ');   // MATZ
    assert.equal(_decodeType({ type: 25, name: 'TWELVE MILE EAST MOA' }), 'RESTRICTED');
    assert.equal(_decodeType({ type: 26, name: 'PONCE CLASS E5' }), 'CTA');
    assert.equal(_decodeType({ type: 28, name: 'BROWN DZ' }),       'DROP');
    assert.equal(_decodeType({ type: 4,  name: 'ZARAGOZA CTR' }),   'CTR');
    assert.equal(_decodeType({ type: 7,  name: 'TMA ZARAGOZA-1' }), 'TMA');
    assert.equal(_decodeType({ type: 33, name: 'SIV AJACCIO' }),    'SIV');
});

test('_decodeType : numérotation SIA (items marqués _sia)', () => {
    assert.equal(_decodeType({ _sia: true, type: 5,  name: 'TMA RENNES' }),     'TMA');
    assert.equal(_decodeType({ _sia: true, type: 33, name: 'SIV RENNES SUD A' }), 'SIV');
    assert.equal(_decodeType({ _sia: true, type: 11, name: 'TMZ SEINE' }),      'TMZ');
    assert.equal(_decodeType({ _sia: true, type: 12, name: 'RMZ ANNECY' }),     'RMZ');
    assert.equal(_decodeType({ _sia: true, type: 6,  name: 'ATZ' }),            'ATZ');
    assert.equal(_decodeType({ _sia: true, type: 14, name: 'TrPla' }),          'GLIDER');
    assert.equal(_decodeType({ _sia: true, type: 1,  name: 'Pje' }),            'DROP');
});

test('_decodeType : repli sur le nom quand le type manque', () => {
    assert.equal(_decodeType({ name: 'RMZ ANGOULEME' }),  'RMZ');
    assert.equal(_decodeType({ name: 'ATZ DEAUVILLE' }),  'ATZ');
    assert.equal(_decodeType({ name: 'TMZ PARIS' }),      'TMZ');
});

// ZRT — zones réglementées TEMPORAIRES : JAMAIS affichées (décision pilote
// 02/09 — activation NOTAM, absentes de l'AIP permanente, openAIP seul) ;
// filtrées à la source dans _loadCellsGrid / fetchAirspacesForBbox.
test('_isZrt : les ZRT sont filtrées, les zones permanentes restent', () => {
    assert.equal(_isZrt('ZRT VILLACOUBLAY'), true);
    assert.equal(_isZrt('zrt 1 le croisic'), true);
    assert.equal(_isZrt('  ZRT PLOEMEUR BASE'), true);
    assert.equal(_isZrt('LF-R278 VANNES'), false);
    assert.equal(_isZrt('R 278'), false);
    assert.equal(_isZrt('TMZ SEINE 9'), false);
    assert.equal(_isZrt(''), false);
    assert.equal(_isZrt(undefined), false);
});

// Dé-duplounage openAIP vs base SIA : les zones réglementées françaises
// s'appellent « R 278 » côté SIA et « LF-R278 VANNES » côté openAIP —
// le nom exact ne suffit pas (LF-R278/279 Vannes restaient en double, la
// copie openAIP apportant sa fréquence communautaire « 122.600 » que le
// SIA ne publie pas).
test('_rdpKey : désignateurs R/D/P des deux conventions de nommage', () => {
    assert.equal(_rdpKey('LF-R278 VANNES'), 'R278');
    assert.equal(_rdpKey('LF-R279 VANNES PARA'), 'R279');
    assert.equal(_rdpKey('LF-R13A1 GAVRES QUIBERON'), 'R13A1');
    assert.equal(_rdpKey('R 278'), 'R278');
    assert.equal(_rdpKey('D 59B'), 'D59B');
    assert.equal(_rdpKey('P 23'), 'P23');
    // Suffixe ESPACÉ côté SIA (retour pilote 09/09 : « R 149 E » doublonnait
    // avec « LF-R149E ») — la clé doit rejoindre la convention openAIP.
    assert.equal(_rdpKey('R 149 E'), 'R149E');
    assert.equal(_rdpKey('LF-R149E'), 'R149E');
    assert.equal(_rdpKey('R 149 E (2)'), 'R149E(2)');
    // Hors famille R/D/P : aucune clé (jamais dé-duplounés par désignateur).
    assert.equal(_rdpKey('RMZ CHERBOURG'), null);
    assert.equal(_rdpKey('TMA RENNES 2'), null);
    assert.equal(_rdpKey('SIV RENNES SUD A'), null);
    assert.equal(_rdpKey('CTR VANNES'), null);
});

test('_dropOpenAipDuplicates : la copie SIA prime, y compris par désignateur', () => {
    const sia = [{ name: 'R 278' }, { name: 'R 279' }, { name: 'CTR VANNES' }, { name: 'R 149 E' }];
    const oaip = [
        sia[0],                                          // déjà dans SIA
        { name: 'LF-R278 VANNES', frequencies: [{ value: '122.600' }] },
        { name: 'LF-R279 VANNES PARA' },
        { name: 'CTR VANNES' },                          // homonyme exact
        { name: 'RMZ VANNES' },                          // famille non-SIA : conservé
        { name: 'LF-D42B LOINTAIN' },                    // désignateur absent du SIA : conservé
        { name: 'LF-R149E' },                            // suffixe espacé côté SIA (retour 09/09)
    ];
    const out = _dropOpenAipDuplicates(oaip, sia);
    assert.equal(out.length, 3);
    assert.deepEqual(out.map(z => z.name), ['R 278', 'RMZ VANNES', 'LF-D42B LOINTAIN']);
});

test('_dropOpenAipDuplicates : « partie X » normalisé (SIV RENNES SUD partie A ≡ SIV RENNES SUD A)', () => {
    const sia = [
        { name: 'SIV RENNES SUD partie A' },
        { name: 'SIV RENNES SUD partie B' },
        { name: 'CTR SARREBRUCK-PARTIE FRANCE' },        // trait d'union : vrai nom, pas normalisé
    ];
    const oaip = [
        { name: 'SIV RENNES SUD A' },                    // doublon de la partie A
        { name: 'SIV RENNES SUD B' },                    // doublon de la partie B
        { name: 'CTR SARREBRUCK PARTIE FRANCE' },        // ≠ « SARREBRUCK-PARTIE » (tiret) : conservé
        { name: 'SIV RENNES NORD' },                     // inconnu du SIA ici : conservé
    ];
    const out = _dropOpenAipDuplicates(oaip, sia);
    assert.deepEqual(out.map(z => z.name), ['CTR SARREBRUCK PARTIE FRANCE', 'SIV RENNES NORD']);
});

test('_expandFileItem : activité officielle des zones R/D/P transportée', () => {
    const it = _expandFileItem({ i: 'r279', n: 'R 279', ty: 15, ic: null, lo: [0, 1], up: [145, 6], f: null, act: 'Parachutage', g: { t: 1, c: [[[-3, 47], [-2.9, 47], [-2.9, 47.1], [-3, 47]]] } });
    assert.equal(it.activity, 'Parachutage');
    const sans = _expandFileItem({ i: 'x', n: 'TMA RENNES 2', ty: 5, ic: null, lo: null, up: null, f: null, g: null });
    assert.equal(sans.activity, null, 'champ absent → null');
});
