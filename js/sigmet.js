import { state, I18N, fetchAvecRelais } from './core.js';

// C1 (14/09) : SIGMET France via AEROWEB (relais Worker /sigmet, compte du
// pilote). Prioritaire en France ; repli NOAA (US) ailleurs ou en échec.
const RELAY_SIGMET = 'https://meteo-relais.papabear56.workers.dev/sigmet';
const EN_FRANCE = (lat, lon) => lat >= 41 && lat <= 52 && lon >= -6 && lon <= 11;

/**
 * Parse le XML AEROWEB (affichemessages_sigmet.php) : messages SIGMET/
 * GAMET/AIRMET par FIR. PUR — testé sous Node (DOMParser en option).
 * @param {string} xml réponse AEROWEB
 * @param {{querySelectorAll:Function}} [doc] document pré-parsé (tests)
 * @returns {Array<{raw:string, type:string}>}
 */
export function parseAerowebSigmetXml(xml, doc) {
    const out = [];
    try {
        const d = doc
            || (typeof DOMParser !== 'undefined' ? new DOMParser().parseFromString(xml, 'text/xml') : null);
        if (!d) return out;
        d.querySelectorAll('message').forEach(m => {
            // <message id="LFRR" type="FIR"> peut contenir les bulletins ;
            // les vrais messages arrivent en <bulletin>/<message> internes
            // selon la version — on accepte les deux formes.
            const raw = (m.textContent || '').trim();
            if (!raw || /pas de sigmet/i.test(raw)) return;
            for (const bloc of raw.split(/(?=(?:LF\w{2}|LFPW)\s+SIGMET\b)/i)) {
                const t = bloc.trim();
                if (/SIGMET/i.test(t) && t.length > 30) out.push({ raw: t, type: 'SIGMET' });
            }
        });
    } catch {   }
    return out;
}

export async function fetchSigmetAirmet(lat, lon, radiusDeg = 5) {
    if (lat == null || lon == null) return [];

    // ---- Source FRANCE (AEROWEB via relais) : le flux NOAA ne couvre que
    // les US — en France le GO/NO-GO restait muet sur les SIGMET.
    if (EN_FRANCE(lat, lon)) {
        try {
            const xml = await fetchAvecRelais(RELAY_SIGMET + '?codes=LFFF%20LFEE%20LFRR%20LFBB%20LFMH', 'text', 240);
            const items = parseAerowebSigmetXml(String(xml || ''));
            if (items.length) {
                return items.map(item => {
                    const allCoords = _extractCoords(item.raw);
                    return {
                        raw: item.raw,
                        type: item.type,
                        hazard: _inferHazard(item.raw),
                        obs: /OBS|OBSERVED/i.test(item.raw),
                        coords: allCoords,
                        polygon: allCoords.length >= 3 ? _toLeafletRing(allCoords) : null,
                        center: allCoords.length ? _centroid(allCoords) : null,
                        source: 'AEROWEB',
                    };
                });
            }
            // Réponse valide mais vide (aucun SIGMET en France) : silencieux,
            // sans repli US (qui n'apporterait que du Kansas).
            if (/<\/root>/.test(String(xml || ''))) return [];
        } catch { /* relais indisponible → repli NOAA ci-dessous */ }
    }

    try {

        const url = `https://aviationweather.gov/api/data/sigmet?format=json`;
        const data = await fetchAvecRelais(url, 'json');

        if (!Array.isArray(data)) return [];

        const relevant = [];
        for (const item of data) {

            const raw = item.rawAirSigmet || item.rawText || item.raw || item.rawSigmet || '';
            if (!raw) continue;

            const coords = Array.isArray(item.coords) ? item.coords : [];
            const isNear = coords.length === 0 || coords.some(c =>
                typeof c.lat === 'number' && typeof c.lon === 'number' &&
                Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
            );

            const isNearFromText = coords.length === 0 && _isNearFromText(raw, lat, lon, radiusDeg);

            if (isNear || isNearFromText) {
                // Conserve la géométrie pour permettre le tracé sur la carte Leaflet.
                const allCoords = coords.length ? coords : _extractCoords(raw);
                relevant.push({
                    raw,
                    type: item.airSigmetType || (item.type === 'A' ? 'AIRMET' : 'SIGMET'),
                    hazard: item.hazard || _inferHazard(raw),
                    obs: /OBS|OBSERVED/i.test(raw),
                    coords: allCoords,
                    polygon: allCoords.length >= 3 ? _toLeafletRing(allCoords) : null,
                    center: allCoords.length ? _centroid(allCoords) : null,
                });
            }
        }

        return relevant;
    } catch (e) {
        console.warn('SIGMET/AIRMET fetch failed:', e);
        return [];
    }
}

