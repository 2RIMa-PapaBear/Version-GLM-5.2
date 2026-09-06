#!/usr/bin/env node
// ============================================================================
// FETCH AIRSPACES — base mondiale d'espaces aériens, cellule par cellule.
//
//   node scripts/fetch-airspaces.mjs [--budget-minutes=300]
//
// Objectif : remplacer TOTALEMENT l'API openAIP côté client (elle refuse
// les rafales : ~4 requêtes/minute puis 429 sans en-têtes CORS). Deux modes
// de sortie complémentaires dans data/airspaces/ :
//
//   1. cells/{lat}_{lon}.json — MONDE ENTIER découpé en cellules 1°,
//      chargées à la demande par la carte (comme des tuiles). Chaque cellule
//      contient toutes les familles (le rendu filtre selon les cases).
//   2. {ctr,tma,siv,atz,rpd,tmz,autres}.json — France élargie par famille
//      (couverture 41-52N/-6-10E) : chemin instantané pour la France,
//      familles chargées selon les cases cochées.
//
// Le crawl mondial est INCRÉMENTAL : l'état (data/airspaces/.crawl.json,
// committé) mémorise le curseur ; chaque exécution avance pendant le budget
// imparti puis s'arrête proprement (cron quotidien → le monde est couvert en
// quelques jours, puis rafraîchi en continu). Les cellules d'une tuile 5°
// sont intégralement remplacées à chaque passage (une cellule 1° appartient
// à une seule tuile 5° → pas de fusion ambiguë).
//
// Filtres à l'export (identiques au client) : FIR/UIR/LTA et planchers
// > 5000 ft écartés. Coordonnées arrondies à 4 décimales (~10 m).
// Clé API : env OPENAIP_API_KEY (GitHub Actions), à défaut config.local.js.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data', 'airspaces');
const CELLS_DIR = path.join(DIR, 'cells');
const CRAWL_STATE = path.join(DIR, '.crawl.json');
const BASE = 'https://api.core.openaip.net/api/airspaces';
const LIMIT = 200;
const DELAY_MS = 2500;

const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
const BUDGET_MIN = Number(args['budget-minutes'] || 0) || 0;
const DEADLINE = BUDGET_MIN ? Date.now() + BUDGET_MIN * 60000 : Infinity;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function getKey() {
    if (process.env.OPENAIP_API_KEY) return process.env.OPENAIP_API_KEY;
    try {
        const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'config.local.js')).href);
        return mod.OPENAIP_API_KEY;
    } catch {
        throw new Error('Clé openAIP introuvable : OPENAIP_API_KEY (env) ou js/config.local.js');
    }
}

