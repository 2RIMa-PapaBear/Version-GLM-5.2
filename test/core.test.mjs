/* ================================================================
 * TESTS UNITAIRES — Fonctions pures de core.js
 * Exécution : node --test test/core.test.mjs
 * (Utilise le runner natif Node.js, aucune dépendance externe.)
 * ================================================================ */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
    parseVisiToMeters,
    parseWindGroupToKt,
    getCeiling,
    getFlightCategory,
    evaluateVmc,
    VMC_MINIMA,
    getWeatherIcon,
    findActiveValueAtHour
} from '../js/core.js';

describe('parseVisiToMeters', () => {
    test('retourne 10000 pour 9999', () => {
        assert.equal(parseVisiToMeters('9999'), 10000);
    });

    test('retourne 10000 pour CAVOK', () => {
        assert.equal(parseVisiToMeters('CAVOK'), 10000);
    });

    test('null/vide → null = INCONNUE (o4, audit 01/10 : plus de 10 km implicite)', () => {
        // Ce test encodait l'ANCIEN défaut (repli 10 km sur chaîne vide) —
        // la règle « absent = inconnu, jamais 10 km implicite » s'applique
        // désormais à la source, tous appelants gardés en amont.
        assert.equal(parseVisiToMeters(''), null);
        assert.equal(parseVisiToMeters('   '), null);
        assert.equal(parseVisiToMeters(null), null);
    });

    test('parse les mètres à 4 chiffres', () => {
        assert.equal(parseVisiToMeters('5000'), 5000);
        assert.equal(parseVisiToMeters('0500'), 500);
    });

    test('parse les miles-statute entiers', () => {
        // 1 SM ≈ 1609 m
        assert.ok(Math.abs(parseVisiToMeters('1SM') - 1609) < 5);
        // 5 SM ≈ 8047 m
        assert.ok(Math.abs(parseVisiToMeters('5SM') - 8047) < 5);
    });

    test('parse les miles fractionnaires', () => {
        // 1/2 SM ≈ 805 m
        assert.ok(Math.abs(parseVisiToMeters('1/2SM') - 805) < 5);
        // 1 1/4 SM = 1.25 SM ≈ 2012 m
        assert.ok(Math.abs(parseVisiToMeters('1 1/4SM') - 2012) < 5);
    });

    test('parse les préfixes P/M (plus/moins que)', () => {
        // P6SM → 6 SM
        assert.ok(Math.abs(parseVisiToMeters('P6SM') - 9656) < 5);
        // M1/4SM → 1/4 SM ≈ 402 m
        assert.ok(Math.abs(parseVisiToMeters('M1/4SM') - 402) < 5);
    });
});

describe('getCeiling', () => {
    test('retourne 999 (illimité) pour CAVOK/NSC/SKC/NCD', () => {
        assert.equal(getCeiling('CAVOK'), 999);
        assert.equal(getCeiling('NSC'), 999);
        assert.equal(getCeiling('SKC'), 999);
        assert.equal(getCeiling('NCD'), 999);
    });

    test('retourne 999 pour null/vide', () => {
        assert.equal(getCeiling(''), 999);
        assert.equal(getCeiling(null), 999);
    });

    test('retourne 0 pour ciel invisible VV///', () => {
        assert.equal(getCeiling('VV///'), 0);
    });

    test('retourne le plafond le plus bas (centaines de ft)', () => {
        // BKN010 = 1000 ft → 10 (centaines)
        assert.equal(getCeiling('BKN010'), 10);
        // OVC005 = 500 ft → 5 (centaines)
        assert.equal(getCeiling('OVC005'), 5);
    });

    test('ignore FEW et SCT (ne sont pas un plafond)', () => {
        // FEW030 SCT100 : aucun plafond → illimité
        assert.equal(getCeiling('FEW030 SCT100'), 999);
    });

    test('prend le plus bas entre plusieurs plafonds', () => {
        // BKN020 OVC010 → plafond à 1000 ft → 10
        assert.equal(getCeiling('BKN020 OVC010'), 10);
    });

    test('gère VV (vertical visibility) comme plafond', () => {
        // VV008 = 800 ft → 8 (centaines)
        assert.equal(getCeiling('VV008'), 8);
    });

    test('gère le format parsé "BKN 1000ft"', () => {
        assert.equal(getCeiling('BKN 1000ft'), 10);
        assert.equal(getCeiling('OVC 500ft'), 5);
    });
});

