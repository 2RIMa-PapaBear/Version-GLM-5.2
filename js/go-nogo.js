import { state, I18N, parseVisiToMeters, getCeiling, memoGet, getFlightCategory, findActiveValueAtHour } from './core.js';
import { airspaceContextFor } from './vfr-minima.js';
import { parseWindString, selectBestRunway } from './engine.js';
import { analyzeWeatherAlerts, analyzeForecastAlerts, openThresholdsModal } from './weather.js';
import { getAirportByICAO } from './ui-module.js';
import { getPerformanceData, densityAltitude, evaluateDensityAltitude } from './density-altitude.js';
import { computeFlightWindow } from './flight-window.js';
import { fetchPressureTrend, evaluatePressureTrend } from './pressure-trend.js';
import { evaluateSigmetAirmet } from './sigmet.js';
import { fetchSigmetAirmet } from './sigmet.js';
import { getDeclinationForIcao } from './magvar.js';
import { evaluateIcingRisk, fetchFreezingLevel } from './freezing-level.js';
import { evaluateTakeoffPerformance } from './takeoff-performance.js';
import { getLastMetarObsMs, metarAgeMin, ageLevel, fmtAge } from './data-age.js';
import { getActiveAircraft } from './aircraft-fleet.js';

/* Catégorie VMC/IMC (fiche n°3, audit 27/09) : la table FAA
 * VFR/MVFR/IFR/LIFR a été retirée — la règle européenne (SERA.5005)
 * évalue les conditions SELON LA CLASSE DE L'ESPACE du terrain affiché
 * (state._airspaceCtx, alimenté par refreshAirspaceCtx via
 * vfr-minima/airspace-profile). Sans contexte encore chargé :
 * pire-cas des deux interprétations (contrôlé/non contrôlé).
 * TAF : valeurs à l'HEURE CIBLE, pas au premier groupe de base. */
function _currentVmc(ctx) {
    const parsed = state.lastParsed;
    if (!parsed) return null;
    let visiStr, nuageStr;
    if (parsed.isMetar) {
        visiStr = parsed.base?.visi?.[0]?.val;
        nuageStr = parsed.base?.nuage?.[0]?.val;
    } else {
        const targetH = state.manualTargetHour === null
            ? (new Date().getUTCHours() + new Date().getUTCMinutes() / 60)
            : state.manualTargetHour;
        visiStr = findActiveValueAtHour(parsed.base?.visi, targetH);
        nuageStr = findActiveValueAtHour(parsed.base?.nuage, targetH);
    }
    // Visi ABSENTE = null (ré-audit 26/09, même règle que le watchdog) :
    // ne pas supposer 10 km — seul le plafond juge alors, jamais de faux GO
    // optimiste sur une donnée manquante.
    const visiM = visiStr ? parseVisiToMeters(visiStr) : null;
    const ceilHund = getCeiling(nuageStr || '');
    const catObj = getFlightCategory(visiM, ceilHund, ctx ?? undefined);
    const ceilFt = ceilHund >= 999 ? null : ceilHund * 100;
    return { catObj, visiM, ceilFt };
}

