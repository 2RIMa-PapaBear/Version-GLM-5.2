import { memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { fetchWindsAloft, fetchWindsAloftMulti, getWindAtAltitude, weightedMeanWind } from './winds-aloft.js';
import { fetchRouteElevation, evaluateClearance, fetchMultiSegmentElevation, _greatCirclePoints } from './route-elevation.js';
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

/** Profil de REPLI « sans relief » (20/09, retour pilote) : quand le service
 *  d'élévation ne répond pas (quota Open-Meteo saturé…), le profil reste
 *  AFFICHÉ — interpolation linéaire entre les élévations OFFICIELLES des
 *  terrains de la route (les lat/lon suivent la ligne entre terrains, pour
 *  que les zones aériennes traversées se calculent quand même), drapeau
 *  noTerrain pour le bandeau de panne écran + PDF. La marge de
 *  franchissement, elle, n'est JAMAIS calculée sur ce repli. Exporté pour
 *  les tests. */
export function _fallbackProfile(anchors) {
    const ok = (anchors || []).filter(a => Number.isFinite(a?.lat) && Number.isFinite(a?.lon));
    if (ok.length < 2) ok.push({ ...ok[0] });
    const PER_SEG = 8;
    const points = [];
    let distKm = 0;
    for (let s = 0; s < ok.length - 1; s++) {
        const a = ok[s], b = ok[s + 1];
        distKm += greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon) * 1.852;
        for (let i = 0; i < PER_SEG; i++) {
            const t = i / PER_SEG;
            points.push({
                frac: null,   // posé après la boucle (0 → 1 sur le total)
                lat: a.lat + (b.lat - a.lat) * t,
                lon: a.lon + (b.lon - a.lon) * t,
                elevFt: Math.round((a.elevFt ?? 0) + ((b.elevFt ?? 0) - (a.elevFt ?? 0)) * t),
            });
        }
    }
    const last = ok[ok.length - 1];
    points.push({ frac: 1, lat: last.lat, lon: last.lon, elevFt: Math.round(last.elevFt ?? 0) });
    points.forEach((p, i) => { p.frac = i / (points.length - 1); });
    const elevs = points.map(p => p.elevFt);
    return {
        points,
        minFt: Math.min(...elevs),
        maxFt: Math.max(...elevs),
        distTotalKm: Math.round(distKm),
        noTerrain: true,
    };
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

// Réserve de base du devis NAVIGATION (fiche 7, 27/09) : avion certifié
// 30 min jour / 45 nuit (arrêté du 24/07/1991 modifié — minimum réglementaire
// 20/45, l'app reste volontairement au-dessus) ; ULM 15 min de jour (arrêté
// du 17/02/2025, art. 4.1.4) via le drapeau isULM de la flotte. ULM la nuit :
// 45 min par prudence (vol de nuit ULM non courant).
const RESERVE_MIN_DAY = 30;
const RESERVE_MIN_NIGHT = 45;
const RESERVE_MIN_DAY_ULM = 15;

// Réserve réglementaire de base selon l'aéronef (isULM) et le créneau.
export function regulatoryReserveMin({ isNight = false, isULM = false } = {}) {
    if (isNight) return RESERVE_MIN_NIGHT;
    return isULM ? RESERVE_MIN_DAY_ULM : RESERVE_MIN_DAY;
}

// Forfaits AU SOL du devis carburant : roulage départ et arrivée (5 min mini
// chacun) + intégration à destination. La branche dégagement ajoute aussi
// son intégration (remise de gaz → navigation → intégration → atterrissage).
export const TAXI_MIN_DEP = 5;
export const TAXI_MIN_ARR = 5;
export const INTEGRATION_MIN = 5;
const GROUND_MIN = TAXI_MIN_DEP + TAXI_MIN_ARR + INTEGRATION_MIN;

// Réserve finale d'un VOL LOCAL en vue du terrain (F1, audits 26+27/09 —
// AVANT : 10 min forfaitaires) : arrêté du 24/07/1991 modifié le 17/02/2025
// → avion 20 min de jour / 45 de nuit ; ULM 15 min de jour (art. 4.1.4 de
// l'arrêté du 17/02/2025 — identique à la navigation, cf.
// regulatoryReserveMin ; l'avion certifié, lui, reste volontairement
// au-dessus du minimum EN NAVIGATION : 30/45). Le devis local est celui
// d'un vol de JOUR en vue du terrain : la valeur nuit (45) ne joue que si
// le pilote déborde sur la nuit — signalé par ailleurs (bannière
// crépuscules civils + go-nogo).
export const LOCAL_RESERVE_MIN_DAY = 20;
export const LOCAL_RESERVE_MIN_NIGHT = 45;
export function localReserveMin(ac = {}, isNight = false) {
    if (isNight) return LOCAL_RESERVE_MIN_NIGHT;
    return ac?.isULM ? RESERVE_MIN_DAY_ULM : LOCAL_RESERVE_MIN_DAY;
}

/** Devis carburant d'un VOL LOCAL (pure — exportée pour les tests) :
 *  durée estimée + forfaits roulage départ/arrivée (sans intégration,
 *  le vol local reste dans le circuit) + réserve finale locale majorée
 *  de la réserve perso de l'avion + carburant INUTILISABLE du manuel de
 *  vol, jamais consommable mais embarqué (ex. avion à 18 L/h, réserve
 *  jour 20 min : 1 h requiert 18 + 3 + 6 + 6 = 33 L embarqués — trip +
 *  2×roulage + réserve + inutilisable 6 L). Source UNIQUE du devis
 *  local — widget Centrage (wb-ui), tuile Carburant du dossier de vol et
 *  son refresh à la frappe, log PDF local (fiche 26 : le refresh recodait
 *  la formule SANS l'inutilisable, la tuile mentait au pilote à la saisie).
 *  @param {number} tripMin Durée estimée du vol local (minutes, > 0).
 *  @param {object} ac Avion actif (fuelBurnLph, reserveExtraMin,
 *    unusableFuelL, isULM — cf. localReserveMin, F1 audits 26+27/09).
 *  @returns {{local:true, tripMin:number, tripFuelL:number, groundMin:number,
 *    groundL:number, reserveMin:number, reserveL:number, reserveBaseMin:number,
 *    reserveExtraMin:number, unusableL:number, totalL:number}} */
export function computeLocalFuelDevis(tripMin, ac = {}) {
    const burn = ac?.fuelBurnLph ?? 35;
    const groundMin = TAXI_MIN_DEP + TAXI_MIN_ARR;
    const reserveBaseMin = localReserveMin(ac);
    const reserveMin = reserveBaseMin + (ac?.reserveExtraMin || 0);
    const tripL = Math.round(tripMin / 60 * burn * 10) / 10;
    const groundL = Math.round(groundMin / 60 * burn * 10) / 10;
    const reserveL = Math.round(reserveMin / 60 * burn * 10) / 10;
    const unusableL = Math.round(((ac?.unusableFuelL > 0) ? ac.unusableFuelL : 0) * 10) / 10;
    return {
        local: true, tripMin, tripFuelL: tripL,
        groundMin, groundL,
        reserveMin, reserveL,
        reserveBaseMin, reserveExtraMin: ac?.reserveExtraMin || 0,
        unusableL,
        totalL: Math.round((tripL + groundL + reserveL + unusableL) * 10) / 10,
    };
}

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
 * réserve 30/45 min — 15 min jour ULM). Distance depuis la DESTINATION vers le dégagement ;
 * GS recalculée sur le CAP de la branche avec le vent du plan et le TAS —
 * même windCorrection que la route principale (fiche audit 27/09,
 * NCO.OP.125 : la GS de la route ou sa moyenne ignore l'effet vectoriel du
 * vent sur un cap potentiellement opposé et sous-estime le déroutement).
 * Le temps inclut l'INTÉGRATION à l'arrivée au dégagement. Sans TAS
 * exploitable : repli sur refGsKt (GS de référence du plan) ; sans GS du
 * tout, seule la distance est rendue.
 * Fonction pure — testée sous Node.
 * @returns {{distNm:number, gsKt:number|null, timeMin:number|null, fuelL:number|null}|null}
 */
