// Pastilles sans METAR propre : SUBSTITUTION par la station émettrice la
// plus proche (retour pilote 11/09) — étiquette identique (code* + catégorie
// colorée), popup avec provenance, et terrain utilisable comme départ/arrivée.
// Stations mock : une par cellule d'1°, codes LF+digits (jamais attribués en
// France réelle) → AUCUN terrain local ne possède son METAR : tous substitués.
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
await new Promise(r => server.listen(8660, r));

// Décodé de l'URL cible, quelle que soit l'enveloppe (worker ?url=, ancien
// relais Apps Script, corsproxy, ou appel direct aviationweather.gov).
const target = (u) => {
    try {
        const dec = decodeURIComponent(u);
        const m = dec.match(/url=([^&]+)/);
        return m ? decodeURIComponent(m[1]) : dec;
    } catch { return u; }
};

// METAR d'une station mock : catégorie VFR ou MVFR selon la parité du code.
const metarFor = (code) => {
    const n = parseInt(code.slice(2), 10);
    return (n % 2 === 0)
        ? `METAR ${code} 041200Z AUTO 27008KT 9999 FEW035 18/12 Q1021`
        : `METAR ${code} 041200Z AUTO 24012KT 6000 BKN030 16/11 Q1018`;
};

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
            // Recherche d'un terrain précis : l'API ne connaît AUCUN de nos
            // codes → repli sur airports.json puis station la plus proche.
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        } else if (u.includes('/metar') || u.includes('/taf')) {
            const isTaf = u.includes('/taf');
            const ids = (u.match(/ids=([A-Z0-9,]+)/)?.[1] || '').split(',').filter(Boolean);
            const body = isTaf
                ? JSON.stringify(ids.map(c => ({ icaoId: c, rawTaf: `TAF ${c} 041100Z 0412/0512 27008KT 9999 FEW035 PROB30 TEMPO 0418/0422 4000 BKN012=` })))
                : JSON.stringify(ids.map(c => ({ icaoId: c, rawOb: metarFor(c) })));
            req.respond({ status: 200, contentType: 'application/json', headers, body });
        } else {
            req.respond({ status: 200, contentType: 'application/json', headers, body: '[]' });
        }
    } else req.continue();
});

