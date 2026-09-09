// [VERSION TEST GPS] =========================================================
// SUIVI GPS « ma position » sur la carte régionale — v2 (retours pilote 07/09).
// Ce module n'est chargé QUE dans la copie version-test/ (construite par
// scripts/build-test-version.mjs) : JAMAIS dans la prod Free.fr ni à la
// racine du miroir Pages. La version réelle du site reste intacte.
//
// Arbitrages validés 06-07/09 :
//   - 1 clic = suivi continu ; déplacement carte = « Recentrer » ; re-clic = arrêt.
//   - Marqueur : avion Lucide blanc contour sombre, rotation (cap − 45°).
//   - Trace magenta #D946EF (effacée à chaque démarrage, conservée à l'arrêt).
//   - Wake Lock auto + voyant ambre ; HTTP = bouton grisé + infobulle.
//   v2 :
//   - ROTATION « Route haut » (bouton Nord/Route) : map.setBearing(−cap) via
//     le plugin vendor/leaflet-rotate.js (activé par `rotate: true` injecté
//     dans la COPIE de regional-map.js). L'avion vit dans le plan tournant :
//     il pointe automatiquement vers le HAUT de l'écran (la carte tourne,
//     pas l'icône). Angle = cap sol GPS, pris par le plus court chemin.
//   - ENREGISTREMENT AUTO de chaque session de suivi : points horodatés
//     (lat, lon, alt GPS, vitesse, cap). Chrono de vol déclenché à la
//     première vitesse > 35 kt (FT_START_MS). Vitesse/cap calculés entre
//     fixations quand le téléphone ne les fournit pas.
//   - HISTORIQUE IndexedDB (« mt-gps-test/vols », 50 derniers) + panneau
//     « Vols » : revoir les vols passés, exporter .GPX (1.1) ou .KML,
//     supprimer. Vitesse/altitude/temps de vol ne sont PAS affichés à
//     l'écran (souhait pilote) : ils vivent dans les exports.
// ============================================================================
import { state } from './core.js';

const ROT_OFFSET = -45;          // glyphe Lucide orienté NE → rotation = cap − 45°
const TRACE_MAX = 2000;          // au-delà : décimation ×2 (mémoire bornée)
const TRACE_COLOR = '#D946EF';   // magenta EFB, distinct de la route (#38BDF8)
const FT_START_MS = 18.0;        // ~35 kt : chrono de vol déclenché au-delà
const VOLS_MAX = 50;             // historique conservé sur le portable
// Durée minimale d'une session pour être conservée (réglage pilote 09/09) ;
// surchargeable avant le chargement via window.__gpsVolMinMs (QA).
const VOL_MIN_MS = (typeof window !== 'undefined' && Number(window.__gpsVolMinMs)) || 300000;
const volDurMs = (v) => (v.pts.length ? v.pts[v.pts.length - 1].t : v.id) - v.id;
const VDB_NAME = 'mt-gps-test', VDB_STORE = 'vols';
const ROT_KEY = 'mt-gps-rotation';

const isFr = () => state && state.lang === 'fr';
const T = () => isFr() ? {
    title: 'Suivi de ma position GPS',
    titleStop: 'Suivi actif — cliquer pour arrêter',
    titleHttp: 'Nécessite la version HTTPS (miroir Pages)',
    recenter: 'Recentrer',
    recTitleFollow: 'Recentrage auto actif — cliquer pour recentrer sur ma position',
    recTitlePaused: 'Recentrage en pause (carte déplacée) — cliquer pour recentrer et reprendre',
    voyant: 'écran maintenu allumé',
    voyantLock: 'Wake Lock actif — l\'écran restera allumé',
    voyantNoLock: 'Wake Lock indisponible sur ce navigateur',
    errDenied: 'Position indisponible : autorise la localisation de ce site dans ton navigateur (icône cadenas → Autorisations → Localisation).',
    errOther: 'Position GPS introuvable pour le moment — réessaie.',
    rotNord: 'Nord', rotRoute: 'Route',
    rotTitleNord: 'Orientation Nord en haut — cliquer pour Route en haut (la carte suit ton cap)',
    rotTitleRoute: 'Route en haut : la carte tourne avec ton cap — cliquer pour revenir Nord en haut',
    rotIndispo: 'Rotation non disponible',
    vols: 'Vols',
    volsTitle: 'Vols enregistrés sur ce portable (export GPX/KML)',
    volsAucun: 'Aucun vol enregistré. Chaque session de suivi GPS est enregistrée automatiquement.',
    volsFermer: 'Fermer',
    volSuppr: 'Supprimer ce vol',
    volTrace: 'Afficher ou masquer la trace de ce vol sur la carte',
    dureeVol: 'vol',
    dureeSuivi: 'suivi',
} : {
    title: 'Track my GPS position',
    titleStop: 'Tracking active — click to stop',
    titleHttp: 'Requires the HTTPS version (Pages mirror)',
    recenter: 'Recenter',
    recTitleFollow: 'Auto-centering on — click to center on my position',
    recTitlePaused: 'Centering paused (map moved) — click to center and resume',
    voyant: 'screen kept awake',
    voyantLock: 'Wake Lock active — screen will stay on',
    voyantNoLock: 'Wake Lock unavailable on this browser',
    errDenied: 'Position unavailable: allow location for this site in your browser (padlock icon → Permissions → Location).',
    errOther: 'GPS position not found right now — try again.',
    rotNord: 'North', rotRoute: 'Track',
    rotTitleNord: 'North-up — click for Track-up (map follows your heading)',
    rotTitleRoute: 'Track-up: the map rotates with your heading — click to go back to North-up',
    rotIndispo: 'Rotation unavailable',
    vols: 'Flights',
    volsTitle: 'Flights recorded on this device (GPX/KML export)',
    volsAucun: 'No recorded flight yet. Each GPS tracking session is recorded automatically.',
    volsFermer: 'Close',
    volSuppr: 'Delete this flight',
    volTrace: 'Show or hide this flight\'s track on the map',
    dureeVol: 'flight',
    dureeSuivi: 'tracking',
};

