/* ================================================================
 * VFR MINIMA — minima météorologiques réglementaires par terrain du plan
 * ================================================================
 *
 * PRINCIPE : indicateur PURÉMENT INFORMATIF (même philosophie que le
 * givrage carburateur) — jamais un GO/NO-GO automatique, la clairance
 * VFR spécial reste à la discrétion du contrôleur.
 *
 * Règles évaluées (Vi ≤ 140 kt, aviation légère, sous FL100) :
 *  - espace CONTRÔLÉ (classe A-E) : visi ≥ 5 km et plafond ≥ 1500 ft ;
 *    règle pilote 26/09 (clearance D) : le « OK » plein exige en plus
 *    1000 ft de marge SOUS la couche à 1500 ft, soit base ≥ 2500 ft —
 *    entre 1500 et 2500 ft : conforme au réglementaire mais prudence
 *    (marge sous couche < 1000 ft, VFR spécial possible en dessous) ;
 *  - en dessous, VFR SPÉCIAL possible sur clairance : visi ≥ 1500 m et
 *    plafond ≥ 600 ft — INTERDIT DE NUIT ;
 *  - espace NON CONTRÔLÉ (F-G, sous la surface S) : visi ≥ 1500 m et
 *    plafond > 500 ft.
 *
 * Périmètre : DÉPART (METAR du moment), DESTINATION et DÉGAGEMENT
 * (TAF à l'heure d'arrivée estimée). Pas d'analyse en route par tronçon
 * (les groupes de zones du plan ne portent pas la classe d'espace).
 *
 * Structure : la partie PURE (évaluation + parsing METAR) est statique et
 * testée sous Node ; la collecte (espaces/météo réseau) utilise des
 * imports dynamiques pour garder le module importable par les tests.
 * ================================================================ */

import { state, memoGet, parseVisiToMeters, getCeiling, findActiveValueAtHour } from './core.js';

export const VFR_MINIMA = {
    CTRL_VISI_M: 5000,     // espace contrôlé sous FL100
    CTRL_CEIL_FT: 1500,
    CTRL_CLEARANCE_FT: 2500,   // règle pilote : base − 1000 ≥ 1500 (clearance D)
    SP_VISI_M: 1500,       // VFR spécial (clairance, hors nuit)
    SP_CEIL_FT: 600,
    UNCTRL_VISI_M: 1500,   // non contrôlé sous surface S à Vi ≤ 140 kt
    UNCTRL_CEIL_FT: 500,   // plafond strictement SUPÉRIEUR à 500 ft
};

/**
 * Évaluation PURE des minima pour un terrain.
 * @param {{controlled:boolean, visiM:number|null, ceilingFt:number|null,
 *          isNight?:boolean}} p
 * @returns {{level:'ok'|'caution'|'danger'|'unknown', key:string}}
 */
export function evaluateVfrMinima({ controlled, visiM, ceilingFt, isNight = false }) {
    if (visiM == null || ceilingFt == null || !Number.isFinite(visiM) || !Number.isFinite(ceilingFt)) {
        return { level: 'unknown', key: 'unknown' };
    }
    if (controlled) {
        // OK plein : minima réglementaire + règle pilote « clearance D »
        // (1000 ft sous la couche à 1500 ft → base ≥ 2500 ft).
        if (visiM >= VFR_MINIMA.CTRL_VISI_M && ceilingFt >= VFR_MINIMA.CTRL_CLEARANCE_FT) {
            return { level: 'ok', key: 'ctrl_ok' };
        }
        // Conforme au réglementaire mais < 1000 ft de marge sous couche :
        // prudence, jamais une suggestion de passer AU-DESSUS (règle BKN).
        if (visiM >= VFR_MINIMA.CTRL_VISI_M && ceilingFt >= VFR_MINIMA.CTRL_CEIL_FT) {
            return { level: 'caution', key: 'ctrl_clearance' };
        }
        if (visiM >= VFR_MINIMA.SP_VISI_M && ceilingFt >= VFR_MINIMA.SP_CEIL_FT) {
            return isNight ? { level: 'danger', key: 'sp_night' } : { level: 'caution', key: 'sp_needed' };
        }
        return { level: 'danger', key: 'ctrl_below' };
    }
    if (visiM >= VFR_MINIMA.UNCTRL_VISI_M && ceilingFt > VFR_MINIMA.UNCTRL_CEIL_FT) {
        return { level: 'ok', key: 'unctrl_ok' };
    }
    return { level: 'danger', key: 'unctrl_below' };
}

/**
 * Visibilité (m) et plafond (ft) extraits d'un METAR BRUT.
 * Tolérances format français : la visi porte souvent un suffixe (9999NDZ,
 * 3500ND — « pas de diminution »), les groupes nuages un genre (BKN043SC),
 * et le message se termine par « = ». Pur — testé sous Node.
 */
