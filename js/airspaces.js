/* ================================================================
 * AIRSPACES — Espaces aériens (CTR, TMA, classes A/B/C/D/E/G)
 * ================================================================
 *
 * POURQUOI
 * --------
 * En VFR, savoir quelle zone on va pénétrer est vital : CTR = clairance
 * obligatoire, TMA souvent soumise à clairance, classes D/E contact radio,
 * zones réglementées (RTBA, parachutage...) interdiction temporaire.
 *
 * Afficher les espaces aériens sur la carte régionale donne au pilote
 * une conscience immédiate de l'environnement contrôlé autour de son
 * terrain — comme le fait SkyDemon ou ForeFlight.
 *
 * SOURCE
 * ------
 * API OpenAIP /api/airspaces — recherche par bbox ou coordonnées.
 * Authentification : header x-openaip-api-key (déjà configurée pour
 * le module openaip.js). CORS natif → pas de proxy nécessaire.
 *
 * Les données géométrriques sont au GeoJSON (polygones). On crée une
 * couche Leaflet par classe d'espace, avec un code couleur standardisé.
 *
 * CACHE
 * -----
 * Cache IndexedDB dédié (store 'airspaces') par bbox arrondie au demi-
 * degré. TTL 30 jours : les espaces aériens changent rarement (cycle
 * AIRAC de 28 jours).
 *
 * PERFORMANCE
 * -----------
 * On ne charge les espaces qu'au zoom ≥ 9 (au-delà, la carte couvre
 * un trop grand nombre de zones). On filtre par altitude (uniquement
 * les espaces dont la base est ≤ 3000 ft AGL — pertinents en VFR de
 * transit).
 * ================================================================ */

import { OPENAIP_API_KEY } from './config.local.js';
import { state } from './core.js';

const BASE_URL = 'https://api.core.openaip.net/api/airspaces';

// Cache IndexedDB (store dédié airspaces).
const IDB_NAME = 'openaip-cache';
const IDB_STORE = 'airspaces';
const IDB_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;  // 30 jours (cycle AIRAC).

// Zoom minimum pour charger les espaces (évite surcharge à bas zoom).
const MIN_ZOOM = 9;

// N'affiche que les espaces dont la base est ≤ cet altitude (ft AGL).
// Au-dessus de 5000 ft, le VFR de transit a déjà évolué ; on garde
// néanmoins une marge large pour ne rien masquer d'utile.
const MAX_BASE_FT = 5000;

// Couleurs par type/classe d'espace (cohérentes avec l'usage aéro).
const AIRSPACE_STYLE = {
    CTR:    { color: '#EF4444', fill: 'rgba(239,68,68,0.10)',  weight: 2, label: 'CTR' },
    TMA:    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 2, label: 'TMA' },
    'A':    { color: '#DC2626', fill: 'rgba(220,38,38,0.10)',  weight: 1.5, label: 'A' },
    'B':    { color: '#DC2626', fill: 'rgba(220,38,38,0.10)',  weight: 1.5, label: 'B' },
    'C':    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 1.5, label: 'C' },
    'D':    { color: '#FBBF24', fill: 'rgba(251,191,36,0.10)', weight: 1.5, label: 'D' },
    'E':    { color: '#38BDF8', fill: 'rgba(56,189,248,0.06)', weight: 1, label: 'E' },
    'G':    { color: '#94A3B8', fill: 'rgba(148,163,184,0.04)', weight: 0.8, label: 'G' },
    RMZ:    { color: '#A855F7', fill: 'rgba(168,85,247,0.10)', weight: 1.5, label: 'RMZ' },
    TMZ:    { color: '#A855F7', fill: 'rgba(168,85,247,0.10)', weight: 1.5, label: 'TMZ' },
    'GLIDER': { color: '#4ADE80', fill: 'rgba(74,222,128,0.08)', weight: 1, label: 'Planel' },
    'DROP': { color: '#94A3B8', fill: 'rgba(148,163,184,0.08)', weight: 1, label: 'Parachut.' },
    'RESTRICTED': { color: '#EF4444', fill: 'rgba(239,68,68,0.18)', weight: 2, label: 'Réglementée' },
    'DANGER': { color: '#F59E0B', fill: 'rgba(245,158,11,0.15)', weight: 2, label: 'Dangereuse' },
    'PROHIBITED': { color: '#DC2626', fill: 'rgba(220,38,38,0.25)', weight: 2.5, label: 'Interdite' },
    'OTHER': { color: '#94A3B8', fill: 'rgba(148,163,184,0.06)', weight: 1, label: '?' },
};

