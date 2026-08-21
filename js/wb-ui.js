/* ================================================================
 * WB UI — Widget dashboard « Centrage »
 * ================================================================
 *
 * Panneau repliable sous « Performance décollage », relié à l'avion
 * actif de la flotte. Affiche le centrogramme (enveloppe + points
 * décollage / arrivée / ZFW), permet de saisir le chargement du jour
 * (postes de l'avion, carburant embarqué et essence consommée —
 * pré-remplis depuis le plan de nav courant, modifiables) et donne
 * le verdict dedans/dehors enveloppe + marge MTOW.
 *
 * La configuration (enveloppe, postes, masse à vide, unités) se gère
 * dans la fenêtre Flotte : ce widget ne fait que consommer/afficher.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { getActiveAircraft } from './aircraft-fleet.js';
import { openFleetManager } from './fleet-ui.js';
import {
    computeWb, resolveLoads, writeWbLoads, mountWbChart,
    armFromMm, massFromKg, massToKg, armDecimals,
} from './wb-core.js';

let _chartDispose = null;

/** Masse affichée (unité de l'avion) → chaîne arrondie. */
const _m = (kg, u) => Math.round(massFromKg(kg, u));
/** Bras mm → chaîne dans l'unité de l'avion (décimales selon l'unité). */
const _a = (mm, u) => String(+(armFromMm(mm, u).toFixed(armDecimals(u))));

/** Parse une saisie (accepte la virgule décimale). */
const _num = (v) => parseFloat(String(v ?? '').replace(',', '.'));

/**
 * Affiche/masque le widget centrage pour l'avion actif.
 * @param {string|null} icao Code OACI courant (null = masquer, comme
 *   les autres widgets du dashboard : le centrage se consulte en
 *   préparation de vol, une fois un terrain sélectionné).
 */
export function refreshWbWidget(icao = state.requestedIcao) {
    const container = document.getElementById('wb-widget');
    if (!container) return;

    if (!icao) {
        container.style.display = 'none';
        return;
    }
    const ac = getActiveAircraft();
    if (!ac?.wb) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Centrage' : 'Weight & balance', 'scale');

    // Bouton « Flotte » dans le header repliable (même pattern que le
    // widget Performance décollage) : accès direct à la configuration.
    const header = container.querySelector('.collapsible-header');
    if (header && !header.querySelector('#wb-fleet-btn')) {
        const lblManage = isFr ? 'Gérer la flotte' : 'Manage fleet';
        const fleetBtn = document.createElement('button');
        fleetBtn.id = 'wb-fleet-btn';
        fleetBtn.className = 'fleet-open-btn';
        fleetBtn.title = lblManage;
        fleetBtn.style.cssText = 'background:none; border:1px solid var(--border-color); color:var(--text-muted); border-radius:6px; padding:3px 8px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; margin-left:auto; margin-right:8px;';
        fleetBtn.innerHTML = `<i data-lucide="plane" style="width:13px;height:13px;"></i> ${isFr ? 'Flotte' : 'Fleet'}`;
        fleetBtn.addEventListener('click', (e) => e.stopPropagation());
        fleetBtn.addEventListener('click', () => openFleetManager(() => { refreshWbWidget(icao); }));
        header.appendChild(fleetBtn);
        if (window.lucide) window.lucide.createIcons({ root: header });
    }

    _render(body, ac, isFr);
    container.style.display = 'block';
}

