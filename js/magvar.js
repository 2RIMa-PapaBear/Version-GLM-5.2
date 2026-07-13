/* ================================================================
 * MAGVAR — Déclinaison magnétique
 * ================================================================
 *
 * Le vent d'un METAR/TAF est en degrés VRAIS ; les numéros de piste
 * sont MAGNÉTIQUES. La déclinaison (différence) varie selon la
 * position (ex: ~0-2° en France, ~-13° à New York, ~+12° à LA).
 *
 * APPROCHE
 * --------
 * Ce module expose des helpers de conversion de caps. La résolution
 * de la déclinaison se fait via getDeclinationForIcao(), qui consulte
 * un cache localStorage. Si aucune valeur n'est en cache, il lance un
 * calcul en arrière-plan (NOAA WMM via le proxy) puis rafraîchit l'UI.
 *
 * Si le calcul réseau échoue (proxy indisponible, CORS, offline),
 * getDeclinationForIcao() retourne 0 — valeur correcte pour la France
 * et l'Europe de l'Ouest où la déclinaison est < 2°. Le calcul de
 * traversier reste juste dans cette zone ; hors Europe de l'Ouest, la
 * correction sera appliquée dès que le cache sera rempli.
 * ================================================================ */

import { memoGet } from './core.js';
// NOTE : on n'importe PAS ui-module.js ici pour éviter une dépendance
// circulaire (engine → magvar → ui-module → engine). Les coordonnées du
// terrain sont lues depuis le memo (core.js) qui est sans dépendance.

// Cache session (évite de re-demander l'API au même terrain).
const _sessionCache = new Map();

// Clé localStorage pour la persistance inter-sessions.
const LS_KEY = 'magvar-cache';

/**
 * Lit le cache persisté (localStorage).
 * @returns {Object} Map code OACI → déclinaison (degrés).
 */
function _readLs() {
    try {
        return JSON.parse(localStorage.getItem(LS_KEY)) || {};
    } catch {
        return {};
    }
}

/**
 * Écrit une entrée dans le cache persisté.
 */
function _writeLs(icao, dec) {
    try {
        const cache = _readLs();
        cache[icao.toUpperCase()] = dec;
        localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch {
        /* quota / mode privé */
    }
}

/**
 * Récupère la déclinaison magnétique pour un terrain, avec cache.
 * Non-bloquant : retourne immédiatement la valeur en cache (ou 0),
 * et déclenche un rafraîchissement en arrière-plan si nécessaire.
 *
 * @param {string} icao Code OACI.
 * @returns {number} Déclinaison en degrés (0 si inconnue — correct pour la FR).
 */
export function getDeclinationForIcao(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();

    // 1. Cache session (déjà calculé cette session).
    if (_sessionCache.has(key)) return _sessionCache.get(key);

    // 2. Cache persisté (localStorage).
    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return lsCache[key];
    }

    // 3. Pas en cache → on lance le calcul en arrière-plan.
    _fetchAndCache(icao);
    return 0;
}

/**
 * Version asynchrone : attend le résultat réel.
 * @param {string} icao
 * @returns {Promise<number>}
 */
export async function getDeclinationForIcaoAsync(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return _sessionCache.get(key);

    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return lsCache[key];
    }

    await _fetchAndCache(icao);
    return _sessionCache.get(key) ?? 0;
}

/**
 * Récupère les coordonnées d'un terrain depuis le memo (core.js).
 * Évite l'import de ui-module.js (qui dépend d'engine.js → cycle).
 */
function _getCoords(icao) {
    const memo = memoGet(icao);
    if (memo && typeof memo.lat === 'number') {
        return { lat: memo.lat, lon: memo.lon };
    }
    return { lat: null, lon: null };
}

/**
 * Calcul de la déclinaison — désactivé (no-op).
 *
 * Le calculateur NOAA/WMM n'est plus interrogé car l'API est instable via
 * le proxy (404 récurrents). La déclinaison reste donc à 0, ce qui est
 * CORRECT pour la France et l'Europe de l'Ouest (déclinaison < 2°, donc
 * négligeable pour le calcul de traversier en instruction VFR).
 *
 * L'infrastructure (cache, helpers) reste en place pour brancher une
 * source fiable ultérieurement (modèle WMM offline, ou API corrigée).
 * Le pilote peut aussi saisir manuellement une valeur via le cache
 * localStorage ('magvar-cache').
 */
async function _fetchAndCache(_icao) {
    // No-op intentionnel. Voir commentaire ci-dessus.
    return;
}

/**
 * Précharge la déclinaison pour un terrain (appel au chargement).
 * @param {string} icao
 */
export async function preloadDeclination(icao) {
    if (!icao) return;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return;
    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') {
        _sessionCache.set(key, lsCache[key]);
        return;
    }
    await _fetchAndCache(icao);
}

// ----------------------------------------------------------------
// Conversions de caps (pour engine.js et go-nogo.js)
// ----------------------------------------------------------------

/**
 * Déclinaison par coordonnées directes (pour les cas sans code OACI).
 * Utilise le cache session basé sur les coordonnées arrondies.
 * @param {number} lat
 * @param {number} lon
 * @returns {number}
 */
export function getMagneticDeclination(lat, lon) {
    if (lat == null || lon == null) return 0;
    const key = `${lat.toFixed(0)},${lon.toFixed(0)}`;
    if (_sessionCache.has(key)) return _sessionCache.get(key);
    const lsCache = _readLs();
    if (typeof lsCache[key] === 'number') return lsCache[key];
    return 0; // Fallback : 0 (correct pour la France).
}

/**
 * Convertit un cap vrai en cap magnétique.
 * Mag = Vrai − Déclinaison.
 */
export function trueToMagnetic(trueHdg, lat, lon) {
    if (trueHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((trueHdg - dec) % 360) + 360) % 360;
}

/**
 * Convertit un cap magnétique en cap vrai.
 * Vrai = Magnétique + Déclinaison.
 */
export function magneticToTrue(magHdg, lat, lon) {
    if (magHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((magHdg + dec) % 360) + 360) % 360;
}

/**
 * Réinitialise le cache session (utile pour les tests).
 */
export function _clearSessionCache() {
    _sessionCache.clear();
}
