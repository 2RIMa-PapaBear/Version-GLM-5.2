#!/usr/bin/env node
// ============================================================================
// PURGE-TEST — supprime TOUT le canal test/ sur l'hébergement (fichiers +
// sous-dossiers + le dossier test/ lui-même). La RACINE de production
// n'est JAMAIS touchée.
//
//   node scripts/purge-test.mjs           (purge réelle)
//   node scripts/purge-test.mjs --dry-run (liste sans supprimer)
//
// Usage : après validation du pilote et `npm run pub` (le canal /test/ n'a
// plus de raison d'être jusqu'au prochain chantier).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from 'basic-ftp';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry-run');

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

const client = new Client(30000);
try {
    await client.access(credentials());

    // Le dossier test/ existe-t-il ?
    const listing = await client.list();
    if (!listing.some((f) => f.name === 'test')) {
        console.log('Canal test/ déjà absent — rien à faire.');
        client.close();
        process.exit(0);
    }

    // Suppression récursive : basic-ftp removeDir vide le dossier ET le
    // supprime — plus sûr qu'une marche manuelle (files puis dossiers).
    if (DRY) {
        let n = 0;
        const walk = async (rel) => {
            for (const f of await client.list()) {
                if (f.type === 1) n++;
                else if (f.name !== '.' && f.name !== '..') {
                    await client.cd(f.name);
                    await walk(rel ? `${rel}/${f.name}` : f.name);
                    await client.cd('..');
                }
            }
        };
        await client.cd('test');
        await walk('');
        await client.cd('..');
        console.log(`DRY-RUN : ${n} fichier(s) sous test/ seraient supprimés, puis le dossier test/.`);
    } else {
        await client.removeDir('test');
        console.log('Canal test/ supprimé (fichiers + sous-dossiers + dossier).');
        const after = await client.list();
        console.log(after.some((f) => f.name === 'test') ? 'ATTENTION : test/ still listé.' : 'Vérifié : test/ absent de la racine.');
    }
} catch (e) {
    console.error('Purge impossible : ' + String(e.message || e).slice(0, 160));
    process.exitCode = 1;
} finally {
    client.close();
}
