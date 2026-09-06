// PASTILLES CARTE (demandes pilote 06/09) : ① bouton « Carte VAC » dans le
// panneau de pastille (ouvert par clic) → visionneuse ; ② CLIC DROIT sur
// une pastille = AJOUT AU PLAN DE VOL, sans créer de repère libre.
// Le clic souris physique sur les pastilles n'est pas déterministe en
// headless (plusieurs couches de cartes en mode nav, elementFromPoint
// instable) : le panneau est ouvert via le vrai API Leaflet du marker et
// le clic droit par un événement DOM contextmenu SYNTHÉTIQUE sur la zone
// .pin-hit — exactement ce que le navigateur livre au handler.
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
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.pdf': 'application/pdf' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8652, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://127.0.0.1:8652/index.html?icao=LFRV&mode=nav&dest=LFRN', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.pin-hit').length > 5, { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));

// ① Ouvre le panneau d'une pastille VOISINE (pas la 1re = terrain courant).
await page.evaluate(() => {
    const hits = [...document.querySelectorAll('.pin-hit')];
    hits[Math.floor(hits.length / 2)].dispatchEvent(new MouseEvent('click', { bubbles: true }));
});
await page.waitForFunction(() => document.querySelector('.leaflet-popup'), { timeout: 8000 });
await new Promise(r => setTimeout(r, 1500));   // hasVac async → bouton révélé
const popup = await page.evaluate(() => {
    const el = document.querySelector('.leaflet-popup');
    return { texte: el?.innerText?.slice(0, 100) || '', vac: !!el?.querySelector('.mp-vac-btn') };
});
console.log('panneau :', JSON.stringify(popup));
(popup.texte ? ok : ko)('clic : panneau METAR ouvert');
(popup.vac ? ok : ko)('bouton « Carte VAC » présent');
if (popup.vac) {
    await page.evaluate(() => document.querySelector('.leaflet-popup .mp-vac-btn')?.click());
    await page.waitForFunction(() => document.querySelector('#vac-overlay canvas'), { timeout: 30000 });
    ok('visionneuse VAC ouverte depuis la pastille');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('#vac-overlay'), { timeout: 5000 });
}
await page.evaluate(() => document.querySelector('.leaflet-popup-close-button')?.click());
await new Promise(r => setTimeout(r, 400));

// ② CLIC DROIT (contextmenu synthétique sur .pin-hit) : ajout au plan.
const wpAvant = await page.evaluate(() => document.getElementById('fp-waypoints')?.value || '');
const res = await page.evaluate(() => {
    const hits = [...document.querySelectorAll('.pin-hit')];
    hits[Math.floor(hits.length / 2)].dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }));
    return new Promise(r => setTimeout(() => r({
        wp: document.getElementById('fp-waypoints')?.value || '',
        editeurLibre: !!document.querySelector('.fw-name-input'),
    }), 1200));
});
console.log('waypoints :', JSON.stringify({ avant: wpAvant, apres: res.wp }));
(res.wp.length > wpAvant.length ? ok : ko)('clic droit : terrain ajouté au plan (waypoints)');
(!res.editeurLibre ? ok : ko)('clic droit : PAS de repère libre parasite');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
