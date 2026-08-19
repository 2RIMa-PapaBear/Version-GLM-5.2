// ============================================================================
// NOTIFY-DEPLOY — Notification Windows (toast/ballon) de fin de déploiement.
//
// Deux usages :
//   1. import { toast }  → utilisé par scripts/pub.mjs à la fin de sa routine
//   2. exécution directe (via le hook git pre-push, détaché) : scrute le dépôt
//      distant jusqu'à l'apparition du commit [deploy] du bot — c'est lui qui
//      signe la fin du déploiement FTP — puis affiche le toast.
//
// Le déplacement de origin/Version-2.0 après un push = le bot a committé le
// bump = l'upload FTP a réussi (sinon le workflow s'arrête avant son commit).
// ============================================================================

import { execFile, execFileSync } from 'node:child_process';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function git(args) {
    return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
}

/**
 * Affiche un toast/ballon Windows (zone de notification) + un bip console.
 * @param {string} title ex. « Déploiement FTP Free.fr » (sans apostrophe)
 * @param {string} message texte du toast (sans apostrophe)
 */
export function toast(title, message) {
    process.stdout.write('\x07');   // bip console
    const ps = [
        'Add-Type -AssemblyName System.Windows.Forms',
        'Add-Type -AssemblyName System.Drawing',
        '$n = New-Object System.Windows.Forms.NotifyIcon',
        '$n.Icon = [System.Drawing.SystemIcons]::Information',
        '$n.Visible = $true',
        `$n.ShowBalloonTip(6000, '${title}', '${message}', 'Info')`,
        'Start-Sleep -Seconds 7',
        '$n.Dispose()',
    ].join('; ');
    execFile('powershell.exe', ['-NoProfile', '-WindowStyle', 'Hidden', '-Command', ps], () => { });
}

// --- Mode watcher (hook pre-push) ---------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('notify-deploy.mjs')) {
    const BRANCH = process.argv[2] || 'Version-2.0';
    const baseSha = git(['rev-parse', 'HEAD']);
    for (let i = 0; i < 36; i++) {          // 36 × 5 s = 3 min max
        await sleep(5000);
        try { git(['fetch', 'origin', BRANCH]); } catch { /* transit réseau */ }
        if (git(['rev-parse', `origin/${BRANCH}`]) !== baseSha) {
            const subject = git(['log', '-1', '--format=%s', `origin/${BRANCH}`]);
            if (subject.startsWith('[deploy]')) {
                toast('Déploiement FTP Free.fr', 'papabear56.free.fr a été mis à jour ✓');
            } else {
                toast('Nouveau commit distant', subject);
            }
            process.exit(0);
        }
    }
    toast('Déploiement FTP Free.fr', 'Toujours pas terminé après 3 min — voir onglet Actions');
    process.exit(0);
}
