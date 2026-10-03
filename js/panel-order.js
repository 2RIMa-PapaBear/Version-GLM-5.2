/* ================================================================
 * PANEL ORDER — Cadres du briefing réordonnables à la main
 * ================================================================
 *
 * OBJECTIF (retour pilote 03/10)
 * --------
 * Les cadres « de données » du briefing — Performances piste,
 * Centrage, Info terrain, Fréquences, Alternates, Calcul de
 * navigation, Sup AIP, NOTAM et Carte régionale — doivent pouvoir
 * être déplacés librement et rangés dans l'ordre que souhaite le
 * pilote, ordre mémorisé d'une session à l'autre.
 *
 * INTERACTION
 * -----------
 * Poignée ⠿ à gauche du titre de chaque cadre concerné.
 *   Souris : glisser directement (au-delà de 6 px).
 *   Tactile : appui long (450 ms, comme les repères libres de la
 *             carte) puis glissé — la page ne défile pas pendant
 *             le geste, une vibration confirme la préhension.
 * Un clic simple (sans glisser) continue de replier/déplier le
 * cadre ; Échap annule un déplacement en cours.
 *
 * PÉRIMÈTRE
 * ---------
 * L'ordre ne permute que les EMPPLACEMENTS de ces cadres : les
 * autres panneaux de la colonne (fenêtre de vol, dossier de vol,
 * légendes) restent ancrés à leur place.
 *
 * IMPLÉMENTATION
 * --------------
 * Le cadre déplacé passe en position:fixed (il suit le pointeur,
 * insensible au défilement) pendant qu'un placeholder de même
 * hauteur maintient son créneau dans .center-column. Au relâché,
 * le cadre est réinséré à l'emplacement du placeholder et l'ordre
 * complet est persisté en localStorage (`panel-order-v1`).
 * Un MutationObserver sur la colonne redécore les cadres montés
 * tardivement (Sup AIP et NOTAM s'insèrent dynamiquement après
 * chargement) et réapplique l'ordre sauvegardé : les positions
 * d'insertion par défaut de sup-sia.js / notam.js ne le cassent
 * jamais.
 * ================================================================ */

import { state } from './core.js';

const ORDER_KEY = 'panel-order-v1';
const HOLD_MS = 450;          // appui long tactile (cf. repères libres)
const MOUSE_START_PX = 6;     // seuil souris : au-delà, ce n'est plus un clic
const TOUCH_CANCEL_PX = 12;   // le doigt glisse avant l'appui long → scroll
const AUTOSCROLL_MARGIN = 48; // marge haute/basse déclenchant le défilement
const AUTOSCROLL_STEP = 10;

// Les cadres réordonnables (id DOM) — centrage inclus (retour pilote
// 03/10 : « centrage n'a pas sa poignée ») ; alternates et Calcul de
// navigation ajoutés sur demande (visibles en mode Navigation, l'ordre
// y est mémorisé pareil).
const MOVABLE = [
    'takeoff-widget',        // Performances piste
    'wb-widget',             // Centrage & masse
    'airfield-widget',       // Info terrain
    'frequencies-widget',    // Fréquences
    'alternates-container',  // Alternates viables (mode Navigation)
    'flight-planner-panel',  // Calcul de navigation (mode Navigation)
    'sup-panel',             // Sup AIP (SIA) — monté dynamiquement
    'notam-panel',           // NOTAM (SOFIA) — monté dynamiquement
    'regional-map-panel',    // Carte régionale
];
const MOVABLE_SET = new Set(MOVABLE);

// Poignée inline (aucune dépendance au chargeur d'icônes : elle doit
// être visible dès la décoration, y compris avant lucide).
const GRIP_SVG =
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="16" viewBox="0 0 10 16" fill="currentColor" aria-hidden="true">' +
    '<circle cx="2.5" cy="2" r="1.5"></circle><circle cx="7.5" cy="2" r="1.5"></circle>' +
    '<circle cx="2.5" cy="8" r="1.5"></circle><circle cx="7.5" cy="8" r="1.5"></circle>' +
    '<circle cx="2.5" cy="14" r="1.5"></circle><circle cx="7.5" cy="14" r="1.5"></circle></svg>';

const _drag = {
    pending: null,   // préhension envisagée { panel, header, container, x0, y0, pointerId, pointerType, holdTimer }
    active: null,    // déplacement en cours { panel, header, container, placeholder, pointerId, startClientY, originalNext, lastY }
};

const _isFr = () => state.lang === 'fr';

function _announce(msg) {
    const el = document.getElementById('sr-announcements');
    if (el) {
        el.textContent = '';
        setTimeout(() => { el.textContent = msg; }, 30);
    }
}

