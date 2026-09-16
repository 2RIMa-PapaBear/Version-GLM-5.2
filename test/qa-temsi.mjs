// QA réelle B3 v2 (TEMSI) : bouton dans la barre de la carte régionale,
// panneau de vignettes datées (UTC + locale), mise en avant ≈ arrivée,
// images chargées depuis le Worker (prod), visionneuse + Échap.
// Usage : node test/qa-temsi.mjs [baseURL]   (défaut localhost:8651)
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASE = (process.argv[2] || 'http://127.0.0.1:8651').replace(/\/$/, '');
const REMOTE = !/^http:\/\/127/.test(BASE);

let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const ko = (m) => { failures++; console.log('KO  ' + m); };

let server = null;
if (!REMOTE) {
    const portFree = await new Promise((res) => {
        const s = net.connect(8651, '127.0.0.1');
        s.on('error', () => res(true));
        s.on('connect', () => { s.destroy(); res(false); });
    });
    if (portFree) {
        server = spawn(process.execPath, [path.join(root, 'test', '_serve.mjs')], { stdio: 'ignore' });
        await new Promise((r) => setTimeout(r, 800));
    }
}

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e?.message || e).slice(0, 140)));

    await page.goto(`${BASE}/index.html?icao=LFRV&mode=nav&dest=LFOO`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane') && !!document.querySelector('.fp-cell'), { timeout: 90000 });

    // Bouton TEMSI présent dans la barre.
    const hasBtn = await page.waitForFunction(
        () => !!document.querySelector('.temsi-btn'), { timeout: 15000 }).then(() => true).catch(() => false);
    hasBtn ? ok('bouton TEMSI dans la barre de la carte') : ko('bouton TEMSI introuvable');
    if (!hasBtn) throw new Error('interrompu');

    await page.click('.temsi-btn');
    const hasPanel = await page.waitForFunction(
        () => !!document.querySelector('#temsi-panel .temsi-layer'), { timeout: 30000 }).then(() => true).catch(() => false);
    hasPanel ? ok('panneau ouvert, couches rendues') : ko('panneau vide (relais /temsi ?)');

    // Première image réellement chargée (Worker prod → navigateur).
    const imgOk = await page.waitForFunction(
        () => [...document.querySelectorAll('#temsi-panel .temsi-thumb img')].some(i => i.complete && i.naturalWidth > 0),
        { timeout: 45000 }).then(() => true).catch(() => false);
    imgOk ? ok('au moins une vignette image chargée (Worker → navigateur)') : ko('aucune image chargée');

    const info = await page.evaluate(() => {
        const layers = [...document.querySelectorAll('#temsi-panel .temsi-layer')].map(l => ({
            title: l.querySelector('.temsi-layer-title')?.textContent,
            thumbs: l.querySelectorAll('.temsi-thumb').length,
        }));
        const thumbs = [...document.querySelectorAll('#temsi-panel .temsi-thumb')];
        return {
            layers,
            total: thumbs.length,
            near: thumbs.filter(t => t.classList.contains('near')).length,
            firstWhen: thumbs[0]?.querySelector('.temsi-when')?.textContent?.replace(/\s+/g, ' ').trim(),
            loaded: thumbs.filter(t => t.querySelector('img')?.complete && t.querySelector('img')?.naturalWidth > 0).length,
        };
    });
    console.log('    couches :', JSON.stringify(info.layers), '| vignettes :', info.total,
        '| chargées :', info.loaded, '| mise(s) en avant :', info.near);
    console.log('    1re étiquette :', info.firstWhen);
    info.layers.length >= 2 ? ok('TEMSI + WINTEM présentes') : ko('couches insuffisantes');
    info.total >= 4 ? ok(`${info.total} vignettes datées`) : ko(`${info.total} vignettes seulement`);
    /UTC/.test(info.firstWhen || '') && /\dh\d{2}(?!.*UTC)/.test(info.firstWhen || '')
        ? ok('étiquette = UTC ET heure locale') : ko('étiquette sans double heure : ' + info.firstWhen);
    info.near >= 1 ? ok('une échéance mise en avant (≈ arrivée)') : ko('aucune mise en avant');

    // Visionneuse + Échap.
    await page.evaluate(() => {
        const t = [...document.querySelectorAll('#temsi-panel .temsi-thumb')]
            .find(x => x.querySelector('img')?.complete && x.querySelector('img')?.naturalWidth > 0);
        t?.click();
    });
    const viewer = await page.waitForFunction(() => !!document.querySelector('.temsi-viewer img'), { timeout: 8000 })
        .then(() => true).catch(() => false);
    viewer ? ok('visionneuse plein cadre au clic') : ko('visionneuse absente');
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => !document.querySelector('.temsi-viewer'), { timeout: 4000 })
        .then(() => true).catch(() => false);
    closed ? ok('Échap ferme la visionneuse') : ko('Échap inefficace');

    const fatal = errs.find((e) => /temsi/i.test(e));
    if (!fatal) ok('aucune erreur JS TEMSI'); else ko('erreur JS : ' + fatal);
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
