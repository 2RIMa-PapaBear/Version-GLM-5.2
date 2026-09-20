import { state, escapeHtml, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO, enrichAirport } from './ui-module.js';
import { getActiveAircraftId, getActiveAircraft, getFleet, updateAircraft, usableFuelOf } from './aircraft-fleet.js';
import { getActiveRunwayNameForIcao, evaluateTakeoffFromRaw, evaluateLandingFromRaw, evaluateLandingAtDestination, fetchTafWithFallback, getAircraftRef } from './takeoff-performance.js';
import { showTakeoffWidget } from './takeoff-ui.js';
import { showFrequenciesWidget } from './frequencies-ui.js';
import { collectFileInputs, computeFileTiles, showFlightFile } from './flight-file.js';
import { getVacIndexInfo, getVacConsultedTs } from './vac-viewer.js';
import { getLastMetarObsMs } from './data-age.js';
import { getLastNotamFetchTs } from './notam.js';
import { drawNavLogPdf, drawNotamAnnex, drawFileCover, drawWeatherPage, drawVacPages } from './navlog-pdf.js';
import { getSelectedNotams, getCurrentNotams } from './notam.js';
import { computeWb, resolveLoads, normalizeEnvelope } from './wb-core.js';
import { makeCollapsible } from './collapsible.js';
import { computeFlightPlan, computeMultiLegFlightPlan, getDefaultAircraftPerf, greatCircleDistanceNm, computeLeg2Fuel, RESERVES } from './flight-planner.js';
import { evaluateVfrMinima, collectVfrMinima } from './vfr-minima.js';
import { getActiveRunwaySurfaceInfo, isSoftSurface } from './runway-surface.js';
import { getEnRouteAlternates } from './alternates.js';
import { drawFlightMapPage } from './flight-map-pdf.js';
import { buildFlightMapData } from './flight-map-collect.js';
import { renderElevationChart, clearElevationChart } from './elevation-chart.js';
import { fetchAirportByIcao } from './openaip.js';
import { loadFreqSources, getAirportFreqs } from './freq-sia.js';
import { getSiaAirfield } from './sia-data.js';

const LS_PERF_PREFIX = 'ac-perf-';

// Retourne la fréquence principale (TWR/AFIS) d'un terrain, ou null si non disponible.
function _getMainFreq(icao) {
    const apt = getAirportByICAO(icao);
    if (!apt?.frequencies?.length) return null;
    const primary = apt.frequencies.find(f => f.primary) || apt.frequencies.find(f => f.type === 'TWR' || f.type === 'AFIS');
    return primary || apt.frequencies[0];
}

/** Meilleure fréquence d'une étape pour le « Détail des waypoints » :
 *  SIA officiel en priorité (types RÉELS : TWR, AFIS, APP, FIS, ATIS…),
 *  à défaut openAIP (types souvent génériques COM/UNK). Un terrain
 *  FRANÇAIS connu sans fréquence fixe reçoit 123.500 MHz (fréquence
 *  standard VFR en l'absence de fréquence spécifique). Retourne
 *  { freq, type } ou null. */
function _legMainFreq(icao) {
    // VOLMET = diffusion météo automatique à ÉCOUTER, pas une fréquence de
    // contact du terrain : jamais retenue comme fréquence d'étape (retour
    // pilote 12/09 « 123.500 VOLMET » sur LFOO → LFTA).
    const { source, freqs } = getAirportFreqs(icao, getAirportByICAO(icao)?.frequencies || []);
    const usable = freqs.filter(x => x.type !== 'VOLMET');
    if (usable.length) {
        // Ordre de préférence : tour/AFIS du terrain, puis approche, FIS,
        // ATIS, et enfin A/A (air-air : seul service de nombreux petits
        // terrains — Ploërmel, LFEV…).
        const prio = ['TWR', 'AFIS', 'APP', 'FIS', 'ATIS', 'A/A'];
        for (const t of prio) {
            let f = usable.find(x => x.type === t);
            // Plusieurs A/A publiées (ex. LFOM : « SAINT LAURENT » 123.500
            // ET « LESSAY » 128.930) : celle au nom du terrain d'abord,
            // sinon une valeur différente de la standard 123.500.
            if (t === 'A/A') {
                const cands = usable.filter(x => x.type === t);
                if (cands.length > 1) {
                    const apt = getAirportByICAO(icao);
                    const word = (apt?.name || '').split(/[\s-]/)[0]?.toUpperCase();
                    f = cands.find(x => word && (x.name || '').toUpperCase().includes(word))
                        || cands.find(x => Math.abs((x.freq || 0) - 123.5) > 0.001)
                        || cands[0];
                }
            }
            if (f) return f;
        }
        return usable[0];
    }
    if (/^LF/.test(String(icao || '')) && getAirportByICAO(icao)) {
        return { freq: 123.5, type: 'STD' };
    }
    return null;
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

// Perf nav (TAS, conso) : la FLOTTE est la source de vérité — champs
// « Vitesse croisière / Conso croisière » des caractéristiques de l'avion.
// L'ancien stockage ac-perf-<id> (saisies du planificateur) est relu une
// dernière fois pour les avions qui n'ont pas encore ces champs, puis la
// première saisie le recopie dans la flotte et vide l'ancienne clé.
function _readPerf(acId) {
    const def = getDefaultAircraftPerf();
    if (!acId) return def;
    const ac = getFleet().find(a => a.id === acId) || {};
    let tasKt = typeof ac.cruiseSpeedKt === 'number' ? ac.cruiseSpeedKt : null;
    let fuelBurnLph = typeof ac.fuelBurnLph === 'number' ? ac.fuelBurnLph : null;
    if (tasKt == null || fuelBurnLph == null) {
        try {
            const raw = localStorage.getItem(LS_PERF_PREFIX + acId);
            if (raw) {
                const p = JSON.parse(raw);
                if (tasKt == null && typeof p.tasKt === 'number') tasKt = p.tasKt;
                if (fuelBurnLph == null && typeof p.fuelBurnLph === 'number') fuelBurnLph = p.fuelBurnLph;
            }
        } catch {   }
    }
    return {
        tasKt: tasKt ?? def.tasKt,
        fuelBurnLph: fuelBurnLph ?? def.fuelBurnLph,
        reserveExtraMin: Number.isFinite(ac.reserveExtraMin) ? ac.reserveExtraMin : (def.reserveExtraMin ?? 0),
        unusableFuelL: (ac.unusableFuelL > 0) ? ac.unusableFuelL : (def.unusableFuelL ?? 0),
    };
}

function _writePerf(acId, tasKt, fuelBurnLph) {
    if (!acId) return;
    // Persiste dans les caractéristiques de l'avion (flotte) et retire
    // l'ancienne clé ac-perf (migration effectuée).
    updateAircraft(acId, { cruiseSpeedKt: tasKt, fuelBurnLph });
    try { localStorage.removeItem(LS_PERF_PREFIX + acId); } catch {   }
}

// Garde-fou anti-récursion PARTAGÉ : le callback de _preloadWaypointFreqs (dans
// showFlightPlanner) et recalc (dans _wireInputs) doivent voir le MÊME flag.
// Déclaré au niveau module — sinon ReferenceError dans le callback de re-render.
let _recalculating = false;

// Jeton d'obsolescence des calculs de plan : deux showFlightPlanner peuvent
// se chevaucher (ex. changement de départ pendant un calcul multi-étapes) ;
// le rendu du calcul le plus ANCIEN ne doit pas écraser celui du plus récent.
let _plannerToken = 0;

export async function showFlightPlanner(fromIcao, toIcao) {
    // PRÉCHAUFFAGE (retour pilote 13/09 « perfs atterrissage lentes ») :
    // la météo de l'ARRIVÉE part EN TÊTE de la file relais, AVANT les
    // fetchs du plan (TAF, vents, relief, alternates, NOTAM…) — quand le
    // widget « Performances piste » se rend, le cache (10 min) répond
    // immédiatement. Fire-and-forget : n'entrave jamais le plan.
    const dest = String(toIcao || '').toUpperCase();
    if (/^[A-Z][A-Z0-9]{3}$/.test(dest) && dest !== String(fromIcao || '').toUpperCase()) {
        evaluateLandingAtDestination(dest).catch(() => {});
    }
    const container = document.getElementById('flight-planner-panel');
    if (!container) return;
    loadFreqSources();   // SIA + overrides : fréquences réelles des étapes

    if (!fromIcao || !toIcao || fromIcao === toIcao) {
        container.style.display = 'none';
        return;
    }
    const myToken = ++_plannerToken;

    const isFr = state.lang === 'fr';
    const acId = getActiveAircraftId();
    const perf = _readPerf(acId);

    const body = makeCollapsible(container, isFr ? 'Calcul de navigation' : 'Flight plan', 'navigation');

    let cruiseAlt = 2500;
    const altInput = body.querySelector('#fp-cruise-alt');
    if (altInput && altInput.value) cruiseAlt = parseInt(altInput.value, 10);
    const tasInput = body.querySelector('#fp-tas');
    let tasKt = tasInput?.value ? parseInt(tasInput.value, 10) : perf.tasKt;
    // Conso : PARAMÈTRE INFORMATIF (retour pilote 19/09) — toujours celle de
    // la fiche avion (fenêtre Flotte), jamais modifiable dans le calcul.
    const burn = perf.fuelBurnLph;
    const nightInput = body.querySelector('#fp-night');
    const isNight = nightInput ? nightInput.checked : false;

    _renderLoading(body, fromIcao, toIcao, cruiseAlt, tasKt, burn, isNight, isFr);

    // Multi-waypoints si state.route est défini (≥3 OACI) ET cohérent avec le
    // départ/destination demandés — une séquence périmée (ancien départ en
    // tête après un changement) serait calculée telle quelle. Sinon plan A→B.
    const seq = Array.isArray(state.route) ? state.route : [];
    const route = (seq.length >= 3
        && String(seq[0]).toUpperCase() === fromIcao.toUpperCase()
        && String(seq[seq.length - 1]).toUpperCase() === toIcao.toUpperCase())
        ? seq : [fromIcao, toIcao];
    const plan = route.length >= 3
        ? await computeMultiLegFlightPlan(route, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight, diversionIcao: state.diversionIcao || null, reserveExtraMin: perf.reserveExtraMin ?? 0, unusableFuelL: perf.unusableFuelL ?? 0 })
        : await computeFlightPlan(fromIcao, toIcao, { cruiseAltFt: cruiseAlt, tasKt, fuelBurnLph: burn, isNight, diversionIcao: state.diversionIcao || null, reserveExtraMin: perf.reserveExtraMin ?? 0, unusableFuelL: perf.unusableFuelL ?? 0 });

    // Un calcul plus récent a pris la main (changement de départ/destination
    // pendant les fetchs) : ce rendu périmé ne doit pas l'écraser.
    if (myToken !== _plannerToken) return;

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
            if (!_recalculating && myToken === _plannerToken) _renderResult(body, plan, isFr, isNight, cruiseAlt, tasKt, burn);
        });
    }

    if (plan.elevationProfile) {
        // En multi-leg, passe les waypoints intermédiaires pour les afficher
        // sur le profil — sous leur vrai nom pour les repères ZZxx.
        const waypoints = (plan.isMultiLeg && plan.waypoints)
            ? plan.waypoints.map(w => ({ icao: w.icao, name: _wpDisplayName(w.icao), lat: w.lat, lon: w.lon }))
            : null;
        renderElevationChart('elevation-profile-container', plan.elevationProfile, cruiseAlt, fromIcao, toIcao, waypoints, plan.routeAirspaces);
    } else {
        clearElevationChart('elevation-profile-container');
    }

    // Le plan vient d'être (re)calculé : la section ATTERRISSAGE du widget
    // « Performances piste » dépend de la DESTINATION — le widget n'étant
    // sinon rendu qu'au chargement du METAR, une destination saisie
    // APRÈS ce chargement ne l'actualisait jamais (div vide). On re-rend
    // sur le terrain OBSERVÉ (consultation départ/arrivée comprise).
    showTakeoffWidget(state.requestedIcao || fromIcao);
    // Idem pour l'onglet « Info terrain » : en navigation, le bloc
    // « Info terrain d'arrivée » suit la destination (retour pilote
    // 19/09) — saisie APRÈS le chargement du METAR comprise.
    showFrequenciesWidget(state.requestedIcao || fromIcao);
    // Idem pour le panneau « Dossier de vol » : la tuile Carburant suit le
    // PLAN (total requis) — retour pilote 13/09 : elle ne bougeait pas à
    // la modification du PV.
    showFlightFile();

    // B3+ (14/09) : le plan vient d'être recalculé (altitude comprise) →
    // la couche Vent de la carte suit (bidirectionnel : carte ↔ plan).
    try { document.dispatchEvent(new CustomEvent('windlayer:plan-alt')); } catch {   }
}

