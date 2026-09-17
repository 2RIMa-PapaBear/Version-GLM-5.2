// QA MINIMA VFR (chantier ④) : section présente dans le planificateur,
// lignes départ/arrivée, dégradation gracieuse sans météo (stubs), zéro
// erreur JS. Les cellules de zones sont servies localement (data/) : la
// détection contrôlé/non contrôlé est RÉELLE.
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
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
await page.setRequestInterception(true);
// Régression 17/09 : le METAR stubbé est un VRAI format français AUTO
// (visi 9999NDZ, nuages à suffixe, « = » final) — les verdicts doivent se
// CALCULER, pas afficher « météo indisponible ». Le TAF reste vide → repli
// METAR partout.
const METAR_FR = 'LFRV 171520Z AUTO 33008KT 9999NDZ SCT043 BKN049SC 17/08 Q1019=';
page.on('request', req => {
    const u = req.url();
    if (/aviationweather\.gov\/api\/data\/metar/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: METAR_FR });
    } else if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

await page.goto('http://127.0.0.1:8666/index.html?icao=LFRV&mode=nav&dest=LFRN', { waitUntil: 'domcontentloaded', timeout: 30000 });
// La section arrive avec le rendu du plan ; les LIGNES arrivent après la
// collecte async (météo stubée → les fetchs de repli brûlent ~15 s).
await page.waitForFunction(() => /Minima VFR/.test(document.body.textContent || ''), { timeout: 30000 });
await page.waitForFunction(() => /Départ/.test(document.getElementById('fp-minima-block')?.textContent || ''), { timeout: 40000 }).catch(() => {});
await wait(500);
const res = await page.evaluate(() => {
    const block = document.getElementById('fp-minima-block');
    const rows = [...(block?.querySelectorAll('.fp-minima-row') || [])].map(r => r.textContent.replace(/\s+/g, ' ').trim());
    const note = block?.querySelector('.fp-minima-note')?.textContent || '';
    return { present: !!block, rows, note: note.slice(0, 60) };
});
console.log('lignes :', JSON.stringify(res.rows, null, 1));
(res.present ? ok : ko)('section « Minima VFR » présente dans le planificateur');
(res.rows.some(r => /Départ/.test(r) && /LFRV/.test(r)) ? ok : ko)('ligne Départ LFRV');
(res.rows.some(r => /Arrivée/.test(r) && /LFRN/.test(r)) ? ok : ko)('ligne Arrivée LFRN');
(res.rows.some(r => /contrôlé|non contrôlé/.test(r)) ? ok : ko)('contexte d\'espace affiché (cellules locales réelles)');
(res.rows.some(r => /≥ 10 km/.test(r)) ? ok : ko)('visi du METAR français (9999NDZ) lue → « ≥ 10 km »');
(res.rows.every(r => /météo indisponible/.test(r)) ? ko : ok)('verdicts CALCULÉS (plus de « météo indisponible » systématique)');
(res.rows.some(r => /Conditions VFR OK/.test(r)) ? ok : ko)('verdict « Conditions VFR OK » rendu (formulation pilote 17/09)');
(/informatif/.test(res.note) ? ok : ko)('note « informatif — clairance à la discrétion du contrôleur »');
(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));
server.close(); await browser.close();
console.log(failures === 0 ? 'QA OK' : `QA KO (${failures})`);
process.exit(failures === 0 ? 0 : 1);