export function computeDiversionLeg(destLat, destLon, divLat, divLon, fuelBurnLph, tasKt, wind = null, refGsKt = 0) {
    if (!Number.isFinite(destLat) || !Number.isFinite(destLon)
        || !Number.isFinite(divLat) || !Number.isFinite(divLon)) return null;
    const distNm = greatCircleDistanceNm(destLat, destLon, divLat, divLon);
    const out = { distNm: Math.round(distNm * 10) / 10, timeMin: null, fuelL: null, gsFallback: false };
    let gsKt = 0, gsFallback = false;
    if (tasKt > 0) {
        const wcDiv = windCorrection(trueCourseDeg(destLat, destLon, divLat, divLon), tasKt, wind);
        // N4 (audit 27/09) : GS ≤ 0 (vent ≥ TAS) → repli TAS, comme la route —
        // DÉSORMAIS SIGNALÉ (gsFallback) au lieu du repli silencieux.
        gsFallback = !(wcDiv.gsKt > 0);
        gsKt = gsFallback ? tasKt : wcDiv.gsKt;
    } else if (refGsKt > 0) {
        gsKt = refGsKt;
    }
    if (!(gsKt > 0)) return out;
    out.gsKt = gsKt;
    if (!(fuelBurnLph > 0)) return out;
    const timeMin = distNm / gsKt * 60 + INTEGRATION_MIN;
    out.timeMin = Math.round(timeMin);
    out.fuelL = Math.round(timeMin / 60 * fuelBurnLph * 10) / 10;
    return out;
}