// Choix/retrait du terrain de dégagement (panneau Alternates, état
// state.diversionIcao) : recalcul complet du plan — le devis carburant
// (Trajet + Dégagement + Réserve) et le pré-remplissage du centrage suivent.
if (typeof document !== 'undefined') {
    document.addEventListener('diversion-changed', (e) => {
        const { from, to } = e.detail || {};
        if (from && to) showFlightPlanner(from, to);
    });
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

// Export PDF du log de nav A5 (d'après le modèle papier du pilote).
// Collecte les données connues de l'app : avion actif de la flotte, METAR de
// départ frais (QNH + vent pour l'en-tête, code brut pour la 1re ligne des
// Notes), piste en service, tronçons du plan avec Z sécu calculée (relief max
// du tronçon + 1000 ft, arrondi aux 500 ft sup). Les champs inconnus (pilote,
// c/sign, heures, horamètres, HEA/HRA) restent vides à remplir à la main.
async function _generateNavLogPdf(opts = {}) {
    // L'onglet est ouvert immédiatement, pendant que le geste utilisateur est
    // encore actif (la génération attend un METAR : un window.open tardif serait
    // bloqué comme popup). Le PDF s'y chargera une fois généré ; en cas
    // d'échec, l'onglet est refermé.
    const tab = window.open('', '_blank');
    try {
        await _generateNavLogPdfInto(tab, opts);
    } catch (err) {
        console.error('Nav log PDF generation failed:', err);
        try { tab?.close(); } catch { /* déjà fermé */ }
    }
}

/** PDF UNIQUE du dossier de vol (B1 phase 2) : le bouton du panneau
 *  « Dossier de vol » (flight-file.js, import dynamique anti-cycle).
 *  Vol local (retour pilote 19/09) : même organisation de dossier, log
 *  réduit au terrain (en-tête + devis local, tronçons vierges). */
export function printFlightFile() {
    const isFr = state.lang === 'fr';
    const local = !(typeof document !== 'undefined' && document.body?.classList.contains('mode-nav'));
    _confirmNavLogPdf(isFr, { file: true, local }).then(ok => { if (ok) _generateNavLogPdf({ file: true, local }); });
}

async function _generateNavLogPdfInto(tab, { file = false, local = false } = {}) {
    let stash = state._lastNavPlan;
    if (local) {
        // VOL LOCAL : plan synthétique terrain → terrain. Le dossier garde
        // l'organisation de la navigation (garde / log / météo / NOTAM /
        // carte / VAC / centrage) ; le log se réduit à l'en-tête (QNH, vent,
        // piste, durée) et au devis carburant local — les tronçons restent
        // VIERGES, remplis à la main pour les tours de piste.
        const icao = String(state.requestedIcao || '').toUpperCase();
        const apt = getAirportByICAO(icao);
        const memo = memoGet(icao);
        const lat = memo?.lat ?? apt?.lat ?? null;
        const lon = memo?.lon ?? apt?.lon ?? null;
        if (!/^[A-Z][A-Z0-9]{3}$/.test(icao) || lat == null || lon == null) return;
        const ac0 = getActiveAircraft() || {};
        const burn = ac0.fuelBurnLph ?? 35;
        // Même formule que le devis du widget Centrage / la tuile Carburant.
        const min = parseInt(document.getElementById('wb-local-min')?.value, 10) || 0;
        const reserveMin = 10 + (ac0.reserveExtraMin || 0);
        const unusableL = (ac0.unusableFuelL > 0) ? ac0.unusableFuelL : 0;
        const r1 = (v) => Math.round(v * 10) / 10;
        const tripL = r1(min / 60 * burn);
        const groundL = r1(10 / 60 * burn);
        const reserveL = r1(reserveMin / 60 * burn);
        stash = {
            plan: {
                from: { icao, lat, lon, elevFt: apt?.elevation ?? null },
                to: { icao, lat, lon, elevFt: apt?.elevation ?? null },
                distanceNm: null, distanceKm: null,
                trueCourse: null, magHeading: null, trueHeading: null,
                wind: null, windCorrection: {}, groundSpeed: null,
                legTimeMin: min,
                fuel: {
                    tripFuelL: tripL, groundMin: 10, groundL,
                    reserveMin, reserveL, unusableL,
                    totalL: r1(tripL + groundL + reserveL + unusableL),
                    diversionL: 0, diversion: null,
                },
                cruiseAltFt: null, tasKt: null, declination: null,
                elevationProfile: null, obstacles: [], clearance: null,
                routeAirspaces: null, waypoints: null, legs: null,
            },
            tas: null, alt: null, burn, isNight: false, isFr: state.lang === 'fr',
        };
    }
    if (!stash?.plan) return;
    const { plan, tas } = stash;
    if (!window.jspdf?.jsPDF) { console.warn('jsPDF indisponible (vendor/jspdf.umd.min.js)'); return; }

    // Cartes VAC rendues (option ②=B) : déclarées ICI — collectées dans le
    // bloc garde (avant son dessin, pour une attestation exacte), posées en
    // pages A5 APRÈS la carte de vol. (TDZ : une déclaration plus bas fait
    // ReferenceError dans le bloc garde.)
    let vacPagesData = [];

    const isMulti = Array.isArray(plan.legs) && plan.legs.length > 0;
    const legs = isMulti ? plan.legs : [{
        from: plan.from, to: plan.to, distanceNm: plan.distanceNm,
        trueCourse: plan.trueCourse, magHeading: plan.magHeading, legTimeMin: plan.legTimeMin,
    }];
    const fromIcao = legs[0].from.icao;
    const toIcao = legs[legs.length - 1].to.icao;
    const totalNm = isMulti ? plan.totalDistanceNm : plan.distanceNm;
    const totalMin = isMulti ? plan.totalTimeMin : plan.legTimeMin;

    // METAR de départ frais : QNH + vent pour l'en-tête, code brut pour les Notes.
    let metarRaw = '', qnh = '', windDir = null, windKt = null;
    try {
        metarRaw = String(await fetchAvecRelais(`https://aviationweather.gov/api/data/metar?ids=${fromIcao}&format=raw`) || '').trim().split('\n')[0] || '';
        const mQ = metarRaw.match(/\bQ(\d{4})\b/);
        if (mQ) qnh = parseInt(mQ[1], 10);
        const mW = metarRaw.match(/\b(\d{3}|VRB)(\d{2})(?:G\d{2})?KT\b/);
        if (mW) { windDir = mW[1] === 'VRB' ? 'VRB' : parseInt(mW[1], 10); windKt = parseInt(mW[2], 10); }
    } catch { /* hors ligne : champs laissés vides à compléter à la main */ }

    const ac = getActiveAircraft() || {};
    const decl = plan.declination ?? 0;
    // Piste en service alignée sur le vent RÉEL du METAR de départ (les
    // numéros de piste sont magnétiques, le vent METAR est vrai → correction
    // de déclinaison). Sans METAR : comportement historique (rose des vents).
    const rwyWind = (windKt != null && windDir != null)
        ? { dir: windDir === 'VRB' ? null : windDir, speed: windKt }
        : null;
    const runway = getActiveRunwayNameForIcao(fromIcao, rwyWind, decl) || '';
    const zRet = plan.cruiseAltFt;

    // Z sécu par tronçon : les points du profil portent un frac [0..1] sur la
    // distance TOTALE du trajet — on regarde ceux qui tombent dans le tronçon.
    const prof = plan.elevationProfile;
    let cum = 0;
    const bounds = legs.map(lg => { const b = [cum, cum + lg.distanceNm]; cum += lg.distanceNm; return b; });
    const zSecuFor = (i) => {
        if (!prof?.points?.length || cum <= 0) return '';
        const [a, b] = bounds[i];
        let max = -Infinity;
        for (const p of prof.points) {
            if (p.frac == null) continue;
            const f = p.frac * cum;
            if (f >= a - 1 && f <= b + 1 && p.elevFt > max) max = p.elevFt;
        }
        // Obstacles SIA du couloir (A6) : le sommet le plus élevé du tronçon
        // compte comme le relief — Z sécu = max(relief, obstacle) + 1000 ft.
        for (const o of (plan.obstacles || [])) {
            const f = (o.frac ?? -1) * cum;
            if (f >= a - 1 && f <= b + 1 && o.topFt > max) max = o.topFt;
        }
        return max === -Infinity ? '' : Math.ceil((max + 1000) / 500) * 500;
    };

    let remain = totalNm;
    // Vol local : table des tronçons VIERGE (tours de piste à la main).
    const rows = local ? [] : legs.map((lg, i) => {
        const rm = ((Math.round((lg.trueCourse ?? 0) - decl) % 360) + 360) % 360;
        const row = {
            from: _wpDisplayName(lg.from.icao), to: _wpDisplayName(lg.to.icao),
            // Distances arrondies au NM entier — lisibilité du log papier.
            distRemain: Math.round(remain), dist: Math.round(lg.distanceNm),
            zSecu: zSecuFor(i), zRet: zRet ?? '',
            rm: String(rm).padStart(3, '0'), cm: String(lg.magHeading ?? '').padStart(3, '0'),
            tsv: (tas && lg.distanceNm) ? Math.round(lg.distanceNm / tas * 60) : '',
            tav: lg.legTimeMin ?? '',
        };
        remain -= lg.distanceNm;
        return row;
    });

    const h = Math.floor((totalMin || 0) / 60), m = Math.round((totalMin || 0) % 60);
    const timeLabel = totalMin ? (h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`) : '';

    // ---- Page 2 « Calcul de navigation » : mêmes données que le bloc écran ----
    const firstLeg = legs[0];
    const wc = (isMulti ? firstLeg.windCorrection : plan.windCorrection) || {};
    const fuel = plan.fuel || {};
    const fmtEte = (min) => {
        if (!min || min < 0) return '—';
        const eh = Math.floor(min / 60), em = Math.round(min % 60);
        return eh > 0 ? `${eh}h${String(em).padStart(2, '0')}` : `${em} min`;
    };
    const legFreq = (icao) => {
        const f = _legMainFreq(icao);
        return f ? `${f.freq.toFixed(3)}${f.type ? ' ' + f.type : ''}` : '';
    };
    const calc = {
        isFr: state.lang === 'fr',
        // Vol local (19/09) : la page « Calcul de navigation » est SAUTÉE
        // (sans route elle n'a pas d'objet) — drapeau lu par drawNavLogPdf.
        local,
        fromIcao, toIcao,
        fromName: getAirportByICAO(fromIcao)?.name || fromIcao,
        toName: getAirportByICAO(toIcao)?.name || toIcao,
        waypoints: (isMulti && plan.waypoints?.length > 2)
            ? plan.waypoints.slice(1, -1).map(w => _wpDisplayName(w.icao)).join(' ') : '',
        cruiseAltFt: stash.alt ?? plan.cruiseAltFt, tasKt: tas,
        fuelBurnLph: stash.burn ?? '', isNight: !!stash.isNight,
        distanceNm: totalNm != null ? Math.round(totalNm) : '',
        distanceKm: (() => { const km = isMulti ? plan.totalDistanceKm : plan.distanceKm; return km != null ? Math.round(km) : ''; })(),
        trueCourse: firstLeg.trueCourse ?? '', magHeading: firstLeg.magHeading ?? '',
        declination: plan.declination ?? 0,
        wind: plan.wind || null, driftDeg: wc.driftDeg,
        groundSpeed: firstLeg.groundSpeed ?? '',
        timeLabel,
        fuel: {
            tripL: fuel.tripFuelL, reserveL: fuel.reserveL, totalL: fuel.totalL,
            reserveMin: fuel.reserveMin ?? (stash.isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN),
            groundMin: fuel.groundMin ?? 0, groundL: fuel.groundL ?? 0,
            diversionL: fuel.diversionL || 0,
            unusableL: fuel.unusableL || 0,
            divIcao: fuel.diversion?.icao || null,
            divDistNm: fuel.diversion?.distNm ?? null,
            divTimeMin: fuel.diversion?.timeMin ?? null,
        },
        clearance: plan.clearance ? {
            maxFt: plan.elevationProfile?.maxFt ?? '',
            minClearanceFt: plan.clearance.minClearanceFt, level: plan.clearance.level,
        } : null,
        isMultiLeg: isMulti,
        legs: legs.map(lg => ({
            from: _wpDisplayName(lg.from.icao), to: _wpDisplayName(lg.to.icao), dist: Math.round(lg.distanceNm),
            hdg: lg.magHeading, eteLabel: fmtEte(lg.legTimeMin),
            fuelL: lg.fuel?.tripFuelL ?? '', freq: legFreq(lg.to.icao),
        })),
    };

    // ---- Page 3 « Performances et terrain » ----
    const FT_TO_M = ft => Math.round(ft * 0.3048);
    const isFr3 = state.lang === 'fr';

    // Perfs décollage du DÉPART, calculées sur le METAR frais récupéré
    // ci-dessus (l'état de l'app peut être affiché sur un autre terrain).
    // OAT extraite du groupe température/point de rosée (« 18/12 », « M05/… »).
    let takeoff = null;
    const mT = metarRaw.match(/\s(M?\d{2})\/M?\d{2}\s/);
    const oat = mT ? (mT[1].startsWith('M') ? -parseInt(mT[1].slice(1), 10) : parseInt(mT[1], 10)) : null;
    if (qnh != null && oat != null) {
        const t = evaluateTakeoffFromRaw(fromIcao, {
            raw: metarRaw, qnh, oat,
            // Élévation OFFICIELLE SIA (France) en priorité, sinon openAIP.
            elevationFt: getSiaAirfield(fromIcao)?.elevFt ?? getAirportByICAO(fromIcao)?.elevation ?? null,
        });
        if (t) {
            const surf = getActiveRunwaySurfaceInfo(fromIcao);
            const acRef = getAircraftRef();
            takeoff = {
                da: t.da,
                groundRollM: FT_TO_M(t.groundRoll), fiftyFtM: FT_TO_M(t.fiftyFt),
                runwayLengthM: t.runwayLength != null ? FT_TO_M(t.runwayLength) : null,
                marginM: t.margin != null ? FT_TO_M(t.margin) : null,
                level: t.level, message: t.message,
                refLabel: `${FT_TO_M(acRef.groundRoll)}/${FT_TO_M(acRef.fiftyFt)}`,
                surfaceLabel: surf ? surf.label : '—',
                surfaceSoft: surf ? isSoftSurface(surf.code) : false,
                surfacePct: t.surfaceFactor > 1 ? Math.round((t.surfaceFactor - 1) * 100) : 0,
            };
        }
    }

    // Vol local (19/09) : ATTERRISSAGE sur le MÊME terrain, calculé comme le
    // décollage sur le METAR frais récupéré ci-dessus — la coupe se dessine
    // sous celle de décollage (page Performances). Références POH atterrissage
    // de la flotte requises (ldgRoll/ldgFifty).
    let landing = null;
    if (local && qnh != null && oat != null) {
        const l = evaluateLandingFromRaw(fromIcao, {
            raw: metarRaw, qnh, oat,
            elevationFt: getSiaAirfield(fromIcao)?.elevFt ?? getAirportByICAO(fromIcao)?.elevation ?? null,
        });
        if (l) {
            // Même convention que le verdict écran : franchissement 50 ft
            // MAJORÉ +20 % avant LDA, marge = piste − franchissement majoré.
            const fiftyMarginedFt = Math.round(l.fiftyFt * 1.2);
            landing = {
                da: l.da,
                rollM: FT_TO_M(l.rollFt), fiftyM: FT_TO_M(fiftyMarginedFt),
                runwayLengthM: l.runwayLength != null ? FT_TO_M(l.runwayLength) : null,
                marginM: l.margin != null ? FT_TO_M(l.margin) : null,
                level: l.level, message: l.message,
                headwindKt: l.headwindKt, crosswindKt: l.crosswindKt ?? null, crosswindSide: l.crosswindSide ?? null,
                rwy: l.runwayName, forecast: l.forecast,
                refLabel: (ac.ldgRoll && ac.ldgFifty) ? `${FT_TO_M(ac.ldgRoll)}/${FT_TO_M(ac.ldgFifty)}` : '—',
            };
        }
    }

    // Profil d'élévation : mêmes points que le graphique écran ; les waypoints
    // intermédiaires sont localisés par le point de profil le plus proche.
    let profile = null;
    if (prof?.points?.length) {
        const first = prof.points[0], last = prof.points[prof.points.length - 1];
        profile = {
            fromIcao, toIcao,
            distTotalKm: Math.round(greatCircleDistanceNm(first.lat, first.lon, last.lat, last.lon) * 1.852),
            minFt: prof.minFt, maxFt: prof.maxFt,
            cruiseAltFt: stash.alt ?? plan.cruiseAltFt,
            points: prof.points.map(pt => ({ frac: pt.frac, elevFt: pt.elevFt })),
            waypoints: (isMulti && plan.waypoints?.length > 2)
                ? plan.waypoints.slice(1, -1).map(w => {
                    let frac = null, bestD = Infinity;
                    for (const pt of prof.points) {
                        if (pt.lat == null || pt.lon == null) continue;
                        const d = greatCircleDistanceNm(pt.lat, pt.lon, w.lat, w.lon);
                        if (d < bestD) { bestD = d; frac = pt.frac; }
                    }
                    return { icao: w.icao, name: _wpDisplayName(w.icao), frac };
                }).filter(w => w.frac != null)
                : [],
            routeAirspaces: plan.routeAirspaces ?? null,
        };
    }

    // Alternates viables à ± 25 NM de la route (départ → waypoints → dest.),
    // tous aérodromes (openAIP) — METAR de la station la plus proche si le
    // terrain n'en émet pas (marqué « * » dans le PDF).
    // Vol local : route réduite au terrain (carte centrée sur le champ et
    // ses terrains de déroutement) ; navigation : départ → étapes → dest.
    const routePts = local
        ? [plan.from]
        : (isMulti && plan.waypoints?.length)
            ? plan.waypoints.map(w => ({ icao: w.icao, lat: w.lat, lon: w.lon }))
            : [plan.from, plan.to].map(a => ({ icao: a.icao, lat: a.lat, lon: a.lon }));
    const altRows = await getEnRouteAlternates(routePts, 25, local ? 6 : 8).catch(() => null);
    let alternates = null;
    if (altRows?.length) {
        alternates = {
            maxOffsetNm: 25,
            rows: altRows.map(r => ({
                code: r.code, name: r.name, cat: r.cat.cat,
                visiStr: r.cat.visiM >= 10000 ? '>10 km' : `${r.cat.visiM} m`,
                ceilStr: r.cat.ceilHund === 999 ? '—' : `${r.cat.ceilHund * 100} ft`,
                windStr: r.cat.wind
                    ? `${r.cat.wind.dir == null ? 'VRB' : String(r.cat.wind.dir).padStart(3, '0') + '°'} ${r.cat.wind.speed}${r.cat.wind.gust ? 'G' + r.cat.wind.gust : ''} kt`
                    : '—',
                offsetNm: Math.round(r.offsetNm),
                side: r.side >= 0 ? (isFr3 ? 'D' : 'R') : (isFr3 ? 'G' : 'L'),
                metarFrom: r.metarFrom || null, metarDistNm: r.metarDistNm ?? null,
            })),
        };
    }
    const perf = { isFr: isFr3, fromIcao, toIcao, runway, takeoff, profile, alternates, landing };

    // Centrage : si l'avion actif a un bloc wb configuré (fenêtre Flotte),
    // la page 4 « Centrage » est ajoutée — chargement mémorisé s'il existe,
    // sinon carburant embarqué / essence consommée pré-remplis du plan.
    let centro = null;
    if (ac?.wb) {
        const loads = resolveLoads(ac.id, plan);
        centro = {
            isFr: isFr3, fromIcao,
            reg: ac.registration || ac.name, type: ac.type || '',
            wb: { ...ac.wb, envelope: normalizeEnvelope(ac.wb.envelope) },
            calc: computeWb(ac.wb, loads),
            fuelL: loads.fuelL, burnL: loads.burnL,
        };
    }

    const doc = drawNavLogPdf(window.jspdf.jsPDF, {
        isFr: state.lang === 'fr',
        aircraftType: ac.type || '', aircraftReg: ac.registration || '',
        qnh, windDir, windKt, runway,
        distanceNm: totalNm ?? '', timeLabel,
        metarRaw, rows, calc, perf, centro,
    });
    // Annexe NOTAM : les NOTAM cochés du dossier SOFIA prolongent le
    // dossier sur des pages dédiées. ORDRE PILOTE 16/09 : garde / log /
    // météo / NOTAM — l'annexe est donc générée APRÈS la page météo (elle
    // suit naturellement, sans remontée). Dossier complet (B1) : aucune
    // case cochée alors que le dossier est chargé → annexe du dossier
    // ENTIER (retour pilote 13/09 : « si le dossier NOTAM est OK il doit
    // être ajouté à la suite du PDF »).
    const _notamAnnexe = () => {
        try {
            let selNotams = getSelectedNotams();
            if (file && !selNotams.length) selNotams = getCurrentNotams();
            if (selNotams.length) drawNotamAnnex(doc, selNotams, state.lang === 'fr');
        } catch (e) { console.warn('annexe NOTAM ignorée :', e.message); }
    };

    // ---- B1 phase 2 : PDF UNIQUE du dossier — page de garde datée (statut
    // des six rubriques + attestation VAC) et page météo capturée, AJOUTÉES
    // en fin de document puis remontées en tête (doc.movePage). Arbitrage
    // ②=A : ~1 Mo, VAC non intégrées.
    if (file) {
        try {
            const finp = await collectFileInputs();
            const tiles = computeFileTiles(finp);
            const vacInfo = await getVacIndexInfo();
            const hhmm = (ts) => ts ? new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
            const lvlTxt = (l) => l === 'ok' ? 'OK' : (l === 'caution' || l === 'limitative' ? '!' : '!!');
            const rows = [
                { status: tiles.weather.status, label: isFr3 ? 'Météo' : 'Weather',
                    detail: `METAR ${finp.metarAgeMin != null ? finp.metarAgeMin + ' min' : '—'} · TAF `
                        + (finp.tafState === 'loaded' ? 'OK' : finp.tafState === 'none' ? (isFr3 ? 'sans objet' : 'n/a') : (isFr3 ? 'à charger' : 'missing'))
                        + (finp.arrWeather != null ? ` · ${isFr3 ? 'arrivée' : 'dest.'} ${finp.arrWeather ? 'OK' : '?'}` : ''),
                    ref: hhmm(getLastMetarObsMs()) },
                { status: tiles.notam.status, label: 'NOTAM',
                    detail: finp.notamCount
                        ? `${finp.notamCount} NOTAM · ${isFr3 ? 'générés il y a' : 'fetched'} ${finp.notamAgeMin ?? '—'} min`
                        : (isFr3 ? 'aucun dossier chargé' : 'no briefing loaded'),
                    ref: hhmm(getLastNotamFetchTs()) },
                { status: tiles.vac.status, label: 'VAC',
                    detail: `${tiles.vac.items.filter(v => v.consulted).length}/${tiles.vac.items.length} ${isFr3 ? 'consultées' : 'viewed'}`,
                    ref: vacInfo.airac || '' },
                { status: tiles.fuel.status, label: isFr3 ? 'Carburant' : 'Fuel',
                    detail: finp.fuelRequired != null
                        ? `${isFr3 ? 'requis' : 'req.'} ${finp.fuelRequired} L · ${isFr3 ? 'embarqué' : 'on board'} ${finp.fuelOnBoard ?? '—'} L`
                            + (finp.mode === 'nav' ? ` · ${isFr3 ? 'dégagement' : 'alt.'} ${state.diversionIcao || '—'}` : '')
                        : (isFr3 ? 'devis non renseigné' : 'no fuel plan yet'), ref: '' },
                { status: tiles.perf.status, label: isFr3 ? 'Perfs piste' : 'Rwy perf',
                    detail: `${isFr3 ? 'décollage' : 'takeoff'} ${finp.takeoffLevel ? lvlTxt(finp.takeoffLevel) : '—'} · ${isFr3 ? 'atterrissage' : 'landing'} ${finp.landingLevel ? lvlTxt(finp.landingLevel) : '—'}`, ref: '' },
                { status: tiles.wb.status, label: isFr3 ? 'Centrage' : 'Balance',
                    detail: tiles.wb.status === 'ok' ? (isFr3 ? 'dans l\u2019enveloppe' : 'within envelope')
                        : tiles.wb.status === 'danger' ? (isFr3 ? 'HORS LIMITES' : 'OUT OF LIMITS')
                        : (isFr3 ? 'non configuré (flotte)' : 'not configured (fleet)'), ref: '' },
            ];
            const generatedLabel = new Date().toLocaleString([], { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
            const ac = getActiveAircraft() || {};
            // Cartes VAC INTÉGRÉES (option ②=B, demandée par le pilote le
            // 16/09) : rendues AVANT la garde pour que son attestation soit
            // EXACTE (« jointe au dossier » seulement si la carte est là),
            // posées en pages A5 APRÈS la carte de vol. Départ, arrivée,
            // dégagement ; chaque terrain dégrade seul.
            try {
                const { vacPageImages } = await import('./vac-viewer.js');
                const vacIcaos = [...new Set([fromIcao, toIcao, state.diversionIcao].filter(Boolean))];
                for (const icao of vacIcaos) {
                    // Fenêtre hôte VISIBLE pour pdfjs (piège du rendu suspendu
                    // en page masquée — cf. vac-viewer.js) : l'onglet popup
                    // s'il existe, sinon la fenêtre courante.
                    const r = await vacPageImages(icao, { win: (tab && !tab.closed) ? tab : null });
                    if (r?.pages?.length) {
                        const label = icao === fromIcao ? `${isFr3 ? 'Départ' : 'Dep.'} ${icao}`
                            : icao === toIcao ? `${isFr3 ? 'Arrivée' : 'Arr.'} ${icao}`
                            : `${isFr3 ? 'Dégagement' : 'Alt.'} ${icao}`;
                        vacPagesData.push({ icao, label, airac: r.airac, pages: r.pages });
                    }
                }
            } catch (e) { console.warn('cartes VAC ignorées :', e.message); }
            const n0 = doc.getNumberOfPages();
            drawFileCover(doc, {
                isFr: isFr3, generatedLabel,
                routeLabel: local
                    ? `${fromIcao} · ${isFr3 ? 'vol local' : 'local flight'}`
                    : `${fromIcao} - ${toIcao}${state.diversionIcao ? ` · ${isFr3 ? 'dégagement' : 'alt.'} ${state.diversionIcao}` : ''}`,
                aircraftLabel: `${ac.name || ''}${ac.registration ? ' (' + ac.registration + ')' : ''}`.trim() || '—',
                rows, vac: tiles.vac.items.map(v => ({ icao: v.icao, ts: getVacConsultedTs(v.icao), jointe: vacPagesData.some(x => x.icao === v.icao) })),
                vacAirac: vacInfo.airac,
            });
            const displayed = (document.getElementById('tafInput')?.value || '').trim().split('\n')[0] || '';
            const depType = state.lastParsed?.isMetar === false ? 'TAF' : 'METAR';
            let dep = null;
            if (displayed) {
                const isDepMsg = String(state.requestedIcao || '').toUpperCase() === fromIcao;
                dep = {
                    title: isDepMsg
                        ? `${isFr3 ? 'Départ' : 'Departure'} ${fromIcao} - ${depType}`
                        : `${isFr3 ? 'Message affiché' : 'Displayed message'} - ${depType}`,
                    raw: displayed,
                    decode: depType === 'METAR',
                };
            }
            // Spécification pilote 13/09 (la lettre) : DÉROUTEMENT puis
            // ARRIVÉE, chacun en GRAPHIQUE TAF (capturé du moteur réel,
            // substitution olive grise mentionnée si le terrain n'émet pas)
            // au-dessus du texte BRUT — PAS de METAR pour ces deux terrains.
            const { captureTafChartPng } = await import('./taf-chart-capture.js');
            const terrains = [];
            const addTafBlock = async (role, icao) => {
                if (!icao) return;
                const tf = await fetchTafWithFallback(icao);
                if (!tf?.raw) return;
                const t = {
                    label: `${role} ${icao}`,
                    tafRaw: tf.raw,
                    note: tf.from ? `${isFr3 ? 'station' : 'stn'} ${tf.from}, ${tf.distNm} NM` : undefined,
                };
                const cap = await captureTafChartPng(tf.raw);
                if (cap) { t.chart = cap.png; t.chartRatio = cap.ratio; t.chartFmt = cap.fmt; }
                terrains.push(t);
            };
            if (state.diversionIcao && state.diversionIcao !== toIcao) {
                await addTafBlock(isFr3 ? 'Déroutement' : 'Alternate', state.diversionIcao);
            }
            await addTafBlock(local ? (isFr3 ? 'Terrain' : 'Field') : (isFr3 ? 'Arrivée' : 'Destination'), toIcao);
            drawWeatherPage(doc, { isFr: isFr3, generatedLabel, dep, terrains });
            // ORDRE PILOTE 16/09 : garde / log / météo / NOTAM. La garde et
            // la météo sont générées à la suite du log — une SEULE remontée
            // suffit (la garde en page 1, la météo reste juste après le
            // log) ; l'annexe NOTAM est générée ENSUITE (elle suit donc la
            // météo naturellement), et la carte de vol clôt le dossier.
            doc.movePage(n0 + 1, 1);
        } catch (e) {
            console.warn('pages dossier de vol ignorées :', e.message);
        }
    }
    _notamAnnexe();
    // ---- B7 : carte de vol (« carte de secours ») en DERNIÈRE page —
    // ajoutée APRÈS la remontée garde/météo pour rester en fin de dossier.
    // Cadrage = la route seule (sémantique « Cadrer plan ») ; alternates et
    // dégagement portés dessus (rabattus au bord si hors emprise) ; zones
    // SIA avec la sémantique AZBA du dossier NOTAM courant ; fond relief
    // OpenTopoMap recomposé (repli vectoriel blanc si hors ligne). Chaque
    // source dégrade seule — l'impression ne doit jamais échouer pour ça.
    let carteOmise = '';
    if (file) {
        try {
            const mapRoute = routePts
                .map((p, i) => ({
                    lat: p.lat, lon: p.lon,
                    // ZZxx → NOM RÉEL du repère (RV-E, LOR…) : à l écran ces
                    // repères affichent leur nom, la carte du PDF aussi
                    // (retour pilote 16/09 « les repères VFR type RV-E
                    // apparaissent sous la forme ZZAA »). Les terrains
                    // gardent leur code OACI (résolveur neutre pour eux).
                    code: _wpDisplayName(p.icao),
                    name: getAirportByICAO(p.icao)?.name || '',
                    role: i === 0 ? 'dep' : (i === routePts.length - 1 ? 'dest' : 'wp'),
                }))
                .filter((p) => p.lat != null && p.lon != null);
            const mapAlts = (altRows || [])
                .filter((r) => r.lat != null && r.lon != null)
                .map((r) => ({ lat: r.lat, lon: r.lon, code: r.code, name: r.name }));
            if (state.diversionIcao && state.diversionIcao !== toIcao && state.diversionIcao !== fromIcao) {
                const di = mapAlts.findIndex((a) => a.code === state.diversionIcao);
                const d = di >= 0 ? mapAlts[di] : getAirportByICAO(state.diversionIcao);
                if (d?.lat != null && d.lon != null) {
                    if (di >= 0) mapAlts[di] = { ...mapAlts[di], diversion: true };
                    else mapAlts.push({ lat: d.lat, lon: d.lon, code: state.diversionIcao, name: d.name, diversion: true });
                }
            }
            const mapData = await buildFlightMapData({
                isFr: isFr3,
                generatedLabel: new Date().toLocaleString([], { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
                routeLabel: local
                    ? `${fromIcao} · ${isFr3 ? 'vol local' : 'local flight'}`
                    : `${fromIcao} - ${toIcao}${state.diversionIcao ? ` · ${isFr3 ? 'dégagement' : 'alt.'} ${state.diversionIcao}` : ''}`,
                route: mapRoute,
                alternates: mapAlts,
                notams: getCurrentNotams(),
            });
            if (mapData) drawFlightMapPage(doc, mapData);
        } catch (e) {
            console.warn('carte de vol ignorée :', e.message);
            // Diagnostic SANS console (téléphone) : la raison est reportée
            // dans le titre de l'onglet PDF — « Dossier … — carte omise : … ».
            carteOmise = ` — carte omise : ${String(e.message || e).slice(0, 60)}`;
        }
    }

    // ---- Cartes VAC intégrées (②=B, 16/09) : pages A5 APRÈS la carte de
    // vol — dernières pages du dossier. Les données ont été rendues avant
    // la garde (texte d attestation exact).
    if (file && vacPagesData.length) {
        try { drawVacPages(doc, vacPagesData, isFr3); }
        catch (e) { console.warn('cartes VAC ignorées :', e.message); }
    }
    const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const filename = file
        ? (local ? `Dossier_${fromIcao}_local_${today}.pdf` : `Dossier_${fromIcao}-${toIcao}_${today}.pdf`)
        : `Log-nav_${fromIcao}-${toIcao}_${today}.pdf`;
    // Le PDF s'ouvre dans un onglet, dans une PAGE HTML HABILLÉE : il y est
    // embarqué en <iframe src="data:application/pdf;base64,…">. En HTTPS le
    // visualiseur du navigateur l'affiche ; surtout, sur une origine HTTP
    // (Free.fr, pas de TLS possible) Chrome REFUSE d'afficher un blob: PDF
    // issu d'une page non sécurisée et le fait télécharger — l'iframe data:
    // contourne ce refus et rend l'aperçu. Repli : navigation blob: directe,
    // puis téléchargement classique.
    if (tab && !tab.closed) {
        try {
            const dataUri = doc.output('datauristring');
            const blobUrl = URL.createObjectURL(doc.output('blob'));
        const title = (file
            ? (local
                ? (isFr3 ? `Dossier de vol local ${fromIcao}` : `Local flight file ${fromIcao}`)
                : (isFr3 ? `Dossier de vol ${fromIcao}-${toIcao}` : `Flight file ${fromIcao}-${toIcao}`))
            : (isFr3 ? `Log de nav ${fromIcao}-${toIcao}` : `Nav log ${fromIcao}-${toIcao}`))
            + (typeof carteOmise === 'string' ? carteOmise : '');
            tab.document.open();
            tab.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title}</title>
<style>html,body{margin:0;height:100%;overflow:hidden}iframe{border:0;width:100%;height:100%}
#dl{position:fixed;right:10px;bottom:10px;z-index:9;font:12px/1 sans-serif;color:#e2e8f0;background:#1e293bdd;padding:7px 12px;border-radius:8px;text-decoration:none;border:1px solid #475569}
#dl:hover{background:#334155dd}</style></head>
<body><iframe src="${dataUri}" title="${title}"></iframe>
<a id="dl" href="${blobUrl}" download="${filename}">${isFr3 ? '⤓ Télécharger le PDF' : '⤓ Download PDF'}</a></body></html>`);
            tab.document.close();
            return;
        } catch (e) {
            try { tab.location.href = doc.output('bloburl'); return; } catch { /* on referme */ }
            try { tab.close(); } catch { /* déjà fermé */ }
        }
    }
    doc.save(filename);
}

