/* ================================================================
 * ROUTE WEATHER — Météo le long d'une route (corridor)
 * ================================================================
 *
 * CONTEXTE
 * --------
 * En navigation VFR, le pilote a besoin de savoir si la météo se
 * dégrade sur sa route, pas seulement à destination. Ce module trace
 * la ligne entre deux terrains (départ → destination) et récupère les
 * METARs des terrains proches de cette route pour afficher une "coupe
 * météo" du corridor.
 *
 * IMPLÉMENTATION
 * --------------
 * On calcule une boîte allongée le long du segment départ-destination,
 * on récupère les stations et METARs dans cette zone, puis on place
 * des marqueurs colorés (catégorie de vol) le long de la route sur la
 * carte régionale. On trace aussi la ligne de route elle-même.
 * ================================================================ */

import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters } from './core.js';

let _routeLayer = null;
let _routeMarkers = [];

/**
 * Affiche (ou met à jour) la météo de route entre deux terrains sur la
 * carte Leaflet passée en paramètre.
 * @param {L.Map} map Instance Leaflet.
 * @param {string} fromIcao Code OACI de départ.
 * @param {string} toIcao Code OACI de destination.
 */
export async function showRouteWeather(map, fromIcao, toIcao) {
    if (!map || !fromIcao || !toIcao || fromIcao === toIcao) {
        _clearRoute(map);
        return;
    }

    const fromApt = getAirportByICAO(fromIcao);
    const toApt = getAirportByICAO(toIcao);
    const fromMemo = memoGet(fromIcao);
    const toMemo = memoGet(toIcao);

    const fromLat = fromMemo?.lat ?? fromApt?.lat ?? null;
    const fromLon = fromMemo?.lon ?? fromApt?.lon ?? null;
    const toLat = toMemo?.lat ?? toApt?.lat ?? null;
    const toLon = toMemo?.lon ?? toApt?.lon ?? null;

    if (fromLat == null || toLat == null) {
        _clearRoute(map);
        return;
    }

    _clearRoute(map);

    // 1. Trace la ligne de route.
    _routeLayer = L.polyline([[fromLat, fromLon], [toLat, toLon]], {
        color: '#FBBF24',
        weight: 3,
        opacity: 0.7,
        dashArray: '8, 6',
    }).addTo(map);

    // 2. Marqueurs départ/destination.
    _addRouteEndpoint(map, fromLat, fromLon, fromIcao, true);
    _addRouteEndpoint(map, toLat, toLon, toIcao, false);

    // 3. Récupère les METARs le long du corridor.
    await _loadCorridorMetars(map, fromLat, fromLon, toLat, toLon);
}

/**
 * Récupère et place les METARs des terrains proches du corridor.
 */
async function _loadCorridorMetars(map, fromLat, fromLon, toLat, toLon) {
    try {
        // Boîte englobante élargie autour du segment.
        const minLat = Math.min(fromLat, toLat) - 1;
        const maxLat = Math.max(fromLat, toLat) + 1;
        const minLon = Math.min(fromLon, toLon) - 1;
        const maxLon = Math.max(fromLon, toLon) + 1;

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json&_t=${Date.now()}`;
        const stations = await fetchAvecRelais(stationsUrl, 'json');
        if (!Array.isArray(stations)) return;

        // Filtre les stations proches de la ligne (distance < ~0.8°).
        const corridorStations = stations
            .filter(s => {
                if (!s.icaoId || !/^[A-Z]{4}$/.test(s.icaoId)) return false;
                const d = _pointToSegmentDist(s.lat, s.lon, fromLat, fromLon, toLat, toLon);
                return d < 0.8;
            })
            .sort((a, b) => _pointToSegmentDist(a.lat, a.lon, fromLat, fromLon, toLat, toLon) - _pointToSegmentDist(b.lat, b.lon, fromLat, fromLon, toLat, toLon))
            .slice(0, 10);

        if (corridorStations.length === 0) return;

        // METARs groupés.
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${corridorStations.map(s => s.icaoId).join(',')}&format=json&_t=${Date.now()}`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return;

        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        // Place un marqueur pour chaque terrain du corridor avec sa catégorie.
        const catColors = { VFR: '#4ADE80', MVFR: '#38BDF8', IFR: '#F87171', LIFR: '#D946EF' };
        corridorStations.forEach(s => {
            const raw = metarByCode[s.icaoId.toUpperCase()];
            if (!raw) return;
            const cat = _categoryFromMetar(raw);
            const color = catColors[cat] || '#94A3B8';

            const marker = L.circleMarker([s.lat, s.lon], {
                radius: 6,
                fillColor: color,
                color: '#fff',
                weight: 1,
                opacity: 1,
                fillOpacity: 0.85,
            }).addTo(map);

            marker.bindTooltip(`<strong>${s.icaoId}</strong> — <span style="color:${color};font-weight:700;">${cat}</span>`, { direction: 'top' });
            _routeMarkers.push(marker);
        });
    } catch (e) {
        console.warn('Corridor METAR load failed:', e);
    }
}

function _addRouteEndpoint(map, lat, lon, icao, isStart) {
    const isFr = state.lang === 'fr';
    const marker = L.circleMarker([lat, lon], {
        radius: 11,
        fillColor: isStart ? '#4ADE80' : '#EF4444',
        color: '#fff',
        weight: 3,
        opacity: 1,
        fillOpacity: 0.9,
    }).addTo(map);
    marker.bindTooltip(`<strong>${isFr ? 'Départ' : 'Departure'}: ${icao}</strong>`, { direction: 'top', permanent: false });
    _routeMarkers.push(marker);
}

function _clearRoute(map) {
    if (_routeLayer && map) {
        map.removeLayer(_routeLayer);
        _routeLayer = null;
    }
    _routeMarkers.forEach(m => map.removeLayer(m));
    _routeMarkers = [];
}

/**
 * Distance entre un point et un segment (en degrés, approximation).
 */
function _pointToSegmentDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) return Math.hypot(px - x1, py - y1);
    let t = ((px - x1) * dx + (py - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
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

    if (ceilHund < 5 || visiM < 1600) return 'LIFR';
    if (ceilHund < 10 || visiM < 4800) return 'IFR';
    if (ceilHund <= 30 || visiM <= 8000) return 'MVFR';
    return 'VFR';
}
