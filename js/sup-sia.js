/* ================================================================
 * SUP AIP SÉRIE A (B4, 16/09) — Suppléments AIP France métropole.
 * ================================================================
 *
 * Source OFFICIELLE : portail SIA (page publique « SUP AIP METROPOLE »),
 * régénérée en data/sup-sia.json par le robot hebdo
 * (scripts/fetch-sup-sia.mjs, workflow update-radio-points.yml).
 *
 * PANNEAU « Sup AIP (SIA) » sous le tableau de bord (modes vol local ET
 * navigation) : liste datée des Sup en vigueur — par défaut VFR et
 * valides aujourd'hui —, recherche libre, et mise en avant des Sup qui
 * citent un terrain du plan (départ, waypoints, arrivée, dégagement) :
 * les ZRT/ZDT temporaires des exercices y sont annoncées AVANT leur
 * apparition en NOTAM. Le PDF officiel SIA s'ouvre dans un onglet
 * (documents/download — public).
 *
 * Node-safe : DOM gardé par typeof document.
 */
import { state } from './core.js';

import { makeCollapsible } from './collapsible.js';

import { getAirportByICAO, getAirportsInBbox } from './ui-module.js';

// Chemin RELATIF au canal (PAS bigDataUrl : sa redirection racine-prod ne
// vaut que pour les données volumineuses partagées cells/VAC — sur /test/,
// sup-sia.json est servi par /test/data/ par deploy-test ; en racine par pub).
const LIST_URL = () => 'data/sup-sia.json';
const CACHE_TTL_MS = 24 * 3600 * 1000;

