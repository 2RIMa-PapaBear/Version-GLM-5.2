import { state, I18N, fetchAvecRelais, memoGet, escapeHtml } from './core.js';
import { getAirportByICAO, getAirportsInBbox } from './ui-module.js';
import { parseVisiToMeters, parseWindGroupToKt, getCeiling, CAT_COLORS, getFlightCategory, parseMetarQnhOat } from './core.js';
import { getSiaAirfield } from './sia-data.js';
import { evaluateLandingFromRaw } from './takeoff-performance.js';
import { airspaceContextFor } from './vfr-minima.js';

// ====================================================================
// ALTERNATES DE ROUTE — TOUS les aérodromes à ± maxOffsetNm de la route
// prévue (base locale des terrains), avec ou sans METAR : si le terrain
// n'émet pas de METAR, on reprend celui de la STATION ÉMETTRICE LA PLUS
// PROCHE (substitution marquée « * » dans le log de nav).
//
// Utilisé par le log de nav PDF (page « Performances et terrain ») :
// le pilote veut savoir où se dérouter en cours de route, pas seulement
// autour du départ. On ne garde que les terrains dont la distance à la
// polyligne de la route est ≤ maxOffsetNm.
// ====================================================================

const R_NM = 3440.065;
const _toRad = d => d * Math.PI / 180;

