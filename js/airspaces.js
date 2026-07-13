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

// ----------------------------------------------------------------
// Enums OpenAIP — l'API renvoie des ENTIERS, pas des chaînes.
// Mapping basé sur le schéma OpenAIP et confirmé sur données réelles.
// (Sans cette table, un CTR s'affiche « ? » et sa classe « classe 3 ».)
// ----------------------------------------------------------------

// type → nature de l'espace (OpenAIP enum 0–36).
// Source : schéma OpenAIP /airspaces + vérification sur noms réels.
const TYPE_MAP = {
    0:  'OTHER',          // ex: ALPINE AREA, AREA
    1:  'DROP',           // parachutage (PA = Parachute Area)
    2:  'DANGER',         // ex: FIRINGAREA
    3:  'PROHIBITED',
    4:  'CTR',
    5:  'TMA',            // CTA / TMA (peut être recadré via le nom)
    6:  'ATZ',
    7:  'TMA',
    8:  'TMA',
    9:  'TMA',
    10: 'TMA',
    11: 'TMZ',
    12: 'RMZ',
    13: 'ATZ',
    14: 'GLIDER',
    15: 'RESTRICTED',     // ex: A25, A27 (zones réglementées UK)
    16: 'DANGER',
    17: 'PROHIBITED',
    18: 'RESTRICTED',     // ex: ALDBROUGH (RA - Restricted Area UK)
    19: 'RESTRICTED',
    20: 'RESTRICTED',
    21: 'RESTRICTED',     // ex: UGR (zones ULM/UL aérien réglementées DE)
    22: 'RESTRICTED',
    23: 'RESTRICTED',
    24: 'GLIDER',
    25: 'GLIDER',
    26: 'GLIDER',
    27: 'GLIDER',
    28: 'ACRO',           // voltige (ACRO)
    29: 'DROP',           // park/parachutage
    30: 'OTHER',
    31: 'OTHER',
    32: 'OTHER',
    33: 'OTHER',
    34: 'OTHER',
    35: 'OTHER',
    36: 'OTHER',
};

// icaoClass → lettre ICAO (OpenAIP enum 0–8).
// Confirmé : type=4 (CTR) avec icaoClass=3 → classe D partout en Europe.
const ICAO_CLASS_MAP = {
    0: 'A',
    1: 'B',
    2: 'C',
    3: 'D',
    4: 'E',
    5: 'F',
    6: 'G',
    7: 'SPECIAL',
    8: 'NA',   // non applicable / non classé
};

// Couleurs par type/classe d'espace (cohérentes avec l'usage aéro).
const AIRSPACE_STYLE = {
    CTR:    { color: '#EF4444', fill: 'rgba(239,68,68,0.10)',  weight: 2, label: 'CTR' },
    TMA:    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 2, label: 'TMA' },
    CTA:    { color: '#F97316', fill: 'rgba(249,115,22,0.10)', weight: 1.5, label: 'CTA' },
    ATZ:    { color: '#FBBF24', fill: 'rgba(251,191,36,0.08)', weight: 1.2, label: 'ATZ' },
    ACRO:   { color: '#A855F7', fill: 'rgba(168,85,247,0.08)', weight: 1, label: 'Voltige' },
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
 *
 * ⚠️ L'API OpenAIP renvoie 'type' et 'icaoClass' sous forme d'ENTIERS
 * (enums), pas de chaînes. On décode donc via les tables TYPE_MAP /
 * ICAO_CLASS_MAP. On garde une robustesse par le nom (fallback) au cas
 * où l'API changerait de convention.
 *
 * @returns {{ kind: string, classLetter: string }}
 */
function _decodeAirspace(as) {
    const typeName = _decodeType(as);
    const classLetter = _decodeIcaoClass(as);
    return { kind: typeName, classLetter };
}

/**
 * Décode le type OpenAIP (entier → clé de style).
 * Complète la table TYPE_MAP par inspection du nom de zone (robustesse).
 */
