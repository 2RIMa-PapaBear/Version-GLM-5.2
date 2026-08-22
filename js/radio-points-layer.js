/* ================================================================
 * RADIO POINTS LAYER — couches carte des radiophares et points VFR
 * ================================================================
 *
 * Contrôleur de couches pour la carte régionale : VOR, NDB et points
 * de repère VFR issus de data/radio-points.json (cf. radio-points.js).
 *
 * Le bouton « Espaces » existant est promu en MENU DÉROULANT listant
 * toutes les couches (espaces aériens + VOR + NDB + points VFR) ; chaque
 * case (dé)cochée rafraîchit la carte immédiatement. Déclutter : sous
 * LAYER_MIN_ZOOM une couche n'affiche rien ; les étiquettes n'apparaissent
 * qu'à partir de LABEL_MIN_ZOOM (icône seule en dessous).
 *
 * Chaque point est utilisable comme WAYPOINT du plan de vol via son
 * popup (repère nommé du pipeline existant : enrichAirport + insertion
 * intelligente — cf. deps.createWaypoint).
 * ================================================================ */

import { state } from './core.js';
import { AIRSPACE_GROUPS } from './airspaces.js';
import {
    loadRadioPoints, filterBbox, visibleKinds,
    LABEL_MIN_ZOOM, LAYER_MAX_POINTS, formatFreq,
} from './radio-points.js';

const COLORS = { vor: '#60A5FA', ndb: '#4ADE80', vrp: '#86EFAC' };

const _esc = (s) => String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** Symboles conventionnels des cartes aéro (SIA/OACI) :
 *  VOR = hexagone + point central ; NDB = « goutte » (cercle + tige) ;
 *  point de repère VFR = triangle plein. */
function _icon(kind) {
    const c = COLORS[kind];
    const svg = kind === 'vor'
        ? `<polygon points="9,1 16.5,5.3 16.5,13.7 9,18 1.5,13.7 1.5,5.3" fill="none" stroke="${c}" stroke-width="1.8"/>`
            + `<circle cx="9" cy="9" r="1.4" fill="${c}"/>`
        : kind === 'ndb'
            ? `<path d="M9 0.8 L9 6" stroke="${c}" stroke-width="1.6"/>`            // tige
                + `<circle cx="9" cy="11" r="5.2" fill="none" stroke="${c}" stroke-width="1.8"/>`
                + `<circle cx="9" cy="11" r="1.6" fill="${c}"/>`
            : `<path d="M9 1.5 L16 14 L2 14 Z" fill="none" stroke="${c}" stroke-width="1.8" stroke-linejoin="round"/>`
                + `<path d="M9 5.2 L13.3 12.4 L4.7 12.4 Z" fill="${c}" opacity="0.5"/>`;
    return L.divIcon({
        className: 'rp-marker rp-' + kind,
        html: `<svg width="18" height="18" viewBox="0 0 18 18" style="display:block;overflow:visible">${svg}</svg>`,
        iconSize: [18, 18],
        iconAnchor: [9, 9],
    });
}

