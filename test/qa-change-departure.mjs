// QA du changement de départ depuis la carte (retours pilote 12/09) : avec un
// plan multi-étapes LFRV → LFRQ → LFRC, « Définir comme départ » sur la
// pastille LFRD doit repartir à zéro — ancien départ LFRV et waypoints
// supprimés de la CARTE (polyline, étiquettes) ET de la fenêtre « Calcul de
// navigation » (champ Waypoints, liste d'étapes), destination conservée.
// Usage : node test/qa-change-departure.mjs
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
await new Promise(r => server.listen(8661, r));

// Décodage de l'URL cible, quelle que soit l'enveloppe (worker ?url=, ancien
// relais Apps Script, corsproxy, appel direct aviationweather.gov).
const target = (u) => {
    try {
        const dec = decodeURIComponent(u);
        const m = dec.match(/url=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : dec;
    } catch { return u; }
};

const metarFor = (code) => `METAR ${code} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021`;

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = target(req.url());
    if (u.includes('meteo-relais') || u.includes('script.google') || u.includes('corsproxy.io') || u.includes('aviationweather.gov')) {
        const headers = { 'Access-Control-Allow-Origin': '*' };
        if (u.includes('stationinfo') && u.includes('bbox=')) {
            const bb = u.match(/bbox=(-?[\d.]+),(-?[\d.]+),(-?[\d.]+),(-?[\d.]+)/) || [];
            const [s, w, n, e] = bb.slice(1).map(Number);
            const stations = [];
            let i = 0;
            for (let lat = Math.ceil(s); lat <= Math.floor(n); lat += 1) {
                for (let lon = Math.ceil(w); lon <= Math.floor(e); lon += 1) {
                    stations.push({ icaoId: `LF${Math.floor(i / 10)}${i % 10}`, site: `Mock ${i}`, lat: lat + 0.5, lon: lon + 0.5 });
                    i++;
                }
            }
            req.respond({ status: 200, contentType: 'application/json', headers, body: JSON.stringify(stations.slice(0, 150)) });
        } else if (u.includes('stationinfo') && u.includes('ids=')) {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        } else if (u.includes('/metar') || u.includes('/taf')) {
            const isTaf = u.includes('/taf');
            const ids = (u.match(/ids=([A-Z0-9,]+)/)?.[1] || '').split(',').filter(Boolean);
            const body = isTaf
                ? JSON.stringify(ids.map(c => ({ icaoId: c, rawTaf: `TAF ${c} 041100Z 0412/0512 27008KT 9999 FEW035=` })))
                : JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: metarFor(c) })));
            req.respond({ status: 200, contentType: 'application/json', headers, body });
        } else {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        }
    } else req.continue();
});

// Watchdog global : la QA ne doit pas suspendre la CI.
setTimeout(() => { console.log('KO  watchdog 180 s — QA interrompue'); process.exit(1); }, 180000);

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

// Empreinte de la route sur la carte : polyline bleue + étiquettes PERMANENTES
// (vert départ / rouge arrivée / ambre waypoints — les pastilles voisines ne
// sont que survolées, elles n'entrent pas dans ces comptes).
const routeInfo = () => page.evaluate(() => {
    const map = window.__regionalMap;
    if (!map) return null;
    const out = { poly: null, permLabels: [], depLabel: null, arrLabel: null };
    const strip = h => String(h).replace(/<[^>]+>/g, '').trim();
    map.eachLayer(l => {
        if (l.getLatLngs && l.options && l.options.color === '#38BDF8' && !out.poly) {
            out.poly = l.getLatLngs().flat().map(p => [p.lat, p.lng]);
        }
        const tt = (l.getTooltip && l.getTooltip()) || null;
        if (tt && tt.options && tt.options.permanent) {
            const c = strip(tt.getContent());
            out.permLabels.push(c);
            if ((tt.options.className || '').includes('route-dep-label')) out.depLabel = c;
            if ((tt.options.className || '').includes('route-arr-label')) out.arrLabel = c;
        }
    });
    return out;
});
const distDeg = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Position écran d'une pastille (pour le clic souris réel sur le pin-hit).
const pinScreenPos = (code) => page.evaluate((c) => {
    let found = null;
    window.__regionalMap.eachLayer(l => {
        if (found || !l.getTooltip || !l.getLatLng) return;
        const tt = l.getTooltip();
        if (!tt) return;
        const th = typeof tt.getContent() === 'string' ? tt.getContent() : '';
        if (!th.startsWith(`<strong>${c}<`) && !th.startsWith(`<strong>${c}*<`)) return;
        if (th.includes('Terrain courant') || th.includes('Current airport')) return;
        found = { lat: l.getLatLng().lat, lon: l.getLatLng().lng };
    });
    if (!found) return null;
    const map = window.__regionalMap;
    const pt = map.latLngToContainerPoint([found.lat, found.lon]);
    const r = document.getElementById('regional-map').getBoundingClientRect();
    return { x: Math.round(r.left + pt.x), y: Math.round(r.top + pt.y), top: Math.round(r.top), lat: found.lat, lon: found.lon };
}, code);

