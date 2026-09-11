// Aperçu visuel : étiquette au survol + popup d'une pastille substituée
// (terrain sans METAR propre) — captures PNG pour revue pilote.
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
        res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(d);
    });
});
await new Promise(r => server.listen(8661, r));
const target = (u) => { try { const d = decodeURIComponent(u); const m = d.match(/url=([^&]+)/); return m ? decodeURIComponent(m[1]) : d; } catch { return u; } };
const metarFor = (code) => {
    const n = parseInt(code.slice(2), 10);
    return (n % 2 === 0) ? `METAR ${code} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021` : `METAR ${code} 041200Z AUTO 24012KT 6000 BKN030 16/11 Q1018`;
};
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = target(req.url());
    if (u.includes('meteo-relais') || u.includes('script.google') || u.includes('corsproxy.io') || u.includes('aviationweather.gov')) {
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (u.includes('stationinfo') && u.includes('bbox=')) {
            const bb = u.match(/bbox=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/) || [];
            const [s, w, n, e] = bb.slice(1).map(Number);
            const stations = []; let i = 0;
            for (let lat = Math.ceil(s); lat <= Math.floor(n); lat += 1)
                for (let lon = Math.ceil(w); lon <= Math.floor(e); lon += 1) { stations.push({ icaoId: `LF${Math.floor(i / 10)}${i % 10}`, site: `Mock ${i}`, lat: lat + 0.5, lon: lon + 0.5 }); i++; }
            req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(stations.slice(0, 150)) });
        } else if (u.includes('stationinfo') && u.includes('ids=')) {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        } else if (u.includes('/metar') || u.includes('/taf')) {
            const isTaf = u.includes('/taf');
            const ids = (u.match(/ids=([A-Z0-9,]+)/)?.[1] || '').split(',').filter(Boolean);
            req.respond({ status: 200, contentType: 'application/json', headers, body: isTaf
                ? JSON.stringify(ids.map(c => ({ icaoId: c, rawTaf: `TAF ${c} 041100Z 0412/0512 27008KT 9999 FEW035=` })))
                : JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: metarFor(c) }))) });
        } else req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
    } else req.continue();
});
await page.goto('http://127.0.0.1:8661/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await page.waitForFunction(() => { const m = window.__regionalMap; if (!m) return false; let n = 0; m.eachLayer(l => { if (l.getTooltip && l.getTooltip()) n++; }); return n >= 20; }, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 400));

// Une pastille substituée (popup « Météo de ») vers le centre de la vue.
const pick = await page.evaluate(() => {
    const map = window.__regionalMap;
    const c = map.getCenter();
    let best = null;
    map.eachLayer(l => {
        const tt = (l.getTooltip && l.getTooltip()) || null;
        const pp = (l.getPopup && l.getPopup()) || null;
        if (!tt || !pp) return;
        const th = typeof tt.getContent() === 'string' ? tt.getContent() : '';
        const ph = typeof pp.getContent() === 'string' ? pp.getContent() : '';
        const m = th.match(/^<strong>([A-Z0-9]{4})(\*?)<\/strong>/);
        if (!m || !(ph.includes('Météo de') || ph.includes('Weather from'))) return;
        const ll = l.getLatLng();
        const d = Math.hypot(ll.lat - c.lat, (ll.lng - c.lng) * 0.7);
        if (!best || d < best.d) best = { d, lat: ll.lat, lon: ll.lng, code: m[1] };
    });
    if (!best) return null;
    const p = map.latLngToContainerPoint([best.lat, best.lon]);
    const r = document.getElementById('regional-map').getBoundingClientRect();
    return { x: r.left + p.x, y: r.top + p.y, code: best.code };
});
console.log('Pastille substituée visée :', pick.code);

// Survol → étiquette (tooltip) : mouseover SYNTHÉTIQUE sur le .pin-hit le
// plus proche du point (à z7 le curseur tombe souvent sur une pastille voisine).
await page.evaluate((x, y) => {
    let best = null;
    document.querySelectorAll('#regional-map .pin-hit').forEach(h => {
        const r = h.getBoundingClientRect();
        const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
        if (!best || d < best.d) best = { h, d };
    });
    if (best) {
        best.h.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    }
}, pick.x, pick.y);
await new Promise(r => setTimeout(r, 1100));
const ttTxt = await page.evaluate(() => document.querySelector('#regional-map .leaflet-tooltip')?.innerText || '(aucun tooltip)');
console.log('Tooltip ouvert :', JSON.stringify(ttTxt));
await page.screenshot({ path: 'test/apercu-substitution-etiquette.png' });
console.log('étiquette capturée');

// Clic → popup.
await page.mouse.click(Math.round(pick.x), Math.round(pick.y));
await new Promise(r => setTimeout(r, 900));
await page.screenshot({ path: 'test/apercu-substitution-popup.png' });
const popupTxt = await page.evaluate(() => document.querySelector('.leaflet-popup-content')?.innerText?.slice(0, 260) || '(aucun popup)');
console.log('--- POPUP ---'); console.log(popupTxt);

await browser.close(); server.close();
