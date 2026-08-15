import { state, I18N, fetchAvecRelais, memoGet, surfaceLabel } from './core.js';
import { getAirportByICAO, getAirportsInBbox } from './ui-module.js';
import { parseVisiToMeters, getCeiling } from './core.js';
import { HAZARD_COLORS } from './sigmet.js';
import { showRouteWeather } from './route-weather.js';
import { createPrecipController } from './radar-layer.js';
import { createAirspaceController } from './airspaces.js';
import { fetchPireps, pirepDisplayMeta } from './pireps.js';
import { getRunwayThresholds } from './runways-geo.js';

let _map = null;
let _precip = null;
let _airspaces = null;
let _sigmetLayer = null;
let _currentBaseLayer = null;
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

// Fonds de carte disponibles (source unique pour le basemap switcher).
const BASEMAPS = {
    satellite: () => L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
        maxZoom: 19, maxNativeZoom: 19,
    }),
    osm: () => L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }),
    dark: () => L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png', {
        attribution: '© CARTO © OpenStreetMap contributors', maxZoom: 19, subdomains: 'abcd',
    }),
    terrain: () => L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap (CC-BY-SA)', maxZoom: 17, subdomains: 'abc',
    }),
};

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

        // Fond de carte : mémorisé dans localStorage, satellite par défaut.
        const savedBase = localStorage.getItem('mt-basemap');
        const baseKey = (savedBase && BASEMAPS[savedBase]) ? savedBase : 'satellite';
        _currentBaseLayer = BASEMAPS[baseKey]().addTo(_map);
        el.dataset.baseLayer = baseKey;

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

    _sigmetLayer = createSigmetController(_map);
    _sigmetLayer.mountControls(bar);

    _mountZoomAirfieldButton(bar);

    _precip.toggleRadar(true);

    // Basemap switcher AJOUTÉ EN DERNIER (les autres contrôleurs pouvaient réorganiser la barre).
    try { _mountBasemapSwitcher(bar); } catch (e) { console.error('basemap switcher failed:', e.message); }

    // Écoute les mises à jour SIGMET émises par go-nogo.js (event custom 'sigmets-updated').
    document.addEventListener('sigmets-updated', (e) => {
        if (_sigmetLayer && e.detail) _sigmetLayer.refresh(e.detail);
    });

    // Redessine la route quand les waypoints changent (event émis par flight-planner-ui).
    // On ne redessine QUE la polyline + marqueurs, SANS recharger les METARs du corridor
    // (qui font 2 appels proxy et peuvent saturer si l'utilisateur tape rapidement).
    window.addEventListener('route-changed', () => {
        if (!_map || !_currentIcao) return;
        const toInput = document.getElementById('route-to-input');
        const toIcao = toInput?.value?.trim().toUpperCase();
        if (toIcao && /^[A-Z]{4}$/.test(toIcao) && toIcao !== _currentIcao.toUpperCase()) {
            showRouteWeather(_map, _currentIcao, toIcao, { skipMetars: true });
        }
    });
}

// Contrôleur SIGMET/AIRMET : trace les polygones de hazard sur la carte.
function createSigmetController(map) {
    let layer = null;
    let visible = true;
    let sigmets = [];

    function _redraw() {
        if (layer) { map.removeLayer(layer); layer = null; }
        if (!visible || !sigmets || !sigmets.length) return;

        const markers = [];
        for (const s of sigmets) {
            const color = HAZARD_COLORS[s.hazard] || HAZARD_COLORS.OTHER;
            const isAirmet = s.type === 'AIRMET';
            const label = isAirmet ? `AIRMET ${s.hazard}` : `SIGMET ${s.hazard}`;
            const popupHtml = `<div style="max-width:280px;"><b style="color:${color};">${label}</b><br>` +
                              `<pre style="white-space:pre-wrap; font-family:'DM Mono',monospace; font-size:11px; margin-top:4px;">${_escapeHtml(s.raw)}</pre></div>`;

            if (s.polygon && s.polygon.length >= 3) {
                markers.push(L.polygon(s.polygon, {
                    color, weight: 2, opacity: 0.9, fillColor: color, fillOpacity: 0.12,
                    dashArray: isAirmet ? '4 4' : null, zIndex: 500,
                }).bindPopup(popupHtml));
            } else if (s.center) {
                markers.push(L.circleMarker([s.center.lat, s.center.lon], {
                    radius: 8, color, weight: 2, fillColor: color, fillOpacity: 0.25, zIndex: 500,
                }).bindPopup(popupHtml));
            }
        }
        if (markers.length) {
            layer = L.layerGroup(markers).addTo(map);
        }
    }

    return {
        refresh(newSigmets) { sigmets = newSigmets || []; _redraw(); },
        toggle(on) { visible = on; _redraw(); },
        isVisible() { return visible; },
        mountControls(bar) {
            const isFr = state.lang === 'fr';
            const group = document.createElement('div');
            group.className = 'precip-control-group';
            group.innerHTML = `
                <button class="precip-toggle sigmet-toggle ${visible ? 'active' : ''}" aria-pressed="${String(visible)}" title="${isFr ? 'Afficher les SIGMET/AIRMET' : 'Show SIGMET/AIRMET'}">
                    <i data-lucide="alert-triangle" style="width:14px;height:14px;"></i>
                    <span>SIGMET</span>
                </button>`;
            bar.appendChild(group);
            if (window.lucide) window.lucide.createIcons({ root: group });
            group.querySelector('.sigmet-toggle')?.addEventListener('click', (ev) => {
                visible = !visible;
                ev.currentTarget.setAttribute('aria-pressed', String(visible));
                ev.currentTarget.classList.toggle('active', visible);
                _redraw();
            });
            // Replay : si des SIGMET ont déjà été fetchés avant l'init de la carte.
            if (state._sigmets && state._sigmets.length) {
                sigmets = state._sigmets;
                _redraw();
            }
        },
        destroy() { if (layer) map.removeLayer(layer); },
    };
}