await page.goto('http://127.0.0.1:8661/index.html?icao=LFRV&mode=nav&dest=LFRC', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });

// 1) Waypoint intermédiaire LFRQ par le chemin officiel (popup « + Waypoint »
//    / clic droit pastille → event add-waypoint → insertion intelligente).
await page.waitForFunction(() => !!document.getElementById('fp-waypoints'), { timeout: 60000 });
await page.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFRQ' } })));
await page.waitForFunction(() => {
    const ri = (() => {
        const map = window.__regionalMap; if (!map) return null;
        let poly = null;
        map.eachLayer(l => {
            if (!poly && l.getLatLngs && l.options && l.options.color === '#38BDF8') poly = l.getLatLngs().flat().length;
        });
        return poly;
    })();
    return ri === 3;
}, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1200));

const before = await routeInfo();
(before.poly && before.poly.length === 3) ? ok(`plan initial 3 étapes tracées (polyline ${before.poly.length} points)`) : ko(`polyline initiale inattendue (${before.poly?.length} points)`);
before.depLabel === 'LFRV' ? ok('étiquette verte initiale = LFRV (départ)') : ko(`étiquette verte initiale = ${before.depLabel}`);
before.arrLabel === 'LFRC' ? ok('étiquette rouge = LFRC (destination)') : ko(`étiquette rouge = ${before.arrLabel}`);
before.permLabels.includes('LFRQ') ? ok('waypoint LFRQ étiqueté sur la route') : ko('waypoint LFRQ absent des étiquettes');
const oldDepPos = before.poly[0];
const wpBefore = await page.evaluate(() => document.getElementById('fp-waypoints')?.value || '');
wpBefore.toUpperCase() === 'LFRQ' ? ok(`champ Waypoints = « ${wpBefore} »`) : ko(`champ Waypoints = « ${wpBefore} »`);

// 2) Geste réel du pilote : clic sur la pastille LFRD (Dinard, dans la fenêtre
//    du plan) → popup → « Définir comme départ ».
await page.waitForFunction(() => {
    let has = false;
    window.__regionalMap?.eachLayer(l => {
        if (has || !l.getTooltip) return;
        const tt = l.getTooltip(); if (!tt) return;
        const th = typeof tt.getContent() === 'string' ? tt.getContent() : '';
        if (th.startsWith('<strong>LFRD<') || th.startsWith('<strong>LFRD*<')) has = true;
    });
    return has;
}, { timeout: 60000 });

await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 500));
const pin = await pinScreenPos('LFRD');
if (!pin || pin.top < 0 || pin.top > 800) { console.log('KO  pastille LFRD introuvable/hors fenêtre'); process.exit(1); }
// Coordonnées géo de la pastille capturées MAINTENANT : après le changement
// de départ, LFRD devient le « Terrain courant » (pastille différente).
const pinLL = [pin.lat, pin.lon];
await page.mouse.click(pin.x, pin.y);
await page.waitForSelector('.metar-popup .mp-dep-btn', { timeout: 10000, visible: true });
await page.click('.metar-popup .mp-dep-btn');
ok('clic pastille LFRD → popup → « Définir comme départ »');

