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
 * PIVOTÉES au cap réel de la piste principale — les pictogrammes de la
 * légende sont dessinés barre à ~140° (mesure PCA de l'encre centrale :
 * civil 137°, mixte 142°, militaire 142° → 140° retenu). « bande »,
 * hélistation, hydro : pas de rotation (plateforme/symbole fixes).
 *
 * Hors France (non-LF) ou sans info → null : pastille météo classique.
 * ================================================================ */
import { getSiaAirfield, getSiaRunways } from './sia-data.js';

export const OACI_SYMBOL_DIR = 'assets/oaci-symboles/couleurs';
export const OACI_SYMBOL_SIZE = 30;   // px d'affichage (source ~90 px)

const SOFT = /gazon|non rev|terre|sable/i;

// Angle de la barre-piste DANS les pictogrammes source (degrés boussole).
export const OACI_BAR_HEADING = 140;

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
