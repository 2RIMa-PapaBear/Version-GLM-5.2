/* ================================================================
 * TAKEOFF UI — Widget performance décollage
 * ================================================================
 *
 * Affiche un panneau compact sous le GO/NO-GO qui présente :
 *   - la distance de décollage corrigée (roulement + franchissement 50ft),
 *   - un champ pour saisir la longueur de piste du terrain (persistée),
 *   - une barre de marge visuelle (roulement / 50ft vs piste disponible).
 *
 * Le widget n'apparaît que si la densité-altitude est calculable
 * (i.e. on a l'élévation + QNH + OAT). La saisie de la longueur de piste
 * est optionnelle mais débloque le verdict de marge.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { makeCollapsible } from './collapsible.js';
import {
    evaluateTakeoffPerformance, getRunwayLength, setRunwayLength,
    getAircraftRef, isRunwayLengthAuto, getActiveRunwayNameForIcao,
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
    const lblRwy = isFr ? 'Longueur piste' : 'Runway length';
    const lblDa = isFr ? 'Densité-alt.' : 'Density alt.';
    const lblMargin = isFr ? 'Marge' : 'Margin';
    const lblAcRef = isFr ? 'Réf. avion' : 'A/C ref';
    const lblSetRwy = isFr ? 'm (piste la plus longue)' : 'm (longest runway)';
    const lblSave = isFr ? 'OK' : 'Set';
    const ref = getAircraftRef();
    const isAuto = isRunwayLengthAuto(icao);
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

    // Barre visuelle de marge (si longueur de piste connue).
    // Les pourcentages restent en unités internes (ft) — c'est un ratio.
    let barHtml = '';
    if (r.runwayLength != null) {
        const rollPct = Math.min(100, (r.groundRoll / r.runwayLength) * 100);
        const fiftyPct = Math.min(100, (r.fiftyFt / r.runwayLength) * 100);
        barHtml = `
            <div class="to-bar" style="margin-top:10px;">
                <div style="position:relative; height:22px; background:rgba(255,255,255,0.08); border-radius:4px; overflow:hidden;">
                    <div style="position:absolute; left:0; top:0; height:100%; width:${fiftyPct}%; background:${r.level === 'danger' ? '#EF4444' : (r.level === 'caution' ? '#F59E0B' : '#10B981')}33; border-right:2px solid ${r.level === 'danger' ? '#EF4444' : (r.level === 'caution' ? '#F59E0B' : '#10B981')};"></div>
                    <div style="position:absolute; left:0; top:0; height:100%; width:${rollPct}%; background:${r.level === 'danger' ? '#EF4444' : (r.level === 'caution' ? '#F59E0B' : '#10B981')}99; border-right:2px solid #fff;"></div>
                </div>
                <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-muted); margin-top:3px;">
                    <span>0</span>
                    <span>${ftToM(r.runwayLength)} m</span>
                </div>
            </div>
        `;
    }

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
        <div style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 16px; font-size:12px;">
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblRoll}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:700; color:var(--text-color);">${ftToM(r.groundRoll)} m</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lbl50ft}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:700; color:var(--text-color);">${ftToM(r.fiftyFt)} m</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblDa}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:700; color:var(--text-color);">${r.da} ft</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblAcRef}</div>
                <div style="font-family:'DM Mono',monospace; font-weight:700; color:var(--text-muted); font-size:11px;">${ftToM(ref.groundRoll)}/${ftToM(ref.fiftyFt)} m</div>
            </div>
            <div>
                <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${isFr ? 'Revêtement' : 'Surface'}</div>
                <div style="font-family:'DM Sans',sans-serif; font-weight:700; color:${surfSoft ? '#FBBF24' : 'var(--text-color)'}; font-size:12px; display:flex; align-items:center; gap:4px;">
                    ${surfInfo ? escapeHtml(surfInfo.label) : '—'}
                    ${r.surfaceFactor > 1
                        ? `<span style="font-size:9px; background:${surfSoft ? 'rgba(251,191,36,0.18)' : 'rgba(56,189,248,0.15)'}; color:${surfSoft ? '#FBBF24' : '#38BDF8'}; padding:1px 5px; border-radius:3px; font-weight:700; font-family:'DM Mono',monospace;">+${Math.round((r.surfaceFactor-1)*100)}%</span>`
                        : ''}
                </div>
            </div>
        </div>
        ${barHtml}
        <div style="display:flex; align-items:flex-end; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <label style="font-size:11px; color:var(--text-muted); display:flex; flex-direction:column; gap:3px;">
                <span style="display:flex; align-items:center; gap:5px;">
                    ${lblRwy}
                    ${isAuto ? `<span title="${isFr ? 'Valeur automatique de la base' : 'Auto from database'}" style="font-size:8px; background:rgba(56,189,248,0.15); color:#38BDF8; padding:1px 5px; border-radius:3px; letter-spacing:0.5px; font-weight:600;">AUTO</span>` : ''}
                    ${activeRwy ? `<span title="${isFr ? 'Piste sélectionnée dans la rose des vents' : 'Runway selected in wind compass'}" style="font-size:8px; background:rgba(74,222,128,0.15); color:#4ADE80; padding:1px 5px; border-radius:3px; letter-spacing:0.5px; font-weight:700; font-family:'DM Mono',monospace;">RWY ${escapeHtml(activeRwy)}</span>` : ''}
                </span>
                <input type="number" id="to-rwy-input" value="${rwyLenM ?? ''}" placeholder="${lblSetRwy}"
                    min="0" step="10"
                    style="width:120px; background:var(--input-bg); border:1px solid var(--border-color); color:var(--primary); border-radius:6px; padding:5px 8px; font-family:'DM Mono',monospace; font-size:13px; font-weight:600; outline:none;">
            </label>
            <button id="to-rwy-save" class="btn-secondary" style="padding:6px 14px; font-size:12px;">${lblSave}</button>
            ${r.margin != null ? `
                <div style="margin-left:auto; text-align:right;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px;">${lblMargin}</div>
                    <div style="font-family:'DM Mono',monospace; font-weight:800; font-size:15px; color:${marginColor};">
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

    // Branchement du bouton de sauvegarde.
    // La saisie est en mètres ; on convertit en pieds pour le stockage interne.
    const saveBtn = container.querySelector('#to-rwy-save');
    const rwyInput = container.querySelector('#to-rwy-input');
    if (saveBtn && rwyInput) {
        const doSave = () => {
            const m = parseInt(rwyInput.value, 10);
            // Conversion m → ft avant stockage (la base et les calculs sont en ft).
            const ft = isNaN(m) ? null : Math.round(m / FT_TO_M);
            setRunwayLength(icao, ft);
            // Rafraîchit le widget + le dashboard complet (GO/NO-GO inclus).
            showTakeoffWidget(icao);
            if (state.refreshCallback) {
                state.lastRenderState = null;
                state.refreshCallback();
            }
        };
        saveBtn.addEventListener('click', doSave);
        // Enter = save.
        rwyInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); doSave(); }
        });
    }

    if (window.lucide) window.lucide.createIcons({ root: container });
}
