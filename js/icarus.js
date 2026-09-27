/* ================================================================
 * FICHES ICARUS (FFA) — lien contextuel vers les fiches « AD ICARUS »
 * de la Commission Prévention Sécurité de la FFA (menaces locales,
 * zones sensibles bruit, particularités d'exploitation).
 * ================================================================
 *
 * Source OFFICIELLE uniquement (demande pilote 27/09) : le site FFA
 * (onglet ICARUS de ffa-aero.fr, appli WEBDEV). La liste des terrains
 * couverts est relevée à la main dans data/icarus.json — l'appli WEBDEV
 * n'expose rien de scrapable en statique et ses liens « Afficher » sont
 * liés à la session (non partageables) ; le bouton ouvre donc TOUJOURS
 * l'onglet ICARUS officiel, jamais une copie (aucune fiche hébergée
 * ici, © FFA).
 *
 * Complément NON officiel SIA : la carte VAC reste la référence — le
 * lien est rendu APRÈS le bouton « Carte VAC » dans le widget terrain.
 *
 * Node-safe : pas de DOM ; indexedDB gardé par typeof.
 */
const LIST_URL = () => 'data/icarus.json';
const CACHE_TTL_MS = 24 * 3600 * 1000;

// ---- Cache IDB (base « metar-taf-cache » commune) --------------------------
const IDB_NAME = 'metar-taf-cache';
const IDB_STORE = 'cache';
function _idb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idb();
        return await new Promise((resolve, reject) => {
            const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    } catch { return null; }
}
async function _idbPut(key, val) {
    try {
        const db = await _idb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(val, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* best effort */ }
}

let _index = null;

/** Charge l'index des fiches (cache 24 h). null en échec complet. */
export async function loadIcarusIndex() {
    const key = 'icarus:index';
    const hit = await _idbGet(key);
    if (hit?.data?.icaos && Date.now() - hit.ts < CACHE_TTL_MS) { _index = hit.data; return _index; }
    try {
        const r = await fetch(LIST_URL() + '?t=' + (hit?.ts || 0), { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!data?.icaos || !Object.keys(data.icaos).length) throw new Error('index Icarus vide');
        await _idbPut(key, { ts: Date.now(), data });
        _index = data;
        return _index;
    } catch (e) {
        console.warn('Index Icarus indisponible :', e.message);
        _index = hit?.data ?? null;
        return _index;
    }
}

/** Entrée d'un terrain ({name,url}) ou null si non couvert / non chargé. */
export function icarusEntry(icao) {
    const c = String(icao || '').toUpperCase();
    return (c && _index?.icaos?.[c]) || null;
}

/** Le terrain a-t-il une fiche Icarus ? */
export function hasIcarus(icao) {
    return !!icarusEntry(icao);
}

/** Injection pour tests Node (data/icarus.json lu du disque). */
export function _setIcarusIndexForTests(data) { _index = data; }