await page.goto('http://127.0.0.1:8660/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
// Pastilles voisines rendues (chargement initial : IDB + stationinfo + metar).
await page.waitForFunction(() => {
    const map = window.__regionalMap;
    if (!map) return false;
    let n = 0;
    map.eachLayer(l => { if (l.getTooltip && l.getTooltip()) n++; });
    return n >= 20;
}, { timeout: 60000 });
await new Promise(r => setTimeout(r, 1500));

// Tous les tooltips + popups des pastilles (sans les ouvrir — contenu lié),
// avec la position pour viser le clic aux coordonnées écran réelles.
const pins = await page.evaluate(() => {
    const out = [];
    window.__regionalMap.eachLayer(l => {
        const tt = (l.getTooltip && l.getTooltip()) || null;
        if (!tt) return;
        const th = typeof tt.getContent() === 'string' ? tt.getContent() : '';
        if (!/^<strong>[A-Z][A-Z0-9]{3}/.test(th)) return;   // pastilles aérodromes uniquement
        if (th.includes('Terrain courant') || th.includes('Current airport')) return;   // terrain courant : pas une pastille météo
        const pop = (l.getPopup && l.getPopup()) ? l.getPopup().getContent() : '';
        const popStr = typeof pop === 'string' ? pop : '';
        const m = th.match(/^<strong>([A-Z0-9]{4})(\*?)<\/strong>/);
        const cat = th.match(/font-weight:700;">(VFR|MVFR|IFR|LIFR|Sans METAR|No METAR)</);
        const ll = (l.getLatLng && l.getLatLng()) || {};
        // Substitution détectée par le POPUP (l'étiquette ne porte plus l'étoile).
        out.push({ code: m[1], sub: popStr.includes('Météo de') || popStr.includes('Weather from'), cat: cat ? cat[1] : null, tooltip: th, popup: popStr, lat: ll.lat, lon: ll.lng });
    });
    return out;
});

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

console.log(`Pastilles aérodromes : ${pins.length} (substituées * : ${pins.filter(p => p.sub).length})`);
pins.length >= 20 ? ok('pastilles voisines présentes') : ko(`${pins.length} pastilles seulement`);
pins.filter(p => p.sub).length >= 15 ? ok('nombreuses pastilles substituées (terrains sans METAR propre)') : ko('substitution absente');
// Pastille/étiquette COMME AVANT (retour pilote 11/09, 2e passe) : un terrain
// sans METAR propre reste gris « Sans METAR » — seule sa POPUP est enrichie.
pins.filter(p => p.sub).every(p => p.cat === 'Sans METAR' || p.cat === 'No METAR')
    ? ok('étiquette substituée = « Sans METAR » (comportement antérieur conservé)') : ko(`${pins.filter(p => p.sub && p.cat !== 'Sans METAR' && p.cat !== 'No METAR').length} étiquette(s) substituée(s) colorée(s)`);
pins.filter(p => p.sub).every(p => !p.tooltip.includes('*')) ? ok('aucune étoile dans les étiquettes') : ko('étoile présente dans une étiquette');
const subPins = pins.filter(p => p.sub && p.popup);
subPins.every(p => p.popup.includes('Météo de') && /NM/.test(p.popup) && /mp-load-btn/.test(p.popup) && /mp-dest-btn/.test(p.popup))
    ? ok('popup substitué : provenance (station · NM) + boutons départ/destination') : ko('popup substitué incomplet');
subPins.some(p => p.popup.includes('<pre class="mp-raw">')) ? ok('popup substitué : METAR brut affiché') : ko('METAR brut absent');

// Couleur des pastilles SVG : substituées = GRIS, terrain courant ambre
// (clés normalisées en minuscules — Leaflet garde la casse fournie).
const fills = await page.evaluate(() => {
    const counts = {};
    document.querySelectorAll('#regional-map path.leaflet-interactive').forEach(p => {
        const f = p.getAttribute('fill'); if (!f) return;
        const k = f.toLowerCase();
        counts[k] = (counts[k] || 0) + 1;
    });
    return counts;
});
console.log('Fills des pastilles :', JSON.stringify(fills));
(fills['#94a3b8'] || 0) >= 20 ? ok(`pastilles grises conservées (${fills['#94a3b8']})`) : ko('pastilles grises absentes');
(fills['#fbbf24'] || 0) === 1 ? ok('terrain courant ambre') : ko('pastille courante inattendue');

// Ouvre le popup d'une pastille par clic écran sur sa position (les pastilles
// superposées à z7 peuvent dévier le clic : on vérifie le code du bouton).
async function openPopupOf(code) {
    // La carte doit être visible dans le viewport pour des coordonnées écran valides.
    await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
    await new Promise(r => setTimeout(r, 300));
    for (const p of subPins) {
        if (p.code !== code && code) continue;
        const pt = await page.evaluate((lat, lon) => {
            const m = window.__regionalMap;
            const c = m.latLngToContainerPoint([lat, lon]);
            const r = document.getElementById('regional-map').getBoundingClientRect();
            return { x: r.left + c.x, y: r.top + c.y };
        }, p.lat, p.lon);
        if (pt.y < 0 || pt.y > 900) continue;   // hors viewport (carte repliée)
        await page.mouse.click(Math.round(pt.x), Math.round(pt.y));
        await new Promise(r => setTimeout(r, 600));
        const got = await page.evaluate(() => {
            const btn = document.querySelector('.leaflet-popup .mp-dest-btn');
            return btn ? btn.dataset.icao : null;
        });
        if (got === p.code) return p.code;
    }
    return null;
}

// --- Destination : clic réel sur « Définir comme destination » d un substitué.
const candidates = subPins.slice(0, 6);
let dest = null;
for (const c of candidates) { dest = await openPopupOf(c.code); if (dest) break; }
const destClicked = dest ? await page.evaluate((code) => {
    const btn = document.querySelector('.leaflet-popup .mp-dest-btn');
    if (!btn || btn.dataset.icao !== code) return false;
    btn.click();
    return true;
}, dest) : false;
await new Promise(r => setTimeout(r, 2500));
const destState = await page.evaluate(() => ({
    input: (document.getElementById('route-to-input')?.value || '').toUpperCase(),
    route: !!document.querySelector('#regional-map path[stroke="#38BDF8"]'),
    plan: (document.getElementById('flight-planner-panel')?.style.display || '') !== 'none',
}));
destClicked ? ok(`popup ouvert puis « Définir comme destination » cliqué (${dest})`) : ko('bouton destination introuvable');
destState.input === dest ? ok(`destination sans METAR acceptée (${dest})`) : ko(`destination = «${destState.input}» au lieu de ${dest}`);
destState.route ? ok('route tracée vers ce terrain') : ko('aucune route tracée');
destState.plan ? ok('plan de vol calculé') : ko('plan de vol absent');

// --- Départ : clic réel sur « Définir comme départ » d un autre substitué.
let dep = null;
for (const c of subPins.slice(6, 12)) { if (c.code !== dest) { dep = await openPopupOf(c.code); if (dep) break; } }
if (!dep && subPins[0]) dep = await openPopupOf(subPins[0].code);
const depClicked = dep ? await page.evaluate((code) => {
    const btn = document.querySelector('.leaflet-popup .mp-load-btn');
    if (!btn || btn.dataset.icao !== code) return false;
    btn.click();
    return true;
}, dep) : false;
await new Promise(r => setTimeout(r, 6000));
const depState = await page.evaluate(() => ({
    input: (document.getElementById('icaoInput')?.value || '').toUpperCase(),
    metar: (document.getElementById('tafInput')?.value || ''),
}));
depClicked ? ok(`« Définir comme départ » cliqué (${dep})`) : ko('bouton départ introuvable');
depState.input === dep ? ok(`départ sans METAR accepté (${dep}, code demandé conservé)`) : ko(`départ = «${depState.input}» au lieu de ${dep}`);
/^METAR|^SPECI|Q10/.test(depState.metar) ? ok('météo du départ = METAR de substitution affiché') : ko(`tafInput = «${depState.metar.slice(0, 80)}»`);

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
