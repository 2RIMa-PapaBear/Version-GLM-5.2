import { state, escapeHtml } from './core.js';
import { getAirportByICAO, enrichAirport } from './ui-module.js';
import { getActiveAircraftId } from './aircraft-fleet.js';
import { makeCollapsible } from './collapsible.js';
import { computeFlightPlan, computeMultiLegFlightPlan, getDefaultAircraftPerf, RESERVES } from './flight-planner.js';
import { renderElevationChart, clearElevationChart } from './elevation-chart.js';
import { fetchAirportByIcao } from './openaip.js';

const LS_PERF_PREFIX = 'ac-perf-';

// Retourne la fréquence principale (TWR/AFIS) d'un terrain, ou null si non disponible.
function _getMainFreq(icao) {
    const apt = getAirportByICAO(icao);
    if (!apt?.frequencies?.length) return null;
    const primary = apt.frequencies.find(f => f.primary) || apt.frequencies.find(f => f.type === 'TWR' || f.type === 'AFIS');
    return primary || apt.frequencies[0];
}

// Charge les fréquences manquantes des waypoints en arrière-plan, puis re-rend le panneau.
function _preloadWaypointFreqs(plan, reRenderFn) {
    if (!plan?.waypoints) return;
    const missing = plan.waypoints.filter(w => !_getMainFreq(w.icao));
    if (!missing.length) return;
    Promise.all(missing.map(w =>
        fetchAirportByIcao(w.icao).then(e => { if (e) enrichAirport(w.icao, e); }).catch(() => {})
    )).then(() => { if (typeof reRenderFn === 'function') reRenderFn(); });
}

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
    } catch {   }
    return def;
}

function _writePerf(acId, tasKt, fuelBurnLph) {
    if (!acId) return;
    try {
        localStorage.setItem(LS_PERF_PREFIX + acId, JSON.stringify({ tasKt, fuelBurnLph }));
    } catch {   }
}

export async function showFlightPlanner(fromIcao, toIcao) {
    const container = document.getElementById('flight-planner-panel');
    if (!container) return;

    if (!fromIcao || !toIcao || fromIcao === toIcao) {
        container.style.display = 'none';
        return;
    }

    const isFr = state.lang === 'fr';
    const acId = getActiveAircraftId();
    const perf = _readPerf(acId);

    const body = makeCollapsible(container, isFr ? 'Calcul de navigation' : 'Flight plan', 'navigation');

    let cruiseAlt = 2500;
    const altInput = body.querySelector('#fp-cruise-alt');
    if (altInput && altInput.value) cruiseAlt = parseInt(altInput.value, 10);
    const tasInput = body.querySelector('#fp-tas');
    let tasKt = tasInput?.value ? parseInt(tasInput.value, 10) : perf.tasKt;
    const burnInput = body.querySelector('#fp-burn');
    let burn = burnInput?.value ? parseInt(burnInput.value, 10) : perf.fuelBurnLph;
    const nightInput = body.querySelector('#fp-night');
    const isNight = nightInput ? nightInput.checked : false;

    _renderLoading(body, fromIcao, toIcao, cruiseAlt, tasKt, burn, isNight, isFr);

    // Multi-waypoints si state.route est défini (≥3 OACI), sinon plan A→B simple.
    const route = (Array.isArray(state.route) && state.route.length >= 3)
        ? state.route : [fromIcao, toIcao];
    const plan = route.length >= 3
        ? await computeMultiLegFlightPlan(route, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight })
        : await computeFlightPlan(fromIcao, toIcao, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight });

    if (!plan) {
        _renderError(body, fromIcao, toIcao, isFr);
        container.style.display = 'block';
        return;
    }

    _writePerf(acId, tasKt, burn);

    _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
    container.style.display = 'block';

    // Pré-charge les fréquences des waypoints en arrière-plan puis re-rend.
    if (plan.isMultiLeg && plan.waypoints) {
        _preloadWaypointFreqs(plan, () => {
            if (!_recalculating) _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
        });
    }

    if (plan.elevationProfile) {
        // En multi-leg, passe les waypoints intermédiaires pour les afficher sur le profil.
        const waypoints = (plan.isMultiLeg && plan.waypoints)
            ? plan.waypoints.map(w => ({ icao: w.icao, lat: w.lat, lon: w.lon }))
            : null;
        renderElevationChart('elevation-profile-container', plan.elevationProfile, cruiseAlt, fromIcao, toIcao, waypoints);
    } else {
        clearElevationChart('elevation-profile-container');
    }
}

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

