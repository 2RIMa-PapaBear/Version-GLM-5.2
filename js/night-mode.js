const STORAGE_KEY = 'night-mode-enabled';

export function isNightMode() {
    return document.documentElement.classList.contains('night-mode');
}

export function setNightMode(enabled) {
    const root = document.documentElement;
    if (enabled) {
        root.classList.add('night-mode');
    } else {
        root.classList.remove('night-mode');
    }
    try {
        localStorage.setItem(STORAGE_KEY, enabled ? '1' : '0');
    } catch {

    }

    const btn = document.getElementById('btn-night-mode');
    if (btn) {
        btn.setAttribute('aria-pressed', String(enabled));
        btn.classList.toggle('active', enabled);
    }
}

export function toggleNightMode() {
    setNightMode(!isNightMode());
}

export function initNightMode() {
    let enabled = false;
    try {
        enabled = localStorage.getItem(STORAGE_KEY) === '1';
    } catch {

    }
    setNightMode(enabled);
}
