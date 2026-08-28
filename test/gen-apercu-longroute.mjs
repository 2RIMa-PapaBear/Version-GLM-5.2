// Aperçu PDF « plan long » — route réelle LFRV/LFER/LFTQ/LFOV/LFRW/LFOM/LFRC
// avec DONNÉES RÉELLES : relief Open-Meteo échantillonné le long de la route,
// espaces aériens de la base officielle SIA (data/sia-airspaces.json) via
// computeRouteAirspaces, METAR de départ aviationweather.gov.
// Usage : node test/gen-apercu-longroute.mjs
//   → Apercu_Log-nav_longroute.pdf + test/fixtures-navlog-longroute.json
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;
const { drawNavLogPdf } = await import(pathToFileURL(path.join(root, 'js', 'navlog-pdf.js')).href);
const { computeRouteAirspaces } = await import(pathToFileURL(path.join(root, 'js', 'airspace-profile.js')).href);

// ---- Route (coordonnées data/airports.json) ----
const AIRPORTS = require(path.join(root, 'data', 'airports.json'));
const aps = Array.isArray(AIRPORTS) ? AIRPORTS : (AIRPORTS.airports || Object.values(AIRPORTS));
const ROUTE = ['LFRV', 'LFER', 'LFTQ', 'LFOV', 'LFRW', 'LFOM', 'LFRC'];
const apt = (icao) => aps.find(p => p.icao === icao);
const COORD = Object.fromEntries(ROUTE.map(i => [i, apt(i)]));

const R_NM = 3440.065, D2R = Math.PI / 180;
const gcNm = (a, b) => {
    const [la1, lo1] = [a.lat * D2R, a.lon * D2R], [la2, lo2] = [b.lat * D2R, b.lon * D2R];
    return R_NM * Math.acos(Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(lo2 - lo1)));
};
const initialBearing = (a, b) => {
    const [la1, lo1] = [a.lat * D2R, a.lon * D2R], [la2, lo2] = [b.lat * D2R, b.lon * D2R];
    const y = Math.sin(lo2 - lo1) * Math.cos(la2);
    const x = Math.cos(la1) * Math.sin(la2) - Math.sin(la1) * Math.cos(la2) * Math.cos(lo2 - lo1);
    return (Math.atan2(y, x) / D2R + 360) % 360;
};

// ---- Échantillonnage le long de la route (points + reliefs réels) ----
const N_PER_LEG = 13;
const legPts = [];
const legDist = [];
for (let i = 0; i < ROUTE.length - 1; i++) {
    const A = COORD[ROUTE[i]], B = COORD[ROUTE[i + 1]];
    legDist.push(gcNm(A, B));
    for (let k = 0; k < N_PER_LEG; k++) {
        const f = k / N_PER_LEG;
        legPts.push({ leg: i, f, lat: A.lat + (B.lat - A.lat) * f, lon: A.lon + (B.lon - A.lon) * f });
    }
}
legPts.push({ leg: ROUTE.length - 2, f: 1, lat: COORD[ROUTE.at(-1)].lat, lon: COORD[ROUTE.at(-1)].lon });
const totalNm = legDist.reduce((s, d) => s + d, 0);

// Fractions globales : distance cumulée le long des tronçons / distance totale.
let acc = 0;
const pts2 = [];
for (let i = 0; i < ROUTE.length - 1; i++) {
    for (const p of legPts.filter(q => q.leg === i)) {
        pts2.push({
            frac: (acc + p.f * legDist[i]) / totalNm,
            lat: p.lat, lon: p.lon,
        });
    }
    acc += legDist[i];
}
pts2.push({ frac: 1, lat: COORD[ROUTE.at(-1)].lat, lon: COORD[ROUTE.at(-1)].lon });

// ---- Relief réel (Open-Meteo elevation, ≤100 points par requête) ----
async function fetchElevation(batch) {
    const url = 'https://api.open-meteo.com/v1/elevation?latitude='
        + batch.map(p => p.lat.toFixed(5)).join(',') + '&longitude=' + batch.map(p => p.lon.toFixed(5)).join(',');
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    if (!res.ok) throw new Error('elevation HTTP ' + res.status);
    const d = await res.json();
    return d.elevation;
}
const elevs = [];
for (let i = 0; i < pts2.length; i += 90) {
    elevs.push(...await fetchElevation(pts2.slice(i, i + 90)));
}
const FT_PER_M = 3.28084;
const profilePoints = pts2.map((p, i) => ({ frac: p.frac, lat: p.lat, lon: p.lon, elevFt: Math.round(elevs[i] * FT_PER_M) }));
const minFt = Math.min(...profilePoints.map(p => p.elevFt));
const maxFt = Math.max(...profilePoints.map(p => p.elevFt));
console.log(`Route ${ROUTE[0]}→${ROUTE.at(-1)} : ${Math.round(totalNm)} NM, relief ${minFt}-${maxFt} ft, ${profilePoints.length} points`);