// ----------------------------------------------------------------
// PROJET « DEUX ÉTAPES SANS PLEIN » : minimum réglementaire de la 2ᵉ
// étape (roulage ×2 + intégration + navigation sans vent + réserve)
// ajouté au requis complet de l'étape 1, comparé au carburant UTILISABLE
// réellement à bord. Saisie : code OACI de la 2ᵉ destination (prime) ou
// durée d'une étape locale. État EN MÉMOIRE uniquement, remis à vide à
// chaque changement de route (retour pilote 17/09 : le champ ne doit
// pas survivre d'un vol à l'autre) — plus aucun localStorage.
// ----------------------------------------------------------------
let _leg2Mem = { planKey: null, icao: '', min: '' };
try { localStorage.removeItem('fp-leg2'); } catch { /* best effort */ }

function _leg2PlanKey(plan) {
    const wps = Array.isArray(plan.waypoints) && plan.waypoints.length ? plan.waypoints : null;
    const dep = wps ? wps[0].icao : plan.from?.icao;
    const arr = wps ? wps[wps.length - 1].icao : plan.to?.icao;
    return `${dep || ''}>${arr || ''}`;
}
function _readLeg2(plan) {
    const key = _leg2PlanKey(plan);
    if (_leg2Mem.planKey !== key) _leg2Mem = { planKey: key, icao: '', min: '' };
    return _leg2Mem;
}

