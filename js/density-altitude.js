import { state, I18N, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';

const DEFAULT_DA_THRESHOLD = 3000;

const STORAGE_KEY = 'density-altitude-threshold';

export function getDaThreshold() {
    try {
        const v = parseInt(localStorage.getItem(STORAGE_KEY), 10);
        return isNaN(v) ? DEFAULT_DA_THRESHOLD : v;
    } catch {
        return DEFAULT_DA_THRESHOLD;
    }
}

export function setDaThreshold(ft) {
    try {
        localStorage.setItem(STORAGE_KEY, String(ft));
    } catch {

    }
}

export function pressureAltitude(elevationFt, qnhHpa) {
    return elevationFt + 27 * (1013.25 - qnhHpa);
}

export function isaTemp(altFt) {
    return 15 - 1.98 * (altFt / 1000);
}

export function densityAltitude(elevationFt, qnhHpa, oatC) {
    if (elevationFt == null || qnhHpa == null || oatC == null) return null;
    if (isNaN(elevationFt) || isNaN(qnhHpa) || isNaN(oatC)) return null;

    const pa = pressureAltitude(elevationFt, qnhHpa);
    const isaT = isaTemp(pa);
    const da = pa + 118.8 * (oatC - isaT);
    return { pa, da, isaT, oat: oatC };
}

export function getPerformanceData() {
    const parsed = state.lastParsed;
    if (!parsed) return null;

    const icao = state.requestedIcao || parsed.code;
    const apt = getAirportByICAO(icao);

    const elevationFt = (apt && typeof apt.elevation === 'number')
        ? apt.elevation
        : (memoGet(parsed.code)?.elevation ?? 0);

    let qnh = null;
    let oat = null;

    if (parsed.base) {

        const qnhStr = parsed.base.qnh?.[0]?.val || '';
        const qnhMatch = qnhStr.match(/(\d{3,4})\s*hPa/);
        if (qnhMatch) qnh = parseInt(qnhMatch[1], 10);

        const tempStr = parsed.base.temp?.[0]?.val || '';
        const tempMatch = tempStr.match(/(-?\d+)°C/);
        if (tempMatch) oat = parseInt(tempMatch[1], 10);
    }

    if (qnh === null || oat === null) return null;

    return { elevationFt, qnh, oat, icao };
}

export function evaluateDensityAltitude(da) {
    if (da == null || isNaN(da)) return null;
    const isFr = state.lang === 'fr';
    const threshold = getDaThreshold();

    if (da >= threshold + 1500) {
        return {
            level: 'danger',
            message: isFr
                ? `Densité altitude ÉLEVÉE (${Math.round(da)} ft) — performances fortement dégradées`
                : `HIGH density altitude (${Math.round(da)} ft) — severely degraded performance`,
        };
    }
    if (da >= threshold) {
        return {
            level: 'caution',
            message: isFr
                ? `Densité altitude à surveiller (${Math.round(da)} ft) — vérifiez vos performances`
                : `Density altitude worth watching (${Math.round(da)} ft) — check your performance`,
        };
    }
    return {
        level: 'ok',
        message: isFr
            ? `Densité altitude OK (${Math.round(da)} ft)`
            : `Density altitude OK (${Math.round(da)} ft)`,
    };
}
