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
await new Promise(r => server.listen(8656, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        const raw = u.includes('format=raw');
        req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: raw ? 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' : JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]) });
    } else req.continue();
});
await page.goto('http://127.0.0.1:8656/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 400));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

const noBtn = await page.evaluate(() => !document.querySelector('.free-wp-btn') && !document.getElementById('wp-insert-hint'));
noBtn ? ok('bouton « + Waypoint » et bandeau mode insertion absents') : ko('bouton encore présent');

// Clic droit sur la carte, sur un point SANS terrain proche (océan à l'ouest
// de LFRV) → l'éditeur de nom du repère libre s'ouvre (.fw-name-input).
const mid = await page.evaluate(() => {
    const r = document.getElementById('regional-map').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2 - 250), y: Math.round(r.top + r.height / 2 - 60) };
});
await page.mouse.click(mid.x, mid.y, { button: 'right' });
await new Promise(r => setTimeout(r, 1200));
const editor = await page.evaluate(() => !!document.querySelector('.free-wp-popup, .fw-name-input'));
editor ? ok('clic droit ouvre l\u2019éditeur de repère libre') : ko('clic droit sans effet');

// Les autres boutons de la barre sont intacts.
const barBtns = await page.evaluate(() => [...document.querySelectorAll('#map-layers-bar .precip-toggle')].map(b => b.textContent.trim()).join(' · '));
console.log('Barre :', barBtns);
barBtns.includes('Cadrer plan') && barBtns.includes('Plein cadre') ? ok('boutons récents intacts') : ko('barre incomplète');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
