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
 * SOURCE : socle commun js/winds-aloft.js — UNE requête Open-Meteo
 * multi-points pour toute la grille, surfaces ISOBARIQUES en `hourly`
 * (B1, audit 27/09 : les niveaux en mètres de `current` ne sont jamais
 * servis — null silencieux ≥ 1000 m) interpolées à l'altitude demandée.
 * Calque « maintenant » : créneau horaire courant.
 * ================================================================ */

import { state } from './core.js';
import { getWindAtAltitude, fetchWindsAloftMulti } from './winds-aloft.js';
import { escapeHtml } from './core.js';

const MIN_ZOOM = 6;          // sous z6 : grille trop dense ou trop large
const GRID_CELLS = 9;        // ~9×9 = 81 flèches sur la dimension dominante
const GRID_MIN_CELLS = 6;    // plancher : la dimension courte garde ≥6 graduations
const MAX_POINTS = 96;       // garde-fou — une requête de ~96 points reste ~300 ms

// Couleur par force (kt) — cohérente avec l'échelle du widget Vent.
const _color = (kt) => kt < 10 ? '#94A3B8' : kt < 20 ? '#4ADE80' : kt < 30 ? '#F59E0B' : '#EF4444';

/** Altitude du calque Vent : partagée avec le plan (BIDIRECTIONNELLE —
 *  arbitrage pilote 14/09 : modifier le plan change la carte, modifier la
 *  carte change le plan, toujours identiques). Vol local : défaut 2000 ft
 *  à chaque session, JAMAIS mémorisé (arbitrage pilote). */
let _manualAltFt = 2000;

export function windLayerAltFt() {
    if (typeof document === 'undefined') return _manualAltFt;   // tests Node
    // En navigation : le champ altitude du plan est la source — la carte
    // suit (bidirectionnel : le sélecteur de la carte met à jour le champ).
    const input = document.getElementById('fp-cruise-alt');
    if (input && document.body.classList.contains('mode-nav')) {
        const v = parseInt(input.value, 10);
        if (Number.isFinite(v) && v > 0) return v;
    }
    return _manualAltFt;
}

/** Change l'altitude du calque (sélecteur carte) — met à jour le champ du
 *  plan en navigation (les deux restent identiques), puis re-rend. */
export function setWindLayerAltFt(altFt, { rerender = null } = {}) {
    _manualAltFt = Number.isFinite(+altFt) && +altFt > 0 ? +altFt : 2000;
    if (typeof document !== 'undefined' && document.body.classList.contains('mode-nav')) {
        const input = document.getElementById('fp-cruise-alt');
        if (input) {
            input.value = String(_manualAltFt);
            input.dispatchEvent(new Event('input', { bubbles: true }));   // recalcule le plan
        }
    }
    rerender?.();
}

/**
 * Grille de flèches pour une bbox : [{lat, lon}] — le pas est ADAPTATIF
 * (plus grande dimension / GRID_CELLS) : ~36 flèches RÉPARTIES SUR TOUTE
 * la vue, du zoom serré à la France entière (retour pilote 14/09 : le pas
 * fixe plafonné à 48 ne couvrait que le coin sud-ouest de la carte).
 * PUR — testé sous Node.
 */
export function buildWindGrid(minLat, minLon, maxLat, maxLon, cells = GRID_CELLS, maxPoints = MAX_POINTS) {
    const spanLat = Math.max(0.05, maxLat - minLat);
    const spanLon = Math.max(0.05, maxLon - minLon);
    const stepDeg = Math.max(spanLat, spanLon) / Math.max(2, cells);
    // La dimension dominante prend `cells` graduations ; la courte en prend
    // au moins GRID_MIN_CELLS (retour pilote : « 5 flèches sur la Bretagne,
    // trop peu ») — la grille reste équilibrée quelle que soit la forme de
    // la vue (portrait/paysage).
    const nLat = Math.max(GRID_MIN_CELLS, Math.min(cells + 1, Math.round(spanLat / stepDeg) + 1));
    const nLon = Math.max(GRID_MIN_CELLS, Math.min(Math.floor(maxPoints / nLat), Math.round(spanLon / stepDeg) + 1));
    const pts = [];
    for (let i = 0; i < nLat; i++) {
        const lat = +(minLat + (spanLat * i) / (nLat - 1)).toFixed(3);
        for (let j = 0; j < nLon; j++) {
            pts.push({ lat, lon: +(minLon + (spanLon * j) / (nLon - 1)).toFixed(3) });
            if (pts.length >= maxPoints) return pts;
        }
    }
    return pts;
}

/**
 * UNE SEULE requête Open-Meteo multi-points pour toute la grille (le fetch
 * point-par-point de la v1 mettait ~48 requêtes sérialisées = des secondes
 * d'attente et rien ne s'affichait — retour pilote 14/09). Passe par le
 * socle winds-aloft (isobare/horaire, B1/M1 audit 27/09) — calque live :
 * créneau horaire courant. CORS natif, donc hors de la file du relais
 * dans winds-aloft ; timeout couvert par fetchOpenMeteo.
 * @returns {Promise<Array<{lat,lon,speedKt,dir}>|null>}
 */
