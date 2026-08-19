/* ================================================================
 * ELEVATION CHART — Profil d'élévation interactif (canvas)
 * ================================================================
 *
 * Affiche le profil du terrain entre le départ et la destination sous
 * la carte régionale. Le pilote peut :
 *   - survoler pour voir l'altitude/distance du point sous le curseur,
 *   - zoomer (molette) verticalement,
 *   - glisser horizontalement pour se déplacer le long de la route.
 *
 * Une ligne horizontale représente l'altitude de croisière saisie dans
 * le planificateur de vol, pour visualiser la clearance.
 * ================================================================ */

const PAD = { top: 18, right: 16, bottom: 28, left: 52 };
const MIN_H = 100;

// État d'interaction (un seul graphique à la fois).
let _canvas = null;
let _ctx = null;
let _profile = null;
let _cruiseFt = 0;
let _fromIcao = '';
let _toIcao = '';
let _waypoints = null;        // [{icao, lat, lon}] waypoints intermédiaires (ou null).
let _hoverFrac = null;       // position du curseur (0-1), null si hors canvas.
let _zoomMin = null;         // min Y affiché (ft), null = auto.
let _zoomMax = null;
let _dragging = false;
let _dragStartX = 0;
let _dragOffset = 0;
let _distTotalKm = 0;

/**
 * Affiche le profil d'élévation dans le conteneur donné.
 * @param {string} containerId ID du conteneur parent.
 * @param {Object} profile Résultat de fetchRouteElevation ({points, maxFt, minFt, avgFt}).
 * @param {number} cruiseAltFt Altitude de croisière (ft).
 * @param {string} fromIcao Code OACI départ.
 * @param {string} toIcao Code OACI destination.
 * @param {Array|null} waypoints Waypoints intermédiaires [{icao, lat, lon}] pour multi-leg.
 */
export function renderElevationChart(containerId, profile, cruiseAltFt, fromIcao, toIcao, waypoints = null) {
    const container = document.getElementById(containerId);
    if (!container || !profile?.points?.length) {
        clearElevationChart(containerId);
        return;
    }

    container.style.display = 'block';
    _profile = profile;
    _cruiseFt = cruiseAltFt || 0;
    _waypoints = (waypoints && waypoints.length > 2) ? waypoints : null;
    _fromIcao = fromIcao || '';
    _toIcao = toIcao || '';
    _zoomMin = null;
    _zoomMax = null;
    _hoverFrac = null;

    // Distance totale (km) depuis le premier/dernier point.
    const pts = profile.points;
    _distTotalKm = _haversineKm(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon);

    // Met à jour le label de route.
    const label = document.getElementById('elev-route-label');
    if (label) label.textContent = `${fromIcao} → ${toIcao} · ${Math.round(_distTotalKm)} km`;

    _ensureCanvas(container);
    _draw();
    // Rediffère le dessin : si le conteneur était invisible au moment du
    // premier _draw() (panneau carte fermé), le canvas avait une largeur nulle.
    // requestAnimationFrame + timeout double pour couvrir le délai d'animation CSS.
    requestAnimationFrame(() => { _draw(); setTimeout(_draw, 250); });
}

/**
 * Redessine le graphique avec la langue courante (titre compris) — appelé
 * sur l'événement 'lang-changed' émis par setLanguage.
 */
export function refreshElevationChart() {
    _draw();
}

/**
 * Masque et vide le graphique.
 */
export function clearElevationChart(containerId) {
    const container = document.getElementById(containerId);
    if (container) container.style.display = 'none';
    if (_canvas && _canvas.parentElement === container) {
        _detachListeners();
        _canvas.remove();
        _canvas = null;
        _ctx = null;
    }
    _profile = null;
}

// ----------------------------------------------------------------
// Rendu canvas
// ----------------------------------------------------------------

function _ensureCanvas(container) {
    const old = document.getElementById('elevation-canvas');
    if (old) { _detachListeners(); old.remove(); }

    const title = document.createElement('div');
    title.className = 'elev-title';
    title.style.cssText = 'font-size:11px; color:var(--text-muted); margin-bottom:4px; font-weight:600;';

    _canvas = document.createElement('canvas');
    _canvas.id = 'elevation-canvas';
    _canvas.style.cssText = 'width:100%; height:150px; cursor:crosshair; display:block;';
    _ctx = _canvas.getContext('2d');

    container.innerHTML = '';
    container.appendChild(title);
    container.appendChild(_canvas);

    _attachListeners();

    // ResizeObserver pour gérer la responsivité.
    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => _draw());
        ro.observe(_canvas);
        _canvas._ro = ro;
    }
}

