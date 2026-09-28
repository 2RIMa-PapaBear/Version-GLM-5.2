/* ================================================================
 * AIRSPACE PROFILE — Zones aériennes traversées par la route
 * ================================================================
 *
 * Calcule, à partir des points du profil d'élévation (frac/lat/lon) et
 * des zones openAIP brutes, la liste des espaces aériens REellement
 * traversés par la route : tronçon (en fraction 0-1 de la route),
 * plancher/plafond (ft) et fréquence. Les secteurs d'un même organisme
 * (ex. SEINE 6/7/8, même fréquence) sont fusionnés en un groupe avec
 * un plafond par secteur — dessinés comme rectangles d'altitude nichés
 * sur le profil (écran + log de nav PDF), façon EFB.
 *
 * Module PUR (aucune dépendance DOM/réseau) → testable sous Node.
 * ================================================================ */

const FT_PER_M = 3.28084;

// Filtres identiques au rendu de la carte (airspaces.js).
const ADMIN_NAME_RE = /\bFIR\b|\bUIR\b|\bLTA\b/;
// Cap de plancher : PAS de VFR au-dessus du FL195 (SERA.5005), croisières
// semi-circulaires VFR FL055–FL195 (SERA Appendice 3) — une zone dont le
// plancher dépasse le FL195 ne peut concerner AUCUN vol de l'app. Le cap
// historique à 5000 ft rendait carte, profil et log de nav aveugles à une
// TMA C/D de plancher FL065 survolée au FL085 (audit 27/09, fiche 2) ;
// défini ICI (module pur) et importé par airspaces.js pour ne garder
// qu'UNE valeur côté client.
export const MAX_BASE_FT = 19500;
// Tolérance autour de l'altitude de croisière pour les espaces CONTRÔLÉS
// (CTR/TMA/CTA/SIV…) : une limite à moins de 1000 ft du niveau de vol reste
// affichée — élargie de 500 → 1000 ft (consigne pilote 20/09 : une CTR/TMA
// survolée de près garde sa place sur le profil).
export const ALT_TOLERANCE_FT = 1000;
// Zones RÉGLEMENTÉES (R/D/P) : TOUJOURS visibles sur le profil dès que la
// route les traverse géographiquement (consigne pilote 20/09 : R 147
// 800-1500 ft et R 162 1000-2000 ft survolées à ~3500 ft doivent y
// figurer — information de sécurité : descente, activation NOTAM…).
const RDP_NAME_RE = /^(?:LF-)?[RDP][\s-]?\d/i;
/** Zone RÉGLEMENTÉE (R/D/P) ? — SIA « R 147 », openAIP « LF-P23… ». Piloté
 *  par le rendu : R/D/P toujours visibles sur le profil et dessinées en
 *  trait rouge + hachures rouges (consigne pilote 20/09). */
export function isRdpZone(name) {
    return RDP_NAME_RE.test(String(name || '').trim());
}
// Tronçon minimal pour dessiner une zone (en fraction de route) : écarte
// les coins à peine effleurés (≈ 1,5 NM sur une navigation de 100 NM).
const MIN_SPAN_FRAC = 0.012;
// Deux secteurs du même organisme séparés de moins que ceci sont dessinés
// comme un seul rectangle (séparateur pointillé au milieu de l'écart).
const MERGE_TOL_FRAC = 0.02;

/** Limite verticale openAIP → ft (unit 6 = FL, 1 = ft, 0 = m). */
export function limitToFt(lim) {
    if (!lim || !Number.isFinite(lim.value)) return null;
    if (lim.unit === 6) return lim.value * 100;
    if (lim.unit === 0) return Math.round(lim.value * FT_PER_M);
    return Math.round(lim.value);
}

/** Bbox [minLat, minLon, maxLat, maxLon] englobant les points + marge. */
export function routeBbox(points, marginDeg = 0.4) {
    let minLat = Infinity, minLon = Infinity, maxLat = -Infinity, maxLon = -Infinity;
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        minLat = Math.min(minLat, p.lat); maxLat = Math.max(maxLat, p.lat);
        minLon = Math.min(minLon, p.lon); maxLon = Math.max(maxLon, p.lon);
    }
    if (!Number.isFinite(minLat)) return null;
    return [minLat - marginDeg, minLon - marginDeg, maxLat + marginDeg, maxLon + marginDeg];
}

