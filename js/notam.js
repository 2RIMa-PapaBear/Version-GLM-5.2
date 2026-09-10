/* ================================================================
 * NOTAM — Dossier NOTAM officiel SOFIA-Briefing pour le plan de vol
 * ================================================================
 * (Test local 10/09 — feu vert pilote pour l'expérimentation, aucune
 * diffusion sans sa décision.)
 *
 * SOURCE : l'API interne de SOFIA-Briefing (portail NOTAM officiel du
 * SIA), via le relais Cloudflare en POST /notam (le Worker joue la
 * session et l'opération postNarrowRoutePibRequest — contrat complet
 * en mémoire projet : notam-sofia-api). Le PIB JSON renvoyé contient
 * les NOTAM triés par terrain (départ / dégagements / survolés) et par
 * famille officielle, avec ligne Q décodée, validités et item E.
 *
 * RENDU : panneau repliable monté sous le planificateur (mode
 * Navigation) — résumé du plan + bouton « Rechercher » (NOTAM frais à
 * chaque demande, jamais cachés).
 * ================================================================ */
import { config } from './config.js';
import { getAirportByICAO, getAirportsInBbox } from './ui-module.js';
import { state } from './core.js';
import { makeCollapsible } from './collapsible.js';

const isFr = () => state.lang === 'fr';

// Familles officielles SOFIA → libellés pilotes (FR/EN).
const CATS = () => (isFr() ? {
    aerodromes_services: 'Aérodrome & services',
    aire_mouvement: 'Aires de mouvement',
    aire_trafic: 'Circulation aérienne',
    balisage: 'Balisage',
    aides_atter_instal_radionav_GNSS: 'Aides à l\'atterrissage / radionav / GNSS',
    procedures: 'Procédures',
    organisation_espace_services_circulation: 'Organisation de l\'espace & services',
    meteorologie_equipements: 'Météo & équipements',
    reglementation_espace_aerien: 'Réglementation de l\'espace aérien',
    avertissements_navigation: 'Avertissements navigation',
    obstacles: 'Obstacles',
    autres_info: 'Autres informations',
} : {
    aerodromes_services: 'Aerodrome & services',
    aire_mouvement: 'Movement areas',
    aire_trafic: 'Air traffic',
    balisage: 'Lighting',
    aides_atter_instal_radionav_GNSS: 'Landing aids / radionav / GNSS',
    procedures: 'Procedures',
    organisation_espace_services_circulation: 'Airspace organisation & services',
    meteorologie_equipements: 'Weather & equipment',
    reglementation_espace_aerien: 'Airspace regulations',
    avertissements_navigation: 'Navigation warnings',
    obstacles: 'Obstacles',
    autres_info: 'Other information',
});

// Catégories spécifiques au groupe FIR (jeu officiel SOFIA, cf firNotams.js).
const CATS_FIR = () => (isFr() ? {
    organisation_espace_procedures: 'Organisation de l’espace & procédures',
    services_circulation_aerienne_VOLMET: 'Services circulation aérienne / VOLMET',
    installations_com_surveillance: 'Installations communication & surveillance',
    GNSS_installations_radionav: 'GNSS & installations radionav',
    reglementation_espace_aerien: 'Réglementation de l’espace aérien',
    avertissements_navigation: 'Avertissements navigation',
    obstacles: 'Obstacles',
    autres_info: 'Autres informations',
} : {
    organisation_espace_procedures: 'Airspace organisation & procedures',
    services_circulation_aerienne_VOLMET: 'ATC services / VOLMET',
    installations_com_surveillance: 'Communication & surveillance facilities',
    GNSS_installations_radionav: 'GNSS & radionavigation facilities',
    reglementation_espace_aerien: 'Airspace regulations',
    avertissements_navigation: 'Navigation warnings',
    obstacles: 'Obstacles',
    autres_info: 'Other information',
});

