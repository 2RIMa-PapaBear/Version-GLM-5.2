// Vérif navigateur : les zones ZRT (openAIP, ex. « ZRT VILLACOUBLAY »)
// apparaissent-elles sur la carte quand la couche Espaces est active ?
// Balaye la souris sur les centres des ZRT connues de la cellule 48_2 et
// lit les infobulles Leaflet (sticky) qui s'ouvrent.
// Usage : node test/qa-zrt-map.mjs
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Centres approximatifs des ZRT autour du terrain de test (cellules 47_-3/47_-4).
const zrtTargets = [];
for (const f of ['47_-3.json', '47_-4.json', '47_-5.json']) {
    const cell = JSON.parse(fs.readFileSync(path.join(root, 'data/airspaces/cells', f), 'utf8'));
    for (const z of cell.items.filter(z => String(z.n).toUpperCase().startsWith('ZRT'))) {
        const ring = z.g.c[0];
        zrtTargets.push({
            name: z.n,
            lat: ring.reduce((a, p) => a + p[1], 0) / ring.length,
            lon: ring.reduce((a, p) => a + p[0], 0) / ring.length,
        });
    }
}

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
await new Promise(r => server.listen(8647, r));

const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
page.on('console', m => { const t = m.text(); if (/error|échec|failed/i.test(t)) console.log('CONSOLE:', t.slice(0, 160)); });
const netLog = [];
page.on('request', req => {
    const u = req.url();
    if (!u.includes('127.0.0.1')) netLog.push(u.slice(0, 110));
    else if (u.includes('airspaces')) netLog.push('LOCAL ' + u.slice(0, 110));
});
await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

// METAR stubbé (déterministe) : aviationweather direct + toute la chaîne du
// relais Apps Script (script.google → redirection googleusercontent/echo,
// dont l'URL ne mentionne plus la ressource — c'est elle qui 403 la nuit).
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    const isMetar = u.includes('aviationweather.gov')
        || u.includes('script.google.com') || u.includes('script.googleusercontent.com')
        || u.includes('corsproxy.io');
    if (isMetar) {
        req.respond({
            status: 200,
            contentType: 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },   // requis : fetch cross-origin
            body: JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 020900Z AUTO 27008KT 9999 FEW035 18/12 Q1020' }]),
        });
    } else req.continue();
});

await page.goto('http://127.0.0.1:8647/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });

// Attend la carte Leaflet (après chargement METAR) puis la bascule Espaces ON.
await page.waitForSelector('#regional-map', { timeout: 30000 });
try {
    await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 30000 });
} catch {
    const st = await page.evaluate(() => ({
        panes: document.querySelectorAll('#regional-map .leaflet-pane').length,
        panelClass: document.getElementById('regional-map-panel')?.className,
        info: document.getElementById('lbl-info')?.textContent?.slice(0, 60),
        banner: document.getElementById('flight-window-banner')?.textContent?.slice(0, 40),
    }));
    console.log('Carte non initialisée :', JSON.stringify(st));
    console.log('Réseau vu :', JSON.stringify([...new Set(netLog)].slice(0, 30), null, 1));
    await page.screenshot({ path: path.join(root, 'test', 'zrt_map_diag.png') });
    await browser.close(); server.close(); process.exit(1);
}
await new Promise(r => setTimeout(r, 8000));   // tuiles + voisins + cellules espaces

