// VISIONNEUSE VAC MULTI-CARTES (05/09) — test de bout en bout contre le
// VRAI relais Cloudflare (le SW de la PWA rend un stub non déterministe).
// Nantes (LFRS) publie 9 cartes VFR : aérodrome, 4 insertions, parking,
// 2 sol, environnement. On vérifie le bouton, le rendu, le sélecteur, la
// bascule d'une carte à l'autre, le badge, le hors ligne (navigateur
// OFFLINE → cache IndexedDB), le repli portail (LFOM) et l'Échap.
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
await new Promise(r => server.listen(8672, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
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

// La largeur du canvas est posée AVANT la fin du rendu pdfjs (asynchrone) :
// on attend un contenu réellement DESSINÉ (contraste), pas des dimensions.
const canvasDessine = () => {
    const c = document.querySelector('#vac-overlay canvas');
    if (!c || c.width < 50) return false;
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return max - min > 30;
};

// 1. LFRS (Nantes, 9 cartes VFR) : bouton, ouverture, rendu (relais réel).
await page.goto('http://127.0.0.1:8672/index.html?icao=LFRS', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
await page.waitForFunction(() => document.querySelector('[data-vac-open]'), { timeout: 30000 });
await new Promise(r => setTimeout(r, 500));
ok('bouton « Carte VAC officielle » présent (fiche eAIP)');
await page.click('[data-vac-open]');
await page.waitForFunction(canvasDessine, { timeout: 30000 });
const rendu = await page.evaluate(() => {
    const c = document.querySelector('#vac-overlay canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 400)).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return { w: c.width, h: c.height, contraste: max - min };
});
(rendu.contraste > 30 ? ok : ko)(`carte d'aérodrome rendue (${rendu.w}×${rendu.h}, contraste ${rendu.contraste})`);

// Badge d'état au premier chargement (réseau → « cache mis à jour »).
const badge1 = await page.evaluate(() => [...document.querySelectorAll('#vac-overlay span')].map(s => s.textContent).filter(t => /cache|hors ligne/i.test(t))[0] || '');
(/mis à jour|cache/i.test(badge1) ? ok : ko)(`badge cache affiché (« ${badge1.trim()} »)`);

// 2. Sélecteur multi-cartes : les 9 cartes VFR de Nantes, bon ordre.
const sel = await page.evaluate(() => {
    const s = document.querySelector('#vac-overlay [data-vac="select"]');
    return { n: s?.options.length, labels: [...(s?.options || [])].map(o => o.textContent), val: s?.value };
});
(sel.n === 9 ? ok : ko)(`sélecteur : 9 cartes VFR à LFRS (${sel.n})`);
(sel.labels[0]?.startsWith('Aérodrome') ? ok : ko)(`première carte = Aérodrome (${sel.labels[0]})`);
(sel.labels.filter(l => /^Insertion /.test(l)).length === 4 ? ok : ko)(`4 insertions listées (${sel.labels.filter(l => /^Insertion /.test(l)).length})`);
(sel.labels.some(l => /^Parking/.test(l)) && sel.labels.some(l => /^Circulation/.test(l)) && sel.labels.some(l => /^Environnement/.test(l)) ? ok : ko)(`parking/sol/environnement listés (${sel.labels.join(', ')})`);

// Bascule vers « Insertion 2 » : chargement + rendu d'une autre carte.
await page.select('#vac-overlay [data-vac="select"]', 'AD_2_LFRS_MIA_TEXT_02.pdf');
await page.waitForFunction(() => {
    const s = document.querySelector('#vac-overlay [data-vac="select"]');
    const c = document.querySelector('#vac-overlay canvas');
    return s?.value === 'AD_2_LFRS_MIA_TEXT_02.pdf' && c && c.width > 50;
}, { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));   // laisser le rendu pdfjs finir
const mia = await page.evaluate(() => {
    const c = document.querySelector('#vac-overlay canvas');
    const d = c.getContext('2d').getImageData(0, 0, c.width, Math.min(c.height, 300)).data;
    let min = 255, max = 0;
    for (let i = 0; i < d.length; i += 40) { if (d[i] < min) min = d[i]; if (d[i] > max) max = d[i]; }
    return { w: c.width, h: c.height, contraste: max - min };
});
(mia.contraste > 30 ? ok : ko)(`carte « Insertion 2 » rendue (${mia.w}×${mia.h}, contraste ${mia.contraste})`);

// 3. Fermeture Échap.
await page.keyboard.press('Escape');
await page.waitForFunction(() => !document.querySelector('#vac-overlay'), { timeout: 5000 });
ok('Échap ferme la visionneuse');

// 4. HORS LIGNE : navigateur offline → les cartes viennent du cache IDB.
await page.setOfflineMode(true);
await page.click('[data-vac-open]');
await page.waitForFunction(canvasDessine, { timeout: 30000 });
const off = await page.evaluate(() => ({
    badge: [...document.querySelectorAll('#vac-overlay span')].map(s => s.textContent).find(t => /hors ligne/i.test(t)) || '',
    w: document.querySelector('#vac-overlay canvas').width,
}));
(off.badge ? ok : ko)(`réouverture HORS LIGNE depuis le cache (« ${off.badge.trim()} », ${off.w}px)`);
await page.keyboard.press('Escape');
await page.setOfflineMode(false);

// 5. Terrain sans fiche eAIP (LFOM) : pas de bouton carte, lien portail.
await page.goto('http://127.0.0.1:8672/index.html?icao=LFOM', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
await new Promise(r => setTimeout(r, 800));
const repli = await page.evaluate(() => ({
    btn: !!document.querySelector('[data-vac-open]'),
    portail: !!document.querySelector('#frequencies-widget a[target="_blank"]'),
}));
(!repli.btn ? ok : ko)('LFOM sans fiche eAIP : pas de bouton carte');
(repli.portail ? ok : ko)('LFOM : lien portail eAIP conservé');

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