// ---- Cache IDB (base « metar-taf-cache » commune) --------------------------
const IDB_NAME = 'metar-taf-cache';
const IDB_STORE = 'cache';
function _idb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idb();
        return await new Promise((resolve, reject) => {
            const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    } catch { return null; }
}
async function _idbPut(key, val) {
    try {
        const db = await _idb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(val, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* best effort */ }
}

/** Charge la base Sup (cache 24 h). null en échec complet. */
export async function loadSupSia() {
    const key = 'sup-sia:list';
    const hit = await _idbGet(key);
    if (hit?.data?.items?.length && Date.now() - hit.ts < CACHE_TTL_MS) return hit.data;
    try {
        const r = await fetch(LIST_URL() + '?t=' + (hit?.ts || 0), { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!Array.isArray(data?.items) || !data.items.length) throw new Error('réponse sans Sup');
        await _idbPut(key, { ts: Date.now(), data });
        return data;
    } catch (e) {
        console.warn('Sup AIP indisponibles :', e.message);
        return hit?.data ?? null;
    }
}

/** La Sup est-elle en vigueur à la date donnée (bornes incluses) ? */
export function supActiveOn(sup, dayIso) {
    return (!sup.start || sup.start <= dayIso) && (!sup.end || sup.end >= dayIso);
}

/** Terrains du plan cités dans l'objet d'une Sup (LFxx en clair). */
export function supMatches(sup, icaos) {
    const hits = [];
    const s = String(sup.subject || '').toUpperCase();
    for (const icao of icaos || []) {
        if (icao && s.includes(icao)) hits.push(icao);
    }
    return hits;
}

/** Terrains dont le NOM est cité dans l'objet — beaucoup de Sup désignent la
 *  zone par le nom de l'AD (« région de FIGARI (2A) ») sans code OACI.
 *  Mots de ≥ 4 lettres du nom, insensibles à la casse (accents compris) ;
 *  retourne les ICAO des candidats dont le nom est cité. */
export function supMatchesNames(sup, candidats) {
    const s = String(sup.subject || '').toUpperCase();
    const out = [];
    for (const c of candidats || []) {
        if (!c?.icao || out.includes(c.icao)) continue;
        const mots = String(c.name || '').toUpperCase()
            .split(/[^A-ZÀ-ÖØ-Þ]+/).filter(w => w.length >= 4);
        if (mots.some(w => s.includes(w))) out.push(c.icao);
    }
    return out;
}

// ---- Régions & zones cardinales : la plupart des Sup citent une RÉGION
// (« région de Nîmes », « Sud-Est »), pas un code OACI. Boîtes englobantes
// approximatives (régions administratives +.cardinaux) : elles SERVENT À
// PROMOUVOIR des Sup près du trajet, jamais à en masquer.
const REGIONS = [
    ['Bretagne', 47.2, 49.1, -5.6, -1.0],
    ['Pays de la Loire', 46.1, 48.6, -2.6, 1.0],
    ['Normandie', 48.2, 50.3, -2.2, 1.9],
    ['Île-de-France', 48.1, 49.2, 1.3, 3.7],
    ['Hauts-de-France', 49.1, 51.2, 0.9, 4.4],
    ['Grand Est', 47.3, 50.4, 3.2, 8.3],
    ['Bourgogne-Franche-Comté', 46.1, 48.7, 2.6, 7.1],
    ['Centre-Val de Loire', 46.1, 48.7, 0.1, 3.3],
    ['Nouvelle-Aquitaine', 42.6, 46.9, -2.0, 3.1],
    ['Auvergne-Rhône-Alpes', 43.8, 46.9, 1.9, 7.3],
    ['Occitanie', 42.2, 45.0, -0.4, 4.9],
    ['Provence-Alpes-Côte d’Azur', 42.8, 45.1, 4.1, 7.8],
    ['Corse', 41.3, 43.1, 8.4, 9.7],
];
// Alias fréquents dans les libellés SIA (mot → régions couvertes).
const REGION_ALIASES = [
    ['Sud-Est', ['Provence-Alpes-Côte d’Azur', 'Auvergne-Rhône-Alpes', 'Occitanie', 'Corse']],
    ['Sud-Ouest', ['Nouvelle-Aquitaine', 'Occitanie']],
    ['Nord', ['Hauts-de-France', 'Normandie', 'Île-de-France']],
    ['Est', ['Grand Est', 'Bourgogne-Franche-Comté']],
    ['Ouest', ['Bretagne', 'Pays de la Loire', 'Normandie', 'Nouvelle-Aquitaine']],
];

/** Régions administratives contenant un point (lat, lon). */
export function regionsForPoint(lat, lon) {
    const out = [];
    for (const [name, la, lb, oa, ob] of REGIONS) {
        if (lat >= la && lat <= lb && lon >= oa && lon <= ob) out.push(name);
    }
    return out;
}

/** Pertinence d'une Sup pour un trajet : ICAO cités + régions/cardinaux
 *  du trajet cités dans l'objet. Retourne { icaos, regions } (listes des
 *  raisons de mise en avant — vides = non pertinente). */
export function supRelevance(sup, planRegions) {
    const subj = String(sup.subject || '');
    const low = subj.toLowerCase();
    const regions = [];
    for (const r of planRegions || []) {
        if (r && low.includes(r.toLowerCase()) && !regions.includes(r)) regions.push(r);
    }
    // Alias : « Sud-Est » compte si le trajet touche une région couverte.
    // Frontières de mots : « Ouest » contient « est » — et un alias contenu
    // dans un alias déjà retenu (« Est » ⊂ « Sud-Est ») ne compte pas deux fois.
    for (const [alias, covers] of REGION_ALIASES) {
        if (!new RegExp('(^|[^A-Za-z])' + alias, 'i').test(subj)) continue;
        if (regions.some(r => r !== alias && r.endsWith(alias))) continue;
        if ((planRegions || []).some(r => covers.includes(r)) && !regions.includes(alias)) regions.push(alias);
    }
    return { regions };
}

/** Régions du plan courant (waypoints/extrémités/dégagement). */
export function planRegions() {
    const pts = [];
    const plan = state._lastNavPlan?.plan;
    if (plan?.waypoints?.length) pts.push(...plan.waypoints);
    else if (plan?.from) pts.push(plan.from, plan.to);
    const set = new Set();
    for (const p of pts) {
        if (Number.isFinite(p?.lat) && Number.isFinite(p?.lon)) {
            regionsForPoint(p.lat, p.lon).forEach(r => set.add(r));
        }
    }
    return [...set];
}

/** ICAOs du plan courant (départ → waypoints → arrivée → dégagement). */
export function planIcaos() {
    const out = new Set();
    const add = (c) => { if (c && /^[A-Z][A-Z0-9]{3}$/.test(c)) out.add(c); };
    const plan = state._lastNavPlan?.plan;
    if (plan?.waypoints?.length) plan.waypoints.forEach(w => add(w.icao));
    else { add(plan?.from?.icao); add(plan?.to?.icao); }
    add(state.diversionIcao);
    if (document && typeof document !== 'undefined') {
        add((document.getElementById('route-to-input')?.value || '').trim().toUpperCase());
    }
    return [...out];
}

// ---- Panneau ----------------------------------------------------------------

let _panel = null;

/** Filtres persistés le temps de la session (pas de localStorage : état volatil). */
const _filters = { vfrOnly: true, todayOnly: true, q: '' };

function _render(data) {
    // Accepte l enveloppe {generatedAt, items} OU le tableau brut (les
    // appelants historiques passaient les deux — un filter sur l enveloppe
    // jetait silencieusement via le .catch de l init).
    if (data) _lastData = data;
    const items = Array.isArray(data) ? data : (data?.items || []);
    const isFr = state.lang === 'fr';
    const body = _panel?.querySelector('.sup-body');
    if (!body) return;
    const dayIso = new Date().toISOString().slice(0, 10);
    const isNav = document.body.classList.contains('mode-nav');
    // Vol local (retour pilote 20/09) : le terrain observé tient lieu de plan —
    // son ICAO, les régions couvertes par sa position ET les terrains du
    // voisinage (≤ 50 NM, piste ≥ 1 000 m — même filtre que les pastilles) :
    // une ZRT « à proximité de l'AD LFRH » doit remonter quand l'app est
    // ouverte sur LFRV.
    const icaos = isNav ? planIcaos() : (state.requestedIcao ? [state.requestedIcao] : []);
    let regs = isNav ? planRegions() : [];
    if (!isNav && state.requestedIcao) {
        const apt = getAirportByICAO(state.requestedIcao);
        if (apt && Number.isFinite(apt.lat) && Number.isFinite(apt.lon)) {
            regs = regionsForPoint(apt.lat, apt.lon);
            const R_KM = 50 * 1.852;                        // voisinage 50 NM
            const dLat = R_KM / 111.32;
            const dLon = R_KM / (111.32 * Math.max(0.3, Math.cos(apt.lat * Math.PI / 180)));
            const voisins = getAirportsInBbox(apt.lat - dLat, apt.lon - dLon, apt.lat + dLat, apt.lon + dLon);
            for (const v of voisins) {
                if (v.icao !== state.requestedIcao && !icaos.includes(v.icao)) icaos.push(v.icao);
            }
        }
    }
    const q = _filters.q.trim().toLowerCase();

    let rows = items;
    if (_filters.todayOnly) rows = rows.filter(s => supActiveOn(s, dayIso));
    if (_filters.vfrOnly) rows = rows.filter(s => s.vfr);
    if (q) rows = rows.filter(s => (s.num + ' ' + s.subject).toLowerCase().includes(q));
    // Pertinence au TRAJET : ICAO du plan cités (fort) + régions/cardinaux
    // du trajet cités dans l'objet (« région de Nîmes », « Sud-Est ») —
    // les deux font remonter la Sup en tête (retour pilote 16/09 : le tri
    // sur le trajet ne s'exprimait pas car les Sup citent des régions).
    // Noms des terrains candidats (base locale) pour le matching par nom.
    const candidats = icaos.map(c => {
        const a = getAirportByICAO(c);
        return { icao: c, name: a?.name || '' };
    });
    const relOf = (s) => {
        const iDirect = supMatches(s, icaos);
        const iNom = supMatchesNames(s, candidats).filter(x => !iDirect.includes(x));
        const r = supRelevance(s, regs).regions;
        return { i: [...iDirect, ...iNom], r, n: iDirect.length + iNom.length + r.length };
    };
    const matched = rows.map(s => ({ s, rel: relOf(s) }));
    matched.sort((a, b) => (b.rel.n - a.rel.n) || (b.s.num > a.s.num ? 1 : -1));

    const nMatch = matched.filter(x => x.rel.n).length;
    _panel.querySelector('.sup-summary').innerHTML = isFr
        ? `${items.length} Sup SIA en vigueur (maj ${new Date(data?.generatedAt || Date.now()).toLocaleDateString()})`
            + ` — affichées : ${matched.length}${nMatch ? ` dont <b style="color:#FBBF24;">${nMatch} pour votre vol</b>` : ''}`
        : `${items.length} SIA SUP in force — shown: ${matched.length}`;

    body.innerHTML = matched.length ? matched.map(({ s, rel }) => {
        const m = rel.i, rg = rel.r;
        return `
        <div class="sup-row${rel.n ? ' sup-match' : ''}">
            <div class="sup-line1">
                <b class="sup-num">${s.num}</b>
                <span class="sup-dates">${s.start || '?'} → ${s.end || '?'}</span>
                <span class="sup-chips">${s.vfr ? '<i>VFR</i>' : ''}${s.ifr ? '<i>IFR</i>' : ''}${s.airac ? '<i>AIRAC</i>' : ''}</span>
                ${rel.n ? `<span class="sup-plan">${isFr ? 'votre vol' : 'your flight'} · ${[...m, ...rg].join(' ')}</span>` : ''}
                <a class="sup-pdf" href="${s.url}" target="_blank" rel="noopener" title="${isFr ? 'PDF officiel SIA (nouvel onglet)' : 'Official SIA PDF (new tab)'}">PDF ↗</a>
            </div>
            <div class="sup-subject">${_esc(s.subject)}</div>
        </div>`;
    }).join('')
        : `<div class="sup-empty">${isFr ? 'Aucune Sup ne correspond aux filtres.' : 'No SUP matches the filters.'}</div>`;
    _renduPourIcao = state.requestedIcao || null;
}

function _esc(s) {
    return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Montre le panneau (idempotent). Panneau de DONNÉES : modes local ET nav. */
export async function initSupPanel() {
    if (typeof document === 'undefined') return;
    if (_panel) { _render(await loadSupSia() || { items: [] }); return; }
    const isFr = state.lang === 'fr';

    // POSITION (retour pilote 16/09) : entre le NOTAM et le « Calcul de
    // navigation ». Le panneau NOTAM s'insère juste APRÈS
    // #flight-planner-panel (cf. notam.js _mount) → le Sup AIP se place
    // immédiatement après ce même panneau : Calcul de navigation → Sup AIP
    // → NOTAM. En vol local (planner masqué), repli sous le tableau de bord.
    const planner = document.getElementById('flight-planner-panel');
    const dash = document.getElementById('metar-dashboard');
    const parent = planner?.parentElement || dash?.parentElement;
    if (!parent) return;
    _panel = document.createElement('aside');
    _panel.id = 'sup-panel';
    _panel.className = 'card';
    // Si le NOTAM est déjà monté (planner → notam), passer DEVANT lui ;
    // sinon juste après le planner (le NOTAM viendra derrière, cf. notam.js).
    const notam = document.getElementById('notam-panel');
    if (notam && notam.parentElement === parent) parent.insertBefore(_panel, notam);
    else if (planner && planner.parentElement) parent.insertBefore(_panel, planner.nextSibling);
    else parent.insertBefore(_panel, dash.nextSibling);

    const body = makeCollapsible(_panel, isFr ? 'Sup AIP (SIA)' : 'AIP SUP (SIA)', 'file-plus');
    body.innerHTML = `
        <div class="sup-summary" style="font-size:12px;color:var(--text-muted);margin:2px 0 6px;"></div>
        <div class="sup-filters">
            <label><input type="checkbox" class="sup-f-vfr" checked> ${isFr ? 'VFR' : 'VFR'}</label>
            <label><input type="checkbox" class="sup-f-today" checked> ${isFr ? "en vigueur aujourd'hui" : 'in force today'}</label>
            <input type="search" class="sup-f-q" placeholder="${isFr ? 'Rechercher (numéro, objet…)' : 'Search (number, subject…)'}">
        </div>
        <div class="sup-body"></div>`;
    body.querySelector('.sup-f-vfr').addEventListener('change', (e) => { _filters.vfrOnly = e.target.checked; _render(_lastData || { items: [] }); });
    body.querySelector('.sup-f-today').addEventListener('change', (e) => { _filters.todayOnly = e.target.checked; _render(_lastData || { items: [] }); });
    let qT;
    body.querySelector('.sup-f-q').addEventListener('input', (e) => {
        clearTimeout(qT);
        qT = setTimeout(() => { _filters.q = e.target.value; _render(_lastData || { items: [] }); }, 180);
    });

    const data = await loadSupSia();
    _lastData = data || { items: [] };
    if (!data) {
        _panel.querySelector('.sup-summary').textContent = isFr
            ? 'Base Sup SIA indisponible (réessayez plus tard).' : 'SIA SUP base unavailable.';
        return;
    }
    _render(data);
}

let _lastData = null;
let _renduPourIcao = null; // terrain observé pour lequel le panneau a été rendu

/** Re-rendu quand le plan change (mise en avant « votre vol »). */
if (typeof document !== 'undefined') {
    document.addEventListener('route-changed', async () => {
        if (_panel && _lastData) _render(_lastData);
    });
    // Vol local : le terrain OBSERVÉ a changé (retour pilote 20/09) — re-rendu
    // avec sa pertinence, sinon le panneau reste sans « votre vol ».
    document.addEventListener('airport-changed', (e) => {
        const icao = e.detail?.icao || null;
        if (_panel && _lastData && icao && icao !== _renduPourIcao) _render(_lastData);
    });
}