export function metarVisiCeiling(raw) {
    if (!raw) return null;
    const tokens = String(raw).replace(/=+\s*$/, '').split(/\s+/);
    let visiM = null;
    const clouds = [];
    let seenWind = false;
    for (const t of tokens) {
        if (/(KT|MPS)$/.test(t) && (/^\d{3}/.test(t) || /^VRB/.test(t) || /^\/{3,}/.test(t))) { seenWind = true; continue; }
        if (t === 'CAVOK') { visiM = 10000; continue; }
        if (visiM == null && /^\d{4}(NDZ|ND)?$/.test(t)) { visiM = parseInt(t.slice(0, 4), 10); continue; }
        if (/^(FEW|SCT|BKN|OVC|VV)\d{3}/.test(t)) {
            clouds.push(t);
            // Vent illisible (/////KT) : la visi peut suivre les nuages —
            // on continue à la chercher, sans dépendre de l'ordre.
            continue;
        }
    }
    if (visiM == null) {
        const sm = String(raw).match(/\b(\d{1,2})SM\b/);
        if (sm) visiM = Math.round(parseInt(sm[1], 10) * 1609.34);
    }
    if (visiM == null) return null;
    const hund = getCeiling(clouds.join(' '));   // centaines de ft ; 999 = illimité
    const ceilingFt = (hund === 999) ? 99999 : hund * 100;
    return { visiM, ceilingFt, clouds: clouds.join(' ') };
}

/** Heure cible sur l'axe du TAF (heures continues depuis 00:00 UTC du jour
 *  d'émission — cf. analyserTAF startH/startDay). */
function _tafHourFor(tafData, dateMs) {
    const anchor = Date.UTC(tafData.startYear, tafData.startMonth - 1, tafData.startDay);
    return (dateMs - anchor) / 3600000;
}

/** Visi/plafond d'un TAF à l'heure donnée (null si TAF illisible). */
export function tafVisiCeilingAt(tafData, dateMs) {
    if (!tafData?.base) return null;
    const h = _tafHourFor(tafData, dateMs);
    const visiStr = findActiveValueAtHour(tafData.base.visi, h) || '> 10 km';
    const nuageStr = findActiveValueAtHour(tafData.base.nuage, h) || 'CAVOK';
    const visiM = parseVisiToMeters(visiStr);
    const hund = getCeiling(nuageStr);
    return { visiM, ceilingFt: (hund === 999) ? 99999 : hund * 100, hour: Math.round(h * 10) / 10 };
}

// ----------------------------------------------------------------
// Collecte : contexte d'espace au sol + météo par terrain du plan.
// ----------------------------------------------------------------
const _ctxCache = new Map();   // icao → { zone, classe, controlled, ts }
const CTX_TTL = 30 * 60 * 1000;

async function _airspaceContext(icao, lat, lon) {
    const key = icao || `${lat.toFixed(3)}|${lon.toFixed(3)}`;
    const hit = _ctxCache.get(key);
    if (hit && Date.now() - hit.ts < CTX_TTL) return hit;
    let out = { zone: null, type: '', classe: '', controlled: false, ts: Date.now() };
    try {
        const { fetchAirspacesForBbox, _decodeType, _decodeIcaoClass } = await import('./airspaces.js');
        const { pointInAirspace, limitToFt } = await import('./airspace-profile.js');
        const d = 0.15;   // ~16 km autour du terrain
        const items = (await fetchAirspacesForBbox(lat - d, lon - d, lat + d, lon + d)) || [];
        let best = null;
        for (const it of items) {
            const lo = limitToFt(it.lowerLimit);
            if (lo == null || lo > 200) continue;   // uniquement les zones posées au sol
            if (!pointInAirspace(lat, lon, it.geometry)) continue;
            const type = _decodeType(it) || '';
            const classe = _decodeIcaoClass(it) || '';
            const rank = type.includes('CTR') ? 3 : (/TMA|CTA/.test(type) ? 2 : 0);
            const score = rank * 10 + (/^[A-E]$/.test(classe) ? 1 : 0);
            if (!best || score > best.score) best = { score, it, type, classe };
        }
        if (best) {
            out = {
                zone: String(best.it.name || best.type || '').trim().slice(0, 28),
                type: best.type, classe: best.classe,
                controlled: /CTR|TMA|CTA/.test(best.type) || /^[A-E]$/.test(best.classe),
                ts: Date.now(),
            };
        }
    } catch { /* cellules de zones indisponibles → réputé non contrôlé */ }
    _ctxCache.set(key, out);
    return out;
}

/**
 * Collecte les minima pour départ / destination / dégagement du plan.
 * @returns {Promise<Array<{role,icao,name,zone,classe,controlled,visiM,
 *   ceilingFt,source,when,isNight,verdict}>>}
 */
