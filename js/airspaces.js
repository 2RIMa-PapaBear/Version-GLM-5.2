import { OPENAIP_API_KEY } from './config.local.js';
import { state } from './core.js';

const BASE_URL = 'https://api.core.openaip.net/api/airspaces';

const IDB_NAME = 'openaip-cache';
const IDB_STORE = 'airspaces';
const IDB_VERSION = 1;
const TTL_MS = 30 * 24 * 60 * 60 * 1000;

const MIN_ZOOM = 9;

const MAX_BASE_FT = 5000;

const TYPE_MAP = {
    0:  'OTHER',
    1:  'DROP',
    2:  'DANGER',
    3:  'PROHIBITED',
    4:  'CTR',
    5:  'TMA',
    6:  'ATZ',
    7:  'TMA',
    8:  'TMA',
    9:  'TMA',
    10: 'TMA',
    11: 'TMZ',
    12: 'RMZ',
    13: 'ATZ',
    14: 'GLIDER',
    15: 'RESTRICTED',
    16: 'DANGER',
    17: 'PROHIBITED',
    18: 'RESTRICTED',
    19: 'RESTRICTED',
    20: 'RESTRICTED',
    21: 'RESTRICTED',
    22: 'RESTRICTED',
    23: 'RESTRICTED',
    24: 'GLIDER',
    25: 'GLIDER',
    26: 'GLIDER',
    27: 'GLIDER',
    28: 'ACRO',
    29: 'DROP',
    30: 'OTHER',
    31: 'OTHER',
    32: 'OTHER',
    33: 'SIV',     // France : « SIV SEINE », « SIV CHEVREUSE »…
    34: 'CTA',     // LTA
    35: 'OTHER',
    36: 'OTHER',
};

const ICAO_CLASS_MAP = {
    0: 'A',
    1: 'B',
    2: 'C',
    3: 'D',
    4: 'E',
    5: 'F',
    6: 'G',
    7: 'SPECIAL',
    8: 'NA',
};

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
    'SIV':   { color: '#38BDF8', fill: 'rgba(56,189,248,0.07)', weight: 1.5, label: 'SIV' },
    'OTHER': { color: '#94A3B8', fill: 'rgba(148,163,184,0.06)', weight: 1, label: '?' },
};

// Familles (dé)cochables du menu « Espaces » — chaque case filtre le rendu
// sans re-téléchargement (les items du dernier cadrage sont rejoués).
export const AIRSPACE_GROUPS = {
    ctr:    { kinds: ['CTR'], label: 'CTR', en: 'CTR', color: '#EF4444' },
    tma:    { kinds: ['TMA', 'CTA'], label: 'TMA / CTA', en: 'TMA / CTA', color: '#F97316' },
    siv:    { kinds: ['SIV'], label: 'SIV', en: 'SIV', color: '#38BDF8' },
    atz:    { kinds: ['ATZ'], label: 'ATZ', en: 'ATZ', color: '#FBBF24' },
    rpd:    { kinds: ['RESTRICTED', 'PROHIBITED', 'DANGER', 'DROP'], label: 'Zones R · P · D', en: 'R · P · D areas', color: '#DC2626' },
    tmz:    { kinds: ['TMZ', 'RMZ'], label: 'TMZ / RMZ', en: 'TMZ / RMZ', color: '#A855F7' },
    autres: { kinds: ['GLIDER', 'ACRO', 'OTHER'], label: 'Planeurs & autres', en: 'Glider & others', color: '#4ADE80' },
};
const _KIND_TO_GROUP = (() => {
    const m = {};
    for (const [g, def] of Object.entries(AIRSPACE_GROUPS)) for (const k of def.kinds) m[k] = g;
    return m;
})();

function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);

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
    } catch {   }
}

function _bboxKey(minLat, minLon, maxLat, maxLon) {
    const r = (x) => Math.round(x * 2) / 2;
    return `bbox_${r(minLat)}_${r(minLon)}_${r(maxLat)}_${r(maxLon)}`;
}

function _decodeAirspace(as) {
    const typeName = _decodeType(as);
    const classLetter = _decodeIcaoClass(as);
    return { kind: typeName, classLetter };
}

