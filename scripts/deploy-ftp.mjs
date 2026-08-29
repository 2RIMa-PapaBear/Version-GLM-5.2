#!/usr/bin/env node
// ============================================================================
// DEPLOY-FTP — Upload Free.fr des fichiers modifiés depuis le dernier déploiement.
//
// Usage :
//   npm run deploy            → upload normal (lit deploy.config.json)
//   npm run deploy -- --dry-run        → liste ce qui partirait, sans toucher au FTP
//   npm run deploy -- --since=<ref>    → base de comparaison explicite (sha, HEAD~2…)
//   npm run deploy -- --all            → (re)envoie TOUS les fichiers autorisés
//
// Principe : git diff --name-status <dernier déployé>..HEAD, filtré sur les
// chemins « prod » (index.html, sw.js, js/, css/, vendor/, data/…). Les A/M
// sont uploadés, les D supprimés côté serveur. À la fin, l'état (sha HEAD)
// est mémorisé dans deploy.state.json et la prod est vérifiée au curl
// (version du shell sw.js + numéros ?v= d'index.html) — le rappel du bump
// version est automatique si oubli.
//
// Identifiants : deploy.config.json (gitignoré, voir deploy.config.example.json).
// ============================================================================

import { Client } from 'basic-ftp';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bumpVersions } from './bump-version.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG_PATH = path.join(ROOT, 'deploy.config.json');
const STATE_PATH = path.join(ROOT, 'deploy.state.json');

// Seuls ces chemins partent en prod (le reste du dépôt = dev : test/,
// apps-script/, scripts/, package.json…).
const ALLOWED = [
    'index.html', 'sw.js', 'manifest.webmanifest', 'favicon.ico', 'icon.svg',
    'notice-fr.html', 'notice-en.html',
    'js/', 'css/', 'vendor/', 'data/',
];
// … sauf outilage dev hébergé dans vendor/ (pdfjs ne sert que aux aperçus locaux).
// … sauf outilage dev hébergé dans vendor/ (pdfjs ne sert qu'aux aperçus locaux)
// et les CELLULES openAIP (data/airspaces/cells/) : ~27 000 fichiers, le débit
// Free.fr (~10 fichiers/min) rend l'upload impossible dans un run Actions —
// l'utilisateur les pose directement sur le FTP (décision 29/08). Base SIA,
// radio-points et obstacles restent déployés normalement.
const DENIED = [/^vendor\/pdfjs/, /^data\/airspaces\/cells\//];

const DRY = process.argv.includes('--dry-run');
const sinceArg = process.argv.find(a => a.startsWith('--since='));
const ALL = process.argv.includes('--all');
const BUMP = process.argv.includes('--bump');

const log = (m) => console.log(m);
const ok = (m) => console.log('  ✓ ' + m);
const warn = (m) => console.log('  ⚠ ' + m);

const isAllowed = (f) => !DENIED.some(re => re.test(f))
    && ALLOWED.some(p => f === p || f === p.replace(/\/$/, '') || f.startsWith(p));

function git(cmd) {
    return execSync(cmd, { cwd: ROOT, encoding: 'utf8' }).trim();
}

// Dernier commit marqueur « [deploy] … » posé par le déploiement automatique
// (GitHub Actions) : c'est l'état de déploiement vu du dépôt, contrairement à
// deploy.state.json qui ne vit que sur la machine locale.
function lastDeployMarker() {
    try { return git("git log -1 --grep '^\\[deploy\\]' --format=%H"); } catch { return null; }
}

// ---- 1. Liste des fichiers à traiter --------------------------------------
function collectFiles() {
    if (ALL) {
        const files = git('git ls-files').split('\n').filter(Boolean).filter(isAllowed);
        return { uploads: files, deletes: [] };
    }
    const state = fs.existsSync(STATE_PATH) ? JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')) : null;
    // Base : --since explicite > état local (deploy.state.json) > marqueur [deploy] du dépôt.
    const base = sinceArg ? sinceArg.slice(8) : (state?.lastSha || lastDeployMarker());
    if (!base) {
        console.error('Aucun point de départ : lancez d\'abord avec --since=<ref> (ex. --since=8824988) ou --all.');
        process.exit(1);
    }
    const baseSha = git(`git rev-parse --verify "${base}^{commit}"`);
    const headSha = git('git rev-parse HEAD');
    if (baseSha === headSha) {
        return { uploads: [], deletes: [], base, headSha, note: 'rien de nouveau depuis le dernier déploiement' };
    }
    const lines = git(`git diff --name-status --no-renames ${baseSha}..HEAD`).split('\n').filter(Boolean);
    const uploads = [], deletes = [], skipped = [];
    for (const line of lines) {
        const [status, file] = line.split('\t');
        if (!isAllowed(file)) { skipped.push(file); continue; }
        if (status === 'D') deletes.push(file);
        else uploads.push(file);
    }
    if (skipped.length) {
        log(`Fichiers modifiés hors périmètre prod (ignorés) : ${skipped.join(', ')}`);
    }
    return { uploads, deletes, base, headSha };
}

// Fichiers autorisés modifiés mais NON commités → avertir (on ne déploie que du commité).
function warnDirty() {
    const dirty = git('git status --porcelain').split('\n').filter(Boolean)
        .map(l => l.slice(3).trim()).filter(isAllowed);
    if (dirty.length) warn(`modifications locales non commitées ignorées : ${dirty.join(', ')}`);
}

// ---- 2. Vérification post-déploiement (le réflexe curl, automatisé) --------
async function verifyProd() {
    const nc = Date.now();
    const grab = async (url) => (await fetch(`${url}?nocache=${nc}`).catch(() => null))?.text() ?? null;
    const [swHtml, idx] = await Promise.all([
        grab('http://papabear56.free.fr/sw.js'),
        grab('http://papabear56.free.fr/index.html'),
    ]);
    log('\n--- Vérification prod ---');
    if (swHtml == null || idx == null) { warn('prod injoignable au curl — vérifiez à la main'); return; }
    const prodCache = swHtml.match(/CACHE = '([^']+)'/)?.[1];
    const localCache = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8').match(/CACHE = '([^']+)'/)?.[1];
    const prodV = [...new Set((idx.match(/v=\d+\.\d+/g) ?? []))].sort().join(', ');
    const localV = [...new Set((fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/v=\d+\.\d+/g) ?? []))].sort().join(', ');
    ok(`sw.js prod : ${prodCache} (local : ${localCache})`);
    ok(`index.html prod : ${prodV} (local : ${localV})`);
    if (prodCache !== localCache) warn('le CACHE de sw.js diffère du local — bump oublié ? Les PWA ne se rafrachiront pas.');
    if (prodV !== localV) warn('les ?v= d\'index.html diffèrent du local — bump oublié ?');
}

