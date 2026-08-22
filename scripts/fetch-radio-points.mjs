#!/usr/bin/env node
// ============================================================================
// FETCH RADIO POINTS — régénère data/radio-points.json depuis openAIP.
//
//   node scripts/fetch-radio-points.mjs
//
// Pagination MONDIALE de deux collections openAIP :
//   - /navaids          (VOR, DME, NDB, TACAN…)  → tableau compact
//   - /reporting-points (points de repère VFR)   → tableau compact
//
// Clé API : variable d'environnement OPENAIP_API_KEY (GitHub Actions,
// secret), à défaut js/config.local.js (développement local).
//
// Format de sortie (compact, ~0,5 Mo pour le monde entier) :
//   { generatedAt, counts,
//     navaids: [[type, ident, lat, lon, freq, unit], …],
//     vrps:    [[name, lat, lon, country], …] }
// Coordonnées arrondies à 5 décimales (~1 m) ; freq en MHz (unit 1)
// ou kHz (unit 0) telle que fournie par openAIP.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'radio-points.json');
const BASE = 'https://api.core.openaip.net/api';
const LIMIT = 200;          // taille de page maximale acceptée
const DELAY_MS = 150;       // politesse entre pages
const MAX_RETRIES = 4;

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

/** Pagine une collection openAIP entière avec retry sur 429/5xx. */
async function fetchAll(key, collection) {
    const items = [];
    let page = 1, totalPages = Infinity;
    while (page <= totalPages) {
        const url = `${BASE}/${collection}?page=${page}&limit=${LIMIT}`;
        let json = null;
        for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
            const res = await fetch(url, { headers: { 'x-openaip-api-key': key } });
            if (res.ok) { json = await res.json(); break; }
            if (res.status === 429 || res.status >= 500) {
                await sleep(1000 * attempt);       // backoff linéaire
                continue;
            }
            throw new Error(`${collection} page ${page}: HTTP ${res.status} ${await res.text()}`);
        }
        if (!json) throw new Error(`${collection} page ${page}: épuisé après ${MAX_RETRIES} essais`);
        totalPages = json.totalPages ?? 1;
        items.push(...(json.items ?? []));
        process.stdout.write(`\r  ${collection}: ${items.length}/${json.totalCount ?? '?'}   `);
        page++;
        await sleep(DELAY_MS);
    }
    process.stdout.write('\n');
    return items;
}

const r5 = (v) => Math.round(v * 1e5) / 1e5;

const key = await getKey();
console.log('Récupération /navaids…');
const navaidsRaw = await fetchAll(key, 'navaids');
console.log('Récupération /reporting-points…');
const vrpsRaw = await fetchAll(key, 'reporting-points');

// ---- Navaids : compactage + statistiques par type ----
// Unités openAIP observées : 1 = kHz (NDB, 190-1000), 2 = MHz (VOR et
// assimilés, 108-118). Le champ type est conservé pour raffiner plus
// tard (l'énum officielle n'est pas publiée) mais la classification
// affichée repose sur la bande de fréquence, incontestable.
const navaids = [];
const byType = {};
for (const it of navaidsRaw) {
    const [lon, lat] = it.geometry?.coordinates ?? [];
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const f = it.frequency?.value;
    const freq = f != null && isFinite(+f) ? +f : null;
    const unit = it.frequency?.unit ?? null;
    navaids.push([it.type ?? 0, it.identifier ?? '?', r5(lat), r5(lon), freq, unit]);
    const t = (byType[it.type ?? 0] ??= { n: 0, ndb: 0, vor: 0, ex: [] });
    t.n++;
    if (unit === 1 && freq >= 150 && freq <= 1100) t.ndb++;
    else if (unit === 2 && freq >= 108 && freq <= 118) t.vor++;
    if (t.ex.length < 3) t.ex.push(`${it.identifier}@${freq}${unit === 1 ? 'kHz' : 'MHz'}`);
}

// ---- Points VFR : compactage ----
const vrps = [];
const byCountry = {};
for (const it of vrpsRaw) {
    const [lon, lat] = it.geometry?.coordinates ?? [];
    if (!isFinite(lat) || !isFinite(lon)) continue;
    const name = (it.name ?? '').trim().slice(0, 24);
    if (!name) continue;
    vrps.push([name, r5(lat), r5(lon), it.country ?? '']);
    byCountry[it.country ?? ''] = (byCountry[it.country ?? ''] ?? 0) + 1;
}

const out = {
    generatedAt: new Date().toISOString(),
    counts: { navaids: navaids.length, vrps: vrps.length },
    navaids,
    vrps,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`OK : ${OUT} (${kb} Ko) — ${navaids.length} navaids, ${vrps.length} points VFR`);

// ---- Rapport de classification (pour vérifier l'énum des types) ----
console.log('\nRépartition des types openAIP (classification par bande) :');
for (const t of Object.keys(byType).map(Number).sort((a, b) => a - b)) {
    const v = byType[t];
    console.log(`  type ${t} : ${String(v.n).padStart(5)} | NDB=${v.ndb} VOR=${v.vor} | ${v.ex.join(', ')}`);
}
const top = Object.entries(byCountry).sort((a, b) => b[1] - a[1]).slice(0, 8);
console.log('Points VFR par pays (top 8) :', top.map(([c, n]) => `${c}:${n}`).join(' '));