function _decodeType(as) {
    // 1. Enum numérique (cas normal).
    if (typeof as.type === 'number' && TYPE_MAP[as.type]) {
        return TYPE_MAP[as.type];
    }
    // 2. Chaîne (ancienne API ou GeoJSON openaip) — on matche directement.
    const t = String(as.type || '').toUpperCase();
    if (t === 'CTR' || t === 'D') return 'CTR';
    if (t === 'TMA') return 'TMA';
    if (t === 'CTA') return 'CTA';
    if (t === 'ATZ') return 'ATZ';
    if (t === 'RMZ') return 'RMZ';
    if (t === 'TMZ') return 'TMZ';
    if (t.includes('RESTRICTED') || t === 'R') return 'RESTRICTED';
    if (t.includes('DANGER') || t === 'Q') return 'DANGER';
    if (t.includes('PROHIBITED') || t === 'P') return 'PROHIBITED';
    if (t.includes('GLIDER') || t.includes('GLIDING')) return 'GLIDER';

    // 3. Fallback sur le nom de la zone.
    const name = String(as.name || as.designator || '').toUpperCase();
    if (/\bCTR\b/.test(name)) return 'CTR';
    if (/\bTMA\b/.test(name)) return 'TMA';
    if (/\bATZ\b/.test(name)) return 'ATZ';
    if (/\bRMZ\b/.test(name)) return 'RMZ';
    if (/\bTMZ\b/.test(name)) return 'TMZ';
    if (/RESTRICT|REGUL|RTBA|R\d{2,}/.test(name)) return 'RESTRICTED';
    if (/DANGER/.test(name)) return 'DANGER';
    if (/PROHIB/.test(name)) return 'PROHIBITED';
    if (/PARACHUTE|\bPA\b|\(PA\)/.test(name)) return 'DROP';
    if (/ACRO|VOLTIGE|AEROBAT/.test(name)) return 'ACRO';
    if (/GLIDER|PLANEUR|VOL.A.VOILE/.test(name)) return 'GLIDER';

    return 'OTHER';
}

/**
 * Décode la classe ICAO OpenAIP (entier → lettre A-G).
 */