const pressed = 'menu';
{
    // Le bouton « Espaces » ouvre un menu déroulant (radio-points-layer) :
    // la bascule zones est la case [data-rp-airspaces] DANS ce menu.
    await page.evaluate(() => document.querySelector('.precip-toggle-airspaces').click());
    await new Promise(r => setTimeout(r, 300));
    await page.evaluate(() => {
        const cb = document.querySelector('.rp-menu [data-rp-airspaces]');
        if (!cb.checked) { cb.checked = true; cb.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await new Promise(r => setTimeout(r, 10000));
}
const pressed2 = await page.evaluate(() => document.querySelector('.rp-menu [data-rp-airspaces]')?.checked);
console.log(`Bascule zones (case du menu) : ${pressed2}`);

const totalPaths = await page.evaluate(() => document.querySelectorAll('#regional-map path.leaflet-interactive').length);
console.log(`Chemins de zones rendus : ${totalPaths}`);

// Reprojette lat/lon → pixel écran : projection Web Mercator manuelle
// (l'objet carte n'est pas exposé au window). Vue initiale : zoom 7 centré
// LFRV (47.7192, -2.7233) — le test ne déplace pas la carte.
const results = [];
for (const t of zrtTargets) {
    const pt = await page.evaluate((t) => {
        const r = document.getElementById('regional-map').getBoundingClientRect();
        const scale = 256 * Math.pow(2, 7);   // zoom 7
        const proj = (lat, lon) => [
            (lon / 360 + 0.5) * scale,
            (0.5 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / (2 * Math.PI)) * scale,
        ];
        const c = proj(47.7192, -2.7233);   // setView initial
        const p = proj(t.lat, t.lon);
        const dx = (p[0] - c[0]) + r.width / 2, dy = (p[1] - c[1]) + r.height / 2;
        return { x: Math.round(r.left + dx), y: Math.round(r.top + dy), onScreen: dx > 0 && dx < r.width && dy > 0 && dy < r.height };
    }, t);
    if (!pt.onScreen) { results.push({ name: t.name, note: 'hors vue (carte centrée LFRV)' }); continue; }
    await page.mouse.move(pt.x, pt.y, { steps: 6 });
    await new Promise(r => setTimeout(r, 400));
    const tip = await page.evaluate(() => {
        const el = document.querySelector('.leaflet-tooltip:not(.leaflet-tooltip-hide)');
        return el ? el.textContent : null;
    });
    results.push({ name: t.name, x: pt.x, y: pt.y, tooltip: tip });
}
// Validation de l'approche survol : le marqueur LFRV (centre de la vue)
// doit produire une infobulle.
{
    const c = await page.evaluate(() => {
        const r = document.getElementById('regional-map').getBoundingClientRect();
        return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2),
                 w: Math.round(r.width), h: Math.round(r.height),
                 tips: document.querySelectorAll('.leaflet-tooltip').length,
                 paths: document.querySelectorAll('#regional-map path.leaflet-interactive').length };
    });
    console.log(`Carte ${c.w}x${c.h}, infobulles existantes: ${c.tips}, chemins: ${c.paths}`);
    const render = await page.evaluate(() => ({
        badge: document.querySelector('.airspace-count')?.textContent || '(vide)',
        canvases: document.querySelectorAll('#regional-map canvas').length,
        svgPaths: document.querySelectorAll('#regional-map svg path').length,
        overlaySvg: document.querySelectorAll('#regional-map .leaflet-overlay-pane svg').length,
    }));
    console.log('Rendu zones :', JSON.stringify(render));

    // ENUMÉRATION DÉCISIVE : infobulle de chaque chemin dessiné → noms des
    // zones réellement rendues (survol synthétique sur chaque path).
    const names = await page.evaluate(() => {
        const out = [];
        const paths = [...document.querySelectorAll('#regional-map path.leaflet-interactive')];
        for (const p of paths) {
            const d = p.getAttribute('d') || '';
            const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
            if (nums.length < 4) continue;
            const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            for (const type of ['mousemove', 'mouseover']) {
                p.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy }));
            }
            // Toutes les infobulles ouvertes (celle de l'aéroport est
            // permanente et masque une lecture au premier sélecteur).
            for (const t of [...document.querySelectorAll('.leaflet-tooltip')]) {
                out.push(t.textContent.replace(/\s+/g, ' ').slice(0, 70));
            }
            p.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        }
        return out;
    });
    const uniq = [...new Set(names)];
    const zrtDrawn = uniq.filter(n => /ZRT/i.test(n));
    console.log(`Zones rendues (infobulles uniques) : ${uniq.length}`);
    console.log(`  dont ZRT : ${zrtDrawn.length}${zrtDrawn.length ? ' → ' + zrtDrawn.slice(0, 3).join(' | ') : ''}`);
    const zrtOk = zrtDrawn.length > 0 && zrtDrawn.every(n => /\bZRT\b/.test(n));

    // La famille R·P·D décochée ne doit PAS retirer les ZRT (elles vivent
    // dans TMZ/RMZ/ZRT) — le test pilote la case du menu Espaces.
    await page.evaluate(() => {
        const cb = document.querySelector('.rp-menu [data-rp-airgroup="rpd"]');
        cb.checked = false;
        cb.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await new Promise(r => setTimeout(r, 2500));
    const afterRpdOff = await page.evaluate(() => {
        const out = [];
        const paths = [...document.querySelectorAll('#regional-map path.leaflet-interactive')];
        for (const p of paths) {
            const d = p.getAttribute('d') || '';
            const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map(m => parseFloat(m[0]));
            if (nums.length < 4) continue;
            const xs = nums.filter((_, i) => i % 2 === 0), ys = nums.filter((_, i) => i % 2 === 1);
            const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
            for (const type of ['mousemove', 'mouseover']) p.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: cx, clientY: cy }));
            for (const t of [...document.querySelectorAll('.leaflet-tooltip')]) out.push(t.textContent.replace(/\s+/g, ' ').slice(0, 60));
            p.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
        }
        return [...new Set(out)];
    });
    const zrtAfterRpdOff = afterRpdOff.filter(n => /ZRT/i.test(n));
    console.log(`  R·P·D décochée → ZRT restantes : ${zrtAfterRpdOff.length} (attendu > 0), libellé famille : ${zrtAfterRpdOff[0] || '—'}`);

    globalThis.__zrtDrawn = zrtDrawn.length;
    const verdict = zrtOk && zrtAfterRpdOff.length > 0;
    console.log(verdict ? 'VERDICT : ZRT rendues dans la famille TMZ/RMZ/ZRT ✓' : 'VERDICT : ÉCHEC ZRT');
    process.exitCode = verdict ? 0 : 1;
}

console.log(JSON.stringify(results, null, 1));
console.log('Réseau vu :', JSON.stringify([...new Set(netLog)].slice(0, 40), null, 1));
const badge2 = await page.evaluate(() => ({
    badge: document.querySelector('.airspace-count')?.textContent || '(vide)',
    badgeShown: getComputedStyle(document.querySelector('.airspace-count') || {}).display,
    pressed: document.querySelector('.precip-toggle-airspaces')?.getAttribute('aria-pressed'),
}));
console.log('Badge final :', JSON.stringify(badge2));
await page.screenshot({ path: path.join(root, 'test', 'zrt_map.png') });
await browser.close();
server.close();
