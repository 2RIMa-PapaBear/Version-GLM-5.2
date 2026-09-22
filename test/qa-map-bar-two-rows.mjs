// QA BARRE CARTE RÉGIONALE SUR DEUX RANGÉES (17/09 ; ordre rangée 1 révisé
// 20/09) : rangée 1 couches (Espaces/Vent/TEMSI/Fronts/SIGMET puis Radar en
// FIN — son groupe horloge élastique absorbe l'espace restant), rangée 2
// fond & cadrage (Fond/Terrain/Vols).
// + COURSE D'INIT (20/09) : trois déclencheurs rapprochés de l'ouverture
// (toggle, ouverture nav, changement de terrain) arrivaient en concurrence
// pendant le chargement paresseux de Leaflet — « Map container is already
// initialized » et barre incomplète. La création est maintenant sérialisée
// (_ensureMapReady, promesse mémoïsée) : on rejoue la triple-course et on
// vérifie barre complète + zéro erreur.
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
await new Promise(r => server.listen(8657, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
page.on('console', msg => {
    const t = msg.text();
    if (/layer failed|error/i.test(t)) console.log('CONSOLE[' + msg.type() + '] ' + t.slice(0, 200));
});
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else if (retarderLeaflet && /vendor\/leaflet\.min\.js/.test(u)) {
        setTimeout(() => req.continue().catch(() => {}), 400);
    } else req.continue();
});
// Retard artificiel du JS Leaflet (course d'init, plus bas) — UN SEUL
// handler d'interception : deux handlers enchaînés lèvent « Request is
// already handled ».
let retarderLeaflet = false;
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

