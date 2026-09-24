// ATIS TÉLÉPHONE CLIQUABLE (demande pilote 24/09) : quand l'observation
// eAIP d'un ATIS publie un numéro (« TEL : 02 40 05 12 74 », 37 terrains),
// l'onglet Fréquences le rend en lien tel: — numéro ENTIER et cliquable
// même quand l'observation dépasse la troncature d'affichage (Carcassonne),
// sans duplication quand l'observation ne contient que le numéro (Nantes),
// et sans lien quand il n'y a pas de téléphone (Dax, Vannes sans ATIS).
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
await new Promise(r => server.listen(8666, r));
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

/** Ouvre la fiche d'un terrain et attend que le widget Fréquences soit
 *  rendu DE FAÇON STABLE (deux mesures de texte identiques à 1 s). */
async function openTerrain(icao) {
    await page.goto(`http://127.0.0.1:8666/index.html?icao=${icao}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
    let prev = '';
    for (let i = 0; i < 12; i++) {
        const cur = await page.evaluate(() => document.getElementById('frequencies-widget')?.innerText || '');
        if (cur && cur === prev) break;
        prev = cur;
        await new Promise(r => setTimeout(r, 1000));
    }
    return page.evaluate(() => {
        const w = document.getElementById('frequencies-widget');
        const links = [...w.querySelectorAll('a[href^="tel:"]')].map(a => ({
            href: a.getAttribute('href'),
            text: a.textContent.replace(/\s+/g, ' ').trim(),
            icon: !!a.querySelector('svg'),
            visible: !!a.offsetParent && a.getBoundingClientRect().width > 0,
            row: a.closest('div[title]')?.getAttribute('title') || '',
            // Span frère du lien (texte restant de l'observation) — PAS un
            // descendant du lien, qui contient le span du numéro.
            remSpan: [...(a.parentElement?.children || [])].find(el => el.tagName === 'SPAN')?.textContent.trim() || '',
        }));
        return { text: w.innerText, links };
    });
}

// LFRS — Nantes : rem = « TEL : 02 40 05 12 74 » (rien d'autre) → lien
// tel: avec icône, numéro affiché UNE SEULE FOIS (pas de duplication).
{
    const r = await openTerrain('LFRS');
    const l = r.links.find(x => x.href === 'tel:0240051274');
    (l ? ok : ko)('LFRS : lien tel:0240051274 présent');
    if (l) {
        (l.text === '02 40 05 12 74' ? ok : ko)(`LFRS : numéro affiché « ${l.text} »`);
        (l.icon ? ok : ko)('LFRS : icône téléphone (Lucide) rendue');
        (l.visible ? ok : ko)('LFRS : lien visible');
        ((r.text.match(/02 40 05 12 74/g) || []).length === 1 ? ok : ko)(`LFRS : numéro UNE seule fois dans l'onglet (${(r.text.match(/02 40 05 12 74/g) || []).length})`);
        (l.remSpan === '' ? ok : ko)(`LFRS : pas de texte dupliqué après le lien (« ${l.remSpan} »)`);
        (l.row === 'TEL : 02 40 05 12 74' ? ok : ko)('LFRS : info-bulle = observation officielle complète');
    }
    const atisBadge = r.text.includes('ATIS');
    (atisBadge ? ok : ko)('LFRS : badge ATIS affiché');
}

// LFMK — Carcassonne : observation de 97 caractères, le TEL arrive APRÈS
// la troncature (92) → le numéro doit pourtant être ENTIER et cliquable,
// le texte restant affiché sans le numéro.
{
    const r = await openTerrain('LFMK');
    const l = r.links.find(x => x.href === 'tel:468102356');
    (l ? ok : ko)('LFMK : lien tel:468102356 présent (TEL au-delà de la troncature)');
    if (l) {
        (l.text === '(0)4.68.10.23.56' ? ok : ko)(`LFMK : numéro entier affiché « ${l.text} »`);
        (l.visible ? ok : ko)('LFMK : lien visible');
        (l.remSpan === 'Diffusion des paramètres de DEP et ARR/DEP and ARR parameters broadcasting'
            ? ok : ko)(`LFMK : texte restant conservé « ${l.remSpan} »`);
        (!l.remSpan.includes('68.10') ? ok : ko)('LFMK : numéro non dupliqué dans le texte');
    }
}

// LFLC — Clermont : numéro en tête, texte restant LONG (> 92 caractères)
// → tronqué avec « … », numéro entier cliquable.
{
    const r = await openTerrain('LFLC');
    const l = r.links.find(x => x.href === 'tel:0473627438');
    (l ? ok : ko)('LFLC : lien tel:0473627438 présent');
    if (l) {
        (l.text === '04 73 62 74 38' ? ok : ko)(`LFLC : numéro entier affiché « ${l.text} »`);
        (l.remSpan.startsWith("Aéronefs d'État") && l.remSpan.endsWith('…') ? ok : ko)(`LFLC : texte restant tronqué « ${l.remSpan.slice(0, 40)}… »`);
    }
}

// LFBY — Dax (ATIS sans téléphone, rem « NIL ») et LFRV — Vannes (pas
// d'ATIS du tout, AFIS) : AUCUN lien tel: dans l'onglet Fréquences.
for (const icao of ['LFBY', 'LFRV']) {
    const r = await openTerrain(icao);
    (r.links.length === 0 ? ok : ko)(`${icao} : aucun lien tel: (${r.links.length})`);
    (r.text.toUpperCase().includes('ATIS') && icao === 'LFBY' ? ok(icao + ' : ATIS affiché sans lien') : null);
}

// Mobile 390 px : la ligne (lien + texte, flex-wrap) ne fait pas déborder
// le widget.
await page.setViewport({ width: 390, height: 800 });
{
    await page.goto('http://127.0.0.1:8666/index.html?icao=LFRS', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    const fit = await page.evaluate(() => {
        const c = document.getElementById('frequencies-widget');
        return { scrollW: c.scrollWidth, clientW: c.clientWidth, links: c.querySelectorAll('a[href^="tel:"]').length };
    });
    (fit.scrollW <= fit.clientW + 1 ? ok : ko)(`mobile 390 : sans débordement (${fit.scrollW} ≤ ${fit.clientW})`);
    (fit.links === 1 ? ok : ko)(`mobile 390 : lien ATIS conservé (${fit.links})`);
}

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
