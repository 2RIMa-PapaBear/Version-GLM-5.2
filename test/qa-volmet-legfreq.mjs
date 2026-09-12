// QA « 123.500 VOLMET » (retour pilote 12/09) : le tronçon LFOO → LFTA doit
// afficher la fréquence du terrain d'arrivée REQUALIFIÉE « A/A » — openAIP
// publie La Tranche-sur-Mer 123.500 codée type 12 (VOLMET) mais NOMMÉE « A/A ».
// Usage : node test/qa-volmet-legfreq.mjs
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
await new Promise(r => server.listen(8664, r));

const target = (u) => {
    try {
        const dec = decodeURIComponent(u);
        const m = dec.match(/url=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : dec;
    } catch { return u; }
};
// Valeurs RÉELLES d'openAIP (capturées le 12/09) : LFOO = 123.355 type 16
// « LES SABLES D OLONNE » ; LFTA = 123.500 type 12 (VOLMET) nommée « A/A ».
const openaipItem = (icao, name, lat, lon, freqs) => ({
    icaoCode: icao, name, country: 'FR',
    elevation: { value: 20 }, geometry: { coordinates: [lon, lat] },
    frequencies: freqs, runways: [],
});
const openaipDb = {
    LFOO: openaipItem('LFOO', 'LES SABLES D OLONNE TALMONT', 46.4756, -1.725,
        [{ type: 16, value: '123.355', name: 'LES SABLES D OLONNE', primary: true }]),
    LFTA: openaipItem('LFTA', 'LA TRANCHE SUR MER', 46.3656, -1.4275,
        [{ type: 12, value: '123.500', name: 'A/A', primary: true }]),
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = target(req.url());
    if (u.includes('api.core.openaip.net/api/airports')) {
        const code = u.match(/search=([A-Z0-9]{4})/)?.[1];
        const it = openaipDb[code];
        req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' },
            body: JSON.stringify(it ? { items: [it] } : { items: [] }) });
        return;
    }
    if (u.includes('meteo-relais') || u.includes('script.google') || u.includes('corsproxy.io') || u.includes('aviationweather.gov')) {
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (u.includes('/metar') || u.includes('/taf')) {
            const isTaf = u.includes('/taf');
            const ids = (u.match(/ids=([A-Z0-9,]+)/)?.[1] || '').split(',').filter(Boolean);
            req.respond({ status: 200, contentType: 'application/json', headers,
                body: isTaf
                    ? JSON.stringify(ids.map(c => ({ icaoId: c, rawTaf: `TAF ${c} 041100Z 0412/0512 27008KT 9999 FEW035=` })))
                    : JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: `METAR ${c} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021` }))) });
        } else {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        }
    } else req.continue();
});

setTimeout(() => { console.log('KO  watchdog 120 s — QA interrompue'); process.exit(1); }, 120000);

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://127.0.0.1:8664/index.html?icao=LFRV&mode=nav&dest=LFTA', { waitUntil: 'domcontentloaded', timeout: 30000 });
// Le tableau « Détail des waypoints » n'existe qu'en multi-leg : waypoint
// intermédiaire LFOO par le chemin officiel (popup « + Waypoint » → event).
await page.waitForFunction(() => !!document.getElementById('fp-waypoints'), { timeout: 60000 });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFOO' } })));

// Le détail des waypoints (tableau des tronçons) doit apparaître avec la
// fréquence du terrain d'arrivée — requalifiée A/A, jamais VOLMET.
await page.waitForFunction(() => {
    const cells = [...document.querySelectorAll('#flight-planner-panel .freq-cell')];
    return cells.length >= 2 && /\d{3}\.\d{3}/.test(cells[1].textContent);
}, { timeout: 60000 });
await new Promise(r => setTimeout(r, 800));

const legs = await page.evaluate(() =>
    [...document.querySelectorAll('#flight-planner-panel tr')].map(tr => tr.textContent.replace(/\s+/g, ' ').trim())
        .filter(t => t.includes('→')));
console.log('tronçon affiché :', JSON.stringify(legs));
const row = legs.find(t => t.includes('LFOO') && t.includes('LFTA'));
row ? ok(`ligne tronçon présente : « ${row.slice(0, 80)}… »`) : ko('ligne LFOO → LFTA introuvable');
row && row.includes('123.500 A/A') ? ok('fréquence d\u2019étape = « 123.500 A/A » (requalifiée)') : ko(`fréquence d\u2019étape inattendue : « ${row} »`);
row && !row.includes('VOLMET') ? ok('aucune mention VOLMET dans le tronçon') : ko('VOLMET encore affiché comme fréquence d\u2019étape');

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
