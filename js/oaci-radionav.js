/* ================================================================
 * MOYENS DE RADIONAVIGATION — symboles + annotations carte OACI
 * ================================================================
 *
 * Présentation SIA/OACI validée sur planche par le pilote le 27/09
 * (test/oaci-extract/planche-radionav.html) — mêmes conventions que
 * les aérodromes (bleu OACI #0040A0, Archivo) :
 *
 *   VOR      hexagone plat + point central                  (43×39 doc)
 *   VOR-DME  hexagone INSCRIT dans un cadre (sommets aux 4 bords) (50×38)
 *   NDB      cercle central + point + 3 couronnes de points (78×78,
 *            taille carte −30 % : couronnes r20/28/36,5 → 16/21/29 pts)
 *   DME ENR  rectangle + point central                      (52×39)
 *
 *   TACAN (pentagone) et VOR-TACAN : EN RÉSERVE — non dérivés des
 *   données (TACAN SIA volontairement exclu : azimut militaire UHF).
 *
 * Annotation façon document : nom du lieu en bleu POSÉ sur la ligne
 * haute du cadre (le trait est masqué derrière), « [ (D) ] IDENT FRÉQ »
 * dans le cadre (préfixe (D) = DME colocalisé ou DME ENR), PAS de
 * mot-type sous l'encadré ; bloc remonté de 20 % + 14 px ; trait de
 * rappel du milieu gauche du cadre visant le centre du symbole,
 * accroché au bord extérieur du dessin.
 *
 * Sources SIA (AIRAC 2026-09-03) : 51 VOR-DME, 12 VOR, 54 NDB,
 * 19 DME-ATT (DME ENR) — distinction NavType conservée depuis le
 * XML (scripts/lib/sia-navaids.mjs, décision pilote 27/09).
 * ================================================================ */

export const RADIONAV_BLUE = '#0040A0';

/** Kinds rendus en symboles OACI (TACAN/VOR-TACAN en réserve). */
export const RADIONAV_KINDS = ['vor', 'vor-dme', 'ndb', 'dme', 'tacan'];
export const RADIONAV_KIND_LABEL = { vor: 'VOR', 'vor-dme': 'VOR-DME', ndb: 'NDB', dme: 'DME', tacan: 'TACAN' };

/** Taille du DESSIN en px document (mesurée sur la légende) + échelle
 *  carte (NDB réduit de 30 % — retour pilote 27/09). */
export const RADIONAV_DOC_SIZE = { vor: [43, 39], 'vor-dme': [50, 38], ndb: [78, 78], dme: [52, 39], tacan: [58, 55] };
const MAP_SCALE = { vor: 0.55, 'vor-dme': 0.55, ndb: 0.385, dme: 0.55, tacan: 0.55 };

/** Taille du symbole sur la carte (px) — ancre Leaflet au centre. */
export function radionavMapSize(kind) {
    const [w, h] = RADIONAV_DOC_SIZE[kind] || [40, 40];
    const k = MAP_SCALE[kind] ?? 0.55;
    return [Math.round(w * k), Math.round(h * k)];
}

/* ---- Symboles (géométrie validée sur planche, viewBox en px document) ---- */

function _svg(kind, inner) {
    const [vw, vh] = RADIONAV_DOC_SIZE[kind];
    return `<svg viewBox="0 0 ${vw} ${vh}" fill="none" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%">${inner}</svg>`;
}

/** VOR : hexagone plat haut/bas, pointes gauche/droite, point central. */
function _svgVor() {
    return _svg('vor',
        `<polygon points="1.5,19.5 9.5,2.5 33.5,2.5 41.5,19.5 33.5,36.5 9.5,36.5" stroke="${RADIONAV_BLUE}" stroke-width="3"/>`
        + `<circle cx="21.5" cy="19.5" r="3.5" fill="${RADIONAV_BLUE}"/>`);
}

/** VOR-DME : hexagone inscrit, sommets touchant les 4 bords du cadre. */
function _svgVorDme() {
    return _svg('vor-dme',
        `<rect x="1.5" y="1.5" width="47" height="35" stroke="${RADIONAV_BLUE}" stroke-width="3"/>`
        + `<polygon points="2,19 14,2 36,2 48,19 36,36 14,36" stroke="${RADIONAV_BLUE}" stroke-width="2.8"/>`
        + `<circle cx="25" cy="19" r="3" fill="${RADIONAV_BLUE}"/>`);
}

