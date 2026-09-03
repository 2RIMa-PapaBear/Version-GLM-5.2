// Vérifie la page d'aperçu du log de nav PDF sur origine HTTP (comme
// Free.fr) : l'onglet ouvert doit être une page HTML habillée avec le PDF
// embarqué en <iframe src="data:application/pdf;base64,…"> (contournement
// du refus Chrome d'afficher un blob: PDF issu d'une page non sécurisée),
// plus un lien de repli « Télécharger le PDF ».
// Usage : node test/qa-pdf-tab.mjs
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
await new Promise(r => server.listen(8651, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });

// ---- Stubs réseau (relais + aviationweather + open-meteo), avec ACAO ----
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    const reply = (body, type = 'application/json') => req.respond({
        status: 200, contentType: type, headers: { 'Access-Control-Allow-Origin': '*' }, body,
    });
    if (u.includes('aviationweather.gov')) {
        if (u.includes('format=raw')) return reply('METAR LFRV 031200Z AUTO 27008KT 9999 FEW035 18/12 Q1021', 'text/plain');
        if (u.includes('stationinfo')) {
            return reply(JSON.stringify([
                { icaoId: 'LFRV', site: 'VANNES', lat: 47.72, lon: -2.72 },
                { icaoId: 'LFRC', site: 'CHERBOURG', lat: 49.65, lon: -1.47 },
                { icaoId: 'LFRN', site: 'RENNES', lat: 48.07, lon: -1.73 },
            ]));
        }
        return reply(JSON.stringify([
            { icaoId: 'LFRV', rawOb: 'METAR LFRV 031200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' },
            { icaoId: 'LFRC', rawOb: 'METAR LFRC 031200Z AUTO 28010KT 9999 FEW040 17/11 Q1021' },
            { icaoId: 'LFRN', rawOb: 'METAR LFRN 031200Z 27007KT 9999 SCT040 17/11 Q1021' },
        ]));
    }
    if (u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        return reply(JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 031200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]));
    }
    if (u.includes('api.open-meteo.com/v1/forecast')) {
        const cur = {};
        for (const h of [80, 180, 1000, 1500, 2000, 3000]) { cur[`windspeed_${h}m`] = 20 + h / 300; cur[`winddirection_${h}m`] = 265; }
        return reply(JSON.stringify({ current: cur }));
    }
    if (u.includes('api.open-meteo.com/v1/elevation')) {
        const n = (u.match(/latitude=/g) || []).length ? u.split('latitude=')[1].split('&')[0].split(',').length : 20;
        return reply(JSON.stringify({ elevation: Array.from({ length: n }, () => 40) }));
    }
    req.continue();
});

await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV&mode=nav&dest=LFRC', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Attend le planificateur + le bouton PDF (plan calculé).
await page.waitForSelector('#fp-navlog-pdf', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2500));   // profil/alternates se terminent

// Onglets ouverts par l'app.
let pdfTab = null;
browser.on('targetcreated', async t => { try { const p = await t.page(); if (p) pdfTab = p; } catch { } });

await page.click('#fp-navlog-pdf');
await page.waitForSelector('#navlog-confirm-modal [data-ok]', { timeout: 10000 });
await new Promise(r => setTimeout(r, 200));
await page.click('#navlog-confirm-modal [data-ok]');

// L'onglet reçoit la page habillée (data: iframe) une fois le PDF généré.
let verdict = null;
for (let i = 0; i < 30 && !verdict; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
        if (!pdfTab) continue;
        const c = await pdfTab.content();
        if (c.includes('data:application/pdf')) {
            const info = await pdfTab.evaluate(() => ({
                title: document.title,
                iframe: !!document.querySelector('iframe[src^="data:application/pdf"]'),
                dl: !!document.querySelector('#dl[download]'),
            }));
            verdict = { ok: true, ...info };
        } else if (c.includes('<embed') || c.length > 500) {
            verdict = { ok: false, note: 'onglet rempli sans data:iframe', head: c.slice(0, 120) };
        }
    } catch { /* onglet pas prêt */ }
}

console.log(verdict ? JSON.stringify(verdict, null, 1) : 'KO : aucun onglet PDF détecté');
await browser.close();
server.close();
process.exit(verdict?.ok ? 0 : 1);
