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
