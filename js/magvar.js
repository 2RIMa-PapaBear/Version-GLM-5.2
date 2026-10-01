import { memoGet } from './core.js';
import { getOfficialDeclination } from './sia-data.js';

const _sessionCache = new Map();

// N5+N11 (audit 27/09) : chaque ENTRÉE porte sa propre date (l'ancien
// horodatage GLOBAL était reprisé par n'importe quelle écriture — une
// valeur de 2024 servait au-delà des 30 j dès qu'on consultait autre
// chose), et la clé lat/lon est fine au CENTIÈME de degré (≈ 1 km ; avant
// : arrondi au degré ≈ 60 NM). Format v2 incompatible : l'ancien cache
// sans dates est ignoré et se reconstruit.
const LS_KEY = 'magvar-cache-v2';
const LS_TTL_MS = 30 * 86400e3;   // audit 26/09 : sans TTL, une valeur de 2024 servait indéfiniment

function _readLs() {
    try {
        const cache = JSON.parse(localStorage.getItem(LS_KEY)) || {};
        // Entrée PÉRIMÉE (> 30 j, ou ancien format sans date) → éjectée,
        // recalculée au prochain besoin.
        const now = Date.now();
        for (const k of Object.keys(cache)) {
            const ts = Number(cache[k]?.ts);
            if (!Number.isFinite(ts) || now - ts > LS_TTL_MS) delete cache[k];
        }
        return cache;
    } catch {
        return {};
    }
}

function _writeLs(key, dec) {
    try {
        const cache = _readLs();
        cache[key] = { v: dec, ts: Date.now() };
        localStorage.setItem(LS_KEY, JSON.stringify(cache));
    } catch {

    }
}

export function getDeclinationForIcao(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();

    if (_sessionCache.has(key)) return _sessionCache.get(key);

    // Déclinaison OFFICIELLE SIA (France, AdMagVar millésimé — ex. 0,24°
    // 2025) en priorité sur le repli WMM2025 ; null tant que sia-data
    // n'est pas chargé ou hors France.
    const sia = getOfficialDeclination(key);
    if (typeof sia === 'number') {
        _sessionCache.set(key, sia);
        _writeLs(key, sia);
        return sia;
    }

    const lsCache = _readLs();
    if (typeof lsCache[key]?.v === 'number') {
        _sessionCache.set(key, lsCache[key].v);
        return lsCache[key].v;
    }

    // Calcul synchrone via la lib geomag (WMM2025, chargée en <script> dans index.html).
    // Indépendant du réseau : garantit une valeur réelle même si OpenAIP ne répond pas.
    _fetchAndCache(icao);
    return _sessionCache.get(key) ?? 0;
}

export async function getDeclinationForIcaoAsync(icao) {
    if (!icao) return 0;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return _sessionCache.get(key);

    const sia = getOfficialDeclination(key);
    if (typeof sia === 'number') {
        _sessionCache.set(key, sia);
        _writeLs(key, sia);
        return sia;
    }

    const lsCache = _readLs();
    if (typeof lsCache[key]?.v === 'number') {
        _sessionCache.set(key, lsCache[key].v);
        return lsCache[key].v;
    }

    _fetchAndCache(icao);
    return _sessionCache.get(key) ?? 0;
}

function _getCoords(icao) {
    const memo = memoGet(icao);
    if (memo && typeof memo.lat === 'number') {
        return { lat: memo.lat, lon: memo.lon };
    }
    return { lat: null, lon: null };
}

// Calcule la déclinaison (°, convention : + = Est, - = Ouest) via le modèle
// WMM2025 (World Magnetic Model 2025-2030, coefficients officiels NOAA du
// 13/11/2024) embarqué dans vendor/geomag.js (lib MIT patchée localement,
// migration N13 du 01/10/2026). Précision : ~±0,3° en France — validée à
// l'époque 2025.0 contre les déclinaisons OFFICIELLES SIA AdMagVar embarquées
// (biais 0,017° / RMSE 0,019° / max 0,030° sur 444 terrains ; test
// geomag.test.mjs), et contre les 100 points de test NOAA (médiane 0,000°).
// L'ancien WMM2020 extrapolé surestimait la déclinaison Est de ~+0,4° en
// 2026. La lib expose window.geomag.field(lat, lon, altKm, dateMs?) ;
// N14 (audit 27/09, corrigé le 01/10) : le 3ᵉ argument est en KILOMÈTRES
// (analyse dimensionnelle du code + preuve sur les points NOAA à 8-65 km) —
// on passe TOUJOURS 0 (sol) : l'effet de l'altitude est négligeable en
// aviation légère.
function _fetchAndCache(icao) {
    if (!icao) return;
    const { lat, lon } = _getCoords(icao);
    if (lat == null || lon == null) return;
    try {
        if (typeof window !== 'undefined' && window.geomag && typeof window.geomag.field === 'function') {
            const result = window.geomag.field(lat, lon, 0);
            const dec = result?.declination;
            if (typeof dec === 'number' && !isNaN(dec)) {
                _writeLs(icao.toUpperCase(), dec);
                _sessionCache.set(icao.toUpperCase(), dec);
            }
        }
    } catch {
        // Silencieux : on garde le comportement par défaut (0).
    }
}

export async function preloadDeclination(icao) {
    if (!icao) return;
    const key = icao.toUpperCase();
    if (_sessionCache.has(key)) return;
    const lsCache = _readLs();
    if (typeof lsCache[key]?.v === 'number') {
        _sessionCache.set(key, lsCache[key].v);
        return;
    }
    _fetchAndCache(icao);
}

export function getMagneticDeclination(lat, lon) {
    if (lat == null || lon == null) return 0;
    // N11 (audit 27/09) : clé au CENTIÈME de degré (≈ 1 km) — l'arrondi au
    // degré (~60 NM) faisait servir la déclinaison d'un point lointain.
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    if (_sessionCache.has(key)) return _sessionCache.get(key);
    const lsCache = _readLs();
    if (typeof lsCache[key]?.v === 'number') return lsCache[key].v;
    // Calcul direct via la lib geomag (évite de dépendre d'un ICAO).
    try {
        if (typeof window !== 'undefined' && window.geomag && typeof window.geomag.field === 'function') {
            const dec = window.geomag.field(lat, lon, 0)?.declination;
            if (typeof dec === 'number' && !isNaN(dec)) {
                _sessionCache.set(key, dec);
                _writeLs(key, dec);
                return dec;
            }
        }
    } catch {
        // Silencieux.
    }
    return 0;
}

export function trueToMagnetic(trueHdg, lat, lon) {
    if (trueHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((trueHdg - dec) % 360) + 360) % 360;
}

export function magneticToTrue(magHdg, lat, lon) {
    if (magHdg == null) return null;
    const dec = getMagneticDeclination(lat, lon);
    return (((magHdg + dec) % 360) + 360) % 360;
}

export function _clearSessionCache() {
    _sessionCache.clear();
}

// Permet à un module externe (ex: openaip.js) de peupler le cache déclinaison
// avec une valeur déjà connue, sans repasser par _fetchAndCache. Utile pour
// réinjecter la magneticDeclination d'OpenAIP dès qu'elle est récupérée.
export function injectMagvar(icao, dec) {
    if (!icao || typeof dec !== 'number' || isNaN(dec)) return;
    const key = icao.toUpperCase();
    _sessionCache.set(key, dec);
    _writeLs(key, dec);
}
