#!/usr/bin/env node
// ============================================================================
// FETCH FREQ SIA — fréquences radio officielles des terrains français,
// extraites de l'eAIP France (publication AIRAC, mise à jour tous les 28 j).
//
//   node scripts/fetch-freq-sia.mjs
//
// Source : le SIA publie l'eAIP en HTML à URL stable par cycle AIRAC :
//   https://www.sia.aviation-civile.gouv.fr/media/dvd/eAIP_<D_MMM_YYYY>/
//     FRANCE/AIRAC-<YYYY-MM-DD>/html/eAIP/FR-AD-2.<OACI>-fr-FR.html
// Chaque fiche terrain contient AD 2.17 (espaces ATS) et AD 2.18 (moyens
// de radiocommunication : Service | Indicatif | FREQ | HOR | Observations)
// — c'est la donnée réglementaire, celle des cartes.
//
// Sortie : data/freq-sia.json
//   { generatedAt, airac, counts,
//     airports: { "LFRV": [{type:"AFIS", name:"VANNES Information",
//                            value:"122.605", hor:"HO"}], … } }
// Complété côté app par data/freq-overrides.json (corrections manuelles,
// priorité maximale) ; openAIP reste la source hors France métropole.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'freq-sia.json');
const SIA = 'https://www.sia.aviation-civile.gouv.fr/media/dvd';
const DELAY_MS = 600;
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Cycle AIRAC : ancré sur 2026-07-09, tous les 28 jours. La mise à jour ne
// se fait QU'À CHAQUE NOUVEAU AIRAC (retour utilisateur 28/08) : le cron
// quotidien appelle ce script, qui sort immédiatement (exit 0, aucun
// téléchargement) tant que l'édition en vigueur est déjà extraite. Le CDN du
// SIA bannit TEMPORAIREMENT l'IP après des rafales (404 erratiques ~30 s) :
// sondes uniques et espacées, repli sur l'édition déjà connue.
const AIRAC_ANCHOR = Date.UTC(2026, 6, 9);
const AIRAC_DAY_MS = 28 * 86400000;

function baseUrlOf(date) {
    const d = new Date(date + 'T00:00:00Z');
    const folder = `eAIP_${d.getUTCDate()}_${MONTHS[d.getUTCMonth()]}_${d.getUTCFullYear()}`;
    return { date, folder, base: `${SIA}/${folder}/FRANCE/AIRAC-${date}/html/eAIP` };
}

/** Édition AIRAC en VIGUEUR aujourd'hui (la plus récente d'entrée en
 *  vigueur, sans anticipation des cycles futurs). */
function airacInForce() {
    const k = Math.max(0, Math.floor((Date.now() - AIRAC_ANCHOR) / AIRAC_DAY_MS));
    return new Date(AIRAC_ANCHOR + k * AIRAC_DAY_MS).toISOString().slice(0, 10);
}

async function probeEdition(date) {
    const { folder, base } = baseUrlOf(date);
    try {
        const res = await fetch(`${SIA}/${folder}/FRANCE/AIRAC-${date}/html/index-fr-FR.html`, { signal: AbortSignal.timeout(15000) });
        console.log(`  sonde édition ${date} → ${res.status}`);
        return res.ok ? base : null;
    } catch (e) {
        console.log(`  sonde ${date} → ${e.message.slice(0, 40)}`);
        return null;
    }
}

