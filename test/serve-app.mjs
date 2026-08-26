// Serveur statique de l'app pour les tests navigateur (pas de timeout).
// Usage : node test/serve-app.mjs [port]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2] || 8644);
const MIME = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
    '.webmanifest': 'application/manifest+json',
};
http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/qa-report') {
        let b = ''; req.on('data', c => b += c);
        req.on('end', () => { console.log('\n===== QA REÇU =====\n' + b); res.writeHead(204); res.end(); });
        return;
    }
    let file = path.join(root, decodeURIComponent(url.pathname));
    if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
    if (url.pathname === '/' || url.pathname.endsWith('/')) file = path.join(file, 'index.html');
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`app: http://localhost:${PORT}/`));