function planeSvg(hdg) {
    return `<svg class="gps-plane-icon" xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24"
        fill="#FFFFFF" stroke="#1E293B" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
        style="transform: rotate(${hdg + ROT_OFFSET}deg)">
        <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
    </svg>`;
}

// ---- Style propre au module (aucune modification de css/style.css) ---------
const CSS = `
.gps-voyant {
    display: none; align-items: center; gap: 4px; font-size: 11px; color: #CBD5E1;
    background: rgba(2, 6, 23, .7); border: 1px solid #334155; border-radius: 6px;
    padding: 3px 7px; margin-left: 4px; white-space: nowrap;
}
.gps-voyant.on { display: inline-flex; }
.gps-voyant::before { content: ''; width: 7px; height: 7px; border-radius: 50%; background: #FBBF24; box-shadow: 0 0 6px #FBBF24; }
.gps-error {
    display: none; position: fixed; top: 150px; left: 10px; z-index: 4000; max-width: 380px;
    background: #450A0A; border: 1px solid #F87171; color: #FECACA; border-radius: 8px;
    font-size: 12px; padding: 8px 10px;
}
.gps-error.on { display: block; }
.precip-toggle.gps-disabled { opacity: .45; cursor: not-allowed; }
.gps-plane-icon { filter: drop-shadow(0 1px 2px rgba(0, 0, 0, .8)); }
.gps-vols-panel {
    display: none; position: fixed; top: 60px; left: 10px; z-index: 4000; width: min(420px, calc(100vw - 20px));
    max-height: 65vh; overflow: auto; background: rgba(2, 6, 23, .96); border: 1px solid #334155;
    border-radius: 10px; color: #E2E8F0; font-size: 12px; box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
}
.gps-vols-panel.on { display: block; }
.gps-vols-head { display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 9px 11px; border-bottom: 1px solid #334155; font-weight: 600; }
.gps-vols-close { background: none; border: none; color: #94A3B8; cursor: pointer; padding: 2px; display: flex; }
.gps-vols-list { padding: 6px 11px 10px; }
.gps-vol-row { display: flex; align-items: center; gap: 8px; padding: 6px 0; border-bottom: 1px solid #1E293B; }
.gps-vol-row:last-child { border-bottom: none; }
.gps-vol-date { flex: 1; min-width: 0; }
.gps-vol-date b { color: #F1F5F9; }
.gps-vol-meta { color: #94A3B8; font-size: 11px; }
.gps-vol-btn { background: #1E293B; color: #E2E8F0; border: 1px solid #334155; border-radius: 6px;
    font-size: 11px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.gps-vol-btn:hover { background: #334155; }
.gps-vol-btn.active { background: #4C1D95; border-color: #A78BFA; color: #EDE9FE; }
.gps-vols-count { color: #FBBF24; font-weight: 600; margin-left: 2px; }
.gps-vols-count:empty { display: none; }
/* ---- Barre d'origine : une seule ligne (défilement horizontal), sans les boutons GPS ---- */
.map-layers-bar { flex-wrap: nowrap !important; overflow-x: auto; scrollbar-width: none; }
.map-layers-bar::-webkit-scrollbar { display: none; }
.map-layers-bar .precip-control-group { flex: 0 0 auto; }
/* ---- Paquet d'icônes GPS flottant SUR la carte (demande pilote 08/09) ---- */
.gps-map-cluster {
    position: absolute; top: 10px; right: 10px; z-index: 1000;
    display: flex; flex-direction: column; gap: 6px;
}
.gps-map-btn {
    width: 38px; height: 38px; display: flex; align-items: center; justify-content: center;
    background: rgba(2, 6, 23, .88); color: #E2E8F0; border: 1px solid #334155; border-radius: 10px;
    cursor: pointer; position: relative; padding: 0;
}
.gps-map-btn:hover { background: #1E293B; }
.gps-map-btn.active { background: #1D4ED8; border-color: #60A5FA; color: #FFFFFF; }
.gps-map-btn.gps-disabled { opacity: .45; cursor: not-allowed; }
.gps-map-count {
    position: absolute; bottom: -4px; right: -4px; background: #FBBF24; color: #020617;
    font-size: 10px; font-weight: 700; border-radius: 8px; padding: 0 4px; line-height: 14px;
}
.gps-map-count:empty { display: none; }
.gps-cluster-sep { height: 1px; background: #334155; margin: 4px 3px; }
.gps-vols-count { color: #FBBF24; font-weight: 600; margin-left: 2px; }
.gps-vols-count:empty { display: none; }
.gps-led { position: relative; }
.gps-led.on::after {
    content: ''; position: absolute; top: 4px; right: 5px; width: 7px; height: 7px;
    border-radius: 50%; background: #FBBF24; box-shadow: 0 0 6px #FBBF24;
}
.gps-vol-del { background: none; border: none; color: #94A3B8; cursor: pointer; padding: 3px; display: flex; }
.gps-vol-del:hover { color: #F87171; }
.gps-vols-empty { color: #94A3B8; padding: 10px 0; }
`;

