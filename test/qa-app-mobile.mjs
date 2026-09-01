// Vérification app réelle : bandeau « NUIT AÉRONAUTIQUE » + débordements.
// Usage : node test/qa-app-mobile.mjs [largeur=390] — 390 = mobile, 1280 = desktop.
const WIDTH = parseInt(process.argv[2] || '390', 10);
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
await new Promise(r => server.listen(8645, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: WIDTH, height: WIDTH > 800 ? 900 : 844, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8645/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Attend (30 s max) que le bandeau fenêtre de vol soit rendu = METAR chargé.
let bannerOk = true;
try {
    await page.waitForSelector('#flight-window-banner .flight-window-content', { timeout: 30000 });
} catch { bannerOk = false; }
await new Promise(r => setTimeout(r, 1500));

const m = await page.evaluate(() => {
    const res = { url: location.href, hasBanner: false };
    const b = document.getElementById('flight-window-banner');
    res.hasBanner = !!(b && b.querySelector('.flight-window-content'));
    if (res.hasBanner) {
        const label = b.querySelector('.flight-window-status div div');
        res.label = label ? label.textContent : '';
        res.labelLines = label ? (Math.round(label.getBoundingClientRect().height) > 20 ? 2 : 1) : 0;
        res.labelOverflows = label ? label.scrollWidth > label.clientWidth + 1 : null;
        const br = b.getBoundingClientRect();
        res.bannerRight = Math.round(br.right);
        res.bannerOverflows = br.right > window.innerWidth + 1;
    }
    res.pageScrollW = document.scrollingElement.scrollWidth;
    res.innerW = window.innerWidth;
    const off = [];
    document.querySelectorAll('body *').forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > window.innerWidth + 1) {
            const anc = el.closest('[id]');
            off.push(((anc && anc.id) ? '#' + anc.id : '?') + ' > .' + (typeof el.className === 'string' && el.className ? el.className.split(' ')[0] : '') + ':' + el.tagName +
                ' « ' + (el.textContent || '').trim().slice(0, 30) + ' » right=' + Math.round(r.right));
        }
    });
    res.offenders = [...new Set(off)].slice(0, 12);
    return res;
});

console.log(JSON.stringify(m, null, 1));
await page.screenshot({ path: path.join(root, 'test', `app_mobile_${WIDTH}.png`), fullPage: false });

await browser.close();
server.close();
