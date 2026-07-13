/* ================================================================
 * SIGMET / AIRMET — Alertes météo en route
 * ================================================================
 *
 * CONTEXTE
 * --------
 * SIGMET (Significant Meteorological Information) et AIRMET (Airman's
 * Meteorological Information) alertent les pilotes de phénomènes
 * dangereux en route :
 *
 *   SIGMET : orages sévères, grêle forte, turbu sévère, givrage sévère,
 *            onde de montagne sévère, tempête de sable, cendres volcaniques,
 *            cyclone tropical.
 *   AIRMET : phénomènes modérés (turbu, givrage, plafond/visi bas, vent)
 *            intéressant surtout les avions légers.
 *
 * SOURCE DES DONNÉES — LIMITATION EUROPE
 * ---------------------------------------
 * L'API AviationWeather.gov (endpoint /api/data/sigmet) distribue les
 * SIGMET/Convective SIGMET US et de l'Atlantique Ouest. Elle NE distribue
 * PAS les SIGMET émis par les bureaux météo nationaux européens (Météo-
 * France, DWD, Met Office...).
 *
 * Pour l'Europe, les sources officielles sont :
 *   - SADIS OPMET API (Met Office) : OAuth2, couvre EUR/NAT.
 *   - Eurocontrol NM B2B : certificat, NOTAM + SIGMET.
 * Ces deux sources nécessitent une authentification backend — impossible
 * à appeler depuis une app 100% statique sans exposer les secrets.
 *
 * Ce module interroge donc AviationWeather (qui couvre au moins l'Atlantique
 * et les SIGMET US/convectifs mondiaux) et filtre par proximité avec le
 * terrain. Hors US/Atlantique, il retournera souvent peu de résultats —
 * c'est une limitation connue, documentée pour le pilote.
 * ================================================================ */

import { state, I18N, fetchAvecRelais } from './core.js';

/**
 * Récupère les SIGMET/AIRMET actifs et les filtre par proximité avec un point.
 * @param {number} lat Latitude du centre de recherche.
 * @param {number} lon Longitude du centre de recherche.
 * @param {number} radiusDeg Rayon de recherche en degrés (~1° ≈ 111 km).
 * @returns {Promise<Array<{raw:string, type:string, hazard:string, obs:boolean}>>}
 */
export async function fetchSigmetAirmet(lat, lon, radiusDeg = 5) {
    if (lat == null || lon == null) return [];
    try {
        // Endpoint corrigé : l'ancien "airsigmets" est obsolète (404).
        // La nouvelle API utilise "sigmet" et retourne un tableau direct.
        const url = `https://aviationweather.gov/api/data/sigmet?format=json&_t=${Date.now()}`;
        const data = await fetchAvecRelais(url, 'json');

        if (!Array.isArray(data)) return [];

        const relevant = [];
        for (const item of data) {
            // Le texte brut (champ rawAirSigmet dans la nouvelle API).
            const raw = item.rawAirSigmet || item.rawText || item.raw || item.rawSigmet || '';
            if (!raw) continue;

            // Filtrage géographique : on utilise le champ 'coords' (tableau de
            // {lat, lon} formant le polygone) plutôt que de parser le texte.
            // C'est bien plus fiable que l'ancienne extraction par regex.
            const coords = Array.isArray(item.coords) ? item.coords : [];
            const isNear = coords.length === 0 || coords.some(c =>
                typeof c.lat === 'number' && typeof c.lon === 'number' &&
                Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
            );

            // Si pas de coords, on tente l'extraction depuis le texte brut.
            const isNearFromText = coords.length === 0 && _isNearFromText(raw, lat, lon, radiusDeg);

            if (isNear || isNearFromText) {
                relevant.push({
                    raw,
                    type: item.airSigmetType || (item.type === 'A' ? 'AIRMET' : 'SIGMET'),
                    hazard: item.hazard || _inferHazard(raw),
                    obs: /OBS|OBSERVED/i.test(raw),
                });
            }
        }

        return relevant;
    } catch (e) {
        console.warn('SIGMET/AIRMET fetch failed:', e);
        return [];
    }
}

/**
 * Fallback : estime si un SIGMET (sans coords) est proche en parsant les
 * coordonnées codées dans le texte (format "N4512 W02030" etc.).
 * @returns {boolean}
 */