function _isNearFromText(raw, lat, lon, radiusDeg) {
    const coords = _extractCoords(raw);
    return coords.some(c =>
        Math.abs(c.lat - lat) <= radiusDeg && Math.abs(c.lon - lon) <= radiusDeg
    );
}

// Extrait les paires lat/lon d'un texte SIGMET. Deux écritures coexistent :
// OACI Annexe 3 Appendice 6 — lettre cardinale PUIS les chiffres —
// « N4945 W00350 » (degrés+minutes) ou « N54 W020 » (degrés seuls) ; et
// des flux non-OACI qui inversent — « 4800N 00400W », parfois collé
// « 4800N00400W ». Le séparateur lat/lon est donc optionnel.
export function _extractCoords(raw) {
    const coords = [];
    const push = (latDigits, ns, lonDigits, ew) => {
        const lat = _dmsToDeg(latDigits, 2);
        const lon = _dmsToDeg(lonDigits, 3);
        if (lat == null || lon == null) return;
        coords.push({ lat: ns === 'S' ? -lat : lat, lon: ew === 'W' ? -lon : lon });
    };

    const reIcao = /\b([NS])(\d{2,4})\s*([EW])(\d{2,5})/g;
    const reInverse = /\b(\d{2,4})([NS])\s*(\d{2,5})([EW])/g;
    let m;
    while ((m = reIcao.exec(raw)) !== null) push(m[2], m[1], m[4], m[3]);
    while ((m = reInverse.exec(raw)) !== null) push(m[1], m[2], m[3], m[4]);
    return coords;
}

// « 4800 » avec 2 chiffres de degrés → 48,5 ; « 00430 » avec 3 → 4,5.
// OACI : lat Nnn/Nnnnn, lon Wnnn/Wnnnnn — les longueurs non standard
// retombent sur 2 chiffres de degrés (héritage flux non-OACI, ex. lon à
// 4 chiffres « 0733 » lue 7°33').
function _dmsToDeg(digits, degLen) {
    if (digits.length === degLen) return parseInt(digits, 10);
    if (digits.length === degLen + 2) {
        return parseInt(digits.slice(0, degLen), 10) + parseInt(digits.slice(degLen), 10) / 60;
    }
    const rest = digits.slice(2);
    return parseInt(digits.slice(0, 2), 10) + (rest ? parseInt(rest, 10) / 60 : 0);
}

// Convertit une liste de {lat,lon} en anneau Leaflet [[lat,lon],...].
function _toLeafletRing(coords) {
    return coords.map(c => [c.lat, c.lon]);
}

// Centre approché (moyenne arithmétique) — utilisé comme fallback quand le
// polygone n'est pas exploitable (moins de 3 points) pour positionner un marker.
function _centroid(coords) {
    if (!coords.length) return null;
    const sum = coords.reduce((acc, c) => ({ lat: acc.lat + c.lat, lon: acc.lon + c.lon }), { lat: 0, lon: 0 });
    return { lat: sum.lat / coords.length, lon: sum.lon / coords.length };
}

// Palette couleurs par hazard SIGMET/AIRMET (source unique — réutilisée par la carte).
export const HAZARD_COLORS = {
    TS: '#EF4444',   // orages — rouge
    ICE: '#3B82F6',  // givrage — bleu
    TURB: '#F97316', // turbulence — orange
    MTW: '#A855F7',  // onde de montagne — violet
    HAIL: '#EF4444', // grêle — rouge
    VA: '#6B7280',   // cendres volcaniques — gris
    IFR: '#94A3B8',  // conditions IFR — gris-bleu
    OTHER: '#FBBF24',// autre — ambre
};

function _inferHazard(raw) {
    const r = raw.toUpperCase();
    if (/\bTS\b|\bTHUNDERSTORM|CONVECTIVE/.test(r)) return 'TS';
    if (/\bICE\b|\bICING|\bFZRA/.test(r)) return 'ICE';
    if (/\bTURB|\bTURBULENCE/.test(r)) return 'TURB';
    if (/\bMTN|\bMOUNTAIN WAVE/.test(r)) return 'MTW';
    if (/\bHAIL|\bGR\b/.test(r)) return 'HAIL';
    if (/\bASH|\bVOLCANIC/.test(r)) return 'VA';
    if (/\bIFR|\bCIG|\bVIS/.test(r)) return 'IFR';
    return 'OTHER';
}

