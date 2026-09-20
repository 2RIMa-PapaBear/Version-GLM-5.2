// QA DOSSIER PDF « VOL LOCAL » (19/09) : bouton verrouillé tant que les
// rubriques ne sont pas vertes (VAC exceptée), confirmation adaptée,
// génération complète (garde / log terrain / météo / NOTAM / carte / VAC /
// centrage) et mode navigation inchangé. Lent (~2 min, réseau réel pour
// tuiles et VAC) — hors `npm test`, exécution manuelle comme les autres qa-*.
// PIÈGE harnais : ne pas attacher de session CDP au popup (t.page() sur
// targetcreated) — le rendu pdfjs des VAC y serait suspendu en headless.
import puppeteer from 'puppeteer-core';
const browser = await puppeteer.launch({
    executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe',
    headless: 'new', args: ['--disable-gpu', '--no-sandbox'],
});
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };
try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 860 });
    // PIÈGE harnais (cf. qa-fuel-details) : avec une durée locale saisie et
    // 0 L embarqué, l'alerte synchrone « CARBURANT INSUFFISANT » FIGE un
    // headless — on la dismiss.
    page.on('dialog', d => d.dismiss());
    const errs = [];
    page.on('pageerror', e => errs.push(String(e).slice(0, 140)));
    await page.setRequestInterception(true);
    page.on('request', req => {
        const u = req.url();
        if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
            req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
        } else req.continue();
    });
    await page.evaluateOnNewDocument(() => {
        const ac = {
            id: 'ac_qa_wt9', name: 'Dynamic WT9 Club', registration: 'F-HVXJ', type: 'WT9-LSA',
            groundRoll: 540, fiftyFt: 1148, safetyMargin: 15,
            cruiseSpeedKt: 100, fuelBurnLph: 18, unusableFuelL: 6,
            xwindLimitKt: 25, reserveExtraMin: 5, ldgRoll: 246, ldgFifty: 863,
            wb: {
                units: { mass: 'kg', arm: 'm' }, emptyMassKg: 354, emptyArmMm: 2641,
                mtowKg: 600, refMassKg: null, fuelDensity: 0.72,
                envelope: [[405, 2704], [405, 2704], [542.5, 2704], [600, 2748], [600, 2824], [465.3, 2824], [445, 2810], [405, 2713]],
                stations: [
                    { name: 'Pilote', armMm: 3130, maxKg: 130, fuel: false },
                    { name: 'Passager 1', armMm: 3130, maxKg: 130, fuel: false },
                    { name: 'Bagages', armMm: 3795, maxKg: 40, fuel: false },
                    { name: 'Carburant', armMm: 2580, maxKg: 119, fuel: true },
                ],
            },
        };
        localStorage.setItem('ac-fleet', JSON.stringify([ac]));
        localStorage.setItem('ac-active-id', 'ac_qa_wt9');
        localStorage.setItem('wb-local-min', '60');
    });

    // ① LOCAL, rubriques incomplètes (pas de METAR/NOTAM chargés) : bouton
    // grisé + infobulle règle « au vert sauf VAC ».
    await page.goto('http://localhost:8644/index.html?icao=LFRV', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForFunction(() => document.getElementById('ff-print') !== null, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 600));
    const localBtn = await page.evaluate(() => {
        const b = document.getElementById('ff-print');
        return { disabled: b.disabled, title: b.title };
    });
    (localBtn.disabled === true ? ok : ko)('local, rubriques non vertes : bouton grisé');
    (/VAC est facultative/.test(localBtn.title) ? ok : ko)('infobulle locale = règle « au vert, VAC facultative »');

    // ② Génération E2E du dossier local (appel direct, hors verrou) :
    // confirmation adaptée vol local → cases cochées → PDF dans un onglet.
    // PIÈGE harnais : NE PAS attacher de session CDP au popup (t.page() sur
    // targetcreated) — le rendu pdfjs des VAC y serait suspendu en headless
    // (cf. vac-viewer « rendu suspendu »). Observation uniquement via
    // window.__tab depuis la page principale.
    await page.evaluate(async () => {
        const mod = await import('./js/flight-planner-ui.js');
        mod.printFlightFile();
    });
    await page.waitForFunction(() => document.getElementById('navlog-confirm-modal'), { timeout: 15000 });
    const confirmLocal = await page.evaluate(() => {
        const m = document.getElementById('navlog-confirm-modal');
        return { local: /vol local/.test(m.textContent), duree: /Durée estimée/.test(m.textContent), caps: /Caps \(RM\/CM\)/.test(m.textContent) };
    });
    (confirmLocal.local && confirmLocal.duree && !confirmLocal.caps ? ok : ko)(`confirmation adaptée vol local (durée, sans caps) : ${JSON.stringify(confirmLocal)}`);
    await page.evaluate(() => {
        // Observable depuis la page principale : capture la référence de
        // l'onglet ouvert — AUCUN accès CDP direct au popup (le interpeller
        // pendant document.write le bloque en headless).
        const _open = window.open.bind(window);
        window.open = function (...a) { const t = _open(...a); window.__tab = t; return t; };
        document.querySelectorAll('#navlog-confirm-modal .docs-check').forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    });
    await new Promise(r => setTimeout(r, 300));
    const okEnabled = await page.evaluate(() => !document.querySelector('#navlog-confirm-modal [data-ok]')?.disabled);
    (okEnabled ? ok : ko)('cases cochées → bouton d\u2019impression déverrouillé');
    await page.evaluate(() => document.querySelector('#navlog-confirm-modal [data-ok]')?.click());

    page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') console.log('  [page]', m.type(), m.text().slice(0, 160)); });
    // Observation DEPUIS la page principale : l'onglet capturé porte-t-il
    // l'iframe du PDF ? (attente plate 45 s puis lectures espacées)
    let etat = null;
    for (const delai of [30000, 30000, 30000, 30000]) {
        await new Promise(r => setTimeout(r, delai));
        etat = await page.evaluate(() => {
            const t = window.__tab;
            if (!t) return { absent: true };
            if (t.closed) return { ferme: true };
            return {
                iframe: !!t.document.querySelector('iframe'),
                title: t.document.title || '',
                pdfLen: (t.document.querySelector('iframe')?.src || '').length,
            };
        }).catch(e => ({ err: String(e).slice(0, 80) }));
        if (etat?.iframe) break;
    }
    (etat?.iframe && /Dossier de vol local LFRV/.test(etat.title || '') ? ok : ko)(`onglet PDF local : « ${etat?.title || '(vide)'} » · iframe ${etat?.iframe ? 'présent (' + Math.round((etat.pdfLen || 0) / 1024) + ' Ko)' : 'absent'}`);

    // ③ NAV inchangée : destination → bouton actif (onglet NEUF, isolé de la
    // génération précédente).
    const page3 = await browser.newPage();
    page3.on('dialog', d => d.dismiss());
    await page3.setRequestInterception(true);
    page3.on('request', req => {
        const u = req.url();
        if (/script\.google|corsproxy|aviationweather|open-meteo|api\.core\.openaip/.test(u)) {
            req.respond({ status: 200, contentType: 'text/plain', headers: { 'Access-Control-Allow-Origin': '*' }, body: ' ' });
        } else req.continue();
    });
    await page3.goto('http://localhost:8644/index.html?icao=LFRV&mode=nav&dest=LFOO', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page3.waitForFunction(() => document.getElementById('ff-print') !== null, { timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));
    const navBtn = await page3.evaluate(() => !document.getElementById('ff-print').disabled);
    (navBtn ? ok : ko)('navigation avec destination : bouton actif (inchangé)');
    await page3.close();

    (errs.length === 0 ? ok : ko)('zéro erreur JS' + (errs.length ? ' — ' + errs[0] : ''));
} catch (e) {
    failures++;
    console.log('ERREUR E2E :', String(e && e.stack || e).slice(0, 500));
} finally {
    await browser.close();
    console.log(failures === 0 ? 'E2E LOCAL OK' : `E2E LOCAL KO (${failures})`);
    process.exit(failures === 0 ? 0 : 1);
}
