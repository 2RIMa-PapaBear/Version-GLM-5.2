/* ================================================================
 * TAKEOFF PERFORMANCE — Distance de décollage corrigée vs piste
 * ================================================================
 *
 * POURQUOI — C'EST LE MODULE "KILLER" VFR
 * ----------------------------------------
 * La densité-altitude ne dit rien au pilote tant qu'elle reste un
 * chiffre abstrait. Ce que le pilote VFR se demande RÉELLEMENT en se
 * gauchissant sur la piste en herbe un après-midi d'été, c'est :
 *
 *   "Est-ce que je vais décoller avant le bout de la piste ?"
 *
 * Ce module traduit la densité-altitude en une réponse concrète :
 * il estime la distance de décollage corrigée et la compare à la
 * longueur de piste disponible. C'est exactement le calcul que le
 * pilote fait (ou devrait faire) avec le manuel de vol — sauf qu'ici
 * il est automatisé à partir des conditions météo live.
 *
 * APPROCHE
 * --------
 * La correction de performance selon la densité-altitude suit les
 * règles empiriques du manuel de vol du Cessna 172 (référence de
 * l'instruction), confirmées par la FAA (PHAK Ch. 11) :
 *
 *   • Pour chaque 1000 ft de densité-altitude AU-DESSUS de l'élévation
 *     standard (ISA au niveau de la mer), la distance de décollage
 *     augmente d'environ 10 %.
 *   • La distance de roulement (ground roll) augmente plus vite que la
 *     distance de franchissement des 50 ft.
 *
 * On prend comme référence un C172 moyen au niveau de la mer en ISA :
 *     ground roll  ≈ 830 ft
 *     distance 50 ft ≈ 1400 ft
 *
 * Le pilote peut ajuster :
 *   - la longueur de piste de son terrain (persistée par OACI),
 *   - la distance de référence de son avion (si connu).
 *
 * ⚠️ AIDE À LA DÉCISION — pas un manuel de vol. Le manuel de vol de
 * l'avion (POH) reste la seule référence légale.
 * ================================================================ */

import { state, fetchAvecRelais } from './core.js';
import { densityAltitude, getPerformanceData } from './density-altitude.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { selectBestRunway } from './engine.js';
import { getRunwaySurface, isSoftSurface, surfaceLabel, runwayBelongsToAirport } from './runway-surface.js';
import { siaRunwayLengthFt, getSiaAirfield } from './sia-data.js';
import { getDeclinationForIcao } from './magvar.js';

// Distance de référence C172 (ft), au niveau de la mer / ISA.
const DEFAULT_GROUND_ROLL = 830;
const DEFAULT_50FT = 1400;

// Facteur de conversion pied → mètre.
const FT_TO_M = 0.3048;

// Clé localStorage pour la longueur de piste par terrain.
const LS_RWY_LEN_PREFIX = 'rwy-length-';

/** Convertit pieds en mètres (arrondi). */
function ftToM(ft) { return Math.round(ft * FT_TO_M); }

/**
 * Récupère la longueur de piste pour un terrain, en tenant compte de la piste
 * actuellement sélectionnée dans la rose des vents.
 *
 * Priorité :
 *   1. Piste SIA officielle (France) contenant la piste active de la rose
 *      des vents, sinon la piste principale du terrain (longueur déclarée
 *      en mètres convertie en pieds).
 *   2. Piste active de la rose des vents → longueur openAIP spécifique.
 *   3. Piste la plus longue du terrain (fallback openAIP).
 *
 * @param {string} icao
 * @returns {number|null} Longueur en pieds, ou null si inconnue.
 */
export function getRunwayLength(icao) {
    if (!icao) return null;

    const apt = getAirportByICAO(icao);

    // 1. Officiel SIA (France) : piste active si connue, sinon principale.
    const activeRwyName = apt ? _getActiveRunwayName(apt) : null;
    const siaLen = siaRunwayLengthFt(icao, activeRwyName || undefined);
    if (siaLen) return siaLen;

    if (!apt) return null;

    // 2. Piste active de la rose des vents : si le pilote a cliqué une piste
    //    (state.forcedRunway = "08L-26R") ou si une piste est suggérée par le
    //    vent, on cherche la longueur de CE numéro de piste.
    if (activeRwyName && apt.runwayLengths) {
        const len = apt.runwayLengths[activeRwyName];
        if (typeof len === 'number' && len > 0) return len;
    }

    // 3. Fallback : piste la plus longue du terrain.
    if (typeof apt.longestRunway === 'number' && apt.longestRunway > 0) {
        return apt.longestRunway;
    }
    return null;
}

