// Collecteur de la carte de vol imprimable (B7) — pont entre les données
// applicatives et le module pur flight-map-pdf.js :
//   - normalizeZones() : items d espaces (cellules SIA/openAIP, format
//     compact ou étendu) -> descripteurs normalisés pour le tracé PDF,
//     avec les MÊMES filtres et la même sémantique AZBA que le rendu de
//     la carte régionale (base > 5000 ft écartée, FIR/UIR/LTA exclues,
//     pointillé = « par NOTAM » sans activation aujourd hui) ;
//   - buildFlightMapData() : emprise + zoom + tuiles OpenTopoMap
//     recomposées en une seule image JPEG (canvas) + zones, prêt pour
//     drawFlightMapPage().
//
// Node-safe : normalizeZones/zoneLegend sont pures (importées par la
// maquette test/gen-apercu-flight-map.mjs) ; les parties navigateur
// (canvas, fetch tuiles) sont gardées par typeof document.

import {
    AIRSPACE_STYLE, MAX_BASE_FT, _limitFt, _limitTxt, _rdpKey,
    _expandFileItem, _decodeType, _geometryToLatLngs, fetchAirspacesForBbox,
} from './airspaces.js';
import { zoneActiveToday } from './azba.js';
import { computeMapBounds, pickTileZoom, safeTileRange, mapArea } from './flight-map-pdf.js';

// Palette IMPRESSION : les couleurs écran de la carte régionale (#3B82F6,
// #FBBF24…) assombries d un cran pour rester lisibles sur papier blanc,
// mêmes familles que la décision SIA 09/09 (contrôlés = bleu).
const PRINT_COLORS = {
    CTR: [37, 99, 235], TMA: [37, 99, 235], CTA: [37, 99, 235], SIV: [37, 99, 235],
    ATZ: [180, 83, 9],
    RESTRICTED: [220, 38, 38], DANGER: [220, 38, 38], PROHIBITED: [185, 28, 28], DROP: [220, 38, 38],
    'A': [185, 28, 28], 'B': [185, 28, 28], 'C': [194, 65, 12], 'D': [194, 65, 12],
    TMZ: [109, 40, 217], RMZ: [109, 40, 217],
    GLIDER: [5, 122, 85], ACRO: [109, 40, 217],
    'E': [14, 116, 144], 'G': [100, 116, 139], OTHER: [100, 116, 139],
};
const PRINT_WEIGHT = {
    CTR: 0.8, TMA: 0.8, CTA: 0.7, SIV: 1.0, ATZ: 0.6,
    RESTRICTED: 0.9, DANGER: 0.9, PROHIBITED: 1.0, DROP: 0.9,
    'A': 1.0, 'B': 1.0, 'C': 0.9, 'D': 0.8, TMZ: 0.7, RMZ: 0.7,
};

/** Items d espaces -> zones normalisées pour le PDF.
 *  notams : dossier NOTAM courant (vide = trait plein partout — pas
 *  d info ≠ inactive, même règle que la carte). */
export function normalizeZones(items, { notams = [], now = Date.now() } = {}) {
    const out = [];
    for (const raw of items || []) {
        const as = raw && raw.geometry ? raw : _expandFileItem(raw);
        if (!as || !as.geometry || !as.geometry.coordinates) continue;
        const nameU = String(as.name || as.designator || '').toUpperCase();
        if (/\bFIR\b|\bUIR\b|\bLTA\b/.test(nameU)) continue;
        if (!as._sia && (as.type === 10 || as.type === 11 || as.type === 27)) continue;
        const baseFt = _limitFt(as.lowerLimit ?? as.lower) ?? 0;
        if (baseFt > MAX_BASE_FT) continue;

        const kind = _decodeType(as) || 'OTHER';
        const color = PRINT_COLORS[kind] || PRINT_COLORS.OTHER;
        const dashedAzba = notams.length > 0
            && !zoneActiveToday({ hor: as.hor, key: _rdpKey(as.name) }, notams, now, null);
        const radiusKm = (as.radius && typeof as.radius.value === 'number') ? as.radius.value : 5;
        const rings = _geometryToLatLngs(as.geometry, radiusKm);
        if (!rings.length) continue;

        const style = AIRSPACE_STYLE[kind] || AIRSPACE_STYLE.OTHER;
        const lo = _limitTxt(as.lowerLimit) || 'SFC';
        const up = _limitTxt(as.upperLimit);
        out.push({
            rings,
            color, fill: color,
            weight: PRINT_WEIGHT[kind] ?? 0.7,
            // SIV : pointillé PERMANENT (représentation SIA) ; les autres
            // familles ne le deviennent que par la sémantique AZBA.
            dashed: dashedAzba || kind === 'SIV',
            label: String(as.name || style.label || kind).trim(),
            sub: up ? `${lo} - ${up}` : lo,
            kind,
        });
    }
    return out;
}