function _headerOf(panel) {
    // L'Alternates n'utilise pas makeCollapsible : son en-tête maison
    // porte .alternates-header (cf. index.html).
    return panel.querySelector(':scope > .collapsible-header, :scope > .regional-map-header, :scope > .alternates-header');
}

function _panelTitle(panel) {
    const h = _headerOf(panel);
    return (h?.querySelector('.collapsible-title, #lbl-regional-map, #lbl-alternates')?.textContent || panel.id || '').trim();
}

/** Pose la poignée + l'infobulle sur le titre d'un cadre (idempotent).
 * Exportée pour makeCollapsible : le titre d'un cadre peut être
 * RECONSTRUIT longtemps après l'init (rendu des données), la poignée
 * doit suivre sans attendre le prochain passage de l'observateur. */
export function decorateOrderable(panel) {
    if (!panel || !MOVABLE_SET.has(panel.id)) return;
    const header = _headerOf(panel);
    if (!header) return;
    header.title = _isFr()
        ? 'Glisser pour réordonner · clic : replier/déplier'
        : 'Drag to reorder · click: collapse/expand';
    if (header.dataset.orderGrip) return;
    header.dataset.orderGrip = '1';
    header.classList.add('panel-order-header');
    const grip = document.createElement('span');
    grip.className = 'panel-order-grip';
    grip.setAttribute('aria-hidden', 'true');
    grip.innerHTML = GRIP_SVG;
    header.insertBefore(grip, header.firstChild);
}

/* ------------------------------------------------------------------
 * Persistance de l'ordre + réapplication.
 * ------------------------------------------------------------------ */

function _readSavedOrder() {
    try {
        const order = JSON.parse(localStorage.getItem(ORDER_KEY) || 'null');
        return Array.isArray(order) ? order.filter(id => MOVABLE_SET.has(id)) : null;
    } catch { /* quota / JSON corrompu */ }
    return null;
}

/** Enregistre l'ordre courant des cadres déplaçables dans la colonne. */
function _persistOrder(container) {
    const ids = [...container.children]
        .filter(el => MOVABLE_SET.has(el.id))
        .map(el => el.id);
    if (ids.length < 2) return;
    try { localStorage.setItem(ORDER_KEY, JSON.stringify(ids)); } catch { /* quota */ }
}

/**
 * Replace les cadres déplaçables selon l'ordre sauvegardé, en ne
 * permutant que leurs emplacements (les autres panneaux ne bougent
 * pas). Les cadres CONNUS de la sauvegarde suivent son ordre ; un
 * cadre jamais sauvegardé (nouvellement déplaçable — ex. Alternates
 * et Calcul de navigation ajoutés après coup) RESTE à son emplacement
 * courant : les connus se répartissent autour de lui dans leur ordre
 * relatif. Le premier glissé enregistre la liste complète.
 *
 * Les ancrages d'insertion sont les voisins NON déplaçables (ils ne
 * bougent jamais) : s'ancrer sur un occupant déplaçable défait la
 * permutation en cours de boucle — l'ordre sauvegardé n'était alors
 * pas réappliqué après rechargement (vu en QA 03/10).
 */
function _applySavedOrder(container) {
    const saved = _readSavedOrder();
    if (!saved || saved.length < 2) return;
    const kids = [...container.children];
    const movableEls = [];
    for (let i = 0; i < kids.length; i++) {
        if (MOVABLE_SET.has(kids[i].id)) movableEls.push(kids[i]);
    }
    if (movableEls.length < 2) return;
    const byId = new Map(movableEls.map(el => [el.id, el]));
    const known = saved.filter(id => byId.has(id));
    let k = 0;
    const queue = movableEls.map(el => (known.includes(el.id) ? known[k++] : el.id));
    // Déjà conforme : ne rien toucher (sinon l'observateur de la colonne
    // rebouclerait sur des déplacements/insertions permanents).
    if (movableEls.every((el, i) => el.id === queue[i])) return;
    // Ancre STABLE de chaque emplacement : premier voisin non
    // déplaçable après lui (null = bout de colonne). Des emplacements
    // consécutifs peuvent partager la même ancre : l'insertion en
    // ordre croissant devant cette ancre conserve l'ordre voulu.
    const anchors = movableEls.map((el) => {
        for (let sib = el.nextElementSibling; sib; sib = sib.nextElementSibling) {
            if (!MOVABLE_SET.has(sib.id)) return sib;
        }
        return null;
    });
    movableEls.forEach(el => el.remove());
    queue.forEach((id, i) => {
        const el = byId.get(id);
        if (!el) return;
        if (anchors[i]) container.insertBefore(el, anchors[i]);
        else container.appendChild(el);
    });
}