/**
 * Renvoie le numéro de piste actif (ex: "08L") selon la rose des vents.
 * Exporté pour que l'UI puisse afficher quelle piste est concernée.
 * @param {string} icao
 * @param {Object|null} [wind] vent {dir (°VRAIS ou null si VRB), speed} —
 *   si fourni, la piste active est choisie FACE AU VENT (ex. METAR de
 *   départ pour le log de nav) ; sinon comportement historique (paire
 *   suggérée/forcée de la rose des vents, sans alignement vent).
 * @param {number} [magDeclination] déclinaison (°E+) : le vent METAR est
 *   VRAI, les pistes sont MAGNÉTIQUES.
 * @returns {string|null}
 */
export function getActiveRunwayNameForIcao(icao, wind = null, magDeclination = 0) {
    const apt = getAirportByICAO(icao);
    return _getActiveRunwayName(apt, wind, magDeclination);
}

/**
 * Détermine le numéro de piste actif (ex: "08L") selon l'état courant :
 * - Si state.forcedRunway est défini (pilote a cliqué une piste), on résout
 *   via selectBestRunway pour obtenir le nom de la piste active de cette paire.
 * - Si un vent est fourni, la piste la plus face au vent est retenue.
 * @param {Object} apt L'objet terrain (avec .runways).
 * @param {Object|null} [wind] {dir, speed} ou null.
 * @param {number} [magDeclination]
 * @returns {string|null} Numéro de piste (ex: "08L"), ou null.
 */
function _getActiveRunwayName(apt, wind = null, magDeclination = 0) {
    if (!apt || !Array.isArray(apt.runways) || apt.runways.length === 0) return null;
    // Priorité à la piste PUBLIÉE PAR LA ROSE DES VENTS (sélection du pilote
    // ou choix automatique de la vue courante) : le calcul des performances
    // doit porter sur CETTE piste. Uniquement si elle appartient à CE terrain
    // (le planificateur peut interroger un autre aérodrome que l'affiché).
    if (state.activeRunwayName && runwayBelongsToAirport(apt, state.activeRunwayName)) {
        return state.activeRunwayName;
    }
    // wind=null : selectBestRunway retourne quand même la paire (et la piste
    // active si forcedRunway est défini). C'est suffisant pour récupérer le nom.
    const rwyData = selectBestRunway(apt.runways, wind, state.forcedRunway, magDeclination);
    return rwyData?.active?.name || null;
}

/**
 * Indique si la longueur de piste provient de la base (auto) ou d'une saisie
 * manuelle. Sert à l'UI pour afficher un indice "auto".
 * @param {string} icao
 * @returns {boolean} true si la valeur vient de airports.json (non personnalisée).
 */
export function isRunwayLengthAuto(icao) {
    if (!icao) return false;
    try {
        const v = parseInt(localStorage.getItem(LS_RWY_LEN_PREFIX + icao.toUpperCase()), 10);
        if (!isNaN(v) && v > 0) return false; // saisie manuelle
    } catch { /* ignore */ }
    return true; // vient de la base
}

/**
 * Définit la longueur de piste pour un terrain.
 * @param {string} icao
 * @param {number} ft Longueur en pieds.
 */
export function setRunwayLength(icao, ft) {
    if (!icao) return;
    try {
        if (ft == null || isNaN(ft)) {
            localStorage.removeItem(LS_RWY_LEN_PREFIX + icao.toUpperCase());
        } else {
            localStorage.setItem(LS_RWY_LEN_PREFIX + icao.toUpperCase(), String(Math.round(ft)));
        }
    } catch {
        /* quota */
    }
}

/**
 * Récupère les distances de référence de l'avion actif (depuis la flotte).
 * @returns {{groundRoll: number, fiftyFt: number, name: string, safetyMargin: number}}
 */
export function getAircraftRef() {
    const ac = getActiveAircraft();
    return {
        name: ac.name,
        groundRoll: ac.groundRoll,
        fiftyFt: ac.fiftyFt,
        safetyMargin: ac.safetyMargin ?? 20,
    };
}

