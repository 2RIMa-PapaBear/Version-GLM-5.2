// ALLER-RETOUR / MULTI-ÉTAPES (retour pilote 25/09) : « vol LFRV-LFEQ le
// tracé est OK même avec des points ; en rajoutant une 2ᵉ étape pour
// revenir (vers LFRV ou vers LFOO), ce tracé n'apparaissait pas ». Causes
// corrigées : destination = départ rejetée partout (app.js validDest +
// gardes planner), changement de destination PURGEANT les étapes (exception
// boucle), couloir météo limité à la ligne directe. Vérifié ici : tracé
// complet de la boucle, planificateur vivant, étapes ajoutables (terrain,
// et extrémités refusées comme étapes), anneau d'arrivée, purge conservée
// vers une AUTRE destination.
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
await new Promise(r => server.listen(8675, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
const pageErrors = [];
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://127.0.0.1:8675/index.html?icao=LFRV&mode=nav&dest=LFEQ', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('fp-waypoints') && document.querySelectorAll('.pin-hit').length > 3, { timeout: 30000 });
await page.evaluate(() => document.getElementById('regional-map')?.scrollIntoView({ block: 'center' }));
await new Promise(r => setTimeout(r, 1500));

const etat = (tag) => page.evaluate((t) => {
    const paths = [...document.querySelectorAll('#regional-map path')];
    const route = paths.find(p => (p.getAttribute('stroke') || '').toUpperCase() === '#38BDF8' && /8,\s*6|8,6/.test(p.getAttribute('stroke-dasharray') || ''));
    const d = route?.getAttribute('d') || null;
    // Anneau d'arrivée (aller-retour) : cercle rouge r=15 (~30 px) très transparent.
    const ring = paths.find(p => (p.getAttribute('fill') || '').toUpperCase() === '#EF4444'
        && Math.abs(p.getBoundingClientRect().width - 30) <= 3);
    return { tag: t, pts: d ? (d.match(/[ML]/g) || []).length : 0,
        wp: document.getElementById('fp-waypoints')?.value || '',
        dest: (document.getElementById('route-to-input')?.value || '').trim().toUpperCase(),
        plannerVisible: document.getElementById('flight-planner-panel')?.style.display === 'block',
        ring: !!ring,
        labels: [...document.querySelectorAll('#regional-map .free-wp-label, #regional-map .route-dep-label, #regional-map .route-arr-label')].map(e => e.textContent.replace(/[×✕]/g, '').trim()).slice(0, 8) };
}, tag);

// ① Aller simple LFRV→LFEQ : tracé direct (référence).
console.log(JSON.stringify(await etat('aller')));
(await etat('aller')).pts === 2 ? console.log('OK  aller simple tracé (2 pts)') : console.log('KO  aller simple');

// ② 2ᵉ étape LFOO dans le champ Waypoints (cas « même si cette étape serait
// LFOO ») : 3 points dessinés.
await page.evaluate(() => { const wp = document.getElementById('fp-waypoints'); wp.value = 'LFOO'; wp.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 2500));
let e2 = await etat('étape LFOO');
e2.pts === 3 ? console.log('OK  étape LFOO : tracé 3 points') : console.log('KO  étape LFOO : ' + JSON.stringify(e2));

// ③ ALLER-RETOUR : destination ← LFRV. Les étapes doivent être CONSERVÉES
// (exception boucle) et la route dessinée en entier : LFRV→LFOO→LFEQ→LFRV.
await page.evaluate(() => { const t = document.getElementById('route-to-input'); t.value = 'LFRV'; t.dispatchEvent(new Event('input', { bubbles: true })); });
await new Promise(r => setTimeout(r, 5500));
let e3 = await etat('boucle');
e3.pts === 3 ? console.log('OK  aller-retour : tracé complet 3 points (étape conservée)') : console.log('KO  aller-retour : ' + JSON.stringify(e3));
e3.plannerVisible ? console.log('OK  planificateur visible en boucle') : console.log('KO  planificateur masqué en boucle');
e3.ring ? console.log('OK  arrivée en anneau autour du départ') : console.log('KO  anneau d arrivée absent');

// ④ Ajout d'une étape sur le retour (LFRN) : 5 points.
await page.evaluate(() => { const wp = document.getElementById('fp-waypoints'); wp.value = (wp.value.trim() + ' LFRN').trim(); wp.dispatchEvent(new Event('change')); });
await new Promise(r => setTimeout(r, 4500));
let e4 = await etat('+LFRN');
e4.pts === 4 ? console.log('OK  étape ajoutée sur la boucle : 4 points') : console.log('KO  ajout étape : ' + JSON.stringify(e4));

// ⑤ Les extrémités (départ/arrivée) ne peuvent pas devenir des étapes.
const avantWp = (await etat('av5')).wp;
await page.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFRV' } })));
await new Promise(r => setTimeout(r, 800));
let e5 = await etat('addLFRV');
e5.wp === avantWp ? console.log('OK  le départ/arrivée refusé comme étape intermédiaire') : console.log('KO  LFRV ajouté en étape : ' + JSON.stringify(e5.wp));

// ⑥ Vers une AUTRE destination : la purge des étapes est conservée
// (arbitrage 12/09) — la route repart en direct.
await page.evaluate(() => { const t = document.getElementById('route-to-input'); t.value = 'LFRD'; t.dispatchEvent(new Event('input', { bubbles: true })); });
await new Promise(r => setTimeout(r, 3000));
let e6 = await etat('autre dest');
e6.pts === 2 && !e6.wp ? console.log('OK  autre destination : purge des étapes conservée (direct)') : console.log('KO  autre destination : ' + JSON.stringify(e6));

// ⑦ LE CAS PILOTE EXACT : champ « 2ᵉ ÉTAPE (OACI) » du planificateur —
// « je fais LFRV-LFEQ OK et j'ajoute LFRV dans cette case : le tracé
// LFEQ-LFRV n'apparaissait pas ». La saisie doit transformer le plan
// (LFEQ devient étape, LFRV devient destination) et tout tracer.
await page.evaluate(() => { const t = document.getElementById('route-to-input'); t.value = 'LFEQ'; t.dispatchEvent(new Event('input', { bubbles: true })); });
await new Promise(r => setTimeout(r, 5500));
await page.evaluate(() => {
    document.getElementById('regional-map')?.scrollIntoView({ block: 'center' });
    const el = document.querySelector('#fp-leg2-icao');
    if (el) { el.value = 'LFRV'; el.dispatchEvent(new Event('change', { bubbles: true })); }
});
await new Promise(r => setTimeout(r, 6500));
let e7 = await etat('leg2');
e7.dest === 'LFRV' ? console.log('OK  champ 2ᵉ étape : LFRV devient la destination') : console.log('KO  destination non transformée : ' + JSON.stringify(e7));
/LFEQ/.test(e7.wp) ? console.log('OK  LFEQ conservée comme étape intermédiaire') : console.log('KO  LFEQ perdue : ' + JSON.stringify(e7.wp));
e7.pts >= 3 ? console.log('OK  tracé LFEQ→LFRV dessiné sur la carte (' + e7.pts + ' points)') : console.log('KO  tracé 2ᵉ étape absent : ' + JSON.stringify(e7));
// ⑧ MINIMA VFR : l'étape où l'on se pose (LFEQ) doit y figurer comme
// vraie posée (départ/arrivée), entre le départ et l'arrivée.
await new Promise(r => setTimeout(r, 3500));
// ⑧ bis CARBURANT : une posée = un cycle sol complet (intégration +
// roulage arrivée, puis roulage au nouveau départ) → forfait 30 min avec
// une étape posée (15 min par vol/tronçon).
const ground = await page.evaluate(() => {
    const el = [...document.querySelectorAll('#flight-planner-panel .fp-label')].find(e => /Roulage \+ intégr|Taxi \+ integ/.test(e.textContent));
    return el ? el.textContent.trim() : '';
});
/\(30min\)/.test(ground) ? console.log('OK  carburant sol : 30 min avec une posée (cycle complet par vol)') : console.log('KO  forfait sol : ' + JSON.stringify(ground));
const minima = await page.evaluate(() => document.querySelector('#fp-minima-block')?.innerText || '');
/Étape \(posée\)[\s\S]*LFEQ/.test(minima) ? console.log('OK  minima VFR : étape LFEQ (posée) évaluée') : console.log('KO  étape absente des minima : ' + JSON.stringify(minima.slice(0, 220)));
/Départ[\s\S]*Arrivée/.test(minima) ? console.log('OK  minima VFR : ordre Départ → Étape → Arrivée') : console.log('KO  ordre minima : ' + JSON.stringify(minima.slice(0, 220)));
const absorbe = await page.evaluate(() => {
    const b = document.querySelector('#fp-leg2-block')?.innerText || '';
    return { integree: /Intégrée au plan/.test(b), requis: /Requis \(étapes intégrées, avec vent\)/.test(b) || /Requis/.test(b) };
});
absorbe.integree ? console.log('OK  bloc 2ᵉ étape : accusé « intégrée au plan »') : console.log('KO  pas d accusé d intégration');
absorbe.requis ? console.log('OK  bloc 2ᵉ étape : carburant conservé (requis avec vent vs embarqué)') : console.log('KO  carburant disparu du bloc');
// ⑨ BOUCLE SANS ÉTAPE puis ajout de points (retour pilote 25/09 : « le tracé
// entre les points ne se fait pas ») : page VIERGE, destination = départ dès
// le chargement → le planificateur est masqué avant tout rendu (aucun champ
// Waypoints). Chaque ajout (« + Waypoint », point perso créé, point VFR)
// doit construire la séquence et tracer la boucle.
{
    const p2 = await browser.newPage();
    p2.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
    await p2.setRequestInterception(true);
    p2.on('request', req => {
        const u = req.url();
        if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) req.respond({ status: 200, contentType: 'text/plain', body: ' ' });
        else req.continue();
    });
    await p2.setViewport({ width: 1280, height: 900 });
    await p2.goto('http://127.0.0.1:8675/index.html?icao=LFRV&mode=nav&dest=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await p2.waitForFunction(() => document.querySelectorAll('.pin-hit').length > 3, { timeout: 30000 });
    await p2.evaluate(() => document.getElementById('regional-map')?.scrollIntoView({ block: 'center' }));
    await new Promise(r => setTimeout(r, 2500));
    const champAvant = await p2.evaluate(() => !!document.getElementById('fp-waypoints'));
    !champAvant ? console.log('OK  boucle sans étape : panneau masqué, pas de champ Waypoints') : console.log('KO  champ déjà présent');
    // Ajout d'un point (même événement que « + Waypoint » pastille / création
    // d un repère perso / point VFR).
    await p2.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFRN' } })));
    await new Promise(r => setTimeout(r, 6000));
    const b9 = await p2.evaluate(() => {
        const paths = [...document.querySelectorAll('#regional-map path')];
        const route = paths.find(p => (p.getAttribute('stroke') || '').toUpperCase() === '#38BDF8' && /8,\s*6|8,6/.test(p.getAttribute('stroke-dasharray') || ''));
        const d = route?.getAttribute('d') || null;
        return { pts: d ? (d.match(/[ML]/g) || []).length : 0,
            wp: document.getElementById('fp-waypoints')?.value || '(absent)',
            planner: document.getElementById('flight-planner-panel')?.style.display === 'block' };
    });
    b9.pts === 3 ? console.log('OK  ajout sur boucle vierge : tracé LFRV→LFRN→LFRV (3 points)') : console.log('KO  tracé boucle vierge : ' + JSON.stringify(b9));
    b9.planner ? console.log('OK  planificateur apparu avec l étape') : console.log('KO  planificateur toujours masqué');
    // Un deuxième point s ajoute aussi.
    await p2.evaluate(() => document.dispatchEvent(new CustomEvent('add-waypoint', { detail: { icao: 'LFOO' } })));
    await new Promise(r => setTimeout(r, 6000));
    const c9 = await p2.evaluate(() => {
        const paths = [...document.querySelectorAll('#regional-map path')];
        const route = paths.find(p => (p.getAttribute('stroke') || '').toUpperCase() === '#38BDF8' && /8,\s*6|8,6/.test(p.getAttribute('stroke-dasharray') || ''));
        const d = route?.getAttribute('d') || null;
        return { pts: d ? (d.match(/[ML]/g) || []).length : 0, wp: document.getElementById('fp-waypoints')?.value || '' };
    });
    c9.pts === 4 ? console.log('OK  2ᵉ point ajouté : boucle à 4 points (' + c9.wp + ')') : console.log('KO  2ᵉ point : ' + JSON.stringify(c9));
    // Bouton « Imprimer le dossier de vol » ACTIF sur la boucle (retour
    // pilote 25/09 : inactif malgré les tuiles au vert — 8ᵉ verreur
    // destination≠départ, dans flight-file.js).
    await new Promise(r => setTimeout(r, 2500));
    const ff = await p2.evaluate(() => {
        const b = document.getElementById('ff-print');
        return { present: !!b, disabled: b ? b.disabled : null };
    });
    ff.present && ff.disabled === false ? console.log('OK  bouton « Imprimer le dossier de vol » ACTIF sur la boucle') : console.log('KO  bouton dossier : ' + JSON.stringify(ff));
    // ⑨ bis (règle pilote 25/09) : les points ajoutés par ailleurs
    // (aérodromes « + Waypoint », repères perso, points VFR) restent des
    // points TOURNANTS/de passage SANS ARRÊT — seules les étapes nées du
    // champ « 2ᵉ ÉTAPE » sont des posées. Ici LFRN et LFOO ont été ajoutés
    // par add-waypoint : AUCUNE posée, forfait sol inchangé (15 min).
    const etatPoses = () => p2.evaluate(() => {
        const el = [...document.querySelectorAll('#flight-planner-panel .fp-label')].find(e => /Roulage \+ intégr|Taxi \+ integ/.test(e.textContent));
        const minima = document.querySelector('#fp-minima-block')?.innerText || '';
        return { ground: el ? el.textContent.trim() : '', nEtapes: (minima.match(/Étape \(posée\)/g) || []).length,
            wp: document.getElementById('fp-waypoints')?.value || '' };
    });
    let eP = await etatPoses();
    /\(15min\)/.test(eP.ground) ? console.log('OK  passages sans arrêt : forfait sol 15 min (aucune posée)') : console.log('KO  forfait sol : ' + JSON.stringify(eP.ground));
    eP.nEtapes === 0 ? console.log('OK  passages sans arrêt : aucune « Étape (posée) » dans les minima') : console.log('KO  posées inattendues : ' + eP.nEtapes);
    // Un repère PERSO sur la même boucle : point de passage lui aussi.
    await p2.evaluate(() => {
        const cont = document.getElementById('regional-map');
        const r = cont.getBoundingClientRect();
        let x = 0, y = 0;
        for (const [fx, fy] of [[0.15, 0.75], [0.2, 0.35], [0.5, 0.68], [0.3, 0.45]]) {
            const px = r.left + r.width * fx, py = r.top + r.height * fy;
            if (!document.elementFromPoint(px, py)?.closest?.('.leaflet-control')) { x = px; y = py; break; }
        }
        if (!x) { x = r.left + r.width * 0.15; y = r.top + r.height * 0.75; }
        cont.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: x, clientY: y }));
    });
    await new Promise(r => setTimeout(r, 900));
    const edOk = await p2.evaluate(() => { const i = document.querySelector('.fw-name-input'); if (i) { i.value = 'PHARE DU BILL'; document.querySelector('.fw-ok-btn')?.click(); return true; } return false; });
    if (!edOk) { console.log('KO  éditeur repère perso introuvable'); }
    else {
        await new Promise(r => setTimeout(r, 6500));
        const b9b = await p2.evaluate(() => {
            const paths = [...document.querySelectorAll('#regional-map path')];
            const route = paths.find(p => (p.getAttribute('stroke') || '').toUpperCase() === '#38BDF8' && /8,\s*6|8,6/.test(p.getAttribute('stroke-dasharray') || ''));
            const d = route?.getAttribute('d') || null;
            const el = [...document.querySelectorAll('#flight-planner-panel .fp-label')].find(e => /Roulage \+ intégr|Taxi \+ integ/.test(e.textContent));
            const minima = document.querySelector('#fp-minima-block')?.innerText || '';
            return { pts: d ? (d.match(/[ML]/g) || []).length : 0, wp: document.getElementById('fp-waypoints')?.value || '',
                ground: el ? el.textContent.trim() : '', nEtapes: (minima.match(/Étape \(posée\)/g) || []).length,
                persoDansMinima: /PHARE/.test(minima) };
        });
        /PHARE/.test(b9b.wp) && b9b.pts === 5 ? console.log('OK  repère perso ajouté : boucle à 5 points (' + b9b.wp + ')') : console.log('KO  perso : ' + JSON.stringify(b9b));
        /\(15min\)/.test(b9b.ground) ? console.log('OK  perso = passage : forfait sol toujours 15 min') : console.log('KO  forfait sol : ' + JSON.stringify(b9b.ground));
        b9b.nEtapes === 0 && !b9b.persoDansMinima ? console.log('OK  perso absent des minima (simple passage)') : console.log('KO  minima : ' + JSON.stringify({ n: b9b.nEtapes, perso: b9b.persoDansMinima }));
    }
    // ⑨ ter « Inverser » (retour pilote 25/09) : le bouton du titre
    // « Détail des waypoints » retourne COMPLÈTEMENT les points de passage.
    const avantInv = await p2.evaluate(() => document.getElementById('fp-waypoints')?.value || '');
    const clicInv = await p2.evaluate(() => {
        const b = document.querySelector('#flight-planner-panel label .fp-invert-btn');   // bouton de la LIGNE Waypoints
        if (!b) return false;
        b.click();
        return true;
    });
    if (!clicInv) { console.log('KO  bouton Inverser (ligne Waypoints) introuvable'); }
    else {
        await new Promise(r => setTimeout(r, 6000));
        const apresInv = await p2.evaluate(() => {
            const paths = [...document.querySelectorAll('#regional-map path')];
            const route = paths.find(p => (p.getAttribute('stroke') || '').toUpperCase() === '#38BDF8' && /8,\s*6|8,6/.test(p.getAttribute('stroke-dasharray') || ''));
            const d = route?.getAttribute('d') || null;
            return { wp: document.getElementById('fp-waypoints')?.value || '', pts: d ? (d.match(/[ML]/g) || []).length : 0 };
        });
        const attendu = [...avantInv.trim().split(/\s+/)].reverse().join(' ');
        apresInv.wp === attendu ? console.log('OK  Inverser (ligne Waypoints) : ordre complètement retourné (' + apresInv.wp + ')') : console.log('KO  Inverser : ' + JSON.stringify({ avant: avantInv, apres: apresInv.wp }));
        apresInv.pts === 5 ? console.log('OK  Inverser : tracé toujours 5 points (sens retourné)') : console.log('KO  Inverser tracé : ' + apresInv.pts);
        // Le bouton du TITRE « Détail des waypoints » inverse en retour.
        const clicInv2 = await p2.evaluate(() => {
            const b = document.querySelector('#flight-planner-panel .fp-section-title .fp-invert-btn');
            if (!b) return false;
            b.click();
            return true;
        });
        if (!clicInv2) { console.log('KO  bouton Inverser (titre Détail) introuvable'); }
        else {
            await new Promise(r => setTimeout(r, 6000));
            const apresInv2 = await p2.evaluate(() => document.getElementById('fp-waypoints')?.value || '');
            apresInv2 === avantInv.trim() ? console.log('OK  Inverser (titre Détail) : retour à l ordre initial') : console.log('KO  2e inversé : ' + JSON.stringify({ attendu: avantInv, apres: apresInv2 }));
        }
    }
{
    const caps = await p2.evaluate(() => {
        const gs = [...document.querySelectorAll('#flight-planner-panel .fp-grid-line')];
        const mesure = (g) => {
            const tops = [...g.querySelectorAll(':scope > .fp-cell')].map(c => Math.round(c.getBoundingClientRect().top));
            return { n: tops.length, uneLigne: tops.length >= 2 && tops.every(t => Math.abs(t - tops[0]) <= 2) };
        };
        return { n: gs.length, caps: gs[0] ? mesure(gs[0]) : null, vent: gs[1] ? mesure(gs[1]) : null };
    });
    caps.caps && caps.caps.n === 4 && caps.caps.uneLigne ? console.log('OK  Distance / Cap vrai / Cap magnétique / Déclinaison sur UNE ligne') : console.log('KO  grille caps : ' + JSON.stringify(caps));
    // Sans vent en QA (réseau intercepté) : GS + Temps seuls ; en réel,
    // Vent / Dérive / GS / Temps — une seule ligne dans les deux cas.
    caps.vent && caps.vent.n >= 2 && caps.vent.uneLigne ? console.log('OK  Vent / Dérive / Vitesse sol / Temps de vol sur UNE ligne (' + caps.vent.n + ' cadres, vent simulé absent)') : console.log('KO  grille vent : ' + JSON.stringify(caps));
}
    await p2.close();
}

// ⑩ Grille caps sur UNE ligne (retour pilote 25/09) : les 4 cadres
// (Distance / Cap vrai / Cap magnétique / Déclinaison) au même niveau.
(pageErrors.length === 0 ? console.log('OK  zéro erreur JS') : console.log('KO  ERREURS JS : ' + pageErrors.join(' ; ')));
await browser.close(); server.close();
