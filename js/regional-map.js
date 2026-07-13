import { state, I18N, fetchAvecRelais, memoGet, surfaceLabel } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, getCeiling } from './core.js';
import { showRouteWeather } from './route-weather.js';
import { createPrecipController } from './radar-layer.js';
import { createAirspaceController } from './airspaces.js';
import { fetchPireps, pirepDisplayMeta } from './pireps.js';
import { getRunwayThresholds } from './runways-geo.js';

let _map = null;
let _precip = null;
let _airspaces = null;
let _pirepMarkers = [];
let _airportMarkers = [];
let _neighborMarkers = [];
let _currentIcao = null;

let _runwayLayer = null;
const RUNWAY_MIN_ZOOM = 11;

let _refreshToken = 0;
let _lastLoadedIcao = null;

// Marqueur de suivi du curseur d'élévation (déplacé en temps réel sur la carte).
let _cursorMarker = null;

// Synchronise le marqueur de carte avec le curseur du profil d'élévation.
document.addEventListener('elevation-hover', (e) => {
    if (!_map) return;
    const d = e.detail;
    if (!d) {
        // Curseur quitté : masque le marqueur.
        if (_cursorMarker) { _map.removeLayer(_cursorMarker); _cursorMarker = null; }
        return;
    }
    // Crée ou déplace le marqueur à la position du curseur.
    const latlng = [d.lat, d.lon];
    if (!_cursorMarker) {
        _cursorMarker = L.circleMarker(latlng, {
            radius: 6,
            fillColor: '#FBBF24',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.9,
            zIndexOffset: 1000,
        }).addTo(_map);
    } else {
        _cursorMarker.setLatLng(latlng);
    }
});

// Couleur du trait de piste selon le revêtement (codes FAA/OurAirports).
// Durs (asphalte/béton/bitume) = gris clair, herbe = vert, terre = ocre, etc.
const RUNWAY_SURFACE_COLORS = {
    ASP: '#CBD5E1', BIT: '#CBD5E1', CON: '#E2E8F0', MAC: '#CBD5E1',
    MIX: '#CBD5E1', PEM: '#CBD5E1', PER: '#CBD5E1', MEM: '#CBD5E1',
    COP: '#CBD5E1', COM: '#CBD5E1', BRI: '#D6A87A',
    GRS: '#4ADE80',
    GRE: '#D97706', CLA: '#D97706', SAN: '#D97706', LAT: '#D97706', COR: '#D97706',
    GVL: '#A8A29E',
    ICE: '#7DD3FC', SNO: '#7DD3FC',
    PSP: '#94A3B8',
    WAT: '#60A5FA',
    U:   '#94A3B8',
};
const RUNWAY_COLOR_DEFAULT = '#94A3B8';

/**
 * Retourne la couleur de trait pour un code de revêtement donné.
 */
function _runwayColorForSurface(code) {
    return RUNWAY_SURFACE_COLORS[code] || RUNWAY_COLOR_DEFAULT;
}

/**
 * Résout le code de revêtement d'une piste à partir de sa désignation.
 * Ordre : apt.runwaySurfaces[desig] (avec/sans suffixe LRC) → apt.surface.
 */
function _resolveRunwaySurface(apt, desig) {
    if (!apt) return null;
    if (!desig) return apt.surface || null;
    const key = desig.toUpperCase();
    const keyBase = key.replace(/[LRC]$/, '');
    if (apt.runwaySurfaces) {
        return apt.runwaySurfaces[key]
            || apt.runwaySurfaces[keyBase]
            || apt.surface
            || null;
    }
    return apt.surface || null;
}

export function toggleRegionalMap() {
    const panel = document.getElementById('regional-map-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
        setTimeout(() => _initOrRefresh(), 100);
    }
}

export function showRegionalMapFor(icao, force = false) {
    _currentIcao = icao;
    const panel = document.getElementById('regional-map-panel');
    if (panel && panel.classList.contains('open')) {
        if (force || _lastLoadedIcao !== _currentIcao || !_map) {
            _lastLoadedIcao = _currentIcao;
            _initOrRefresh();
        }
    }
}

