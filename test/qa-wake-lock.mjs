// WAKE LOCK (retour pilote 25/09 « l'app ne doit pas se mettre en pause
// pendant son utilisation ») : Screen Wake Lock demandé dès le chargement,
// ré-acquis au retour de visibilité et à la moindre activité. Vérifié par
// STUB de navigator.wakeLock posé AVANT les scripts de l'app.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8682, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', body: ' ' });
    } else req.continue();
});
// Stub posé avant tout script : enregistre chaque demande de verrou.
// navigator.wakeLock est un getter non inscriptible → defineProperty.
await page.evaluateOnNewDocument(() => {
    window.__wl = { demandes: 0, sentinel: null };
    try {
        Object.defineProperty(navigator, 'wakeLock', {
            configurable: true,
            value: {
                async request() {
                    window.__wl.demandes++;
                    const s = { released: false, addEventListener() {} };
                    window.__wl.sentinel = s;
                    return s;
                },
            },
        });
    } catch (e) { window.__wl.stubErr = String(e); }
});
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://127.0.0.1:8682/index.html?icao=LFRV&mode=nav&dest=LFRN', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('fp-waypoints') && document.querySelectorAll('.pin-hit').length > 3, { timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

let wl = await page.evaluate(() => window.__wl);
wl.demandes >= 1 ? ok(`wake lock demandé au chargement (${wl.demandes})`) : ko('aucune demande au chargement');

// Retour de visibilité : le navigateur relâche le verrou en caché ( simulé
// par released=true) → ré-acquisition au retour visible.
await page.evaluate(() => {
    if (window.__wl.sentinel) window.__wl.sentinel.released = true;
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
});
await new Promise(r => setTimeout(r, 800));
wl = await page.evaluate(() => window.__wl);
wl.demandes === 2 ? ok('ré-acquisition au retour de visibilité (verrou relâché en caché)') : ko('retour de visibilité : ' + wl.demandes + ' demandes');
// Activité (pointerdown) avec verrou relâché par le système → re-demande.
await page.evaluate(() => {
    if (window.__wl.sentinel) window.__wl.sentinel.released = true;
    window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
});
await new Promise(r => setTimeout(r, 600));
wl = await page.evaluate(() => window.__wl);
wl.demandes === 3 ? ok('ré-acquisition à l\'activité après relâche système') : ko('activité : ' + wl.demandes + ' demandes');

(pageErrors.length === 0 ? ok : ko)(pageErrors.length === 0 ? 'zéro erreur JS' : 'ERREURS JS : ' + pageErrors.join(' ; '));
server.close(); await browser.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