function _renderResult(container, plan, isFr, isNight, alt, tas, burn) {
    // Gère les deux formats de plan :
    //   - single-leg : { from, to, distanceNm, trueCourse, magHeading, windCorrection, legTimeMin, ... }
    //   - multi-leg  : { waypoints[], legs[], totalDistanceNm, totalTimeMin, fuel, declination, ... }
    // On normalise vers une vue synthétique (1re jambe pour cap/vent, totaux pour distance/temps/fuel).
    const isMulti = Array.isArray(plan.legs) && plan.legs.length > 0;
    const firstLeg = isMulti ? plan.legs[0] : plan;
    const fromIcao = isMulti ? (plan.waypoints?.[0]?.icao || '') : (plan.from?.icao || '');
    const toIcao = isMulti ? (plan.waypoints?.[plan.waypoints.length - 1]?.icao || '') : (plan.to?.icao || '');

    const from = fromIcao;
    const to = toIcao;
    const fromName = getAirportByICAO(from)?.name || from;
    const toName = getAirportByICAO(to)?.name || to;

    const fmtTime = (min) => {
        if (!min || min < 0) return '—';
        const h = Math.floor(min / 60);
        const m = Math.round(min % 60);
        return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`;
    };

    const wind = plan.wind;
    const wc = isMulti ? (firstLeg.windCorrection || {}) : plan.windCorrection;
    const cl = plan.clearance;

    // Champs unifiés single-leg / multi-leg.
    const distanceNm = isMulti ? plan.totalDistanceNm : plan.distanceNm;
    const distanceKm = isMulti ? plan.totalDistanceKm : plan.distanceKm;
    const trueCourse = isMulti ? firstLeg.trueCourse : plan.trueCourse;
    const magHeading = isMulti ? firstLeg.magHeading : plan.magHeading;
    const declination = plan.declination ?? 0;
    const cruiseAltFt = plan.cruiseAltFt;
    const groundSpeed = isMulti ? firstLeg.groundSpeed : plan.groundSpeed;
    const legTimeMin = isMulti ? plan.totalTimeMin : plan.legTimeMin;
    const fuel = plan.fuel;

    const clearColor = cl?.level === 'danger' ? '#EF4444' : (cl?.level === 'caution' ? '#F59E0B' : '#10B981');

    container.innerHTML = `
        <div style="font-size:11px; color:var(--text-muted); font-family:'DM Mono',monospace; margin-bottom:8px;">${escapeHtml(from)} → ${escapeHtml(to)}</div>
        ${_renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr)}

        <div class="fp-grid" style="gap:8px 16px; margin-top:10px;">
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Distance' : 'Distance'}</div>
                <div class="fp-value">${distanceNm} NM <span style="color:var(--text-muted); font-size:10px;">(${distanceKm} km)</span></div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap vrai (TC)' : 'True course'}</div>
                <div class="fp-value">${String(trueCourse).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Cap magnétique' : 'Magnetic heading'}</div>
                <div class="fp-value" style="color:var(--primary); font-size:16px; font-weight:800;">${String(magHeading).padStart(3, '0')}°</div>
            </div>
            <div class="fp-cell">
                <div class="fp-label">${isFr ? 'Déclinaison' : 'Declination'}</div>
                <div class="fp-value">${declination > 0 ? '+' : ''}${declination}°</div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Vent à ' + cruiseAltFt + ' ft' : 'Wind at ' + cruiseAltFt + ' ft'}</div>
            ${wind ? `
                <div class="fp-grid" style="margin-top:6px;">
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
            <div class="fp-grid">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Vitesse sol (GS)' : 'Ground speed'}</div>
                    <div class="fp-value">${groundSpeed} kt</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Temps de vol' : 'Flight time'}</div>
                    <div class="fp-value" style="color:var(--secondary); font-weight:800;">${fmtTime(legTimeMin)}</div>
                </div>
            </div>
        </div>

        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
            <div class="fp-section-title">${isFr ? 'Carburant' : 'Fuel'}</div>
            <div class="fp-grid fp-grid-3" style="margin-top:6px;">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Trajet' : 'Trip'}</div>
                    <div class="fp-value">${fuel.tripFuelL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Réserve' : 'Reserve'} (${isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN}min)</div>
                    <div class="fp-value">${fuel.reserveL} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Total requis' : 'Total req.'}</div>
                    <div class="fp-value" style="color:var(--primary); font-weight:800; font-size:15px;">${fuel.totalL} L</div>
                </div>
            </div>
        </div>

        ${cl ? `
            <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
                <div class="fp-section-title">${isFr ? 'Relief sous la route' : 'Terrain clearance'}</div>
                <div class="fp-grid" style="margin-top:6px;">
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

        ${plan.isMultiLeg && plan.legs?.length ? `
            <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px solid var(--border-color);">
                <div class="fp-section-title">${isFr ? 'Détail des waypoints (' + plan.legs.length + ')' : 'Leg details (' + plan.legs.length + ')'}</div>
                <table class="fp-navlog" style="margin-top:6px;">
                    <thead>
                        <tr>
                            <th>${isFr ? 'Tronçon' : 'Leg'}</th>
                            <th>${isFr ? 'Dist' : 'Dist'}</th>
                            <th>${isFr ? 'Cap' : 'Hdg'}</th>
                            <th>ETE</th>
                            <th>${isFr ? 'Conso' : 'Fuel'}</th>
                            <th>${isFr ? 'Fréq' : 'Freq'}</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${plan.legs.map(lg => {
                            const f = _getMainFreq(lg.to.icao);
                            return `
                            <tr>
                                <td><b>${escapeHtml(lg.from.icao)}</b> → <b>${escapeHtml(lg.to.icao)}</b></td>
                                <td>${lg.distanceNm} NM</td>
                                <td>${String(lg.magHeading).padStart(3,'0')}°</td>
                                <td>${fmtTime(lg.legTimeMin)}</td>
                                <td>${lg.fuel.tripFuelL} L</td>
                                <td class="freq-cell">${f ? f.freq.toFixed(3) + ' ' + escapeHtml(f.type) : '—'}</td>
                            </tr>`;
                        }).join('')}
                        <tr class="total">
                            <td>${isFr ? 'TOTAL' : 'TOTAL'}</td>
                            <td>${plan.totalDistanceNm} NM</td>
                            <td>—</td>
                            <td>${fmtTime(plan.totalTimeMin)}</td>
                            <td>${plan.fuel.tripFuelL} L</td>
                            <td>—</td>
                        </tr>
                    </tbody>
                </table>
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

function _renderError(container, from, to, isFr) {
    container.innerHTML = `
        <div style="padding:14px; text-align:center; color:var(--text-muted); font-size:12px;">
            <i data-lucide="map-pin-off" style="width:20px;height:20px;"></i>
            <div style="margin-top:6px;">${isFr ? 'Coordonnées des terrains indisponibles. Chargez d\'abord la météo de chaque terrain.' : 'Airport coordinates unavailable. Load weather for each airport first.'}</div>
        </div>
    `;
    if (window.lucide) window.lucide.createIcons({ root: container });
}

function _renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr) {
    const waypointsValue = (state.route && state.route.length > 2)
        ? state.route.slice(1, -1).join(' ') : '';
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
        <div class="fp-inputs">
            <label class="fp-input-label" style="grid-column: 1 / -1;" title="${isFr ? 'Waypoints intermédiaires (codes OACI séparés par espaces)' : 'Intermediate waypoints (ICAO codes, space-separated)'}">
                <span>${isFr ? 'Waypoints (optionnel)' : 'Waypoints (optional)'}</span>
                <input type="text" id="fp-waypoints" value="${escapeHtml(waypointsValue)}" placeholder="${isFr ? 'LFPB LFOB puis Tab' : 'LFPB LFOB then Tab'}" class="fp-input" style="font-family:'DM Mono',monospace; text-transform:uppercase;">
            </label>
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

function _wireInputs(container, from, to) {
    // Garde-fou anti-récursion : showFlightPlanner recrée le DOM et rewire les inputs,
    // ce qui peut redéclencher 'change' et boucler (OOM). Le flag bloque les recalculs
    // pendant qu'un recalcul est en cours.
    let _recalculating = false;
    const recalc = () => {
        if (_recalculating) return;   // évite la récursion pendant le re-render
        _recalculating = true;
        try {
            // Lit les waypoints saisis et peuple state.route pour le multi-leg.
            const wpInput = container.querySelector('#fp-waypoints');
            if (wpInput) {
                const wps = wpInput.value.trim().toUpperCase().split(/\s+/).filter(w => /^[A-Z]{4}$/.test(w));
                state.route = wps.length ? [from, ...wps, to] : null;
            }
            showFlightPlanner(from, to);
            // Notifie la carte régionale de redessiner la route avec les waypoints.
            // setTimeout(0) : attend que le DOM du panneau soit recréé avant de notifier,
            // pour éviter que le re-render ne détruise le champ waypoints en cours de saisie.
            setTimeout(() => window.dispatchEvent(new CustomEvent('route-changed')), 0);
        } finally {
            _recalculating = false;
        }
    };
    // change/blur : recalc immédiat (l'utilisateur a fini de saisir).
    container.querySelector('#fp-cruise-alt')?.addEventListener('change', recalc);
    container.querySelector('#fp-tas')?.addEventListener('change', recalc);
    container.querySelector('#fp-burn')?.addEventListener('change', recalc);
    container.querySelector('#fp-night')?.addEventListener('change', recalc);
    // IMPORTANT : on n'écoute QUE 'change' (déclenché à la perte de focus / Entrée),
    // jamais 'input' (frappe clavier). Sinon showFlightPlanner recrée le DOM et
    // détruit le champ en cours de saisie → l'utilisateur ne peut pas taper ses waypoints.
    container.querySelector('#fp-waypoints')?.addEventListener('change', recalc);
}