describe('getFlightCategory (VMC/IMC — SERA.5005, fiche n°3 audit 27/09)', () => {
    const G = { controlled: false };     // espace non contrôlé (classe G, jour)
    const D = { controlled: true };      // espace contrôlé (TMA/CTR cl. D)

    test('FICHE n°3 cas ① : classe G jour, visi 3000 m à ≤ 140 kt → VMC (plus de faux No-Go)', () => {
        // Hors nuages, plafond 1500 ft > 500 ft : légal en G sous la
        // surface S — la visi 1500 m (Vi ≤ 140 kt) suffit le jour.
        const o = getFlightCategory(3000, 15, G);
        assert.equal(o.cat, 'VMC');
        assert.equal(o.class, 'cat-vmc');
        assert.deepEqual(o.verdict, { vmc: 'VMC', level: 'ok', key: 'unctrl_ok' });
    });

    test('FICHE n°3 cas ② : TMA classe D, plafond 1200 ft → MARGINAL (VFR spécial), pas un banal « MVFR »', () => {
        // La clairance verticale de 1000 ft sous BKN012 est irrrespectable
        // en pratique : reste le VFR spécial (visi ≥ 1500 m, ≥ 600 ft, jour).
        const o = getFlightCategory(9999, 12, D);
        assert.equal(o.cat, 'MARGINAL');
        assert.equal(o.verdict.key, 'sp_needed');
        assert.equal(o.verdict.level, 'caution');
    });

    test('contrôlé : visi ≥ 5 km et base ≥ 2500 ft (clearance D) → VMC plein', () => {
        assert.deepEqual(getFlightCategory(5000, 25, D).verdict, { vmc: 'VMC', level: 'ok', key: 'ctrl_ok' });
    });

    test('contrôlé : plafond 1500–2500 ft → MARGINAL (marge sous couche < 1000 ft)', () => {
        assert.equal(getFlightCategory(9999, 20, D).verdict.key, 'ctrl_clearance');
        assert.equal(getFlightCategory(9999, 15, D).cat, 'MARGINAL');
        // 2499 ft → encore caution ; 2500 ft exact → ok (borne incluse)
        assert.equal(getFlightCategory(9999, 24, D).verdict.key, 'ctrl_clearance');
        assert.equal(getFlightCategory(9999, 25, D).verdict.key, 'ctrl_ok');
    });

    test('contrôlé : visi 1500–5000 m → MARGINAL (VFR spécial jour), IMC la nuit', () => {
        const jour = getFlightCategory(3000, 50, D);
        assert.equal(jour.cat, 'MARGINAL');
        assert.equal(jour.verdict.key, 'sp_needed');
        const nuit = getFlightCategory(3000, 50, { controlled: true, isNight: true });
        assert.equal(nuit.cat, 'IMC');
        assert.equal(nuit.verdict.key, 'sp_night');
    });

    test('IMC : sous les minima même en VFR spécial', () => {
        // Plafond 400 ft < 600 ft en contrôlé (VFR spécial impossible)
        assert.equal(getFlightCategory(9999, 4, D).cat, 'IMC');
        // Visi 1200 m < 1500 m (G jour) — fiche n°8 : sans visi tenue,
        // le plafond haut ne sauve rien.
        assert.equal(getFlightCategory(1200, 50, G).cat, 'IMC');
        assert.equal(getFlightCategory(1200, 3, G).cat, 'IMC');
    });

    test('G NUIT : la dérogation 1500 m est jour seulement — 5 km requis (SERA.5005(b)(2))', () => {
        assert.equal(getFlightCategory(3000, 50, { controlled: false, isNight: true }).cat, 'IMC');
        assert.equal(getFlightCategory(5000, 50, { controlled: false, isNight: true }).cat, 'VMC');
    });

    test('FICHE n°8 : G, plafond 0–500 ft avec visi tenue → MARGINAL (pas de plafond numérique en classe G)', () => {
        // SERA.5005 classe G : « hors nuages, en vue de la surface » —
        // la garde 500 ft relève de SERA.3105 (hauteur minimale de vol) :
        // situation LÉGALE mais très basse → prudence, pas IMC.
        assert.equal(getFlightCategory(9999, 4, G).cat, 'MARGINAL');
        assert.equal(getFlightCategory(9999, 4, G).verdict.key, 'unctrl_lowceil');
        assert.equal(getFlightCategory(9999, 5, G).verdict.key, 'unctrl_lowceil'); // 500 ft exact inclus
        assert.equal(getFlightCategory(9999, 6, G).cat, 'VMC');
        // Nuit : même logique dès que la visi de table (5 km) est tenue.
        assert.equal(getFlightCategory(6000, 3, { controlled: false, isNight: true }).cat, 'MARGINAL');
        assert.equal(getFlightCategory(4000, 3, { controlled: false, isNight: true }).cat, 'IMC'); // < 5 km nuit
    });

    test('visi ABSENTE (null) : seul le plafond juge — jamais de 10 km implicite', () => {
        // Contrôlé, BKN003 (300 ft) : IMC quand même sans connaître la visi.
        assert.equal(getFlightCategory(null, 3, D).cat, 'IMC');
        // Contrôlé, plafond 4000 ft : VMC — mais 2000 ft → caution (marge),
        // la donnée manquante ne fabrique ni GO ni NO-GO optimiste.
        assert.equal(getFlightCategory(null, 40, D).cat, 'VMC');
        assert.equal(getFlightCategory(null, 20, D).cat, 'MARGINAL');
    });

    test('SANS contexte (ctx null) : pire-cas contrôlé — jamais de VMC optimiste en attente', () => {
        // Visi 3000 m + CAVOK : en G ce serait VMC, en contrôlé MARGINAL —
        // en attendant la classe réelle on affiche le pire (caution).
        assert.equal(getFlightCategory(3000, 999, null).cat, 'MARGINAL');
        // 9999 + CAVOK : VMC dans les deux lectures.
        assert.equal(getFlightCategory(10000, 999, null).cat, 'VMC');
        // BKN002 : IMC en contrôlé, MARGINAL en G (fiche n°8) — pire-cas IMC.
        assert.equal(getFlightCategory(10000, 2, null).cat, 'IMC');
    });
});

