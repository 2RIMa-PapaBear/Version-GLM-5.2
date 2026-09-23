/* ================================================================
 * AIRSPACE FREQ — fréquence radio d'une zone contrôlée / SIV
 * ================================================================
 * Pour la carte de vol imprimable (B7) : résout la fréquence à écrire
 * dans l'étiquette d'une zone SIV / CTR / TMA / CTA — SANS JAMAIS
 * INVENTER (null si aucune source ne la connaît).
 *
 * Chaîne, par ordre de priorité (règle pilote 22/09 : TWR pour une
 * CTR, APP pour une TMA/CTA) :
 *   1. correction manuelle data/freq-overrides.json (clé « services »,
 *      par indicatif — « RENNES INFORMATION ») : prime toujours ;
 *   2. champ « f » propre de la zone : officiel SIA pour les SIV
 *      (export XML AIRAC, 108/110 couverts) ; openAIP pour les zones
 *      hors base SIA (étranger, ATZ…) ;
 *   3. data/freq-services-sia.json — fréquences officielles PAR
 *      ORGANISME (section <Frequence> du XML SIA : 62 APP + 168 TWR +
 *      29 FIS), rapprochées par la ville du nom de zone
 *      (« CTR QUIMPER » → TWR QUIMPER Tour) ;
 *   4. fréquence openAIP du jumeau écarté par le dédoublonnage SIA
 *      (champ _oaFreqs posé par _dropOpenAipDuplicates).
 *
 * Seul le VHF comm (118-136.995) est retenu : les UHF 2xx/3xx MHz
 * militaires qui côtoient les fréquences dans le fichier SIA ne
 * servent pas un vol VFR.
 *
 * Node-safe (maquette/taquets) : le fichier services se charge par fs
 * hors navigateur ; les overrides restent alors neutres (null).
 * ================================================================ */

import { getServiceFreq, loadFreqSources, getAirportFreqs } from './freq-sia.js';

const _FREQ_KINDS = new Set(['CTR', 'TMA', 'CTA', 'SIV']);

const _isVhf = (v) => {
    const f = parseFloat(v);
    return Number.isFinite(f) && f >= 118 && f <= 136.995;
};

/** Normalisation d'un nom de ville : casse, tirets/apostrophes en
 *  espaces, ST ≡ SAINT (« ST-BRIEUC » ≡ « SAINT BRIEUC »). */