// Résout l'ICAO du dégagement (base locale + mémo) et calcule sa branche
// (GS sur le cap Dégagement, vent du plan). Retourne { icao, distNm,
// gsKt, timeMin, fuelL } ou null (ICAO inconnu).
function _diversionFor(toLat, toLon, diversionIcao, fuelBurnLph, tasKt, wind) {
    const code = String(diversionIcao || '').toUpperCase();
    if (!code) return null;
    const apt = getAirportByICAO(code);
    const memo = memoGet(code);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) return null;
    const d = computeDiversionLeg(toLat, toLon, lat, lon, fuelBurnLph, tasKt, wind);
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
    // M1 (audit 27/09) : vent à l'heure de VOL, pas à l'heure de la
    // requête — ETA sans vent du milieu du vol (le calcul affiné au vent
    // vient juste après, l'écart reste < la résolution horaire).
    const midEtaMs = Date.now() + (distNm / (params.tasKt || 100)) * 3600000 / 2;
    const winds = await fetchWindsAloft(midLat, midLon, midEtaMs);
    const wind = winds ? getWindAtAltitude(winds, params.cruiseAltFt) : null;

    const declination = getDeclinationForIcao(fromIcao);

    const wc = windCorrection(tc, params.tasKt, wind);

    const trueHdg = (tc + wc.wcaDeg + 360) % 360;
    const magHdg = trueToMagneticHdg(trueHdg, declination);

    const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;
    const legTimeMin = distNm / gsKt * 60;

    // Réserve EFFECTIVE : réglementaire selon l'aéronef (30/45 avion certifié,
    // 15 ULM jour) + majoration personnelle de l'avion actif (flotte) — le
    // devis et le PDF affichent cette valeur.
    const reserveMin = regulatoryReserveMin(params)
        + (Number.isFinite(params.reserveExtraMin) ? Math.max(0, Math.min(60, params.reserveExtraMin)) : 0);
    const fuel = withUnusableFuel(_withDiversion(
        { ...computeFuel(legTimeMin, params.fuelBurnLph, reserveMin, GROUND_MIN), reserveMin },
        _diversionFor(toLat, toLon, params.diversionIcao, params.fuelBurnLph, params.tasKt, wind)), params.unusableFuelL);

    const elevReal = await fetchRouteElevation(fromLat, fromLon, toLat, toLon, null,
        [_officialElevFt(fromIcao, fromApt), _officialElevFt(toIcao, toApt)]);
    // (20/09, retour pilote) Relief indisponible (quota Open-Meteo saturé…) :
    // le profil reste AFFICHÉ SANS RELIEF — interpolation entre les élévations
    // officielles des extrémités, drapeau noTerrain pour le bandeau de panne
    // (écran et PDF). Le calcul de marge de franchissement, lui, exige le
    // VRAI relief : il reste absent tant qu'Open-Meteo ne répond pas.
    const elevProfile = elevReal ?? _fallbackProfile([
        { lat: fromLat, lon: fromLon, elevFt: _officialElevFt(fromIcao, fromApt) ?? 0 },
        { lat: toLat, lon: toLon, elevFt: _officialElevFt(toIcao, toApt) ?? 0 },
    ]);
    const routeObstacles = await _routeObstacles(elevReal);
    const clearance = elevReal
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
        gsFallback: !(wc.gsKt > 0),   // N4 : vent ≥ TAS → GS réduite à la TAS (signalé)
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
        isULM: !!ac?.isULM,
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
    const reserveMin = regulatoryReserveMin(params)
        + (Number.isFinite(params.reserveExtraMin) ? Math.max(0, Math.min(60, params.reserveExtraMin)) : 0);

    // Vent PAR TRONÇON (fiche 20, audit 27/09) : hétérogénéité spatiale
    // des masses d'air — un vent unique au milieu global imposait la même
    // dérive et la même GS à des segments orientés différemment. UNE SEULE
    // requête Open-Meteo multi-points pour les milieux orthodromiques de
    // tous les segments (même capacité que la grille wind-layer) ; le
    // récapitulatif affiche ensuite la moyenne vectorielle pondérée.
    const legWindPoints = [];
    const legWindDistNm = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i], b = waypoints[i + 1];
        const gc = _greatCirclePoints(a.lat, a.lon, b.lat, b.lon, 3);
        legWindPoints.push(gc[1] ?? {
            lat: (a.lat + b.lat) / 2,
            lon: (a.lon + b.lon) / 2,
        });
        legWindDistNm.push(greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon));
    }
    // M1 (audit 27/09) : ETA sans vent du MILIEU de chaque tronçon —
    // chaque segment reçoit le vent de son propre créneau horaire.
    const _tasKt = params.tasKt || 100;
    const _totalNm = legWindDistNm.reduce((s, d) => s + d, 0) || 1;
    let _cumNm = 0;
    const legEtasMs = legWindDistNm.map(d => {
        const midNm = _cumNm + d / 2; _cumNm += d;
        return Date.now() + (midNm / _tasKt) * 3600000;
    });
    const legWindsRaw = await fetchWindsAloftMulti(legWindPoints, legEtasMs);
    const legWinds = legWindPoints.map((_, i) =>
        (legWindsRaw?.[i] ? getWindAtAltitude(legWindsRaw[i], params.cruiseAltFt) : null));

    // Déclinaison au point de départ (suffisante pour des routes VFR courtes).
    const declination = getDeclinationForIcao(route[0]);

    const legDistNm = [];
    for (let i = 0; i < waypoints.length - 1; i++) {
        const a = waypoints[i], b = waypoints[i + 1];
        const distNm = greatCircleDistanceNm(a.lat, a.lon, b.lat, b.lon);
        const tc = trueCourseDeg(a.lat, a.lon, b.lat, b.lon);
        const wind = legWinds[i] ?? null;
        const wc = windCorrection(tc, params.tasKt, wind);
        const trueHdg = (tc + wc.wcaDeg + 360) % 360;
        const magHdg = trueToMagneticHdg(trueHdg, declination);
        const gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt;   // N4 : gsFallback sur le leg
        const legTimeMin = distNm / gsKt * 60;
        const fuel = computeFuel(legTimeMin, params.fuelBurnLph, reserveMin);

        legs.push({
            from: { icao: a.icao, lat: a.lat, lon: a.lon },
            to: { icao: b.icao, lat: b.lat, lon: b.lon },
            distanceNm: Math.round(distNm * 10) / 10,
            trueCourse: Math.round(tc),
            wind: wind ? { ...wind, altFt: params.cruiseAltFt } : null,
            windCorrection: wc,
            trueHeading: Math.round(trueHdg),
            magHeading: magHdg,
            groundSpeed: gsKt,
            gsFallback: !(wc.gsKt > 0),   // N4 : vent ≥ TAS → GS réduite à la TAS
            legTimeMin: Math.round(legTimeMin),
            fuel,
        });
        legDistNm.push(distNm);

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
    const elevReal = await fetchMultiSegmentElevation(legCoords, waypoints.map(w => w.elevFt));
    // (20/09, retour pilote) Voir computeFlightPlan : sans relief service,
    // profil de REPLI interpolé entre les élévations officielles des
    // terrains de la route (départ, étapes, arrivée) + drapeau noTerrain.
    const elevProfile = elevReal ?? _fallbackProfile(
        waypoints.map(w => ({ lat: w.lat, lon: w.lon, elevFt: w.elevFt ?? 0 })));
    const routeObstacles = await _routeObstacles(elevReal);
    const clearance = elevReal ? evaluateClearance(elevProfile, params.cruiseAltFt, 1000, routeObstacles) : null;
    const routeAirspaces = await loadRouteAirspaces(elevProfile, params.cruiseAltFt);

    const totalReserveL = (reserveMin / 60) * params.fuelBurnLph;
    // Forfaits au sol (roulage ×2 + intégration) : UN CYCLE PAR VOL, c.-à-d.
    // par POSEÉ — uniquement les étapes issues du champ « 2ᵉ ÉTAPE » du
    // planificateur (state.routePoses, alimenté par sa transformation ;
    // retour pilote 25/09). Tout autre point — aérodrome ajouté, repère
    // perso, point VFR — est un point TOURNANT/de passage SANS ARRÊT :
    // aucun cycle.
    const poses = Array.isArray(params.poses) ? params.poses.map(c => String(c).toUpperCase()) : [];
    const nbPosees = waypoints.slice(1, -1).filter(w => poses.includes(String(w.icao).toUpperCase())).length;
    const groundMin = GROUND_MIN * (1 + nbPosees);
    const groundL = (groundMin / 60) * params.fuelBurnLph;
    // Branche dégagement : depuis la DESTINATION (dernier waypoint), GS
    // recalculée sur le cap Dégagement avec le vent du TRONÇON D'ARRIVÉE
    // (le dégagement part de la destination — fiche 3, NCO.OP.125) : la GS
    // moyenne du vol ignorait l'effet vectoriel du vent sur un cap
    // potentiellement opposé (sous-estimation possible).
    const dest = waypoints[waypoints.length - 1];
    const destWind = legWinds[legWinds.length - 1] ?? null;
    const diversion = _diversionFor(dest.lat, dest.lon, params.diversionIcao, params.fuelBurnLph, params.tasKt, destWind);

    // Vent « du plan » du récapitulatif : moyenne VECTORIELLE des vents de
    // tronçons pondérée par la distance (270° et 090° s'annulent au lieu
    // de fabriquer un vent de travers fantôme).
    const wind = weightedMeanWind(legWinds.map((w, i) => ({ wind: w, weight: legDistNm[i] })));
    const fuel = withUnusableFuel(_withDiversion({
        tripFuelL: Math.round(totalTripFuelL * 10) / 10,
        reserveL: Math.round(totalReserveL * 10) / 10,
        groundMin,
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

export const RESERVES = { DAY_MIN: RESERVE_MIN_DAY, NIGHT_MIN: RESERVE_MIN_NIGHT, DAY_MIN_ULM: RESERVE_MIN_DAY_ULM };
