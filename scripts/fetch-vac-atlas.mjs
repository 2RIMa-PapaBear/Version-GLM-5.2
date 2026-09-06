#!/usr/bin/env node
// ============================================================================
// FETCH VAC ATLAS — cartes « Atterrissage à vue » (Atlas-VAC du ZIP eAIP
// complet du SIA).
//
//   node scripts/fetch-vac-atlas.mjs [--zip="chemin/eaip_<date>.zip"]
//
// Le ZIP « eAIP complet » (≈1 Go, portail SIA → Produits numériques, lien
// de téléchargement du compte) contient l'atlas VAC :
//   Atlas-VAC/PDF_AIPparSSection/VAC/AD/AD-2.<ICAO>.pdf   (≈420 terrains)
// Ce script les extrait vers data/vac-sia/<ICAO>.pdf + data/vac-sia/index.json
// (cycle AIRAC lu de FRANCE/AIRAC-<date>). Sans --zip : prend le zip eaip_*
// le plus récent de « telechargement AIRAC/ ». À lancer à chaque cycle avec
// le garde-fou airac-sia-xml (check-sia-airac.mjs contrôle aussi les VAC).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=').map(decodeURIComponent)));
const DIR = path.join(ROOT, 'data', 'vac-sia');

let zip = args.zip;
if (!zip) {
    const d = path.join(ROOT, 'telechargement AIRAC');
    const cands = fs.existsSync(d) ? fs.readdirSync(d).filter(f => /^eaip_.*\.zip$/i.test(f)).sort() : [];
    if (!cands.length) { console.error('Aucun zip eaip_* dans « telechargement AIRAC/ » — poser le ZIP eAIP complet du portail SIA, ou --zip='); process.exit(1); }
    zip = path.join(d, cands[cands.length - 1]);
}
zip = path.resolve(zip);
console.log(`ZIP : ${zip} (${(fs.statSync(zip).size / 1e9).toFixed(2)} Go)`);

// Listing (noms + cycles) : l'airac vient du chemin FRANCE/AIRAC-<date>.
const listing = execFileSync('C:\Windows\System32\tar.exe', ['-tf', zip], { encoding: 'utf8', maxBuffer: 1 << 28 }).split('\n');
const vacs = listing.filter(p => /^Atlas-VAC\/PDF_AIPparSSection\/VAC\/AD\/AD-2\.[A-Z0-9]{4}\.pdf$/.test(p));
const airac = (listing.find(p => /FRANCE\/AIRAC-\d{4}-\d{2}-\d{2}\//.test(p))?.match(/AIRAC-(\d{4}-\d{2}-\d{2})/)?.[1]) || 'inconnue';
console.log(`${vacs.length} cartes VAC · édition AIRAC ${airac}`);

// Extraction ciblée dans un dossier temp.
const tmp = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vac-'));
execFileSync('C:\Windows\System32\tar.exe', ['-xf', zip, '-C', tmp, 'Atlas-VAC/PDF_AIPparSSection/VAC/AD'], { stdio: 'inherit' });
fs.mkdirSync(DIR, { recursive: true });
const src = path.join(tmp, 'Atlas-VAC', 'PDF_AIPparSSection', 'VAC', 'AD');
const icacos = [];
for (const f of fs.readdirSync(src)) {
    const m = f.match(/^AD-2\.([A-Z0-9]{4})\.pdf$/);
    if (!m) continue;
    fs.copyFileSync(path.join(src, f), path.join(DIR, `${m[1]}.pdf`));
    icacos.push(m[1]);
}
fs.rmSync(tmp, { recursive: true, force: true });

// Purge des VAC retirées de l'édition en cours + index.
const gardes = new Set(icacos);
for (const f of fs.readdirSync(DIR)) {
    if (f.endsWith('.pdf') && !gardes.has(f.replace('.pdf', ''))) fs.unlinkSync(path.join(DIR, f));
}
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify({ generatedAt: new Date().toISOString(), airac, count: icacos.length, icacos }, null, 1));
console.log(`OK : ${icacos.length} cartes extraites → data/vac-sia/ (+ index.json, AIRAC ${airac})`);
