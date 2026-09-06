#!/usr/bin/env node
// ============================================================================
// PUB — La routine de livraison complète en UNE commande.
//
//   npm run pub                    → pousse les commits existants, attend le
//                                    déploiement automatique (~45 s), récupère
//                                    le commit [deploy] du bot (bump versions).
//   npm run pub -- "mon message"   → commit TOUT le travail avant, puis idem.
//
// Pourquoi : après chaque push, le workflow GitHub Actions bump les versions
// PWA et committe lui-même « [deploy] bump versions PWA ». Il faut récupérer
// ce commit en local, sinon le push suivant est rejeté. Ce script pousse puis
// scrute le dépôt distant jusqu'à ce que le bump apparaisse, et le fusionne.
// ============================================================================

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
import { toast, waitForDeploy } from './notify-deploy.mjs';

const args = process.argv.slice(2);
const msg = args.find(a => !a.startsWith('--')) || null;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (m) => console.log(m);

function git(gitArgs, opts = {}) {
    return execFileSync('git', gitArgs, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts }).toString().trim();
}

// Le hook pre-push lance son propre watcher détaché ; depuis pub, on notifie
// nous-mêmes → on lui signale de ne pas doubler la notification.
const GIT_ENV = { ...process.env, PUB_WATCHER: '1' };
const gitPush = (rebaseFirst) => {
    if (!rebaseFirst) return git(['push', 'origin', BRANCH], { env: GIT_ENV });
    git(['pull', '--rebase', 'origin', BRANCH], { env: GIT_ENV });
    return git(['push', 'origin', BRANCH], { env: GIT_ENV });
};

// ---- 1. Commit (si un message est fourni) -----------------------------------
if (msg) {
    if (!git(['status', '--porcelain'])) {
        log('Rien à committer (arborescence propre).');
    } else {
        git(['add', '-A']);
        const out = git(['commit', '-m', msg]);
        // Journal des versions (notice + README) : alimenté par le commit
        // qui vient d'être posé, puis intégré au même commit (amend avant
        // push — les docs partent avec le changement qu'ils décrivent).
        try {
            execFileSync('node', ['scripts/update-docs.mjs'], { cwd: ROOT, stdio: 'inherit' });
            const dirty = git(['status', '--porcelain']).split('\n').some(l => /notice-(fr|en)\.html|README\.md/.test(l));
            if (dirty) {
                git(['add', 'README.md']);
                git(['commit', '--amend', '--no-edit']);
            }
        } catch (e) { console.warn('update-docs ignoré :', String(e).slice(0, 120)); }
        log(out.split('\n').find(l => l.startsWith('[')) || 'Commit créé.');
    }
}

// ---- 2. État de la branche ---------------------------------------------------
const BRANCH = git(['rev-parse', '--abbrev-ref', 'HEAD']);
if (BRANCH !== 'Version-2.0') {
    log(`⚠ Branche « ${BRANCH} » : le déploiement automatique ne se déclenche que sur Version-2.0.`);
}

git(['fetch', 'origin', BRANCH]);
const ahead = parseInt(git(['rev-list', '--count', `origin/${BRANCH}..HEAD`]), 10) || 0;
if (!ahead) {
    log('Rien à pousser — la branche est à jour.');
    process.exit(0);
}

// ---- 3. Push (auto-guérison si un bump non récupéré bloque) ------------------
const pushedSha = git(['rev-parse', 'HEAD']);
log(`Push de ${ahead} commit(s) vers origin/${BRANCH}…`);
try {
    gitPush(false);
} catch (e) {
    log('Push rejeté (bump [deploy] non récupéré ?) — synchronisation puis nouvelle tentative…');
    gitPush(true);
}
log('Poussé ✓ — déploiement automatique en cours, attente du bump…');

// ---- 4. Suivi du run Actions, puis fusion du bump + notification ------------
// Trois issues honnêtes : deployed (upload réel + bump), nothing (commit dev
// uniquement : rien à uploader), failed (run en échec).
const res = await waitForDeploy(BRANCH, pushedSha, 240);