/**
 * Calcule la distance de décollage corrigée selon la densité-altitude ET
 * le revêtement de piste.
 *
 * Corrections appliquées (coefficients aéronautiques reconnus, FAA PHAK /
 * manuels Cessna-Piper) :
 *
 *   1. DENSITÉ-ALTITUDE (toujours) :
 *      +10 % par 1000 ft de DA sur la distance totale ; +2 % supplémentaire
 *      sur le roulement (plus sensible : rotation plus tardive).
 *
 *   2. REVÊTEMENT MOU (herbe, terre tassée, gravier, sable...) :
 *      Le roulement s'allonge car l'accélération est dégradée (résistance
 *      de roulement supérieure). Le franchissement 50 ft est peu affecté.
 *        - Piste molle SÈCHE    : +15 % sur le roulement
 *        - Piste molle HUMIDE   : +25 % sur le roulement (herbe mouillée)
 *        - Piste molle + PLUIE/NEIGE : +30 % sur le roulement
 *      Une piste dure (asphalte, béton) n'est pas affectée par cette
 *      correction (sauf pluie battante : +5 % par sécurité).
 *
 * @param {number} da Densité-altitude (ft).
 * @param {Object} [opts] Options de correction revêtement.
 * @param {string} [opts.surfaceCode] Code revêtement (ex: 'GRE', 'ASP').
 * @param {boolean} [opts.wet] Piste humide (bruine, pluie légère).
 * @param {boolean} [opts.contaminated] Piste contaminée (pluie forte, neige).
 * @returns {{groundRoll: number, fiftyFt: number, factor: number, surfaceFactor: number}}
 */
export function correctedTakeoffDistance(da, opts = {}) {
    const ref = getAircraftRef();

    // ---- 1. Correction densité-altitude ----
    const effectiveDa = Math.max(0, da);
    const factor = 1 + (effectiveDa / 1000) * 0.10;
    const rollFactor = factor + (effectiveDa / 1000) * 0.02;

    // ---- 2. Correction revêtement (sur le roulement uniquement) ----
    let surfaceFactor = 1; // 1 = pas de majoration.
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;

    if (soft) {
        // Piste molle : la majoration dépend de l'humidité.
        if (opts.contaminated) surfaceFactor = 1.30;       // +30 % (pluie/neige)
        else if (opts.wet) surfaceFactor = 1.25;           // +25 % (humide)
        else surfaceFactor = 1.15;                          // +15 % (sèche)
    } else if (opts.contaminated) {
        // Piste dure contaminée (eau stagnante, neige) : léger allongement.
        surfaceFactor = 1.10;
    } else if (opts.wet) {
        // Piste dure humide : marginal.
        surfaceFactor = 1.05;
    }

    return {
        groundRoll: Math.round(ref.groundRoll * rollFactor * surfaceFactor),
        fiftyFt: Math.round(ref.fiftyFt * factor),
        factor,
        surfaceFactor,
    };
}

/**
 * Distance d'ATTERRISSAGE corrigée (A5) — miroir du décollage, sur les
 * références POH d'atterrissage de l'avion actif (ldgRoll / ldgFifty, ft).
 *
 *   1. DENSITÉ-ALTITUDE : +10 % par 1000 ft (majorant prudent, cohérent
 *      avec la correction de décollage de l'app).
 *   2. VENT LONGITUDINAL sur la piste en service : −10 % par 10 kt de vent
 *      DE FACE (plancher −30 %) ; +20 % par 10 kt de vent ARRIÈRE (plafond
 *      +60 %).
 *   3. REVÊTEMENT/ÉTAT : mêmes facteurs maison que le décollage.
 *
 * Fonction pure — testée sous Node.
 * @param {number} daFt Densité-altitude (ft).
 * @param {number} refRollFt Référence POH roulement atterrissage (ft).
 * @param {number} refFiftyFt Référence POH franchissement 50 ft (ft).
 * @param {Object} [opts] { headwindKt (>0 = de face), surfaceCode, wet, contaminated }
 * @returns {{rollFt:number, fiftyFt:number, daFactor:number, windFactor:number, surfaceFactor:number}|null}
 */