export function evaluateGoNoGo() {
    const parsed = state.lastParsed;
    if (!parsed) return null;

    const isFr = state.lang === 'fr';
    const icao = state.requestedIcao || parsed.code;
    const reasons = [];
    let verdict = 'GO';

    const memo = memoGet(parsed.code);
    const apt = getAirportByICAO(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    const flightWin = (lat != null && lon != null) ? computeFlightWindow(lat, lon) : null;

    // Contexte d'espace (classe du terrain) + nuit aéronautique locale :
    // croisés avec la visi/le plafond pour le verdict VMC/IMC SERA.5005.
    const ctx = state._airspaceCtx ? { ...state._airspaceCtx, isNight: flightWin?.status === 'night' } : null;
    const vmc = _currentVmc(ctx);
    const catObj = vmc?.catObj ?? { cat: 'VMC', verdict: { vmc: 'VMC', level: 'ok', key: 'unknown' } };

    // Âge du METAR observé (audit 26/09) : le badge d'âge existait déjà mais
    // le verdict l'ignorait — un « GO » sur une observation de 2 h devait
    // rester visible comme tel. OLD (≥ ~2 cycles) → NO-GO ; AGING → CAUTION.
    if (parsed.isMetar) {
        const obsMs = getLastMetarObsMs();
        const ageMin = obsMs != null ? metarAgeMin(obsMs) : null;
        const lvl = ageLevel(ageMin);
        if (lvl === 'old') {
            verdict = 'NO-GO';
            reasons.push({
                level: 'danger',
                icon: 'clock-alert',
                text: isFr
                    ? `METAR de ${fmtAge(ageMin)} — actualisez avant toute décision`
                    : `METAR ${fmtAge(ageMin)} old — refresh before deciding`,
            });
        } else if (lvl === 'aging') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({
                level: 'caution',
                icon: 'clock-alert',
                text: isFr
                    ? `METAR de ${fmtAge(ageMin)} — pensez à actualiser`
                    : `METAR ${fmtAge(ageMin)} old — consider refreshing`,
            });
        }
    }

    // Verdict VMC/IMC (SERA.5005, conditionné par la classe d'espace).
    // N5 (audit 27/09) : contexte indisponible → repli « contrôlé » signalé,
    // jamais présenté comme un espace réputé non contrôlé.
    const zoneLbl = ctx?.zone
        ? ` (${ctx.zone}${ctx.classe ? ` · cl. ${ctx.classe}` : ''}${ctx.unknown ? (isFr ? ' · zones indisponibles' : ' · zones unavailable') : ''})`
        : (ctx?.unknown ? (isFr ? ' (zones indisponibles — repli contrôlé)' : ' (zones unavailable — controlled fallback)') : '');
    const v = catObj.verdict;
    if (v.level === 'danger') {
        verdict = 'NO-GO';
        reasons.push({
            level: 'danger',
            icon: 'cloud-fog',
            text: isFr
                ? `Conditions IMC — sous les minima VMC${zoneLbl} (SERA.5005)`
                : `IMC conditions — below VMC minima${zoneLbl} (SERA.5005)`,
        });
    } else if (v.level === 'caution') {
        if (verdict === 'GO') verdict = 'CAUTION';
        reasons.push({
            level: 'caution',
            icon: 'cloud-drizzle',
            text: v.key === 'ctrl_clearance'
                ? (isFr
                    ? `Plafond ${vmc.ceilFt} ft — moins de 1000 ft sous la couche (clairance verticale SERA.5005)`
                    : `Ceiling ${vmc.ceilFt} ft — less than 1000 ft below cloud (SERA.5005 vertical clearance)`)
                : v.key === 'unctrl_lowceil'
                ? (isFr
                    ? `Plafond ${vmc.ceilFt} ft hors zone contrôlée — « hors nuages » légal (SERA.5005) mais très bas : garde 500 ft de hauteur minimale (SERA.3105)`
                    : `Ceiling ${vmc.ceilFt} ft uncontrolled — “clear of cloud” legal (SERA.5005) but very low: 500 ft minimum-height guard (SERA.3105)`)
                : (isFr
                    ? `Sous les minima VMC de l'espace contrôlé — VFR spécial possible sur clairance (≥ 1500 m, ≥ 600 ft, jour)`
                    : `Below VMC minima in controlled airspace — special VFR possible on clearance (≥ 1500 m, ≥ 600 ft, day)`),
        });
    }

    const raw = document.getElementById('tafInput')?.value || '';
    let alerts = [];
    if (parsed.isMetar) {
        alerts = analyzeWeatherAlerts(raw);
    } else {
        const targetH = state.manualTargetHour === null
            ? (new Date().getUTCHours() + new Date().getUTCMinutes() / 60)
            : state.manualTargetHour;
        if (targetH >= parsed.startH && targetH <= parsed.endH) {
            alerts = analyzeForecastAlerts(parsed, targetH);
        }
    }

    const dangerAlerts = alerts.filter(a => a.level === 'danger');
    const warningAlerts = alerts.filter(a => a.level === 'warning');

    if (dangerAlerts.length > 0) {
        if (verdict !== 'NO-GO') verdict = 'NO-GO';
        dangerAlerts.forEach(a => {
            reasons.push({ level: 'danger', icon: a.icon, text: _formatAlertText(a, isFr) });
        });
    }
    if (warningAlerts.length > 0) {
        if (verdict === 'GO') verdict = 'CAUTION';
        warningAlerts.forEach(a => {
            reasons.push({ level: 'caution', icon: a.icon, text: _formatAlertText(a, isFr) });
        });
    }

    if (flightWin && flightWin.status === 'night') {
        if (verdict !== 'NO-GO') verdict = 'NO-GO';
        reasons.unshift({
            level: 'danger',
            icon: 'moon',
            text: isFr ? 'Nuit aéronautique — qualification de nuit requise' : 'Aeronautical night — night rating required',
        });
    } else if (flightWin && flightWin.status === 'closing') {
        if (verdict === 'GO') verdict = 'CAUTION';
        reasons.push({
            level: 'caution',
            icon: 'sunset',
            text: isFr
                ? `Fin de journée proche (${flightWin.minutesLeft} min avant la nuit)`
                : `Daylight ending soon (${flightWin.minutesLeft} min before night)`,
        });
    }

    const perf = getPerformanceData();
    if (perf) {
        const daResult = densityAltitude(perf.elevationFt, perf.qnh, perf.oat);
        if (daResult) {
            const evalDa = evaluateDensityAltitude(daResult.da);
            if (evalDa && evalDa.level !== 'ok') {
                if (verdict === 'GO') verdict = 'CAUTION';
                reasons.push({ level: evalDa.level, icon: 'thermometer-sun', text: evalDa.message });
            }
        }
    }

    const toResult = evaluateTakeoffPerformance(icao);
    if (toResult) {
        if (toResult.level === 'danger') {
            if (verdict !== 'NO-GO') verdict = 'NO-GO';
            reasons.push({ level: 'danger', icon: 'plane-takeoff', text: toResult.message });
        } else if (toResult.level === 'caution' || toResult.level === 'limitative') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: 'caution', icon: 'plane-takeoff', text: toResult.message });
        }
    }

    if (state._pressureTrend) {
        const evalPt = evaluatePressureTrend(state._pressureTrend);
        if (evalPt && evalPt.level !== 'ok') {
            if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: evalPt.level, icon: evalPt.icon, text: evalPt.message });
        }
    }

    if (state._sigmets && state._sigmets.length > 0) {
        // M5 (audit 27/09) : le SIGMET ne frappe que s'il approche le
        // terrain affiché OU la route du plan — sinon un orage SIGMÉT sur
        // les Pyrénées mettait Lille en NO-GO national (conservateur mais
        // inutilisable les jours d'orage). Sans géométrie : conservateur.
        const routePts = [{ lat, lon }];
        for (const c of (Array.isArray(state.route) ? state.route : [])) {
            const code = String(c).toUpperCase();
            const m = memoGet(code);
            const a = m?.lat == null ? getAirportByICAO(code) : null;
            if ((m?.lat ?? a?.lat) != null) routePts.push({ lat: m?.lat ?? a.lat, lon: m?.lon ?? a.lon });
        }
        const sigAlerts = evaluateSigmetAirmet(state._sigmets, routePts);
        sigAlerts.forEach(a => {
            if (a.level === 'danger') {
                if (verdict !== 'NO-GO') verdict = 'NO-GO';
            } else if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: a.level, icon: a.icon, text: a.text });
        });
    }

    if (state._freezingLevel != null) {
        const nuageStr = parsed.base?.nuage?.[0]?.val || '';
        const icing = evaluateIcingRisk(state._freezingLevel, nuageStr);
        if (icing && icing.level !== 'ok') {
            if (icing.level === 'danger') {
                if (verdict !== 'NO-GO') verdict = 'NO-GO';
            } else if (verdict === 'GO') verdict = 'CAUTION';
            reasons.push({ level: icing.level, icon: 'snowflake', text: icing.message });
        }
    }

    const windStr = parsed.base?.vent?.[0]?.val;
    const wind = windStr ? parseWindString(windStr) : null;
    if (wind && apt && apt.runways && wind.dir !== null) {

        const dec = getDeclinationForIcao(icao);
        const rwyData = selectBestRunway(apt.runways, wind, null, dec);
        if (rwyData.active) {

            const magWindDir = (((wind.dir - dec) % 360) + 360) % 360;
            const xw = Math.abs(wind.speed * Math.sin((magWindDir - rwyData.active.hdg) * Math.PI / 180));

            const xwT = xwindThresholds(getActiveAircraft()?.xwindLimitKt);
            if (xw >= xwT.caution) {
                if (verdict === 'GO') verdict = 'CAUTION';
                reasons.push({
                    level: xw >= xwT.danger ? 'danger' : 'caution',
                    icon: 'wind',
                    text: isFr
                        ? `Vent traversier ${Math.round(xw)} kt sur ${rwyData.active.name}${xwT.limit ? ` (limite avion ${xwT.limit} kt)` : ''} — vérifiez les limites avion`
                        : `Crosswind ${Math.round(xw)} kt on ${rwyData.active.name}${xwT.limit ? ` (aircraft limit ${xwT.limit} kt)` : ''} — check aircraft limits`,
                });
                if (xw >= xwT.danger && verdict !== 'NO-GO') verdict = 'NO-GO';
            }
        }
    }

    const colors = {
        'GO': '#4ADE80',
        'CAUTION': '#F59E0B',
        'NO-GO': '#EF4444',
    };

    return { verdict, reasons, color: colors[verdict] || '#94A3B8', cat: catObj.cat };
}