async function findCurrentAirac() {
    // Dernière édition EXTRAITE (data/freq-sia.json, à défaut de la
    // constante initiale vérifiée le 28/08/2026).
    let extracted = null;
    try {
        extracted = JSON.parse(fs.readFileSync(OUT, 'utf8')).airac || null;
    } catch {   }
    const known = extracted || '2026-07-09';

    // Candidats à une édition PLUS RÉCENTE que l'extraite : union de la
    // série SIA observée (ancrée 2026-07-09, 28 j) et du calendrier AIRAC
    // international — le SIA ne publie pas sa date suivante, on couvre les
    // deux cadences. Une seule sonde par date (CDN chatouilleux), 30 s
    // d'écart, uniquement les dates ENTRÉES EN VIGUEUR (jamais en avance).
    const today = new Date().toISOString().slice(0, 10);
    const intl = [
        '2026-08-20', '2026-09-17', '2026-10-15', '2026-11-12', '2026-12-10',
        '2027-01-07', '2027-02-04', '2027-03-04', '2027-04-01', '2027-04-29',
        '2027-05-27', '2027-06-24', '2027-07-22',
    ];
    const k = Math.floor((Date.now() - AIRAC_ANCHOR) / AIRAC_DAY_MS);
    const cands = new Set();
    for (let i = 0; i <= 1; i++) {
        const d = new Date(AIRAC_ANCHOR + (k - i) * AIRAC_DAY_MS).toISOString().slice(0, 10);
        if (d <= today) cands.add(d);
    }
    for (const d of intl) if (d <= today) cands.add(d);

    for (const date of [...cands].filter(d => d > known).sort().reverse()) {
        const base = await probeEdition(date);
        if (base) return { date, base };
        await sleep(30000);
    }

    // Rien de neuf : SORTIE IMMÉDIATE, aucun téléchargement — sauf --force
    // (ré-extraction du même cycle : extracteur amélioré, champ ajouté…).
    if (extracted && !process.argv.includes('--force')) {
        console.log(`À jour : AIRAC ${known} déjà extrait — rien à faire (--force pour ré-extraire).`);
        process.exit(0);
    }

    // Premier run : extraction de l'édition connue (CDN capricieux → les
    // fichiers eux-mêmes sont re-tentés par fetchText).
    const kb = baseUrlOf(known);
    console.log(`  édition de travail : ${known} (connue)`);
    return { date: known, base: kb.base };
}

async function fetchText(url) {
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
            if (res.ok) return await res.text();
            if (res.status === 404 && attempt < 2) {   // 404 erratiques du CDN
                await sleep(8000);
                continue;
            }
            if (res.status === 404) return null;
            throw new Error('HTTP ' + res.status);
        } catch (e) {
            if (attempt === 2) throw e;
            await sleep(3000);
        }
    }
}

// Liste des fiches terrains (LF**) : menu eAIP → fichier AD 2.0 → openAIP.
async function listAirports(base) {
    const fromHtml = (html) => {
        const codes = [...new Set([...html.matchAll(/FR-AD-2\.([A-Z]{2}[A-Z0-9]{2})-fr-FR\.html/g)].map(m => m[1]))];
        return codes.filter(c => c.startsWith('LF')).sort();
    };
    for (const f of ['FR-menu-fr-FR.html', 'FR-AD-2.0-fr-FR.html']) {
        const html = await fetchText(`${base}/${f}`);
        const lf = html ? fromHtml(html) : [];
        if (lf.length) { console.log(`  ${lf.length} terrains LF (${f})`); return lf; }
    }
    console.log('  menu/AD-2 indisponibles → liste des LF** via openAIP');
    const key = await getOpenAipKey();
    const codes = new Set();
    for (let lat = 41; lat < 52; lat += 5) {
        for (let lon = -6; lon < 10; lon += 5) {
            for (let attempt = 0; attempt < 3; attempt++) {
                try {
                    const res = await fetch(
                        `https://api.core.openaip.net/api/airports?bbox=${lon},${lat},${Math.min(lon + 5, 10)},${Math.min(lat + 5, 52)}&limit=1000`,
                        { headers: { 'x-openaip-api-key': key }, signal: AbortSignal.timeout(15000) });
                    if (res.ok) {
                        for (const a of ((await res.json()).items || [])) {
                            if (/^LF[A-Z0-9]{2}$/.test(a.icaoCode || '')) codes.add(a.icaoCode);
                        }
                        break;
                    }
                    console.log(`  openAIP ${lat},${lon} → ${res.status}${attempt < 2 ? ' (retente dans 20 s)' : ''}`);
                } catch (e) { console.log(`  openAIP ${lat},${lon} → ${e.message.slice(0, 40)}`); }
                await sleep(20000);
            }
            await sleep(2000);
        }
    }
    if (!codes.size) throw new Error('menu eAIP ET openAIP indisponibles');
    console.log(`  ${codes.size} terrains LF (openAIP)`);
    return [...codes].sort();
}

