// Après-fix : le graphe doit se dessiner SANS erreur, et les olives du
// watchdog doivent peindre les favoris (le crash _drawSunLayer cassait
// la chaîne de rendu en aval).
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
await new Promise(r => server.listen(8661, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const errors = [];
page.on('pageerror', e => errors.push(String(e).slice(0, 100)));
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        const raw = u.includes('format=raw');
        // METAR par terrain pour que le watchdog catégorie chacun.
        // ids peut porter PLUSIEURS terrains (watchdog : LFRV,LFRC) → un
        // METAR par id, sinon le dernier reste sans olive.
        const ids = decodeURIComponent(decodeURIComponent(u)).match(/ids=([A-Z0-9,]+)/)?.[1].split(',') || ['LFRV'];   // double-décodage : la virgule reste %2C au 1er
        const mk = (id) => ({ icaoId: id, rawOb: `METAR ${id} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021` });
        const body = raw ? `METAR ${ids[0]} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021`
            : (u.includes('stationinfo') ? JSON.stringify(ids.map(id => ({ icaoId: id, site: id, lat: 47.7, lon: -2.7 })))
              : JSON.stringify(ids.map(mk)));
        req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    } else req.continue();
});
// Favoris + watchdog actifs AVANT le chargement.
await browser.defaultBrowserContext().overridePermissions?.('http://127.0.0.1', []);
await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorites', JSON.stringify(['LFRV', 'LFRC']));
    localStorage.setItem('watchdog-settings', JSON.stringify({ enabled: true, intervalMin: 5, notify: false }));
});
await page.goto('http://127.0.0.1:8661/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#tafCanvas'), { timeout: 30000 });
await new Promise(r => setTimeout(r, 6000));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

// 1. Aucune erreur JS.
errors.length === 0 ? ok('aucune erreur JS (T defined partout)') : ko('erreurs : ' + errors.join(' | '));

// 2. Le graphe est dessiné (fond sombre par défaut + contenu).
const px = await page.evaluate(() => {
    const c = document.getElementById('tafCanvas');
    return c && c.width > 50 ? Array.from(c.getContext('2d').getImageData(c.width / 2, 10, 1, 1).data).slice(0, 3) : null;
});
px && px[0] < 40 ? ok(`graphe dessiné (fond ${px.join(',')})`) : ko(`graphe vide ${JSON.stringify(px)}`);

// 3. Bascule thème : redraw sans erreur + canvas clair.
await page.evaluate(() => document.getElementById('btn-theme').click());
await new Promise(r => setTimeout(r, 800));
const pxL = await page.evaluate(() => {
    const c = document.getElementById('tafCanvas');
    return Array.from(c.getContext('2d').getImageData(c.width / 2, 10, 1, 1).data).slice(0, 3);
});
pxL[0] > 200 ? ok(`graphe clair après bascule (${pxL.join(',')})`) : ko(`canvas pas clair (${pxL})`);
errors.length === 0 ? ok('toujours aucune erreur JS après bascule') : ko('erreurs post-bascule : ' + errors.join(' | '));

// 4. Olives du watchdog peintes dans les favoris.
const olives = await page.evaluate(() => [...document.querySelectorAll('#favorites-list .fav-status-badge')]
    .filter(b => b.style.background).map(b => ({ txt: b.title.slice(0, 20), col: b.style.background.slice(0, 15) })));
olives.length >= 2 ? ok(`olives favoris peintes : ${JSON.stringify(olives)}`) : ko(`olives : ${JSON.stringify(olives)}`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