export function correctedLandingDistance(daFt, refRollFt, refFiftyFt, opts = {}) {
    if (!Number.isFinite(refRollFt) || refRollFt <= 0
        || !Number.isFinite(refFiftyFt) || refFiftyFt <= 0) return null;

    const daFactor = 1 + (Math.max(0, daFt) / 1000) * 0.10;

    let windFactor = 1;
    const hw = Number.isFinite(opts.headwindKt) ? opts.headwindKt : 0;
    if (hw >= 0) windFactor = Math.max(0.70, 1 - (hw / 10) * 0.10);
    else windFactor = Math.min(1.60, 1 + (-hw / 10) * 0.20);

    let surfaceFactor = 1;
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;
    if (soft) {
        if (opts.contaminated) surfaceFactor = 1.30;
        else if (opts.wet) surfaceFactor = 1.25;
        else surfaceFactor = 1.15;
    } else if (opts.contaminated) surfaceFactor = 1.10;
    else if (opts.wet) surfaceFactor = 1.05;

    const f = daFactor * windFactor * surfaceFactor;
    return {
        rollFt: Math.round(refRollFt * f),
        fiftyFt: Math.round(refFiftyFt * f),
        daFactor, windFactor, surfaceFactor,
    };
}

// Suffixe d'info quand le revêtement/l'humidité a majoré le calcul.
function _surfaceNote(corr, surfaceCode, isFr) {
    if (corr.surfaceFactor <= 1) return '';
    const surfLbl = surfaceCode ? surfaceLabel(surfaceCode) : '';
    const pct = Math.round((corr.surfaceFactor - 1) * 100);
    if (isSoftSurface(surfaceCode)) {
        const wet = corr.surfaceFactor === 1.25, contaminated = corr.surfaceFactor >= 1.30;
        if (contaminated) return isFr ? ` (revêtement ${surfLbl} contaminé +${pct}%)` : ` (${surfLbl} contaminated +${pct}%)`;
        if (wet) return isFr ? ` (revêtement ${surfLbl} humide +${pct}%)` : ` (wet ${surfLbl} +${pct}%)`;
        return isFr ? ` (revêtement ${surfLbl} +${pct}%)` : ` (${surfLbl} +${pct}%)`;
    }
    return isFr ? ` (piste humide/contaminée +${pct}%)` : ` (wet/contaminated +${pct}%)`;
}

