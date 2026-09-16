// Carte de vol imprimable (B7 — roadmap dossier de vol, 15/09/2026).
//
// Page A5 PAYSAGE ajoutée en DERNIÈRE page du dossier de vol : la
// « carte de secours ». Une mosaïque de tuiles Web Mercator (fond relief
// OpenTopoMap) est RECOMPOSÉE en jsPDF — jamais une capture d'écran du
// DOM — et les calques de l'app y sont redessinés en vectoriel :
// zones SIA (couleurs de la carte régionale, pointillé AZBA conservé),
// route, étapes, alternates et dégagement.
//
// Arbitrages pilote 15/09 : A5 paysage INTÉGRÉE au PDF du dossier
// (dernière page) · cadrage AUTO sur le plan (+15 %, plan + alternates
// visibles) · calques = zones SIA étiquetées + terrains/alternates (PAS
// d'étiquettes de tronçons, PAS de flèches de vent) · fond relief
// OpenTopoMap, repli vectoriel blanc si les tuiles sont indisponibles
// (hors ligne) — la carte reste alors tracée, avec mention.
//
// Ce module est VOLONTAIREMENT SANS IMPORT : drawFlightMapPage() reçoit
// un doc jsPDF existant + des données normalisées ; la collecte
// applicative (zones, plan, tuiles) est faite par l'appelant
// (flight-map-collect.js côté app, test/gen-apercu-flight-map.mjs pour
// les maquettes). Testable sous Node sans DOM.
//
// Contrat des données (d) :
//   isFr, routeLabel, generatedLabel        habillage
//   bounds {minLat,minLon,maxLat,maxLon}    emprise DÉJÀ ajustée à la page
//   tiles : null | { z, single:{data,fmt} | grid:{x0,y0,nx,ny,images:[{ix,iy,data,fmt}]} }
//   route [{lat,lon,code,name?,role:'dep'|'wp'|'dest'}]
//   alternates [{lat,lon,code,name?,diversion}]
//   zones [{rings:[[lat,lon]…]…, color, fill, dashed, label, sub, kind}]
//   legend [{label,color,dashed}], legendNote

const PAGE = { w: 595.28, h: 419.53 };   // A5 paysage (miroir du log A5 portrait)

const M = 16;            // marge extérieure (bande du pied de page)
const HDR_H = 30;        // bande titre au-dessus de la carte
const LEG_H = 15;        // bande légende sous la carte
const TILE = 256;        // tuile Web Mercator

const INK = [17, 24, 39];
const MUTED = [100, 116, 139];
const LINE = [148, 163, 184];
const ROUTE = [3, 105, 161];        // #0369A1 — la route domine les zones
const AMBER = [180, 83, 9];         // #B45309 — waypoints / dégagement
const PAPER = [253, 252, 248];      // fond blanc cassé (repli sans tuiles)

/** Zone utile de la carte sur la page (exposée pour que les collecteurs
 *  calculent l'emprise au même ratio que la page réelle). */
export function mapArea() {
    return {
        x: M + 10,
        y: M + HDR_H + 6,
        w: PAGE.w - 2 * (M + 10),
        h: PAGE.h - 2 * M - HDR_H - LEG_H - 18,
    };
}

// ---------------------------------------------------------------------------
// Projection Web Mercator — l'ESPACE PIXEL des tuiles raster : les calques
// vectoriels s'alignent au pixel près sur le fond recomposé.
// ---------------------------------------------------------------------------

export function lonToPx(lon, z) {
    return ((lon + 180) / 360) * TILE * 2 ** z;
}