async function _initOrRefresh() {
    if (!_currentIcao) return;

    const apt = getAirportByICAO(_currentIcao);
    const memo = memoGet(_currentIcao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) return;

    const myToken = ++_refreshToken;

    const isFirstInit = !_map;
    if (isFirstInit) {
        const el = document.getElementById('regional-map');
        if (!el || typeof L === 'undefined') return;
        
        _map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19 }).setView([lat, lon], 7);

        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
            maxZoom: 19, maxNativeZoom: 19,
        }).addTo(_map);

        el.dataset.baseLayer = 'satellite';

        _initLayerControls();

        _runwayLayer = L.layerGroup().addTo(_map);
        _map.on('zoomend', _updateRunwayVisibility);
    } else {
        _map.setView([lat, lon], 7);
    }

    _clearAirportMarkers();
    _clearNeighborMarkers();
    _clearPirepMarkers();
    _addAirportMarker(lat, lon, _currentIcao, apt?.name || _currentIcao, null, true);
    await _drawRunways(lat, lon, apt);

    if (_precip) _precip.preload();

    await _loadNeighborCategories(lat, lon);
    if (myToken !== _refreshToken) return;

    await _loadPireps(lat, lon);
    if (myToken !== _refreshToken) return;

    const toInput = document.getElementById('route-to-input');
    const toIcao = toInput?.value?.trim().toUpperCase();
    if (toIcao && /^[A-Z]{4}$/.test(toIcao) && toIcao !== _currentIcao.toUpperCase()) {
        await showRouteWeather(_map, _currentIcao, toIcao);
        if (myToken !== _refreshToken) return;
    }

    setTimeout(() => _map.invalidateSize(), 50);
}

function _initLayerControls() {
    let bar = document.getElementById('map-layers-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'map-layers-bar';
        bar.className = 'map-layers-bar';
        const mapEl = document.getElementById('regional-map');
        mapEl?.parentNode?.insertBefore(bar, mapEl);
    }

    _precip = createPrecipController(_map);
    _precip.mountControls(bar);

    _airspaces = createAirspaceController(_map);
    _airspaces.mountControls(bar);

    _mountZoomAirfieldButton(bar);

    _precip.toggleRadar(true);
}

function _mountZoomAirfieldButton(bar) {
    const isFr = state.lang === 'fr';
    const group = document.createElement('div');
    group.className = 'precip-control-group';
    group.innerHTML = `
        <button class="precip-toggle zoom-airfield-btn" title="${isFr ? 'Zoomer sur le terrain' : 'Zoom to airfield'}">
            <i data-lucide="locate-fixed" style="width:14px;height:14px;"></i>
            <span>${isFr ? 'Terrain' : 'Airfield'}</span>
        </button>`;
    bar.appendChild(group);
    if (window.lucide) window.lucide.createIcons({ root: group });

    group.querySelector('.zoom-airfield-btn')?.addEventListener('click', async () => {
        if (!_map || !_currentIcao) return;
        const apt = getAirportByICAO(_currentIcao);
        const memo = memoGet(_currentIcao);
        const lat = memo?.lat ?? apt?.lat ?? null;
        const lon = memo?.lon ?? apt?.lon ?? null;
        if (lat != null && lon != null) {
            _map.setView([lat, lon], 14, { animate: true });
            await _drawRunways(lat, lon, apt);
        }
    });
}

