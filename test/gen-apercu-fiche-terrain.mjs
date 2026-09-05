// APERÇU PDF de la fiche terrain (workflow « aperçu avant validation ») :
// rendu RÉEL du widget par la vraie app (3 terrains : LFRN demandé par le
// pilote, LFRV complet horaires+carburant, LFPF usage restreint), assemblés
// dans une page A4 → Apercu_fiche_terrain.pdf (ignoré par git). Aucune
// diffusion sans feu vert.
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
await new Promise(r => server.listen(8665, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });

// 1. Rendu réel du widget pour chaque terrain.
const SAMPLES = [
    ['LFRN', 'Rennes Saint-Jacques — terrain demandé (CAP)'],
    ['LFRV', 'Vannes Golfe du Morbihan — fiche complète (horaires + carburant)'],
    ['LFPF', 'Beynes Thiverval — statut usage restreint'],
];
const blocks = [];
const page = await browser.newPage();
page.on('pageerror', e => console.log('PAGEERROR:', e.message));
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
for (const [icao, note] of SAMPLES) {
    await page.goto(`http://127.0.0.1:8665/index.html?icao=${icao}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('frequencies-widget')?.style.display === 'block', { timeout: 60000 });
    await new Promise(r => setTimeout(r, 1200));
    const ext = await page.evaluate(() => {
        const w = document.getElementById('frequencies-widget');
        return { html: w.querySelector('.collapsible-body, #frequencies-widget > div')?.innerHTML || w.innerHTML, width: Math.round(w.getBoundingClientRect().width) };
    });
    blocks.push({ icao, note, html: ext.html, width: ext.width });
    console.log(`${icao} capturé (largeur ${ext.width}px)`);
}

// 2. Page A4 assemblée : le CSS réel de l'app + les widgets rendus.
const css = fs.readFileSync(path.join(root, 'css', 'style.css'), 'utf8');
const pdf = await browser.newPage();
await pdf.setContent(`<!doctype html><html><head><meta charset="utf-8"><style>
${css}
body { background:#020617; padding:26px 30px; margin:0; }
h2 { color:#F8FAFC; font-size:16px; margin:26px 0 4px; font-family:'DM Sans','Segoe UI',sans-serif; }
h2 small { color:#94A3B8; font-weight:400; font-size:12px; margin-left:10px; }
.card-demo { width:${Math.min(blocks[0].width, 720)}px; background:#0F172A; border:1px solid rgba(255,255,255,0.15); border-radius:12px; padding:16px; }
.titre { color:#38BDF8; font-family:'DM Sans','Segoe UI',sans-serif; font-size:20px; font-weight:700; margin:0 0 14px; }
</style></head><body>
<div class="titre">Proposition — fiche terrain, onglet « Fréquences &amp; info terrain » (aperçu avant diffusion)</div>
${blocks.map(b => `<h2>${b.icao}<small>${b.note}</small></h2><div class="card-demo">${b.html}</div>`).join('\n')}
</body></html>`, { waitUntil: 'domcontentloaded' });
await pdf.addScriptTag({ path: path.join(root, 'vendor', 'lucide.min.js') });
await pdf.evaluate(() => window.lucide?.createIcons());
await pdf.emulateMediaType('screen');
await pdf.pdf({ path: path.join(root, 'Apercu_fiche_terrain.pdf'), format: 'A4', printBackground: true, margin: { top: 10, bottom: 10, left: 10, right: 10 } });
console.log('Apercu_fiche_terrain.pdf généré');
await browser.close(); server.close();
