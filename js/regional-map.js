/* ================================================================
 * REGIONAL MAP — Carte régionale : radar précip + catégories voisines
 * ================================================================
 *
 * FONCTIONNALITÉ
 * --------------
 * Une carte interactive (Leaflet) qui superpose :
 *  1. Un fond de carte au choix : sombre (CartoDB), satellite (Esri World
 *     Imagery, zoom jusqu'à 19 pour détailler les pistes) ou carte
 *     aéronautique VFR (OpenFlightMaps).
 *  2. Le radar précipitations (RainViewer) — le temps qui arrive.
 *  3. Le terrain courant (marqueur central) + ses pistes tracées en
 *     vecteur quand on zoome (zoom ≥ 11).
 *  4. Les terrains voisins avec leur catégorie de vol (VFR/MVFR/IFR/LIFR)
 *     calculée depuis le dernier METAR — awareness régional.
 *
 * FONDS DE CARTE
 * --------------
 *  - Sombre : CartoDB dark_all (gratuit, sans clé).
 *  - Satellite : Esri World Imagery (gratuit, sans clé, CORS natif,
 *    zoom natif 19 — photos aériennes montrant les pistes).
 *  - Aéro : OpenFlightMaps VFR (peut nécessiter clé/être temporairement
 *    indispo ; fallback transparent si les tuiles ne chargent pas).
 *
 * PISTES VECTORIELLES
 * -------------------
 * Les seuils de piste sont tracés à partir de leurs coordonnées RÉELLES
 * (lat/lon) issues du CSV OurAirports (domaine public, cache IndexedDB).
 * Cela permet de représenter correctement les pistes sécantes (ex. 04/22 et
 * 08/26) que le calcul depuis le centroïde ne savait pas gérer.
 * Tracé uniquement au zoom ≥ 11 pour éviter l'encombrement.
 *
 * CATÉGORIES VOISINES
 * -------------------
 * On interroge l'API AviationWeather pour les METARs des terrains dans un
 * rayon de ~2° autour du terrain courant, puis on calcule la catégorie de
 * vol de chacun et on place un marqueur coloré.
 * ================================================================ */

import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, getCeiling } from './core.js';
import { showRouteWeather } from './route-weather.js';
import { createPrecipController } from './radar-layer.js';
import { createAirspaceController } from './airspaces.js';
import { fetchPireps, pirepDisplayMeta } from './pireps.js';
import { getRunwayThresholds } from './runways-geo.js';

let _map = null;
let _precip = null;        // contrôleur radar + satellite animé.
let _airspaces = null;     // contrôleur espaces aériens OpenAIP.
let _pirepMarkers = [];    // marqueurs PIREPs (rapports pilotes).
let _airportMarkers = [];   // marqueur du terrain courant (singleton).
let _neighborMarkers = [];  // marqueurs des terrains voisins (catégories).
let _currentIcao = null;

// Fonds de carte commutables.
let _baseLayers = null;    // { dark, satellite }
let _activeBaseLayer = 'satellite';  // satellite par défaut (voit les pistes).
let _runwayLayer = null;   // L.layerGroup des pistes vectorielles.
const RUNWAY_MIN_ZOOM = 11; // zoom minimal pour tracer les pistes.

// Garde-fou contre les appels concurrents de _initOrRefresh : seul le dernier
// survit, les autres sont annulés (évite le clignotement des marqueurs quand
// plusieurs refresh se chevauchent via les callbacks de genererGraphique).
let _refreshToken = 0;
let _lastLoadedIcao = null; // dernier terrain dont les marqueurs ont été chargés.

/**
 * Initialise/bascule la visibilité du panneau carte.
 */
export function toggleRegionalMap() {
    const panel = document.getElementById('regional-map-panel');
    if (!panel) return;
    const isOpen = panel.classList.toggle('open');
    if (isOpen) {
        // La carte doit être initialisée après que le panneau est visible
        // (Leaflet a besoin de dimensions calculées).
        setTimeout(() => _initOrRefresh(), 100);
    }
}

