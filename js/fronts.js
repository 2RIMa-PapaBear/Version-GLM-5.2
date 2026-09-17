/* ================================================================
 * CARTES DES FRONTS (⑤, 17/09) — situation générale du briefing.
 * ================================================================
 *
 * Source OFFICIELLE : AEROWEB (aviation.meteo.fr), compte du pilote,
 * via le Worker GET /fronts (même session AEROWEB que TEMSI/SIGMET) :
 *   - liste  : analyse + prévisions « fronts et isobares » Europe ouest
 *     toutes les 6 h (jusqu'à J+3), page anim_carte_front.php ;
 *   - images : affiche_image.php?mode=img (PNG ~60 Ko, immuable par
 *     date — cache périphérique 30 min côté Worker, IDB côté app).
 *
 * UI : bouton « Fronts » dans la rangée couches de la barre de la carte
 * régionale → panneau de VIGNETTES DATÉES (UTC ET locale, échéance ≈
 * arrivée mise en avant — mêmes conventions que TEMSI). Clic = zoom.
 *
 * Node-safe : les parties DOM sont gardées par typeof document.
 * Réutilise les helpers datés de temsi.js (labels, échéance proche,
 * heure cible) — une seule source pour ces conventions.
 */
import { state } from './core.js';
import { temsiLabels, nearestEcheance, temsiTargetMs } from './temsi.js';

const RELAY_FRONTS = 'https://meteo-relais.papabear56.workers.dev/fronts';

// ---- Cache IDB (base commune « metar-taf-cache ») ----
const IDB_NAME = 'metar-taf-cache';
const IDB_STORE = 'cache';
const IMG_TTL_MS = 12 * 3600 * 1000;   // image immuable par date
const LIST_TTL_MS = 10 * 60 * 1000;    // idem Worker

