import { state } from './core.js';
import { densityAltitude, getPerformanceData } from './density-altitude.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { selectBestRunway } from './engine.js';
import { getRunwaySurface, isSoftSurface, surfaceLabel } from './runway-surface.js';

const DEFAULT_GROUND_ROLL = 830;
const DEFAULT_50FT = 1400;

const FT_TO_M = 0.3048;

const LS_RWY_LEN_PREFIX = 'rwy-length-';

function ftToM(ft) { return Math.round(ft * FT_TO_M); }

export function getRunwayLength(icao) {
    if (!icao) return null;

    const apt = getAirportByICAO(icao);
    if (!apt) return null;

    const activeRwyName = _getActiveRunwayName(apt);
    if (activeRwyName && apt.runwayLengths) {
        const len = apt.runwayLengths[activeRwyName];
        if (typeof len === 'number' && len > 0) return len;
    }

    if (typeof apt.longestRunway === 'number' && apt.longestRunway > 0) {
        return apt.longestRunway;
    }
    return null;
}

export function getActiveRunwayNameForIcao(icao) {
    const apt = getAirportByICAO(icao);
    return _getActiveRunwayName(apt);
}

function _getActiveRunwayName(apt) {
    if (!apt || !Array.isArray(apt.runways) || apt.runways.length === 0) return null;

    const rwyData = selectBestRunway(apt.runways, null, state.forcedRunway);
    return rwyData?.active?.name || null;
}

export function isRunwayLengthAuto(icao) {
    if (!icao) return false;
    try {
        const v = parseInt(localStorage.getItem(LS_RWY_LEN_PREFIX + icao.toUpperCase()), 10);
        if (!isNaN(v) && v > 0) return false;
    } catch {   }
    return true;
}

export function setRunwayLength(icao, ft) {
    if (!icao) return;
    try {
        if (ft == null || isNaN(ft)) {
            localStorage.removeItem(LS_RWY_LEN_PREFIX + icao.toUpperCase());
        } else {
            localStorage.setItem(LS_RWY_LEN_PREFIX + icao.toUpperCase(), String(Math.round(ft)));
        }
    } catch {

    }
}

export function getAircraftRef() {
    const ac = getActiveAircraft();
    return {
        name: ac.name,
        groundRoll: ac.groundRoll,
        fiftyFt: ac.fiftyFt,
        safetyMargin: ac.safetyMargin ?? 20,
    };
}

export function correctedTakeoffDistance(da, opts = {}) {
    const ref = getAircraftRef();

    const effectiveDa = Math.max(0, da);
    const factor = 1 + (effectiveDa / 1000) * 0.10;
    const rollFactor = factor + (effectiveDa / 1000) * 0.02;

    let surfaceFactor = 1;
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;

    if (soft) {

        if (opts.contaminated) surfaceFactor = 1.30;
        else if (opts.wet) surfaceFactor = 1.25;
        else surfaceFactor = 1.15;
    } else if (opts.contaminated) {

        surfaceFactor = 1.10;
    } else if (opts.wet) {

        surfaceFactor = 1.05;
    }

    return {
        groundRoll: Math.round(ref.groundRoll * rollFactor * surfaceFactor),
        fiftyFt: Math.round(ref.fiftyFt * factor),
        factor,
        surfaceFactor,
    };
}

