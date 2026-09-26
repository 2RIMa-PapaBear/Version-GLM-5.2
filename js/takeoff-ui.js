/* ================================================================
 * TAKEOFF UI — Widget « Performances piste » (décollage + atterrissage)
 * ================================================================
 *
 * Affiche TOUJOURS les deux sections (arbitrage pilote 13/09) :
 *   1. DÉCOLLAGE du terrain observé (présentation historique : métriques,
 *      schéma en coupe, piste en service de la rose des vents, marge) ;
 *   2. ATTERRISSAGE, même présentation (métriques, schéma en coupe dédié,
 *      piste, marge) :
 *      - vol local : le terrain observé (départ = arrivée, même piste) ;
 *      - navigation : la DESTINATION du plan, calculée SANS consultation à
 *        partir du METAR de l'arrivée (relais) — piste PRÉVUE d'après son
 *        vent, mention « prévue ». Le plan de vol n'est jamais modifié.
 *
 * La section atterrissage exige les références POH de la flotte
 * (ldgRoll / ldgFifty) — sinon bandeau d'invitation.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { mountTakeoffProfile, mountLandingProfile } from './takeoff-profile.js';
import {
    evaluateTakeoffPerformance, evaluateLandingPerformance, evaluateLandingAtDestination,
    getRunwayLength, getAircraftRef, getActiveRunwayNameForIcao, _parseWindForAxial,
} from './takeoff-performance.js';
import { getFleet, getActiveAircraft, getActiveAircraftId, setActiveAircraft } from './aircraft-fleet.js';
import { getDeclinationForIcao } from './magvar.js';
import { getActiveRunwaySurfaceInfo, surfaceLabel, isSoftSurface } from './runway-surface.js';

// Jeton anti-course des atterrissages de destination asynchrones.
let _ldgSeq = 0;

/**
 * Affiche/masque le widget takeoff pour le terrain courant.
 * @param {string|null} icao Code OACI (null = masquer).
 */
export function showTakeoffWidget(icao) {
    const container = document.getElementById('takeoff-widget');
    if (!container) return;

    if (!icao) {
        container.style.display = 'none';
        return;
    }

    const result = evaluateTakeoffPerformance(icao);
    // Consultation de l'ARRIVÉE (message affiché = TAF) : le décollage du
    // départ n'est plus calculable, mais la section ATTERRISSAGE vit de la
    // météo de la destination (fetch propre) — le widget reste affiché, la
    // section décollage remplacée par une invitation (retour au départ).
    const isNav = document.body.classList.contains('mode-nav');
    const destInput = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
    // NB : pas de condition « destination ≠ terrain observé » — en CONSULTATION
    // de l'arrivée, l'observé EST la destination : le widget reste utile
    // (atterrissage de la destination, fetch météo propre).
    const hasNavDest = isNav && /^[A-Z][A-Z0-9]{3}$/.test(destInput);
    if (!result && !hasNavDest) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Performances piste' : 'Runway performance', 'plane-takeoff');

    // Injecte le bouton « Flotte » dans le header repliable (avant le chevron).
    const header = container.querySelector('.collapsible-header');
    if (header && !header.querySelector('#to-fleet-btn')) {
        const lblManage = isFr ? 'Gérer la flotte' : 'Manage fleet';
        const fleetBtn = document.createElement('button');
        fleetBtn.id = 'to-fleet-btn';
        fleetBtn.className = 'fleet-open-btn';
        fleetBtn.title = lblManage;
        fleetBtn.style.cssText = 'background:none; border:1px solid var(--border-color); color:var(--text-muted); border-radius:6px; padding:3px 8px; font-size:11px; cursor:pointer; display:flex; align-items:center; gap:4px; margin-left:auto; margin-right:8px;';
        fleetBtn.innerHTML = `<i data-lucide="plane" style="width:13px;height:13px;"></i> ${isFr ? 'Flotte' : 'Fleet'}`;
        // Empêche le clic sur le bouton de toggle le panel.
        fleetBtn.addEventListener('click', (e) => e.stopPropagation());
        header.appendChild(fleetBtn);
        if (window.lucide) window.lucide.createIcons({ root: header });
    }

    render(body, result, icao);
    container.style.display = 'block';
}

