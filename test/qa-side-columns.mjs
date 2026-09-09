// QA SIDEBARS REPLIABLES (retour pilote 09/09 : « favoris + historique ne se
// replient pas sur portable ») : le mécanisme d'origine (CSS + toggle .expanded)
// n'était actif qu'à ≤800 px — vérifier le comportement en PORTRAIT (390 px)
// et en PAYSAGE (844 px), avant et après correction du seuil.
// Cible : version-test/ (build d'abord : node scripts/build-test-version.mjs)
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_ROOT = path.join(root, 'version-test');
if (!fs.existsSync(path.join(TEST_ROOT, 'index.html'))) {
    console.error('version-test/ absente — lancer d\'abord scripts/build-test-version.mjs');
    process.exit(1);
}
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(TEST_ROOT, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8658, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip|workers\.dev/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

async function loadAt(width, height) {
    await page.setViewport({ width, height });
    await page.goto('http://127.0.0.1:8658/index.html', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.evaluate(() => { const h = document.querySelector('.side-column-right h3'); if (h) h.dataset.qaMark = '1'; });
    await page.waitForSelector('#favorites-list', { timeout: 45000 });
    await new Promise(r => setTimeout(r, 1200));
}

// État du repli pour les deux colonnes
const state = () => page.evaluate(() => {
    const vis = sel => {
        const el = document.querySelector(sel);
        return el ? getComputedStyle(el).display !== 'none' : null;
    };
    return {
        favVisible: vis('#favorites-list'),
        histVisible: vis('#search-history-container'),   // le conteneur direct (la liste interne reste 'block' sous un parent caché)
    };
});

// ---- 1. PORTRAIT 390 px ----
await loadAt(390, 844);
let s = await state();
s.favVisible === false ? ok('portrait : Favoris replié par défaut') : ko('portrait : Favoris visible par défaut');
// Clic sur le titre → déplié
await page.click('.side-column-left h3');
await new Promise(r => setTimeout(r, 300));
s = await state();
s.favVisible === true ? ok('portrait : clic titre → Favoris déplié') : ko('portrait : le clic ne déplie pas les Favoris');
await page.click('.side-column-left h3');
await new Promise(r => setTimeout(r, 300));
s = await state();
s.favVisible === false ? ok('portrait : re-clic → Favoris replié') : ko('portrait : le re-clic ne replie pas');

// ---- 2. PAYSAGE 844 px (téléphone en paysage : >800 px d'origine) ----
await loadAt(844, 390);
s = await state();
console.log('INFO  paysage : Favoris visible par défaut = ' + s.favVisible);

const probe = await page.evaluate(() => {
    const h3 = document.querySelector('.side-column-right h3');
    window.__docSeen = 0;
    document.addEventListener('click', () => window.__docSeen++, true);
    h3.click();
    return {
        attached: !!window.__sideColAttached,
        docSeen: window.__docSeen,
        expanded: document.querySelector('.side-column-right').classList.contains('expanded'),
        inner: window.innerWidth,
        display: getComputedStyle(document.getElementById('search-history-container')).display,
    };
});
console.log('INFO  probe : ' + JSON.stringify(probe));
s = await state();
s.histVisible === true ? ok('paysage 844 : clic titre -> Historique deroule') : ko('paysage 844 : le clic ne deroule pas');
await page.click('.side-column-right h3');
await new Promise(r => setTimeout(r, 300));
s = await state();
s.histVisible === false ? ok('paysage 844 : re-clic -> Historique replie') : ko('paysage 844 : le re-clic ne replie pas');

if (jsErrors.length > 0) ko('erreurs JS : ' + jsErrors.join(' | ')); else ok('aucune erreur JS');
console.log(failures === 0 ? '\nSIDEBARS MOBILE : TOUT OK' : `\nSIDEBARS MOBILE : ${failures} ÉCHEC(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
