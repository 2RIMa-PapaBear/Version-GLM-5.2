const STORAGE_KEY = 'cockpit-mode';

const HIDDEN_SELECTORS = [
    '.side-column',
    '#regional-map-panel',
    '.legend-bar-bottom',
    '.aero-legend-bar',
    '#alertes-meteo',
    '#takeoff-widget',
    '#frequencies-widget',
    '#alternates-container',
    '#flight-planner-panel',
    '.audio-controls',
];

export function isCockpitMode() {
    return document.body.classList.contains('cockpit-mode');
}

export function setCockpitMode(enabled) {
    document.body.classList.toggle('cockpit-mode', enabled);
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {   }

    const btn = document.getElementById('btn-cockpit-mode');
    if (btn) {
        btn.setAttribute('aria-pressed', String(enabled));
        btn.classList.toggle('active', enabled);
    }

    if (enabled) {
        const banner = document.getElementById('go-nogo-banner');
        if (banner && banner.style.display !== 'none') {
            banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }
}

export function toggleCockpitMode() {
    setCockpitMode(!isCockpitMode());
}

export function initCockpitMode() {
    let enabled = false;
    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {   }
    setCockpitMode(enabled);

    const btn = document.getElementById('btn-cockpit-mode');
    if (btn) {
        btn.addEventListener('click', toggleCockpitMode);
    }
}

export { HIDDEN_SELECTORS };
