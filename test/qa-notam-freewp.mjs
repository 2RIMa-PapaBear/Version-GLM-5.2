// QA NOTAM × repères libres (retour pilote 12/09 « Erreur : SOFIA HTTP 400 ») :
// un plan contenant un code ZZxx (repère libre, clic droit carte) ne doit plus
// être envoyé tel quel à SOFIA — la route interrogée est nettoyée, le dossier
// s'affiche avec la mention du repère exclu, aucune erreur.
// Le POST /notam part vers le VRAI worker (meteo-relais) — seule la météo est
// mockée. Usage : node test/qa-notam-freewp.mjs
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
await new Promise(r => server.listen(8663, r));

const target = (u) => {
    try {
        const dec = decodeURIComponent(u);
        const m = dec.match(/url=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : dec;
    } catch { return u; }
};

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('requestfailed', req => { if (req.url().includes('notam')) console.log(`[FAILED ${req.method()}] ${req.url().slice(0, 90)} — ${req.failure()?.errorText}`); });
page.on('console', msg => { if (['error', 'warning'].includes(msg.type())) console.log(`[console.${msg.type()}] ${msg.text().slice(0, 140)}`); });
page.on('pageerror', err => console.log(`[pageerror] ${String(err).slice(0, 140)}`));
const notamPosts = [];
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (u.includes('workers.dev')) console.log(`[req ${req.method()}] ${u.slice(0, 80)}`);
    // POST /notam : laissé passer vers le VRAI worker (preuve réelle), body tracé.
    if (req.method() === 'POST' && /meteo-relais/.test(u) && u.includes('/notam')) {
        notamPosts.push({ url: u, body: req.postData() });
        req.continue();
        return;
    }
    // Preflight CORS du POST /notam : en-têtes complets (sans Allow-Methods,
    // le navigateur bloque le POST et le fetch échoue avant même de partir).
    if (req.method() === 'OPTIONS' && u.includes('/notam')) {
        req.respond({
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
                'Access-Control-Max-Age': '86400',
            },
        });
        return;
    }
    const t = target(u);
    if (t.includes('meteo-relais') || t.includes('script.google') || t.includes('corsproxy.io') || t.includes('aviationweather.gov')) {
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (t.includes('stationinfo') && t.includes('bbox=')) {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        } else if (t.includes('stationinfo') && t.includes('ids=')) {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        } else if (t.includes('/metar') || t.includes('/taf')) {
            const isTaf = t.includes('/taf');
            const ids = (t.match(/ids=([A-Z0-9,]+)/)?.[1] || '').split(',').filter(Boolean);
            const body = isTaf
                ? JSON.stringify(ids.map(c => ({ icaoId: c, rawTaf: `TAF ${c} 041100Z 0412/0512 27008KT 9999 FEW035=` })))
                : JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: `METAR ${c} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021` })));
            req.respond({ status: 200, contentType: 'application/json', headers, body });
        } else {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        }
    } else req.continue();
});

setTimeout(() => { console.log('KO  watchdog 120 s — QA interrompue'); process.exit(1); }, 120000);

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://127.0.0.1:8663/index.html?icao=LFRV&mode=nav&dest=LFRC', { waitUntil: 'domcontentloaded', timeout: 30000 });
// Panneau NOTAM monté + planificateur visible (offsetParent) → route lue depuis state.route.
await page.waitForFunction(() => {
    const fp = document.getElementById('flight-planner-panel');
    return document.getElementById('notam-search') && fp && fp.offsetParent !== null;
}, { timeout: 60000 });

// Plan AVEC repère libre : exactement l'état qui provoquait « SOFIA HTTP 400 ».
// (dispatch sur WINDOW, comme le vrai code flight-planner-ui/recalc ;
// config.local.js dévie le relay vers wrangler dev — on reforce le VRAI
// worker pour tester le chemin applicatif réel.)
await page.evaluate(async () => {
    const { state } = await import('/js/core.js');
    const { config } = await import('/js/config.js');
    config.NOTAM_RELAY_URL = 'https://meteo-relais.papabear56.workers.dev/notam';
    state.route = ['LFRV', 'ZZAB', 'LFRC'];
    window.dispatchEvent(new CustomEvent('route-changed'));
});
await new Promise(r => setTimeout(r, 400));
const dbg = await page.evaluate(async () => {
    const { state } = await import('/js/core.js');
    const fp = document.getElementById('flight-planner-panel');
    return { route: state.route, plannerVisible: !!(fp && fp.offsetParent !== null), display: fp?.style.display };
});
console.log('dbg:', JSON.stringify(dbg));

const summary = await page.evaluate(() => document.getElementById('notam-summary')?.textContent || '');
summary.includes('LFRV → LFRC') ? ok(`résumé sur la route interrogée : « ${summary.slice(0, 70)}… »`) : ko(`résumé inattendu : « ${summary} »`);
summary.includes('repère libre') ? ok('résumé mentionne le repère libre exclu') : ko('résumé sans mention du repère exclu');

// Demande du dossier : DOIT aboutir (sans le filtre, le vrai worker répond
// « SOFIA HTTP 400 » — c'est le bug du 12/09).
await page.evaluate(() => document.getElementById('notam-search')?.click());
await page.waitForFunction(() => {
    const r = document.getElementById('notam-results');
    return r && (r.textContent.includes('Erreur') || r.querySelector('.notam-ckb, details'));
}, { timeout: 45000 });

const resTxt = await page.evaluate(() => document.getElementById('notam-results')?.textContent || '');
!resTxt.includes('Erreur') && !resTxt.includes('Error') ? ok('dossier NOTAM rendu SANS erreur (vrai worker SOFIA)') : ko(`erreur affichée : « ${resTxt.slice(0, 120)} »`);
resTxt.includes('SOFIA-Briefing (SIA)') ? ok('en-tête du dossier présent') : ko('en-tête du dossier absent');
resTxt.includes('ZZAB') && resTxt.includes('inconnu de SOFIA') ? ok('mention « repère libre ZZAB non interrogé » affichée') : ko('mention du repère exclu absente du dossier');

// La requête réellement partie ne contenait PAS le ZZxx.
const mainPost = notamPosts[0];
if (mainPost) {
    const sent = JSON.parse(mainPost.body).route;
    JSON.stringify(sent) === JSON.stringify(['LFRV', 'LFRC'])
        ? ok(`requête partie : route ${JSON.stringify(sent)} (ZZAB écarté)`)
        : ko(`requête partie avec ${JSON.stringify(sent)}`);
} else ko('aucun POST /notam observé');

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
