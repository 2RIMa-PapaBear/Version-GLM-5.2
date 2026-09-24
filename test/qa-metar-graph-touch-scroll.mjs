// QA réelle (retour pilote 24/09 : « le cadre du graphique du METAR empêche
// de faire glisser l'écran sur téléphone ») : le drag tactile a été retiré du
// canvas — le doigt doit DÉFILER LA PAGE quand il part du graphique, et un
// simple tap ne doit pas déplacer le curseur d'heure d'arrivée (gardes souris
// fantômes). Le drag À LA SOURIS reste fonctionnel sur bureau.
// Usage : node test/qa-metar-graph-touch-scroll.mjs   (serveur 8651 requis)
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

const TAF_LFRV = 'TAF LFRV 240500Z 2406/2506 32010KT 9999 SCT030 TEMPO 2409/2412 4000 RA BKN020=';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});

async function openPage(opts) {
    const page = await browser.newPage();
    await page.setViewport(opts);
    await page.goto('http://127.0.0.1:8651/index.html', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => !!document.getElementById('tafCanvas'), { timeout: 30000 });
    return page;
}

// ---------- Téléphone : le doigt sur le graphique doit défiler la page ----------
const mob = await openPage({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });

const css = await mob.evaluate(() => getComputedStyle(document.getElementById('tafCanvas')).touchAction);
css !== 'none' ? ok(`touch-action ${css} (l'ancien 'none' bloquait le défilement)`)
    : ko(`touch-action 'none' encore posé sur .taf-canvas`);

const prevented = await mob.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const t = new Touch({ identifier: 1, target: can, clientX: 100, clientY: 100 });
    const ev = new TouchEvent('touchmove', { cancelable: true, touches: [t] });
    can.dispatchEvent(ev);
    return ev.defaultPrevented;
});
!prevented ? ok('touchmove sur le canvas non avalé (plus de preventDefault) — le navigateur peut défiler')
    : ko('touchmove encore preventDefault par un écouteur');

const tapGhost = await mob.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const tip = document.getElementById('drag-tooltip');
    const t = new Touch({ identifier: 1, target: can, clientX: 100, clientY: 100 });
    can.dispatchEvent(new TouchEvent('touchstart', { touches: [t] }));
    can.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    return tip?.style?.opacity || '0';
});
tapGhost !== '1' ? ok('tap tactile : pas de drag déclenché (souris fantôme ignorée)')
    : ko('tap tactile déclenche le drag (garde souris fantôme absente)');

// Geste réel CDP : doigt posé au centre du canvas, glissé vers le haut → la page doit descendre.
await mob.evaluate(() => document.getElementById('tafCanvas').scrollIntoView({ block: 'center' }));
await new Promise((r) => setTimeout(r, 300));
const y0 = await mob.evaluate(() => window.scrollY);
const c = await mob.evaluate(() => {
    const r = document.getElementById('tafCanvas').getBoundingClientRect();
    return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) };
});
await mob.touchscreen.touchStart(c.x, c.y);
for (let i = 1; i <= 6; i++) await mob.touchscreen.touchMove(c.x, c.y - 25 * i);
await mob.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 400));
const y1 = await mob.evaluate(() => window.scrollY);
y1 > y0 + 30 ? ok(`glisser vertical depuis le graphique : la page défile (${Math.round(y0)} → ${Math.round(y1)} px)`)
    : ko(`glisser vertical depuis le graphique : page figée (${Math.round(y0)} → ${Math.round(y1)} px)`);
await mob.close();

// ---------- Bureau : le drag souris reste fonctionnel ----------
const desk = await openPage({ width: 1280, height: 900 });
await desk.evaluate((taf) => {
    const ta = document.getElementById('tafInput');
    ta.value = taf;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
}, TAF_LFRV);
await new Promise((r) => setTimeout(r, 600));
const drag = await desk.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const r = can.getBoundingClientRect();
    can.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + 20 }));
    const op = document.getElementById('drag-tooltip')?.style?.opacity || '0';
    window.dispatchEvent(new MouseEvent('mouseup'));
    return op;
});
drag === '1' ? ok('bureau : cliquer-glisser le graphique toujours actif (infobulle visible)')
    : ko('bureau : drag souris cassé');
await desk.close();

await browser.close().catch(() => {});
if (server) server.kill();
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
