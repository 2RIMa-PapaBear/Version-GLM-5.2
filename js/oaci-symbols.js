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

/** Classe un terrain ÉTRANGER depuis un objet openAIP mappé
 *  (fetchAirportByIcao — type d'aérodrome hors France pris d'openAIP,
 *  retour pilote 27/09) : militaire → rouge ; HELI → hélistation ;
 *  fermé → désaffecté ; sinon civil. Revêtement dominant → dur/bande.
 *  Null si l'objet ne permet pas de trancher (on garde le classement
 *  de la base locale). */
export function classifyForeignSymbolOa(oa) {
    if (!oa) return null;
    const surf = String(oa.surface || '').toUpperCase();
    const surface = /^(GRS|GRASS|DIRT|DIR|GRVL|SAND|U)$/.test(surf) ? 'bande' : 'piste-dur';
    const type = String(oa.type || '').toUpperCase();
    if (oa.military) return { icon: 'militaire-' + surface, statut: 'MIL (openAIP)', surf: surf || null };
    if (type.includes('CLSD') || type.includes('CLOSED')) return { icon: 'desaffecte', statut: 'FERMÉ (openAIP)', surf: surf || null };
    if (type.includes('HELI')) return { icon: 'civil-helistation', statut: 'ÉTR (openAIP)', surf: null };
    return { icon: 'civil-' + surface, statut: 'ÉTR (openAIP)', surf: surf || null };
}

/** Classe un terrain français./** Classe un terrain français.
 *  @returns {{icon: string, statut: string, surf: string|null}|null}
 *  siaAf/siaRws : injection pour les TESTS (sinon getters sia-data). */
export function classifyOaciSymbol(icao, siaAf = null, siaRws = null, apt = null) {
    const code = String(icao || '').toUpperCase();
    const manual = MANUAL_OVERRIDES.get(code);
    if (manual) return { icon: manual.icon, statut: 'MAN', surf: null };
    // Hors France : RETOUR AUX OLIVES MÉTÉO (retour pilote 28/09 — la
    // généralisation des symboles aux étrangers est abandonnée ;
    // classifyForeignSymbolOa reste en réserve au cas où).
    if (!code.startsWith('LF')) return null;
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

/* ---- JUMEAU PDF (carte du dossier de vol) ------------------------------
 * MÊME géométrie que oaciSymbolSvg (mêmes constantes, viewBox 100 → points
 * via sizePt) tracée en primitives jsPDF — la carte imprimée est
 * IDENTIQUE à la carte régionale (harmonisation pilote 28/09). Le doc
 * jsPDF est passé en argument (module Node-safe, aucun import navigateur).
 */
const PDF_COLORS = {
    civil: [0, 64, 160], mixte: [0, 64, 160], militaire: [224, 48, 32],
};

/** Rect ABCD rempli/contourné (coins absolus). */
function _pdfQuad(doc, pts, style) {
    const seg = [];
    for (let i = 1; i < 4; i++) seg.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]]);
    seg.push([pts[0][0] - pts[3][0], pts[0][1] - pts[3][1]]);
    doc.lines(seg, pts[0][0], pts[0][1], [1, 1], style, true);
}

/** Symbole OACI `icon` tracé sur doc, centré (cx, cy), diamètre ~sizePt.
 *  Rotation « piste-dur » au cap réel comme à l'écran. */
