/* ================================================================
 * DATA-AGE — Badge d'âge de la dernière observation météo
 * ================================================================
 *
 * OBJECTIF (demande pilote 09/09 « badge d'âge des données »)
 * ----------------------------------------------------------
 * En vol, réseau capricieux : plutôt qu'un échec muet, le pilote doit
 * savoir À QUOI il a affaire — dernière observation frais / vieillissant /
 * périmé, et si le dernier chargement a échoué (réseau indisponible).
 * La règle « jamais de météo cachée » est préservée : on n'affiche JAMAIS
 * une valeur périmée sans le dire ; le badge EST cette mention.
 *
 * SEUILS (METAR publié toutes les heures + SPECI)
 *   < 56 min   → FRESH  (vert)   observation courante
 *   < 116 min  → AGING  (ambre)  non renouvelée depuis plus d'un cycle
 *   ≥ 116 min  → OLD    (rouge)  périmée pour un briefing
 *
 * Pure functions exportées → testées sous Node (test/data-age.test.mjs).
 * ================================================================ */
import { state } from './core.js';

// Seuils PAR TYPE DE MESSAGE (retour pilote 10/09) : un METAR est observé
// toutes les heures (+SPECI), un TAF est ÉMIS toutes les ~6 h (routine, AMD
// possible entre deux) — mêmes couleurs, cycles différents.
export const AGE_THRESHOLDS = {
    metar: { freshMin: 56, agingMin: 116 },    // < 1 cycle = vert ; ≈ 2 cycles = rouge
    taf:   { freshMin: 390, agingMin: 720 },   // < 6 h 30 = vert ; > 12 h = rouge
};
export function thresholdsFor(type) {
    return AGE_THRESHOLDS[type] || AGE_THRESHOLDS.metar;
}

/** Minutes écoulées depuis l'observation (jamais négatif). */
export function metarAgeMin(obsTimeMs, nowMs = Date.now()) {
    if (!Number.isFinite(obsTimeMs)) return null;
    return Math.max(0, Math.floor((nowMs - obsTimeMs) / 60000));
}

/** Niveau de fraîcheur : 'fresh' | 'aging' | 'old' | null (selon le type). */
export function ageLevel(min, type = 'metar') {
    if (!Number.isFinite(min)) return null;
    const th = thresholdsFor(type);
    if (min < th.freshMin) return 'fresh';
    if (min < th.agingMin) return 'aging';
    return 'old';
}

/** Durée lisible : « 45 min » puis « 3 h 05 » au-delà d'une heure. */
export function fmtAge(min) {
    if (!Number.isFinite(min)) return '—';
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h} h ${String(m).padStart(2, '0')}` : `${h} h`;
}

/**
 * État du badge à partir de l'état précédent et de l'événement courant.
 * - météo chargée : obsTimeMs extrait, offline remis à zéro.
 * - échec réseau : on CONSERVE l'observation précédente + offline=true.
 * @returns {{obsTimeMs:number|null, offline:boolean}}
 */
export function nextAgeState(prev, { obsTimeMs = null, offline = false, type = 'metar' } = {}) {
    if (offline) return { obsTimeMs: prev?.obsTimeMs ?? null, offline: true, type: prev?.type ?? type };
    return { obsTimeMs: Number.isFinite(obsTimeMs) ? obsTimeMs : null, offline: false, type };
}

const LABELS = () => (state.lang === 'fr' ? {
    observed: (d) => `Observé il y a ${d}`,
    issued: (d) => `Émis il y a ${d}`,
    offlineMetar: (d) => `Réseau indisponible — dernière obs. il y a ${d}`,
    offlineTaf: (d) => `Réseau indisponible — dernier TAF émis il y a ${d}`,
    noData: 'Aucune observation',
} : {
    observed: (d) => `Observed ${d} ago`,
    issued: (d) => `Issued ${d} ago`,
    offlineMetar: (d) => `Network unavailable — last obs. ${d} ago`,
    offlineTaf: (d) => `Network unavailable — last TAF issued ${d} ago`,
    noData: 'No observation',
});

let _ageState = { obsTimeMs: null, offline: false, type: 'metar' };
let _timer = null;
let _badge = null;

function _render() {
    if (!_badge) return;
    const L = LABELS();
    const min = metarAgeMin(_ageState.obsTimeMs);
    if (min == null) { _badge.className = 'data-age-badge'; _badge.style.display = 'none'; return; }
    const level = _ageState.offline ? 'old' : ageLevel(min, _ageState.type);
    const d = fmtAge(min);
    const isTaf = _ageState.type === 'taf';
    _badge.style.display = '';
    _badge.className = `data-age-badge age-${level}`;
    _badge.textContent = _ageState.offline
        ? (isTaf ? L.offlineTaf(d) : L.offlineMetar(d))
        : (isTaf ? L.issued(d) : L.observed(d));
    _badge.title = new Date(_ageState.obsTimeMs).toISOString();
}

function _ensureBadge() {
    if (_badge) return _badge;
    const info = document.getElementById('lbl-info');
    if (!info || !info.parentElement) return null;
    _badge = document.createElement('span');
    _badge.id = 'data-age-badge';
    _badge.className = 'data-age-badge';
    _badge.style.display = 'none';
    info.parentElement.insertBefore(_badge, info);
    return _badge;
}

/**
 * Signale un événement au badge.
 * @param {string|null} metarText  le message météo chargé (null si échec)
 * @param {{offline?:boolean}} [opts] offline=true : dernier chargement en échec
 */
export function dataAgeUpdate(metarText, opts = {}) {
    const type = opts.type === 'taf' ? 'taf' : 'metar';
    let obsTimeMs = null;
    if (metarText) {
        const m = String(metarText).match(/\b(\d{2})(\d{2})(\d{2})Z\b/);
        if (m) {
            const now = new Date();
            const d = parseInt(m[1], 10), h = parseInt(m[2], 10), mn = parseInt(m[3], 10);
            // Jour du mois observé : hier possible (message émis à 23:50 lu à 00:10).
            let t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), d, h, mn);
            if (t - now.getTime() > 12 * 3600e3) t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, d, h, mn);
            if (now.getTime() - t > 36 * 3600e3) t = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, d, h, mn);
            obsTimeMs = t;
        }
    }
    _ageState = nextAgeState(_ageState, { obsTimeMs, offline: !!opts.offline, type });
    _ensureBadge();
    _render();
}

/** Monte le badge (au premier chargement de l'app). */
export function initDataAge() {
    _ensureBadge();
    if (!_timer) {
        _timer = setInterval(_render, 60000);   // l'âge avance d'une minute…
        document.addEventListener('lang-changed', _render);
    }
}
