// QA réelle (retour pilote 17/09 : « les graphiques de l'alternate et de
// l'arrivée ne sont pas les TAF mais les METAR ») — reproduction exacte :
// l'onglet PDF s'ouvre AVANT la génération → page principale MASQUÉE →
// Chrome suspend les rAF → updateFinalUI ne dessinait JAMAIS et la capture
// embarquait l'ANCIEN graphique (le METAR à l'écran).
// Ici : snapshot du canvas AVANT, ouverture du popup, capture de DEUX TAF
// différents en page masquée — chacun doit différer du snapshot ET de
// l'autre. Usage : node test/qa-taf-capture.mjs   (serveur 8651 requis)
import puppeteer from 'puppeteer-core';
import net from 'node:net';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const ko = (m) => { failures++; console.log('KO  ' + m); };

const portFree = await new Promise((res) => {
    const s = net.connect(8651, '127.0.0.1');
    s.on('error', () => res(true));
    s.on('connect', () => { s.destroy(); res(false); });
});
let server = null;
if (portFree) {
    server = spawn(process.execPath, [path.join(root, 'test', '_serve.mjs')], { stdio: 'ignore' });
    await new Promise((r) => setTimeout(r, 800));
}

const TAF_A = 'TAF LFOO 170500Z 1706/1806 31010KT 9999 SCT030 TEMPO 1712/1718 4000 -SHRA BKN025=';
const TAF_B = 'TAF LFRD 170500Z 1706/1806 27012KT 9999 FEW035 BCMG 1714/1716 32015G25KT=';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 140)));
    await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
        const c = document.getElementById('tafCanvas');
        return c && c.width > 0;
    }, { timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));

    const res = await page.evaluate(async (tafA, tafB) => {
        // Snapshot du graphique actuellement affiché (METAR LFRV).
        const avant = document.getElementById('tafCanvas').toDataURL('image/jpeg', 0.85);
        // L'onglet PDF du dossier : la page principale passe en masquée.
        window.open('', '_blank');
        await new Promise((r) => setTimeout(r, 300));
        const hidden = document.visibilityState === 'hidden';
        const { captureTafChartPng } = await import('./js/taf-chart-capture.js');
        const capA = await captureTafChartPng(tafA);
        const capB = await captureTafChartPng(tafB);
        return {
            hidden,
            avantLen: avant.length,
            aOk: !!capA, bOk: !!capB,
            aLen: capA?.png?.length ?? 0,
            bLen: capB?.png?.length ?? 0,
            aDiffAvant: capA?.png !== avant,
            bDiffAvant: capB?.png !== avant,
            aDiffB: capA?.png !== capB?.png,
            apres: document.getElementById('tafInput').value.slice(0, 30),
        };
    }, TAF_A, TAF_B);

    console.log('    page masquée :', res.hidden, '| avant', res.avantLen, 'c | capA', res.aLen, 'c | capB', res.bLen, 'c');
    res.hidden ? ok('reproduction fidèle : page masquée par le popup') : ko('page NON masquée — test non concluant');
    res.aOk ? ok('capture TAF A rendue') : ko('capture A null');
    res.bOk ? ok('capture TAF B rendue') : ko('capture B null');
    res.aDiffAvant ? ok('TAF A ≠ graphique METAR affiché avant (le bug donnait l ANCIEN canvas)')
        : ko('TAF A = image du METAR précédent — LE BUG EST PRÉSENT');
    res.bDiffAvant ? ok('TAF B ≠ graphique METAR affiché avant') : ko('TAF B = image du METAR précédent');
    res.aDiffB ? ok('les deux TAF donnent deux graphiques DISTINCTS') : ko('A et B identiques (canvas non redessiné)');
    /TAF|METAR/.test(res.apres) ? ok('écran restauré (« ' + res.apres + '… »)') : ko('champ non restauré : ' + res.apres);
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
