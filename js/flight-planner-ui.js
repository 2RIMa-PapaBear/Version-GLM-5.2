/* ================================================================
 * FLIGHT PLANNER UI — Panneau de navigation VFR
 * ================================================================
 *
 * Affiche un panneau (visible seulement en mode "navigation") qui
 * présente les résultats du calcul de vol :
 *
 *   - Route : distance (NM/km), cap vrai, cap magnétique.
 *   - Vent : force/direction à l'altitude de croisière, dérive.
 *   - Performances : vitesse sol, temps de vol (ETA).
 *   - Carburant : voyage + réserve légale + total.
 *   - Profil d'élévation : hauteur max du relief, marge de
 *     franchissement, alerte si sous le minimum.
 *
 * Le pilote saisit :
 *   - L'altitude de croisière (ft MSL).
 *   - La vitesse air vraie (kt) — pré-remplie depuis l'avion actif.
 *   - La consommation (L/h) — pré-remplie.
 *   - Le type de vol (jour/nuit) — détermine la réserve légale.
 *
 * Les valeurs de TAS/conso sont persistées par avion dans la flotte
 * (localStorage) pour ne pas les re-saisir à chaque fois.
 * ================================================================ */

import { state, escapeHtml } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { getActiveAircraftId } from './aircraft-fleet.js';
import { makeCollapsible } from './collapsible.js';
import { computeFlightPlan, getDefaultAircraftPerf, RESERVES } from './flight-planner.js';

// Clé localStorage pour les perfs par avion (TAS, conso).
const LS_PERF_PREFIX = 'ac-perf-';

/**
 * Lit les perfs (TAS, conso) persistées pour un avion.
 * @param {string} acId
 * @returns {{tasKt:number, fuelBurnLph:number}}
 */
function _readPerf(acId) {
    const def = getDefaultAircraftPerf();
    if (!acId) return def;
    try {
        const raw = localStorage.getItem(LS_PERF_PREFIX + acId);
        if (raw) {
            const p = JSON.parse(raw);
            return {
                tasKt: typeof p.tasKt === 'number' ? p.tasKt : def.tasKt,
                fuelBurnLph: typeof p.fuelBurnLph === 'number' ? p.fuelBurnLph : def.fuelBurnLph,
            };
        }
    } catch { /* ignore */ }
    return def;
}

/**
 * Persiste les perfs pour un avion.
 */
function _writePerf(acId, tasKt, fuelBurnLph) {
    if (!acId) return;
    try {
        localStorage.setItem(LS_PERF_PREFIX + acId, JSON.stringify({ tasKt, fuelBurnLph }));
    } catch { /* quota */ }
}

/**
 * Affiche/masque le panneau flight planner.
 * @param {string|null} fromIcao Code OACI départ (null = masquer).
 * @param {string|null} toIcao   Code OACI destination.
 */
export async function showFlightPlanner(fromIcao, toIcao) {
    const container = document.getElementById('flight-planner-panel');
    if (!container) return;

    // Masqué si pas de route valide.
    if (!fromIcao || !toIcao || fromIcao === toIcao) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const acId = getActiveAircraftId();
    const perf = _readPerf(acId);

    // Prépare le panel repliable et récupère le body.
    const body = makeCollapsible(container, isFr ? 'Calcul de navigation' : 'Flight plan', 'navigation');

    // Altitude de croisière par défaut : 2500 ft MSL (typique VFR transit).
    // Mémorisée dans le champ input entre les recalculs.
    let cruiseAlt = 2500;
    const altInput = body.querySelector('#fp-cruise-alt');
    if (altInput && altInput.value) cruiseAlt = parseInt(altInput.value, 10);
    const tasInput = body.querySelector('#fp-tas');
    let tasKt = tasInput?.value ? parseInt(tasInput.value, 10) : perf.tasKt;
    const burnInput = body.querySelector('#fp-burn');
    let burn = burnInput?.value ? parseInt(burnInput.value, 10) : perf.fuelBurnLph;
    const nightInput = body.querySelector('#fp-night');
    const isNight = nightInput ? nightInput.checked : false;

    // Rendu initial (état "calcul en cours").
    _renderLoading(body, fromIcao, toIcao, cruiseAlt, tasKt, burn, isNight, isFr);

    // Calcul (async : appels Open-Meteo pour vent + élévation).
    const plan = await computeFlightPlan(fromIcao, toIcao, {
        cruiseAltFt: cruiseAlt,
        tasKt,
        fuelBurnLph: burn,
        isNight,
    });

    if (!plan) {
        _renderError(body, fromIcao, toIcao, isFr);
        container.style.display = 'block';
        return;
    }

    // Persiste les perfs si elles ont changé.
    _writePerf(acId, tasKt, burn);

    _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
    container.style.display = 'block';
}

/**
 * Rendu de l'état "calcul en cours".
 */
