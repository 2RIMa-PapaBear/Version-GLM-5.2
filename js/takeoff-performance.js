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
import { resolveLoads, computeWb } from './wb-core.js';
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
 * Calcule la distance de décollage corrigée — MÉTHODE MÉTHODE RÉFÉRENCE
 * (arbitrage pilote 15/09 : alignement complet, y compris masse, pente
 * et marge +20 % piste disponible).
 *
 *   1. ALTITUDE PRESSION : ×1,15 par 1000 ft Zp
 *   2. TEMPÉRATURE       : ×1,10 par +10 °C au-dessus d'ISA
 *   3. REVÊTEMENT        : herbe ×1,20/1,30 ; dur contaminé ×1,25 ; mouillé ×1,00
 *   4. MASSE             : ×1,20 par +10 % au-dessus de la masse de référence
 *   5. PENTE             : ×1,05 par 1 % de pente (montante ou descendante)
 *
 *   La MARGE +20 % avant piste disponible est appliquée dans le verdict (_takeoffVerdict).
 *
 * @param {number} pressureAltFt Altitude PRESSION (ft).
 * @param {number} oatDegC Température extérieure (°C).
 * @param {Object} [opts] { surfaceCode, wet, contaminated, massRatio, slopePct }
 *   massRatio = masse décollage / masse de référence POH (1,10 = +10 %).
 *   slopePct = pente de piste en % (1 = montante 1 %, -1 = descendante 1 %).
 */
export function correctedTakeoffDistance(pressureAltFt, oatDegC, opts = {}) {
    const ref = getAircraftRef();

    // ---- 1. Altitude pression + température ----
    const zpK = Math.max(0, pressureAltFt) / 1000;
    const paFactor = Math.pow(1.15, zpK);
    const isaTemp = 15 - 1.98 * zpK;
    const devIsa = Math.max(0, oatDegC - isaTemp);
    const tempFactor = Math.pow(1.10, devIsa / 10);

    // ---- 2. Revêtement ----
    let surfaceFactor = 1;
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;
    if (soft) {
        if (opts.contaminated) surfaceFactor = 1.25;
        else if (opts.wet) surfaceFactor = 1.30;
        else surfaceFactor = 1.20;
    } else if (opts.contaminated) surfaceFactor = 1.25;
    // Dure mouillée : ×1,00 (méthode de référence).

    // ---- 3. Masse : ×1,20 par +10 % (méthode de référence, arbitrage 15/09) ----
    let massFactor = 1;
    if (Number.isFinite(opts.massRatio) && opts.massRatio > 1) {
        const excessPct = (opts.massRatio - 1) * 100;
        massFactor = Math.pow(1.20, excessPct / 10);
    }

    // ---- 4. Pente : ×1,05 par 1 % (montante OU descendante, méthode de référence) ----
    let slopeFactor = 1;
    if (Number.isFinite(opts.slopePct) && Math.abs(opts.slopePct) > 0.05) {
        slopeFactor = Math.pow(1.05, Math.abs(opts.slopePct));
    }

    const factor = paFactor * tempFactor;
    const totalFactor = factor * surfaceFactor * massFactor * slopeFactor;
    return {
        groundRoll: Math.round(ref.groundRoll * totalFactor),
        fiftyFt: Math.round(ref.fiftyFt * totalFactor),
        factor,
        paFactor,
        tempFactor,
        surfaceFactor,
        massFactor,
        slopeFactor,
    };
}

/**
 * Distance d'ATTERRISSAGE corrigée — MÉTHODE MÉTHODE RÉFÉRENCE (arbitrage 15/09).
 *
 *   1. ALTITUDE PRESSION : ×1,05 par 1000 ft Zp
 *   2. TEMPÉRATURE       : ×1,05 par +10 °C au-dessus d'ISA
 *   3. VENT LONGITUDINAL : −10 %/10 kt face (plancher −30 %) ; +20 %/10 kt arrière (plafond +60 %)
 *   4. REVÊTEMENT        : dure sèche ×1,00 ; mouillée ×1,15 ; herbe ×1,20/1,30 ; contaminé ×1,25
 *   5. MASSE             : ×1,10 par +10 % (méthode de référence atterrissage)
 *   6. PENTE             : ×1,05 par 1 %
 *
 *   Marge +20 % avant LDA appliquée dans le verdict.
 */
