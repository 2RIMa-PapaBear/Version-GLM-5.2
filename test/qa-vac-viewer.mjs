// VISIONNEUSE « ATERRISSAGE À VUE » (Atlas-VAC local, choix pilote 06/09 :
// seule carte retenue — les familles eAIP ADC/MIA/… sont retirées) : bouton
// de la fiche terrain, rendu pdfjs de la carte LOCALE data/vac-sia/, badge,
// pages (les VAC sont souvent bipages), hors ligne (navigateur OFFLINE →
// cache IndexedDB), LFOM A ENFIN sa carte (pas de fiche eAIP), repli
// portail pour l'étranger.
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
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.pdf': 'application/pdf' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8674, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', String(e).slice(0, 200)));
page.on('console', m => { if (m.type() === 'error') console.log('CONSOLE:', m.text().slice(0, 200)); });
await page.setViewport({ width: 1280, height: 900 });
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
const canvasDessine = () => {
    const c = document.querySelector('#vac-overlay canvas');
    if (!c || c.width < 50) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return max - min > 30;
};

async function ouvre(icao) {
    await page.goto(`http://127.0.0.1:8674/index.html?icao=${icao}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block' || document.getElementById('airfield-widget')?.style.display === 'block', { timeout: 30000 });
    await page.waitForFunction(() => {
        const b = document.querySelector('[data-vac-open]');
        const l = document.querySelector('#airfield-widget a[target="_blank"], #frequencies-widget a[target="_blank"]');
        return b || l;
    }, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 400));
}

// 1. LFRV : bouton + rendu de la VAC locale + badge + pages.
await ouvre('LFRV');
(await page.evaluate(() => !!document.querySelector('[data-vac-open]')) ? ok : ko)('LFRV : bouton « Carte VAC · Atterrissage à vue » présent');
await page.click('[data-vac-open]');
await page.waitForFunction(canvasDessine, { timeout: 30000 });
// Ajustement HAUTEUR (retour pilote 06/09) : toute la carte visible de haut
// en bas ; si elle est plus large que la fenêtre, scroll horizontal SANS
// coupure du bord gauche (le centrage flex rend la gauche inaccessible).
const fit = await page.evaluate(() => {
    const cont = document.querySelector('#vac-overlay [data-vac="container"]');
    const c = document.querySelector('#vac-overlay canvas');
    const contRect = cont.getBoundingClientRect(), cRect = c.getBoundingClientRect();
    return {
        pct: document.querySelector('#vac-overlay [data-vac="pct"]')?.textContent || '',
        contH: cont.clientHeight, scrollableH: cont.scrollHeight,
        contW: cont.clientWidth, scrollableW: cont.scrollWidth,
        canvasH: parseFloat(c.style.height), canvasW: parseFloat(c.style.width),
        left: cRect.left - contRect.left,
    };
});
(Math.abs(fit.canvasH - (fit.contH - 28)) <= 2
    ? ok : ko)(`ajusté à la HAUTEUR (carte ${Math.round(fit.canvasH)}px ≈ fenêtre ${fit.contH - 28}px)`);
(fit.pct === '100%' ? ok : ko)(`ouverture à 100 % (${fit.pct})`);
(fit.canvasH <= fit.contH ? ok : ko)(`toute la carte tient en hauteur (${Math.round(fit.canvasH)} ≤ ${fit.contH})`);
if (fit.canvasW > fit.contW) {
    (fit.scrollableW > fit.contW ? ok : ko)(`carte plus large → scroll horizontal (${Math.round(fit.canvasW)}px dans ${fit.contW}px)`);
    (fit.left >= -1 ? ok : ko)(`bord gauche accessible (left ${fit.left.toFixed(1)}px)`);
}
const etat = await page.evaluate(() => ({
    badge: [...document.querySelectorAll('#vac-overlay span')].map(s => s.textContent).find(t => /enregistrée|hors ligne/i.test(t)) || '',
    pages: document.querySelector('#vac-overlay [data-vac="pagelbl"]')?.textContent || '',
    w: document.querySelector('#vac-overlay canvas').width,
}));
(/enregistrée/.test(etat.badge) ? ok : ko)(`LFRV : VAC locale rendue, badge « ${etat.badge.trim()} » (${etat.w}px)`);
(/\d+\/\d+/.test(etat.pages) ? ok : ko)(`LFRV : pagination présente (${etat.pages})`);
if (/^[2-9]\//.test(etat.pages)) {
    await page.click('[data-vac="next"]');
    await new Promise(r => setTimeout(r, 1200));
    const p2 = await page.evaluate(() => document.querySelector('#vac-overlay [data-vac="pagelbl"]')?.textContent);
    (p2?.startsWith('2/') ? ok : ko)(`navigation page 2 OK (${p2})`);
}
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('#vac-overlay'), { timeout: 5000 });
ok('Échap ferme la visionneuse');

// 1bis. MOBILE (390px) : carte paysage plus large que la fenêtre → scroll
// horizontal, bord gauche accessible (le centrage flex coupe la gauche).
await page.setViewport({ width: 390, height: 844 });
await page.click('[data-vac-open]');
await page.waitForFunction(canvasDessine, { timeout: 30000 });
const mob = await page.evaluate(() => {
    const cont = document.querySelector('#vac-overlay [data-vac="container"]');
    const c = document.querySelector('#vac-overlay canvas');
    const contRect = cont.getBoundingClientRect(), cRect = c.getBoundingClientRect();
    return { contW: cont.clientWidth, scrollW: cont.scrollWidth, canvasW: parseFloat(c.style.width), canvasH: parseFloat(c.style.height), contH: cont.clientHeight, left: cRect.left - contRect.left };
});
(mob.canvasW > mob.contW && mob.scrollW > mob.contW
    ? ok : ko)(`mobile : carte ${Math.round(mob.canvasW)}px > fenêtre ${mob.contW}px, scroll horizontal (${mob.scrollW}px)`);
(mob.left >= -1 ? ok : ko)(`mobile : bord gauche accessible (left ${mob.left.toFixed(1)}px)`);
(mob.canvasH <= mob.contH ? ok : ko)(`mobile : tient en hauteur (${Math.round(mob.canvasH)} ≤ ${mob.contH})`);
await page.keyboard.press('Escape');
await page.setViewport({ width: 1280, height: 900 });

// 2. HORS LIGNE : navigateur offline → cache IndexedDB.
await page.setOfflineMode(true);
await page.click('[data-vac-open]');
await page.waitForFunction(canvasDessine, { timeout: 30000 });
const off = await page.evaluate(() => [...document.querySelectorAll('#vac-overlay span')].map(s => s.textContent).find(t => /hors ligne/i.test(t)) || '');
(off ? ok : ko)(`réouverture HORS LIGNE depuis le cache (« ${off.trim()} »)`);
await page.keyboard.press('Escape');
await page.setOfflineMode(false);

// 3. LFOM : ENFIN une carte (VAC publiée sans fiche eAIP).
await ouvre('LFOM');
(await page.evaluate(() => !!document.querySelector('[data-vac-open]')) ? ok : ko)('LFOM : bouton carte présent (VAC sans fiche eAIP)');

// 4. EGHH (étranger) : lien portail, pas de bouton.
await ouvre('EGHH');
const repli = await page.evaluate(() => ({
    btn: !!document.querySelector('[data-vac-open]'),
    portail: !!document.querySelector('#airfield-widget a[target="_blank"], #frequencies-widget a[target="_blank"]'),
}));
(!repli.btn ? ok : ko)('EGHH : pas de bouton carte');
(repli.portail ? ok : ko)('EGHH : lien portail conservé');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
