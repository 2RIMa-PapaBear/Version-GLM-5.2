#!/usr/bin/env node
// ============================================================================
// FETCH AIRSPACES — régénère data/airspaces/<famille>.json depuis openAIP.
//
//   node scripts/fetch-airspaces.mjs
//
// Exporte les espaces aériens de la FRANCE ÉLARGIE (lat 41..52, lon -6..10 :
// France + Benelux + ouest Suisse + Channel) répartis PAR FAMILLE — la même
// classification que le menu « Espaces » de l'app (js/airspaces.js) :
//   ctr.json  tma.json  siv.json  atz.json  rpd.json  tmz.json  autres.json
// plus index.json (couverture + compteurs + date).
//
// Servis par notre serveur (comme data/radio-points.json), ces fichiers
// remplacent l'API openAIP pour toute vue dans la couverture : l'API refuse
// les rafales (~4 requêtes par fenêtre glissante → 429 sans en-têtes CORS),
// ces fichiers rendent la carte instantanée et silencieuse.
//
// Filtres à l'export (les mêmes que le client) : zones administratives
// FIR/UIR/LTA et planchers > 5000 ft écartés. Coordonnées arrondies à
// 4 décimales (~10 m). Format compact {i,n,ty,ic,lo,up,f,r,g} détaillé
// dans _expandFileItem() côté client.
//
// Clé API : env OPENAIP_API_KEY (GitHub Actions), à défaut config.local.js.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'data', 'airspaces');
const BASE = 'https://api.core.openaip.net/api/airspaces';
const LIMIT = 200;
const DELAY_MS = 2500;      // l'API refuse les rafales (429 Cloudflare)
const MAX_RETRIES = 5;

// Couverture France élargie.
const COVERAGE = [41, -6, 52, 10];

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

// --- Classification type → famille : RÉPLIQUE EXACTE de js/airspaces.js
// (TYPE_MAP + _decodeType + _KIND_TO_GROUP). Toute évolution du menu
// « Espaces » côté client doit être reportée ici. ---
const TYPE_MAP = {
    0: 'OTHER', 1: 'DROP', 2: 'DANGER', 3: 'PROHIBITED', 4: 'CTR', 5: 'TMA',
    6: 'ATZ', 7: 'TMA', 8: 'TMA', 9: 'TMA', 10: 'TMA', 11: 'TMZ', 12: 'RMZ',
    13: 'ATZ', 14: 'GLIDER', 15: 'RESTRICTED', 16: 'DANGER', 17: 'PROHIBITED',
    18: 'RESTRICTED', 19: 'RESTRICTED', 20: 'RESTRICTED', 21: 'RESTRICTED',
    22: 'RESTRICTED', 23: 'RESTRICTED', 24: 'GLIDER', 25: 'GLIDER',
    26: 'GLIDER', 27: 'GLIDER', 28: 'ACRO', 29: 'DROP', 30: 'OTHER',
    31: 'OTHER', 32: 'OTHER', 33: 'SIV', 34: 'CTA', 35: 'OTHER', 36: 'OTHER',
};
const KIND_TO_FAMILY = {
    CTR: 'ctr', TMA: 'tma', CTA: 'tma', SIV: 'siv', ATZ: 'atz',
    RESTRICTED: 'rpd', PROHIBITED: 'rpd', DANGER: 'rpd', DROP: 'rpd',
    TMZ: 'tmz', RMZ: 'tmz', GLIDER: 'autres', ACRO: 'autres', OTHER: 'autres',
};
const FAMILIES = ['ctr', 'tma', 'siv', 'atz', 'rpd', 'tmz', 'autres'];

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

// Tuiles ≤ 5° couvrant la zone (limite bbox openAIP).
function tilesFor(cov) {
    const [lat0, lon0, lat1, lon1] = cov;
    const tiles = [];
    for (let lat = lat0; lat < lat1; lat += 5) {
        for (let lon = lon0; lon < lon1; lon += 5) {
            tiles.push([lat, lon, Math.min(lat + 5, lat1), Math.min(lon + 5, lon1)]);
        }
    }
    return tiles;
}

async function fetchPage(key, bbox, page) {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            const url = `${BASE}?bbox=${bbox[1]},${bbox[0]},${bbox[3]},${bbox[2]}&limit=${LIMIT}&page=${page}`;
            const res = await fetch(url, { headers: { 'x-openaip-api-key': key } });
            if (res.status === 429) {
                console.log(`  429 (page ${page}) — pause 20 s`);
                await sleep(20000);
                continue;
            }
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return (await res.json()).items || [];
        } catch (e) {
            console.log(`  erreur page ${page} : ${e.message} — nouvelle tentative`);
            await sleep(5000);
        }
    }
    return null;
}

// Compacte une zone : champs utiles seulement, géométrie arrondie 4 déc.
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
        i: it._id,
        n: it.name || it.designator || '',
        ty: it.type ?? null,
        ic: it.icaoClass ?? null,
        lo: lim(it.lowerLimit),
        up: lim(it.upperLimit),
        f: Array.isArray(it.frequencies) && it.frequencies.length ? it.frequencies : null,
        r: it.radius && Number.isFinite(it.radius.value) ? [it.radius.value] : null,
        g: geom,
    };
}

async function main() {
    const key = await getKey();
    const byId = new Map();
    const tiles = tilesFor(COVERAGE);
    console.log(`Export espaces ${FAMILIES.length} familles, couverture ${COVERAGE} — ${tiles.length} tuiles ≤ 5°`);

    for (const bbox of tiles) {
        let page = 1;
        while (page < 30) {
            const items = await fetchPage(key, bbox, page);
            if (!items) { console.log(`  tuile ${bbox} page ${page} : abandon après ${MAX_RETRIES} essais`); break; }
            for (const it of items) {
                const nm = String(it.name || it.designator || '').toUpperCase();
                if (ADMIN_RE.test(nm)) continue;                      // FIR/UIR/LTA
                const loFt = limitToFt(it.lowerLimit) ?? 0;
                if (loFt > 5000) continue;                            // hors VFR
                if (limitToFt(it.upperLimit) == null) continue;       // plafond inconnu
                byId.set(it._id, it);
            }
            console.log(`  tuile ${bbox.join(',')} page ${page} : ${items.length} items (total ${byId.size})`);
            if (items.length < LIMIT) break;
            page++;
            await sleep(DELAY_MS);
        }
        await sleep(DELAY_MS);
    }

    // Répartition par famille (classification client).
    const byFamily = Object.fromEntries(FAMILIES.map(f => [f, []]));
    for (const it of byId.values()) {
        const fam = KIND_TO_FAMILY[decodeKind(it)] || 'autres';
        byFamily[fam].push(compactItem(it));
    }

    fs.mkdirSync(OUT_DIR, { recursive: true });
    const generatedAt = new Date().toISOString();
    const counts = {};
    for (const fam of FAMILIES) {
        counts[fam] = byFamily[fam].length;
        fs.writeFileSync(path.join(OUT_DIR, `${fam}.json`), JSON.stringify({
            generatedAt, coverage: COVERAGE, count: byFamily[fam].length, items: byFamily[fam],
        }));
    }
    fs.writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ generatedAt, coverage: COVERAGE, counts }));
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    const size = FAMILIES.reduce((a, f) => a + fs.statSync(path.join(OUT_DIR, `${fam2file(f)}`)).size, 0);
    function fam2file(f) { return `${f}.json`; }
    console.log(`OK : ${total} zones — ${JSON.stringify(counts)} — ${(size / 1024 / 1024).toFixed(2)} Mo au total`);
}

main().catch(e => { console.error(e); process.exit(1); });
