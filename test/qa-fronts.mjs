// QA réelle ⑤ (cartes des fronts) : bouton dans la rangée couches de la
// barre carte, panneau de vignettes datées (UTC + locale), mise en avant
// ≈ arrivée, images chargées depuis le Worker (prod), visionneuse + Échap.
// Usage : node test/qa-fronts.mjs [baseURL]   (défaut localhost:8651)
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

    // Bouton Fronts présent dans la rangée couches.
    const hasBtn = await page.waitForFunction(
        () => !!document.querySelector('.fronts-btn'), { timeout: 15000 }).then(() => true).catch(() => false);
    hasBtn ? ok('bouton Fronts dans la rangée couches de la barre') : ko('bouton Fronts introuvable');
    if (!hasBtn) throw new Error('interrompu');

    await page.click('.fronts-btn');
    const hasPanel = await page.waitForFunction(
        () => !!document.querySelector('#fronts-panel .fronts-layer'), { timeout: 30000 }).then(() => true).catch(() => false);
    hasPanel ? ok('panneau ouvert, couche rendue') : ko('panneau vide (relais /fronts ?)');

    // Première image réellement chargée (Worker prod → navigateur).
    const imgOk = await page.waitForFunction(
        () => [...document.querySelectorAll('#fronts-panel .fronts-thumb img')].some(i => i.complete && i.naturalWidth > 0),
        { timeout: 45000 }).then(() => true).catch(() => false);
    imgOk ? ok('au moins une vignette image chargée (Worker → navigateur)') : ko('aucune image chargée');

    const info = await page.evaluate(() => {
        const layers = [...document.querySelectorAll('#fronts-panel .fronts-layer')].map(l => ({
            title: l.querySelector('.fronts-layer-title')?.textContent,
            thumbs: l.querySelectorAll('.fronts-thumb').length,
        }));
        const thumbs = [...document.querySelectorAll('#fronts-panel .fronts-thumb')];
        return {
            layers,
            total: thumbs.length,
            near: thumbs.filter(t => t.classList.contains('near')).length,
            firstWhen: thumbs[0]?.querySelector('.fronts-when')?.textContent?.replace(/\s+/g, ' ').trim(),
            loaded: thumbs.filter(t => t.querySelector('img')?.complete && t.querySelector('img')?.naturalWidth > 0).length,
        };
    });
    console.log('    couches :', JSON.stringify(info.layers), '| vignettes :', info.total,
        '| chargées :', info.loaded, '| mise(s) en avant :', info.near);
    console.log('    1re étiquette :', info.firstWhen);
    info.layers.length >= 1 ? ok('couche « Europe ouest » présente') : ko('couche absente');
    info.total >= 6 ? ok(`${info.total} échéances datées (analyse + prévisions 6 h)`) : ko(`${info.total} échéances seulement`);
    /UTC/.test(info.firstWhen || '') && /\dh\d{2}(?!.*UTC)/.test(info.firstWhen || '')
        ? ok('étiquette = UTC ET heure locale') : ko('étiquette sans double heure : ' + info.firstWhen);
    info.near >= 1 ? ok('une échéance mise en avant (≈ arrivée)') : ko('aucune mise en avant');

    // Visionneuse + Échap.
    await page.evaluate(() => {
        const t = [...document.querySelectorAll('#fronts-panel .fronts-thumb')]
            .find(x => x.querySelector('img')?.complete && x.querySelector('img')?.naturalWidth > 0);
        t?.click();
    });
    const viewer = await page.waitForFunction(() => !!document.querySelector('.fronts-viewer img'), { timeout: 8000 })
        .then(() => true).catch(() => false);
    viewer ? ok('visionneuse plein cadre au clic') : ko('visionneuse absente');
    await page.keyboard.press('Escape');
    const closed = await page.waitForFunction(() => !document.querySelector('.fronts-viewer'), { timeout: 4000 })
        .then(() => true).catch(() => false);
    closed ? ok('Échap ferme la visionneuse') : ko('Échap inefficace');

    const fatal = errs.find((e) => /fronts/i.test(e));
    if (!fatal) ok('aucune erreur JS fronts'); else ko('erreur JS : ' + fatal);
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