/**
 * Seuils du critère vent traversier : la LIMITE DE L'AVION ACTIF (flotte)
 * prime quand elle est renseignée — PRUDENCE dès 80 % de la limite
 * (plafonné au seuil école 12 kt), NO-GO à la limite. Sans limite avion,
 * seuils génériques 12/15 kt. Pur — testé sous Node.
 * @param {number|null} xwindLimitKt limite avion (kt) ou null.
 * @returns {{limit:number|null, caution:number, danger:number}}
 */
export function xwindThresholds(xwindLimitKt) {
    const limit = Number.isFinite(xwindLimitKt) && xwindLimitKt > 0 ? xwindLimitKt : null;
    return {
        limit,
        caution: limit ? Math.min(12, Math.round(limit * 0.8)) : 12,
        danger: limit ?? 15,
    };
}

let _trendIcao = null;

export async function refreshPressureTrend(icao) {
    if (!icao || icao === _trendIcao && state._pressureTrend) return;
    _trendIcao = icao;
    state._pressureTrend = null;
    const trend = await fetchPressureTrend(icao);
    if (trend && _trendIcao === icao) {
        state._pressureTrend = trend;

        renderGoNoGo();
    }
}

let _sigmetIcao = null;
let _sigmetCoords = null;

export async function refreshSigmet(lat, lon, icao) {
    if (lat == null || lon == null) return;
    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    if (icao === _sigmetIcao && _sigmetCoords === key && state._sigmets) return;
    _sigmetIcao = icao;
    _sigmetCoords = key;
    state._sigmets = null;
    const sigmets = await fetchSigmetAirmet(lat, lon);
    if (_sigmetIcao === icao) {
        state._sigmets = sigmets;
        // Notifie la carte régionale pour tracé des polygones SIGMET/AIRMET.
        document.dispatchEvent(new CustomEvent('sigmets-updated', { detail: sigmets }));
        renderGoNoGo();
    }
}

