// Pastilles voisines : TOUTE la carte visible doit être peuplée (bounds
// réels, retour pilote 04/09) — on dézoome au niveau France et on vérifie
// la présence de marqueurs dans les 4 quadrants de la vue.
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
await new Promise(r => server.listen(8657, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        // Relais : selon l'URL cible embarquée → stations ou METARs France.
        if (u.includes('stationinfo')) {
            const bb = decodeURIComponent(u).match(/bbox=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/) || [];
            const [s, w, n, e] = bb.slice(1).map(Number);
            const stations = [];
            for (let lat = Math.ceil(s); lat <= Math.floor(n); lat += 1) {
                for (let lon = Math.ceil(w); lon <= Math.floor(e); lon += 1) {
                    stations.push(
                        { icaoId: `LF${String(lat).padStart(2, '0')}${String(((lon % 10) + 10) % 10).padStart(2, '0')}A`, site: 'X', lat: lat + 0.1, lon: lon + 0.1 },
                        { icaoId: `LF${String(lat).padStart(2, '0')}${String(((lon % 10) + 10) % 10).padStart(2, '0')}B`, site: 'Y', lat: lat + 0.6, lon: lon + 0.6 });
                }
            }
            req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(stations.slice(0, 400)) });
        } else {
            const ids = decodeURIComponent(u).match(/ids=([A-Z0-9,]+)/)?.[1]?.split(',') || [];
            req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: `METAR ${c} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021` }))) });
        }
    } else if (u.includes('aviationweather.gov')) {
        const raw = u.includes('format=raw');
        req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: raw ? 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' : JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]) });
    } else req.continue();
});
await page.goto('http://127.0.0.1:8657/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 4000));

// Pastilles présentes à z7 (vue initiale ±bounds) ?
const count0 = await page.evaluate(() => document.querySelectorAll('#regional-map .leaflet-marker-icon').length
    + document.querySelectorAll('#regional-map path.leaflet-interactive').length);
console.log(`Marqueurs (vue initiale z7) : ${count0}`);

// DÉZOOM France (z5) puis attente du re-peuplement (debounce 600 ms + fetch).
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
const mid = await page.evaluate(() => { const r = document.getElementById('regional-map').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
await page.mouse.move(mid.x, mid.y);
await page.mouse.wheel({ deltaX: 0, deltaY: 900 }); await page.mouse.wheel({ deltaX: 0, deltaY: 900 });
await new Promise(r => setTimeout(r, 5000));

// Répartition dans les 4 quadrants de la vue carte.
const quad = await page.evaluate(() => {
    const el = document.getElementById('regional-map');
    const r = el.getBoundingClientRect();
    const marks = [...el.querySelectorAll('.leaflet-marker-icon'), ...el.querySelectorAll('path.leaflet-interactive')];
    const q = { TL: 0, TR: 0, BL: 0, BR: 0 };
    for (const m of marks) {
        const b = m.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) continue;
        const x = b.left + b.width / 2 - r.left, y = b.top + b.height / 2 - r.top;
        if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
        q[(y < r.height / 2 ? 'T' : 'B') + (x < r.width / 2 ? 'L' : 'R')]++;
    }
    return { q, total: marks.length };
});
console.log(JSON.stringify(quad));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
quad.q.TL > 0 ? ok('quadrant haut-gauche peuplé') : ko('haut-gauche vide');
quad.q.TR > 0 ? ok('quadrant haut-droit peuplé') : ko('haut-droit vide');
quad.q.BL > 0 ? ok('quadrant bas-gauche peuplé') : ko('bas-gauche vide');
quad.q.BR > 0 ? ok('quadrant bas-droit peuplé') : ko('bas-droit vide');
quad.total > quad.q.TL + quad.q.TR + quad.q.BL + quad.q.BR ? ok('marqueurs hors vue accumulés (normal)') : ok('tous dans la vue');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