function _draw() {
    if (!_ctx || !_canvas || !_profile) return;

    // Titre re-traduit à chaque dessin (langue courante du document).
    const titleEl = _canvas.parentElement?.querySelector('.elev-title');
    if (titleEl) {
        const isFr = (document.documentElement.lang || 'fr') === 'fr';
        titleEl.textContent = isFr
            ? `Profil d'élévation — ${_fromIcao} → ${_toIcao}`
            : `Elevation profile — ${_fromIcao} → ${_toIcao}`;
    }

    const dpr = window.devicePixelRatio || 1;
    const cw = _canvas.clientWidth;
    const ch = Math.max(MIN_H, _canvas.clientHeight);
    _canvas.width = cw * dpr;
    _canvas.height = ch * dpr;
    _ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    _ctx.clearRect(0, 0, cw, ch);

    const pts = _profile.points;
    const plotW = cw - PAD.left - PAD.right;
    const plotH = ch - PAD.top - PAD.bottom;

    // Échelle Y (altitude) : englobe le terrain + l'altitude de croisière.
    let yMin = _zoomMin ?? Math.min(_profile.minFt, _cruiseFt) - 200;
    let yMax = _zoomMax ?? Math.max(_profile.maxFt, _cruiseFt) + 200;
    if (yMax - yMin < 500) yMax = yMin + 500; // évite une échelle trop plate.

    const xOf = frac => PAD.left + frac * plotW;
    const yOf = elev => PAD.top + (1 - (elev - yMin) / (yMax - yMin)) * plotH;

    // --- Fond ---
    _ctx.fillStyle = 'rgba(255,255,255,0.03)';
    _ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

    // --- Grille horizontale + labels Y ---
    _ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    _ctx.lineWidth = 1;
    _ctx.fillStyle = 'rgba(255,255,255,0.35)';
    _ctx.font = '9px "DM Mono", monospace';
    _ctx.textAlign = 'right';
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const elev = yMin + (yMax - yMin) * i / ySteps;
        const y = PAD.top + (1 - i / ySteps) * plotH;
        _ctx.beginPath();
        _ctx.moveTo(PAD.left, y);
        _ctx.lineTo(cw - PAD.right, y);
        _ctx.stroke();
        _ctx.fillText(Math.round(elev) + ' ft', PAD.left - 6, y + 3);
    }

    // --- Aire sous la courbe ---
    _ctx.beginPath();
    _ctx.moveTo(xOf(pts[0].frac), PAD.top + plotH);
    pts.forEach(p => _ctx.lineTo(xOf(p.frac), yOf(p.elevFt)));
    _ctx.lineTo(xOf(pts[pts.length - 1].frac), PAD.top + plotH);
    _ctx.closePath();
    const grad = _ctx.createLinearGradient(0, PAD.top, 0, PAD.top + plotH);
    grad.addColorStop(0, 'rgba(251,146,60,0.35)');
    grad.addColorStop(1, 'rgba(251,146,60,0.05)');
    _ctx.fillStyle = grad;
    _ctx.fill();

    // --- Ligne de terrain ---
    _ctx.beginPath();
    pts.forEach((p, i) => {
        const x = xOf(p.frac), y = yOf(p.elevFt);
        if (i === 0) _ctx.moveTo(x, y); else _ctx.lineTo(x, y);
    });
    _ctx.strokeStyle = '#FB923C';
    _ctx.lineWidth = 1.8;
    _ctx.stroke();

    // --- Ligne altitude de croisière ---
    if (_cruiseFt > yMin && _cruiseFt < yMax) {
        const yc = yOf(_cruiseFt);
        _ctx.beginPath();
        _ctx.setLineDash([6, 4]);
        _ctx.moveTo(PAD.left, yc);
        _ctx.lineTo(cw - PAD.right, yc);
        _ctx.strokeStyle = '#38BDF8';
        _ctx.lineWidth = 1.5;
        _ctx.stroke();
        _ctx.setLineDash([]);
        _ctx.fillStyle = '#38BDF8';
        _ctx.font = '9px "DM Sans", sans-serif';
        _ctx.textAlign = 'left';
        _ctx.fillText(Math.round(_cruiseFt) + ' ft', PAD.left + 4, yc - 4);
    }

    // --- Axe X : distance ---
    _ctx.fillStyle = 'rgba(255,255,255,0.35)';
    _ctx.font = '9px "DM Mono", monospace';
    _ctx.textAlign = 'center';
    const xSteps = 5;
    for (let i = 0; i <= xSteps; i++) {
        const frac = i / xSteps;
        const x = xOf(frac);
        const km = Math.round(frac * _distTotalKm);
        _ctx.fillText(km + ' km', x, ch - PAD.bottom + 16);
    }

    // --- Labels départ / arrivée ---
    _ctx.textAlign = 'left';
    _ctx.fillStyle = 'rgba(255,255,255,0.5)';
    _ctx.font = 'bold 9px "DM Mono", monospace';
    _ctx.fillText(_fromIcao, PAD.left + 2, PAD.top + 10);
    _ctx.textAlign = 'right';
    _ctx.fillText(_toIcao, cw - PAD.right - 2, PAD.top + 10);

    // --- Marqueurs waypoints intermédiaires (multi-leg) ---
    if (_waypoints && _waypoints.length > 2) {
        for (let i = 1; i < _waypoints.length - 1; i++) {
            const wp = _waypoints[i];
            // Trouve le frac du point de profil le plus proche du waypoint.
            const frac = _findWaypointFrac(wp);
            if (frac == null) continue;
            const wx = xOf(frac);

            // Ligne verticale pointillée ambre.
            _ctx.beginPath();
            _ctx.setLineDash([3, 3]);
            _ctx.moveTo(wx, PAD.top);
            _ctx.lineTo(wx, PAD.top + plotH);
            _ctx.strokeStyle = 'rgba(251, 191, 36, 0.5)';
            _ctx.lineWidth = 1;
            _ctx.stroke();
            _ctx.setLineDash([]);

            // Point + label ICAO en haut.
            _ctx.fillStyle = '#FBBF24';
            _ctx.beginPath();
            _ctx.arc(wx, PAD.top + 2, 3, 0, Math.PI * 2);
            _ctx.fill();
            _ctx.fillStyle = '#FBBF24';
            _ctx.font = 'bold 9px "DM Mono", monospace';
            _ctx.textAlign = 'center';
            _ctx.fillText(wp.icao, wx, PAD.top - 4 > 0 ? PAD.top - 4 : PAD.top + 14);
        }
    }

    // --- Curseur de survol ---
    if (_hoverFrac != null) {
        const hx = xOf(_hoverFrac);
        const pt = _nearestPoint(_hoverFrac);
        if (pt) {
            const hy = yOf(pt.elevFt);

            // Ligne verticale.
            _ctx.beginPath();
            _ctx.setLineDash([3, 3]);
            _ctx.moveTo(hx, PAD.top);
            _ctx.lineTo(hx, PAD.top + plotH);
            _ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            _ctx.lineWidth = 1;
            _ctx.stroke();
            _ctx.setLineDash([]);

            // Point sur la courbe.
            _ctx.beginPath();
            _ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            _ctx.fillStyle = '#FB923C';
            _ctx.fill();
            _ctx.strokeStyle = '#fff';
            _ctx.lineWidth = 1.5;
            _ctx.stroke();

            // Tooltip.
            const km = Math.round(pt.frac * _distTotalKm);
            const clearance = Math.round(_cruiseFt - pt.elevFt);
            const lines = [
                `${Math.round(pt.elevFt)} ft`,
                `${km} km`,
                clearance >= 0 ? `+${clearance} ft` : `${clearance} ft`,
            ];
            const tipW = 76, tipH = 40;
            let tipX = hx + 10;
            if (tipX + tipW > cw - PAD.right) tipX = hx - tipW - 10;
            const tipY = Math.max(PAD.top, hy - tipH - 8);

            _ctx.fillStyle = 'rgba(15,23,42,0.95)';
            _ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            _ctx.lineWidth = 1;
            _roundRect(tipX, tipY, tipW, tipH, 5);
            _ctx.fill();
            _ctx.stroke();

            _ctx.font = '9px "DM Mono", monospace';
            _ctx.textAlign = 'left';
            const colors = ['#FB923C', 'rgba(255,255,255,0.6)', clearance >= 0 ? '#4ADE80' : '#EF4444'];
            lines.forEach((line, i) => {
                _ctx.fillStyle = colors[i];
                _ctx.fillText(line, tipX + 6, tipY + 12 + i * 11);
            });
        }
    }
}

