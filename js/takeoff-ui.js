/* ================================================================
 * TAKEOFF UI — Widget performance décollage
 * ================================================================
 *
 * Affiche un panneau compact sous le GO/NO-GO qui présente :
 *   - la distance de décollage corrigée (roulement + franchissement 50ft),
 *   - un champ pour saisir la longueur de piste du terrain (persistée),
 *   - le schéma en coupe de la piste (roulement, montée au 50ft, marge) —
 *     la barre « plan » historique a été supprimée (redondante avec la coupe).
 *
 * Le widget n'apparaît que si la densité-altitude est calculable
 * (i.e. on a l'élévation + QNH + OAT). La saisie de la longueur de piste
 * est optionnelle mais débloque le verdict de marge.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import { mountTakeoffProfile } from './takeoff-profile.js';
import {
    evaluateTakeoffPerformance, getRunwayLength,
    getAircraftRef, getActiveRunwayNameForIcao,
} from './takeoff-performance.js';
import { getFleet, getActiveAircraftId, setActiveAircraft } from './aircraft-fleet.js';
import { openFleetManager } from './fleet-ui.js';
import { getActiveRunwaySurfaceInfo, surfaceLabel, isSoftSurface } from './runway-surface.js';

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
    if (!result) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const body = makeCollapsible(container, isFr ? 'Performance décollage' : 'Takeoff performance', 'plane-takeoff');

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
    // Piste active selon la rose des vents (null si non définie).
    const activeRwy = getActiveRunwayNameForIcao(icao);
    // Revêtement de la piste active.
    const surfInfo = getActiveRunwaySurfaceInfo(icao);
    const surfSoft = surfInfo ? isSoftSurface(surfInfo.code) : false;

    // Liste des avions pour le sélecteur.
    const fleet = getFleet();
    const activeId = getActiveAircraftId();
    const lblManage = isFr ? 'Gérer la flotte' : 'Manage fleet';
    const lblAircraft = isFr ? 'Avion' : 'Aircraft';

    const marginColor = r.level === 'danger' ? '#EF4444' : (r.level === 'caution' ? '#F59E0B' : '#10B981');
    // Longueur de piste affichée en mètres (conversion depuis le stockage en ft).
    const rwyLenM = r.runwayLength != null ? ftToM(r.runwayLength) : null;

    container.innerHTML = `
        <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px; background:var(--input-bg); border:1px solid var(--border-color); border-radius:6px; padding:6px 10px;">
            <label for="to-aircraft-select" style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:1px; margin:0; white-space:nowrap;">${lblAircraft}</label>
            <select id="to-aircraft-select" style="flex:1; background:transparent; border:none; color:var(--primary); font-family:'DM Sans',sans-serif; font-size:13px; font-weight:700; outline:none; cursor:pointer;">
                ${fleet.map(ac => `<option value="${ac.id}" ${ac.id === activeId ? 'selected' : ''}>${escapeHtml(ac.name)}${ac.registration ? ' (' + escapeHtml(ac.registration) + ')' : ''}</option>`).join('')}
            </select>
        </div>
        <div class="to-metrics-grid">
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblRoll}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:500; color:var(--text-color);">${ftToM(r.groundRoll)} m</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lbl50ft}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:500; color:var(--text-color);">${ftToM(r.fiftyFt)} m</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblDa}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:500; color:var(--text-color);">${r.da} ft</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${isFr ? 'Revêtement' : 'Surface'}</div>
                <div style="font-family:'DM Sans',sans-serif; font-weight:700; color:${surfSoft ? '#FBBF24' : 'var(--text-color)'}; font-size:12px; display:flex; align-items:center; gap:4px;">
                    ${surfInfo ? escapeHtml(surfInfo.label) : '—'}
                    ${r.surfaceFactor > 1
                        ? `<span style="font-size:9px; background:${surfSoft ? 'rgba(251,191,36,0.18)' : 'rgba(56,189,248,0.15)'}; color:${surfSoft ? '#FBBF24' : '#38BDF8'}; padding:1px 5px; border-radius:3px; font-weight:500; font-family:'DM Mono',monospace;">+${Math.round((r.surfaceFactor-1)*100)}%</span>`
                        : ''}
                </div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblAcRef}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:500; color:var(--text-muted); font-size:11px;">${ftToM(ref.groundRoll)}/${ftToM(ref.fiftyFt)} m</div>
            </div>
        </div>
        <div class="to-profile" style="margin-top:10px;"></div>
        <div style="display:flex; align-items:flex-end; gap:14px; margin-top:10px; flex-wrap:nowrap;">
            <label style="font-size:11px; color:var(--text-muted); display:flex; flex-direction:column; gap:3px;">
                <span>${isFr ? 'Piste en service' : 'Runway in use'}</span>
                ${activeRwy
                    ? `<span title="${isFr ? 'Piste sélectionnée dans la rose des vents' : 'Runway selected in wind compass'}" style="font-size:11px; background:rgba(74,222,128,0.15); color:#4ADE80; padding:3px 8px; border-radius:4px; letter-spacing:0.5px; font-weight:600; font-family:'DM Mono',monospace; align-self:flex-start;">RWY ${escapeHtml(activeRwy)}</span>`
                    : `<span style="font-family:'DM Mono',monospace; font-size:13px; color:var(--text-muted);">—</span>`}
            </label>
            <label style="font-size:11px; color:var(--text-muted); display:flex; flex-direction:column; gap:3px;">
                <span>${isFr ? 'Longueur de piste' : 'Runway length'}</span>
                <div style="width:120px; background:var(--input-bg); border:1px solid var(--border-color); color:var(--primary); border-radius:6px; padding:5px 8px; font-family:'DM Mono',monospace; font-size:13px; font-weight:500;">
                    ${rwyLenM != null ? rwyLenM + ' m' : '—'}
                </div>
            </label>
            ${r.margin != null ? `
                <div style="margin-left:auto; text-align:right;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${isFr ? 'Longueur restante' : 'Remaining length'}</div>
                    <div style="font-family:'DM Mono',monospace; font-weight:500; font-size:15px; color:${marginColor};">
                        ${r.margin >= 0 ? '+' : ''}${ftToM(r.margin)} m
                    </div>
                </div>
            ` : ''}
        </div>
        <div style="font-size:10px; color:var(--text-muted); margin-top:8px; line-height:1.4;">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? `Distances corrigées selon la densité-altitude (réf. manuel de vol au niveau mer/ISA). « Flotte » pour gérer vos avions.`
                : `Distances corrected for density altitude (POH ref. at SL/ISA). "Fleet" to manage your aircraft.`}
        </div>
    `;

    // Schéma en coupe : monté après injection (mesure la largeur
    // réelle du panneau pour garder les textes à 10 px).
    const profileHost = container.querySelector('.to-profile');
    if (profileHost) mountTakeoffProfile(profileHost, r, isFr);

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
            openFleetManager(() => {
                // Au retour : rafraîchit le widget + dashboard.
                showTakeoffWidget(icao);
                if (state.refreshCallback) {
                    state.lastRenderState = null;
                    state.refreshCallback();
                }
            });
        });
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
}