// Distance angulaire (radians) entre deux points.
function _angDist(lat1, lon1, lat2, lon2) {
    const dLat = _toRad(lat2 - lat1), dLon = _toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(_toRad(lat1)) * Math.cos(_toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function _bearingRad(lat1, lon1, lat2, lon2) {
    const φ1 = _toRad(lat1), φ2 = _toRad(lat2), Δλ = _toRad(lon2 - lon1);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return Math.atan2(y, x);
}

function _haversineNm(lat1, lon1, lat2, lon2) {
    return _angDist(lat1, lon1, lat2, lon2) * R_NM;
}

/**
 * Distance d'un point au SEGMENT A→B (NM) — perpendiculaire si la projection
 * tombe dans le segment, distance à l'extrémité la plus proche sinon (ce qui
 * couvre les terrains au-delà du départ/arrivée).
 * @returns {{nm: number, side: number}} side : +1 à droite du tracé A→B, -1 à gauche.
 * Exporté pour les tests (qa géométrie de route).
 */
export function _distToSegmentNm(p, a, b) {
    const d13 = _angDist(a.lat, a.lon, p.lat, p.lon);
    const th13 = _bearingRad(a.lat, a.lon, p.lat, p.lon);
    const th12 = _bearingRad(a.lat, a.lon, b.lat, b.lon);
    const sinXtd = Math.max(-1, Math.min(1, Math.sin(d13) * Math.sin(th13 - th12)));
    const xtd = Math.asin(sinXtd);
    // Along-track SIGNÉ (atan2) : négatif si la projection tombe derrière A —
    // la forme acos perd ce signe (point dans l'axe opposé au segment).
    const atd = Math.atan2(Math.sin(d13) * Math.cos(th13 - th12), Math.cos(d13));
    const segLen = _angDist(a.lat, a.lon, b.lat, b.lon);
    const side = Math.sign(sinXtd) || 1;
    // atdNm/segLenNm : POSITION LE LONG DE LA ROUTE (pour répartir les
    // alternates — un point au-delà du segment est ramené à l'extrémité).
    const atdNm = Math.max(0, Math.min(atd, segLen)) * R_NM;
    const segLenNm = segLen * R_NM;
    if (atd < 0) return { nm: _haversineNm(p.lat, p.lon, a.lat, a.lon), side, atdNm, segLenNm };
    if (atd > segLen) return { nm: _haversineNm(p.lat, p.lon, b.lat, b.lon), side, atdNm, segLenNm };
    return { nm: Math.abs(xtd) * R_NM, side, atdNm, segLenNm };
}

/**
 * Pour chaque candidat : son METAR s'il émet, sinon celui de la STATION
 * émettrice la plus proche (substitution marquée metarFrom/metarDistNm).
 * Fonction pure — testée sous Node.
 * @param {Array} candidates terrains [{code, name, lat, lon, offsetNm, side}]
 * @param {Object} metarByCode METAR bruts par code OACI de station.
 * @param {Array} pool stations émettrices [{code, lat, lon}].
 */
export function _attachMetars(candidates, metarByCode, pool) {
    const emitters = pool.filter(s => s.code && metarByCode[s.code]);
    return candidates.map(c => {
        if (c.code && metarByCode[c.code]) {
            return { ...c, raw: metarByCode[c.code], metarFrom: null, metarDistNm: null };
        }
        let best = null;
        for (const s of emitters) {
            const d = _haversineNm(c.lat, c.lon, s.lat, s.lon);
            if (!best || d < best.d) best = { s, d };
        }
        if (!best) return null;
        return {
            ...c,
            raw: metarByCode[best.s.code],
            metarFrom: best.s.code,
            metarDistNm: Math.round(best.d),
        };
    }).filter(Boolean);
}

/**
 * QNH (hPa) et température (°C) extraits d'un METAR brut — null si le
 * groupe est absent. Alias de l'extracteur UNIQUE de core.js (fiche n°9,
 * audit 27/09 : gère aussi l'altimètre nord-américain Axxxx inHg → hPa ;
 * mêmes expressions que la page Performances du log de nav). Pur —
 * testé sous Node.
 */
export const _parseMetarQnhOat = parseMetarQnhOat;

/**
 * Verdict d'ATTERRISSAGE de l'avion ACTIF sur chaque alternate (audit
 * 27/09 — NCO.OP.105 : la suggestion de dégagement doit d'abord répondre
 * aux performances de l'aéronef, pas seulement au plancher générique de
 * piste de la base locale). Reprend TEL QUEL le calcul de la destination
 * du log de nav (evaluateLandingFromRaw : densité-altitude au METAR de
 * l'alternate — ou de la station de substitution —, vent axial sur la
 * piste prévue, revêtement/humidité, marge +20 %). Le résultat atterrit
 * dans `row.ldg` : {level: ok|caution|limitative|danger|unknown, message…}
 * ou null (références atterrissage flotte absentes, METAR sans QNH/temp).
 */
function _attachLandingPerf(rows) {
    return rows.map(row => {
        const { qnh, oat } = _parseMetarQnhOat(row.raw);
        if (!row.code || qnh == null || oat == null) return { ...row, ldg: null };
        const elevationFt = getSiaAirfield(row.code)?.elevFt
            ?? getAirportByICAO(row.code)?.elevation ?? null;
        return { ...row, ldg: evaluateLandingFromRaw(row.code, { raw: row.raw, qnh, oat, elevationFt }) };
    });
}

/**
 * Score de praticabilité d'un alternate comme terrain de DÉGAGEMENT
 * (arbitrage ①=C du 13/09 : proposition automatique + choix du pilote —
 * JAMAIS la météo seule). Composantes : catégorie de vol (pénalité forte
 * IMC), distance à la DESTINATION, ouverture H24 (SIA horAtsCode),
 * terrain privé (pénalité) et PERFORMANCES D'ATTERRISSAGE de l'avion
 * actif (audit 27/09 — NCO.OP.105 : un dégagement doit d'abord être
 * attérissable par l'appareil, le plancher de piste générique ne suffit
 * pas). `afInfo` injectable pour les tests.
 * @returns {{score:number, distNm:number, h24:boolean, prive:boolean, ldg:string|null}}
 *   score = Infinity quand l'atterrissage est impossible (brut > piste) :
 *   le terrain reste listé mais n'est JAMAIS proposé.
 */
export function _diversionScore(r, destPt, afInfo = null) {
    const catPenalty = { VMC: 0, MARGINAL: 3, IMC: 12 }[r.cat?.cat] ?? 8;
    // Verdict atterrissage (r.ldg, posé par _attachLandingPerf depuis
    // evaluateLandingFromRaw) : ok 0 · marge faible +1 · piste limitative +8
    // (utilisable aux vitesses exactes du manuel) · atterrissage impossible
    // → Infinity. null (références flotte absentes, METAR sans QNH/temp,
    // piste de longueur inconnue) → neutre.
    const ldgPenalty = { ok: 0, caution: 1, limitative: 8, danger: Infinity }[r.ldg?.level] ?? 0;
    const distNm = _haversineNm(destPt.lat, destPt.lon, r.lat, r.lon);
    const af = afInfo !== null ? afInfo : getSiaAirfield(r.code);
    const h24 = /H24/i.test(String(af?.horAtsCode || af?.horAts || ''));
    const prive = !!af?.prive;
    return {
        score: catPenalty + ldgPenalty + distNm * 0.15 + (h24 ? 0 : 2) + (prive ? 6 : 0),
        distNm: Math.round(distNm), h24, prive,
        ldg: r.ldg?.level ?? null,
    };
}

/** Tous les aérodromes du couloir — depuis la BASE LOCALE des terrains
 *  (airports.json en cache IndexedDB, déjà chargée pour l'autocomplétion).
 *  Zéro requête réseau : l'API openAIP (avant ici) renvoyait 429 à la
 *  génération du PDF — sans en-têtes CORS sur l'erreur, d'où des messages
 *  « blocked by CORS » trompeurs et la section alternates amputée.
 *  La base filtre d'office les terrains sans piste ≥ 1000 ft (~300 m),
 *  plancher raisonnable pour un déroutement. */
function _corridorAirports(minLat, minLon, maxLat, maxLon) {
    return getAirportsInBbox(minLat, minLon, maxLat, maxLon)
        .map(a => ({ code: _validIcao(a.icao), name: a.name || '', lat: a.lat, lon: a.lon }))
        .filter(a => a.code && Number.isFinite(a.lat) && Number.isFinite(a.lon));
}

/**
 * SÉLECTION RÉGULIÈRE le long du trajet (retour pilote 11/09 : « les 8
 * terrains les plus proches, régulièrement répartis, avec ou sans station
 * météo »). La route est découpée en maxRows SECTEURS ÉGAUX, chacun
 * représenté par une ANCRE au centre du secteur. Coût d'un terrain pour une
 * ancre = hypot(écart à la route, écart le long de la route) — distance
 * réelle au point idéal du trajet. Affectation gloutonne sur toutes les
 * paires (ancre, terrain) triées par coût croissant, chaque ancre et chaque
 * terrain ne servant qu'une fois, et une paire n'étant éligible que sous le
 * RAYON D'ANCRAGE : une grappe dense ne peut pas coloniser un secteur
 * lointain, et un secteur sans terrain à portée reste vide (trou réel du
 * couloir — mer, montagne) au lieu d'être comblé par un terrain agglutiné
 * ailleurs. La MÉTÉO ne joue AUCUN rôle dans la sélection — elle n'est
 * qu'une information affichée ensuite (METAR propre, sinon station la plus
 * proche via _attachMetars).
 * Fonction pure — testée sous Node.
 * @returns {Array} maxRows terrains au plus, dans l'ordre du vol.
 */
export function _pickEvenSpread(rows, maxRows, routeLen, anchorRadiusNm = 25) {
    const anchors = Array.from({ length: maxRows }, (_, i) => (i + 0.5) * (routeLen || 1) / maxRows);
    const pairs = [];
    rows.forEach((r, ri) => {
        anchors.forEach((a, ai) => {
            const cost = Math.hypot(r.offsetNm, r.atdNm - a);
            if (cost <= anchorRadiusNm) pairs.push({ ai, ri, cost });
        });
    });
    pairs.sort((x, y) => x.cost - y.cost);
    const usedRow = new Set(), usedAnchor = new Set(), picks = [];
    for (const p of pairs) {
        if (usedAnchor.has(p.ai) || usedRow.has(p.ri)) continue;
        usedAnchor.add(p.ai); usedRow.add(p.ri);
        picks.push(rows[p.ri]);
        if (picks.length >= maxRows) break;
    }
    picks.sort((a, b) => a.atdNm - b.atdNm);
    return picks;
}

/**
 * Alternates répartis régulièrement le long d'une route (retour pilote
 * 11/09) : les maxRows terrains les plus proches d'autant de points d'ancrage
 * réguliers, SANS distinction de leur météo — un terrain sans station
 * émettrice reçoit le METAR de la plus proche (marqué metarFrom/metarDistNm).
 * @param {Array<{icao:string, lat:number, lon:number}>} routePts points de la
 *   route (départ, waypoints éventuels, destination).
 * @param {number} [maxOffsetNm=25] écart max à gauche ou à droite de la route.
 * @param {number} [maxRows=8] nombre de terrains retenus.
 * @returns {Promise<Array<{code,name,cat,visiM,ceilHund,wind,offsetNm,side,
 *   atdNm,metarFrom,metarDistNm}>|null>} null si les données ne sont pas
 *   récupérables (la section est alors omise du PDF) ; sinon les terrains
 *   dans l'ordre du vol. metarFrom non nul = METAR repris de la station
 *   émettrice la plus proche (à metarDistNm).
 */
export async function getEnRouteAlternates(routePts, maxOffsetNm = 25, maxRows = 8) {
    if (!Array.isArray(routePts) || routePts.length < 2) return null;
    try {
        // Bbox englobante de la route + marge couloir (corrigée en longitude
        // par la latitude médiane : 1° de lon ≈ cos(lat) × 60 NM).
        const lats = routePts.map(p => p.lat), lons = routePts.map(p => p.lon);
        const latMargin = maxOffsetNm / 60;
        const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const lonMargin = latMargin / Math.max(0.2, Math.cos(_toRad(midLat)));
        const bbox = [
            Math.min(...lats) - latMargin, Math.min(...lons) - lonMargin,
            Math.max(...lats) + latMargin, Math.max(...lons) + lonMargin,
        ].map(v => v.toFixed(3)).join(',');

        // ---- Terrains du couloir : base locale (zéro réseau) ; repli sur
        // les stations aviationweather si la base IDB n'est pas encore là.
        const routeIcaos = new Set(routePts.map(p => String(p.icao || '').toUpperCase()).filter(Boolean));
        const candidates = [];

        const localItems = _corridorAirports(
            Math.min(...lats) - latMargin, Math.min(...lons) - lonMargin,
            Math.max(...lats) + latMargin, Math.max(...lons) + lonMargin);
        if (localItems.length) {
            candidates.push(...localItems);
        } else {
            const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${bbox}&format=json`;
            const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
            if (!Array.isArray(stations)) return null;
            for (const s of stations) {
                if (s.lat == null || s.lon == null) continue;
                candidates.push({ code: _validIcao(s.icaoId || s.id), name: s.site || s.name || '', lat: s.lat, lon: s.lon });
            }
        }

        // ---- Couloir : distance à la polyligne ≤ maxOffsetNm ; on écarte
        // aussi les terrains confondus avec un point de la route (départ,
        // arrivée, waypoints) même sans code OACI commun.
        // Longueurs cumulées des segments : position le long de la route.
        const segLens = [];
        let routeLen = 0;
        for (let i = 0; i < routePts.length - 1; i++) {
            const L = _angDist(routePts[i].lat, routePts[i].lon, routePts[i + 1].lat, routePts[i + 1].lon) * R_NM;
            segLens.push(L);
            routeLen += L;
        }
        const kept = [];
        for (const c of candidates) {
            if (c.code && routeIcaos.has(c.code)) continue;
            if (routePts.some(p => _haversineNm(c.lat, c.lon, p.lat, p.lon) < 1.5)) continue;
            let best = null, bestPos = 0;
            let cumul = 0;
            for (let i = 0; i < routePts.length - 1; i++) {
                const d = _distToSegmentNm(c, routePts[i], routePts[i + 1]);
                if (!best || d.nm < best.nm) { best = d; bestPos = cumul + d.atdNm; }
                cumul += segLens[i];
            }
            if (best.nm <= maxOffsetNm) {
                kept.push({ ...c, offsetNm: Math.round(best.nm), side: best.side, atdNm: bestPos });
            }
        }
        if (!kept.length) return null;

        // ---- SÉLECTION AVANT la météo (retour pilote 11/09) : les maxRows
        // terrains les plus proches d'ancres régulières, quel que soit leur
        // équipement météo — la météo ne peut plus influencer la répartition.
        // Rayon d'ancrage = couloir : un secteur sans terrain à portée reste
        // vide plutôt que de tirer un terrain agglutiné ailleurs.
        const picked = _pickEvenSpread(kept, maxRows, routeLen, maxOffsetNm);
        if (!picked.length) return null;

        // ---- METAR : pool des stations émettrices du couloir élargi, puis
        // substitution par la plus proche pour les terrains sans METAR.
        const poolMargin = latMargin + 25 / 60;
        const poolBbox = [
            Math.min(...lats) - poolMargin, Math.min(...lons) - lonMargin - 25 / 60 / Math.max(0.2, Math.cos(_toRad(midLat))),
            Math.max(...lats) + poolMargin, Math.max(...lons) + lonMargin + 25 / 60 / Math.max(0.2, Math.cos(_toRad(midLat))),
        ].map(v => v.toFixed(3)).join(',');
        const poolUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${poolBbox}&format=json`;
        const stations = await fetchAvecRelais(poolUrl, 'json', 3600);
        if (!Array.isArray(stations)) return null;
        const pool = stations
            .map(s => ({ code: _validIcao(s.icaoId || s.id), name: s.site || s.name || '', lat: s.lat, lon: s.lon }))
            .filter(s => s.code && s.lat != null && s.lon != null);

        const metarIds = [...new Set([...picked.map(c => c.code).filter(Boolean), ...pool.map(s => s.code)])].slice(0, 60);
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${metarIds.join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return null;
        const metarByCode = {};
        metars.forEach(m => {
            const code = _validIcao(m.icaoId || m.stationId);
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        // Contexte d'espace PAR TERRAIN (fiche n°3, audit 27/09) : la classe
        // C/D/E vs G conditionne les minima VMC (SERA.5005) — un dégagement
        // en classe G garde droit à la visi 1500 m, un terrain en TMA non.
        const ctxByCode = {};
        await Promise.all(picked.map(async c => {
            if (!c.code || c.lat == null) return;
            try { ctxByCode[c.code] = await airspaceContextFor(c.code, c.lat, c.lon); } catch { /* pire-cas */ }
        }));

        const rows = _attachMetars(picked, metarByCode, pool)
            .map(s => {
                const cat = _categoryFromMetar(s.raw, ctxByCode[s.code] ?? null);
                if (!cat) return null;
                return { ...s, cat, raw: s.raw };
            })
            .filter(Boolean);
        if (!rows.length) return null;
        // Verdict atterrissage de l'avion actif par terrain (NCO.OP.105) —
        // purement local (SIA + base terrains en mémoire), zéro requête.
        return _attachLandingPerf(rows);   // _pickEvenSpread a déjà établi l'ordre du vol
    } catch (e) {
        console.warn('En-route alternates load failed:', e);
        return null;
    }
}

function _validIcao(v) {
    const s = String(v || '').toUpperCase();
    return /^[A-Z][A-Z0-9]{3}$/.test(s) ? s : '';
}

export async function showAlternates(icao) {
    const container = document.getElementById('alternates-container');
    if (!container) return;

    const depIcao = String(icao || '').toUpperCase();

    // Mode Navigation avec destination (retour pilote 11/09) : le panneau
    // affiche les alternates RÉGULIÈREMENT RÉPARTIS LE LONG DU TRAJET — le
    // MÊME algorithme que le log de nav PDF (8 terrains, météo sans rôle,
    // substitution « * »). Classe .mode-nav posée par flight-mode.js (pas
    // d'import ici : flight-mode importe déjà ce module — cycle évité).
    const toVal = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
    // ALLER-RETOUR étapé (retour pilote 03/10) : destination = départ MAIS
    // des étapes posées → c'est toujours une route (state.route =
    // [départ, étapes…, départ]) : les alternates de trajet — et leurs
    // boutons « terrain de dégagement » — doivent être proposés, sinon le
    // panneau retombe en rendu local SANS bouton alors qu'un dégagement
    // reste actif au planificateur (impossible à changer).
    const boucleEtapee = toVal === depIcao && Array.isArray(state.route) && state.route.length >= 3;
    if (document.body.classList.contains('mode-nav')
        && /^[A-Z][A-Z0-9]{3}$/.test(toVal) && (toVal !== depIcao || boucleEtapee)) {
        const pts = _routePtsFromUI(depIcao, toVal);
        if (pts) {
            const token = ++_altSeq;
            const rows = await getEnRouteAlternates(pts, 25, 8);
            if (token !== _altSeq) return;   // saisie plus récente en cours
            if (rows && rows.length) {
                _render(rows, depIcao, { mode: 'route', to: toVal, destPt: pts[pts.length - 1] });
                container.style.display = 'block';
                return;
            }
        }
        // Trajet non exploitable (coords manquantes, réseau…) : widget local.
    }

    // Repli LOCAL alors qu'on est en navigation (retour pilote 03/10) : un
    // dégagement resté d'une route précédente ne doit pas rester affiché au
    // planificateur sans pouvoir être changé ici — on le retire proprement.
    if (document.body.classList.contains('mode-nav') && state.diversionIcao) {
        state.diversionIcao = null;
        document.dispatchEvent(new CustomEvent('diversion-changed', { detail: {} }));
    }

    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    if (lat == null || lon == null) {
        container.style.display = 'none';
        return;
    }

    try {

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${lat - 3},${lon - 3},${lat + 3},${lon + 3}&format=json`;
        const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
        if (!Array.isArray(stations)) { container.style.display = 'none'; return; }

        const nearby = stations
            .map(s => ({
                code: s.icaoId || s.id,
                name: s.site || s.name || '',
                lat: s.lat, lon: s.lon,
                dist: Math.pow(s.lat - lat, 2) + Math.pow(s.lon - lon, 2),
            }))
            .filter(s => s.code && /^[A-Z][A-Z0-9]{3}$/.test(s.code) && s.code !== icao.toUpperCase())
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 12);

        if (nearby.length === 0) { container.style.display = 'none'; return; }

        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${nearby.map(s => s.code).join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) { container.style.display = 'none'; return; }

        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        // Contexte d'espace PAR TERRAIN (fiche n°3) : minima VMC selon la
        // classe C/D/E vs G (SERA.5005) — cache 30 min, pire-cas si absent.
        const ctxByCode = {};
        await Promise.all(nearby.map(async s => {
            if (!s.code || s.lat == null) return;
            try { ctxByCode[s.code.toUpperCase()] = await airspaceContextFor(s.code, s.lat, s.lon); } catch { /* pire-cas */ }
        }));

        const rows = nearby
            .map(s => {
                const raw = metarByCode[s.code.toUpperCase()];
                if (!raw) return null;
                const cat = _categoryFromMetar(raw, ctxByCode[s.code.toUpperCase()] ?? null);
                if (!cat) return null;
                return { ...s, cat, raw };
            })
            .filter(Boolean);

        if (rows.length === 0) { container.style.display = 'none'; return; }

        const catPriority = { VMC: 0, MARGINAL: 1, IMC: 2 };
        rows.sort((a, b) => (catPriority[a.cat.cat] ?? 9) - (catPriority[b.cat.cat] ?? 9) || a.dist - b.dist);

        _render(rows.slice(0, 6), icao, { mode: 'local' });
        container.style.display = 'block';

    } catch (e) {
        console.warn('Alternates load failed:', e);
        container.style.display = 'none';
    }
}

let _altSeq = 0;   // invalide un calcul de route lancé pour une saisie dépassée

// Séquence de la navigation courante (départ → waypoints → destination),
// coordonnées résolues par la base locale puis le cache mémoire. La séquence
// state.route n'est reprise que si elle correspond au départ/destination
// SAISIS (un plan pas encore recalculé ne doit pas imposer sa géométrie).
function _routePtsFromUI(depIcao, toVal) {
    let seq = [depIcao, toVal];
    if (Array.isArray(state.route) && state.route.length >= 2) {
        const first = String(state.route[0] || '').toUpperCase();
        const last = String(state.route[state.route.length - 1] || '').toUpperCase();
        if (first === depIcao && last === toVal) {
            seq = state.route.map(c => String(c || '').toUpperCase());
        }
    }
    const pts = [];
    for (const code of seq) {
        const apt = getAirportByICAO(code);
        const memo = memoGet(code);
        const lat = memo?.lat ?? apt?.lat ?? null, lon = memo?.lon ?? apt?.lon ?? null;
        if (lat == null || lon == null) continue;   // p.ex. repère libre non résolu
        pts.push({ icao: code, lat, lon });
    }
    return pts.length >= 2 ? pts : null;
}

function _render(rows, depIcao, ctx = { mode: 'local' }) {
    const isFr = state.lang === 'fr';
    const list = document.getElementById('alternates-list');
    if (!list) return;

    const catColors = CAT_COLORS;
    const isRoute = ctx.mode === 'route';

    // Titre du panneau (retour pilote 11/09 soir : simplement « Alternates »
    // dans les deux modes — la note en bas distingue trajet / autour du
    // terrain). setLanguage réécrit #lbl-alternates, puis showAlternates est
    // rappelé et repose le bon titre.
    const titleEl = document.getElementById('lbl-alternates');
    if (titleEl) {
        titleEl.textContent = isRoute
            ? (isFr ? 'Alternates' : 'Alternates')
            : (I18N[state.lang]?.alternatesTitle || 'Alternates');
    }

    let html = `<div class="alternates-grid${isRoute ? ' route' : ''}">`;
    html += `<div class="alt-header">${isFr ? 'Terrain' : 'Airfield'}</div>`;
    html += `<div class="alt-header">${isFr ? 'Cat.' : 'Cat.'}</div>`;
    html += `<div class="alt-header">${isFr ? 'Visi' : 'Visi'}</div>`;
    html += `<div class="alt-header">${isFr ? 'Plafond' : 'Ceiling'}</div>`;
    html += `<div class="alt-header">${isFr ? 'Vent' : 'Wind'}</div>`;
    if (isRoute) html += `<div class="alt-header">${isFr ? 'Écart' : 'Off rte'}</div>`;
    if (isRoute) html += `<div class="alt-header">${isFr ? 'Dégagement' : 'Alternate to'}</div>`;

    // Dégagement courant : doit rester un terrain du trajet — destination
    // changée → liste renouvelée sans lui → purge silencieuse.
    if (isRoute && state.diversionIcao && !rows.some(r => r.code === state.diversionIcao)) {
        state.diversionIcao = null;
    }
    // Proposition (①=C) : le plus praticable à défaut de choix du pilote —
    // IMC jamais proposé (terrain sous les minima VMC = pas un dégagement),
    // pas plus qu'un terrain où l'atterrissage est IMPOSSIBLE pour l'avion
    // actif (NCO.OP.105 : score infini posé par _diversionScore).
    let recoCode = null;
    if (isRoute && ctx.destPt && !state.diversionIcao) {
        let best = null;
        for (const r of rows) {
            if (r.cat.cat === 'IMC') continue;
            const s = _diversionScore(r, ctx.destPt);
            if (!Number.isFinite(s.score)) continue;
            if (!best || s.score < best.score) best = { code: r.code, s };
        }
        recoCode = best?.code ?? null;
    }

    // Libellé de catégorie (fiche n°3) : VMC / LIMITE (MARGINAL) / IMC.
    const catLbl = (c) => (c === 'MARGINAL' ? (isFr ? 'LIMITE' : 'MARGINAL') : c);

    rows.forEach(r => {
        const color = catColors[r.cat.cat];
        const visiM = r.cat.visiM;
        const ceilFt = r.cat.ceilHund === 999 ? null : r.cat.ceilHund * 100;
        const wind = r.cat.wind;

        const visiStr = visiM == null ? '—' : (visiM >= 10000 ? '>10km' : `${visiM}m`);
        const ceilStr = ceilFt !== null ? `${ceilFt}ft` : '∞';
        const windStr = wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3, '0') + '°'} ${wind.speed}${wind.gust ? 'G' + wind.gust : ''}` : '—';
        const star = r.metarFrom ? '*' : '';
        const nameTitle = r.metarFrom
            ? `${r.name} — ${isFr ? 'METAR de' : 'METAR from'} ${r.metarFrom} (${r.metarDistNm} NM)`
            : r.name;

        html += `
            <div class="alt-cell alt-cell-name" title="${escapeHtml(nameTitle)}" data-icao="${escapeHtml(r.code)}">
                <span class="alt-code">${escapeHtml(r.code)}${star}</span>
                <span class="alt-name">${escapeHtml(r.name)}</span>
            </div>
            <div class="alt-cell" style="color:${color}; font-weight:800;">${catLbl(r.cat.cat)}</div>
            <div class="alt-cell" style="${visiM != null && visiM < 5000 ? 'color:#FCA5A5;' : ''}">${visiStr}</div>
            <div class="alt-cell" style="${ceilFt !== null && ceilFt < 1500 ? 'color:#FCA5A5;' : ''}">${ceilStr}</div>
            <div class="alt-cell">${windStr}</div>
            ${isRoute ? `<div class="alt-cell">${r.offsetNm} NM ${r.side >= 0 ? (isFr ? 'D' : 'R') : (isFr ? 'G' : 'L')}</div>` : ''}
            ${isRoute ? (() => {
                const chosen = state.diversionIcao === r.code;
                const reco = recoCode === r.code;
                const d = ctx.destPt ? _diversionScore(r, ctx.destPt) : { distNm: null, h24: false, prive: false };
                const bits = d.distNm != null ? [`${d.distNm} NM ${isFr ? 'de l\u2019arrivée' : 'from destination'}`] : [];
                if (d.h24) bits.push('H24');
                if (d.prive) bits.push(isFr ? 'privé' : 'private');
                if (d.ldg === 'limitative') bits.push(isFr ? 'piste limitative' : 'limiting runway');
                if (d.ldg === 'danger') bits.push(isFr ? 'piste insuffisante' : 'runway too short');
                const title = chosen
                    ? (isFr ? `Terrain de dégagement du devis carburant (${bits.join(' · ')}) — cliquer pour retirer` : `Fuel plan alternate field (${bits.join(' · ')}) — click to clear`)
                    : (isFr ? `Utiliser comme terrain de dégagement — branche carburant du plan (${bits.join(' · ')})` : `Use as alternate field — fuel plan branch (${bits.join(' · ')})`);
                // Marqueur performances atterrissage (NCO.OP.105) : le bouton
                // reste cliquable (choix du pilote) mais l'avertissement est
                // visible — le message complet du verdict est dans le title.
                const ldgLevel = r.ldg?.level || null;
                const ldgWarn = (ldgLevel === 'danger' || ldgLevel === 'limitative')
                    ? `<span class="alt-ldg-warn${ldgLevel === 'danger' ? ' danger' : ''}" title="${escapeHtml(r.ldg.message || '')}">⚠</span>`
                    : '';
                return `<div class="alt-cell alt-div-cell">
                    ${ldgWarn}
                    <button class="alt-divert${chosen ? ' on' : ''}${reco ? ' reco' : ''}" data-icao="${escapeHtml(r.code)}"
                        title="${escapeHtml(title)}" aria-pressed="${chosen ? 'true' : 'false'}">
                        <i data-lucide="${chosen ? 'flag' : 'plus'}" style="width:13px;height:13px;"></i>
                    </button>
                    ${reco ? `<span class="alt-reco">${isFr ? 'Recommandé' : 'Suggested'}</span>` : ''}
                </div>`;
            })() : ''}
        `;
    });
    html += `</div>`;

    html += `<div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
        <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
        ${isRoute
            ? (isFr
                ? `8 terrains régulièrement espacés le long du trajet, dans l'ordre du vol. « * » : METAR de la station la plus proche. Cliquez un terrain pour le charger. Le bouton <strong>+</strong> le désigne <strong>terrain de dégagement</strong> : la branche carburant (destination → dégagement) s'ajoute au devis — Trajet + Dégagement + Réserve 30 min. <strong>⚠</strong> : piste limitative ou insuffisante pour l'avion actif (performances d'atterrissage de la flotte, jamais proposée comme dégagement si insuffisante).`
                : `8 airfields evenly spaced along the route, in flight order. "*": METAR from the nearest reporting station. Click a field to load it. The <strong>+</strong> button marks it as the <strong>alternate field</strong>: its fuel branch (destination → alternate) is added to the fuel plan — Trip + Alternate + Reserve. <strong>⚠</strong>: limiting or insufficient runway for the active aircraft (fleet landing performance — never suggested as an alternate when insufficient).`)
            : (isFr
                ? `Alternates viables autour de <strong>${escapeHtml(depIcao)}</strong>, triés par viabilité (catégorie de vol puis proximité). Cliquez un terrain pour le charger.`
                : `Viable alternates around <strong>${escapeHtml(depIcao)}</strong>, sorted by flight category then proximity. Click a field to load it.`)}
    </div>`;

    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: list });

    list.querySelectorAll('.alt-cell-name').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
            const targetIcao = cell.dataset.icao;
            if (targetIcao) {
                document.getElementById('icaoInput').value = targetIcao;
                document.getElementById('btn-fetch-metar').click();
            }
        });
    });

    // Bouton « terrain de dégagement » (mode trajet) : toggle du choix pilote,
    // re-render local (aucun réseau) et recalcul du plan — le devis carburant
    // et le centrage suivent l'événement.
    if (isRoute) {
        list.querySelectorAll('.alt-divert').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const code = btn.dataset.icao;
                state.diversionIcao = (state.diversionIcao === code) ? null : code;
                _render(rows, depIcao, ctx);
                document.dispatchEvent(new CustomEvent('diversion-changed', { detail: { from: depIcao, to: ctx.to } }));
            });
        });
    }
}