// 3) APRÈS : le plan repart à zéro — polyline directe LFRD → LFRC, plus
// AUCUNE étiquette de l'ancien départ ni des anciens waypoints, fenêtre
// vidée. (Attente non fatale : sur code bogué, la route ne redémarre pas
// du nouveau départ — les vérifications émettent alors leurs KO.)
try {
    await page.waitForFunction(() => {
        const map = window.__regionalMap; if (!map) return false;
        let first = null, n = 0;
        map.eachLayer(l => {
            if (l.getLatLngs && l.options && l.options.color === '#38BDF8' && first === null) {
                const pts = l.getLatLngs().flat();
                n = pts.length; first = [pts[0].lat, pts[0].lng];
            }
        });
        return n === 2 && first && Math.hypot(first[0] - 48.6, first[1] - (-2.08)) < 0.35;
    }, { timeout: 20000 });
} catch { console.log('…  la polyline ne redémarre pas de LFRD (20 s) — vérifications quand même'); }
await new Promise(r => setTimeout(r, 1500));

const after = await routeInfo();
(after.poly?.length === 2) ? ok('route directe redessinée (2 sommets, plan repris à zéro)') : ko(`polyline après = ${after.poly?.length ?? 0} sommets (waypoints non purgés du tracé)`);
(after.poly && pinLL && distDeg(after.poly[0], pinLL) < 0.35) ? ok('la polyline part bien du NOUVEAU départ LFRD') : ko(`1er sommet ${JSON.stringify(after.poly?.[0])} ≠ pastille LFRD ${JSON.stringify(pinLL)}`);
after.depLabel === 'LFRD' ? ok('étiquette verte = LFRD (nouveau départ)') : ko(`étiquette verte = ${after.depLabel}`);
after.arrLabel === 'LFRC' ? ok('destination conservée : étiquette rouge = LFRC') : ko(`étiquette rouge = ${after.arrLabel}`);
!after.permLabels.includes('LFRQ') ? ok('ancien waypoint LFRQ supprimé de la carte') : ko('waypoint LFRQ encore tracé sur la carte');
!after.permLabels.includes('LFRV') ? ok('ancien départ LFRV n\u2019est plus étiqueté sur la route') : ko('ancien départ LFRV encore étiqueté (route)');
const nearOld = (after.poly || []).filter(p => distDeg(p, oldDepPos) < 0.3).length;
nearOld === 0 ? ok('ancien départ LFRV n\u2019est plus un sommet du tracé') : ko(`${nearOld} sommet(s) de la polyline encore sur l\u2019ancien départ LFRV`);

// Fenêtre « Calcul de navigation » : waypoints purgés eux aussi.
const nav = await page.evaluate(() => ({
    icaoInput: (document.getElementById('icaoInput')?.value || '').trim().toUpperCase(),
    fromDisplay: (document.getElementById('route-from-display')?.textContent || '').trim().toUpperCase(),
    fpHead: (document.querySelector('#flight-planner-panel .fp-route')?.textContent || '').replace(/\s+/g, ' ').trim(),
    wp: (document.getElementById('fp-waypoints')?.value || '').trim().toUpperCase(),
    wpRows: document.querySelectorAll('#fp-waypoint-list .fp-wp-row').length,
}));
nav.icaoInput === 'LFRD' ? ok('champ terrain = LFRD') : ko(`champ terrain = ${nav.icaoInput}`);
nav.fromDisplay === 'LFRD' ? ok('barre Départ→Destination affiche LFRD') : ko(`barre départ = ${nav.fromDisplay}`);
nav.fpHead.includes('LFRD') && nav.fpHead.includes('LFRC') ? ok(`en-tête du plan = « ${nav.fpHead} »`) : ko(`en-tête du plan = « ${nav.fpHead} »`);
nav.wp === '' ? ok('fenêtre Calcul de navigation : champ Waypoints VIDÉ') : ko(`champ Waypoints = « ${nav.wp} » (non purgé)`);
nav.wpRows === 0 ? ok('fenêtre Calcul de navigation : liste d\u2019étapes vidée') : ko(`${nav.wpRows} étape(s) encore listée(s)`);

await browser.close();
server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