/** Calcul complet du bloc étape 2 (pure vis-à-vis du DOM). */
function _leg2Compute(plan, isNight, tas, burn) {
    const saved = _readLeg2(plan);
    const icao = String(saved.icao || '').toUpperCase();
    const localMin = Math.max(0, Math.min(600, Math.round(parseFloat(saved.min)) || 0));
    const dest1 = (Array.isArray(plan.waypoints) && plan.waypoints.length)
        ? plan.waypoints[plan.waypoints.length - 1] : plan.to;
    let info = null;
    if (/^[A-Z][A-Z0-9]{3}$/.test(icao)) {
        const apt = getAirportByICAO(icao);
        const memo = memoGet(icao);
        const lat = memo?.lat ?? apt?.lat ?? null, lon = memo?.lon ?? apt?.lon ?? null;
        if (lat != null && lon != null && dest1?.lat != null && dest1?.lon != null) {
            info = { icao, name: apt?.name && apt.name !== icao ? apt.name : null,
                     distNm: greatCircleDistanceNm(dest1.lat, dest1.lon, lat, lon) };
        }
    }
    const ac = getActiveAircraft();
    const perso = Number.isFinite(ac?.reserveExtraMin) ? Math.max(0, Math.min(60, ac.reserveExtraMin)) : 0;
    const leg2 = (info || localMin > 0) ? computeLeg2Fuel({
        distNm: info ? info.distNm : null,
        localMin: info ? null : localMin,
        tasKt: tas, fuelBurnLph: burn,
        reserveMin: (info ? (isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN) : 10) + perso,
    }) : null;
    // Embarqué (widget Centrage) plafonné au carburant UTILISABLE (capacité
    // du poste carburant − inutilisable du manuel de vol).
    const loads = resolveLoads(getActiveAircraftId());
    const onBoardRaw = loads.fuelL > 0 ? loads.fuelL : null;
    const usable = usableFuelOf(ac);
    const onBoard = (onBoardRaw != null && usable != null) ? Math.min(onBoardRaw, usable) : onBoardRaw;
    const req2legs = leg2 ? Math.round((plan.fuel.totalL + leg2.totalL) * 10) / 10 : null;
    const manque = (req2legs != null && onBoard != null) ? Math.round((req2legs - onBoard) * 10) / 10 : null;
    return { saved, icao: info ? info.icao : (/^[A-Z][A-Z0-9]{3}$/.test(icao) ? icao : ''),
             icaoInconnu: !info && /^[A-Z][A-Z0-9]{3}$/.test(icao),
             info, localMin, leg2, onBoard, onBoardRaw, usable, req2legs, manque };
}

