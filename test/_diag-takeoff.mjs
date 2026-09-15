// Diagnostic one-shot (non listé dans npm test) : reproduit « la fenêtre
// Performances piste a disparu » — ouvre localhost:8642, charge LFRV,
// relève les erreurs console et l'état des panneaux takeoff/dossier.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new', args: ['--disable-gpu', '--no-sandbox'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
page.on('console', m => { if (['error', 'warning'].includes(m.type())) console.log(`[console.${m.type()}]`, m.text().slice(0, 180)); });
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 240)));

await page.goto('http://localhost:8642/', { waitUntil: 'networkidle2', timeout: 45000 });
await page.type('#icaoInput', 'LFRV');
await page.click('#btn-fetch-metar');
await new Promise(r => setTimeout(r, 7000));

// ---- Diagnostic vent axial en VOL LOCAL (question pilote 15/09) ----
const hwLocal = await page.evaluate(async () => {
    // Instrumenter le module pour voir les variables internes
    const results = {};
    try {
        const um = await import('/js/ui-module.js');
        results.apt = um.getAirportByICAO('LFRV') ? 'présent (' + um.getAirportByICAO('LFRV').runways?.length + ' pistes)' : 'NULL';
    } catch (e) { results.apt = 'erreur: ' + e.message; }

    // ce que le module voit
    const tp = await import('/js/takeoff-performance.js');
    const r = tp.evaluateLandingPerformance('LFRV');
    results.headwindKt = r?.headwindKt;
    results.runwayName = r?.runwayName;
    results.msg = (r?.message || '').slice(0, 130);
    results.level = r?.level;
    return results;
});
console.log('Vent axial (LOCAL):', JSON.stringify(hwLocal, null, 1));

// ---- Mode Navigation + destination LFOO ----
await page.click('#flight-mode-toggle');
await new Promise(r => setTimeout(r, 800));
await page.type('#route-to-input', 'LFOO');
await page.keyboard.press('Tab');   // déclenche le calcul du plan
await new Promise(r => setTimeout(r, 9000));

// ---- Consultation de l'ARRIVÉE (toggle Départ/Destination) ----
await page.click('.dep-dest-btn[data-side="dest"]');
await new Promise(r => setTimeout(r, 8000));

const st2 = await page.evaluate(() => {
    const el = document.getElementById('takeoff-widget');
    return {
        display: el?.style.display,
        visible: !!el?.offsetParent,
        txtLen: (el?.textContent || '').trim().length,
        collapsed: el?.classList?.contains('open') === false && !!el?.querySelector('.collapsible-header'),
    };
});
console.log('Après consultation arrivée :', JSON.stringify(st2));

const st = await page.evaluate(() => {
    const pick = (id) => {
        const el = document.getElementById(id);
        if (!el) return { absent: true };
        return {
            display: el.style.display,
            visible: !!el.offsetParent,
            txtLen: (el.textContent || '').trim().length,
            htmlLen: (el.innerHTML || '').length,
        };
    };
    return {
        takeoff: pick('takeoff-widget'),
        file: pick('flight-file-panel'),
        planner: pick('flight-planner-panel'),
        alternates: pick('alternates-container'),
    };
});
console.log(JSON.stringify(st, null, 1));

// ---- Modale dossier : bouton grisé tant que les 4 cases ne sont pas cochées ----
const modalCheck = await page.evaluate(() => {
    document.getElementById('fp-navlog-pdf')?.click();
    return new Promise(res => setTimeout(() => {
        const ok = document.querySelector('#navlog-confirm-modal [data-ok]');
        const boxes = [...document.querySelectorAll('#navlog-confirm-modal .docs-check')];
        const before = { disabled: ok?.disabled, n: boxes.length };
        boxes.forEach(b => { b.checked = true; b.dispatchEvent(new Event('change')); });
        const after = { disabled: ok?.disabled };
        document.querySelector('#navlog-confirm-modal [data-cancel]')?.click();
        res({ before, after });
    }, 400));
});
console.log('Modale :', JSON.stringify(modalCheck));

// ---- Substitution olive grise en page réelle (base terrains chargée) ----
const subst = await page.evaluate(async () => {
    const m = await import('/js/takeoff-performance.js');
    const r = await m.fetchMetarWithFallback('LFOO');   // terrain sans METAR NOAA
    const t = await m.fetchTafWithFallback('LFOO');
    return {
        metar: r ? { from: r.from, distNm: r.distNm, raw: (r.raw || '').slice(0, 45) } : null,
        taf: t ? { from: t.from, distNm: t.distNm } : null,
    };
});
console.log('Substitution LFOO :', JSON.stringify(subst));

// ---- Diagnostic vent axial atterrissage (question pilote 15/09) ----
const hw = await page.evaluate(async () => {
    const tp = await import('/js/takeoff-performance.js');
    const r = tp.evaluateLandingPerformance('LFRV');
    return {
        vent_result: r ? {
            headwindKt: r.headwindKt,
            runwayName: r.runwayName,
            level: r.level,
            message: (r.message || '').slice(0, 120),
        } : 'null',
        tafInput: document.getElementById('tafInput')?.value?.slice(0, 60) || '',
    };
});
console.log('Vent axial:', JSON.stringify(hw, null, 1));

// ---- Capture graphique TAF pour le PDF (moteur réel, restauration) ----
const cap = await page.evaluate(async () => {
    const m = await import('/js/taf-chart-capture.js');
    const before = document.getElementById('tafInput')?.value?.slice(0, 30) || '';
    const taf = 'TAF LFRN 131100Z 1312/1412 VRB05KT CAVOK\nBECMG 1315/1317 01010KT\nTEMPO 1321/1324 BKN007';
    const r = await m.captureTafChartPng(taf);
    await new Promise(res => setTimeout(res, 400));
    const after = document.getElementById('tafInput')?.value?.slice(0, 30) || '';
    // PREUVE anti-régression : le PNG capturé ne doit PAS être le graphe
    // affiché à l'écran (le message d'origine, un METAR) — avant le fix
    // rAF, la capture photographiait exactement ce graphe-là.
    const screenNow = document.getElementById('tafCanvas').toDataURL('image/png');
    return r
        ? { ok: true, pngLen: r.png.length, ratio: Math.round(r.ratio * 100) / 100,
            restored: before === after,
            notScreenGraph: r.png !== screenNow }
        : { ok: false };
});
console.log('Capture TAF :', JSON.stringify(cap));
await browser.close();
