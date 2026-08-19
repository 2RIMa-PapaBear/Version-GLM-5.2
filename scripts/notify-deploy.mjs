// ============================================================================
// NOTIFY-DEPLOY — Suivi du déploiement automatique + notification Windows.
//
// Deux usages :
//   1. import { toast, waitForDeploy } → utilisé par scripts/pub.mjs
//   2. exécution directe (hook git pre-push, détaché) : attend la fin du run
//      GitHub Actions du push et affiche le toast correspondant.
//
// waitForDeploy distingue trois fins honnêtes :
//   deployed  → le run a réussi ET le bot a posé son commit [deploy]
//               (l'upload FTP a réellement eu lieu, versions bumpées)
//   nothing   → le run a réussi mais aucun fichier prod n'a changé
//               (commit dev uniquement : rien à uploader, pas de bump)
//   failed    → le run a échoué
//   timeout   → pas de conclusion à temps
//
// S'appuie sur gh (installé et authentifié sur la machine) ; sans gh, retombe
// sur la scrutation du dépôt distant (moins précise : deployed | timeout).
// ============================================================================

import { execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

function gh(args) {
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

const hasGh = (() => {
    try { execFileSync('gh', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
})();

/**
 * Affiche une fenêtre de notification Windows qui se ferme seule après 8 s,
 * + un bip console. (Les toasts/ballons natifs sont bloqués sur la machine
 * de l'utilisateur — assistant de concentration — seul le popup WScript est
 * visible, validé par test le 2026-08-19.)
 * @param {string} title ex. « Déploiement FTP Free.fr » (sans apostrophe)
 * @param {string} message texte (sans apostrophe)
 * @param {'info'|'warn'} kind info = icône information, warn = exclamation
 */
export function toast(title, message, kind = 'info') {
    process.stdout.write('\x07');   // bip console
    const type = kind === 'warn' ? 48 : 64;   // Popup : 64 = info, 48 = avertissement
    const ps = `(New-Object -ComObject WScript.Shell).Popup('${message}', 8, '${title}', ${type}) | Out-Null`;
    try {
        execFileSync('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], { stdio: 'ignore' });
    } catch { /* notification best-effort */ }
}

/**
 * Attend la fin du déploiement automatique déclenché par le push de
 * `pushedSha` sur `branch`. Retourne {status, subject?}.
 */
export async function waitForDeploy(branch, pushedSha, maxSec = 240) {
    const deadline = Date.now() + maxSec * 1000;

    if (hasGh) {
        // 1. Le run apparaît (file d'attente Actions : quelques secondes).
        let runId = null;
        while (!runId && Date.now() < deadline) {
            await sleep(3000);
            try {
                const runs = JSON.parse(gh(['run', 'list', '--branch', branch, '--limit', '5', '--json', 'databaseId,headSha,status']));
                const r = runs.find(x => x.headSha?.startsWith(pushedSha.slice(0, 8)) || x.headSha === pushedSha);
                if (r && r.status !== 'queued') runId = r.databaseId;
            } catch { /* gh indisponible à cet instant : on retente */ }
        }
        if (!runId) return { status: 'timeout' };

        // 2. Attente de la conclusion du run.
        let conclusion = null;
        while (conclusion == null && Date.now() < deadline) {
            await sleep(5000);
            try {
                const v = JSON.parse(gh(['run', 'view', String(runId), '--json', 'status,conclusion']));
                if (v.status === 'completed') conclusion = v.conclusion;
            } catch { /* on retente */ }
        }
        if (conclusion == null) return { status: 'timeout' };
        if (conclusion !== 'success') return { status: 'failed' };
    }

    // 3. Le bot a-t-il posé son commit [deploy] ? (= upload FTP réel)
    try { git(['fetch', 'origin', branch]); } catch { /* transit */ }
    if (git(['rev-parse', `origin/${branch}`]) !== pushedSha) {
        return { status: 'deployed', subject: git(['log', '-1', '--format=%s', `origin/${branch}`]) };
    }
    return hasGh ? { status: 'nothing' } : { status: 'timeout' };
}

// --- Mode watcher (hook pre-push) ---------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('notify-deploy.mjs')) {
    const BRANCH = process.argv[2] || 'Version-2.0';
    const baseSha = git(['rev-parse', 'HEAD']);
    const res = await waitForDeploy(BRANCH, baseSha, 240);
    if (res.status === 'deployed') toast('Déploiement FTP Free.fr', 'papabear56.free.fr a été mis à jour ✓');
    else if (res.status === 'nothing') toast('Déploiement FTP Free.fr', 'OK - rien à déployer (fichiers dev uniquement)');
    else if (res.status === 'failed') toast('Déploiement FTP Free.fr', 'ÉCHEC du déploiement - voir onglet Actions', 'warn');
    else toast('Déploiement FTP Free.fr', 'Pas de conclusion après 4 min - voir onglet Actions', 'warn');
    process.exit(0);
}