// ---- État du contrôleur -----------------------------------------------------
let btn = null, recBtn = null, errBox = null, errTimer = null;
let rotBtn = null, volsBtn = null, volsCount = null, volsPanel = null;
let mode = 'off';                 // off | follow | recenter
let watchId = null, wakeLock = null;
let marker = null, circle = null, traceLine = null, trace = [];
let lastFix = null, lastFixT = 0, lastHdg = 0, haveHdg = false;
let lastAcc = 8;
let activeMap = null;
let rotationOn = false;
let curBearing = 0;               // bearing réellement appliqué à la carte
let curVol = null;                // { id, startedAt, endedAt, flightStartT, pts[] }
let panelOpen = false;
let gpsSaveTimer = null;          // autosave périodique du vol en cours
let replayLine = null, replayVolId = null;   // trace d'un vol sauvegardé rejouée à l'écran

function rotationWanted() { try { return localStorage.getItem(ROT_KEY) === '1'; } catch (e) { return false; } }
function rotationStore(v) { try { localStorage.setItem(ROT_KEY, v ? '1' : '0'); } catch (e) { /* indisponible */ } }

function bearing(a, b) {
    const toRad = d => d * Math.PI / 180;
    const φ1 = toRad(a[0]), φ2 = toRad(b[0]), Δλ = toRad(b[1] - a[1]);
    const y = Math.sin(Δλ) * Math.cos(φ2);
    const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
}

function distM(a, b) {
    // Approximation équirectangulaire : largement suffisante entre 2 fixations rapprochées.
    const toRad = d => d * Math.PI / 180;
    const x = toRad(b[1] - a[1]) * Math.cos(toRad((a[0] + b[0]) / 2));
    const z = toRad(b[0] - a[0]);
    return Math.hypot(x, z) * 6371000;
}

function drawPlane(ll, hdg, accM) {
    if (!activeMap) return;
    // IMPORTANT : leaflet-rotate place les marqueurs dans un panneau QUI NE
    // TOURNE PAS (_norotatePane). L'icône doit donc afficher le cap RELATIF
    // À LA CARTE = cap + bearing appliqué : « vers le haut » en mode Route
    // (bearing ≈ −cap), cap réel sur une carte Nord haut (bearing 0).
    const rel = hdg + curBearing;
    const icon = L.divIcon({ html: planeSvg(rel), className: '', iconSize: [30, 30], iconAnchor: [15, 15] });
    if (!marker) {
        marker = L.marker(ll, { icon, zIndexOffset: 1000, interactive: false }).addTo(activeMap);
        circle = L.circle(ll, {
            radius: accM, color: '#FFFFFF', weight: 1, opacity: .9,
            fillColor: '#FFFFFF', fillOpacity: .15, interactive: false,
            className: 'gps-acc-circle',
        }).addTo(activeMap);
    } else {
        marker.setIcon(icon).setLatLng(ll);
        circle.setLatLng(ll).setRadius(accM);
    }
}