export function createRadioPointsController(map, deps = {}) {
    let data = null, loadPromise = null;
    let layerGroup = null;
    const enabled = { vor: false, ndb: false, vrp: false };
    let refreshTimer = null;
    let menuEl = null;

    const isFr = () => state.lang === 'fr';
    const anyEnabled = () => enabled.vor || enabled.ndb || enabled.vrp;

    function ensureLayer() {
        layerGroup ??= L.layerGroup().addTo(map);
        return layerGroup;
    }

    function ensureData() {
        if (data) return Promise.resolve(data);
        loadPromise ??= loadRadioPoints().then((d) => { data = d; return d; }).catch(() => null);
        return loadPromise;
    }

    function popupHtml(kind, it) {
        const fr = isFr();
        const parts = [];
        if (kind === 'vrp') {
            parts.push(`<div class="fw-title"><strong>${_esc(it.name)}</strong></div>`);
            parts.push(`<div style="font-size:11px;color:var(--text-muted,#94A3B8);">${fr ? 'Point de repère VFR' : 'VFR reporting point'}${it.cc ? ' · ' + _esc(it.cc) : ''}</div>`);
        } else {
            parts.push(`<div class="fw-title"><strong style="color:${COLORS[kind]};">${_esc(it.ident)}</strong></div>`);
            parts.push(`<div style="font-size:11px;color:var(--text-muted,#94A3B8);">${kind === 'vor' ? 'VOR' + (fr ? ' · DME colocalisé le cas échéant' : ' · co-located DME if any') : 'NDB'}</div>`);
            if (it.freq != null) parts.push(`<div style="font-family:'DM Mono',monospace;font-size:12px;">${_esc(formatFreq(it.freq, kind === 'ndb' ? 1 : 2))}</div>`);
        }
        const wpName = kind === 'vrp' ? it.name : `${it.ident} (${kind === 'vor' ? 'VOR' : 'NDB'})`;
        parts.push(`<div class="mp-btns"><button class="rp-wp-btn" data-lat="${it.lat}" data-lon="${it.lon}" data-name="${_esc(wpName)}" title="${fr ? 'Ajouter comme waypoint du plan de navigation' : 'Add as waypoint to the flight plan'}">+ Waypoint</button></div>`);
        return `<div class="fw-inner">${parts.join('')}</div>`;
    }

    function refresh() {
        if (!layerGroup) return;
        layerGroup.clearLayers();               // toujours effacer, même si
        if (!anyEnabled() || !data) return;     // plus aucune couche active
        const zoom = map.getZoom();
        const kinds = visibleKinds(zoom);
        const b = map.getBounds().pad(0.2);
        for (const kind of ['vor', 'ndb', 'vrp']) {
            if (!enabled[kind] || !kinds[kind]) continue;
            let pts = filterBbox(data[kind], b.getWest(), b.getSouth(), b.getEast(), b.getNorth());
            if (pts.length > LAYER_MAX_POINTS[kind]) pts = pts.slice(0, LAYER_MAX_POINTS[kind]);
            const withLabels = zoom >= LABEL_MIN_ZOOM[kind];
            for (const it of pts) {
                const m = L.marker([it.lat, it.lon], {
                    icon: _icon(kind),
                    keyboard: false,
                    zIndexOffset: kind === 'vrp' ? -200 : 0,
                });
                if (withLabels) {
                    // Encadrés façon carte aéro : ident sur fréquence pour
                    // les radiophares, nom en italique pour les repères.
                    const labelHtml = kind === 'vor'
                        ? `${_esc(it.ident)}<br><span class="rp-freq">${_esc(formatFreq(it.freq, 2))}</span>`
                        : kind === 'ndb'
                            ? `${_esc(it.ident)}<br><span class="rp-freq">${_esc(formatFreq(it.freq, 1))}</span>`
                            : `<i>${_esc(it.name)}</i>`;
                    m.bindTooltip(labelHtml, { permanent: true, direction: 'right', className: 'rp-label rp-label-' + kind });
                } else {
                    m.bindTooltip(_esc(kind === 'vrp' ? it.name : it.ident), { direction: 'top' });
                }
                m.bindPopup(() => popupHtml(kind, it), { maxWidth: 250 });
                m.addTo(layerGroup);
            }
        }
    }

    function scheduleRefresh() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { ensureData().then(refresh); }, 200);
    }

    function setKind(kind, on) {
        enabled[kind] = !!on;
        if (on) { ensureLayer(); ensureData().then(refresh); }
        else if (layerGroup) refresh();
    }

    // Popup « + Waypoint » : le contenu du popup est recréé à chaque
    // ouverture, on binde le bouton sur l'évènement popupopen (comme les
    // popups aérodromes de regional-map.js).
    map.on('popupopen', (e) => {
        const btn = e.popup?.getElement()?.querySelector?.('.rp-wp-btn');
        if (!btn) return;
        btn.addEventListener('click', () => {
            map.closePopup();
            deps.createWaypoint?.(+btn.dataset.lat, +btn.dataset.lon, btn.dataset.name);
        });
    });

    // ---- Menu déroulant greffé sur le bouton « Espaces » ----
    function mountControls(bar) {
        const oldBtn = bar.querySelector('.precip-toggle-airspaces');
        if (!oldBtn || bar.querySelector('.rp-menu')) return;

        // Clone le bouton pour retirer son listener direct (bascule) :
        // le clic ouvre désormais le menu des couches.
        const btn = oldBtn.cloneNode(true);
        btn.setAttribute('aria-haspopup', 'true');
        btn.setAttribute('aria-expanded', 'false');
        oldBtn.replaceWith(btn);
        const group = btn.closest('.precip-control-group') || btn.parentElement;
        group.style.position = 'relative';

        menuEl = document.createElement('div');
        menuEl.className = 'rp-menu';
        menuEl.style.cssText = 'display:none;position:absolute;top:calc(100% + 6px);left:0;min-width:170px;'
            + 'background:var(--input-bg,#0F172A);border:1px solid var(--border-color,#334155);border-radius:10px;'
            + 'padding:6px;z-index:1200;box-shadow:0 8px 24px rgba(0,0,0,.45);font-size:12px;color:var(--text-color,#E2E8F0);';
        menuEl.innerHTML = _menuHtml();
        group.appendChild(menuEl);

        const close = () => { menuEl.style.display = 'none'; btn.setAttribute('aria-expanded', 'false'); };
        const open = () => { _syncFromState(); menuEl.style.display = 'block'; btn.setAttribute('aria-expanded', 'true'); };
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            menuEl.style.display === 'block' ? close() : open();
        });
        document.addEventListener('click', (e) => {
            if (menuEl.style.display !== 'block') return;
            if (!menuEl.contains(e.target) && !btn.contains(e.target)) close();
        });
        document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

        menuEl.addEventListener('change', (e) => {
            const kind = e.target?.dataset?.rpKind;
            if (kind) { setKind(kind, e.target.checked); return; }
            const group = e.target?.dataset?.rpAirgroup;
            if (group && deps.airspace) { deps.airspace.setGroup(group, e.target.checked); return; }
            if (e.target?.dataset?.rpAirspaces != null && deps.airspace) {
                deps.airspace.toggle(e.target.checked);
            }
        });
    }

    function _menuHtml() {
        const fr = isFr();
        const row = (attrs, label, color) => `
            <label style="display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;">
                <input type="checkbox" ${attrs} style="accent-color:${color};width:14px;height:14px;cursor:pointer;">
                <span>${label}</span>
            </label>`;
        const subRow = (attrs, label, color) => `
            <label style="display:flex;align-items:center;gap:7px;padding:3px 8px 3px 26px;border-radius:6px;cursor:pointer;white-space:nowrap;font-size:11px;">
                <input type="checkbox" ${attrs} style="accent-color:${color};width:12px;height:12px;cursor:pointer;">
                <span>${label}</span>
                <span style="width:8px;height:8px;border-radius:2px;background:${color};opacity:.8;margin-left:auto;"></span>
            </label>`;
        let html = row('data-rp-airspaces="1"', fr ? 'Espaces aériens' : 'Airspaces', '#38BDF8');
        for (const [g, def] of Object.entries(AIRSPACE_GROUPS)) {
            html += subRow(`data-rp-airgroup="${g}"`, fr ? def.label : def.en, def.color);
        }
        return html
            + row('data-rp-kind="vor"', 'VOR', COLORS.vor)
            + row('data-rp-kind="ndb"', 'NDB', COLORS.ndb)
            + row('data-rp-kind="vrp"', fr ? 'Points VFR' : 'VFR points', COLORS.vrp)
            + `<div style="padding:4px 8px 2px;font-size:9px;color:var(--text-muted,#94A3B8);border-top:1px solid var(--border-color,#334155);margin-top:4px;">openAIP · ${fr ? 'maj' : 'upd'} <span class="rp-date">—</span></div>`;
    }

    function _syncFromState() {
        const cb = menuEl?.querySelector('[data-rp-airspaces]');
        if (cb && deps.airspace) cb.checked = !!deps.airspace.visible;
        if (deps.airspace?.getGroups) {
            const groups = deps.airspace.getGroups();
            for (const g of Object.keys(groups)) {
                const el = menuEl?.querySelector(`[data-rp-airgroup="${g}"]`);
                if (el) el.checked = groups[g];
            }
        }
        for (const k of ['vor', 'ndb', 'vrp']) {
            const el = menuEl?.querySelector(`[data-rp-kind="${k}"]`);
            if (el) el.checked = enabled[k];
        }
        const d = menuEl?.querySelector('.rp-date');
        if (d) d.textContent = data?.generatedAt ? data.generatedAt.slice(0, 10) : '…';
    }

    map.on('moveend', scheduleRefresh);
    map.on('zoomend', scheduleRefresh);

    return {
        mountControls,
        setKind,
        refresh,
        get enabled() { return { ...enabled }; },
        destroy() {
            clearTimeout(refreshTimer);
            map.off('moveend', scheduleRefresh);
            map.off('zoomend', scheduleRefresh);
            if (layerGroup) { map.removeLayer(layerGroup); layerGroup = null; }
            menuEl?.remove();
            menuEl = null;
        },
    };
}
