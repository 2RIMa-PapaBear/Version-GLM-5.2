// QA réelle (retours pilote 24/09) : le drag tactile du graphique n'existe
// QUE sur un TAF (il y règle l'heure d'arrivée prévue). Sur un METAR il est
// inutile : rien n'est capturé et le doigt fait DÉFILER LA PAGE. Un tap sur
// un METAR ne déplace pas le curseur d'arrivée (souris fantômes ignorées).
// Le drag À LA SOURIS reste fonctionnel sur bureau. Le graphique de relief
// (mode Navigation) est HORS PÉRIMÈTRE : ne pas le tester ni le modifier.
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

const METAR_LFRV = 'LFRV 240800Z 32008KT 9999 FEW030 18/12 Q1019 NOSIG';
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

async function saisirMessage(page, msg) {
    await page.evaluate((m) => {
        const ta = document.getElementById('tafInput');
        ta.value = m;
        ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, msg);
    await new Promise((r) => setTimeout(r, 600));
}

// ---------- Téléphone + METAR : le doigt sur le graphique doit défiler la page ----------
const mob = await openPage({ width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
await saisirMessage(mob, METAR_LFRV);

const css = await mob.evaluate(() => getComputedStyle(document.getElementById('tafCanvas')).touchAction);
css !== 'none' ? ok(`METAR : touch-action ${css} (aucun blocage CSS du défilement)`)
    : ko(`METAR : touch-action 'none' encore posé sur .taf-canvas`);

const prevented = await mob.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const t = new Touch({ identifier: 1, target: can, clientX: 100, clientY: 100 });
    const ev = new TouchEvent('touchmove', { cancelable: true, touches: [t] });
    can.dispatchEvent(ev);
    return ev.defaultPrevented;
});
!prevented ? ok('METAR : touchmove non avalé — le navigateur peut défiler')
    : ko('METAR : touchmove encore preventDefault par un écouteur');

const tapMetar = await mob.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const tip = document.getElementById('drag-tooltip');
    const t = new Touch({ identifier: 1, target: can, clientX: 100, clientY: 100 });
    can.dispatchEvent(new TouchEvent('touchstart', { touches: [t] }));
    can.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 100, clientY: 100 }));
    return tip?.style?.opacity || '0';
});
tapMetar !== '1' ? ok('METAR : tap tactile inerte (pas de drag, souris fantôme ignorée)')
    : ko('METAR : tap tactile déclenche le drag');

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
y1 > y0 + 30 ? ok(`METAR : glisser vertical depuis le graphique → la page défile (${Math.round(y0)} → ${Math.round(y1)} px)`)
    : ko(`METAR : glisser vertical depuis le graphique → page figée (${Math.round(y0)} → ${Math.round(y1)} px)`);

// ---------- Téléphone + TAF : le drag tactile est actif (heure d'arrivée prévue) ----------
await saisirMessage(mob, TAF_LFRV);

const dragTaf = await mob.evaluate(() => {
    const can = document.getElementById('tafCanvas');
    const tip = document.getElementById('drag-tooltip');
    const t = new Touch({ identifier: 1, target: can, clientX: 100, clientY: 100 });
    can.dispatchEvent(new TouchEvent('touchstart', { touches: [t] }));
    const armed = tip?.style?.opacity || '0';
    const mv = new TouchEvent('touchmove', { cancelable: true, touches: [t] });
    can.dispatchEvent(mv);
    const captured = mv.defaultPrevented;
    window.dispatchEvent(new Event('touchend'));
    const closed = tip?.style?.opacity || '?';
    return { armed, captured, closed };
});
dragTaf.armed === '1' ? ok('TAF : toucher le graphique arme le drag (infobulle heure d\'arrivée)') : ko('TAF : drag non armé au toucher');
dragTaf.captured ? ok('TAF : touchmove capturé (preventDefault) — le doigt règle l\'heure, pas le défilement') : ko('TAF : touchmove non capturé');
dragTaf.closed !== '1' ? ok('TAF : fin de toucher → drag terminé, infobulle masquée') : ko('TAF : drag jamais terminé');

// Geste réel CDP sur un TAF : le graphique garde la main, la page ne défile pas.
const y2 = await mob.evaluate(() => window.scrollY);
await mob.touchscreen.touchStart(c.x, c.y);
for (let i = 1; i <= 6; i++) await mob.touchscreen.touchMove(c.x - 15 * i, c.y - 25 * i);
await mob.touchscreen.touchEnd();
await new Promise((r) => setTimeout(r, 400));
const y3 = await mob.evaluate(() => window.scrollY);
Math.abs(y3 - y2) < 10 ? ok(`TAF : glisser réel capturé par le graphique (page figée ${Math.round(y2)} → ${Math.round(y3)} px)`)
    : ko(`TAF : le glisser fait défiler la page (${Math.round(y2)} → ${Math.round(y3)} px) — drag tactile inactif`);
await mob.close();

// ---------- Bureau : le drag souris reste fonctionnel ----------
const desk = await openPage({ width: 1280, height: 900 });
await saisirMessage(desk, TAF_LFRV);
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
