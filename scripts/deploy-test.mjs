#!/usr/bin/env node
// ============================================================================
// DEPLOY-TEST — Canal TEST publié À CÔTÉ de la production (dossier /test/).
//
//   npm run deploy:test                  → sync réel (delta seulement)
//   npm run deploy:test -- --dry-run     → montre le delta sans rien envoyer
//   npm run deploy:test -- --mirror      → supprime aussi les fichiers
//                                           distants disparus localement
//
// RÔLE : publier l'ÉTAT LOCAL DE TRAVAIL — y compris les modifications NON
// commitées — sur https://papabear56.pages-perso.free.fr/test/ (et
// http://papabear56.free.fr/test/) pour validation du pilote AVANT toute
// diffusion. La production (racine) n'est JAMAIS touchée ici : elle ne
// bouge que par le pipeline GitHub (push → deploy-ftp.mjs, basé sur le
// dépôt git commité — jamais le working dir — après `npm run pub` et feu
// vert). Workflow convenu 13/09/2026 : modif → deploy:test → approbation
// sur /test/ → npm run pub.
//
// SPÉCIFICITÉS du canal test (patchées EN MÉMOIRE, fichiers locaux intacts) :
//   - index.html : ?v=test.<horodatage> (identifiant visible au footer) ;
//   - sw.js : CACHE 'mt-shell-vtest-<horodatage>' (shell test indépendant,
//     mise à jour immédiate des PWA de test installées) ;
//   - manifest.webmanifest : nom suffixé « — TEST » (icône distincte) ;
//   - js/config.local.js EXCLU (clés privées : le canal test utilise les
//     défauts publics de config.js — relais Cloudflare — comme un vrai
//     utilisateur) ;
//   - data/airspaces/cells/ (~257 Mo) et data/vac-sia/ (~123 Mo) NON
//     uploadés : lus depuis la RACINE via js/data-base.js (bigDataUrl),
//     déjà en ligne et tenus à jour par les déploiements normaux.
// ============================================================================
import { Client } from 'basic-ftp';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REMOTE_TEST_DIR = 'test';

const DRY = process.argv.includes('--dry-run');
const MIRROR = process.argv.includes('--mirror');

const log = (m) => console.log(m);
const warn = (m) => console.log('  ⚠ ' + m);

// ---- Périmètre : mêmes chemins « app » que la prod, moins les exclusions ----
const ALLOWED = [
    'index.html', 'accueil.html', 'sw.js', 'manifest.webmanifest', 'favicon.ico', 'icon.svg',
    'notice-fr.html', 'notice-en.html',
    'js/', 'css/', 'vendor/', 'data/', 'assets/accueil/',
];
const DENIED = [
    /^data\/airspaces\/cells\//,   // 257 Mo — lus depuis la racine (data-base.js)
    /^data\/vac-sia\//,            // 123 Mo — idem
    /^js\/config\.local\.js$/,     // clés privées — jamais diffusées
];

function isAllowed(rel) {
    if (!ALLOWED.some(a => rel.startsWith(a))) return false;
    return !DENIED.some(re => re.test(rel));
}

// ---- Inventaire local récursif (working dir, PAS git) -----------------------
function walkLocal(dir, base, out) {
    for (const f of fs.readdirSync(dir)) {
        if (f.startsWith('.')) continue;
        const full = path.join(dir, f);
        const rel = base ? `${base}/${f}` : f;
        if (fs.statSync(full).isDirectory()) walkLocal(full, rel, out);
        else if (isAllowed(rel)) out.push(rel);
    }
}
const localFiles = [];
walkLocal(ROOT, '', localFiles);
localFiles.sort();
log(`Fichiers locaux (canal test) : ${localFiles.length}`);

// ---- Contenus patchés en mémoire ---------------------------------------------
const TS = Date.now();
const patched = new Map();   // rel → Buffer
{
    const idx = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    patched.set('index.html',
        Buffer.from(idx.replace(/\?v=(\d+)\.(\d+)/g, `?v=test.${TS}`), 'utf8'));

    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const swPatched = sw.replace(/CACHE = '(mt-shell-v)(\d+)'/, `CACHE = 'mt-shell-vtest-${TS}'`);
    if (swPatched === sw) warn("constante CACHE 'mt-shell-vN' introuvable dans sw.js — shell test non versionné");
    patched.set('sw.js', Buffer.from(swPatched, 'utf8'));

    const man = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.webmanifest'), 'utf8'));
    man.name = `${man.name} — TEST`;
    man.short_name = `${man.short_name} T`;
    patched.set('manifest.webmanifest', Buffer.from(JSON.stringify(man, null, 2), 'utf8'));
}

function sizeOf(rel) {
    return patched.has(rel) ? patched.get(rel).length : fs.statSync(path.join(ROOT, rel)).size;
}
function sourceOf(rel) {
    return patched.has(rel)
        ? Readable.from(patched.get(rel))
        : path.join(ROOT, rel);
}

