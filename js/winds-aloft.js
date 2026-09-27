/* ================================================================
 * WINDS ALOFT — Vents en altitude (Open-Meteo)
 * ================================================================
 *
 * POURQUOI
 * --------
 * En navigation VFR, le vent au sol (METAR) ne suffit pas : on vole
 * à 1000-3000 ft où le vent peut être significativement différent en
 * force et en direction. Pour calculer la dérive, le cap à suivre et
 * le temps de vol, il faut connaître le vent réel à l'altitude de
 * croisière.
 *
 * SOURCE
 * ------
 * Open-Meteo forecast endpoint — gratuit, sans clé, CORS natif.
 * NIVEAUX ISOBARIQUES en `hourly` (B1, audit 27/09 : les niveaux
 * « altitude » en mètres de `current` — windspeed_1000m… — ne sont
 * JAMAIS servis par l'API, null silencieux ≥ 1000 m : tout le plan
 * était extrapolé depuis le 180 m AGL, dérive/GS fausses) :
 *   - windspeed_<p>hPa / winddirection_<p>hPa, p ∈ 1000…700 hPa
 *     (≈ 360 à 9 880 ft AMSL — couvre toute la plage VFR de transit) ;
 *   - une surface isobare sous le niveau du sol (plateau) revient null
 *     et est filtrée : l'interpolation se fait entre surfaces valides.
 * Et `hourly` résout AUSSI M1 (audit 27/09) : le vent est pris à
 * l'HEURE DE VOL (créneau horaire le plus proche de l'heure estimée
 * du milieu de tronçon), pas à l'heure de la requête.
 *
 * Les niveaux sont des altitudes PRESSION ≈ AMSL : la croisière du
 * plan (AMSL/QNH) se compare DIRECTEMENT — plus de conversion par
 * l'élévation du sol (l'ancien décalage AGL n'a plus d'objet).
 *
 * On interpole linéairement entre les surfaces pour obtenir le vent
 * à n'importe quelle altitude.
 *
 * CACHE
 * -----
 * Cache session mémoire (Map) par coordonnées arrondies au 0.1° ET
 * par créneau horaire ciblé (une heure bucket) — un plan à 14 h et un
 * plan à 17 h ne se servent pas le même vent. TTL 1 heure.
 * ================================================================ */

import { fetchOpenMeteo } from './core.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

// Niveaux isobariques interrogés (hPa) — B1/M1, audit 27/09.
const LEVELS_HPA = [1000, 975, 950, 925, 900, 850, 800, 700];
// Altitude géométrique approchée (atmosphère ISA, ft AMSL) de chaque
// surface isobare — la pression ≠ géomètre, l'écart ISA/réel reste
// faible devant la résolution d'un vent interpolé.
const HPA_TO_FT = { 1000: 363, 975: 1061, 950: 1775, 925: 2503, 900: 3246, 850: 4786, 800: 6396, 700: 9880 };
const KT_PER_KMH = 1 / 1.852;

// Cache session : clé "lat,lon@heure" → { winds, ts }.
const _cache = new Map();
const TTL_MS = 60 * 60 * 1000;  // 1 heure.

/** Heure cible d'un point (targetMs scalaire ou tableau aligné). */
function _targetMsFor(targetMs, idx) {
    if (Array.isArray(targetMs)) {
        const t = targetMs[idx];
        return Number.isFinite(t) ? t : Date.now();
    }
    return Number.isFinite(targetMs) ? targetMs : Date.now();
}