/** Construit le widget une fois, puis recalcule à chaque saisie. */
function _render(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;
    const plan = state._lastNavPlan?.plan;
    const loads = resolveLoads(ac.id, plan);

    // Postes sans bras (saisie incomplète côté flotte) : ignorés ici.
    const usable = (s) => s.armMm != null && isFinite(s.armMm);
    const stations = wb.stations.filter(s => !s.fuel && usable(s));
    const fuelSt = wb.stations.find(s => s.fuel && usable(s));

    body.innerHTML = `
        <div class="wb-ac-line">
            <span class="wb-ac-reg">${escapeHtml(ac.registration || ac.name)}${ac.type ? ' · ' + escapeHtml(ac.type) : ''}</span>
            <span class="wb-units">${u.mass} / ${u.arm}</span>
        </div>
        <div class="wb-chart-host"></div>
        <div class="wb-results">
            <div class="wb-res"><span class="wb-dot wb-dot-to"></span><span class="wb-res-val" id="wb-res-to"></span></div>
            <div class="wb-res"><span class="wb-dot wb-dot-ar"></span><span class="wb-res-val" id="wb-res-ar"></span></div>
            <div class="wb-res"><span class="wb-dot wb-dot-zf"></span><span class="wb-res-val" id="wb-res-zf"></span></div>
        </div>
        <div class="fleet-wb-sub" style="margin-top:12px;">${isFr ? 'CHARGEMENT DU JOUR' : 'TODAY\'S LOADING'}</div>
        <div class="wb-load-grid">
            ${stations.map(s => `
                <label class="wb-load">${escapeHtml(s.name)} (${u.mass})${s.maxKg ? ` <span class="wb-load-max">max ${_m(s.maxKg, u.mass)}</span>` : ''}
                    <input type="number" step="any" min="0" class="wb-load-in" data-key="st:${escapeHtml(s.name)}" data-max="${s.maxKg || ''}" value="${loads.masses[s.name] ?? ''}" placeholder="0">
                    <input type="range" class="wb-load-range" data-key="st:${escapeHtml(s.name)}" min="0" max="${s.maxKg ? Math.max(1, Math.round(massFromKg(s.maxKg, u.mass))) : 150}" step="1" value="${Math.round(massFromKg(loads.masses[s.name] || 0, u.mass))}">
                </label>`).join('')}
        </div>
        ${fuelSt ? `
        <div class="wb-load-grid wb-load-grid-fuel">
            <label class="wb-load wb-load-fuel" title="${isFr ? 'Quantité totale embarquée au décollage — pré-remplie du plan de nav (trajet + réserve), modifiable.' : 'Total fuel at takeoff — pre-filled from the nav plan (trip + reserve), editable.'}">${isFr ? 'Carburant embarqué (L)' : 'Fuel on board (L)'}${fuelSt.maxKg ? ` <span class="wb-load-max">max ${fuelSt.maxKg} L</span>` : ''}
                <input type="number" step="any" min="0" id="wb-fuel-l" data-key="fuel" data-max="${fuelSt.maxKg || ''}" value="${loads.fuelL || ''}" placeholder="0">
                <input type="range" class="wb-load-range" data-key="fuel" min="0" max="${fuelSt.maxKg ? Math.max(1, Math.round(fuelSt.maxKg)) : 200}" step="1" value="${Math.round(loads.fuelL || 0)}">
            </label>
            <label class="wb-load wb-load-fuel" title="${isFr ? 'Essence brûlée pendant le vol — le point Arrivée est calculé avec le carburant restant (embarqué − consommée). Pré-remplie du plan de nav (trajet, sans la réserve).' : 'Fuel burned during the flight — the landing point uses the remaining fuel (on board − burned). Pre-filled from the nav plan (trip, no reserve).'}">${isFr ? 'Essence consommée en vol (L)' : 'Fuel burned in flight (L)'} <span class="wb-load-max">${isFr ? 'option' : 'optional'}</span>
                <input type="number" step="any" min="0" id="wb-burn-l" data-key="burn" value="${loads.burnL || ''}" placeholder="0">
                <input type="range" class="wb-load-range" data-key="burn" min="0" max="${Math.max(1, Math.round(loads.fuelL || 1))}" step="1" value="${Math.round(loads.burnL || 0)}">
            </label>
        </div>` : ''}
        <div class="wb-verdict" id="wb-verdict"></div>
        <div class="wb-note">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? 'Carburant embarqué et essence consommée en vol pré-remplis du plan de nav (modifiables). Point Arrivée = carburant embarqué − essence consommée. Enveloppe, postes et masse à vide : fenêtre Flotte.'
                : 'Fuel on board and fuel burned in flight pre-filled from the nav plan (editable). Landing point = fuel on board − fuel burned. Envelope, stations and empty weight: Fleet window.'}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: body });

    body.querySelectorAll('.wb-load-in, #wb-fuel-l, #wb-burn-l').forEach(input => {
        input.addEventListener('input', () => _recalc(body, ac, isFr));
    });
    // Sliders : pilotent le champ numérique associé (même data-key).
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        rng.addEventListener('input', () => {
            const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
            if (num) num.value = rng.value;
            _recalc(body, ac, isFr);
        });
    });

    _recalc(body, ac, isFr);
}

/** Relit les saisies, recalcule, rafraîchit graphe + résultats + verdict. */
function _recalc(body, ac, isFr) {
    const wb = ac.wb;
    const u = wb.units;

    // Saisies → chargement interne (kg / litres). data-key : "st:Nom" pour
    // les postes, "fuel"/"burn" pour le carburant.
    const loads = { masses: {}, fuelL: 0, burnL: 0 };
    body.querySelectorAll('.wb-load-in').forEach(inp => {
        const name = (inp.dataset.key || '').startsWith('st:') ? inp.dataset.key.slice(3) : null;
        if (!name) return;
        const v = _num(inp.value);
        if (isFinite(v) && v > 0) loads.masses[name] = massToKg(v, u.mass);
        // Pastille ambre si le max du poste est dépassé.
        const max = _num(inp.dataset.max);
        const over = max > 0 && isFinite(v) && v > massFromKg(max, u.mass) + 1e-9;
        inp.classList.toggle('wb-over', over);
    });
    const fl = _num(body.querySelector('#wb-fuel-l')?.value);
    const bl = _num(body.querySelector('#wb-burn-l')?.value);
    loads.fuelL = (isFinite(fl) && fl > 0) ? fl : 0;
    loads.burnL = (isFinite(bl) && bl > 0) ? bl : 0;
    // Carburant : pastille ambre si la capacité (max du poste, en litres) est dépassée.
    const fuelIn = body.querySelector('#wb-fuel-l');
    if (fuelIn) {
        const maxL = _num(fuelIn.dataset.max);
        fuelIn.classList.toggle('wb-over', maxL > 0 && isFinite(fl) && fl > maxL + 1e-9);
    }
    writeWbLoads(ac.id, loads);

    const calc = computeWb(wb, loads);

    // Graphe (remonté à chaque saisie : léger).
    if (_chartDispose) { _chartDispose(); _chartDispose = null; }
    const host = body.querySelector('.wb-chart-host');
    if (host) _chartDispose = mountWbChart(host, wb, calc, isFr);

    // Résultats : Décollage (vert) / Arrivée (orange) / ZFW (rouge) — masse
    // et CG seuls (le bandeau verdict ci-dessous porte marges et alertes).
    const burnL = Math.round(calc.burnKg / (wb.fuelDensity || 0.72));
    const mkLine = (label, p) => {
        const cgTxt = p.cgMm == null ? '—' : `${_a(p.cgMm, u.arm)} ${u.arm}`;
        return `<b>${label}</b> ${_m(p.massKg, u.mass)} ${u.mass} · CG ${cgTxt}`;
    };
    const set = (sel, html) => { const el = body.querySelector(sel); if (el) el.innerHTML = html; };
    set('#wb-res-to', mkLine(isFr ? 'Décollage :' : 'Takeoff:', calc.takeoff));
    set('#wb-res-ar', mkLine(isFr ? `Arrivée (−${burnL} L) :` : `Landing (−${burnL} L):`, calc.arrival));
    set('#wb-res-zf', mkLine(isFr ? 'ZFW (zéro carburant) :' : 'ZFW (zero fuel):', calc.zfw));

    // Bandeau verdict.
    const vEl = body.querySelector('#wb-verdict');
    if (!vEl) return;
    if (calc.level === 'ok') {
        const p = calc.points.takeoff;
        const U = u.arm.toUpperCase();
        vEl.className = 'wb-verdict ok';
        vEl.innerHTML = isFr
            ? `CG DÉCOLLAGE ${_a(calc.takeoff.cgMm, u.arm)} ${U} · DANS L'ENVELOPPE · MARGE AVANT ${Math.round(armFromMm(p.fwdMm, u.arm))} ${U} / ARRIÈRE ${Math.round(armFromMm(p.aftMm, u.arm))} ${U}`
            : `TAKEOFF CG ${_a(calc.takeoff.cgMm, u.arm)} ${U} · IN ENVELOPE · FWD ${Math.round(armFromMm(p.fwdMm, u.arm))} ${U} / AFT ${Math.round(armFromMm(p.aftMm, u.arm))} ${U}`;
    } else {
        const reasons = [];
        if (!calc.mtowOk) reasons.push(isFr
            ? `masse décollage > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`
            : `takeoff weight > MTOW (${_m(calc.takeoff.massKg, u.mass)} > ${_m(wb.mtowKg, u.mass)} ${u.mass})`);
        for (const [k, lbl] of [['takeoff', isFr ? 'décollage' : 'takeoff'],
                                 ['arrival', isFr ? 'arrivée' : 'landing'],
                                 ['zfw', 'ZFW']]) {
            if (!calc.points[k].inside) reasons.push(`${lbl} ${isFr ? 'hors enveloppe' : 'out of envelope'}`);
        }
        vEl.className = 'wb-verdict danger';
        vEl.innerHTML = `${isFr ? 'HORS LIMITES' : 'OUT OF LIMITS'} — ${reasons.join(' · ')}`;
    }

    // Resynchronise les sliders sur les valeurs saisies ; le slider
    // « essence consommée » est borné au carburant embarqué courant.
    body.querySelectorAll('input[type="range"].wb-load-range').forEach(rng => {
        const num = body.querySelector(`input[type="number"][data-key="${CSS.escape(rng.dataset.key)}"]`);
        if (!num) return;
        if (rng.dataset.key === 'burn') rng.max = Math.max(1, Math.round(loads.fuelL));
        const v = _num(num.value);
        rng.value = (isFinite(v) && v > 0) ? Math.min(v, Number(rng.max)) : 0;
    });
}