/**
 * Met à jour la carte avec le terrain courant (appelé après chargement météo).
 * showRegionalMapFor est appelé à chaque rendu (3-6 fois par fetch via
 * genererGraphique). On ne déclenche un refresh complet que si l'ICAO a changé
 * ou si la carte n'est pas encore initialisée pour ce terrain. Sinon, on ne
 * fait rien — la carte est déjà à jour, pas de clignotement.
 *
 * @param {string} icao  Code OACI du terrain à afficher.
 * @param {boolean} [force]  Force le refresh (ex: changement de route).
 */
export function showRegionalMapFor(icao, force = false) {
    _currentIcao = icao;
    const panel = document.getElementById('regional-map-panel');
    if (panel && panel.classList.contains('open')) {
        if (force || _lastLoadedIcao !== _currentIcao || !_map) {
            _initOrRefresh();
        }
    }
}

/**
 * Initialise ou rafraîchit la carte.
 *
 * N'est appelé qu'à l'ouverture du panneau ou au changement de terrain (la
 * fonction showRegionalMapFor filtre déjà les appels redondants). On distingue :
 *  - 1ʳᵉ initialisation (création de la carte Leaflet + fonds + contrôleurs).
 *  - Changement de terrain (re-centrage + recharge des marqueurs réseau).
 */
async function _initOrRefresh() {
    if (!_currentIcao) return;

    const apt = getAirportByICAO(_currentIcao);
    const memo = memoGet(_currentIcao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) return;

    // Token d'annulation : si un autre _initOrRefresh démarre avant la fin de
    // celui-ci, on abandonne silencieusement aux points de contrôle.
    const myToken = ++_refreshToken;

    // --- 1. Initialisation Leaflet (une seule fois) ---
    const isFirstInit = !_map;
    if (isFirstInit) {
        const el = document.getElementById('regional-map');
        if (!el || typeof L === 'undefined') return;
        // maxZoom 19 : permet de détailler les pistes (satellite Esri natif 19).
        _map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19 }).setView([lat, lon], 7);

        // Crée les 2 fonds de carte (un seul actif à la fois).
        _baseLayers = {
            satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
                attribution: 'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics',
                maxZoom: 19, maxNativeZoom: 19,
            }),
            dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
                attribution: '© OpenStreetMap, © CARTO',
                maxZoom: 19, maxNativeZoom: 14,
            }),
        };
        _baseLayers[_activeBaseLayer].addTo(_map);

        // Contrôleurs de calques enrichis (radar animé + satellite + espaces).
        _initLayerControls();

        // Couche des pistes vectorielles (ajoutée/retrait selon le zoom).
        _runwayLayer = L.layerGroup().addTo(_map);
        _map.on('zoomend', _updateRunwayVisibility);
    } else {
        // Terrain changé : re-centre la vue sur le nouveau terrain.
        _map.setView([lat, lon], 7);
    }

    // --- 2. Marqueur du terrain courant + pistes ---
    _clearAirportMarkers();
    _clearNeighborMarkers();
    _clearPirepMarkers();
    _addAirportMarker(lat, lon, _currentIcao, apt?.name || _currentIcao, null, true);
    await _drawRunways(lat, lon, apt);

    // --- 3. Pré-charge le manifeste radar (non bloquant) ---
    if (_precip) _precip.preload();

    // --- 4. Section réseau : annulable via le token ---
    // Les marqueurs voisins/PIREPs utilisent un swap atomique (clear puis add
    // après le fetch, pas de fenêtre vide).

    await _loadNeighborCategories(lat, lon);
    if (myToken !== _refreshToken) return;

    await _loadPireps(lat, lon);
    if (myToken !== _refreshToken) return;

    // Météo de route si un terrain de départ est défini (mode navigation).
    const fromInput = document.getElementById('route-from-input');
    const fromIcao = fromInput?.value?.trim().toUpperCase();
    if (fromIcao && /^[A-Z]{4}$/.test(fromIcao) && fromIcao !== _currentIcao.toUpperCase()) {
        await showRouteWeather(_map, fromIcao, _currentIcao);
        if (myToken !== _refreshToken) return;
    }

    _lastLoadedIcao = _currentIcao;

    // Force le recalcul des dimensions (panneau nouvellement ouvert).
    setTimeout(() => _map.invalidateSize(), 50);
}