function clearMarker() {
    if (marker && activeMap) activeMap.removeLayer(marker);
    if (circle && activeMap) activeMap.removeLayer(circle);
    marker = null; circle = null;
}

function resetTrace() {
    trace = [];
    if (traceLine && activeMap) activeMap.removeLayer(traceLine);
    traceLine = null;
}

function appendTrace(ll) {
    trace.push(ll);
    if (trace.length > TRACE_MAX) trace = trace.filter((_, i) => i % 2 === 0);
    if (!traceLine) {
        traceLine = L.polyline(trace, { color: TRACE_COLOR, weight: 3, opacity: .85, interactive: false, className: 'gps-trace-path' }).addTo(activeMap);
    } else {
        traceLine.setLatLngs(trace);
    }
}

// ---- IndexedDB (historique des vols) ----------------------------------------
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
async function volSave(vol) {
    try {
        const db = await idb();
        const st = db.transaction(VDB_STORE, 'readwrite').objectStore(VDB_STORE);
        st.put(vol);
        const all = await volAll();
        for (const old of all.slice(VOLS_MAX)) st.delete(old.id);
        updateVolsCount();
    } catch (e) { /* stockage indisponible : le vol reste exportable de la session */ }
}
async function volAll() {
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
async function volDel(id) {
    try {
        const db = await idb();
        db.transaction(VDB_STORE, 'readwrite').objectStore(VDB_STORE).delete(id);
        updateVolsCount();
    } catch (e) { /* rien */ }
}
async function updateVolsCount() {
    if (!volsCount) return;
    const all = await volAll();
    volsCount.textContent = all.length ? String(all.length) : '';
}

// ---- Exports GPX / KML ------------------------------------------------------
function volName(v) {
    const d = new Date(v.id);
    const p = n => String(n).padStart(2, '0');
    return `vol-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}
function toGpx(v) {
    const pts = v.pts.map(p => {
        let s = `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}">`;
        if (p.alt != null) s += `<ele>${p.alt.toFixed(1)}</ele>`;
        s += `<time>${new Date(p.t).toISOString()}</time>`;
        if (p.spd != null) s += `<speed>${p.spd.toFixed(1)}</speed>`;
        if (p.hdg != null) s += `<course>${p.hdg.toFixed(1)}</course>`;
        return s + `</trkpt>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="meteo VFR - version test GPS" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${volName(v)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
function toKml(v) {
    const coords = v.pts.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)},${p.alt != null ? p.alt.toFixed(1) : 0}`).join(' ');
    return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${volName(v)}</name>
    <Placemark>
      <name>${volName(v)}</name>
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
function download(name, content, mime) {
    const b = new Blob([content], { type: mime });
    const u = URL.createObjectURL(b);
    const a = document.createElement('a');
    a.href = u; a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(u), 2000);
}

// ---- Rotation « Route haut » --------------------------------------------------
function updateBearing() {
    if (!rotationOn || !activeMap || !activeMap.setBearing || !haveHdg) return;
    const target = -lastHdg;                       // cap sol vers le HAUT de l'écran
    const cur = activeMap.getBearing ? (activeMap.getBearing() || 0) : 0;
    const delta = ((target - cur + 540) % 360) - 180;   // plus court chemin
    activeMap.setBearing(cur + delta);
    curBearing = activeMap.getBearing ? (activeMap.getBearing() || 0) : (cur + delta);
    // L'avion vit dans le panneau non tournant : son cap relatif change avec
    // le bearing → redessine l'icône immédiatement (pas d'attente du fix suivant).
    if (lastFix && marker) drawPlane(lastFix, lastHdg, lastAcc);
}
function setRotation(on) {
    rotationOn = on;
    rotationStore(on);
    if (!on && activeMap && activeMap.setBearing) { activeMap.setBearing(0); curBearing = 0; }
    if (lastFix && marker) drawPlane(lastFix, lastHdg, lastAcc);   // que si le suivi est ACTIF
    renderRot();
}
function renderRot() {
    if (!rotBtn) return;
    const t = T();
    rotBtn.classList.toggle('active', rotationOn);
    rotBtn.innerHTML = '<i data-lucide="compass" style="width:18px;height:18px;"></i>';
    rotBtn.title = rotationOn ? t.rotTitleRoute : t.rotTitleNord;
    if (window.lucide) window.lucide.createIcons({ root: rotBtn });
}

