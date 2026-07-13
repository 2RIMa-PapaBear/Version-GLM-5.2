/* ================================================================
 * FREEZING LEVEL — Niveau de gel (isotherme 0°C)
 * ================================================================
 *
 * POURQUOI
 * --------
 * Pour un pilote VFR, le niveau où la température atteint 0°C est
 * critique dans deux scénarios :
 *
 *   1. GIVRAGE : si le pilote pénètre un nuage (scud running, vol en
 *      montagne, inversion) alors que la température est ≤ 0°C, le
 *      givrage est quasi certain. L'isotherme 0°C marque la limite
 *      basse du risque.
 *
 *   2. PLAFOND/ SOMMET : si le plafond (BKN/OVC) est au-dessus de
 *      l'isotherme 0°C, les gouttelettes du nuage sont surfondues →
 *      givrage à la traversée.
 *
 *      Ex : plafond 4000 ft, isotherme 0°C à 3500 ft → le bas du nuage
 *      est sous 0°C → givrage probable si on y entre.
 *
 * SOURCE
 * ------
 * Open-Meteo fournit gratuitement le "freezing level height" via
 * l'endpoint forecast. On l'appelle pour les coordonnées du terrain.
 * Open-Meteo supporte CORS nativement → pas de proxy nécessaire.
 *
 * On compare ensuite l'isotherme au plafond METAR courant pour alerter
 * sur le risque de givrage par nuage traversé.
 * ================================================================ */

import { state, getCeiling } from './core.js';
import { memoGet, fetchAvecRelais } from './core.js';
import { getAirportByICAO } from './ui-module.js';

// Cache session : on ne redemande pas l'API si on a déjà la valeur pour
// un terrain donné (elle évolue lentement). TTL de 30 min.
const _cache = new Map();
const TTL_MS = 30 * 60 * 1000;

/**
 * Récupère l'altitude du niveau de gel (isotherme 0°C) pour un terrain.
 * @param {string} icao Code OACI.
 * @returns {Promise<{altFt: number, source: string}|null>}
 *   altFt : altitude de l'isotherme 0°C en pieds (MSL).
 *   null si indisponible.
 */
export async function fetchFreezingLevel(icao) {
    if (!icao) return null;

    // Cache.
    const cached = _cache.get(icao);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.value;

    const memo = memoGet(icao);
    const apt = getAirportByICAO(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) return null;

    try {
        // Open-Meteo : freezing_level_height est l'altitude du 0°C, en mètres,
        // au-dessus du niveau de la mer (geopotential). CORS natif.
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=freezing_level_height&timezone=auto`;
        let data;
        try { data = await fetchAvecRelais(url, 'json'); } catch { return null; }
        if (!data) return null;

        const heightM = data?.current?.freezing_level_height;
        if (typeof heightM !== 'number' || isNaN(heightM)) return null;

        // Conversion mètres → pieds.
        const altFt = Math.round(heightM * 3.28084);

        const value = { altFt, source: 'Open-Meteo' };
        _cache.set(icao, { value, ts: Date.now() });
        return value;
    } catch (e) {
        console.warn('Freezing level fetch failed:', e);
        return null;
    }
}

/**
 * Évalue le risque de givrage en croisant l'isotherme 0°C et le plafond
 * METAR courant.
 *
 * Règle : si le plafond (BKN/OVC le plus bas) est AU-DESSUS de
 * l'isotherme 0°C, le bas du nuage est sous 0°C → givrage probable à
 * la traversée. Plus l'écart est faible, plus le risque est élevé.
 *
 * @param {number} freezingLevelFt Altitude du 0°C (ft MSL).
 * @param {string} nuageStr Chaîne nuageuse du METAR (ex: "BKN040 OVC080").
 * @returns {{level: 'ok'|'caution'|'danger', message: string}|null}
 */
export function evaluateIcingRisk(freezingLevelFt, nuageStr) {
    if (freezingLevelFt == null || isNaN(freezingLevelFt)) return null;
    if (!nuageStr) return null;

    const ceilHund = getCeiling(nuageStr);
    if (ceilHund >= 999) return null; // pas de plafond défini (CAVOK/NSC).

    const ceilingFt = ceilHund * 100;

    // Pas de nuage au-dessus du niveau de gel → pas de risque identifié.
    if (ceilingFt < freezingLevelFt) {
        return {
            level: 'ok',
            message: state.lang === 'fr'
                ? `Niveau de gel à ${Math.round(freezingLevelFt)} ft — sous le plafond`
                : `Freezing level at ${Math.round(freezingLevelFt)} ft — below ceiling`,
        };
    }

    // Plafond au-dessus de l'isotherme 0°C : le bas du nuage est sous 0°C.
    const margin = ceilingFt - freezingLevelFt;
    const isFr = state.lang === 'fr';
    if (margin < 2000) {
        return {
            level: 'danger',
            message: isFr
                ? `GIVRAGE PROBABLE — plafond ${ceilingFt} ft, isotherme 0°C à ${Math.round(freezingLevelFt)} ft`
                : `LIKELY ICING — ceiling ${ceilingFt} ft, freezing level at ${Math.round(freezingLevelFt)} ft`,
        };
    }
    return {
        level: 'caution',
        message: isFr
            ? `Risque de givrage en nuage — isotherme 0°C à ${Math.round(freezingLevelFt)} ft`
            : `Icing risk in cloud — freezing level at ${Math.round(freezingLevelFt)} ft`,
    };
}