function _leg2InnerHtml(plan, isFr, isNight, tas, burn) {
    const c = _leg2Compute(plan, isNight, tas, burn);
    const t = (fr, en) => (isFr ? fr : en);
    let res = '';
    if (c.leg2) {
        const l = c.leg2;
        res += `<div class="fp-leg2-line">${t('Étape 2', 'Leg 2')} : <b>${c.info ? `${escapeHtml(c.info.icao)}${c.info.name ? ' · ' + escapeHtml(c.info.name) : ''}` : t('vol local', 'local flight')}</b>`
            + ` — ${l.navTimeMin} min ${t('sans vent', 'no wind')} · ${l.navL} L + ${t('roulage', 'taxi')} ${l.groundL} L + ${t('réserve', 'reserve')} ${l.reserveL} L (${l.reserveMin} min)`
            + ` → <b>${l.totalL} L</b></div>`
            + `<div class="fp-leg2-line">${t('Requis 2 étapes', 'Required for both legs')} : <b style="color:var(--primary);">${c.req2legs} L</b>`
            + ` · ${t('à bord (utilisable)', 'on board (usable)')} : ${c.onBoard != null ? c.onBoard + ' L' : '—'}</div>`;
        if (c.manque != null && c.manque > 0) {
            res += `<div class="fp-leg2-verdict warn"><i data-lucide="fuel" style="width:13px;height:13px;"></i> ${t(`Manque ${c.manque} L — <b>avitaillement à prévoir</b> (pompe, moyen de paiement).`,
                `Short by ${c.manque} L — <b>refuelling stop required</b> (pump, payment).`)}</div>`;
        } else if (c.onBoard != null) {
            res += `<div class="fp-leg2-verdict ok"><i data-lucide="check" style="width:13px;height:13px;"></i> ${t('Les deux étapes sont possibles sans complément de plein.', 'Both legs are achievable without refuelling.')}</div>`;
        } else {
            res += `<div class="fp-leg2-verdict" >${t('Renseignez le carburant embarqué dans le widget Centrage pour le verdict.', 'Fill the fuel on board in the Balance widget to get the verdict.')}</div>`;
        }
    } else if (c.icaoInconnu) {
        res += `<div class="fp-leg2-line" style="color:var(--danger);">${t('Terrain inconnu — chargez sa météo ou vérifiez le code.', 'Unknown airfield — load its weather or check the code.')}</div>`;
    }
    if (c.leg2) {
        res += `<div class="fp-leg2-note">${t('Vérification à refaire au sol avant le départ de la 2ᵉ étape (responsabilité du commandant de bord). Étape 2 sans dégagement propre.',
            'Re-check on the ground before departing on the 2nd leg (pilot-in-command responsibility). Leg 2 has no alternate of its own.')}</div>`;
    }
    return `
        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
            <div class="fp-section-title">${t('Deuxième étape (sans plein)', 'Second leg (no refuel)')}</div>
            <div class="fp-leg2-inputs">
                <label class="fp-input-label" title="${t('Code OACI de la 2ᵉ destination, au départ de l’arrivée de l’étape 1 — prime sur la durée', 'ICAO of the 2nd destination, departing from leg 1 arrival — takes precedence over duration')}">
                    <span>${t('2ᵉ étape (OACI)', '2nd leg (ICAO)')}</span>
                    <input type="text" id="fp-leg2-icao" value="${escapeHtml(c.saved.icao || '')}" placeholder="LFRD" class="fp-input" style="font-family:'DM Mono',monospace; text-transform:uppercase;" maxlength="8">
                </label>
                <label class="fp-input-label" title="${t('Étape 2 LOCALE : durée estimée en minutes (réserve 10 min)', 'LOCAL 2nd leg: estimated duration in minutes (10 min reserve)')}">
                    <span>${t('ou durée locale (min)', 'or local duration (min)')}</span>
                    <input type="number" id="fp-leg2-min" value="${c.saved.min != null && c.saved.min !== '' ? escapeHtml(String(c.saved.min)) : ''}" placeholder="30" min="0" max="600" step="5" class="fp-input">
                </label>
            </div>
            ${res}
        </div>`;
}

