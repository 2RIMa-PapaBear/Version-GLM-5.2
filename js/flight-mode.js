import { state } from './core.js';
import { showAlternates } from './alternates.js';
import { clearElevationChart } from './elevation-chart.js';

const STORAGE_KEY = 'flight-mode';

export function getFlightMode() {
    try {
        const m = localStorage.getItem(STORAGE_KEY);
        return m === 'nav' ? 'nav' : 'local';
    } catch {
        return 'local';
    }
}

export function setFlightMode(mode) {
    try {
        localStorage.setItem(STORAGE_KEY, mode);
    } catch {

    }

    document.body.classList.remove('mode-local', 'mode-nav');
    document.body.classList.add(mode === 'nav' ? 'mode-nav' : 'mode-local');

    const toggle = document.getElementById('flight-mode-toggle');
    if (toggle) {
        toggle.setAttribute('data-mode', mode);
        toggle.setAttribute('aria-pressed', String(mode === 'nav'));

        updateToggleLabels();
    }

    if (mode === 'local') {
        state.manualTargetHour = null;

        const toInput = document.getElementById('route-to-input');
        if (toInput) toInput.value = '';
        const fpPanel = document.getElementById('flight-planner-panel');
        if (fpPanel) fpPanel.style.display = 'none';
        clearElevationChart('elevation-profile-container');

        document.querySelectorAll('.dep-dest-btn').forEach(b => {
            b.classList.toggle('active', b.dataset.side === 'dep');
        });

        document.dispatchEvent(new CustomEvent('clear-route'));
    }

    const altC = document.getElementById('alternates-container');
    if (mode === 'nav' && state.requestedIcao) {
        showAlternates(state.requestedIcao);
        // NOTE : l'auto-ouverture du panneau carte régionale a été désactivée car elle
        // provoquait un crash du navigateur (OOM / récursion de re-rendu).
        // L'utilisateur doit ouvrir manuellement le panneau carte pour saisir destination
        // et waypoints. La visibilité du route-planner est garantie par le CSS mode-nav.
    } else if (altC) {
        altC.style.display = 'none';
    }

    if (state.refreshCallback) {
        state.lastRenderState = null;
        state.refreshCallback();
    }
}

export function toggleFlightMode() {
    setFlightMode(getFlightMode() === 'nav' ? 'local' : 'nav');
}

function updateToggleLabels() {
    const toggle = document.getElementById('flight-mode-toggle');
    if (!toggle) return;
    const lang = state.lang || 'fr';
    const localLbl = toggle.querySelector('.seg-local');
    const navLbl = toggle.querySelector('.seg-nav');
    if (localLbl) localLbl.textContent = lang === 'fr' ? 'Local' : 'Local';
    if (navLbl) navLbl.textContent = lang === 'fr' ? 'Navigation' : 'Nav';
}

export function initFlightMode() {

    setFlightMode('local');

    const toggle = document.getElementById('flight-mode-toggle');
    if (toggle) {
        toggle.addEventListener('click', toggleFlightMode);
        updateToggleLabels();
    }
}
