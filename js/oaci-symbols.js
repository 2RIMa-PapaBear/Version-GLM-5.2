/* ================================================================
 * ICÔNES AÉRODROMES « CARTE OACI » — classification par terrain
 * ================================================================
 * Pictogrammes couleur extraits du panneau légende (matrice CIVIL bleu
 * / MIXTE bleu double anneau / MILITAIRE rouge double anneau × piste
 * en dur / bande, + AD privé + désaffecté) :
 * assets/oaci-symboles/couleurs/.
 *
 * Classification sur les DONNÉES SIA LOCALES (retour pilote 27/09) :
 *   - data/sia-airfields.json : statut CAP (civil public) / MIL
 *     (militaire) / PRV (privé) / OFF / RST (variantes civiles) ;
 *   - data/sia-runways.json : revêtement de la piste principale
 *     (revêtue/béton/asphalte → piste-dur ; gazon/non revêtue/terre →
 *     bande) + seuils t1/t2 (cap VRAI de l'axe) ;
 *   - MANUAL_OVERRIDES : saisies pilote (terrains sans entrée SIA) ;
 *   - MIXTE_OVERRIDES : mixtes non dérivables du SIA (saisie pilote).
 *
 * ORIENTATION (retour pilote 27/09) : les icônes « *-piste-dur » sont
 * PIVOTÉES au cap réel de la piste principale. Le pictogramme source =
 * disque barré d'un canal blanc (la piste) : l'axe se mesure aux TROUS
 * du disque où le canal sort (caps 24-58°, centre ≈ 40° — civil 42,
 * militaire 37 ; une 1ʳᵉ mesure PCA à 140° lisait l'élément
 * PERPENDICULAIRE : erreur ~100° signalée par le pilote). « bande »,
 * hélistation, hydro : pas de rotation (plateforme/symbole fixes).
 *
 * Hors France (non-LF) ou sans info → null : pastille météo classique.
 * ================================================================ */
import { getSiaAirfield, getSiaRunways } from './sia-data.js';

export const OACI_SYMBOL_DIR = 'assets/oaci-symboles/couleurs';
export const OACI_SYMBOL_SIZE = 30;   // px d'affichage (source ~90 px)

const SOFT = /gazon|non rev|terre|sable/i;

// Angle de la barre-piste DANS les pictogrammes source (degrés boussole) :
// axe du canal blanc (mesure : trous du disque aux caps 24-58° → ~40°).
export const OACI_BAR_HEADING = 40;

// Saisies pilote 27/09 (terrains sans entrée sia-airfields).
export const MANUAL_OVERRIDES = new Map([
    ['LFVM', { icon: 'civil-piste-dur' }],    // Miquelon 12/30 revêtue 1000×20
    ['LFVP', { icon: 'civil-piste-dur' }],    // Saint-Pierre Pointe-Blanche 08/26 revêtue 1920×45
    ['LFPI', { icon: 'civil-helistation' }],  // Héliport Paris-Issy-les-Moulineaux (Valérie-André)
    ['LFPY', { icon: 'desaffecte' }],         // Brétigny : fermé à la CAP depuis 2012
]);

// Terrains MIXTES (utilisation principale militaire, civile possible —
// double anneau bleu) : le SIA ne les distingue pas, saisie pilote.
export const MIXTE_OVERRIDES = new Set([
    // (vide — en attente de la liste pilote)
]);

// Terrains MILITAIRES que le SIA ne marque pas « MIL » (saisie pilote
// 27/09 : LFRH Lorient Lann-Bihoué — BAN, statut SIA « RST » → bleu à
// tort).
export const MILITARY_OVERRIDES = new Set([
    'LFRH',   // Lorient Lann-Bihoué (base d'aéronautique navale)
]);

function _mainRunway(rws) {
    const list = Array.isArray(rws) ? rws : [];
    return list.filter(r => r.main)[0] || list[0] || null;
}

/** Cap VRAI (°) du segment a→b (formule géodésique). */
export function bearingDeg(a, b) {
    const rad = Math.PI / 180;
    const f1 = a.lat * rad, f2 = b.lat * rad, dl = (b.lon - a.lon) * rad;
    const y = Math.sin(dl) * Math.cos(f2);
    const x = Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl);
    return (Math.atan2(y, x) / rad + 360) % 360;
}

/** Cap de l'axe de la piste principale (mod 180 — un axe est symétrique).
 *  Priorité : seuils SIA t1/t2 (cap VRAI) > champ brg > null. */
export function oaciRunwayBearing(icao, siaRws = null) {
    const main = _mainRunway(siaRws ?? getSiaRunways(String(icao || '').toUpperCase()));
    if (!main) return null;
    if (Number.isFinite(main.t1?.lat) && Number.isFinite(main.t2?.lat)) {
        return bearingDeg(main.t1, main.t2) % 180;
    }
    if (Number.isFinite(main.brg)) return main.brg % 180;
    return null;
}

/** Rotation à appliquer au pictogramme (°, [-90 ; 90[) — 0 si l'icône
 *  n'orientepas (bande/hélico/hydro/désaffecté/privé). */
