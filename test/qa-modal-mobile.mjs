// QA réelle (retour pilote 16/09 : « dans le popup Dossier de vol - à
// vérifier avant impression, le bouton "J'ai vérifié - générer le dossier"
// est masqué en bas du popup — on croit qu'il manque quelque chose ») :
// sur un écran TÉLÉPHONE (390×780), la modale doit garder ses boutons
// VISIBLES sans scroll : en-tête et pied épinglés, seul le corps défile.
// Usage : node test/qa-modal-mobile.mjs   (serveur 8651 requis)
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

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});
try {
    const page = await browser.newPage();
    // L argument 1 = largeur, 2 = hauteur : PC (retour pilote « c'est le
    // cas aussi sur PC ») par défaut 1280x800 ; passer 390 780 pour mobile.
    const [W, H] = [Number(process.argv[2]) || 1280, Number(process.argv[3]) || 800];
    const MOBILE = W <= 640;
    await page.setViewport({ width: W, height: H, isMobile: MOBILE, hasTouch: MOBILE, deviceScaleFactor: MOBILE ? 2 : 1 });
    await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => {
        const b = document.getElementById('ff-print');
        return b && b.offsetParent !== null && !!document.querySelector('.fp-cell');
    }, { timeout: 90000 });
    await page.tap('#ff-print');
    await page.waitForSelector('.docs-check', { timeout: 15000 });

    const res = await page.evaluate(() => {
        // DOMRect ne sérialise PAS à travers CDP (propriétés prototype) :
        // extraire des primitives dans la page.
        const r = (el) => {
            if (!el) return null;
            const b = el.getBoundingClientRect();
            return { top: b.top, bottom: b.bottom, left: b.left, right: b.right };
        };
        const okBtn = document.querySelector('[data-ok]');
        const cancel = document.querySelector('[data-cancel]');
        const body = document.querySelector('.modal.show .modal-body, .modal[style*="display"] .modal-body') || document.querySelector('.modal-body');
        return {
            okBtn: r(okBtn), cancel: r(cancel),
            vh: innerHeight,
            bodyScroll: body ? { s: body.scrollHeight, c: body.clientHeight } : null,
            bodyOverflow: body ? getComputedStyle(body).overflowY : '',
        };
    });
    console.log(`    fenêtre ${res.vh}px · bouton « générer » [${Math.round(res.okBtn.top)}→${Math.round(res.okBtn.bottom)}]`);
    res.okBtn && res.okBtn.bottom <= res.vh - 2
        ? ok('bouton « J ai vérifié — générer » VISIBLE sans scroll')
        : ko(`bouton coupé : bas à ${res.okBtn?.bottom}px pour ${res.vh}px de fenêtre`);
    res.cancel && res.cancel.bottom <= res.vh - 2
        ? ok('bouton Annuler visible') : ko('Annuler coupé');
    res.bodyOverflow === 'auto'
        ? ok('corps de modale défilant (en-tête/pied épinglés)') : ko('corps non défilant : ' + res.bodyOverflow);
    if (res.bodyScroll && res.bodyScroll.s > res.bodyScroll.c) {
        ok(`contenu plus haut que la fenêtre (${res.bodyScroll.s}>${res.bodyScroll.c}px) : c est le CORPS qui scrolle, pas la modale entière`);
    }
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