describe('evaluateVmc (table SERA.5005 pure — source unique)', () => {
    test('les constantes minima ne bougent pas (vfr-minima délègue)', () => {
        assert.equal(VMC_MINIMA.CTRL_VISI_M, 5000);
        assert.equal(VMC_MINIMA.CTRL_CLEARANCE_FT, 2500);
        assert.equal(VMC_MINIMA.SP_VISI_M, 1500);
        assert.equal(VMC_MINIMA.SP_CEIL_FT, 600);
        assert.equal(VMC_MINIMA.UNCTRL_VISI_M, 1500);
        assert.equal(VMC_MINIMA.UNCTRL_CEIL_FT, 500);
    });

    test('CAVOK en contrôlé → VMC (plafond illimité)', () => {
        assert.deepEqual(
            evaluateVmc({ controlled: true, visiM: 10000, ceilingFt: 99999 }),
            { vmc: 'VMC', level: 'ok', key: 'ctrl_ok' });
    });
});

describe('getWeatherIcon', () => {
    test('orage', () => {
        assert.equal(getWeatherIcon(null, 'orage TS'), 'cloud-lightning');
        assert.equal(getWeatherIcon(null, 'thunderstorm'), 'cloud-lightning');
    });

    test('neige/grêle', () => {
        assert.equal(getWeatherIcon(null, 'neige'), 'cloud-snow');
        assert.equal(getWeatherIcon(null, 'snow'), 'cloud-snow');
        assert.equal(getWeatherIcon(null, 'grêle hail'), 'cloud-snow');
    });

    test('pluie', () => {
        assert.equal(getWeatherIcon(null, 'pluie'), 'cloud-rain');
        assert.equal(getWeatherIcon(null, 'rain'), 'cloud-rain');
    });

    test('brouillard', () => {
        assert.equal(getWeatherIcon(null, 'brouillard'), 'cloud-fog');
        assert.equal(getWeatherIcon(null, 'fog'), 'cloud-fog');
    });

    test('nuages (sans phénomène)', () => {
        assert.equal(getWeatherIcon('VV001', ''), 'cloud-fog');
        assert.equal(getWeatherIcon('OVC010', ''), 'cloud');
        assert.equal(getWeatherIcon('BKN010', ''), 'cloudy');
        assert.equal(getWeatherIcon('SCT030', ''), 'cloud-sun');
        assert.equal(getWeatherIcon('FEW030', ''), 'sun');
    });

    test('défaut : soleil', () => {
        assert.equal(getWeatherIcon('', ''), 'sun');
    });
});