function _escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// Sélecteur de fond de carte (satellite / OSM / sombre / relief).
function _mountBasemapSwitcher(bar) {
    if (!bar) return;
    const isFr = state.lang === 'fr';
    const group = document.createElement('div');
    group.className = 'precip-control-group';
    // Récupère le fond mémorisé pour pré-sélectionner le <select>.
    const savedBase = localStorage.getItem('mt-basemap');
    const currentBase = (savedBase && BASEMAPS[savedBase]) ? savedBase : 'satellite';
    const options = [
        ['satellite', 'Satellite'],
        ['osm',       isFr ? 'Plan'   : 'Map'],
        ['dark',      isFr ? 'Sombre' : 'Dark'],
        ['terrain',   isFr ? 'Relief' : 'Terrain'],
    ];
    group.innerHTML = `
        <select class="basemap-select" title="${isFr ? 'Fond de carte' : 'Base map'}" aria-label="${isFr ? 'Fond de carte' : 'Base map'}">
            ${options.map(([v, lbl]) => `<option value="${v}" ${v === currentBase ? 'selected' : ''}>${lbl}</option>`).join('')}
        </select>`;
    bar.appendChild(group);
    group.querySelector('.basemap-select')?.addEventListener('change', (ev) => {
        const key = ev.target.value;
        if (!BASEMAPS[key] || !_map) return;
        if (_currentBaseLayer) _map.removeLayer(_currentBaseLayer);
        _currentBaseLayer = BASEMAPS[key]().addTo(_map);
        _currentBaseLayer.bringToBack();   // les couches météo restent au-dessus
        const el = document.getElementById('regional-map');
        if (el) el.dataset.baseLayer = key;
        // Mémorise le choix pour les prochaines sessions.
        try { localStorage.setItem('mt-basemap', key); } catch (e) { /* localStorage indisponible */ }
    });
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

        // 1. Base locale : tous les aérodromes de la zone (piste >= 1000 ft).
        const localAirports = getAirportsInBbox(minLat, minLon, maxLat, maxLon);

        // 2. API AviationWeather : METAR des stations de la zone.
        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json`;
        const stations = await fetchAvecRelais(stationsUrl, 'json');

        const metarByCode = {};
        if (Array.isArray(stations)) {
            const nearby = stations
                .map(s => ({ code: s.icaoId || s.id }))
                .filter(s => s.code && /^[A-Z]{4}$/.test(s.code))
                .slice(0, 50);

            if (nearby.length > 0) {
                const idsStr = nearby.map(s => s.code).join(',');
                const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${idsStr}&format=json`;
                const metars = await fetchAvecRelais(metarUrl, 'json');
                if (Array.isArray(metars)) {
                    metars.forEach(m => {
                        const code = m.icaoId || m.stationId;
                        if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
                    });
                }
            }
        }

        _clearNeighborMarkers();

        // 3. Affiche tous les aérodromes de la base locale.
        // Ceux avec METAR → marker coloré ; ceux sans METAR → marker gris.
        localAirports.forEach(a => {
            if (a.icao === _currentIcao) return;
            const raw = metarByCode[a.icao];
            if (raw) {
                const cat = _categoryFromMetar(raw);
                if (cat) {
                    _addAirportMarker(a.lat, a.lon, a.icao, a.name, cat, false);
                    return;
                }
            }
            // Pas de METAR ou non catégorisable → marker gris.
            _addAirportMarker(a.lat, a.lon, a.icao, a.name, null, false);
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
        : cat
            ? `<strong>${escapeHtml(icao)}</strong>${name ? ' — ' + escapeHtml(name) : ''}<br><span style="color:${color};font-weight:700;">${cat.cat}</span>`
            : `<strong>${escapeHtml(icao)}</strong>${name ? ' — ' + escapeHtml(name) : ''}<br><span style="color:#94A3B8;font-weight:700;">${state.lang === 'fr' ? 'Sans METAR' : 'No METAR'}</span>`;

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