// ----------------------------------------------------------------
// Géométrie : point dans une zone openAIP
// ----------------------------------------------------------------

function _pointInRing(lat, lon, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const lati = ring[i][1], loni = ring[i][0];
        const latj = ring[j][1], lonj = ring[j][0];
        if (((lati > lat) !== (latj > lat)) &&
            (lon < (lonj - loni) * (lat - lati) / (latj - lati) + loni)) {
            inside = !inside;
        }
    }
    return inside;
}

/** Teste si (lat, lon) est dans la géométrie openAIP (GeoJSON :
 *  Polygon/MultiPolygon ; Point+rayon → disque ; LineString ignoré). */
export function pointInAirspace(lat, lon, geometry, radiusKm = 5) {
    if (!geometry) return false;
    const type = geometry.type;
    if (type === 'Polygon') {
        return geometry.coordinates.some(ring => _pointInRing(lat, lon, ring));
    }
    if (type === 'MultiPolygon') {
        return geometry.coordinates.some(poly => poly.some(ring => _pointInRing(lat, lon, ring)));
    }
    if (type === 'Point') {
        const [clon, clat] = geometry.coordinates;
        const R = 6371, toRad = d => d * Math.PI / 180;
        const d = 2 * R * Math.asin(Math.sqrt(
            Math.sin(toRad(clat - lat) / 2) ** 2 +
            Math.cos(toRad(lat)) * Math.cos(toRad(clat)) * Math.sin(toRad(clon - lon) / 2) ** 2));
        return d <= radiusKm;
    }
    return false;
}

// ----------------------------------------------------------------
// Tronçons traversés
// ----------------------------------------------------------------

/** Tronçons [fa, fb] (frac) où la route est DANS la zone, à partir des
 *  points échantillonnés (intérieurs contigus). */
export function crossedRanges(points, geometry, radiusKm) {
    const runs = [];
    let start = null;
    for (const p of points) {
        if (!Number.isFinite(p.lat) || !Number.isFinite(p.lon)) continue;
        const inside = pointInAirspace(p.lat, p.lon, geometry, radiusKm);
        if (inside && start == null) start = p.frac;
        if (!inside && start != null) {
            runs.push([start, p.frac]);
            start = null;
        }
    }
    if (start != null) runs.push([start, points[points.length - 1].frac]);
    return runs.filter(r => r[1] - r[0] >= MIN_SPAN_FRAC);
}

/** Nom d'affichage du service : fréquence openAIP (« SEINE INFORMATION »)
 *  sinon nom de la zone ; « INFORMATION » abrégé en « INFO ». */
export function serviceDisplayName(as) {
    const f = Array.isArray(as.frequencies) ? as.frequencies.find(x => x && x.value) : null;
    const raw = (f?.name || as.name || as.designator || '?').toString().trim();
    return raw.replace(/\s+information$/i, ' INFO').toUpperCase();
}

/** Fréquence principale affichable (« 127.815 ») ou null. */
export function serviceFreq(as) {
    const f = Array.isArray(as.frequencies) ? as.frequencies.find(x => x && x.value) : null;
    return f ? String(f.value) : null;
}

/** Libellé du code d'horaire d'activation SIA (HorCode des zones —
 *  distribution AIRAC 2026-09 : H24×603, HX×540, NOTAM×156, HO×122,
 *  TS×60, HJ×44, HN×1). Seuls les codes au sens ICAO documenté sont
 *  traduits ; toute autre valeur (« TS », horaire littéral…) est
 *  affichée telle quelle — jamais d'invention. */
export function horLabel(hor, isFr = true, horTxt = null) {
    const h = String(hor || '').trim().toUpperCase();
    if (!h) return '';
    // A6 (audit 27/09) : code d'horaire inconnu du tableau → afficher le
    // TEXTE officiel du XML (HorTxt, « 0700 - au plus tard de 1900 ou
    // SS+30 ») plutôt que le sigle brut (« TS »).
    const txtRaw = String(horTxt || '').trim();
    const L = {
        'H24':   { fr: 'H24 — jour et nuit', en: 'H24 — day & night' },
        'HJ':    { fr: 'HJ — jour (lever→coucher du soleil)', en: 'HJ — day (sunrise→sunset)' },
        'HN':    { fr: 'HN — nuit (coucher→lever du soleil)', en: 'HN — night (sunset→sunrise)' },
        'HO':    { fr: 'HO — sur demande', en: 'HO — on request' },
        'HX':    { fr: 'HX — horaires variables', en: 'HX — variable hours' },
        'NOTAM': { fr: 'Activation par NOTAM', en: 'Activation by NOTAM' },
    };
    if (!L[h] && txtRaw) return txtRaw;
    return L[h] ? L[h][isFr ? 'fr' : 'en'] : h;
}