export function correctedLandingDistance(pressureAltFt, oatDegC, refRollFt, refFiftyFt, opts = {}) {
    if (!Number.isFinite(refRollFt) || refRollFt <= 0
        || !Number.isFinite(refFiftyFt) || refFiftyFt <= 0) return null;

    const zpK = Math.max(0, pressureAltFt) / 1000;
    const paFactor = Math.pow(1.05, zpK);
    const isaTemp = 15 - 1.98 * zpK;
    const devIsa = Math.max(0, oatDegC - isaTemp);
    const tempFactor = Math.pow(1.05, devIsa / 10);

    let windFactor = 1;
    const hw = Number.isFinite(opts.headwindKt) ? opts.headwindKt : 0;
    if (hw >= 0) windFactor = Math.max(0.70, 1 - (hw / 10) * 0.10);
    else windFactor = Math.min(1.60, 1 + (-hw / 10) * 0.20);

    let surfaceFactor = 1;
    const soft = opts.surfaceCode ? isSoftSurface(opts.surfaceCode) : false;
    if (soft) {
        if (opts.contaminated) surfaceFactor = 1.25;
        else if (opts.wet) surfaceFactor = 1.30;
        else surfaceFactor = 1.20;
    } else if (opts.contaminated) surfaceFactor = 1.25;
    else if (opts.wet) surfaceFactor = 1.15;

    let massFactor = 1;
    if (Number.isFinite(opts.massRatio) && opts.massRatio > 1) {
        massFactor = Math.pow(1.10, ((opts.massRatio - 1) * 100) / 10);
    }

    let slopeFactor = 1;
    if (Number.isFinite(opts.slopePct) && Math.abs(opts.slopePct) > 0.05) {
        slopeFactor = Math.pow(1.05, Math.abs(opts.slopePct));
    }

    const f = paFactor * tempFactor * windFactor * surfaceFactor * massFactor * slopeFactor;
    return {
        rollFt: Math.round(refRollFt * f),
        fiftyFt: Math.round(refFiftyFt * f),
        paFactor, tempFactor, windFactor, surfaceFactor, massFactor, slopeFactor,
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
// Niveau « PISTE LIMITATIVE » (①, feu vert pilote 18/09) : distance BRUTE
// qui tient dans la piste mais PAS avec la marge +20 % — réglementairement
// utilisable en respectant exactement les vitesses du manuel.
export function runwayLevel(rawFt, marginedFt, rwyLenFt, cautionPct = 20) {
    if (rawFt > rwyLenFt) return 'danger';        // même sans marge : non
    if (marginedFt > rwyLenFt) return 'limitative'; // brut tient, marge non
    const margin = rwyLenFt - marginedFt;
    return (margin / rwyLenFt) * 100 < cautionPct ? 'caution' : 'ok';
}

function _takeoffVerdict(icao, daResult, corr, surfaceCode) {
    const acRef = getAircraftRef();
    const rwyLen = getRunwayLength(icao);
    const isFr = state.lang === 'fr';
    const surfaceNote = _surfaceNote(corr, surfaceCode, isFr);

    // MARGE +20 % avant piste disponible (méthode de référence, arbitrage 15/09) : la distance
    // « factorisée » est multipliée par 1,20 AVANT comparaison à la piste.
    const MARGIN_FACTOR = 1.20;
    const fiftyMargined = Math.round(corr.fiftyFt * MARGIN_FACTOR);

    // Pas de longueur de piste configurée → on donne la distance corrigée
    // brute (informatif) sans verdict de marge.
    if (rwyLen == null) {
        return {
            da: Math.round(daResult.da),
            groundRoll: corr.groundRoll,
            fiftyFt: corr.fiftyFt,
            fiftyMargined,
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

    // Marge : piste − distance 50 ft × 1,20 (méthode de référence).
    const margin = rwyLen - fiftyMargined;
    const cautionThreshold = acRef.safetyMargin ?? 20;
    const level = runwayLevel(corr.fiftyFt, fiftyMargined, rwyLen, cautionThreshold);

    const messages = {
        ok: isFr
            ? `Décollage OK — ${acRef.name}: 50 ft ${ftToM(fiftyMargined)} m (+20 %), piste ${ftToM(rwyLen)} m (marge ${ftToM(margin)} m)${surfaceNote}`
            : `Takeoff OK — ${acRef.name}: 50 ft ${ftToM(fiftyMargined)} m (+20%), rwy ${ftToM(rwyLen)} m (margin ${ftToM(margin)} m)${surfaceNote}`,
        caution: isFr
            ? `Marge faible — ${acRef.name}: 50 ft ${ftToM(fiftyMargined)} m (+20 %), piste ${ftToM(rwyLen)} m${surfaceNote}`
            : `Tight margin — ${acRef.name}: 50 ft ${ftToM(fiftyMargined)} m (+20%), rwy ${ftToM(rwyLen)} m${surfaceNote}`,
        limitative: isFr
            ? `PISTE LIMITATIVE (décollage) — brut ${ftToM(corr.fiftyFt)} m tient dans ${ftToM(rwyLen)} m, mais +20 % (${ftToM(fiftyMargined)} m) dépasse${surfaceNote} : utilisable en respectant exactement les vitesses du manuel — pleins gaz sur freins, rotation au bon moment`
            : `LIMITING RUNWAY (takeoff) — raw ${ftToM(corr.fiftyFt)} m fits in ${ftToM(rwyLen)} m but +20% (${ftToM(fiftyMargined)} m) does not${surfaceNote}: fly the book speeds — full power before brake release, rotate on speed`,
        danger: isFr
            ? `DÉCOLLAGE IMPOSSIBLE — ${acRef.name}: même sans marge, brut ${ftToM(corr.fiftyFt)} m > piste ${ftToM(rwyLen)} m (manque ${ftToM(corr.fiftyFt - rwyLen)} m)${surfaceNote}`
            : `TAKEOFF NOT POSSIBLE — ${acRef.name}: even raw ${ftToM(corr.fiftyFt)} m > rwy ${ftToM(rwyLen)} m (short by ${ftToM(corr.fiftyFt - rwyLen)} m)${surfaceNote}`,
    };

    return {
        da: Math.round(daResult.da),
        groundRoll: corr.groundRoll,
        fiftyFt: corr.fiftyFt,
        fiftyMargined,
        runwayLength: rwyLen,
        margin: Math.round(margin),
        level,
        surfaceNote,
        surfaceFactor: corr.surfaceFactor,
        massFactor: corr.massFactor ?? 1,
        slopeFactor: corr.slopeFactor ?? 1,
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

    // ---- Masse (W&B) et pente (seuils SIA) — méthode de référence 15/09 ----
    const ac = getActiveAircraft();
    const activeRwy = state.activeRunwayName
        || getActiveRunwayNameForIcao(icao, null, getDeclinationForIcao(icao));
    const extra = { surfaceCode, wet, contaminated, ..._massAndSlope(ac, icao, activeRwy) };

    const corr = correctedTakeoffDistance(daResult.pa, daResult.oat, extra);
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
    const ac = getActiveAircraft();
    const activeRwy = state.activeRunwayName || getActiveRunwayNameForIcao(icao, null, getDeclinationForIcao(icao));
    const corr = correctedTakeoffDistance(daResult.pa, daResult.oat,
        { surfaceCode, wet, contaminated, ..._massAndSlope(ac, icao, activeRwy) });
    return _takeoffVerdict(icao, daResult, corr, surfaceCode);
}

/** MASSE (W&B → massRatio) + PENTE (calculée SIA) — méthode de référence 15/09.
 *  Masse : ac.wb.refMassKg (POH) vs computeWb().takeoff.massKg (jour).
 *  PENTE : CALCULÉE AUTOMATIQUEMENT depuis les altitudes de seuils SIA
 *  (t1.altFt / t2.altFt, longueur en m) — pas de saisie manuelle. */
function _massAndSlope(ac, icao, activeRwyName) {
    const out = {};
    try {
        if (ac?.wb && Number.isFinite(ac.wb.refMassKg) && ac.wb.refMassKg > 0) {
            const loads = resolveLoads(ac.id);
            const calc = computeWb(ac.wb, loads);
            if (Number.isFinite(calc?.takeoff?.massKg) && calc.takeoff.massKg > 0) {
                out.massRatio = calc.takeoff.massKg / ac.wb.refMassKg;
            }
        }
    } catch {   }
    const slope = _calcRunwaySlopePct(icao, activeRwyName);
    if (slope != null) out.slopePct = slope;
    return out;
}

/**
 * Pente de piste (%) calculée depuis les altitudes de SEUILS SIA —
 * retour positif = montante dans le sens du décollage/atterrissage.
 * Ex. LFRV 04/22 : seuil 04 à 429 ft, seuil 22 à 437 ft, 1530 m
 * → +0,16 % si on décolle 04 (on monte), −0,16 % si on décolle 22.
 * @param {string} icao
 * @param {string} rwyName numéro en service (« 04 » ou « 04/22 »)
 * @returns {number|null} pente en % (arrondie au 0,1), ou null sans données.
 */
function _calcRunwaySlopePct(icao, rwyName) {
    try {
        if (!icao || !rwyName) return null;
        const rwys = getSiaRunways(icao);
        if (!Array.isArray(rwys) || !rwys.length) return null;

        // Trouve la paire de pistes contenant le numéro en service.
        const num = String(rwyName).split('/')[0].trim();
        const rwy = rwys.find(r => (r.d || '').includes(num)) || rwys.find(r => r.main);
        if (!rwy?.t1?.altFt != null || rwy?.t2?.altFt == null) return null;
        if (!Number.isFinite(rwy.t1.altFt) || !Number.isFinite(rwy.t2.altFt)) return null;
        if (!Number.isFinite(rwy.len) || rwy.len <= 0) return null;

        const lenFt = rwy.len * 3.28084;
        const dAlt = rwy.t2.altFt - rwy.t1.altFt;

        // Sens : si le numéro en service correspond à t1, on va t1 → t2.
        // Sinon on va t2 → t1 (pente inversée).
        const isT1 = String(rwy.t1?.id || '') === num;
        const slopePct = (isT1 ? dAlt : -dAlt) / lenFt * 100;

        // Arrondi au 0,1 % ; négligeable sous 0,05 %.
        const rounded = Math.round(slopePct * 10) / 10;
        return Math.abs(rounded) < 0.05 ? 0 : rounded;
    } catch { return null; }
}

/**
 * Cœur de verdict atterrissage, partagé par le terrain OBSERVÉ
 * (evaluateLandingPerformance — rose des vents) et la DESTINATION distante
 * calculée depuis son METAR brut (evaluateLandingFromRaw — piste PRÉVUE au
 * vent du METAR, `isForecast` à true).
 */
function _landingVerdict(icao, daResult, corr, headwindKt, activeName, isForecast, extra = {}) {
    const ac = getActiveAircraft();
    const isFr = state.lang === 'fr';
    const base = {
        da: Math.round(daResult.da),
        rollFt: corr.rollFt,
        fiftyFt: corr.fiftyFt,
        headwindKt,
        runwayName: activeName || null,
        forecast: !!isForecast,
        crosswindKt: extra.crosswindKt ?? null,
        crosswindSide: extra.crosswindSide ?? null,
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
    // MARGE +20 % avant LDA (méthode de référence, arbitrage 15/09).
    const MARGIN_FACTOR = 1.20;
    const fiftyMargined = Math.round(corr.fiftyFt * MARGIN_FACTOR);
    const margin = rwyLen - fiftyMargined;
    const cautionThreshold = ac.safetyMargin ?? 20;
    const level = runwayLevel(corr.fiftyFt, fiftyMargined, rwyLen, cautionThreshold);
    const hwTxt = headwindKt == null ? '' : (isFr
        ? ` · vent ${headwindKt >= 0 ? 'de face' : 'arrière'} ${Math.abs(headwindKt)} kt`
        : ` · ${headwindKt >= 0 ? 'headwind' : 'tailwind'} ${Math.abs(headwindKt)} kt`);
    const messages = {
        ok: isFr
            ? `Atterrissage OK — 50 ft ${ftToM(fiftyMargined)} m (+20 %), piste ${ftToM(rwyLen)} m${hwTxt}`
            : `Landing OK — 50 ft ${ftToM(fiftyMargined)} m (+20%), rwy ${ftToM(rwyLen)} m${hwTxt}`,
        caution: isFr
            ? `Marge faible — 50 ft ${ftToM(fiftyMargined)} m (+20 %), piste ${ftToM(rwyLen)} m${hwTxt}`
            : `Tight margin — 50 ft ${ftToM(fiftyMargined)} m (+20%), rwy ${ftToM(rwyLen)} m${hwTxt}`,
        limitative: isFr
            ? `PISTE LIMITATIVE (atterrissage) — brut ${ftToM(corr.fiftyFt)} m tient dans ${ftToM(rwyLen)} m, mais +20 % (${ftToM(fiftyMargined)} m) dépasse${hwTxt} : posé court au seuil, visée de la zone d'aboutissement, remise de gaz sinon`
            : `LIMITING RUNWAY (landing) — raw ${ftToM(corr.fiftyFt)} m fits in ${ftToM(rwyLen)} m but +20% (${ftToM(fiftyMargined)} m) does not${hwTxt}: aim for the touchdown zone, go around if not stable`,
        danger: isFr
            ? `ATTERRISSAGE IMPOSSIBLE — même sans marge, brut ${ftToM(corr.fiftyFt)} m > piste ${ftToM(rwyLen)} m (manque ${ftToM(corr.fiftyFt - rwyLen)} m)${hwTxt}`
            : `LANDING NOT POSSIBLE — even raw ${ftToM(corr.fiftyFt)} m > rwy ${ftToM(rwyLen)} m (short by ${ftToM(corr.fiftyFt - rwyLen)} m)${hwTxt}`,
    };
    return { ...base, fiftyMargined, runwayLength: rwyLen, margin: Math.round(margin), level, message: messages[level] };
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

    // Composantes du vent sur la piste en service : AXIALE (de face/arrière)
    // + TRAVERSIÈRE (gauche/droite) — le format de _parseVent est
    // « 340° 09KT » ou « 34009KT » : _parseWindForAxial gère les deux.
    let headwindKt = null;
    let crosswindKt = null;
    let crosswindSide = null;   // 'D' (droite) ou 'G' (gauche)
    let activeName = null;
    const rwyWind = _parseWindForAxial(state.lastParsed?.base?.vent?.[0]?.val);
    const apt = getAirportByICAO(icao);
    if (rwyWind && rwyWind.dir != null && apt?.runways) {
        const dec = getDeclinationForIcao(icao) || 0;
        const sel = selectBestRunway(apt.runways, rwyWind, null, dec);
        if (sel?.active) {
            const magWindDir = (((rwyWind.dir - dec) % 360) + 360) % 360;
            const angle = (magWindDir - sel.active.hdg) * Math.PI / 180;
            headwindKt = Math.round(rwyWind.speed * Math.cos(angle));
            const xw = Math.round(rwyWind.speed * Math.sin(angle));
            if (Math.abs(xw) >= 1) {
                crosswindKt = Math.abs(xw);
                crosswindSide = xw > 0 ? 'D' : 'G';   // sin > 0 = vent de droite
            }
            activeName = sel.active.name;
        }
    }

    const surfaceCode = getRunwaySurface(icao);
    const { wet, contaminated } = _detectWetFromMetar();
    const corr = correctedLandingDistance(daResult.pa, daResult.oat, ac.ldgRoll, ac.ldgFifty, {
        headwindKt: headwindKt ?? 0, surfaceCode, wet, contaminated,
    });
    if (!corr) return null;
    return _landingVerdict(icao, daResult, corr, headwindKt, activeName || state.activeRunwayName, false, { crosswindKt, crosswindSide });
}

/**
 * Extrait {dir, speed} d'une chaîne de vent — accepte le format du parseur
 * « 340° 09KT » (degré + espace, avec variation « 300V010 » en suffixe) ET
 * le format brut « 34009KT ». Retourne {dir: null, speed} pour VRB.
 */
export function _parseWindForAxial(ventStr) {
    if (!ventStr) return null;
    const s = String(ventStr);
    // VRB (variable) : pas de direction → pas de vent axial calculable.
    if (/^VRB/i.test(s)) {
        const mv = s.match(/VRB\s*(\d{2,3})/i);
        return mv ? { dir: null, speed: parseInt(mv[1], 10) } : null;
    }
    // Directionnelle : 3 chiffres puis optionnellement ° et/ou espace puis 2-3 chiffres.
    const m = s.match(/(\d{3})[°\s]*(\d{2,3})/);
    return m ? { dir: parseInt(m[1], 10), speed: parseInt(m[2], 10) } : null;
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
    const corr = correctedLandingDistance(daResult.pa, daResult.oat, ac.ldgRoll, ac.ldgFifty, {
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
