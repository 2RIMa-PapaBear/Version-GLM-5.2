const CSV_URL = 'https://davidmegginson.github.io/ourairports-data/runways.csv';
const IDB_NAME = 'meteo-taf-cache';
const IDB_VERSION = 1;
const IDB_STORE = 'runways-geo';

let _thresholdsByIcao = null;
let _loadPromise = null;

function _idbOpen() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, IDB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;

            if (!db.objectStoreNames.contains(IDB_STORE)) db.createObjectStore(IDB_STORE);
            if (!db.objectStoreNames.contains('openaip')) db.createObjectStore('openaip');
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function _idbGet(key) {
    return _idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const req = tx.objectStore(IDB_STORE).get(key);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => reject(req.error);
    })).catch(() => null);
}

function _idbPut(key, value) {
    return _idbOpen().then(db => new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        tx.objectStore(IDB_STORE).put(value, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
    })).catch(() => {});
}

function _parseCsv(csv) {
    const lines = csv.split('\n');
    const result = new Map();

    const header = _parseCsvLine(lines[0]);
    const idxIdent = header.indexOf('airport_ident');
    const idxLeDesig = header.indexOf('le_ident');
    const idxLeLat = header.indexOf('le_latitude_deg');
    const idxLeLon = header.indexOf('le_longitude_deg');
    const idxHeDesig = header.indexOf('he_ident');
    const idxHeLat = header.indexOf('he_latitude_deg');
    const idxHeLon = header.indexOf('he_longitude_deg');

    if (idxIdent < 0) return result;

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (!line || !line.includes(',')) continue;
        const cols = _parseCsvLine(line);
        const ident = cols[idxIdent];
        if (!ident || ident.length !== 4) continue;

        const leDesig = cols[idxLeDesig];
        const leLat = parseFloat(cols[idxLeLat]);
        const leLon = parseFloat(cols[idxLeLon]);
        const heDesig = cols[idxHeDesig];
        const heLat = parseFloat(cols[idxHeLat]);
        const heLon = parseFloat(cols[idxHeLon]);

        if (!isFinite(leLat) && !isFinite(heLat)) continue;

        if (!result.has(ident)) result.set(ident, []);
        result.get(ident).push({
            desig: leDesig || '', lat: leLat, lon: leLon,
            desig2: heDesig || '', lat2: heLat, lon2: heLon,
        });
    }
    return result;
}

function _parseCsvLine(line) {
    const cols = [];
    let cur = '', inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
            else inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
            cols.push(cur); cur = '';
        } else {
            cur += ch;
        }
    }
    cols.push(cur);
    return cols;
}

export async function loadRunwaysCsv() {
    if (_thresholdsByIcao) return _thresholdsByIcao;
    if (_loadPromise) return _loadPromise;

    _loadPromise = (async () => {

        const CACHE_KEY = 'thresholds-v1';
        const cached = await _idbGet(CACHE_KEY);
        if (cached && typeof cached === 'string' && cached.length > 1000) {
            _thresholdsByIcao = _parseCsv(cached);
            return _thresholdsByIcao;
        }

        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 25000);
            const res = await fetch(CSV_URL, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!res.ok) throw new Error('HTTP ' + res.status);
            const csv = await res.text();
            if (!csv || csv.length < 1000) return null;
            _thresholdsByIcao = _parseCsv(csv);
            _idbPut(CACHE_KEY, csv);
            return _thresholdsByIcao;
        } catch (e) {
            console.warn('Runways CSV load failed:', e.message);
            return null;
        }
    })();

    return _loadPromise;
}

export async function getRunwayThresholds(icao) {
    if (!icao) return [];
    const map = await loadRunwaysCsv();
    if (!map) return [];
    return map.get(icao.toUpperCase()) || [];
}

export function runwaysGeoReady() {
    return _thresholdsByIcao !== null;
}
