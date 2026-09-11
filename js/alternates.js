import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO, getAirportsInBbox } from './ui-module.js';
import { parseVisiToMeters, getCeiling, CAT_COLORS } from './core.js';

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

        const rows = _attachMetars(picked, metarByCode, pool)
            .map(s => {
                const cat = _categoryFromMetar(s.raw);
                if (!cat) return null;
                return { ...s, cat, raw: s.raw };
            })
            .filter(Boolean);
        if (!rows.length) return null;
        return rows;   // _pickEvenSpread a déjà établi l'ordre du vol
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
    if (document.body.classList.contains('mode-nav')
        && /^[A-Z][A-Z0-9]{3}$/.test(toVal) && toVal !== depIcao) {
        const pts = _routePtsFromUI(depIcao, toVal);
        if (pts) {
            const token = ++_altSeq;
            const rows = await getEnRouteAlternates(pts, 25, 8);
            if (token !== _altSeq) return;   // saisie plus récente en cours
            if (rows && rows.length) {
                _render(rows, depIcao, { mode: 'route' });
                container.style.display = 'block';
                return;
            }
        }
        // Trajet non exploitable (coords manquantes, réseau…) : widget local.
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

        const rows = nearby
            .map(s => {
                const raw = metarByCode[s.code.toUpperCase()];
                if (!raw) return null;
                const cat = _categoryFromMetar(raw);
                if (!cat) return null;
                return { ...s, cat, raw };
            })
            .filter(Boolean);

        if (rows.length === 0) { container.style.display = 'none'; return; }

        const catPriority = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
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
        if (lat == null || lon == null) continue;   // p.ex. ZZxx non résolu
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

    rows.forEach(r => {
        const color = catColors[r.cat.cat];
        const visiM = r.cat.visiM;
        const ceilFt = r.cat.ceilHund === 999 ? null : r.cat.ceilHund * 100;
        const wind = r.cat.wind;

        const visiStr = visiM >= 10000 ? '>10km' : `${visiM}m`;
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
            <div class="alt-cell" style="color:${color}; font-weight:800;">${r.cat.cat}</div>
            <div class="alt-cell" style="${visiM < 5000 ? 'color:#FCA5A5;' : ''}">${visiStr}</div>
            <div class="alt-cell" style="${ceilFt !== null && ceilFt < 1500 ? 'color:#FCA5A5;' : ''}">${ceilStr}</div>
            <div class="alt-cell">${windStr}</div>
            ${isRoute ? `<div class="alt-cell">${r.offsetNm} NM ${r.side >= 0 ? (isFr ? 'D' : 'R') : (isFr ? 'G' : 'L')}</div>` : ''}
        `;
    });
    html += `</div>`;

    html += `<div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
        <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
        ${isRoute
            ? (isFr
                ? `8 terrains régulièrement espacés le long du trajet, dans l'ordre du vol. « * » : METAR de la station la plus proche. Cliquez un terrain pour le charger.`
                : `8 airfields evenly spaced along the route, in flight order. "*": METAR from the nearest reporting station. Click a field to load it.`)
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
}

function _categoryFromMetar(raw) {
    const visiMatch = raw.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : parseVisiToMeters('');

    let ceilHund = 999;
    const cloudMatches = [...raw.matchAll(/\b(BKN|OVC)(\d{3})/g)];
    cloudMatches.forEach(m => {
        const alt = parseInt(m[2], 10);
        if (alt < ceilHund) ceilHund = alt;
    });
    const vvMatch = raw.match(/\bVV(\d{3})\b/);
    if (vvMatch) ceilHund = parseInt(vvMatch[1], 10);
    if (/CAVOK|NSC|SKC|NCD/.test(raw)) ceilHund = 999;

    const windMatch = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    const wind = windMatch ? {
        variable: windMatch[1] === 'VRB',
        dir: windMatch[1] === 'VRB' ? null : parseInt(windMatch[1], 10),
        speed: parseInt(windMatch[2], 10),
        gust: windMatch[3] ? parseInt(windMatch[3], 10) : null,
    } : null;

    let cat;
    if (ceilHund < 5 || visiM < 1600) cat = 'LIFR';
    else if (ceilHund < 10 || visiM < 4800) cat = 'IFR';
    else if (ceilHund <= 30 || visiM <= 8000) cat = 'MVFR';
    else cat = 'VFR';

    return { cat, visiM, ceilHund, wind };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
