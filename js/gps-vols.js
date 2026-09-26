/* ================================================================
 * GPS-VOLS — Persistance des vols (IndexedDB) + exports GPX/KML
 * ================================================================
 * Extrait de js/gps.js (item ⑥ dettes techniques, 09/09) : la partie
 * DONNÉES du suivi GPS vit ici, pure et testable sous Node — l'UI et la
 * cartographie restent dans js/gps.js.
 *
 *  - Historique IndexedDB « mt-gps-test/vols » (50 derniers vols) ;
 *  - Exports GPX 1.1 (ele/time/speed/course) et KML (altitudes absolues) ;
 *  - download() : déclenche le téléchargement navigateur.
 *
 * volSave/volDel acceptent un callback onChange (rafraîchit le compteur
 * de l'UI appelante). Seule dépendance : la flotte (avion actif cité dans
 * les exports) — branche terminale sans cycle (wb-core est pur).
 * ================================================================ */

import { getActiveAircraft } from './aircraft-fleet.js';

const VDB_NAME = 'mt-gps-test', VDB_STORE = 'vols';
const VOLS_MAX = 50;             // historique conservé sur le portable

// ---- IndexedDB ----------------------------------------------------------------
let _dbp = null;
function idb() {
    if (!_dbp) {
        _dbp = new Promise((res, rej) => {
            const rq = indexedDB.open(VDB_NAME, 1);
            rq.onupgradeneeded = () => rq.result.createObjectStore(VDB_STORE, { keyPath: 'id' });
            rq.onsuccess = () => res(rq.result);
            rq.onerror = () => rej(rq.error);
        });
    }
    return _dbp;
}

/** Durée d'une session (horodatages des points) — pure, testée sous Node. */
export function volDurMs(v) {
    return (v.pts.length ? v.pts[v.pts.length - 1].t : v.id) - v.id;
}

/** Écrit/met à jour un vol ; purge au-delà de VOLS_MAX ; onChange = compteur UI. */
export async function volSave(vol, onChange) {
    try {
        const db = await idb();
        const st = db.transaction(VDB_STORE, 'readwrite').objectStore(VDB_STORE);
        st.put(vol);
        const all = await volAll();
        for (const old of all.slice(VOLS_MAX)) st.delete(old.id);
        onChange?.();
    } catch (e) { /* stockage indisponible : le vol reste exportable de la session */ }
}

export async function volAll() {
    try {
        const db = await idb();
        const all = await new Promise((res, rej) => {
            const rq = db.transaction(VDB_STORE).objectStore(VDB_STORE).getAll();
            rq.onsuccess = () => res(rq.result || []);
            rq.onerror = () => rej(rq.error);
        });
        return all.sort((a, b) => b.id - a.id);
    } catch (e) { return []; }
}

export async function volDel(id, onChange) {
    try {
        const db = await idb();
        db.transaction(VDB_STORE, 'readwrite').objectStore(VDB_STORE).delete(id);
        onChange?.();
    } catch (e) { /* rien */ }
}

// ---- Exports GPX / KML ---------------------------------------------------------

// Allègement à l'export (retour pilote 27/09) : le suivi démarre souvent
// bien avant le roulage et s'arrête une fois au parking — les phases
// immobiles empilent des points quasi superposés (GPS 1 Hz). On ne garde à
// l'export que les points en mouvement ; le PREMIER et le DERNIER points
// sont toujours conservés (postes de départ et d'arrivée). L'historique
// IndexedDB reste brut — un futur filtrage meilleur pourra être rejoué.
const EXPORT_SPEED_MS = 1.0;   // ≈ 2 kt : en dessous, l'avion est arrêté
const EXPORT_DIST_M = 20;      // garde-fou sans capteur vitesse : écart au dernier point gardé

function _distM(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(s));
}

export function exportPts(pts) {
    const out = [];
    let ref = null;
    for (const p of pts) {
        const moving = p.spd != null && p.spd >= EXPORT_SPEED_MS;
        const far = !ref || _distM(ref, [p.lat, p.lon]) >= EXPORT_DIST_M;
        if (moving || far) { out.push(p); ref = [p.lat, p.lon]; }
    }
    const last = pts[pts.length - 1];
    if (last && out[out.length - 1] !== last) out.push(last);
    return out;
}

/** Vario dérivé (m/s) : moyenne des pentes d'altitude sur une fenêtre ±2
 *  points — lissée pour un profil lisible dans les lecteurs de traces. */
