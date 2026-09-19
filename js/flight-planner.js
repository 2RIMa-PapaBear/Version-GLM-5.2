import { memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { fetchWindsAloft, getWindAtAltitude } from './winds-aloft.js';
import { fetchRouteElevation, evaluateClearance, fetchMultiSegmentElevation } from './route-elevation.js';
import { computeRouteAirspaces, routeBbox } from './airspace-profile.js';
import { fetchAirspacesForBbox } from './airspaces.js';
import { loadFreqSources, getServiceFreq } from './freq-sia.js';
import { getSiaAirfield } from './sia-data.js';
import { _distToSegmentNm } from './alternates.js';

// Élévation OFFICIELLE d'un terrain en ft (SIA AdRefAltFt, repli base locale
// openAIP déjà convertie) — pour ancrer les extrémités du profil d'élévation
// au niveau réel du sol des aérodromes (la maille Open-Meteo peut en différer).
function _officialElevFt(icao, apt = null) {
    return getSiaAirfield(icao)?.elevFt ?? apt?.elevation ?? null;
}

// Zones aériennes traversées par la route (rectangles d'altitude du profil
// d'élévation) : bbox du corridor → items openAIP → groupes. Non bloquant —
// null silencieux si l'API/cache est indisponible. Une correction manuelle
// de fréquence (freq-overrides.json, par INDICATIF) prime sur openAIP.
async function loadRouteAirspaces(elevProfile, cruiseAltFt) {
    try {
        if (!elevProfile?.points?.length) return null;
        const bbox = routeBbox(elevProfile.points);
        if (!bbox) return null;
        const items = await fetchAirspacesForBbox(bbox[0], bbox[1], bbox[2], bbox[3]);
        if (!items?.length) return null;
        loadFreqSources();
        const groups = computeRouteAirspaces(elevProfile.points, items, { cruiseAltFt });
        for (const g of groups || []) {
            const fixed = getServiceFreq(g.name);
            if (fixed) g.freq = fixed;
        }
        return groups;
    } catch { return null; }
}

const RESERVE_MIN_DAY = 30;
const RESERVE_MIN_NIGHT = 45;

// Forfaits AU SOL du devis carburant : roulage départ et arrivée (5 min mini
// chacun) + intégration à destination. La branche dégagement ajoute aussi
// son intégration (remise de gaz → navigation → intégration → atterrissage).
export const TAXI_MIN_DEP = 5;
export const TAXI_MIN_ARR = 5;
export const INTEGRATION_MIN = 5;
const GROUND_MIN = TAXI_MIN_DEP + TAXI_MIN_ARR + INTEGRATION_MIN;

// Couloir de prise en compte des obstacles SIA autour de la polyligne (A6) —
// 0,5 NM couvre largement la bande réglementaire de 600 m autour de la route.
const OBSTACLE_CORRIDOR_NM = 0.5;

/**
 * Obstacles SIA (base AIXM officielle) à moins de OBSTACLE_CORRIDOR_NM de la
 * polyligne de route, positionnés le long du trajet (frac 0-1) : leur sommet
 * (topFt, AMSL) alimente la marge mini (evaluateClearance) et la Z sécu du
 * log. Non bloquant : null si la base n'est pas disponible.
 * @returns {Promise<Array<{frac:number, topFt:number, hFt:number|null,
 *   type:string, name:string, distNm:number}>|null>}
 */
async function _routeObstacles(elevProfile) {
    try {
        if (!elevProfile?.points?.length) return null;
        const pts = elevProfile.points.filter(p => Number.isFinite(p.lat) && Number.isFinite(p.lon));
        if (pts.length < 2) return null;
        const mod = await import('./radio-points.js');
        const data = await mod.loadObstacles();
        if (!data?.obstacles?.length) return null;

        // Longueurs cumulées des segments du profil (NM) → frac global.
        const cumNm = [0];
        let minLat = 90, maxLat = -90, minLon = 180, maxLon = -180;
        for (let i = 0; i < pts.length; i++) {
            if (i) cumNm.push(cumNm[i - 1] + greatCircleDistanceNm(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
            if (pts[i].lat < minLat) minLat = pts[i].lat;
            if (pts[i].lat > maxLat) maxLat = pts[i].lat;
            if (pts[i].lon < minLon) minLon = pts[i].lon;
            if (pts[i].lon > maxLon) maxLon = pts[i].lon;
        }
        const totalNm = cumNm[cumNm.length - 1] || 1;

        const out = [];
        for (const o of data.obstacles) {
            if (o.elevFt == null) continue;
            if (o.lat < minLat - 0.02 || o.lat > maxLat + 0.02
                || o.lon < minLon - 0.03 || o.lon > maxLon + 0.03) continue;
            let best = null;
            for (let i = 0; i < pts.length - 1; i++) {
                const d = _distToSegmentNm(o, pts[i], pts[i + 1]);
                if (!best || d.nm < best.nm) best = { nm: d.nm, atdNm: cumNm[i] + d.atdNm };
            }
            if (best && best.nm <= OBSTACLE_CORRIDOR_NM) {
                out.push({
                    frac: Math.min(1, Math.max(0, best.atdNm / totalNm)),
                    topFt: o.elevFt, hFt: o.hFt ?? null,
                    type: o.type || '', name: o.name || '',
                    distNm: Math.round(best.nm * 10) / 10,
                });
            }
        }
        out.sort((a, b) => a.frac - b.frac);
        return out.length ? out : null;
    } catch { return null; }
}

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

/**
 * Index d'insertion (0..wps.length) d'un nouveau waypoint qui minimise la
 * distance totale de la route (insertion la moins coûteuse) : on teste chaque
 * slot de la chaîne Départ → étapes existantes → Destination et on garde le
 * plus court trajet. L'ordre des étapes déjà saisies est préservé.
 *
 * @param {string} depIcao   code du départ
 * @param {string[]} wps     étapes existantes (codes OACI, ordre conservé)
 * @param {string} destIcao  code de la destination
 * @param {string} newIcao   waypoint à insérer
 * @param {(code:string)=>{lat:number,lon:number}|null} coordsOf
 *   résolveur de coordonnées (base locale + mémo).
 * @returns {number|null} index d'insertion optimal, ou null si une
 *   coordonnée manque (l'appelant ajoutera alors en fin de liste).
 */
export function cheapestWaypointInsertion(depIcao, wps, destIcao, newIcao, coordsOf) {
    const dep = coordsOf(depIcao);
    const dest = coordsOf(destIcao);
    const x = coordsOf(newIcao);
    const legCoords = wps.map(coordsOf);
    if (!dep || !dest || !x || legCoords.some(c => !c)) return null;

    const legLen = (seq) => {
        let s = 0;
        for (let i = 0; i < seq.length - 1; i++) {
            s += greatCircleDistanceNm(seq[i].lat, seq[i].lon, seq[i + 1].lat, seq[i + 1].lon);
        }
        return s;
    };

    let bestIdx = null;
    let bestLen = Infinity;
    for (let i = 0; i <= wps.length; i++) {
        const seq = [dep, ...legCoords.slice(0, i), x, ...legCoords.slice(i), dest];
        const len = legLen(seq);
        if (len < bestLen) { bestLen = len; bestIdx = i; }
    }
    return bestIdx;
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

export function computeFuel(legTimeMin, fuelBurnLph, reserveMin, groundMin = 0) {
    const tripFuelL = (legTimeMin / 60) * fuelBurnLph;
    const reserveL = (reserveMin / 60) * fuelBurnLph;
    const groundL = (groundMin / 60) * fuelBurnLph;
    return {
        tripFuelL: Math.round(tripFuelL * 10) / 10,
        reserveL: Math.round(reserveL * 10) / 10,
        groundMin: Math.round(groundMin),
        groundL: Math.round(groundL * 10) / 10,
        totalL: Math.round((tripFuelL + reserveL + groundL) * 10) / 10,
    };
}

/**
 * Branche DÉGAGEMENT du devis carburant (arrêté du 24/07/1991 : carburant
 * pour rejoindre la destination, PUIS le terrain de dégagement, PLUS la
 * réserve 30/45 min). Distance depuis la DESTINATION vers le dégagement, à
 * la vitesse sol de référence du plan (vent du plan pris en compte) ; le
 * temps inclut l'INTÉGRATION à l'arrivée au dégagement. Sans GS de
 * référence explotable, seule la distance est rendue.
 * Fonction pure — testée sous Node.
 * @returns {{distNm:number, timeMin:number|null, fuelL:number|null}|null}
 */
export function computeDiversionLeg(destLat, destLon, divLat, divLon, fuelBurnLph, refGsKt) {
    if (!Number.isFinite(destLat) || !Number.isFinite(destLon)
        || !Number.isFinite(divLat) || !Number.isFinite(divLon)) return null;
    const distNm = greatCircleDistanceNm(destLat, destLon, divLat, divLon);
    const out = { distNm: Math.round(distNm * 10) / 10, timeMin: null, fuelL: null };
    if (!(refGsKt > 0) || !(fuelBurnLph > 0)) return out;
    const timeMin = distNm / refGsKt * 60 + INTEGRATION_MIN;
    out.timeMin = Math.round(timeMin);
    out.fuelL = Math.round(timeMin / 60 * fuelBurnLph * 10) / 10;
    return out;
}

// Résout l'ICAO du dégagement (base locale + mémo) et calcule sa branche.
// Retourne { icao, distNm, timeMin, fuelL } ou null (ICAO inconnu).
function _diversionFor(toLat, toLon, diversionIcao, fuelBurnLph, refGsKt) {
    const code = String(diversionIcao || '').toUpperCase();
    if (!code) return null;
    const apt = getAirportByICAO(code);
    const memo = memoGet(code);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) return null;
    const d = computeDiversionLeg(toLat, toLon, lat, lon, fuelBurnLph, refGsKt);
    return d ? { icao: code, ...d } : null;
}

// Enrichit le bloc fuel du plan avec la branche dégagement : diversionL et
// totalL = trajet + dégagement + réserve (les autres champs inchangés).
function _withDiversion(fuel, diversion) {
    if (!diversion?.fuelL) return { ...fuel, diversion: diversion ?? null, diversionL: 0 };
    return {
        ...fuel,
        diversion,
        diversionL: diversion.fuelL,
        totalL: Math.round((fuel.totalL + diversion.fuelL) * 10) / 10,
    };
}

// Enrichit le bloc fuel avec le carburant INUTILISABLE du manuel de vol
// (19/09, retour pilote — « pareil pour les navigations ») : jamais
// consommable mais présent dans le réservoir, le total requis l'inclut.
// Champ unusableL exposé pour les devis écran / dossier / PDF.
// Pure — exportée pour les tests.
export function withUnusableFuel(fuel, unusableFuelL) {
    const unusableL = Math.round(((unusableFuelL > 0) ? unusableFuelL : 0) * 10) / 10;
    if (!(unusableL > 0)) return { ...fuel, unusableL: 0 };
    return {
        ...fuel,
        unusableL,
        totalL: Math.round((fuel.totalL + unusableL) * 10) / 10,
    };
}

/**
 * Projet « DEUX ÉTAPES SANS PLEIN » : minimum réglementaire de la 2ᵉ étape —
 * roulage ×2 + intégration (forfaits au sol) + navigation + réserve finale.
 * Navigation SANS VENT au TAS du plan (le pilote majore via sa réserve
 * perso) ; étape 2 LOCALE (durée saisie) → l'appelant passe la réserve
 * locale 10 min. Pas de dégagement propre à l'étape 2 (v1, affiché).
 * Fonction pure — testée sous Node.
 * @returns {{isLocal:boolean, navTimeMin:number, navL:number, groundMin:number,
 *   groundL:number, reserveMin:number, reserveL:number, totalL:number}|null}
 */
export function computeLeg2Fuel({ distNm = null, localMin = null, tasKt, fuelBurnLph, reserveMin }) {
    if (!(tasKt > 0) || !(fuelBurnLph > 0)) return null;
    const isLocal = !(distNm > 0);
    const navTimeMin = isLocal ? localMin : distNm / tasKt * 60;
    if (!(navTimeMin > 0)) return null;
    const navL = navTimeMin / 60 * fuelBurnLph;
    const groundL = GROUND_MIN / 60 * fuelBurnLph;
    const reserveL = reserveMin / 60 * fuelBurnLph;
    return {
        isLocal,
        navTimeMin: Math.round(navTimeMin),
        navL: Math.round(navL * 10) / 10,
        groundMin: GROUND_MIN,
        groundL: Math.round(groundL * 10) / 10,
        reserveMin,
        reserveL: Math.round(reserveL * 10) / 10,
        totalL: Math.round((navL + groundL + reserveL) * 10) / 10,
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

    // Réserve EFFECTIVE : 30/45 min réglementaires + majoration personnelle
    // de l'avion actif (flotte) — le devis et le PDF affichent cette valeur.
    const reserveMin = (params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY)
        + (Number.isFinite(params.reserveExtraMin) ? Math.max(0, Math.min(60, params.reserveExtraMin)) : 0);
    const fuel = withUnusableFuel(_withDiversion(
        { ...computeFuel(legTimeMin, params.fuelBurnLph, reserveMin, GROUND_MIN), reserveMin },
        _diversionFor(toLat, toLon, params.diversionIcao, params.fuelBurnLph, gsKt)), params.unusableFuelL);

    const elevProfile = await fetchRouteElevation(fromLat, fromLon, toLat, toLon, null,
        [_officialElevFt(fromIcao, fromApt), _officialElevFt(toIcao, toApt)]);
    const routeObstacles = await _routeObstacles(elevProfile);
    const clearance = elevProfile
        ? evaluateClearance(elevProfile, params.cruiseAltFt, 1000, routeObstacles)
        : null;
    const routeAirspaces = await loadRouteAirspaces(elevProfile, params.cruiseAltFt);

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
        obstacles: routeObstacles,
        clearance,
        routeAirspaces,
    };
}

export function getDefaultAircraftPerf() {
    const ac = getActiveAircraft();

    // Vitesse/conso de croisière des caractéristiques de l'avion (flotte).
    return {
        tasKt: ac?.cruiseSpeedKt ?? 110,
        fuelBurnLph: ac?.fuelBurnLph ?? 35,
        reserveExtraMin: ac?.reserveExtraMin ?? 0,
        unusableFuelL: ac?.unusableFuelL ?? 0,
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
        waypoints.push({ icao, lat, lon, elevFt: _officialElevFt(icao, apt), name: apt?.name || icao });
    }

    const legs = [];
    let totalDistanceNm = 0, totalTimeMin = 0;
    let totalTripFuelL = 0;
    const reserveMin = (params.isNight ? RESERVE_MIN_NIGHT : RESERVE_MIN_DAY)
        + (Number.isFinite(params.reserveExtraMin) ? Math.max(0, Math.min(60, params.reserveExtraMin)) : 0);

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

    // Profil d'élévation concaténé sur tous les segments, ancré aux élévations
    // officielles des terrains de la route (départ, étapes, arrivée).
    const legCoords = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        legCoords.push([waypoints[i].lat, waypoints[i].lon, waypoints[i + 1].lat, waypoints[i + 1].lon]);
    }
    const elevProfile = await fetchMultiSegmentElevation(legCoords, waypoints.map(w => w.elevFt));
    const routeObstacles = await _routeObstacles(elevProfile);
    const clearance = elevProfile ? evaluateClearance(elevProfile, params.cruiseAltFt, 1000, routeObstacles) : null;
    const routeAirspaces = await loadRouteAirspaces(elevProfile, params.cruiseAltFt);

    const totalReserveL = (reserveMin / 60) * params.fuelBurnLph;
    // Forfaits au sol (roulage ×2 + intégration) : une seule fois pour toute
    // la navigation, pas par tronçon.
    const groundL = (GROUND_MIN / 60) * params.fuelBurnLph;
    // Branche dégagement : depuis la DESTINATION (dernier waypoint), à la GS
    // moyenne réelle du plan (totalDistance / temps total — vent intégré).
    const dest = waypoints[waypoints.length - 1];
    const avgGsKt = totalTimeMin > 0 ? totalDistanceNm / (totalTimeMin / 60) : 0;
    const diversion = _diversionFor(dest.lat, dest.lon, params.diversionIcao, params.fuelBurnLph, avgGsKt);
    const fuel = withUnusableFuel(_withDiversion({
        tripFuelL: Math.round(totalTripFuelL * 10) / 10,
        reserveL: Math.round(totalReserveL * 10) / 10,
        groundMin: GROUND_MIN,
        groundL: Math.round(groundL * 10) / 10,
        totalL: Math.round((totalTripFuelL + totalReserveL + groundL) * 10) / 10,
        reserveMin,
    }, diversion), params.unusableFuelL);
    return {
        waypoints,
        legs,
        totalDistanceNm: Math.round(totalDistanceNm * 10) / 10,
        totalDistanceKm: Math.round(totalDistanceNm * KT_TO_KMH),
        totalTimeMin: Math.round(totalTimeMin),
        wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
        declination,
        fuel,
        cruiseAltFt: params.cruiseAltFt,
        tasKt: params.tasKt,
        elevationProfile: elevProfile,
        obstacles: routeObstacles,
        clearance,
        routeAirspaces,
        isMultiLeg: true,
    };
}

// Wrapper de compatibilité : un plan A→B est un cas particulier de multi-leg.
export async function computeMultiLegFromPair(fromIcao, toIcao, params) {
    return computeMultiLegFlightPlan([fromIcao, toIcao], params);
}

export const RESERVES = { DAY_MIN: RESERVE_MIN_DAY, NIGHT_MIN: RESERVE_MIN_NIGHT };
