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

/* ---- Symboles DESSINÉS EN SVG (retour pilote 27/09) --------------------
 * Les repères cardinaux N/E/S/W restent FIXES — seule la piste pivote
 * (impossible en pivotant les PNG extraits, on recompose). Formes
 * relevées sur les pictogrammes légende (dumps ASCII) :
 *   piste-dur   : disque plein + canal blanc de piste pivoté au cap VRAI ;
 *   bande       : anneau épais (plateforme non revêtue, sans orientation) ;
 *   helistation : disque + « H » blanc ;
 *   hydro       : disque + ancre blanche ;
 *   prive       : disque + « P » blanc ;
 *   desaffecte  : anneau noir barré d'un X (noir, sans cardinaux).
 * Anneau externe (double) pour mixte/militaire. Couleurs échantillonnées :
 * bleu #0040A0, rouge #E03020, noir #141414. */
const OACI_STYLES = {
    civil: { color: '#0040A0', doubleRing: false },
    mixte: { color: '#0040A0', doubleRing: true },
    militaire: { color: '#E03020', doubleRing: true },
};

const SVG_OPEN = '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg">';
const SVG_CLOSE = '</svg>';
// Traits cardinaux externes (épais : retour pilote 27/09 « trop fins »).
const SVG_TICKS = c => `<g stroke="${c}" stroke-width="9">`
    + `<line x1="50" y1="2" x2="50" y2="9"/>`      // N
    + `<line x1="98" y1="50" x2="91" y2="50"/>`    // E
    + `<line x1="50" y1="98" x2="50" y2="91"/>`    // S
    + `<line x1="2" y1="50" x2="9" y2="50"/>`      // W
    + `</g>`;
const SVG_RING = c => `<circle cx="50" cy="50" r="39" fill="none" stroke="${c}" stroke-width="4.5"/>`;
const SVG_DISC = c => `<circle cx="50" cy="50" r="32" fill="${c}"/>`;

/** SVG inline (~30 px) du symbole `icon` (cf. classifyOaciSymbol).
 *  `bearing` : axe de piste en ° (mod 180) pour les « *-piste-dur » —
 *  repli à la pose légende (40°). Null si le nom d'icône est inconnu. */
export function oaciSymbolSvg(icon, bearing) {
    const name = String(icon || '');
    if (name === 'desaffecte') {
        const c = '#141414';
        return SVG_OPEN
            + `<circle cx="50" cy="50" r="26" fill="none" stroke="${c}" stroke-width="15"/>`
            + `<g stroke="${c}" stroke-width="7"><line x1="31" y1="31" x2="69" y2="69"/><line x1="69" y1="31" x2="31" y2="69"/></g>`
            + SVG_CLOSE;
    }
    if (name === 'prive') {
        const c = OACI_STYLES.civil.color;
        return SVG_OPEN + SVG_TICKS(c) + SVG_DISC(c)
            + `<g fill="#fff"><rect x="38" y="26" width="9" height="48"/>`
            + `<circle cx="53" cy="37" r="13"/></g>`
            + `<circle cx="53" cy="37" r="6.5" fill="${c}"/>`
            + SVG_CLOSE;
    }
    const st = OACI_STYLES[name.split('-')[0]];
    const type = name.split('-').slice(1).join('-');
    if (!st || !['piste-dur', 'bande', 'helistation', 'hydro'].includes(type)) return null;
    const c = st.color;
    let core = '';
    if (type === 'piste-dur') {
        const hdg = Number.isFinite(bearing) ? ((bearing % 180) + 180) % 180 : OACI_BAR_HEADING;
        core = SVG_DISC(c)
            + `<g transform="rotate(${hdg} 50 50)"><rect x="44" y="16" width="12" height="68" fill="#fff"/></g>`;
    } else if (type === 'bande') {
        core = `<circle cx="50" cy="50" r="26" fill="none" stroke="${c}" stroke-width="16"/>`;
    } else if (type === 'helistation') {
        core = SVG_DISC(c)
            + `<g fill="#fff"><rect x="36" y="27" width="9" height="46"/><rect x="55" y="27" width="9" height="46"/><rect x="36" y="46" width="28" height="8"/></g>`;
    } else if (type === 'hydro') {
        core = SVG_DISC(c)
            + `<g stroke="#fff" fill="none" stroke-width="7">`
            + `<line x1="50" y1="24" x2="50" y2="62"/><line x1="31" y1="32" x2="69" y2="32"/>`
            + `<path d="M 31 56 A 19 16 0 0 0 69 56"/></g>`
            + `<g stroke="#fff" stroke-width="6"><line x1="26" y1="50" x2="34" y2="58"/><line x1="74" y1="50" x2="66" y2="58"/></g>`;
    }
    return SVG_OPEN + SVG_TICKS(c) + (st.doubleRing ? SVG_RING(c) : '') + core + SVG_CLOSE;
}

/** @deprecated — remplacé par oaciSymbolSvg (tous les symboles). */
export function oaciDurSymbolSvg(icon, bearing) { return oaciSymbolSvg(icon, bearing); }

/** Classe un terrain français.
 *  @returns {{icon: string, statut: string, surf: string|null}|null}
 *  siaAf/siaRws : injection pour les TESTS (sinon getters sia-data). */
export function classifyOaciSymbol(icao, siaAf = null, siaRws = null) {
    const code = String(icao || '').toUpperCase();
    if (!code.startsWith('LF')) return null;
    const manual = MANUAL_OVERRIDES.get(code);
    if (manual) return { icon: manual.icon, statut: 'MAN', surf: null };
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
    if (af.statut === 'MIL' || MIXTE_OVERRIDES.has(code)) {
        return { icon: MIXTE_OVERRIDES.has(code) ? 'mixte-' + surface : 'militaire-' + surface, statut: MIXTE_OVERRIDES.has(code) ? 'MIX' : af.statut, surf: main?.surf || null };
    }
    return { icon: 'civil-' + surface, statut: af.statut, surf: main?.surf || null };
}
