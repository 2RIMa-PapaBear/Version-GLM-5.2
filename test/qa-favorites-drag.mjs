// Classement des FAVORIS À LA SOURIS (demande pilote 05/09) : poignée
// grip sur chaque ligne, drag & drop HTML5, persistance de l'ordre.
// Puppeteer/CDP ne déclenche pas le drag natif avec la souris → on
// dispatche des DragEvent avec un vrai DataTransfer (valide le câblage des
// handlers + le résultat), et on vérifie au passage que le clic reste un
// clic (ouverture du terrain) et que la poignée ne navigue pas.
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
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
// Favoris posés AVANT tout script de page (le rendu de la liste a lieu au chargement).
await page.evaluateOnNewDocument(() => {
    localStorage.setItem('favorites', JSON.stringify(['LFRV', 'LFRN', 'LFRO', 'LFRT']));
});
await page.goto('http://127.0.0.1:8661/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('#favorites-list .fav-item').length >= 4, { timeout: 30000 });
await new Promise(r => setTimeout(r, 1000));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const domOrder = () => page.evaluate(() => [...document.querySelectorAll('#favorites-list .fav-item')].map(b => b.dataset.icao));
const lsOrder = () => page.evaluate(() => JSON.parse(localStorage.getItem('favorites')));
const eq = (a, b, m) => (JSON.stringify(a) === JSON.stringify(b) ? ok : ko)(`${m} (${JSON.stringify(a)})`);

// Drag synthétique : from → dessus/dessous de to (selon after).
const drag = (from, to, after) => page.evaluate((from, to, after) => {
    const items = [...document.querySelectorAll('#favorites-list .fav-item')];
    const src = items.find(b => b.dataset.icao === from);
    const dst = items.find(b => b.dataset.icao === to);
    if (!src || !dst) return false;
    const r = dst.getBoundingClientRect();
    const y = after ? r.bottom - 2 : r.top + 2;
    const dt = new DataTransfer();
    src.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('dragover', { bubbles: true, clientY: y, dataTransfer: dt }));
    dst.dispatchEvent(new DragEvent('drop', { bubbles: true, clientY: y, dataTransfer: dt }));
    src.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    return true;
}, from, to, after);

// 1. Rendu initial : 4 lignes dans l'ordre, poignée + icône grip générée.
eq(await domOrder(), ['LFRV', 'LFRN', 'LFRO', 'LFRT'], 'ordre initial (DOM)');
const handles = await page.evaluate(() => {
    const hs = [...document.querySelectorAll('#favorites-list .fav-drag-handle')];
    return { n: hs.length, icons: hs.filter(h => h.querySelector('svg') || h.querySelector('i')).length };
});
handles.n === 4 ? ok('4 poignées rendues') : ko(`poignées : ${handles.n}`);
handles.icons === 4 ? ok('icône grip générée sur chacune') : ko(`icônes grip : ${handles.icons}`);
(await page.evaluate(() => getComputedStyle(document.querySelector('.fav-drag-handle')).cursor) === 'grab')
    ? ok('curseur grab sur la poignée') : ko('curseur poignée incorrect');

// 2. Descente : LFRV lâché SOUS LFRO → LFRN, LFRO, LFRV, LFRT.
(await drag('LFRV', 'LFRO', true)) ? ok('drag 1 dispatché') : ko('drag 1 : items introuvables');
await new Promise(r => setTimeout(r, 300));
eq(await domOrder(), ['LFRN', 'LFRO', 'LFRV', 'LFRT'], 'DOM après descente sous LFRO');
eq(await lsOrder(), ['LFRN', 'LFRO', 'LFRV', 'LFRT'], 'localStorage après descente');

// 3. Montée : LFRV lâché AU-DESSUS de LFRN → LFRV, LFRN, LFRO, LFRT.
(await drag('LFRV', 'LFRN', false)) ? ok('drag 2 dispatché') : ko('drag 2 : items introuvables');
await new Promise(r => setTimeout(r, 300));
eq(await domOrder(), ['LFRV', 'LFRN', 'LFRO', 'LFRT'], 'DOM après montée au-dessus de LFRN');
eq(await lsOrder(), ['LFRV', 'LFRN', 'LFRO', 'LFRT'], 'localStorage après montée');

// 4. Drop sur soi-même : aucun changement, pas d'erreur.
(await drag('LFRN', 'LFRN', true)) || ko('drag sur soi introuvable');
eq(await lsOrder(), ['LFRV', 'LFRN', 'LFRO', 'LFRT'], 'drop sur soi = no-op');

// 5. La poignée ne NAVIGUE PAS (clic dessus n'ouvre pas le terrain).
const inputBefore = await page.evaluate(() => document.getElementById('icaoInput')?.value);
await page.evaluate(() => document.querySelectorAll('#favorites-list .fav-drag-handle')[1]?.click());
await new Promise(r => setTimeout(r, 400));
const inputAfterHandle = await page.evaluate(() => document.getElementById('icaoInput')?.value);
inputAfterHandle === inputBefore ? ok('clic poignée : pas de navigation') : ko(`clic poignée a navigué (${inputBefore} → ${inputAfterHandle})`);

// 6. Le clic sur la ligne ouvre toujours le terrain (comportement inchangé).
await page.evaluate(() => document.querySelectorAll('#favorites-list .fav-item')[1]?.click());
await new Promise(r => setTimeout(r, 600));
const inputAfterItem = await page.evaluate(() => document.getElementById('icaoInput')?.value);
inputAfterItem === 'LFRN' ? ok('clic ligne : terrain ouvert (LFRN)') : ko(`clic ligne : ${inputAfterItem}`);

// 7. Pas de débordement horizontal de la ligne (poignée ~18 px ajoutés).
const fit = await page.evaluate(() => {
    const it = document.querySelector('#favorites-list .fav-item');
    const cont = document.getElementById('favorites-list');
    return { item: it.getBoundingClientRect().right, cont: cont.getBoundingClientRect().right, scrollW: cont.scrollWidth, clientW: cont.clientWidth };
});
(fit.scrollW <= fit.clientW + 1) ? ok(`aucun débordement (scrollW ${fit.scrollW} ≤ ${fit.clientW})`) : ko(`débordement ${fit.scrollW} > ${fit.clientW}`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
