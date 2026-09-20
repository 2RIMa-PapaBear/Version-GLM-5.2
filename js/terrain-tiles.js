/* ================================================================
 * TERRAIN TILES — Relief depuis les tuiles « Terrarium » d'AWS
 * ================================================================
 *
 * SOURCE PRIMAIRE DU RELIEF (choix pilote 20/09) : les tuiles
 * d'altitude Terrarium du registre Open Data d'AWS (ex-Mapzen :
 * SRTM/NED/EU-DEM selon les zones, ~30-50 m/px). Gratuites, SANS clé
 * et SANS quota — le point faible du service Open-Meteo (429/jour)
 * disparaît du chemin du relief.
 *
 * Codage pixel → mètres : (R × 256 + G + B/256) − 32768.
 * Décodage DANS LE NAVIGATEUR : fetch → blob → ImageBitmap → canvas
 * (aucune taint CORS : le blob est same-origin), échantillonnage
 * bilinéaire en coordonnées Mercator « slippy ».
 * ================================================================ */

const TILE = 256;
const MAX_TILES = 40;      // garde-fou : zoom baissé si la route en couvre plus
const BASE_ZOOM = 11;      // ~50 m/px en France — résolution des données sources

/** Longitude → X flottant (en tuiles) au zoom z. Pur, testé sous Node. */
export function _lonToTileX(lon, z) {
    return (lon + 180) / 360 * 2 ** z;
}

/** Latitude → Y flottant (en tuiles) au zoom z (Mercator slippy). Pur. */
export function _latToTileY(lat, z) {
    const r = (Math.PI / 180) * Math.max(-85.051129, Math.min(85.051129, lat));
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z;
}

/** Pixel Terrarium (R, G, B) → altitude en mètres. Pur, testé sous Node. */
export function _decodeTerrarium(r, g, b) {
    return (r * 256 + g + b / 256) - 32768;
}

const _tileCache = new Map();   // 'z/x/y' → ImageBitmap (session)

/** Altitudes (mètres) d'une liste de points [{lat, lon}] depuis les tuiles
 *  Terrarium ; null si la source échoue (réseau/CORS) — l'app repliera
 *  alors sur Open-Meteo puis sur le profil interpolé. */
export async function sampleElevationsTerrarium(points) {
    const ok = (points || []).filter(p => Number.isFinite(p?.lat) && Number.isFinite(p?.lon));
    if (!ok.length) return null;

    // Zoom : couvre la route en ≤ MAX_TILES tuiles (routes très longues →
    // un zoom de moins, la résolution reste celle des données ~30 m).
    let z = BASE_ZOOM, tx0, tx1, ty0, ty1;
    for (;;) {
        const xs = ok.map(p => _lonToTileX(p.lon, z));
        const ys = ok.map(p => _latToTileY(p.lat, z));
        tx0 = Math.floor(Math.min(...xs)); tx1 = Math.floor(Math.max(...xs));
        ty0 = Math.floor(Math.min(...ys)); ty1 = Math.floor(Math.max(...ys));
        if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) <= MAX_TILES || z <= 6) break;
        z--;
    }

    const w = (tx1 - tx0 + 1) * TILE, h = (ty1 - ty0 + 1) * TILE;
    const canvas = typeof OffscreenCanvas !== 'undefined'
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement('canvas'), { width: w, height: h });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });

    // Tuiles : téléchargées en parallèle, dessinées sur la grille composée.
    // Une tuile refusée fait échouer l'ensemble (repli propre en amont).
    const jobs = [];
    for (let tx = tx0; tx <= tx1; tx++) {
        for (let ty = ty0; ty <= ty1; ty++) {
            jobs.push((async () => {
                const key = `${z}/${tx}/${ty}`;
                let bmp = _tileCache.get(key);
                if (!bmp) {
                    const res = await fetch(`https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${key}.png`,
                        { signal: AbortSignal.timeout(10000) });
                    if (!res.ok) throw new Error(`tuile ${key} HTTP ${res.status}`);
                    bmp = await createImageBitmap(await res.blob());
                    if (_tileCache.size > 120) _tileCache.clear();   // borne mémoire
                    _tileCache.set(key, bmp);
                }
                ctx.drawImage(bmp, (tx - tx0) * TILE, (ty - ty0) * TILE);
            })());
        }
    }
    await Promise.all(jobs);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Altitude au pixel global (x, y en pixels Mercator au zoom z).
    const px = (gx, gy) => {
        const x = Math.min(w - 1, Math.max(0, gx - tx0 * TILE));
        const y = Math.min(h - 1, Math.max(0, gy - ty0 * TILE));
        const i = (Math.round(y) * w + Math.round(x)) * 4;
        return _decodeTerrarium(data[i], data[i + 1], data[i + 2]);
    };
    // Bilinéaire aux pixels entiers voisins (dérive ≤ demi-pixel ~25 m).
    const bilinear = (gx, gy) => {
        const x0 = Math.floor(gx - tx0 * TILE), y0 = Math.floor(gy - ty0 * TILE);
        const fx = gx - tx0 * TILE - x0, fy = gy - ty0 * TILE - y0;
        const v00 = px(tx0 * TILE + x0, ty0 * TILE + y0);
        const v10 = px(tx0 * TILE + x0 + 1, ty0 * TILE + y0);
        const v01 = px(tx0 * TILE + x0, ty0 * TILE + y0 + 1);
        const v11 = px(tx0 * TILE + x0 + 1, ty0 * TILE + y0 + 1);
        return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
    };

    return ok.map(p => Math.round(bilinear(_lonToTileX(p.lon, z) * TILE, _latToTileY(p.lat, z) * TILE)));
}
