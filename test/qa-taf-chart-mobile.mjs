// QA réelle (retour pilote 16/09 : « le format des graphiques TAF doit
// être de la largeur d'une page A5, quel que soit l'appareil ») : la
// capture du graphique TAF passe par un OVERRIDE DE LARGEUR DU MOTEUR
// (state.chartRenderWidthOverride = 760) — le ratio hauteur/largeur doit
// être IDENTIQUE sur un écran téléphone (390 px) et un écran bureau
// (1280 px), et l'écran doit être restauré.
// Usage : node test/qa-taf-chart-mobile.mjs   (serveur 8651 requis)
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

const TAF_LFOO = 'TAF LFOO 160500Z 1606/1712 31010KT 9999 SCT030 BCMG 1612/1614 27015KT=';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});

async function captureAt(width, isMobile) {
    const page = await browser.newPage();
    await page.setViewport({ width, height: isMobile ? 844 : 900, isMobile: !!isMobile, hasTouch: !!isMobile, deviceScaleFactor: isMobile ? 2 : 1 });
    await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.getElementById('tafCanvas'), { timeout: 30000 });
    await new Promise((r) => setTimeout(r, 2500));
    const res = await page.evaluate(async (taf) => {
        const { captureTafChartPng } = await import('./js/taf-chart-capture.js');
        const cap = await captureTafChartPng(taf);
        // La restauration RE-REND l'écran (genererGraphique asynchrone) :
        // laisser le canvas revenir à la largeur écran avant de mesurer.
        for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 150));
            const w = parseFloat(document.getElementById('tafCanvas')?.style?.width || '0');
            if (w > 0 && w < 760) break;
        }
        const can = document.getElementById('tafCanvas');
        return {
            ok: !!cap,
            ratio: cap?.ratio ?? null,
            imgLen: cap?.png?.length ?? 0,
            canvasCssW: Math.round(parseFloat(can?.style?.width || '0')) || null,
        };
    }, TAF_LFOO);
    await page.close();
    return { before: width, ...res };
}

try {
    const mob = await captureAt(390, true);
    const desk = await captureAt(1280, false);

    if (mob.ok) {
        mob.ratio <= 0.66 ? ok(`téléphone : ratio ${mob.ratio.toFixed(2)} (format A5, ≤ 0.66 — avant fix ~1.1)`)
            : ko(`téléphone : ratio ${mob.ratio.toFixed(2)} : graphe encore étroit`);
        mob.imgLen > 5000 ? ok(`téléphone : image ${(mob.imgLen / 1024).toFixed(0)} Ko`) : ko('téléphone : image vide');
        // restauration : le canvas écran doit revenir à ~ la largeur du conteneur (<760)
        mob.canvasCssW && mob.canvasCssW < 760 ? ok(`téléphone : écran restauré (canvas ${mob.canvasCssW}px)`)
            : ko(`téléphone : canvas non restauré (${mob.canvasCssW}px)`);
    } else ko('téléphone : capture null');

    if (desk.ok) {
        Math.abs(desk.ratio - mob.ratio) <= 0.08
            ? ok(`bureau : ratio ${desk.ratio.toFixed(2)} ≡ téléphone (écart ${(Math.abs(desk.ratio - mob.ratio)).toFixed(2)}) — format indépendant de l'appareil`)
            : ko(`bureau ${desk.ratio.toFixed(2)} ≠ téléphone ${(mob.ratio || 0).toFixed(2)} : le format dépend encore de l'écran`);
    } else ko('bureau : capture null');
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
