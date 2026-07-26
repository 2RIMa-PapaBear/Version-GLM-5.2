import { state, surfaceLabel as _surfaceLabel, SOFT_SURFACES } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { selectBestRunway } from './engine.js';

export const surfaceLabel = _surfaceLabel;

export function isSoftSurface(code) {
    return SOFT_SURFACES.has(code);
}

export function getRunwaySurface(icao, rwyName) {
    const apt = getAirportByICAO(icao);
    if (!apt) return null;

    if (rwyName && apt.runwaySurfaces) {
        return apt.runwaySurfaces[rwyName.toUpperCase()] || null;
    }

    if (apt.runwaySurfaces) {
        const activeName = _resolveActiveRunwayName(apt);
        if (activeName) {
            return apt.runwaySurfaces[activeName] || null;
        }
    }

    return apt.surface || null;
}

export function getActiveRunwaySurfaceInfo(icao) {
    const code = getRunwaySurface(icao);
    if (!code) return null;
    return { code, label: surfaceLabel(code) };
}

function _resolveActiveRunwayName(apt) {
    if (!apt || !Array.isArray(apt.runways) || apt.runways.length === 0) return null;
    const rwyData = selectBestRunway(apt.runways, null, state.forcedRunway);
    return rwyData?.active?.name || null;
}