// ---- Rejouer la trace d'un vol sauvegardé -----------------------------------
// Indépendant du suivi : la carte (singleton) est utilisée directement, pour
// pouvoir rejouer un vol AU DÉMARRAGE de l'app sans avoir lancé le GPS
// (bug constaté par le pilote : « Trace » sans session GPS = rien).
function replayMap() { return window.__regionalMap || activeMap; }
function resetReplay() {
    const map = replayMap();
    if (replayLine && map) map.removeLayer(replayLine);
    replayLine = null; replayVolId = null;
}
function toggleReplay(v) {
    const map = replayMap();
    if (!map) return;
    if (replayVolId === v.id) { resetReplay(); return; }
    resetReplay();
    replayLine = L.polyline(v.pts.map(p => [p.lat, p.lon]), {
        color: TRACE_COLOR, weight: 3, opacity: .7, dashArray: '6 6',
        interactive: false, className: 'gps-replay-path',
    }).addTo(map);
    replayVolId = v.id;
    map.fitBounds(replayLine.getBounds(), { padding: [40, 40] });
}

// ---- Wake Lock --------------------------------------------------------------
async function requestWakeLock() {
    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { /* libéré (onglet masqué…) */ });
    } catch (e) { /* refusé ou indisponible : le voyant reste informatif */ }
    updateVoyant();
}
function releaseWakeLock() {
    try { wakeLock && wakeLock.release(); } catch (e) { /* déjà libéré */ }
    wakeLock = null;
    updateVoyant();
}
function updateVoyant() {
    // Le voyant « écran maintenu allumé » est désormais une LED ambre posée
    // sur le bouton GPS (gain de place — retour pilote « barre en bazar »).
    if (!btn) return;
    const t = T();
    btn.classList.toggle('on', mode !== 'off');
    if (mode !== 'off') btn.title = t.titleStop + ' — ' + (wakeLock ? t.voyantLock : t.voyantNoLock);
}
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && mode !== 'off') requestWakeLock();
    if (document.visibilityState === 'hidden' && curVol) volSave(curVol);   // arrière-plan/fermeture
});
// Fermeture de la page (swipe de fermeture, changement de page…) : dernier état sauvegardé
window.addEventListener('pagehide', () => { if (curVol) volSave(curVol); });

// ---- Suivi + enregistrement --------------------------------------------------
function onFix(pos) {
    const c = pos.coords;
    const ll = [c.latitude, c.longitude];
    const t = pos.timestamp || Date.now();
    // Cap : capteur boussole s'il existe, sinon cap sol calculé entre deux fixations.
    if (Number.isFinite(c.heading)) { lastHdg = c.heading; haveHdg = true; }
    else if (lastFix && lastFixT && t > lastFixT) { lastHdg = bearing(lastFix, ll); haveHdg = true; }
    // Vitesse : capteur s'il existe, sinon dérivée entre deux fixations.
    let spd = Number.isFinite(c.speed) ? c.speed
        : (lastFix && lastFixT && t > lastFixT ? distM(lastFix, ll) / ((t - lastFixT) / 1000) : null);
    lastFix = ll; lastFixT = t;
    lastAcc = Math.max(Number.isFinite(c.accuracy) ? c.accuracy : 0, 8);
    // Enregistrement automatique du vol
    if (curVol) {
        curVol.pts.push({
            t, lat: c.latitude, lon: c.longitude,
            alt: Number.isFinite(c.altitude) ? c.altitude : null,
            spd: Number.isFinite(spd) ? spd : null,
            hdg: haveHdg ? Math.round(lastHdg * 10) / 10 : null,
        });
        // Chrono de vol : première vitesse > ~35 kt (roulage terminé)
        if (!curVol.flightStartT && Number.isFinite(spd) && spd >= FT_START_MS) curVol.flightStartT = t;
    }
    drawPlane(ll, lastHdg, lastAcc);
    appendTrace(ll);
    if (mode === 'follow' && activeMap) activeMap.panTo(ll, { animate: true, duration: .25 });
    updateBearing();
}

function onErr(err) {
    const t = T();
    showErr(err && err.code === 1 ? t.errDenied : t.errOther);
    if (err && err.code === 1) stop();   // permission refusée : inutile d'insister
}

function showErr(msg) {
    if (!errBox) return;
    errBox.textContent = msg;
    errBox.classList.add('on');
    clearTimeout(errTimer);
    errTimer = setTimeout(() => errBox.classList.remove('on'), 8000);
}

