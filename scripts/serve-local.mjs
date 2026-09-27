#!/usr/bin/env node
// ============================================================================
// SERVE-LOCAL — serveur statique de recette sur http://localhost:<port>
//
//   node scripts/serve-local.mjs [port]        (défaut 8690)
//   npm run serve
//
// RÔLE : servir l'état LOCAL du répertoire de travail (modifications non
// commitées comprises) pour la QA navigateur, SANS aucun impact sur la
// production (qui ne bouge que par push → deploy-ftp) ni sur le canal
// /test/ (npm run deploy:test).
//
// Choix techniques (reçus des recettes précédentes) :
//   - .js en « text/javascript » OBLIGATOIRE : les modules ES sont refusés
//     par le navigateur en text/plain ;
//   - Cache-Control: no-store : la recette doit toujours voir l'état du
//     disque, même après édition (pas de SW périmé possible) ;
//   - Port par défaut 8690 : origine NEUVE à chaque session de recette —
//     les origins recyclées traînent leurs service workers/caches HTTP.
// ============================================================================
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8690;

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
    '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
    '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.woff': 'font/woff',
    '.ttf': 'font/ttf', '.otf': 'font/otf', '.kmz': 'application/vnd.google-earth.kmz',
    '.gpx': 'application/gpx+xml', '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
    try {
        let p = decodeURIComponent(new URL(req.url, `http://localhost:${PORT}`).pathname);
        if (p.endsWith('/')) p += 'index.html';
        const file = path.normalize(path.join(ROOT, p));
        if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
        const data = await readFile(file);
        res.writeHead(200, {
            'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
            'Cache-Control': 'no-store',
        });
        res.end(data);
    } catch {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('404 — introuvable (serveur de recette local)');
    }
});

server.listen(PORT, () => {
    console.log(`Serveur TEST local : http://localhost:${PORT}/  (racine : ${ROOT})`);
});