// Fusionne les tronçons d'un même groupe séparés de < MERGE_TOL_FRAC.
function _mergeRanges(ranges) {
    const sorted = ranges.map(r => [...r]).sort((a, b) => a[0] - b[0]);
    const out = [];
    for (const r of sorted) {
        const last = out[out.length - 1];
        if (last && r[0] - last[1] < MERGE_TOL_FRAC) last[1] = Math.max(last[1], r[1]);
        else out.push([...r]);
    }
    return out;
}

/**
 * Calcule les groupes de zones traversées par la route.
 * @param {Array} points Points du profil d'élévation [{frac, lat, lon}].
 * @param {Array} items  Zones openAIP brutes (bbox de la route chargée).
 * @param {Object} [opts] {cruiseAltFt} : si fournie (> 0), seules les zones
 *   RELEVANTES pour l'altitude du vol sont retenues — la croisière doit être
 *   DANS la tranche verticale (lo ≤ croisière ≤ plafond). Une CTR SFC-1500
 *   survolée à 3500 ft n'apparaît pas (retour utilisateur 27/08).
 * @returns {Array|null} Groupes triés conteneur → imbriqué :
 *   [{ name, freq, lo, up (plafond max), ranges: [[fa,fb]],
 *      segs: [{fa, fb, up, zone}] }] — zone = nom openAIP du SECTEUR
 *   (ex. « SIV RENNES SUD A ») porté par chaque tronçon, ou null si aucun.
 */
