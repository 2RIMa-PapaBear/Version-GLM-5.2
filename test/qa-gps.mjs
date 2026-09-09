// QA GPS — teste l'APPLICATION RÉELLE (module js/gps.js intégré, action 08/09)
// avec des positions injectées dans la VRAIE API Geolocation via CDP.
// Couverture :
//   v1 : bouton GPS → marqueur + cercle + trace → suivi → « Recentrer » →
//        arrêt (trace conservée), voyant Wake Lock.
//   v2 : rotation « Route haut » (leaflet-rotate : setBearing actif, cap sol
//        est mis vers le HAUT, retour Nord haut) ; enregistrement auto du
//        vol en IndexedDB (chrono déclenché à la vitesse dérivée > 35 kt) ;
//        panneau « Vols » avec exports .GPX / .KML réels (contenu vérifié)
//        et suppression.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Garde-fou : aucune exécution QA ne doit dépasser 3 min (diagnostic si blocage).
setTimeout(() => { console.log('\nWATCHDOG : QA bloquée au-delà de 180 s — arrêt forcé'); process.exit(2); }, 180000);
// L'application réelle (racine du dépôt) — le GPS y est intégré.
const TEST_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(TEST_ROOT, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8656, r));
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const context = browser.defaultBrowserContext();
await context.overridePermissions('http://127.0.0.1:8656', ['geolocation']);
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
// Seuil minimal de durée de vol abaissé à 1,5 s pour la QA (5 min réels).
await page.evaluateOnNewDocument(() => { window.__gpsVolMinMs = 1500; });
await page.setGeolocation({ latitude: 48.7690, longitude: 2.1050, accuracy: 30 });
await page.setRequestInterception(true);
page.on('request', req => {
    const u = req.url();
    if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip|workers\.dev/.test(u)) {
        req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
    } else req.continue();
});
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
const idbVols = () => page.evaluate(() => new Promise(res => {
    const rq = indexedDB.open('mt-gps-test', 1);
    rq.onsuccess = () => {
        const db = rq.result;
        const rq2 = db.transaction('vols').objectStore('vols').getAll();
        rq2.onsuccess = () => res(rq2.result || []);
        rq2.onerror = () => res([]);
    };
    rq.onerror = () => res([]);
}));

