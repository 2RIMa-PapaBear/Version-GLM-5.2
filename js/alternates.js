import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, getCeiling, CAT_COLORS } from './core.js';

// ====================================================================
// ALTERNATES DE ROUTE — terrains à ± maxOffsetNm de la route prévue.
//
// Utilisé par le log de nav PDF (page « Performances et terrain ») :
// le pilote veut savoir où se dérouter en cours de route, pas seulement
// autour du départ. On récupère les stations dans la bbox englobante de
// la route (marge en degrés), puis on ne garde que celles dont la
// distance à la polyligne de la route est ≤ maxOffsetNm.
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
    if (atd < 0) return { nm: _haversineNm(p.lat, p.lon, a.lat, a.lon), side };
    if (atd > segLen) return { nm: _haversineNm(p.lat, p.lon, b.lat, b.lon), side };
    return { nm: Math.abs(xtd) * R_NM, side };
}

/**
 * Alternates viables le long d'une route.
 * @param {Array<{icao:string, lat:number, lon:number}>} routePts points de la
 *   route (départ, waypoints éventuels, destination).
 * @param {number} [maxOffsetNm=50] écart max à gauche ou à droite de la route.
 * @param {number} [maxRows=6] nombre de terrains retenus.
 * @returns {Promise<Array<{code,name,cat,visiM,ceilHund,wind,offsetNm,side}>|null>}
 *   null si les données ne sont pas récupérables (la section est alors omise
 *   du PDF) ; sinon les terrains triés par viabilité (catégorie puis écart).
 */
export async function getEnRouteAlternates(routePts, maxOffsetNm = 50, maxRows = 6) {
    if (!Array.isArray(routePts) || routePts.length < 2) return null;
    try {
        // Bbox englobante de la route + marge maxOffsetNm (corrigée en longitude
        // par la latitude médiane : 1° de lon ≈ cos(lat) × 60 NM).
        const lats = routePts.map(p => p.lat), lons = routePts.map(p => p.lon);
        const latMargin = maxOffsetNm / 60;
        const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
        const lonMargin = latMargin / Math.max(0.2, Math.cos(_toRad(midLat)));
        const bbox = [
            Math.min(...lats) - latMargin, Math.min(...lons) - lonMargin,
            Math.max(...lats) + latMargin, Math.max(...lons) + lonMargin,
        ].map(v => v.toFixed(3)).join(',');

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${bbox}&format=json`;
        const stations = await fetchAvecRelais(stationsUrl, 'json', 3600);
        if (!Array.isArray(stations)) return null;

        const routeIcaos = new Set(routePts.map(p => p.icao.toUpperCase()));
        const candidates = [];
        for (const s of stations) {
            const code = (s.icaoId || s.id || '').toUpperCase();
            if (!/^[A-Z]{4}$/.test(code) || routeIcaos.has(code)) continue;
            if (s.lat == null || s.lon == null) continue;
            // Distance à la polyligne = min sur tous les segments.
            let best = null;
            for (let i = 0; i < routePts.length - 1; i++) {
                const d = _distToSegmentNm(s, routePts[i], routePts[i + 1]);
                if (!best || d.nm < best.nm) best = d;
            }
            if (best.nm <= maxOffsetNm) {
                candidates.push({ code, name: s.site || s.name || '', lat: s.lat, lon: s.lon, offsetNm: best.nm, side: best.side });
            }
        }
        if (!candidates.length) return null;
        candidates.sort((a, b) => a.offsetNm - b.offsetNm);

        // METAR en masse sur les 24 plus proches de la route (limite l'URL).
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${candidates.slice(0, 24).map(s => s.code).join(',')}&format=json`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return null;
        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const rows = candidates
            .map(s => {
                const raw = metarByCode[s.code];
                if (!raw) return null;
                const cat = _categoryFromMetar(raw);
                if (!cat) return null;
                return { ...s, cat, raw };
            })
            .filter(Boolean);

        const catPriority = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
        rows.sort((a, b) => (catPriority[a.cat.cat] ?? 9) - (catPriority[b.cat.cat] ?? 9) || a.offsetNm - b.offsetNm);
        return rows.slice(0, maxRows);
    } catch (e) {
        console.warn('En-route alternates load failed:', e);
        return null;
    }
}

export async function showAlternates(icao) {
    const container = document.getElementById('alternates-container');
    if (!container) return;

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
            .filter(s => s.code && /^[A-Z]{4}$/.test(s.code) && s.code !== icao.toUpperCase())
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

        _render(rows.slice(0, 6), icao);
        container.style.display = 'block';

    } catch (e) {
        console.warn('Alternates load failed:', e);
        container.style.display = 'none';
    }
}

function _render(rows, destIcao) {
    const isFr = state.lang === 'fr';
    const list = document.getElementById('alternates-list');
    if (!list) return;

    const catColors = CAT_COLORS;

    const lblCat = isFr ? 'Cat.' : 'Cat.';
    const lblVisi = isFr ? 'Visi' : 'Visi';
    const lblCeil = isFr ? 'Plafond' : 'Ceiling';
    const lblWind = isFr ? 'Vent' : 'Wind';

    let html = `<div class="alternates-grid">`;
    html += `<div class="alt-header">${isFr ? 'Terrain' : 'Airfield'}</div>`;
    html += `<div class="alt-header">${lblCat}</div>`;
    html += `<div class="alt-header">${lblVisi}</div>`;
    html += `<div class="alt-header">${lblCeil}</div>`;
    html += `<div class="alt-header">${lblWind}</div>`;

    rows.forEach(r => {
        const color = catColors[r.cat.cat];
        const visiM = r.cat.visiM;
        const ceilFt = r.cat.ceilHund === 999 ? null : r.cat.ceilHund * 100;
        const wind = r.cat.wind;

        const visiStr = visiM >= 10000 ? '>10km' : `${visiM}m`;
        const ceilStr = ceilFt !== null ? `${ceilFt}ft` : (isFr ? '∞' : '∞');
        const windStr = wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3, '0') + '°'} ${wind.speed}${wind.gust ? 'G' + wind.gust : ''}` : '—';

        html += `
            <div class="alt-cell alt-cell-name" title="${escapeHtml(r.name)}" data-icao="${escapeHtml(r.code)}">
                <span class="alt-code">${escapeHtml(r.code)}</span>
                <span class="alt-name">${escapeHtml(r.name)}</span>
            </div>
            <div class="alt-cell" style="color:${color}; font-weight:800;">${r.cat.cat}</div>
            <div class="alt-cell" style="${visiM < 5000 ? 'color:#FCA5A5;' : ''}">${visiStr}</div>
            <div class="alt-cell" style="${ceilFt !== null && ceilFt < 1500 ? 'color:#FCA5A5;' : ''}">${ceilStr}</div>
            <div class="alt-cell">${windStr}</div>
        `;
    });
    html += `</div>`;

    html += `<div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
        <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
        ${isFr
            ? `Alternates viables autour de <strong>${escapeHtml(destIcao)}</strong>, triés par viabilité (catégorie de vol puis proximité). Cliquez un terrain pour le charger.`
            : `Viable alternates around <strong>${escapeHtml(destIcao)}</strong>, sorted by flight category then proximity. Click a field to load it.`}
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