// ---- 3. Transfert FTP -------------------------------------------------------
// Identifiants : deploy.config.json (usage local) ou variables d'environnement
// FTP_HOST / FTP_USER / FTP_PASSWORD (usage GitHub Actions — secrets du dépôt).
function resolveConfig() {
    if (fs.existsSync(CONFIG_PATH)) {
        return { secure: false, remoteRoot: '/', ...JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')) };
    }
    if (process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD) {
        return { host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASSWORD, secure: false, remoteRoot: '/' };
    }
    return null;
}

async function deploy(uploads, deletes, headSha) {
    const cfg = resolveConfig();
    if (!cfg) {
        console.error('Identifiants FTP introuvables — deploy.config.json (local) ou FTP_HOST/FTP_USER/FTP_PASSWORD (CI).');
        process.exit(1);
    }
    const client = new Client(30000);
    await client.access({
        host: cfg.host, user: cfg.user, password: cfg.password,
        port: cfg.port || 21, secure: cfg.secure ?? false,
    });
    log(`Connecté à ${cfg.host} — ${uploads.length} upload(s), ${deletes.length} suppression(s)`);
    const madeDirs = new Set();
    try {
        for (const f of uploads) {
            const remote = (cfg.remoteRoot || '/') + f;
            const dir = path.posix.dirname(remote);
            if (!madeDirs.has(dir)) { await client.ensureDir(dir); madeDirs.add(dir); }
            let done = false;
            for (let attempt = 1; attempt <= 3 && !done; attempt++) {
                try {
                    await client.uploadFrom(path.join(ROOT, f), remote);
                    done = true;
                } catch (e) {
                    if (attempt === 3) throw e;
                    warn(`${f} : tentative ${attempt} échouée (${e.message}) — nouvelle essai`);
                }
            }
            ok(`upload ${f}`);
        }
        for (const f of deletes) {
            const remote = (cfg.remoteRoot || '/') + f;
            try { await client.remove(remote); ok(`supprimé ${f}`); }
            catch { warn(`suppression impossible de ${f} (fichier absent côté serveur ?)`); }
        }
    } finally {
        client.close();
    }
}

// ---- Orchestration ----------------------------------------------------------
const saveState = (sha) => fs.writeFileSync(STATE_PATH,
    JSON.stringify({ lastSha: sha, at: new Date().toISOString() }, null, 2));

const { uploads, deletes, headSha = git('git rev-parse HEAD'), note } = collectFiles();
warnDirty();
if (note) {
    log(note);
    if (!DRY) saveState(headSha);   // mémorise le point de départ même sans transfert
    process.exit(0);
}
if (!uploads.length && !deletes.length) { log('Rien à déployer.'); process.exit(0); }

log(DRY ? '=== SIMULATION (dry-run) — rien ne sera envoyé ===' : '=== DÉPLOIEMENT FTP ===');
for (const f of uploads) log(`  ↑ ${f}`);
for (const f of deletes) log(`  × ${f} (suppression)`);

// Bump des versions PWA (index.html ?v= + sw.js CACHE) : appliqué AVANT
// l'upload pour que les fichiers envoyés portent les nouvelles versions.
// En dry-run, on ne touche à rien — on affiche juste le prochain bump.
if (BUMP) {
    if (DRY) {
        log('  ↻ bump versions PWA : serait appliqué (?v= et CACHE incrémentés)');
    } else {
        const b = bumpVersions(ROOT);
        b.write();
        for (const f of ['index.html', 'sw.js']) if (!uploads.includes(f)) uploads.push(f);
        log(`  ↻ bump appliqué : index.html ?v=${b.vHtml} · sw.js CACHE='${b.vShell}'`);
    }
}

if (DRY) {
    log('\nDry-run terminé — aucun fichier envoyé, état inchangé.');
} else {
    await deploy(uploads, deletes, headSha);
    saveState(headSha);
    await verifyProd();
}
