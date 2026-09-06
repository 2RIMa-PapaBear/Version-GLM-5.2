// REPÈRE LIBRE → PLAN DE VOL (bug 06/09 : da0feda1 avait remplacé
// marker.bindPopup par hit.bindPopup dans _createFreeWaypoint — ReferenceError
// AVANT l'enregistrement du repère et le dispatch add-waypoint : le point
// apparaissait sur la carte mais ne pouvait jamais rejoindre le plan, sans
// popup pour l'ajouter à la main). Flux vérifié : clic droit sur la carte →
// éditeur de nom → Valider → repère créé ET ajouté au champ Waypoints.
// Le contextmenu de la carte est déclenché par un événement DOM synthétique
// sur le conteneur Leaflet (pattern qa-pin-rightclick : les événements
// synthétiques = exactement ce que le navigateur livre aux handlers).
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
await new Promise(r => server.listen(8653, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.setRequestInterception(true);
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://127.0.0.1:8653/index.html?icao=LFRV&mode=nav&dest=LFRN', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('fp-waypoints'), { timeout: 30000 });
await page.waitForFunction(() => document.querySelectorAll('.pin-hit').length > 5, { timeout: 30000 });
// La carte régionale doit être visible AVANT les interactions souris.
await page.evaluate(() => document.getElementById('regional-map')?.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 800));

// ① Clic droit sur la carte, sur un point SANS aérodrome et HORS ROUTE (au
// sud-ouest = océan sur le cadrage LFRV→LFRN — sinon le marqueur de waypoint
// de la route se dessine PAR-DESSUS le repère et intercepte les clics) →
// l'ÉDITEUR de waypoint s'ouvre (pas d'ajout direct).
const editeur = await page.evaluate(() => {
    const cont = document.getElementById('regional-map');
    if (!cont) return { err: 'conteneur carte absent' };
    const r = cont.getBoundingClientRect();
    const x = r.left + r.width * 0.15, y = r.top + r.height * 0.75;
    cont.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    return new Promise(res => setTimeout(() => res({ err: null, input: !!document.querySelector('.fw-name-input') }), 1200));
});
(!editeur.err && editeur.input ? ok : ko)(editeur.err || 'clic droit carte : éditeur de waypoint ouvert');

// ② Nom du repère + Valider → repère créé ET ajouté au champ Waypoints.
const creation = await page.evaluate(() => {
    const inp = document.querySelector('.fw-name-input');
    if (!inp) return { err: 'pas d éditeur' };
    inp.value = 'QA PT LIBRE';
    document.querySelector('.fw-ok-btn')?.click();
    return new Promise(res => setTimeout(() => res({
        err: null,
        wp: document.getElementById('fp-waypoints')?.value || '',
        label: [...document.querySelectorAll('.free-wp-label')].map(e => e.textContent).join('|'),
    }), 1500));
});
if (creation.err) ko(creation.err);
else {
    console.log('waypoints :', JSON.stringify(creation.wp), '· repères :', JSON.stringify(creation.label));
    (/ZZ[A-Z]{2}/.test(creation.wp) ? ok : ko)('Valider : repère ZZ** AJOUTÉ au champ Waypoints');
    (/QA PT LIBRE/.test(creation.label) ? ok : ko)('marqueur ambre + étiquette posés sur la carte');
}

// ③ Clic sur le marqueur ambre (le path SVG du circleMarker — l'étiquette
// n'est pas interactive) : popup d'édition (Renommer / + Plan / Supprimer).
// Clic SOURIS PHYSIQUE aux coordonnées du cercle : Leaflet résout ses
// couches interactives depuis les événements réels du conteneur.
const cible = await page.evaluate(() => {
    const inp = document.querySelector('.fw-name-input');
    if (inp) return { err: 'éditeur encore ouvert' };
    const paths = [...document.querySelectorAll('#regional-map path')];
    // Le repère libre = cercle de rayon 7 (≈14 px de large) au fill ambre —
    // le waypoint de route ambre (r=5) se dessine CONCENTRIQUE par-dessus
    // (le repère ajouté au plan est sur la route) : on cherche un point de
    // la couronne (5 < d < 7) où le repère est bien la cible du clic.
    const ambre = paths.find(p => (p.getAttribute('fill') || '').toUpperCase() === '#FBBF24'
        && Math.abs(p.getBoundingClientRect().width - 14) <= 2.5);
    if (!ambre) return { err: 'path du repère introuvable' };
    const r = ambre.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    let pt = null;
    for (let a = 0; a < 16 && !pt; a++) {
        const x = cx + 6 * Math.cos(a * Math.PI / 8), y = cy + 6 * Math.sin(a * Math.PI / 8);
        if (document.elementFromPoint(x, y) === ambre) pt = { x, y };
    }
    if (!pt) pt = { x: cx + 6, y: cy };
    return { err: null, x: pt.x, y: pt.y, w: r.width };
});
if (cible.err) ko(cible.err);
else {
    // Clic (synthétique, pattern pastilles) sur le HIT DOM du repère : le
    // div .pin-hit 16×16 centré sur le cercle ambre porte le popup.
    const popup = await page.evaluate((x, y) => {
        const hits = [...document.querySelectorAll('#regional-map .pin-hit')];
        const hitDiv = hits.find(d => { const r = d.getBoundingClientRect(); return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom; });
        if (!hitDiv) return { err: 'hit du repère introuvable', n: hits.length };
        hitDiv.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
        return new Promise(res => setTimeout(() => {
            const p = document.querySelector('#regional-map .leaflet-popup');   // le bindPopup ne pose pas .free-wp-popup
            res({ err: null, ouvert: !!p, texte: p?.innerText?.slice(0, 60) || '', boutons: p ? [...p.querySelectorAll('button')].map(b => b.textContent.trim()) : [] });
        }, 900));
    }, cible.x, cible.y);
    if (popup.err) ko(popup.err + (popup.n != null ? ` (${popup.n} hits)` : ''));
    else {
        console.log('popup repère :', JSON.stringify(popup.boutons));
        (popup.ouvert ? ok : ko)('clic sur le repère : popup ouvert');
        (popup.boutons.some(b => /Renommer|Rename/i.test(b)) ? ok : ko)('popup : bouton Renommer');
        (popup.boutons.some(b => /Supprimer|Delete/i.test(b)) ? ok : ko)('popup : bouton Supprimer');
        // « + Plan » n'apparaît QUE si le repère n'est pas déjà au plan —
        // ici il VIENT d'y être ajouté : le bouton doit être absent.
        (popup.boutons.some(b => /\+\s*Plan/i.test(b)) ? ko : ok)('popup : pas de « + Plan » (repère déjà dans le plan)');
    }

    // ④ Raccourci CLIC DROIT sur le repère (comme les pastilles) : retiré du
    // plan, un clic droit le RAJOUTE au champ Waypoints. La position du
    // repère est RE-localisée après le recalcul (le vidage du champ recadre
    // la route → l'écran a bougé).
    const apresDroit = await page.evaluate(() => {
        document.querySelector('#regional-map .leaflet-popup-close-button')?.click();
        const wp = document.getElementById('fp-waypoints');
        if (wp) { wp.value = ''; wp.dispatchEvent(new Event('change')); }
        return new Promise(res => setTimeout(() => {
            // Re-localise le cercle ambre r=7 (le repère) PUIS son hit.
            const paths = [...document.querySelectorAll('#regional-map path')];
            const ambre = paths.find(p => (p.getAttribute('fill') || '').toUpperCase() === '#FBBF24'
                && Math.abs(p.getBoundingClientRect().width - 14) <= 2.5);
            if (!ambre) return res({ wp: '', err: 'repère disparu' });
            const r = ambre.getBoundingClientRect();
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            const hits = [...document.querySelectorAll('#regional-map .pin-hit')];
            const hitDiv = hits.find(d => { const hr = d.getBoundingClientRect(); return x >= hr.left && x <= hr.right && y >= hr.top && y <= hr.bottom; });
            if (!hitDiv) return res({ wp: '', err: `hit introuvable (${hits.length} hits)` });
            hitDiv.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
            setTimeout(() => res({ wp: document.getElementById('fp-waypoints')?.value || '', editeur: !!document.querySelector('.fw-name-input') }), 1000);
        }, 600));
    });
    console.log('après clic droit (repère retiré du plan) :', JSON.stringify(apresDroit));
    (/ZZ[A-Z]{2}/.test(apresDroit.wp) ? ok : ko)('clic droit sur le repère : re-ajouté au plan' + (apresDroit.err ? ` — ${apresDroit.err}` : ''));
}

// ④ Aucune erreur JavaScript pendant tout le flux (le bug historique était un
// ReferenceError silencieux sur `hit`).
(pageErrors.length === 0 ? ok : ko)(pageErrors.length === 0 ? 'aucune erreur JS (fix `hit` vérifié)' : 'ERREURS JS : ' + pageErrors.join(' ; '));

await browser.close(); server.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