if (res.status === 'deployed') {
    git(['merge', '--ff-only', `origin/${BRANCH}`]);
    log(`✓ Déployé — bump récupéré et fusionné (${res.subject}) : tout est synchronisé.`);
    toast('Déploiement FTP Free.fr', 'papabear56.free.fr a été mis à jour ✓');
} else if (res.status === 'nothing') {
    log('✓ Run réussi — aucun fichier prod modifié : rien à uploader, pas de bump.');
    toast('Déploiement FTP Free.fr', 'OK - rien à déployer (fichiers dev uniquement)');
} else if (res.status === 'failed') {
    log('⚠ ÉCHEC du déploiement automatique — détails : onglet Actions du dépôt GitHub.');
    toast('Déploiement FTP Free.fr', 'ÉCHEC du déploiement - voir onglet Actions', 'warn');
} else {
    log('⚠ Pas de conclusion du run après 4 min — onglet Actions du dépôt pour voir.');
    log('  Faites simplement « git pull » dans une minute.');
    toast('Déploiement FTP Free.fr', 'Pas de conclusion après 4 min - voir onglet Actions', 'warn');
}

// ---- 5. Miroir GitHub Pages (PWA installable, HTTPS) ------------------------
// Synchronise le dépôt public metar-taf-pwa avec les fichiers prod. Un échec
// du miroir NE FAIT PAS échouer pub (Free.fr est déjà servi) — relancer
// simplement : node scripts/mirror-pages.mjs
try {
    const { spawnSync } = await import('node:child_process');
    log('Miroir GitHub Pages (metar-taf-pwa)…');
    const r = spawnSync(process.execPath, ['scripts/mirror-pages.mjs'], { stdio: 'inherit' });
    if (r.status !== 0) log('⚠ Miroir non synchronisé — relancer : node scripts/mirror-pages.mjs');
} catch (e) {
    log('⚠ Miroir ignoré : ' + String(e.message).slice(0, 80));
}

// ---- 6. Attendre le BUILD Pages (scrutation active, pas d'attente fixe) ----
// Le push du miroir déclenche une construction GitHub Pages (~1 min). On
// scrute son statut via gh, puis on lit la version réellement servie —
// remplace les « sleep 100 puis curl » à l'aveugle (demande pilote 04/09).
try {
    const { execFileSync: x } = await import('node:child_process');
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    let ghOk = false;
    try { x('gh', ['--version'], { stdio: 'ignore' }); ghOk = true; } catch { /* gh absent */ }
    if (ghOk) {
        const deadline = Date.now() + 180000;
        let status = '';
        while (Date.now() < deadline) {
            await sleep(5000);
            try {
                status = JSON.parse(x('gh', ['api', 'repos/2RIMa-PapaBear/metar-taf-pwa/pages/builds/latest', '--jq', '{status: .status}'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })).status;
            } catch { status = '?'; }
            if (status === 'built') break;
        }
        log(status === 'built' ? 'Build Pages terminé ✓' : `⚠ Build Pages non confirmé (${status || 'délai dépassé'}) — il finira de lui-même.`);
    }
    // Version servie par le miroir (contrôle final ; le CDN peut traîner).
    for (let i = 0; i < 4; i++) {
        try {
            const html = x('curl', ['-s', '--max-time', '20', 'https://2rima-papabear.github.io/metar-taf-pwa/'], { encoding: 'utf8' });
            const v = (html.match(/v=(\d+\.\d+)/) || [])[1];
            if (v) { log(`Miroir servi : v${v} ✓ — https://2rima-papabear.github.io/metar-taf-pwa/`); break; }
        } catch { /* on retente */ }
        await sleep(5000);
    }
} catch (e) {
    log('⚠ Contrôle miroir ignoré : ' + String(e.message).slice(0, 80));
}
