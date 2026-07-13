/* ================================================================
 * ROUTE ELEVATION — Profil d'élévation du sol le long d'une route
 * ================================================================
 *
 * POURQUOI
 * --------
 * En VFR de transit (surtout en montagne ou en traversée de relief),
 * connaître l'altitude du sol le long de la route est vital :
 *   - Détecter un col ou une ligne de crête sous la route qui réduit
 *     la marge de franchissement (hélicoptère ou ULM, mais aussi
 *     avion en cas de panne moteur → zone d'atterrissage forcée).
 *   - Vérifier qu'on respecte la règle VFR des 500 ft sol (ou 1000 ft
 *     au-dessus des obstacles les plus élevés en agglomération).
 *   - Visualiser un "profil de vol" qui aide à planifier l'altitude
 *     de croisière optimale.
 *
 * SOURCE
 * ------
 * Open-Meteo elevation endpoint — gratuit, sans clé, CORS natif.
 *   GET /v1/elevation?latitude=lat1,lat2,...&longitude=lon1,lon2,...
 * Retourne un tableau d'élévations (mètres) pour chaque point.
 *
 * On échantillonne la route départ→destination en N points (défaut 20)
 * pour obtenir un profil lisse sans saturer l'API.
 *
 * SOURCE : Open Topo Data (api.opentopodata.org) — API publique gratuite
 * basée sur SRTM 90m. Indépendante d'Open-Meteo pour éviter les conflits
 * de rate-limit avec les requêtes météo.
 * ================================================================ */

import { fetchAvecRelais } from './core.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const FT_PER_M = 3.28084;

// Nombre de points d'échantillonnage le long de la route.
// Adapté à la distance : ~1 point tous les 3 NM, pour capter les reliefs
// significatifs même sur les longues traversées.
// Open Topo Data accepte jusqu'à 100 points par requête.
const DEFAULT_SAMPLES = 20;
const MAX_SAMPLES = 100;

// Cache session (clé : route arrondie au 0.01° + nombre de points).
const _cache = new Map();
const TTL_MS = 24 * 60 * 60 * 1000;  // 24 h (le relief ne change pas).

/**
 * Récupère le profil d'élévation le long d'une route.
 * @param {number} fromLat Latitude départ.
 * @param {number} fromLon Longitude départ.
 * @param {number} toLat   Latitude destination.
 * @param {number} toLon   Longitude destination.
 * @param {number} [samples=20] Nombre de points.
 * @returns {Promise<{
 *   points: Array<{lat:number, lon:number, elevFt:number, frac:number}>,
 *   maxFt: number,
 *   minFt: number,
 *   avgFt: number
 * }|null>}
 *   frac = position le long de la route (0=départ, 1=destination).
 */
export async function fetchRouteElevation(fromLat, fromLon, toLat, toLon, samples) {
    if (fromLat == null || toLat == null) return null;

    // Nombre de points adaptatif si non spécifié : ~1 point / 3 NM.
    // On estime la distance par la formule haversine simplifiée.
    let n = DEFAULT_SAMPLES;
    if (samples == null) {
        const distNm = _haversineNm(fromLat, fromLon, toLat, toLon);
        n = Math.max(20, Math.min(MAX_SAMPLES, Math.round(distNm / 3)));
    } else {
        n = Math.max(2, Math.min(samples, MAX_SAMPLES));
    }

    // La clé de cache inclut le nombre de points (sinon un appel avec plus de
    // points récupère un profil sous-échantillonné mis en cache avant).
    const key = `${fromLat.toFixed(2)},${fromLon.toFixed(2)},${toLat.toFixed(2)},${toLon.toFixed(2)},${n}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.profile;

    try {
        // Échantillonnage linéaire de la route.
        const lats = [];
        const lons = [];
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            lats.push((fromLat + (toLat - fromLat) * t).toFixed(4));
            lons.push((fromLon + (toLon - fromLon) * t).toFixed(4));
        }

        // Open-Meteo elevation via le proxy (change l'IP source → évite le 429
        // et contourne les restrictions CORS depuis free.fr).
        const url = `${ENDPOINT}?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
        let data;
        try {
            data = await fetchAvecRelais(url, 'json');
        } catch (e) {
            console.warn('Route elevation fetch error:', e.message);
            return null;
        }
        if (!data) return null;

        const elevs = data?.elevation;
        if (!Array.isArray(elevs) || elevs.length !== n) return null;

        // Construit les points avec conversion m → ft.
        const points = [];
        let maxFt = -Infinity, minFt = Infinity, sumFt = 0;
        for (let i = 0; i < n; i++) {
            const elevFt = Math.round(elevs[i] * FT_PER_M);
            const frac = i / (n - 1);
            points.push({
                lat: parseFloat(lats[i]),
                lon: parseFloat(lons[i]),
                elevFt,
                frac,
            });
            if (elevFt > maxFt) maxFt = elevFt;
            if (elevFt < minFt) minFt = elevFt;
            sumFt += elevFt;
        }

        const profile = {
            points,
            maxFt,
            minFt,
            avgFt: Math.round(sumFt / n),
        };

        _cache.set(key, { profile, ts: Date.now() });
        return profile;
    } catch (e) {
        console.warn('Route elevation fetch failed:', e.message);
        return null;
    }
}

/**
 * Évalue la marge de franchissement pour une altitude de croisière donnée.
 * @param {Object} profile Résultat de fetchRouteElevation.
 * @param {number} cruiseAltFt Altitude de croisière (ft MSL).
 * @param {number} [minClearanceFt=1000] Marge réglementaire mini (ft).
 * @returns {{minClearanceFt:number, worstPoint:Object|null, level:'ok'|'caution'|'danger'}}
 */
export function evaluateClearance(profile, cruiseAltFt, minClearanceFt = 1000) {
    if (!profile?.points?.length) return { minClearanceFt: null, worstPoint: null, level: 'ok' };

    let worst = profile.points[0];
    let worstClear = cruiseAltFt - worst.elevFt;

    for (const p of profile.points) {
        const clear = cruiseAltFt - p.elevFt;
        if (clear < worstClear) {
            worstClear = clear;
            worst = p;
        }
    }

    let level = 'ok';
    if (worstClear < 0) level = 'danger';              // sous le sol !
    else if (worstClear < minClearanceFt) level = 'caution';

    return { minClearanceFt: worstClear, worstPoint: worst, level };
}

/**
 * Invalide le cache session.
 */
export function _clearCache() { _cache.clear(); }

/**
 * Distance haversine entre deux points (NM). Sert à adapter le nombre
 * de points d'échantillonnage à la longueur de la route.
 */
function _haversineNm(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) / 1852);
}
