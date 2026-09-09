// ============================================================================
// PUBLISH TEST PAGES — publie version-test/ dans le sous-dossier /test/ du
// dépôt miroir GitHub Pages, À CÔTÉ de la version principale (jamais par-
// dessus) :
//
//   https://2rima-papabear.github.io/metar-taf-pwa/test/
//
//   node scripts/publish-test-pages.mjs             (publie réellement)
//   node scripts/publish-test-pages.mjs --dry-run   (simulation, zéro envoi)
//
// GARDE-FOUS :
//   - seule l'arborescence test/ du clone est modifiée (jamais la racine,
//     qui reste la vraie PWA du pilote) ;
//   - refus si version-test/ manque ou ne contient pas js/gps.js ;
//   - en --dry-run : clone + copie + calcul du diff, puis STOP (pas de
//     commit, pas de push).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'version-test');
const REMOTE = 'https://github.com/2RIMa-PapaBear/metar-taf-pwa.git';
const BRANCH = 'main';
const DRY = process.argv.includes('--dry-run');

const log = (m) => console.log(m);
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function git(args, opts = {}) {
    return execFileSync('git', args, {
        encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
        maxBuffer: 256 * 1024 * 1024, ...opts,
    }).toString().trim();
}

// ---- 0. Garde-fous ----------------------------------------------------------
if (!fs.existsSync(path.join(SRC, 'index.html'))) {
    throw new Error('version-test/ absente — lancer d\'abord scripts/build-test-version.mjs');
}
if (!fs.existsSync(path.join(SRC, 'js', 'gps.js'))) {
    throw new Error('version-test/js/gps.js absent — ce n\'est pas un build GPS, abandon');
}

// ---- 1. Clone du miroir -----------------------------------------------------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mirror-test-'));
try {
    git(['clone', '--depth', '20', REMOTE, tmp]);
} catch (e) {
    throw new Error('clone du miroir impossible : ' + String(e.message).split('\n')[0]);
}
git(['config', 'user.name', git(['config', 'user.name'], { cwd: ROOT }) || 'mirror-bot'], { cwd: tmp });
git(['config', 'user.email', git(['config', 'user.email'], { cwd: ROOT }) || 'mirror-bot@users.noreply.github.com'], { cwd: tmp });

// ---- 2. Remplacement complet du sous-dossier test/ --------------------------
const dest = path.join(tmp, 'test');
fs.rmSync(dest, { recursive: true, force: true });
fs.mkdirSync(dest, { recursive: true });
fs.cpSync(SRC, dest, { recursive: true });
log(`Copie de version-test/ → test/ (${DRY ? 'SIMULATION' : 'réelle'})`);

// ---- 3. Diff ----------------------------------------------------------------
git(['add', 'test'], { cwd: tmp });
const changed = git(['status', '--porcelain', '--', 'test'], { cwd: tmp })
    .split('\n').filter(Boolean);
const dels = changed.filter(l => l.startsWith('D')).length;
const adds = changed.filter(l => l.startsWith('A')).length;
const mods = changed.length - dels - adds;
log(`Diff : ${adds} ajout(s), ${mods} modifié(s), ${dels} supprimé(s)`);
changed.slice(0, 8).forEach(l => log('  ' + l));
if (changed.length > 8) log(`  … +${changed.length - 8} autres`);

if (changed.length === 0) {
    log('Version test déjà à jour — rien à pousser.');
    process.exit(0);
}

if (DRY) {
    log('\nDRY-RUN terminé : RIEN n\'a été commité ni poussé.');
    process.exit(0);
}

// ---- 4. Commit + push (5 tentatives) ----------------------------------------
git(['commit', '--quiet', '-m', '[mirror-test] version test GPS (v99.254)'], { cwd: tmp });
for (let attempt = 1; attempt <= 5; attempt++) {
    try {
        git(['push', '-u', 'origin', BRANCH], { cwd: tmp });
        log('Version test poussée ✓ → https://2rima-papabear.github.io/metar-taf-pwa/test/ (Pages se construit en ~1 min)');
        process.exit(0);
    } catch (e) {
        log(`  push : tentative ${attempt}/5 échouée (${String(e.message).split('\n')[0].slice(0, 80)})`);
        await sleep(5000 * attempt);
    }
}
throw new Error('push impossible après 5 tentatives — vérifier le réseau puis relancer');