/**
 * Initialise les contrôleurs de calques enrichis (radar animé + satellite +
 * espaces aériens) et monte leur barre de contrôles.
 *
 * Appelé une seule fois, à la création de la carte Leaflet.
 */
function _initLayerControls() {
    // Conteneur des contrôles : on le crée juste au-dessus de la carte.
    let bar = document.getElementById('map-layers-bar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'map-layers-bar';
        bar.className = 'map-layers-bar';
        // Inséré AVANT le conteneur de carte (cf. index.html structure).
        const mapEl = document.getElementById('regional-map');
        mapEl?.parentNode?.insertBefore(bar, mapEl);
    }

    // IMPORTANT : _precip.mountControls fait bar.innerHTML = ... qui écrase tout
    // contenu existant. On l'appelle donc en PREMIER, puis on ajoute les autres
    // contrôles (switcher de fond, espaces, zoom) en append (ils ne s'écrasent
    // pas mutuellement).

    // Contrôleur précipitations (radar + satellite) — écrit directement innerHTML.
    _precip = createPrecipController(_map);
    _precip.mountControls(bar);

    // Sélecteur de fond de carte (3 fonds commutables) — append.
    _mountBaseLayerSwitcher(bar);

    // Contrôleur espaces aériens — append.
    _airspaces = createAirspaceController(_map);
    _airspaces.mountControls(bar);

    // Bouton de zoom rapide sur le terrain courant (voit les pistes) — append.
    _mountZoomAirfieldButton(bar);

    // Active le radar par défaut (frame la plus récente, sans animation).
    _precip.toggleRadar(true);
}

/**
 * Montre le sélecteur de fond de carte (sombre / satellite / aéro) dans la barre.
 */
function _mountBaseLayerSwitcher(bar) {
    if (!_baseLayers) return;
    const isFr = state.lang === 'fr';
    const group = document.createElement('div');
    group.className = 'precip-control-group base-layer-group';
    const layers = [
        { key: 'dark', label: isFr ? 'Sombre' : 'Dark', icon: 'map' },
        { key: 'satellite', label: isFr ? 'Satellite' : 'Satellite', icon: 'satellite' },
        { key: 'aero', label: isFr ? 'Aéro' : 'Aero', icon: 'navigation' },
    ];
    group.innerHTML = layers.map(l => `
        <button class="precip-toggle base-layer-btn${l.key === _activeBaseLayer ? ' active' : ''}" data-base="${l.key}" aria-pressed="${l.key === _activeBaseLayer}" title="${l.label}">
            <i data-lucide="${l.icon}" style="width:14px;height:14px;"></i>
            <span>${l.label}</span>
        </button>`).join('');
    bar.insertBefore(group, bar.firstChild);
    if (window.lucide) window.lucide.createIcons({ root: group });

    group.querySelectorAll('.base-layer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const key = btn.dataset.base;
            if (!_baseLayers || key === _activeBaseLayer) return;
            _map.removeLayer(_baseLayers[_activeBaseLayer]);
            _baseLayers[key].addTo(_map);
            _activeBaseLayer = key;
            // Met à jour l'état visuel des boutons.
            group.querySelectorAll('.base-layer-btn').forEach(b => {
                const active = b.dataset.base === key;
                b.classList.toggle('active', active);
                b.setAttribute('aria-pressed', String(active));
            });
            // Le filtre CSS sombre ne s'applique qu'au fond sombre (voir style.css).
            const container = document.getElementById('regional-map');
            if (container) container.dataset.baseLayer = key;
        });
    });

    // Initialise l'attribut data-base-layer pour le filtrage CSS des tuiles.
    const container = document.getElementById('regional-map');
    if (container) container.dataset.baseLayer = _activeBaseLayer;
}