// ----------------------------------------------------------------
// IndexedDB
// ----------------------------------------------------------------
function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            // Le store 'airports' est créé par openaip.js — pas touché ici.
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGet(key) {
    try {
        const db = await _openDB();
        return await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readonly');
            const req = tx.objectStore(IDB_STORE).get(key);
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); resolve(null); };
        });
    } catch { return null; }
}

async function _idbPut(key, data) {
    try {
        const db = await _openDB();
        await new Promise((resolve) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put({ data, ts: Date.now() }, key);
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); resolve(); };
        });
    } catch { /* quota / mode privé */ }
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

/**
 * Construit une clé de cache par bbox arrondie au demi-degré.
 * Deux requêtes voisines partagent le même cache.
 */
function _bboxKey(minLat, minLon, maxLat, maxLon) {
    const r = (x) => Math.round(x * 2) / 2;
    return `bbox_${r(minLat)}_${r(minLon)}_${r(maxLat)}_${r(maxLon)}`;
}

/**
 * Détermine le type/classe d'un espace OpenAIP pour le style.
 * OpenAIP expose 'type' (enum) et 'icaoClass' (lettre).
 */
function _classify(as) {
    const t = String(as.type || '').toUpperCase();
    const cls = String(as.icaoClass || '').toUpperCase();

    if (t.includes('CTR') || t === 'D') return 'CTR';
    if (t.includes('TMA')) return 'TMA';
    if (t.includes('RESTRICTED') || t === 'R') return 'RESTRICTED';
    if (t.includes('DANGER') || t === 'P') return 'DANGER';
    if (t.includes('PROHIBITED') || t === 'P') return 'PROHIBITED';
    if (t.includes('RMZ')) return 'RMZ';
    if (t.includes('TMZ')) return 'TMZ';
    if (t.includes('GLIDER')) return 'GLIDER';
    if (t.includes('DROP') || t.includes('PARACHUTE')) return 'DROP';

    // Par classe ICAO.
    if (cls && AIRSPACE_STYLE[cls]) return cls;
    return 'OTHER';
}

/**
 * Extrait l'altitude de base (ft) d'un espace OpenAIP.
 * Les champs lower/upper sont en mètres avec unit:0.
 */
function _baseFt(as) {
    const lower = as.lower;
    if (!lower) return 0;
    const m = typeof lower.value === 'number' ? lower.value : null;
    if (m == null) return 0;
    // Conversion mètres → pieds (arrondi).
    return Math.round(m * 3.28084);
}

/**
 * Convertit la géométrie OpenAIP (GeoJSON) en tableau d'anneaux [lat,lon].
 * @param {Object} geometry Géométrie GeoJSON.
 * @param {number} [radiusKm] Rayon pour les zones circulaires (Point).
 * @returns {Array<Array<[number,number]>>} Anneaux de [lat,lon].
 */