/** Câblage des deux saisies : persiste puis re-rend SEULEMENT le sous-bloc. */
function _wireLeg2(container, ctx) {
    const block = container.querySelector('#fp-leg2-block');
    if (!block) return;
    const rerender = () => {
        block.innerHTML = _leg2InnerHtml(ctx.plan, ctx.isFr, ctx.isNight, ctx.tas, ctx.burn);
        if (window.lucide) window.lucide.createIcons({ root: block });
        _wireLeg2(container, ctx);
    };
    const persist = () => {
        const s = _readLeg2(ctx.plan);
        const icaoEl = block.querySelector('#fp-leg2-icao');
        const minEl = block.querySelector('#fp-leg2-min');
        s.icao = (icaoEl?.value || '').trim().toUpperCase();
        s.min = minEl?.value ?? '';
        _leg2Mem = s;
        rerender();
    };
    block.querySelector('#fp-leg2-icao')?.addEventListener('change', persist);
    block.querySelector('#fp-leg2-min')?.addEventListener('change', persist);

    // L'embarqué se saisit dans le widget Centrage (rendu indépendant) : on
    // suit sa saisie pour rafraîchir le verdict, avec un léger debounce.
    if (!container.dataset.leg2FuelWire) {
        container.dataset.leg2FuelWire = '1';
        let t = null;
        document.addEventListener('input', (e) => {
            if (e.target?.id !== 'wb-fuel-l') return;
            const b = container.querySelector('#fp-leg2-block');
            if (!b) return;
            clearTimeout(t);
            t = setTimeout(() => {
                b.innerHTML = _leg2InnerHtml(ctx.plan, ctx.isFr, ctx.isNight, ctx.tas, ctx.burn);
                if (window.lucide) window.lucide.createIcons({ root: b });
            }, 400);
        });
    }
}

// ----------------------------------------------------------------
// MINIMA VFR RÉGLEMENTAIRES par terrain du plan (départ / destination /
// dégagement). Indicateur informatif : collecte asynchrone (espaces au
// sol + METAR/TAF à l'ETA), rendu re-dessiné à l'arrivée des données.
// ----------------------------------------------------------------
const _MINIMA_MSG = {
    ctrl_ok:    { fr: 'Conditions VFR OK (zone contrôlée)', en: 'VFR conditions OK (controlled airspace)',
                  tipFr: 'Visi ≥ 5 km et plafond ≥ 1500 ft (espace contrôlé sous FL100)', tipEn: 'Vis ≥ 5 km and ceiling ≥ 1500 ft (controlled below FL100)' },
    sp_needed:  { fr: 'Météo insuffisante pour le VFR — clairance VFR spécial requise', en: 'Below VFR minima — special VFR clearance required',
                  tipFr: 'Sous 5 km ou 1500 ft, mais ≥ 1500 m et ≥ 600 ft : possible sur clairance du contrôleur', tipEn: 'Below 5 km or 1500 ft, but ≥ 1500 m and ≥ 600 ft: possible on controller clearance' },
    sp_night:   { fr: 'Conditions VFR spécial mais NUIT — interdit', en: 'Special-VFR conditions but NIGHT — not allowed',
                  tipFr: 'Le VFR spécial est interdit de nuit', tipEn: 'Special VFR is not allowed at night' },
    ctrl_below: { fr: 'Sous tous les minima VFR', en: 'Below all VFR minima',
                  tipFr: 'Même le VFR spécial exige ≥ 1500 m et ≥ 600 ft', tipEn: 'Even special VFR needs ≥ 1500 m and ≥ 600 ft' },
    unctrl_ok:  { fr: 'Conditions VFR OK (hors zone contrôlée)', en: 'VFR conditions OK (uncontrolled airspace)',
                  tipFr: 'Visi ≥ 1500 m et plafond > 500 ft (espace non contrôlé, Vi ≤ 140 kt)', tipEn: 'Vis ≥ 1500 m and ceiling > 500 ft (uncontrolled, Vi ≤ 140 kt)' },
    unctrl_below: { fr: 'Sous tous les minima VFR', en: 'Below all VFR minima',
                  tipFr: 'Exige visi ≥ 1500 m et plafond > 500 ft', tipEn: 'Needs vis ≥ 1500 m and ceiling > 500 ft' },
    unknown:    { fr: 'météo indisponible', en: 'weather unavailable' },
};
const _MINIMA_DOT = { ok: 'ok', caution: 'warn', danger: 'bad', unknown: 'dim' };

function _minimaRowHtml(r, isFr) {
    const t = (fr, en) => (isFr ? fr : en);
    const role = r.role === 'dep' ? t('Départ', 'Departure') : r.role === 'div' ? t('Dégagement', 'Alternate') : t('Arrivée', 'Arrival');
    const espace = r.zone
        ? `${escapeHtml(r.zone)}${r.classe ? ' · ' + escapeHtml(r.classe) : ''} — ${r.controlled ? t('contrôlé', 'controlled') : t('non contrôlé', 'uncontrolled')}`
        : t('non contrôlé (aucune zone au sol)', 'uncontrolled (no ground airspace)');
    const meteo = (r.visiM != null)
        ? `${r.source} : ${r.visiM >= 10000 ? '≥ 10 km' : Math.round(r.visiM) + ' m'} · ${t('plafond', 'ceiling')} ${r.ceilingFt >= 99999 ? '—' : r.ceilingFt + ' ft'}`
        : '';
    const msg = _MINIMA_MSG[r.verdict.key] || _MINIMA_MSG.unknown;
    const tip = msg.tipFr ? (isFr ? msg.tipFr : msg.tipEn) : '';
    return `
        <div class="fp-minima-row">
            <span class="fp-minima-dot ${_MINIMA_DOT[r.verdict.level] || 'dim'}"></span>
            <span class="fp-minima-main">
                <b>${role}</b> ${escapeHtml(r.icao || '')}${r.name ? ' · ' + escapeHtml(r.name) : ''}
                <span class="fp-minima-meta">${espace} · ${meteo}${r.isNight ? ' · ' + t('nuit', 'night') : ''}</span>
                <span class="fp-minima-verdict lvl-${r.verdict.level}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${msg[isFr ? 'fr' : 'en']}</span>
            </span>
        </div>`;
}

function _minimaSectionInner(plan, isFr) {
    const t = (fr, en) => (isFr ? fr : en);
    const rows = state._vfrMinima;
    const body = Array.isArray(rows) && rows.length
        ? rows.map(r => _minimaRowHtml(r, isFr)).join('')
        : `<div class="fp-minima-row"><span class="fp-minima-dot dim"></span><span class="fp-minima-main">${t('Collecte des minima (espaces au sol, METAR/TAF)…', 'Collecting minima (ground airspaces, METAR/TAF)…')}</span></div>`;
    return `
        <div class="fp-section" style="margin-top:10px; padding-top:10px; border-top:1px dashed var(--border-color);">
            <div class="fp-section-title">${t('Minima VFR', 'VFR minima')}</div>
            ${body}
            <div class="fp-minima-note">${t('Vi ≤ 140 kt supposée. Indicateur informatif — la clairance VFR spécial reste à la discrétion du contrôleur ; le règlement et le manuel de vol priment.',
                'Vi ≤ 140 kt assumed. Informational only — special-VFR clearance remains at the controller\u2019s discretion; regulations and the POH prevail.')}</div>
        </div>`;
}

/** Lance la collecte et re-dessine la section quand elle arrive (jeton
 *  anti-course : un nouveau rendu du plan invalide la collecte en vol). */