await page.setGeolocation({ latitude: 48.7690, longitude: 2.1050, accuracy: 30, altitude: 200 });
await page.goto('http://127.0.0.1:8656/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.waitForSelector('#gps-toggle-btn', { timeout: 45000 });
await new Promise(r => setTimeout(r, 500));

// 1. Version test + interface v2 complète
const appVersion = await page.evaluate(() => window.APP_VERSION || '?');
/^\d+\.\d+$/.test(appVersion) ? ok('APP_VERSION = ' + appVersion) : ko('APP_VERSION inattendue : ' + appVersion);
const ui = await page.evaluate(() => ({
    rot: !!document.getElementById('gps-rot-btn') && document.getElementById('gps-rot-btn').style.display !== 'none',
    vols: !!document.getElementById('gps-vols-btn'),
    plugin: window.__regionalMap && typeof window.__regionalMap.setBearing === 'function',
}));
ui.plugin ? ok('plugin leaflet-rotate actif (setBearing disponible)') : ko('plugin rotation absent');
ui.rot ? ok('bouton Nord/Route affiché') : ko('bouton rotation absent ou masqué');
ui.vols ? ok('bouton « Vols » affiché') : ko('bouton Vols absent');

// 1bis. Paquet flottant SUR la carte (GPS + Vue), « Vols » dans la barre
const ui2 = await page.evaluate(() => {
    const mapHost = document.getElementById('regional-map');
    const cluster = mapHost ? mapHost.querySelector('.gps-map-cluster') : null;
    const ids = cluster ? [...cluster.querySelectorAll('button')].map(b => b.id || (b.classList.contains('map-fitplan-btn') ? 'map-fitplan-btn' : b.classList.contains('map-fs-btn') ? 'map-fs-btn' : '?')).join(',') : '';
    return {
        wrap: getComputedStyle(document.getElementById('map-layers-bar')).flexWrap,
        volsInBar: !!document.querySelector('#map-layers-bar #gps-vols-btn'),
        gpsInBar: !!document.querySelector('#map-layers-bar #gps-toggle-btn'),
        clusterInMap: !!cluster,
        n: cluster ? cluster.querySelectorAll('button').length : 0,
        fitIn: !!(cluster && cluster.querySelector('.map-fitplan-btn.gps-map-btn')),
        fsIn: !!(cluster && cluster.querySelector('.map-fs-btn.gps-map-btn')),
        seps: cluster ? cluster.querySelectorAll('.gps-cluster-sep').length : 0,
        ids,
        led: !!document.getElementById('gps-toggle-btn')?.classList.contains('gps-led'),
    };
});
ui2.wrap === 'nowrap' ? ok('barre d\'origine : une seule ligne (défilement horizontal)') : ko('barre : wrap=' + ui2.wrap);
ui2.volsInBar && !ui2.gpsInBar ? ok('barre : « Vols » dedans, GPS dehors') : ko('répartition barre/cluster incorrecte : ' + JSON.stringify({ volsInBar: ui2.volsInBar, gpsInBar: ui2.gpsInBar }));
ui2.clusterInMap ? ok('paquet d\'icônes posé SUR la carte') : ko('paquet d\'icônes absent de la carte');
ui2.n === 5 ? ok('5 icônes : GPS, Recentrer, Nord/Route, Cadrer plan, Plein cadre') : ko('nombre d\'icônes inattendu : ' + ui2.n);
ui2.fitIn && ui2.fsIn ? ok('« Cadrer plan » et « Plein cadre » déplacés dans le paquet (vrais boutons)') : ko('Cadrer/Plein cadre absents du paquet');
ui2.seps === 1 ? ok('séparateur navigation / vue présent') : ko('séparateur intra-cluster : ' + ui2.seps);
ui2.ids === 'gps-toggle-btn,gps-recenter-btn,gps-rot-btn,map-fitplan-btn,map-fs-btn'
    ? ok('ordre du paquet : GPS, Recentrer, Nord/Route, Cadrer plan, Plein cadre') : ko('ordre inattendu : ' + ui2.ids);
ui2.led ? ok('icône GPS porte la LED (.gps-led)') : ko('LED absente');
const volsIconRendered = await page.evaluate(() => !!document.querySelector('#gps-vols-btn svg'));
volsIconRendered ? ok('icône du bouton « Vols » rendue (Lucide)') : ko('icône « Vols » VIDE (createIcons manquant)');

// 1ter. MENU « ESPACES » : le défilement de la barre clippait le dropdown
// (bouton « mort » en recette 09/09) — il doit s'ouvrir en position:fixed,
// visible et atteignable au pointeur.
await page.click('.precip-toggle-airspaces');
await new Promise(r => setTimeout(r, 400));
const rpMenu = await page.evaluate(() => {
    const m = document.querySelector('.rp-menu');
    if (!m) return { exists: false };
    const r = m.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + Math.min(10, r.width / 2), r.top + 10);
    return {
        exists: true, open: m.style.display === 'block',
        fixed: getComputedStyle(m).position === 'fixed',
        w: Math.round(r.width), h: Math.round(r.height),
        inViewport: r.top >= 0 && r.right <= window.innerWidth + 1 && r.bottom <= window.innerHeight,
        clickable: !!hit && (m.contains(hit) || hit === m),
    };
});
rpMenu.exists && rpMenu.open ? ok('menu « Espaces » ouvert au clic') : ko("menu Espaces n'ouvre pas : " + JSON.stringify(rpMenu));
rpMenu.fixed ? ok('menu « Espaces » libéré en position:fixed (hors barre)') : ko('menu toujours dans le contexte de défilement de la barre');
rpMenu.h > 30 && rpMenu.inViewport ? ok(`menu visible dans le viewport (${rpMenu.w}×${rpMenu.h}px)`) : ko('menu clippé/hors viewport : ' + JSON.stringify(rpMenu));
rpMenu.clickable ? ok('menu atteignable au pointeur (cases cliquables)') : ko('un élément couvre le menu : ' + JSON.stringify(rpMenu));
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 200));

