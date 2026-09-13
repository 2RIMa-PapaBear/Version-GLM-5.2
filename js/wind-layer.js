/* ================================================================
 * WIND LAYER — Flèches de vent à l'altitude du plan (B3, 14/09)
 * ================================================================
 *
 * LA « WINTEM INTERACTIVE » : une grille de flèches sur la carte
 * régionale, à l'altitude de croisière du plan (mode Navigation) ou
 * 2000 ft par défaut (vol local). Chaque flèche pointe DANS le sens
 * où VA le vent (origine → déplacement), couleur par force :
 *   <10 kt gris · <20 vert · <30 ambre · ≥30 rouge.
 *
 * SOURCE : Open-Meteo multi-points (une seule requête pour toute la
 * grille), niveaux 80/180/1000/1500/2000/3000 m AGL interpolés à
 * l'altitude demandée — mêmes conventions que js/winds-aloft.js.
 * ================================================================ */

import { state } from './core.js';
import { getWindAtAltitude } from './winds-aloft.js';
import { escapeHtml } from './core.js';

const MIN_ZOOM = 6;          // sous z6 : grille trop dense ou trop large
const GRID_STEP_DEG = 0.55;  // pas de grille (°) — ~33 NM
const MAX_POINTS = 48;       // garde-fou : la vue ne peut pas dépasser

// Couleur par force (kt) — cohérente avec l'échelle du widget Vent.
const _color = (kt) => kt < 10 ? '#94A3B8' : kt < 20 ? '#4ADE80' : kt < 30 ? '#F59E0B' : '#EF4444';

/** Altitude d'affichage : croisière du plan actif, sinon 2000 ft. */
export function windLayerAltFt() {
    const plan = state._lastNavPlan?.plan;
    if (plan?.cruiseAltFt > 500) return plan.cruiseAltFt;
    if (typeof document === 'undefined') return 2000;   // tests Node
    const input = document.getElementById('fp-cruise-alt');
    const v = parseInt(input?.value, 10);
    return Number.isFinite(v) && v > 500 ? v : 2000;
}

/**
 * Grille de flèches pour une bbox : [{lat, lon, speedKt, dir}] (dir vraie
 * d'ORIGINE — convertie en « vers » au rendu). PUR — testé sous Node.
 */
export function buildWindGrid(minLat, minLon, maxLat, maxLon, stepDeg = GRID_STEP_DEG, maxPoints = MAX_POINTS) {
    const pts = [];
    for (let lat = minLat; lat <= maxLat + 1e-9; lat += stepDeg) {
        for (let lon = minLon; lon <= maxLon + 1e-9; lon += stepDeg) {
            pts.push({ lat: +lat.toFixed(3), lon: +lon.toFixed(3) });
            if (pts.length >= maxPoints) return pts;
        }
    }
    return pts;
}

/** Niveaux AGL d'Open-Meteo (mètres) — mêmes que winds-aloft.js. */
const LEVELS_M = [80, 180, 1000, 1500, 2000, 3000];
const FT_PER_M = 3.28084;

/**
 * UNE SEULE requête Open-Meteo multi-points pour toute la grille (le fetch
 * point-par-point de la v1 mettait ~48 requêtes sérialisées = des secondes
 * d'attente et rien ne s'affichait — retour pilote 14/09). CORS natif,
 * donc fetch direct, hors de la file du relais.
 * @returns {Promise<Array<{lat,lon,speedKt,dir}>|null>}
 */
