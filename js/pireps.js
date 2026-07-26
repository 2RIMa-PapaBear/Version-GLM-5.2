import { fetchAvecRelais } from './core.js';

const _cache = new Map();
const TTL_MS = 10 * 60 * 1000;

export async function fetchPireps(lat, lon, radiusDeg = 3) {
    if (lat == null || lon == null) return [];

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.pireps;

    try {

        const url = `https://aviationweather.gov/api/data/aircraftrep?format=json&_t=${Date.now()}`;
        const data = await fetchAvecRelais(url, 'json');

        if (!Array.isArray(data)) return [];

        const relevant = [];
        for (const p of data) {
            const raw = p.rawOb || p.rawText || p.raw || '';
            if (!raw) continue;

            const pLat = typeof p.lat === 'number' ? p.lat : null;
            const pLon = typeof p.lon === 'number' ? p.lon : null;

            if (pLat != null && pLon != null) {
                if (Math.abs(pLat - lat) > radiusDeg || Math.abs(pLon - lon) > radiusDeg) continue;
            } else {

                continue;
            }

            const parsed = _parsePirep(raw);
            relevant.push({
                raw,
                type: parsed.type,
                intensity: parsed.intensity,
                altFt: parsed.altFt,
                lat: pLat,
                lon: pLon,
            });
        }

        _cache.set(key, { pireps: relevant, ts: Date.now() });
        return relevant;
    } catch (e) {
        console.warn('PIREPs fetch failed:', e.message);
        return [];
    }
}

function _parsePirep(raw) {
    const upper = raw.toUpperCase();

    let type = 'OTHER';
    if (/\bTB\b|TURB|TURBULENCE/.test(upper)) type = 'TURB';
    else if (/\bICE\b|ICING|\bFZRA\b|\bFZDZ\b/.test(upper)) type = 'ICE';
    else if (/\bTOP\b|\bBASE\b|\bCIG\b/.test(upper)) type = 'CLOUD';
    else if (/VIS|VISIBILITY/.test(upper)) type = 'VIS';
    else if (/WND|WIND/.test(upper)) type = 'WIND';

    let intensity = '';
    const intMatch = upper.match(/\b(LGT|MOD|SEV|EXT|EXTRM|LIGHT|MODERATE|SEVERE|EXTREME)\b/);
    if (intMatch) {
        intensity = intMatch[1];
    }

    let altFt = null;
    const flMatch = upper.match(/\bFL(\d{3})\b/);
    if (flMatch) {
        altFt = parseInt(flMatch[1], 10) * 100;
    } else {
        const altMatch = upper.match(/\b(?:TOP|BASE|ALT)?\s*(\d{4,5})\s*(?:FT|M)\b/);
        if (altMatch) altFt = parseInt(altMatch[1], 10);
    }

    return { type, intensity, altFt };
}

export function pirepDisplayMeta(type, intensity) {
    const sev = /^(SEV|EXT|EXTRM|SEVERE|EXTREME)$/.test(intensity);
    const mod = /^(MOD|MODERATE)$/.test(intensity);

    const META = {
        TURB: {
            icon: 'wind',
            color: sev ? '#EF4444' : (mod ? '#F59E0B' : '#FBBF24'),
            labelFr: sev ? 'Turbulence sévère' : (mod ? 'Turbulence modérée' : 'Turbulence légère'),
            labelEn: sev ? 'Severe turbulence' : (mod ? 'Moderate turbulence' : 'Light turbulence'),
        },
        ICE: {
            icon: 'snowflake',
            color: sev ? '#EF4444' : (mod ? '#F59E0B' : '#38BDF8'),
            labelFr: sev ? 'Givrage sévère' : (mod ? 'Givrage modéré' : 'Givrage léger'),
            labelEn: sev ? 'Severe icing' : (mod ? 'Moderate icing' : 'Light icing'),
        },
        CLOUD: {
            icon: 'cloud',
            color: '#94A3B8',
            labelFr: 'Base/sommet de nuages',
            labelEn: 'Cloud base/tops',
        },
        VIS: {
            icon: 'eye',
            color: '#F59E0B',
            labelFr: 'Visibilité en vol',
            labelEn: 'In-flight visibility',
        },
        WIND: {
            icon: 'wind',
            color: '#94A3B8',
            labelFr: 'Vent en vol',
            labelEn: 'In-flight wind',
        },
        OTHER: {
            icon: 'radio',
            color: '#94A3B8',
            labelFr: 'Rapport pilote',
            labelEn: 'Pilot report',
        },
    };
    return META[type] || META.OTHER;
}

export function _clearCache() { _cache.clear(); }