function _normCity(s) {
    return String(s || '').toUpperCase()
        .replace(/[-']/g, ' ')
        .replace(/\bST\b/g, 'SAINT')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Ville portée par le nom d'une zone : « TMA RENNES 1 » → RENNES,
 *  « CTR DINARD 01 » → DINARD, « CTA NANTES A » → NANTES,
 *  « SIV RENNES COTENTIN C » → RENNES COTENTIN. Les numéros de
 *  secteur et lettres finales sont retirés itérativement (un nom peut
 *  porter les deux : « RENNES 2-1 A »). */
export function zoneCity(name) {
    let s = String(name || '').toUpperCase().trim()
        .replace(/^(CTR|TMA|CTA|SIV)\s+/, '')
        .replace(/\s+PARTIE\s+[A-Z0-9.]+$/, '');
    let prev = null;
    while (prev !== s) {
        prev = s;
        s = s.replace(/[\s\-]+\d+(?:[.\-]\d+)*$/, '')   // « 1 », « 01 », « 2-1 », « 2.1 »
            .replace(/\s+[A-Z]$/, '');                   // lettre de secteur (« … C »)
    }
    return s.trim();
}

/** data/freq-services-sia.json → index [{family, role, city, cityRaw,
 *  freqs:[VHF…]}]. Clés « TWR RENNES Tour », « APP NANTES Approche »,
 *  « FIS LA ROCHELLE Information » — la VILLE est tout ce qui sépare
 *  la famille du rôle (dernier mot). ATIS/A-A/AFIS hors périmètre. */
export function buildServicesIndex(raw) {
    const out = [];
    for (const [key, entries] of Object.entries(raw?.services || {})) {
        const parts = String(key || '').trim().split(/\s+/);
        if (parts.length < 3) continue;
        const family = parts[0].toUpperCase();
        if (family !== 'TWR' && family !== 'APP' && family !== 'FIS') continue;
        const role = parts[parts.length - 1].toUpperCase();
        const cityRaw = parts.slice(1, -1).join(' ').toUpperCase();
        const freqs = (Array.isArray(entries) ? entries : [])
            .filter((e) => e && _isVhf(e.freq))
            .map((e) => String(e.freq));
        if (!freqs.length) continue;
        out.push({ family, role, cityRaw, city: _normCity(cityRaw), freqs });
    }
    return out;
}

/** Score de rapprochement ville zone ↔ ville service : 2 = identiques,
 *  1 = préfixe mot entier (« RENNES » ≡ « RENNES COTENTIN »), 0 sinon. */
function _cityMatch(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 2;
    if (a.startsWith(b + ' ') || b.startsWith(a + ' ')) return 1;
    return 0;
}

/** Indicatif d'override candidat pour un service résolu
 *  (« RENNES INFORMATION », « QUIMPER TOUR »…) — la clé réelle des
 *  overrides, quand elle existe, prime sur la fréquence du fichier. */
function _serviceOverride(family, cityRaw) {
    const suffix = family === 'FIS' ? 'INFORMATION'
        : family === 'APP' ? 'APPROCHE' : 'TOUR';
    return getServiceFreq(`${cityRaw} ${suffix}`) || null;
}

/** Fréquence affichable d'une zone : { freq, tag } | null.
 *  tag = indicatif court (« QUIMPER TWR », « RENNES INFO ») ou ''.
 *  « index » = sortie de buildServicesIndex (null = étape 3 sautée). */
export function zoneFreqInfo(as, kind, index) {
    if (!as || !_FREQ_KINDS.has(kind)) return null;

    // 1-2. Champ propre — officiel SIA pour un SIV, openAIP hors base
    // SIA. Correction manuelle par indicatif prioritaire.
    const own = (Array.isArray(as.frequencies) ? as.frequencies : [])
        .find((f) => f && f.value && _isVhf(f.value));
    if (own) {
        const fixed = own.name ? getServiceFreq(own.name) : null;
        return { freq: String(fixed || own.value), tag: String(own.name || '').trim() };
    }

    // 3. Services officiels SIA, par ville du nom de zone.
    if (Array.isArray(index) && index.length) {
        const city = _normCity(zoneCity(as.name || as.designator));
        if (city) {
            // CTR → la tour (premier contact VFR pour entrer/transiter) ;
            // TMA/CTA → l'approche (qui gère le transit au-dessus) ;
            // SIV sans « f » propre → l'information. Jamais « Sol ».
            const prefs = kind === 'CTR'
                ? [['TWR', 'TOUR'], ['TWR', null], ['APP', null]]
                : kind === 'SIV'
                    ? [['FIS', null], ['APP', null]]
                    : [['APP', null], ['FIS', null], ['TWR', 'TOUR']];
            for (const [fam, role] of prefs) {
                let best = null, bestScore = 0;
                for (const s of index) {
                    if (s.family !== fam || (!role && s.role === 'SOL')) continue;
                    if (role && s.role !== role) continue;
                    const sc = _cityMatch(city, s.city);
                    if (sc > bestScore) { best = s; bestScore = sc; }
                }
                if (best) {
                    const fixed = _serviceOverride(fam, best.cityRaw);
                    return {
                        freq: String(fixed || best.freqs[0]),
                        tag: `${best.cityRaw} ${fam}`,
                    };
                }
            }
        }
    }

    // 4. Fréquence openAIP du jumeau écarté par le dédoublonnage SIA.
    const oa = (Array.isArray(as._oaFreqs) ? as._oaFreqs : [])
        .find((f) => f && f.value && _isVhf(f.value));
    if (oa) return { freq: String(oa.value), tag: String(oa.name || '').trim() };

    return null;
}

let _servicesIndex = null;
let _servicesPending = null;

/** Index des services officiels (cache session) — null/[] si le
 *  fichier est indisponible (hors ligne) : les SIV gardent leur
 *  champ « f » propre, les CTR/TMA restent sans fréquence affichée. */
export function loadZoneFreqServices() {
    if (_servicesIndex) return Promise.resolve(_servicesIndex);
    _servicesPending ??= (async () => {
        let raw = null;
        if (typeof window !== 'undefined') {
            // Overrides prêts pour getServiceFreq (déjà en attente dans
            // la session si le widget terrain a tourné — promesse partagée).
            try { await Promise.race([loadFreqSources(), new Promise(r => setTimeout(r, 4000))]); } catch { /* neutre */ }
            try {
                const res = await fetch('data/freq-services-sia.json', { signal: AbortSignal.timeout(8000) });
                if (res.ok) raw = await res.json();
            } catch { /* hors ligne */ }
        } else {
            try {
                const { readFileSync } = await import('node:fs');
                raw = JSON.parse(readFileSync(new URL('../data/freq-services-sia.json', import.meta.url), 'utf8'));
            } catch { /* maquette sans le fichier */ }
        }
        _servicesIndex = buildServicesIndex(raw);
        return _servicesIndex;
    })();
    return _servicesPending;
}

// ----------------------------------------------------------------
// Fréquences A/A + AFIS des TERRAINS (carte imprimable, 22/09) :
// ligne « 122.605 AFIS » sous le code du terrain — l'A/A ne s'ajoute
// que si elle DIFFÈRE de l'AFIS (« · 123.455 A/A »). Sources = la
// chaîne officielle existante : overrides > eAIP (AD 2.17/2.18) ⊕
// XML SIA (freq-aa-sia.json, 271 terrains) > openAIP ; GONIO écartée.
// ----------------------------------------------------------------

/** Entrées [{type, value}] → texte affichable ou null (aucune). */
export function aaAfisFreqText(entries) {
    const pick = (t) => (Array.isArray(entries) ? entries : [])
        .filter((e) => e && e.type === t && _isVhf(e.value))
        .map((e) => String(e.value))[0] || null;
    const afis = pick('AFIS'), aa = pick('A/A');
    if (!afis && !aa) return null;
    const parts = [];
    if (afis) parts.push(`${afis} AFIS`);
    if (aa && aa !== afis) parts.push(`${aa} A/A`);
    return parts.join(' · ');
}

let _terrainNodeMap = null;

/** Texte A/A-AFIS d'un terrain par code OACI — null si inconnu (les
 *  repères/waypoints non terrains ne matchent aucune entrée). */
export async function terrainFreqText(icao) {
    const code = String(icao || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;   // codes à chiffres : pas des terrains
    if (typeof window !== 'undefined') {
        try { await Promise.race([loadFreqSources(), new Promise(r => setTimeout(r, 4000))]); } catch { /* neutre */ }
        const r = getAirportFreqs(code, []);
        const entries = (r?.freqs || []).map((f) => ({ type: f.type, value: String(f.freq) }));
        return aaAfisFreqText(entries);
    }
    // Node (maquette) : fusion fs des deux fichiers officiels,
    // eAIP d'abord puis XML (même ordre que la chaîne navigateur).
    _terrainNodeMap ??= (async () => {
        const { readFileSync } = await import('node:fs');
        const read = (f) => {
            try { return JSON.parse(readFileSync(new URL(`../data/${f}`, import.meta.url), 'utf8')); } catch { return null; }
        };
        const map = {};
        for (const src of [read('freq-sia.json'), read('freq-aa-sia.json')]) {
            for (const [icao2, list] of Object.entries(src?.airports || {})) {
                map[icao2] ||= [];
                for (const f of list || []) {
                    if (f && f.value && !map[icao2].some((x) => x.value === f.value)) {
                        map[icao2].push({ type: f.type, value: String(f.value) });
                    }
                }
            }
        }
        return { airports: map };
    })();
    const map = await _terrainNodeMap;
    return aaAfisFreqText(map.airports[code] || []);
}