// 2. Clic GPS → marqueur + cercle + trace + LED, carte centrée sur la position
await page.click('#gps-toggle-btn');
await page.waitForSelector('.gps-plane-icon', { timeout: 15000 });
await new Promise(r => setTimeout(r, 800));
const afterOn = await page.evaluate(() => ({
    active: document.getElementById('gps-toggle-btn').classList.contains('active'),
    led: document.getElementById('gps-toggle-btn').classList.contains('on'),
    trace: !!document.querySelector('.gps-trace-path'),
    acc: !!document.querySelector('.gps-acc-circle'),
    center: window.__regionalMap.getCenter(),
}));
afterOn.active ? ok('bouton GPS actif') : ko('bouton GPS inactif');
afterOn.led ? ok('LED « écran maintenu allumé » allumée sur le bouton GPS') : ko('LED absente');
afterOn.trace && afterOn.acc ? ok('cercle de précision + trace présents') : ko('overlays GPS absents');
afterOn.center && Math.abs(afterOn.center.lat - 48.769) < 0.05 ? ok('suivi : carte centrée sur la position injectée') : ko('carte non centrée : ' + JSON.stringify(afterOn.center));

// 3. ROTATION « Route haut » : vol vers l'EST → le cap doit se retrouver en haut
await page.click('#gps-rot-btn');
await new Promise(r => setTimeout(r, 300));
const rotOn = await page.evaluate(() => ({
    active: document.getElementById('gps-rot-btn').classList.contains('active'),
    stored: localStorage.getItem('mt-gps-rotation'),
}));
rotOn.active && rotOn.stored === '1' ? ok('rotation activée (icône surlignée, préférence mémorisée)') : ko('rotation non activée : ' + JSON.stringify(rotOn));
await page.setGeolocation({ latitude: 48.7690, longitude: 2.1600, accuracy: 30 });   // cap EST
await new Promise(r => setTimeout(r, 1500));
const rotCheck = await page.evaluate(() => {
    const m = window.__regionalMap;
    const b = m.getBearing ? m.getBearing() : null;
    const c = m.getCenter();
    const north = m.latLngToContainerPoint([c.lat + 0.05, c.lng]);
    return { bearing: b, northX: north.x, midX: m.getSize().x / 2 };
});
// bearing normalisé ±180° : 270 ≡ -90 (cap EST vers le haut)
const bNorm = rotCheck.bearing != null ? ((rotCheck.bearing % 360) + 540) % 360 - 180 : null;
bNorm != null && Math.abs(bNorm + 90) < 8
    ? ok(`cap EST appliqué à la carte (bearing ${rotCheck.bearing.toFixed(0)}° ≡ ${bNorm.toFixed(0)}°)`) : ko('rotation non appliquée : ' + JSON.stringify(rotCheck));
rotCheck.northX < rotCheck.midX ? ok('le NORD est bien parti à GAUCHE → l\'EST (le cap) est en HAUT de l\'écran') : ko('sens de rotation inversé : nord à droite ? ' + JSON.stringify(rotCheck));
// L'ICÔNE (panneau NON tournant chez leaflet-rotate) doit pointer vers le
// HAUT en mode Route : cap relatif = cap + bearing = 90 + 270 ≡ 0 → −45° (≡ 315).
const parseRot = (s) => { const m = s && s.match(/rotate\((-?[\d.]+)deg\)/); return m ? ((parseFloat(m[1]) % 360) + 360) % 360 : null; };
const iconRotRoute = parseRot(await page.evaluate(() => document.querySelector('.gps-plane-icon')?.style.transform || ''));
iconRotRoute != null && Math.abs(iconRotRoute - 315) < 2 ? ok(`avion vers le HAUT en mode Route (${iconRotRoute.toFixed(0)}° ≡ −45°)`) : ko(`avion MAL orienté en mode Route : ${iconRotRoute}° (attendu 315 ≡ −45)`);
await page.click('#gps-rot-btn');   // retour Nord haut
await new Promise(r => setTimeout(r, 400));
const rotOff = await page.evaluate(() => ({ b: window.__regionalMap.getBearing ? window.__regionalMap.getBearing() : null, stored: localStorage.getItem('mt-gps-rotation') }));
(Math.abs(rotOff.b || 0) < 2 && rotOff.stored === '0') ? ok('retour Nord haut (bearing 0, préférence mémorisée)') : ko('retour Nord haut cassé : ' + JSON.stringify(rotOff));
// En Nord haut, l'avion reprend son cap ABSOLU : EST → 45° (glyphe NE)
const iconRotNord = parseRot(await page.evaluate(() => document.querySelector('.gps-plane-icon')?.style.transform || ''));
iconRotNord != null && Math.abs(iconRotNord - 45) < 2 ? ok(`avion vers l'EST en mode Nord (${iconRotNord.toFixed(1)}°)`) : ko(`avion MAL orienté en mode Nord : ${iconRotNord}° (attendu ≈ 45)`);