// Décode UNE location de la réponse Open-Meteo ({ hourly, … }) en liste
// de vents par surface isobare, au créneau horaire le plus proche de
// l'heure de vol. Commune au point-à-point et au multi-points.
function _parseWindsLocation(d, targetMs) {
    const h = d?.hourly;
    if (!h || !Array.isArray(h.time) || h.time.length === 0) return null;

    // M1 : créneau horaire le plus proche de l'heure de vol (timezone=UTC
    // demandé → suffixe Z au parse ; sans Z, Date.parse lit l'heure locale
    // du runner et décalerait la sélection).
    let i = 0, best = Infinity;
    for (let k = 0; k < h.time.length; k++) {
        const t = Date.parse(String(h.time[k]) + (String(h.time[k]).endsWith('Z') ? '' : 'Z'));
        if (!Number.isFinite(t)) continue;
        const dd = Math.abs(t - targetMs);
        if (dd < best) { best = dd; i = k; }
    }

    const winds = [];
    for (const p of LEVELS_HPA) {
        const speedKmh = h[`windspeed_${p}hPa`]?.[i];
        const dir = h[`winddirection_${p}hPa`]?.[i];
        // null = surface sous le niveau du sol (relief) → ignorée.
        if (typeof speedKmh !== 'number' || typeof dir !== 'number') continue;
        winds.push({ altFt: HPA_TO_FT[p], speedKt: Math.round(speedKmh * KT_PER_KMH), dir });
    }
    return winds.length ? winds : null;
}

/**
 * Récupère les vents en altitude pour PLUSIEURS positions en UNE SEULE
 * requête multi-points (fiche 20, audit 27/09 : hétérogénéité spatiale
 * des masses d'air — un plan multi-étapes doit avoir un vent par tronçon,
 * pas un vent unique au milieu global de la route). Les points déjà en
 * cache session ne sont pas redemandés ; les points de même clé (0.1° +
 * créneau horaire) sont dédoublonnés dans la requête.
 * @param {Array<{lat:number, lon:number}>} points Positions demandées.
 * @param {number|Array<number>} [targetMs] Heure(s) de vol visée(s) —
 *   scalaire pour toute la requête, ou tableau aligné sur `points`
 *   (ETA du milieu de chaque tronçon, M1). Défaut : maintenant.
 * @returns {Promise<Array<Array<{altFt,speedKt,dir}>|null>|null>}
 *   Tableau ALIGNÉ sur l'entrée (vents par surface isobare, ou null par
 *   point inconnu/échec) ; null si l'entrée est vide.
 */
export async function fetchWindsAloftMulti(points, targetMs) {
    if (!Array.isArray(points) || points.length === 0) return null;

    const out = new Array(points.length).fill(null);
    const todo = new Map();   // clé cache → { lat, lon, idxs, targetMs }
    points.forEach((p, idx) => {
        if (p?.lat == null || p?.lon == null) return;
        const tMs = _targetMsFor(targetMs, idx);
        const key = `${p.lat.toFixed(1)},${p.lon.toFixed(1)}@${Math.floor(tMs / 3600000)}`;
        const cached = _cache.get(key);
        if (cached && Date.now() - cached.ts < TTL_MS) { out[idx] = cached.winds; return; }
        const t = todo.get(key);
        if (t) t.idxs.push(idx);
        else todo.set(key, { key, lat: p.lat, lon: p.lon, idxs: [idx], targetMs: tMs });
    });
    if (todo.size === 0) return out;

    try {
        // Variables isobariques (B1) — servies en `hourly` uniquement.
        const vars = LEVELS_HPA.flatMap(p => [`windspeed_${p}hPa`, `winddirection_${p}hPa`]).join(',');

        const list = [...todo.values()];
        const url = `${ENDPOINT}?latitude=${list.map(t => t.lat).join(',')}` +
            `&longitude=${list.map(t => t.lon).join(',')}` +
            `&hourly=${vars}&forecast_days=2&timezone=UTC`;

        let data;
        try { data = await fetchOpenMeteo(url); } catch { return out; }
        // Un seul point demandé → objet simple ; plusieurs → tableau
        // (une entrée par location, dans l'ordre des coordonnées).
        const arr = Array.isArray(data) ? data : (data ? [data] : null);
        if (!arr) return out;

        list.forEach((t, i) => {
            const winds = _parseWindsLocation(arr[i], t.targetMs);
            if (!winds) return;
            _cache.set(t.key, { winds, ts: Date.now() });
            for (const idx of t.idxs) out[idx] = winds;
        });
        return out;
    } catch (e) {
        console.warn('Winds aloft multi fetch failed:', e.message);
        return out;
    }
}

