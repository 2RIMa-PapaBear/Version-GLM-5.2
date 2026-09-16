// QA réelle B7 : la carte de vol est bien la DERNIÈRE page du PDF du
// dossier généré par le VRAI bouton « Imprimer le dossier de vol »
// (flux complet : permalien nav → panneau dossier → modale « Documents à
// bord » → onglet PDF), avec les tuiles OpenTopoMap recomposées par le
// CANVAS du navigateur (JPEG DCTDecode — la voie production) et les zones
// SIA chargées comme sur la carte (cellules IDB/fichier).
// Usage : node test/qa-flight-map-dossier.mjs [baseURL]
//   baseURL défaut http://127.0.0.1:8651 — passer
//   https://papabear56.pages-perso.free.fr/test/ pour jouer contre le canal
//   déployé (profil vierge : départage cache navigateur vs vrai bug).
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
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

// Serveur statique local (si personne ne l'occupe déjà).
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
    await page.setViewport({ width: 1280, height: 1000 });
    const consoleErrs = [];
    const consoleAll = [];
    page.on('pageerror', (e) => consoleErrs.push(String(e?.message || e)));
    page.on('console', (msg) => {
        consoleAll.push(`[${msg.type()}] ${msg.text()}`.slice(0, 200));
        consoleErrs.push(msg.text());
    });

    // 1. App en mode nav avec destination (permalien officiel).
    await page.goto(`${BASE}/index.html?icao=LFRV&mode=nav&dest=LFOO`,
        { waitUntil: 'domcontentloaded', timeout: 30000 });
    const hasPrint = await page.waitForFunction(
        () => { const b = document.getElementById('ff-print'); return b && b.offsetParent !== null; },
        { timeout: 45000 }).then(() => true).catch(() => false);
    if (hasPrint) ok('mode nav + bouton « Imprimer le dossier de vol » visible'); else ko('bouton dossier introuvable');
    if (!hasPrint) throw new Error('interrompu');

    // Le bouton apparaît dès le mode nav, mais la génération repart de
    // state._lastNavPlan : sans plan calculé elle RETOURNE en silence et
    // l'onglet reste about:blank — on attend le résultat du planificateur.
    const planReady = await page.waitForFunction(
        () => !!document.querySelector('.fp-cell'),
        { timeout: 90000 }).then(() => true).catch(() => false);
    if (planReady) ok('plan calculé (bloc résultat rendu)'); else ko('plan jamais calculé (.fp-cell absent)');
    await new Promise((r) => setTimeout(r, 2500));

    // Instrumentation : chaque fetch de la génération est tracé (>, <, X) —
    // c'est lui qui révélera l'attente sans timeout le cas échéant.
    await page.evaluate(() => {
        window._fetchLog = [];
        const of = window.fetch;
        window.fetch = function (...args) {
            const u = String(args[0]).slice(0, 90);
            window._fetchLog.push(['>', u, Date.now()]);
            return of.apply(this, args).then(
                (r) => { window._fetchLog.push(['<', u, r.status, Date.now()]); return r; },
                (e) => { window._fetchLog.push(['X', u, String(e).slice(0, 60), Date.now()]); throw e; });
        };
    });

    // 2. Clic → modale « Documents à bord » → 4 cases → imprimer.
    let pdfTab = null;
    page.on('popup', (p) => { pdfTab = p; });
    await page.click('#ff-print');
    await page.waitForSelector('.docs-check', { timeout: 15000 });
    await page.evaluate(() => {
        document.querySelectorAll('.docs-check').forEach((c) => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    await page.waitForFunction(() => !document.querySelector('[data-ok]')?.disabled, { timeout: 8000 });
    await page.click('[data-ok]');
    ok('modale documents cochée, impression lancée');

    // 3. L'onglet PDF arrive avec l'iframe data: (génération complète,
    //    tuiles + zones + captures TAF comprises).
    if (!pdfTab) {
        await new Promise((r) => setTimeout(r, 1500));
    }
    if (!pdfTab) ko('aucun onglet ouvert par window.open');
    let dataUri = '';
    for (let i = 0; i < 90 && !dataUri; i++) {
        try {
            dataUri = await pdfTab.evaluate(() => document.querySelector('iframe')?.getAttribute('src') || '');
        } catch { /* onglet pas prêt */ }
        if (!dataUri) await new Promise((r) => setTimeout(r, 2000));
    }
    if (dataUri.startsWith('data:application/pdf')) ok('PDF généré dans l onglet');
    else {
        ko(`onglet sans PDF (${dataUri.slice(0, 40) || 'vide'})`);
        // Sondes d'état : la page principale répond-elle (boucle bloquée ?)
        // et que contient l'onglet popup ?
        try {
            const probe = await Promise.race([
                page.evaluate(() => ({ alive: true, gen: !!document.querySelector('.modal-overlay') })),
                new Promise((r) => setTimeout(() => r({ alive: false }), 4000)),
            ]);
            console.log('    page principale :', JSON.stringify(probe));
        } catch (e) { console.log('    page principale : evaluate en erreur ' + String(e).slice(0, 60)); }
        try {
            const body = await Promise.race([
                pdfTab.evaluate(() => ({
                    readyState: document.readyState,
                    title: document.title,
                    bodyLen: document.body ? document.body.innerHTML.length : -1,
                    head: document.head ? document.head.innerHTML.slice(0, 100) : '',
                })),
                new Promise((r) => setTimeout(() => r({ timeout: true }), 4000)),
            ]);
            console.log('    onglet popup :', JSON.stringify(body));
        } catch (e) { console.log('    onglet popup : evaluate en erreur ' + String(e).slice(0, 60)); }
        const errs2 = consoleErrs.filter((l) => !/^[<>] /.test(l));
        if (errs2.length) {
            console.log('--- erreurs/awaRN app ---');
            errs2.slice(-12).forEach((l) => console.log('    ' + l.slice(0, 180)));
        }
        console.log('--- console app (40 derniers) ---');
        consoleAll.slice(-40).forEach((l) => console.log('    ' + l));
        try {
            const fl = await page.evaluate(() => (window._fetchLog || []).slice(-25));
            console.log('--- fetch (25 derniers) ---');
            fl.forEach(([d, u, s, t]) => console.log(`    ${d} ${u} ${s ?? ''}`));
        } catch { /* page fermée */ }
        try { console.log('    onglet url:', pdfTab?.url()); } catch { /* fermé */ }
    }
    if (!dataUri.startsWith('data:application/pdf')) throw new Error('interrompu');

    const buf = Buffer.from(dataUri.slice(dataUri.indexOf('base64,') + 7), 'base64');
    const out = path.join(root, 'test', 'Apercu_Dossier_carte_LFRV-LFOO.pdf');
    fs.writeFileSync(out, buf);
    console.log(`    PDF sauvé : test/Apercu_Dossier_carte_LFRV-LFOO.pdf (${(buf.length / 1024).toFixed(0)} Ko)`);

    // 4. ORDRE PILOTE 16/09 : garde / log / météo / NOTAM / carte —
    //    extraction du texte PAR PAGE via pdfjs chargé dans l'onglet PDF
    //    lui-même (le bundle refuse le fake worker sous Node : « no require »).
    const raw = buf.toString('latin1');
    let numPages = 0, lastPageHasMap = null;
    let orderInfo = null;
    try {
        const info = await pdfTab.evaluate(async (b64) => {
            const bin = atob(b64);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            await import(`${location.origin}/vendor/pdfjs-3.11.174.min.js`);
            const pdfjs = window.pdfjsLib || globalThis.pdfjsLib;
            pdfjs.GlobalWorkerOptions.workerSrc = '/vendor/pdfjs-worker-3.11.174.min.js';
            const doc = await pdfjs.getDocument({ data: bytes }).promise;
            const textAt = async (n) => {
                const p = await doc.getPage(n);
                const tc = await p.getTextContent();
                return tc.items.map((it) => it.str || '').join(' ');
            };
            const texts = [];
            for (let n = 1; n <= doc.numPages; n++) texts.push(await textAt(n));
            const find = (re) => texts.findIndex((t) => re.test(t));
            return {
                numPages: doc.numPages,
                firstIsCover: /DOSSIER DE VOL|Dossier de vol/i.test(texts[0]),
                logPage: find(/VFR Flight Log/),
                meteoPage: find(/M[eé]t[eé]o au dossier/),
                notamPage: find(/NOTAM sélectionnés/),
                mapPage: texts.findIndex(t => /CARTE DE VOL/.test(t)),
                vacPages: texts.map((t, i) => /VAC · /.test(t) ? i : -1).filter(i => i >= 0),
                vacLabels: texts.filter(t => /VAC · /.test(t)).map(t => (t.match(/VAC · [^ ]+ [A-Z]{4}/) || [''])[0]),
            };
        }, dataUri.slice(dataUri.indexOf('base64,') + 7));
        numPages = info.numPages;
        lastPageHasMap = info.lastHasMap;
        orderInfo = info;
        info.firstIsCover ? ok('page 1 = garde du dossier') : ko('page 1 n est pas la garde');
        info.logPage === 1 ? ok('page 2 = log de nav (juste après la garde)')
            : ko(`log en page ${info.logPage + 1} (attendu 2)`);
        info.meteoPage > info.logPage ? ok(`météo APRÈS le log (page ${info.meteoPage + 1})`)
            : ko(`météo en page ${info.meteoPage + 1}, avant/absente alors que le log est page ${info.logPage + 1}`);
        // Cartes VAC INTÉGRÉES (②=B, 16/09) : APRÈS la carte de vol, en fin de dossier.
    if (info.vacPages.length) {
        const afterMap = info.vacPages.every(i => i >= (info.numPages - info.vacPages.length));
        afterMap ? ok(`cartes VAC intégrées en fin de dossier (${info.vacPages.length} pages : ${[...new Set(info.vacLabels)].join(', ')})`)
            : ko(`pages VAC mal placées : ${info.vacPages.map(i => i + 1).join(', ')} sur ${info.numPages}`);
    } else {
        ko('aucune page VAC dans le dossier (LFRV/LFOO ont une VAC)');
    }
    if (info.notamPage >= 0 && info.notamPage < info.meteoPage) ko('annexe NOTAM avant la météo (ordre pilote violé)');
        else if (info.notamPage >= 0) ok(`annexe NOTAM après la météo (page ${info.notamPage + 1})`);
        else ok('pas d annexe NOTAM dans ce parcours (dossier non chargé) — ordre non applicable');
    } catch (e) {
        console.log('    (pdfjs onglet indisponible : ' + String(e?.message || e).slice(0, 80) + ')');
    }
    if (!numPages) numPages = (raw.match(/\/Type \/Page[^s]/g) || []).length;
    if (lastPageHasMap === null) lastPageHasMap = false;

    numPages >= 4 ? ok(`${numPages} pages`) : ko(`${numPages} pages (≥4 attendues)`);
    // La carte de vol précède immédiatement les VAC (②=B) ; sans VAC elle
    // reste la dernière page.
    const vacCount = orderInfo ? orderInfo.vacPages.length : 0;
    const expectedMap = vacCount ? numPages - vacCount - 1 : numPages - 1;
    (orderInfo && orderInfo.mapPage === expectedMap)
        ? ok(`carte de vol en position ${orderInfo.mapPage + 1}${vacCount ? ' — juste avant les VAC' : ' — dernière page'}`)
        : ko(`carte de vol en position ${(orderInfo?.mapPage ?? -1) + 1}, attendue ${expectedMap + 1} (VAC : ${vacCount})`);

    raw.includes('CARTE DE VOL') ? ok('titre carte présent') : ko('titre carte absent');
    raw.includes('DCTDecode') ? ok('fond OpenTopoMap recomposé en JPEG (voie canvas production)')
        : ko('pas de JPEG embarqué — tuiles absentes ?');
    for (const t of ['LFRV', 'LFOO']) {
        raw.includes(t) ? ok(`« ${t} » dans le PDF`) : ko(`« ${t} » absent`);
    }
    // Graphiques TAF PLEINE LARGEUR (exigence pilote 16/09) : au moins une
    // image posée à INNER = 419.53 − 2×28 = 363.5 pt sur la page Météo.
    {
        const places = [...raw.matchAll(/([\d.]+) 0 0 ([\d.]+) ([\d.]+) ([\d.]+) cm\s*\/\w+ Do/g)]
            .map((m) => ({ w: +m[1], h: +m[2] }));
        const full = places.filter((p) => Math.abs(p.w - 363.53) < 2);
        full.length ? ok(`graphique(s) TAF pleine largeur (${full.length} × ${full[0].w.toFixed(0)} pt)`)
            : ko(`aucun graphique à 363.5 pt (placements : ${places.map((p) => p.w.toFixed(0)).join(', ')})`);
    }

    // 5. Aucune erreur bloquante côté page (les warnings de dégradation
    //    isolés — TAF absent etc. — ne comptent PAS, seule la CARTE doit
    //    se taire).
    const mapErr = consoleErrs.find((e) => /carte de vol/i.test(e));
    if (!mapErr) ok('aucune erreur « carte de vol ignorée » en console');
    else ko('carte ignorée : ' + mapErr.slice(0, 120));
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
