// Zones P — rangée de croix « XXX » côté INTÉRIEUR (pilote 30/09) : une
// fine ligne rouge pleine borde la zone et des croix rouges courent le
// long de la limite, décalées vers l'intérieur, comme sur la carte
// papier.
//
// Noyau PUR 2D sans AUCUNE dépendance (DOM compris) : importé à la fois
// par la carte écran (js/airspaces.js, coordonnées mètres) et par la
// carte PDF imprimable (js/flight-map-pdf.js, points d'impression). L'axe
// y du PDF est VERS LE BAS mais ne demande aucun drapeau : une réflexion
// retourne ENSEMBLE le signe de l'aire et la normale intérieure — la
// géométrie est invariante (vérifié par test).

/** Croix d'un anneau de zone P — ou HACHURES « / » des zones R/D/CBA
 *  (pilote 30/09 : `slash = true` → UN SEUL trait par position, le bras à
 *  +45° du sens de marche : la rangée se lit « ////// »). `pts` = sommets
 *  2D quelconques (fermés ou non), `spec` = { size, spacing, inset } dans
 *  l'unité de `pts` (mètres à l'écran, points sur le PDF).
 *
 *  La rangée vit sur la LIGNE EN RETRAIT de `inset` (polygone offset en
 *  mitre par bissectrice — pilote 30/09 : « sur les cercles ce n'est pas
 *  bon ») : sur une COURBE le retrait suit le rayon de courbure et les
 *  marques y sont RÉGULIÈRES, sur une ligne droite l'offset est parallèle
 *  (comportement inchangé). Chaque marque est ORIENTÉE PAR la ligne qui
 *  la porte : bras à ±45° de la direction locale, comme une lettre écrite
 *  le long du texte. Avec inset = size·√½/2 la marque est EN CONTACT avec
 *  la limite (un cheveu de plus, couvert par l'épaisseur du trait — le
 *  filet de sécurité empêche tout franchissement). Espacée de `spacing`
 *  le long de la ligne porteuse (pas réparti : la rangée se referme sans
 *  couture) ; sur un petit cercle, la convergence des bras INTÉRIEURS
 *  peut les faire se chevaucher légèrement — toléré (pilote 30/09), les
 *  bras côté limite restent réguliers.
 *  Retour : segments [[p1, p2], …] — DEUX par croix, UN par hachure.
 *  Exporté pour les tests (via airspaces.js) et flight-map-pdf.js. */