/** NDB : cercle central + point + 3 couronnes de points réguliers. */
function _svgNdb() {
    const cx = 39, cy = 39;
    const ring = (r, n) => {
        const c = 2 * Math.PI * r;
        return `<circle cx="${cx}" cy="${cy}" r="${r}" stroke="${RADIONAV_BLUE}" stroke-width="4" stroke-linecap="round" stroke-dasharray="0.01 ${(c / n - 0.01).toFixed(3)}"/>`;
    };
    return _svg('ndb',
        ring(20, 16) + ring(28, 21) + ring(36.5, 29)
        + `<circle cx="${cx}" cy="${cy}" r="12" stroke="${RADIONAV_BLUE}" stroke-width="2.6"/>`
        + `<circle cx="${cx}" cy="${cy}" r="2.6" fill="${RADIONAV_BLUE}"/>`);
}

/** DME ENR : rectangle + point central. */
function _svgDme() {
    return _svg('dme',
        `<rect x="2" y="2" width="48" height="35" stroke="${RADIONAV_BLUE}" stroke-width="3"/>`
        + `<circle cx="26" cy="19.5" r="2.6" fill="${RADIONAV_BLUE}"/>`);
}

/* TACAN — copie conforme validée (TACAN_2.png + script pilote 29/09 :
   seuil 240, RETR_TREE, approxPolyDP ε=0,005, chemin unique evenodd). */
const TACAN_D = 'M 18.0,0.0 L 0.0,31.1 L 14.8,42.6 L 31.1,68.9 L 31.1,83.6 L 68.9,83.6 L 68.9,67.2 L 86.9,37.7 L 98.4,29.5 L 78.7,0.0 L 68.9,6.6 L 31.1,6.6 Z M 21.3,8.2 L 27.9,11.5 L 70.5,11.5 L 77.0,8.2 L 90.2,27.9 L 82.0,34.4 L 62.3,67.2 L 62.3,77.0 L 60.7,78.7 L 37.7,78.7 L 36.1,77.0 L 36.1,65.6 L 16.4,34.4 L 8.2,29.5 Z M 49.2,32.8 L 47.5,34.4 L 45.9,34.4 L 44.3,36.1 L 44.3,42.6 L 47.5,45.9 L 52.5,45.9 L 55.7,42.6 L 55.7,36.1 L 54.1,34.4 L 52.5,34.4 L 50.8,32.8 Z';
function _svgTacan() {
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" style="display:block;width:100%;height:100%"><path fill="${RADIONAV_BLUE}" fill-rule="evenodd" d="${TACAN_D}"/></svg>`;
}

/** Sommets des sous-chemins TACAN (boîte 100) pour le rendu jsPDF
 *  (flight-map-pdf.js — remplissage evenodd). */
export const TACAN_PDF_PATH = [[[18.0,0.0],[0.0,31.1],[14.8,42.6],[31.1,68.9],[31.1,83.6],[68.9,83.6],[68.9,67.2],[86.9,37.7],[98.4,29.5],[78.7,0.0],[68.9,6.6],[31.1,6.6]],[[21.3,8.2],[27.9,11.5],[70.5,11.5],[77.0,8.2],[90.2,27.9],[82.0,34.4],[62.3,67.2],[62.3,77.0],[60.7,78.7],[37.7,78.7],[36.1,77.0],[36.1,65.6],[16.4,34.4],[8.2,29.5]],[[49.2,32.8],[47.5,34.4],[45.9,34.4],[44.3,36.1],[44.3,42.6],[47.5,45.9],[52.5,45.9],[55.7,42.6],[55.7,36.1],[54.1,34.4],[52.5,34.4],[50.8,32.8]]];

const _SYMBOLS = { vor: _svgVor, 'vor-dme': _svgVorDme, ndb: _svgNdb, dme: _svgDme, tacan: _svgTacan };

/** SVG du symbole (remplit son conteneur — taille pilotée par le CSS). */
export function radionavSymbolSvg(kind) {
    const gen = _SYMBOLS[kind];
    if (!gen) throw new Error(`radionav : kind inconnu « ${kind} »`);
    return gen();
}