export async function fetchWindGrid(pts, altFt) {
    if (!Array.isArray(pts) || !pts.length) return null;
    try {
        const arr = await fetchWindsAloftMulti(pts);
        if (!arr) return null;
        const out = [];
        arr.forEach((winds, i) => {
            const p = pts[i];
            if (!p || !winds) return;
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

    // N9 (audit 27/09) : la liste s'arrêtait à 4500 ft — un plan volé à
    // 6000 ft (ou plus, jusqu'à la limite VFR/givrage ~10 000) faisait
    // retomber le sélecteur à 2000. Niveaux VFR usuels couverts.
    const ALTS = [500, 1000, 1500, 2000, 2500, 3000, 3500, 4500, 5500, 6500, 7500, 8500, 9500];

    const group = document.createElement('div');
    group.className = 'precip-control-group wind-ctl-group';
    // Altitude = contrôle FRÈRE du bouton, collé en « segmenté » — JAMAIS
    // un select DANS un button (retour pilote 24/09 : imbriqué, le toucher
    // du téléphone tombait 3 fois sur 4 sur le sélecteur — le libellé
    // « Vent » est masqué ≤ 700 px, le sélecteur couvrait presque toute
    // la surface du bouton).
    group.innerHTML = `
        <button class="precip-toggle wind-layer-btn" aria-pressed="false" title="${isFr ? 'Vent — flèches à l\u2019altitude affichée à droite (cliquez le nombre pour changer)' : 'Wind — arrows at the altitude shown on the right (click the number to change)'}">
            <i data-lucide="wind" style="width:14px;height:14px;"></i>
            <span class="wind-layer-label">${isFr ? 'Vent' : 'Wind'}</span>
        </button>
        <select class="wind-alt-select" title="${isFr ? 'Altitude (ft)' : 'Altitude (ft)'}" aria-label="${isFr ? 'Altitude des flèches' : 'Arrow altitude'}">
            ${ALTS.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>`;
    bar.appendChild(group);
    if (window.lucide) window.lucide.createIcons({ root: group });

    const btn = group.querySelector('.wind-layer-btn');
    const altSelect = group.querySelector('.wind-alt-select');
    let layerGroup = null;
    let epoch = 0;

    async function refresh() {
        const myEpoch = ++epoch;
        const altFt = windLayerAltFt();
        // Le sélecteur affiche TOUJOURS l'altitude courante (y compris quand
        // c'est le plan qui l'a changée — bidirectionnel).
        if (altSelect && String(altSelect.value) !== String(altFt)) {
            // N9 : repli sur le niveau le PLUS PROCHE (un plan à 6200 ft
            // suit 6500, plus un saut à 2000), et non plus sur 2000.
            const opts = [...altSelect.options].map(o => +o.value);
            const nearest = opts.reduce((a, b) => Math.abs(b - altFt) < Math.abs(a - altFt) ? b : a, opts[0] ?? 2000);
            altSelect.value = String(opts.includes(+altFt) ? altFt : nearest);
        }
        // Mais on ne DESSINE que si la couche est ACTIVE (retour pilote
        // 15/09 : au recalcul du plan — événement plan-alt — ou au changement
        // d'altitude du sélecteur, les flèches apparaissaient sur la carte
        // sans aucun appui sur le bouton, téléphone en tête).
        if (btn.getAttribute('aria-pressed') !== 'true') return;

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
                iconSize: [32, 32],
                iconAnchor: [16, 16],
            });
            L.marker([r.lat, r.lon], { icon, interactive: false, keyboard: false }).addTo(layerGroup);
        }
    }

    // Sélecteur d'altitude (contrôle frère du bouton : ses clics ne
    // peuvent plus déclencher le toggle).
    altSelect?.addEventListener('change', () => {
        setWindLayerAltFt(parseInt(altSelect.value, 10), { rerender: refresh });
    });

    // Le plan recalculé avec une nouvelle altitude → la couche suit
    // (bidirectionnel : carte ↔ plan toujours identiques).
    if (typeof document !== 'undefined') {
        document.addEventListener('windlayer:plan-alt', refresh);
    }

    // Suivi AUTOMATIQUE du déplacement/zoom de la carte (retour pilote
    // 14/09 : les flèches ne suivaient pas la fenêtre active). Leaflet
    // déclenche « moveend » (sans namespace) à la fin de chaque pan/zoom —
    // on débounce 350 ms pour ne pas requêter à chaque frame de drag.
    let _moveTimer = null;
    const onMoveEnd = () => {
        if (btn.getAttribute('aria-pressed') !== 'true') return;
        clearTimeout(_moveTimer);
        _moveTimer = setTimeout(refresh, 350);
    };
    map.on('moveend', onMoveEnd);
    map.on('zoomend', onMoveEnd);

    btn.addEventListener('click', () => {
        const on = btn.getAttribute('aria-pressed') !== 'true';
        btn.setAttribute('aria-pressed', String(on));
        // Voyant d'état : classe .active (fond bleu) comme Radar/Espaces.
        btn.classList.toggle('active', on);
        if (on) {
            refresh();
        } else {
            epoch++;
            layerGroup?.remove();
            layerGroup = null;
        }
    });
}