export async function collectVfrMinima(plan) {
    const [{ fetchMetarWithFallback, fetchTafWithFallback },
           { analyserTAF, isAeroNight },
           { getAirportByICAO }] = await Promise.all([
        import('./takeoff-performance.js'),
        import('./engine.js'),
        import('./ui-module.js'),
    ]);
    const etaMs = Date.now() + ((plan.totalTimeMin ?? plan.legTimeMin ?? 0) * 60000);
    const wps = Array.isArray(plan.waypoints) && plan.waypoints.length ? plan.waypoints : null;
    const dep = wps ? wps[0] : plan.from;
    const arr = wps ? wps[wps.length - 1] : plan.to;

    const pts = [];
    if (dep?.lat != null) pts.push({ role: 'dep', icao: dep.icao, lat: dep.lat, lon: dep.lon, when: Date.now(), kind: 'metar' });
    // ÉTAPES-POSÉES (retour pilote 25/09 : « LFEQ reste un point où je me
    // pose, il doit être dans le cadre minima VFR ») : SEULES les étapes
    // issues du champ « 2ᵉ ÉTAPE » du planificateur (state.routePoses) sont
    // des posées — TAF à l'heure de passage estimée (arrivée puis nouveau
    // départ dans la même fenêtre, le temps sol n'étant pas modélisé). Tout
    // autre point (aérodrome ajouté, repère perso, point VFR) est un point
    // tournant/de passage sans arrêt : pas de minima.
    const posesIcao = new Set((state.routePoses || []).map(c => String(c).toUpperCase()));
    if (wps && wps.length > 2 && Array.isArray(plan.legs)) {
        let cum = 0;
        for (let i = 0; i + 1 < wps.length && i < plan.legs.length; i++) {
            cum += plan.legs[i].legTimeMin ?? 0;
            const w = wps[i + 1];
            if (i + 1 < wps.length - 1 && w?.lat != null && posesIcao.has(String(w.icao).toUpperCase())) {
                pts.push({ role: 'etape', icao: w.icao, lat: w.lat, lon: w.lon, when: Date.now() + cum * 60000, kind: 'taf' });
            }
        }
    }
    if (arr?.lat != null) pts.push({ role: 'dest', icao: arr.icao, lat: arr.lat, lon: arr.lon, when: etaMs, kind: 'taf' });
    const divIcao = String(state?.diversionIcao || '').toUpperCase();
    if (/^[A-Z][A-Z0-9]{3}$/.test(divIcao) && divIcao !== String(arr?.icao || '').toUpperCase()) {
        const apt = getAirportByICAO(divIcao);
        const memo = memoGet(divIcao);
        const lat = memo?.lat ?? apt?.lat ?? null, lon = memo?.lon ?? apt?.lon ?? null;
        if (lat != null) pts.push({ role: 'div', icao: divIcao, lat, lon, when: etaMs + 30 * 60000, kind: 'taf' });
    }

    const rows = [];
    for (const p of pts) {
        const row = { role: p.role, icao: p.icao, name: null, zone: null, classe: '',
                      controlled: false, visiM: null, ceilingFt: null, source: null,
                      when: p.when, isNight: false, verdict: { level: 'unknown', key: 'unknown' } };
        try {
            const apt = getAirportByICAO(p.icao);
            row.name = apt?.name && apt.name !== p.icao ? apt.name : null;
        } catch { /* base locale indisponible */ }
        try {
            const ctx = await _airspaceContext(p.icao, p.lat, p.lon);
            row.zone = ctx.zone; row.classe = ctx.classe; row.controlled = ctx.controlled;
        } catch { /* garde le défaut non contrôlé */ }
        try {
            if (p.kind === 'metar') {
                // fetchMetarWithFallback renvoie {raw, from, distNm} (avec
                // substitution « olive grise » par la station proche) — le
                // parseur veut .raw.
                const m = await fetchMetarWithFallback(p.icao);
                const vc = metarVisiCeiling(m?.raw);
                if (vc) {
                    row.visiM = vc.visiM; row.ceilingFt = vc.ceilingFt;
                    row.source = m?.from ? `METAR ${m.from} · ${m.distNm} NM` : 'METAR';
                }
            } else {
                const t = await fetchTafWithFallback(p.icao);
                const taf = t?.raw ? analyserTAF(t.raw) : null;
                const vc = taf ? tafVisiCeilingAt(taf, p.when) : null;
                if (vc && vc.visiM != null) {
                    row.visiM = vc.visiM; row.ceilingFt = vc.ceilingFt;
                    row.source = t?.from ? `TAF ETA ${t.from} · ${t.distNm} NM` : 'TAF ETA';
                }
                if (row.visiM == null) {
                    // Pas de TAF exploitable (terrain sans prévisionniste) :
                    // dernier METAR connu, source explicite.
                    const m = await fetchMetarWithFallback(p.icao);
                    const mvc = metarVisiCeiling(m?.raw);
                    if (mvc) {
                        row.visiM = mvc.visiM; row.ceilingFt = mvc.ceilingFt;
                        row.source = m?.from ? `METAR ${m.from} · ${m.distNm} NM` : 'METAR';
                    }
                }
            }
        } catch { /* météo indisponible → ligne grisée */ }
        try {
            const { isAeroNight } = await import('./engine.js');
            row.isNight = isAeroNight(p.lat, p.lon, new Date(p.when));
        } catch { /* SunCalc indisponible */ }
        row.verdict = evaluateVfrMinima({ controlled: row.controlled, visiM: row.visiM, ceilingFt: row.ceilingFt, isNight: row.isNight });
        rows.push(row);
    }
    return rows;
}
