// QA SUPPRESSION DEPUIS L ÉTIQUETTE (17/09) : le « × » des points de passage
// sur la carte — waypoints de route (data-icao → event remove-waypoint) et
// repères libres ZZxx (data-code → _deleteFreeWaypoint). Clics SOURIS RÉELS
// sur le bouton : valide aussi le pointer-events:auto du tooltip Leaflet.
// PIÈGE recouvrement : selon le cadrage, une étiquette passe SOUS la barre
// d en-tête de la carte ou la commande bas-gauche — on glisse la carte (vrai
// drag) jusqu à ce que le « × » soit l élément le plus haut, puis on clique
// (comme le pilote : il pan/zoome puis clique).
// barre d'en-tête de la carte ou la commande bas-gauche — on glisse la carte
// (vrai drag) jusqu'à ce que le « × » soit l'élément le plus haut, puis on
// clique (comme le pilote : il pan/zoome puis clique).
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
await new Promise(r => server.listen(8654, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// Glisse la carte (vrai drag souris) puis clic réel sur le « × », avec
// vérification que le bouton est bien l'élément le plus haut avant de cliquer.
async function dragPuisClicReel(selector) {
    for (let essai = 0; essai < 4; essai++) {
        const cible = await page.evaluate((sel) => {
            const btn = document.querySelector(sel);
            if (!btn) return { err: 'absent' };
            const r = btn.getBoundingClientRect();
            const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            return { err: null, cleared: top === btn, x: r.left + r.width / 2, y: r.top + r.height / 2 };
        }, selector);
        if (cible.err) return { err: cible.err };
        if (cible.cleared) {
            await page.mouse.click(cible.x, cible.y);
            return { err: null };
        }
        const drag = await page.evaluate(() => {
            const r = document.getElementById('regional-map').getBoundingClientRect();
            return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.8 };
        });
        await page.mouse.move(drag.x, drag.y);
        await page.mouse.down();
        await page.mouse.move(drag.x, drag.y + 120, { steps: 8 });
        await page.mouse.up();
        await wait(900);
    }
    return { err: '« × » toujours recouvert après 4 drags' };
}

await page.goto('http://127.0.0.1:8654/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('fp-waypoints'), { timeout: 30000 });
await page.evaluate(() => document.getElementById('regional-map')?.scrollIntoView({ block: 'center' }));
await wait(800);

// ① Étape aérodrome LFRC (même événement que « + Waypoint » des popups) :
// étiquette avec « × », clic réel → retirée du champ et de la carte.
await page.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFRC' } })));
await page.waitForFunction(() => document.querySelector('.free-wp-label .wp-del-x[data-icao="LFRC"]'), { timeout: 15000 });
ok('étape LFRC : étiquette avec « × » (data-icao)');
const r1 = await dragPuisClicReel('.wp-del-x[data-icao="LFRC"]');
if (r1.err) ko('étape LFRC : ' + r1.err);
await wait(1500);
const etapeApres = await page.evaluate(() => ({
    wp: document.getElementById('fp-waypoints')?.value || '',
    btn: !!document.querySelector('.wp-del-x[data-icao="LFRC"]'),
}));
console.log('waypoints :', JSON.stringify(etapeApres.wp));
(!/LFRC/i.test(etapeApres.wp) ? ok : ko)('« × » étape LFRC : retirée du champ Waypoints');
(etapeApres.btn === false ? ok : ko)('« × » étape LFRC : étiquette disparue de la carte');

// ② Repère libre : clic droit (zone dégagée) → nommer → Valider → « × » de
// SON étiquette supprime le repère ET son étape du plan.
const editeur = await page.evaluate(() => {
    const cont = document.getElementById('regional-map');
    const r = cont.getBoundingClientRect();
    // 45 % / 70 % : ni sous l'en-tête, ni sur la commande bas-gauche.
    const x = r.left + r.width * 0.45, y = r.top + r.height * 0.7;
    cont.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    return new Promise(res => setTimeout(() => res({ input: !!document.querySelector('.fw-name-input') }), 1200));
});
(editeur.input ? ok : ko)('clic droit carte : éditeur de repère ouvert');
const creation = await page.evaluate(() => {
    const inp = document.querySelector('.fw-name-input');
    if (!inp) return { err: 'pas d éditeur' };
    inp.value = 'QA SMOKE';
    document.querySelector('.fw-ok-btn')?.click();
    return new Promise(res => setTimeout(() => res({
        wp: document.getElementById('fp-waypoints')?.value || '',
        label: [...document.querySelectorAll('.free-wp-label')].map(e => e.textContent).join('|'),
    }), 1500));
});
console.log('waypoints :', JSON.stringify(creation.wp), '· étiquettes :', JSON.stringify(creation.label));
(/QA SMOKE/.test(creation.label) ? ok : ko)('repère créé : étiquette nommée posée');
await page.waitForFunction(() => document.querySelector('.free-wp-label .wp-del-x[data-code]'), { timeout: 15000 });
ok('repère libre : étiquette avec « × » (data-code)');
const r2 = await dragPuisClicReel('.free-wp-label .wp-del-x[data-code]');
if (r2.err) ko('repère : ' + r2.err);
await wait(1500);
const repereApres = await page.evaluate(() => ({
    wp: document.getElementById('fp-waypoints')?.value || '',
    labels: [...document.querySelectorAll('.free-wp-label')].map(e => e.textContent).join('|'),
}));
console.log('waypoints :', JSON.stringify(repereApres.wp), '· étiquettes :', JSON.stringify(repereApres.labels));
(!/QA SMOKE/.test(repereApres.labels) ? ok : ko)('« × » repère : étiquette + marqueur disparus');
(!/ZZ[A-Z]{2}/.test(repereApres.wp) ? ok : ko)('« × » repère : retiré du champ Waypoints');

// ③ Popups sans doublons : plus aucun bouton de suppression dans le DOM.
const doublons = await page.evaluate(() => ({
    rmwp: !!document.querySelector('.mp-rmwp-btn'),
    fwdel: !!document.querySelector('.fw-del-btn'),
}));
(doublons.rmwp === false ? ok : ko)('popup étape : plus de bouton « Retirer du plan » (doublon)');
(doublons.fwdel === false ? ok : ko)('popup repère : plus de bouton « Supprimer » (doublon)');

(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));

server.close();
await browser.close();
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE KO (${failures})`);
process.exit(failures === 0 ? 0 : 1);