function _isNearFromText(raw, lat, lon, radiusDeg) {
    const coords = _extractCoords(raw);
    return coords.some(c =>
        Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
    );
}

/**
 * Extrait les coordonnées (lat, lon) d'un message SIGMET codé.
 * Format typique : "N4512 W02030", "4500N 02030W", "45N 20W".
 * @returns {Array<{lat:number, lon:number}>}
 */
function _extractCoords(raw) {
    const coords = [];
    // Format : (N|S)DD(MM) (E|W)DDD(MM)
    const re = /(\d{2,4})([NS])\s+(\d{2,5})([EW])/g;
    let m;
    while ((m = re.exec(raw)) !== null) {
        const latRaw = m[1];
        const lonRaw = m[3];
        const lat = parseInt(latRaw.slice(0, 2), 10) + (latRaw.length > 2 ? parseInt(latRaw.slice(2), 10) / 60 : 0);
        // Longitude : 2 ou 3 chiffres pour les degrés.
        const lonDegLen = lonRaw.length > 4 ? 3 : 2;
        const lon = parseInt(lonRaw.slice(0, lonDegLen), 10) + (lonRaw.length > lonDegLen ? parseInt(lonRaw.slice(lonDegLen), 10) / 60 : 0);
        coords.push({
            lat: m[2] === 'S' ? -lat : lat,
            lon: m[4] === 'W' ? -lon : lon,
        });
    }
    return coords;
}

/**
 * Infère le type de phénomène depuis le texte brut d'un SIGMET.
 */
function _inferHazard(raw) {
    const r = raw.toUpperCase();
    if (/\bTS\b|\bTHUNDERSTORM|CONVECTIVE/.test(r)) return 'TS';
    if (/\bICE\b|\bICING|\bFZRA/.test(r)) return 'ICE';
    if (/\bTURB|\bTURBULENCE/.test(r)) return 'TURB';
    if (/\bMTN|\bMOUNTAIN WAVE/.test(r)) return 'MTW';
    if (/\bHAIL|\bGR\b/.test(r)) return 'HAIL';
    if (/\bASH|\bVOLCANIC/.test(r)) return 'VA';
    if (/\bIFR|\bCIG|\bVIS/.test(r)) return 'IFR';
    return 'OTHER';
}

/**
 * Évalue les SIGMET/AIRMET et retourne des alertes formatées pour le GO/NO-GO.
 * @param {Array} sigmets Résultat de fetchSigmetAirmet.
 * @returns {Array<{level:string, icon:string, text:string}>}
 */
export function evaluateSigmetAirmet(sigmets) {
    if (!sigmets || sigmets.length === 0) return [];
    const isFr = state.lang === 'fr';
    const results = [];

    const hazardLabels = {
        'TS': { fr: 'Orages (SIGMET)', en: 'Thunderstorms (SIGMET)', icon: 'cloud-lightning', level: 'danger' },
        'ICE': { fr: 'Givrage (SIGMET/AIRMET)', en: 'Icing (SIGMET/AIRMET)', icon: 'snowflake', level: 'danger' },
        'TURB': { fr: 'Turbulence (SIGMET/AIRMET)', en: 'Turbulence (SIGMET/AIRMET)', icon: 'wind', level: 'caution' },
        'MTW': { fr: 'Onde de montagne', en: 'Mountain wave', icon: 'mountain-snow', level: 'caution' },
        'HAIL': { fr: 'Grêle', en: 'Hail', icon: 'cloud-hail', level: 'danger' },
        'VA': { fr: 'Cendres volcaniques', en: 'Volcanic ash', icon: 'cloudy', level: 'danger' },
        'IFR': { fr: 'Conditions IFR (AIRMET)', en: 'IFR conditions (AIRMET)', icon: 'cloud-fog', level: 'caution' },
        'OTHER': { fr: 'Phénomène météo significatif', en: 'Significant weather', icon: 'alert-triangle', level: 'caution' },
    };

    // Dédoublonne par type de phénomène.
    const seenHazards = new Set();
    for (const s of sigmets) {
        if (seenHazards.has(s.hazard)) continue;
        seenHazards.add(s.hazard);

        const lbl = hazardLabels[s.hazard] || hazardLabels.OTHER;
        results.push({
            level: lbl.level,
            icon: lbl.icon,
            text: isFr ? lbl.fr : lbl.en,
        });
    }

    return results;
}
