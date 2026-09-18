/* ================================================================
 * FLIGHT FILE — Assistant « Dossier de vol » (B1 v1, écran)
 * ================================================================
 *
 * Six tuiles de statut qui PROUVENT que le dossier est prêt avant le
 * vol — chacune : état (vert / ambre / rouge), détail chiffré, action
 * quand il y en a une :
 *
 *   MÉTÉO    METAR frais + TAF chargé (+ météo de l'arrivée en nav)
 *   NOTAM    dossier chargé, nombre, fraîcheur (SOFIA, jamais caché)
 *   VAC      cartes consultées de chaque terrain du vol (attestation
 *            horodatée à l'ouverture de la visionneuse) + bouton Voir
 *   CARBURANT total requis vs embarqué (+ dégagement choisi en nav)
 *   PERFS    décollage (terrain courant) + atterrissage (arrivée)
 *   CENTRAGE verdict d'enveloppe du chargement du jour
 *
 * computeFileTiles est PUR (testé sous Node) ; la collecte des entrées
 * réelles est faite par _collectInputs (état de l'app + modules).
 * Rafraîchi : chargement METAR, dossier NOTAM, choix de dégagement,
 * et toutes les 60 s tant que le panneau est affiché.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { computeWb, resolveLoads } from './wb-core.js';
import { evaluateTakeoffPerformance, evaluateLandingPerformance, evaluateLandingAtDestination } from './takeoff-performance.js';
import { getCurrentNotams, getLastNotamFetchTs, getSelectedNotams } from './notam.js';
import { hasVac, openVac, getVacConsultedTs } from './vac-viewer.js';
import { getLastMetarObsMs } from './data-age.js';

// Mode courant sans importer flight-mode (module à effet de bord DOM au
// chargement) — même détection par classe body que takeoff-performance.
const _isNav = () => typeof document !== 'undefined' && document.body?.classList.contains('mode-nav');

const LVL = { ok: '#10B981', warn: '#F59E0B', danger: '#EF4444' };

/**
 * Statuts des six tuiles — PUR, testé sous Node.
 * @param {Object} i entrées collectées :
 *   metarAgeMin (min|null), tafLoaded (bool), arrWeather (bool|null),
 *   notamCount, notamAgeMin (min|null),
 *   vac [{icao, hasVac, consulted}], fuelRequired (L|null), fuelOnBoard (L|null),
 *   diversion (bool), takeoffLevel ('ok'|'caution'|'limitative'|'danger'|null),
 *   landingLevel (…|null), wbLevel ('ok'|'out'|null)
 * @returns {{weather, notam, vac, fuel, perf, wb}} tuiles {status, …}.
 */
export function computeFileTiles(i) {
    const t = {};

    // ---- MÉTÉO : METAR frais ; TAF non consulté ou météo d'arrivée
    // indisponible dégradent en ambre. TAF « none » (terrain sans TAF,
    // la source l'a dit) = sans objet, ne dégrade pas.
    const m = i.metarAgeMin == null ? 'danger'
        : i.metarAgeMin < 60 ? 'ok' : i.metarAgeMin < 120 ? 'warn' : 'danger';
    let w = m;
    if (w === 'ok' && i.tafState == null) w = 'warn';
    if (w === 'ok' && i.arrWeather === false) w = 'warn';
    t.weather = { status: w, metar: m, taf: i.tafState ?? null, arr: i.arrWeather == null ? null : !!i.arrWeather };

    // ---- NOTAM : dossier rendu + fraîcheur (30 min de référence).
    if (!i.notamCount) t.notam = { status: 'danger', count: 0 };
    else t.notam = {
        status: (i.notamAgeMin == null || i.notamAgeMin > 30) ? 'warn' : 'ok',
        count: i.notamCount, ageMin: i.notamAgeMin,
    };

    // ---- VAC : tous les terrains du vol POURVUS d'une VAC doivent avoir
    // été consultés (attestation à l'ouverture). Aucun terrain à VAC →
    // sans objet (vert).
    const needed = (i.vac || []).filter(v => v.hasVac);
    if (!needed.length) t.vac = { status: 'ok', items: [] };
    else t.vac = { status: needed.every(v => v.consulted) ? 'ok' : 'warn', items: needed };

    // ---- CARBURANT : la couleur ne juge QUE requis vs embarqué (retour
    // pilote 13/09 : 90 L embarqués pour 37,4 requis = VERT). L'absence de
    // dégagement reste DANS LE DÉTAIL (« dégagement — »), sans dégrader la
    // pastille — c'est une décision de route, pas un défaut de carburant.
    if (i.fuelRequired == null) t.fuel = { status: 'warn', unknown: true, diversion: i.diversion };
    else if (i.fuelOnBoard == null || i.fuelOnBoard + 0.05 < i.fuelRequired) t.fuel = { status: 'danger', short: true, diversion: i.diversion };
    else t.fuel = { status: 'ok', diversion: i.diversion };

    // ---- PERFS : le pire des niveaux calculés ; non calculé → ambre.
    const levels = [i.takeoffLevel, i.landingLevel].filter(Boolean);
    t.perf = {
        status: i.takeoffLevel == null ? 'warn'
            : levels.includes('danger') ? 'danger'
            : levels.some(l => l === 'caution' || l === 'limitative') ? 'warn' : 'ok',
    };

    // ---- CENTRAGE : dans l'enveloppe / hors limites / non configuré.
    t.wb = { status: i.wbLevel === 'ok' ? 'ok' : i.wbLevel === 'out' ? 'danger' : 'warn' };

    return t;
}

