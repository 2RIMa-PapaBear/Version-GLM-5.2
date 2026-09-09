#!/usr/bin/env node
// ============================================================================
// HEALTH-CHECK — surveillance du site et du relais météo (item ②, 09/09).
//
//   node scripts/health-check.mjs
//
// Vérifications :
//   1. SITE HTTPS   https://papabear56.pages-perso.free.fr/ → 200 + version
//   2. RELAIS VIVANT HEAD du Worker Cloudflare → 200
//   3. RELAIS UTILE Worker ?url=<METAR LFRN> → JSON réel (pas PROXY_ERROR)
//   4. UPSTREAM (diagnostic) aviationweather.gov en direct — pour distinguer
//      « relais HS » de « source météo HS » ; non bloquant.
//
// Sortie : une ligne par contrôle, exit 1 si un contrôle CRITIQUE échoue
// (le workflow GitHub échoue → e-mail de notification au pilote).
// Cron : .github/workflows/health-check.yml (toutes les 6 h + manuel).
// ============================================================================
const SITE = 'https://papabear56.pages-perso.free.fr/';
const WORKER = 'https://meteo-relais.papabear56.workers.dev/';
const AW_METAR = 'https://aviationweather.gov/api/data/metar?ids=LFRN&format=json';

const TIMEOUT_MS = 15000;

async function get(url, method = 'GET') {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
        const res = await fetch(url, { method, signal: ac.signal, redirect: 'follow' });
        const text = method === 'HEAD' ? '' : await res.text();
        return { ok: res.ok, status: res.status, text };
    } finally { clearTimeout(t); }
}

let failures = 0;
const ok = (m) => console.log('OK   ' + m);
const ko = (m) => { failures++; console.log('KO   ' + m); };
const info = (m) => console.log('INFO ' + m);

// ---- 1. Site HTTPS (critique) ----------------------------------------------
try {
    const r = await get(SITE);
    const v = (r.text.match(/v=(\d+\.\d+)/) || [])[1];
    if (r.ok && v) ok(`site en ligne : v${v} — ${SITE}`);
    else if (r.ok) ko(`site en ligne mais version illisible (marqueur v= absent) — ${SITE}`);
    else ko(`site injoignable (HTTP ${r.status}) — ${SITE}`);
} catch (e) { ko(`site injoignable (${e.name === 'AbortError' ? 'timeout 15 s' : e.message}) — ${SITE}`); }

// ---- 2. Relais vivant (critique) ---------------------------------------------
try {
    const r = await get(WORKER, 'HEAD');
    r.ok ? ok(`relais vivant (HEAD 200) — ${WORKER}`)
         : ko(`relais ne répond pas au HEAD (HTTP ${r.status}) — ${WORKER}`);
} catch (e) { ko(`relais injoignable (${e.name === 'AbortError' ? 'timeout 15 s' : e.message}) — ${WORKER}`); }

// ---- 3. Relais utile, bout en bout (critique) -------------------------------
try {
    const url = WORKER + '?url=' + encodeURIComponent(AW_METAR);
    const r = await get(url);
    if (!r.ok) { ko(`relais répond HTTP ${r.status} sur un METAR réel`); }
    else if (r.text.startsWith('PROXY_ERROR')) { ko(`relais vivant mais la source échoue : ${r.text.slice(0, 90)}`); }
    else {
        const data = JSON.parse(r.text);
        const raw = Array.isArray(data) && data[0] && (data[0].rawOb || data[0].rawMetar);
        raw ? ok(`relais utile : METAR LFRN traversé (« ${String(raw).slice(0, 40)}… »)`)
            : ko(`relais répond mais format METAR inattendu : ${r.text.slice(0, 80)}`);
    }
} catch (e) { ko(`relais : test METAR bout en bout échoué (${e.name === 'AbortError' ? 'timeout 15 s' : e.message})`); }

// ---- 4. Upstream direct (diagnostic, non bloquant) ---------------------------
try {
    const r = await get(AW_METAR);
    if (r.ok && r.text.includes('LFRN')) info(`upstream aviationweather.gov OK en direct (si 3 a échoué : problème côté relais)`);
    else info(`upstream direct répond HTTP ${r.status} (informatif seulement)`);
} catch { info('upstream direct injoignable depuis ce réseau (informatif seulement)'); }

console.log(failures === 0 ? '\nHEALTH-CHECK : TOUT OK' : `\nHEALTH-CHECK : ${failures} ÉCHEC(S) — notification GitHub si exécuté par le cron`);
process.exit(failures === 0 ? 0 : 1);