// ---- Espaces aériens réels (base SIA + overrides de fréquences) ----
const SIA = require(path.join(root, 'data', 'sia-airspaces.json'));
const expand = (c) => {
    const g = c.g;
    let geometry = null;
    if (g) {
        if (g.t === 0) geometry = { type: 'Point', coordinates: g.c };
        else if (g.t === 1) geometry = { type: 'Polygon', coordinates: g.c };
        else if (g.t === 2) geometry = { type: 'MultiPolygon', coordinates: g.c };
        else if (g.t === 3) geometry = { type: 'LineString', coordinates: g.c };
    }
    const lim = (l) => (Array.isArray(l) ? { value: l[0], unit: l[1] } : null);
    return {
        _id: c.i, name: c.n, type: c.ty, icaoClass: c.ic,
        lowerLimit: lim(c.lo), upperLimit: lim(c.up),
        frequencies: c.f || [], radius: Array.isArray(c.r) ? { value: c.r[0] } : null,
        geometry,
    };
};
const CRUISE = 3500;
const groups = computeRouteAirspaces(profilePoints, SIA.items.map(expand), { cruiseAltFt: CRUISE });
try {
    const ov = require(path.join(root, 'data', 'freq-overrides.json'));
    for (const g of groups || []) {
        const fixed = ov?.services?.[String(g.name || '').trim().toUpperCase()];
        if (fixed) g.freq = fixed;
    }
} catch { }
console.log('Zones traversées :', (groups || []).map(g => `${g.name}${g.freq ? ' ' + g.freq : ''} [${g.ranges.map(r => r.map(v => Math.round(v * 100) + '%').join('->')).join(' ')}]`).join(' | ') || 'aucune');

