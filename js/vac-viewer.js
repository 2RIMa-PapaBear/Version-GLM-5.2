/* ================================================================
 * VAC VIEWER — carte « Atterrissage à vue » (Atlas-VAC officiel SIA)
 * ================================================================
 *
 * La carte VAC du terrain vient de l'Atlas-VAC du ZIP eAIP complet du
 * SIA (extrait vers data/vac-sia/<ICAO>.pdf à chaque cycle AIRAC par
 * scripts/fetch-vac-atlas.mjs — 421 terrains, y compris ceux sans fiche
 * eAIP comme LFOM). Fichier local du site : aucun relais nécessaire.
 *
 * Consultation HORS LIGNE : la carte ouverte est mise en cache IndexedDB
 * (clé OACI+cycle) — relisible au club sans connexion ; à chaque nouvel
 * AIRAC elle se re-télécharge. pdfjs (vendor) est chargé À LA DEMANDE au
 * premier affichage. Les VAC comportent souvent 2 pages (recto/verso) :
 * navigation ‹ › quand c'est le cas.
 * ================================================================ */

import { state } from './core.js';
import { bigDataUrl } from './data-base.js';

// ---- Index des cartes disponibles (data/vac-sia/index.json, ~5 Ko) ---------

let _indexPromise = null;
function loadVacIndex() {
    _indexPromise ??= (async () => {
        try {
            const r = await fetch(bigDataUrl('data/vac-sia/index.json'), { cache: 'no-cache' });
            if (!r.ok) return null;
            const d = await r.json();
            return (d && Array.isArray(d.icacos)) ? d : null;
        } catch { return null; }
    })();
    return _indexPromise;
}

/** Ce terrain a-t-il une carte VAC publiée (Atlas-VAC) ? */
export function hasVac(icao) {
    const code = String(icao || '').toUpperCase();
    return loadVacIndex().then(idx => !!(idx?.icacos?.includes(code)));
}

/** Infos de l'index Atlas-VAC — cycle AIRAC courant (B1 : attestation
 *  de la page de garde du dossier de vol). */
export async function getVacIndexInfo() {
    const idx = await loadVacIndex();
    return { airac: idx?.airac || '', count: idx?.icacos?.length || 0 };
}

/** URL de la carte VAC locale (versionnée par cycle pour les caches). */
export async function vacUrl(icao) {
    const code = String(icao || '').toUpperCase();
    const idx = await loadVacIndex();
    const airac = idx?.airac || '';
    return `${bigDataUrl(`data/vac-sia/${code}.pdf`)}${airac ? `?v=${airac}` : ''}`;
}

// ---- Cache IndexedDB (une carte ≈ 300 Ko, cycle inclus) --------------------

const IDB_NAME = 'vac-cache';
const IDB_STORE = 'vac';