export async function fetchWindGrid(pts, altFt) {
    if (!Array.isArray(pts) || !pts.length) return null;
    try {
        const vars = LEVELS_M.flatMap(h => [`windspeed_${h}m`, `winddirection_${h}m`]).join(',');
        const url = 'https://api.open-meteo.com/v1/forecast'
            + '?latitude=' + pts.map(p => p.lat).join(',')
            + '&longitude=' + pts.map(p => p.lon).join(',')
            + '&current=' + vars + '&timezone=auto';
        const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
        if (!res.ok) return null;
        const arr = await res.json();
        if (!Array.isArray(arr)) return null;

        const out = [];
        arr.forEach((d, i) => {
            const p = pts[i];
            if (!p || !d?.current) return;
            const winds = LEVELS_M
                .map(h => {
                    const s = d.current['windspeed_' + h + 'm'], dir = d.current['winddirection_' + h + 'm'];
                    return (typeof s === 'number' && typeof dir === 'number')
                        ? { altFt: Math.round(h * FT_PER_M), speedKt: Math.round(s / 1.852), dir } : null;
                })
                .filter(Boolean);
            if (!winds.length) return;
            // Croisière AMSL → AGL par l'élévation du point (incluse dans la
            // réponse) : même correction que le planificateur.
            const elevFt = Math.round((d.elevation || 0) * FT_PER_M);
            winds.groundElevFt = elevFt;
            const w = getWindAtAltitude(winds, altFt);
            if (w) out.push({ lat: p.lat, lon: p.lon, speedKt: w.speedKt, dir: w.dir });
        });
        return out.length ? out : null;
    } catch (e) {
        console.warn('wind grid fetch failed:', e.message);
        return null;
    }
}

/**
 * Monte le contrôleur « Vent » dans la barre de couches + la couche
 * Leaflet (divIcon flèches). État OFF au départ (comme le radar).
 */
export function mountWindLayer(map, bar) {
    if (!map || !bar || bar.querySelector('.wind-layer-btn')) return;
    const isFr = state.lang === 'fr';

    const group = document.createElement('div');
    group.className = 'precip-control-group';
    group.innerHTML = `
        <button class="precip-toggle wind-layer-btn" aria-pressed="false" title="${isFr ? 'Vent à l\u2019altitude du plan (flèches)' : 'Wind at plan altitude (arrows)'}">
            <i data-lucide="wind" style="width:14px;height:14px;"></i>
            <span class="wind-layer-label">${isFr ? 'Vent' : 'Wind'}</span>
        </button>`;
    bar.appendChild(group);
    if (window.lucide) window.lucide.createIcons({ root: group });

    const btn = group.querySelector('.wind-layer-btn');
    let layerGroup = null;
    let epoch = 0;

    async function refresh() {
        const myEpoch = ++epoch;
        const altFt = windLayerAltFt();
        const label = btn.querySelector('.wind-layer-label');
        if (label) label.textContent = `${isFr ? 'Vent' : 'Wind'} ${altFt}`;
        btn.title = `${isFr ? 'Vent à' : 'Wind at'} ${altFt} ft ${isFr ? 'AGL (altitude du plan)' : 'AGL (plan altitude)'}`;

        layerGroup?.remove();
        layerGroup = L.layerGroup().addTo(map);

        const b = map.getBounds();
        const pts = buildWindGrid(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
        if (!pts.length) return;

        // UNE requête pour toute la grille (~200 ms mesuré), puis rendu
        // complet d'un coup — les 48 fetch sériels de la v1 ne s'affichaient
        // pas avant plusieurs secondes.
        const results = await fetchWindGrid(pts, altFt);
        if (myEpoch !== epoch) return;   // la vue a changé pendant le fetch
        if (!results) return;

        for (const r of results) {
            // Flèche orientée VERS où va le vent (dir = origine).
            const toward = (r.dir + 180) % 360;
            const col = _color(r.speedKt);
            const icon = L.divIcon({
                className: 'wind-arrow-wrap',
                html: `<div class="wind-arrow" style="transform: rotate(${toward}deg); border-bottom-color:${col};">
                       </div><span class="wind-arrow-kt" style="color:${col};">${r.speedKt}</span>`,
                iconSize: [26, 26],
                iconAnchor: [13, 13],
            });
            L.marker([r.lat, r.lon], { icon, interactive: false, keyboard: false }).addTo(layerGroup);
        }
    }

    btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        // Voyant d'état : classe .active (fond bleu) comme Radar/Espaces.
        btn.classList.toggle('active', on);
        if (on) {
            refresh();
            map.on('moveend.zoomwind windlayer:refresh', refresh);
        } else {
            epoch++;
            layerGroup?.remove();
            layerGroup = null;
            map.off('moveend.zoomwind windlayer:refresh', refresh);
        }
    });
}