export function _crossSegments2D(pts, spec, slash = false) {
    const p = (pts || []).slice();
    // Sommet de fermeture éventuel (premier = dernier) retiré : le
    // parcours boucle par modulo.
    if (p.length >= 2) {
        const a = p[0], b = p[p.length - 1];
        if (Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) p.pop();
    }
    const n = p.length;
    if (n < 3 || !(spec?.size > 0) || !(spec?.spacing > 0) || !(spec?.inset >= 0)) return [];
    // Côté intérieur : aire signée de Gauss. Positive = parcours CCW en
    // repère direct → intérieur à GAUCHE du sens de marche.
    let signed = 0;
    for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        signed += a[0] * b[1] - b[0] * a[1];
    }
    const mathLeft = signed > 0;
    // Arêtes utiles (longueurs nulles écartées) : direction + normale
    // INTÉRIEURE (± quart de tour selon le côté intérieur).
    const edges = [];
    for (let i = 0; i < n; i++) {
        const a = p[i], b = p[(i + 1) % n];
        const dx = b[0] - a[0], dy = b[1] - a[1];
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        const ux = dx / len, uy = dy / len;
        edges.push({
            x: a[0], y: a[1], ux, uy,
            nx: mathLeft ? -uy : uy,
            ny: mathLeft ? ux : -ux,
        });
    }
    const m = edges.length;
    if (m < 3) return [];

    // LIGNE PORTEUSE (offset en mitre) : sommet en retrait = bissectrice
    // intérieure des deux arêtes × inset/cos(Δ/2), plafonné à 2,5·inset
    // (pointe très vive). Un sommet de densification (~3-10° sur les
    // cercles SIA) n'est PAS un angle vif : seuil à 25° pour la garde de
    // coin, sinon chaque sommet de cercle écarterait ses croix et les
    // empilerait sur les petits arcs.
    const TURN_SHARP = Math.sin(25 * Math.PI / 180);
    const verts = [];           // sommets de la ligne porteuse
    let rowPerim = 0;
    for (let j = 0; j < m; j++) {
        const e = edges[j], f = edges[(j + m - 1) % m];
        let bx = f.nx + e.nx, by = f.ny + e.ny;
        const bl = Math.hypot(bx, by);
        if (bl < 1e-9) { bx = e.nx; by = e.ny; } else { bx /= bl; by /= bl; }
        const dot = f.ux * e.ux + f.uy * e.uy;
        const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
        const miter = spec.inset / Math.max(cosHalf, 0.4);
        verts.push({
            x: e.x + bx * miter, y: e.y + by * miter,
            // angle VIF CONVEXE seul (tournant vers l'intérieur)
            sharp: Math.abs(f.ux * e.uy - f.uy * e.ux) >= TURN_SHARP
                && ((f.ux * e.uy - f.uy * e.ux > 0) === mathLeft),
        });
    }
    // Arêtes de la ligne porteuse (parallèles aux arêtes d'origine sur
    // les sections droites) + longueurs cumulées.
    const row = [];
    for (let j = 0; j < m; j++) {
        const a = verts[j], b = verts[(j + 1) % m];
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        if (len < 1e-9) continue;
        row.push({
            cum: rowPerim, x: a.x, y: a.y, ux: dx / len, uy: dy / len, len,
            sharpStart: verts[j].sharp,
            sharpEnd: verts[(j + 1) % m].sharp,
        });
        rowPerim += len;
    }
    if (row.length < 3 || rowPerim < spec.size * 1.2) return [];   // trop petit : rien
    // Angle vif convexe : la croix y est écartée d'AU MOINS sa demi-
    // emprise (+2 %) — elle reste EN CONTACT des deux arêtes du coin
    // (peint par l'épaisseur du trait) sans jamais les franchir.
    const h = spec.size / 2, q = Math.SQRT1_2;
    const pad = Math.max(spec.inset, q * h * 1.02);
    // Pas réparti pour refermer la rangée SANS couture (multiple entier du
    // périmètre PORTEUR), départ à un demi-pas pour éviter un X sur un
    // sommet.
    const count = Math.max(2, Math.round(rowPerim / spec.spacing));
    const step = rowPerim / count;
    // Filet de sécurité : une croix dont une pointe sort de l'anneau est
    // ÉCARTÉE (pointe très aiguë, mitre plafonné…). Test ray-crossing
    // O(n) par point — zones P seulement, peu nombreuses.
    const inside = (x, y) => {
        let c = false;
        for (let i = 0, j = n - 1; i < n; j = i++) {
            const a = p[i], b = p[j];
            if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c;
        }
        return c;
    };
    // Filet de sécurité : une marque dont une pointe SORT VRAIMENT de
    // l'anneau est écartée (pointe très aiguë, mitre plafonné…). Les
    // marques TOUCHENT la limite par conception : une pointe qui la
    // frôle à moins de ε (bosses sub-pixel des cercles publiés, arrondis
    // flottants) n'est pas « dehors » — ε ≈ 8 % de la taille, sous
    // l'épaisseur du trait. Test ray-crossing O(n) par point, distance
    // au contour seulement en recours — zones P/R/D, peu nombreuses.
    const eps = spec.size * 0.08;
    const distEdge = (x, y) => {
        let dmin = Infinity;
        for (let i = 0; i < n; i++) {
            const a = p[i], b = p[(i + 1) % n];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
            const ex = x - (a[0] + t * dx), ey = y - (a[1] + t * dy);
            const d2 = ex * ex + ey * ey;
            if (d2 < dmin) dmin = d2;
        }
        return Math.sqrt(dmin);
    };
    const okPt = (x, y) => inside(x, y) || distEdge(x, y) <= eps;
    const out = [];
    let ei = 0;
    for (let k = 0; k < count; k++) {
        const s = (k + 0.5) * step;
        while (ei + 1 < row.length && s >= row[ei + 1].cum) ei++;
        const e = row[ei];
        const tMin = e.sharpStart ? pad : 0;
        const tMax = Math.max(tMin, e.len - (e.sharpEnd ? pad : 0));
        const t = Math.min(Math.max(s - e.cum, tMin), tMax);
        const cx = e.x + e.ux * t;
        const cy = e.y + e.uy * t;
        // Orientation (pilote 30/09) : bras à ±45° de la direction LOCALE
        // de la ligne porteuse — la marque suit la ligne, comme une lettre
        // écrite le long du texte. Taille = diagonale COMPLÈTE.
        const ax1 = (e.ux - e.uy) * q * h, ay1 = (e.ux + e.uy) * q * h;   // +45°
        const ax2 = (e.ux + e.uy) * q * h, ay2 = (e.uy - e.ux) * q * h;   // −45°
        const s1 = [[cx - ax1, cy - ay1], [cx + ax1, cy + ay1]];   // bras « / »
        if (slash) {
            if (s1.every(([x, y]) => okPt(x, y))) out.push(s1);
        } else {
            const s2 = [[cx - ax2, cy - ay2], [cx + ax2, cy + ay2]];
            if (s1.concat(s2).every(([x, y]) => okPt(x, y))) out.push(s1, s2);
        }
    }
    return out;
}

/** Marques (« XXX » ou « /// ») d'une zone P/R/D en LAT/LON ([lat, lon]
 *  comme le reste du module airspaces) : anneau projeté en mètres autour
 *  de son origine, marques du noyau 2D, reprojettées en degrés. Exporté
 *  pour les tests. */
export function _pZoneCrossSegments(ring, spec, slash = false) {
    if (!Array.isArray(ring) || ring.length < 3) return [];
    const lat0 = ring[0][0], lon0 = ring[0][1];
    const kLat = 111320;
    const kLon = 111320 * Math.cos(lat0 * Math.PI / 180) || 1;
    const pts = ring.map(([la, lo]) => [(lo - lon0) * kLon, (la - lat0) * kLat]);
    return _crossSegments2D(pts, spec, slash)
        .map(seg => seg.map(([x, y]) => [lat0 + y / kLat, lon0 + x / kLon]));
}