function _idbOpen() {
    return new Promise((resolve, reject) => {
        const req = indexedDB.open(IDB_NAME, 1);
        req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}
async function _idbGet(key) {
    try {
        const db = await _idbOpen();
        return await new Promise((resolve, reject) => {
            const r = db.transaction(IDB_STORE).objectStore(IDB_STORE).get(key);
            r.onsuccess = () => resolve(r.result || null);
            r.onerror = () => reject(r.error);
        });
    } catch { return null; }
}
async function _idbPut(key, value) {
    try {
        const db = await _idbOpen();
        await new Promise((resolve, reject) => {
            const tx = db.transaction(IDB_STORE, 'readwrite');
            tx.objectStore(IDB_STORE).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
        });
    } catch { /* quota : la carte ne sera simplement pas hors ligne */ }
}

/** Carte VAC du terrain : cache IndexedDB (cycle courant) sinon fichier
 * local du site. Retourne { blob, airac, offline } ou null. */
export async function fetchVac(icao) {
    const code = String(icao || '').toUpperCase();
    const idx = await loadVacIndex();
    const airac = idx?.airac || null;
    if (!idx?.icacos?.includes(code)) return null;
    const cle = `${code}:VAC:${airac}`;

    const cached = await _idbGet(cle);
    if (cached?.blob instanceof Blob) {
        return { blob: cached.blob, airac, offline: true };
    }
    try {
        const res = await fetch(`${bigDataUrl(`data/vac-sia/${code}.pdf`)}${airac ? `?v=${airac}` : ''}`, { signal: AbortSignal.timeout(20000) });
        if (res.ok) {
            const blob = await res.blob();
            if (blob.size > 500) {
                _idbPut(cle, { airac, blob, ts: Date.now() });
                return { blob, airac, offline: false };
            }
        }
    } catch { /* réseau : repli cache périmé puis portail */ }

    // Réseau indisponible mais carte d'un cycle précédent : mieux que rien.
    if (cached?.blob instanceof Blob) return { blob: cached.blob, airac: cached.airac, offline: true, stale: true };
    return null;
}

// ---- pdfjs chargé à la demande ----------------------------------------------

let _pdfjsPromise = null;
function _loadPdfjs() {
    _pdfjsPromise ??= new Promise((resolve, reject) => {
        if (window.pdfjsLib) return resolve(window.pdfjsLib);
        const s = document.createElement('script');
        s.src = 'vendor/pdfjs-3.11.174.min.js';
        s.onload = () => {
            const lib = window.pdfjsLib;
            if (!lib) return reject(new Error('pdfjsLib absent'));
            lib.GlobalWorkerOptions.workerSrc = 'vendor/pdfjs-worker-3.11.174.min.js';
            resolve(lib);
        };
        s.onerror = () => reject(new Error('pdfjs non chargé'));
        document.head.appendChild(s);
    });
    return _pdfjsPromise;
}

// ---- Rendu PDF -> images pour le DOSSIER (option ②=B, pilote 16/09) ----

/** Rend toutes les pages de la VAC d'un terrain en JPEG (dataURL) prêts
 *  pour une page A5 du dossier de vol. null si VAC indisponible (hors
 *  ligne sans cache, terrain sans carte). Node (tests) : null.
 *  @returns {Promise<{airac:string, pages:[{data,w,h}]}|null>} */
export async function vacPageImages(icao, { pxHeight = 1400, quality = 0.85, win = null } = {}) {
    if (typeof document === 'undefined') return null;
    let v = null;
    try { v = await fetchVac(icao); } catch { return null; }
    if (!v) return null;
    // PIÈGE pdfjs (16/09) : page.render() SE SUSPEND ou REJETTE dans une
    // page MASQUÉE. Fenêtre hôte : celle qui est RÉELLEMENT VISIBLE au
    // moment du rendu — l'onglet popup s'il est au premier plan, SINON la
    // fenêtre courante (retour pilote 17/09 : en revenant sur l'app pendant
    // la génération, le popup passe masqué et les VAC des premiers terrains
    // disparaissaient du dossier). 2 essais, en basculant d'hôte.
    let host = (win && !win.closed && !win.document.hidden) ? win : window;
    for (let essai = 1; essai <= 2; essai++) {
        try {
            const lib = await _loadPdfjsIn(host);
            const data = new Uint8Array(await v.blob.arrayBuffer());
            const pdf = await lib.getDocument({ data }).promise;
            const pages = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const vp1 = page.getViewport({ scale: 1 });
                const scale = pxHeight / vp1.height;   // ~1 400 px de haut ≈ 170 dpi en A5
                const vp = page.getViewport({ scale });
                const canvas = host.document.createElement('canvas');
                canvas.width = Math.ceil(vp.width);
                canvas.height = Math.ceil(vp.height);
                await _renderAvecGarde(page, canvas, vp);
                pages.push({ data: canvas.toDataURL('image/jpeg', quality), w: vp.width, h: vp.height });
            }
            return { airac: v.airac, pages };
        } catch (e) {
            console.warn(`VAC ${icao} : rendu échoué (essai ${essai}, hôte ${host === window ? 'fenêtre' : 'popup'}) :`, String(e?.message || e).slice(0, 80));
            if (essai === 2) return null;
            host = (host === window && win && !win.closed) ? win : window;
            await new Promise(r => setTimeout(r, 400));
        }
    }
    return null;
}

/** page.render() avec garde-fou temps : une page masquée peut suspendre le
 *  rendu pdfjs indéfiniment — on rejette plutôt que de geler le dossier. */
function _renderAvecGarde(page, canvas, vp, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('rendu pdfjs expiré (page masquée ?)')), timeoutMs);
        page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise
            .then(() => { clearTimeout(t); resolve(); },
                  (e) => { clearTimeout(t); reject(e); });
    });
}