function _categoryFromMetar(raw, ctx = null) {
    // Fiche n°15 (audit 27/09) : l'ancre du groupe vent accepte les 3 unités
    // OACI (KT/MPS/KMH) — sinon la visi d'un METAR MPS était perdue.
    const visiMatch = raw.match(/(?:KT|MPS|KMH)(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    // Visi absente du groupe = null (pas de 10 km implicite — ré-audit 26/09).
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : null;

    let ceilHund = 999;
    const cloudMatches = [...raw.matchAll(/\b(BKN|OVC)(\d{3})/g)];
    cloudMatches.forEach(m => {
        const alt = parseInt(m[2], 10);
        if (alt < ceilHund) ceilHund = alt;
    });
    const vvMatch = raw.match(/\bVV(\d{3})\b/);
    if (vvMatch) ceilHund = parseInt(vvMatch[1], 10);
    if (/CAVOK|NSC|SKC|NCD/.test(raw)) ceilHund = 999;

    // Vent décodé par le parseur canonique (KT/MPS/KMH → kt, fiche n°15).
    const wind = parseWindGroupToKt(raw);

    // Catégorie VMC/IMC (SERA.5005) conditionnée par la classe d'espace du
    // terrain quand le contexte est fourni — pire-cas sinon (fiche n°3).
    const cat = getFlightCategory(visiM, ceilHund, ctx).cat;

    return { cat, visiM, ceilHund, wind };
}

// escapeHtml vient de core.js (dédupliqué 26/09).
