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

export function toGpx(v) {
    const pts = v.pts.map(p => {
        let s = `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`;
        if (p.alt != null) s += `<ele>${p.alt.toFixed(1)}</ele>`;
        s += `<time>${new Date(p.t).toISOString()}</time>`;
        if (p.spd != null) s += `<speed>${p.spd.toFixed(1)}</speed>`;
        if (p.hdg != null) s += `<course>${p.hdg.toFixed(1)}</course>`;
        return s + `</trkpt>`;
    }).join('\n');
    // Mention de l'avion (type + immatriculation de l'AVION ACTIF au moment
    // de l'export — retour pilote 26/09). Enquête flysto.net (26/09, code de
    // leur appli décompilé) : leur importeur lit metadataName, trackName,
    // creator, tailNumber et model — l'immat est scannée dans le NOM de la
    // trace (convention ForeFlight « immat · date »), d'où le préfixe.
    const { avion, reg } = aircraftMention();
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const desc = avion ? `\n    <desc>${esc(avion)}</desc>` : '';
    const meta = avion ? `\n  <metadata><name>${esc(avion)}</name></metadata>` : '';
    const nom = reg ? `${reg} · ${volName(v)}` : volName(v);
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="meteo VFR - suivi GPS" xmlns="http://www.topografix.com/GPX/1/1">${meta}
  <trk>${desc}
    <name>${esc(nom)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}

export function toKml(v) {
    const coords = v.pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${p.alt != null ? p.alt.toFixed(1) : 0}`).join(' ');
    const { avion, reg } = aircraftMention();
    const escK = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const desc = avion ? `\n    <description>${escK(avion)}</description>` : '';
    const nom = reg ? `${reg} · ${volName(v)}` : volName(v);
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${escK(nom)}</name>${desc}
    <Placemark>
      <name>${escK(nom)}</name>
      <Style><LineStyle><color>ffef46d9</color><width>3</width></LineStyle></Style>
      <LineString>
        <tessellate>1</tessellate>
        <altitudeMode>absolute</altitudeMode>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>
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