// Classification type → famille pour données openAIP BRUTES : RÉPLIQUE
// EXACTE de js/airspaces.js TYPE_MAP (numérotation openAIP, vérifiée sur
// le corpus : 5=TMZ, 6=RMZ, 13=ATZ, 14=MATZ, 25=MOA, 26=CTA…). Attention :
// la base SIA (fetch-sia-airac.mjs TYPE_NUM) a SA numérotation propre —
// côté client elle est décodée par SIA_TYPE_MAP via le marqueur _sia.
const TYPE_MAP = {
    0: 'OTHER', 1: 'RESTRICTED', 2: 'DANGER', 3: 'PROHIBITED', 4: 'CTR', 5: 'TMZ',
    6: 'RMZ', 7: 'TMA', 8: 'TMA', 9: 'TMA', 10: 'OTHER', 11: 'OTHER', 12: 'OTHER',
    13: 'ATZ', 14: 'ATZ', 15: 'GLIDER', 16: 'DANGER', 17: 'PROHIBITED',
    18: 'RESTRICTED', 19: 'RESTRICTED', 20: 'RESTRICTED', 21: 'RESTRICTED',
    22: 'RESTRICTED', 23: 'ATZ', 24: 'ATZ', 25: 'RESTRICTED', 26: 'CTA',
    27: 'OTHER', 28: 'DROP', 29: 'RESTRICTED',
    30: 'OTHER', 31: 'OTHER', 32: 'OTHER', 33: 'SIV', 34: 'CTA', 35: 'OTHER',
    36: 'CTR',
};
function decodeKind(as) {
    if (typeof as.type === 'number' && TYPE_MAP[as.type]) return TYPE_MAP[as.type];
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
const ADMIN_RE = /\bFIR\b|\bUIR\b|\bLTA\b/;
function limitToFt(lim) {
    if (!lim || !Number.isFinite(lim.value)) return null;
    if (lim.unit === 6) return lim.value * 100;
    if (lim.unit === 0) return Math.round(lim.value * 3.28084);
    return Math.round(lim.value);
}

// Tuiles 5° du monde, filtrées par un masque continental GROSSIER (les
// tuiles pleine mer renverraient 0 item — une requête économisée chacune).
const LAND_MASK = [
    [-58, -125, 72, -52],    // Amérique du Nord (contiguë + Alaska est)
    [15, -95, 33, -60],      // Caraïbes / golfe du Mexique
    [-56, -82, 13, -34],     // Amérique du Sud
    [-48, 167, -33, 179],    // Nouvelle-Zélande
    [34, -10, 72, 42],       // Europe (jusqu'à l'Oural)
    [71, 25, 78, 60],        // Nouvelle-Zemble / nord Russie
    [12, -18, 38, 52],       // Afrique nord-ouest + Proche-Orient
    [-36, 8, 12, 52],        // Afrique subsaharienne + corne
    [-11, 90, 60, 128],      // Asie (Russie sud, Chine, Inde, SE asiatique)
    [-9, 92, -1, 120],       // Indonésie
    [47, 127, 54, 143],      // Japon / Sakhaline
    [63, 165, 72, 180],      // Extrême-Orient russe
    [-48, 110, 0, 155],      // Australie + Mélanésie
    [47, -8, 61, -1],        // Royaume-Uni / Irlande
    [-55, -75, -63, -57],    // Géorgie du Sud (pouches australes)
    [60, -50, 84, -20],      // Groenland
    [-80, -180, -62, -160],  // Antarctique péninsule (ouest)
    [-85, -10, -70, 60],     // Antarctique (est + côte)
    [63, 10, 71, 30],        // Scandinavie nord
    [70, 42, 73, 75],        // Sibérie nord-est
    [24, 44, 42, 63],        // Moyen-Orient / Caucase
];
function tilesWorld() {
    const tiles = [];
    for (let lat = -85; lat < 85; lat += 5) {
        for (let lon = -180; lon < 180; lon += 5) {
            const inLand = LAND_MASK.some(([a, b, c, d]) =>
                lat + 5 > a && lat < c && lon + 5 > b && lon < d);
            if (inLand) tiles.push([lat, lon, lat + 5, lon + 5]);
        }
    }
    // Priorité au Europe/France : le premier passage du crawl couvre d'abord
    // la zone de vol de l'utilisateur, le monde se complète ensuite.
    const d = (t) => Math.abs(t[0] + 2.5 - 47) + Math.abs(((t[1] + 2.5 - 2 + 540) % 360) - 180) * 0.5;
    tiles.sort((a, b) => d(a) - d(b));
    return tiles;
}

async function fetchPage(key, bbox, page) {
    for (let attempt = 0; attempt < 5; attempt++) {
        if (Date.now() > DEADLINE) return 'budget';
        try {
            const url = `${BASE}?bbox=${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}&limit=${LIMIT}&page=${page}`;
            const res = await fetch(url, { headers: { 'x-openaip-api-key': key } });
            if (res.status === 429) {
                console.log(`  429 (page ${page}) — pause 20 s`);
                await sleep(20000);
                continue;
            }
            if (res.status === 524 || res.status === 502 || res.status === 503) throw new Error('HTTP ' + res.status);
            if (!res.ok) return null;   // définitif
            return (await res.json()).items || [];
        } catch (e) {
            console.log(`  erreur page ${page} : ${e.message} — retente`);
            await sleep(8000);
        }
    }
    return null;
}

const R4 = (v) => Math.round(v * 1e4) / 1e4;
function compactItem(it) {
    const g = it.geometry;
    let geom = null;
    if (g?.type === 'Polygon') geom = { t: 1, c: g.coordinates.map(r => r.map(([lon, lat]) => [R4(lon), R4(lat)])) };
    else if (g?.type === 'MultiPolygon') geom = { t: 2, c: g.coordinates.map(p => p.map(r => r.map(([lon, lat]) => [R4(lon), R4(lat)]))) };
    else if (g?.type === 'Point') geom = { t: 0, c: [R4(g.coordinates[0]), R4(g.coordinates[1])] };
    else if (g?.type === 'LineString') geom = { t: 3, c: g.coordinates.map(([lon, lat]) => [R4(lon), R4(lat)]) };
    const lim = (l) => l && Number.isFinite(l.value) ? [l.value, l.unit ?? 1] : null;
    return {
        i: it._id, n: it.name || it.designator || '', ty: it.type ?? null,
        ic: it.icaoClass ?? null, lo: lim(it.lowerLimit), up: lim(it.upperLimit),
        f: Array.isArray(it.frequencies) && it.frequencies.length ? it.frequencies : null,
        r: it.radius && Number.isFinite(it.radius.value) ? [it.radius.value] : null,
        g: geom,
    };
}

// Cellule 1° d'une zone : centroïde approximatif (1er point du 1er anneau).
function cellOf(it) {
    const g = it.geometry?.coordinates;
    const first = Array.isArray(g?.[0]?.[0]) ? g[0][0] : g;
    const lon = Number(first?.[0]), lat = Number(first?.[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    return [Math.floor(lat), Math.floor(lon)];
}

/** Crawl UNE tuile 5° : écrit ses 25 cellules 1° (fichier vide = cache
 * négatif). Retourne { ok, touched, budget } — ok=false : pages en échec,
 * la tuile sera reprise EN PRIORITÉ au run suivant. */
async function crawlTile(bbox, key, now) {
    const byCell = new Map();
    let page = 1;
    while (page < 40) {
        const items = await fetchPage(key, bbox, page);
        if (items === 'budget') return { ok: false, touched: 0, budget: true };
        if (items === null) { console.log(`  tuile ${bbox.join(',')} page ${page} : abandon`); return { ok: false, touched: 0, budget: false }; }
        for (const it of items) {
            const nm = String(it.name || it.designator || '').toUpperCase();
            if (ADMIN_RE.test(nm)) continue;
            if ((limitToFt(it.lowerLimit) ?? 0) > 5000) continue;
            if (limitToFt(it.upperLimit) == null) continue;
            const cell = cellOf(it);
            if (!cell) continue;
            const k = cell.join('_');
            (byCell.get(k) ?? byCell.set(k, new Map()).get(k)).set(it._id, compactItem(it));
        }
        if (items.length < LIMIT) break;
        page++;
        await sleep(DELAY_MS);
    }
    let touched = 0;
    for (let lat = bbox[0]; lat < bbox[2]; lat++) {
        for (let lon = bbox[1]; lon < bbox[3]; lon++) {
            const k = `${lat}_${lon}`;
            const arr = byCell.has(k) ? [...byCell.get(k).values()] : [];
            fs.writeFileSync(path.join(CELLS_DIR, `${k}.json`), JSON.stringify({ ts: now, n: arr.length, items: arr }));
            touched++;
        }
    }
    console.log(`  tuile ${bbox.join(',')} : ${[...byCell.values()].reduce((a, m) => a + m.size, 0)} zones → ${touched} cellules écrites`);
    return { ok: true, touched, budget: false };
}

async function main() {
    const key = await getKey();
    fs.mkdirSync(CELLS_DIR, { recursive: true });

    let state = { cursor: 0, updated: 0, pending: [] };
    try { state = { ...state, pending: [], ...JSON.parse(fs.readFileSync(CRAWL_STATE, 'utf8')) }; } catch { /* premier run */ }
    const tiles = tilesWorld();
    console.log(`Crawl mondial : ${tiles.length} tuiles 5° (masque continental), curseur ${state.cursor}, ${state.pending.length} tuile(s) à reprendre, budget ${BUDGET_MIN || '∞'} min`);

    const now = new Date().toISOString();
    let touched = 0;
    // REPRISE PRIORITAIRE des tuiles en échec des runs précédents : une
    // tuile malade ne doit pas attendre un cycle complet (bug constaté
    // 06/09 : cellules du sud-est de la France absentes alors que le
    // curseur était déjà passé — attente de semaines sinon).
    const pending = new Set((state.pending || []).filter(ti => Number.isInteger(ti) && ti >= 0 && ti < tiles.length));
    for (const ti of [...pending]) {
        if (Date.now() > DEADLINE) break;
        const r = await crawlTile(tiles[ti], key, now);
        touched += r.touched;
        if (r.ok) pending.delete(ti);
        if (r.budget) break;
    }

    for (let ti = state.cursor; ti < tiles.length; ti++) {
        const r = await crawlTile(tiles[ti], key, now);
        touched += r.touched;
        if (r.budget) { state.cursor = ti; break; }
        if (!r.ok) pending.add(ti);   // reprise prioritaire au run suivant
        state.cursor = ti + 1;
        state.updated = touched;
        state.pending = [...pending];
        fs.writeFileSync(CRAWL_STATE, JSON.stringify(state));
        if (Date.now() > DEADLINE) { console.log('Budget épuisé — arrêt propre.'); break; }
        await sleep(DELAY_MS);
    }

    if (state.cursor >= tiles.length) state.cursor = 0;   // cycle suivant
    state.pending = [...pending];
    fs.writeFileSync(CRAWL_STATE, JSON.stringify(state));
    console.log(`OK : curseur ${state.cursor}/${tiles.length}, ${state.pending.length} tuile(s) en attente, ${touched} cellules écrites ce run.`);
}

main().catch(e => { console.error(e); process.exit(1); });