async function getOpenAipKey() {
    if (process.env.OPENAIP_API_KEY) return process.env.OPENAIP_API_KEY;
    const mod = await import(pathToFileURL(path.join(ROOT, 'js', 'config.local.js')).href);
    return mod.OPENAIP_API_KEY;
}

const strip = (html) => html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

// Extrait AD 2.17 + AD 2.18 (moyens radio) : lignes [Service, Indicatif,
// FREQ, HOR, Remarques] ; on ne garde que celles avec une fréquence MHz.
export function parseAdFrequencies(html) {
    const out = [];
    const trs = [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];
    for (const m of trs) {
        const cells = [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => strip(c[1]));
        if (cells.length < 3) continue;
        const freqCell = cells.find(c => /^\d{2,3}\.\d{2,3}\s*MHz$/i.test(c));
        if (!freqCell) continue;
        const value = freqCell.match(/\d{2,3}\.\d{2,3}/)[0];
        const type = cells[0] || '';
        const nameCell = cells[1] || '';
        // Indicatif bilingue « VANNES Information (FR) VANNES Information (EN) »
        // → partie française.
        const name = (nameCell.replace(/\(FR\)/g, '\u0001').split('\u0001')[0] || nameCell).trim()
            .replace(/\s*\(EN\).*$/i, '').trim();
        if (/^(A\/A|DEL|GND|TWR|AFIS|APP|ATIS|ATM|FIS|TCA|SMR|SFA)$/i.test(type) || name) {
            const hor = (cells.find(c => /^(H24|HO|HX|HC|HJ|UZ|\d{2,4}-\d{2,4})/.test(c)) || '').slice(0, 12);
            // Colonne OBSERVATIONS (5ᵉ) : secteurs, fréquences suppléantes,
            // conditions d'emploi — c'est ELLE qui différencie les fréquences
            // multiples d'un même organisme (ex. NANTES Approche : « Secteurs
            // NA 1 à 4 », « Fréquence supplétive < FL 115 »…). Publiée
            // bilingue FR/EN d'un seul tenant par le SIA : conservée telle
            // quelle (la partie française est toujours en tête de segment).
            const rem = cells
                .filter(c => c !== freqCell && c !== type && c !== nameCell && c !== hor && !/^\d{2,3}\.\d{2,3}\s*MHz$/i.test(c))
                .join(' ')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160) || null;
            out.push({ type: type.toUpperCase().slice(0, 12), name: name.slice(0, 60), value, hor, rem });
        }
    }
    // Déduplique (type+name+value) en conservant l'ordre.
    const seen = new Set();
    return out.filter(f => {
        const k = f.type + '|' + f.name + '|' + f.value;
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
    });
}

