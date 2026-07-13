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
 * ================================================================ */

const ENDPOINT = 'https://api.open-meteo.com/v1/elevation';
const FT_PER_M = 3.28084;

// Nombre de points d'échantillonnage le long de la route.
// 20 points = bon compromis précision/charge (max 100 par requête).
const DEFAULT_SAMPLES = 20;

// Cache session (clé : route arrondie au 0.01°).
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
export async function fetchRouteElevation(fromLat, fromLon, toLat, toLon, samples = DEFAULT_SAMPLES) {
    if (fromLat == null || toLat == null) return null;

    const key = `${fromLat.toFixed(2)},${fromLon.toFixed(2)},${toLat.toFixed(2)},${toLon.toFixed(2)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.profile;

    try {
        // Échantillonnage linéaire de la route.
        const lats = [];
        const lons = [];
        const n = Math.max(2, Math.min(samples, 100));
        for (let i = 0; i < n; i++) {
            const t = i / (n - 1);
            lats.push((fromLat + (toLat - fromLat) * t).toFixed(4));
            lons.push((fromLon + (toLon - fromLon) * t).toFixed(4));
        }

        const url = `${ENDPOINT}?latitude=${lats.join(',')}&longitude=${lons.join(',')}`;
        const res = await fetch(url);
        if (!res.ok) throw new Error('Open-Meteo elevation HTTP ' + res.status);
        const data = await res.json();

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
