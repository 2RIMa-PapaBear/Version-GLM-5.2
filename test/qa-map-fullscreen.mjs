// QA du plein cadre intégré de la carte régionale : bouton ⛶ → panneau
// fixed plein écran + carte agrandie + scroll body verrouillé ; Échap →
// retour normal. Testé en desktop 1280 et mobile 390.
// Usage : node test/qa-map-fullscreen.mjs
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
await new Promise(r => server.listen(8652, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});

let failures = 0;
const ko = (m) => { failures++; console.log('KO  ' + m); };
const ok = (m) => console.log('OK  ' + m);

for (const W of [1280, 390]) {
    const page = await browser.newPage();
    await page.setViewport({ width: W, height: W > 800 ? 900 : 844, deviceScaleFactor: 1 });
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        const metar = JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]);
        if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
            const raw = u.includes('format=raw');
            req.respond({ status: 200, contentType: raw ? 'text/plain' : 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: raw ? metar.slice(2, -2).replace(/\\"/g, '"') : metar });
        } else req.continue();
    });
    await page.goto(`http://127.0.0.1:8652/index.html?icao=LFRV&mode=nav`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
    await new Promise(r => setTimeout(r, 3500));

    const h0 = await page.evaluate(() => Math.round(document.getElementById('regional-map').getBoundingClientRect().height));
    await page.evaluate(() => document.querySelector('.map-fs-btn')?.click());
    await new Promise(r => setTimeout(r, 600));
    const st = await page.evaluate(() => {
        const panel = document.getElementById('regional-map-panel');
        const cs = getComputedStyle(panel);
        const map = document.getElementById('regional-map').getBoundingClientRect();
        return {
            fixed: cs.position === 'fixed',
            covers: cs.zIndex !== 'auto' && map.height >= window.innerHeight - 155 && map.width >= window.innerWidth - 30,
            h: Math.round(map.height),
            w: Math.round(map.width),
            innerH: window.innerHeight,
            innerW: window.innerWidth,
            scrollLocked: getComputedStyle(document.body).overflow === 'hidden',
            lbl: document.querySelector('.map-fs-btn span')?.textContent,
        };
    });
    st.fixed ? ok(`[${W}px] panneau fixed`) : ko(`[${W}px] panneau pas fixed (${st.position})`);
    st.covers ? ok(`[${W}px] carte agrandie ${st.w}x${st.h} (fenêtre ${st.innerW}x${st.innerH})`) : ko(`[${W}px] carte trop petite ${st.w}x${st.h}`);
    st.scrollLocked ? ok(`[${W}px] scroll page verrouillé`) : ko(`[${W}px] scroll non verrouillé`);
    st.h > h0 + 100 ? ok(`[${W}px] agrandissement net (${h0} → ${st.h}px)`) : ko(`[${W}px] pas assez agrandie (${h0} → ${st.h}px)`);

    if (W === 1280) await page.screenshot({ path: path.join(root, 'test', 'map_fs_desktop.png') });

    // Échap referme.
    await page.keyboard.press('Escape');
    await new Promise(r => setTimeout(r, 500));
    const closed = await page.evaluate(() => {
        const panel = document.getElementById('regional-map-panel');
        return getComputedStyle(panel).position !== 'fixed'
            && getComputedStyle(document.body).overflow !== 'hidden';
    });
    closed ? ok(`[${W}px] Échap referme et restaure`) : ko(`[${W}px] Échap n'a pas refermé`);
    await page.close();
}

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
