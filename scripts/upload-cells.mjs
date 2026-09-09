#!/usr/bin/env node
// ============================================================================
// UPLOAD-CELLS — Sync INCRÉMENTAL des cellules openAIP vers Free.fr
// (item ③ du plan d'améliorations 09/09 : « fin du FileZilla »).
//
//   npm run cells                 → sync réel (n'envoie que le delta)
//   npm run cells -- --dry-run    → montre le delta sans rien envoyer
//   npm run cells -- --mirror     → supprime aussi les fichiers distants
//                                   disparus localement (défaut : rapport seul)
//
// PRINCIPE : le déploiement normal EXCLUT data/airspaces/cells/ (~27 000
// fichiers, débit Free.fr insuffisant dans un run Actions) — d'où le dépôt
// FileZilla manuel. Ce script remplace ce geste : il LISTE le dossier
// distant (plat), compare TAILLE par fichier et n'envoie que les manquants
// ou modifiés. Relançable : ce qui est déjà parti ne repart pas.
//
// Identifiants (les mêmes que deploy-ftp.mjs) : deploy.config.json à la
// racine (gitignoré — voir deploy.config.example.json) ou variables
// FTP_HOST / FTP_USER / FTP_PASSWORD.
//
// RYTHME : débit Free.fr ≈ 10 fichiers/min → prévoir le delta hebdo du
// crawl (~1 h la 1ʳᵉ fois si tout manque, quelques dizaines de minutes en
// routine). À lancer après le cron du lundi ou à la demande.
// ============================================================================
import { Client } from 'basic-ftp';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL_DIR = path.join(ROOT, 'data', 'airspaces', 'cells');
const REMOTE_DIR = 'data/airspaces/cells';

const DRY = process.argv.includes('--dry-run');
const MIRROR = process.argv.includes('--mirror');

const log = (m) => console.log(m);

// ---- Identifiants -----------------------------------------------------------
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
    console.error('(copie de deploy.config.example.json avec votre mot de passe Free.fr — fichier');
    console.error('gitignoré) ou exportez FTP_HOST / FTP_USER / FTP_PASSWORD.');
    process.exit(2);
}

if (!fs.existsSync(LOCAL_DIR)) { console.error('Dossier local introuvable : ' + LOCAL_DIR); process.exit(2); }

// ---- Inventaire local (dossier PLAT : cellules 1° + .crawl.json exclus) ------
const local = new Map();   // nom → taille (octets)
for (const f of fs.readdirSync(LOCAL_DIR)) {
    if (f.startsWith('.')) continue;
    const st = fs.statSync(path.join(LOCAL_DIR, f));
    if (st.isFile()) local.set(f, st.size);
}
log(`Cellules locales : ${local.size} fichiers`);

// ---- Connexion + inventaire distant ------------------------------------------
const creds = credentials();
const client = new Client(30000);
let remote = new Map();
try {
    await client.access(creds);
    await client.ensureDir(REMOTE_DIR);
    const list = await client.list();
    for (const f of list) {
        if (f.type !== 1) continue;   // 1 = fichier (basic-ftp FileType.File)
        remote.set(f.name, f.size);
    }
    log(`Cellules distantes : ${remote.size} fichiers`);
} catch (e) {
    console.error('Connexion/listing FTP impossible : ' + String(e.message).slice(0, 120));
    client.close();
    process.exit(1);
}

// ---- Delta -------------------------------------------------------------------
const toUpload = [...local.entries()]
    .filter(([name, size]) => remote.get(name) !== size)   // absent ou taille ≠
    .map(([name]) => name);
const remoteOnly = [...remote.keys()].filter(n => !local.has(n));
log(`À envoyer : ${toUpload.length} · À jour : ${local.size - toUpload.length}` +
    (remoteOnly.length ? ` · Distants orphelins : ${remoteOnly.length}${MIRROR ? ' (suppression)' : ' (rapport seul — --mirror pour supprimer)'}` : ''));
if (toUpload.length <= 10) toUpload.forEach(f => log('  ↑ ' + f));
else { toUpload.slice(0, 10).forEach(f => log('  ↑ ' + f)); log(`  … +${toUpload.length - 10} autres`); }
if (remoteOnly.length && remoteOnly.length <= 5) remoteOnly.forEach(f => log('  ✂ orphelin : ' + f));

if (DRY) { log('\nDRY-RUN : rien n\'a été envoyé.'); client.close(); process.exit(0); }
if (!toUpload.length && !(MIRROR && remoteOnly.length)) { log('Rien à faire — cellules déjà synchronisées.'); client.close(); process.exit(0); }

// ---- Envoi séquentiel (retry par fichier, reprise possible en relançant) -----
let sent = 0, errors = 0;
for (const name of toUpload) {
    let done = false;
    for (let attempt = 1; attempt <= 3 && !done; attempt++) {
        try {
            await client.uploadFrom(path.join(LOCAL_DIR, name), name);
            done = true;
        } catch (e) {
            if (attempt === 3) { errors++; console.error(`  ✗ ${name} : ${String(e.message).slice(0, 80)}`); }
            else await new Promise(r => setTimeout(r, 3000 * attempt));
        }
    }
    if (done && ++sent % 100 === 0) log(`  … ${sent}/${toUpload.length} envoyés`);
}
if (MIRROR && remoteOnly.length) {
    let del = 0;
    for (const name of remoteOnly) {
        try { await client.remove(name); del++; } catch { /* déjà parti */ }
    }
    log(`Orphelins distants supprimés : ${del}/${remoteOnly.length}`);
}
client.close();
log(`\nSYNC CELLULES : ${sent} envoyé(s), ${errors} en erreur` +
    (errors ? ' — RELANCER la commande : elle reprend là où elle s\'est arrêtée.' : ' — terminé.'));
process.exit(errors ? 1 : 0);