// 3bis. TAP SUR L'AVION (après ≥ 2 fixations : vitesse/cap dérivés dispo)
await page.evaluate(() => document.querySelector('.gps-plane-icon')?.closest('.leaflet-marker-icon')?.click());
await page.waitForSelector('.leaflet-popup', { timeout: 5000 }).catch(() => {});
const tapInfo = await page.evaluate(() => {
    const p = document.querySelector('.leaflet-popup');
    return p ? { text: p.textContent, visible: p.getClientRects().length > 0 } : null;
});
tapInfo && tapInfo.visible && /kt/.test(tapInfo.text) && /(Vitesse|Speed)/.test(tapInfo.text) && /Cap/.test(tapInfo.text)
    ? ok('tap sur l\'avion → popup infos vol (vitesse/altitude/cap/temps)') : ko('popup infos vol absent : ' + JSON.stringify(tapInfo));

// 4. Déplacement carte → « Recentrer » → reprise → arrêt (trace conservée, vol clôturé)
// Drag SYNTHÉTIQUE sur le conteneur Leaflet : un drag souris physique est
// instable en headless (des panneaux de l'app, ex. alternates-header, peuvent
// couvrir le point visé et avaler les événements) — on livre au handler
// Leaflet exactement les MouseEvent qu'un drag réel produirait.
await page.evaluate(() => {
    const mapEl = document.querySelector('.leaflet-container');
    const r = mapEl.getBoundingClientRect();
    const mk = (type, x, y) => new MouseEvent(type, { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0, buttons: type === 'mouseup' ? 0 : 1 });
    const x0 = r.left + r.width / 2, y0 = r.top + r.height / 2;
    mapEl.dispatchEvent(mk('mousedown', x0, y0));
    // move/up envoyés sur documentElement (cible RÉELLE élément) : une cible
    // `document` ferait planter l'addClass de Leaflet (document.className absent).
    for (let i = 1; i <= 8; i++) document.documentElement.dispatchEvent(mk('mousemove', x0 - i * 15, y0 - i * 10));
    document.documentElement.dispatchEvent(mk('mouseup', x0 - 120, y0 - 80));
});
await new Promise(r => setTimeout(r, 400));
// Bouton « Recentrer » DÉDIÉ : visible dès le suivi, non surligné quand le
// recentrage est en pause après un déplacement de carte ; GPS reste « GPS ».
const afterDrag = await page.evaluate(() => ({
    recVisible: document.getElementById('gps-recenter-btn').style.display !== 'none',
    recActive: document.getElementById('gps-recenter-btn').classList.contains('active'),
}));
afterDrag.recVisible && !afterDrag.recActive
    ? ok('déplacement carte : « Recentrer » visible et dé-surligné (recentrage en PAUSE)') : ko('état après drag inattendu : ' + JSON.stringify(afterDrag));
await page.click('#gps-recenter-btn');
await new Promise(r => setTimeout(r, 600));
const afterRec = await page.evaluate(() => ({
    recActive: document.getElementById('gps-recenter-btn').classList.contains('active'),
    center: window.__regionalMap.getCenter(),
}));
afterRec.recActive && afterRec.center && Math.abs(afterRec.center.lat - 48.769) < 0.05
    ? ok('clic « Recentrer » : recentrage repris + carte centrée sur ma position') : ko('recentrage cassé : ' + JSON.stringify(afterRec));
await page.click('#gps-toggle-btn');   // arrêt → clôture du vol en IndexedDB (GPS = interrupteur : 1 clic suffit)
await new Promise(r => setTimeout(r, 800));
const afterOff = await page.evaluate(() => ({
    plane: !!document.querySelector('.gps-plane-icon'),
    trace: !!document.querySelector('.gps-trace-path'),
    recHidden: document.getElementById('gps-recenter-btn').style.display === 'none',
}));
!afterOff.plane && afterOff.trace && afterOff.recHidden ? ok('arrêt : avion retiré, trace conservée, « Recentrer » masqué') : ko('arrêt incomplet : ' + JSON.stringify(afterOff));

// 4bis. REGRESSION : toucher à la rotation APRÈS l'arrêt ne doit PAS faire
// réapparaître l'avion (bug constaté par le pilote sur téléphone).
await page.click('#gps-rot-btn');
await new Promise(r => setTimeout(r, 300));
await page.click('#gps-rot-btn');
await new Promise(r => setTimeout(r, 300));
const planeAfterRot = await page.evaluate(() => !!document.querySelector('.gps-plane-icon'));
!planeAfterRot ? ok('arrêt + rotation : l\'avion reste absent') : ko('l\'avion RÉAPPARAÎT après toggle rotation (bug pilote)');