// Groupes RÉELS du PIB (retour pilote 10/09 : il manquait Arrivée et FIR).
const GROUPS = () => (isFr() ? {
    ADDep: 'Départ', ADDes: 'Arrivée', ADDeg: 'Dégagements', ADSur: 'Survollés',
    FIR: 'En route (FIR)', Other: 'Autres zones',
} : {
    ADDep: 'Departure', ADDes: 'Destination', ADDeg: 'Alternates', ADSur: 'En route',
    FIR: 'En route (FIR)', Other: 'Other areas',
});

/** NOTAM VFR ? (garde client : SOFIA filtre déjà via traffic=V). */
export function isVfrNotam(n) {
    const t = String(n?.qLine?.traffic || '').toUpperCase();
    return !t || t.includes('V');
}

/** Titre court d'un NOTAM : « P 3953/25 · OBST ». */
export function notamTitle(n) {
    const q = n.qLine?.code23 || '';
    return `${n.series || ''} ${n.number || ''}/${String(n.year || '').slice(-2)}${q ? ' · ' + q : ''}`.trim();
}

/** Validité lisible : « 25 11 2025 14:01 → 25 09 2026 19:00 (0600-1900) ». */
export function notamPeriod(n) {
    const fmt = (iso) => {
        if (!iso) return '';
        const d = new Date(iso);
        const p = (x) => String(x).padStart(2, '0');
        return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}Z`;
    };
    let s = n.startValidityFormat || fmt(n.startValidity);
    const fin = n.endValidityFormat || fmt(n.endValidity);
    s = `${s || '?'} → ${fin || '?'}`;
    if (n.itemD && n.itemD.trim()) s += ` (${n.itemD.trim()})`;
    return s;
}

/** Corps lisible : traduction FR si dispo, sinon l'original. */
export function notamBody(n) {
    return (n.multiLanguage && n.multiLanguage.itemE) || n.itemE || '';
}

/** Aplatit une catégorie FIR (imbriquée : terrains impactés → purpose → notam). */
export function flattenFirList(list) {
    const out = [];
    for (const entry of list || []) {
        for (const ad of entry.sortedNotamsByImpactedAerodromes || []) {
            for (const p of ad.sortedNotamsByPurpose || []) {
                for (const n of p.notam || []) out.push(n);
            }
        }
    }
    return out;
}

/** Construit le payload relais depuis l'état du plan (pur, testable). */
export function buildPibRequest(route, opts = {}) {
    const clean = (route || []).map(c => String(c || '').toUpperCase().trim())
        .filter(c => /^[A-Z][A-Z0-9]{3}$/.test(c));
    return {
        route: clean,
        validFrom: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        durationMin: opts.durationMin || 1200,
        traffic: 'V',
        flLower: opts.flLower ?? 0,
        flUpper: opts.flUpper ?? 999,
        widthNm: opts.widthNm || 15,
        radiusAdNm: opts.radiusAdNm || 30,
    };
}

/** Degrés décimaux → format SOFIA « 4739N » / « 00243W » (pur, testé). */
export function decToSofiaDms(lat, lon) {
    const fmt = (v, pos, neg, pad) => {
        const hemi = v >= 0 ? pos : neg;
        const a = Math.abs(v);
        let d = Math.floor(a);
        let m = Math.round((a - d) * 60);
        if (m === 60) { d += 1; m = 0; }
        return String(d).padStart(pad, '0') + String(m).padStart(2, '0') + hemi;
    };
    return { lat: fmt(lat, 'N', 'S', 2), long: fmt(lon, 'E', 'W', 3) };
}

/** Terrains à moins de radiusNm du centre, triés par distance (pur, testé).
 * Retourne le centre en tête + ses voisins — chaîne pour les appels legs,
 * chaque tronçon rapportant le dossier du terrain de départ. */
export function airfieldsWithinNm(centerLat, centerLon, radiusNm, allAirports, max = 10) {
    const R = 3440.1;   // rayon terrestre en NM
    const toRad = (d) => d * Math.PI / 180;
    const dist = (a, b) => {
        const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon);
        const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
        return 2 * R * Math.asin(Math.sqrt(h));
    };
    const centre = { lat: centerLat, lon: centerLon };
    const proches = (allAirports || [])
        .filter(a => Number.isFinite(a.lat) && Number.isFinite(a.lon) && a.icao)
        .map(a => ({ a, d: dist(centre, a) }))
        .filter(x => x.d <= radiusNm)
        .sort((x, y) => x.d - y.d)
        .slice(0, max);
    return proches.map(x => x.a.icao);
}

/** Legs [A,B] pour les points de passage intermédiaires (purs, testable). */
export function waypointLegs(route) {
    const clean = (route || []).filter(Boolean);
    return clean.length > 2
        ? clean.slice(1, -1).map((_, i) => [clean[i + 1], clean[i + 2]])
        : [];
}

/** Appelle le relais NOTAM → PIB JSON complet ({ error } si échec). */
export async function fetchRoutePib(req) {
    try {
        const res = await fetch(config.NOTAM_RELAY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...req, legs: waypointLegs(req.route) }),
        });
        const data = await res.json();
        if (!res.ok || data.error) return { error: data.error || `relais HTTP ${res.status}` };
        return data;
    } catch (e) {
        return { error: isFr() ? 'Relais NOTAM injoignable' : 'NOTAM relay unreachable' };
    }
}

/** Liste plate annotée [{n, _grp, _icao}] des NOTAM affichés (pour le PDF). */
export function collectFlat(pib, planRoute = []) {
    const isFrL = isFr();
    const groups = GROUPS();
    const dep = planRoute[0], arr = planRoute[planRoute.length - 1];
    const out = [];
    const push = (gLabel, list) => { for (const n of list || []) { n._grp = gLabel; out.push(n); } };
    push(dep ? `${groups.ADDep} ${dep}` : groups.ADDep, flatVfr(pib.listnotams?.ADDep));
    push(groups.FIR, flatVfrFir(pib.listnotams?.FIR));
    for (const [icao, dos] of Object.entries(pib.waypointDossiers || {}))
        push(icao, flatVfr(dos));
    push(arr && arr !== dep ? `${groups.ADDes} ${arr}` : groups.ADDes, flatVfr(pib.listnotams?.ADDes));
    return out;
}
const flatVfr = (grp) => Object.values(grp || {}).filter(Array.isArray).flat().filter(isVfrNotam);
const flatVfrFir = (grp) => flattenFirList(Object.values(grp || {}).filter(Array.isArray).flat()).filter(isVfrNotam);

/** Liste plate annotée pour le dossier LOCAL (zone 30 NM). */
export function collectFlatLocal(pib, planRoute = []) {
    const groups = GROUPS_LOCAL();
    const icao = planRoute[0];
    const out = [];
    const push = (gLabel, list) => { for (const n of list || []) { n._grp = gLabel; out.push(n); } };
    push(icao ? `${groups.ADSur} ${icao}` : groups.ADSur, flatVfr(pib.listnotams?.ADSur));
    push(groups.FIR, flatVfrFir(pib.listnotams?.FIR));
    push(groups.Other, flatVfr(pib.listnotams?.Other));
    return out;
}

let _flat = [];   // dernier dossier rendu (annoté)

/** NOTAM cochés pour l'annexe du log de nav PDF — [] si dossier jamais affiché. */
export function getSelectedNotams() {
    const boxes = document.querySelectorAll('#notam-results .notam-ckb');
    if (!boxes.length) return [];
    const ids = new Set();
    boxes.forEach(b => { if (b.checked) ids.add(b.dataset.nid); });
    return _flat.filter(n => ids.has(String(n.id)));
}

const GROUPS_LOCAL = () => (isFr() ? {
    ADSur: 'Zone 30 NM', FIR: 'En route (FIR)', Other: 'Autres zones',
    ADDep: 'Départ', ADDes: 'Arrivée', ADDeg: 'Dégagements',
} : {
    ADSur: '30 NM zone', FIR: 'En route (FIR)', Other: 'Other areas',
    ADDep: 'Departure', ADDes: 'Destination', ADDeg: 'Alternates',
});

/** Dossier NOTAM « vol local » : cylindre 30 NM autour du terrain observé. */
export async function fetchZonePib(icao, lat, lon, opts = {}) {
    const dms = decToSofiaDms(lat, lon);
    // Dossiers de TOUS les terrains de la zone (retour pilote 10/09) :
    // l'anneau est chaîné, chaque tronçon rapporte le dossier de son départ.
    const ring = opts.ring || [icao];
    const legs = ring.length > 1
        ? ring.slice(0, -1).map((a, i) => [a, ring[i + 1]])
        : [];
    try {
        const res = await fetch(config.NOTAM_RELAY_URL, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...buildPibRequest([icao], opts), route: ring,
                legs, area: { lat: dms.lat, long: dms.long, radiusNm: opts.radiusNm || 30 } }),
        });
        const data = await res.json();
        if (!res.ok || data.error) return { error: data.error || `relais HTTP ${res.status}` };
        return data;
    } catch (e) {
        return { error: isFr() ? 'Relais NOTAM injoignable' : 'NOTAM relay unreachable' };
    }
}

// ---- Rendu --------------------------------------------------------------------
let _panel = null, _body = null;

function _notamHtml(n) {
    const body = notamBody(n).replace(/</g, '&lt;');
    const loc = n.itemA && n.itemA !== n.sectionCode ? `<span style="color:#7DD3FC;font-size:10px;">${n.itemA}</span>` : '';
    return `<li style="margin:0 0 10px 0;">
        <div style="display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;">
            <input type="checkbox" checked class="notam-ckb" data-nid="${n.id}" title="${isFr() ? 'Inclure dans le log de nav PDF' : 'Include in the nav log PDF'}" style="accent-color:#38BDF8;">
            <b style="font-family:'DM Mono',monospace;font-size:12px;">${notamTitle(n)}</b>${loc}
            <span style="color:#94A3B8;font-size:11px;">${notamPeriod(n)}</span>
        </div>
        <div style="white-space:pre-wrap;font-size:12px;margin-top:2px;">${body}</div>
    </li>`;
}

function _renderPib(pib, planRoute = [], opts = {}) {
    const local = !!opts.local;
    const t = isFr();
    const aucun = t ? 'aucun NOTAM VFR' : 'no VFR NOTAM';
    let html = `<p style="font-size:11px;color:var(--text-muted);margin:4px 0 8px;">
        ${t ? 'Dossier généré par SOFIA-Briefing (SIA)' : 'Bulletin from SOFIA-Briefing (SIA)'} ·
        ${pib.nbNotams ?? '?'} NOTAM · ${t ? 'valide de' : 'valid'} ${pib.validFrom || ''} ${t ? 'à' : 'to'} ${pib.validTo || ''}
    </p>`;
    const cats = { ...CATS(), ...CATS_FIR() }, groups = local ? GROUPS_LOCAL() : GROUPS();
    // Ordre du VOL (retour pilote 10/09) : Départ → Points de passage → Arrivée
    // → En route → Dégagements → Survollés → Autres. Départ/Arrivée TOUJOURS
    // affichés avec leur code OACI, même sans NOTAM.
    const dep = planRoute[0], arr = planRoute[planRoute.length - 1];
    // Bloc points de passage (calculé ici pour l'insérer à sa place dans le vol)
    const wps = pib.waypointDossiers || {};
    const wpKeys = Object.keys(wps);
    let wpHtml = '';
    if (wpKeys.length) {
        wpHtml += `<h4 style="font-size:12px;margin:10px 0 4px;">${local ? (t ? 'Terrains dans la zone (30 NM)' : 'Airfields in the zone (30 NM)') : (t ? 'Points de passage' : 'Waypoints')}</h4>`;
        for (const icao of wpKeys) {
            const dos = wps[icao] || {};
            const vfr2 = {};
            let tot2 = 0;
            for (const [cat, list] of Object.entries(dos)) {
                const kept = (Array.isArray(list) ? list : []).filter(isVfrNotam);
                if (kept.length) { vfr2[cat] = kept; tot2 += kept.length; }
            }
            wpHtml += `<details style="margin:2px 0;">
                <summary style="cursor:pointer;font-size:11px;font-weight:600;color:var(--primary);display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" checked class="notam-cat-ckb" style="accent-color:#38BDF8;" ${tot2 ? '' : 'disabled'}>
                    <span>${icao} — ${tot2 || aucun}</span>
                </summary>
                ${tot2 ? `<ul style="list-style:none;padding-left:2px;">${Object.values(vfr2).flat().map(_notamHtml).join('')}</ul>` : ''}
            </details>`;
        }
    }
    const ordre = [];
    if (local) {
        // Ordre pilote 10/09 : dossier des TERRAINS de la zone (l AD observé
        // en tête d anneau) puis zones/FIR du rayon 30 NM.
        ordre.push(['__WP__', null]);
        ordre.push(['FIR', groups.FIR], ['Other', groups.Other]);
    } else {
        if (dep) ordre.push(['ADDep', `${groups.ADDep} ${dep}`]);
        ordre.push(['FIR', groups.FIR]);            // ordre pilote : le FIR suit le départ
        ordre.push(['__WP__', null]);               // puis les points de passage
        if (arr && arr !== dep) ordre.push(['ADDes', `${groups.ADDes} ${arr}`]);
        ordre.push(['ADDeg', groups.ADDeg], ['ADSur', groups.ADSur], ['Other', groups.Other]);
    }
    for (const [gKey, gLabel] of ordre) {
        if (gKey === '__WP__') { html += wpHtml; continue; }
        const group = pib.listnotams?.[gKey];
        const vfr = {};
        let total = 0;
        for (const [cat, list] of Object.entries(group || {})) {
            if (!Array.isArray(list)) continue;
            const kept = (gKey === 'FIR' ? flattenFirList(list) : list).filter(isVfrNotam);
            if (kept.length) { vfr[cat] = kept; total += kept.length; }
        }
        // Annoter pour l'annexe PDF (groupe + terrain concerné)
        for (const kept of Object.values(vfr))
            for (const n of kept) { n._grp = gLabel; n._icao = n.sectionCode || ''; }
        const toujours = !local && (gKey === 'ADDep' || gKey === 'ADDes');
        if (!total && !toujours) continue;
        html += `<h4 style="font-size:12px;margin:10px 0 4px;">${gLabel} — ${total || aucun}</h4>`;
        for (const [cat, list] of Object.entries(vfr)) {
            html += `<details style="margin:2px 0;">
                <summary style="cursor:pointer;font-size:11px;font-weight:600;color:var(--primary);display:flex;align-items:center;gap:6px;">
                    <input type="checkbox" checked class="notam-cat-ckb" style="accent-color:#38BDF8;">
                    <span>${cats[cat] || cat} (${list.length})</span>
                </summary>
                <ul style="list-style:none;padding-left:2px;">${list.map(_notamHtml).join('')}</ul>
            </details>`;
        }
    }
    return html;
}

/** FL du plan (ft → FL) avec marge de montée ; 999 si champ vide. */
export function planFlUpper() {
    const v = parseInt(document.getElementById('fp-cruise-alt')?.value || '', 10);
    if (!Number.isFinite(v) || v <= 0) return 999;
    return Math.ceil(v / 100) + 10;
}

async function _search(body, planRoute) {
    const tr = isFr();
    body.innerHTML = `<p style="font-size:12px;">${tr ? 'Recherche du dossier NOTAM…' : 'Fetching NOTAM…'}</p>`;
    const local = !!planRoute._local;
    const route = local ? planRoute.icaos : planRoute;
    let pib;
    if (local) {
        const { _lat: lat, _lon: lon } = planRoute;
        let ring = airfieldsWithinNm(lat, lon, 30,
            getAirportsInBbox(lat - 0.6, lon - 0.75, lat + 0.6, lon + 0.75));
        if (!ring.includes(route[0])) ring.unshift(route[0]);
        if (ring.length === 1) {
            // Aucun voisin à 30 NM (ou base encore en chargement) : un tronçon
            // vers le terrain CONNU le plus proche suffit — seul le dossier du
            // DÉPART du tronçon (le centre) nous intéresse.
            const proches = airfieldsWithinNm(lat, lon, 150,
                getAirportsInBbox(lat - 2.5, lon - 3, lat + 2.5, lon + 3), 4)
                .filter(i => i !== route[0]);
            if (proches.length) ring.push(proches[0]);
        }
        pib = await fetchZonePib(route[0], lat, lon, { flUpper: planFlUpper(), ring });
    } else {
        pib = await fetchRoutePib(buildPibRequest(route, { flUpper: planFlUpper() }));
    }
    if (pib.error) {
        body.innerHTML = `<p style="font-size:12px;color:#F87171;">${tr ? 'Erreur : ' : 'Error: '}${pib.error}</p>`;
        return;
    }
    _flat = local ? collectFlatLocal(pib, route) : collectFlat(pib, route);
    const rendered = _renderPib(pib, route, { local });
    const again = document.createElement('button');
    again.className = 'btn-primary';
    again.style.cssText = 'margin:8px 0;padding:6px 12px;font-size:12px;';
    again.textContent = tr ? 'Actualiser' : 'Refresh';
    body.innerHTML = rendered;
    const counter = document.createElement('p');
    counter.id = 'notam-pdf-counter';
    counter.style.cssText = 'font-size:11px;color:var(--text-muted);margin:6px 0 0;';
    body.appendChild(counter);
    const majCounter = () => {
        const sel = getSelectedNotams().length;
        counter.textContent = isFr()
            ? `${sel}/${_flat.length} NOTAM cochés → inclus dans le « log de nav » PDF`
            : `${sel}/${_flat.length} NOTAM checked → included in the nav log PDF`;
    };
    const syncCat = (catBox) => {
        const boxes = [...catBox.closest('details').querySelectorAll('.notam-ckb')];
        const checked = boxes.filter(b => b.checked).length;
        catBox.checked = checked > 0 && checked === boxes.length;
        catBox.indeterminate = checked > 0 && checked < boxes.length;
    };
    body.addEventListener('change', (e) => {
        const t = e.target;
        if (t.classList?.contains('notam-cat-ckb')) {
            // La catégorie bascule TOUS ses NOTAM d'un coup (retour pilote 10/09)
            t.closest('details').querySelectorAll('.notam-ckb').forEach(b => { b.checked = t.checked; });
            t.indeterminate = false;
        } else if (t.classList?.contains('notam-ckb')) {
            const cat = t.closest('details')?.querySelector('.notam-cat-ckb');
            if (cat) syncCat(cat);
        } else return;
        majCounter();
    });
    body.addEventListener('click', (e) => {
        // Case catégorie DANS le <summary> : la spec HTML n'active pas le
        // repli quand le clic porte sur un élément interactif (input) — on
        // stoppe juste la propagation par sécurité, la case se coche
        // nativement, le <details> ne bouge jamais.
        if (e.target.classList?.contains('notam-cat-ckb')) e.stopPropagation();
    }, true);
    majCounter();
    body.appendChild(again);
    again.addEventListener('click', () => _search(body, planRoute));
}

function _routeFromApp() {
    // MODE NAVIGATION : state.route (multi-étapes, rempli au calcul du plan)
    // sinon les champs — le terrain observé sert de repli de départ. SANS
    // panneau de plan (mode vol local), les champs affichent le terrain
    // observé : ne PAS en fabriquer un plan → dossier zone 30 NM.
    // NB : le panneau existe mais CACHÉ (display:none) en vol local —
    // offsetParent le distingue d'un vrai plan affiché.
    const fp = document.getElementById('flight-planner-panel');
    const hasPlanner = !!fp && fp.offsetParent !== null;
    let arr = hasPlanner
        ? (Array.isArray(state.route) && state.route.length
            ? state.route
            : [document.getElementById('route-from-display')?.textContent, document.getElementById('route-to-input')?.value])
        : [];
    arr = arr.map(c => String(c || '').trim()).filter(c => c && c !== '—' && c !== '-');
    if (arr.length === 1 && state.requestedIcao) arr = [state.requestedIcao, arr[0]];
    // MODE VOL LOCAL : pas de plan actif → dossier zone 30 NM autour du terrain
    // observé (coordonnées : base airports locale).
    if (!arr.length) {
        const icao = state.requestedIcao;
        if (!icao) return [];
        const apt = getAirportByICAO(icao);
        if (!apt || !Number.isFinite(apt.lat) || !Number.isFinite(apt.lon)) return [];
        return { _local: true, icaos: [icao], _lat: apt.lat, _lon: apt.lon };
    }
    return arr;
}

function _mount() {
    if (_panel) return;
    const tr = isFr();
    const planner = document.getElementById('flight-planner-panel');
    let host, title;
    if (planner && planner.parentElement) {
        host = planner.nextSibling;
        title = 'NOTAM (SOFIA)';
    } else {
        // MODE VOL LOCAL (retour pilote 10/09) : panneau sous le tableau de
        // bord météo, dossier zone 30 NM autour du terrain observé.
        const dash = document.getElementById('metar-dashboard');
        if (!dash || !dash.parentElement || !state.requestedIcao) return;
        host = dash.nextSibling;
        title = 'NOTAM (SOFIA)';
    }
    _panel = document.createElement('aside');
    _panel.id = 'notam-panel';
    _panel.className = 'card';
    host.parentElement.insertBefore(_panel, host);
    _body = makeCollapsible(_panel, title, 'file-text');
    _body.innerHTML = `
        <p id="notam-summary" style="font-size:12px;color:var(--text-muted);margin:2px 0 6px;"></p>
        <button id="notam-search" class="btn-primary" style="padding:6px 12px;font-size:12px;">
            ${tr ? 'Obtenir le dossier NOTAM' : 'Get NOTAM briefing'}
        </button>
        <div id="notam-results"></div>`;
    _body.querySelector('#notam-search')?.addEventListener('click', () => _search(_body.querySelector('#notam-results'), _routeFromApp()));
    _refreshSummary();
}

function _refreshSummary() {
    if (!_body) return;
    const el = _body.querySelector('#notam-summary');
    if (!el) return;
    const route = _routeFromApp();
    const fl = planFlUpper();
    const flTxt = fl >= 999 ? 'FL 0-999' : `FL 0-${fl}`;
    if (route._local) {
        el.textContent = isFr()
            ? `Zone 30 NM autour de ${route.icaos[0]} · ${flTxt} · VFR`
            : `30 NM zone around ${route.icaos[0]} · ${flTxt} · VFR`;
        return;
    }
    el.textContent = route.length
        ? (isFr() ? `Trajet : ${route.join(' → ')} · demi-couloir 15 NM · rayon AD 30 NM · ${flTxt} · VFR` : `Route: ${route.join(' → ')} · corridor 15 NM · AD radius 30 NM · ${flTxt} · VFR`)
        : (isFr() ? 'Aucun plan actif.' : 'No active plan.');
}

// Montage : le panneau apparaît avec le planificateur (mode Navigation).
// (Garde Node : ce module expose des helpers purs testés sans navigateur.)
if (typeof window === 'undefined') {
    // rien — environnement de test
} else {
const _poll = setInterval(() => {
    if (document.getElementById('flight-planner-panel')
        || (document.getElementById('metar-dashboard') && state.requestedIcao)) {
        clearInterval(_poll);
        _mount();
    }
}, 500);
setTimeout(() => clearInterval(_poll), 120000);
// Bascule Local ↔ Navigation (retour pilote 10/09) : le dossier affiché
// appartient à l'ancien mode — on le VIDE (résumé recalculé, sélection
// annulée) pour ne jamais montrer des NOTAM d'un autre contexte.
function _resetOnModeChange() {
    _flat = [];
    const results = _body?.querySelector('#notam-results');
    if (results) results.innerHTML = '';
    _refreshSummary();
}
document.addEventListener('clear-route', _resetOnModeChange);
// Un plan qui CHANGE invalide le dossier affiché (sécurité : ne jamais
// montrer des NOTAM d'un autre trajet) — remise à zéro, comme en mode.
window.addEventListener('route-changed', _resetOnModeChange);
window.addEventListener('navplan-changed', _resetOnModeChange);
window.__notamApi = { getSelectedNotams };   // hook QA
}