/**
 * Récupère les vents en altitude pour une position (cas particulier du
 * multi-points — même parsing, même cache).
 * @param {number} lat Latitude.
 * @param {number} lon Longitude.
 * @param {number} [targetMs] Heure de vol visée (défaut : maintenant).
 * @returns {Promise<Array<{altFt:number, speedKt:number, dir:number}>|null>}
 *   Liste des vents par surface isobare (ft AMSL, kt, degrés vrais d'origine).
 */
export async function fetchWindsAloft(lat, lon, targetMs) {
    if (lat == null || lon == null) return null;
    const arr = await fetchWindsAloftMulti([{ lat, lon }], targetMs);
    return arr ? arr[0] : null;
}

/**
 * Vent moyen d'un plan multi-tronçons : moyenne VECTORIELLE pondérée par
 * la distance (fiche 20). Une moyenne arithmétique des direction ferait
 * « 270° et 090° → 180° » — un vent de travers fantôme là où deux
 * tronçons opposés s'annulent en réalité.
 * @param {Array<{wind:{speedKt:number,dir:number}|null, weight:number}>} entries
 *   Une entrée par tronçon ; vent indisponible → ignoré.
 * @returns {{speedKt:number, dir:number}|null} null si aucune entrée valable.
 */
export function weightedMeanWind(entries) {
    if (!Array.isArray(entries)) return null;
    let u = 0, v = 0, w = 0;
    for (const e of entries) {
        const wt = Number(e?.weight);
        const wind = e?.wind;
        if (!wind || !(wt > 0) || !Number.isFinite(wind.speedKt) || !Number.isFinite(wind.dir)) continue;
        const rad = wind.dir * Math.PI / 180;
        // Direction météorologique = d'ORIGINE : le vecteur va VERS dir+180.
        u -= Math.sin(rad) * wind.speedKt * wt;
        v -= Math.cos(rad) * wind.speedKt * wt;
        w += wt;
    }
    if (!w) return null;
    const speedKt = Math.round(Math.hypot(u, v) / w);
    if (speedKt === 0) return { speedKt: 0, dir: 0 };
    const dir = ((Math.round(Math.atan2(-u, -v) * 180 / Math.PI) + 360) % 360) % 360;
    return { speedKt, dir };
}

/**
 * Obtient le vent interpolé à l'altitude de croisière du plan.
 * Interpolation linéaire entre les surfaces isobariques connues.
 * @param {Array} winds Liste issue de fetchWindsAloft — altFt en ft AMSL
 *   (altitudes pression ISA des surfaces, cf. HPA_TO_FT).
 * @param {number} altFt Altitude cible (ft AMSL/QNH).
 * @returns {{speedKt:number, dir:number}|null}
 */
export function getWindAtAltitude(winds, altFt) {
    if (!Array.isArray(winds) || winds.length === 0) return null;

    // Niveaux et croisière dans le MÊME référentiel (≈ AMSL) : lecture
    // directe. (L'ancienne conversion AGL par groundElevFt n'a plus
    // d'objet avec des surfaces isobariques.)

    // Sous la surface la plus basse → on renvoie la plus basse.
    if (altFt <= winds[0].altFt) return { speedKt: winds[0].speedKt, dir: winds[0].dir };
    // Au-dessus du plus haut → le plus haut.
    const last = winds[winds.length - 1];
    if (altFt >= last.altFt) return { speedKt: last.speedKt, dir: last.dir };

    // Trouve l'encadrement.
    for (let i = 0; i < winds.length - 1; i++) {
        const a = winds[i], b = winds[i + 1];
        if (altFt >= a.altFt && altFt <= b.altFt) {
            const t = (altFt - a.altFt) / (b.altFt - a.altFt);
            const speedKt = Math.round(a.speedKt + (b.speedKt - a.speedKt) * t);
            // Direction : interpolation circulaire (pour éviter le saut 359→001).
            const dir = _interpAngle(a.dir, b.dir, t);
            return { speedKt, dir };
        }
    }
    return null;
}

/**
 * Interpolation angulaire (gère le passage 360°→0°).
 */
function _interpAngle(a, b, t) {
    let diff = b - a;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    let r = a + diff * t;
    return Math.round(((r % 360) + 360) % 360);
}

/**
 * Invalide le cache session (utile pour les tests).
 */
export function _clearCache() { _cache.clear(); }