// 5. Enregistrement auto : le vol est dans IndexedDB avec chrono > 35 kt
const vols = await idbVols();
vols.length >= 1 ? ok(`vol enregistré automatiquement (${vols[0].pts.length} points)`) : ko('aucun vol en IndexedDB : ' + vols.length);
vols.length && vols[0].flightStartT ? ok('chrono de vol déclenché (vitesse dérivée > seuil décollage)') : ko('chrono de vol jamais déclenché : ' + JSON.stringify(vols.length && { fs: vols[0].flightStartT, pts: vols[0].pts.length }));
vols.length && vols[0].pts.every(p => Number.isFinite(p.lat) && Number.isFinite(p.lon)) ? ok('points valides (lat/lon)') : ko('points invalides');

// 6. Panneau « Vols » : exports GPX et KML réels (capturés via CDP)
await page.click('#gps-vols-btn');
await page.waitForSelector('.gps-vol-row', { timeout: 8000 });
ok('panneau « Vols » ouvert avec le vol listé');
const dlDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gps-dl-'));
const cdp = await page.createCDPSession();
await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: dlDir });
async function waitDl(ext) {
    for (let i = 0; i < 40; i++) {   // max 10 s
        await new Promise(r => setTimeout(r, 250));
        const f = fs.readdirSync(dlDir).find(n => n.endsWith(ext));
        if (f) return path.join(dlDir, f);
    }
    return null;
}
await page.click('.gps-vol-row [data-x="gpx"]');
const gpxFile = await waitDl('.gpx');
const gpx = gpxFile ? fs.readFileSync(gpxFile, 'utf8') : '';
// le vol va vers l'EST : longitude 2.160000 attendue dans les trkpts
gpxFile && gpx.includes('<gpx') && gpx.includes('<trkpt') && gpx.includes('2.160000') && gpx.includes('<speed>')
    ? ok(`export GPX valide (${path.basename(gpxFile)}, trkpts avec vitesse/altitude)`) : ko('GPX invalide ou absent : ' + (gpxFile || 'rien téléchargé') + ' / ' + gpx.slice(0, 160));
await page.click('.gps-vol-row [data-x="kml"]');
const kmlFile = await waitDl('.kml');
const kml = kmlFile ? fs.readFileSync(kmlFile, 'utf8') : '';
kmlFile && kml.includes('<kml') && kml.includes('<coordinates>')
    ? ok(`export KML valide (${path.basename(kmlFile)}, LineString + altitudes)`) : ko('KML invalide ou absent : ' + (kmlFile || 'rien téléchargé') + ' / ' + kml.slice(0, 120));

// 6bis. Rejouer la trace d'un vol sauvegardé (bouton « Trace »)
await page.click('.gps-vol-row [data-x="see"]');
await new Promise(r => setTimeout(r, 600));
const replayOn = await page.evaluate(() => ({
    path: !!document.querySelector('.gps-replay-path'),
    active: !!document.querySelector('.gps-vol-row [data-x="see"].active'),
}));
replayOn.path && replayOn.active ? ok('trace du vol sauvegardé rejouée à l\'écran (pointillés)') : ko('rejeu de trace cassé : ' + JSON.stringify(replayOn));
await page.click('.gps-vol-row [data-x="see"]');
await new Promise(r => setTimeout(r, 600));
const replayOff = await page.evaluate(() => !!document.querySelector('.gps-replay-path'));
!replayOff ? ok('rejeu de trace masqué au second clic') : ko('la trace rejouée ne se masque pas');

// 6ter. REJEU SANS SESSION GPS (bug pilote : « Trace » ne faisait rien tant
// que le GPS n'avait pas été lancé dans la session — activeMap nul).
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#gps-vols-btn', { timeout: 45000 });
await page.click('#gps-vols-btn');
await page.waitForSelector('.gps-vol-row', { timeout: 8000 });
await page.click('.gps-vol-row [data-x="see"]');
await new Promise(r => setTimeout(r, 600));
const replayNoGps = await page.evaluate(() => !!document.querySelector('.gps-replay-path'));
replayNoGps ? ok('rejeu de trace APRÈS rechargement, sans lancer le GPS (bug corrigé)') : ko('rejeu sans session GPS toujours cassé');
await page.click('#gps-vols-btn');   // referme le panneau laissé ouvert
await new Promise(r => setTimeout(r, 300));

