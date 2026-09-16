/* ================================================================
 * TEMSI (B3 v2, 16/09) — cartes du temps significatif Météo-France.
 * ================================================================
 *
 * Source OFFICIELLE : AEROWEB (aviation.meteo.fr), compte du pilote,
 * via le Worker GET /temsi (même session que les SIGMET) :
 *   - liste  : couches TEMSI SFC-FL150 + WINTEM FL020-100 avec leurs
 *     échéances UTC du jour (4 émissions/jour) ;
 *   - images : affiche_image.php?mode=img (PNG ~150-280 Ko, immuable
 *     par date — cache périphérique 30 min côté Worker, IDB côté app).
 *
 * UI : bouton « TEMSI » dans la barre de la carte régionale → panneau
 * de VIGNETTES DATÉES (chaque vignette porte son émission UTC ET son
 * heure locale — une carte TEMSI sans heure ne vaut rien). L'échéance
 * la plus proche de l'heure prévue d'arrivée du plan (ou de maintenant
 * + 1 h sans plan) est mise en avant. Clic = agrandissement.
 *
 * Node-safe : les parties DOM sont gardées par typeof document.
 */
import { state } from './core.js';

const RELAY_TEMSI = 'https://meteo-relais.papabear56.workers.dev/temsi';

// ---- Cache IDB (commun aux autres modules : base « metar-taf-cache ») ----
const IDB_NAME = 'metar-taf-cache';
const IDB_STORE = 'cache';
const IMG_TTL_MS = 12 * 3600 * 1000;   // image immuable par date : 12 h largement
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
export async function fetchTemsiList() {
    const key = 'temsi:list';
    const hit = await _idbGet(key);
    if (hit?.data?.layers?.length && Date.now() - hit.ts < LIST_TTL_MS) return hit.data;
    try {
        const r = await fetch(RELAY_TEMSI, { signal: AbortSignal.timeout(15000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        if (!Array.isArray(data?.layers) || !data.layers.length) throw new Error('réponse sans couches');
        await _idbPut(key, { ts: Date.now(), data });
        return data;
    } catch (e) {
        console.warn('TEMSI liste indisponible :', e.message);
        return hit?.data ?? null;   // périmé > rien
    }
}

/** Image d'une échéance → objectURL (cache IDB par type+date). null en échec. */
export async function fetchTemsiImage(type, utc) {
    const key = `temsi:img:${type}:${utc}`;
    const hit = await _idbGet(key);
    if (hit?.blob instanceof Blob && Date.now() - hit.ts < IMG_TTL_MS) {
        return URL.createObjectURL(hit.blob);
    }
    try {
        const r = await fetch(`${RELAY_TEMSI}?img=${encodeURIComponent(type)}&date=${utc}`,
            { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        if (!blob.size || !/^image\//.test(blob.type)) throw new Error('réponse non image');
        await _idbPut(key, { ts: Date.now(), blob });
        return URL.createObjectURL(blob);
    } catch (e) {
        console.warn('TEMSI image indisponible :', e.message);
        return null;
    }
}

/** UTC « 20260916150000 » → { utc: '15h00', loc: '17h00' } (heure locale). */
export function temsiLabels(utc) {
    const d = new Date(utc.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'));
    if (isNaN(d)) return { utc: '?', loc: '?' };
    const p = (x) => String(x).padStart(2, '0');
    return {
        utc: `${p(d.getUTCHours())}h${p(d.getUTCMinutes())} UTC`,
        loc: `${p(d.getHours())}h${p(d.getMinutes())}`,
    };
}

/** Échéance la plus proche d'une cible (ms) — pour la mise en avant. */
export function nearestEcheance(echeances, targetMs) {
    let best = null, bestD = Infinity;
    for (const e of echeances || []) {
        const t = Date.parse(e.utc.replace(/^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/, '$1-$2-$3T$4:$5:$6Z'));
        if (isNaN(t)) continue;
        const d = Math.abs(t - targetMs);
        if (d < bestD) { bestD = d; best = e; }
    }
    return best;
}

/** Heure cible de mise en avant : arrivée prévue du plan si un plan
 *  existe (maintenant + temps de vol), sinon maintenant + 1 h. */
export function temsiTargetMs() {
    const totalMin = state._lastNavPlan?.plan?.totalTimeMin;
    return Date.now() + (Number.isFinite(+totalMin) && +totalMin > 0 ? +totalMin : 60) * 60000;
}

// ---- Panneau (DOM) ----------------------------------------------------------

/** Montre le panneau des vignettes (créé à la demande). */
export async function openTemsiPanel() {
    if (typeof document === 'undefined') return;
    const isFr = state.lang === 'fr';
    let panel = document.getElementById('temsi-panel');
    if (panel) { panel.hidden = false; return; }

    panel = document.createElement('div');
    panel.id = 'temsi-panel';
    panel.className = 'temsi-panel card';
    panel.innerHTML = `
        <div class="temsi-head">
            <h3>${isFr ? 'TEMSI — temps significatif' : 'TEMSI — significant weather'}</h3>
            <button class="temsi-close" title="${isFr ? 'Fermer' : 'Close'}" aria-label="${isFr ? 'Fermer' : 'Close'}"><i data-lucide="x" style="width:15px;height:15px;"></i></button>
        </div>
        <div class="temsi-note">${isFr
            ? 'Cartes Météo-France (AEROWEB) — chaque vignette porte son heure de validité UTC et locale.'
            : 'Météo-France charts (AEROWEB) — each thumbnail carries its UTC and local validity time.'}</div>
        <div class="temsi-body"><div class="temsi-wait">${isFr ? 'Chargement des échéances…' : 'Loading times…'}</div></div>`;
    const host = document.getElementById('regional-map-body') || document.body;
    host.appendChild(panel);
    if (window.lucide) window.lucide.createIcons({ root: panel });
    panel.querySelector('.temsi-close').addEventListener('click', () => { panel.hidden = true; });

    const body = panel.querySelector('.temsi-body');
    const list = await fetchTemsiList();
    if (!list) {
        body.innerHTML = `<div class="temsi-wait">${isFr
            ? 'TEMSI indisponible (relais AEROWEB injoignable — réessayez plus tard).'
            : 'TEMSI unavailable (AEROWEB relay unreachable).'}</div>`;
        return;
    }
    const targetMs = temsiTargetMs();
    body.innerHTML = list.layers.map((l) => `
        <div class="temsi-layer" data-type="${l.type}">
            <div class="temsi-layer-title">${l.label}</div>
            <div class="temsi-grid" data-type="${l.type}">
                ${l.echeances.map((e) => {
                    const lab = temsiLabels(e.utc);
                    const near = nearestEcheance(l.echeances, targetMs)?.utc === e.utc;
                    return `<button class="temsi-thumb${near ? ' near' : ''}" data-type="${l.type}" data-utc="${e.utc}"
                        title="${l.label} — ${lab.utc}${near ? (isFr ? ' (≈ heure d arrivée prévue)' : ' (≈ ETA)') : ''}">
                        <div class="temsi-when"><b>${lab.utc}</b><span>${lab.loc}</span>${near ? `<em>${isFr ? '≈ arrivée' : '≈ ETA'}</em>` : ''}</div>
                        <img alt="${l.label} ${lab.utc}" loading="lazy">
                        <div class="temsi-load">${isFr ? 'chargement…' : 'loading…'}</div>
                    </button>`;
                }).join('')}
            </div>
        </div>`).join('');

    // Chargement séquentiel doux (les images sont ~150-280 Ko chacune) :
    // d'abord l'échéance mise en avant, puis les autres.
    const thumbs = [...body.querySelectorAll('.temsi-thumb')];
    const ordered = [...thumbs.filter(t => t.classList.contains('near')), ...thumbs.filter(t => !t.classList.contains('near'))];
    (async () => {
        for (const t of ordered) {
            if (!t.isConnected) return;   // panneau refermé/vidé
            const url = await fetchTemsiImage(t.dataset.type, t.dataset.utc);
            const img = t.querySelector('img');
            const load = t.querySelector('.temsi-load');
            if (url) { img.src = url; img.onload = () => { load.hidden = true; }; }
            else { load.textContent = isFr ? 'indisponible' : 'unavailable'; }
        }
    })();

    // Agrandissement : la vignette devient une visionneuse plein cadre
    // (même esprit que la visionneuse VAC, plus légère).
    body.querySelectorAll('.temsi-thumb').forEach((t) => {
        t.addEventListener('click', () => {
            if (!t.querySelector('img')?.src) return;
            showTemsiViewer(t.dataset.type, t.dataset.utc, t.querySelector('img').src);
        });
    });
}

let _viewer = null;
function showTemsiViewer(type, utc, src) {
    closeTemsiViewer();
    const isFr = state.lang === 'fr';
    _viewer = document.createElement('div');
    _viewer.className = 'temsi-viewer';
    _viewer.innerHTML = `
        <div class="temsi-viewer-bar">
            <span></span>
            <button title="${isFr ? 'Fermer (Échap)' : 'Close (Esc)'}" aria-label="${isFr ? 'Fermer' : 'Close'}"><i data-lucide="x" style="width:16px;height:16px;"></i></button>
        </div>
        <img src="${src}" alt="TEMSI ${utc}">`;
    document.body.appendChild(_viewer);
    if (window.lucide) window.lucide.createIcons({ root: _viewer });
    const lab = temsiLabels(utc);
    _viewer.querySelector('span').textContent = `${type.includes('wintemp') ? 'WINTEM' : 'TEMSI'} · ${lab.utc} (${lab.loc})`;
    _viewer.querySelector('button').addEventListener('click', closeTemsiViewer);
    _viewer.addEventListener('click', (e) => { if (e.target === _viewer) closeTemsiViewer(); });
}
export function closeTemsiViewer() {
    if (_viewer) { _viewer.remove(); _viewer = null; }
}

/** Bouton « TEMSI » greffé dans la barre de la carte régionale. */
export function mountTemsiButton(bar) {
    if (!bar || bar.querySelector('.temsi-btn')) return;
    const isFr = state.lang === 'fr';
    const group = document.createElement('div');
    group.className = 'precip-control-group';
    group.innerHTML = `
        <button class="precip-toggle temsi-btn" title="${isFr ? 'Cartes TEMSI/WinTEM du temps significatif (Météo-France, vignettes datées)' : 'TEMSI/WinTEM significant weather charts (dated thumbnails)'}">
            <i data-lucide="cloud-lightning" style="width:14px;height:14px;"></i>
            <span>TEMSI</span>
        </button>`;
    bar.appendChild(group);
    if (window.lucide) window.lucide.createIcons({ root: group });
    group.querySelector('.temsi-btn').addEventListener('click', openTemsiPanel);
}

// Échap ferme la visionneuse plein cadre (et le panneau au second temps).
if (typeof document !== 'undefined') {
    document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape') return;
        if (_viewer) { closeTemsiViewer(); return; }
        const panel = document.getElementById('temsi-panel');
        if (panel && !panel.hidden) panel.hidden = true;
    });
}
