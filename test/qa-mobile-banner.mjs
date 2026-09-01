// QA mobile du bandeau « NUIT AÉRONAUTIQUE — VFR DE JOUR INTERDIT » :
// vraie émulation 390 px via puppeteer-core + Edge local.
// Vérifie : AVANT (nowrap) la carte déborde ; APRÈS (correctif) elle tient.
// Usage : node test/qa-mobile-banner.mjs
import puppeteer from 'puppeteer-core';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

// Mini-serveur statique (le harnais a besoin de http : modules/CSS).
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const ext = path.extname(p);
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime });
        res.end(d);
    });
});
await new Promise(r => server.listen(8643, r));

const browser = await puppeteer.launch({
    executablePath: EDGE,
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:8643/test/fw-preview.html', { waitUntil: 'domcontentloaded' });
await new Promise(r => setTimeout(r, 800));

const m = await page.evaluate(() => {
    const cards = document.querySelectorAll('.card');
    const one = (i) => {
        const c = cards[i];
        const lab = c.querySelector('div > div');
        return {
            overflow: c.scrollWidth > c.clientWidth,
            cardW: Math.round(c.clientWidth),
            labScrollW: lab.scrollWidth,
            labelLines: Math.round(lab.getBoundingClientRect().height) > 20 ? '2 lignes' : '1 ligne',
        };
    };
    return { avant: one(0), apres: one(1), pageScrollW: document.scrollingElement.scrollWidth, innerW: window.innerWidth };
});

let failures = 0;
console.log(`Viewport réel : ${m.innerW}px (page scrollW=${m.pageScrollW})`);
if (m.innerW !== 390) { console.log('KO  viewport ≠ 390 — émulation cassée'); failures++; }
console.log(`AVANT  : carte ${m.avant.cardW}px, libellé ${m.avant.labScrollW}px (${m.avant.labelLines}) → ${m.avant.overflow ? 'DÉBORDE (attendu, ancien bug)' : 'ne déborde pas (inattendu)'}`);
if (!m.avant.overflow) { console.log('KO  l’ancien nowrap ne déborde plus ?! reproduction invalide'); failures++; }
console.log(`APRÈS  : carte ${m.apres.cardW}px, libellé ${m.apres.labScrollW}px (${m.apres.labelLines}) → ${m.apres.overflow ? 'DÉBORDE' : 'tient dans le cadre'}`);
if (m.apres.overflow) { console.log('KO  le correctif déborde encore'); failures++; }
if (m.pageScrollW > m.innerW) {
    const off = await page.evaluate(() => {
        const out = [];
        document.querySelectorAll('body *').forEach(el => {
            const r = el.getBoundingClientRect();
            if (r.right > window.innerWidth + 1 && r.width > 0) {
                out.push((el.id ? '#' + el.id : '') + '.' + (typeof el.className === 'string' ? el.className.split(' ')[0] : '') + ' ' + el.tagName + ' right=' + Math.round(r.right));
            }
        });
        return out;
    });
    console.log('note (harnais) : page déborde de ' + (m.pageScrollW - m.innerW) + 'px → ' + off.join(' | '));
}

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
