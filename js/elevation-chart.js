const PAD = { top: 18, right: 16, bottom: 28, left: 52 };
const MIN_H = 100;

let _canvas = null;
let _ctx = null;
let _profile = null;
let _cruiseFt = 0;
let _fromIcao = '';
let _toIcao = '';
let _hoverFrac = null;
let _zoomMin = null;
let _zoomMax = null;
let _dragging = false;
let _dragStartX = 0;
let _dragOffset = 0;
let _distTotalKm = 0;

export function renderElevationChart(containerId, profile, cruiseAltFt, fromIcao, toIcao) {
    const container = document.getElementById(containerId);
    if (!container || !profile?.points?.length) {
        clearElevationChart(containerId);
        return;
    }

    container.style.display = 'block';
    _profile = profile;
    _cruiseFt = cruiseAltFt || 0;
    _fromIcao = fromIcao || '';
    _toIcao = toIcao || '';
    _zoomMin = null;
    _zoomMax = null;
    _hoverFrac = null;

    const pts = profile.points;
    _distTotalKm = _haversineKm(pts[0].lat, pts[0].lon, pts[pts.length - 1].lat, pts[pts.length - 1].lon);

    const label = document.getElementById('elev-route-label');
    if (label) label.textContent = `${fromIcao} → ${toIcao} · ${Math.round(_distTotalKm)} km`;

    _ensureCanvas(container);
    _draw();

    requestAnimationFrame(() => { _draw(); setTimeout(_draw, 250); });

    const titleEl = container.querySelector('.elev-title');
    if (titleEl) {
        const lang = document.documentElement.lang || 'fr';
        const isFr = lang === 'fr';
        titleEl.textContent = isFr
            ? `Profil d'élévation — ${fromIcao} → ${toIcao}`
            : `Elevation profile — ${fromIcao} → ${toIcao}`;
    }
}

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

    if (window.ResizeObserver) {
        const ro = new ResizeObserver(() => _draw());
        ro.observe(_canvas);
        _canvas._ro = ro;
    }
}

function _draw() {
    if (!_ctx || !_canvas || !_profile) return;

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

    let yMin = _zoomMin ?? Math.min(_profile.minFt, _cruiseFt) - 200;
    let yMax = _zoomMax ?? Math.max(_profile.maxFt, _cruiseFt) + 200;
    if (yMax - yMin < 500) yMax = yMin + 500;

    const xOf = frac => PAD.left + frac * plotW;
    const yOf = elev => PAD.top + (1 - (elev - yMin) / (yMax - yMin)) * plotH;

    _ctx.fillStyle = 'rgba(255,255,255,0.03)';
    _ctx.fillRect(PAD.left, PAD.top, plotW, plotH);

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

    _ctx.beginPath();
    pts.forEach((p, i) => {
        const x = xOf(p.frac), y = yOf(p.elevFt);
        if (i === 0) _ctx.moveTo(x, y); else _ctx.lineTo(x, y);
    });
    _ctx.strokeStyle = '#FB923C';
    _ctx.lineWidth = 1.8;
    _ctx.stroke();

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

    _ctx.textAlign = 'left';
    _ctx.fillStyle = 'rgba(255,255,255,0.5)';
    _ctx.font = 'bold 9px "DM Mono", monospace';
    _ctx.fillText(_fromIcao, PAD.left + 2, PAD.top + 10);
    _ctx.textAlign = 'right';
    _ctx.fillText(_toIcao, cw - PAD.right - 2, PAD.top + 10);

    if (_hoverFrac != null) {
        const hx = xOf(_hoverFrac);
        const pt = _nearestPoint(_hoverFrac);
        if (pt) {
            const hy = yOf(pt.elevFt);

            _ctx.beginPath();
            _ctx.setLineDash([3, 3]);
            _ctx.moveTo(hx, PAD.top);
            _ctx.lineTo(hx, PAD.top + plotH);
            _ctx.strokeStyle = 'rgba(255,255,255,0.4)';
            _ctx.lineWidth = 1;
            _ctx.stroke();
            _ctx.setLineDash([]);

            _ctx.beginPath();
            _ctx.arc(hx, hy, 4, 0, Math.PI * 2);
            _ctx.fillStyle = '#FB923C';
            _ctx.fill();
            _ctx.strokeStyle = '#fff';
            _ctx.lineWidth = 1.5;
            _ctx.stroke();

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

function _haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