function _geometryToLatLngs(geometry, radiusKm = 5) {
    if (!geometry || !geometry.coordinates) return [];
    const type = geometry.type;
    const rings = [];

    if (type === 'Polygon') {
        // coordinates = [ [ [lon,lat], ... ] ] (anneau extérieur + trous).
        geometry.coordinates.forEach(ring => {
            rings.push(ring.map(([lon, lat]) => [lat, lon]));
        });
    } else if (type === 'MultiPolygon') {
        geometry.coordinates.forEach(poly => {
            poly.forEach(ring => {
                rings.push(ring.map(([lon, lat]) => [lat, lon]));
            });
        });
    } else if (type === 'LineString') {
        // Certaines zones (couloirs) sont des lignes épaisses.
        rings.push(geometry.coordinates.map(([lon, lat]) => [lat, lon]));
    } else if (type === 'Point') {
        // Zone circulaire représentée par un point + rayon.
        const [lon, lat] = geometry.coordinates;
        const ring = [];
        const R = 6378.137;
        const steps = 36;
        for (let i = 0; i <= steps; i++) {
            const brg = (i / steps) * 2 * Math.PI;
            const dLat = (radiusKm / R) * (180 / Math.PI);
            const dLon = (radiusKm / R) * (180 / Math.PI) / Math.cos(lat * Math.PI / 180);
            ring.push([lat + dLat * Math.sin(brg), lon + dLon * Math.cos(brg)]);
        }
        rings.push(ring);
    }
    return rings;
}

// ----------------------------------------------------------------
// Contrôleur Leaflet
// ----------------------------------------------------------------

/**
 * Fabrique un contrôleur d'espaces aériens pour une carte Leaflet.
 *
 * @param {L.Map} map Instance Leaflet.
 * @returns {{
 *   mountControls: (el: HTMLElement) => void,
 *   loadForBounds: (b: L.LatLngBounds) => Promise<void>,
 *   toggle: (on: boolean) => void,
 *   destroy: () => void
 * }}
 */
