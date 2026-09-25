// REPÈRE LIBRE DÉPLAÇABLE (retour pilote 25/09) : glisser à la souris au
// bureau ; sur téléphone, appui long (450 ms) PUIS glissé — la carte reste
// immobile, un toucher bref garde le popup, un glissé immédiat panne la
// carte. Au relâcher : fiche réécrite dans la base locale + plan recalculé
// quand le repère en fait partie (re-testé via le « + Plan » du clic droit).
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
await new Promise(r => server.listen(8668, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));
const pageErrors = [];

async function openPage(opts) {
    const p = await browser.newPage();
    p.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
    await p.setRequestInterception(true);
    p.on('request', req => {
        const u = req.url();
        if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
            req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
        } else req.continue();
    });
    await p.setViewport(opts);
    await p.goto('http://127.0.0.1:8668/index.html?icao=LFRV&mode=nav&dest=LFRN', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p.waitForFunction(() => document.getElementById('fp-waypoints') && document.querySelectorAll('.pin-hit').length > 5, { timeout: 30000 });
    await p.evaluate(() => document.getElementById('regional-map')?.scrollIntoView({ block: 'center' }));
    await wait(800);
    return p;
}

// Pose un repère « QA PT LIBRE » par clic droit sur un point océan hors
// route ET NON RECOUVERT par un contrôle Leaflet (sur téléphone, les
// étiquettes de tronçons recouvrent une partie de la carte et avaleraient
// les touchers), puis VIDE le champ Waypoints : la route ne passe plus par
// lui, son hit DOM est la cible unique (sinon le hit du point de route,
// concentrique, intercepte la souris).
async function createIsolatedWp(p) {
    await p.evaluate(() => {
        const cont = document.getElementById('regional-map');
        const r = cont.getBoundingClientRect();
        const essais = [[0.15, 0.75], [0.2, 0.5], [0.5, 0.68], [0.3, 0.4], [0.45, 0.5], [0.6, 0.7]];
        let x = 0, y = 0;
        for (const [fx, fy] of essais) {
            const px = r.left + r.width * fx, py = r.top + r.height * fy;
            const sous = document.elementFromPoint(px, py);
            if (!sous?.closest?.('.leaflet-control')) { x = px; y = py; break; }
        }
        if (!x) { x = r.left + r.width * 0.15; y = r.top + r.height * 0.75; }
        cont.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    });
    await wait(900);
    const created = await p.evaluate(() => {
        const inp = document.querySelector('.fw-name-input');
        if (!inp) return false;
        inp.value = 'QA PT LIBRE';
        document.querySelector('.fw-ok-btn')?.click();
        return true;
    });
    if (!created) { ko('création du repère : éditeur introuvable'); return null; }
    await wait(1400);
    await p.evaluate(() => {
        const wp = document.getElementById('fp-waypoints');
        if (wp) { wp.value = ''; wp.dispatchEvent(new Event('change')); }
    });
    await wait(900);
    return p.evaluate(() => {
        // Localise le cercle ambre r=7 (repère) PUIS son hit DOM — et
        // vérifie qu'aucun contrôle Leaflet ne le recouvre.
        const paths = [...document.querySelectorAll('#regional-map path')];
        const ambre = paths.find(q => (q.getAttribute('fill') || '').toUpperCase() === '#FBBF24'
            && Math.abs(q.getBoundingClientRect().width - 14) <= 2.5);
        if (!ambre) return { err: 'repère introuvable' };
        const r = ambre.getBoundingClientRect();
        const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        const sous = document.elementFromPoint(cx, cy);
        if (sous?.closest?.('.leaflet-control')) return { err: 'repère recouvert par un contrôle Leaflet' };
        const hits = [...document.querySelectorAll('#regional-map .pin-hit')];
        const hit = hits.find(d => { const h = d.getBoundingClientRect(); return cx >= h.left && cx <= h.right && cy >= h.top && cy <= h.bottom; });
        if (!hit) return { err: `hit introuvable (${hits.length})` };
        const pane = document.querySelector('#regional-map .leaflet-map-pane');
        return { err: null, cx: Math.round(cx), cy: Math.round(cy), w: Math.round(hits[0].getBoundingClientRect().width), paneTf: pane?.style.transform || '' };
    });
}

const localiser = (p) => p.evaluate(() => {
    const paths = [...document.querySelectorAll('#regional-map path')];
    const ambre = paths.find(q => (q.getAttribute('fill') || '').toUpperCase() === '#FBBF24'
        && Math.abs(q.getBoundingClientRect().width - 14) <= 2.5);
    if (!ambre) return null;
    const r = ambre.getBoundingClientRect();
    const pane = document.querySelector('#regional-map .leaflet-map-pane');
    return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, paneTf: pane?.style.transform || '', wp: document.getElementById('fp-waypoints')?.value || '',
        popup: !!document.querySelector('#regional-map .leaflet-popup'), hint: !!document.querySelector('.wp-move-hint') };
});

