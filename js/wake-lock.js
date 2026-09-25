/* ================================================================
 * WAKE LOCK — l'app ne doit PAS se mettre en veille pendant son
 * utilisation (retour pilote 25/09).
 *
 * Screen Wake Lock tant que la page est VISIBLE : le navigateur
 * relâche le verrou tout seul quand l'onglet passe derrière — on le
 * ré-acquiert au retour (visibilitychange) et à la moindre activité
 * (pointerdown, filet de sécurité si le système l'a relâché : batterie
 * faible, etc.). Silencieux là où l'API manque (vieux navigateurs) ou
 * refuse — jamais bloquant.
 * ================================================================ */

let _sentinel = null;

async function _acquire() {
    try {
        if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return;
        if (_sentinel && _sentinel.released === false) return;   // déjà tenu
        _sentinel = await navigator.wakeLock.request('screen');
        _sentinel?.addEventListener?.('release', () => { _sentinel = null; });
    } catch { /* refus système : silencieux, ré-essayé au prochain signal */ }
}

/** À appeler une fois à l'init de l'app. */
export function initWakeLock() {
    if (typeof document === 'undefined') return;
    _acquire();
    document.addEventListener('visibilitychange', () => {
        // Caché : le navigateur relâche le verrou de lui-même, rien à faire.
        if (document.visibilityState === 'visible') _acquire();
    });
    // Filet de sécurité : activité = utilisation → verrou (s'il avait été
    // relâché par le système).
    window.addEventListener('pointerdown', () => {
        if (document.visibilityState === 'visible') _acquire();
    }, { passive: true });
}
