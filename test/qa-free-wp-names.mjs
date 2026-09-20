// QA NOMS DES REPÈRES LIBRES (19/09) : la base aérodromes se charge en
// ASYNCHRONE — un plan restauré au démarrage enregistre ses repères ZZxx
// AVANT elle, et la reconstruction de l'index les effaçait : le log PDF
// retombait sur les codes bruts ZZAA/ZZAB (retour pilote). rebuildIndex
// préserve désormais les entrées runtime. Exécution manuelle (navigateur).
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new', args: ['--disable-gpu', '--no-sandbox'],
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
try {
    const page = await browser.newPage();
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 120)));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
            req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
        } else req.continue();
    });
    await page.goto('http://localhost:8644/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, 2500));
    const res = await page.evaluate(async () => {
        const ui = await import('./js/ui-module.js');
        await ui.initAirportsDB();
        // Repères libres (code = nom, drapeau freeWp — 19/09) créés PUIS une
        // recharge de base (la course du démarrage).
        ui.enrichAirport('RV-E', { icao: 'RV-E', lat: 47.7, lon: -3.0, name: 'RV-E EVRON', freeWp: true });
        ui.enrichAirport('LOR', { icao: 'LOR', lat: 47.9, lon: -2.6, name: 'LOR LORIENT', freeWp: true });
        await ui.initAirportsDB();
        return {
            apresRVE: ui.getAirportByICAO('RV-E')?.name ?? 'PERDU',
            apresLOR: ui.getAirportByICAO('LOR')?.name ?? 'PERDU',
            flagRVE: ui.getAirportByICAO('RV-E')?.freeWp === true,
            vraiTerrain: ui.getAirportByICAO('LFRV')?.name ?? 'PERDU',
        };
    });
    (res.apresRVE === 'RV-E EVRON' ? ok : ko)('nom RV-E préservé après recharge de la base');
    (res.apresLOR === 'LOR LORIENT' ? ok : ko)('nom LOR préservé après recharge de la base');
    (res.flagRVE ? ok : ko)('drapeau freeWp préservé (exclusion NOTAM)');
    (res.vraiTerrain !== 'PERDU' ? ok : ko)('base aérodromes intacte (LFRV résolu)');
    (errs.length === 0 ? ok : ko)('zéro erreur JS' + (errs.length ? ' — ' + errs[0] : ''));
} finally {
    await browser.close();
    console.log(failures === 0 ? 'SMOKE OK' : `SMOKE KO (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}
