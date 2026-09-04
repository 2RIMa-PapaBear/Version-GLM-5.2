// QA thème clair/sombre + ordre des boutons d'en-tête + spinner de
// chargement des pastilles voisines.
// Usage : node test/qa-theme.mjs
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
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8659, r));

// Binaire Edge par numéro de version (le msedge.exe racine peut être en
// cours de permutation lors des auto-updates).
const edgeDir = 'C:/Program Files/BraveSoftware/Brave-Browser/Application';
const ver = fs.readdirSync(edgeDir).filter(d => /^\d+\./.test(d)).sort().pop();
const browser = await puppeteer.launch({
    executablePath: `${edgeDir}/brave.exe`,
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
let slowRelay = false;   // ralentit les stubs pour observer le spinner
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        const raw = u.includes('format=raw');
        const body = raw ? 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' : JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]);
        if (slowRelay) setTimeout(() => req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body }), 1500);
        else req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body });
    } else req.continue();
});

await page.goto('http://127.0.0.1:8659/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#tafCanvas'), { timeout: 30000 });
await new Promise(r => setTimeout(r, 3500));

// ---- 1. Ordre des boutons d'en-tête ----
const order = await page.evaluate(() =>
    [...document.querySelectorAll('.header-controls > *')]
        .map(el => el.id || el.querySelector('button')?.id || el.className.split(' ')[0]));
const want = ['btn-lang-toggle', 'flight-mode-toggle', 'btn-cockpit-mode', 'btn-share', 'btn-watchdog', 'btn-theme', 'btn-notice'];
JSON.stringify(order) === JSON.stringify(want)
    ? ok('ordre des boutons : ' + order.join(' · '))
    : ko(`ordre obtenu : ${JSON.stringify(order)}`);

// ---- 2. Bascule thème ----
const t0 = await page.evaluate(() => ({
    light: document.documentElement.classList.contains('theme-light'),
    lbl: document.querySelector('#btn-theme .theme-lbl')?.textContent,
    bgVar: getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim(),
}));
!t0.light && t0.lbl === 'Clair' ? ok(`départ sombre, bouton « ${t0.lbl} »`) : ko(`départ inattendu : ${JSON.stringify(t0)}`);

await page.evaluate(() => document.getElementById('btn-theme').click());
await new Promise(r => setTimeout(r, 600));
const t1 = await page.evaluate(() => ({
    light: document.documentElement.classList.contains('theme-light'),
    lbl: document.querySelector('#btn-theme .theme-lbl')?.textContent,
    bgVar: getComputedStyle(document.documentElement).getPropertyValue('--bg-color').trim(),
    bodyBg: getComputedStyle(document.body).backgroundColor,
    stored: localStorage.getItem('theme-mode'),
}));
t1.light && t1.lbl === 'Sombre' && t1.bgVar === '#E2E8F0' && t1.stored === 'light'
    ? ok(`thème clair actif (bg ${t1.bgVar}), bouton « ${t1.lbl} », persisté`)
    : ko(`bascule : ${JSON.stringify(t1)}`);

// Canvas principal : le pixel (5,5) doit être clair (fond blanc).
const px = await page.evaluate(() => {
    const c = document.getElementById('tafCanvas');
    const ctx = c.getContext('2d');
    const d = ctx.getImageData(5, 5, 1, 1).data;
    return [d[0], d[1], d[2]];
});
(px[0] > 200 && px[1] > 200 && px[2] > 200) ? ok(`canvas METAR/TAF fond clair rgb(${px.join(',')})`) : ko(`canvas sombre rgb(${px.join(',')})`);

// ---- 3. Persistance après rechargement ----
await page.reload({ waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 2500));
const t2 = await page.evaluate(() => ({
    light: document.documentElement.classList.contains('theme-light'),
    lbl: document.querySelector('#btn-theme .theme-lbl')?.textContent,
}));
t2.light ? ok('thème clair restauré après rechargement') : ko('thème non restauré');

// Retour au sombre (état neutre pour la suite).
await page.evaluate(() => document.getElementById('btn-theme').click());
await new Promise(r => setTimeout(r, 400));

// ---- 4. Spinner de chargement des pastilles ----
await page.evaluate(() => document.getElementById('regional-map-panel')?.classList.add('open'));
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
slowRelay = true;
await page.evaluate(() => { window.__probe = null; location.hash = ''; });
// Re-déclenche un chargement de voisins : changement de vue (dézoom léger).
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
const mid = await page.evaluate(() => { const r = document.getElementById('regional-map').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
await page.mouse.move(mid.x, mid.y);
await page.mouse.wheel({ deltaX: 0, deltaY: 400 });
await new Promise(r => setTimeout(r, 900));   // debounce 600 ms + fetch lent
const spinner = await page.evaluate(() => {
    const el = document.getElementById('neighbors-loading');
    return el && el.style.display !== 'none';
});
spinner ? ok('icône animée visible pendant le chargement') : ko('spinner absent pendant le chargement');
await new Promise(r => setTimeout(r, 4000));
const gone = await page.evaluate(() => {
    const el = document.getElementById('neighbors-loading');
    return !el || el.style.display === 'none';
});
gone ? ok('icône disparue après le chargement') : ko('spinner encore visible');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
