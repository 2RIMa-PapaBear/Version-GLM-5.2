// Maquette B7 — carte de vol imprimable (page A5 paysage du dossier).
// Usage : node test/gen-apercu-flight-map.mjs
//   → Apercu_Carte_vol_LFRV-LFOO.pdf            (fond relief OpenTopoMap réel)
//   → Apercu_Carte_vol_LFRV-LFOO_sans-fond.pdf  (repli vectoriel blanc)
// DONNÉES RÉELLES : route + alternates depuis data/airports.json (couloir
// ±25 NM, piste ≥1000 ft, répartition), zones depuis data/sia-airspaces.json,
// tuiles OpenTopoMap récupérées en direct (fetch Node).
// Ce script n'est PAS exécuté par `npm test` (liste explicite des fichiers).
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Le bundle UMD de jsPDF attend un contexte navigateur : évaluation dans un
// wrapper CommonJS avec self polyfillé (Node, pas de DOM).
globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;

const { drawFlightMapPage, computeMapBounds, pickTileZoom, safeTileRange, mapArea }
    = await import(pathToFileURL(path.join(root, 'js', 'flight-map-pdf.js')).href);
const { normalizeZones, zoneLegend } = await import(pathToFileURL(path.join(root, 'js', 'flight-map-collect.js')).href);

// ---------- données réelles ----------
const airports = JSON.parse(fs.readFileSync(path.join(root, 'data', 'airports.json'), 'utf8'));
const byIcao = (icao) => airports.find((a) => a.icao === icao);
const LFRV = byIcao('LFRV'), LFOO = byIcao('LFOO'), LFRD = byIcao('LFRD');
const route = [
    { lat: LFRV.lat, lon: LFRV.lon, code: 'LFRV', name: 'Vannes Golfe du Morbihan', role: 'dep' },
    { lat: LFOO.lat, lon: LFOO.lon, code: 'LFOO', name: 'Les Sables-d\'Olonne', role: 'dest' },
];

// Alternates de couloir (même règle que l app : ±25 NM de la route, piste
// ≥1000 ft) — répartition régulière le long du tracé.
const R_NM = 3440.065;   // rayon terrestre NM
const toRad = (d) => (d * Math.PI) / 180;
function distNm(a, b) {
    const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.sqrt(s));
}
function distToSegNm(p, a, b) {
    const ab = distNm(a, b), ap = distNm(a, p);
    if (ab < 0.01) return ap;
    const t = Math.max(0, Math.min(1, ((ap * ap) / (ab * ab)) * 0.98));   // proj. approx.
    const m = { lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t };
    return Math.min(distNm(p, a), distNm(p, m), distNm(p, b));
}
const cands = airports.filter((a) => {
    if (!/^LF[A-Z]{2}$/.test(a.icao) || a.icao === 'LFRV' || a.icao === 'LFOO') return false;
    if ((a.longestRunway || 0) < 1000) return false;
    return distToSegNm(a, LFRV, LFOO) <= 25;
});
cands.sort((x, y) => distToSegNm(x, LFRV, LFOO) - distToSegNm(y, LFRV, LFOO));
const alts = cands.slice(0, 5).map((a, i) => ({
    lat: a.lat, lon: a.lon, code: a.icao, name: a.name,
}));
console.log('alternates :', alts.map((a) => a.code).join(' '));
const alternates = [
    ...alts,
    { lat: LFRD.lat, lon: LFRD.lon, code: 'LFRD', name: 'Dinard', diversion: true },
];

// Zones SIA réelles sur l'emprise (préfiltre par bbox des anneaux).
// Cadrage = la ROUTE seule (« Cadrer plan ») : les terrains hors emprise
// (ex. dégagement Dinard au NE d une route sud) sont rabattus au bord.
const sia = JSON.parse(fs.readFileSync(path.join(root, 'data', 'sia-airspaces.json'), 'utf8'));
const bounds = computeMapBounds(route, [], { aspect: mapArea().w / mapArea().h });
let zones = normalizeZones(sia.items, { notams: [] });
zones = zones.filter((z) => {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const ring of z.rings) for (const [lat, lon] of ring) {
        if (lat < minY) minY = lat; if (lat > maxY) maxY = lat;
        if (lon < minX) minX = lon; if (lon > maxX) maxX = lon;
    }
    return maxX >= bounds.minLon && minX <= bounds.maxLon && maxY >= bounds.minLat && minY <= bounds.maxLat;
});
const byKind = {};
zones.forEach((z) => { byKind[z.kind] = (byKind[z.kind] || 0) + 1; });
console.log(`zones sur l'emprise : ${zones.length}`, JSON.stringify(byKind));

// ---------- tuiles OpenTopoMap réelles (fetch Node, file à 4) ----------
const z = pickTileZoom(bounds);
const range = safeTileRange(bounds, z);
console.log(`tuiles : z${z} ${range.nx}x${range.ny} = ${range.nx * range.ny}`);
const jobs = [];
for (let ix = 0; ix < range.nx; ix++) for (let iy = 0; iy < range.ny; iy++) jobs.push({ ix, iy });
const images = [];
let i = 0;
const worker = async () => {
    while (i < jobs.length) {
        const j = jobs[i++];
        const host = ['a', 'b', 'c'][(j.ix + j.iy * 3) % 3];
        try {
            const res = await fetch(`https://${host}.tile.opentopomap.org/${range.z}/${range.x0 + j.ix}/${range.y0 + j.iy}.png`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const buf = Buffer.from(await res.arrayBuffer());
            images.push({ ix: j.ix, iy: j.iy, data: 'data:image/png;base64,' + buf.toString('base64'), fmt: 'PNG' });
        } catch (e) { console.warn(`tuile ${j.ix},${j.iy} : ${e.message}`); }
    }
};
await Promise.all([worker(), worker(), worker(), worker()]);
console.log(`tuiles OK : ${images.length}/${jobs.length}`);

// ---------- pages ----------
const common = {
    isFr: true,
    routeLabel: 'LFRV - LFOO · dégagement LFRD',
    generatedLabel: new Date().toLocaleString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
    bounds,
    route,
    alternates,
    zones,
    legend: zoneLegend(zones, true),
    legendNote: '',
};

const mkPdf = (tiles, out) => {
    const doc = new jsPDF({ unit: 'pt', format: [595.28, 419.53], orientation: 'landscape' });
    drawFlightMapPage(doc, { ...common, tiles });
    doc.deletePage(1);   // la page vierge du constructeur : la carte reste seule
    fs.writeFileSync(path.join(root, out), Buffer.from(doc.output('arraybuffer')));
    console.log(`OK : ${out} (${(fs.statSync(path.join(root, out)).size / 1024).toFixed(0)} Ko)`);
};

if (images.length) {
    mkPdf({ z, grid: { x0: range.x0, y0: range.y0, nx: range.nx, ny: range.ny, images } },
        'Apercu_Carte_vol_LFRV-LFOO.pdf');
}
mkPdf(null, 'Apercu_Carte_vol_LFRV-LFOO_sans-fond.pdf');
