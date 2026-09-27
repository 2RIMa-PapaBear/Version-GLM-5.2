/* ================================================================
 * ICÔNES AÉRODROMES « CARTE OACI » — classification par terrain
 * ================================================================
 * Pictogrammes couleur extraits du panneau légende (matrice CIVIL bleu
 * / MIXTE bleu double anneau / MILITAIRE rouge double anneau × piste
 * en dur / bande, + AD privé) : assets/oaci-symboles/couleurs/.
 *
 * Classification sur les DONNÉES SIA LOCALES (retour pilote 27/09) :
 *   - data/sia-airfields.json : statut CAP (civil public) / MIL
 *     (militaire) / PRV (privé) / OFF / RST (variantes civiles),
 *     drapeau prive ;
 *   - data/sia-runways.json : revêtement de la piste principale
 *     (revêtue/béton/asphalte → piste-dur ; gazon/non revêtue/terre →
 *     bande).
 * MIXTE n'est pas dérivable du SIA : table manuelle MIXTE_OVERRIDES
 * (à alimenter sur indications du pilote).
 * Hors France (non-LF) ou sans entrée SIA → null : pastille météo
 * classique conservée, terrain à faire trancher par le pilote.
 * ================================================================ */
import { getSiaAirfield, getSiaRunways } from './sia-data.js';

export const OACI_SYMBOL_DIR = 'assets/oaci-symboles/couleurs';
export const OACI_SYMBOL_SIZE = 30;   // px d'affichage (source ~90 px)

const SOFT = /gazon|non rev|terre|sable/i;

// Terrains MIXTES (utilisation principale militaire, civile possible —
// double anneau bleu) : le SIA ne les distingue pas, saisie pilote.
export const MIXTE_OVERRIDES = new Set([
    // (vide — en attente de la liste pilote)
]);

/** Classe un terrain français.
 *  @returns {{icon: string, statut: string, surf: string|null}|null}
 *  siaAf/siaRws : injection pour les TESTS (sinon getters sia-data). */
export function classifyOaciSymbol(icao, siaAf = null, siaRws = null) {
    const code = String(icao || '').toUpperCase();
    if (!code.startsWith('LF')) return null;
    const af = siaAf ?? getSiaAirfield(code);
    if (!af) return null;
    const rws = siaRws ?? getSiaRunways(code);
    const list = Array.isArray(rws) ? rws : [];
    const main = list.filter(r => r.main)[0] || list[0] || null;
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