function _decodeType(as) {

    if (typeof as.type === 'number' && TYPE_MAP[as.type]) {
        return TYPE_MAP[as.type];
    }

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

function _decodeIcaoClass(as) {
    if (typeof as.icaoClass === 'number') return ICAO_CLASS_MAP[as.icaoClass] || '';
    const c = String(as.icaoClass || '').toUpperCase();
    return /^[A-G]$/.test(c) ? c : '';
}

// Limites verticales openAIP : lowerLimit/upperLimit { value, unit,
// referenceDatum } — unit 6 = FL, unit 1 = ft, unit 0 = m ; referenceDatum
// 1 = AGL. (L'ancien format `lower`/`upper` en mètres est encore accepté.)
function _limitFt(lim) {
    if (!lim || !isFinite(lim.value)) return null;
    if (lim.unit === 6) return lim.value * 100;                      // FL → ft
    if (lim.unit === 0) return Math.round(lim.value * 3.28084);      // m → ft
    return Math.round(lim.value);                                    // ft
}

/** Texte d'une borne : « SFC », « FL065 », « 2500 ft AMSL »… (les limites
 *  verticales des zones sont publiées AMSL ; le referenceDatum openAIP
 *  « AGL » est erroné sur les CTR/TMA — retour utilisateur 2026-08-26). */
function _limitTxt(lim) {
    const ft = _limitFt(lim);
    if (ft == null) return null;
    if (ft <= 0) return 'SFC';
    if (lim.unit === 6 || (ft >= 4000 && ft % 500 === 0)) {
        return `FL${String(Math.round(ft / 100)).padStart(3, '0')}`;
    }
    return `${ft} ft AMSL`;
}

function _baseFt(as) {
    return _limitFt(as.lowerLimit ?? as.lower) ?? 0;
}

function _geometryToLatLngs(geometry, radiusKm = 5) {
    if (!geometry || !geometry.coordinates) return [];
    const type = geometry.type;
    const rings = [];

    if (type === 'Polygon') {

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

        rings.push(geometry.coordinates.map(([lon, lat]) => [lat, lon]));
    } else if (type === 'Point') {

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

export function createAirspaceController(map) {
    let layerGroup = L.layerGroup().addTo(map);
    let visible = false;
    let activeGroups = new Set(Object.keys(AIRSPACE_GROUPS));   // tout coché
    let lastItems = null;                                          // rejouer sans refetch
    let loaded = false;
    let controlsEl = null;
    let lastBboxKey = null;

    let highlighted = null;
    let openZonePopup = null;   // fiche de zone ouverte (bascule au 2e clic)
    let openZonePoly = null;
    let polyMeta = new Map();

    async function loadForBounds(bounds) {
        let minLat = bounds.getSouth();
        let minLon = bounds.getWest();
        let maxLat = bounds.getNorth();
        let maxLon = bounds.getEast();

        // Quantifie la zone demandée à la GRILLE 1° (cellule contenant la
        // vue) : un déplacement de carte reste dans la même cellule la
        // plupart du temps → rendu INSTANTANÉ depuis le cache IndexedDB,
        // et les cellules voisines déjà visitées ne re-téléchargent rien.
        const q = (x) => Math.floor(x);
        minLat = q(minLat); minLon = q(minLon);
        maxLat = Math.ceil(maxLat); maxLon = Math.ceil(maxLon);

        // OpenAIP rejette les bbox de plus de 5° de large (HTTP 400).
        const MAX_DEG = 5;
        if (maxLat - minLat > MAX_DEG) maxLat = minLat + MAX_DEG;
        if (maxLon - minLon > MAX_DEG) maxLon = minLon + MAX_DEG;

        const key = _bboxKey(minLat, minLon, maxLat, maxLon);

        if (key === lastBboxKey && loaded) return;

        // Rendu immédiat depuis le cache (même périmé) : la carte suit le
        // déplacement sans attendre le réseau ; le rafraîchissement, lui,
        // n'a lieu que pour une cellule jamais vue ou de plus de 30 jours.
        const cached = await _idbGet(key);
        let items = cached?.data;
        if (items && cached.ts > Date.now() - TTL_MS) {
            lastBboxKey = key; loaded = true; lastItems = items;
            _render(items);
            return;
        }
        if (items) {
            lastBboxKey = key; loaded = true; lastItems = items;
            _render(items);   // affiche le périmé pendant le téléchargement
        }

        try {
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

        lastBboxKey = key;
        loaded = true;
        lastItems = items;
        _render(items);
    }

    function _render(items) {
        layerGroup.clearLayers();
        polyMeta.clear();
        highlighted = null;
        if (!Array.isArray(items)) return;

        const isFr = state.lang === 'fr';
        let count = 0;

        items.forEach(as => {

            const baseFt = _baseFt(as);
            if (baseFt > MAX_BASE_FT) return;

            // Zones ADMINISTRATIVES nationales (FIR, UIR, LTA « FRANCE »…)
            // tracées comme de grands cadres orange : inutiles en VFR —
            // on ne les dessine pas du tout.
            if (/\bFIR\b|\bUIR\b|\bLTA\b/.test(String(as.name || as.designator || '').toUpperCase())) return;

            const kind = _decodeAirspace(as);
            if (!activeGroups.has(_KIND_TO_GROUP[kind.kind] || 'autres')) return;
            const style = AIRSPACE_STYLE[kind.kind] || AIRSPACE_STYLE.OTHER;
            const radiusKm = (as.radius && typeof as.radius.value === 'number') ? as.radius.value : 5;
            const rings = _geometryToLatLngs(as.geometry, radiusKm);

            const name = as.name || as.designator || style.label;
            const lower = _limitTxt(as.lowerLimit ?? as.lower) ?? 'SFC';
            const upper = _limitTxt(as.upperLimit ?? as.upper) ?? '∞';
            const cls = kind.classLetter;

            const clsDisplay = /^[A-G]$/.test(cls) ? ` · classe ${cls}` : '';
            // Fréquences openAIP (SIV « XX INFORMATION », CTR…) : affichées
            // dans l'infobulle et le popup quand elles sont renseignées.
            const freqTxt = (Array.isArray(as.frequencies) ? as.frequencies : [])
                .filter(f => f && f.value)
                .map(f => `${f.value}${f.name ? ` ${escapeHtml(f.name)}` : ''}`)
                .join('<br>');
            const tooltip = `<strong>${escapeHtml(name)}</strong><br>
                <span style="color:${style.color};font-weight:700;">${style.label}</span>${clsDisplay}<br>
                ${isFr ? 'Alt.' : 'Alt.'}: ${lower} → ${upper}
                ${freqTxt ? `<br><span style="font-family:'DM Mono',monospace;">${freqTxt}</span>` : ''}`;

            rings.forEach((ring, ringIdx) => {
                if (ring.length < 2) return;
                const poly = L.polygon(ring, {
                    color: style.color,
                    weight: style.weight,
                    fillColor: style.color,
                    fillOpacity: parseFloat(style.fill.match(/[\d.]+(?=\))/)[0]) || 0.08,
                    interactive: true,

                });

                poly.bindTooltip(tooltip, { sticky: true, direction: 'top' });

                poly.on('click', (e) => {
                    L.DomEvent.stopPropagation(e);
                    const latlng = e.latlng;
                    // 2e clic sur la même zone alors que sa fiche est
                    // ouverte → on la FERME (bascule), on ne la rouvre pas.
                    if (openZonePoly === poly && openZonePopup) {
                        map.closePopup(openZonePopup);
                        return;
                    }
                    _highlightPoly(poly);
                    let stacked = _findStackedAt(latlng.lat, latlng.lng);
                    if (!stacked.length) stacked = [{ poly, ...(polyMeta.get(poly) || {}) }];
                    if (stacked.length) {
                        _showStackPopup(latlng, stacked, isFr, poly);
                    }
                });

                polyMeta.set(poly, {
                    ring, style, tooltip,

                    summary: `${style.label} — ${escapeHtml(name)} (${lower} → ${upper})`,
                });
                layerGroup.addLayer(poly);
                count++;
            });
        });

        if (controlsEl) {
            const badge = controlsEl.querySelector('.airspace-count');
            if (badge) {
                badge.textContent = count > 0 ? `${count}` : '';
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            }
        }
    }

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

    function _findStackedAt(lat, lng) {
        const found = [];
        polyMeta.forEach((m, poly) => {
            if (_pointInRing(lat, lng, m.ring)) {
                found.push({ poly, ...m });
            }
        });
        return found;
    }

    function _showStackPopup(latlng, stacked, isFr, fromPoly = null) {
        // Zone unique sous le clic : son détail directement (le contour
        // seul sans popup prêtait à confusion — le « rectangle » de la
        // liste n'apparaissait qu'au 2e clic, sur un chevauchement).
        if (stacked.length === 1) {
            const p = L.popup({ className: 'airspace-popup', maxWidth: 280, closeButton: true })
                .setLatLng(latlng)
                .setContent(stacked[0].tooltip)
                .openOn(map);
            openZonePopup = p; openZonePoly = fromPoly;
            return;
        }
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
        openZonePopup = popup; openZonePoly = fromPoly;

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

    function toggle(on) {
        visible = on;
        if (on) {
            layerGroup.addTo(map);

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

    function mountControls(el) {
        controlsEl = el;
        const isFr = state.lang === 'fr';

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

    function onMapMove() {
        if (visible && map.getZoom() >= MIN_ZOOM) {
            loadForBounds(map.getBounds());
        }
    }

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
    // Fiche fermée par ailleurs (clic carte, croix, Échap) : réinitialise
    // l'état de bascule, sinon le prochain clic sur la même zone serait avalé.
    map.on('popupclose', () => { openZonePopup = null; openZonePoly = null; });

    function setGroup(g, on) {
        if (!AIRSPACE_GROUPS[g]) return;
        if (on) activeGroups.add(g); else activeGroups.delete(g);
        if (lastItems) _render(lastItems);   // re-filtre sans re-télécharger
    }
    function getGroups() {
        const out = {};
        for (const g of Object.keys(AIRSPACE_GROUPS)) out[g] = activeGroups.has(g);
        return out;
    }

    return {
        mountControls,
        setGroup,
        getGroups,
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
