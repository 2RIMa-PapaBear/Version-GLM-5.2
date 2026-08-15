import { memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { fetchWindsAloft, getWindAtAltitude } from './winds-aloft.js';
import { fetchRouteElevation, evaluateClearance, fetchMultiSegmentElevation } from './route-elevation.js';

const RESERVE_MIN_DAY = 30;
const RESERVE_MIN_NIGHT = 45;

const KT_TO_KMH = 1.852;
const KMH_TO_KT = 1 / KT_TO_KMH;

export function greatCircleDistanceNm(lat1, lon1, lat2, lon2) {

    const R = 3440.065;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function trueCourseDeg(lat1, lon1, lat2, lon2) {
    const toRad = (d) => d * Math.PI / 180;
    const toDeg = (r) => r * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function windCorrection(tcTrueCap, tasKt, wind) {
    if (!wind || tasKt <= 0) {
        return { wcaDeg: 0, driftDeg: 0, gsKt: tasKt, headwindKt: 0, crosswindKt: 0 };
    }
    const toRad = (d) => d * Math.PI / 180;

    const angle = toRad(wind.dir - tcTrueCap);
    const crosswind = wind.speedKt * Math.sin(angle);
    const headwind = wind.speedKt * Math.cos(angle);

    const sinWca = Math.max(-1, Math.min(1, crosswind / tasKt));
    const wcaRad = Math.asin(sinWca);
    const wcaDeg = wcaRad * 180 / Math.PI;

    const gsKt = Math.max(0, tasKt * Math.cos(wcaRad) - headwind);

    return {
        wcaDeg: Math.round(wcaDeg * 10) / 10,
        driftDeg: Math.round(-wcaDeg * 10) / 10,
        gsKt: Math.round(gsKt),
        headwindKt: Math.round(headwind),
        crosswindKt: Math.round(crosswind),
    };
}

export function trueToMagneticHdg(trueHdg, declination) {
    return Math.round((((trueHdg - declination) % 360) + 360) % 360);
}

export function computeFuel(legTimeMin, fuelBurnLph, reserveMin) {
    const tripFuelL = (legTimeMin / 60) * fuelBurnLph;
    const reserveL = (reserveMin / 60) * fuelBurnLph;
    return {
        tripFuelL: Math.round(tripFuelL * 10) / 10,
        reserveL: Math.round(reserveL * 10) / 10,
        totalL: Math.round((tripFuelL + reserveL) * 10) / 10,
    };
}

export async function computeFlightPlan(fromIcao, toIcao, params) {
    if (!fromIcao || !toIcao || fromIcao === toIcao) return null;
    if (!params || typeof params.cruiseAltFt !== 'number') return null;

    const fromApt = getAirportByICAO(fromIcao);
    const toApt = getAirportByICAO(toIcao);
    const fromMemo = memoGet(fromIcao);
    const toMemo = memoGet(toIcao);

    const fromLat = fromMemo?.lat ?? fromApt?.lat ?? null;
    const fromLon = fromMemo?.lon ?? fromApt?.lon ?? null;
    const toLat = toMemo?.lat ?? toApt?.lat ?? null;
    const toLon = toMemo?.lon ?? toApt?.lon ?? null;

    if (fromLat == null || toLat == null) return null;

    const distNm = greatCircleDistanceNm(fromLat, fromLon, toLat, toLon);
    const distKm = Math.round(distNm * KT_TO_KMH);
    const tc = trueCourseDeg(fromLat, fromLon, toLat, toLon);

    const midLat = (fromLat + toLat) / 2;
    const midLon = (fromLon + toLon) / 2;
    const winds = await fetchWindsAloft(midLat, midLon);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    const declination = getDeclinationForIcao(fromIcao);

    const wc = windCorrection(tc, params.tasKt, wind);

    const trueHdg = (tc + wc.wcaDeg + 360) % 360;
    const magHdg = trueToMagneticHdg(trueHdg, declination);

    const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
    const legTimeMin = distNm / gsKt * 60;

    const reserveMin = params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY;
    const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

    const elevProfile = await fetchRouteElevation(fromLat, fromLon, toLat, toLon);
    const clearance = elevProfile
        ? evaluateClearance(elevProfile, params.cruiseAltFt)
        : null;

    return {
        from: { icao: fromIcao, lat: fromLat, lon: fromLon, elevFt: fromApt?.elevation ?? null },
        to: { icao: toIcao, lat: toLat, lon: toLon, elevFt: toApt?.elevation ?? null },
        distanceNm: Math.round(distNm * 10) / 10,
        distanceKm: distKm,
        trueCourse: Math.round(tc),
        declination,
        wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
        windCorrection: wc,
        trueHeading: Math.round(trueHdg),
        magHeading: magHdg,
        groundSpeed: gsKt,
        legTimeMin: Math.round(legTimeMin),
        fuel,
        cruiseAltFt: params.cruiseAltFt,
        tasKt: params.tasKt,
        elevationProfile: elevProfile,
        clearance,
    };
}

export function getDefaultAircraftPerf() {
    const ac = getActiveAircraft();

    return {
        tasKt: ac?._tasKt ?? 110,
        fuelBurnLph: ac?._fuelBurnLph ?? 35,
    };
}

// ====================================================================
// MULTI-WAYPOINTS : plan de vol multi-segments (au lieu d'un A→B unique).
//
// `route` = tableau d'OACI [from, waypoint1, waypoint2, ..., to].
// Rétro-compatible : computeFlightPlan(from,to,params) reste inchangé.
// ====================================================================

// Calcule un plan de vol multi-jambes. Retourne les métriques agrégées + le détail par leg.
// Éluevation : concatène les profils de chaque segment (via fetchMultiSegmentElevation).
export async function computeMultiLegFlightPlan(route, params) {
    if (!Array.isArray(route) || route.length < 2) return null;
    if (!params || typeof params.cruiseAltFt !== 'number') return null;

    // Résout les coordonnées de chaque waypoint (ICAO → lat/lon).
    const waypoints = [];
    for (const icao of route) {
        const apt = getAirportByICAO(icao);
        const memo = memoGet(icao);
        const lat = memo?.lat ?? apt?.lat ?? null;
        const lon = memo?.lon ?? apt?.lon ?? null;
        if (lat == null || lon == null) return null;
        waypoints.push({ icao, lat, lon, elevFt: apt?.elevation ?? null, name: apt?.name || icao });
    }

    const legs = [];
    let totalDistanceNm = 0, totalTimeMin = 0;
    let totalTripFuelL = 0;
    const reserveMin = params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY;

    // Vent moyen sur l'ensemble de la route (point milieu global) — un seul fetch.
    const midIdx = Math.floor((waypoints.length - 1) / 2);
    const midWp = waypoints[midIdx];
    const midNext = waypoints[midIdx + 1] || waypoints[midIdx];
    const midLat = (midWp.lat + midNext.lat) / 2;
    const midLon = (midWp.lon + midNext.lon) / 2;
    const winds = await fetchWindsAloft(midLat, midLon);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    // Déclinaison au point de départ (suffisante pour des routes VFR courtes).
    const declination = getDeclinationForIcao(route[0]);

    for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i], b = waypoints[i + 1];
        const distNm = greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon);
        const tc = trueCourseDeg(a.lat, a.lon, b.lat, b.lon);
        const wc = windCorrection(tc, params.tasKt, wind);
        const trueHdg = (tc + wc.wcaDeg + 360) % 360;
        const magHdg = trueToMagneticHdg(trueHdg, declination);
        const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
        const legTimeMin = distNm / gsKt * 60;
        const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

        legs.push({
            from: { icao: a.icao, lat: a.lat, lon: a.lon },
            to: { icao: b.icao, lat: b.lat, lon: b.lon },
            distanceNm: Math.round(distNm * 10) / 10,
            trueCourse: Math.round(tc),
            windCorrection: wc,
            trueHeading: Math.round(trueHdg),
            magHeading: magHdg,
            groundSpeed: gsKt,
            legTimeMin: Math.round(legTimeMin),
            fuel,
        });

        totalDistanceNm += distNm;
        totalTimeMin += legTimeMin;
        totalTripFuelL += fuel.tripFuelL;
    }

    // Profil d'élévation concaténé sur tous les segments.
    const legCoords = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        legCoords.push([waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon]);
    }
    const elevProfile = await fetchMultiSegmentElevation(legCoords);
    const clearance = elevProfile ? evaluateClearance(elevProfile, params.cruiseAltFt) : null;

    const totalReserveL = (reserveMin / 60) * params.fuelBurnLph;
    return {
        waypoints,
        legs,
        totalDistanceNm: Math.round(totalDistanceNm * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceNm * KT_TO_KMH),
        totalTimeMin: Math.round(totalTimeMin),
        wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
        declination,
        fuel: {
            tripFuelL: Math.round(totalTripFuelL * 10) / 10,
            reserveL: Math.round(totalReserveL * 10) / 10,
            totalL: Math.round((totalTripFuelL + totalReserveL) * 10) / 10,
        },
        cruiseAltFt: params.cruiseAltFt,
        tasKt: params.tasKt,
        elevationProfile: elevProfile,
        clearance,
        isMultiLeg: true,
    };
}

// Wrapper de compatibilité : un plan A→B est un cas particulier de multi-leg.
export async function computeMultiLegFromPair(fromIcao, toIcao, params) {
    return computeMultiLegFlightPlan([fromIcao, toIcao], params);
}

export const RESERVES = { DAY_MIN: RESERVE_MIN_DAY, NIGHT_MIN: RESERVE_MIN_NIGHT };