function _idb() {
    return new Promise((resolve, reject) => {
        if (typeof indexedDB === 'undefined') return reject(new Error('IDB indisponible'));
        const req = indexedDB.open(IDB_NAME, 1);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idb();
        return await new Promise((resolve, reject) => {
            const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
            r.onsuccess = () => resolve(r.result);
            r.onerror = () => reject(r.error);
        });
    } catch { return null; }
}
async function _idbPut(key, val) {
    try {
        const db = await _idb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(val, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* cache best effort */ }
}

/** Liste des couches/échéances (cache 10 min). null en échec. */
export async function fetchFrontsList() {
    const key = 'fronts:list';
    const hit = await _idbGet(key);
    if (hit?.data?.layers?.length && Date.now() - hit.ts < LIST_TTL_MS) return hit.data;
    try {
        const r = await fetch(RELAY_FRONTS, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!Array.isArray(data?.layers) || !data.layers.length) throw new Error('réponse sans couches');
        await _idbPut(key, { ts: Date.now(), data });
        return data;
    } catch (e) {
        console.warn('fronts liste indisponible :', e.message);
        return hit?.data ?? null;   // périmé > rien
    }
}

/** Image d'une échéance → objectURL (cache IDB par type+date). null en échec. */
export async function fetchFrontsImage(type, utc) {
    const key = `fronts:img:${type}:${utc}`;
    const hit = await _idbGet(key);
    if (hit?.blob instanceof Blob && Date.now() - hit.ts < IMG_TTL_MS) {
        return URL.createObjectURL(hit.blob);
    }
    try {
        const r = await fetch(`${RELAY_FRONTS}?img=${encodeURIComponent(type)}&date=${utc}`,
            { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        if (!blob.size || !/^image\//.test(blob.type)) throw new Error('réponse non image');
        await _idbPut(key, { ts: Date.now(), blob });
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn('fronts image indisponible :', e.message);
        return null;
    }
}

// ---- Panneau (DOM) ----------------------------------------------------------

/** Montre le panneau des vignettes (créé à la demande). */
export async function openFrontsPanel() {
    if (typeof document === 'undefined') return;
    const isFr = state.lang === 'fr';
    let panel = document.getElementById('fronts-panel');
    if (panel) { panel.hidden = false; return; }

    panel = document.createElement('div');
    panel.id = 'fronts-panel';
    panel.className = 'fronts-panel card';
    panel.innerHTML = `
        <div class="fronts-head">
            <h3>${isFr ? 'Fronts — situation générale' : 'Fronts — general situation'}</h3>
            <button class="fronts-close" title="${isFr ? 'Fermer' : 'Close'}" aria-label="${isFr ? 'Fermer' : 'Close'}"><i data-lucide="x" style="width:15px;height:15px;"></i></button>
        </div>
        <div class="fronts-note">${isFr
            ? 'Cartes « fronts et isobares » Météo-France (AEROWEB) — analyse puis prévisions toutes les 6 h ; chaque vignette porte son heure de validité UTC et locale.'
            : 'Météo-France fronts & isobars charts (AEROWEB) — analysis then 6-hourly forecasts; each thumbnail carries its UTC and local validity time.'}</div>
        <div class="fronts-body"><div class="fronts-wait">${isFr ? 'Chargement des échéances…' : 'Loading times…'}</div></div>`;
    const host = document.getElementById('regional-map-body') || document.body;
    host.appendChild(panel);
    if (window.lucide) window.lucide.createIcons({ root: panel });
    panel.querySelector('.fronts-close').addEventListener('click', () => { panel.hidden = true; });

    const body = panel.querySelector('.fronts-body');
    const list = await fetchFrontsList();
    if (!list) {
        body.innerHTML = `<div class="fronts-wait">${isFr
            ? 'Cartes des fronts indisponibles (relais AEROWEB injoignable — réessayez plus tard).'
            : 'Fronts charts unavailable (AEROWEB relay unreachable).'}</div>`;
        return;
    }
    const targetMs = temsiTargetMs();
    body.innerHTML = list.layers.map((l) => `
        <div class="fronts-layer" data-type="${l.type}">
            <div class="fronts-layer-title">${l.label}</div>
            <div class="fronts-grid" data-type="${l.type}">
                ${l.echeances.map((e) => {
                    const lab = temsiLabels(e.utc);
                    const near = nearestEcheance(l.echeances, targetMs)?.utc === e.utc;
                    return `<button class="fronts-thumb${near ? ' near' : ''}" data-type="${l.type}" data-utc="${e.utc}"
                        title="${l.label} — ${lab.utc}${near ? (isFr ? ' (≈ heure d arrivée prévue)' : ' (≈ ETA)') : ''}">
                        <div class="fronts-when"><b>${lab.utc}</b><span>${lab.loc}</span>${near ? `<em>${isFr ? '≈ arrivée' : '≈ ETA'}</em>` : ''}</div>
                        <img alt="${l.label} ${lab.utc}" loading="lazy">
                        <div class="fronts-load">${isFr ? 'chargement…' : 'loading…'}</div>
                    </button>`;
                }).join('')}
            </div>
        </div>`).join('');

    // Chargement séquentiel doux : d'abord l'échéance ≈ arrivée, puis le
    // reste (les cartes font ~60 Ko chacune, 8 échéances).
    const thumbs = [...body.querySelectorAll('.fronts-thumb')];
    const ordered = [...thumbs.filter(t => t.classList.contains('near')), ...thumbs.filter(t => !t.classList.contains('near'))];
    (async () => {
        for (const t of ordered) {
            if (!t.isConnected) return;   // panneau refermé/vidé
            const url = await fetchFrontsImage(t.dataset.type, t.dataset.utc);
            const img = t.querySelector('img');
            const load = t.querySelector('.fronts-load');
            if (url) { img.src = url; img.onload = () => { load.hidden = true; }; }
            else { load.textContent = isFr ? 'indisponible' : 'unavailable'; }
        }
    })();

    // Agrandissement plein cadre (même esprit TEMSI/VAC).
    body.querySelectorAll('.fronts-thumb').forEach((t) => {
        t.addEventListener('click', () => {
            if (!t.querySelector('img')?.src) return;
            showFrontsViewer(t.dataset.type, t.dataset.utc, t.querySelector('img').src);
        });
    });
}

let _viewer = null;
function showFrontsViewer(type, utc, src) {
    closeFrontsViewer();
    const isFr = state.lang === 'fr';
    _viewer = document.createElement('div');
    _viewer.className = 'fronts-viewer';
    _viewer.innerHTML = `
        <div class="fronts-viewer-bar">
            <span></span>
            <button title="${isFr ? 'Fermer (Échap)' : 'Close (Esc)'}" aria-label="${isFr ? 'Fermer' : 'Close'}"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
        </div>
        <img src="${src}" alt="Fronts ${utc}">`;
    document.body.appendChild(_viewer);
    if (window.lucide) window.lucide.createIcons({ root: _viewer });
    const lab = temsiLabels(utc);
    _viewer.querySelector('span').textContent = `${isFr ? 'Fronts' : 'Fronts'} · ${lab.utc} (${lab.loc})`;
    _viewer.querySelector('button').addEventListener('click', closeFrontsViewer);
    _viewer.addEventListener('click', (e) => { if (e.target === _viewer) closeFrontsViewer(); });
}
export function closeFrontsViewer() {
    if (_viewer) { _viewer.remove(); _viewer = null; }
}

/** Bouton « Fronts » greffé dans la rangée couches de la barre carte. */
export function mountFrontsButton(bar) {
    if (!bar || bar.querySelector('.fronts-btn')) return;
    const isFr = state.lang === 'fr';
    const group = document.createElement('div');
    group.className = 'precip-control-group';
    group.innerHTML = `
        <button class="precip-toggle fronts-btn" title="${isFr ? 'Cartes des fronts et isobares Météo-France (situation générale, vignettes datées)' : 'Météo-France fronts & isobars charts (general situation, dated thumbnails)'}">
            <i data-lucide="activity" style="width:14px;height:14px;"></i>
            <span>Fronts</span>
        </button>`;
    bar.appendChild(group);
    if (window.lucide) window.lucide.createIcons({ root: group });
    group.querySelector('.fronts-btn').addEventListener('click', openFrontsPanel);
}

// Échap ferme la visionneuse plein cadre (et le panneau au second temps).
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (_viewer) { closeFrontsViewer(); return; }
        const panel = document.getElementById('fronts-panel');
        if (panel && !panel.hidden) panel.hidden = true;
    });
}