function _roundRect(x, y, w, h, r) {
    _ctx.beginPath();
    _ctx.moveTo(x + r, y);
    _ctx.arcTo(x + w, y, x + w, y + h, r);
    _ctx.arcTo(x + w, y + h, x, y + h, r);
    _ctx.arcTo(x, y + h, x, y, r);
    _ctx.arcTo(x, y, x + w, y, r);
    _ctx.closePath();
}

function _nearestPoint(frac) {
    if (!_profile?.points) return null;
    let best = _profile.points[0], bestD = Infinity;
    for (const p of _profile.points) {
        const d = Math.abs(p.frac - frac);
        if (d < bestD) { bestD = d; best = p; }
    }
    return best;
}

// Trouve le frac du point de profil le plus proche (en lat/lon) d'un waypoint.
function _findWaypointFrac(wp) {
    if (!_profile?.points || !wp) return null;
    let best = null, bestD = Infinity;
    for (const p of _profile.points) {
        if (p.lat == null || p.lon == null) continue;
        const d = _haversineKm(p.lat, p.lon, wp.lat, wp.lon);
        if (d < bestD) { bestD = d; best = p.frac; }
    }
    return best;
}

// ----------------------------------------------------------------
// Interactions
// ----------------------------------------------------------------

function _attachListeners() {
    if (!_canvas) return;
    _canvas.addEventListener('mousemove', _onMove);
    _canvas.addEventListener('mouseleave', _onLeave);
    _canvas.addEventListener('wheel', _onWheel, { passive: false });
    _canvas.addEventListener('mousedown', _onDown);
    window.addEventListener('mouseup', _onUp);
    _canvas.addEventListener('touchstart', _onTouchStart, { passive: false });
    _canvas.addEventListener('touchmove', _onTouchMove, { passive: false });
}