// Facteur de conversion pied → mètre.
const FT_TO_M = 0.3048;

/** Convertit pieds en mètres, arrondi à l'entier. */
function ftToM(ft) { return Math.round(ft * FT_TO_M); }

/** État de piste déduit du facteur de majoration (mêmes seuils que
 *  takeoff-performance). Herbe sèche (+15 %) : rien à préciser. Les états
 *  restent courts (« humide », « contaminée ») : la ligne doit tenir entière. */
function _surfaceState(factor, isFr) {
    if (Math.abs(factor - 1.15) < 1e-9) return '';            // herbe sèche
    if (factor >= 1.30) return isFr ? 'contaminée' : 'contaminated';
    if (factor >= 1.25) return isFr ? 'humide' : 'wet';
    if (factor >= 1.10) return isFr ? 'contaminée' : 'contaminated';
    if (factor > 1) return isFr ? 'humide' : 'wet';
    return '';
}

const _lvlColor = (lvl) => lvl === 'danger' ? '#EF4444' : (lvl === 'caution' || lvl === 'limitative' ? '#F59E0B' : '#10B981');

/** HTML interne de la section ATTERRISSAGE (métriques + hôte du schéma +
 *  ligne piste + message) — même présentation que la section décollage. */
function _ldgSectionHTML(landing, icao, isFr, activeRwyFallback) {
    const hw = landing.headwindKt;
    const surfInfo = getActiveRunwaySurfaceInfo(icao);
    const ldgLenM = landing.runwayLength != null ? ftToM(landing.runwayLength) : null;
    const rwyLbl = landing.forecast
        ? (isFr ? 'Piste prévue (vent METAR)' : 'Forecast rwy (METAR wind)')
        : (isFr ? 'Piste en service' : 'Runway in use');
    const rwyVal = landing.runwayName || activeRwyFallback;
    return `
            <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:5px;">
                <i data-lucide="plane-landing" style="width:13px;height:13px;"></i>
                ${isFr ? 'Atterrissage' : 'Landing'} · ${escapeHtml(icao)}
            </div>
            ${landing.metarFrom ? `
            <div style="font-size:10px; color:var(--text-muted); margin:-1px 0 6px 0; line-height:1.4;">
                <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
                ${isFr
                    ? `${escapeHtml(icao)} sans METAR propre — météo de <b>${escapeHtml(landing.metarFrom)}</b> (${landing.metarDistNm} NM)`
                    : `${escapeHtml(icao)} has no METAR — weather from <b>${escapeHtml(landing.metarFrom)}</b> (${landing.metarDistNm} NM)`}
            </div>` : ''}
            <div class="to-metrics-grid">
                <span title="${isFr ? 'Le premier chiffre (blanc) = performance calculée du jour, le second (ambre) = distance majorée de 20 % pour la comparaison à la LDA.' : 'First figure (white) = calculated performance, second (amber) = distance with 20% margin for LDA comparison.'}"><span class="lab">${isFr ? 'Franch. 50ft' : '50 ft obst.'} :</span> <span class="val">${ftToM(landing.fiftyFt)} m${landing.fiftyMargined ? ` <span style="color:#FBBF24;">→ ${ftToM(landing.fiftyMargined)} m ${isFr ? 'avec marge' : 'w/ margin'}</span>` : ''}</span></span>
                <span><span class="lab">${isFr ? 'Roulement' : 'Roll'} :</span> <span class="val">${ftToM(landing.rollFt)} m</span></span>
                <span><span class="lab">${isFr ? 'Vent' : 'Wind'} :</span> <span class="val">${hw == null ? '—' : `${Math.abs(hw)} kt ${hw >= 0 ? (isFr ? 'de face' : 'headwind') : (isFr ? 'arrière' : 'tailwind')}`}${landing.crosswindKt != null ? ` / ${landing.crosswindKt} kt ${landing.crosswindSide === 'D' ? (isFr ? 'de droite' : 'right') : (isFr ? 'de gauche' : 'left')}` : ''}</span></span>
                <span><span class="lab">${isFr ? 'Revêtement' : 'Surface'} :</span> <span class="val">${surfInfo ? escapeHtml(surfInfo.label) : '—'}${landing.surfaceFactor > 1
                    ? ` <span style="color:#FBBF24;">+${Math.round((landing.surfaceFactor - 1) * 100)}%</span>` : ''}</span></span>
                <span><span class="lab">${isFr ? 'Densité-alt.' : 'Density alt.'} :</span> <span class="val">${landing.da} ft</span></span>
            </div>
            <div class="to-landing-profile" style="margin-top:10px;"></div>
            <div style="display:flex; align-items:baseline; gap:6px; margin-top:10px; flex-wrap:wrap; font-size:12px; line-height:1.6;">
                <span style="color:var(--text-muted);">${rwyLbl} :</span>
                <span style="font-family:'DM Mono',monospace; color:var(--text-color);">${rwyVal ? 'RWY ' + escapeHtml(rwyVal) : '—'}</span>
                <span style="color:var(--text-muted);">·</span>
                <span style="color:var(--text-muted);">${isFr ? 'Longueur de piste' : 'Runway length'} :</span>
                <span style="font-family:'DM Mono',monospace; color:var(--text-color);">${ldgLenM != null ? ldgLenM + ' m' : '—'}</span>
                ${landing.margin != null ? `
                    <span style="margin-left:auto; color:var(--text-muted);">${isFr ? 'Restant' : 'Remaining'} :</span>
                    <span style="font-family:'DM Mono',monospace; font-weight:500; color:${_lvlColor(landing.level)};">${landing.margin >= 0 ? '+' : ''}${ftToM(landing.margin)} m</span>
                ` : ''}
            </div>
            <div style="font-size:10px; color:var(--text-muted); margin-top:6px; line-height:1.4;">
                <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
                ${isFr
                    ? `Distances d'arrêt corrigées densité-altitude, vent et état de piste (réf. POH « Atterr. roulement / 50 ft » de la flotte)${landing.forecast ? ' — piste prévue au vent du METAR de l\u2019arrivée, à confirmer en approche' : ''}.`
                    : `Stop distances corrected for density altitude, wind and runway state (fleet POH refs)${landing.forecast ? ' — runway forecast from the arrival METAR wind, confirm on approach' : ''}.`}
            </div>`;
}

/**
 * Génère le HTML du widget.
 */
function render(container, r, icao) {
    const isFr = state.lang === 'fr';

    const lblRoll = isFr ? 'Roulement' : 'Ground roll';
    const lbl50ft = isFr ? 'Franch. 50ft' : '50 ft obstacle';
    const lblDa = isFr ? 'Densité-alt.' : 'Density alt.';
    const lblAcRef = isFr ? 'Réf. avion' : 'A/C ref';
    const ref = getAircraftRef();

    // Piste en service = celle de la ROSE DES VENTS (choix automatique selon
    // le vent de la vue courante, ou paire choisie manuellement au clic sur
    // une bulle) — source de vérité unique. Fallback : calcul au vent du
    // METAR si la rose n'a pas encore rendu.
    let rwyWind = null;
    const ventStr = state.lastParsed?.base?.vent?.[0]?.val;
    if (ventStr) {
        rwyWind = _parseWindForAxial(ventStr);
    }
    const activeRwy = state.activeRunwayName
        || getActiveRunwayNameForIcao(icao, rwyWind, getDeclinationForIcao(state.requestedIcao || state.lastParsed?.code));
    // Revêtement de la piste active + état (humide/contaminée) quand le
    // facteur majoré ne s'explique pas par le seul revêtement (herbe sèche).
    const surfInfo = getActiveRunwaySurfaceInfo(icao);
    const surfSoft = surfInfo ? isSoftSurface(surfInfo.code) : false;
    const surfState = r?.surfaceFactor > 1 ? _surfaceState(r.surfaceFactor, isFr) : '';

    // Liste des avions pour le sélecteur.
    const fleet = getFleet();
    const activeId = getActiveAircraftId();
    const lblAircraft = isFr ? 'Avion' : 'Aircraft';

    const marginColor = r ? _lvlColor(r.level) : '#94A3B8';
    // Longueur de piste affichée en mètres (conversion depuis le stockage en ft).
    const rwyLenM = r?.runwayLength != null ? ftToM(r.runwayLength) : null;

    // ---- Section atterrissage : destination du plan en navigation (calcul
    // SANS consultation, METAR de l'arrivée), terrain observé en vol local.
    const isNav = document.body.classList.contains('mode-nav');
    const destInput = (document.getElementById('route-to-input')?.value || '').trim().toUpperCase();
    // Consultation arrivée comprise : la destination du plan reste la cible
    // de la section atterrissage (météo par fetch propre, pas par consultation).
    const hasNavDest = isNav && /^[A-Z][A-Z0-9]{3}$/.test(destInput);
    const acActive = getActiveAircraft();
    const hasLdgRefs = !!(acActive?.ldgRoll && acActive?.ldgFifty);
    const ldgSync = hasLdgRefs && !isNav ? evaluateLandingPerformance(icao) : null;
    const ldgTarget = isNav ? destInput : icao;

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; background:var(--input-bg); border:1px solid var(--border-color); border-radius:6px; padding:6px 10px;">
            <label for="to-aircraft-select" style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin:0; white-space:nowrap;">${lblAircraft}</label>
            <select id="to-aircraft-select" style="flex:1; background:transparent; border:none; color:var(--primary); font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700; outline:none; cursor:pointer;">
                ${fleet.map(ac => `<option value="${ac.id}" ${ac.id === activeId ? 'selected' : ''}>${escapeHtml(ac.name)}${ac.registration ? ' (' + escapeHtml(ac.registration) + ')' : ''}</option>`).join('')}
            </select>
        </div>
        ${r ? `
        <div class="to-metrics-grid">
            <span><span class="lab">${lblRoll} :</span> <span class="val">${ftToM(r.groundRoll)} m</span></span>
            <span><span class="lab">${lbl50ft} :</span> <span class="val">${ftToM(r.fiftyFt)} m</span></span>
            <span><span class="lab">${lblDa} :</span> <span class="val">${r.da} ft</span></span>
            <span><span class="lab">${isFr ? 'Revêtement' : 'Surface'} :</span> <span class="val">${surfInfo ? escapeHtml(surfInfo.label) : '—'}${r.surfaceFactor > 1
                ? `${surfState ? ' · ' + surfState : ''} <span style="color:${surfSoft ? '#FBBF24' : '#38BDF8'};">+${Math.round((r.surfaceFactor - 1) * 100)}%</span>` : ''}</span></span>
            <span><span class="lab">${lblAcRef} :</span> <span class="val">${ftToM(ref.groundRoll)}/${ftToM(ref.fiftyFt)} m</span></span>
        </div>
        <div class="to-profile" style="margin-top:10px;"></div>
        <div style="display:flex; align-items:baseline; gap:6px; margin-top:10px; flex-wrap:wrap; font-size:12px; line-height:1.6;">
            <span style="color:var(--text-muted);">${isFr ? 'Piste en service' : 'Runway in use'} :</span>
            <span title="${isFr ? 'Piste sélectionnée dans la rose des vents' : 'Runway selected in wind compass'}" style="font-family:'DM Mono',monospace; color:var(--text-color);">${activeRwy ? 'RWY ' + escapeHtml(activeRwy) : '—'}</span>
            <span style="color:var(--text-muted);">·</span>
            <span style="color:var(--text-muted);">${isFr ? 'Longueur de piste' : 'Runway length'} :</span>
            <span style="font-family:'DM Mono',monospace; color:var(--text-color);">${rwyLenM != null ? rwyLenM + ' m' : '—'}</span>
            ${r.margin != null ? `
                <span style="margin-left:auto; color:var(--text-muted);">${isFr ? 'Longueur restante' : 'Remaining length'} :</span>
                <span style="font-family:'DM Mono',monospace; font-weight:500; color:${marginColor};">${r.margin >= 0 ? '+' : ''}${ftToM(r.margin)} m</span>
            ` : ''}
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:8px; line-height:1.4;">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? `Distances corrigées selon la densité-altitude (réf. manuel de vol au niveau mer/ISA). « Flotte » pour gérer vos avions.`
                : `Distances corrected for density altitude (POH ref. at SL/ISA). "Fleet" to manage your aircraft.`}
        </div>` : `
        <div style="padding:12px; background:var(--input-bg); border:1px dashed var(--border-color); border-radius:8px; font-size:11.5px; color:var(--text-muted); text-align:center; line-height:1.5;">
            <i data-lucide="plane-takeoff" style="width:14px;height:14px;vertical-align:-2px;"></i>
            ${isFr
                ? ` Décollage — le METAR affiché est celui de l'arrivée (TAF) : revenez au <b>départ</b> (bouton « Départ ») pour recalculer le décollage.`
                : ` Takeoff — the displayed weather is the arrival (TAF): switch back to <b>departure</b> ("Departure" button) to recompute takeoff.`}
        </div>`}
        ${hasLdgRefs ? `
        <div style="margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-color);">
            <div class="to-ldg-body">
                ${ldgSync ? _ldgSectionHTML(ldgSync, icao, isFr, activeRwy) : (isNav && hasNavDest ? `
                    <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:5px;">
                        <i data-lucide="plane-landing" style="width:13px;height:13px;"></i>
                        ${isFr ? 'Atterrissage' : 'Landing'} · ${escapeHtml(ldgTarget)}
                    </div>
                    <div style="padding:14px 0; text-align:center; color:var(--text-muted); font-size:12px;">
                        <i data-lucide="loader-2" style="width:15px;height:15px;animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px;"></i>
                        ${isFr ? `Calcul de l'atterrissage à ${escapeHtml(ldgTarget)} (météo de l'arrivée)…` : `Computing landing at ${escapeHtml(ldgTarget)} (arrival weather)…`}
                    </div>` : '')}
            </div>
        </div>` : (!isNav || hasNavDest ? `
        <div style="margin-top:10px; padding:10px 12px; background:rgba(245,158,11,0.10); border:1px solid rgba(245,158,11,0.30); border-radius:8px; font-size:11.5px; line-height:1.5; color:var(--text-color);">
            <i data-lucide="plane-landing" style="width:13px;height:13px;vertical-align:-2px;color:#F59E0B;"></i>
            ${isFr
                ? ` Pour calculer l'atterrissage${isNav ? ` à ${escapeHtml(ldgTarget)}` : ''}, renseignez les distances du manuel de vol dans la flotte — champs <b>« Atterr. roulement (ft) »</b> et <b>« Atterr. 50ft (ft) »</b>.`
                : ` To compute the landing${isNav ? ` at ${escapeHtml(ldgTarget)}` : ''}, enter the POH distances in the fleet — fields <b>"Landing roll (ft)"</b> and <b>"Landing 50ft (ft)"</b>.`}
            <button id="to-ldg-fleet" style="margin-left:6px; height:24px; padding:0 8px; border:1px solid var(--border-color); border-radius:6px; background:transparent; color:var(--primary); font:600 11px 'DM Sans',sans-serif; cursor:pointer;">${isFr ? 'Ouvrir la flotte' : 'Open fleet'}</button>
        </div>` : '')}
    `;

    // Schémas en coupe : montés après injection (mesure la largeur réelle).
    const profileHost = container.querySelector('.to-profile');
    if (profileHost && r) mountTakeoffProfile(profileHost, r, isFr);
    if (ldgSync) {
        const ldgHost0 = container.querySelector('.to-ldg-body .to-landing-profile');
        if (ldgHost0) mountLandingProfile(ldgHost0, ldgSync, isFr);
    }

    // Atterrissage de DESTINATION (navigation) : asynchrone — météo de
    // l'arrivée au relais. Jeton : un calcul plus récent invalide le rendu.
    if (isNav && hasNavDest && hasLdgRefs) {
        const token = ++_ldgSeq;
        evaluateLandingAtDestination(ldgTarget).then(landing => {
            if (token !== _ldgSeq || !container.isConnected) return;
            const ldgBody = container.querySelector('.to-ldg-body');
            if (!ldgBody) return;
            if (!landing) {
                ldgBody.innerHTML = `
                    <div style="display:flex; align-items:center; gap:6px; font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:5px;">
                        <i data-lucide="plane-landing" style="width:13px;height:13px;"></i>
                        ${isFr ? 'Atterrissage' : 'Landing'} · ${escapeHtml(ldgTarget)}
                    </div>
                    <div style="padding:10px 0; text-align:center; color:var(--text-muted); font-size:12px;">
                        ${isFr ? `Aucun METAR pour ${escapeHtml(ldgTarget)} ni à proximité — atterrissage non calculé.` : `No METAR for ${escapeHtml(ldgTarget)} or nearby — landing not computed.`}
                    </div>`;
            } else {
                ldgBody.innerHTML = _ldgSectionHTML(landing, ldgTarget, isFr, null);
                const host = ldgBody.querySelector('.to-landing-profile');
                if (host) mountLandingProfile(host, landing, isFr);
            }
            if (window.lucide) window.lucide.createIcons({ root: ldgBody });
        });
    }

    // Invitation flotte (références atterrissage manquantes).
    const ldgFleetBtn = container.querySelector('#to-ldg-fleet');
    if (ldgFleetBtn) {
        ldgFleetBtn.addEventListener('click', () => {
            // Fenêtre Flotte chargée à la demande (audit 26/09, motif flight-file).
            import('./fleet-ui.js').then(({ openFleetManager }) => openFleetManager(() => {
                showTakeoffWidget(icao);
                if (state.refreshCallback) {
                    state.lastRenderState = null;
                    state.refreshCallback();
                }
            }));
        });
    }

    // Sélecteur d'avion : change l'avion actif et rafraîchit.
    const acSelect = container.querySelector('#to-aircraft-select');
    if (acSelect) {
        acSelect.addEventListener('change', () => {
            setActiveAircraft(acSelect.value);
            showTakeoffWidget(icao);
            if (state.refreshCallback) {
                state.lastRenderState = null;
                state.refreshCallback();
            }
        });
    }

    // Bouton « Flotte » : ouvre le modal de gestion.
    // Le bouton est dans le header repliable (parent du body), pas dans le body lui-même.
    const fleetBtn = container.closest('.collapsible-panel')?.querySelector('#to-fleet-btn');
    if (fleetBtn) {
        fleetBtn.addEventListener('click', () => {
            import('./fleet-ui.js').then(({ openFleetManager }) => openFleetManager(() => {
                // Au retour : rafraîchit le widget + dashboard.
                showTakeoffWidget(icao);
                if (state.refreshCallback) {
                    state.lastRenderState = null;
                    state.refreshCallback();
                }
            }));
        });
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
}
