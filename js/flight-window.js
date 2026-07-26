import { state, I18N, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';

let _updateInterval = null;
let _currentIcao = null;

export function showFlightWindow(icao) {
    const container = document.getElementById('flight-window-banner');
    if (!container) return;

    _currentIcao = icao;

    if (!icao || typeof SunCalc === 'undefined') {
        container.style.display = 'none';
        stopLiveUpdate();
        return;
    }

    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    if (lat == null || lon == null) {
        container.style.display = 'none';
        stopLiveUpdate();
        return;
    }

    render(lat, lon);
    startLiveUpdate(lat, lon);
}

export function hideFlightWindow() {
    const container = document.getElementById('flight-window-banner');
    if (container) container.style.display = 'none';
    stopLiveUpdate();
    _currentIcao = null;
}

export function computeFlightWindow(lat, lon, now = new Date()) {
    if (typeof SunCalc === 'undefined' || lat == null || lon == null) return null;

    const times = SunCalc.getTimes(now, lat, lon);
    if (!times.sunrise || !times.sunset || isNaN(times.sunrise.getTime())) return null;

    const aeroStart = new Date(times.sunrise.getTime() - 30 * 60000);
    const aeroEnd = new Date(times.sunset.getTime() + 30 * 60000);

    let status;
    let minutesLeft = null;

    if (now < aeroStart) {
        status = 'before';
        minutesLeft = Math.round((aeroStart - now) / 60000);
    } else if (now > aeroEnd) {
        status = 'night';
    } else {
        status = 'open';
        minutesLeft = Math.round((aeroEnd - now) / 60000);
    }

    if (status === 'open' && minutesLeft !== null && minutesLeft <= 30) {
        status = 'closing';
    }

    return { sunrise: times.sunrise, sunset: times.sunset, aeroStart, aeroEnd, status, minutesLeft };
}

function render(lat, lon) {
    const container = document.getElementById('flight-window-banner');
    if (!container) return;

    const isFr = state.lang === 'fr';
    const w = computeFlightWindow(lat, lon);

    if (!w) {
        container.style.display = 'none';
        return;
    }

    const fmt = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Z`;
    };

    const configs = {
        open: {
            color: '#10B981',
            bg: 'rgba(16, 185, 129, 0.12)',
            icon: 'sun',
            label: isFr ? 'FENÊTRE DE VOL OUVERTE' : 'FLIGHT WINDOW OPEN',
            detail: _formatRemaining(w.minutesLeft, isFr, false),
        },
        closing: {
            color: '#F59E0B',
            bg: 'rgba(245, 158, 11, 0.12)',
            icon: 'alert-triangle',
            label: isFr ? 'FIN DE JOURNÉE PROCHE' : 'DAYLIGHT ENDING SOON',
            detail: _formatRemaining(w.minutesLeft, isFr, true),
        },
        before: {
            color: '#F59E0B',
            bg: 'rgba(245, 158, 11, 0.12)',
            icon: 'sunrise',
            label: isFr ? "PAS ENCORE EN HEURES DE JOUR" : 'NOT YET IN DAYLIGHT',
            detail: isFr ? `Ouverture dans ${_mmss(w.minutesLeft)}` : `Opens in ${_mmss(w.minutesLeft)}`,
        },
        night: {
            color: '#EF4444',
            bg: 'rgba(239, 68, 68, 0.12)',
            icon: 'moon',
            label: isFr ? 'NUIT AÉRONAUTIQUE — VFR DE JOUR INTERDIT' : 'AERONAUTICAL NIGHT — DAY VFR PROHIBITED',
            detail: isFr ? 'Le prochain lever civil est demain matin.' : 'Next civil sunrise is tomorrow morning.',
        },
    };

    const cfg = configs[w.status] || configs.open;

    const srLabel = isFr ? 'Lever civil' : 'Civil sunrise';
    const ssLabel = isFr ? 'Coucher civil' : 'Civil sunset';
    const aeroLabel = isFr ? 'Heures aéro' : 'Aero hours';

    container.innerHTML = `
        <div class="flight-window-content" style="display:flex; align-items:center; gap:14px; flex-wrap:wrap;">
            <div class="flight-window-status" style="display:flex; align-items:center; gap:10px; min-width:0; flex:1;">
                <div class="flight-window-icon" style="width:42px; height:42px; border-radius:50%; background:${cfg.bg}; border:2px solid ${cfg.color}; display:flex; align-items:center; justify-content:center; flex-shrink:0;">
                    <i data-lucide="${cfg.icon}" style="width:22px; height:22px; color:${cfg.color};"></i>
                </div>
                <div style="min-width:0;">
                    <div style="font-weight:800; font-size:13px; color:${cfg.color}; letter-spacing:0.5px; white-space:nowrap;">${cfg.label}</div>
                    <div style="font-size:12px; color:var(--text-muted); margin-top:2px;">${cfg.detail}</div>
                </div>
            </div>
            <div class="flight-window-times" style="display:flex; gap:16px; font-size:11px; flex-wrap:wrap;">
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${srLabel}</div>
                    <div style="font-family:'DM Mono', monospace; font-weight:700; color:var(--text-color); font-size:14px;">${fmt(w.sunrise)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${ssLabel}</div>
                    <div style="font-family:'DM Mono', monospace; font-weight:700; color:var(--text-color); font-size:14px;">${fmt(w.sunset)}</div>
                </div>
                <div style="text-align:center;">
                    <div style="color:var(--text-muted); text-transform:uppercase; font-size:9px; letter-spacing:1px; margin-bottom:2px;">${aeroLabel}</div>
                    <div style="font-family:'DM Mono', monospace; font-weight:700; color:var(--primary); font-size:14px;">${fmt(w.aeroStart)}<br>${fmt(w.aeroEnd)}</div>
                </div>
            </div>
        </div>
    `;
    container.style.background = cfg.bg;
    container.style.borderColor = cfg.color;
    container.style.display = 'block';
    if (window.lucide) window.lucide.createIcons({ root: container });
}

function _formatRemaining(minutes, isFr, urgent) {
    if (minutes === null) return '';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    const timeStr = `${h}h${String(m).padStart(2, '0')}`;
    if (urgent) {
        return isFr ? `⚠ Plus que ${timeStr} avant la nuit — prévoyez votre retour !` : `⚠ Only ${timeStr} before night — plan your return!`;
    }
    return isFr ? `${timeStr} restantes avant la nuit` : `${timeStr} before nightfall`;
}

function _mmss(minutes) {
    if (minutes === null) return '--';
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    if (h > 0) return `${h}h${String(m).padStart(2, '0')}`;
    return `${m} min`;
}

function startLiveUpdate(lat, lon) {
    stopLiveUpdate();
    _updateInterval = setInterval(() => {

        const memo = _currentIcao ? memoGet(_currentIcao) : null;
        render(lat, lon);
    }, 60000);
}

function stopLiveUpdate() {
    if (_updateInterval) {
        clearInterval(_updateInterval);
        _updateInterval = null;
    }
}