function _renderLoading(container, from, to, alt, tas, burn, isNight, isFr) {
    const fromName = getAirportByICAO(from)?.name || from;
    const toName = getAirportByICAO(to)?.name || to;

    container.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted); font-family:'DM Mono',monospace; margin-bottom:8px;">${escapeHtml(from)} → ${escapeHtml(to)}</div>
        ${_renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr)}
        <div class="fp-loading" style="padding:20px; text-align:center; color:var(--text-muted); font-size:12px;">
            <i data-lucide="loader-2" style="width:18px;height:18px;animation:spin 1s linear infinite;vertical-align:middle;margin-right:6px;"></i>
            ${isFr ? 'Récupération des vents et du relief...' : 'Fetching winds and terrain...'}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
    _wireInputs(container, from, to);
}

/**
 * Rendu du résultat complet.
 */
function _renderResult(container, plan, isFr, isNight, alt, tas, burn) {
    const from = plan.from.icao;
    const to = plan.to.icao;
    const fromName = getAirportByICAO(from)?.name || from;
    const toName = getAirportByICAO(to)?.name || to;

    const fmtTime = (min) => {
        if (!min || min < 0) return '—';
        const h = Math.floor(min / 60);
        const m = Math.round(min % 60);
        return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    };

    const wind = plan.wind;
    const wc = plan.windCorrection;
    const cl = plan.clearance;

    // Couleur de la marge de franchissement.
    const clearColor = cl?.level === 'danger' ? '#EF4444' : (cl?.level === 'caution' ? '#F59E0B' : '#10B981');

    container.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted); font-family:'DM Mono',monospace; margin-bottom:8px;">${escapeHtml(from)} → ${escapeHtml(to)}</div>
        ${_renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr)}

        <div class="fp-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; font-size:12px; margin-top:10px;">
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Distance' : 'Distance'}</div>
                <div class="fp-value">${plan.distanceNm} NM <span style="color:var(--text-muted); font-size:10px;">(${plan.distanceKm} km)</span></div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap vrai (TC)' : 'True course'}</div>
                <div class="fp-value">${String(plan.trueCourse).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap magnétique' : 'Magnetic heading'}</div>
                <div class="fp-value" style="color:var(--primary); font-size:16px; font-weight:800;">${String(plan.magHeading).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Déclinaison' : 'Declination'}</div>
                <div class="fp-value">${plan.declination > 0 ? '+' : ''}${plan.declination}°</div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Vent à ' + plan.cruiseAltFt + ' ft' : 'Wind at ' + plan.cruiseAltFt + ' ft'}</div>
            ${wind ? `
                <div class="fp-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; font-size:12px; margin-top:6px;">
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Vent' : 'Wind'}</div>
                        <div class="fp-value">${String(wind.dir).padStart(3, '0')}° / ${wind.speedKt} kt</div>
                    </div>
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Dérive' : 'Drift'}</div>
                        <div class="fp-value" style="color:${Math.abs(wc.driftDeg) >= 10 ? '#F59E0B' : 'var(--text-color)'};">
                            ${wc.driftDeg > 0 ? '+' : ''}${wc.driftDeg}°
                        </div>
                    </div>
                </div>
            ` : `<div style="font-size:11px; color:var(--text-muted); margin-top:4px;">${isFr ? 'Vent indisponible' : 'Wind unavailable'}</div>`}
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; font-size:12px;">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Vitesse sol (GS)' : 'Ground speed'}</div>
                    <div class="fp-value">${plan.groundSpeed} kt</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Temps de vol' : 'Flight time'}</div>
                    <div class="fp-value" style="color:var(--secondary); font-weight:800;">${fmtTime(plan.legTimeMin)}</div>
                </div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Carburant' : 'Fuel'}</div>
            <div class="fp-grid" style="display:grid; grid-template-columns:1fr 1fr 1fr; gap:6px 12px; font-size:12px; margin-top:6px;">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Trajet' : 'Trip'}</div>
                    <div class="fp-value">${plan.fuel.tripFuelL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Réserve' : 'Reserve'} (${isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN}min)</div>
                    <div class="fp-value">${plan.fuel.reserveL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Total requis' : 'Total req.'}</div>
                    <div class="fp-value" style="color:var(--primary); font-weight:800; font-size:15px;">${plan.fuel.totalL} L</div>
                </div>
            </div>
        </div>

        ${cl ? `
            <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
                <div class="fp-section-title">${isFr ? 'Relief sous la route' : 'Terrain clearance'}</div>
                <div class="fp-grid" style="display:grid; grid-template-columns:1fr 1fr; gap:6px 16px; font-size:12px; margin-top:6px;">
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Altitude max sol' : 'Max terrain'}</div>
                        <div class="fp-value">${plan.elevationProfile.maxFt} ft</div>
                    </div>
                    <div class="fp-cell">
                        <div class="fp-label">${isFr ? 'Marge mini' : 'Min clearance'}</div>
                        <div class="fp-value" style="color:${clearColor}; font-weight:700;">
                            ${cl.minClearanceFt >= 0 ? '+' : ''}${cl.minClearanceFt} ft
                        </div>
                    </div>
                </div>
                ${cl.level !== 'ok' ? `
                    <div style="margin-top:6px; padding:6px 10px; background:rgba(${cl.level === 'danger' ? '239,68,68' : '245,158,11'},0.1); border-radius:6px; font-size:11px; color:${clearColor};">
                        <i data-lucide="${cl.level === 'danger' ? 'alert-octagon' : 'alert-triangle'}" style="width:13px;height:13px;vertical-align:middle;"></i>
                        ${cl.level === 'danger'
                            ? (isFr ? 'Altitude de croisière SOUS le relief — augmentez l\'altitude' : 'Cruise altitude BELOW terrain — climb higher')
                            : (isFr ? 'Marge de franchissement réduite (< 1000 ft)' : 'Reduced terrain clearance (< 1000 ft)')}
                    </div>
                ` : ''}
            </div>
        ` : ''}

        <div style="font-size:10px; color:var(--text-muted); margin-top:10px; line-height:1.4;">
            <i data-lucide="info" style="width:11px;height:11px;vertical-align:middle;"></i>
            ${isFr
                ? 'Calculs basés sur le vent Open-Meteo à l\'altitude de croisière et l\'élévation du relief. Le POH de l\'avion reste la référence légale.'
                : 'Computations based on Open-Meteo winds at cruise altitude and terrain elevation. The aircraft POH remains the legal reference.'}
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
    _wireInputs(container, from, to);
}

/**
 * Rendu en cas d'erreur (coordonnées manquantes).
 */
function _renderError(container, from, to, isFr) {
    container.innerHTML = `
        <div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px;">
            <i data-lucide="map-pin-off" style="width:20px;height:20px;"></i>
            <div style="margin-top:6px;">${isFr ? 'Coordonnées des terrains indisponibles. Chargez d\'abord la météo de chaque terrain.' : 'Airport coordinates unavailable. Load weather for each airport first.'}</div>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

/**
 * Rendu des champs de saisie (réutilisés dans loading + result).
 */
function _renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr) {
    return `
        <div class="fp-route" style="display:flex; align-items:center; gap:8px; margin-bottom:10px; font-size:12px;">
            <div style="flex:1; min-width:0;">
                <div style="color:var(--text-muted); font-size:9px; text-transform:uppercase; letter-spacing:1px;">${isFr ? 'Départ' : 'From'}</div>
                <div style="font-weight:700; color:var(--secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(from)} · ${escapeHtml(fromName)}</div>
            </div>
            <i data-lucide="arrow-right" style="width:16px;height:16px;color:var(--text-muted);flex-shrink:0;"></i>
            <div style="flex:1; min-width:0;">
                <div style="color:var(--text-muted); font-size:9px; text-transform:uppercase; letter-spacing:1px;">${isFr ? 'Destination' : 'To'}</div>
                <div style="font-weight:700; color:var(--secondary); white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(to)} · ${escapeHtml(toName)}</div>
            </div>
        </div>
        <div class="fp-inputs" style="display:grid; grid-template-columns:1fr 1fr 1fr auto; gap:8px; align-items:end;">
            <label class="fp-input-label">
                <span>${isFr ? 'Alt. croisière (ft)' : 'Cruise alt (ft)'}</span>
                <input type="number" id="fp-cruise-alt" value="${alt}" min="0" step="500" class="fp-input">
            </label>
            <label class="fp-input-label">
                <span>${isFr ? 'Vitesse air (kt)' : 'TAS (kt)'}</span>
                <input type="number" id="fp-tas" value="${tas}" min="0" step="5" class="fp-input">
            </label>
            <label class="fp-input-label">
                <span>${isFr ? 'Conso (L/h)' : 'Burn (L/h)'}</span>
                <input type="number" id="fp-burn" value="${burn}" min="0" step="1" class="fp-input">
            </label>
            <label class="fp-night-label" title="${isFr ? 'Vol de nuit (réserve 45 min au lieu de 30)' : 'Night flight (45 min reserve)'}">
                <input type="checkbox" id="fp-night" ${isNight ? 'checked' : ''}>
                <span>${isFr ? 'Nuit' : 'Night'}</span>
            </label>
        </div>
    `;
}

/**
 * Branche les écouteurs sur les inputs pour recalculer en live.
 */
function _wireInputs(container, from, to) {
    const recalc = () => showFlightPlanner(from, to);
    container.querySelector('#fp-cruise-alt')?.addEventListener('change', recalc);
    container.querySelector('#fp-tas')?.addEventListener('change', recalc);
    container.querySelector('#fp-burn')?.addEventListener('change', recalc);
    container.querySelector('#fp-night')?.addEventListener('change', recalc);
}