/* ------------------------------------------------------------------
 * Glisser-déposer (délégation document : couvre les cadres montés
 * tardivement sans re-brancher quoi que ce soit).
 * ------------------------------------------------------------------ */

function _startDrag() {
    const p = _drag.pending;
    if (!p) return;
    _drag.pending = null;
    const { panel, header, container } = p;
    const rect = panel.getBoundingClientRect();
    const originalNext = panel.nextElementSibling;

    const placeholder = document.createElement('div');
    placeholder.className = 'panel-order-placeholder';
    placeholder.style.height = Math.round(rect.height) + 'px';
    container.insertBefore(placeholder, panel);

    panel.classList.add('panel-order-dragging');
    panel.style.width = Math.round(rect.width) + 'px';
    panel.style.left = Math.round(rect.left) + 'px';
    panel.style.top = Math.round(rect.top) + 'px';
    document.body.classList.add('panel-order-moving');

    _drag.active = {
        panel, header, container, placeholder,
        pointerId: p.pointerId,
        startClientY: p.y0,
        originalNext,
        lastY: p.y0,
        moved: false,
    };
    try { navigator.vibrate?.(30); } catch { /* absence d'API : silencieux */ }
    _announce(_isFr()
        ? `Déplacement de « ${_panelTitle(panel)} » — relâchez pour poser`
        : `Moving “${_panelTitle(panel)}” — release to drop`);
    _startAutoScroll();
}

/**
 * Déplace le placeholder dans l'emplacement visé : avant le premier
 * cadre visible dont le milieu passe sous le pointeur, après le
 * dernier sinon. Les cadres masqués (display:none) sont ignorés.
 */
function _movePlaceholder(d, pointerY) {
    const others = [...d.container.children].filter(el =>
        MOVABLE_SET.has(el.id) && el !== d.panel && el !== d.placeholder
        && el.getBoundingClientRect().height > 0);
    let ref = null;
    for (const el of others) {
        const r = el.getBoundingClientRect();
        if (pointerY < r.top + r.height / 2) { ref = el; break; }
    }
    if (ref) {
        if (d.placeholder.nextElementSibling !== ref) d.container.insertBefore(d.placeholder, ref);
    } else {
        const last = others[others.length - 1];
        if (last && d.placeholder.previousElementSibling !== last) {
            d.container.insertBefore(d.placeholder, last.nextSibling);
        }
    }
}

function _finishDrag(cancelled) {
    const d = _drag.active;
    if (!d) return;
    _drag.active = null;
    _stopAutoScroll();
    const { panel, container, placeholder } = d;
    if (cancelled) {
        // Annulation (Échap) : le cadre reprend sa place d'origine.
        container.insertBefore(panel, d.originalNext);
    } else {
        container.insertBefore(panel, placeholder);
        _persistOrder(container);
        _announce(_isFr() ? 'Ordre des cadres enregistré' : 'Panel order saved');
    }
    placeholder.remove();
    panel.classList.remove('panel-order-dragging');
    for (const prop of ['left', 'top', 'width', 'transform']) panel.style.removeProperty(prop);
    document.body.classList.remove('panel-order-moving');
    // Avale le clic synthétisé après le glissé (la capture tactile le
    // retargete sur le titre : sans cela le cadre se replierait). Désarmé
    // après 500 ms : si aucun clic ne suit le geste, le prochain clic
    // légitime du pilote ne doit pas être mangé.
    document.addEventListener('click', _swallowClick, { capture: true, once: true });
    setTimeout(() => document.removeEventListener('click', _swallowClick, { capture: true }), 500);
}

const _swallowClick = (ev) => { ev.stopPropagation(); ev.preventDefault(); };

/* Défilement automatique quand le pointeur APPROCHE DES BORDS —
 * seulement après un vrai déplacement du pointeur : saisir un cadre
 * déjà haut dans la fenêtre ne doit pas faire défiler la page.
 * (QA 03/10 : marge 90 px + boucle partie d'une position initiale
 * haute → le cadre grimpait en tête de pile sans toucher le bord.) */