let _freezingIcao = null;

export async function refreshFreezingLevel(icao) {
    if (!icao || icao === _freezingIcao && state._freezingLevel != null) return;
    _freezingIcao = icao;
    state._freezingLevel = null;
    const fl = await fetchFreezingLevel(icao);
    if (fl && _freezingIcao === icao) {
        state._freezingLevel = fl.altFt;
        renderGoNoGo();
    }
}

let _ctxIcao = null;

/**
 * Contexte d'espace du terrain affiché (fiche n°3, audit 27/09) :
 * alimente le verdict GO/NO-GO ET le badge VMC/IMC (classe C/D/E vs G
 * → minima SERA.5005 différents). Réutilise le cache 30 min de
 * vfr-minima (airspaceContextFor). À l'arrivée : re-rendu de la
 * bannière + événement 'airspace-ctx-updated' pour le badge/graphique.
 */
export async function refreshAirspaceCtx(icao) {
    if (!icao) return;
    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;
    if (lat == null || lon == null) { _ctxIcao = null; state._airspaceCtx = null; return; }
    if (icao === _ctxIcao && state._airspaceCtx) return;
    _ctxIcao = icao;
    state._airspaceCtx = null;
    let ctx = null;
    try { ctx = await airspaceContextFor(icao, lat, lon); } catch { /* cellules de zones indisponibles → pire-cas */ }
    if (_ctxIcao !== icao) return;
    let isNight = false;
    try { isNight = computeFlightWindow(lat, lon)?.status === 'night'; } catch { /* SunCalc indisponible */ }
    state._airspaceCtx = {
        zone: ctx?.zone ?? null,
        classe: ctx?.classe ?? '',
        controlled: !!ctx?.controlled,
        unknown: !!ctx?.unknown,
        isNight,
    };
    renderGoNoGo();
    document.dispatchEvent(new CustomEvent('airspace-ctx-updated', { detail: state._airspaceCtx }));
}