// ----------------------------------------------------------------
// Collecte des entrées réelles depuis l'état de l'app
// ----------------------------------------------------------------

/** Âge du METAR chargé (min), depuis le badge d'âge (qui trace l'heure
 *  d'observation du dernier METAR — juste même après un chargement TAF). */
function _metarAgeMin() {
    const t = getLastMetarObsMs();
    return t ? Math.max(0, Math.round((Date.now() - t) / 60000)) : null;
}

/** État du TAF affiché : 'loaded' (message réel), 'none' (la source a
 *  répondu « aucun message » — terrain sans TAF : sans objet), null. */
function _tafState() {
    const v = (document.getElementById('tafInput')?.value || '').trim();
    if (!v || v.length <= 20) return null;
    return /Aucun message|Erreur|Error|Recherche/i.test(v) ? 'none' : 'loaded';
}

/** Collecte les entrées réelles (exportée : le générateur du PDF dossier
 *  réutilise les mêmes données que les tuiles — B1 phase 2). */
export async function collectFileInputs() {
    const mode = _isNav() ? 'nav' : 'local';
    const ac = getActiveAircraft();
    const icao = String(state.requestedIcao || state.lastParsed?.code || '').toUpperCase();
    const destInput = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
    const hasDest = mode === 'nav' && /^[A-Z][A-Z0-9]{3}$/.test(destInput) && destInput !== icao;

    // Météo : METAR courant + TAF + (nav) météo de l'arrivée / atterrissage.
    const metarAgeMin = _metarAgeMin();
    const tafState = _tafState();
    let arrWeather = null;
    let landingLevel = null;
    if (hasDest) {
        const ldg = await evaluateLandingAtDestination(destInput);   // cache 10 min
        arrWeather = !!ldg;
        landingLevel = ldg?.level ?? null;
    }

    // NOTAM — le COMPTE suit la SÉLECTION (cases du panneau SOFIA, retour
    // pilote 18/09) : cochés/total. Sans panneau rendu, tout est à zéro.
    const notamTotal = getCurrentNotams().length;
    const notamCount = notamTotal ? getSelectedNotams().length : 0;
    const ts = getLastNotamFetchTs();
    const notamAgeMin = ts ? Math.round((Date.now() - ts) / 60000) : null;

    // VAC : départ, arrivée, dégagement — consultées ?
    const fields = [...new Set([icao, hasDest ? destInput : null, hasDest ? (state.diversionIcao || null) : null]
        .filter(v => v && /^[A-Z][A-Z0-9]{3}$/.test(v)))];
    const vac = [];
    for (const f of fields) {
        vac.push({ icao: f, hasVac: await hasVac(f), consulted: !!getVacConsultedTs(f) });
    }

    // Carburant : embarqué (chargement du jour) vs requis (plan / durée locale).
    const loads = resolveLoads(ac.id);
    const fuelOnBoard = loads.fuelL > 0 ? loads.fuelL : null;
    let fuelRequired = null;
    let fuelParts = null;
    if (mode === 'nav') {
        const f = state._lastNavPlan?.plan?.fuel;
        fuelRequired = f?.totalL ?? null;
        if (f) fuelParts = {
            trip: f.tripFuelL, ground: f.groundL ?? 0,
            reserve: f.reserveL, diversion: f.diversionL || 0,
        };
    } else {
        const min = parseInt(document.getElementById('wb-local-min')?.value, 10);
        if (Number.isFinite(min) && min > 0) {
            const burn = ac.fuelBurnLph ?? 35;
            // Vol local : durée + roulage 10 min (départ+arrivée) + réserve
            // finale 10 min (jour, vue du terrain) — même formule que le
            // devis du widget Centrage (18/09).
            const reserveMin = 10 + (ac.reserveExtraMin || 0);
            fuelRequired = Math.round(((min + 10 + reserveMin) / 60 * burn) * 10) / 10;
        }
    }

    // Perfs & centrage.
    const takeoffLevel = evaluateTakeoffPerformance(icao)?.level ?? null;
    if (mode !== 'nav') landingLevel = evaluateLandingPerformance(icao)?.level ?? null;
    let wbLevel = null;
    if (ac.wb) {
        // Même lecture que le widget Centrage : verdict du point DÉCOLLAGE
        // (points.takeoff.inside) + respect du MTOW.
        const w = computeWb(ac.wb, loads);
        const p = w?.points?.takeoff;
        if (p) {
            const mass = w.takeoff?.massKg ?? Infinity;
            const mtowOk = !ac.wb.mtowKg || mass <= ac.wb.mtowKg;
            wbLevel = (p.inside && mtowOk) ? 'ok' : 'out';
        }
    }

    return {
        mode, icao, dest: hasDest ? destInput : null,
        metarAgeMin, tafState, arrWeather,
        notamCount, notamTotal, notamAgeMin, vac,
        fuelRequired, fuelOnBoard, fuelParts,
        diversion: mode === 'nav' ? !!state.diversionIcao : null,
        takeoffLevel, landingLevel, wbLevel,
    };
}