export function evaluateTakeoffPerformance(icao) {
    const perf = getPerformanceData();
    if (!perf) return null;

    const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
    if (!daResult) return null;

    const acRef = getAircraftRef();

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _detectWetFromMetar();

    const corr = correctedTakeoffDistance(daResult.da, { surfaceCode, wet, contaminated });
    const rwyLen = getRunwayLength(icao);
    const isFr = state.lang === 'fr';

    let surfaceNote = '';
    if (corr.surfaceFactor > 1) {
        const surfLbl = surfaceCode ? surfaceLabel(surfaceCode) : '';
        if (isSoftSurface(surfaceCode)) {
            surfaceNote = contaminated
                ? (isFr ? ` (revêtement ${surfLbl} contaminé +${Math.round((corr.surfaceFactor-1)*100)}%)` : ` (${surfLbl} contaminated +${Math.round((corr.surfaceFactor-1)*100)}%)`)
                : wet
                    ? (isFr ? ` (revêtement ${surfLbl} humide +${Math.round((corr.surfaceFactor-1)*100)}%)` : ` (wet ${surfLbl} +${Math.round((corr.surfaceFactor-1)*100)}%)`)
                    : (isFr ? ` (revêtement ${surfLbl} +${Math.round((corr.surfaceFactor-1)*100)}%)` : ` (${surfLbl} +${Math.round((corr.surfaceFactor-1)*100)}%)`);
        } else {
            surfaceNote = isFr
                ? ` (piste humide/contaminée +${Math.round((corr.surfaceFactor-1)*100)}%)`
                : ` (wet/contaminated +${Math.round((corr.surfaceFactor-1)*100)}%)`;
        }
    }

    if (rwyLen == null) {
        return {
            da: Math.round(daResult.da),
            groundRoll: corr.groundRoll,
            fiftyFt: corr.fiftyFt,
            runwayLength: null,
            margin: null,
            level: 'unknown',
            aircraftName: acRef.name,
            surfaceNote,
            message: isFr
                ? `Roulement estimé ${ftToM(corr.groundRoll)} m (DA ${Math.round(daResult.da)} ft)${surfaceNote} — renseignez la longueur de piste`
                : `Est. roll ${ftToM(corr.groundRoll)} m (DA ${Math.round(daResult.da)} ft)${surfaceNote} — set runway length`,
        };
    }

    const margin = rwyLen - corr.fiftyFt;
    const marginPct = (margin / rwyLen) * 100;

    const cautionThreshold = acRef.safetyMargin ?? 20;

    let level;
    if (margin < 0) {
        level = 'danger';
    } else if (marginPct < cautionThreshold) {
        level = 'caution';
    } else {
        level = 'ok';
    }

    const messages = {
        ok: isFr
            ? `Décollage OK — ${acRef.name}: roulement ${ftToM(corr.groundRoll)} m, piste ${ftToM(rwyLen)} m (marge ${ftToM(margin)} m)${surfaceNote}`
            : `Takeoff OK — ${acRef.name}: roll ${ftToM(corr.groundRoll)} m, rwy ${ftToM(rwyLen)} m (margin ${ftToM(margin)} m)${surfaceNote}`,
        caution: isFr
            ? `Marge faible — ${acRef.name}: roulement ${ftToM(corr.groundRoll)} m / ${ftToM(corr.fiftyFt)} m (50ft), piste ${ftToM(rwyLen)} m${surfaceNote}`
            : `Tight margin — ${acRef.name}: roll ${ftToM(corr.groundRoll)} m / ${ftToM(corr.fiftyFt)} m (50ft), rwy ${ftToM(rwyLen)} m${surfaceNote}`,
        danger: isFr
            ? `DÉCOLLAGE CRITIQUE — ${acRef.name}: ${ftToM(corr.fiftyFt)} m nécessaires (50ft), piste ${ftToM(rwyLen)} m (manque ${ftToM(Math.abs(margin))} m)${surfaceNote}`
            : `CRITICAL TAKEOFF — ${acRef.name}: ${ftToM(corr.fiftyFt)} m needed (50ft), rwy ${ftToM(rwyLen)} m (short by ${ftToM(Math.abs(margin))} m)${surfaceNote}`,
    };

    return {
        da: Math.round(daResult.da),
        groundRoll: corr.groundRoll,
        fiftyFt: corr.fiftyFt,
        runwayLength: rwyLen,
        margin: Math.round(margin),
        level,
        surfaceNote,
        surfaceFactor: corr.surfaceFactor,
        message: messages[level],
    };
}

function _detectWetFromMetar() {
    const parsed = state.lastParsed;
    if (!parsed || !parsed.base) return { wet: false, contaminated: false };

    const raw = (typeof document !== 'undefined'
        ? document.getElementById('tafInput')?.value
        : '') || '';
    const rawUpper = raw.toUpperCase();
    const tempsStr = (parsed.base.temps?.[0]?.val || '').toLowerCase();

    const has = (code, translations) => {

        if (new RegExp(`(^|\\s)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(rawUpper)) return true;
        return translations.some(t => tempsStr.includes(t));
    };

    const contaminated =
        has('+RA', ['pluie forte']) || has('SHRA', ['averse']) ||
        has('SN', ['neige']) || has('SG', ['neige en grains']) ||
        has('PL', ['granules de glace']) || has('FZRA', ['pluie se congelant', 'pluie verglaçante']) ||
        has('FZDZ', ['bruine verglaçante', 'bruine se congelant']) || has('GR', ['grêle']) || has('GS', ['grésil']);

    const wet = !contaminated && (
        has('RA', ['pluie']) || has('DZ', ['bruine']) || has('BR', ['brume'])
    );

    return { wet, contaminated };
}
