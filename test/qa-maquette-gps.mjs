// QA MAQUETTE GPS (action 2 — feu vert visuel pilote) : vérifie que la
// maquette maquette-gps.html se charge sans erreur JS et que la machine
// à états du bouton fonctionne : GPS → suivi (marqueur + recentrage
// continu) → déplacement carte → « Recentrer » → reprise → arrêt.
// La QUALITÉ VISUELLE (orientation de l'avion, lisibilité) reste du
// ressort du feu vert pilote — ce script ne teste QUE la mécanique.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/maquette-gps.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8653, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://127.0.0.1:8653/maquette-gps.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 1500));

// 1. Chargement sans erreur JS
if (jsErrors.length === 0) ok('chargement sans erreur JS'); else ko('erreurs JS au chargement : ' + jsErrors.join(' | '));

// 2. Clic GPS → état « follow » : bouton actif, avion affiché, voyant on
await page.click('#gps-btn');
await new Promise(r => setTimeout(r, 600));
const afterOn = await page.evaluate(() => ({
    active: document.getElementById('gps-btn').classList.contains('active'),
    plane: !!document.querySelector('.gps-plane-icon'),
    led: document.getElementById('gps-btn').classList.contains('on'),
    recVisible: document.getElementById('gps-recenter-btn').style.display !== 'none',
    transform: document.querySelector('.gps-plane-icon')?.style.transform || '',
}));
afterOn.active ? ok('bouton GPS actif après clic') : ko('bouton GPS inactif après clic');
afterOn.plane ? ok('marqueur avion affiché') : ko('marqueur avion absent');
afterOn.led ? ok('LED « écran maintenu allumé » allumée sur le bouton GPS') : ko('LED wake lock absente');
afterOn.recVisible ? ok('bouton « Recentrer » dédié visible au suivi') : ko('bouton Recentrer absent');
// au cap 000° la rotation attendue est -45° (glyphe Lucide orienté NE)
/-45/.test(afterOn.transform) ? ok('rotation cap 000° = -45° (offset NE) : ' + afterOn.transform) : ko('rotation inattendue : ' + afterOn.transform);

// 3. Suivi : la carte doit se déplacer avec l'avion (position simulée) + trace magenta présente
const centerBefore = await page.evaluate(() => document.querySelector('.gps-plane-icon')?.getBoundingClientRect().top);
await new Promise(r => setTimeout(r, 2000));
const planePos1 = await page.evaluate(() => { const el = document.querySelector('.gps-plane-icon'); return el ? el.getBoundingClientRect().top : -1; });
(planePos1 > 0 && Math.abs(planePos1 - centerBefore) < 80) ? ok('suivi : la carte suit l\'avion (avion reste à l\'écran)') : ko('suivi cassé : avion hors cadre ? top=' + planePos1);
const pathsFollow = await page.evaluate(() => document.querySelectorAll('.leaflet-overlay-pane path').length);
pathsFollow >= 2 ? ok('trace du trajet affichée pendant le suivi (cercle + polyligne)') : ko('trace absente pendant le suivi : paths=' + pathsFollow);

// 4. Déplacement de la carte → recentrage en pause (Recentrer dé-surligné),
//    puis clic « Recentrer » → reprise du recentrage auto ; GPS reste « GPS »
await page.mouse.move(640, 500);
await page.mouse.down();
await page.mouse.move(500, 420, { steps: 8 });
await page.mouse.up();
await new Promise(r => setTimeout(r, 400));
const afterDrag = await page.evaluate(() => ({
    recVisible: document.getElementById('gps-recenter-btn').style.display !== 'none',
    recActive: document.getElementById('gps-recenter-btn').classList.contains('active'),
}));
afterDrag.recVisible && !afterDrag.recActive
    ? ok('déplacement carte : « Recentrer » visible et dé-surligné (recentrage en PAUSE)') : ko('état après drag inattendu : ' + JSON.stringify(afterDrag));
await page.click('#gps-recenter-btn');
await new Promise(r => setTimeout(r, 400));
const recResumed = await page.evaluate(() => document.getElementById('gps-recenter-btn').classList.contains('active'));
recResumed ? ok('clic « Recentrer » → recentrage auto repris') : ko('reprise du recentrage cassée');

// 5. Arrêt : re-clic → bouton inactif, avion retiré, LED off, Recentrer masqué
await page.click('#gps-btn');
await new Promise(r => setTimeout(r, 400));
const afterOff = await page.evaluate(() => ({
    active: document.getElementById('gps-btn').classList.contains('active'),
    plane: !!document.querySelector('.gps-plane-icon'),
    led: document.getElementById('gps-btn').classList.contains('on'),
    recVisible: document.getElementById('gps-recenter-btn').style.display !== 'none',
    paths: document.querySelectorAll('.leaflet-overlay-pane path').length,
}));
(afterOff.active === false && !afterOff.plane && !afterOff.led && !afterOff.recVisible && afterOff.paths >= 1)
    ? ok('arrêt complet (bouton neutre, avion retiré, LED off, Recentrer masqué) + trace conservée')
    : ko('arrêt incomplet : ' + JSON.stringify(afterOff));

// 6. Simulation Free.fr HTTP → bouton grisé, pas de démarrage
await page.click('#sim-http');
await page.click('#gps-btn');
await new Promise(r => setTimeout(r, 300));
const afterHttp = await page.evaluate(() => ({
    disabled: document.getElementById('gps-btn').classList.contains('gps-disabled'),
    plane: !!document.querySelector('.gps-plane-icon'),
}));
afterHttp.disabled && !afterHttp.plane ? ok('Free.fr simulé : bouton grisé, GPS refusé') : ko('Free.fr simulé cassé : ' + JSON.stringify(afterHttp));

if (jsErrors.length > 0) ko('erreurs JS en cours de test : ' + jsErrors.join(' | '));
console.log(failures === 0 ? '\nMAQUETTE GPS : TOUT OK' : `\nMAQUETTE GPS : ${failures} ÉCHEC(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