/* ---- M5 (audit 27/09) : filtre géographique du GO/NO-GO ------------------
 * Sans lui, TOUT SIGMET national frappait le verdict : un orage SIGMÉT sur
 * les Pyrénées mettait Lille en NO-GO — conservateur mais inutilisable les
 * jours d'orage. Un SIGMET n'alerte que s'il approche le terrain affiché ou
 * la route du plan (≤ SIGMET_ROUTE_NM d'un point, ou point DANS le
 * polygone). Sans position fournie ou sans géométrie extraite : RETENU
 * (conservateur). Pur — testé sous Node. */
export const SIGMET_ROUTE_NM = 40;

function _distNm(a, b) {
    const R = 3440.065, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const s = Math.sin(dLat / 2) ** 2
        + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

function _ptInPoly(pt, coords) {
    let inside = false;
    for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
        const yi = coords[i].lat, xi = coords[i].lon, yj = coords[j].lat, xj = coords[j].lon;
        if ((yi > pt.lat) !== (yj > pt.lat)
            && pt.lon < ((xj - xi) * (pt.lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}

/** Le SIGMET concerne-t-il la position/la route (≤ maxNm d'un point, ou
 *  point dans le polygone) ? true = alerte. Exporté pour les tests. */
export function _sigmetNear(s, pts, maxNm = SIGMET_ROUTE_NM) {
    if (!Array.isArray(pts) || !pts.length) return true;
    const coords = s?.coords;
    if (!Array.isArray(coords) || coords.length === 0) return true;   // sans géométrie → conservateur
    // Sommets + MILIEUX des arêtes : sur un grand polygone, une arête peut
    // s'approcher de la route alors que tous les sommets en sont loin.
    const probes = [...coords];
    for (let i = 0; i < coords.length; i++) {
        const a = coords[i], b = coords[(i + 1) % coords.length];
        probes.push({ lat: (a.lat + b.lat) / 2, lon: (a.lon + b.lon) / 2 });
    }
    for (const p of pts) {
        if (p?.lat == null || p?.lon == null) continue;
        if (_ptInPoly(p, coords)) return true;
        for (const c of probes) if (_distNm(p, c) <= maxNm) return true;
    }
    return false;
}

export function evaluateSigmetAirmet(sigmets, pts = null, maxNm = SIGMET_ROUTE_NM) {
    if (!sigmets || sigmets.length === 0) return [];
    const isFr = state.lang === 'fr';
    const results = [];

    const hazardLabels = {
        'TS': { fr: 'Orages (SIGMET)', en: 'Thunderstorms (SIGMET)', icon: 'cloud-lightning', level: 'danger' },
        'ICE': { fr: 'Givrage (SIGMET/AIRMET)', en: 'Icing (SIGMET/AIRMET)', icon: 'snowflake', level: 'danger' },
        'TURB': { fr: 'Turbulence (SIGMET/AIRMET)', en: 'Turbulence (SIGMET/AIRMET)', icon: 'wind', level: 'caution' },
        'MTW': { fr: 'Onde de montagne', en: 'Mountain wave', icon: 'mountain-snow', level: 'caution' },
        'HAIL': { fr: 'Grêle', en: 'Hail', icon: 'cloud-hail', level: 'danger' },
        'VA': { fr: 'Cendres volcaniques', en: 'Volcanic ash', icon: 'cloudy', level: 'danger' },
        'IFR': { fr: 'Conditions IFR (AIRMET)', en: 'IFR conditions (AIRMET)', icon: 'cloud-fog', level: 'caution' },
        'OTHER': { fr: 'Phénomène météo significatif', en: 'Significant weather', icon: 'alert-triangle', level: 'caution' },
    };

    const seenHazards = new Set();
    for (const s of sigmets) {
        // M5 : hors du couloir position/route → ce SIGMET ne concerne pas
        // ce vol (le même phénomène national peut être actif ailleurs).
        if (!_sigmetNear(s, pts, maxNm)) continue;
        if (seenHazards.has(s.hazard)) continue;
        seenHazards.add(s.hazard);

        const lbl = hazardLabels[s.hazard] || hazardLabels.OTHER;
        results.push({
            level: lbl.level,
            icon: lbl.icon,
            text: isFr ? lbl.fr : lbl.en,
        });
    }

    return results;
}
