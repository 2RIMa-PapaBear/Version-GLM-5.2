/* ================================================================
 * ATC INFO — ATIS décodé + liens profonds vers cartes VAC/SIA
 * ================================================================
 *
 * DEUX FONCTIONNALITÉS
 * -------------------
 *
 *  1. ATIS (Automatic Terminal Information Service) :
 *     Message automatisé diffusé par les terrains contrôlés (météo
 *     courante + piste en service + informations utiles). On récupère
 *     l'ATIS décodé via AviationWeather (quand le terrain le publie).
 *
 *  2. Liens profonds VAC / cartes d'approche à vue officielles :
 *     Pour chaque terrain, un bouton vers la carte VAC du pays :
 *       - France  : SIA (Service de l'Information Aéronautique)
 *       - UK      : NATS AIP
 *       - USA     : FAA ChartFinder
 *       - Allemagne : DFS AIS
 *       - etc.
 *     Pas de réinvention : juste des liens directs vers les sources
 *     officielles, ce que fait ForeFlight/SkyDemon dans leur UI.
 *
 * SOURCE ATIS
 * -----------
 * AviationWeather /data/atis — endpoint publique, via le proxy Apps
 * Script existant (CORS non natif côté AviationWeather).
 * Tous les terrains ne publient pas d'ATIS : on retourne null
 * discrètement si absent.
 * ================================================================ */

import { fetchAvecRelais } from './core.js';

// Cache session de l'ATIS par ICAO (TTL court : l'ATIS change chaque heure).
const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;

// ----------------------------------------------------------------
// ATIS
// ----------------------------------------------------------------

/**
 * Récupère l'ATIS décodé pour un terrain.
 * @param {string} icao Code OACI.
 * @returns {Promise<{raw:string, icao:string}|null>}
 */
export async function fetchAtis(icao) {
    if (!icao) return null;
    const key = icao.toUpperCase();

    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.data;

    try {
        const url = `https://aviationweather.gov/api/data/atis?station=${encodeURIComponent(key)}&format=json&_t=${Date.now()}`;
        const data = await fetchAvecRelais(url, 'json');

        // L'API retourne un tableau d'objets, ou un objet unique.
        const item = Array.isArray(data) ? data[0] : data;
        if (!item) return null;

        const raw = item.rawOb || item.rawText || item.datis || '';
        if (!raw) return null;

        const result = { raw, icao: key };
        _cache.set(key, { data: result, ts: Date.now() });
        return result;
    } catch (e) {
        console.warn('ATIS fetch failed:', e.message);
        return null;
    }
}

// ----------------------------------------------------------------
// Liens profonds VAC / cartes d'approche à vue
// ----------------------------------------------------------------

/**
 * Mapping des sources de cartes d'approche à vue (VAC) par préfixe OACI.
 *
 * RÉALITÉ DES SOURCES
 * -------------------
 * La plupart des États ne publient pas de PDF VAC gratuit par code OACI.
 * On pointe donc vers le portail AIP officiel de chaque pays (eAIP en
 * ligne), où le pilote trouvera la donnée officielle — parfois payante.
 */
const VAC_PROVIDERS = [
    {
        // France (LF).
        match: /^LF[A-Z]{2}$/,
        country: 'France',
        url: () => 'https://www.sia.aviation-civile.gouv.fr/vaip',
        label: { fr: 'eAIP officiel (SIA)', en: 'Official eAIP (SIA)' },
    },
    {
        // UK (EG).
        match: /^EG[A-Z]{2}$/,
        country: 'United Kingdom',
        url: () => 'https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP/',
        label: { fr: 'eAIP (NATS)', en: 'eAIP (NATS)' },
    },
    {
        // USA (K + 3 lettres, ou 3 lettres sans K).
        match: /^K?[A-Z]{3,4}$/,
        country: 'USA',
        url: () => 'https://www.faa.gov/air_traffic/flight_info/aeronav/digital_products/vfr/',
        label: { fr: 'VFR Charts (FAA)', en: 'VFR Charts (FAA)' },
    },
    {
        // Allemagne (ED).
        match: /^ED[A-Z]{2}$/,
        country: 'Germany',
        url: () => 'https://www.dfs.de/homepage/de/flugsicherung/aeronautical-information-service/aip-vfr/',
        label: { fr: 'AIP VFR (DFS)', en: 'AIP VFR (DFS)' },
    },
    {
        // Espagne (LE).
        match: /^LE[A-Z]{2}$/,
        country: 'Spain',
        url: () => 'https://www.enaire.es/servicios-a-la-navegacion-aerea/servicios-informacion-aeronautica',
        label: { fr: 'eAIP (ENAIRE)', en: 'eAIP (ENAIRE)' },
    },
    {
        // Italie (LI).
        match: /^LI[A-Z]{2}$/,
        country: 'Italy',
        url: () => 'https://www.enav.it/',
        label: { fr: 'eAIP (ENAV)', en: 'eAIP (ENAV)' },
    },
    {
        // Suisse (LS).
        match: /^LS[A-Z]{2}$/,
        country: 'Switzerland',
        url: () => 'https://www.skyguide.ch/',
        label: { fr: 'eAIP (Skyguide)', en: 'eAIP (Skyguide)' },
    },
    {
        // Belgique (EB).
        match: /^EB[A-Z]{2}$/,
        country: 'Belgium',
        url: () => 'https://ops.skeyes.be/',
        label: { fr: 'eAIP (skeyes)', en: 'eAIP (skeyes)' },
    },
];

/**
 * Retourne le lien vers le portail AIP officiel du pays du terrain.
 *
 * @param {string} icao
 * @returns {{url:string, labelFr:string, labelEn:string, country:string}|null}
 *   null si le pays n'est pas reconnu (pas de lien générique).
 */
export function getVacLink(icao) {
    const code = (icao || '').toUpperCase();
    for (const p of VAC_PROVIDERS) {
        if (p.match.test(code)) {
            return {
                url: p.url(code),
                labelFr: p.label.fr,
                labelEn: p.label.en,
                country: p.country,
            };
        }
    }
    return null;
}

/**
 * Invalide le cache ATIS session.
 */
export function _clearCache() { _cache.clear(); }
