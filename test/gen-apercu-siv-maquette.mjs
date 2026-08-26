// MAQUETTE SIV v3 — d'après la proposition de l'utilisateur (capture du
// 26/08 + arbitrage du jour) : rectangles d'altitude nichés sur le profil,
// façon EFB. À L'ÉCRAN : rectangles sans texte, infobulle au survol
// (nom, ALT MIN/ALT MAX, fréquence). DANS LE LOG PDF : mêmes rectangles
// avec étiquettes compactes imprimées (nom + fréquence + plafond par
// secteur) puisqu'il n'y a pas de survol sur le papier.
// Données réelles LFPB - LFRM (corridor openAIP du 26/08/2026).
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8'))(_m, _m.exports, require);
const { jsPDF } = _m.exports;

// Thème papier (log PDF) / thème écran (app).
const PAPER = {
    ink: [26, 32, 44], muted: [110, 120, 135], grid: [200, 208, 218], plotBg: [246, 248, 251],
    siv: [13, 110, 180], sivFill: [226, 242, 252], sivInk: [10, 80, 140],
    terrain: [234, 138, 50], terrainBg: [253, 232, 214], cruise: [40, 120, 190],
};
const SCREEN = {
    ink: [226, 232, 240], muted: [148, 163, 184], grid: [30, 41, 59], plotBg: [15, 23, 42],
    siv: [96, 165, 250], sivFill: [30, 58, 92], sivInk: [147, 197, 253],
    terrain: [240, 160, 80], terrainBg: [46, 34, 24], cruise: [56, 189, 248],
};

const TOTAL_NM = 107.7, CRUISE_FT = 2500;

// Groupes de zones traversées (tronçons en NM, plafonds en ft). Les 3
// secteurs SEINE (même organisme, même fréquence) sont fusionnés : un seul
// rectangle, séparateurs internes pointillés, plafond par secteur.
// labelPos (version PDF) : topleft = zone englobante ; center = imbriquée
// large ; rotate = bande étroite, texte vertical.
const GROUPS = [
    { name: 'PARIS SUD INFO',   freq: '126.100', a: 0,  b: 30,  labelPos: 'topleft', segs: [{ a: 0,  b: 30,  up: 19500 }] },
    { name: 'LE BOURGET INFO',  freq: '123.835', a: 16, b: 21,  labelPos: 'rotate',  segs: [{ a: 16, b: 21,  up: 4500 }] },
    { name: 'CHEVREUSE INFO',   freq: '119.305', a: 22, b: 30,  labelPos: 'rotate',  segs: [{ a: 22, b: 30,  up: 2000 }] },
    { name: 'PARIS OUEST INFO', freq: '129.625', a: 31, b: 108, labelPos: 'topleft', segs: [{ a: 31, b: 108, up: 19500 }] },
    { name: 'SEINE INFO',       freq: '127.815', a: 40, b: 96,  labelPos: 'center',  segs: [{ a: 40, b: 59, up: 6500 }, { a: 60, b: 84, up: 8500 }, { a: 85, b: 96, up: 11500 }] },
    { name: 'NANTES INFO',      freq: '130.275', a: 96, b: 108, labelPos: 'center',  segs: [{ a: 96, b: 108, up: 11500 }] },
];
const HOVER_GROUP = 4;   // SEINE : infobulle simulée sur la page écran

const fmtAlt = (ft) => ft >= 4000 && ft % 500 === 0 ? `FL${String(ft / 100).padStart(3, '0')}` : `${ft} ft`;
const terrainAt = (nm) =>
    150 + 1650 * Math.exp(-(((nm - 20) / 26) ** 2))
        + 900 * Math.exp(-(((nm - 70) / 18) ** 2))
        + 700 * Math.exp(-(((nm - 100) / 14) ** 2));

// ---- Auto-QA : constructeur enregistrant chaque doc.text() (pattern
// qa-navlog-geometry.mjs) pour détecter les chevauchements en fin de run.
const TEXTS = [];
function RecordingCtor(opts) {
    const doc = new jsPDF(opts);
    const origText = doc.text.bind(doc);
    doc.text = (text, x, y, opt) => {
        const s = Array.isArray(text) ? text.join('\n') : String(text);
        const size = doc.getFontSize();
        const w = doc.getTextWidth(s);
        let bx = x;
        if (opt?.align === 'right') bx = x - w;
        else if (opt?.align === 'center') bx = x - w / 2;
        if (opt?.angle) {
            // angle 90 : le texte progresse vers le HAUT depuis l'ancre.
            TEXTS.push({ s, page: doc.internal.getCurrentPageInfo().pageNumber, x: x - size * 0.36, w: size * 0.72, top: y - w, bot: y });
        } else {
            TEXTS.push({ s, page: doc.internal.getCurrentPageInfo().pageNumber, x: bx, w, top: y - size * 0.72, bot: y + size * 0.20 });
        }
        return origText(text, x, y, opt);
    };
    return doc;
}

