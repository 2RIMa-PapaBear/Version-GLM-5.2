// QA du bouton « Cadrer plan » : avec un plan actif (nav, dest=LFRC), le clic
// doit recadrer/zoomer la carte (zoom tuile 7 → 8, centre déplacé) ; sans
// plan, un bandeau transitoire s'affiche.
// Usage : node test/qa-map-fitplan.mjs
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(d);
    });
});
await new Promise(r => server.listen(8654, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        const raw = u.includes('format=raw');
        req.respond({
            status: 200, contentType: raw ? 'text/plain' : 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: raw ? 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021'
                      : JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]),
        });
    } else req.continue();
});
await page.goto('http://127.0.0.1:8654/index.html?icao=LFRV&mode=nav&dest=LFRC', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 4000));

const zoomOf = () => page.evaluate(() => {
    const t = document.querySelector('#regional-map img.leaflet-tile-loaded, #regional-map img.leaflet-tile');
    const m = t?.src.match(/\/tile\/(\d+)\/(\d+)\/(\d+)/) || t?.src.match(/\/(\d+)\/(\d+)\/(\d+)\./);
    return m ? parseInt(m[1], 10) : null;
});
// Empreinte du cadrage : coords z/x/y des TUILES CHARGÉES (le transform du
// pane ne bouge pas au zoom Leaflet — les tuiles se repositionnent seules).
const tilesOf = () => page.evaluate(() =>
    [...document.querySelectorAll('#regional-map img.leaflet-tile-loaded')]
        .map(t => (t.src.match(/\/tile\/(\d+\/\d+\/\d+)/) || t.src.match(/\/(\d+\/\d+\/\d+)\./) || [])[1])
        .filter(Boolean).sort().join('|'));
const center = () => page.evaluate(() => document.querySelector('#regional-map .leaflet-map-pane').style.transform || '');

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

// 1) Avec plan actif : on DÉPLACE la carte (drag), puis « Cadrer plan »
//    doit restaurer le cadrage initial du plan (la route est déjà cadrée
//    au chargement — le bouton sert à y REVENIR après navigation).
const z0 = await zoomOf(), c0 = await tilesOf();
// La carte peut être loin sous le pli (mode nav : page longue) — on la fait
// glisser dans la fenêtre AVANT toute interaction souris.
await page.evaluate(() => document.getElementById('regional-map')
    .scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 400));
const mid = await page.evaluate(() => {
    const r = document.getElementById('regional-map').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2), top: Math.round(r.top) };
});
if (mid.top < 0 || mid.top > 800) { console.log('KO  carte toujours hors fenêtre (top=' + mid.top + ')'); process.exit(1); }
// Zoome OUT à la molette, ANCRÉ HORS CENTRE (le zoom Leaflet garde le
// point sous le curseur : la vue se décale en plus de dézoomer).
await page.mouse.move(mid.x + 160, mid.y + 110);
await page.mouse.wheel({ deltaX: 0, deltaY: 480 });
await new Promise(r => setTimeout(r, 900));
const zDrag = await zoomOf(), cDrag = await tilesOf();
(zDrag !== z0 || cDrag !== c0) ? ok(`carte dézoomée/décalée (${z0} → ${zDrag})`) : ko('la molette n\u2019a rien changé');

await page.evaluate(() => document.querySelector('.map-fitplan-btn')?.click());
await new Promise(r => setTimeout(r, 2500));
const z1 = await zoomOf(), c1 = await tilesOf();
(z1 === z0) ? ok(`« Cadrer plan » restaure le zoom (${zDrag} → ${z1})`) : ko(`zoom non restauré (${zDrag} → ${z1})`);
// Restauration = les tuiles revenues font partie de la fenêtre initiale
// (les dernières rangées peuvent être encore en chargement à la mesure).
const subset = c1.split('|').filter(Boolean).length > 0
    && c1.split('|').every(t => c0.includes(t));
(subset && cDrag !== c0) ? ok('cadrage du plan restauré (tuiles de la fenêtre initiale)') : ko(`cadrage non restauré (${JSON.stringify(c0)} vs ${JSON.stringify(c1)})`);

// 2) Sans plan (destination vidée) : bandeau transitoire.
await page.evaluate(() => {
    const i = document.getElementById('route-to-input');
    i.value = '';
    i.dispatchEvent(new Event('input'));
});
await new Promise(r => setTimeout(r, 500));
await page.evaluate(() => document.querySelector('.map-fitplan-btn')?.click());
await new Promise(r => setTimeout(r, 300));
const hint = await page.evaluate(() => {
    const h = document.getElementById('fitplan-hint');
    return h && !h.hidden ? h.textContent : null;
});
hint ? ok(`bandeau sans plan : « ${hint.slice(0, 40)}… »`) : ko('pas de bandeau sans plan actif');

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