function varioMs(pts) {
    return pts.map((_p, i) => {
        let sum = 0, n = 0;
        for (let j = Math.max(1, i - 2); j <= Math.min(pts.length - 1, i + 2); j++) {
            const a = pts[j - 1], b = pts[j];
            if (a.alt != null && b.alt != null && b.t > a.t) { sum += (b.alt - a.alt) / ((b.t - a.t) / 1000); n++; }
        }
        return n ? sum / n : null;
    });
}

/** Format 1 décimale sans « -0.0 » (zéro négatif issu du lissage). */
const f1 = (x) => (Math.abs(x) < 0.05 ? '0.0' : x.toFixed(1));

export function volName(v) {
    const d = new Date(v.id);
    const p = n => String(n).padStart(2, '0');
    return `vol-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** Type + immat de l'avion actif (« WT9-LSA · F-QA01 ») + immat seule. */
function aircraftMention() {
    const ac = getActiveAircraft();
    const parts = [];
    if (ac?.type) parts.push(ac.type);
    if (ac?.registration) parts.push(ac.registration);
    return { avion: parts.join(' · '), reg: ac?.registration || '' };
}

export function toGpx(v, routePts) {
    const vpts = exportPts(v.pts);
    const vs = varioMs(vpts);
    const pts = vpts.map((p, i) => {
        let s = `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`;
        if (p.alt != null) s += `<ele>${p.alt.toFixed(1)}</ele>`;
        s += `<time>${new Date(p.t).toISOString()}</time>`;
        if (p.spd != null) s += `<speed>${p.spd.toFixed(1)}</speed>`;
        if (p.hdg != null) s += `<course>${p.hdg.toFixed(1)}</course>`;
        // Extensions maison (ignorées par les lecteurs qui ne les connaissent
        // pas, spec GPX) : précision GPS en mètres + vario dérivé en m/s.
        const ext = [];
        if (p.acc != null) ext.push(`<mfr:accuracy>${p.acc.toFixed(0)}</mfr:accuracy>`);
        if (vs[i] != null) ext.push(`<mfr:vs>${f1(vs[i])}</mfr:vs>`);
        if (ext.length) s += `<extensions>${ext.join('')}</extensions>`;
        return s + `</trkpt>`;
    }).join('\n');
    // Mention de l'avion (type + immatriculation de l'AVION ACTIF au moment
    // de l'export — retour pilote 26/09) : immat en tête du nom de trace.
    // Route PRÉVUE en waypoints si un plan existe (comparaison prévu/volé).
    const { avion, reg } = aircraftMention();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const desc = avion ? `\n    <desc>${esc(avion)}</desc>` : '';
    const meta = avion ? `\n  <metadata><name>${esc(avion)}</name></metadata>` : '';
    const nom = reg ? `${reg} · ${volName(v)}` : volName(v);
    const wpts = (routePts && routePts.length >= 2)
        ? '\n' + routePts.map(p => `  <wpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><name>${esc(p.name)}</name></wpt>`).join('\n')
        : '';
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="meteo VFR - suivi GPS" xmlns="http://www.topografix.com/GPX/1/1" xmlns:mfr="https://prevol.app/gpx">${meta}${wpts}
  <trk>${desc}
    <name>${esc(nom)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function toKml(v, routePts, routeLabel) {
    // gx:Track (extension Google Earth, reprise par tous les lecteurs de
    // traces KML) : porte l'heure, l'altitude, la vitesse ET le vario dérivé
    // de chaque point. Route PRÉVUE en ligne bleue si un plan existe.
    const vpts = exportPts(v.pts);
    const vs = varioMs(vpts);
    const pairs = vpts.map(p =>
        `        <when>${new Date(p.t).toISOString()}</when>\n        <gx:coord>${p.lon.toFixed(6)} ${p.lat.toFixed(6)} ${p.alt != null ? p.alt.toFixed(1) : 0}</gx:coord>`).join('\n');
    const arrays = [];
    if (vpts.some(p => p.spd != null)) arrays.push({ n: 'speed', vals: vpts.map(p => p.spd != null ? p.spd.toFixed(1) : '') });
    if (vs.some(x => x != null)) arrays.push({ n: 'vs', vals: vs.map(x => x != null ? f1(x) : '') });
    const data = arrays.length ? `\n        <ExtendedData>
${arrays.map(a => `          <gx:SimpleArrayData name="${a.n}">
${a.vals.map(x => `            <gx:value>${x}</gx:value>`).join('\n')}
          </gx:SimpleArrayData>`).join('\n')}
        </ExtendedData>` : '';
    const route = (routePts && routePts.length >= 2)
        ? `\n    <Placemark>
      <name>${routePts[0].name}-${routePts[routePts.length - 1].name}${routeLabel ? ' ' + routeLabel : ''}</name>
      <Style><LineStyle><color>fff8bd38</color><width>3</width></LineStyle></Style>
      <LineString><coordinates>${routePts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},0`).join(' ')}</coordinates></LineString>
    </Placemark>`
        : '';
    const { avion, reg } = aircraftMention();
    const escK = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const desc = avion ? `\n    <description>${escK(avion)}</description>` : '';
    const nom = reg ? `${reg} · ${volName(v)}` : volName(v);
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2">
  <Document>
    <name>${escK(nom)}</name>${desc}
    <Placemark>
      <name>${escK(nom)}</name>
      <Style><LineStyle><color>ffef46d9</color><width>3</width></LineStyle></Style>
      <gx:Track>
        <altitudeMode>absolute</altitudeMode>${data}
${pairs}
      </gx:Track>
    </Placemark>${route}
  </Document>
</kml>
`;
}

/** Téléchargement navigateur du contenu (GPX/KML). */
export function download(name, content, mime) {
    const b = new Blob([content], { type: mime });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
}

// ---- Export CSV « G1000 » -------------------------------------------------------
// Format des journaux de traces Garmin G1000 (SD card) — le mieux digéré par
// les analyseurs de vols (flysto le liste en source native ; ForeFlight
// l'importe aussi). En-tête exact repris du convertisseur communautaire de
// référence (FlightawareToForeflight, validé par des importations réelles).
// Colonnes remplies depuis notre GPS : date/heure UTC, latitude, longitude,
// AltMSL (pieds), GndSpd (nœuds), VSpd (pieds/min, vario dérivé), TRK.
// Les colonnes moteur/instruments restent vides (pas de sondes à bord).
const G1000_HDR = 'Lcl Date, Lcl Time, UTCOfst, AtvWpt,     Latitude,    Longitude,    AltB, BaroA,  AltMSL,   OAT,    IAS, GndSpd,    VSpd,  Pitch,   Roll,  LatAc, NormAc,   HDG,   TRK, volt1,  FQtyL,  FQtyR, E1 FFlow, E1 FPres, E1 OilT, E1 OilP, E1 MAP, E1 RPM, E1 CHT1, E1 CHT2, E1 CHT3, E1 CHT4, E1 EGT1, E1 EGT2, E1 EGT3, E1 EGT4,  AltGPS, TAS, HSIS,    CRS,   NAV1,   NAV2,    COM1,    COM2,   HCDI,   VCDI, WndSpd, WndDr, WptDst, WptBrg, MagVar, AfcsOn, RollM, PitchM, RollC, PichC, VSpdG, GPSfix,  HAL,   VAL, HPLwas, HPLfd, VPLwas';

export function toG1000Csv(v) {
    const cols = G1000_HDR.split(',').map(s => s.trim());
    const idx = {}; cols.forEach((c, i) => idx[c] = i);
    const vpts = exportPts(v.pts);
    const vs = varioMs(vpts);
    const rows = [G1000_HDR];
    vpts.forEach((p, i) => {
        const r = new Array(cols.length).fill('');
        const iso = new Date(p.t).toISOString();
        r[idx['Lcl Date']] = iso.slice(0, 10);
        r[idx['Lcl Time']] = iso.slice(11, 19);
        r[idx['UTCOfst']] = '00:00';
        r[idx['Latitude']] = p.lat.toFixed(6);
        r[idx['Longitude']] = p.lon.toFixed(6);
        if (p.alt != null) r[idx['AltMSL']] = String(Math.round(p.alt * 3.28084));
        if (p.spd != null) r[idx['GndSpd']] = String(Math.round(p.spd * 1.94384));
        if (vs[i] != null) {
            const fpm = String(Math.round(vs[i] * 196.85));
            r[idx['VSpd']] = fpm;    // vario (baro côté G1000, ici dérivé GPS)
            r[idx['VSpdG']] = fpm;   // vario GPS — sa colonne sémantique
        }
        if (p.hdg != null) r[idx['TRK']] = String(Math.round(p.hdg));
        rows.push(r.join(', '));
    });
    return rows.join('\n') + '\n';
}