export function renderGoNoGo() {
    const container = document.getElementById('go-nogo-banner');
    if (!container) return;

    const result = evaluateGoNoGo();
    const isFr = state.lang === 'fr';

    if (!result) {
        container.style.display = 'none';
        return;
    }

    const icons = {
        'GO': 'check-circle',
        'CAUTION': 'alert-triangle',
        'NO-GO': 'x-octagon',
    };

    const verdictLabels = {
        'GO': isFr ? 'GO — Vous pouvez voler' : 'GO — You can fly',
        'CAUTION': isFr ? 'PRUDENCE — Vol possible, soyez vigilant' : 'CAUTION — Flying possible, stay alert',
        'NO-GO': isFr ? 'NO-GO — Vol déconseillé/interdit' : 'NO-GO — Flight not recommended/prohibited',
    };

    let reasonsHtml = '';
    if (result.reasons.length > 0) {
        reasonsHtml = '<div class="go-nogo-reasons" style="margin-top:6px; display:flex; flex-direction:column; gap:4px; flex:1; min-height:0; overflow-y:auto;">';
        result.reasons.forEach(r => {
            const col = r.level === 'danger' ? '#FCA5A5' : '#FCD34D';
            const dot = r.level === 'danger' ? '#EF4444' : '#F59E0B';
            reasonsHtml += `<div class="go-nogo-reason" style="display:flex; align-items:flex-start; gap:6px; padding:5px 8px; border-radius:5px; font-size:11px; line-height:1.3; color:${col};">
                <span style="width:6px; height:6px; border-radius:50%; background:${dot}; flex-shrink:0; margin-top:4px;"></span>
                <span>${r.text}</span>
            </div>`;
        });
        reasonsHtml += '</div>';
    } else if (result.verdict === 'GO') {
        reasonsHtml = `<div style="margin-top:6px; padding:6px 8px; font-size:11px; color:rgba(74,222,128,0.9); display:flex; align-items:center; gap:6px;">
            <span style="width:6px; height:6px; border-radius:50%; background:#4ADE80; flex-shrink:0;"></span>
            ${isFr ? 'Tous les paramètres sont au vert.' : 'All parameters are green.'}
        </div>`;
    }

    container.innerHTML = `
        <div class="go-nogo-content" style="display:flex; flex-direction:column; height:100%;" title="${isFr ? 'Verdict établi en fonction de vos réglages des minimums VFR.' : 'Verdict based on your VFR minima settings.'}">
            <div class="go-nogo-verdict-block" style="display:flex; flex-direction:column; align-items:center; gap:4px; padding-top:12px; padding-bottom:8px;">
                <div class="go-nogo-icon" style="width:53px; height:53px; border-radius:50%; background:${result.color}22; border:3px solid ${result.color}; display:flex; align-items:center; justify-content:center;">
                    <i data-lucide="${icons[result.verdict]}" style="width:29px; height:29px; color:${result.color};"></i>
                </div>
                <div style="font-size:20px; font-weight:900; color:${result.color}; letter-spacing:1px; line-height:1;">${result.verdict}</div>
                <div style="font-size:9px; color:var(--text-muted); text-align:center; line-height:1.2;">${verdictLabels[result.verdict]}</div>
            </div>
            ${reasonsHtml}
            <button id="go-nogo-config" class="go-nogo-config-btn" title="${isFr ? 'Réglages des Minimums VFR' : 'VFR minima settings'}" style="background:none; border:none; cursor:pointer; padding:3px; border-radius:6px; color:var(--text-muted); opacity:0.6; transition:opacity 0.2s; display:flex; align-items:center; margin-left:auto; margin-top:auto; align-self:flex-end;" onmouseover="this.style.opacity=1" onmouseout="this.style.opacity=0.6">
                <i data-lucide="settings" style="width:15px; height:15px;"></i>
            </button>
        </div>
    `;
    container.style.background = result.color + '15';
    container.style.borderColor = result.color;
    container.style.borderLeftWidth = '5px';
    container.style.display = 'flex';
    if (window.lucide) window.lucide.createIcons({ root: container });

    container.querySelector('#go-nogo-config')?.addEventListener('click', openThresholdsModal);
}

function _formatAlertText(alert, isFr) {
    if (alert.category === 'phenomenon') return alert.title;
    let unit = '';
    if (alert.category === 'ceiling') unit = ' ft';
    else if (alert.category === 'visibility') unit = ' m';
    else if (alert.category === 'wind' || alert.category === 'gusts') unit = ' kt';
    return alert.value !== null ? `${alert.title}: ${alert.value}${unit}` : alert.title;
}
