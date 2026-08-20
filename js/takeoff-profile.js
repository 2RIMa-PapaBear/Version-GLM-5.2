/* ================================================================
 * TAKEOFF PROFILE — Schéma de décollage en coupe (SVG)
 * ================================================================
 *
 * Vue de profil du décollage, façon « coupe de piste » :
 *   - avion posé au seuil,
 *   - segment de roulement jusqu'à la rotation,
 *   - segment de montée jusqu'au franchissement des 50 ft
 *     (avion en vol à cet endroit),
 *   - fin de piste, marge restante (ou manque) mise en couleur.
 *
 * Module SANS dépendance (fonctions pures) : insérable dans le
 * widget takeoff ET testable sous Node (QA géométrique).
 *
 * L'échelle horizontale est proportionnelle aux distances ; la
 * hauteur « 50 ft » est schématique (une vraie échelle rendrait la
 * montée invisible : 15 m de haut pour 400 m de long).
 * ================================================================ */

// Compteur pour des ids de pattern uniques (plusieurs SVG par page).
let _uidSeq = 0;

const FT_TO_M = 0.3048;
function ftToM(ft) { return Math.round(ft * FT_TO_M); }

// Géométrie du viewBox (340 × 108).
const W = 340, H = 108;
const X0 = 16;     // seuil de piste
const XR = 330;    // bord droit utile
const RWY_Y = 76;  // ligne de piste
const FT50_Y = 26; // altitude 50 ft (schématique)

const LEVEL_COLORS = { ok: '#10B981', caution: '#F59E0B', danger: '#EF4444', unknown: '#38BDF8' };
const MONO = "'DM Mono',monospace";

// Silhouette d'avion de profil (nez à droite, ~22 unités de long,
// origine = centre du fuselage, y vers le bas). Une seule couleur de
// remplissage pour rester lisible à ~25 px.
const PLANE_BODY = 'M11 0C10.8-1.5 8.6-2.5 6-2.5C2.8-2.5-1-1.9-4.6-1.2L-9.2-5.1L-9.8-1'
    + 'C-10-.2-9.8.5-8.8.7C-5 1.5 1 2.1 5 1.9C8 1.8 10.4 1.1 11 0Z';
const PLANE_WING = 'M2.6-.7L-3.3 2.7L-1.2 3.1L4 .4Z';

/**
 * Calcule le layout (positions en px) du schéma pour un résultat
 * takeoff donné. Exporté pour la QA géométrique (tests Node).
 *
 * @param {{groundRoll:number, fiftyFt:number, runwayLength:number|null,
 *          margin:number|null, level:string}} r Résultat evaluateTakeoffPerformance.
 * @returns {{W:number,H:number,x0:number,xR:number,rwyY:number,fiftyY:number,
 *            pxPerFt:number,liftX:number,fiftyX:number,rwyEndX:number|null,
 *            labelLiftX:number,col:string}}
 */
export function takeoffProfileLayout(r) {
    // Étendue horizontale : la piste entière tient dans le cadre ;
    // si le 50 ft dépasse la piste (danger), on élargit l'échelle
    // pour que l'avion en vol reste visible APRÈS la fin de piste.
    const spanFt = r.runwayLength != null
        ? Math.max(r.runwayLength, r.fiftyFt * 1.06)
        : r.fiftyFt * 1.15;
    const pxPerFt = (XR - X0) / spanFt;

    const rollFt = Math.min(r.groundRoll, r.fiftyFt); // garde-fou
    const liftX = X0 + rollFt * pxPerFt;
    const fiftyX = X0 + r.fiftyFt * pxPerFt;
    const rwyEndX = r.runwayLength != null ? X0 + r.runwayLength * pxPerFt : null;

    // Étiquette du point de rotation : bornée à droite pour ne pas
    // chevaucher l'étiquette de fin de piste.
    const rightBound = (rwyEndX != null ? Math.min(rwyEndX, XR) : XR) - 26;
    const labelLiftX = Math.max(X0 + 20, Math.min(liftX, rightBound));

    // Étiquette de longueur de piste : ancre « end » près de la fin de
    // piste, bornée au bord droit (sinon elle déborde quand la piste
    // remplit tout le cadre).
    const labelLenX = rwyEndX != null ? Math.min(rwyEndX + 14, XR) : null;

    return {
        W, H, x0: X0, xR: XR, rwyY: RWY_Y, fiftyY: FT50_Y,
        pxPerFt, liftX, fiftyX, rwyEndX, labelLiftX, labelLenX,
        col: LEVEL_COLORS[r.level] || LEVEL_COLORS.unknown,
    };
}

/**
 * Rend le schéma de décollage en coupe (SVG inline).
 * @param {Object} r Résultat evaluateTakeoffPerformance.
 * @param {boolean} [isFr] Langue des étiquettes.
 * @returns {string} HTML du SVG.
 */
