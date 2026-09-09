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

export const AGE_THRESHOLDS = { freshMin: 56, agingMin: 116 };

/** Minutes écoulées depuis l'observation (jamais négatif). */
export function metarAgeMin(obsTimeMs, nowMs = Date.now()) {
    if (!Number.isFinite(obsTimeMs)) return null;
    return Math.max(0, Math.floor((nowMs - obsTimeMs) / 60000));
}

/** Niveau de fraîcheur : 'fresh' | 'aging' | 'old' | null. */
export function ageLevel(min) {
    if (!Number.isFinite(min)) return null;
    if (min < AGE_THRESHOLDS.freshMin) return 'fresh';
    if (min < AGE_THRESHOLDS.agingMin) return 'aging';
    return 'old';
}

/**
 * État du badge à partir de l'état précédent et de l'événement courant.
 * - météo chargée : obsTimeMs extrait, offline remis à zéro.
 * - échec réseau : on CONSERVE l'observation précédente + offline=true.
 * @returns {{obsTimeMs:number|null, offline:boolean}}
 */
export function nextAgeState(prev, { obsTimeMs = null, offline = false } = {}) {
    if (offline) return { obsTimeMs: prev?.obsTimeMs ?? null, offline: true };
    return { obsTimeMs: Number.isFinite(obsTimeMs) ? obsTimeMs : null, offline: false };
}

const LABELS = () => (state.lang === 'fr' ? {
    observed: (m) => `Observé il y a ${m} min`,
    offline: (m) => `Réseau indisponible — dernière obs. il y a ${m} min`,
    noData: 'Aucune observation',
} : {
    observed: (m) => `Observed ${m} min ago`,
    offline: (m) => `Network unavailable — last obs. ${m} min ago`,
    noData: 'No observation',
});

let _ageState = { obsTimeMs: null, offline: false };
let _timer = null;
let _badge = null;

function _render() {
    if (!_badge) return;
    const L = LABELS();
    const min = metarAgeMin(_ageState.obsTimeMs);
    if (min == null) { _badge.className = 'data-age-badge'; _badge.style.display = 'none'; return; }
    const level = _ageState.offline ? 'old' : ageLevel(min);
    _badge.style.display = '';
    _badge.className = `data-age-badge age-${level}`;
    _badge.textContent = _ageState.offline ? L.offline(min) : L.observed(min);
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
    _ageState = nextAgeState(_ageState, { obsTimeMs, offline: !!opts.offline });
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
