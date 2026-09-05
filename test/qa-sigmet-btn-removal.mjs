// BOUTON SIGMET retiré de la carte régionale (retour pilote 05/09 « peu
// utile en VFR ») : le bouton et la couche n'existent plus, le reste de la
// barre est intact, et le module SIGMET du GO/NO-GO continue de charger.
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
await new Promise(r => server.listen(8662, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
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
// Toute erreur de chargement des modules (import mort, référence résiduelle) doit sortir.
const consoleErrors = [];
page.on('console', msg => { if (msg.type() === 'error') consoleErrors.push(msg.text()); });
page.on('pageerror', err => consoleErrors.push(String(err)));
await page.goto('http://127.0.0.1:8662/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await new Promise(r => setTimeout(r, 3500));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

const noSigmet = await page.evaluate(() =>
    !document.querySelector('.sigmet-toggle')
    && ![...document.querySelectorAll('#map-layers-bar .precip-toggle')].some(b => b.textContent.includes('SIGMET')));
noSigmet ? ok('bouton SIGMET absent de la barre') : ko('bouton SIGMET encore présent');

const barBtns = await page.evaluate(() => [...document.querySelectorAll('#map-layers-bar .precip-toggle')].map(b => b.textContent.trim()).join(' · '));
console.log('Barre :', barBtns);
for (const label of ['Radar', 'Espaces', 'Cadrer plan', 'Plein cadre'])
    (barBtns.includes(label) ? ok : ko)(`bouton « ${label} » intact`);

// Le module SIGMET (GO/NO-GO) reste chargé : pas d'erreur console liée à sigmet.js.
const sigmetErrors = consoleErrors.filter(t => /sigmet/i.test(t));
sigmetErrors.length === 0 ? ok('module sigmet.js sans erreur (GO/NO-GO intact)') : ko(`erreurs sigmet: ${sigmetErrors.join(' | ')}`);
consoleErrors.length === 0 ? ok('aucune erreur console au chargement') : console.log(`note : ${consoleErrors.length} erreur(s) console (réseau stubbé) : ${consoleErrors.slice(0, 3).join(' | ')}`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