export function takeoffProfileSvg(r, isFr = true) {
    const L = takeoffProfileLayout(r);
    const uid = 'tp' + (++_uidSeq);
    const muted = 'var(--text-muted)';
    const known = L.rwyEndX != null;
    const groundEnd = known ? L.rwyEndX : XR;
    const p = [];

    const aria = isFr
        ? 'Profil de décollage : roulement, rotation puis montée au franchissement des 50 ft'
        : 'Takeoff profile: ground roll, rotation then climb to 50 ft';

    // ---- Hachures de coupe de sol (pattern unique par instance) ----
    p.push(`<defs><pattern id="${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
        + `<line x1="0" y1="0" x2="0" y2="6" stroke="#64748B" stroke-width="1.3" opacity="0.35"/></pattern></defs>`);

    // ---- Sol : ligne de piste + coupe hachurée ----
    p.push(`<line x1="${X0}" y1="${RWY_Y}" x2="${groundEnd}" y2="${RWY_Y}" stroke="#64748B" stroke-width="2" stroke-linecap="round"${known ? '' : ' stroke-dasharray="5 4"'}/>`);
    p.push(`<rect x="${X0}" y="${RWY_Y + 3}" width="${Math.max(0, groundEnd - X0)}" height="7" fill="url(#${uid})"/>`);
    p.push(`<line x1="${X0}" y1="${RWY_Y - 5}" x2="${X0}" y2="${RWY_Y + 2}" stroke="#64748B" stroke-width="1.5"/>`);
    if (known) p.push(`<line x1="${L.rwyEndX}" y1="${RWY_Y - 5}" x2="${L.rwyEndX}" y2="${RWY_Y + 2}" stroke="#64748B" stroke-width="1.5"/>`);

    // ---- Trajectoire : roulement puis montée ----
    p.push(`<line x1="${X0 + 2}" y1="${RWY_Y - 2.5}" x2="${L.liftX}" y2="${RWY_Y - 2.5}" stroke="${L.col}" stroke-width="3" stroke-linecap="round"/>`);
    p.push(`<line x1="${L.liftX}" y1="${RWY_Y - 3}" x2="${L.fiftyX}" y2="${FT50_Y + 7}" stroke="${L.col}" stroke-width="2.5" stroke-linecap="round"/>`);
    // Repère de hauteur au point 50 ft.
    p.push(`<line x1="${L.fiftyX}" y1="${FT50_Y + 8}" x2="${L.fiftyX}" y2="${RWY_Y}" stroke="${muted}" stroke-width="1" stroke-dasharray="2 3" opacity="0.6"/>`);

    // ---- Marge restante / manque ----
    if (known && r.margin != null) {
        if (r.margin >= 0) {
            const mw = L.rwyEndX - L.fiftyX - 6;
            if (mw > 4) {
                p.push(`<rect x="${L.fiftyX + 3}" y="${RWY_Y - 8}" width="${mw}" height="3.5" rx="1.5" fill="${L.col}" opacity="0.5"/>`);
                if (mw >= 34) {
                    p.push(`<text x="${(L.fiftyX + L.rwyEndX) / 2}" y="${RWY_Y - 12}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${L.col}">+${ftToM(r.margin)} m</text>`);
                }
            }
        } else {
            const mw = L.fiftyX - L.rwyEndX - 6;
            if (mw > 4) {
                p.push(`<rect x="${L.rwyEndX + 3}" y="${RWY_Y - 8}" width="${mw}" height="3.5" rx="1.5" fill="#EF4444" opacity="0.55"/>`);
            }
            p.push(`<text x="${L.fiftyX + 4}" y="${RWY_Y - 12}" text-anchor="end" font-family="${MONO}" font-size="9" fill="#EF4444">${isFr ? 'manque' : 'short'} ${ftToM(Math.abs(r.margin))} m</text>`);
        }
    }

    // ---- Avions ----
    p.push(planeGrounded(X0 + 16, RWY_Y - 6.2));
    p.push(planeAirborne(L.fiftyX - 13, FT50_Y - 2.5, L.col));

    // ---- Étiquettes ----
    p.push(`<text x="${X0}" y="${RWY_Y + 20}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${muted}">0</text>`);
    p.push(`<text x="${L.labelLiftX}" y="${RWY_Y + 20}" text-anchor="middle" font-family="${MONO}" font-size="9" fill="${muted}">${ftToM(Math.min(r.groundRoll, r.fiftyFt))} m</text>`);
    p.push(`<text x="${L.fiftyX + 2}" y="${FT50_Y - 10}" text-anchor="end" font-family="${MONO}" font-size="9" fill="${L.col}">50 ft · ${ftToM(r.fiftyFt)} m</text>`);
    if (known) {
        p.push(`<text x="${L.labelLenX}" y="${RWY_Y + 20}" text-anchor="end" font-family="${MONO}" font-size="9" fill="${muted}">${ftToM(r.runwayLength)} m</text>`);
    } else {
        p.push(`<text x="${XR}" y="${RWY_Y + 20}" text-anchor="end" font-family="'DM Sans',sans-serif" font-size="8.5" font-style="italic" fill="${muted}">${isFr ? 'longueur piste ?' : 'runway length ?'}</text>`);
    }

    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${aria}" style="width:100%; height:auto; display:block;">${p.join('')}</svg>`;
}

/** Avion posé (train sorti, roues au sol) — origine = contact roues. */
function planeGrounded(x, y) {
    const c = 'var(--text-color)';
    return `<g transform="translate(${x} ${y}) scale(1.18)" fill="${c}" opacity="0.85">`
        + `<path d="${PLANE_BODY}"/><path d="${PLANE_WING}"/>`
        + `<path d="M3.4 1.6L4.4 4M-.6 1.8L-.9 4" stroke="${c}" stroke-width="0.9" fill="none"/>`
        + `<circle cx="4.4" cy="4.6" r="1.4"/><circle cx="-1" cy="4.8" r="1.5"/>`
        + `<path d="M-8.4 1.2L-8.8 2.6" stroke="${c}" stroke-width="0.8" fill="none"/><circle cx="-8.9" cy="3.1" r="0.7"/>`
        + `</g>`;
}

/** Avion en vol (légèrement cabré, train rentré) — couleur du verdict. */
function planeAirborne(x, y, col) {
    return `<g transform="translate(${x} ${y}) rotate(-10) scale(1.18)" fill="${col}">`
        + `<path d="${PLANE_BODY}"/><path d="${PLANE_WING}"/>`
        + `</g>`;
}