export function latToPx(lat, z) {
    const s = Math.min(0.9999, Math.max(-0.9999, Math.sin((lat * Math.PI) / 180)));
    return (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * TILE * 2 ** z;
}

/** Résolution au sol (m/px) à la latitude donnée — pour l'échelle. */
export function groundMPerPx(lat, z) {
    return (156543.03392 * Math.cos((lat * Math.PI) / 180)) / 2 ** z;
}

/** Emprise de la carte : englobe les points, marge isotrope en NM, plancher
 *  de span (vol local), puis extension de la dimension courte au ratio de la
 *  zone utile — la carte remplit la page au lieu de s'y letter-boxer. */
export function computeMapBounds(points, extraPoints = [], opts = {}) {
    const marginFrac = opts.marginFrac ?? 0.15;
    const minSpanNm = opts.minSpanNm ?? 30;
    const aspect = opts.aspect ?? 0;      // 0 = pas d'ajustement de ratio
    const all = [...(points || []), ...(extraPoints || [])]
        .filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon));
    if (!all.length) return null;
    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const p of all) {
        if (p.lat < minLat) minLat = p.lat;
        if (p.lat > maxLat) maxLat = p.lat;
        if (p.lon < minLon) minLon = p.lon;
        if (p.lon > maxLon) maxLon = p.lon;
    }
    const midRad = ((minLat + maxLat) / 2) * (Math.PI / 180);
    const cosMid = Math.max(0.2, Math.cos(midRad));
    const dLatN = (maxLat - minLat) * 60;
    const dLonN = (maxLon - minLon) * 60 * cosMid;
    // Marge isotrope proportionnelle à l étendue RÉELLE (pas au plancher),
    // puis plancher de span sur CHAQUE dimension (vol local : ±15 NM).
    const marginNm = Math.max(dLatN, dLonN) * marginFrac;
    let hN = Math.max(dLatN + 2 * marginNm, minSpanNm);
    let wN = Math.max(dLonN + 2 * marginNm, minSpanNm);
    if (aspect > 0) {
        if (wN / hN < aspect) wN = hN * aspect;
        else hN = wN / aspect;
    }
    const cLat = (minLat + maxLat) / 2, cLon = (minLon + maxLon) / 2;
    return {
        minLat: cLat - hN / 120, maxLat: cLat + hN / 120,
        minLon: cLon - wN / (120 * cosMid), maxLon: cLon + wN / (120 * cosMid),
    };
}

/** Zoom tuile : le plus haut dont la largeur en pixels tient sous maxPx,
 *  relevé s'il manque de résolution à l'impression (~150 dpi en A5). */
export function pickTileZoom(b, opts = {}) {
    const minPx = opts.minPx ?? 1250;
    const maxPx = opts.maxPx ?? 1900;
    let z = 5;
    for (let k = 5; k <= 14; k++) {
        if (lonToPx(b.maxLon, k) - lonToPx(b.minLon, k) <= maxPx) z = k;
        else break;
    }
    if (z < 14 && lonToPx(b.maxLon, z) - lonToPx(b.minLon, z) < minPx) z += 1;
    return z;
}

/** Tuiles couvrant l'emprise (y Mercator croît vers le sud). */
export function tileRangeFor(b, z) {
    const x0 = Math.floor(lonToPx(b.minLon, z) / TILE);
    const x1 = Math.floor(lonToPx(b.maxLon, z) / TILE);
    const y0 = Math.floor(latToPx(b.maxLat, z) / TILE);
    const y1 = Math.floor(latToPx(b.minLat, z) / TILE);
    return { z, x0, y0, nx: x1 - x0 + 1, ny: y1 - y0 + 1 };
}

/** Garde-fou : ≤ 48 tuiles (sinon on dézoote — burst raisonnable pour
 *  le serveur communautaire OpenTopoMap et pour la taille du PDF). */
export function safeTileRange(b, z) {
    let r = tileRangeFor(b, z);
    while (r.nx * r.ny > 48 && r.z > 5) r = tileRangeFor(b, r.z - 1);
    return r;
}

// ---------------------------------------------------------------------------
// Helpers de dessin
// ---------------------------------------------------------------------------

function _hex(c) { return Array.isArray(c) ? c : [16, 24, 40]; }

/** Texte NET sur la carte — SANS halo blanc (retour pilote 16/09 : les
 *  ombres blanches sous les étiquettes rendaient le texte quasi illisible
 *  sur le fond relief). opt : {size, bold, italic, color, align, maxW}. */
