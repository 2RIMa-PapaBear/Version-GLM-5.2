/* ================================================================
 * MAP-REGISTRY — Registre de l'instance de carte régionale
 * ================================================================
 * Extrait du global window.__regionalMap (item ⑥ dettes techniques,
 * 09/09) : les modules montés après la carte (suivi GPS…) récupèrent
 * l'instance par import, sans dépendance à un global ni cycle d'import
 * (ce module n'importe rien).
 *
 * NB : regional-map.js pose AUSSI window.__regionalMap en commentaire
 * vivant — c'est un HOOK DE QA (qa-gps.mjs), pas une dépendance du code.
 * ================================================================ */
let _map = null;

export function registerMap(map) { _map = map; }
export function getRegisteredMap() { return _map; }
