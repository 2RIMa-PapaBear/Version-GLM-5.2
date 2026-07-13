/* ================================================================
 * FLIGHT PLANNER — Calculateur de navigation VFR
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Le module "killer" pour la préparation de navigation : à partir de
 * la route (départ → destination), du vent en altitude, et des
 * performances de l'avion (vitesse croisière, consommation), calcule :
 *
 *   - La distance et le cap vrai de la route (orthodromique simplifiée).
 *   - Le cap magnétique (corrigé de la déclinaison).
 *   - La dérive due au vent traversier.
 *   - La vitesse sol (ground speed) et le temps de vol estimé (ETA).
 *   - Le carburant total requis, avec la réserve légale (30 min jour /
 *     45 min nuit VFR).
 *
 * Ce sont exactement les calculs du "log de nav" que le pilote fait à
 * la main — sauf qu'ici ils sont automatisés à partir des données live.
 *
 * ARCHITECTURE
 * ------------
 * Les fonctions de calcul pures (distance, cap, dérive, GS, fuel) sont
 * séparées de l'orchestration réseau (computeFlightPlan) pour être
 * testées unitairement sans mock réseau.
 *
 * ⚠️ AIDE À LA DÉCISION — Le POH et la checkout pré-vol restent la
 * référence légale pour les performances réelles.
 * ================================================================ */

import { memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { fetchWindsAloft, getWindAtAltitude } from './winds-aloft.js';
import { fetchRouteElevation, evaluateClearance } from './route-elevation.js';

// Réserve légale VFR (minutes) — EASA / FCL.
const RESERVE_MIN_DAY = 30;
const RESERVE_MIN_NIGHT = 45;

// Nœuds → km/h et réciproque.
const KT_TO_KMH = 1.852;
const KMH_TO_KT = 1 / KT_TO_KMH;

// ----------------------------------------------------------------
// Fonctions de calcul pures (testables sans réseau)
// ----------------------------------------------------------------

/**
 * Distance orthodromique (grand cercle) entre deux points, en NM.
 * Formule de Haversine — suffisante pour des distances VFR (< 500 NM).
 * @returns {number} Distance en nautiques.
 */
export function greatCircleDistanceNm(lat1, lon1, lat2, lon2) {
    // Rayon terrestre moyen en NM.
    const R = 3440.065;
    const toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Cap vrai (bearing) initial de la route départ → destination.
 * @returns {number} Cap en degrés vrais (0-359).
 */
export function trueCourseDeg(lat1, lon1, lat2, lon2) {
    const toRad = (d) => d * Math.PI / 180;
    const toDeg = (r) => r * 180 / Math.PI;
    const φ1 = toRad(lat1), φ2 = toRad(lat2);
    const Δλ = toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Calcule la dérive angulaire et la vitesse sol pour un vent donné.
 *
 * Triangle des vitesses :
 *   - La direction "d'où vient le vent" est convertie en direction
 *     "vers laquelle souffle le vent" (WCA = wind correction angle).
 *   - La composante traversière du vent donne la dérive angulaire :
 *         WCA = asin( windSpeed * sin(windFrom − TC) / TAS )
 *   - La composante de face/arrière donne la vitesse sol :
 *         GS = sqrt(TAS² − crosswind²) − headwind   (signé)
 *
 * @param {number} tcTrueCap Cap vrai de la route (°).
 * @param {number} tasKt     Vitesse air vraie (kt).
 * @param {{speedKt:number, dir:number}} wind Vent (dir = d'où il vient, ° vrais).
 * @returns {{wcaDeg:number, driftDeg:number, gsKt:number, headwindKt:number, crosswindKt:number}}
 *   - wcaDeg       : angle de correction vent (positif = virer à droite).
 *   - driftDeg     : dérive équivalente (signe opposé pour repère pilote).
 *   - gsKt         : vitesse sol (kt).
 *   - headwindKt   : composante de face (positive = de face, ralentit).
 *   - crosswindKt  : composante travers (positive = vent de la droite).
 */
export function windCorrection(tcTrueCap, tasKt, wind) {
    if (!wind || tasKt <= 0) {
        return { wcaDeg: 0, driftDeg: 0, gsKt: tasKt, headwindKt: 0, crosswindKt: 0 };
    }
    const toRad = (d) => d * Math.PI / 180;
    // Angle entre la route et la direction d'où vient le vent.
    const angle = toRad(wind.dir - tcTrueCap);
    const crosswind = wind.speedKt * Math.sin(angle);  // >0 = de la droite
    const headwind = wind.speedKt * Math.cos(angle);   // >0 = de face

    // Angle de correction vent (limité par ±90° : si vent > TAS, impossible).
    const sinWca = Math.max(-1, Math.min(1, crosswind / tasKt));
    const wcaRad = Math.asin(sinWca);
    const wcaDeg = wcaRad * 180 / Math.PI;

    // Vitesse sol : projection du vecteur TAS sur la route, moins le vent de face.
    // Méthode classique : GS = TAS*cos(WCA) − headwind.
    const gsKt = Math.max(0, tasKt * Math.cos(wcaRad) - headwind);

    return {
        wcaDeg: Math.round(wcaDeg * 10) / 10,
        driftDeg: Math.round(-wcaDeg * 10) / 10,  // dérive = sens pilote
        gsKt: Math.round(gsKt),
        headwindKt: Math.round(headwind),
        crosswindKt: Math.round(crosswind),
    };
}

/**
 * Convertit un cap vrai en cap magnétique.
 * Mag = Vrai − Déclinaison.
 * @param {number} trueHdg Cap vrai (°).
 * @param {number} declination Déclinaison magnétique (°, E positive).
 * @returns {number} Cap magnétique (°).
 */
export function trueToMagneticHdg(trueHdg, declination) {
    return Math.round((((trueHdg - declination) % 360) + 360) % 360);
}

/**
 * Calcule le carburant requis pour un vol.
 * @param {number} legTimeMin   Temps de vol de la jambe (minutes).
 * @param {number} fuelBurnLph  Consommation (litres/heure).
 * @param {number} reserveMin   Réserve légale (minutes, 30 ou 45).
 * @returns {{tripFuelL:number, reserveL:number, totalL:number}}
 */
export function computeFuel(legTimeMin, fuelBurnLph, reserveMin) {
    const tripFuelL = (legTimeMin / 60) * fuelBurnLph;
    const reserveL = (reserveMin / 60) * fuelBurnLph;
    return {
        tripFuelL: Math.round(tripFuelL * 10) / 10,
        reserveL: Math.round(reserveL * 10) / 10,
        totalL: Math.round((tripFuelL + reserveL) * 10) / 10,
    };
}

// ----------------------------------------------------------------
// Orchestration : assemble toutes les données pour un plan complet
// ----------------------------------------------------------------

/**
 * Paramètres de vol saisis par le pilote.
 * @typedef {Object} FlightParams
 * @property {number} cruiseAltFt   Altitude de croisière (ft MSL).
 * @property {number} tasKt         Vitesse air vraie (kt).
 * @property {number} fuelBurnLph   Consommation carburant (L/h).
 * @property {boolean} isNight      Vol de nuit (réserve 45 min au lieu de 30).
 */

/**
 * Calcule un plan de vol complet entre deux terrains.
 *
 * @param {string} fromIcao Code OACI départ.
 * @param {string} toIcao   Code OACI destination.
 * @param {FlightParams} params Paramètres de vol.
 * @returns {Promise<Object|null>} Plan de vol structuré, ou null si données manquantes.
 */
export async function computeFlightPlan(fromIcao, toIcao, params) {
    if (!fromIcao || !toIcao || fromIcao === toIcao) return null;
    if (!params || typeof params.cruiseAltFt !== 'number') return null;

    // Coordonnées des terrains.
    const fromApt = getAirportByICAO(fromIcao);
    const toApt = getAirportByICAO(toIcao);
    const fromMemo = memoGet(fromIcao);
    const toMemo = memoGet(toIcao);

    const fromLat = fromMemo?.lat ?? fromApt?.lat ?? null;
    const fromLon = fromMemo?.lon ?? fromApt?.lon ?? null;
    const toLat = toMemo?.lat ?? toApt?.lat ?? null;
    const toLon = toMemo?.lon ?? toApt?.lon ?? null;

    if (fromLat == null || toLat == null) return null;

    // ---- Distance et cap vrai ----
    const distNm = greatCircleDistanceNm(fromLat, fromLon, toLat, toLon);
    const distKm = Math.round(distNm * KT_TO_KMH);
    const tc = trueCourseDeg(fromLat, fromLon, toLat, toLon);

    // ---- Vent en altitude (au milieu de la route) ----
    const midLat = (fromLat + toLat) / 2;
    const midLon = (fromLon + toLon) / 2;
    const winds = await fetchWindsAloft(midLat, midLon);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    // ---- Déclinaison magnétique (cache, sinon 0) ----
    // On prend celle du terrain de départ (suffisante pour une nav VFR).
    const declination = getDeclinationForIcao(fromIcao);

    // ---- Correction vent ----
    const wc = windCorrection(tc, params.tasKt, wind);

    // ---- Caps ----
    const trueHdg = (tc + wc.wcaDeg + 360) % 360;
    const magHdg = trueToMagneticHdg(trueHdg, declination);

    // ---- Temps de vol ----
    const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
    const legTimeMin = distNm / gsKt * 60;

    // ---- Carburant ----
    const reserveMin = params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY;
    const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

    // ---- Profil d'élévation (non bloquant) ----
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

/**
 * Récupère les valeurs par défaut de l'avion actif (TAS, conso).
 * Le POH reste la référence ; on propose juste des valeurs de départ
 * typiques selon le type d'avion (C172 ≈ 110 kt / 35 L·h⁻¹).
 * @returns {{tasKt:number, fuelBurnLph:number}}
 */
export function getDefaultAircraftPerf() {
    const ac = getActiveAircraft();
    // Valeurs typiques par défaut, affinables par le pilote dans l'UI.
    return {
        tasKt: ac?._tasKt ?? 110,
        fuelBurnLph: ac?._fuelBurnLph ?? 35,
    };
}

export const RESERVES = { DAY_MIN: RESERVE_MIN_DAY, NIGHT_MIN: RESERVE_MIN_NIGHT };