function _detachListeners() {
    if (!_canvas) return;
    _canvas.removeEventListener('mousemove', _onMove);
    _canvas.removeEventListener('mouseleave', _onLeave);
    _canvas.removeEventListener('wheel', _onWheel);
    _canvas.removeEventListener('mousedown', _onDown);
    window.removeEventListener('mouseup', _onUp);
    _canvas.removeEventListener('touchstart', _onTouchStart);
    _canvas.removeEventListener('touchmove', _onTouchMove);
    if (_canvas._ro) _canvas._ro.disconnect();
}

function _fracFromX(clientX) {
    const rect = _canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const plotW = rect.width - PAD.left - PAD.right;
    return Math.max(0, Math.min(1, (x - PAD.left) / plotW));
}

function _onMove(e) {
    _hoverFrac = _fracFromX(e.clientX);
    if (_dragging) {
        const rect = _canvas.getBoundingClientRect();
        const dx = e.clientX - _dragStartX;
        _dragStartX = e.clientX;
        _dragOffset += dx;
    }
    _draw();
    _emitHover();
}

function _onLeave() {
    _hoverFrac = null;
    _draw();
    _emitHover();
}

/**
 * Émet un événement DOM 'elevation-hover' avec la position (lat, lon)
 * du point sous le curseur, pour synchroniser le marqueur sur la carte.
 */
function _emitHover() {
    if (!_profile) return;
    const pt = _hoverFrac != null ? _nearestPoint(_hoverFrac) : null;
    document.dispatchEvent(new CustomEvent('elevation-hover', {
        detail: pt ? { lat: pt.lat, lon: pt.lon, frac: pt.frac, elevFt: pt.elevFt } : null,
    }));
}

function _onWheel(e) {
    e.preventDefault();
    if (!_profile) return;
    // Zoom vertical : resserre l'échelle Y autour du curseur.
    const factor = e.deltaY > 0 ? 1.15 : 0.87;
    let yMin = _zoomMin ?? Math.min(_profile.minFt, _cruiseFt) - 200;
    let yMax = _zoomMax ?? Math.max(_profile.maxFt, _cruiseFt) + 200;
    const mid = (yMin + yMax) / 2;
    const half = (yMax - yMin) / 2 * factor;
    _zoomMin = mid - half;
    _zoomMax = mid + half;
    _draw();
}

function _onDown(e) {
    _dragging = true;
    _dragStartX = e.clientX;
    _canvas.style.cursor = 'grabbing';
}

function _onUp() {
    if (_dragging) {
        _dragging = false;
        _canvas.style.cursor = 'crosshair';
    }
}

// --- Touch (mobile) ---
let _lastTouchX = 0;

function _onTouchStart(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        _lastTouchX = e.touches[0].clientX;
        _hoverFrac = _fracFromX(e.touches[0].clientX);
        _draw();
        _emitHover();
    }
}

function _onTouchMove(e) {
    if (e.touches.length === 1) {
        e.preventDefault();
        _hoverFrac = _fracFromX(e.touches[0].clientX);
        _draw();
        _emitHover();
    }
}

// ----------------------------------------------------------------
// Utils
// ----------------------------------------------------------------

function _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