function _attachMinima(container, plan, isFr) {
    const block = container.querySelector('#fp-minima-block');
    if (!block) return;
    const token = Symbol('minima');
    block._minimaToken = token;
    collectVfrMinima(plan).then(rows => {
        if (block._minimaToken !== token || !block.isConnected) return;
        state._vfrMinima = rows;
        block.innerHTML = _minimaSectionInner(plan, isFr);
    }).catch(() => {
        if (block._minimaToken !== token || !block.isConnected) return;
        state._vfrMinima = null;
        block.innerHTML = _minimaSectionInner(plan, isFr);
    });
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

    // Mémorise le dernier plan rendu pour l'export PDF du log de nav (navlog-pdf.js).
    // alt/burn/isNight/isFr servent à la page 2 « Calcul de navigation ».
    state._lastNavPlan = { plan, tas, alt, burn, isNight, isFr };
    // Le widget centrage suit la consommation du plan (lecture seule en
    // navigation) : on lui signale qu'un plan vient d'être (re)calculé.
    window.dispatchEvent(new CustomEvent('navplan-changed'));

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
            <div class="fp-grid fp-grid-${4 + (fuel.diversion ? 1 : 0) + (fuel.unusableL > 0 ? 1 : 0)}" style="margin-top:6px;">
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Trajet' : 'Trip'}</div>
                    <div class="fp-value">${fuel.tripFuelL} L</div>
                </div>
                ${fuel.diversion ? `
                <div class="fp-cell" title="${isFr ? 'Rejoindre le terrain de dégagement depuis l\u2019arrivée (navigation + intégration)' : 'Reach the alternate field from destination (navigation + integration)'} : ${fuel.diversion.distNm} NM · ${fuel.diversion.timeMin ?? '—'} min">
                    <div class="fp-label">${isFr ? 'Dégagement' : 'Alternate'} ${fuel.diversion.icao}</div>
                    <div class="fp-value">${fuel.diversion.fuelL != null ? fuel.diversion.fuelL : '—'} L</div>
                </div>` : ''}
                <div class="fp-cell" title="${isFr ? 'Roulage départ + intégration + roulage arrivée (forfaits mini)' : 'Taxi-out + integration + taxi-in (minimum allowances)'}">
                    <div class="fp-label">${isFr ? 'Roulage + intégr.' : 'Taxi + integ.'} (${fuel.groundMin ?? 0}min)</div>
                    <div class="fp-value">${fuel.groundL ?? 0} L</div>
                </div>
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Réserve' : 'Reserve'} (${fuel.reserveMin ?? (isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN)}min)</div>
                    <div class="fp-value">${fuel.reserveL} L</div>
                </div>
                ${fuel.unusableL > 0 ? `
                <div class="fp-cell" title="${isFr ? 'Carburant inutilisable du manuel de vol (jamais consommable, mais embarqué dans le réservoir)' : 'Unusable fuel from the POH (never burnable, but on board in the tank)'}">
                    <div class="fp-label">${isFr ? 'Inutilisable' : 'Unusable'}</div>
                    <div class="fp-value">${fuel.unusableL} L</div>
                </div>` : ''}
                <div class="fp-cell">
                    <div class="fp-label">${isFr ? 'Total requis' : 'Total req.'}</div>
                    <div class="fp-value" style="color:var(--primary); font-weight:800; font-size:15px;">${fuel.totalL} L</div>
                </div>
            </div>
        </div>

        <div id="fp-leg2-block">${_leg2InnerHtml(plan, isFr, isNight, tas, burn)}</div>

        <div id="fp-minima-block">${_minimaSectionInner(plan, isFr)}</div>

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
                        <div class="fp-value" style="color:${clearColor};">
                            ${cl.minClearanceFt >= 0 ? '+' : ''}${cl.minClearanceFt} ft
                        </div>
                    </div>
                    ${(() => {
                        // Obstacle SIA dominant du couloir (A6) : intégré à la
                        // marge mini ci-dessus et à la Z sécu du log de nav.
                        const obs = plan.obstacles || [];
                        if (!obs.length) return '';
                        const top = obs.reduce((m, o) => (o.topFt > (m?.topFt ?? -Infinity) ? o : m), null);
                        if (!top) return '';
                        const lib = top.type || top.name || (isFr ? 'obstacle' : 'obstacle');
                        return `<div class="fp-cell" title="${isFr ? 'Sommet d\u2019obstacle le plus élevé du couloir (± 0,5 NM, base SIA) — compris dans la marge mini et la Z sécu' : 'Highest obstacle top in the corridor (±0.5 NM, SIA) — included in min clearance and MSA'}">
                            <div class="fp-label">${isFr ? 'Obstacle max' : 'Max obstacle'}</div>
                            <div class="fp-value" style="color:${top.topFt >= (plan.elevationProfile.maxFt ?? 0) ? '#F59E0B' : 'inherit'};">${top.topFt} ft · ${escapeHtml(lib)}</div>
                        </div>`;
                    })()}
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
                            const f = _legMainFreq(lg.to.icao);
                            return `
                            <tr>
                                <td><b>${escapeHtml(_wpDisplayName(lg.from.icao))}</b> → <b>${escapeHtml(_wpDisplayName(lg.to.icao))}</b></td>
                                <td>${lg.distanceNm} NM</td>
                                <td>${String(lg.magHeading).padStart(3,'0')}°</td>
                                <td>${fmtTime(lg.legTimeMin)}</td>
                                <td>${lg.fuel.tripFuelL} L</td>
                                <td class="freq-cell">${f ? f.freq.toFixed(3) + (f.type ? ' ' + escapeHtml(f.type) : '') : '—'}</td>
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
    _wireLeg2(container, { plan, isFr, isNight, tas, burn });
    _attachMinima(container, plan, isFr);
}

// Fenêtre de confirmation avant génération du log de nav PDF (ou du DOSSIER
// complet, {file:true}) : rappelle que le document est calculé automatiquement
// et liste ce que le pilote doit vérifier avant de l'utiliser en vol.
// Promesse → true si l'utilisateur confirme.
function _confirmNavLogPdf(isFr, { file = false, local = false } = {}) {
    return new Promise(resolve => {
        document.getElementById('navlog-confirm-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'navlog-confirm-modal';
        modal.className = 'modal-overlay visible';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');

        // Vol local (19/09) : vérifications pertinentes d'un circuit — pas de
        // caps / Z sécu / Tsv qui n'existent pas sans route.
        const items = local ? (isFr ? [
            ['clock', '<b>Durée estimée</b> — le devis carburant (durée + roulage + réserve + inutilisable) en découle'],
            ['gauge', '<b>QNH et vent du terrain</b> — METAR capturé à l\'instant de la génération, souvent périmé au décollage'],
            ['radio', '<b>Piste en service et fréquences</b> — à confirmer sur une carte VAC / NOTAM à jour'],
            ['fuel', '<b>Carburant embarqué</b> — à recouper avec la jauge avant le vol'],
        ] : [
            ['clock', '<b>Estimated duration</b> — the fuel quote (duration + taxi + reserve + unusable) follows from it'],
            ['gauge', '<b>Field QNH and wind</b> — METAR captured when generated, likely outdated at takeoff'],
            ['radio', '<b>Runway in use and frequencies</b> — confirm against an up-to-date VAC chart / NOTAM'],
            ['fuel', '<b>Fuel on board</b> — cross-check against the gauge before the flight'],
        ]) : (isFr ? [
            ['compass', '<b>Caps (RM/CM) et dérive</b> — recalculés avec le vent <i>estimé</i> au moment du calcul, pas le vent réel'],
            ['mountain', '<b>Altitudes</b> — Z sécu (relief + 1000 ft) et altitude retenue, à confronter au relief réel et aux zones réglementées'],
            ['clock', '<b>Temps de vol (Tsv/Tav) et vitesse sol</b> — dépendants du vent réel rencontré'],
            ['fuel', '<b>Carburant</b> — trajet et réserve à recouper avec le POH de l\'avion et la consommation réelle'],
            ['radio', '<b>Fréquences et piste en service</b> — à confirmer sur une carte VAC / NOTAM à jour'],
            ['gauge', '<b>QNH et vent de départ</b> — METAR capturé à l\'instant de la génération, souvent périmé au décollage'],
        ] : [
            ['compass', '<b>Headings (MH/CH) and drift</b> — computed with the <i>estimated</i> wind at calculation time, not the actual wind'],
            ['mountain', '<b>Altitudes</b> — MSA (terrain + 1000 ft) and chosen level, to be checked against actual terrain and restricted areas'],
            ['clock', '<b>ETE and ground speed</b> — depend on the actual wind encountered'],
            ['fuel', '<b>Fuel</b> — trip and reserve to be cross-checked against the aircraft POH and actual consumption'],
            ['radio', '<b>Frequencies and runway in use</b> — confirm against an up-to-date VAC chart / NOTAM'],
            ['gauge', '<b>Departure QNH and wind</b> — METAR captured when generated, likely outdated at takeoff'],
        ]);

        modal.innerHTML = `
            <div class="modal-content" style="max-width:540px;">
                <div class="modal-header">
                    <h2 style="display:flex;align-items:center;gap:10px;">
                        <i data-lucide="alert-triangle" style="width:20px;height:20px;color:#F59E0B;"></i>
                        ${file
                            ? (local
                                ? (isFr ? 'Dossier de vol local — à vérifier avant impression' : 'Local flight file — verify before printing')
                                : (isFr ? 'Dossier de vol — à vérifier avant impression' : 'Flight file — verify before printing'))
                            : (isFr ? 'À vérifier avant d\'imprimer' : 'Verify before printing')}
                    </h2>
                    <button class="btn-close-modal" data-cancel title="${isFr ? 'Annuler' : 'Cancel'}" aria-label="${isFr ? 'Annuler' : 'Cancel'}"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body" style="font-size:12.5px; line-height:1.55; color:var(--text-color);">
                    <p style="margin:0 0 10px 0;">
                        ${isFr
                            ? (local
                                ? 'Ce dossier de vol local est <b>généré automatiquement</b> (METAR, NOTAM, devis carburant du widget Centrage). Ces valeurs sont une <b>aide à la préparation, pas une garantie</b>. Avant le vol, vérifiez chaque valeur :'
                                : 'Ce log de nav est <b>généré automatiquement</b> à partir des données du planificateur (vent Open-Meteo estimé à l\'altitude de croisière, relief, performances saisies). Ces valeurs sont une <b>aide à la préparation, pas une garantie</b>. Avant tout usage en vol, vérifiez chaque valeur :')
                            : (local
                                ? 'This local flight file is <b>generated automatically</b> (METAR, NOTAM, fuel quote from the Balance widget). These values are a <b>preparation aid, not a guarantee</b>. Before the flight, verify every value:'
                                : 'This nav log is <b>generated automatically</b> from the flight planner data (estimated Open-Meteo wind at cruise altitude, terrain, entered performance). These values are a <b>preparation aid, not a guarantee</b>. Before any in-flight use, verify every value:')}
                    </p>
                    <div style="display:flex; flex-direction:column; gap:7px; margin:0 0 10px 0;">
                        ${items.map(([icon, txt]) => `
                            <div style="display:flex; gap:9px; align-items:flex-start;">
                                <i data-lucide="${icon}" style="width:14px;height:14px;color:var(--primary);flex-shrink:0;margin-top:2px;"></i>
                                <span>${txt}</span>
                            </div>`).join('')}
                    </div>
                    <div style="margin:0 0 10px 0; padding-top:8px; border-top:1px dashed var(--border-color);">
                        <div style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.8px; color:var(--text-muted); margin-bottom:6px;">
                            <i data-lucide="clipboard-check" style="width:12px;height:12px;vertical-align:middle;"></i>
                            ${isFr ? ' Documents à bord — cochez après vérification' : 'Documents on board — tick after checking'}
                        </div>
                        <div style="display:grid; grid-template-columns:1fr 1fr; gap:5px 12px;">
                            ${(isFr ? [
                                '<b>Licence</b> et certificat médical (ou licence ULM) à jour',
                                '<b>Carnet de vol</b> à jour',
                                '<b>Documents avion</b> : immatriculation, assurance RC, manuel de vol / fiche de pesée',
                                '<b>Cartes du jour</b> : VAC départ / arrivée / dégagement + log de nav',
                            ] : [
                                '<b>Licence</b> and medical (or microlight licence) valid',
                                '<b>Logbook</b> up to date',
                                '<b>Aircraft documents</b>: registration, RC insurance, POH / weight &amp; balance sheet',
                                '<b>Today\u2019s charts</b>: departure / destination / alternate VAC + nav log',
                            ]).map(d => `
                                <label style="display:flex; gap:7px; align-items:center; cursor:pointer; font-size:12px;">
                                    <input type="checkbox" class="docs-check" style="accent-color:var(--primary); width:14px; height:14px; flex-shrink:0;">
                                    <span>${d}</span>
                                </label>`).join('')}
                        </div>
                    </div>
                    <p style="margin:0 0 10px 0; color:var(--text-muted);">
                        ${isFr
                            ? 'Les champs laissés vides (pilote, c/sign, heures, horomètres, HEA/HRA, checks) sont à <b>compléter à la main</b>.'
                            : 'Empty fields (pilot, c/sign, times, hobbs, ETA/ATA, checks) must be <b>filled in by hand</b>.'}
                    </p>
                    <div style="padding:9px 12px; background:rgba(245,158,11,0.12); border:1px solid rgba(245,158,11,0.35); border-radius:8px; color:#FBBF24; font-size:12px;">
                        <i data-lucide="scale" style="width:13px;height:13px;vertical-align:middle;"></i>
                        ${isFr
                            ? ' Ce document ne remplace ni le POH de l\'avion, ni les cartes officielles, ni la préparation réglementaire du vol. <b>Le commandant de bord reste seul responsable</b> de la vérification des informations et de ses décisions.'
                            : ' This document does not replace the aircraft POH, official charts or the regulatory flight preparation. <b>The pilot-in-command remains solely responsible</b> for verifying the information and for their decisions.'}
                    </div>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-cancel>${isFr ? 'Annuler' : 'Cancel'}</button>
                    <button class="btn-primary" data-ok disabled>
                        <i data-lucide="printer" style="width:14px;height:14px;"></i>
                        ${file
                            ? (isFr ? 'J\'ai vérifié — générer le dossier' : 'Verified — generate the file')
                            : (isFr ? 'J\'ai vérifié — générer et ouvrir' : 'Verified — generate & open')}
                    </button>
                </div>
            </div>`;

        document.body.appendChild(modal);
        if (window.lucide) window.lucide.createIcons({ root: modal });

        const onKey = (e) => { if (e.key === 'Escape') done(false); };
        const done = (val) => {
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(val);
        };
        modal.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => done(false)));
        modal.querySelector('[data-ok]').addEventListener('click', () => done(true));
        modal.addEventListener('click', e => { if (e.target === modal) done(false); });
        document.addEventListener('keydown', onKey);

        // Le bouton de génération reste GRISÉ tant que les 4 cases « Documents
        // à bord » ne sont pas toutes cochées (retour pilote 13/09 : la
        // vérification doit être effective, pas sautable).
        const docsBoxes = [...modal.querySelectorAll('.docs-check')];
        const okBtn = modal.querySelector('[data-ok]');
        const syncOk = () => {
            const all = docsBoxes.length > 0 && docsBoxes.every(b => b.checked);
            okBtn.disabled = !all;
            okBtn.style.opacity = all ? '' : '0.45';
            okBtn.style.cursor = all ? '' : 'not-allowed';
        };
        docsBoxes.forEach(b => b.addEventListener('change', syncOk));
        syncOk();

        modal.querySelector('[data-ok]').focus();
    });
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

// Nom d'affichage d'une étape : les repères libres (pseudo-codes ZZxx)
// s'affichent sous leur VRAI nom (VOR « BNE », NDB, point VFR « E2 »…),
// le code restant technique (permalien, pipeline).
// Exporté pour navlog-pdf via le sample (rows/waypoints portent `name`).
export function _wpDisplayName(code) {
    // Le code d'un repère libre EST son nom (slug, 19/09 — plus de ZZxx) :
    // rien à traduire, le code s'affiche tel quel.
    return code;
}

// Le champ Waypoints affiche les VRAIS noms des repères libres (VOR, NDB,
// points VFR…) au lieu de leurs codes techniques ZZxx. Le parse inverse
// (nom saisi → code) s'appuie sur le registre des repères de la carte,
// injecté ici par regional-map (pas d'import croisé).
let _resolveFreeWpToken = null;
export function registerFreeWpResolver(fn) { _resolveFreeWpToken = fn; }

/** Valeur du champ Waypoints → codes (OACI ou nom-slug du repère libre),
 *  sans doublon. Un token invalide qui ne résout aucun repère connu est
 *  écarté. Les codes de repères (issus du nom : « RV-E », « LOR »…) ne
 *  sont PAS des OACI 4 lettres — tiret et 2-10 caractères admis. */
export function parseWaypointsField(value) {
    const out = [];
    for (const t of String(value || '').toUpperCase().split(/\s+/)) {
        if (!t) continue;
        if (/^[A-Z][A-Z0-9]{3}$/.test(t)) { out.push(t); continue; }
        const code = _resolveFreeWpToken?.(t);
        if (code && /^[A-Z0-9][A-Z0-9-]{0,9}$/.test(code)) out.push(code);
    }
    return [...new Set(out)];
}

/** Codes → valeur affichée dans le champ (noms réels des repères ZZxx). */
export function formatWaypointsField(codes) {
    return (Array.isArray(codes) ? codes : [])
        .map(c => /^[A-Z][A-Z0-9]{3}$/.test(c) ? c : _wpDisplayName(c))
        .join(' ');
}

function _renderInputs(from, to, fromName, toName, alt, tas, burn, isNight, isFr) {
    const waypointsValue = (state.route && state.route.length > 2)
        ? formatWaypointsField(state.route.slice(1, -1)) : '';
    // Liste lisible des étapes : code + nom de l'aérodrome (ou nom complet
    // du repère), crayon de renommage pour les repères libres (code = nom).
    const wps = (state.route && state.route.length > 2) ? state.route.slice(1, -1) : [];
    const wpListHtml = wps.length ? `
        <div id="fp-waypoint-list" class="fp-waypoint-list">
            ${wps.map((code, i) => {
                const apt = getAirportByICAO(code);
                const name = apt?.name || code;
                const renamable = !!apt?.freeWp;
                const display = code;
                return `<div class="fp-wp-row">
                    <span class="fp-wp-num">${i + 1}.</span>
                    <span class="fp-wp-code">${escapeHtml(display)}</span>
                    ${!renamable || display !== name ? `<span class="fp-wp-name">${escapeHtml(name)}</span>` : ''}
                    ${renamable ? `<button class="fp-wp-rename" data-icao="${escapeHtml(code)}" title="${isFr ? 'Renommer ce repère' : 'Rename this waypoint'}"><i data-lucide="pencil" style="width:12px;height:12px;"></i></button>` : ''}
                    <button class="fp-wp-del" data-icao="${escapeHtml(code)}" title="${isFr ? 'Retirer ce waypoint du plan' : 'Remove this waypoint from the plan'}"><i data-lucide="x" style="width:12px;height:12px;"></i></button>
                </div>`;
            }).join('')}
        </div>` : '';
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
            <label class="fp-input-label" title="${isFr ? 'Consommation de croisière de l\u2019avion actif — PARAMÈTRE INFORMATIF : issue de la fiche avion (fenêtre Flotte), elle alimente le devis mais ne se modifie pas ici.' : 'Cruise burn of the active aircraft — INFORMATIONAL: from the aircraft sheet (Fleet window), it feeds the quote but is not editable here.'}">
                <span>${isFr ? 'Conso (L/h) · info' : 'Burn (L/h) · info'}</span>
                <input type="number" id="fp-burn" value="${burn}" min="0" step="1" class="fp-input fp-input-ro" readonly tabindex="-1" aria-readonly="true">
            </label>
            <label class="fp-night-label" title="${isFr ? 'Vol de nuit (réserve 45 min au lieu de 30)' : 'Night flight (45 min reserve)'}">
                <input type="checkbox" id="fp-night" ${isNight ? 'checked' : ''}>
                <span>${isFr ? 'Nuit' : 'Night'}</span>
            </label>
        </div>
        ${wpListHtml}
    `;
}