export function computeRouteAirspaces(points, items, opts) {
    if (!Array.isArray(points) || points.length < 2 || !Array.isArray(items)) return null;
    const cruise = Number.isFinite(opts?.cruiseAltFt) && opts.cruiseAltFt > 0 ? opts.cruiseAltFt : null;

    // M13 (audit 27/09) : limites SIA « FT ASFC » (au-dessus du SOL) :
    // converties en AMSL avec le relief de la route — plancher → sol MIN,
    // plafond → sol MAX (les deux sens ÉLARGISSENT la zone, jamais
    // l'inverse). Lues AMSL brutes avant : en montagne (CTR CALVI, CTA
    // TOULON, R 158 B…) une zone CONTENANT l'altitude de vol était exclue
    // du profil et les étiquettes « ft AMSL »/« FL » mentaient.
    const _elevs = points.map(p => p.elevFt).filter(Number.isFinite);
    const elevMin = _elevs.length ? Math.min(..._elevs) : 0;
    const elevMax = _elevs.length ? Math.max(..._elevs) : 0;
    const _asfc = (lim) => !!(lim && lim.ref === 'ASFC');

    const byKey = new Map();
    for (const as of items) {
        if (ADMIN_NAME_RE.test(String(as.name || as.designator || '').toUpperCase())) continue;
        // FIR/UIR/secteurs ACC openAIP dont le nom ne dit pas « FIR »
        // (ex. « LRBB », « POLARIS ACC ») — filtrés aussi sur la carte.
        if (!as._sia && (as.type === 10 || as.type === 11 || as.type === 27)) continue;
        // CTA SUPPRIMÉES du profil vertical comme de la carte (pilote 28/09).
        if (String(as.name || as.designator || '').toUpperCase().includes('CTA')) continue;
        // A8 (audit 27/09) : l'exception R/D/P « toujours retenues »
        // (consigne 20/09) doit précéder TOUS les filtres d'altitude —
        // l'ancien ordre laissait le filtre de plancher (puis le filtre
        // croisière) éliminer une R/D/P 6000-9500 survolée à 3500.
        const rdp = isRdpZone(as.name || as.designator);
        const loLim = as.lowerLimit ?? as.lower, upLim = as.upperLimit ?? as.upper;
        const lo = (limitToFt(loLim) ?? 0) + (_asfc(loLim) ? elevMin : 0);
        const upRaw = limitToFt(upLim);
        const up = upRaw == null ? null : upRaw + (_asfc(upLim) ? elevMax : 0);
        if (up == null || up <= 0) continue;            // plafond inconnu : on ignore
        if (lo > MAX_BASE_FT && !rdp) continue;          // plancher trop haut pour du VFR
        if (up <= lo) continue;
        // Altitude du vol : hors tranche verticale (marge 1000 ft) → la zone
        // ne concerne pas ce vol (entièrement au-dessus ou en dessous) —
        // SAUF zones réglementées R/D/P, toujours retenues (consigne 20/09).
        if (cruise != null && !rdp
            && (up < cruise - ALT_TOLERANCE_FT || lo > cruise + ALT_TOLERANCE_FT)) continue;

        const ranges = crossedRanges(points, as.geometry,
            (as.radius && Number.isFinite(as.radius.value)) ? as.radius.value : 5);
        if (!ranges.length) continue;

        const name = serviceDisplayName(as);
        const freq = serviceFreq(as);
        // Nom du secteur (zone openAIP brute) : le groupe porte le nom de
        // l'organisme (« RENNES INFO ») mais le survol doit dire LEQUEL
        // des secteurs (Sud A, Nord, Cotentin…) est sous le curseur.
        const zone = String(as.name || as.designator || '').trim();
        // (20/09, retour pilote PDF) Clé = NOM SEUL (normalisé), PAS la
        // fréquence : les items d'un même organisme peuvent porter des
        // fréquences différentes (certaines nulles) — deux groupes
        // « LA ROCHELLE » dessinaient chaque secteur DEUX fois sur le
        // profil (TMA LA ROCHELLE 1/3, TMA AQUITAINE 2.1/2.2, D 18 A3…).
        // La fréquence du groupe = la première non nulle rencontrée.
        const key = String(name || '').replace(/\s+/g, ' ').trim().toUpperCase();
        let g = byKey.get(key);
        if (!g) { g = { name, freq: null, lo: Infinity, up: -Infinity, ranges: [], segs: [] }; byKey.set(key, g); }
        if (freq && !g.freq) g.freq = freq;
        g.lo = Math.min(g.lo, lo);
        g.up = Math.max(g.up, up);
        g.ranges.push(...ranges);
        // Activité officielle des zones R/D/P (« Parachutage ») et code
        // d'horaire d'activation SIA (« H24 », « NOTAM »…) : portés au
        // segment pour l'infobulle du profil écran et les cadres du PDF.
        for (const [fa, fb] of ranges) {
            g.segs.push({ fa, fb, up, zone, act: as.activity || null, hor: as.hor || null, horTxt: as.horTxt || null });
        }
    }

    // (20/09) Un même SECTEUR peut venir de plusieurs items openAIP (géométrie
    // multi-parties, sources doublées) : union de ses tronçons CHEVAUCHANTS
    // par nom de secteur — sinon le profil du PDF l'étiquette une fois par
    // item. Les parties DISJOINTES d'une même zone (deux traversées réelles)
    // restent des segments distincts : une étiquette chacune.
    const groups = [...byKey.values()].map(g => {
        const byZone = new Map();   // zone normalisée → segments fusionnables
        for (const s of g.segs) {
            const zk = String(s.zone || '').replace(/\s+/g, ' ').trim().toUpperCase();
            const list = byZone.get(zk) || [];
            const overl = list.find(m => s.fa <= m.fb + MERGE_TOL_FRAC && s.fb >= m.fa - MERGE_TOL_FRAC);
            if (overl) {
                overl.fa = Math.min(overl.fa, s.fa);
                overl.fb = Math.max(overl.fb, s.fb);
                overl.up = Math.max(overl.up, s.up);
                overl.act ??= s.act;
                overl.hor ??= s.hor;
            } else {
                list.push({ fa: s.fa, fb: s.fb, up: s.up, zone: s.zone, act: s.act, hor: s.hor });
                byZone.set(zk, list);
            }
        }
        const ranges = _mergeRanges(g.ranges);
        return {
            name: g.name, freq: g.freq, lo: g.lo, up: g.up,
            span: Math.max(...ranges.map(r => r[1] - r[0])),
            ranges,
            segs: [...byZone.values()].flat().sort((a, b) => a.fa - b.fa),
        };
    });
    if (!groups.length) return null;
    // Conteneurs d'abord, imbriqués ensuite (dessinés par-dessus).
    groups.sort((a, b) => b.span - a.span);
    return groups;
}
