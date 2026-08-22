/* ================================================================
 * RADIO POINTS — radiophares (VOR/NDB) et points de repère VFR
 * ================================================================
 *
 * Source : data/radio-points.json — export MONDIAL de l'API openAIP
 * (/navaids + /reporting-points), régénéré chaque semaine par le cron
 * GitHub « Radio points » puis déployé sur le FTP. L'app ne parle
 * JAMAIS à l'API openAIP pour ces données : elle lit le fichier (374 Ko)
 * et le met en cache IndexedDB, avec un contrôle de fraîcheur hebdo
 * (au-delà de 7 jours, re-téléchargement avec contournement du cache
 * HTTP ; en cas d'échec, on garde les données périmées plutôt que rien).
 *
 * Format du fichier (généré par scripts/fetch-radio-points.mjs) :
 *   { generatedAt, counts,
 *     navaids: [[type, ident, lat, lon, freq, unit], …],
 *     vrps:    [[name, lat, lon, country], …] }
 *
 * Classification : openAIP ne publie pas l'énum du champ « type » ;
 * on classe par BANDE de fréquence, incontestable — unit 1 (kHz,
 * 190-1000) = NDB, unit 2 (MHz, 108-118) = VOR (DME colocalisés
 * indifférenciés : l'API n'expose pas de DME isolés).
 *
 * Module SANS dépendance (fonctions pures + IndexedDB optionnel) :
 * testable sous Node, insérable dans la carte régionale.
 * ================================================================ */

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const RADIO_POINTS_URL = 'data/radio-points.json';

/** Seuils de zoom (déclutter) : sous ces niveaux, la couche est vide. */
export const LAYER_MIN_ZOOM = { vor: 6, ndb: 8, vrp: 10 };
/** Seuils de zoom pour afficher les étiquettes (icône seule en dessous). */
export const LABEL_MIN_ZOOM = { vor: 7, ndb: 10, vrp: 11 };
/** Nombre maximal de marqueurs rendus par couche et par cadrage. */
export const LAYER_MAX_POINTS = { vor: 400, ndb: 400, vrp: 400 };

/**
 * Classe un radiophare par bande de fréquence.
 * @param {number} freq Fréquence (valeur brute openAIP).
 * @param {number} unit 1 = kHz, 2 = MHz (énum observée).
 * @returns {'VOR'|'NDB'}
 */
export function classifyNavaid(freq, unit) {
    if (unit === 1) return 'NDB';   // kHz : plage NDB
    if (unit === 2) return 'VOR';   // MHz 108-118 : VOR (+ DME colocalisé)
    // Unité inconnue : on tranche par la plage si elle parle d'elle-même.
    if (freq != null && freq >= 150 && freq <= 1100) return 'NDB';
    return 'VOR';
}

/**
 * Analyse le fichier compact en ensembles typés.
 * @param {Object} json Contenu de data/radio-points.json.
 * @returns {{vor:Array, ndb:Array, vrp:Array, generatedAt:string,
 *            counts:Object}|null}
 */
export function parseRadioPoints(json) {
    if (!json || !Array.isArray(json.navaids) || !Array.isArray(json.vrps)) return null;
    const vor = [], ndb = [], vrp = [];
    for (const [type, ident, lat, lon, freq, unit] of json.navaids) {
        if (!Number.isFinite(lat) || !Number.isFinite(lon) || !ident) continue;
        const it = { ident, lat, lon, freq: Number.isFinite(freq) ? freq : null, type };
        (classifyNavaid(freq, unit) === 'NDB' ? ndb : vor).push(it);
    }
    for (const [name, lat, lon, cc] of json.vrps) {
        if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        vrp.push({ name: String(name), lat, lon, cc: cc || '' });
    }
    return { vor, ndb, vrp, generatedAt: json.generatedAt || '', counts: json.counts || {} };
}

/**
 * Filtre les points dans un cadrage géographique. Gère l'antiméridien
 * (cadre à cheval sur ±180° : est < ouest → deux fenêtres).
 * @param {Array} items Points {lat, lon, …}.
 * @param {number} west Longitude ouest, `south` latitude sud, etc.
 * @returns {Array} Points dans le cadre, ordre du fichier conservé.
 */
export function filterBbox(items, west, south, east, north) {
    if (east >= west) {
        return items.filter(p => p.lat >= south && p.lat <= north && p.lon >= west && p.lon <= east);
    }
    // Traverse ±180° : [west, 180] ∪ [-180, east]
    return items.filter(p => p.lat >= south && p.lat <= north
        && (p.lon >= west || p.lon <= east));
}

/**
 * Couches visibles à un zoom donné (déclutter).
 * @param {number} zoom Niveau de zoom Leaflet.
 * @returns {{vor:boolean, ndb:boolean, vrp:boolean}}
 */
export function visibleKinds(zoom) {
    return {
        vor: zoom >= LAYER_MIN_ZOOM.vor,
        ndb: zoom >= LAYER_MIN_ZOOM.ndb,
        vrp: zoom >= LAYER_MIN_ZOOM.vrp,
    };
}

/** Formate une fréquence pour affichage (« 113.30 » ou « 355 kHz »). */
export function formatFreq(freq, unit) {
    if (freq == null) return '';
    return unit === 1 ? `${freq} kHz` : `${(+freq).toFixed(2).replace(/0$/, '')} MHz`;
}

// ----------------------------------------------------------------
// Chargement + cache IndexedDB (navigation seule ; sous Node, injecter
// fetchImpl et storage 'off' pour tester).
// ----------------------------------------------------------------
const IDB_NAME = 'radio-points-cache';
const IDB_STORE = 'world';

function _openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => {
            if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function _idbGet() {
    try {
        const db = await _openDB();
        return await new Promise((resolve, reject) => {
            const req = db.transaction(IDB_STORE, 'readonly').objectStore(IDB_STORE).get('data');
            req.onsuccess = () => { db.close(); resolve(req.result || null); };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    } catch { return null; }
}

async function _idbPut(entry) {
    try {
        const db = await _openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(entry, 'data');
            tx.oncomplete = () => { db.close(); resolve(); };
            tx.onerror = () => { db.close(); reject(tx.error); };
        });
    } catch { /* quota : le cache HTTP fera le relais */ }
}

/**
 * Charge les points mondiaux : cache IndexedDB si frais (< 7 jours),
 * sinon téléchargement (contournement du cache HTTP) puis mise en cache.
 * En cas d'échec réseau, sert les données périmées si présentes.
 *
 * @param {{fetchImpl?:Function, now?:number}} [opts] Injection pour tests.
 * @returns {Promise<{vor:Array,ndb:Array,vrp:Array,generatedAt:string,
 *                    counts:Object, stale:boolean}|null>}
 */
export async function loadRadioPoints(opts = {}) {
    const doFetch = opts.fetchImpl ?? (typeof fetch === 'function' ? fetch : null);
    const now = opts.now ?? Date.now();

    const cached = await _idbGet();
    if (cached?.parsed && (now - cached.ts) < WEEK_MS) {
        return { ...cached.parsed, stale: false };
    }

    if (!doFetch) return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    try {
        const bust = (now - (cached?.ts ?? 0)) >= WEEK_MS ? `?t=${now}` : '';
        const res = await doFetch(RADIO_POINTS_URL + bust, { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = parseRadioPoints(await res.json());
        if (!parsed) throw new Error('format inattendu');
        await _idbPut({ parsed, ts: now });
        return { ...parsed, stale: false };
    } catch {
        // Hors ligne / serveur injoignable : données périmées en repli.
        return cached?.parsed ? { ...cached.parsed, stale: true } : null;
    }
}