// 6quater. PLEIN CADRE : le panneau « Vols » doit rester accessible et
// visible AU-DESSUS de la carte (bug constaté en recette 08/09).
await page.click('.map-fs-btn');
await new Promise(r => setTimeout(r, 600));
const fsOn = await page.evaluate(() => document.getElementById('regional-map-panel')?.classList.contains('map-fullscreen'));
fsOn ? ok('plein cadre activé') : ko('plein cadre non activé');
await page.click('#gps-vols-btn');
await new Promise(r => setTimeout(r, 500));
const fsPanel = await page.evaluate(() => {
    const p = document.querySelector('.gps-vols-panel');
    if (!p || !p.classList.contains('on')) return { open: false };
    const r = p.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + 20);
    return { open: true, z: getComputedStyle(p).zIndex, visible: !!hit?.closest('.gps-vols-panel') };
});
fsPanel.open && fsPanel.visible && Number(fsPanel.z) >= 4000
    ? ok(`panneau « Vols » visible AU-DESSUS du plein cadre (z ${fsPanel.z})`) : ko('panneau invisible en plein cadre : ' + JSON.stringify(fsPanel));
await page.click('.gps-vols-close');
await page.keyboard.press('Escape');
await new Promise(r => setTimeout(r, 400));
const fsOff = await page.evaluate(() => !document.getElementById('regional-map-panel')?.classList.contains('map-fullscreen'));
fsOff ? ok('sortie du plein cadre (Échap)') : ko('sortie du plein cadre cassée');

// 7. Suppression du vol (le panneau a été refermé après le test plein cadre)
await page.click('#gps-vols-btn');
await page.waitForSelector('.gps-vols-panel.on .gps-vol-row', { timeout: 8000 });
await new Promise(r => setTimeout(r, 500));   // le rendu du panneau est asynchrone
await page.evaluate(() => document.querySelector('.gps-vol-row [data-x="del"]').click());
await new Promise(r => setTimeout(r, 600));
const volsAfterDel = await idbVols();
volsAfterDel.length === 0 ? ok('suppression du vol dans l\'historique') : ko('vol non supprimé : ' + volsAfterDel.length);

// 8. SURVIE À UNE FERMETURE BRUTALE : session lancée, JAMAIS arrêtée,
// événement pagehide (fermeture de page → sauvegarde immédiate), puis
// recharger la page comme si l'appli avait été tuée.
await page.click('#gps-toggle-btn');
await page.waitForSelector('.gps-plane-icon', { timeout: 15000 });
await new Promise(r => setTimeout(r, 2000));   // ≥1 point enregistré
await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
await new Promise(r => setTimeout(r, 500));
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('#gps-vols-btn', { timeout: 45000 });
await new Promise(r => setTimeout(r, 500));
const volsAfterKill = await idbVols();
const inFlight = volsAfterKill.find(v => !v.endedAt);
inFlight && inFlight.pts.length >= 1
    ? ok(`vol en cours SURVIT à la fermeture sans arrêt (${inFlight.pts.length} points)`) : ko('vol perdu après fermeture brutale : ' + JSON.stringify(volsAfterKill.map(v => ({ endedAt: v.endedAt, n: v.pts.length }))));

// 7bis. FILTRE DES VOLS COURTS : session < seuil (1,5 s en QA) → rien en
// PLUS en base (la section 8 a laissé un orphelin volontairement).
const volsBeforeShort = await idbVols();
await page.click('#gps-toggle-btn');
await page.waitForSelector('.gps-plane-icon', { timeout: 15000 });
await new Promise(r => setTimeout(r, 400));   // session ~0,4 s < 1,5 s
await page.click('#gps-toggle-btn');
await new Promise(r => setTimeout(r, 800));
const volsShort = await idbVols();
volsShort.length === volsBeforeShort.length
    ? ok(`vol trop court (< 5 min réels) NON enregistré (${volsShort.length} vol(s) en base, inchangé)`) : ko('un vol court a été enregistré : ' + volsBeforeShort.length + ' → ' + volsShort.length);

if (jsErrors.length > 0) ko('erreurs JS : ' + jsErrors.join(' | ')); else ok('aucune erreur JS');
console.log(failures === 0 ? '\nVERSION TEST GPS v2 : TOUT OK' : `\nVERSION TEST GPS v2 : ${failures} ÉCHEC(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