describe('findActiveValueAtHour', () => {
    const blocks = [
        { start: 0, end: 6, val: 'Nuit' },
        { start: 6, end: 12, val: 'Matin' },
        { start: 12, end: 18, val: 'Après-midi' },
    ];

    test('retourne la valeur du bloc contenant l\'heure cible', () => {
        assert.equal(findActiveValueAtHour(blocks, 8), 'Matin');
        assert.equal(findActiveValueAtHour(blocks, 15), 'Après-midi');
        assert.equal(findActiveValueAtHour(blocks, 3), 'Nuit');
    });

    test('retourne null si aucune correspondance', () => {
        assert.equal(findActiveValueAtHour(blocks, 20), null);
    });

    test('retourne null pour tableau vide ou null', () => {
        assert.equal(findActiveValueAtHour([], 5), null);
        assert.equal(findActiveValueAtHour(null, 5), null);
    });

    test('ignore les blocs sans valeur', () => {
        const withEmpty = [{ start: 0, end: 10, val: '' }, { start: 5, end: 15, val: 'OK' }];
        assert.equal(findActiveValueAtHour(withEmpty, 7), 'OK');
    });

    test('borne start incluse, borne end exclue', () => {
        assert.equal(findActiveValueAtHour(blocks, 6), 'Matin');  // 6 ∈ [6,12)
        assert.equal(findActiveValueAtHour(blocks, 12), 'Après-midi'); // 12 ∈ [12,18)
        assert.equal(findActiveValueAtHour(blocks, 18), null);    // 18 ∉ [12,18)
    });
});

/* ================================================================
 * fetchAvecRelais — file de sérialisation du relai Apps Script
 * (le relai ne supporte pas la concurrence : 404 echo / gels 30-40 s.
 * On vérifie que les requêtes partent UNE PAR UNE et que les appels
 * simultanés d'une même URL sont dédupliqués — fetch réseau simulé.)
 * ================================================================ */
import { fetchAvecRelais } from '../js/core.js';

