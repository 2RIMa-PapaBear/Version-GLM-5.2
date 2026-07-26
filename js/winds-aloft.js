import { fetchOpenMeteo } from './core.js';

const ENDPOINT = 'https://api.open-meteo.com/v1/forecast';

const LEVELS_M = [80, 180, 1000, 1500, 2000, 3000];
const FT_PER_M = 3.28084;

const _cache = new Map();
const TTL_MS = 60 * 60 * 1000;

export async function fetchWindsAloft(lat, lon) {
    if (lat == null || lon == null) return null;

    const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
    const cached = _cache.get(key);
    if (cached && Date.now() - cached.ts < TTL_MS) return cached.winds;

    try {

        const speedVars = LEVELS_M.map(h => `windspeed_${h}m`);
        const dirVars = LEVELS_M.map(h => `winddirection_${h}m`);
        const vars = [...speedVars, ...dirVars].join(',');

        const url = `${ENDPOINT}?latitude=${lat}&longitude=${lon}` +
            `&current=${vars}&timezone=auto`;

        let data;
        try { data = await fetchOpenMeteo(url); } catch { return null; }
        if (!data) return null;

        const cur = data?.current;
        if (!cur) return null;

        const winds = LEVELS_M.map(h => {
            const speedKmh = cur[`windspeed_${h}m`];
            const dir = cur[`winddirection_${h}m`];
            if (typeof speedKmh !== 'number' || typeof dir !== 'number') return null;

            const speedKt = Math.round(speedKmh / 1.852);
            return { altFt: Math.round(h * FT_PER_M), speedKt, dir };
        }).filter(Boolean);

        if (winds.length === 0) return null;

        _cache.set(key, { winds, ts: Date.now() });
        return winds;
    } catch (e) {
        console.warn('Winds aloft fetch failed:', e.message);
        return null;
    }
}

export function getWindAtAltitude(winds, altFt) {
    if (!Array.isArray(winds) || winds.length === 0) return null;

    if (altFt <= winds[0].altFt) return { speedKt: winds[0].speedKt, dir: winds[0].dir };

    const last = winds[winds.length - 1];
    if (altFt >= last.altFt) return { speedKt: last.speedKt, dir: last.dir };

    for (let i = 0; i < winds.length - 1; i++) {
        const a = winds[i], b = winds[i + 1];
        if (altFt >= a.altFt && altFt <= b.altFt) {
            const t = (altFt - a.altFt) / (b.altFt - a.altFt);
            const speedKt = Math.round(a.speedKt + (b.speedKt - a.speedKt) * t);

            const dir = _interpAngle(a.dir, b.dir, t);
            return { speedKt, dir };
        }
    }
    return null;
}

function _interpAngle(a, b, t) {
    let diff = b - a;
    if (diff > 180) diff -= 360;
    else if (diff < -180) diff += 360;
    let r = a + diff * t;
    return Math.round(((r % 360) + 360) % 360);
}

export function _clearCache() { _cache.clear(); }