export function oaciIconRotation(icon, bearing) {
    if (!icon || !icon.endsWith('piste-dur') || !Number.isFinite(bearing)) return 0;
    return ((bearing - OACI_BAR_HEADING + 90) % 180 + 180) % 180 - 90;
}

/* ---- Symboles DESSINÉS EN SVG (retours pilote 27/09) --------------------
 * Repères cardinaux N/E/S/W FIXES et COLLÉS au disque (correction pilote :
 * l'encre est continue du centre à r≈44/46 sur les axes — profil radial
 * mesuré sur les PNG légende), seule la piste pivote. Cotes relevées sur
 * les pictogrammes (px ×100/92 — militaire dessiné plus petit sur la
 * planche, k=0.76, tailles relatives préservées) :
 *   disque r≈36 ; traits cardinaux collés (du bord à r≈48, largeur 10,8
 *   ≈ 3,2 px écran — +1 px sur demande pilote) ;
 *   anneau externe (mixte/militaire) r≈25,6 ± 2,2, détaché du disque ;
 *   « bande » : anneau FIN r≈34 ép. 7 (pas 16 — retour pilote) ;
 *   canal piste largeur ≈ 14, débordant du disque.
 *   hélistation : disque + H blanc ; hydro : disque + ancre ;
 *   privé : disque + P ; désaffecté : anneau noir épais barré X.
 * Couleurs échantillonnées : bleu #0040A0, rouge #E03020, noir #141414. */
const OACI_STYLES = {
    civil: { color: '#0040A0', k: 1.0, doubleRing: false },
    mixte: { color: '#0040A0', k: 1.0, doubleRing: true },
    // Militaire à la MÊME TAILLE que les autres (retour pilote 27/09 :
    // la planche les dessine plus petits, le pilote veut l'uniforme).
    militaire: { color: '#E03020', k: 1.0, doubleRing: true },
};

const SVG_OPEN = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">';
const SVG_CLOSE = '</svg>';

/** 4 traits cardinaux COLLÉS au bord du symbole (rectangles, retour
 *  pilote : attachés ; épais 10,8 u ≈ 3,2 px à l'écran 30 px — épaissis
 *  de +1 px à la demande pilote 27/09 — du bord à r=48). */
const SVG_TICKS = (c, attach, out, w) => {
    const h = out - attach, x = 50 - w / 2;
    return `<g fill="${c}">`
        + `<rect x="${x}" y="${50 - out}" width="${w}" height="${h}"/>`                    // N
        + `<rect x="${50 + attach}" y="${x}" width="${h}" height="${w}"/>`                 // E
        + `<rect x="${x}" y="${50 + attach}" width="${w}" height="${h}"/>`                 // S
        + `<rect x="${50 - out}" y="${x}" width="${h}" height="${w}"/>`                    // W
        + `</g>`;
};

/** SVG inline (~30 px) du symbole `icon` (cf. classifyOaciSymbol).
 *  `bearing` : axe de piste en ° (mod 180) pour les « *-piste-dur » —
 *  repli à la pose légende (40°). Null si le nom d'icône est inconnu. */
