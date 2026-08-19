// ============================================================================
// BUMP-VERSION — Incrémente les versions de rafraîchissement PWA.
//
// Convention du projet : chaque livraison bump les DEUX à l'identique —
//   - tous les `?v=N.mm` d'index.html (assets) : 1.79 → 1.80
//   - `CACHE = 'mt-shell-vN'` de sw.js (shell) : mt-shell-v61 → v62
// C'est ce double bump qui déclenche la mise à jour chez les utilisateurs PWA.
//
// Utilisé par scripts/deploy-ftp.mjs (--bump, appelé par GitHub Actions) ;
// utilisable seul : node scripts/bump-version.mjs
// ============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Calcule (et retourne un write() pour appliquer) le prochain bump.
 * Ne touche pas aux fichiers tant que write() n'est pas appelé.
 * @param {string} root racine du projet (index.html + sw.js).
 * @returns {{vHtml: string, vShell: string, write: Function}}
 */
export function bumpVersions(root) {
    const idxPath = path.join(root, 'index.html');
    const swPath = path.join(root, 'sw.js');
    const idx = fs.readFileSync(idxPath, 'utf8');
    const sw = fs.readFileSync(swPath, 'utf8');

    const mHtml = idx.match(/\?v=(\d+)\.(\d+)/);
    if (!mHtml) throw new Error('aucune version ?v= trouvée dans index.html');
    const vHtml = `${mHtml[1]}.${Number(mHtml[2]) + 1}`;

    const mSw = sw.match(/CACHE = '(mt-shell-v)(\d+)'/);
    if (!mSw) throw new Error("constante CACHE 'mt-shell-vN' introuvable dans sw.js");
    const vShell = `${mSw[1]}${Number(mSw[2]) + 1}`;

    const newIdx = idx.replace(/\?v=(\d+)\.(\d+)/g, `?v=${vHtml}`);
    const newSw = sw.replace(/CACHE = '(mt-shell-v)(\d+)'/, `CACHE = '${vShell}'`);

    return {
        vHtml, vShell,
        write: () => {
            fs.writeFileSync(idxPath, newIdx);
            fs.writeFileSync(swPath, newSw);
        },
    };
}

// --- CLI ---------------------------------------------------------------------
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    const r = bumpVersions(ROOT);
    r.write();
    console.log(`Bump appliqué : index.html ?v=${r.vHtml} · sw.js CACHE='${r.vShell}'`);
}