export function oaciSymbolDrawPdf(doc, icon, bearing, cx, cy, sizePt = 9) {
    const name = String(icon || '');
    const s = sizePt / 100;                       // unités viewBox 100 → pt
    const P = (ux, uy) => [cx + (ux - 50) * s, cy + (uy - 50) * s];
    if (name === 'desaffecte') {
        const c = [20, 20, 20];
        doc.setDrawColor(...c);
        doc.setLineWidth(16 * s);
        doc.circle(cx, cy, 28 * s, 'S');
        doc.setLineWidth(7 * s);
        doc.line(...P(32, 32), ...P(68, 68));
        doc.line(...P(68, 32), ...P(32, 68));
        return;
    }
    if (name === 'prive') {
        // Jumeau exact du SVG : cardinaux + disque + P blanc (jambe +
        // panse pleine, contre-point bleu).
        const c = PDF_COLORS.civil;
        doc.setFillColor(...c);
        const tickW = 10.8, tickOut = 48, attach = 36, h = tickOut - attach;
        [[50 - tickW / 2, 50 - tickOut, tickW, h], [50 + attach, 50 - tickW / 2, h, tickW],
         [50 - tickW / 2, 50 + attach, tickW, h], [50 - tickOut, 50 - tickW / 2, h, tickW]]
            .forEach(([x, y, w, hh]) => {
                const p1 = P(x, y), p2 = P(x + w, y + hh);
                doc.rect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], 'F');
            });
        doc.circle(cx, cy, 36 * s, 'F');
        doc.setFillColor(255, 255, 255);
        const j1 = P(40, 27), j2 = P(49, 77);
        doc.rect(j1[0], j1[1], j2[0] - j1[0], j2[1] - j1[1], 'F');          // jambe
        doc.circle(...P(55, 37), 14 * s, 'F');                              // panse
        doc.setFillColor(...c);
        doc.circle(...P(55, 37), 7 * s, 'F');                               // contre-point
        return;
    }
    const st = OACI_STYLES[name.split('-')[0]];
    const type = name.split('-').slice(1).join('-');
    if (!st || !['piste-dur', 'bande', 'helistation', 'hydro'].includes(type)) return;
    const c = PDF_COLORS[name.split('-')[0]] || PDF_COLORS.civil;
    doc.setDrawColor(...c);
    doc.setFillColor(...c);
    const discR = 36, outerR = 25.6, outerW = 4.4, tickW = 10.8, tickOut = 48;
    const attach = st.doubleRing ? outerR + outerW / 2 : (type === 'bande' ? 34 + 3.5 : discR);
    // 4 traits cardinaux COLLÉS (N E S W — rects pleins)
    const h = tickOut - attach;
    [[50 - tickW / 2, 50 - tickOut, tickW, h], [50 + attach, 50 - tickW / 2, h, tickW],
     [50 - tickW / 2, 50 + attach, tickW, h], [50 - tickOut, 50 - tickW / 2, h, tickW]]
        .forEach(([x, y, w, hh]) => {
            const p1 = P(x, y), p2 = P(x + w, y + hh);
            doc.rect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], 'F');
        });
    if (st.doubleRing) {
        doc.setLineWidth(outerW * s);
        doc.circle(cx, cy, outerR * s, 'S');
    }
    if (type === 'piste-dur') {
        doc.circle(cx, cy, discR * s, 'F');
        // canal blanc pivoté au cap (même rotation que le SVG rotate(hdg))
        const hdg = Number.isFinite(bearing) ? ((bearing % 180) + 180) % 180 : OACI_BAR_HEADING;
        const a = hdg * Math.PI / 180, chW = 14 / 2, chH = 37.5;
        const rot = (dx, dy) => [cx + (dx * Math.cos(a) - dy * Math.sin(a)) * s,
            cy + (dx * Math.sin(a) + dy * Math.cos(a)) * s];
        const pts = [rot(-chW, -chH), rot(chW, -chH), rot(chW, chH), rot(-chW, chH)];
        doc.setFillColor(255, 255, 255);
        _pdfQuad(doc, pts, 'F');
    } else if (type === 'bande') {
        doc.setLineWidth(7 * s);
        doc.circle(cx, cy, 34 * s, 'S');
    } else if (type === 'helistation') {
        doc.circle(cx, cy, discR * s, 'F');
        doc.setFillColor(255, 255, 255);
        [[-14, -19, 9, 38], [5, -19, 9, 38], [-14, -4, 28, 8]].forEach(([x, y, w, hh]) => {
            const p1 = P(50 + x, 50 + y), p2 = P(50 + x + w, 50 + y + hh);
            doc.rect(p1[0], p1[1], p2[0] - p1[0], p2[1] - p1[1], 'F');
        });
    } else if (type === 'hydro') {
        // disque + ancre stylisée (lignes blanches)
        doc.circle(cx, cy, discR * s, 'F');
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(7 * s);
        doc.line(...P(50, 29), ...P(50, 60));
        doc.line(...P(35, 36), ...P(65, 36));
        // arc de la coche : 2 segments approchés (assez à cette taille)
        doc.line(...P(35, 54), ...P(43, 46));
        doc.line(...P(65, 54), ...P(57, 46));
        doc.line(...P(43, 46), ...P(57, 46));
    }
}
