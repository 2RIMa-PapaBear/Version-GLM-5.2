// QA DEVIS CARBURANT DÉTAILLÉ (17/09) : forfaits roulage+intégration au devis
// écran (ligne dédiée, total = trajet + forfaits + réserve + dégagement),
// réserve vol locale 10 min, plafond embarqué = capacité poste − INUTILISABLE,
// devis local incluant l'inutilisable (19/09 : 30 min → 9 + 3 + 4,5 + 6 = 22,5 L).
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

// Flotte du profil : avion type WT9 AVEC centrage + 6 L inutilisables (le
// widget Centrage se masque sans bloc wb).
await page.evaluateOnNewDocument(() => {
    const ac = {
        id: 'ac_qa_wt9', name: 'QA WT9', registration: '', type: 'WT9',
        groundRoll: 540, fiftyFt: 1148, safetyMargin: 15,
        cruiseSpeedKt: 100, fuelBurnLph: 18, unusableFuelL: 6,
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

// ① NAV : devis avec « Roulage + intégr. » 15 min, « Inutilisable » 6 L
// (19/09), total = trajet+forfait+réserve(+dégag.)+inutilisable.
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
const unusableCell = lignes.find(l => /Inutilisable|Unusable/i.test(l));
(unusableCell ? ok : ko)('devis : cellule « Inutilisable » présente (navigation)');
(/6 L/.test(unusableCell || '') ? ok : ko)('devis : inutilisable = 6 L (manuel de vol)');
const num = l => parseFloat((l.match(/([\d.]+) L/) || [])[1]);
const trip = num(lignes.find(l => /Trajet|Trip/.test(l)) || '');
const res = num(lignes.find(l => /Réserve|Reserve/.test(l)) || '');
const un = unusableCell ? num(unusableCell) : 0;
const div = lignes.find(l => /Dégagement|Alternate/.test(l)) ? num(lignes.find(l => /Dégagement|Alternate/.test(l))) : 0;
const tot = num(lignes.find(l => /Total/.test(l)) || '');
(Math.abs(tot - (trip + 4.5 + res + div + un)) < 0.15 ? ok : ko)(`devis : total ${tot} = trajet ${trip} + 4,5 + réserve ${res} + dégag. ${div} + inutil. ${un}`);
// Conso : PARAMÈTRE INFORMATIF (retour pilote 19/09) — lecture seule, issue
// de la fiche avion (18 L/h de la flotte QA), jamais saisie ici.
const burnRo = await page.evaluate(() => ({
    ro: document.getElementById('fp-burn')?.readOnly === true,
    val: document.getElementById('fp-burn')?.value || '',
}));
(burnRo.ro ? ok : ko)('conso (L/h) : champ informatif lecture seule (fenêtre Flotte)');
(burnRo.val === '18' ? ok : ko)(`conso affichée = fiche avion (18 L/h, lu : « ${burnRo.val} »)`);

// ① bis PROJET 2 ÉTAPES : saisie ICAO → requis 2 étapes + verdict, embarqué
// piloté depuis le widget Centrage, persistance au rechargement. Le requis
// compte l'inutilisable UNE fois (via le total du plan, 19/09) : 36,4 + 38
// = 74,4 L → témoin embarqué 80 L.
await page.evaluate(() => {
    // Embarqué 80 L dans le widget Centrage (même page, dashboard).
    const f = document.getElementById('wb-fuel-l');
    if (f) { f.value = '80'; f.dispatchEvent(new Event('input', { bubbles: true })); }
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
(/74\.4 L/.test(leg2a.block) ? ok : ko)('étape 2 : requis 74,4 L (plan 36,4 + étape 38, inutilisable compté une fois)');
(/sans vent/.test(leg2a.block) ? ok : ko)('étape 2 : temps étiqueté « sans vent »');
(/possibles sans complément de plein/.test(leg2a.block) ? ok : ko)('étape 2 : verdict OK avec 80 L à bord');
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

// ② LOCAL : réserve 10 min + inutilisable 6 L (devis 5 cellules) + plafond
// Max 113 (capacité 119 − 6 inutilisables).
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
(local.cells.length === 5 ? ok : ko)('devis local : 5 cellules (Durée / Roulage / Réserve / Inutilisable / Total)');
(/9 L/.test(local.cells[0] || '') ? ok : ko)('cellule Durée = 9 L (30 min à 18 L/h)');
(/Roulage.*10 min.*3 L/.test(local.cells[1] || '') ? ok : ko)('cellule Roulage = 3 L (10 min)');
(/Réserve.*15 min.*4[.,]5 L/.test(local.cells[2] || '') ? ok : ko)('cellule Réserve = 4,5 L (10 + 5 perso)');
(/Inutilisable.*6 L/.test(local.cells[3] || '') ? ok : ko)('cellule Inutilisable = 6 L (manuel de vol)');
(/22[.,]5 L/.test(local.cells[4] || '') ? ok : ko)('Total requis = 22,5 L (9 + 3 + 4,5 + 6)');
(local.fuelMax === '113' ? ok : ko)(`plafond embarqué = 113 L (capacité 119 − 6 inutilisables)`);
(pageErrors.length === 0 ? ok : ko)('zéro erreur JS' + (pageErrors.length ? ' — ' + pageErrors[0] : ''));
server.close(); await browser.close();
console.log(failures === 0 ? 'SMOKE OK' : `SMOKE KO (${failures})`);
process.exit(failures === 0 ? 0 : 1);