/* ---- Annotation façon document OACI ---- */

/** Fréquence au format carte : NDB en kHz entiers, VOR/DME en MHz
 *  (« 110.25 », « 413 ») — sans unité, comme sur la carte papier. */
export function radionavFreqText(freq, kind) {
    if (freq == null) return '';
    if (kind === 'tacan') return `(${(+freq).toFixed(2).replace(/0$/, '').replace(/\.$/, '')})`;   // légende : « (D) LDV (115.15) »
    return kind === 'ndb' ? String(Math.round(freq))
        : (+freq).toFixed(2).replace(/0$/, '').replace(/\.$/, '');
}

/**
 * Annotation « document » d'un radiophare : nom posé sur la ligne haute
 * du cadre (masque le trait derrière lui), « [ (D) ] IDENT FRÉQ » dans
 * le cadre. Pas de mot-type (retour pilote 27/09).
 * @param {string} kind vor | vor-dme | ndb | dme
 * @param {{ident:string, freq:number|null, officialName:string|null}} it
 * @param {{esc?:Function}} [opts] escapeHtml injecté (tests).
 */
export function radionavAnnotationHtml(kind, it, opts = {}) {
    const esc = opts.esc || ((s) => String(s));
    const dPrefix = (kind === 'vor-dme' || kind === 'dme') ? '(D) ' : '';
    const freq = radionavFreqText(it.freq, kind);
    const box = `${dPrefix}${esc(it.ident)}${freq ? ' ' + freq : ''}`;
    const name = it.officialName ? `<span class="rn-name">${esc(it.officialName)}</span>` : '';
    return `<span class="rn-ann"><span class="rn-box">${name}${box}</span></span>`;
}

/* ---- Marqueur composé : symbole + annotation + trait de rappel ---- */

/** Géométrie du trait de rappel : du milieu gauche du cadre vers le
 *  CENTRE du symbole, accroché au bord extérieur du dessin (ellipse
 *  enveloppe) — formule validée sur planche. Retourne [x1,y1,x2,y2]
 *  en coordonnées du marqueur (0,0 = coin haut-gauche du symbole).
 *  annLift : hauteur du CENTRE du cadre au-dessus du centre du symbole
 *  (le bloc .rn-ann est remonté de 20 % + 14 px ; cadre ≈ 20 px de haut
 *  → son centre ≈ 14 − 0,3×20 = 8 px au-dessus du centre). */
export function radionavLeaderLine(kind, annLift = 8, gap = 14) {
    const [w, h] = radionavMapSize(kind);
    const cx = w / 2, cy = h / 2;                       // centre du symbole
    const px = w + gap, py = cy - annLift;              // milieu gauche du cadre
    const dx = px - cx, dy = py - cy;
    const rx = w / 2 - 1, ry = h / 2 - 1;
    const t = 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2);
    return [cx + dx * t, cy + dy * t, px, py];
}

/**
 * HTML interne du marqueur : symbole (cliquable, aux dimensions réelles)
 * + annotation OACI (débordante à droite) + trait de rappel.
 * @param {string} kind vor | vor-dme | ndb | dme
 * @param {{ident:string, freq:number|null, officialName:string|null}} it
 * @param {{withLabel?:boolean, esc?:Function}} [opts]
 */
export function radionavMarkerHtml(kind, it, opts = {}) {
    const [w, h] = radionavMapSize(kind);
    let html = radionavSymbolSvg(kind);
    if (opts.withLabel) {
        const [x1, y1, x2, y2] = radionavLeaderLine(kind);
        // Cadre du trait : couvre symbole + zone d'annotation (largeur
        // 260 px, largement au-delà du cadre le plus large).
        html += `<svg class="rn-lead" width="${w + 260}" height="${h + 120}" viewBox="0 ${-60} ${w + 260} ${h + 120}" style="position:absolute;left:0;top:${-60}px;overflow:visible;pointer-events:none">`
            + `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${RADIONAV_BLUE}" stroke-width="1.5"/></svg>`;
        html += radionavAnnotationHtml(kind, it, opts);
    }
    return html;
}