export function oaciSymbolSvg(icon, bearing) {
    const name = String(icon || '');
    if (name === 'desaffecte') {
        const c = '#141414';
        return SVG_OPEN
            + `<circle cx="50" cy="50" r="28" fill="none" stroke="${c}" stroke-width="16"/>`
            + `<g stroke="${c}" stroke-width="7"><line x1="32" y1="32" x2="68" y2="68"/><line x1="68" y1="32" x2="32" y2="68"/></g>`
            + SVG_CLOSE;
    }
    if (name === 'prive') {
        const c = OACI_STYLES.civil.color;
        return SVG_OPEN
            + SVG_TICKS(c, 36, 48, 10.8)
            + `<circle cx="50" cy="50" r="36" fill="${c}"/>`
            + `<g fill="#fff"><rect x="40" y="27" width="9" height="50"/>`
            + `<circle cx="55" cy="37" r="14"/></g>`
            + `<circle cx="55" cy="37" r="7" fill="${c}"/>`
            + SVG_CLOSE;
    }
    const st = OACI_STYLES[name.split('-')[0]];
    const type = name.split('-').slice(1).join('-');
    if (!st || !['piste-dur', 'bande', 'helistation', 'hydro'].includes(type)) return null;
    const k = st.k, c = st.color;
    const discR = 36 * k;
    const outerR = 25.6 * k, outerW = 4.4 * k;
    const tickW = 10.8 * k, tickOut = 48 * k;
    const attach = st.doubleRing ? outerR + outerW / 2 : (type === 'bande' ? 34 * k + 3.5 * k : discR);
    let core = '';
    if (type === 'piste-dur') {
        const hdg = Number.isFinite(bearing) ? ((bearing % 180) + 180) % 180 : OACI_BAR_HEADING;
        const chW = 14 * k, chHalf = 37.5 * k;
        core = `<circle cx="50" cy="50" r="${discR}" fill="${c}"/>`
            + `<g transform="rotate(${hdg} 50 50)"><rect x="${50 - chW / 2}" y="${50 - chHalf}" width="${chW}" height="${2 * chHalf}" fill="#fff"/></g>`;
    } else if (type === 'bande') {
        const ringR = 34 * k, ringW = 7 * k;
        core = `<circle cx="50" cy="50" r="${ringR}" fill="none" stroke="${c}" stroke-width="${ringW}"/>`;
    } else if (type === 'helistation') {
        core = `<circle cx="50" cy="50" r="${discR}" fill="${c}"/>`
            + `<g fill="#fff">`
            + `<rect x="${50 - 14 * k}" y="${50 - 19 * k}" width="${9 * k}" height="${38 * k}"/>`
            + `<rect x="${50 + 5 * k}" y="${50 - 19 * k}" width="${9 * k}" height="${38 * k}"/>`
            + `<rect x="${50 - 14 * k}" y="${50 - 4 * k}" width="${28 * k}" height="${8 * k}"/>`
            + `</g>`;
    } else if (type === 'hydro') {
        core = `<circle cx="50" cy="50" r="${discR}" fill="${c}"/>`
            + `<g stroke="#fff" fill="none" stroke-width="${7 * k}">`
            + `<line x1="50" y1="${50 - 21 * k}" x2="50" y2="${50 + 10 * k}"/>`
            + `<line x1="${50 - 15 * k}" y1="${50 - 14 * k}" x2="${50 + 15 * k}" y2="${50 - 14 * k}"/>`
            + `<path d="M ${50 - 15 * k} ${50 + 4 * k} A ${15 * k} ${13 * k} 0 0 0 ${50 + 15 * k} ${50 + 4 * k}"/>`
            + `</g>`
            + `<g stroke="#fff" stroke-width="${6 * k}">`
            + `<line x1="${50 - 19 * k}" y1="${50 - 1 * k}" x2="${50 - 12 * k}" y2="${50 + 6 * k}"/>`
            + `<line x1="${50 + 19 * k}" y1="${50 - 1 * k}" x2="${50 + 12 * k}" y2="${50 + 6 * k}"/>`
            + `</g>`;
    }
    return SVG_OPEN
        + SVG_TICKS(c, attach, tickOut, tickW)
        + (st.doubleRing ? `<circle cx="50" cy="50" r="${outerR}" fill="none" stroke="${c}" stroke-width="${outerW}"/>` : '')
        + core
        + SVG_CLOSE;
}

/** @deprecated — remplacé par oaciSymbolSvg (tous les symboles). */
export function oaciDurSymbolSvg(icon, bearing) { return oaciSymbolSvg(icon, bearing); }

/** Classe un terrain français.
 *  @returns {{icon: string, statut: string, surf: string|null}|null}
 *  siaAf/siaRws : injection pour les TESTS (sinon getters sia-data). */
export function classifyOaciSymbol(icao, siaAf = null, siaRws = null, apt = null) {
    const code = String(icao || '').toUpperCase();
    const manual = MANUAL_OVERRIDES.get(code);
    if (manual) return { icon: manual.icon, statut: 'MAN', surf: null };
    // Hors France (pas de SIA — retour pilote 27/09 « généraliser à tous
    // les aérodromes ») : classification sur la BASE LOCALE — revêtement
    // (GRS/terre/sable → bande, sinon dur) en CIVIL par défaut (les
    // militaires étrangers se déclarent via MILITARY_OVERRIDES).
    if (!code.startsWith('LF')) {
        const surf = String(apt?.surface || '').toUpperCase();
        if (!apt) return null;
        return { icon: /^(GRS|GRASS|DIRT|DIR|GRVL|SAND|UN)/.test(surf) ? 'civil-bande' : 'civil-piste-dur', statut: 'ÉTR', surf: surf || null };
    }
    const af = siaAf ?? getSiaAirfield(code);
    if (!af) return null;
    const main = _mainRunway(siaRws ?? getSiaRunways(code));
    const surface = (main?.surf && SOFT.test(main.surf)) ? 'bande' : 'piste-dur';
    // NB : le drapeau booléen « prive » du fichier SIA est vrai pour
    // 418/507 terrains (Le Bourget compris — défaut du crawler) : SEUL le
    // statut PRV (LF01…LF38 : plateformes ULM/privées) est fiable.
    if (af.statut === 'PRV') {
        return { icon: 'prive', statut: af.statut, surf: main?.surf || null };
    }
    if (MILITARY_OVERRIDES.has(code)) {
        return { icon: 'militaire-' + surface, statut: 'MIL (saisie pilote)', surf: main?.surf || null };
    }
    if (af.statut === 'MIL' || MIXTE_OVERRIDES.has(code)) {
        return { icon: MIXTE_OVERRIDES.has(code) ? 'mixte-' + surface : 'militaire-' + surface, statut: MIXTE_OVERRIDES.has(code) ? 'MIX' : af.statut, surf: main?.surf || null };
    }
    return { icon: 'civil-' + surface, statut: af.statut, surf: main?.surf || null };
}