// ---- Identifiants (identiques à deploy-ftp.mjs / upload-cells.mjs) ----------
function credentials() {
    const cfgPath = path.join(ROOT, 'deploy.config.json');
    if (fs.existsSync(cfgPath)) {
        const c = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        if (c.host && c.user && c.password) return { host: c.host, user: c.user, password: c.password, port: c.port || 21, secure: !!c.secure };
    }
    if (process.env.FTP_HOST && process.env.FTP_USER && process.env.FTP_PASSWORD) {
        return { host: process.env.FTP_HOST, user: process.env.FTP_USER, password: process.env.FTP_PASSWORD, port: 21, secure: false };
    }
    console.error('Identifiants FTP introuvables : posez deploy.config.json à la racine');
    process.exit(2);
}

// ---- Inventaire distant récursif sous test/ ----------------------------------
// Le walk maintient lui-même la position (cd dans les dossiers, retour).
async function walkRemote(client) {
    const files = new Map();   // rel (depuis test/) → taille
    async function walk(rel) {
        for (const f of await client.list()) {
            if (f.type === 1) files.set(rel ? `${rel}/${f.name}` : f.name, f.size);
            else if (f.type === 2 && f.name !== '.' && f.name !== '..') {
                await client.cd(f.name);
                await walk(rel ? `${rel}/${f.name}` : f.name);
                await client.cd('..');
            }
        }
    }
    try {
        await client.cd(REMOTE_TEST_DIR);
        await walk('');
        await client.cd('..');
    } catch {   // /test/ inexistant : rien à distance
    }
    return files;
}

// ---- Connexion ----------------------------------------------------------------
const client = new Client(30000);
let remoteFiles;
try {
    await client.access(credentials());
    remoteFiles = await walkRemote(client);
    log(`Fichiers distants (test/) : ${remoteFiles.size}`);
} catch (e) {
    console.error('Connexion FTP impossible : ' + String(e.message).slice(0, 120));
    client.close();
    process.exit(1);
}

// ---- Delta (taille par fichier — les patchs mémoire changent la taille) ------
// index.html et sw.js sont TOUJOURS renvoyés : leur patch de version
// (?v=test.<ts> / CACHE mt-shell-vtest-<ts>) garde une taille quasi constante
// — un delta par tailles ne les verrait jamais changer, et les navigateurs
// continueraient de servir les ANCIENS modules depuis leur cache.
const ALWAYS = new Set(['index.html', 'sw.js']);
const toUpload = localFiles.filter(rel => ALWAYS.has(rel) || remoteFiles.get(rel) !== sizeOf(rel));
const remoteOnly = [...remoteFiles.keys()].filter(r => !localFiles.includes(r));
log(`À envoyer : ${toUpload.length} · À jour : ${localFiles.length - toUpload.length}` +
    (remoteOnly.length ? ` · Distants orphelins : ${remoteOnly.length}${MIRROR ? ' (suppression)' : ' (rapport seul — --mirror pour supprimer)'}` : ''));
toUpload.slice(0, 10).forEach(f => log('  ↑ ' + f));
if (toUpload.length > 10) log(`  … +${toUpload.length - 10} autres`);
remoteOnly.slice(0, 5).forEach(f => warn('orphelin : ' + f));

if (DRY) { log('\nDRY-RUN : rien n\'a été envoyé. (La racine de production n\'est jamais touchée par ce script.)'); client.close(); process.exit(0); }
if (!toUpload.length && !(MIRROR && remoteOnly.length)) {
    log('Rien à faire — canal test déjà synchronisé. (Racine de production non touchée.)');
    client.close();
    process.exit(0);
}

// ---- Envoi, groupé par dossier (cd minimal), retry par fichier ---------------
await client.ensureDir(REMOTE_TEST_DIR);   // crée /test/ à la première fois
let cwd = '';   // chemin relatif courant DANS test/
async function cdTo(dir) {
    if (dir === cwd) return;
    for (let i = 0; i < cwd.split('/').filter(Boolean).length; i++) await client.cd('..');
    if (dir) await client.ensureDir(dir);
    cwd = dir;
}

let sent = 0, errors = 0;
for (const rel of toUpload) {
    const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
    await cdTo(dir);
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try {
            await client.uploadFrom(sourceOf(rel), path.posix.basename(rel));
            done = true;
        } catch (e) {
            if (attempt === 3) { errors++; console.error(`  ✗ ${rel} : ${String(e.message).slice(0, 80)}`); }
            else await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    if (done && ++sent % 10 === 0) log(`  … ${sent}/${toUpload.length} envoyés`);
}

if (MIRROR && remoteOnly.length) {
    let del = 0;
    for (const rel of remoteOnly) {
        const dir = path.posix.dirname(rel) === '.' ? '' : path.posix.dirname(rel);
        try {
            await cdTo(dir);
            await client.remove(path.posix.basename(rel));
            del++;
        } catch { /* déjà parti */ }
    }
    log(`Orphelins distants supprimés : ${del}/${remoteOnly.length}`);
}
client.close();

log(`\nCANAL TEST : ${sent} envoyé(s), ${errors} en erreur` +
    (errors ? ' — RELANCER la commande : elle reprend là où elle s\'est arrêtée.' : ' — terminé.'));
log('URL : https://papabear56.pages-perso.free.fr/test/  (HTTP : http://papabear56.free.fr/test/)');
log('Version affichée au footer : vtest.' + TS);
log('La RACINE de production n\'a pas été modifiée.');
process.exit(errors ? 1 : 0);