function _wireInputs(container, from, to) {
    // Garde-fou anti-récursion : showFlightPlanner recrée le DOM et rewire les inputs,
    // ce qui peut redéclencher 'change' et boucler (OOM). Le flag est module-level
    // (partagé avec le callback de pré-chargement des fréquences de showFlightPlanner).
    const recalc = () => {
        if (_recalculating) return;   // évite la récursion pendant le re-render
        _recalculating = true;
        try {
            // Lit les waypoints saisis (codes OACI ou noms de repères libres
            // affichés dans le champ) et peuple state.route pour le multi-leg.
            const wpInput = container.querySelector('#fp-waypoints');
            if (wpInput) {
                const wps = parseWaypointsField(wpInput.value);
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
    // La conso n'y figure pas : champ informatif lecture seule (19/09).
    container.querySelector('#fp-cruise-alt')?.addEventListener('change', recalc);
    container.querySelector('#fp-tas')?.addEventListener('change', recalc);
    container.querySelector('#fp-night')?.addEventListener('change', recalc);
    // IMPORTANT : on n'écoute QUE 'change' (déclenché à la perte de focus / Entrée),
    // jamais 'input' (frappe clavier). Sinon showFlightPlanner recrée le DOM et
    // détruit le champ en cours de saisie → l'utilisateur ne peut pas taper ses waypoints.
    container.querySelector('#fp-waypoints')?.addEventListener('change', recalc);

    // Renommage d'un repère (ZZxx) depuis la liste des étapes du plan.
    container.querySelectorAll('.fp-wp-rename').forEach(btn => {
        btn.addEventListener('click', async () => {
            const icao = btn.dataset.icao;
            const apt = getAirportByICAO(icao);
            const name = await _promptRenameWaypoint(icao, apt?.name || icao);
            if (name) {
                // regional-map met à jour le registre, l'étiquette carte et
                // re-rend le plan (dispatch 'change') pour afficher le nouveau nom.
                document.dispatchEvent(new CustomEvent('rename-free-waypoint', { detail: { icao, name } }));
            }
        });
    });

    // Retrait d'un waypoint du plan (croix de la liste des étapes) : retire
    // le code du champ Waypoints et relance le calcul (les repères libres
    // restent sur la carte, réutilisables via leur popup « + Plan »).
    container.querySelectorAll('.fp-wp-del').forEach(btn => {
        btn.addEventListener('click', () => {
            const icao = btn.dataset.icao;
            const wpInput = container.querySelector('#fp-waypoints');
            if (!icao || !wpInput) return;
            const wps = parseWaypointsField(wpInput.value).filter(w => w !== icao);
            wpInput.value = formatWaypointsField(wps);
            wpInput.dispatchEvent(new Event('change'));
        });
    });
}

// Petite modale de renommage d'un waypoint libre (promise → nouveau nom ou null).
function _promptRenameWaypoint(icao, currentName) {
    return new Promise(resolve => {
        document.getElementById('wp-rename-modal')?.remove();
        const modal = document.createElement('div');
        modal.id = 'wp-rename-modal';
        modal.className = 'modal-overlay visible';
        modal.setAttribute('role', 'dialog');
        modal.setAttribute('aria-modal', 'true');
        const isFr = state.lang === 'fr';
        modal.innerHTML = `
            <div class="modal-content" style="max-width:360px;">
                <div class="modal-header">
                    <h2 style="display:flex;align-items:center;gap:8px;font-size:15px;">
                        <i data-lucide="pencil" style="width:16px;height:16px;color:var(--primary);"></i>
                        ${isFr ? 'Renommer le waypoint' : 'Rename waypoint'}
                    </h2>
                    <button class="btn-close-modal" data-cancel aria-label="${isFr ? 'Annuler' : 'Cancel'}"><i data-lucide="x"></i></button>
                </div>
                <div class="modal-body">
                    <label style="display:flex;flex-direction:column;gap:6px;font-size:12px;color:var(--text-muted);">
                        <span><span style="font-family:'DM Mono',monospace;color:var(--primary);font-weight:600;">${escapeHtml(icao)}</span> — ${isFr ? 'nouveau nom' : 'new name'}</span>
                        <input type="text" id="wp-rename-input" maxlength="24" value="${escapeHtml(currentName)}" style="background:var(--input-bg);border:1px solid var(--border-color);color:var(--text-color);border-radius:6px;padding:8px 10px;font-size:13px;outline:none;">
                    </label>
                </div>
                <div class="modal-footer">
                    <button class="btn-secondary" data-cancel>${isFr ? 'Annuler' : 'Cancel'}</button>
                    <button class="btn-primary" data-ok>${isFr ? 'Renommer' : 'Rename'}</button>
                </div>
            </div>`;
        document.body.appendChild(modal);
        if (window.lucide) window.lucide.createIcons({ root: modal });

        const input = modal.querySelector('#wp-rename-input');
        input?.focus();
        input?.select();

        const onKey = (e) => {
            if (e.key === 'Escape') done(null);
            if (e.key === 'Enter') { e.preventDefault(); done(input.value.trim().slice(0, 24) || null); }
        };
        const done = (val) => {
            document.removeEventListener('keydown', onKey);
            modal.remove();
            resolve(val);
        };
        modal.querySelectorAll('[data-cancel]').forEach(b => b.addEventListener('click', () => done(null)));
        modal.querySelector('[data-ok]').addEventListener('click', () => done(input.value.trim().slice(0, 24) || null));
        modal.addEventListener('click', e => { if (e.target === modal) done(null); });
        document.addEventListener('keydown', onKey);
    });
}