describe('fetchAvecRelais — sérialisation relai', () => {
    const _realFetch = globalThis.fetch;
    test('dédup : 3 appels simultanés de la même URL → 1 seul fetch réseau', async () => {
        let calls = 0;
        globalThis.fetch = async () => {
            calls++;
            await new Promise(r => setTimeout(r, 40));
            return { ok: true, status: 200, text: async () => 'METAR LFPZ' };
        };
        try {
            const u = 'https://aviationweather.gov/api/data/metar?ids=LFPZ&format=raw';
            const res = await Promise.all([fetchAvecRelais(u), fetchAvecRelais(u), fetchAvecRelais(u)]);
            assert.deepEqual(res, ['METAR LFPZ', 'METAR LFPZ', 'METAR LFPZ']);
            assert.equal(calls, 1);
        } finally { globalThis.fetch = _realFetch; }
    });

    test('sérialisation : 6 URL différentes en parallèle → jamais 2 fetch simultanés', async () => {
        let active = 0, maxActive = 0;
        globalThis.fetch = async () => {
            active++; maxActive = Math.max(maxActive, active);
            await new Promise(r => setTimeout(r, 30));
            active--;
            return { ok: true, status: 200, text: async () => 'OK' };
        };
        try {
            const urls = ['a', 'b', 'c', 'd', 'e', 'f'].map(c =>
                `https://aviationweather.gov/api/data/metar?ids=LF${c}&format=raw`);
            const res = await Promise.all(urls.map(u => fetchAvecRelais(u)));
            assert.equal(res.length, 6);
            assert.ok(res.every(r => r === 'OK'));
            assert.equal(maxActive, 1);   // le relai n'a JAMAIS vu 2 requêtes en même temps
        } finally { globalThis.fetch = _realFetch; }
    });

    test('la file survit à un échec : la requête suivante passe quand même', async () => {
        // LFZZ échoue réseau à chaque tentative ; LFYY réussit. Le sondage
        // no-cors (HEAD) répond : l'échec est classé « réponse bloquée ».
        // (Test du MODE PROXI : PROXY_URL fixé explicitement — le mode direct
        // sans relais a son propre test ci-dessous.)
        const { config } = await import('../js/config.js');
        const savedProxy = config.PROXY_URL;
        config.PROXY_URL = 'https://relais.test/exec';
        globalThis.fetch = async (u, opts) => {
            if (opts && opts.method === 'HEAD') return {};
            if (String(u).includes('LFZZ')) throw new TypeError('Failed to fetch');
            return { ok: true, status: 200, text: async () => 'OK-APRES' };
        };
        try {
            const u1 = 'https://aviationweather.gov/api/data/metar?ids=LFZZ&format=raw';
            const u2 = 'https://aviationweather.gov/api/data/metar?ids=LFYY&format=raw';
            await assert.rejects(fetchAvecRelais(u1), /relai Google Apps Script inaccessible/i);
            assert.equal(await fetchAvecRelais(u2), 'OK-APRES');
        } finally { config.PROXY_URL = savedProxy; globalThis.fetch = _realFetch; }
    });

    test('mode DIRECT (miroir Pages, sans relais) : succès, json vide, erreur réseau habillée', async () => {
        const { config } = await import('../js/config.js');
        const savedProxy = config.PROXY_URL;
        const savedKey = config.CORS_PROXY_KEY;
        config.PROXY_URL = '';
        config.CORS_PROXY_KEY = '';
        try {
            // Succès texte direct.
            globalThis.fetch = async (u) => ({ ok: true, status: 200, text: async () => 'METAR LFRV' });
            assert.equal(await fetchAvecRelais('https://aviationweather.gov/api/data/metar?ids=LFRV&format=raw'), 'METAR LFRV');
            // Corps vide en json → [] (même règle que via le relais).
            globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
            assert.deepEqual(await fetchAvecRelais('https://aviationweather.gov/api/data/pirep?bbox=1,2,3,4&format=json', 'json'), []);
            // Réseau coupé : message clair, et la file survit.
            globalThis.fetch = async (u) => { if (String(u).includes('LFZZ')) throw new TypeError('Failed to fetch'); return { ok: true, status: 200, text: async () => 'OK-DIRECT' }; };
            await assert.rejects(fetchAvecRelais('https://aviationweather.gov/api/data/metar?ids=LFZZ&format=raw'), /Service météo inaccessible|Weather service unreachable/i);
            assert.equal(await fetchAvecRelais('https://aviationweather.gov/api/data/metar?ids=LFYY&format=raw'), 'OK-DIRECT');
        } finally { config.PROXY_URL = savedProxy; config.CORS_PROXY_KEY = savedKey; globalThis.fetch = _realFetch; }
    });

    test('mode DIRECT + corsproxy : CORS coupé au direct → le proxy avec clé prend le relais', async () => {
        const { config } = await import('../js/config.js');
        const savedProxy = config.PROXY_URL;
        const savedKey = config.CORS_PROXY_KEY;
        config.PROXY_URL = '';
        config.CORS_PROXY_KEY = 'TESTKEY';
        try {
            const vus = [];
            globalThis.fetch = async (u) => {
                vus.push(String(u));
                if (String(u).startsWith('https://corsproxy.io/')) {
                    return { ok: true, status: 200, text: async () => 'METAR-VIA-PROXY' };
                }
                throw new TypeError('Failed to fetch');   // CORS bloque le direct
            };
            assert.equal(await fetchAvecRelais('https://aviationweather.gov/api/data/metar?ids=LFRV&format=raw'), 'METAR-VIA-PROXY');
            assert.ok(vus.length === 2, 'direct tenté puis proxy');
            assert.ok(vus[1].includes('key=TESTKEY') && vus[1].includes(encodeURIComponent('https://aviationweather.gov')), 'clé + URL cible encodée');
            // Proxy en échec réseau aussi → erreur habillée, la file survit.
            globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
            await assert.rejects(fetchAvecRelais('https://aviationweather.gov/api/data/metar?ids=LFZZ&format=raw'), /Service météo inaccessible|Weather service unreachable/i);
        } finally { config.PROXY_URL = savedProxy; config.CORS_PROXY_KEY = savedKey; globalThis.fetch = _realFetch; }
    });
});