/** pdfjs dans une fenêtre donnée : la fenêtre courante via le chargeur
 *  existant ; une AUTRE fenêtre (l'onglet popup, about:blank même origine)
 *  par injection de script en URL ABSOLUE (pas de base URL dans about:blank). */
async function _loadPdfjsIn(win) {
    if (win === window) return _loadPdfjs();
    if (win.pdfjsLib) {
        win.pdfjsLib.GlobalWorkerOptions.workerSrc = `${location.origin}/vendor/pdfjs-worker-3.11.174.min.js`;
        return win.pdfjsLib;
    }
    await new Promise((resolve, reject) => {
        const s = win.document.createElement('script');
        s.src = `${location.origin}/vendor/pdfjs-3.11.174.min.js`;
        s.onload = resolve;
        s.onerror = () => reject(new Error('pdfjs non chargé dans la fenêtre hôte'));
        win.document.head.appendChild(s);
    });
    const lib = win.pdfjsLib;
    lib.GlobalWorkerOptions.workerSrc = `${location.origin}/vendor/pdfjs-worker-3.11.174.min.js`;
    return lib;
}

// ---- Visionneuse plein cadre -------------------------------------------------

let _ui = null;   // { overlay, canvas, container, pct, badge, icao, lib, pdf, page, scale, renderTask, pageNo, numPages }

/** Ouvre la visionneuse VAC du terrain (bouton fiche terrain). */
export async function openVac(icao) {
    const code = String(icao || '').toUpperCase();
    const isFr = state.lang === 'fr';

    let data = null;
    try { data = await fetchVac(code); } catch { data = null; }
    if (!data) return false;

    const lib = await _loadPdfjs().catch(() => null);
    if (!lib) { window.open(await vacUrl(code), '_blank', 'noopener'); return false; }
    const pdf = await lib.getDocument({ data: await data.blob.arrayBuffer() }).promise;
    _buildOverlay(code, pdf.numPages, data, isFr);
    _ui.pdf = pdf;
    await _showPage(1);
    _traceVacConsult(code);   // B1 : atteste la consultation (tuile Dossier de vol)
    // Tuile VAC du dossier (retour pilote 18/09) : mise à jour IMMÉDIATE.
    document.dispatchEvent(new CustomEvent('vac-consulted', { detail: { icao: code } }));
    return true;
}

// B1 (dossier de vol) : dernière consultation de chaque VAC — atteste que le
// pilote a ouvert la carte du terrain (localStorage, clé 'vac-consulted').
const LS_VAC_SEEN = 'vac-consulted';
function _traceVacConsult(icao) {
    try {
        const m = JSON.parse(localStorage.getItem(LS_VAC_SEEN) || '{}');
        m[String(icao).toUpperCase()] = Date.now();
        localStorage.setItem(LS_VAC_SEEN, JSON.stringify(m));
    } catch {   }
}
/** Date de dernière consultation de la VAC d'un terrain (ms), ou null. */
export function getVacConsultedTs(icao) {
    try {
        const m = JSON.parse(localStorage.getItem(LS_VAC_SEEN) || '{}');
        return m[String(icao || '').toUpperCase()] || null;
    } catch { return null; }
}