let _scrollRaf = 0;
function _startAutoScroll() {
    const step = () => {
        const d = _drag.active;
        if (!d) { _scrollRaf = 0; return; }
        if (d.moved) {
            const y = d.lastY;
            if (y < AUTOSCROLL_MARGIN) window.scrollBy(0, -AUTOSCROLL_STEP);
            else if (y > window.innerHeight - AUTOSCROLL_MARGIN) window.scrollBy(0, AUTOSCROLL_STEP);
            // La page défile sans pointermove : recalcule le créneau visé.
            _movePlaceholder(d, y);
        }
        _scrollRaf = requestAnimationFrame(step);
    };
    if (!_scrollRaf) _scrollRaf = requestAnimationFrame(step);
}
function _stopAutoScroll() {
    if (_scrollRaf) cancelAnimationFrame(_scrollRaf);
    _scrollRaf = 0;
}

/* --- Écouteurs délégués (branchés une seule fois par page) ------ */

function _onPointerDown(e) {
    if (_drag.pending || _drag.active) return;
    if (e.button !== 0) return;
    const target = e.target;
    // Les contrôles du titre (bouton Flotte…) gardent leur clic pur.
    if (target.closest?.('button, a, input, select, textarea, label')) return;
    const header = target.closest?.('.collapsible-header, .regional-map-header, .alternates-header');
    if (!header) return;
    const panel = header.closest('aside');
    if (!panel || !MOVABLE_SET.has(panel.id)) return;
    const container = panel.parentElement;
    if (!container?.classList.contains('center-column')) return;

    _drag.pending = {
        panel, header, container,
        x0: e.clientX, y0: e.clientY,
        pointerId: e.pointerId,
        pointerType: e.pointerType || 'mouse',
    };
    // Tactile : la préhension démarre à l'appui long ; un doigt qui
    // glisse avant (seuil 12 px) rend la main au défilement de page.
    if (_drag.pending.pointerType !== 'mouse') {
        _drag.pending.holdTimer = setTimeout(() => { if (_drag.pending) _startDrag(); }, HOLD_MS);
    }
}

function _onPointerMove(e) {
    const d = _drag.active;
    if (d) {
        if (e.pointerId !== d.pointerId) return;
        d.lastY = e.clientY;
        d.moved = true;
        d.panel.style.transform = `translate(0px, ${Math.round(e.clientY - d.startClientY)}px)`;
        _movePlaceholder(d, e.clientY);
        return;
    }
    const p = _drag.pending;
    if (!p || e.pointerId !== p.pointerId) return;
    const dist = Math.hypot(e.clientX - p.x0, e.clientY - p.y0);
    if (p.pointerType === 'mouse') {
        if (dist >= MOUSE_START_PX) _startDrag();
    } else if (p.holdTimer && dist > TOUCH_CANCEL_PX) {
        clearTimeout(p.holdTimer);
        p.holdTimer = null;
    }
}

function _onPointerEnd(e) {
    const p = _drag.pending;
    if (p) {
        if (e.pointerId !== p.pointerId) return;
        if (p.holdTimer) clearTimeout(p.holdTimer);
        _drag.pending = null;   // tap bref : le clic toggle normalement
        return;
    }
    const d = _drag.active;
    if (!d || e.pointerId !== d.pointerId) return;
    _finishDrag(e.type === 'pointercancel');
}

/**
 * Initialise le réordonnancement : décore les six cadres, applique
 * l'ordre sauvegardé puis surveille la colonne (Sup AIP et NOTAM
 * s'y montent après coup).
 */
export function initPanelOrder() {
    if (typeof document === 'undefined') return;
    const container = document.querySelector('.center-column');
    if (!container) return;

    const scan = () => {
        if (_drag.active) return;
        for (const id of MOVABLE) {
            const p = document.getElementById(id);
            if (p && p.parentElement === container) decorateOrderable(p);
        }
        _applySavedOrder(container);
    };
    scan();
    // Sous-arbre : un cadre peut RECONSTRUIRE son titre en interne
    // (makeCollapsible après rendu des données) sans toucher aux
    // enfants directs de la colonne.
    new MutationObserver(() => requestAnimationFrame(scan))
        .observe(container, { childList: true, subtree: true });

    document.addEventListener('pointerdown', _onPointerDown);
    document.addEventListener('pointermove', _onPointerMove);
    document.addEventListener('pointerup', _onPointerEnd);
    document.addEventListener('pointercancel', _onPointerEnd);
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && _drag.active) _finishDrag(true);
    });
    // Pendant le geste tactile, la page ne doit pas défiler : le doigt
    // déplace le cadre (même recette que les repères libres de la carte).
    document.addEventListener('touchmove', (e) => {
        if (_drag.active) e.preventDefault();
    }, { passive: false });
    // Appui long : pas de menu contextuel ni bulle de sélection.
    document.addEventListener('contextmenu', (e) => {
        if (_drag.active || _drag.pending?.holdTimer) e.preventDefault();
    });
}