// Verdict commun : compare la distance corrigée à la longueur de piste et
// construit le message (FR/EN). Partagé par evaluateTakeoffPerformance (état
// courant de l'app) et evaluateTakeoffFromRaw (METAR brut, ex. log de nav).
function _takeoffVerdict(icao, daResult, corr, surfaceCode) {
    const acRef = getAircraftRef();
    const rwyLen = getRunwayLength(icao);
    const isFr = state.lang === 'fr';
    const surfaceNote = _surfaceNote(corr, surfaceCode, isFr);

    // Pas de longueur de piste configurée → on donne la distance corrigée
    // brute (informatif) sans verdict de marge.
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

    // Marge : longueur de piste - distance franchissement 50 ft.
    // On compare au franchissement 50 ft car c'est le critère opérationnel
    // (être airborne avant la fin de piste).
    const margin = rwyLen - corr.fiftyFt;
    const marginPct = (margin / rwyLen) * 100;
    // Le seuil de prudence (caution) est personnalisable par avion.
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

/**
 * Évalue la performance de décollage pour le terrain courant :
 * calcule la distance corrigée, la compare à la longueur de piste
 * configurée, et retourne un verdict.
 *
 * @param {string} icao Code OACI du terrain.
 * @returns {{
 *   da: number,
 *   groundRoll: number,
 *   fiftyFt: number,
 *   runwayLength: number|null,
 *   margin: number|null,
 *   level: 'ok'|'caution'|'danger'|'unknown',
 *   message: string
 * }|null} null si les données météo sont indisponibles.
 */
export function evaluateTakeoffPerformance(icao) {
    const perf = getPerformanceData();
    if (!perf) return null;

    const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
    if (!daResult) return null;

    // ---- Détection du revêtement et de l'humidité ----
    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _detectWetFromMetar();

    const corr = correctedTakeoffDistance(daResult.da, { surfaceCode, wet, contaminated });
    return _takeoffVerdict(icao, daResult, corr, surfaceCode);
}

/**
 * Même calcul qu'evaluateTakeoffPerformance, mais à partir d'un METAR brut
 * fourni (ex. METAR de départ frais au moment de générer le log de nav PDF)
 * au lieu de l'état courant de l'app — qui peut être affiché sur un autre
 * terrain. L'humidité/contamination est détectée par tokens dans le brut.
 *
 * @param {string} icao Code OACI du terrain.
 * @param {{raw:string, qnh:number, oat:number, elevationFt:number|null}} metar
 * @returns {Object|null} même forme qu'evaluateTakeoffPerformance.
 */
export function evaluateTakeoffFromRaw(icao, metar) {
    if (!icao || !metar || metar.qnh == null || metar.oat == null) return null;
    const daResult = densityAltitude(metar.elevationFt ?? 0, metar.qnh, metar.oat);
    if (!daResult) return null;

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _wetFromTokens(metar.raw || '');
    const corr = correctedTakeoffDistance(daResult.da, { surfaceCode, wet, contaminated });
    return _takeoffVerdict(icao, daResult, corr, surfaceCode);
}

/**
 * Cœur de verdict atterrissage, partagé par le terrain OBSERVÉ
 * (evaluateLandingPerformance — rose des vents) et la DESTINATION distante
 * calculée depuis son METAR brut (evaluateLandingFromRaw — piste PRÉVUE au
 * vent du METAR, `isForecast` à true).
 */
function _landingVerdict(icao, daResult, corr, headwindKt, activeName, isForecast) {
    const ac = getActiveAircraft();
    const isFr = state.lang === 'fr';
    const base = {
        da: Math.round(daResult.da),
        rollFt: corr.rollFt,
        fiftyFt: corr.fiftyFt,
        headwindKt,
        runwayName: activeName || null,
        forecast: !!isForecast,
        surfaceFactor: corr.surfaceFactor,
        windFactor: corr.windFactor,
    };

    const rwyLen = getRunwayLength(icao);
    if (rwyLen == null) {
        return {
            ...base, runwayLength: null, margin: null, level: 'unknown',
            message: isFr
                ? `Roulement atterrissage estimé ${ftToM(corr.rollFt)} m — renseignez la longueur de piste`
                : `Est. landing roll ${ftToM(corr.rollFt)} m — set runway length`,
        };
    }

    // Critère opérationnel : franchir les 50 ft puis S'ARRÊTER dans la piste.
    const margin = rwyLen - corr.fiftyFt;
    const marginPct = (margin / rwyLen) * 100;
    const cautionThreshold = ac.safetyMargin ?? 20;
    const level = margin < 0 ? 'danger' : (marginPct < cautionThreshold ? 'caution' : 'ok');
    const hwTxt = headwindKt == null ? '' : (isFr
        ? ` · vent ${headwindKt >= 0 ? 'de face' : 'arrière'} ${Math.abs(headwindKt)} kt`
        : ` · ${headwindKt >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(headwindKt)} kt`);
    const messages = {
        ok: isFr
            ? `Atterrissage OK — roulement ${ftToM(corr.rollFt)} m / ${ftToM(corr.fiftyFt)} m (50 ft), piste ${ftToM(rwyLen)} m${hwTxt}`
            : `Landing OK — roll ${ftToM(corr.rollFt)} m / ${ftToM(corr.fiftyFt)} m (50 ft), rwy ${ftToM(rwyLen)} m${hwTxt}`,
        caution: isFr
            ? `Marge faible — ${ftToM(corr.fiftyFt)} m nécessaires (50 ft), piste ${ftToM(rwyLen)} m${hwTxt}`
            : `Tight margin — ${ftToM(corr.fiftyFt)} m needed (50 ft), rwy ${ftToM(rwyLen)} m${hwTxt}`,
        danger: isFr
            ? `ATTERRISSAGE CRITIQUE — ${ftToM(corr.fiftyFt)} m nécessaires (50 ft), piste ${ftToM(rwyLen)} m (manque ${ftToM(Math.abs(margin))} m)${hwTxt}`
            : `CRITICAL LANDING — ${ftToM(corr.fiftyFt)} m needed (50 ft), rwy ${ftToM(rwyLen)} m (short by ${ftToM(Math.abs(margin))} m)${hwTxt}`,
    };
    return { ...base, runwayLength: rwyLen, margin: Math.round(margin), level, message: messages[level] };
}

/**
 * Performance d'ATTERRISSAGE du terrain OBSERVÉ (vol local : départ =
 * arrivée) : distance corrigée comparée à la longueur de piste — miroir du
 * décollage. N'existe que si les références POH d'atterrissage (ldgRoll /
 * ldgFifty) sont renseignées dans la flotte.
 */
export function evaluateLandingPerformance(icao) {
    const ac = getActiveAircraft();
    if (!ac?.ldgRoll || !ac?.ldgFifty) return null;

    const perf = getPerformanceData();
    if (!perf) return null;
    const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
    if (!daResult) return null;

    // Composante longitudinale du vent sur la piste en service (rose des
    // vents, repli calcul au vent METAR) — headwindKt > 0 = vent de face.
    let headwindKt = null;
    let activeName = null;
    const ventStr = state.lastParsed?.base?.vent?.[0]?.val;
    const m = ventStr ? String(ventStr).match(/(VRB|\d{3})(\d{2,3})/) : null;
    const rwyWind = m ? { dir: m[1] === 'VRB' ? null : parseInt(m[1], 10), speed: parseInt(m[2], 10) } : null;
    const apt = getAirportByICAO(icao);
    if (rwyWind && rwyWind.dir != null && apt?.runways) {
        const dec = getDeclinationForIcao(icao) || 0;
        const sel = selectBestRunway(apt.runways, rwyWind, null, dec);
        if (sel?.active) {
            const magWindDir = (((rwyWind.dir - dec) % 360) + 360) % 360;
            headwindKt = Math.round(rwyWind.speed * Math.cos((magWindDir - sel.active.hdg) * Math.PI / 180));
            activeName = sel.active.name;
        }
    }

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _detectWetFromMetar();
    const corr = correctedLandingDistance(daResult.da, ac.ldgRoll, ac.ldgFifty, {
        headwindKt: headwindKt ?? 0, surfaceCode, wet, contaminated,
    });
    if (!corr) return null;
    return _landingVerdict(icao, daResult, corr, headwindKt, activeName || state.activeRunwayName, false);
}

/**
 * Performance d'ATTERRISSAGE d'un terrain DISTANT (la DESTINATION du plan)
 * à partir de son METAR BRUT : la piste en service est PRÉVUE par le vent
 * du METAR (pas de rose des vents hors du terrain observé) — le numéro
 * affiché porte la mention « prévue ». Références POH de la flotte requises.
 * @param {string} icao Code OACI de l'arrivée.
 * @param {{raw:string, qnh:number, oat:number, elevationFt:number|null}} metar
 */
export function evaluateLandingFromRaw(icao, metar) {
    const ac = getActiveAircraft();
    if (!ac?.ldgRoll || !ac?.ldgFifty) return null;
    if (!icao || !metar || metar.qnh == null || metar.oat == null) return null;
    const daResult = densityAltitude(metar.elevationFt ?? 0, metar.qnh, metar.oat);
    if (!daResult) return null;

    // Vent du brut (vrai) → piste PRÉVUE magnétique (correction déclinaison).
    let headwindKt = null;
    let activeName = null;
    const mW = String(metar.raw || '').match(/\b(\d{3}|VRB)(\d{2,3})(?:G\d{2,3})?KT\b/);
    const wind = mW ? { dir: mW[1] === 'VRB' ? null : parseInt(mW[1], 10), speed: parseInt(mW[2], 10) } : null;
    const apt = getAirportByICAO(icao);
    if (wind && wind.dir != null && apt?.runways) {
        const dec = getDeclinationForIcao(icao) || 0;
        const sel = selectBestRunway(apt.runways, wind, null, dec);
        if (sel?.active) {
            const magWindDir = (((wind.dir - dec) % 360) + 360) % 360;
            headwindKt = Math.round(wind.speed * Math.cos((magWindDir - sel.active.hdg) * Math.PI / 180));
            activeName = sel.active.name;
        }
    }

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _wetFromTokens(metar.raw || '');
    const corr = correctedLandingDistance(daResult.da, ac.ldgRoll, ac.ldgFifty, {
        headwindKt: headwindKt ?? 0, surfaceCode, wet, contaminated,
    });
    if (!corr) return null;
    return _landingVerdict(icao, daResult, corr, headwindKt, activeName, true);
}

// Cache session des atterrissages de destination (10 min) — le widget se
// re-rend à chaque chargement METAR du départ, inutile de re-fetch l'arrivée.
const _destLdgCache = new Map();
const _DEST_TTL_MS = 10 * 60 * 1000;

/** METAR brut d'une station, '' si absente de la source (HTTP 204) ou en échec.
 *  TTL relais 5 min : les refresh successifs sont servis par le cache du
 *  relais au lieu d'un nouvel aller-retour aviationweather. */
async function _fetchMetarRaw(code) {
    try {
        const raw = String(await fetchAvecRelais(`https://aviationweather.gov/api/data/metar?ids=${code}&format=raw`, 'text', 300) || '').trim();
        const first = raw.split('\n')[0] || '';
        return first.length > 10 ? first : '';
    } catch { return ''; }
}

function _haversineNm(lat1, lon1, lat2, lon2) {
    const R = 3440.065, toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** Stations émettrices les plus proches d'un terrain (bbox ±1,5° ≈ 90 NM),
 *  pour la substitution des arrivées sans METAR propre sur la source NOAA
 *  (ex. terrains privés/militaires) — même règle que les pastilles grises. */
async function _nearestReportingStations(icao, max = 3) {
    const apt = getAirportByICAO(icao);
    if (!apt) return [];
    try {
        const d = 1.5;
        const bbox = `${apt.lat - d},${apt.lon - d},${apt.lat + d},${apt.lon + d}`;
        const js = await fetchAvecRelais(`https://aviationweather.gov/api/data/stationinfo?bbox=${bbox}&format=json`, 'json', 3600);
        if (!Array.isArray(js)) return [];
        return js
            .filter(s => s.icaoId && String(s.icaoId).toUpperCase() !== icao && s.lat != null && s.lon != null)
            .map(s => ({ code: String(s.icaoId).toUpperCase(), distNm: Math.round(_haversineNm(apt.lat, apt.lon, s.lat, s.lon)) }))
            .sort((a, b) => a.distNm - b.distNm)
            .slice(0, max);
    } catch { return []; }
}

/** METAR d'un terrain AVEC SUBSTITUTION « olive grise » (règle carte) :
 *  terrain sans message sur la source → METAR de la station émettrice la
 *  plus proche, mentionnée. Exporté pour la page météo du dossier (B1) et
 *  réutilisé par evaluateLandingAtDestination.
 *  @returns {{raw:string, from:string|null, distNm:number|null}|null} */
export async function fetchMetarWithFallback(icao) {
    const code = String(icao || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
    const own = await _fetchMetarRaw(code);
    if (own) return { raw: own, from: null, distNm: null };
    for (const st of await _nearestReportingStations(code, 3)) {
        const r2 = await _fetchMetarRaw(st.code);
        if (r2) return { raw: r2, from: st.code, distNm: st.distNm };
    }
    return null;
}

/** TAF brut d'une station (ttl relais 5 min), '' si absent. */
async function _fetchTafRaw(code) {
    try {
        const raw = String(await fetchAvecRelais(`https://aviationweather.gov/api/data/taf?ids=${code}&format=raw`, 'text', 300) || '').trim();
        return raw.length > 20 ? raw : '';
    } catch { return ''; }
}

/** TAF d'un terrain avec la MÊME substitution « olive grise » : sans TAF
 *  sur la source → TAF de la station émettrice la plus proche.
 *  @returns {{raw:string, from:string|null, distNm:number|null}|null} */
export async function fetchTafWithFallback(icao) {
    const code = String(icao || '').toUpperCase();
    if (!/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
    const own = await _fetchTafRaw(code);
    if (own) return { raw: own, from: null, distNm: null };
    for (const st of await _nearestReportingStations(code, 3)) {
        const r2 = await _fetchTafRaw(st.code);
        if (r2) return { raw: r2, from: st.code, distNm: st.distNm };
    }
    return null;
}

/**
 * Performance d'atterrissage de la DESTINATION du plan, SANS consultation :
 * METAR de l'arrivée récupéré au relais (format=raw), piste prévue d'après
 * son vent. Arrivée SANS METAR propre sur la source : météo de la station
 * émettrice la plus proche (marquée metarFrom/metarDistNm). Seuls les
 * SUCCÈS sont cachés (10 min) — un échec est retenté au prochain rendu.
 */
export async function evaluateLandingAtDestination(destIcao) {
    try {
        const code = String(destIcao || '').toUpperCase();
        if (!/^[A-Z][A-Z0-9]{3}$/.test(code)) return null;
        const cached = _destLdgCache.get(code);
        if (cached && Date.now() - cached.ts < _DEST_TTL_MS) return cached.landing;

        let raw = '';
        let metarFrom = null, metarDistNm = null;
        const fb = await fetchMetarWithFallback(code);
        if (fb) { raw = fb.raw; metarFrom = fb.from; metarDistNm = fb.distNm; }

        const mQ = raw ? raw.match(/\bQ(\d{4})\b/) : null;
        // Température : paire T/Td juste avant le QNH (22/12 Q1018).
        const mT = raw ? raw.match(/\b(M?\d{2})\/M?\d{2}\s+Q\d{4}\b/) : null;
        const qnh = mQ ? parseInt(mQ[1], 10) : null;
        const oat = mT ? (mT[1][0] === 'M' ? -parseInt(mT[1].slice(1), 10) : parseInt(mT[1], 10)) : null;
        let landing = null;
        if (qnh != null && oat != null) {
            const elevFt = getSiaAirfield(code)?.elevFt ?? getAirportByICAO(code)?.elevation ?? 0;
            landing = evaluateLandingFromRaw(code, { raw, qnh, oat, elevationFt: elevFt });
            if (landing && metarFrom) { landing.metarFrom = metarFrom; landing.metarDistNm = metarDistNm; }
            _destLdgCache.set(code, { ts: Date.now(), landing });
        }
        return landing;
    } catch { return null; }
}

// Détection des phénomènes humides/contaminants par tokens dans un METAR
// brut (les codes RA/SN/... sont des groupes délimités par des espaces).
// Équivalent simplifié de _detectWetFromMetar, sans accès au DOM/état.
// Exporté pour les tests.
export function _wetFromTokens(raw) {
    // Ne garde que les groupes plausibles (lettres, préfixe intensité/vicinité)
    // contenant un code météo connu — écarte KT, Q1013, FEW035, NOSIG...
    const groups = String(raw || '').toUpperCase().split(/\s+/)
        .filter(t => /^[-+VC]{0,2}[A-Z]{2,8}$/.test(t))
        .map(t => t.replace(/^VC/, ''))
        .filter(t => /RA|SN|SG|PL|GR|GS|DZ|BR|SH|FZ|TS/.test(t));
    const contaminated = groups.some(g => /\+RA|SH|FZ|TS|SN|SG|PL|GR|GS/.test(g));
    const wet = !contaminated && groups.some(g => /RA|DZ|BR/.test(g));
    return { wet, contaminated };
}

/**
 * Détecte l'humidité/contamination de la piste depuis les phénomènes du
 * METAR courant (pluie, bruine, neige, bruine verglaçante).
 * @returns {{wet: boolean, contaminated: boolean}}
 */
function _detectWetFromMetar() {
    const parsed = state.lastParsed;
    if (!parsed || !parsed.base) return { wet: false, contaminated: false };

    // On cherche les codes phénomènes dans le METAR/TAF brut. Une simple
    // recherche de sous-chaîne suffit (les codes sont des tokens délimités
    // par des espaces). On normalise en majuscules.
    const raw = (typeof document !== 'undefined'
        ? document.getElementById('tafInput')?.value
        : '') || '';
    const rawUpper = raw.toUpperCase();
    const tempsStr = (parsed.base.temps?.[0]?.val || '').toLowerCase();

    // Helper : teste si un code phénomène apparaît comme token dans le brut
    // OU si sa traduction FR/EN est présente dans le champ temps.
    const has = (code, translations) => {
        // Token exact dans le brut : on entoure d'espaces pour éviter les
        // faux positifs (ex: "RA" dans "BRRA" ne doit pas matcher "BR").
        if (new RegExp(`(^|\\s)${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i').test(rawUpper)) return true;
        return translations.some(t => tempsStr.includes(t));
    };

    // Phénomènes contaminants (forte impact sur le roulement).
    const contaminated =
        has('+RA', ['pluie forte']) || has('SHRA', ['averse']) ||
        has('SN', ['neige']) || has('SG', ['neige en grains']) ||
        has('PL', ['granules de glace']) || has('FZRA', ['pluie se congelant', 'pluie verglaçante']) ||
        has('FZDZ', ['bruine verglaçante', 'bruine se congelant']) || has('GR', ['grêle']) || has('GS', ['grésil']);

    // Phénomènes humides (impact modéré) — seulement si pas contaminé.
    const wet = !contaminated && (
        has('RA', ['pluie']) || has('DZ', ['bruine']) || has('BR', ['brume'])
    );

    return { wet, contaminated };
}