// ----------------------------------------------------------------
// Rendu
// ----------------------------------------------------------------

let _timer = null;

const _tile = (icon, title, status, detail, extra = '') => `
    <div class="ff-tile" style="border-left:3px solid ${LVL[status] || LVL.warn};">
        <div class="ff-tile-head">
            <i data-lucide="${icon}" style="width:14px;height:14px;color:${LVL[status] || LVL.warn};"></i>
            <span>${title}</span>
        </div>
        <div class="ff-tile-detail">${detail}</div>
        ${extra}
    </div>`;

const _min = (v, isFr) => v == null ? '' : (v < 60 ? `${v} min` : `${Math.floor(v / 60)} h ${String(v % 60).padStart(2, '0')}`);

/**
 * Affiche/masque le panneau « Dossier de vol » (B1 v1, écran).
 * @param {string|null} forceIcao null explicite → masquer.
 */
export async function showFlightFile(forceIcao) {
    const container = document.getElementById('flight-file-panel');
    if (!container) return;

    const icao = forceIcao === null ? null : (forceIcao || state.requestedIcao || state.lastParsed?.code);
    if (!icao) {
        container.style.display = 'none';
        if (_timer) { clearInterval(_timer); _timer = null; }
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Dossier de vol' : 'Flight file', 'folder-check');
    container.style.display = 'block';

    const inp = await collectFileInputs();
    const t = computeFileTiles(inp);

    // ---- Tuile VAC : une ligne par terrain à VAC, bouton « Voir ».
    const vacRows = t.vac.items.map(v => {
        const seen = getVacConsultedTs(v.icao);
        const seenLbl = seen
            ? new Date(seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            : null;
        return `<div style="display:flex; align-items:center; gap:6px;">
            <span style="font-family:'DM Mono',monospace; font-weight:700;">${escapeHtml(v.icao)}</span>
            <span style="color:${seen ? LVL.ok : LVL.warn}; font-weight:600;">${seen ? (isFr ? 'consultée' : 'viewed') + ' ' + seenLbl : (isFr ? 'à consulter' : 'to view')}</span>
            <button data-vac="${escapeHtml(v.icao)}" style="margin-left:auto; height:22px; padding:0 8px; border:1px solid var(--border-color); border-radius:6px; background:transparent; color:var(--primary); font:600 10px 'DM Sans',sans-serif; cursor:pointer;">${isFr ? 'Voir' : 'View'}</button>
        </div>`;
    }).join('');

    body.innerHTML = `
        <div class="ff-grid">
            ${_tile('cloud-sun', isFr ? 'Météo' : 'Weather', t.weather.status,
                `${isFr ? 'METAR' : 'METAR'} ${inp.metarAgeMin != null ? _min(inp.metarAgeMin, isFr) : '—'}`
                + `${inp.arr != null ? ` · ${isFr ? 'arrivée' : 'dest.'} ${t.weather.arr ? '✓' : '?'}` : ''}`
                + (t.weather.taf === 'loaded' ? '' : t.weather.taf === 'none'
                    ? ` · TAF ${isFr ? 'sans objet' : 'n/a'}`
                    : ` · TAF ${isFr ? 'à charger' : 'missing'}`))}
            ${_tile('file-text', 'NOTAM', t.notam.status,
                inp.notamCount
                    ? `${inp.notamCount}/${inp.notamTotal} ${isFr ? 'NOTAM · il y a' : 'NOTAM ·'} ${_min(inp.notamAgeMin, isFr)}`
                    : (isFr ? 'Aucun dossier chargé' : 'No briefing loaded'))}
            ${_tile('map', 'VAC', t.vac.status,
                t.vac.items.length ? vacRows : (isFr ? 'Aucune VAC publiée sur ce vol' : 'No VAC charts on this flight'))}
            ${_tile('fuel', isFr ? 'Carburant' : 'Fuel', t.fuel.status,
                inp.fuelRequired != null
                    ? `${isFr ? 'Requis' : 'Req.'} ${inp.fuelRequired} L` + (inp.fuelParts
                        ? ` (${isFr ? 'trajet' : 'trip'} ${inp.fuelParts.trip} + ${isFr ? 'roulage' : 'taxi'} ${inp.fuelParts.ground} + ${isFr ? 'rés.' : 'res.'} ${inp.fuelParts.reserve}${inp.fuelParts.diversion ? ` + ${isFr ? 'dégag.' : 'alt.'} ${inp.fuelParts.diversion}` : ''})`
                        : '')
                      + ` · ${isFr ? 'embarqué' : 'on board'} ${inp.fuelOnBoard ?? '—'} L`
                      + (inp.mode === 'nav' ? ` · ${isFr ? 'dégagement' : 'alternate'} ${inp.diversion ? '✓' : '—'}` : '')
                    : (isFr ? 'Devis non renseigné (durée ou plan)' : 'No fuel plan yet (duration or route)'))}
            ${_tile('gauge', isFr ? 'Perfs piste' : 'Rwy perf', t.perf.status,
                `${isFr ? 'Décollage' : 'Takeoff'} ${inp.takeoffLevel ? (inp.takeoffLevel === 'ok' ? '✓' : '!') : '—'}`
                + ` · ${isFr ? 'atterrissage' : 'landing'} ${inp.landingLevel ? (inp.landingLevel === 'ok' ? '✓' : '!') : (isFr ? '—' : 'n/a')}`)}
            ${_tile('scale', isFr ? 'Centrage' : 'Balance', t.wb.status,
                t.wb.status === 'ok' ? (isFr ? 'Dans l\u2019enveloppe' : 'Within envelope')
                : t.wb.status === 'danger' ? (isFr ? 'HORS LIMITES' : 'OUT OF LIMITS')
                : (isFr ? 'Non configuré (flotte)' : 'Not configured (fleet)'))}
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:8px; line-height:1.4;">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? 'Vue de préparation — chaque rubrique doit être verte avant le vol. La VAC est attestée à son ouverture et jointe au PDF du dossier ; le dossier NOTAM n\u2019est jamais mis en cache.'
                : 'Preparation view — every tile should be green before flight. VAC is attested on opening and attached to the dossier PDF; the NOTAM briefing is never cached.'}
        </div>
        ${inp.mode === 'nav' && inp.dest ? `
        <button id="ff-print" class="btn-primary" style="margin-top:10px; height:26px; padding:0 12px; font-size:12px;">
            <i data-lucide="printer" style="width:13px;height:13px;vertical-align:-2px;"></i>
            ${isFr ? 'Imprimer le dossier de vol' : 'Print flight file'}
        </button>` : ''}
    `;

    body.querySelectorAll('button[data-vac]').forEach(btn => {
        btn.addEventListener('click', () => { openVac(btn.dataset.vac); });
    });

    // PDF unique du dossier (B1 phase 2) — import dynamique : le générateur
    // (flight-planner-ui) importe ce module pour les tuiles, l'inverse en
    // statique créerait un cycle.
    const printBtn = body.querySelector('#ff-print');
    if (printBtn) {
        printBtn.addEventListener('click', async () => {
            const { printFlightFile } = await import('./flight-planner-ui.js');
            printFlightFile();
        });
    }

    if (window.lucide) window.lucide.createIcons({ root: container });

    // Fraîcheur : la tuile météo vieillit, le dossier NOTAM aussi.
    if (_timer) clearInterval(_timer);
    _timer = setInterval(() => { if (container.isConnected) showFlightFile(); else { clearInterval(_timer); _timer = null; } }, 60000);
}

// Le dossier vit avec les décisions du pilote : choix de dégagement,
// arrivée du dossier NOTAM et SAISIE du carburant (widget Centrage) —
// retour pilote 13/09 : la tuile Carburant ne suivait pas l'embarqué.
// navplan-changed (retour pilote 18/09 « la tuile Carburant reste en
// ambre ») : la tuile lit le requis DANS le plan — elle doit se rafraîchir
// quand un plan vient d'être (re)calculé, pas seulement à la saisie.
// Retour pilote 18/09 (suite) : la couleur doit changer IMMÉDIATEMENT à
// la saisie de l'embarqué — la tuile seule est recalculée (synchrone),
// sans attendre le re-rendu complet du dossier.
if (typeof document !== 'undefined') {
    document.addEventListener('diversion-changed', () => showFlightFile());
    document.addEventListener('notam-dossier-ready', () => showFlightFile());
    window.addEventListener('navplan-changed', () => showFlightFile());
    document.addEventListener('input', (e) => {
        const id = e.target?.id;
        if (id !== 'wb-fuel-l' && id !== 'wb-local-min') return;
        _refreshFuelTileNow();
    });
    // Cases du panneau NOTAM (SOFIA) — retour pilote 18/09 : le nombre de
    // la tuile doit suivre la sélection IMMÉDIATEMENT.
    document.addEventListener('notam-selection-changed', _refreshNotamTileNow);
    // Consultation d'une carte VAC (visionneuse) — retour pilote 18/09 :
    // la tuile VAC passe à « consultée » IMMÉDIATEMENT.
    document.addEventListener('vac-consulted', (e) => _refreshVacTileNow(e.detail?.icao));
}

/** Mise à jour IMMÉDIATE de la seule tuile Carburant (synchrone) :
 *  requis (plan actif ou formule locale) vs embarqué du widget Centrage. */
function _refreshFuelTileNow() {
    if (typeof document === 'undefined') return;
    const tiles = [...document.querySelectorAll('.ff-tile')];
    const tile = tiles.find(t => /Carburant|Fuel/.test(t.querySelector('.ff-tile-head')?.textContent || ''));
    if (!tile) return;
    const isFr = state.lang === 'fr';
    const ac = getActiveAircraft();
    const destInput = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
    const isNav = _isNav();
    // Embarqué lu DIRECTEMENT dans le champ vivant (toujours à jour à
    // l'instant de l'événement, indépendamment du stockage).
    const flRaw = parseFloat(String(document.getElementById('wb-fuel-l')?.value ?? '').replace(',', '.'));
    const onBoard = (Number.isFinite(flRaw) && flRaw > 0) ? flRaw : null;
    let req = null, detail = null;
    if (isNav) {
        const f = state._lastNavPlan?.plan?.fuel;
        req = f?.totalL ?? null;
        if (req != null) detail = `${isFr ? 'Requis' : 'Req.'} ${req} L · ${isFr ? 'embarqué' : 'on board'} ${onBoard ?? '—'} L`
            + ` · ${isFr ? 'dégagement' : 'alternate'} ${state.diversionIcao ? '✓' : '—'}`;
    } else {
        const min = parseInt(document.getElementById('wb-local-min')?.value, 10);
        if (Number.isFinite(min) && min > 0) {
            const burn = ac.fuelBurnLph ?? 35;
            req = Math.round(((min + 10 + 10 + (ac.reserveExtraMin || 0)) / 60 * burn) * 10) / 10;
            detail = `${isFr ? 'Requis' : 'Req.'} ${req} L · ${isFr ? 'embarqué' : 'on board'} ${onBoard ?? '—'} L`;
        }
    }
    if (req == null) {
        detail = isFr ? 'Devis non renseigné (durée ou plan)' : 'No fuel plan yet (duration or route)';
    }
    const status = req == null ? 'warn' : (onBoard == null || onBoard + 0.05 < req) ? 'danger' : 'ok';
    tile.style.borderLeftColor = LVL[status];
    tile.querySelector('.ff-tile-head svg')?.style.setProperty('color', LVL[status], 'important');
    const d = tile.querySelector('.ff-tile-detail');
    if (d && detail) d.textContent = detail;
}

/** Mise à jour IMMÉDIATE de la seule tuile NOTAM (synchrone) :
 *  cochés/total du panneau SOFIA + fraîcheur. */
function _refreshNotamTileNow() {    if (typeof document === 'undefined') return;
    const tiles = [...document.querySelectorAll('.ff-tile')];
    const tile = tiles.find(t => /^NOTAM/i.test(t.querySelector('.ff-tile-head')?.textContent?.trim() || ''));
    if (!tile) return;
    const isFr = state.lang === 'fr';
    const total = getCurrentNotams().length;
    const sel = total ? getSelectedNotams().length : 0;
    const ts = getLastNotamFetchTs();
    const ageMin = ts ? Math.round((Date.now() - ts) / 60000) : null;
    const status = !sel ? 'danger' : (ageMin == null || ageMin > 30) ? 'warn' : 'ok';
    tile.style.borderLeftColor = LVL[status];
    tile.querySelector('.ff-tile-head svg')?.style.setProperty('color', LVL[status], 'important');
    const d = tile.querySelector('.ff-tile-detail');
    if (d) {
        d.textContent = sel
            ? `${sel}/${total} ${isFr ? 'NOTAM · il y a' : 'NOTAM ·'} ${_min(ageMin, isFr)}`
            : (isFr ? 'Aucun dossier chargé' : 'No briefing loaded');
    }
}

/** Mise à jour IMMÉDIATE de la seule tuile VAC (synchrone) : la ligne du
 *  terrain consulté passe à « consultée HH:MM » (vert) et la pastille de
 *  la tuile suit si toutes les VAC du vol sont consultées. */
function _refreshVacTileNow(icaoConsulte) {
    if (typeof document === 'undefined') return;
    const tiles = [...document.querySelectorAll('.ff-tile')];
    const tile = tiles.find(t => /^VAC/i.test(t.querySelector('.ff-tile-head')?.textContent?.trim() || ''));
    if (!tile) return;
    const isFr = state.lang === 'fr';
    let restent = 0;
    for (const row of [...tile.querySelectorAll('.ff-tile-detail > div')]) {
        const spans = row.querySelectorAll('span');
        const code = spans[0]?.textContent?.trim();
        if (!code) continue;
        const seen = getVacConsultedTs(code);
        if (seen && spans[1]) {
            spans[1].textContent = (isFr ? 'consultée ' : 'viewed ')
                + new Date(seen).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            spans[1].style.color = LVL.ok;
        } else if (!seen) restent++;
    }
    if (!restent) {
        tile.style.borderLeftColor = LVL.ok;
        tile.querySelector('.ff-tile-head svg')?.style.setProperty('color', LVL.ok, 'important');
    }
}
