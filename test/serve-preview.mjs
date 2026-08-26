// Serveur statique jetable pour les harnais de préversion (test/preview-*.html) :
// Cache-Control no-store (pas de service worker qui servirait une vielle coquille)
// + capture POST /qa-report → affiche le résultat et termine le process.
// Usage : node test/serve-preview.mjs <chemin-relatif> [largeur] [hauteur]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const page = process.argv[2] || '/test/preview-elevation-zones.html';
const PORT = 8644;

const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
};

const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/qa-report') {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => {
            console.log('\n===== QA REÇU =====\n' + body);
            res.writeHead(204, { 'Access-Control-Allow-Origin': '*' });
            res.end();
            setTimeout(() => { server.close(); process.exit(body.includes('QA: OK') ? 0 : 1); }, 400);
        });
        return;
    }
    const url = new URL(req.url, 'http://x');
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, {
        'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
        'Cache-Control': 'no-store',
    });
    fs.createReadStream(file).pipe(res);
});

server.listen(PORT, () => console.log(`http://localhost:${PORT}${page}`));
setTimeout(() => { console.log('TIMEOUT : pas de /qa-report reçu'); process.exit(2); }, 60000);
