// QA réelle (retour pilote 16/09 : « le clic gauche ne fonctionne pas sur
// les points VFR de la carte ») : couche radiophares active, clic DOM RÉEL
// (MouseEvent bubbles) sur un marqueur VRP France (base SIA) — le popup
// doit s'ouvrir (nom + description officielle + bouton « + Waypoint »).
// Comparaison VOR/NDB dans la même vue pour isoler un problème propre aux
// VRP. Usage : node test/qa-vrp-click.mjs   (serveur 8651 requis)
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
    await page.setViewport({ width: 1280, height: 1400 });
    const errs = [];
    page.on('pageerror', (e) => errs.push(String(e?.message || e).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 160)); });

    await page.goto('http://127.0.0.1:8651/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('#regional-map .leaflet-pane'), { timeout: 60000 });
    await page.evaluate(() => document.getElementById('regional-map').scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 4000));

    // Active la couche VOR/NDB/VRP (menu Espaces) puis centre sur un VRP
    // SIA proche de Vannes, et déclenche un VRAI clic DOM sur son marqueur.
    const res = await page.evaluate(async () => {
        const out = { steps: [] };
        // Ouvre le menu Espaces et coche VOR/NDB/VRP.
        const espBtn = [...document.querySelectorAll('button')].find(b => /Espaces/.test(b.textContent || ''));
        if (!espBtn) { out.steps.push('pas de bouton Espaces'); return out; }
        espBtn.click();
        await new Promise(r => setTimeout(r, 300));
        const boxes = [...document.querySelectorAll('.rp-menu input[type=checkbox]')];
        out.steps.push(`menu: ${boxes.length} cases`);
        boxes.forEach(c => { if (!c.checked) c.click(); });
        await new Promise(r => setTimeout(r, 400));
        // FIX 16/09 : le menu doit s être REFERMÉ après la case cochée —
        // sinon il flotte sur la carte et intercepte les clics des points.
        out.menuClosedAfterCheck = document.querySelector('.rp-menu')?.style.display !== 'block';

        // Un VRP FR (base SIA) proche de LFRV pour la vue.
        const { parseRadioPoints } = await import('./js/radio-points.js');
        const json = await (await fetch('/data/radio-points.json')).json();
        const p = parseRadioPoints(json);
        const near = p.vrp
            .filter(v => v.cc === 'FR')
            .map(v => ({ v, d: Math.hypot(v.lat - 47.72, (v.lon + 2.72) * 0.67) }))
            .sort((a, b) => a.d - b.d)[0]?.v;
        if (!near) { out.steps.push('aucun VRP FR'); return out; }
        out.vrp = { name: near.name, desc: near.desc || '', lat: near.lat, lon: near.lon };

        const map = window.__regionalMap;
        if (!map) { out.steps.push('pas de __regionalMap'); return out; }
        map.setView([near.lat, near.lon], 12);
        await new Promise(r => setTimeout(r, 1200));
        out.markers = {
            vrp: document.querySelectorAll('.rp-marker.rp-vrp').length,
            vor: document.querySelectorAll('.rp-marker.rp-vor').length,
            ndb: document.querySelectorAll('.rp-marker.rp-ndb').length,
        };

        const clickMarker = async (sel) => {
            const el = document.querySelector(sel);
            if (!el) return 'absent';
            el.scrollIntoView({ block: 'center', inline: 'center' });
            await new Promise(r => setTimeout(r, 300));
            const r = el.getBoundingClientRect();
            const inner = el.querySelector('.rp-sym') || el;
            const ir = inner.getBoundingClientRect();
            const cx = ir.left + ir.width / 2, cy = ir.top + ir.height / 2;
            out.rect = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), ix: Math.round(ir.left), iy: Math.round(ir.top), iw: Math.round(ir.width), ih: Math.round(ir.height), vw: innerWidth, vh: innerHeight, hasSym: !!el.querySelector('.rp-sym') };
            const target = document.elementFromPoint(cx, cy);
            out.hitTag = target ? (target.className || target.tagName) : 'rien';
            out.hitHtml = target ? target.outerHTML.slice(0, 200) : '';
            out.hitChain = target ? (() => { let e = target, c = []; while (e && c.length < 6) { c.push(e.className || e.tagName); e = e.parentElement; } return c.join(' < '); })() : '';
            target?.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: cx, clientY: cy }));
            await new Promise(r2 => setTimeout(r2, 500));
            const popup = document.querySelector('.leaflet-popup');
            if (!popup) return 'pas de popup';
            const html = popup.innerHTML;
            document.querySelector('.leaflet-popup-close-button')?.click();
            await new Promise(r2 => setTimeout(r2, 200));
            return 'popup:' + html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').slice(0, 220);
        };
        // Étiquette permanente du VRP : MODÈLE AÉRODROME (harmonisation
        // 16/09) — <strong>IDENT</strong> + 2e ligne colorée, police de l app.
        // Lue AVANT les clics : le clic droit recadre la carte sur la route
        // et sort le VRP de la vue (étiquette supprimée au refresh).
        const lbl = document.querySelector('.rp-label.rp-label-vrp');
        out.vrpLabel = lbl ? lbl.innerHTML.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) : '';
        const lblStyle = lbl ? getComputedStyle(lbl) : null;
        out.vrpLabelFont = lblStyle ? lblStyle.fontFamily.slice(0, 40) : '';
        out.vrpLabelBg = lblStyle ? lblStyle.backgroundColor : '';

        out.vrpClick = await clickMarker('.rp-marker.rp-vrp');

        // Clic droit sur le VRP : doit l AJOUTER au plan (champ Waypoints),
        // via le même chemin que le bouton « + Waypoint » du popup. Le repère
        // nommé créé porte une zone pin-hit qui COUVRE ensuite le marqueur :
        // d où l ordre (gauche d abord, droit ensuite).
        const wpField = () => document.getElementById('fp-waypoints')?.value || '';
        out.wpBefore = wpField();
        const el = document.querySelector('.rp-marker.rp-vrp');
        if (el) {
            el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            await new Promise(r => setTimeout(r, 800));
        }
        out.wpAfter = wpField();

        out.vorClick = await clickMarker('.rp-marker.rp-vor');
        out.ndbClick = await clickMarker('.rp-marker.rp-ndb');
        return out;
    });

    console.log('    VRP cible :', res.vrp?.name, '—', (res.vrp?.desc || '').slice(0, 50));
    console.log('    marqueurs visibles :', JSON.stringify(res.markers));
    console.log('    élément sous le curseur VRP :', String(res.hitTag).slice(0, 60));
    console.log('    chaîne DOM :', String(res.hitChain).slice(0, 200));
    console.log('    rect marqueur :', JSON.stringify(res.rect));
    console.log('    HTML :', String(res.hitHtml).slice(0, 180));
    console.log('    clic VRP →', String(res.vrpClick).slice(0, 140));
    console.log('    clic VOR →', String(res.vorClick).slice(0, 80));
    console.log('    clic NDB →', String(res.ndbClick).slice(0, 80));
    (res.markers?.vrp > 0) ? ok('marqueurs VRP rendus') : ko('aucun marqueur VRP rendu');
    res.menuClosedAfterCheck ? ok('menu Espaces refermé après la case cochée') : ko('menu resté ouvert au-dessus de la carte');
    String(res.vrpClick).startsWith('popup:') ? ok('popup VRP ouvert') : ko(`clic VRP : ${res.vrpClick}`);
    if (res.vrp?.desc && String(res.vrpClick).includes(res.vrp.desc.slice(0, 20))) ok('description officielle SIA dans le popup');
    String(res.vrpClick).includes('+ Waypoint') ? ok('bouton « + Waypoint » présent') : ko('bouton + Waypoint absent');
    // Le handler add-waypoint (même chemin que le bouton « + Waypoint » du
    // popup, validé) insère le CODE du repère nommé créé (ZZxx, nom = RV-E).
    (res.wpAfter && res.wpAfter !== res.wpBefore && /ZZ[A-Z]{2}/.test(res.wpAfter))
        ? ok('clic droit : VRP ajouté au plan (repère nommé ' + String(res.wpAfter).slice(0, 40) + ' = ' + res.vrp?.name + ')')
        : ko('clic droit : champ Waypoints inchangé (« ' + String(res.wpAfter).slice(0, 60) + ' »)');
    res.vrpLabel && res.vrpLabel.includes('RV-E')
        ? ok('étiquette VRP modèle aérodrome : « ' + res.vrpLabel.slice(0, 50) + ' »')
        : ko('étiquette VRP : ' + JSON.stringify(res.vrpLabel));
    (res.vrpLabelBg === 'rgba(15, 23, 42, 0.95)')
        ? ok('fond de l étiquette = fond des étiquettes aérodromes (hérité du tooltip standard)')
        : ko('fond différent des aérodromes : ' + res.vrpLabelBg);
    (!/DM Mono/i.test(res.vrpLabelFont || ''))
        ? ok('plus de police mono spécifique aux radiophares')
        : ko('police mono résiduelle : ' + res.vrpLabelFont);
    const errClick = errs.find((e) => /rp-|radio|popup|Cannot/i.test(e));
    if (!errClick) ok('aucune erreur JS au clic'); else ko('erreur JS : ' + errClick);
} finally {
    await browser.close().catch(() => {});
    if (server) server.kill();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
