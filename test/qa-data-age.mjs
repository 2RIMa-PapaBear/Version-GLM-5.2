// QA DATA-AGE (localhost:8642, app réelle, RÉSEAU RÉEL) :
//   ① chargement METAR réel → badge visible, niveau cohérent avec l'âge ;
//   ② panne réseau (abort de tout trafic météo) → le badge conserve
//      l'observation précédente en ROUGE « Réseau indisponible ».
// NB : la chaîne de chargement (direct → relais → parallèle + enrichissements)
// peut prendre 20-30 s — on SCRUTE, jamais de délai fixe.
import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe', headless: 'new', args: ['--disable-gpu', '--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 1280, height: 900 });
const jsErrors = [];
page.on('pageerror', e => jsErrors.push(e.message));
let failures = 0;
const ok = m => console.log('OK  ' + m);
const ko = m => { failures++; console.log('KO  ' + m); };

await page.goto('http://localhost:8642/', { waitUntil: 'domcontentloaded', timeout: 45000 });
await page.type('#icaoInput', 'LFRN');
await page.click('#btn-fetch-metar');

// ① Badge rempli par le METAR réel
await page.waitForFunction(() => {
    const el = document.getElementById('data-age-badge');
    return el && el.style.display !== 'none' && /(il y a|ago) \d+ min/.test(el.textContent);
}, { timeout: 150000 }).catch(() => {});   // chaîne 3 fetchs avec repli : ~40-80 s en headless
let b = await page.evaluate(() => {
    const el = document.getElementById('data-age-badge');
    return el ? { text: el.textContent, cls: el.className } : null;
});
b && /(il y a|ago) \d+ min/.test(b.text) ? ok(`badge visible : « ${b.text} » (${b.cls})`) : ko('badge absent : ' + JSON.stringify(b));

// Niveau cohérent avec l'âge affiché
const coh = await page.evaluate(() => {
    const el = document.getElementById('data-age-badge');
    const m = el && el.textContent.match(/(\d+) min/);
    if (!m) return null;
    const min = parseInt(m[1], 10);
    const expected = min < 56 ? 'age-fresh' : min < 116 ? 'age-aging' : 'age-old';
    return { min, expected, pass: el.className.includes(expected) };
});
coh && coh.pass ? ok(`niveau cohérent : ${coh.min} min → ${coh.expected}`) : ko('niveau incohérent : ' + JSON.stringify(coh));

// ② Panne réseau : NON testable ici — le service worker court-circuite
// l'interception page (ses propres fetchs ne passent pas par les aborts
// puppeteer). Le comportement « réseau indisponible → observation conservée
// en rouge » est couvert par les tests unitaires nextAgeState (npm test).

if (jsErrors.length) ko('erreurs JS : ' + jsErrors.join(' | ')); else ok('aucune erreur JS');
console.log(failures === 0 ? '\nDATA-AGE : TOUT OK' : `\nDATA-AGE : ${failures} ÉCHEC(S)`);
await browser.close();
process.exit(failures === 0 ? 0 : 1);
