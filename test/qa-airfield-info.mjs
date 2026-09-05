// FICHE TERRAIN dans l'onglet « Fréquences & info terrain » (demande pilote
// 05/09) : identité (élévation/déclinaison/usage/statut), pistes en clair,
// horaires ATS + tél exploitant et avitaillement (France, rubriques AD du
// XML SIA) ; identité + pistes pour le reste du monde (base embarquée).
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
await new Promise(r => server.listen(8663, r));
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

async function checkTerrain(icao, present, absent) {
    await page.goto(`http://127.0.0.1:8663/index.html?icao=${icao}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 2000));
    // Insensible à la casse : les titres de section sont rendus en MAJUSCULES
    // (text-transform) et innerText retourne le texte transformé.
    const txt = (await page.evaluate(() => document.getElementById('frequencies-widget').innerText)).toUpperCase();
    for (const s of present) (txt.includes(s.toUpperCase()) ? ok : ko)(`${icao} contient « ${s} »`);
    for (const s of absent) (!txt.includes(s.toUpperCase()) ? ok : ko)(`${icao} sans « ${s} »`);
    // Aucun débordement horizontal du widget (pistes en ligne).
    const fit = await page.evaluate(() => {
        const c = document.getElementById('frequencies-widget');
        return { scrollW: c.scrollWidth, clientW: c.clientWidth };
    });
    (fit.scrollW <= fit.clientW + 1 ? ok : ko)(`${icao} widget sans débordement (${fit.scrollW} ≤ ${fit.clientW})`);
}

// LFRV — France complète : FRÉQUENCES puis PISTES puis HORAIRES puis le
// reste, lien eAIP en DERNIÈRE ligne (ordre demandé par le pilote 05/09).
await checkTerrain('LFRV', [
    '440 ft', 'VFR · IFR', 'Ouvert à la circulation aérienne publique',
    '04/22 ★', '039° vrai', '1530 × 45 m', 'revêtue', 'seuils 429/437 ft',
    '08/26', '995 × 60 m', 'non revêtue',
    'Horaires du service', 'HX', 'AFIS', '02 97 60 78 79',
    'Avitaillement', 'Automate',
    '122.605',
    'infos terrain : SIA (AIRAC 2026-09-03)',
], []);
{
    // Ordre des sections : fréquences < pistes < horaires < terrain <
    // avitaillement < lien eAIP (dernière ligne).
    await page.goto('http://127.0.0.1:8663/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1200));
    const order = await page.evaluate(() => {
        const t = document.getElementById('frequencies-widget').innerText.toUpperCase();
        const idx = (s) => t.indexOf(s.toUpperCase());
        return { freq: idx('122.605'), piste: idx('PISTES'), hor: idx('HORAIRES DU SERVICE'), terrain: idx('VFR · IFR'), avt: idx('AVITAILLEMENT'), vac: idx('EAIP OFFICIEL') };
    });
    const seq = [order.freq, order.piste, order.hor, order.terrain, order.avt, order.vac];
    (seq.every((v, i) => v >= 0 && (i === 0 || v > seq[i - 1])) ? ok : ko)(`ordre sections ${JSON.stringify(order)}`);
}

// LFOM — France sans rubriques AD horaires : sections absentes, fiche reste.
await checkTerrain('LFOM', [], ['Horaires du service', 'Avitaillement']);

// EGHH — reste du monde : pays + élévation + pistes (base embarquée,
// caps sans « vrai », mètres convertis 7454 ft → 2271 m), aucune
// section France. Élvévation/pays enrichis dynamiquement (39 ft / GB).
await checkTerrain('EGHH', [
    'GB', '39 ft',
    '08/26', '075°', '2271 m',
    'base embarquée',
], ['Horaires du service', 'Avitaillement', 'vrai']);

// Passe mobile 390 px : les lignes piste (flex-wrap) ne débordent pas.
await page.setViewport({ width: 390, height: 800 });
await page.goto('http://127.0.0.1:8663/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
await new Promise(r => setTimeout(r, 2000));
const fitM = await page.evaluate(() => {
    const c = document.getElementById('frequencies-widget');
    return { scrollW: c.scrollWidth, clientW: c.clientWidth };
});
(fitM.scrollW <= fitM.clientW + 1 ? ok : ko)(`mobile 390 : sans débordement (${fitM.scrollW} ≤ ${fitM.clientW})`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