export function createAirspaceController(map) {
    let layerGroup = L.layerGroup().addTo(map);   // groupe contenant tous les polygones.
    let visible = false;                            // masqué par défaut (évite surcharge).
    let loaded = false;                             // données déjà chargées ?
    let controlsEl = null;
    let lastBboxKey = null;

    /**
     * Charge les espaces aériens pour une bbox.
     */
    async function loadForBounds(bounds) {
        const minLat = bounds.getSouth();
        const minLon = bounds.getWest();
        const maxLat = bounds.getNorth();
        const maxLon = bounds.getEast();
        const key = _bboxKey(minLat, minLon, maxLat, maxLon);

        // Déjà chargé pour cette bbox.
        if (key === lastBboxKey && loaded) return;

        // Cache IndexedDB.
        let cached = await _idbGet(key);
        let items = cached?.data;
        if (!items || Date.now() - cached.ts > TTL_MS) {
            // Fetch OpenAIP : recherche par bbox.
            try {
                // L'API OpenAIP airspaces accepte les paramètres bbox au format
                // "minLon,minLat,maxLon,maxLat" (ordre GeoJSON lon,lat).
                const url = `${BASE_URL}?bbox=${minLon},${minLat},${maxLon},${maxLat}&limit=200`;
                const res = await fetch(url, {
                    headers: { 'x-openaip-api-key': OPENAIP_API_KEY },
                    signal: AbortSignal.timeout(12000),
                });
                if (!res.ok) {
                    console.warn('Airspaces fetch failed:', res.status);
                    return;
                }
                const data = await res.json();
                items = data.items || [];
                _idbPut(key, items);
            } catch (e) {
                console.warn('Airspaces fetch error:', e.message);
                return;
            }
        }

        lastBboxKey = key;
        loaded = true;
        _render(items);
    }

    /**
     * Affiche les espaces sur la carte.
     */
    function _render(items) {
        layerGroup.clearLayers();
        if (!Array.isArray(items)) return;

        const isFr = state.lang === 'fr';
        let count = 0;

        items.forEach(as => {
            // Filtre altitude : on ne garde que les espaces pertinents en VFR.
            const baseFt = _baseFt(as);
            if (baseFt > MAX_BASE_FT) return;

            const kind = _classify(as);
            const style = AIRSPACE_STYLE[kind] || AIRSPACE_STYLE.OTHER;
            const radiusKm = (as.radius && typeof as.radius.value === 'number') ? as.radius.value : 5;
            const rings = _geometryToLatLngs(as.geometry, radiusKm);

            rings.forEach((ring, ringIdx) => {
                if (ring.length < 2) return;
                const poly = L.polygon(ring, {
                    color: style.color,
                    weight: style.weight,
                    fillColor: style.color,
                    fillOpacity: parseFloat(style.fill.match(/[\d.]+(?=\))/)[0]) || 0.08,
                    interactive: true,
                    // On garde le premier anneau cliquable, les trous non.
                });

                const name = as.name || as.designator || style.label;
                const lower = as.lower?.value ? `${Math.round(as.lower.value * 3.28084)} ft` : 'SFC';
                const upper = as.upper?.value ? `${Math.round(as.upper.value * 3.28084)} ft` : '∞';
                const cls = as.icaoClass || '—';
                const country = as.country || '';
                const tooltip = `<strong>${escapeHtml(name)}</strong><br>
                    <span style="color:${style.color};font-weight:700;">${style.label}</span>
                    ${cls !== '—' ? `· classe ${cls}` : ''}<br>
                    ${isFr ? 'Alt.' : 'Alt.'}: ${lower} → ${upper}
                    ${country ? `<br>${country}` : ''}`;
                poly.bindTooltip(tooltip, { sticky: true, direction: 'top' });

                layerGroup.addLayer(poly);
                count++;
            });
        });

        // Met à jour le compteur dans les contrôles.
        if (controlsEl) {
            const badge = controlsEl.querySelector('.airspace-count');
            if (badge) {
                badge.textContent = count > 0 ? `${count}` : '';
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        }
    }

    /**
     * Bascule la visibilité du groupe.
     */
    function toggle(on) {
        visible = on;
        if (on) {
            layerGroup.addTo(map);
            // Charge si pas déjà fait.
            if (!loaded) loadForBounds(map.getBounds());
        } else {
            map.removeLayer(layerGroup);
        }
        if (controlsEl) {
            const btn = controlsEl.querySelector('.precip-toggle-airspaces');
            if (btn) {
                btn.classList.toggle('active', visible);
                btn.setAttribute('aria-pressed', String(visible));
            }
        }
    }

    /**
     * Rend le bouton de contrôle.
     */
    function mountControls(el) {
        controlsEl = el;
        const isFr = state.lang === 'fr';

        // Bouton toggle airspaces.
        let btn = el.querySelector('.precip-toggle-airspaces');
        if (!btn) {
            const group = document.createElement('div');
            group.className = 'precip-control-group';
            group.innerHTML = `
                <button class="precip-toggle precip-toggle-airspaces" aria-pressed="false" title="${isFr ? 'Espaces aériens (CTR, TMA, classes...)' : 'Airspaces (CTR, TMA, classes...)'}">
                    <i data-lucide="hexagon" style="width:14px;height:14px;"></i>
                    <span>${isFr ? 'Espaces' : 'Airspaces'}</span>
                    <span class="airspace-count" style="display:none; font-size:9px; background:rgba(56,189,248,0.2); color:#38BDF8; padding:0 5px; border-radius:8px; margin-left:2px; font-weight:700;"></span>
                </button>
            `;
            el.appendChild(group);
            btn = group.querySelector('.precip-toggle-airspaces');
            btn.addEventListener('click', () => toggle(!visible));
            if (window.lucide) window.lucide.createIcons({ root: el });
        }
    }

    /**
     * Met à jour au déplacement de la carte (si visible).
     */
    function onMapMove() {
        if (visible && map.getZoom() >= MIN_ZOOM) {
            loadForBounds(map.getBounds());
        }
    }

    map.on('moveend', onMapMove);
    map.on('zoomend', onMapMove);

    return {
        mountControls,
        loadForBounds,
        toggle,
        get visible() { return visible; },
        destroy() {
            map.off('moveend', onMapMove);
            map.off('zoomend', onMapMove);
            map.removeLayer(layerGroup);
            layerGroup = null;
            controlsEl = null;
        },
    };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
