// Couverture ESPACES AÉRIENS de la vue (retour pilote 05/09 : « lorsque je
// déplace la carte les espaces ne couvrent pas l'ensemble de la carte
// visible, environ 50 % ») — à z6 France l'ancien clamp 5° laissait un côté
// entier vierge. On active la couche Espaces, on vérifie que les 4
// quadrants de la vue sont peuplés, puis on PANNE latéralement et on
// re-vérifie (c'est LE cas signalé).
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let cellReqs = 0;
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    if (p.startsWith('/data/airspaces/cells/')) cellReqs++;
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8659, r));
const edgeDir = 'C:/Program Files/BraveSoftware/Brave-Browser/Application';
const browser = await puppeteer.launch({ executablePath: `${edgeDir}/brave.exe`, headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '[]' });
    } else if (u.includes('aviationweather.gov')) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else if (u.includes('api.core.openaip.net')) {
        // Repli API neutralisé : la QA porte sur la source fichier.
        req.respond({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: '{"items":[]}' });
    } else req.continue();
});
await page.goto('http://127.0.0.1:8659/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 3000));

// Couche Espaces ON — piège : le bouton est cloné par la couche
// radio-points pour y greffer un menu ; le clic ouvre le menu, et c'est la
// CASE « Espaces aériens » qui bascule la couche (event change).
const toggled = await page.evaluate(() => {
    const btns = [...document.querySelectorAll('.precip-toggle-airspaces')];
    btns[btns.length - 1]?.click();
    const cb = document.querySelector('.rp-menu input[data-rp-airspaces]');
    if (!cb) return false;
    cb.checked = true;
    cb.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
});
if (!toggled) { console.log('KO  menu Espaces introuvable'); await browser.close(); server.close(); process.exit(1); }

// Dézoom via les boutons natifs Leaflet (la molette dérive selon la
// position sous le curseur) jusqu'à une vue ≥ 6° de large : à cette échelle
// l'ancien clamp 5° laissait mécaniquement un côté de la carte vierge.
async function recentre() {
    await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
    await new Promise(r => setTimeout(r, 200));
    return page.evaluate(() => { const r = document.getElementById('regional-map').getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
}
// Empreinte de la vue depuis les tuiles chargées — ATTENTION à l'ordre :
// ArcGIS satellite = /z/y/x, les autres (OSM…) = /z/x/y.
const viewSpan = () => page.evaluate(() => {
    const tiles = [...document.querySelectorAll('#regional-map img.leaflet-tile-loaded')]
        .map(i => { const m = new URL(i.src).pathname.match(/\/(\d+)\/(\d+)\/(\d+)/); return m && { z: +m[1], a: +m[2], b: +m[3], arc: i.src.includes('arcgisonline') }; })
        .filter(Boolean);
    if (!tiles.length) return null;
    const n2 = 2 ** tiles[0].z;
    const pts = tiles.map(t => ({ x: t.arc ? t.b : t.a, y: t.arc ? t.a : t.b }));
    const lon = x => x / n2 * 360 - 180;
    return { z: tiles[0].z, west: lon(Math.min(...pts.map(p => p.x))), east: lon(Math.max(...pts.map(p => p.x)) + 1) };
});
let span = null;
for (let i = 0; i < 6 && !(span && span.east - span.west >= 6); i++) {
    await page.click('#regional-map .leaflet-control-zoom-out', { offset: { x: 5, y: 5 } });
    await new Promise(r => setTimeout(r, 900));
    span = await viewSpan();
}
span = await viewSpan();
console.log(`Vue : z${span?.z} · lon ${span?.west.toFixed(1)}E→${span?.east.toFixed(1)}E (${(span?.east - span?.west).toFixed(1)}°)`);

// Attente de stabilité du rendu (cellules réseau → paths SVG).
async function settle(timeoutMs = 45000) {
    let last = -1, stable = 0;
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
        const n = await page.evaluate(() => document.querySelectorAll('#regional-map path.leaflet-interactive').length);
        if (n === last) { stable += 400; if (stable >= 1600) return n; } else stable = 0;
        last = n;
        await new Promise(r => setTimeout(r, 400));
    }
    return last;
}
function quadrants() {
    return page.evaluate(() => {
        const el = document.getElementById('regional-map');
        const r = el.getBoundingClientRect();
        const paths = [...el.querySelectorAll('path.leaflet-interactive')];
        const q = { TL: 0, TR: 0, BL: 0, BR: 0 };
        const halves = { L: 0, R: 0 };
        for (const m of paths) {
            const b = m.getBoundingClientRect();
            if (b.width === 0 && b.height === 0) continue;
            const x = b.left + b.width / 2 - r.left, y = b.top + b.height / 2 - r.top;
            if (x < 0 || y < 0 || x > r.width || y > r.height) continue;
            q[(y < r.height / 2 ? 'T' : 'B') + (x < r.width / 2 ? 'L' : 'R')]++;
            halves[x < r.width / 2 ? 'L' : 'R']++;
        }
        return { q, halves, total: paths.length };
    });
}
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const check = (label, res) => {
    for (const k of ['TL', 'TR', 'BL', 'BR']) (res.q[k] > 0 ? ok : ko)(`${label} quadrant ${k} peuplé (${res.q[k]})`);
    // Critère durci (retour pilote « ~50 % de la carte couverte ») : chaque
    // MOITIÉ de la vue doit être réellement peuplée — l'ancien clamp 5° ne
    // chargeait qu'une bande ancrée au sud-ouest, laissant l'autre moitié
    // avec les seules grandes zones débordantes.
    for (const k of ['L', 'R']) (res.halves[k] >= 25 ? ok : ko)(`${label} moitié ${k === 'L' ? 'gauche' : 'droite'} dense (${res.halves[k]})`);
    (res.total > 0 ? ok : ko)(`${label} zones rendues (${res.total})`);
};

await settle();
check('vue France z6', await quadrants());
console.log(`Requêtes cellules émises : ${cellReqs}`);

// PAN latéral (drag 400 px vers la gauche = regard vers l'ouest) : la vue
// déborde de l'ancienne grille → nouveau chargement → 4 quadrants à nouveau.
// Re-scroll avant le drag (la page a pu bouger) et vérification que la vue
// a réellement changé.
const before = await viewSpan();
let panned = false;
for (let t = 0; t < 3 && !panned; t++) {
    const mid = await recentre();
    await page.mouse.move(mid.x, mid.y);
    await page.mouse.down();
    await page.mouse.move(mid.x - 400, mid.y, { steps: 25 });
    await page.mouse.up();
    await new Promise(r => setTimeout(r, 600));
    const s = await viewSpan();
    panned = !!s && !!before && (Math.abs(s.west - before.west) > 0.05 || s.z !== before.z);
}
panned ? ok('pan latéral effectif (vue déplacée)') : ko('pan latéral sans effet');
await settle();
const span2 = await viewSpan();
console.log(`Vue après pan : z${span2?.z} · lon ${span2?.west.toFixed(1)}E→${span2?.east.toFixed(1)}E`);
check('après pan', await quadrants());
console.log(`Requêtes cellules cumulées : ${cellReqs}`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