// ---------- BUREAU : glisser souris ----------
{
    const page = await openPage({ width: 1280, height: 900 });
    const av = await createIsolatedWp(page);
    if (av?.err) ko('bureau : ' + av.err);
    else {
        // Glisser RÉEL : souris enfoncée sur le hit, déplacée, relâchée.
        await page.mouse.move(av.cx, av.cy);
        await page.mouse.down();
        for (let i = 1; i <= 6; i++) await page.mouse.move(av.cx + 20 * i, av.cy - 12 * i);
        await page.mouse.up();
        await wait(1000);
        const ap = await localiser(page);
        const dx = ap ? Math.round(ap.cx - av.cx) : 0, dy = ap ? Math.round(ap.cy - av.cy) : 0;
        (Math.hypot(dx, dy) > 40 ? ok : ko)(`bureau : glisser souris → repère déplacé (${dx}, ${dy} px)`);
        (!ap.popup ? ok : ko)('bureau : pas de popup ouvert par le glisser');
        (/QA/.test(ap.wp) ? ko : ok)(`bureau : repère retiré du plan au préalable (${JSON.stringify(ap.wp)}) — position enregistrée sans recalcul`);
        // Re-ajout au plan (clic droit) : la fiche déplacée alimente le
        // recalcul — le champ reprend le repère SANS erreur.
        const readd = await page.evaluate((x, y) => {
            const hits = [...document.querySelectorAll('#regional-map .pin-hit')];
            const hit = hits.find(d => { const h = d.getBoundingClientRect(); return x >= h.left && x <= h.right && y >= h.top && y <= h.bottom; });
            if (!hit) return { err: 'hit introuvable' };
            const r = hit.getBoundingClientRect();
            hit.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
            return new Promise(res => setTimeout(() => res({ err: null, wp: document.getElementById('fp-waypoints')?.value || '' }), 1200));
        }, Math.round(ap.cx), Math.round(ap.cy));
        (/QA/.test(readd.wp || '') ? ok : ko)(`bureau : clic droit « + Plan » → recalculé à la NOUVELLE position (${JSON.stringify(readd.wp)})`);
    }
    await page.close();
}

// ---------- TÉLÉPHONE 390 px : appui long ----------
{
    const page = await openPage({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    const av = await createIsolatedWp(page);
    if (av?.err) ko('mobile : ' + av.err);
    else {
        (av.w >= 24 ? ok : ko)(`mobile : cible tactile élargie (${av.w} px)`);

        // ① Toucher BREF : le popup d'édition s'ouvre toujours.
        await page.touchscreen.tap(av.cx, av.cy);
        await wait(800);
        const t1 = await localiser(page);
        (t1.popup ? ok : ko)('mobile : toucher bref → popup Renommer conservé');
        await page.evaluate(() => document.querySelector('#regional-map .leaflet-popup-close-button')?.click());
        await wait(400);

        // ② APPUI LONG (700 ms > 450) puis glissé : le repère suit le doigt,
        // la carte reste immobile, pas de popup au relâcher. Joué À FROID
        // (juste après le tap) : la cible est propre.
        const b3 = await localiser(page);
        await page.touchscreen.touchStart(Math.round(b3.cx), Math.round(b3.cy));
        await wait(700);
        const actif = await page.evaluate(() => !!document.querySelector('.wp-move-hint'));
        for (let i = 1; i <= 5; i++) await page.touchscreen.touchMove(Math.round(b3.cx + 16 * i), Math.round(b3.cy - 14 * i));
        await page.touchscreen.touchEnd();
        await wait(1000);
        const a3 = await localiser(page);
        const dx = Math.round(a3.cx - b3.cx), dy = Math.round(a3.cy - b3.cy);
        (actif ? ok : ko)('mobile : maintien 700 ms → repère « décroché » (indice affiché)');
        (Math.hypot(dx, dy) > 30 ? ok : ko)(`mobile : appui long + glissé → repère déplacé (${dx}, ${dy} px)`);
        (a3.paneTf === b3.paneTf ? ok : ko)('mobile : la carte n\'a PAS panné pendant le déplacement');
        (!a3.popup ? ok : ko)('mobile : pas de popup fantôme au relâcher');
        (!a3.hint ? ok : ko)('mobile : indice retiré au relâcher');

        // ③ Glissé IMMÉDIAT (pas d'appui long) : la carte panne, pas
        // d'indice de déplacement. Le départ se fait sur le repère si sa
        // cible est propre, sinon sur un point libre de la carte (le
        // comportement testé est celui de la carte, pas du repère).
        const b2 = await localiser(page);
        const dep = await page.evaluate((x, y) => {
            const sous = document.elementFromPoint(x, y);
            if (sous?.closest?.('.leaflet-control')) {
                const r = document.getElementById('regional-map').getBoundingClientRect();
                return { x: Math.round(r.left + r.width * 0.75), y: Math.round(r.top + r.height * 0.3) };
            }
            return { x: Math.round(x), y: Math.round(y) };
        }, Math.round(b2.cx), Math.round(b2.cy));
        await page.touchscreen.touchStart(dep.x, dep.y);
        for (let i = 1; i <= 5; i++) await page.touchscreen.touchMove(dep.x - 18 * i, dep.y - 22 * i);
        await page.touchscreen.touchEnd();
        await wait(600);
        const a2 = await localiser(page);
        (a2.paneTf !== b2.paneTf ? ok : ko)('mobile : glissé immédiat → la carte panne');
        (!a2.hint ? ok : ko)('mobile : pas d\'indice de déplacement sans appui long');
    }
    await page.close();
}

(pageErrors.length === 0 ? ok : ko)(pageErrors.length === 0 ? 'zéro erreur JS' : 'ERREURS JS : ' + pageErrors.join(' ; '));
server.close(); await browser.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
