// QA réelle : répartition des alternates le long d'une vraie route (retour
// pilote 11/09) — 8 terrains les plus proches d'ancres régulières, météo sans
// rôle (substitution * acceptée), ordre du vol. Données RÉELLES via le relais.
import puppeteer from 'puppeteer-core';

const ROUTES = [
    { name: 'LFRV-LFBD (Vannes-Bordeaux, ~230 NM)', pts: [
        { icao: 'LFRV', lat: 47.235, lon: -2.758 },
        { icao: 'LFBD', lat: 44.828, lon: -0.716 },
    ] },
    { name: 'LFRB-LFST (Brest-Strasbourg, ~560 NM)', pts: [
        { icao: 'LFRB', lat: 48.45, lon: -4.418 },
        { icao: 'LFST', lat: 48.538, lon: 7.63 },
    ] },
];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
// Laisse la base IDB des terrains se charger (le couloir l'utilise).
await page.waitForFunction(() => (window.__regionalMap !== undefined), { timeout: 30000 }).catch(() => {});
await new Promise(r => setTimeout(r, 6000));

let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

for (const route of ROUTES) {
    const res = await page.evaluate(async (pts) => {
        const m = await import('./js/alternates.js');
        const { greatCircleDistanceNm } = await import('./js/flight-planner.js');
        const rows = await m.getEnRouteAlternates(pts, 25, 8);
        if (!rows) return { error: 'null' };
        const len = greatCircleDistanceNm(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon);
        return {
            routeLen: Math.round(len),
            rows: rows.map(r => ({
                code: r.code, name: r.name, cat: r.cat.cat,
                off: r.offsetNm, atd: Math.round(r.atdNm),
                from: r.metarFrom, distNm: r.metarDistNm,
            })),
        };
    }, route.pts);

    console.log(`\n--- ${route.name} (ortho ${res.routeLen} NM) ---`);
    if (res.error) { ko(`getEnRouteAlternates → ${res.error}`); continue; }
    res.rows.forEach(r => console.log(`  ${r.from ? '*' : ' '} ${r.code} ${String(r.atd).padStart(4)} NM  ±${r.off} NM  ${r.cat}${r.from ? ` (METAR ${r.from} à ${r.distNm} NM)` : ''}  ${r.name}`));

    const atds = res.rows.map(r => r.atd);
    atds.length > 0 && atds.length <= 8 ? ok(`${atds.length} alternates (≤ 8)`) : ko(`${atds.length} alternates`);
    atds.every((v, i) => i === 0 || v > atds[i - 1]) ? ok('ordre du vol') : ko('ordre cassé');
    // Répartition : au moins la moitié des SECTEURS de route couverts, et les
    // positions couvrent début / milieu / fin (chaque tiers ≥ 1 si assez de rows).
    if (res.rows.length >= 3) {
        const t = res.routeLen / 3;
        const tiers = [0, 1, 2].map(i => atds.filter(a => a >= i * t && a < (i + 1) * t + (i === 2 ? 1 : 0)).length);
        tiers.every(n => n >= 1) ? ok(`chaque tiers couvert ${JSON.stringify(tiers)}`) : ko(`tiers non couverts ${JSON.stringify(tiers)}`);
    }
    res.rows.every(r => r.off <= 25) ? ok('tous dans le couloir ±25 NM') : ko('hors couloir');
    res.rows.every(r => ['VFR', 'MVFR', 'IFR', 'LIFR'].includes(r.cat)) ? ok('tous catégorisés (propre ou substitué)') : ko('sans catégorie');
}

await browser.close();
console.log(`\n${failures ? `${failures} ÉCHEC(S)` : 'TOUT OK'}`);
process.exit(failures ? 1 : 0);