async function _showPage(n) {
    if (!_ui?.pdf) return;
    _ui.pageNo = Math.min(_ui.numPages, Math.max(1, n));
    _ui.page = await _ui.pdf.getPage(_ui.pageNo);
    if (_ui.pageLbl) _ui.pageLbl.textContent = `${_ui.pageNo}/${_ui.numPages}`;
    if (_ui.prev) { _ui.prev.disabled = _ui.pageNo <= 1; _ui.next.disabled = _ui.pageNo >= _ui.numPages; }
    await _zoomTo(null);   // ajustement hauteur : toute la carte visible
}

function _buildOverlay(code, numPages, data, isFr) {
    _closeVac();
    const ov = document.createElement('div');
    ov.id = 'vac-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:4000;background:var(--bg-color,#020617);display:flex;flex-direction:column;';
    const badge = data.stale
        ? (isFr ? `hors ligne · cycle ${data.airac}` : `offline · cycle ${data.airac}`)
        : (isFr ? (data.offline ? 'hors ligne' : 'enregistrée') : (data.offline ? 'offline' : 'stored'));
    const btn = (id, t, h, extra = '') => `<button data-vac="${id}" title="${t}" style="background:none;border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:6px;color:var(--text-color,#F8FAFC);height:28px;cursor:pointer;font-size:13px;font-weight:700;${extra}">${h}</button>`;
    ov.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;flex-wrap:wrap;">
            <i data-lucide="map" style="width:15px;height:15px;color:var(--primary,#38BDF8);"></i>
            <span style="font-weight:700;font-size:13.5px;color:var(--text-color,#F8FAFC);">${code}</span>
            <span style="font-size:11px;color:var(--text-muted,#94A3B8);">${isFr ? 'Carte VAC · Atterrissage à vue · SIA' : 'VAC · Visual approach · SIA'}</span>
            <span data-vac="badge" title="${isFr ? 'carte enregistrée sur cet appareil' : 'stored on this device'}" style="font-size:10px;font-weight:700;color:${data.offline ? '#2DD4BF' : 'var(--text-muted,#94A3B8)'};border:1px solid var(--border-color,rgba(255,255,255,.15));border-radius:4px;padding:2px 7px;">${badge}</span>
            <span style="flex:1;"></span>
            ${btn('out', isFr ? 'Ouvrir le PDF original' : 'Open original PDF', `<i data-lucide="external-link" style="width:13px;height:13px;"></i>`, 'padding:0 9px;display:flex;align-items:center;')}
            ${btn('minus', isFr ? 'Réduire' : 'Zoom out', '−', 'width:28px;')}
            <span data-vac="pct" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:42px;text-align:center;">100%</span>
            ${btn('plus', isFr ? 'Agrandir' : 'Zoom in', '+', 'width:28px;')}
            ${btn('close', isFr ? 'Fermer (Échap)' : 'Close (Esc)', '✕', 'width:28px;background:rgba(239,68,68,.12);border-color:rgba(239,68,68,.35);color:#EF4444;')}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:8px;padding:6px 12px;background:var(--panel-bg,#0F172A);border-bottom:1px solid var(--border-color,rgba(255,255,255,.15));flex:0 0 auto;">
            ${btn('prev', isFr ? 'Page précédente' : 'Previous page', '‹', 'width:26px;')}
            <span data-vac="pagelbl" style="font-family:'DM Mono',monospace;font-size:11px;color:var(--text-muted,#94A3B8);min-width:34px;text-align:center;">1/${numPages}</span>
            ${btn('next', isFr ? 'Page suivante' : 'Next page', '›', 'width:26px;')}
        </div>
        <div data-vac="container" style="flex:1;overflow:auto;display:flex;align-items:flex-start;padding:14px;">
            <canvas data-vac="canvas"></canvas>
        </div>`;
    document.body.appendChild(ov);
    if (window.lucide) window.lucide.createIcons({ root: ov });
    _ui = {
        overlay: ov, icao: code,
        canvas: ov.querySelector('[data-vac="canvas"]'),
        container: ov.querySelector('[data-vac="container"]'),
        pct: ov.querySelector('[data-vac="pct"]'),
        badge: ov.querySelector('[data-vac="badge"]'),
        prev: ov.querySelector('[data-vac="prev"]'),
        next: ov.querySelector('[data-vac="next"]'),
        pageLbl: ov.querySelector('[data-vac="pagelbl"]'),
        numPages, pageNo: 1,
        pdf: null, page: null, scale: null, renderTask: null,
    };
    ov.querySelector('[data-vac="close"]').addEventListener('click', _closeVac);
    ov.querySelector('[data-vac="out"]').addEventListener('click', async () => {
        window.open(await vacUrl(code), '_blank', 'noopener');
    });
    ov.querySelector('[data-vac="plus"]').addEventListener('click', () => _zoom(1.3));
    ov.querySelector('[data-vac="minus"]').addEventListener('click', () => _zoom(1 / 1.3));
    _ui.prev?.addEventListener('click', () => _showPage(_ui.pageNo - 1));
    _ui.next?.addEventListener('click', () => _showPage(_ui.pageNo + 1));
    ov.querySelector('[data-vac="container"]').addEventListener('wheel', (e) => {
        if (!e.ctrlKey) { e.preventDefault(); _zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15); }
    }, { passive: false });
    const onKey = (e) => {
        if (e.key === 'Escape') { _closeVac(); document.removeEventListener('keydown', onKey); }
        if (_ui && e.key === 'ArrowLeft') _showPage(_ui.pageNo - 1);
        if (_ui && e.key === 'ArrowRight') _showPage(_ui.pageNo + 1);
    };
    document.addEventListener('keydown', onKey);
}

function _zoom(f) {
    if (!_ui?.scale) return;
    _zoomTo(_ui.scale * f);
}

async function _zoomTo(scale) {
    if (!_ui?.page) return;
    const dpr = window.devicePixelRatio || 1;
    const availH = _ui.container.clientHeight - 28;   // padding 14 × 2
    const viewport1 = _ui.page.getViewport({ scale: 1 });
    // Ajusté à la HAUTEUR (retour pilote 06/09) : toute la carte VAC est
    // visible de haut en bas — le défilement horizontal montre les côtés.
    const fitH = availH / viewport1.height;
    if (scale == null) scale = fitH;
    scale = Math.min(8, Math.max(0.3, scale));
    _ui.scale = scale;
    const viewport = _ui.page.getViewport({ scale });
    const canvas = _ui.canvas;
    canvas.width = Math.round(viewport.width * dpr);
    canvas.height = Math.round(viewport.height * dpr);
    canvas.style.width = Math.round(viewport.width) + 'px';
    canvas.style.height = Math.round(viewport.height) + 'px';
    // Carte plus large que la fenêtre (paysage ajusté en hauteur) : le
    // centrage flex rendrait la gauche inaccessible au scroll — margin auto
    // centre quand ça tient, aligne à gauche quand ça déborde.
    canvas.style.display = 'block';
    canvas.style.margin = '0 auto';
    _ui.pct.textContent = Math.round((scale / fitH) * 100) + '%';
    // pdfjs interdit deux render() simultanés sur un même canvas : le
    // précédent est annulé, et le rendu est ATTENDU (les tests comme les
    // zooms rapides lisent le canvas avant la fin sinon).
    const ctx = canvas.getContext('2d');
    _ui.renderTask?.cancel();
    _ui.renderTask = _ui.page.render({ canvasContext: ctx, viewport, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
    await _ui.renderTask.promise.catch(() => {});
}

export function _closeVac() {
    if (_ui?.overlay?.parentNode) _ui.overlay.parentNode.removeChild(_ui.overlay);
    _ui = null;
}
