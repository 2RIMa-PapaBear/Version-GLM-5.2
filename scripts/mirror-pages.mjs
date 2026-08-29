#!/usr/bin/env node
// ============================================================================
// MIRROR PAGES — publie les fichiers PROD vers le dépôt miroir public servi
// par GitHub Pages (PWA installable : HTTPS, service worker actif).
//
//   node scripts/mirror-pages.mjs
//
// Cible : 2RIMa-PapaBear/metar-taf-pwa (branche main)
//   → https://2rima-papabear.github.io/metar-taf-pwa/
//
// Contenu : EXACTEMENT les fichiers envoyés en prod Free.fr (liste ALLOWED
// de deploy-ftp.mjs, cellules openAIP INCLUES — 274 Mo servis en HTTPS,
// plus de dépôt FTP manuel pour la PWA Pages) + README + .nojekyll.
// La synchronisation est INCRÉMENTALE : clone du miroir, copie par-dessus,
// commit si diff, push — seuls les fichiers changés partent sur le réseau.
//
// Intégré à npm run pub (après le push et la fusion du bump) : chaque
// publication met Free.fr ET Pages à jour. Appelable seul à tout moment.
// Authentification : identifiants git locaux de l'utilisateur (credential
// manager) — aucun secret à créer.
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE = 'https://github.com/2RIMa-PapaBear/metar-taf-pwa.git';
const BRANCH = 'main';

// Mêmes règles que deploy-ftp.mjs (source unique de vérité dupliquée
// volontairement : le miroir doit rester servable même si deploy-ftp évolue).
const ALLOWED = [
    'index.html', 'sw.js', 'manifest.webmanifest', 'favicon.ico', 'icon.svg',
    'notice-fr.html', 'notice-en.html',
    'js/', 'css/', 'vendor/', 'data/',
    'README.md',   // vitrine du dépôt public
];
const DENIED = [/^vendor\/pdfjs/];

const isAllowed = (f) => !DENIED.some(re => re.test(f))
    && ALLOWED.some(p => f === p || f === p.replace(/\/$/, '') || f.startsWith(p));

const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function git(args, opts = {}) {
    // maxBuffer généreux : les commits de 26 000+ fichiers écrivent des Mo
    // de « create mode … » sur stdout.
    return execFileSync('git', args, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024, ...opts,
    }).toString().trim();
}

// ---- 1. Liste des fichiers prod suivis (arbre commité, pas la copie sale) ----
const tracked = git(['ls-files'], { cwd: ROOT }).split('\n').filter(Boolean);
const files = tracked.filter(isAllowed);
if (!files.includes('index.html')) throw new Error('index.html absent de la liste miroir — abandon');
const kb = (n) => (n / 1024).toFixed(0);
log(`Miroir : ${files.length} fichiers prod (README inclus)`);

// ---- 2. Espace de travail : clone du miroir (ou init si vide) ----
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-pages-'));
let fresh = false;
try {
    git(['clone', '--depth', '20', REMOTE, tmp]);
} catch {
    // Dépôt vide (première fois) : init local.
    git(['init', '-b', BRANCH], { cwd: tmp });
    git(['remote', 'add', 'origin', REMOTE], { cwd: tmp });
    fresh = true;
}
git(['config', 'user.name', git(['config', 'user.name'], { cwd: ROOT }) || 'mirror-bot'], { cwd: tmp });
git(['config', 'user.email', git(['config', 'user.email'], { cwd: ROOT }) || 'mirror-bot@users.noreply.github.com'], { cwd: tmp });

// ---- 3. Copie par-dessus (et retrait de ce qui n'est plus dans la liste) ----
const keep = new Set(files);
keep.add('.nojekyll');
// Stub config.local.js du miroir : le vrai (relais privé + clé openAIP,
// gitignorés) ne quitte jamais le dépôt privé — sans fichier servi, la sonde
// applyLocalOverride() laisserait un 404 dans la console. Le miroir ne reçoit
// QUE la clé corsproxy.io (publique par nature côté navigateur) : la météo y
// passe par ce proxy quand aviationweather.gov bloque CORS.
const localCfg = await import(pathToFileURL(path.join(ROOT, 'js', 'config.local.js')).href).catch(() => ({}));
const corsKey = String(localCfg.CORS_PROXY_KEY || '').replace(/[^\w-]/g, '');
keep.add('js/config.local.js');
fs.mkdirSync(path.join(tmp, 'js'), { recursive: true });
const STUB = [
    '// [miroir] Config publique — le vrai config.local.js (relais privé,',
    '// clé openAIP) ne quitte jamais le dépôt privé. Seule la clé corsproxy.io',
    '// (repli météo quand aviationweather.gov bloque CORS) vit ici.',
    "export const PROXY_URL = '';",
    "export const OPENAIP_API_KEY = '';",
    `export const CORS_PROXY_KEY = '${corsKey}';`,
].join('\n') + '\n';
fs.writeFileSync(path.join(tmp, 'js', 'config.local.js'), STUB);
for (const f of files) {
    const dest = path.join(tmp, f);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(path.join(ROOT, f), dest);
}
fs.writeFileSync(path.join(tmp, '.nojekyll'), '');
// Retire les fichiers du miroir absents de la liste (hors .git).
const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (e.name === '.git') continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else {
            const rel = path.relative(tmp, p).split(path.sep).join('/');
            if (!keep.has(rel)) fs.rmSync(p);
        }
    }
};
walk(tmp);

// ---- 4. Commit si diff, puis push (5 tentatives — DNS/réseau capricieux) ----
git(['add', '-A'], { cwd: tmp });
const dirty = (() => {
    try { git(['diff', '--cached', '--quiet'], { cwd: tmp }); return false; }
    catch { return true; }
})();

if (!dirty && !fresh) {
    log('Miroir déjà à jour — rien à pousser.');
    process.exit(0);
}

const headSubject = (() => {
    try { return git(['log', '-1', '--format=%s'], { cwd: ROOT }); }
    catch { return 'synchronisation'; }
})();
git(['commit', '--quiet', '-m', `[mirror] ${headSubject}`], { cwd: tmp });

if (fresh) {
    const totalKb = files.reduce((a, f) => a + fs.statSync(path.join(ROOT, f)).size, 0);
    log(`Premier envoi du miroir : ${files.length} fichiers, ${kb(totalKb)} Ko — patience selon le débit montant…`);
}
for (let attempt = 1; attempt <= 5; attempt++) {
    try {
        git(['push', '-u', 'origin', BRANCH], { cwd: tmp });
        log(`Miroir poussé ✓ → https://2rima-papabear.github.io/metar-taf-pwa/ (Pages se construit en ~1 min)`);
        process.exit(0);
    } catch (e) {
        log(`  push miroir : tentative ${attempt}/5 échouée (${String(e.message).split('\n')[0].slice(0, 80)})`);
        await sleep(5000 * attempt);
    }
}
console.error('Échec du push miroir après 5 tentatives — relancer : node scripts/mirror-pages.mjs');
process.exit(1);
