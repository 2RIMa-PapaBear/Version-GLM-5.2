// QA réelle (retour pilote 19/09 : « les tuiles du dossier de vol doivent
// être cliquables et renvoyer à la partie concernée ») — chaque tuile mène
// à SA rubrique : Météo → tableau de bord, NOTAM → panneau SOFIA (déplié
// s'il était replié), VAC → visionneuse (première carte à consulter),
// Carburant/Perfs/Centrage → widget correspondant, ou la FLOTTE quand la
// rubrique n'est pas calculable (profil sans références wb). Le bouton
// « Voir » d'une ligne VAC garde son comportement propre, et le clavier
// (Entrée) active la tuile. Usage : node test/qa-ff-tile-nav.mjs
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = http.createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]); if (p === '/') p = '/index.html';
    fs.readFile(path.join(root, p), (e, d) => {
        if (e) { res.writeHead(404); res.end(); return; }
        const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.pdf': 'application/pdf' }[path.extname(p)] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': mime }); res.end(d);
    });
});
await new Promise(r => server.listen(8656, r));

let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const ko = (m) => { failures++; console.log('KO  ' + m); };

// Flotte QA avec un bloc wb VALIDE → widget Centrage visible (phase 2).
const FLEET_WB = [{
    id: 'qa_wb', name: 'QA WB', registration: 'F-QAQA', type: 'C172',
    groundRoll: 830, fiftyFt: 1400, safetyMargin: 20,
    cruiseSpeedKt: 110, fuelBurnLph: 35, ldgRoll: 725, ldgFifty: 1400,
    wb: {
        // NB : la flotte lue depuis localStorage n'est PAS re-sanitisée —
        // le bloc doit être complet (units, fuelDensity) comme un vrai
        // enregistrement passé par la flotte.
        units: { mass: 'kg', arm: 'mm' }, fuelDensity: 0.72,
        emptyMassKg: 600, emptyArmMm: 300, mtowKg: 750,
        envelope: [[600, 2800], [600, 3300], [750, 3300], [750, 2800]],
        stations: [{ name: 'Pilote', armMm: 2900 }, { name: 'Carburant', armMm: 3100, fuel: true }],
    },
}];

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new',
    args: ['--disable-gpu', '--no-sandbox', '--lang=fr'],
});
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 900 });
    page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 140)));
    // Piège connu : une alerte/confirm (ex. carburant insuffisant du plan
    // QA sans embarqué) FIGE le thread headless → tout callFunctionOn
    // timeout. On accepte les dialogues automatiquement.
    page.on('dialog', (d) => d.accept().catch(() => {}));
    // Espion scrollIntoView : enregistre la cible (id) de chaque défilement.
    await page.evaluateOnNewDocument(() => {
        window.__scrolled = [];
        Element.prototype.scrollIntoView = function () {
            window.__scrolled.push(this.id || (this.className || '').toString().slice(0, 40));
        };
    });
    const loadApp = async () => {
        await page.goto('http://127.0.0.1:8656/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
        await page.waitForFunction(() => document.querySelectorAll('.ff-tile[data-goto]').length === 6, { timeout: 60000 });
        await page.waitForFunction(() => !!document.getElementById('notam-panel'), { timeout: 20000 });
        await new Promise(r => setTimeout(r, 500));
    };
    const lastScroll = () => page.evaluate(() => window.__scrolled[window.__scrolled.length - 1]);
    const clickTile = (key) => page.evaluate((k) => {
        document.querySelector(`.ff-tile[data-goto="${k}"]`)?.click();
    }, key);
    const visible = (sel) => page.evaluate((s) => {
        const el = document.querySelector(s);
        return !!el && el.offsetParent !== null;
    }, sel);

    // ---------- Phase 1 : profil vierge (mode local, centrage NON configuré)
    await loadApp();
    ok('6 tuiles cliquables + panneau NOTAM montés (profil vierge, LFRV)');

    await clickTile('weather');
    (await lastScroll()) === 'metar-dashboard' ? ok('Météo → tableau de bord METAR')
        : ko('Météo → ' + await lastScroll());

    // NOTAM : cible REPLIÉE → le clic doit la DÉPLIER puis défiler.
    await page.evaluate(() => {
        const p = document.getElementById('notam-panel');
        p.classList.remove('open');
        localStorage.setItem('collapse-notam-panel', '0');
    });
    await clickTile('notam');
    const notamRes = await page.evaluate(() => ({
        open: document.getElementById('notam-panel').classList.contains('open'),
        last: window.__scrolled[window.__scrolled.length - 1],
    }));
    notamRes.open && notamRes.last === 'notam-panel'
        ? ok('NOTAM → panneau SOFIA, DÉPLIÉ par le clic')
        : ko(`NOTAM → open=${notamRes.open} scroll=${notamRes.last}`);

    // Perfs piste : widget visible sur profil vierge (C172 par défaut).
    const toVisible = await visible('#takeoff-widget');
    await clickTile('perf');
    const perfScroll = await lastScroll();
    (toVisible ? perfScroll === 'takeoff-widget' : perfScroll)
        ? ok(toVisible ? 'Perfs piste → widget Performances piste' : 'Perfs piste → (widget masqué) ' + perfScroll)
        : ko('Perfs piste → ' + perfScroll);

    // Carburant (local, sans plan ni centrage) → la FLOTTE s'ouvre.
    await clickTile('fuel');
    await page.waitForFunction(() => !!document.getElementById('fleet-overlay'), { timeout: 8000 }).catch(() => {});
    (await page.evaluate(() => !!document.getElementById('fleet-overlay')))
        ? ok('Carburant non calculable → gestionnaire de flotte ouvert')
        : ko('Carburant → ni widget ni flotte (' + await lastScroll() + ')');
    await page.evaluate(() => document.getElementById('fleet-overlay')?.remove());

    // Centrage non configuré → la FLOTTE s'ouvre (même repli).
    await clickTile('wb');
    await page.waitForFunction(() => !!document.getElementById('fleet-overlay'), { timeout: 8000 }).catch(() => {});
    (await page.evaluate(() => !!document.getElementById('fleet-overlay')))
        ? ok('Centrage non configuré → gestionnaire de flotte ouvert')
        : ko('Centrage → ni widget ni flotte');
    await page.evaluate(() => document.getElementById('fleet-overlay')?.remove());

    // VAC : la tuile ouvre la PREMIÈRE carte à consulter (LFRV ici).
    await page.evaluate(() => localStorage.removeItem('vac-consulted'));
    await page.evaluate(() => { window.__scrolled = []; });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => document.querySelectorAll('.ff-tile[data-goto]').length === 6, { timeout: 60000 });
    await new Promise(r => setTimeout(r, 500));
    await clickTile('vac');
    await page.waitForFunction(() => !!document.getElementById('vac-overlay'), { timeout: 20000 }).catch(() => {});
    const vacOpen = await page.evaluate(() => !!document.getElementById('vac-overlay'));
    vacOpen ? ok('VAC → visionneuse ouverte (première carte à consulter)') : ko('VAC → pas de visionneuse');
    if (vacOpen) await page.evaluate(() => document.querySelector('#vac-overlay button[data-vac="close"]')?.click());
    await new Promise(r => setTimeout(r, 400));

    // Le bouton « Voir » d'une ligne garde son action propre (pas doublé).
    const voirBtn = await page.evaluate(() => {
        const b = document.querySelector('.ff-tile[data-goto="vac"] button[data-vac]');
        b?.click();
        return b?.dataset.vac || null;
    });
    await page.waitForFunction(() => !!document.getElementById('vac-overlay'), { timeout: 20000 }).catch(() => {});
    (await page.evaluate(() => !!document.getElementById('vac-overlay')))
        ? ok(`bouton « Voir » (${voirBtn}) → visionneuse (comportement inchangé)`)
        : ko('bouton « Voir » ne fonctionne plus');
    await page.evaluate(() => {
        document.querySelector('#vac-overlay button[data-vac="close"]')?.click();
        document.getElementById('vac-overlay')?.remove();
    });

    // Clavier : Entrée sur la tuile NOTAM = même navigation.
    await page.evaluate(() => { window.__scrolled = []; });
    await page.focus('.ff-tile[data-goto="notam"]');
    await page.keyboard.press('Enter');
    (await lastScroll()) === 'notam-panel' ? ok('Entrée clavier sur la tuile NOTAM → panneau')
        : ko('Entrée → ' + await lastScroll());

    // ---------- Phase 2 : flotte AVEC centrage → widgets visibles
    await page.evaluate((fleet) => {
        localStorage.setItem('ac-fleet', JSON.stringify(fleet));
        localStorage.setItem('ac-active-id', 'qa_wb');
    }, FLEET_WB);
    await loadApp();
    const wbVis = await visible('#wb-widget');
    if (!wbVis) ko('widget Centrage devrait être visible avec la flotte QA wb');
    await page.evaluate(() => { window.__scrolled = []; });
    await clickTile('fuel');
    (await lastScroll()) === 'wb-widget' ? ok('Carburant (vol local) → widget Centrage (durée/embarqué)')
        : ko('Carburant → ' + await lastScroll());
    await page.evaluate(() => { window.__scrolled = []; });
    await clickTile('wb');
    (await lastScroll()) === 'wb-widget' ? ok('Centrage configuré → widget Centrage')
        : ko('Centrage → ' + await lastScroll());

    // ---------- Phase 3 : mode NAVIGATION → Carburant = devis du plan
    await page.click('#flight-mode-toggle');
    // Le planner n'apparaît qu'avec une destination (LFRV → LFOO).
    await page.evaluate(() => {
        const inp = document.getElementById('route-to-input');
        inp.value = 'LFOO';
        inp.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForFunction(() => {
        const p = document.getElementById('flight-planner-panel');
        return p && p.offsetParent !== null;
    }, { timeout: 30000 }).catch(() => {});
    const plannerVis = await visible('#flight-planner-panel');
    if (!plannerVis) ko('panneau Calcul de navigation devrait être visible en mode nav');
    await page.evaluate(() => { window.__scrolled = []; });
    await clickTile('fuel');
    (await lastScroll()) === 'flight-planner-panel'
        ? ok('Carburant (navigation) → Calcul de navigation (devis du plan)')
        : ko('Carburant nav → ' + await lastScroll());
} finally {
    await browser.close().catch(() => {});
    server.close();
}
console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
