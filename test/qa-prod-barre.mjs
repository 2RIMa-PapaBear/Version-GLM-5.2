// QA E2E PROD : barre rangée 1 complète + ordre, sur l'URL déployée.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
const errs = [];
page.on('pageerror', e => errs.push(String(e).slice(0, 160)));
await page.goto('https://papabear56.pages-perso.free.fr/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForFunction(() => document.querySelector('.gps-map-cluster'), { timeout: 90000 });
await new Promise(r => setTimeout(r, 3000));
const res = await page.evaluate(() => {
    const row1 = document.querySelector('.map-layers-row-top');
    const groupes = [...(row1?.children || [])].map(g => ({
        t: ((g.querySelector('button, select')?.textContent || g.querySelector('button, select')?.title || '')).trim(),
        radar: !!g.querySelector('.precip-toggle-radar'),
    }));
    const bar = document.getElementById('map-layers-bar');
    return {
        groupes,
        cluster: !!document.querySelector('.gps-map-cluster'),
        gpsBtn: !!document.getElementById('gps-toggle-btn'),
        deborde: bar ? bar.scrollWidth > bar.clientWidth + 1 : null,
        version: (document.querySelector('footer, .app-version')?.textContent || '').match(/v[\d.]+/)?.[0] || '?',
    };
});
console.log(JSON.stringify(res, null, 1));
const labels = res.groupes.map(g => g.t);
const iEsp = labels.findIndex(t => /Espaces/i.test(t));
const iFro = labels.findIndex(t => /Fronts/i.test(t));
const iSig = labels.findIndex(t => /SIGMET/i.test(t));
const iRadar = res.groupes.findIndex(g => g.radar);
const okOrdre = iEsp === 0 && iFro > iEsp && iSig > iFro && iRadar !== -1 && res.groupes.slice(iRadar + 1).every(g => g.t === '');
console.log(res.cluster && res.gpsBtn && okOrdre && !res.deborde && errs.length === 0 ? 'PROD CHECK OK' : 'PROD CHECK KO — erreurs: ' + errs.join(' | '));
await browser.close();
process.exit(okOrdre && errs.length === 0 ? 0 : 1);