for (const [w, h] of [[1280, 900], [640, 900]]) {
    await page.setViewport({ width: w, height: h });
    await page.goto('http://127.0.0.1:8657/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('map-layers-bar'), { timeout: 30000 });
    await wait(2000);
    const res = await page.evaluate(() => {
        const bar = document.getElementById('map-layers-bar');
        const rows = [...bar.querySelectorAll(':scope > .map-layers-row')];
        const lbl = el => [...el.querySelectorAll('button, select')].map(b => (b.tagName === 'SELECT' ? 'select' : (b.textContent || '').trim() || b.title || b.className.split(' ')[0])).filter(Boolean);
        const barR = bar.getBoundingClientRect();
        const horsRanges = [...bar.children].filter(c => !c.classList.contains('map-layers-row'));
        const deborde = rows.some(r => { const rr = r.getBoundingClientRect(); return rr.right > barR.right + 1; }) || bar.scrollWidth > bar.clientWidth + 1;
        const cluster = document.querySelector('.gps-map-cluster');
        return {
            nRows: rows.length, horsRanges: horsRanges.length,
            r1: lbl(rows[0]), r2: lbl(rows[1] || {}),
            groupes: [...(rows[0]?.children || [])].map(g => ({
                t: ((g.querySelector('button, select')?.textContent || g.querySelector('button, select')?.title || '')).trim(),
                radar: !!g.querySelector('.precip-toggle-radar'),
            })),
            dir: getComputedStyle(bar).flexDirection, deborde,
            fitDansCluster: !!cluster?.querySelector('.map-fitplan-btn'),
            fsDansCluster: !!cluster?.querySelector('.map-fs-btn'),
        };
    });
    console.log(`--- ${w}px ---`, JSON.stringify(res));
    (res.nRows === 2 ? ok : ko)(`${w}px : barre sur 2 rangées (et rien hors rangées : ${res.horsRanges})`);
    (res.dir === 'column' ? ok : ko)(`${w}px : direction colonne`);
    (res.r1.some(t => /Radar/i.test(t)) && res.r1.some(t => /TEMSI/i.test(t)) && res.r1.some(t => /Espaces/i.test(t)) ? ok : ko)(`${w}px : rangée 1 = Radar · Espaces · Vent · TEMSI`);
    {
        const g = res.groupes.map(x => x.t);
        const iEsp = g.findIndex(t => /Espaces/i.test(t));
        const iFro = g.findIndex(t => /Fronts/i.test(t));
        const iSig = g.findIndex(t => /SIGMET/i.test(t));
        const iRadar = res.groupes.findIndex(x => x.radar);
        // Dernier groupe à BOUTON = radar (après lui, seul le groupe horloge
        // — slider sans bouton — est autorisé).
        const dernierRadar = iRadar !== -1 && res.groupes.slice(iRadar + 1).every(x => x.t === '');
        (iEsp === 0 && iFro > iEsp && iSig > iFro && dernierRadar
            ? ok : ko)(`${w}px : ordre rangée 1 = Espaces … Fronts · SIGMET · Radar (FIN) — ${JSON.stringify(g)}`);
    }
    (res.r2.some(t => /Terrain/i.test(t)) && res.r2.some(t => /Vols/i.test(t)) ? ok : ko)(`${w}px : rangée 2 = Fond · Terrain · Vols`);
    (res.fitDansCluster && res.fsDansCluster ? ok : ko)(`${w}px : Cadrer plan + Plein cadre promus dans le paquet flottant`);
    (!res.deborde ? ok : ko)(`${w}px : aucun débordement horizontal`);
}

// COURSE D'INIT (20/09) : on élargit la fenêtre de chargement paresseux de
// Leaflet (retard artificiel du JS vendor), puis on déclenche TROIS
// ouvertures concurrentes via le vrai module — avant le fix, la 2e/3e
// levaient « Map container is already initialized » et la barre restait
// incomplète (seul le radar était monté).
retarderLeaflet = true;
const errAvantCourse = pageErrors.length;
await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
await page.evaluate(async () => {
    const m = await import('./js/regional-map.js');
    m.openRegionalMap();
    m.showRegionalMapFor('LFRV', true);
    m.showRegionalMapFor('LFRV', true);
});
await page.waitForFunction(() => document.querySelector('.gps-map-cluster'), { timeout: 30000 });
await wait(1500);
{
    const res = await page.evaluate(() => {
        const bar = document.getElementById('map-layers-bar');
        const r1 = bar?.querySelector('.map-layers-row-top');
        const txt = r1 ? r1.textContent : '';
        return {
            bar: !!bar, cluster: !!document.querySelector('.gps-map-cluster'),
            gpsBtn: !!document.getElementById('gps-toggle-btn'),
            groupes: [...(r1?.children || [])].map(c => c.className.split(' ')[0]).join(','),
            complet: /Espaces/i.test(txt) && /Vent/i.test(txt) && /TEMSI/i.test(txt)
                && /Fronts/i.test(txt) && /SIGMET/i.test(txt) && /Radar/i.test(txt),
        };
    });
    (res.bar && res.complet ? ok : ko)(`course d'init : barre complète après 3 déclencheurs concurrents [${res.groupes}]`);
    (res.cluster && res.gpsBtn ? ok : ko)(`course d'init : paquet GPS monté (prevol:map-ready émis)`);
    const nouvelles = pageErrors.slice(errAvantCourse);
    (nouvelles.length === 0 ? ok : ko)(`course d'init : zéro nouvelle erreur JS${nouvelles.length ? ' — ' + nouvelles[0] : ''}`);
}

// Cadrer plan (dans le cluster) répond bien au clic.
const fit = await page.evaluate(() => {
    const btn = document.querySelector('.gps-map-cluster .map-fitplan-btn');
    if (!btn) return { err: 'bouton Cadrer introuvable' };
    btn.click();
    return { err: null };
});
await wait(600);
(!fit.err ? ok : ko)('bouton « Cadrer plan » (cluster) cliquable');
(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));
server.close(); await browser.close();
console.log(failures === 0 ? 'CHECK OK' : `CHECK KO (${failures})`);
process.exit(failures === 0 ? 0 : 1);