const doc = RecordingCtor({ unit: 'pt', format: 'a4' });
const L = 16, R = 403;

/** Le profil + rectangles d'altitude nichés. mode: 'screen' (pas de texte,
 *  infobulle simulée sur HOVER_GROUP) | 'print' (étiquettes compactes). */
function profile(yTop, yMax, T, mode) {
    const xL = L + 42, xR = R - 6, CH = 150, yT = yTop, yB = yT + CH;
    const plotW = xR - xL;
    const xOf = (nm) => xL + (nm / TOTAL_NM) * plotW;
    const yOf = (e) => yT + (1 - Math.min(e, yMax) / yMax) * CH;
    const ink = (c) => doc.setTextColor(...c);

    doc.setFillColor(...T.plotBg); doc.rect(xL, yT, plotW, CH, 'F');

    // Grille + axe Y.
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
    for (let i = 0; i <= 4; i++) {
        const gy = yT + (1 - i / 4) * CH;
        doc.setDrawColor(...T.grid); doc.setLineWidth(0.4); doc.line(xL, gy, xR, gy);
        ink(T.muted); doc.text(`${Math.round(yMax * i / 4)} ft`, xL - 4, gy + 2.2, { align: 'right' });
    }

    // ---- 1. Rectangles d'altitude (rects seuls) ----
    for (const g of GROUPS) {
        const maxUp = Math.max(...g.segs.map(s => s.up));
        const clamped = maxUp > yMax;
        const x0 = xOf(g.a), x1 = xOf(g.b);
        const yTopBand = yOf(clamped ? yMax : maxUp), yBotBand = yOf(0);

        doc.setFillColor(...T.sivFill);
        doc.setDrawColor(...T.siv); doc.setLineWidth(0.8);
        doc.rect(x0 + 0.5, yTopBand, x1 - x0 - 1, yBotBand - yTopBand, 'FD');
        if (clamped) {   // plafond hors échelle : bord haut en pointillés
            doc.setLineDashPattern([2.5, 2], 0); doc.setLineWidth(1);
            doc.line(x0 + 0.5, yT + 0.7, x1 - 0.5, yT + 0.7);
            doc.setLineDashPattern([], 0);
        }
        doc.setLineDashPattern([2, 2], 0); doc.setLineWidth(0.6);
        for (let i = 1; i < g.segs.length; i++) {
            const sx = xOf((g.segs[i - 1].b + g.segs[i].a) / 2);
            doc.line(sx, yTopBand, sx, yBotBand);
        }
        doc.setLineDashPattern([], 0);
        g._yTopBand = yTopBand; g._yBotBand = yBotBand; g._clamped = clamped;
    }

    // ---- 2. Terrain + croisière ----
    const pts = [];
    for (let nm = 0; nm <= TOTAL_NM; nm += 1.5) pts.push([nm, terrainAt(nm)]);
    const segs = [[0, yOf(pts[0][1]) - yB]];
    for (let i = 1; i < pts.length; i++) {
        segs.push([xOf(pts[i][0]) - xOf(pts[i - 1][0]), yOf(pts[i][1]) - yOf(pts[i - 1][1])]);
    }
    segs.push([0, yB - yOf(pts[pts.length - 1][1])]);
    doc.setFillColor(...T.terrainBg);
    doc.lines(segs, xOf(0), yB, [1, 1], 'F', false);
    doc.setDrawColor(...T.terrain); doc.setLineWidth(1.4);
    doc.lines(segs.slice(1, -1), xOf(0), yB, [1, 1], 'S', false);

    const yCr = yOf(CRUISE_FT);
    doc.setDrawColor(...T.cruise); doc.setLineWidth(0.7); doc.setLineDashPattern([4, 3], 0);
    doc.line(xL, yCr, xR, yCr);
    doc.setLineDashPattern([], 0);
    doc.setFillColor(...T.cruise); doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6);
    const lab = `${CRUISE_FT} ft`;
    doc.rect(xL + 3, yCr - 4, doc.getTextWidth(lab) + 6, 8, 'F');
    doc.text(lab, xL + 6, yCr + 1.5);

    // ---- 3. Étiquettes ----
    if (mode === 'print') {
        for (const g of GROUPS) {
            const { _yTopBand: yTopBand, _yBotBand: yBotBand, _clamped: clamped } = g;
            const x0 = xOf(g.a), x1 = xOf(g.b);

            // Plafond par secteur : zone englobante à gauche (évite les
            // collisions avec les plafonds des zones imbriquées).
            doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); ink(T.sivInk);
            if (g.labelPos === 'topleft') {
                const s = g.segs[0];
                const capped = s.up > yMax;
                doc.text((capped ? '> ' : '') + fmtAlt(s.up), x0 + 3, capped ? yT + 6.5 : yOf(s.up) + 6);
            } else {
                for (const s of g.segs) {
                    const cx = (xOf(s.a) + xOf(s.b)) / 2;
                    const capped = s.up > yMax;
                    const ly = capped ? yT + 6.5 : yOf(s.up) + 6;
                    doc.text((capped ? '> ' : '') + fmtAlt(s.up), cx, ly, { align: 'center' });
                }
            }
            // Nom + fréquence.
            doc.setFont('helvetica', 'bold'); ink(T.sivInk);
            if (g.labelPos === 'topleft') {
                // 2 lignes (nom / fréquence) pour rester avant les bandes étroites.
                doc.setFontSize(6);
                const ny = clamped ? yT + 24 : yTopBand + 17;
                doc.text(g.name, x0 + 3, ny);
                doc.text(g.freq, x0 + 3, ny + 7.5);
            } else if (g.labelPos === 'center') {
                doc.setFontSize(6.5);
                let ny = (yTopBand + yBotBand) / 2 + 2;
                if (Math.abs(ny - yCr) < 8) ny += 10;              // sous la croisière
                for (const s of g.segs) {                          // sous un plafond de secteur
                    const cy = s.up > yMax ? yT + 6.5 : yOf(s.up) + 6;
                    if (Math.abs(ny - cy) < 8) ny = cy + 10;
                }
                doc.text(`${g.name} ${g.freq}`, (x0 + x1) / 2, ny, { align: 'center' });
            } else { // rotate : bande étroite, texte vertical lu de bas en haut ;
                     // si le nom+fréquence ne tient pas, 2 colonnes (nom | fréquence)
                doc.setFontSize(5.5);
                const shortName = g.name.replace(' INFO', '');
                const label = `${shortName} ${g.freq}`;
                const wAll = doc.getTextWidth(label);
                const hBand = yBotBand - yTopBand;
                if (hBand > wAll + 6) {
                    doc.text(label, x0 + 5, yBotBand - 3, { angle: 90 });
                } else if (hBand > Math.max(doc.getTextWidth(shortName), doc.getTextWidth(g.freq)) + 6) {
                    doc.text(shortName, x0 + 5, yBotBand - 3, { angle: 90 });
                    doc.text(g.freq, x0 + 11, yBotBand - 3, { angle: 90 });
                }
            }
        }
    } else {
        // mode screen : rectangles vierges + infobulle simulée au survol.
        const g = GROUPS[HOVER_GROUP];
        const seg = g.segs[0];
        const hx = (xOf(seg.a) + xOf(seg.b)) / 2;           // pointe au centre du secteur survolé
        const hy = yT + 34;
        // marqueur de survol sur la zone (point + trait pointillé).
        doc.setDrawColor(...T.siv); doc.setLineWidth(0.7); doc.setLineDashPattern([2, 2], 0);
        doc.line(hx, hy, hx, yT + 74);
        doc.setLineDashPattern([], 0);
        doc.setFillColor(...T.siv);
        doc.circle(hx, hy, 1.6, 'F');
        // carte blanche façon infobulle de l'app.
        const l1 = g.name, l2 = `ALT MIN : SFC   ALT MAX : ${fmtAlt(seg.up)}`, l3 = `${g.freq} MHz`;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        const w1 = doc.getTextWidth(l1);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        const w23 = Math.max(doc.getTextWidth(l2), doc.getTextWidth(l3));
        const bw = Math.max(w1, w23) + 14, bh = 32;
        const bx = Math.min(Math.max(hx - bw / 2, xL), xR - bw), by = hy - bh - 6;
        doc.setDrawColor(...[148, 163, 184]); doc.setLineWidth(0.8);
        doc.setFillColor(255, 255, 255);
        doc.rect(bx, by, bw, bh, 'FD');
        doc.setTextColor(26, 32, 44);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
        doc.text(l1, bx + 7, by + 11);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
        doc.text(l2, bx + 7, by + 20.5);
        doc.setTextColor(...T.siv); doc.setFont('helvetica', 'bold');
        doc.text(l3, bx + 7, by + 28.5);
        // menton de la carte vers le point de survol.
        doc.setFillColor(255, 255, 255);
        doc.triangle(Math.min(Math.max(hx - 3, bx + 4), bx + bw - 10), by + bh,
            Math.min(Math.max(hx + 3, bx + 12), bx + bw - 4), by + bh, hx, by + bh + 4.5, 'F');
    }

    // Axe X : extrémités + graduations NM.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); ink(T.ink);
    doc.text('LFPB', xL, yB + 9);
    doc.text('LFRM', xR, yB + 9, { align: 'right' });
    doc.setFont('courier', 'normal'); ink(T.muted); doc.setFontSize(6);
    for (const nm of [20, 40, 60, 80, 100]) doc.text(String(nm), xOf(nm), yB + 9, { align: 'center' });
}

