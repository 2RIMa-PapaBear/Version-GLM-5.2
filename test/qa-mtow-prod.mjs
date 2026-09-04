// PREUVE : génère un PDF depuis la PROD réelle (papabear56.free.fr, assets
// servis tels quels — seuls les API météo/relais sont stubbées), récupère le
// PDF via la page d'aperçu (iframe data:), et mesure la position X du texte
// « MTOW … kg » du centrogramme avec pdfjs.
// Verdict : X proche du bord GAUCHE du graphe (~80) = correctif actif ;
// X proche du bord DROIT (~360) = ancienne position.
// Usage : node test/qa-mtow-prod.mjs
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/152.0.4191.62/msedge.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('aviationweather.gov') || u.includes('script.google') || u.includes('script.googleusercontent.com') || u.includes('corsproxy.io')) {
        const raw = u.includes('format=raw');
        req.respond({
            status: 200, contentType: raw ? 'text/plain' : 'application/json',
            headers: { 'Access-Control-Allow-Origin': '*' },
            body: raw ? 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021'
                      : JSON.stringify([{ icaoId: 'LFRV', rawOb: 'METAR LFRV 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021' }]),
        });
    } else req.continue();
});

await page.goto('http://papabear56.free.fr/index.html?icao=LFRV&mode=nav&dest=LFRC', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#fp-navlog-pdf', { timeout: 60000 });
await new Promise(r => setTimeout(r, 2000));

let pdfTab = null;
browser.on('targetcreated', async t => { try { const p = await t.page(); if (p) pdfTab = p; } catch { } });
await page.click('#fp-navlog-pdf');
await page.waitForSelector('#navlog-confirm-modal [data-ok]', { timeout: 10000 });
await new Promise(r => setTimeout(r, 300));
await page.click('#navlog-confirm-modal [data-ok]');

// Récupère le PDF depuis la page d'aperçu (iframe data:application/pdf;base64,…).
let b64 = null;
for (let i = 0; i < 40 && !b64; i++) {
    await new Promise(r => setTimeout(r, 500));
    try {
        if (!pdfTab) continue;
        b64 = await pdfTab.evaluate(() => document.querySelector('iframe[src^="data:application/pdf"]')?.getAttribute('src').split('base64,')[1] || null);
    } catch { /* pas prêt */ }
}
await browser.close();
if (!b64) { console.log('KO : PDF non récupéré'); process.exit(1); }
fs.writeFileSync(path.join(root, 'test', 'mtow-prod.pdf'), Buffer.from(b64, 'base64'));
console.log(`PDF récupéré depuis la prod : ${Math.round(b64.length * 3 / 4 / 1024)} Ko`);

// pdfjs (UMD vendor) : extraction texte avec coordonnées.
const _m = { exports: {} };
new Function('module', 'exports', 'require', fs.readFileSync(path.join(root, 'vendor', 'pdfjs-3.11.174.min.js'), 'utf8'))(_m, _m.exports, require);
const pdfjsLib = _m.exports;
const _w = { exports: {} };
new Function('module', 'exports', 'require', fs.readFileSync(path.join(root, 'vendor', 'pdfjs-worker-3.11.174.min.js'), 'utf8'))(_w, _w.exports, require);
globalThis.pdfjsWorker = _w.exports;

const doc = await pdfjsLib.getDocument({ data: new Uint8Array(Buffer.from(b64, 'base64')) }).promise;
let verdict = null;
for (let p = 1; p <= doc.numPages && !verdict; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    const has = tc.items.some(it => /CENTROGRAMME/i.test(it.str));
    if (!has) continue;
    const hits = tc.items
        .filter(it => /MTOW/i.test(it.str))
        .map(it => ({ txt: it.str.trim(), x: Math.round(it.transform[4]), y: Math.round(it.transform[5]) }));
    console.log(`Page ${p} (centrogramme), occurrences MTOW :`, JSON.stringify(hits));
    // L'ANNOTATION de la ligne rouge : celle dont Y est le plus HAUT (les
    // cellules/légende sont sous le graphe).
    const annot = hits.sort((a, b) => b.y - a.y)[0];
    verdict = annot;
}
if (!verdict) { console.log('KO : page centrogramme introuvable'); process.exit(1); }
// Géométrie : xL ≈ 78 (L+62), xR ≈ 362 (R−40).
const side = verdict.x < 160 ? 'GAUCHE du graphe (correctif actif)' : verdict.x > 280 ? 'DROITE du graphe (ANCIENNE position !)' : 'centre(?)';
console.log(`\nVERDICT : annotation « ${verdict.txt} » à x=${verdict.x}, y=${verdict.y} → ${side}`);