const LEGEND_GROUPS = (isFr) => ([
    { kinds: ['CTR', 'TMA', 'CTA'], color: PRINT_COLORS.CTR, label: isFr ? 'Contrôlés' : 'Controlled' },
    { kinds: ['SIV'], color: PRINT_COLORS.SIV, label: 'SIV', dashed: true },
    { kinds: ['ATZ'], color: PRINT_COLORS.ATZ, label: 'ATZ' },
    {
        kinds: ['RESTRICTED', 'PROHIBITED', 'DANGER', 'DROP', 'A', 'B', 'C', 'D'],
        color: PRINT_COLORS.RESTRICTED, label: isFr ? 'Zones R · P · D' : 'R · P · D',
    },
    { kinds: ['TMZ', 'RMZ'], color: PRINT_COLORS.TMZ, label: 'TMZ · RMZ' },
]);

/** Échantillons de légende pour les familles RÉELLEMENT présentes. */
export function zoneLegend(zones, isFr = true) {
    const kinds = new Set(zones.map((z) => z.kind));
    return LEGEND_GROUPS(isFr)
        .filter((g) => g.kinds.some((k) => kinds.has(k)))
        .map((g) => ({ label: g.label, color: g.color, dashed: !!g.dashed }));
}

// ---------------------------------------------------------------------------
// Partie NAVIGATEUR (maquette Node : ces fonctions retournent null).
// ---------------------------------------------------------------------------

const TILE_HOSTS = ['a', 'b', 'c'];

function _loadTileImg(src) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => resolve(null);
        img.src = src;
    });
}

/** Grille de tuiles OpenTopoMap recomposée en UNE image JPEG aux bornes
 *  exactes de l emprise (canvas) — la carte tient en un seul objet dans
 *  le PDF (~300 Ko) au lieu de ~30 tuiles. Hors ligne : null (repli
 *  vectoriel blanc, tracé conservé). */
export async function compositeOtmTiles(bounds, range) {
    if (typeof document === 'undefined') return null;
    const bx0 = (range.x0 * 256), by0 = (range.y0 * 256);
    const bw = range.nx * 256, bh = range.ny * 256;
    let canvas, ctx;
    try {
        canvas = document.createElement('canvas');
        canvas.width = bw; canvas.height = bh;
        ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fdfcf8';
        ctx.fillRect(0, 0, bw, bh);
    } catch { return null; }

    const jobs = [];
    for (let ix = 0; ix < range.nx; ix++) {
        for (let iy = 0; iy < range.ny; iy++) jobs.push({ ix, iy });
    }
    // File à 4 tuiles parallèles (le serveur communautaire refuse les
    // rafales) ; les tuiles déjà affichées à l écran sont chaudes en cache
    // HTTP — l export n ajoute quasiment rien. Budget global 20 s : au-delà
    // on rend la mosaïque PARTIELLE (trous blancs) plutôt que de bloquer
    // l impression du dossier.
    const deadline = Date.now() + 20000;
    let i = 0, failed = 0;
    const worker = async () => {
        while (i < jobs.length && Date.now() < deadline) {
            const j = jobs[i++];
            const host = TILE_HOSTS[(j.ix + j.iy * 3) % 3];
            try {
                const res = await fetch(`https://${host}.tile.opentopomap.org/${range.z}/${range.x0 + j.ix}/${range.y0 + j.iy}.png`,
                    { signal: AbortSignal.timeout(9000) });
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const url = URL.createObjectURL(await res.blob());
                const img = await _loadTileImg(url);
                URL.revokeObjectURL(url);
                if (img) ctx.drawImage(img, j.ix * 256, j.iy * 256, 256, 256);
                else failed++;
            } catch { failed++; }
        }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    if (failed >= jobs.length) return null;   // rien : repli vectoriel
    try {
        return { z: range.z, single: { data: canvas.toDataURL('image/jpeg', 0.82), fmt: 'JPEG' } };
    } catch { return null; }
}

/** Assemblage complet pour drawFlightMapPage() — null si rien à tracer
 *  (ni route ni terrain). Jamais throw : chaque source dégrade seule. */
export async function buildFlightMapData({
    isFr = true, generatedLabel = '', routeLabel = '',
    route = [], alternates = [], notams = [],
} = {}) {
    if (!route.length && !alternates.length) return null;
    const bounds = computeMapBounds(route, alternates, { aspect: mapArea().w / mapArea().h });
    const z = pickTileZoom(bounds);
    const range = safeTileRange(bounds, z);

    let tiles = null;
    try { tiles = await compositeOtmTiles(bounds, range); } catch { /* repli */ }
    let items = [];
    try {
        items = await fetchAirspacesForBbox(bounds.minLat, bounds.minLon, bounds.maxLat, bounds.maxLon) || [];
    } catch { /* zones absentes : la route et les terrains restent */ }

    const zones = normalizeZones(items, { notams, now: Date.now() });
    const legend = zoneLegend(zones, isFr);
    const hasAzbaDash = zones.some((zn) => zn.dashed && zn.kind !== 'SIV');
    return {
        isFr, generatedLabel, routeLabel,
        bounds, tiles,
        route, alternates, zones, legend,
        legendNote: hasAzbaDash
            ? (isFr ? 'Plein : active ou sans info · pointillé : non active ce jour (AZBA)'
                : 'Solid: active or unknown · dashed: not active today (AZBA)')
            : '',
    };
}
