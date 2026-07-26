import { state } from './core.js';

const MANIFEST_URL = 'https://api.rainviewer.com/public/weather-maps.json';
const MANIFEST_TTL_MS = 10 * 60 * 1000;
const DEFAULT_SPEED_MS = 600;
const TILE_SIZE = 256;

const RADAR_COLOR = 2;
const RADAR_SMOOTH = 1;

let _manifest = null;
let _manifestTs = 0;

async function _loadManifest() {
    if (_manifest && Date.now() - _manifestTs < MANIFEST_TTL_MS) return _manifest;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12000);
    try {
        const res = await fetch(MANIFEST_URL, { signal: controller.signal });
        if (!res.ok) throw new Error('RainViewer HTTP ' + res.status);
        _manifest = await res.json();
        _manifestTs = Date.now();
        return _manifest;
    } finally {
        clearTimeout(timeoutId);
    }
}

function _buildRadarFrames(manifest) {
    const past = (manifest.radar?.past || []).map(f => ({ ...f, forecast: false }));
    const nowcast = (manifest.radar?.nowcast || []).map(f => ({ ...f, forecast: true }));
    return [...past, ...nowcast];
}

function _tileUrl(host, path, color, smooth) {

    return `${host}${path}/${TILE_SIZE}/{z}/{x}/{y}/${color}/${smooth || 0}_1.png`;
}

export function createPrecipController(map) {

    let radarFrames = [];
    let radarLayer = null;
    let radarVisible = true;
    let frameIdx = 0;
    let playing = false;
    let playTimer = null;
    let speedMs = DEFAULT_SPEED_MS;
    let controlsEl = null;

    let _initPromise = null;
    let _initOk = false;
    function _ensureInit() {

        if (_initOk && _initPromise) return _initPromise;
        _initPromise = (async () => {
            const mf = await _loadManifest();
            radarFrames = _buildRadarFrames(mf);

            const lastPastIdx = radarFrames.map(f => f.forecast).lastIndexOf(false);
            frameIdx = lastPastIdx >= 0 ? lastPastIdx : radarFrames.length - 1;
            _initOk = true;
        })().catch(e => {
            console.warn('Precip controller init failed:', e);
            _initOk = false;
            _initPromise = null;
        });
        return _initPromise;
    }

    function _removeRadarLayer() {
        if (radarLayer) { map.removeLayer(radarLayer); radarLayer = null; }
    }

    function _showRadarFrame() {
        if (!radarVisible || radarFrames.length === 0) return;
        const host = _manifest?.host;
        if (!host) return;
        const f = radarFrames[frameIdx];
        if (!f) return;
        const url = _tileUrl(host, f.path, RADAR_COLOR, RADAR_SMOOTH);
        _removeRadarLayer();
        radarLayer = L.tileLayer(url, {
            opacity: 0.65,
            tileSize: TILE_SIZE,
            attribution: '© RainViewer',
            zIndex: 400,
        }).addTo(map);
        _updateFrameLabel();
    }

    function _play() {
        if (playing || radarFrames.length < 2) return;
        playing = true;
        playTimer = setInterval(() => {
            frameIdx = (frameIdx + 1) % radarFrames.length;
            _showRadarFrame();
            _syncSlider();
        }, speedMs);
        _updatePlayBtn();
    }

    function _pause() {
        if (playTimer) { clearInterval(playTimer); playTimer = null; }
        playing = false;
        _updatePlayBtn();
    }

    function _setFrame(i) {
        frameIdx = Math.max(0, Math.min(radarFrames.length - 1, i));
        _showRadarFrame();
        _syncSlider();
    }

    function _updatePlayBtn() {
        if (!controlsEl) return;
        const btn = controlsEl.querySelector('.precip-play-btn');
        const icon = controlsEl.querySelector('.precip-play-btn i');
        if (!btn || !icon) return;
        if (playing) {
            icon.setAttribute('data-lucide', 'pause');
            btn.setAttribute('aria-label', state.lang === 'fr' ? 'Pause' : 'Pause');
        } else {
            icon.setAttribute('data-lucide', 'play');
            btn.setAttribute('aria-label', state.lang === 'fr' ? 'Lecture' : 'Play');
        }
        if (window.lucide) window.lucide.createIcons({ root: controlsEl });
    }

    function _syncSlider() {
        if (!controlsEl) return;
        const slider = controlsEl.querySelector('.precip-slider');
        if (slider) slider.value = String(frameIdx);
    }

    function _updateFrameLabel() {
        if (!controlsEl) return;
        const label = controlsEl.querySelector('.precip-time-label');
        if (!label) return;
        const f = radarFrames[frameIdx];
        if (!f) { label.textContent = '—'; return; }
        const d = new Date(f.time * 1000);
        const pad = n => String(n).padStart(2, '0');
        const hhmm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
        const tag = f.forecast ? (state.lang === 'fr' ? 'prév.' : 'fcst') : '';
        label.textContent = `${hhmm} Z${tag ? ' ' + tag : ''}`;
    }

    function mountControls(el) {
        controlsEl = el;
        const isFr = state.lang === 'fr';

        el.innerHTML = `
            <div class="precip-control-group">
                <button class="precip-toggle precip-toggle-radar active" data-layer="radar" aria-pressed="true" title="${isFr ? 'Couches radar' : 'Radar layers'}">
                    <i data-lucide="cloud-rain" style="width:14px;height:14px;"></i>
                    <span>${isFr ? 'Radar' : 'Radar'}</span>
                </button>
                <button class="precip-play-btn" aria-label="${isFr ? 'Lecture' : 'Play'}" title="${isFr ? 'Animation précipitations' : 'Precipitation animation'}">
                    <i data-lucide="play" style="width:14px;height:14px;"></i>
                </button>
            </div>
            <div class="precip-slider-group">
                <input type="range" class="precip-slider" min="0" max="${Math.max(0, radarFrames.length - 1)}" value="${frameIdx}" step="1" aria-label="${isFr ? 'Horloge animation' : 'Animation clock'}">
                <span class="precip-time-label">—</span>
            </div>
        `;

        if (window.lucide) window.lucide.createIcons({ root: el });

        const radarBtn = el.querySelector('.precip-toggle-radar');
        radarBtn?.addEventListener('click', async () => {
            radarVisible = !radarVisible;
            radarBtn.classList.toggle('active', radarVisible);
            radarBtn.setAttribute('aria-pressed', String(radarVisible));
            if (radarVisible) {
                await _ensureInit();
                _showRadarFrame();
                _syncSliderMax();
            } else {
                _pause();
                _removeRadarLayer();
            }
        });

        el.querySelector('.precip-play-btn')?.addEventListener('click', async () => {
            await _ensureInit();
            if (playing) _pause(); else _play();
        });

        const slider = el.querySelector('.precip-slider');
        slider?.addEventListener('input', () => {
            _pause();
            _setFrame(parseInt(slider.value, 10));
        });
    }

    function _syncSliderMax() {
        if (!controlsEl) return;
        const slider = controlsEl.querySelector('.precip-slider');
        if (slider) slider.max = String(Math.max(0, radarFrames.length - 1));
        _syncSlider();
        _updateFrameLabel();
    }

    return {
        mountControls,
        async toggleRadar(on) {
            radarVisible = on;
            if (on) {
                await _ensureInit();
                _syncSliderMax();
                _showRadarFrame();
            } else {
                _pause();
                _removeRadarLayer();
            }
        },

        preload() { return _ensureInit().then(_syncSliderMax); },

        destroy() {
            _pause();
            _removeRadarLayer();
            controlsEl = null;
        },
    };
}
