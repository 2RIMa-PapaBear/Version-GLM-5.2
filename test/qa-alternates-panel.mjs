// QA réelle : panneau « Alternates » du site en mode Navigation — même
// algorithme que le log de nav (retour pilote 11/09 : « applique l'algorithme
// du PDF à l'onglet des alternates »). Données réelles via le relais.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 1000 });
await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV&mode=nav', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 6000));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

// --- Destination saisie : panneau passe en mode « le long du trajet ».
await page.evaluate(() => {
    const inp = document.getElementById('route-to-input');
    inp.value = 'LFBD';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => !!document.querySelector('.alternates-grid.route'), { timeout: 45000 });
await new Promise(r => setTimeout(r, 800));

const route = await page.evaluate(() => {
    const cont = document.getElementById('alternates-container');
    const grid = document.querySelector('.alternates-grid.route');
    const names = [...grid?.querySelectorAll('.alt-cell-name') || []];
    const title = document.getElementById('lbl-alternates')?.textContent || '';
    const note = grid?.parentElement?.innerText || '';
    return {
        visible: cont && cont.style.display !== 'none' && cont.style.display !== '',
        rows: names.map(n => ({
            code: n.querySelector('.alt-code')?.textContent?.trim(),
            cellCount: n.parentElement ? null : null,
        })),
        gridChildren: grid ? grid.children.length : 0,
        stars: names.filter(n => n.querySelector('.alt-code')?.textContent?.includes('*')).length,
        title, note,
    };
});
console.log(`Titre : ${route.title}`);
route.rows.forEach(r => console.log(`  ${r.code}`));
route.visible ? ok('panneau visible') : ko('panneau masqué');
route.title.trim() === 'Alternates' ? ok('titre « Alternates » (mode trajet)') : ko(`titre : «${route.title}»`);
route.rows.length === 8 ? ok('8 lignes') : ko(`${route.rows.length} lignes`);
route.gridChildren === 6 + 8 * 6 ? ok(`grille 6 colonnes (${route.gridChildren} cellules)`) : ko(`grille : ${route.gridChildren} cellules (attendu 54)`);
route.stars >= 1 ? ok(`${route.stars} substitution(s) marquée(s) *`) : ko('aucune étoile (substitution attendue sur cette route)');
route.note.includes('régulièrement espacés') ? ok('note mode trajet') : ko('note inattendue');

// Ordre du vol : re-vérifie via un recalcul avec les MÊMES points que le
// panneau (position officielle de la station via le mémo — des coordonnées
// codées en dur décaleraient les ancres aux frontières de secteurs).
const orderOk = await page.evaluate(async () => {
    const m = await import('./js/alternates.js');
    const { getAirportByICAO } = await import('./js/ui-module.js');
    const { memoGet } = await import('./js/core.js');
    const pts = ['LFRV', 'LFBD'].map(code => {
        const apt = getAirportByICAO(code), memo = memoGet(code);
        return { icao: code, lat: memo?.lat ?? apt?.lat, lon: memo?.lon ?? apt?.lon };
    });
    if (pts.some(p => p.lat == null)) return false;
    const rows = await m.getEnRouteAlternates(pts, 25, 8);
    const shown = [...document.querySelectorAll('.alternates-grid.route .alt-code')].map(e => e.textContent.replace('*', '').trim());
    return rows.length === shown.length && rows.every((r, i) => r.code === shown[i]);
});
orderOk ? ok('affichage = calcul (ordre du vol, mêmes terrains)') : ko('écran ≠ calcul');

// --- Capture du panneau pour revue pilote.
await page.evaluate(() => {
    document.getElementById('alternates-container')?.classList.add('open');
    document.getElementById('alternates-container')?.scrollIntoView({ block: 'center' });
});
await new Promise(r => setTimeout(r, 600));
await page.screenshot({ path: 'test/apercu-alternates-panneau.png' });
console.log('capture → test/apercu-alternates-panneau.png');

// --- Destination vidée : retour au widget « autour du terrain ».
await page.evaluate(() => {
    const inp = document.getElementById('route-to-input');
    inp.value = '';
    inp.dispatchEvent(new Event('input', { bubbles: true }));
});
await page.waitForFunction(() => {
    const g = document.querySelector('.alternates-grid');
    return g && !g.classList.contains('route');
}, { timeout: 45000 });
const local = await page.evaluate(() => ({
    rows: document.querySelectorAll('.alternates-grid .alt-cell-name').length,
    title: document.getElementById('lbl-alternates')?.textContent || '',
    note: document.querySelector('.alternates-grid')?.parentElement?.innerText || '',
}));
local.rows > 0 && local.rows <= 6 ? ok(`destination vidée → widget local (${local.rows} lignes)`) : ko(`${local.rows} lignes en local`);
local.title.includes('viables') || local.title.includes('Viable') ? ok('titre local restauré') : ko(`titre : «${local.title}»`);

await browser.close();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