function start() {
    const map = window.__regionalMap;
    if (!map || !navigator.geolocation) return;
    activeMap = map;
    resetTrace();
    resetReplay();          // une nouvelle session repart d'une carte propre
    clearMarker();
    lastFix = null; lastFixT = 0; haveHdg = false; lastHdg = 0;
    // Enregistrement automatique de la session — écrit EN BASE dès le départ,
    // puis autosave toutes les 3 MIN (réglage pilote) + sauvegarde immédiate
    // à l'arrière-plan et à la fermeture de la page.
    try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) { /* refusé */ }
    curVol = { id: Date.now(), startedAt: new Date().toISOString(), endedAt: null, flightStartT: null, pts: [] };
    volSave(curVol);
    gpsSaveTimer = setInterval(() => { if (curVol) volSave(curVol); }, 180000);   // 3 min (réglage pilote)
    mode = 'follow';
    render();
    requestWakeLock();
    watchId = navigator.geolocation.watchPosition(onFix, onErr,
        { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 });
    map.on('dragstart', onUserDrag);
    updateBearing();
    renderRec();
}

function stop() {
    if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
    if (gpsSaveTimer) { clearInterval(gpsSaveTimer); gpsSaveTimer = null; }
    if (activeMap) activeMap.off('dragstart', onUserDrag);
    releaseWakeLock();
    clearMarker();          // la trace reste affichée après l'arrêt
    // Clôture du vol : conservé seulement si ≥ 2 points ET ≥ durée minimale
    // (les autosaves incrémentaux l'ont déjà écrit : on le RETIRE sinon).
    if (curVol) {
        curVol.endedAt = new Date().toISOString();
        // Durée en horloge murale (id = départ de session) : les timestamps
        // des fixations peuvent être identiques (cache géoloc, injecteurs).
        if (curVol.pts.length >= 2 && (Date.now() - curVol.id) >= VOL_MIN_MS) volSave(curVol);
        else volDel(curVol.id);   // vol trop court : pas enregistré
        curVol = null;
    }
    mode = 'off';
    render();
    renderRec();
}

function onUserDrag() {
    if (mode === 'follow') { mode = 'recenter'; renderRec(); }
}