describe('fetchAvecRelais — corps vide', () => {
    const _realFetch = globalThis.fetch;
    test('réponse 200 à corps vide en json → [] (pas de SyntaxError)', async () => {
        globalThis.fetch = async () => ({ ok: true, status: 200, text: async () => '' });
        try {
            const r = await fetchAvecRelais('https://aviationweather.gov/api/data/pirep?bbox=1,2,3,4&format=json', 'json');
            assert.deepEqual(r, []);
        } finally { globalThis.fetch = _realFetch; }
    });
});

// Fiche n°9 (audit 27/09) : QNH + OAT numériques d'un METAR, Qxxxx (hPa)
// ET Axxxx (inHg, spécificité Amérique du Nord — OACI Annexe 3) → hPa.
test('parseMetarQnhOat : Qxxxx hPa, Axxxx inHg converti, M=négatif, absents → null', async () => {
    const { parseMetarQnhOat } = await import('../js/core.js');
    // Format européen.
    assert.deepEqual(parseMetarQnhOat('LFPB 260800Z 27010KT 9999 FEW040 22/12 Q1018'), { qnh: 1018, oat: 22 });
    assert.deepEqual(parseMetarQnhOat('AAAA 190830Z 28012KT 6000 RA BKN010 M05/M07 Q1002'), { qnh: 1002, oat: -5 });
    // Format nord-américain : altimètre A2992 (29,92 inHg → 1013 hPa),
    // visibilité en SM, RMK avec groupes additionnels (SLP, Txxxxxx).
    assert.deepEqual(
        parseMetarQnhOat('KLAX 261953Z 27012KT 10SM FEW250 22/12 A2992 RMK AO2 SLP132 T02210172'),
        { qnh: 1013, oat: 22 });
    assert.deepEqual(
        parseMetarQnhOat('CYUL 261400Z 30015G25KT 15SM -SN BKN008 OVC015 M05/M12 A3001 RMK SC3SC5 SLP201'),
        { qnh: 1016, oat: -5 });
    // Températures seules dans RMK (Txxxxxx) : pas de paire nn/nn → null.
    assert.deepEqual(
        parseMetarQnhOat('KDEN 261753Z 09008KT 10SM CLR A3040 RMK AO2 T01721017'),
        { qnh: 1029, oat: null });
    // Groupes absents → null (jamais de valeur implicite).
    assert.deepEqual(parseMetarQnhOat('AAAA 190830Z 28012KT 6000 BKN010'), { qnh: null, oat: null });
    assert.deepEqual(parseMetarQnhOat(''), { qnh: null, oat: null });
});