/** Paragraphe avec interligne, renvoie le Y suivant. */
function para(text, y, T, size = 8.5, lead = 10.5) {
    doc.setTextColor(...T.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(size);
    const lines = doc.splitTextToSize(text, R - L);
    doc.text(lines, L, y);
    return y + lines.length * lead;
}

// ---------------- Page 1 : à l'écran (survol) ----------------
doc.setTextColor(...PAPER.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
doc.text('SIV sur le profil d\u2019élévation — 1. À l\u2019écran (survol)', L, 24);
let y = para('Route réelle LFPB - LFRM (openAIP 26/08). Chaque zone traversée = rectangle de son plancher à son '
    + 'plafond sur son tronçon (bleu, fond sombre de l\u2019app). Les rectangles restent vierges : '
    + 'au passage du curseur sur une zone, une infobulle affiche son nom, ses altitudes (ALT MIN / ALT MAX) '
    + 'et sa fréquence — simulée ici sur SEINE INFO (secteur survolé : SFC - FL065). Les zones qui se '
    + 'chevauchent se nichent (LE BOURGET et CHEVREUSE dans PARIS SUD, SEINE et NANTES dans PARIS OUEST).',
    38, PAPER);
profile(y + 4, 5000, SCREEN, 'screen');
doc.setTextColor(...PAPER.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
doc.text('Les plafonds au-dessus de l\u2019échelle sont rabattus en haut du graphe (bord pointillé) ; les 3 secteurs '
    + 'SEINE = un rectangle, séparateurs pointillés, le survol indique le plafond du secteur sous le curseur.',
    L, y + 4 + 150 + 46, { maxWidth: R - L });

// ---------------- Page 2 : dans le log de nav PDF ----------------
doc.addPage();
doc.setTextColor(...PAPER.ink); doc.setFont('helvetica', 'bold'); doc.setFontSize(14);
doc.text('SIV sur le profil d\u2019élévation — 2. Dans le log de nav PDF', L, 24);
y = para('Sur papier il n\u2019y a pas de survol : les mêmes rectangles sont imprimés avec des étiquettes compactes '
    + '— nom + fréquence à l\u2019intérieur (vertical pour les bandes étroites), plafond en haut de chaque tronçon '
    + 'de secteur (« > FL… » = plafond rabattu, il continue au-dessus de l\u2019échelle). Échelle du profil '
    + 'conservée pour garder le terrain et la croisière lisibles.', 38, PAPER);
profile(y + 4, 5000, PAPER, 'print');
doc.setTextColor(...PAPER.muted); doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5);
doc.text('Lecture : la croisière 2500 ft traverse LE BOURGET (SFC - 4500 ft), passe au-dessus de CHEVREUSE '
    + '(SFC - 2000 ft) ; PARIS SUD/OUEST et SEINE 6/7/8 s\u2019étendent au-dessus de l\u2019échelle (pointillés).',
    L, y + 4 + 150 + 46, { maxWidth: R - L });

const out = path.join(root, 'Apercu_SIV_maquette.pdf');
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log('OK :', out, '(' + doc.getNumberOfPages() + ' pages)');

// ---- Auto-QA : chevauchements de textes + glyphes non WinAnsi ----
let bad = 0;
for (const p of [1, 2]) {
    const items = TEXTS.filter(t => t.page === p && t.s.trim());
    const ov = [];
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const a = items[i], b = items[j];
        if (a.x < b.x + b.w - 1.2 && b.x < a.x + a.w - 1.2 && a.top < b.bot - 1.4 && b.top < a.bot - 1.4)
            ov.push(`"${a.s}"/"${b.s}"`);
    }
    if (ov.length) { bad++; console.log(`QA KO  p${p} : ${ov.length} chevauchement(s) : ` + ov.slice(0, 8).join(' ; ')); }
    else console.log(`QA OK  p${p} : ${items.length} textes, aucun chevauchement`);
}
const nonWin = TEXTS.filter(t => /[→←↔△▲]/.test(t.s));
if (nonWin.length) { bad++; console.log('QA KO  glyphes non WinAnsi : ' + nonWin.map(t => JSON.stringify(t.s)).join(', ')); }
process.exit(bad ? 1 : 0);
