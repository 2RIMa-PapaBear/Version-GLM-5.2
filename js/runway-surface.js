/* ================================================================
 * RUNWAY SURFACE — Traduction des codes de revêtement de piste
 * ================================================================
 *
 * Les codes (ASP, GRE, CON, GRS...) proviennent de SurfaceTypes.json
 * (standard FAA/OurAirports). Ce module les traduit en texte lisible
 * FR/EN et fournit des helpers pour récupérer le revêtement de la
 * piste active du terrain courant.
 *
 * Intérêt VFR : le revêtement conditionne les performances (herbe
 * mouillée = roulement +30 %) et la praticabilité (ULM sur goudron,
 * jet sur herbe...).
 * ================================================================ */

import { state, surfaceLabel as _surfaceLabel, SOFT_SURFACES } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { selectBestRunway } from './engine.js';

// Réexporte les helpers de traduction depuis core (point d'entrée unique).
export const surfaceLabel = _surfaceLabel;

/**
 * Indique si le revêtement est "mou" (herbe, gravier, terre...) — sensible
 * à l'humidité et à l'épaisseur. Sert à alerter sur l'allongement du
 * roulement par temps de pluie.
 * @param {string} code
 * @returns {boolean}
 */
export function isSoftSurface(code) {
    return SOFT_SURFACES.has(code);
}

/**
 * Récupère le code de revêtement de la piste active d'un terrain.
 * @param {string} icao
 * @param {string} [rwyName] Numéro de piste (ex: '08L'). Si omis, prend
 *                           la piste active (state.forcedRunway ou suggérée).
 * @returns {string|null} Code (ex: 'ASP'), ou null si inconnu.
 */
export function getRunwaySurface(icao, rwyName) {
    const apt = getAirportByICAO(icao);
    if (!apt) return null;

    // Si un numéro de piste est fourni, on l'utilise directement.
    if (rwyName && apt.runwaySurfaces) {
        return apt.runwaySurfaces[rwyName.toUpperCase()] || null;
    }

    // Sinon, on résout la piste active via la rose des vents.
    if (apt.runwaySurfaces) {
        const activeName = _resolveActiveRunwayName(apt);
        if (activeName) {
            return apt.runwaySurfaces[activeName] || null;
        }
    }
    // Fallback : surface dominante du terrain.
    return apt.surface || null;
}

/**
 * Récupère le revêtement et son libellé pour la piste active.
 * @param {string} icao
 * @returns {{code: string, label: string}|null}
 */
export function getActiveRunwaySurfaceInfo(icao) {
    const code = getRunwaySurface(icao);
    if (!code) return null;
    return { code, label: surfaceLabel(code) };
}

/**
 * Résout le nom de la piste active via selectBestRunway.
 * engine.js n'importe pas runway-surface → pas de cycle.
 */
function _resolveActiveRunwayName(apt) {
    if (!apt || !Array.isArray(apt.runways) || apt.runways.length === 0) return null;
    const rwyData = selectBestRunway(apt.runways, null, state.forcedRunway);
    return rwyData?.active?.name || null;
}
