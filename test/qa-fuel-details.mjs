// QA DEVIS CARBURANT DÉTAILLÉ (17/09) : forfaits roulage+intégration au devis
// écran (ligne dédiée, total = trajet + forfaits + réserve + dégagement),
// réserve vol locale 10 min, plafond embarqué = carburant UTILISABLE.
// PIÈGE harnais : flotte pré-chargée AVEC centrage (sinon widget masqué) et
// dialogues dismissés — l alerte synchrone « CARBURANT INSUFFISANT » (0 L
// embarqué au chargement) FIGE un navigateur headless.
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
await new Promise(r => server.listen(8662, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const pageErrors = [];
page.on('dialog', d => d.dismiss());   // alerte « carburant insuffisant » au chargement (0 L embarqué)
page.on('pageerror', e => pageErrors.push(String(e).slice(0, 160)));
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const wait = ms => new Promise(r => setTimeout(r, ms));

// Flotte du profil : avion type WT9 AVEC centrage + 113 L utilisables (le
// widget Centrage se masque sans bloc wb).
await page.evaluateOnNewDocument(() => {
    const ac = {
        id: 'ac_qa_wt9', name: 'QA WT9', registration: '', type: 'WT9',
        groundRoll: 540, fiftyFt: 1148, safetyMargin: 15,
        cruiseSpeedKt: 100, fuelBurnLph: 18, usableFuelL: 113,
        xwindLimitKt: 25, reserveExtraMin: 5, ldgRoll: 246, ldgFifty: 863,
        wb: {
            units: { mass: 'kg', arm: 'm' },
            emptyMassKg: 354, emptyArmMm: 2641, mtowKg: 600, refMassKg: null,
            fuelDensity: 0.72,
            envelope: [[405, 2704], [405, 2704], [542.5, 2704], [600, 2748], [600, 2824], [465.3, 2824], [445, 2810], [405, 2713]],
            stations: [
                { name: 'Pilote', armMm: 3130, maxKg: 130, fuel: false },
                { name: 'Passager 1', armMm: 3130, maxKg: 130, fuel: false },
                { name: 'Bagages', armMm: 3795, maxKg: 40, fuel: false },
                { name: 'Carburant', armMm: 2580, maxKg: 119, fuel: true },
            ],
        },
    };
    localStorage.setItem('ac-fleet', JSON.stringify([ac]));
    localStorage.setItem('ac-active-id', 'ac_qa_wt9');
});

// ① NAV : devis avec « Roulage + intégr. » 15 min, total = trajet+forfait+réserve(+dégag.)
await page.goto('http://127.0.0.1:8662/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => [...document.querySelectorAll('.fp-section-title')].some(t => /Carburant|Fuel/.test(t.textContent)), { timeout: 30000 });
await wait(2500);
const lignes = await page.evaluate(() => {
    const sec = [...document.querySelectorAll('.fp-section')].find(s => /Carburant|Fuel/.test(s.querySelector('.fp-section-title')?.textContent || ''));
    return sec ? [...sec.querySelectorAll('.fp-cell')].map(c => c.textContent.trim().replace(/\s+/g, ' ')) : [];
});
console.log('devis :', JSON.stringify(lignes));
const groundCell = lignes.find(l => /Roulage|Taxi/i.test(l));
(groundCell ? ok : ko)('devis : ligne « Roulage + intégr. » présente');
(/15min/.test(groundCell || '') ? ok : ko)('devis : forfait 15 min affiché');
(/4\.5 L/.test(groundCell || '') ? ok : ko)('devis : 4,5 L à 18 L/h');
const num = l => parseFloat((l.match(/([\d.]+) L/) || [])[1]);
const trip = num(lignes.find(l => /Trajet|Trip/.test(l)) || '');
const res = num(lignes.find(l => /Réserve|Reserve/.test(l)) || '');
const div = lignes.find(l => /Dégagement|Alternate/.test(l)) ? num(lignes.find(l => /Dégagement|Alternate/.test(l))) : 0;
const tot = num(lignes.find(l => /Total/.test(l)) || '');
(Math.abs(tot - (trip + 4.5 + res + div)) < 0.15 ? ok : ko)(`devis : total ${tot} = trajet ${trip} + 4,5 + réserve ${res} + dégag. ${div}`);

// ① bis PROJET 2 ÉTAPES : saisie ICAO → requis 2 étapes + verdict, embarqué
// piloté depuis le widget Centrage, persistance au rechargement.
await page.evaluate(() => {
    // Embarqué 70 L dans le widget Centrage (même page, dashboard).
    const f = document.getElementById('wb-fuel-l');
    if (f) { f.value = '70'; f.dispatchEvent(new Event('input', { bubbles: true })); }
    const i = document.getElementById('fp-leg2-icao');
    i.value = 'LFRD';
    i.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(1200);
const leg2a = await page.evaluate(() => ({
    block: document.getElementById('fp-leg2-block')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) || '',
}));
console.log('étape 2 :', JSON.stringify(leg2a.block));
(/Requis 2 étapes/.test(leg2a.block) ? ok : ko)('étape 2 : « Requis 2 étapes » affiché');
(/sans vent/.test(leg2a.block) ? ok : ko)('étape 2 : temps étiqueté « sans vent »');
(/possibles sans complément de plein/.test(leg2a.block) ? ok : ko)('étape 2 : verdict OK avec 70 L à bord');
// Bascule : embarqué insuffisant → avitaillement.
await page.evaluate(() => {
    const f = document.getElementById('wb-fuel-l');
    f.value = '40';
    f.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(1200);
const leg2b = await page.evaluate(() => ({
    block: document.getElementById('fp-leg2-block')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 300) || '',
}));
console.log('étape 2 (40 L) :', JSON.stringify(leg2b.block));
(/avitaillement à prévoir/.test(leg2b.block) && !/possibles sans complément/.test(leg2b.block) ? ok : ko)('étape 2 : verdict bascule sur « avitaillement à prévoir » à 40 L');
// Retour pilote 17/09 : le champ 2ᵉ étape NE DOIT PAS survivre — vide au
// rechargement, vide aussi quand la route change.
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForFunction(() => document.getElementById('fp-leg2-block') && /Deuxième|Second/.test(document.getElementById('fp-leg2-block')?.textContent || ''), { timeout: 30000 }).catch(() => {});
const leg2c = await page.evaluate(() => ({
    icao: document.getElementById('fp-leg2-icao')?.value || '',
    block: document.getElementById('fp-leg2-block')?.textContent.replace(/\s+/g, ' ').trim().slice(0, 120) || '',
}));
console.log('après rechargement :', JSON.stringify(leg2c));
(leg2c.icao === '' && !/Étape 2 :/.test(leg2c.block) ? ok : ko)('2ᵉ étape VIDE au rechargement (plus de persistance d un vol à l autre)');
// Changement de route → remise à vide.
await page.evaluate(() => {
    const i = document.getElementById('fp-leg2-icao');
    i.value = 'LFRD';
    i.dispatchEvent(new Event('change', { bubbles: true }));
});
await wait(800);
await page.evaluate(() => {
    const to = document.getElementById('route-to-input');
    to.value = 'LFRN';
    to.dispatchEvent(new Event('input', { bubbles: true }));   // câblé sur 'input' (frappe clavier)
});
await wait(4500);
const leg2d = await page.evaluate(() => ({
    icao: document.getElementById('fp-leg2-icao')?.value ?? 'ABSENT',
}));
console.log('après changement de destination :', JSON.stringify(leg2d));
(leg2d.icao === '' ? ok : ko)('2ᵉ étape remise à vide quand la route change');

// ② LOCAL : réserve 10 min + plafond Max 113 (utilisable).
await page.goto('http://127.0.0.1:8662/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
await page.waitForFunction(() => document.getElementById('wb-local-min'), { timeout: 30000 });
await page.evaluate(() => {
    const i = document.getElementById('wb-local-min');
    i.value = '30';
    i.dispatchEvent(new Event('input', { bubbles: true }));
});
await wait(800);
const local = await page.evaluate(() => ({
    cells: [...document.querySelectorAll('#wb-local-devis .wb-fuel-cell')].map(c => c.textContent.replace(/\s+/g, ' ').trim()),
    fuelMax: document.getElementById('wb-fuel-l')?.dataset.max || '',
    label: document.querySelector('#wb-fuel-l')?.closest('label')?.textContent.replace(/\s+/g, ' ').trim() || '',
}));
console.log('devis local :', JSON.stringify(local.cells), '· max embarqué :', local.fuelMax);
(local.cells.length === 4 ? ok : ko)('devis local : 4 cellules (Durée / Roulage / Réserve / Total)');
(/9 L/.test(local.cells[0] || '') ? ok : ko)('cellule Durée = 9 L (30 min à 18 L/h)');
(/Roulage.*10 min.*3 L/.test(local.cells[1] || '') ? ok : ko)('cellule Roulage = 3 L (10 min)');
(/Réserve.*15 min.*4[.,]5 L/.test(local.cells[2] || '') ? ok : ko)('cellule Réserve = 4,5 L (10 + 5 perso)');
(/16[.,]5 L/.test(local.cells[3] || '') ? ok : ko)('Total requis = 16,5 L (9 + 3 + 4,5)');
(local.fuelMax === '113' ? ok : ko)(`plafond embarqué = utilisable 113 L (capacité poste 119)`);
(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));
server.close(); await browser.close();
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE KO (${failures})`);
process.exit(failures === 0 ? 0 : 1);