/**
 * Bouton de zoom rapide sur le terrain courant : zoome à 14 centré sur le
 * terrain pour voir les pistes (en photo satellite ou en vecteur).
 */
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

/**
 * Charge les catégories de vol des terrains voisins.
 */
async function _loadNeighborCategories(lat, lon) {
    try {
        const minLat = lat - 2, maxLat = lat + 2;
        const minLon = lon - 2, maxLon = lon + 2;

        // 1. Récupère les stations dans la zone.
        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${minLat},${minLon},${maxLat},${maxLon}&format=json&_t=${Date.now()}`;
        const stations = await fetchAvecRelais(stationsUrl, 'json');
        if (!Array.isArray(stations)) return;

        // Limite à 25 stations pour rester léger.
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

        // 2. Récupère les METARs de ces stations en une requête.
        const idsStr = nearby.map(s => s.code).join(',');
        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${idsStr}&format=json&_t=${Date.now()}`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) return;

        // Index par code OACI.
        const metarByCode = {};
        metars.forEach(m => {
            const code = m.icaoId || m.stationId;
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        // 3. Pour chaque station voisine, calcule la catégorie. On clear les
        // anciens marqueurs juste avant d'ajouter les nouveaux (swap atomique)
        // pour éviter une fenêtre vide → pas de clignotement.
        _clearNeighborMarkers();
        nearby.forEach(s => {
            if (s.code === _currentIcao) return; // déjà ajouté comme terrain courant.
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

/**
 * Charge les PIREPs (rapports en vol des pilotes) et place des marqueurs.
 */
async function _loadPireps(lat, lon) {
    try {
        const pireps = await fetchPireps(lat, lon, 3);
        // Clear les anciens marqueurs juste avant d'ajouter les nouveaux (swap
        // atomique) : évite une fenêtre vide pendant le fetch → pas de clignotement.
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
    // Visibilité : après le vent, " 5000 " ou " 9999 ".
    const visiMatch = raw.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : parseVisiToMeters('');

    // Plafond : BKN/OVC le plus bas.
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

// Couleurs par catégorie (cohérentes avec le dashboard).
const CAT_PIN_COLORS = {
    VFR: '#4ADE80',
    MVFR: '#38BDF8',
    IFR: '#F87171',
    LIFR: '#D946EF',
};

/**
 * Ajoute un marqueur d'aéroport sur la carte. Le marqueur courant est stocké
 * dans _airportMarkers, les voisins dans _neighborMarkers.
 */
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

// ----------------------------------------------------------------
// PISTES VECTORIELLES
// ----------------------------------------------------------------

/**
 * Point de destination à partir d'un point + cap + distance (formule
 * sphérique simplifiée). La géométrie des seuils de piste n'étant pas en
 * base, on la calcule à partir du centroïde du terrain.
 *
 * @param {number} lat Latitude de départ (degrés).
 * @param {number} lon Longitude de départ (degrés).
 * @param {number} bearing Cap vrai (degrés, 0 = nord).
 * @param {number} distM Distance en mètres.
 * @returns {[number, number]} [lat, lon] du point d'arrivée.
 */
function _destinationPoint(lat, lon, bearing, distM) {
    const R = 6371000; // rayon terrestre moyen (m)
    const br = bearing * Math.PI / 180;
    const d = distM / R;
    const lat1 = lat * Math.PI / 180, lon1 = lon * Math.PI / 180;
    const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(br));
    const lon2 = lon1 + Math.atan2(Math.sin(br) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
    return [lat2 * 180 / Math.PI, lon2 * 180 / Math.PI];
}

/**
 * Parse une paire de pistes "12 (102°)/30 (282°)" en seuils exploitables.
 * @returns {Array<{desig:string, hdg:number}>} Tableau des seuils.
 */
function _parseRunwayPairs(runways) {
    if (!Array.isArray(runways)) return [];
    const out = [];
    runways.forEach(pair => {
        // Chaque moitié "12 (102°)" contient le désignateur et le cap vrai.
        const halves = String(pair).split('/').map(s => s.trim());
        halves.forEach(h => {
            const m = h.match(/^(\d{2}[LRC]?)\s*\((\d{3})°\)/);
            if (m) out.push({ desig: m[1], hdg: parseInt(m[2], 10) });
        });
    });
    return out;
}

/**
 * Trace les pistes du terrain courant en vecteur, à partir des coordonnées
 * RÉELLES des seuils (CSV OurAirports). Chaque seuil (le/he) est placé à sa
 * position exacte — les pistes sécantes (ex. 04/22 et 08/26) sont donc
 * correctement représentées.
 *
 * Fallback : si le CSV n'est pas disponible (réseau/indispo), on calcule la
 * géométrie depuis le centroïde + cap + longueur (ancienne méthode).
 */
async function _drawRunways(lat, lon, apt) {
    if (!_map || !_runwayLayer) return;
    _runwayLayer.clearLayers();
    if (!apt) return;

    // 1. Tente d'abord les seuils réels (CSV OurAirports).
    const realThresholds = await getRunwayThresholds(_currentIcao);
    let drawn = [];

    if (realThresholds.length > 0) {
        // Mode précis : chaque piste a ses deux seuils (le + he) en lat/lon.
        drawn = realThresholds
            .filter(rw => isFinite(rw.lat) && isFinite(rw.lon) &&
                          isFinite(rw.lat2) && isFinite(rw.lon2))
            .map(rw => ({
                endA: [rw.lat, rw.lon],   // seuil "low end" (le)
                endB: [rw.lat2, rw.lon2], // seuil "high end" (he)
                desigAtEndA: rw.desig,    // désignateur au seuil le
                desigAtEndB: rw.desig2,   // désignateur au seuil he
            }));
    }

    // 2. Fallback : calcul depuis le centroïde (si pas de seuils réels).
    if (drawn.length === 0) {
        drawn = _computeRunwaysFromCentroid(lat, lon, apt);
    }

    if (drawn.length === 0) return;

    drawn.forEach(rw => {
        // Ligne épaisse type asphalte (bord clair + centre sombre).
        L.polyline([rw.endA, rw.endB], {
            color: '#94A3B8', weight: 7, opacity: 0.9, lineCap: 'round',
        }).addTo(_runwayLayer);
        L.polyline([rw.endA, rw.endB], {
            color: '#1E293B', weight: 4, opacity: 1, lineCap: 'round', dashArray: '10,8',
        }).addTo(_runwayLayer);

        // Désignateurs aux deux extrémités.
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

/**
 * Fallback : calcule les pistes depuis le centroïde + cap + longueur quand les
 * seuils réels ne sont pas disponibles. Décale les pistes parallèles.
 */
function _computeRunwaysFromCentroid(lat, lon, apt) {
    const thresholds = _parseRunwayPairs(apt.runways);
    if (thresholds.length === 0) return [];

    const lenM = desig => apt.runwayLengths && apt.runwayLengths[desig]
        ? apt.runwayLengths[desig] * 0.3048 : null;
    const longestM = apt.longestRunway ? apt.longestRunway * 0.3048 : 2000;

    // Regroupe les seuils opposés en paires.
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

    // Décale les pistes parallèles.
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

/**
 * Affiche/masque le groupe de pistes selon le niveau de zoom.
 * Appelé sur 'zoomend' et après chaque tracé.
 */
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