function _label(doc, txt, x, y, opt = {}) {
    if (!txt) return;
    const size = opt.size ?? 7;
    const font = opt.bold ? 'bold' : (opt.italic ? 'italic' : 'normal');
    doc.setFont('helvetica', font);
    doc.setFontSize(size);
    let t = String(txt);
    if (opt.maxW) {
        while (t.length > 1 && doc.getTextWidth(t) > opt.maxW) t = t.slice(0, -1) + '…';
    }
    doc.setTextColor(..._hex(opt.color || INK));
    doc.text(t, x, y, { align: opt.align || 'left' });
}

/** Anneau [lat,lon] en chemin jsPDF fermé (deltas consécutifs — chaque
 *  sommet est relatif au PRÉCÉDENT, c'est une polyline). */
function _ringPath(doc, ring, xy, style) {
    const p0 = xy(ring[0][0], ring[0][1]);
    const seg = [];
    let prev = p0;
    for (let i = 1; i < ring.length; i++) {
        const p = xy(ring[i][0], ring[i][1]);
        seg.push([p[0] - prev[0], p[1] - prev[1]]);
        prev = p;
    }
    doc.lines(seg, p0[0], p0[1], [1, 1], style, true);
}

function _rectsOverlap(a, b) {
    return a.x < b.x + b.w + 1 && b.x < a.x + a.w + 1 && a.y < b.y + b.h + 1 && b.y < a.y + a.h + 1;
}

/** Étiquettes : réserve l'espace (priorité par ordre d'ajout — terrains
 *  AVANT zones), refuse en cas de chevauchement. */
function _makePlacer() {
    const placed = [];
    return (r) => {
        for (const p of placed) if (_rectsOverlap(p, r)) return false;
        placed.push(r);
        return true;
    };
}

/** Barre d'échelle : longueur « ronde » en NM entre 55 et 130 pt. */
function _niceScale(mppPagePt) {
    for (const nm of [5, 10, 20, 25, 50, 100]) {
        const pt = (nm * 1852) / mppPagePt;
        if (pt >= 55 && pt <= 130) return { nm, pt };
    }
    return { nm: 20, pt: (20 * 1852) / mppPagePt };
}

// ---------------------------------------------------------------------------
// LA PAGE
// ---------------------------------------------------------------------------