// ---- Panneau « Vols » ---------------------------------------------------------
function fmtDur(ms) {
    if (!Number.isFinite(ms) || ms <= 0) return '—';
    const m = Math.floor(ms / 60000), h = Math.floor(m / 60);
    return h ? `${h}h${String(m % 60).padStart(2, '0')}` : `${m} min`;
}
async function openPanel() {
    const t = T();
    panelOpen = true;
    volsPanel.classList.add('on');
    const all = await volAll();
    const rows = all.length ? all.map(v => {
        const d = new Date(v.id);
        const p = n => String(n).padStart(2, '0');
        const date = `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
        const lastT = v.pts.length ? v.pts[v.pts.length - 1].t : v.id;
        const duree = v.flightStartT
            ? `${T().dureeVol} ${fmtDur(lastT - v.flightStartT)}`
            : `${T().dureeSuivi} ${fmtDur(lastT - v.id)}`;
        return `<div class="gps-vol-row" data-id="${v.id}">
            <div class="gps-vol-date"><b>${date}</b><div class="gps-vol-meta">${duree} · ${v.pts.length} pts</div></div>
            <button class="gps-vol-btn${replayVolId === v.id ? ' active' : ''}" data-x="see" title="${t.volTrace}">Trace</button>
            <button class="gps-vol-btn" data-x="gpx">GPX</button>
            <button class="gps-vol-btn" data-x="kml">KML</button>
            <button class="gps-vol-del" data-x="del" title="${t.volSuppr}"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
        </div>`;
    }).join('') : `<div class="gps-vols-empty">${t.volsAucun}</div>`;
    volsPanel.innerHTML = `<div class="gps-vols-head"><span>${t.volsTitle}</span>
        <button class="gps-vols-close" title="${t.volsFermer}"><i data-lucide="x" style="width:15px;height:15px;"></i></button></div>
        <div class="gps-vols-list">${rows}</div>`;
    if (window.lucide) window.lucide.createIcons({ root: volsPanel });
    volsPanel.querySelector('.gps-vols-close').addEventListener('click', closePanel);
    volsPanel.querySelectorAll('.gps-vol-row').forEach(row => {
        const v = all.find(x => String(x.id) === row.dataset.id);
        if (!v) return;
        row.querySelector('[data-x="see"]').addEventListener('click', () => { toggleReplay(v); openPanel(); });
        row.querySelector('[data-x="gpx"]').addEventListener('click', () => download(volName(v) + '.gpx', toGpx(v), 'application/gpx+xml'));
        row.querySelector('[data-x="kml"]').addEventListener('click', () => download(volName(v) + '.kml', toKml(v), 'application/vnd.google-earth.kml+xml'));
        row.querySelector('[data-x="del"]').addEventListener('click', async () => {
            if (replayVolId === v.id) resetReplay();
            await volDel(v.id); openPanel();
        });
    });
}
function closePanel() { panelOpen = false; volsPanel.classList.remove('on'); }

// ---- Bouton ------------------------------------------------------------------
function render() {
    if (!btn) return;
    const t = T();
    // Le bouton GPS reste « GPS » dans tous les modes : c'est l'interrupteur
    // marche/arrêt. Le recentrage a son PROPRE bouton (renderRec).
    btn.innerHTML = '<i data-lucide="navigation" style="width:18px;height:18px;"></i>';
    btn.classList.toggle('active', mode !== 'off');
    btn.title = mode === 'off' ? t.title : t.titleStop;
    if (window.lucide) window.lucide.createIcons({ root: btn });
    updateVoyant();
}

// Bouton « Recentrer » dédié : visible dès que le suivi est actif, surligné
// quand le recentrage auto est actif (il repasse en grisé quand le pilote
// déplace la carte — le recentrage est alors en pause).
function renderRec() {
    if (!recBtn) return;
    const t = T();
    const tracking = mode !== 'off';
    recBtn.style.display = tracking ? '' : 'none';
    recBtn.classList.toggle('active', mode === 'follow');
    recBtn.title = mode === 'follow' ? t.recTitleFollow : (mode === 'recenter' ? t.recTitlePaused : '');
}

function mount() {
    if (window.__gpsController) return;
    const bar = document.getElementById('map-layers-bar');
    if (!bar) return;
    window.__gpsController = api;

    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    errBox = document.createElement('div');
    errBox.className = 'gps-error';
    document.body.appendChild(errBox);

    volsPanel = document.createElement('div');
    volsPanel.className = 'gps-vols-panel';
    document.body.appendChild(volsPanel);

    const t = T();

    // Paquet d'icônes GPS flottant SUR la carte (boutons ronds icône-seule,
    // indépendants de la barre — demande pilote 08/09 « poser des icônes sur
    // la carte »). Hôte = conteneur Leaflet : visible en plein cadre aussi.
    const cluster = document.createElement('div');
    cluster.className = 'gps-map-cluster';
    cluster.innerHTML = `
        <button class="gps-map-btn gps-led" id="gps-toggle-btn" title="${t.title}">
            <i data-lucide="navigation" style="width:18px;height:18px;"></i>
        </button>
        <button class="gps-map-btn" id="gps-recenter-btn" style="display:none" title="${t.recTitleFollow}">
            <i data-lucide="locate" style="width:18px;height:18px;"></i>
        </button>
        <button class="gps-map-btn" id="gps-rot-btn" title="${t.rotTitleNord}">
            <i data-lucide="compass" style="width:18px;height:18px;"></i>
        </button>`;
    const host = document.getElementById('regional-map');
    (host || bar).appendChild(cluster);

    // « Vols » reste dans la barre (fonction d'archive, pas un réflexe de vol)
    const groupVols = document.createElement('div');
    groupVols.className = 'precip-control-group';
    groupVols.innerHTML = `
        <button class="precip-toggle" id="gps-vols-btn" title="${t.volsTitle}">
            <i data-lucide="download" style="width:14px;height:14px;"></i><span>${t.vols}</span><span class="gps-vols-count"></span>
        </button>`;
    bar.appendChild(groupVols);

    btn = cluster.querySelector('#gps-toggle-btn');
    recBtn = cluster.querySelector('#gps-recenter-btn');
    rotBtn = cluster.querySelector('#gps-rot-btn');
    volsBtn = groupVols.querySelector('#gps-vols-btn');
    volsCount = groupVols.querySelector('.gps-vols-count');
    // Rendu des icônes Lucide (sinon elles restent vides — bug constaté 07/09)
    if (window.lucide) window.lucide.createIcons({ root: cluster });
    if (window.lucide) window.lucide.createIcons({ root: groupVols });

    // « Cadrer plan » et « Plein cadre » descendent dans le paquet flottant,
    // sous les 3 icônes GPS : on DÉPLACE les vrais boutons de l'app (listeners
    // et icône d'état max/min du plein cadre conservés), juste restylés.
    const sep = document.createElement('div');
    sep.className = 'gps-cluster-sep';
    cluster.appendChild(sep);
    ['.map-fitplan-btn', '.map-fs-btn'].forEach(sel => {
        const b = bar.querySelector(sel);
        if (!b) return;
        const oldGroup = b.closest('.precip-control-group');
        b.classList.add('gps-map-btn');
        b.querySelectorAll('svg').forEach(svg => { svg.style.width = '18px'; svg.style.height = '18px'; });
        const span = b.querySelector('span');
        if (span) span.remove();   // icône seule (title conservé)
        cluster.appendChild(b);
        if (oldGroup && !oldGroup.querySelector('button, select')) oldGroup.remove();
    });

    // HTTP (Free.fr) : géolocation impossible → boutons grisés + infobulle.
    if (!(window.isSecureContext && navigator.geolocation)) {
        btn.disabled = true;
        btn.classList.add('gps-disabled');
        btn.title = t.titleHttp;
        return;
    }

    // GPS = interrupteur marche/arrêt ; le recentrage a son propre bouton.
    btn.addEventListener('click', () => {
        if (mode === 'off') start(); else stop();
    });

    recBtn.addEventListener('click', () => {
        if (mode === 'off') return;
        mode = 'follow';
        if (lastFix && activeMap) activeMap.panTo(lastFix, { animate: true, duration: .3 });
        renderRec();
    });

    // Rotation : proposée seulement si le plugin est actif sur la carte
    if (window.__regionalMap && typeof window.__regionalMap.setBearing === 'function') {
        rotationOn = rotationWanted();
        rotBtn.addEventListener('click', () => setRotation(!rotationOn));
        renderRot();
    } else {
        rotBtn.style.display = 'none';
    }

    volsBtn.addEventListener('click', () => panelOpen ? closePanel() : openPanel());

    // Le menu des familles d'espaces (.rp-menu de radio-points-layer) vit
    // DANS la barre (position:absolute sous son bouton) : le défilement
    // horizontal de la barre le CLIPPE (overflow-y devient auto) — le bouton
    // « Espaces » semblait mort. On libère tout menu ouvert en position:fixed
    // sous son bouton, déplacé sur <body> (hors du contexte de défilement).
    // (écouteur en CAPTURE : le bouton « Espaces » fait stopPropagation,
    // les écouteurs de remontée ne voient jamais le clic.)
    document.addEventListener('click', () => {
        setTimeout(() => {
            document.querySelectorAll('.rp-menu').forEach(m => {
                if (m.style.display !== 'block') return;
                const btn = m._rpBtn || (m._rpBtn = m.parentElement?.querySelector?.('button'));
                if (!btn) return;
                if (m.parentElement !== document.body) document.body.appendChild(m);
                const r = btn.getBoundingClientRect();
                m.style.position = 'fixed';
                m.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 185)) + 'px';
                m.style.top = (r.bottom + 6) + 'px';
                m.style.zIndex = 4000;
                m.style.maxHeight = '60vh';
                m.style.overflowY = 'auto';
            });
        }, 0);
    }, true);

    // Orphelins d'une fermeture brutale (endedAt nul, plus rien qui arrive) :
    // finalisés si ≥ durée minimale, sinon supprimés — même règle qu'à l'arrêt.
    (async () => {
        const all = await volAll();
        for (const v of all) {
            if (v.endedAt) continue;
            const lastT = v.pts.length ? v.pts[v.pts.length - 1].t : v.id;
            if (Date.now() - lastT < 60000) continue;   // session peut-être encore active
            if (volDurMs(v) >= VOL_MIN_MS) { v.endedAt = new Date(lastT).toISOString(); volSave(v); }
            else volDel(v.id);
        }
        updateVolsCount();
    })();
    updateVolsCount();
    render();
}

// ---- Barre « une ligne, 3 groupes » -----------------------------------------
// Réorganise la barre EXISTANTE (test only — aucun module source modifié) :
// Couches (Radar · Espaces · Satellite) │ Vue (Terrain · Cadrer plan ·
// Plein cadre) │ Navigation (GPS · Recentrer · Nord/Route · Vols).
// Le CSS (nowrap + défilement horizontal) est déjà injecté avec le style du
// module : la barre ne se replie plus jamais en vrac sur un écran étroit.
const api = { start, stop, get mode() { return mode; } };

// La barre est créée à l'ouverture de la carte : on attend qu'elle existe.
const poll = setInterval(() => {
    if (document.getElementById('map-layers-bar') && window.__regionalMap) {
        clearInterval(poll);
        mount();
    }
}, 300);
setTimeout(() => clearInterval(poll), 120000);