async function main() {
    // Mode ZIP LOCAL : le ZIP eAIP téléchargé depuis le portail SIA (produit
    // « ZIP eAIP Complet », gratuit) contient toutes les fiches — aucun
    // CDN, aucun 404 erratique, et la liste des terrains EST le contenu.
    //   node scripts/fetch-freq-sia.mjs --zip="chemin/du/zip.zip"
    const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=').map(decodeURIComponent)));
    if (args.zip) return mainFromZip(args.zip);
    if (args.dir) return mainFromDir(args.dir);

    const { date, base } = await findCurrentAirac();
    console.log(`AIRAC courant : ${date}`);
    const codes = await listAirports(base);
    console.log(`${codes.length} fiches terrains (LF*)`);

    const airports = {};
    let done = 0, failed = 0;
    for (const icao of codes) {
        try {
            const html = await fetchText(`${base}/FR-AD-2.${icao}-fr-FR.html`);
            if (html && !/Error 404: Not Found/.test(html)) {
                const freqs = parseAdFrequencies(html);
                if (freqs.length) airports[icao] = freqs;
            } else failed++;
        } catch (e) {
            failed++;
            console.log(`  ${icao} : ${e.message}`);
        }
        done++;
        if (done % 50 === 0) console.log(`  … ${done}/${codes.length} (${Object.keys(airports).length} avec fréquences)`);
        await sleep(DELAY_MS);
    }
    writeOut(airports, date, failed);
}

async function mainFromZip(zipPath) {
    const { execFileSync } = await import('node:child_process');
    const os = await import('node:os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eaip-'));
    console.log(`Extraction du ZIP : ${zipPath}`);
    // bsdtar de WINDOWS (System32) lit les ZIP — le GNU tar de Git Bash non.
    execFileSync('C:\\Windows\\System32\\tar.exe', ['-xf', zipPath, '-C', tmp], { stdio: 'inherit' });
    const res = await mainFromDir(tmp);
    fs.rmSync(tmp, { recursive: true, force: true });
    return res;
}

/** Exploite un dossier eAIP DÉZIPPÉ (ou une arborescence extraite) :
 *  <dir>/FRANCE/AIRAC-<date>/html/eAIP/FR-AD-2.<OACI>-fr-FR.html */
async function mainFromDir(dir) {
    let htmlDir = null, airac = null;
    const walk = (d) => {
        for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const p = path.join(d, e.name);
            if (!e.isDirectory()) continue;
            const m = e.name.match(/^AIRAC-(\d{4}-\d{2}-\d{2})$/);
            if (m) airac ??= m[1];
            if (e.name === 'eAIP' && fs.existsSync(path.join(p, 'FR-AD-2.0-fr-FR.html'))) htmlDir ??= p;
            else walk(p);
        }
    };
    walk(dir);
    if (!htmlDir) throw new Error('dossier html/eAIP introuvable (attendu FRANCE/AIRAC-<date>/html/eAIP)');
    console.log(`Édition AIRAC : ${airac || '?'}`);

    // Liste des fiches = fichiers présents (liste EXACTE du SIA : seuls les
    // terrains avec fiche eAIP — les petits terrains VFR n'en ont pas et
    // restent couverts par openAIP côté app).
    const codes = fs.readdirSync(htmlDir)
        .map(f => f.match(/^FR-AD-2\.([A-Z]{2}[A-Z0-9]{2})-fr-FR\.html$/))
        .filter(Boolean).map(m => m[1])
        .filter(c => c.startsWith('LF')).sort();
    console.log(`${codes.length} fiches terrains (LF*)`);

    const airports = {};
    for (const icao of codes) {
        const html = fs.readFileSync(path.join(htmlDir, `FR-AD-2.${icao}-fr-FR.html`), 'utf8');
        const freqs = parseAdFrequencies(html);
        if (freqs.length) airports[icao] = freqs;
    }
    writeOut(airports, airac || 'inconnue', 0);
}

function writeOut(airports, airac, failed) {
    const total = Object.values(airports).reduce((a, l) => a + l.length, 0);
    fs.writeFileSync(OUT, JSON.stringify({
        generatedAt: new Date().toISOString(),
        airac,
        source: 'SIA eAIP France AD 2.17/2.18',
        counts: { airports: Object.keys(airports).length, frequencies: total, failed },
        airports,
    }, null, 1));
    console.log(`OK : ${Object.keys(airports).length} terrains, ${total} fréquences, ${failed} échecs → data/freq-sia.json`);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch(e => { console.error(e); process.exit(1); });
