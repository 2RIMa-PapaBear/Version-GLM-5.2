/* ================================================================
 * OPENAIP — Intégration API OpenAIP pour données aérodromes
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Enrichir les données d'aérodromes (pistes, revêtement, radio,
 * élévation, déclinaison magnétique) via l'API OpenAIP, plus à jour
 * et plus détaillée que la base locale airports.json.
 *
 * ARCHITECTURE HYBRIDE
 * --------------------
 * airports.json reste la base synchrone (vitesse, offline, 36 appels
 * par rendu). OpenAIP intervient en ARRIÈRE-PLAN au chargement d'un
 * terrain : on fetch les détails, on les fusionne dans le memo, puis
 * on rafraîchit l'UI. Le tout est mis en cache IndexedDB pour les
 * visites suivantes.
 *
 * SOURCE
 * ------
 * GET https://api.core.openaip.net/api/airports?search={query}&limit={n}
 * Auth : header x-openaip-api-key
 * CORS supporté nativement (pas de proxy nécessaire).
 *
 * MAPPING DES DONNÉES
 * -------------------
 * OpenAIP retourne des unités en mètres (unit:0) et des codes de
 * revêtement mainComposite (0=asphalte/béton, 1=bitume, 2=herbe...).
 * On convertit vers le format interne de l'app (ft, codes ASP/GRE...).
 * ================================================================ */

import { OPENAIP_API_KEY } from './config.local.js';

const BASE_URL = 'https://api.core.openaip.net/api/airports';
const FT_PER_M = 3.28084;

// ----------------------------------------------------------------
// Cache IndexedDB (store dédié OpenAIP)
// ----------------------------------------------------------------
const IDB_NAME = 'openaip-cache';
const IDB_STORE = 'airports';
const IDB_VERSION = 1;

function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGet(icao) {
    try {
        const db = await _openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(icao.toUpperCase());
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    } catch { return null; }
}