// ---- Plan cohérent (TAS 110 kt, vent léger 250/12) ----
const TAS = 110, DECL = 1;   // déclinaison ≈ 1°E Bretagne/Normandie
const legs = [];
let remain = totalNm;
for (let i = 0; i < ROUTE.length - 1; i++) {
    const tc = initialBearing(COORD[ROUTE[i]], COORD[ROUTE[i + 1]]);
    const mh = (Math.round(tc) - DECL + 360) % 360;
    // vent 250/12 : composante de face/arrière approximative par tronçon
    const rel = (250 - tc) * D2R;
    const head = 12 * Math.cos(rel);
    const gs = Math.max(60, Math.round(TAS - head * 0.8));
    const ete = legDist[i] / gs * 60;
    legs.push({
        from: ROUTE[i], to: ROUTE[i + 1],
        dist: Math.round(legDist[i]), tc: Math.round(tc), mh,
        gs, ete,
    });
    remain -= legDist[i];
}
const totalMin = Math.round(legs.reduce((s, l) => s + l.ete, 0));
const fmtH = (min) => { const h = Math.floor(min / 60), m = Math.round(min % 60); return h > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${m} min`; };
const tripL = Math.round(totalMin / 60 * 30);
const fuel = { tripL, reserveL: Math.round((30 / 60) * 30 * 10) / 10, totalL: tripL + 15, reserveMin: 30 };

// METAR réel du départ
let metarRaw = '';
try {
    const res = await fetch('https://aviationweather.gov/api/data/metar?ids=LFRV&format=raw', { signal: AbortSignal.timeout(15000) });
    if (res.ok) metarRaw = (await res.text()).trim().split('\n')[0] || '';
} catch { }
console.log('METAR LFRV :', metarRaw || '(indisponible)');

// ---- Échantillon drawNavLogPdf (même forme que flight-planner-ui) ----
const wpFrac = ROUTE.slice(1, -1).map((icao) => {
    let frac = null, bestD = Infinity;
    for (const p of profilePoints) {
        const d = gcNm(p, COORD[icao]);
        if (d < bestD) { bestD = d; frac = p.frac; }
    }
    return { icao, name: icao, frac };
}).filter(w => w.frac != null);

const rows = legs.map((lg, i) => ({
    from: lg.from, to: lg.to,
    distRemain: Math.round(remain + legs.slice(i).reduce((s, l) => s + l.dist, 0) - legs.slice(0, i).reduce((s, l) => s + l.dist, 0)),
    dist: lg.dist,
    zSecu: Math.ceil((maxFt + 1000) / 500) * 500,
    zRet: CRUISE,
    rm: String((lg.tc - DECL + 360) % 360).padStart(3, '0'),
    cm: String(lg.mh).padStart(3, '0'),
    tsv: Math.round(lg.dist / TAS * 60),
    tav: Math.round(lg.ete),
}));
rows.forEach((r, i) => { r.distRemain = Math.round(legs.slice(i).reduce((s, l) => s + l.dist, 0)); });

const sample = {
    isFr: true,
    aircraftType: 'DR400-140', aircraftReg: 'F-XXXX',
    qnh: metarRaw.match(/\bQ(\d{4})/)?.[1] || '1013',
    windDir: 250, windKt: 12, runway: '36',
    distanceNm: Math.round(totalNm), timeLabel: fmtH(totalMin), metarRaw,
    rows,
    calc: {
        isFr: true,
        fromIcao: ROUTE[0], toIcao: ROUTE.at(-1),
        fromName: COORD[ROUTE[0]].name, toName: COORD[ROUTE.at(-1)].name,
        waypoints: ROUTE.slice(1, -1).join(' '),
        cruiseAltFt: CRUISE, tasKt: TAS, fuelBurnLph: 30, isNight: false,
        distanceNm: Math.round(totalNm), distanceKm: Math.round(totalNm * 1.852),
        trueCourse: legs[0].tc, magHeading: legs[0].mh, declination: DECL,
        wind: { dir: 250, speedKt: 12 },
        driftDeg: 4, groundSpeed: legs[0].gs, timeLabel: fmtH(totalMin), fuel,
        clearance: { maxFt, minClearanceFt: CRUISE - maxFt, level: 'ok' },
        isMultiLeg: true,
        legs: legs.map((lg, i) => ({
            from: lg.from, to: lg.to, dist: lg.dist, hdg: lg.mh,
            eteLabel: fmtH(lg.ete), fuelL: Math.round(lg.ete / 60 * 30),
            freq: i === 0 ? '120.200 TWR' : (i === legs.length - 1 ? '118.300 AFIS' : ''),
        })),
    },
    perf: {
        isFr: true, fromIcao: ROUTE[0], toIcao: ROUTE.at(-1), runway: '36',
        takeoff: {
            da: 860, groundRollM: 205, fiftyFtM: 405,
            runwayLengthM: 1250, marginM: 845, level: 'ok',
            message: 'Marge confortable', refLabel: '170/335',
            surfaceLabel: 'Dure', surfaceSoft: false, surfacePct: 0,
        },
        profile: {
            fromIcao: ROUTE[0], toIcao: ROUTE.at(-1),
            distTotalKm: Math.round(totalNm * 1.852),
            minFt, maxFt, cruiseAltFt: CRUISE,
            points: profilePoints.map(p => ({ frac: p.frac, elevFt: p.elevFt })),
            waypoints: wpFrac,
            routeAirspaces: groups,
        },
        alternates: {
            maxOffsetNm: 25,
            rows: [
                { code: 'LFRN', name: 'Rennes St Jacques', cat: 'VFR', visiStr: '>10 km', ceilStr: '—', windStr: '250° 12 kt', offsetNm: 22, side: 'E', metarFrom: '' },
                { code: 'LFRD', name: 'Dinan Trelivan', cat: 'VFR', visiStr: '>10 km', ceilStr: '4500 ft', windStr: '250° 11 kt', offsetNm: 18, side: 'N', metarFrom: '' },
                { code: 'LFRB', name: 'Brest Guipavas', cat: 'MVFR', visiStr: '8000 m', ceilStr: '2200 ft', windStr: '250° 16 kt', offsetNm: 48, side: 'O', metarFrom: '' },
                { code: 'LFOH', name: 'Le Havre Octeville', cat: 'VFR', visiStr: '>10 km', ceilStr: '5000 ft', windStr: '250° 13 kt', offsetNm: 55, side: 'E', metarFrom: '' },
            ],
        },
    },
};

fs.writeFileSync(path.join(root, 'test', 'fixtures-navlog-longroute.json'), JSON.stringify(sample, null, 1));
const doc = drawNavLogPdf(jsPDF, sample);
const out = path.join(root, 'Apercu_Log-nav_longroute.pdf');
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log('OK :', out, `(${doc.getNumberOfPages()} pages)`);