// Sécurité (audit 26/09) : escapeHtml doit être sûr EN ATTRIBUT — les
// guillemets échappés, sinon « a"onmouseover="x » sort de value="…"/data-*.
test('escapeHtml : échappe les guillemets (usage attribut) et reste pur sous Node', async () => {
    const { escapeHtml } = await import('../js/core.js');
    assert.equal(escapeHtml('a"onmouseover="alert(1)'), 'a&quot;onmouseover=&quot;alert(1)');
    assert.equal(escapeHtml("l'oiseau <b>&</b>"), 'l&#39;oiseau &lt;b&gt;&amp;&lt;/b&gt;');
    assert.equal(escapeHtml(null), '');
    assert.equal(escapeHtml(42), '42');
});

// Fiche n°15 (audit 27/09) : le groupe vent OACI peut être en KT, MPS
// (Russie, Chine…) ou KMH selon la région émettrice. parseWindGroupToKt est
// le décodeur canonique — tout est converti en nœuds (MPS ×1.94384,
// KMH ÷1.852), unité de travail de toute l'app.
describe('parseWindGroupToKt', () => {
    test('KT : pass-through sans conversion', () => {
        const w = parseWindGroupToKt('LFPG 270800Z 24008KT 9999 FEW030 Q1013');
        assert.equal(w.variable, false);
        assert.equal(w.dir, 240);
        assert.equal(w.speed, 8);
        assert.equal(w.gust, null);
    });

    test('KT avec rafales et variation de direction', () => {
        const w = parseWindGroupToKt('17015G25KT 150V200');
        assert.equal(w.speed, 15);
        assert.equal(w.gust, 25);
        assert.equal(w.varFrom, 150);
        assert.equal(w.varTo, 200);
    });

    test('MPS : 20004MPS → 8 kt (4 × 1.94384 = 7.78 arrondi)', () => {
        const w = parseWindGroupToKt('ULAA 270800Z 20004MPS 9999 SCT025 Q1013');
        assert.equal(w.dir, 200);
        assert.equal(w.speed, 8);
        assert.equal(w.gust, null);
    });

    test('MPS : 31012MPS → 23 kt, rafales 24MPS → 47 kt', () => {
        const w = parseWindGroupToKt('31012G24MPS');
        assert.equal(w.speed, 23);   // 12 × 1.94384 = 23.33
        assert.equal(w.gust, 47);    // 24 × 1.94384 = 46.65
    });

    test('KMH : 31012KMH → 6 kt (12 ÷ 1.852 = 6.48 arrondi)', () => {
        const w = parseWindGroupToKt('ZBAA 270800Z 31012KMH 9999 NSW Q1008');
        assert.equal(w.dir, 310);
        assert.equal(w.speed, 6);
    });

    test('VRB en MPS : direction null, vitesse convertie', () => {
        const w = parseWindGroupToKt('VRB03MPS');
        assert.equal(w.variable, true);
        assert.equal(w.dir, null);
        assert.equal(w.speed, 6);    // 3 × 1.94384 = 5.83
    });

    test('variation de direction collée à un groupe MPS', () => {
        const w = parseWindGroupToKt('24008MPS 180V300');
        assert.equal(w.speed, 16);   // 8 × 1.94384 = 15.55
        assert.equal(w.varFrom, 180);
        assert.equal(w.varTo, 300);
    });

    test('pas de groupe vent lisible → null (jamais de vent implicite)', () => {
        assert.equal(parseWindGroupToKt('CAVOK'), null);
        assert.equal(parseWindGroupToKt('/////KT'), null);
        assert.equal(parseWindGroupToKt(''), null);
        assert.equal(parseWindGroupToKt(null), null);
    });
});