export function drawFlightMapPage(doc, d) {
    const isFr = d.isFr !== false;
    const b = d.bounds;
    if (!b) return false;
    const map = mapArea();
    doc.addPage([PAGE.w, PAGE.h], 'landscape');
    const z = (d.tiles && d.tiles.z) ?? d.z ?? 8;

    // Projection page : bbox Mercator -> zone carte, ajustée et centrée.
    const bx0 = lonToPx(b.minLon, z), bx1 = lonToPx(b.maxLon, z);
    const by0 = latToPx(b.maxLat, z), by1 = latToPx(b.minLat, z);
    const s = Math.min(map.w / (bx1 - bx0), map.h / (by1 - by0));
    const ox = map.x + (map.w - (bx1 - bx0) * s) / 2 - bx0 * s;
    const oy = map.y + (map.h - (by1 - by0) * s) / 2 - by0 * s;
    const xy = (lat, lon) => [ox + lonToPx(lon, z) * s, oy + latToPx(lat, z) * s];

    // Cadre extérieur (même langage que les pages du log de nav).
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.8);
    doc.rect(M, M, PAGE.w - 2 * M, PAGE.h - 2 * M);

    // ---------------- Carte (tout est clippé à la zone utile) -----------
    doc.saveGraphicsState();
    doc.rect(map.x, map.y, map.w, map.h, null);
    doc.clip();

    doc.setFillColor(...PAPER);
    doc.rect(map.x, map.y, map.w, map.h, 'F');

    // Fond tuilé : image unique recomposée, ou grille de tuiles (Node /
    // repli), ou fond blanc si indisponible (hors ligne).
    if (d.tiles && d.tiles.single) {
        const g = safeTileRange(b, z);
        const mx0 = g.x0 * TILE, my0 = g.y0 * TILE;
        const mw = g.nx * TILE, mh = g.ny * TILE;
        doc.addImage(d.tiles.single.data, d.tiles.single.fmt || 'JPEG',
            ox + mx0 * s, oy + my0 * s, mw * s, mh * s);
    } else if (d.tiles && d.tiles.grid) {
        const g = d.tiles.grid;
        for (const im of g.images || []) {
            doc.addImage(im.data, im.fmt || 'PNG',
                ox + (g.x0 + im.ix) * TILE * s, oy + (g.y0 + im.iy) * TILE * s,
                TILE * s, TILE * s);
        }
    }
    const hasTiles = !!(d.tiles && (d.tiles.single || (d.tiles.grid && d.tiles.grid.images.length)));

    // ---- Zones SIA : remplissage translucide PUIS contour net (le trait
    // plein/pointillé porte la sémantique AZBA de la carte régionale).
    const labelCands = [];
    for (const zone of d.zones || []) {
        const rings = (zone.rings || []).filter((r) => r.length >= 3);
        if (!rings.length) continue;
        // Géométrie SIA pré-densifiée : décimation à ~0.55 pt.
        const dec = [];
        for (const ring of rings) {
            const out = [ring[0]];
            for (let i = 1; i < ring.length; i++) {
                const p = xy(ring[i][0], ring[i][1]);
                const q = xy(out[out.length - 1][0], out[out.length - 1][1]);
                if ((p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 > 0.3) out.push(ring[i]);
            }
            if (out.length >= 3) dec.push(out);
        }
        if (!dec.length) continue;
        if (typeof doc.GState === 'function') {
            doc.saveGraphicsState();
            doc.setGState(new doc.GState({ opacity: zone.fillOpacity ?? 0.10 }));
            doc.setFillColor(..._hex(zone.fill || zone.color));
            for (const ring of dec) _ringPath(doc, ring, xy, 'F');
            doc.restoreGraphicsState();
        }
        doc.setDrawColor(..._hex(zone.color));
        doc.setLineWidth(zone.weight ?? 0.7);
        if (zone.dashed) doc.setLineDashPattern([2.6, 1.8], 0);
        for (const ring of dec) _ringPath(doc, ring, xy, 'S');
        if (zone.dashed) doc.setLineDashPattern([], 0);
        // Candidat étiquette : centre de la bbox de l'anneau externe.
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const p of dec[0]) {
            const q = xy(p[0], p[1]);
            if (q[0] < minX) minX = q[0]; if (q[0] > maxX) maxX = q[0];
            if (q[1] < minY) minY = q[1]; if (q[1] > maxY) maxY = q[1];
        }
        if (maxX - minX < 20 || maxY - minY < 12) continue;   // trop petite
        const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
        if (cx < map.x + 8 || cx > map.x + map.w - 8 || cy < map.y + 8 || cy > map.y + map.h - 8) continue;
        labelCands.push({ cx, cy, zone, area: (maxX - minX) * (maxY - minY) });
    }

    // ---- Route : liseré blanc PUIS trait plein — domine le fond relief.
    const rp = (d.route || []).filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon));
    const rPts = rp.map((p) => xy(p.lat, p.lon));
    if (rPts.length >= 2) {
        doc.setLineJoin('round');
        doc.setLineCap('round');
        for (const [w, col] of [[2.6, [255, 255, 255]], [1.4, ROUTE]]) {
            doc.setDrawColor(...col);
            doc.setLineWidth(w);
            const seg = [];
            for (let i = 1; i < rPts.length; i++) {
                seg.push([rPts[i][0] - rPts[i - 1][0], rPts[i][1] - rPts[i - 1][1]]);
            }
            doc.lines(seg, rPts[0][0], rPts[0][1], [1, 1], 'S', false);
        }
    }

    // ---- Terrains. Étiquettes réservées AVANT celles des zones (les
    // terrains priment : c'est une carte de navigation).
    // Un terrain HORS emprise (dégagement éloigné au-delà de la marge)
    // est RABATTU au bord de carte : direction visible, sans gonfler
    // l'échelle — la route définit seule le cadrage (« Cadrer plan »).
    const place = _makePlacer();
    const clampToMap = (x, y) => [
        Math.min(Math.max(x, map.x + 8), map.x + map.w - 8),
        Math.min(Math.max(y, map.y + 8), map.y + map.h - 8),
    ];
    for (const a of d.alternates || []) {
        if (!Number.isFinite(a.lat) || !Number.isFinite(a.lon)) continue;
        let [x, y] = xy(a.lat, a.lon);
        const clamped = x < map.x + 8 || x > map.x + map.w - 8 || y < map.y + 8 || y > map.y + map.h - 8;
        if (clamped) [x, y] = clampToMap(x, y);
        if (a.diversion) {
            // Dégagement carburant : losange ambre plein (il fait partie
            // DU plan, pas de la simple liste d'alternates).
            doc.setFillColor(...AMBER);
            doc.setDrawColor(255, 255, 255);
            doc.setLineWidth(0.6);
            doc.triangle(x, y - 4, x + 4, y, x, y + 4, 'FD');
            doc.triangle(x, y + 4, x + 4, y, x - 4, y, 'FD');
        } else {
            doc.setDrawColor(...MUTED);
            doc.setLineWidth(0.8);
            doc.setLineDashPattern([1.6, 1.2], 0);
            doc.circle(x, y, 3, 'S');
            doc.setLineDashPattern([], 0);
        }
        const label = a.diversion ? `${a.code} ${isFr ? '(dégagement)' : '(alt.)'}` : a.code;
        _label(doc, label, x + 5, y + 2, {
            size: 6, bold: !!a.diversion, italic: !a.diversion,
            color: a.diversion ? AMBER : MUTED,
        });
        doc.setFont('helvetica', a.diversion ? 'bold' : 'italic');
        doc.setFontSize(6);
        place({ x: x + 5, y: y - 5, w: doc.getTextWidth(label) + 2, h: 8 });
    }

    for (let i = 0; i < rp.length; i++) {
        const p = rp[i];
        const [x, y] = rPts[i];
        const isEnd = p.role === 'dep' || p.role === 'dest';
        doc.setFillColor(...(isEnd ? ROUTE : AMBER));
        doc.setDrawColor(255, 255, 255);
        doc.setLineWidth(0.7);
        doc.circle(x, y, isEnd ? 3.4 : 2.5, 'FD');
        if (!p.code) continue;
        _label(doc, p.code, x + 5, y - 1, { size: isEnd ? 8 : 7, bold: true, color: INK });
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(isEnd ? 8 : 7);
        const w = doc.getTextWidth(p.code) + 2;
        const h = p.name && isEnd ? 14 : 9;
        place({ x: x + 5, y: y - 7, w, h });
        if (p.name && isEnd) {
            _label(doc, p.name, x + 5, y + 4.5, { size: 5.5, color: MUTED, maxW: 90 });
        }
    }

    // ---- Étiquettes de zones (grandes d'abord, sans chevauchement).
    labelCands.sort((a, b2) => b2.area - a.area);
    let labeled = 0;
    for (const c of labelCands) {
        if (labeled >= 42) break;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(6);
        const wl = doc.getTextWidth(c.zone.label || '?') + 2;
        const hs = c.zone.sub ? 11 : 8;
        if (!place({ x: c.cx - wl / 2, y: c.cy - 6, w: wl, h: hs })) continue;
        _label(doc, c.zone.label, c.cx, c.cy, { size: 6, bold: true, color: _hex(c.zone.color), align: 'center' });
        if (c.zone.sub) {
            _label(doc, c.zone.sub, c.cx, c.cy + 5, { size: 4.8, color: MUTED, align: 'center' });
        }
        labeled++;
    }

    // ---- Rose nord (coin haut droit) et échelle linéaire (bas gauche).
    const nx = map.x + map.w - 16;
    const nyTop = map.y + 7, nyBot = map.y + 30;
    doc.setDrawColor(...INK);
    doc.setFillColor(...INK);
    doc.setLineWidth(1);
    doc.line(nx, nyBot, nx, nyTop + 5);
    doc.triangle(nx, nyTop, nx - 3.2, nyTop + 6.5, nx + 3.2, nyTop + 6.5, 'F');
    _label(doc, 'N', nx, nyBot + 4, { size: 7, bold: true, align: 'center' });

    const cLat = (b.minLat + b.maxLat) / 2;
    const mppPt = groundMPerPx(cLat, z) / s;          // mètres par point page
    const sc = _niceScale(mppPt);
    const sx = map.x + 8, sy = map.y + map.h - 10;
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.5);
    doc.rect(sx, sy, sc.pt, 2.4, 'S');
    doc.setFillColor(...INK);
    doc.rect(sx, sy, sc.pt / 2, 2.4, 'F');
    _label(doc, `${sc.nm} NM`, sx + sc.pt / 2, sy - 2.6, { size: 6, bold: true, align: 'center' });

    // Mention de repli vectoriel (tuiles indisponibles).
    if (!hasTiles) {
        _label(doc, isFr ? 'Fond de carte indisponible (hors ligne) - carte vectorielle de secours'
            : 'Base map unavailable (offline) - vector backup map',
            map.x + map.w / 2, map.y + 14, { size: 7, italic: true, color: MUTED, align: 'center' });
    }

    doc.restoreGraphicsState();
    doc.setDrawColor(...INK);
    doc.setLineWidth(0.8);
    doc.rect(map.x, map.y, map.w, map.h);

    // ---------------- Habillage ----------------------------------------
    // Aération titre/sous-titre (retour pilote 16/09 : « CARTE DE VOL » et
    // la ligne de route se touchaient) : titre remonté, sous-titre descendu
    // — ~4 pt d'air entre le jambage du 13 pt et le haut du 8 pt.
    const rx = PAGE.w - M - 10;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...INK);
    doc.text(isFr ? 'CARTE DE VOL' : 'FLIGHT MAP', M + 10, M + 15);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(String(d.routeLabel || ''), M + 10, M + 27);

    const denom = Math.round((mppPt * 72000) / 25.4 / 10000) * 10000;
    doc.setFontSize(7);
    doc.text(
        `${isFr ? 'Échelle' : 'Scale'} 1:${denom.toLocaleString('fr-FR').replace(/\u202f|\u00a0/g, ' ')}`
            + (hasTiles ? ` · ${isFr ? 'fond' : 'base'} OpenTopoMap` : ''),
        rx, M + 14, { align: 'right' });
    doc.text(String(d.generatedLabel || ''), rx, M + 26, { align: 'right' });

    // Légende : échantillons de trait + note AZBA.
    let lx = M + 10;
    const ly = M + PAGE.h - 2 * M - 8.5;
    doc.setFontSize(6.2);
    for (const item of d.legend || []) {
        doc.setDrawColor(..._hex(item.color));
        doc.setLineWidth(item.dashed ? 0.9 : 1.5);
        if (item.dashed) doc.setLineDashPattern([1.8, 1.2], 0);
        doc.line(lx, ly - 2, lx + 12, ly - 2);
        doc.setLineDashPattern([], 0);
        doc.setTextColor(...INK);
        doc.text(item.label, lx + 15, ly);
        doc.setFontSize(6.2);
        lx += 15 + doc.getTextWidth(item.label) + 9;
    }
    if (d.legendNote) {
        doc.setFont('helvetica', 'italic');
        doc.setFontSize(5.5);
        doc.setTextColor(...MUTED);
        doc.text(d.legendNote, rx, ly, { align: 'right' });
    }

    // Pied de page : même avertissement que les autres pages du dossier.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text(
        isFr
            ? 'Document généré automatiquement - aide à la préparation. Vérifiez chaque valeur avant le vol (météo, POH, VAC, NOTAM).'
            : 'Automatically generated preparation aid - verify every value before flight (weather, POH, charts, NOTAM).',
        PAGE.w / 2, PAGE.h - 5.5, { align: 'center' });

    return true;
}