async function _loadNeighborCategories(lat, lon) {
    try {
        const minLat = lat - 2, maxLat = lat + 2;
        const minLon = lon - 2, maxLon = lon + 2;

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json&_t=${Date.now()}`;
        const stations = await fetchAvecRelais(stationsUrl, 'json');
        if (!Array.isArray(stations)) return;

        const nearby = stations
            .map(s => ({
                code: s.icaoId || s.id,
                lat: s.lat, lon: s.lon,
                dist: Math.pow(s.lat - lat, 2) + Math.pow(s.lon - lon, 2),
            }))
            .filter(s => s.code && /^[A-Z]{4}$/.test(s.code))
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 25);

        if (nearby.length === 0) return;

        const idsStr = nearby.map(s => s.code).join(',');
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${idsStr}&format=json&_t=${Date.now()}`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return;

        const metarByCode = {};
        metars.forEach(m => {
            const code = m.icaoId || m.stationId;
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        _clearNeighborMarkers();
        nearby.forEach(s => {
            if (s.code === _currentIcao) return;
            const raw = metarByCode[s.code];
            if (!raw) return;

            const cat = _categoryFromMetar(raw);
            if (!cat) return;
            _addAirportMarker(s.lat, s.lon, s.code, '', cat, false);
        });
    } catch (e) {
        console.warn('Neighbor categories load failed:', e);
    }
}

async function _loadPireps(lat, lon) {
    try {
        const pireps = await fetchPireps(lat, lon, 3);
        _clearPirepMarkers();
        if (pireps.length === 0) return;

        const isFr = state.lang === 'fr';
        pireps.forEach(p => {
            const meta = pirepDisplayMeta(p.type, p.intensity);
            const altStr = p.altFt != null ? ` · ${p.altFt} ft` : '';
            const marker = L.circleMarker([p.lat, p.lon], {
                radius: 7,
                fillColor: meta.color,
                color: '#fff',
                weight: 1.5,
                opacity: 1,
                fillOpacity: 0.9,
            }).addTo(_map);

            marker.bindTooltip(
                `<strong>${isFr ? meta.labelFr : meta.labelEn}</strong>${altStr}<br>
                 <span style="font-size:10px;color:var(--text-muted);">PIREP</span>`,
                { direction: 'top' }
            );
            _pirepMarkers.push(marker);
        });
    } catch (e) {
        console.warn('PIREPs load failed:', e);
    }
}

function _clearPirepMarkers() {
    _pirepMarkers.forEach(m => _map?.removeLayer(m));
    _pirepMarkers = [];
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

    if (ceilHund < 5 || visiM < 1600) return { cat: 'LIFR' };
    if (ceilHund < 10 || visiM < 4800) return { cat: 'IFR' };
    if (ceilHund <= 30 || visiM <= 8000) return { cat: 'MVFR' };
    return { cat: 'VFR' };
}

const CAT_PIN_COLORS = {
    VFR: '#4ADE80',
    MVFR: '#38BDF8',
    IFR: '#F87171',
    LIFR: '#D946EF',
};

function _addAirportMarker(lat, lon, icao, name, cat, isCurrent) {
    if (!_map) return;

    const color = isCurrent ? '#FBBF24' : (cat ? CAT_PIN_COLORS[cat.cat] || '#94A3B8' : '#94A3B8');
    const radius = isCurrent ? 10 : 7;

    const marker = L.circleMarker([lat, lon], {
        radius,
        fillColor: color,
        color: '#fff',
        weight: isCurrent ? 3 : 1.5,
        opacity: 1,
        fillOpacity: 0.85,
    }).addTo(_map);

    const label = isCurrent
        ? `<strong>${escapeHtml(icao)}</strong>${name ? ' — ' + escapeHtml(name) : ''}<br><em>${state.lang === 'fr' ? 'Terrain courant' : 'Current airport'}</em>`
        : `<strong>${escapeHtml(icao)}</strong> — <span style="color:${color};font-weight:700;">${cat?.cat || '?'}</span>`;

    marker.bindTooltip(label, { permanent: false, direction: 'top' });
    if (isCurrent) _airportMarkers.push(marker);
    else _neighborMarkers.push(marker);
}

function _clearAirportMarkers() {
    _airportMarkers.forEach(m => _map.removeLayer(m));
    _airportMarkers = [];
}

function _clearNeighborMarkers() {
    _neighborMarkers.forEach(m => _map.removeLayer(m));
    _neighborMarkers = [];
}

function _destinationPoint(lat, lon, bearing, distM) {
    const R = 6371000;
    const br = bearing * Math.PI / 180;
    const d = distM / R;
    const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

function _parseRunwayPairs(runways) {
    if (!Array.isArray(runways)) return [];
    const out = [];
    runways.forEach(pair => {
        const halves = String(pair).split('/').map(s => s.trim());
        halves.forEach(h => {
            const m = h.match(/^(\d{2}[LRC]?)\s*\((\d{3})°\)/);
            if (m) out.push({ desig: m[1], hdg: parseInt(m[2], 10) });
        });
    });
    return out;
}

async function _drawRunways(lat, lon, apt) {
    if (!_map || !_runwayLayer) return;
    _runwayLayer.clearLayers();
    if (!apt) return;

    const realThresholds = await getRunwayThresholds(_currentIcao);
    let drawn = [];

    if (realThresholds.length > 0) {
        drawn = realThresholds
            .filter(rw => isFinite(rw.lat) && isFinite(rw.lon) &&
                          isFinite(rw.lat2) && isFinite(rw.lon2))
            .map(rw => ({
                endA: [rw.lat, rw.lon],
                endB: [rw.lat2, rw.lon2],
                desigAtEndA: rw.desig,
                desigAtEndB: rw.desig2,
            }));
    }

    if (drawn.length === 0) {
        drawn = _computeRunwaysFromCentroid(lat, lon, apt);
    }

    if (drawn.length === 0) return;

    drawn.forEach(rw => {
        // Couleur du trait selon le revêtement (herbe=béton=terre...).
        const surfaceCode = _resolveRunwaySurface(apt, rw.desigAtEndB) || _resolveRunwaySurface(apt, rw.desigAtEndA);
        const rwColor = _runwayColorForSurface(surfaceCode);

        L.polyline([rw.endA, rw.endB], {
            color: rwColor, weight: 5, opacity: 0.9, lineCap: 'round',
        }).addTo(_runwayLayer);
        L.polyline([rw.endA, rw.endB], {
            color: '#1E293B', weight: 2.5, opacity: 1, lineCap: 'round', dashArray: '10,8',
        }).addTo(_runwayLayer);

        const mkIcon = txt => L.divIcon({
            className: 'runway-designator',
            html: `<span>${escapeHtml(txt)}</span>`,
            iconSize: [26, 14], iconAnchor: [13, 7],
        });
        if (rw.desigAtEndA) L.marker(rw.endA, { icon: mkIcon(rw.desigAtEndA) }).addTo(_runwayLayer);
        if (rw.desigAtEndB) L.marker(rw.endB, { icon: mkIcon(rw.desigAtEndB) }).addTo(_runwayLayer);
    });

    _updateRunwayVisibility();
}

function _computeRunwaysFromCentroid(lat, lon, apt) {
    const thresholds = _parseRunwayPairs(apt.runways);
    if (thresholds.length === 0) return [];

    const lenM = desig => apt.runwayLengths && apt.runwayLengths[desig]
        ? apt.runwayLengths[desig] * 0.3048 : null;
    const longestM = apt.longestRunway ? apt.longestRunway * 0.3048 : 2000;

    const used = new Set();
    const pairs = [];
    thresholds.forEach(t => {
        if (used.has(t.desig)) return;
        const oppHdg = (t.hdg + 180) % 360;
        const opp = thresholds.find(o =>
            !used.has(o.desig) && o.desig !== t.desig &&
            Math.abs(((o.hdg - oppHdg + 360) % 360 + 540) % 360 - 180) < 5
        );
        const rwLen = lenM(t.desig) || (opp ? lenM(opp.desig) : null) || longestM;
        pairs.push({ hdg: t.hdg, len: rwLen, desig1: t.desig, desig2: opp?.desig });
        used.add(t.desig);
        if (opp) used.add(opp.desig);
    });

    const groups = [];
    pairs.forEach(p => {
        let grp = groups.find(g => Math.abs(((g[0].hdg - p.hdg + 360) % 360 + 540) % 360 - 180) < 5);
        if (!grp) { grp = []; groups.push(grp); }
        grp.push(p);
    });

    const PARALLEL_SPACING_M = 300;
    const drawn = [];
    groups.forEach(grp => {
        grp.forEach((p, idx) => {
            const n = grp.length;
            const lateralOffset = (idx - (n - 1) / 2) * PARALLEL_SPACING_M;
            const perpBearing = (p.hdg + 90) % 360;
            const [clat, clon] = lateralOffset !== 0
                ? _destinationPoint(lat, lon, perpBearing, lateralOffset)
                : [lat, lon];
            const endA = _destinationPoint(clat, clon, p.hdg, p.len / 2);
            const endB = _destinationPoint(clat, clon, (p.hdg + 180) % 360, p.len / 2);
            drawn.push({ endA, endB, desigAtEndA: p.desig2, desigAtEndB: p.desig1 });
        });
    });
    return drawn;
}

function _updateRunwayVisibility() {
    if (!_map || !_runwayLayer) return;
    const show = _map.getZoom() >= RUNWAY_MIN_ZOOM;
    if (show && !_map.hasLayer(_runwayLayer)) _runwayLayer.addTo(_map);
    else if (!show && _map.hasLayer(_runwayLayer)) _map.removeLayer(_runwayLayer);
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = text;
    return el.innerHTML;
}