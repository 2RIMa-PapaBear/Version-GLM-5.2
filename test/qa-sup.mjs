// QA réelle B4 (Sup AIP SIA) : panneau sous le tableau de bord, filtres
// VFR/en vigueur, recherche, mise en avant « votre vol » en nav (ICAO du
// plan cité dans l'objet d'une Sup), ouverture du PDF SIA dans un onglet.
// Usage : node test/qa-sup.mjs [baseURL]   (défaut localhost:8651)
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

    // MODE NAV avec plan — pour la mise en avant « votre vol ».
    await page.goto(`${BASE}/index.html?icao=LFRV&mode=nav&dest=LFMK`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
        const p = document.getElementById('sup-panel');
        return p && p.querySelector('.sup-row');
    }, { timeout: 45000 });

    const info = await page.evaluate(() => {
        const panel = document.getElementById('sup-panel');
        const rows = [...panel.querySelectorAll('.sup-row')];
        return {
            summary: panel.querySelector('.sup-summary')?.textContent?.trim() || '',
            total: rows.length,
            matches: rows.filter(r => r.classList.contains('sup-match')).length,
            first: rows[0]?.textContent?.replace(/\s+/g, ' ').slice(0, 120) || '',
            pdfHref: panel.querySelector('.sup-pdf')?.href || '',
            title: panel.querySelector('h3, .collapsible-title, summary')?.textContent?.trim()
                || panel.querySelector('.card-title')?.textContent?.trim() || '',
        };
    });
    console.log('    résumé :', info.summary.slice(0, 110));
    console.log('    1re ligne :', info.first);
    info.total >= 20 ? ok(`${info.total} Sup affichées (filtres VFR + en vigueur)`) : ko(`${info.total} Sup seulement`);
    info.total < 121 ? ok('filtres actifs (moins que les 121 de la base)') : ko('filtres sans effet');
    // La Sup citant LFMK (206/2026) n est pas ENCORE en vigueur (début
    // 24/09) : la mise en avant se vérifie filtre « en vigueur » décoché.
    await page.evaluate(() => { document.querySelector('#sup-panel .sup-f-today').click(); });
    await new Promise((r) => setTimeout(r, 400));
    const matchesAll = await page.evaluate(() => document.querySelectorAll('#sup-panel .sup-row.sup-match').length);
    const matchTxt = await page.evaluate(() => document.querySelector('#sup-panel .sup-row.sup-match')?.textContent?.replace(/\s+/g, ' ').slice(0, 100) || '');
    console.log('    mise en avant (toutes échéances) :', matchTxt);
    matchesAll >= 1 ? ok(`mise en avant « votre vol » (${matchesAll} Sup citant le plan, dest LFMK)`)
        : ko('aucune mise en avant pour LFMK');
    await page.evaluate(() => { document.querySelector('#sup-panel .sup-f-today').click(); });
    await new Promise((r) => setTimeout(r, 300));
    /sia\.aviation-civile\.gouv\.fr\/documents\/download/.test(info.pdfHref)
        ? ok('lien PDF officiel SIA : ' + info.pdfHref.slice(0, 70) + '…')
        : ko('lien PDF inattendu : ' + info.pdfHref);

    // Recherche : numéro exact → 1 ligne.
    await page.evaluate(() => { document.getElementById('sup-panel').querySelector('.sup-f-q').value = ''; });
    await page.type('.sup-f-q', '206/2026');
    await new Promise((r) => setTimeout(r, 500));
    const n1 = await page.evaluate(() => document.querySelectorAll('#sup-panel .sup-row').length);
    // (206/2026 est valide le jour J ? si non, elle est filtrée par « en
    // vigueur aujourd hui » → décoche ce filtre pour la retrouver.)
    if (n1 === 0) {
        await page.evaluate(() => { document.querySelector('#sup-panel .sup-f-today').click(); });
        await new Promise((r) => setTimeout(r, 400));
    }
    const n2 = await page.evaluate(() => document.querySelectorAll('#sup-panel .sup-row').length);
    n2 === 1 ? ok('recherche par numéro → exactement 1 Sup') : ko(`recherche → ${n2} lignes (attendu 1)`);

    // PDF SIA s'ouvre dans un onglet (popup) — pas de CORS en navigation haute.
    let pdfTab = null;
    page.on('popup', (p) => { pdfTab = p; });
    await page.evaluate(() => document.querySelector('#sup-panel .sup-pdf')?.click());
    await new Promise((r) => setTimeout(r, 2500));
    pdfTab ? ok('PDF SIA ouvert dans un onglet : ' + (pdfTab.url() || '').slice(0, 72)) : ko('aucun onglet ouvert');

    const fatal = errs.find((e) => /sup/i.test(e));
    if (!fatal) ok('aucune erreur JS'); else ko('erreur JS : ' + fatal);
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
