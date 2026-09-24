// BOUTON VENT AU TACTILE (retour pilote 24/09) : « 3 fois sur 4 c'est
// l'altitude qui est sélectionnée, la surface du bouton n'est pas
// correctement divisée ». Cause : le <select> d'altitude vivait DANS le
// <button> (interactif imbriqué = routage tactile non fiable) et le
// libellé « Vent » est masqué ≤ 700 px — le sélecteur couvrait presque
// toute la surface. Fix : sélecteur FRÈRE du bouton, collé en segmenté.
// On vérifie par VRAIS taps (CDP) à 390 px que chaque zone fait ce
// qu'elle doit, et par elementFromPoint que les surfaces ne se
// chevauchent plus.
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
await new Promise(r => server.listen(8667, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
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
const wait = ms => new Promise(r => setTimeout(r, ms));

// Téléphone : 390 px, tactile — la barre passe en icônes seules ≤ 700 px.
await page.setViewport({ width: 390, height: 800, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await page.goto('http://127.0.0.1:8667/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.wind-layer-btn'), { timeout: 30000 });
await wait(2500);

const geom = await page.evaluate(() => {
    const btn = document.querySelector('.wind-layer-btn');
    // La carte régionale est loin sous le pli en mode nav : on l'amène à
    // l'écran comme le pilote qui fait défiler avant de taper.
    btn.scrollIntoView({ block: 'center' });
    const sel = document.querySelector('.wind-alt-select');
    const grp = btn?.closest('.precip-control-group');
    const br = btn.getBoundingClientRect(), sr = sel.getBoundingClientRect();
    const centre = (el, r) => ({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) });
    return {
        dansLeBouton: btn.querySelectorAll('select').length,
        freres: sel.parentElement === btn.parentElement && !!grp?.classList.contains('wind-ctl-group'),
        btnRect: { w: Math.round(br.width), h: Math.round(br.height) },
        selRect: { w: Math.round(sr.width), h: Math.round(sr.height) },
        chevauchent: br.right > sr.left + 1,
        memeHauteur: Math.abs(br.height - sr.height) <= 1.5,
        colles: Math.abs(br.right - sr.left) <= 1.5,
        btnC: centre(btn, br), selC: centre(sel, sr),
        cibleBtn: (() => { const e = document.elementFromPoint(br.left + br.width / 2, br.top + br.height / 2); return e?.closest('.wind-layer-btn') === btn; })(),
        cibleSel: (() => { const e = document.elementFromPoint(sr.left + sr.width / 2, sr.top + sr.height / 2); return e?.closest('.wind-alt-select') === sel; })(),
        labelCache: getComputedStyle(btn.querySelector('.wind-layer-label')).display === 'none',
        aLecran: br.top >= 0 && br.bottom <= innerHeight,
    };
});
(geom.aLecran ? ok : ko)('bouton amené à l’écran avant les taps');
(geom.dansLeBouton === 0 ? ok : ko)(`select HORS du bouton (${geom.dansLeBouton} descendant)`);
(geom.freres ? ok : ko)('select frère du bouton dans le groupe .wind-ctl-group');
(geom.labelCache ? ok : ko)('390 px : libellé « Vent » masqué (icônes seules) — contexte du bug');
(geom.chevauchent === false ? ok : ko)(`surfaces SANS chevauchement (bouton ${geom.btnRect.w}×${geom.btnRect.h} + select ${geom.selRect.w}×${geom.selRect.h})`);
(geom.memeHauteur ? ok : ko)(`hauteurs alignées (${geom.btnRect.h} vs ${geom.selRect.h} px)`);
(geom.colles ? ok : ko)('contrôles collés (segmenté)');
(geom.cibleBtn ? ok : ko)('elementFromPoint au centre du BOUTON → bouton');
(geom.cibleSel ? ok : ko)('elementFromPoint au centre du SELECT → select');

// --- VRAIS TAPS (CDP tactile) --------------------------------------------
// 1. Tap sur le bouton → la couche s'allume.
await page.touchscreen.tap(geom.btnC.x, geom.btnC.y);
await wait(700);
let pressed = await page.evaluate(() => document.querySelector('.wind-layer-btn').getAttribute('aria-pressed'));
(pressed === 'true' ? ok : ko)(`tap bouton → couche allumée (aria-pressed=${pressed})`);

// 2. Tap sur le sélecteur → la couche reste allumée, PAS de toggle.
await page.touchscreen.tap(geom.selC.x, geom.selC.y);
await wait(700);
pressed = await page.evaluate(() => document.querySelector('.wind-layer-btn').getAttribute('aria-pressed'));
(pressed === 'true' ? ok : ko)(`tap select → couche toujours allumée (aria-pressed=${pressed})`);

// 3. Tap sur le bouton → extinction.
await page.touchscreen.tap(geom.btnC.x, geom.btnC.y);
await wait(500);
pressed = await page.evaluate(() => document.querySelector('.wind-layer-btn').getAttribute('aria-pressed'));
(pressed === 'false' ? ok : ko)(`re-tap bouton → couche éteinte (aria-pressed=${pressed})`);

// 4. La sélection d'altitude marche toujours (change → champ plan + retour).
const altOk = await page.evaluate(() => {
    const sel = document.querySelector('.wind-alt-select');
    sel.value = '3000';
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return new Promise(r => setTimeout(() => r({
        valeur: document.querySelector('.wind-alt-select').value,
        plan: document.getElementById('fp-alt')?.value || document.getElementById('plan-alt')?.value || null,
    }), 600));
});
(altOk.valeur === '3000' ? ok : ko)(`change select → altitude prise en compte (select=${altOk.valeur})`);
(altOk.plan === '3000' || altOk.plan === null ? ok : ko)(`champ altitude du plan synchronisé (${altOk.plan})`);

// 5. Barre toujours sur 2 rangées sans débordement à 390 px (le segmenté
//    n'élargit pas la rangée 1).
const bar = await page.evaluate(() => {
    const b = document.getElementById('map-layers-bar');
    return { nRows: b.querySelectorAll(':scope > .map-layers-row').length, deborde: b.scrollWidth > b.clientWidth + 1, w: b.clientWidth };
});
(bar.nRows === 2 && !bar.deborde ? ok : ko)(`barre 2 rangées sans débordement à 390 px (${bar.nRows} rangées, ${bar.w}px)`);

// --- Passe bureau : clic souris sur le bouton (segmenté) ------------------
await page.setViewport({ width: 1280, height: 900, hasTouch: false, isMobile: false, deviceScaleFactor: 1 });
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('.wind-layer-btn'), { timeout: 30000 });
await wait(1500);
const d = await page.evaluate(() => {
    const btn = document.querySelector('.wind-layer-btn');
    btn.scrollIntoView({ block: 'center' });
    const sel = document.querySelector('.wind-alt-select');
    const br = btn.getBoundingClientRect(), sr = sel.getBoundingClientRect();
    return { btnC: { x: Math.round(br.left + br.width / 2), y: Math.round(br.top + br.height / 2) },
             selC: { x: Math.round(sr.left + sr.width / 2), y: Math.round(sr.top + sr.height / 2) },
             labelVisible: getComputedStyle(btn.querySelector('.wind-layer-label')).display !== 'none',
             valeur: sel.value };
});
(d.labelVisible ? ok : ko)('bureau : libellé « Vent » visible');
await page.mouse.click(d.selC.x, d.selC.y);
await wait(400);
let p2 = await page.evaluate(() => document.querySelector('.wind-layer-btn').getAttribute('aria-pressed'));
(p2 === 'false' ? ok : ko)(`bureau : clic sur le sélecteur n'allume PAS la couche (${p2})`);
await page.mouse.click(d.btnC.x, d.btnC.y);
await wait(500);
p2 = await page.evaluate(() => document.querySelector('.wind-layer-btn').getAttribute('aria-pressed'));
(p2 === 'true' ? ok : ko)(`bureau : clic sur le bouton allume la couche (${p2})`);
(d.valeur ? ok : ko)(`sélecteur montre l'altitude courante (${d.valeur} ft)`);

(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));
server.close(); await browser.close();
console.log(failures === 0 ? 'TOUT OK' : `${failures} ÉCHEC(S)`);
process.exit(failures ? 1 : 0);