async function _idbPut(icao, data) {
    try {
        const db = await _openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put({ data, ts: Date.now() }, icao.toUpperCase());
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch { /* quota / mode privé */ }
}

// ----------------------------------------------------------------
// Mapping OpenAIP → format interne
// ----------------------------------------------------------------

/**
 * Convertit le code de revêtement OpenAIP (mainComposite) en code interne.
 *
 * Nomenclature OpenAIP (confirmée) :
 *   0 = ASPH  Asphalt   (asphalte)
 *   1 = CONC  Concrete  (béton)
 *   2 = GRASS Grass     (herbe)
 *   3 = GRA   Gravel    (gravier)
 *   4 = DIRT  Dirt      (terre)
 *   5 = SAND  Sand      (sable)
 *   6 = WAT   Water     (eau — hydravion)
 *
 * Mapping vers nos codes internes (standard OurAirports/SurfaceTypes) :
 *   ASPH → ASP, CONC → CON, GRASS → GRS, GRA → GVL, DIRT → GRE, SAND → SAN, WAT → WAT.
 */
function _mapSurface(mainComposite) {
    switch (mainComposite) {
        case 0: return 'ASP';   // Asphalt
        case 1: return 'CON';   // Concrete
        case 2: return 'GRS';   // Grass
        case 3: return 'GVL';   // Gravel
        case 4: return 'GRE';   // Dirt (terre tassée)
        case 5: return 'SAN';   // Sand
        case 6: return 'WAT';   // Water
        default: return 'U';    // Unknown
    }
}

/**
 * Convertit mètres → pieds (arrondi).
 */
function _mToFt(m) { return Math.round(m * FT_PER_M); }

/**
 * Transforme un terrain OpenAIP en objet format interne (compatible airports.json).
 * @param {Object} aip Terrain OpenAIP brut.
 * @returns {Object} Terrain au format interne.
 */
function _mapAirport(aip) {
    const [lon, lat] = aip.geometry?.coordinates || [null, null];
    const elevM = aip.elevation?.value;
    const elevFt = typeof elevM === 'number' ? _mToFt(elevM) : null;

    // Pistes : on regroupe par paire (designator opposés) et on convertit.
    const runways = [];
    const runwayLengths = {};
    const runwaySurfaces = {};
    let longestRunway = 0;
    let dominantSurface = null;
    const surfCounts = {};

    (aip.runways || []).forEach(rw => {
        const desig = rw.designator;
        if (!desig) return;
        const lenM = rw.dimension?.length?.value;
        const lenFt = typeof lenM === 'number' ? _mToFt(lenM) : null;
        const surfCode = _mapSurface(rw.surface?.mainComposite);

        if (lenFt) {
            runwayLengths[desig] = lenFt;
            if (lenFt > longestRunway) longestRunway = lenFt;
        }
        if (surfCode && surfCode !== 'U') {
            runwaySurfaces[desig] = surfCode;
            surfCounts[surfCode] = (surfCounts[surfCode] || 0) + 1;
        }
    });

    // Surface dominante : la plus fréquente.
    if (Object.keys(surfCounts).length > 0) {
        dominantSurface = Object.entries(surfCounts).sort((a, b) => b[1] - a[1])[0][0];
    }

    // Fréquences radio (champ 'frequencies' dans l'API OpenAIP).
    const FREQ_TYPE_LABELS = {
        0: 'APP',   // Approach
        1: 'ARR',   // Arrival
        2: 'DEP',   // Departure
        3: 'CTR',   // Center
        4: 'FIS',   // Flight Information Service
        5: 'AFIS',  // Aerodrome FIS
        6: 'RAD',   // Radar
        7: 'INFO',  // Information
        8: 'DEL',   // Clearance Delivery
        9: 'GND',   // Ground
        10: 'TWR',  // Tower (alt code)
        11: 'ATIS', // ATIS (alt code)
        12: 'VOLMET',
        13: 'OPS',  // Operations
        14: 'TWR',  // Tower
        15: 'ATIS', // ATIS
        16: 'UNK',  // Unknown
        17: 'AOC',  // Aeronautical Operational Control
        18: 'EMER', // Emergency
        19: 'SAFETY',
    };
    const frequencies = (aip.frequencies || [])
        .filter(f => f && f.value)  // ignore les fréquences vides
        .map(f => ({
            freq: parseFloat(f.value),
            name: f.name || '',
            type: FREQ_TYPE_LABELS[f.type] ?? 'COM',
            primary: !!f.primary,
        }))
        .filter(f => !isNaN(f.freq))  // garde uniquement les fréquences valides
        // Trie : primary d'abord, puis par type, puis par fréquence.
        .sort((a, b) => (b.primary - a.primary) || a.freq - b.freq);

    return {
        icao: aip.name?.match(/[A-Z]{4}/)?.[0] || '',  // best-effort
        name: aip.name || '',
        country: aip.country || '',
        lat,
        lon,
        elevation: elevFt,
        magneticDeclination: typeof aip.magneticDeclination === 'number' ? aip.magneticDeclination : null,
        runways: _buildRunwayPairs(aip.runways),
        runwayLengths,
        runwaySurfaces,
        longestRunway: longestRunway || null,
        surface: dominantSurface,
        frequencies,
        type: aip.type,
        source: 'openaip',
        ts: Date.now(),
    };
}

/**
 * Reconstruit les paires de pistes au format airports.json.
 * OpenAIP liste chaque seuil séparément (04, 22, 08, 26...).
 * On regroupe les seuils opposés en paires "04 (039°)/22 (219°)".
 */
function _buildRunwayPairs(aipRunways) {
    if (!aipRunways || aipRunways.length === 0) return [];
    const pairs = [];
    const used = new Set();

    aipRunways.forEach(rw => {
        if (used.has(rw.designator)) return;
        // Cherche le seuil opposé (cap inverse ≈ +180°).
        const oppHeading = (rw.trueHeading + 180) % 360;
        let opp = aipRunways.find(o =>
            !used.has(o.designator) &&
            o.designator !== rw.designator &&
            Math.abs(o.trueHeading - oppHeading) < 5
        );
        if (!opp) {
            // Pas d'opposé : piste seule (helipad, etc.).
            pairs.push(`${rw.designator} (${String(Math.round(rw.trueHeading)).padStart(3,'0')}°)`);
            used.add(rw.designator);
            return;
        }
        pairs.push(`${rw.designator} (${String(Math.round(rw.trueHeading)).padStart(3,'0')}°)/${opp.designator} (${String(Math.round(opp.trueHeading)).padStart(3,'0')}°)`);
        used.add(rw.designator);
        used.add(opp.designator);
    });

    return pairs;
}

// ----------------------------------------------------------------
// API publique
// ----------------------------------------------------------------

// Cache mémoire des terrains déjà fetch ce cycle (évite les double-fetch).
const _memCache = new Map();

/**
 * Charge un terrain depuis OpenAIP par code OACI, avec cache.
 * @param {string} icao Code OACI (ex: 'LFPG').
 * @param {Object} [opts]
 * @param {boolean} [opts.forceRefresh] Forcer le re-fetch (ignore cache).
 * @returns {Promise<Object|null>} Terrain au format interne, ou null.
 */
export async function fetchAirportByIcao(icao, opts = {}) {
    if (!icao) return null;
    const key = icao.toUpperCase();

    // 1. Cache mémoire.
    if (!opts.forceRefresh && _memCache.has(key)) return _memCache.get(key);

    // 2. Cache IndexedDB.
    if (!opts.forceRefresh) {
        const cached = await _idbGet(key);
        if (cached?.data) {
            _memCache.set(key, cached.data);
            return cached.data;
        }
    }

    // 3. Fetch OpenAIP.
    try {
        const url = `${BASE_URL}?search=${encodeURIComponent(key)}&limit=1`;
        const res = await fetch(url, {
            headers: { 'x-openaip-api-key': OPENAIP_API_KEY },
            signal: AbortSignal.timeout(12000),
        });
        if (!res.ok) {
            console.warn('OpenAIP fetch failed:', res.status);
            return null;
        }
        const data = await res.json();
        const item = data.items?.[0];
        if (!item) return null;

        const mapped = _mapAirport(item);
        // Le code OACI exact peut manquer dans le mapping best-effort → on l'injecte.
        mapped.icao = key;

        _memCache.set(key, mapped);
        _idbPut(key, mapped);
        return mapped;
    } catch (e) {
        console.warn('OpenAIP fetch error:', e.message);
        return null;
    }
}

/**
 * Recherche textuelle pour l'autocomplétion (nom, ville, code OACI).
 * @param {string} query Texte de recherche (min 2 caractères).
 * @param {number} [limit=8] Nombre max de résultats.
 * @returns {Promise<Array<{icao,name,country,lat,lon,type}>>}
 */
export async function searchAirports(query, limit = 8) {
    if (!query || query.trim().length < 2) return [];
    try {
        const url = `${BASE_URL}?search=${encodeURIComponent(query.trim())}&limit=${limit}`;
        const res = await fetch(url, {
            headers: { 'x-openaip-api-key': OPENAIP_API_KEY },
            signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) return [];
        const data = await res.json();
        return (data.items || []).map(a => {
            const [lon, lat] = a.geometry?.coordinates || [null, null];
            return {
                icao: _extractIcao(a),
                name: a.name || '',
                country: a.country || '',
                lat,
                lon,
                type: a.type,
            };
        }).filter(a => a.name); // filtre les résultats vides
    } catch {
        return [];
    }
}

/**
 * Tente d'extraire un code OACI d'un terrain OpenAIP.
 * OpenAIP ne stocke pas toujours l'ICAO dans un champ dédié ; on essaie
 * plusieurs sources.
 */
function _extractIcao(aip) {
    // Certains terrains ont l'ICAO dans un champ dédié.
    if (aip.icaoId && /^[A-Z]{4}$/.test(aip.icaoId)) return aip.icaoId;
    if (aip.ICAO && /^[A-Z]{4}$/.test(aip.ICAO)) return aip.ICAO;
    // Sinon on cherche dans le nom (ex: "PARIS CHARLES DE GAULLE" → pas d'ICAO).
    // Dans ce cas, on retourne une chaîne vide ; l'autocomplétion affichera
    // juste le nom.
    return '';
}

/**
 * Réinitialise le cache mémoire (tests).
 */
export function _clearMemCache() {
    _memCache.clear();
}