function _decodeIcaoClass(as) {
    if (typeof as.icaoClass === 'number') return ICAO_CLASS_MAP[as.icaoClass] || '';
    const c = String(as.icaoClass || '').toUpperCase();
    return /^[A-G]$/.test(c) ? c : '';
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

/**
 * Test point-in-polygon (ray casting). ring = [[lat, lon], ...].
 * Sert à détecter quelles zones se superposent au point cliqué.
 */
function _pointInRing(lat, lng, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const lati = ring[i][0], loni = ring[i][1];
        const latj = ring[j][0], lonj = ring[j][1];
        if (((lati > lat) !== (latj > lat)) &&
            (lng < (lonj - loni) * (lat - lati) / (latj - lati) + loni)) {
            inside = !inside;
        }
    }
    return inside;
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

    // --- Surlignage & superposition ---
    // highlighted : le polygone actuellement mis en évidence (contour blanc épais).
    // polyMeta : Map L.polygon → métadonnées (item, ring, style, label de tooltip).
    // Permet de retrouver la zone cliquée et de lister les zones superposées.
    let highlighted = null;
    let polyMeta = new Map();

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
        polyMeta.clear();
        highlighted = null;
        if (!Array.isArray(items)) return;

        const isFr = state.lang === 'fr';
        let count = 0;

        items.forEach(as => {
            // Filtre altitude : on ne garde que les espaces pertinents en VFR.
            const baseFt = _baseFt(as);
            if (baseFt > MAX_BASE_FT) return;

            const kind = _decodeAirspace(as);
            const style = AIRSPACE_STYLE[kind.kind] || AIRSPACE_STYLE.OTHER;
            const radiusKm = (as.radius && typeof as.radius.value === 'number') ? as.radius.value : 5;
            const rings = _geometryToLatLngs(as.geometry, radiusKm);

            const name = as.name || as.designator || style.label;
            const lower = as.lower?.value ? `${Math.round(as.lower.value * 3.28084)} ft` : 'SFC';
            const upper = as.upper?.value ? `${Math.round(as.upper.value * 3.28084)} ft` : '∞';
            const cls = kind.classLetter;
            const country = as.country || '';
            // La classe ICAO n'est affichée que si elle est pertinente
            // (A-G) ; on ignore 'NA' / 'SPECIAL' qui n'apportent rien au pilote.
            const clsDisplay = /^[A-G]$/.test(cls) ? ` · classe ${cls}` : '';
            const tooltip = `<strong>${escapeHtml(name)}</strong><br>
                <span style="color:${style.color};font-weight:700;">${style.label}</span>${clsDisplay}<br>
                ${isFr ? 'Alt.' : 'Alt.'}: ${lower} → ${upper}
                ${country ? `<br>${country}` : ''}`;

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

                poly.bindTooltip(tooltip, { sticky: true, direction: 'top' });

                // Au clic : surligne la zone (contour blanc épais) et, si des
                // zones se superposent au point cliqué, propose un sélecteur.
                poly.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    const latlng = e.latlng;
                    _highlightPoly(poly);
                    const stacked = _findStackedAt(latlng.lat, latlng.lng);
                    if (stacked.length > 1) {
                        _showStackPopup(latlng, stacked, isFr);
                    }
                });

                polyMeta.set(poly, {
                    ring, style, tooltip,
                    // Résumé court pour le sélecteur de superposition.
                    summary: `${style.label} — ${escapeHtml(name)} (${lower} → ${upper})`,
                });
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
     * Surligne un polygone (contour blanc épais). Un seul à la fois :
     * l'ancien surlignage est rétabli dans son style d'origine.
     */
    function _highlightPoly(poly) {
        if (highlighted === poly) return;
        if (highlighted && polyMeta.has(highlighted)) {
            const m = polyMeta.get(highlighted);
            highlighted.setStyle({ color: m.style.color, weight: m.style.weight });
        }
        poly.bringToFront();
        poly.setStyle({ color: '#FFFFFF', weight: 4 });
        highlighted = poly;
    }

    /**
     * Retourne toutes les zones dont le polygone contient le point.
     * Sert à détecter les superpositions (ex: ATZ sous TMA sous CTR).
     */
    function _findStackedAt(lat, lng) {
        const found = [];
        polyMeta.forEach((m, poly) => {
            if (_pointInRing(lat, lng, m.ring)) {
                found.push({ poly, ...m });
            }
        });
        return found;
    }

    /**
     * Affiche un popup de sélection quand plusieurs zones se superposent.
     * Le pilote peut cliquer sur n'importe laquelle (y compris celles
     * masquées sous une zone plus grande).
     */
    function _showStackPopup(latlng, stacked, isFr) {
        const html = `
            <div class="airspace-stack">
                <div class="airspace-stack-title">${isFr ? `${stacked.length} zones superposées — cliquez pour sélectionner` : `${stacked.length} overlapping zones — click to select`}</div>
                ${stacked.map((s, i) => `
                    <div class="airspace-stack-item" data-idx="${i}">
                        <span class="airspace-dot" style="background:${s.style.color};"></span>
                        <span class="airspace-stack-name">${s.summary}</span>
                    </div>
                `).join('')}
            </div>`;
        const popup = L.popup({ className: 'airspace-popup', maxWidth: 280, closeButton: true })
            .setLatLng(latlng)
            .setContent(html)
            .openOn(map);

        const root = popup.getElement();
        root?.querySelectorAll('.airspace-stack-item').forEach(el => {
            el.addEventListener('click', () => {
                const idx = parseInt(el.dataset.idx, 10);
                const target = stacked[idx];
                if (target) {
                    _highlightPoly(target.poly);
                    target.poly.openTooltip(latlng);
                }
                map.closePopup(popup);
            });
        });
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

    // Clic sur la carte (hors zone) : retire le surlignage.
    function onMapClick() {
        if (highlighted && polyMeta.has(highlighted)) {
            const m = polyMeta.get(highlighted);
            highlighted.setStyle({ color: m.style.color, weight: m.style.weight });
            highlighted = null;
        }
        map.closePopup();
    }

    map.on('moveend', onMapMove);
    map.on('zoomend', onMapMove);
    map.on('click', onMapClick);

    return {
        mountControls,
        loadForBounds,
        toggle,
        get visible() { return visible; },
        destroy() {
            map.off('moveend', onMapMove);
            map.off('zoomend', onMapMove);
            map.off('click', onMapClick);
            map.removeLayer(layerGroup);
            layerGroup = null;
            controlsEl = null;
            highlighted = null;
            polyMeta.clear();
        },
    };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
