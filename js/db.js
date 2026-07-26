export const AIRPORTS_DB_VERSION = '1.15.0';

const TZ_KEY = 'airport-tz';
const TZ_MAX = 200;

function tzLoad() {
    try {
        const raw = localStorage.getItem(TZ_KEY);
        return raw ? JSON.parse(raw) : {};
    } catch {
        return {};
    }
}

function tzStore(obj) {
    try {
        localStorage.setItem(TZ_KEY, JSON.stringify(obj));
    } catch {

    }
}

export function tzGet(icao) {
    if (!icao) return null;
    const all = tzLoad();
    const rec = all[icao.toUpperCase()];
    if (rec && typeof rec.tzOffset === 'number') return rec;
    return null;
}

export function tzPut(icao, info) {
    if (!icao || !info || typeof info.tzOffset !== 'number') return;
    const key = icao.toUpperCase();
    const all = tzLoad();

    delete all[key];
    all[key] = {
        name: info.name || key,
        lat: info.lat,
        lon: info.lon,
        tzOffset: info.tzOffset,
        ts: Date.now(),
    };

    const keys = Object.keys(all);
    if (keys.length > TZ_MAX) {
        for (let i = 0; i < keys.length - TZ_MAX; i++) delete all[keys[i]];
    }
    tzStore(all);
}

const DB_NAME = 'metar-taf-cache';
const DB_VERSION = 1;
const STORE = 'kv';
const RECORD_ID = 'airports';

const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function openDB() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') {
            reject(new Error('IndexedDB indisponible'));
            return;
        }
        let req;
        try {
            req = indexedDB.open(DB_NAME, DB_VERSION);
        } catch (e) {
            reject(e);
            return;
        }
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error || new Error('Échec ouverture IndexedDB'));
    });
}

export async function idbGetAirports() {
    try {
        const db = await openDB();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readonly');
            const req = tx.objectStore(STORE).get(RECORD_ID);
            req.onsuccess = () => {
                const rec = req.result;
                db.close();
                if (!rec || typeof rec !== 'object') return resolve(null);
                if (rec.version !== AIRPORTS_DB_VERSION) return resolve(null);
                if (typeof rec.ts === 'number' && Date.now() - rec.ts > MAX_AGE_MS) return resolve(null);
                resolve(Array.isArray(rec.data) ? rec.data : null);
            };
            req.onerror = () => { db.close(); reject(req.error); };
        });
    } catch {

        return null;
    }
}

export async function idbPutAirports(data) {
    try {
        const db = await openDB();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(STORE, 'readwrite');
            tx.objectStore(STORE).put(
                { version: AIRPORTS_DB_VERSION, data, ts: Date.now() },
                RECORD_ID,
            );
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error);
        });
        db.close();
    } catch {

    }
}
