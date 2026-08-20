// MAQUETTE PDF du widget Centrage (centrage / mass & balance) — pour validation
// AVANT implémentation. 2 pages :
//   p1 : maquette de la future page « Centrage » du log de nav (style pages 2/3)
//   p2 : maquette écran du WIDGET « Centrage » du dashboard (sous Perf. décollage)
// Arbitrages utilisateur : points Décollage (vert) / Arrivée (orange, essence
// moins essence consommée du plan) / ZFW (rouge) ; unités par avion (kg/mm en
// interne, conversion à l'affichage). Valeurs d'exemple FICTIVES (DR400-like).
// Usage : node test/gen-apercu-centro-maquette.mjs
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

globalThis.self = globalThis;
const _m = { exports: {} };
new Function('module', 'exports', 'require',
    fs.readFileSync(path.join(root, 'vendor', 'jspdf.umd.min.js'), 'utf8')
)(_m, _m.exports, require);
const { jsPDF } = _m.exports;

// ---------------------------------------------------------------------------
// Données d'exemple (fictives) — structure envisagée pour le bloc wb d'un avion
// ---------------------------------------------------------------------------
const AC = {
    registration: 'F-GKQA', type: 'DR400/180',
    fromIcao: 'LFPB', toIcao: 'LFRM',
    units: { mass: 'kg', arm: 'mm' },          // unités d'AFFICHAGE de cet avion
    emptyMassKg: 628, emptyArmMm: 295, mtowKg: 1100,
    fuelDensity: 0.72,                          // kg par litre
    envelope: [[740, 180], [1000, 228], [1100, 245], [1100, 490], [740, 520]],
    stations: [
        { name: 'Pilote', armMm: 340, massKg: 82 },
        { name: 'Passager 1', armMm: 340, massKg: 70 },
        { name: 'Passager 2', armMm: 1050, massKg: 78 },
        { name: 'Passager 3', armMm: 1050, massKg: 65 },
        { name: 'Bagages (max 40 kg)', armMm: 1600, massKg: 15 },
    ],
    fuelL: 100,      // carburant embarqué au décollage (pré-rempli du plan)
    burnL: 41,       // essence consommée estimée (35 L/h · 1 h 10 — plan de nav)
};

// --- Calcul (avant-goût du futur js/wb-core.js) — interne : kg et mm ---
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
const fuelKg = Math.round(AC.fuelL * AC.fuelDensity * 10) / 10;       // 72,0
const burnKg = Math.round(AC.burnL * AC.fuelDensity * 10) / 10;       // 29,5
const fuelArm = 300;
const fuelLbl = String(AC.fuelDensity).replace('.', ',');
const rows = [{ name: 'Masse à vide', armMm: AC.emptyArmMm, massKg: AC.emptyMassKg, empty: true },
              ...AC.stations,
              { name: `Carburant (${AC.fuelL} L · ${fuelLbl} kg/L)`, armMm: fuelArm, massKg: fuelKg }];
let zfM = 0, zfMom = 0;
for (const r of rows) { if (r.name.startsWith('Carburant')) continue; zfM += r.massKg; zfMom += r.massKg * r.armMm; }
const toM = zfM + fuelKg, toMom = zfMom + fuelKg * fuelArm;
const arM = zfM + (fuelKg - burnKg), arMom = zfMom + (fuelKg - burnKg) * fuelArm;
const cgZfw = Math.round(zfMom / zfM);
const cgTakeoff = Math.round(toMom / toM);
const cgArrival = Math.round(arMom / arM);

// Point dans le polygone (ray-casting) — enveloppe en [masse, bras].
function inEnvelope(mass, arm) {
    let inside = false;
    const p = AC.envelope;
    for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        const [yi, xi] = p[i], [yj, xj] = p[j];   // y = masse, x = bras
        if ((yi > mass) !== (yj > mass) &&
            arm < ((xj - xi) * (mass - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
}
// Bras des limites avant/arrière pour une masse donnée (interpolation).
function armLimit(mass, side) {
    const p = AC.envelope;
    let best = null;
    for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const [am, aa] = a, [bm, ba] = b;
        if ((am - mass) * (bm - mass) <= 0 && am !== bm) {
            const arm = aa + (ba - aa) * (mass - am) / (bm - am);
            if (best === null) best = arm;
            else best = side === 'fwd' ? Math.min(best, arm) : Math.max(best, arm);
        }
    }
    return best;
}
const okTakeoff = inEnvelope(toM, cgTakeoff);
const fwdMargin = Math.round(cgTakeoff - armLimit(toM, 'fwd'));
const aftMargin = Math.round(armLimit(toM, 'aft') - cgTakeoff);

// ---------------------------------------------------------------------------
// Helpers style navlog-pdf.js (copiés pour rester autonome)
// ---------------------------------------------------------------------------
const PAGE = { w: 419.53, h: 595.32 };
const INK = [17, 24, 39], MUTED = [107, 114, 128], LINE = [156, 163, 175];
const BLUE = [2, 132, 199], AMBER = [180, 83, 9], GREEN = [5, 150, 105], RED = [185, 28, 28];
const CELL_BG = [243, 244, 246], BANDL = [229, 231, 235], PLOT_BG = [248, 250, 252];

const doc = new jsPDF({ unit: 'pt', format: [PAGE.w, PAGE.h], orientation: 'portrait' });
const ink = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);

// Garde-fou : aucune baseline de texte hors de la page.
const _text = doc.text.bind(doc);
doc.text = (s, x, y, opt) => {
    if (x < 4 || x > PAGE.w - 4 || y < 4 || y > PAGE.h - 4)
        throw new Error(`Texte hors page : "${s}" @(${x.toFixed(1)},${y.toFixed(1)})`);
    return _text(s, x, y, opt);
};

function _cell(x, yc, w, h, label, value, opt = {}) {
    doc.setFillColor(...CELL_BG); doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.roundedRect(x, yc, w, h, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); ink(MUTED);
    doc.text(String(label).toUpperCase(), x + 7, yc + 9.5, { charSpace: 0.5 });
    doc.setFont('courier', 'bold');
    let size = opt.size || 10.5, v = String(value ?? '—');
    doc.setFontSize(size);
    while (v.length > 3 && doc.getTextWidth(v) > w - 14) { size -= 0.5; doc.setFontSize(size); }
    ink(opt.color || INK);
    doc.text(v, x + 7, yc + h - 8);
}
function _section(L, R, title, ys) {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(L, ys, R, ys);
    if (title) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); ink(MUTED);
        doc.text(String(title).toUpperCase(), L + 1.5, ys + 11, { charSpace: 0.6 });
        return ys + 16;
    }
    return ys + 6;
}
function _footer() {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUTED);
    _text('Document généré automatiquement — aide à la préparation. Vérifiez chaque valeur avant le vol (météo, POH, VAC, NOTAM).',
        PAGE.w / 2, 590.2, { align: 'center' });
}

// ---------------------------------------------------------------------------
// Centrogramme vectoriel — X = bras (unité de l'avion), Y = masse.
// T = thème papier { plotBg, grid, tick, envFill, envStroke, axis, axisLabel }
// ---------------------------------------------------------------------------
function drawChart(xL, xR, yT, CH, T) {
    const yB = yT + CH, plotW = xR - xL;
    const ARM0 = 100, ARM1 = 600, M0 = 600, M1 = 1200;
    const xOf = a => xL + (a - ARM0) / (ARM1 - ARM0) * plotW;
    const yOf = m => yT + (1 - (m - M0) / (M1 - M0)) * CH;

    doc.setFillColor(...T.plotBg);
    doc.rect(xL, yT, plotW, CH, 'F');
    doc.setFont('courier', 'normal'); doc.setFontSize(T.tickSize || 6.5);
    for (let m = M0; m <= M1; m += 150) {
        doc.setDrawColor(...T.grid); doc.setLineWidth(0.4);
        doc.line(xL, yOf(m), xR, yOf(m));
        ink(T.tick); doc.text(`${m}`, xL - 4, yOf(m) + 2.2, { align: 'right' });
    }
    for (let a = ARM0; a <= ARM1; a += 100) {
        doc.setDrawColor(...T.grid); doc.setLineWidth(0.4);
        doc.line(xOf(a), yT, xOf(a), yB);
        if (a > ARM0 && a < ARM1) { ink(T.tick); doc.text(`${a}`, xOf(a), yB + 8, { align: 'center' }); }
    }
    doc.text('100', xOf(ARM0) + 7, yB + 8);
    doc.text('600', xOf(ARM1) - 7, yB + 8, { align: 'right' });
    doc.setDrawColor(...T.axis); doc.setLineWidth(0.5);
    doc.line(xL, yT, xL, yB); doc.line(xL, yB, xR, yB);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(T.axisSize || 7); ink(T.axisLabel);
    doc.text(`Bras de levier (${AC.units.arm})`, (xL + xR) / 2, yB + 19, { align: 'center' });
    doc.text(`Masse (${AC.units.mass})`, xL - 30, (yT + yB) / 2, { align: 'center', angle: 90 });

    // Enveloppe (polygone rempli + trait bleu).
    const pts = AC.envelope.map(([m, a]) => [xOf(a), yOf(m)]);
    const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    doc.setFillColor(...T.envFill); doc.setDrawColor(...T.envStroke); doc.setLineWidth(1.2);
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(T.envStroke);
    doc.text('ENV', xOf(180) - 2, yOf(740) + 10);

    // Ligne MTOW (rouge pointillée).
    doc.setDrawColor(...T.mtow); doc.setLineWidth(0.9);
    doc.setLineDashPattern([5, 3], 0);
    doc.line(xL, yOf(AC.mtowKg), xR, yOf(AC.mtowKg));
    doc.setLineDashPattern([], 0);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); ink(T.mtow);
    doc.text(`MTOW ${AC.mtowKg} kg`, xR - 3, yOf(AC.mtowKg) - 3, { align: 'right' });

    // Points : Décollage (vert) / Arrivée (orange) / ZFW (rouge) / À vide (gris discret).
    // Étiquette Arrivée À GAUCHE du point, à sa hauteur ; ZFW juste à côté (droite).
    const decFr = (n) => String(n).replace('.', ',');
    const P = [
        { arm: cgTakeoff, mass: toM, col: T.ptTakeoff, r: 3.2, lab: `Décollage ${fmt(toM)} · ${cgTakeoff}`, dx: 9, dy: 2 },
        { arm: cgArrival, mass: arM, col: T.ptArrival, r: 2.8, lab: `Arrivée ${decFr(arM)} · ${cgArrival}`, dx: -6, dy: 2, right: true },
        { arm: cgZfw, mass: zfM, col: T.ptZfw, r: 2.8, lab: `ZFW ${fmt(zfM)} · ${cgZfw}`, dx: 6, dy: 2 },
        { arm: AC.emptyArmMm, mass: AC.emptyMassKg, col: T.ptEmpty, r: 2.4, lab: `Vide ${AC.emptyMassKg} · ${AC.emptyArmMm}`, dx: 8, dy: 3 },
    ];
    for (const p of P) {
        doc.setFillColor(...p.col);
        doc.circle(xOf(p.arm), yOf(p.mass), p.r, 'F');
    }
    if (!T.hidePointLabels) {
        doc.setFont('courier', 'bold'); doc.setFontSize(T.labSize || 7);
        for (const p of P) {
            ink(p.col === T.ptEmpty ? T.tick : p.col);
            doc.text(p.lab, xOf(p.arm) + p.dx, yOf(p.mass) + p.dy, p.right ? { align: 'right' } : undefined);
        }
    }
    return yB + 24;
}

// ===========================================================================
// PAGE 1 — maquette « page 4 Centrage » du log de nav
// ===========================================================================
{
    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const FRAME_BOT = 581.8;

    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink([255, 255, 255]);
    doc.text('Centrage', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    doc.setFont('courier', 'normal'); doc.setFontSize(8); ink(MUTED);
    doc.text(`${AC.fromIcao} - ${AC.toIcao} · ${AC.registration} · ${AC.type}`, L + 1.5, 45);

    // ---- Section 1 : tableau de chargement (décollage) ----
    let y = _section(L, R, 'Chargement', 54);
    const CX = { arm: 268, mass: 322, mom: R - 5 };
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); ink(MUTED);
    doc.text('POSTE', L + 1.5, y + 8, { charSpace: 0.4 });
    doc.text('BRAS (MM)', CX.arm, y + 8, { align: 'right', charSpace: 0.4 });
    doc.text('MASSE (KG)', CX.mass, y + 8, { align: 'right', charSpace: 0.4 });
    doc.text('MOMENT (KG·MM)', CX.mom, y + 8, { align: 'right', charSpace: 0.4 });
    const headBot = y + 11;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(L, headBot, R, headBot);
    const RH = 12.6;
    let totM = 0, totMom = 0;
    rows.forEach((r, i) => {
        totM += r.massKg; totMom += r.massKg * r.armMm;
        const base = headBot + i * RH + RH - 3;
        doc.setFont('helvetica', r.empty ? 'bold' : 'normal'); doc.setFontSize(7.5);
        ink(r.empty ? INK : MUTED);
        doc.text(r.name, L + 1.5, base);
        doc.setFont('courier', r.empty ? 'bold' : 'normal'); ink(INK);
        doc.text(`${fmt(r.armMm)}`, CX.arm, base, { align: 'right' });
        doc.text(`${fmt(r.massKg)}`, CX.mass, base, { align: 'right' });
        doc.text(`${fmt(r.massKg * r.armMm)}`, CX.mom, base, { align: 'right' });
        doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
        doc.line(L, headBot + (i + 1) * RH, R, headBot + (i + 1) * RH);
    });
    const totBase = headBot + rows.length * RH + RH - 3;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
    doc.line(L, headBot + rows.length * RH, R, headBot + rows.length * RH);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); ink(INK);
    doc.text(`TOTAL — CG décollage : ${cgTakeoff} mm`, L + 1.5, totBase);
    doc.setFont('courier', 'bold'); ink(BLUE);
    doc.text(`${fmt(totM)}`, CX.mass, totBase, { align: 'right' });
    doc.text(`${fmt(totMom)}`, CX.mom, totBase, { align: 'right' });

    // Essence consommée (plan de nav) → point arrivée.
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5); ink(MUTED);
    doc.text(`Essence consommée estimée (plan : 35 L/h · 1 h 10) : ${AC.burnL} L · ${String(burnKg).replace('.', ',')} kg — carburant à l'arrivée : ${AC.fuelL - AC.burnL} L`,
        L + 1.5, totBase + 11);
    y = totBase + 18;

    // ---- Section 2 : centrogramme ----
    y = _section(L, R, 'Centrogramme — enveloppe de centrage', y);
    y = drawChart(L + 42, R - 6, y + 2, 168, {
        plotBg: PLOT_BG, grid: BANDL, tick: MUTED, axis: LINE, axisLabel: MUTED,
        envFill: [227, 242, 253], envStroke: BLUE, mtow: [220, 38, 38],
        ptTakeoff: GREEN, ptArrival: AMBER, ptZfw: [220, 38, 38], ptEmpty: MUTED,
    });

    // ---- Cellules résultats ----
    y = _section(null, 0, null, y + 2);
    const cw3 = (W - 2 * 7) / 3;
    _cell(L, y, cw3, 27, 'CG décollage', `${cgTakeoff} mm`, { color: GREEN, size: 12 });
    _cell(L + cw3 + 7, y, cw3, 27, 'CG arrivée', `${cgArrival} mm`, { color: AMBER, size: 12 });
    _cell(L + 2 * (cw3 + 7), y, cw3, 27, 'CG zéro carburant', `${cgZfw} mm`, { color: RED, size: 12 });
    y += 31;
    _cell(L, y, cw3, 27, 'Masse décollage', `${fmt(toM)} kg`);
    _cell(L + cw3 + 7, y, cw3, 27, 'Marge MTOW', `+${AC.mtowKg - toM} kg`);
    _cell(L + 2 * (cw3 + 7), y, cw3, 27, 'Enveloppe', okTakeoff ? 'Dans les limites' : 'HORS LIMITES',
        { color: okTakeoff ? GREEN : [220, 38, 38], size: 9.5 });
    y += 37;

    // Légende (pastilles couleur, comme la barre de marge décollage p3).
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); ink(MUTED);
    let lx = L + 1;
    const LEG = [
        [GREEN, 'Décollage'], [AMBER, 'Arrivée'], [[185, 28, 28], 'ZFW'], [MUTED, 'À vide'],
        [BLUE, 'Enveloppe'], [[220, 38, 38], 'MTOW'],
    ];
    for (const [col, lab] of LEG) {
        doc.setFillColor(...col); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
        doc.circle(lx + 2.5, y - 5, 2.5, 'F');
        doc.text(lab, lx + 9, y - 2.6);
        lx += 11 + doc.getTextWidth(lab) + 9;
    }

    // Note POH ancrée en bas du cadre.
    const fy = FRAME_BOT - 24;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.5);
    doc.circle(L + 3.5, fy + 1, 3.2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); ink(MUTED);
    doc.text('i', L + 3.5, fy + 3.2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); ink(MUTED);
    const note = 'Centrogramme établi à partir des données de la flotte (masse à vide, enveloppe, postes) et du chargement saisi. '
        + 'La fiche de pesée et le manuel de vol restent la référence légale.';
    const words = note.split(' ');
    const lines = []; let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (doc.getTextWidth(t) > W - 13 && cur) { lines.push(cur); cur = w; } else cur = t;
    }
    if (cur) lines.push(cur);
    lines.slice(0, 2).forEach((l, i) => doc.text(l, L + 11, fy + 2.5 + i * 9));

    _footer();
}

// ===========================================================================
// PAGE 2 — maquette ÉCRAN : WIDGET « Centrage » du dashboard
// ===========================================================================
{
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    // Thème écran : fond --bg-color #020617, carte --panel-bg #0F172A.
    const BG = [2, 6, 23], PANEL = [15, 23, 42], INNER = [11, 18, 32];
    const BORD = [42, 53, 72], TXT = [248, 250, 252], MUT2 = [148, 163, 184];
    const CYAN = [56, 189, 248], GRN = [52, 211, 153], AMB = [251, 191, 36], RED2 = [248, 113, 113];

    doc.setFillColor(...BG); doc.rect(0, 0, PAGE.w, PAGE.h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(MUT2);
    doc.text('MAQUETTE ÉCRAN — WIDGET « CENTRAGE » DU DASHBOARD (SOUS PERF. DÉCOLLAGE) · VALEURS FICTIVES',
        PAGE.w / 2, 16, { align: 'center' });

    // Carte widget (pleine largeur, style .card des panneaux).
    doc.setFillColor(...PANEL); doc.setDrawColor(...BORD); doc.setLineWidth(1);
    doc.roundedRect(20, 26, PAGE.w - 40, PAGE.h - 66, 8, 8, 'FD');

    // Header repliable (chevron, comme le widget Performance décollage).
    doc.setFillColor(...[19, 28, 48]); doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.roundedRect(26, 32, PAGE.w - 52, 34, 5, 5, 'FD');
    doc.setFillColor(...MUT2);
    doc.triangle(384, 44, 392, 44, 388, 51, 'F');          // chevron bas
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink(TXT);
    doc.text('Centrage', 36, 50);
    doc.setFont('courier', 'bold'); doc.setFontSize(8); ink(CYAN);
    doc.text(`${AC.registration} · ${AC.type}`, 96, 50);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); ink(MUT2);
    doc.text(`unités : ${AC.units.mass} / ${AC.units.arm}`, 368, 50, { align: 'right' });

    // Aperçu centrogramme (cadre interne).
    doc.setFillColor(...INNER); doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.roundedRect(30, 74, 359, 196, 4, 4, 'FD');
    const xL = 68, xR = 380, yT = 84, CH = 158;
    drawChart(xL, xR, yT, CH, {
        plotBg: INNER, grid: [23, 32, 51], tick: MUT2, axis: BORD, axisLabel: MUT2,
        tickSize: 6, axisSize: 6.5, labSize: 7,
        envFill: [23, 35, 56], envStroke: CYAN, mtow: [239, 68, 68],
        ptTakeoff: GRN, ptArrival: AMB, ptZfw: RED2, ptEmpty: MUT2,
    });

    // Résultats : 3 lignes à pastilles (vert / orange / rouge).
    const RES = [
        [GRN, `Décollage : ${fmt(toM)} kg · CG ${cgTakeoff} mm · marges enveloppe avant ${fwdMargin} mm / arrière ${aftMargin} mm`],
        [AMB, `Arrivée (essence - ${AC.burnL} L consommés) : ${fmt(arM)} kg · CG ${cgArrival} mm`],
        [RED2, `ZFW zéro carburant : ${fmt(zfM)} kg · CG ${cgZfw} mm`],
    ];
    RES.forEach(([col, s], i) => {
        const yy = 292 + i * 12;
        doc.setFillColor(...col); doc.circle(37, yy - 2.5, 2.5, 'F');
        doc.setFont('courier', i === 0 ? 'bold' : 'normal'); doc.setFontSize(7.5);
        ink(i === 0 ? TXT : MUT2);
        doc.text(s, 44, yy);
    });

    // Chargement du jour (inputs simulés, 2 colonnes).
    doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.line(30, 334, 389, 334);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(MUT2);
    doc.text('CHARGEMENT DU JOUR', 31.5, 345, { charSpace: 0.6 });
    const FIELDS = [
        ['Pilote (kg)', '82'], ['Passager 1 (kg)', '70'],
        ['Passager 2 (kg)', '78'], ['Passager 3 (kg)', '65'],
        ['Bagages (kg) · max 40', '15'], ['Carburant (L) — du plan', '100'],
        ['Consommée (L) · 35 L/h · 1 h 10', '41'], ['Densité carburant (kg/L)', fuelLbl],
    ];
    FIELDS.forEach(([lab, val], i) => {
        const col = i % 2, row = Math.floor(i / 2);
        const x = 30 + col * 184, yy = 352 + row * 32;
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
        doc.text(lab.toUpperCase(), x + 2, yy);
        doc.setFillColor(...PANEL); doc.setDrawColor(...BORD); doc.setLineWidth(0.7);
        doc.roundedRect(x, yy + 3, 175, 19, 3, 3, 'FD');
        doc.setFont('courier', 'bold'); doc.setFontSize(9);
        ink(i === 5 || i === 6 ? AMB : CYAN);        // pré-remplissages plan en ambre
        doc.text(val, x + 6, yy + 16.5);
    });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); ink(MUT2);
    doc.text('Carburant et essence consommée pré-remplis depuis le plan de nav (modifiables).', 30, 474);

    // Bandeau verdict.
    doc.setFillColor(...[6, 46, 32]); doc.setDrawColor(...[16, 185, 129]); doc.setLineWidth(0.8);
    doc.roundedRect(30, 484, 359, 20, 3, 3, 'FD');
    let vs = `CG DÉCOLLAGE ${cgTakeoff} MM · DANS L'ENVELOPPE · MARGE AVANT ${fwdMargin} MM / ARRIÈRE ${aftMargin} MM`;
    let vsz = 8;
    while (doc.getTextWidth(vs) > 347 && vsz > 6) { vsz -= 0.25; doc.setFontSize(vsz); }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(vsz); ink(GRN);
    doc.text(vs, 209.5, 497, { align: 'center' });

    // Lien vers la flotte (configuration enveloppe/postes).
    doc.setDrawColor(...BORD); doc.setLineWidth(0.8);
    doc.roundedRect(30, 514, 176, 18, 3, 3, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(MUT2);
    doc.text('Enveloppe / postes : fenêtre Flotte', 118, 525.5, { align: 'center' });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); ink(MUT2);
    doc.text('L\'enveloppe, les postes et la masse à vide sont édités par avion dans la fenêtre Flotte.', 30, 546);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
    doc.text('Maquette d\'intégration — aucune donnée réelle', PAGE.w / 2, PAGE.h - 8, { align: 'center' });
}

// ===========================================================================
// PAGE 3 — maquette ÉCRAN : fenêtre Flotte (liste + formulaire, Centrage replié)
// ===========================================================================
{
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    const BG = [2, 6, 23], PANEL = [15, 23, 42], INNER = [11, 18, 32];
    const BORD = [42, 53, 72], TXT = [248, 250, 252], MUT2 = [148, 163, 184];
    const CYAN = [56, 189, 248], GRN = [52, 211, 153], RED2 = [248, 113, 113];

    doc.setFillColor(...BG); doc.rect(0, 0, PAGE.w, PAGE.h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(MUT2);
    doc.text('MAQUETTE ÉCRAN — FENÊTRE « MA FLOTTE » · SECTION CENTRAGE REPLIÉE · VALEURS FICTIVES',
        PAGE.w / 2, 16, { align: 'center' });

    // Modale (hauteur adaptée au contenu, comme la vraie).
    doc.setFillColor(...PANEL); doc.setDrawColor(...BORD); doc.setLineWidth(1);
    doc.roundedRect(20, 26, PAGE.w - 40, 346, 8, 8, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); ink(TXT);
    doc.text('Ma flotte d\'avions', 34, 48);
    doc.setDrawColor(...MUT2); doc.setLineWidth(1);
    doc.line(382, 42, 390, 50); doc.line(390, 42, 382, 50);

    // ---- Liste : item actif (configuré) + item simple ----
    const item = (y, active, reg, typ, stats, wbOk) => {
        doc.setFillColor(...(active ? INNER : PANEL));
        doc.setDrawColor(...(active ? CYAN : BORD)); doc.setLineWidth(active ? 1.2 : 0.7);
        doc.roundedRect(30, y, 359, 40, 4, 4, 'FD');
        // Rangée 1 : titre + statut ACTIF (à gauche), badge centrage (à droite).
        doc.setFont('courier', 'bold'); doc.setFontSize(9); ink(active ? CYAN : TXT);
        const title = `${reg} · ${typ}`;
        doc.text(title, 38, y + 14);
        if (active) {
            const tw = doc.getTextWidth(title);
            doc.setFillColor(...CYAN); doc.circle(38 + tw + 10, y + 11.8, 2.5, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); ink(CYAN);
            doc.text('ACTIF', 38 + tw + 16, y + 13.8);
        }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5);
        const badge = wbOk ? 'CENTRAGE CONFIGURÉ' : 'CENTRAGE NON CONFIGURÉ';
        const bw = doc.getTextWidth(badge) + 10;
        doc.setDrawColor(...(wbOk ? GRN : BORD)); doc.setLineWidth(0.6);
        doc.roundedRect(388 - bw, y + 5, bw, 11, 3, 3, 'S');
        ink(wbOk ? GRN : MUT2);
        doc.text(badge, 388 - bw / 2, y + 12.5, { align: 'center' });
        // Rangée 2 : stats (à gauche, sans vitesse/conso : visibles dans le
        // formulaire) et boutons d'action (à droite) sans chevauchement.
        doc.setFont('courier', 'normal'); doc.setFontSize(6); ink(MUT2);
        doc.text(stats, 38, y + 28);
        const btn = (x, w, lab, col) => {
            doc.setDrawColor(...BORD); doc.setLineWidth(0.7);
            doc.roundedRect(x, y + 22, w, 14, 3, 3, 'S');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(5.5); ink(col);
            doc.text(lab, x + w / 2, y + 31.5, { align: 'center' });
        };
        if (active) {
            btn(262, 46, 'MODIFIER', TXT); btn(314, 60, 'SUPPRIMER', RED2);
        } else {
            btn(230, 50, 'ACTIVER', TXT); btn(286, 46, 'MODIFIER', TXT); btn(338, 56, 'SUPPRIMER', RED2);
        }
    };
    item(58, true, 'F-GKQA', 'DR400/180', 'Roulement 500 ft · 50 ft 1 100 ft · Marge 20 %', true);
    item(102, false, 'F-BVRE', 'C172', 'Roulement 950 ft · 50 ft 1 600 ft · Marge 15 %', false);

    // ---- Formulaire (mode édition de l'avion actif) ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(TXT);
    doc.text('MODIFIER L\'AVION', 30, 160);
    const field = (x, yy, lab, val) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); ink(MUT2);
        doc.text(lab.toUpperCase(), x + 2, yy);
        doc.setFillColor(...INNER); doc.setDrawColor(...BORD); doc.setLineWidth(0.7);
        doc.roundedRect(x, yy + 3, 175, 18, 3, 3, 'FD');
        doc.setFont('courier', 'bold'); doc.setFontSize(8.5); ink(CYAN);
        doc.text(val, x + 6, yy + 15.5);
    };
    const FRM = [
        ['Nom', 'DR400 du club', 'Immat', 'F-GKQA'],
        ['Type', 'DR400/180', 'Marge sécu (%)', '20'],
        ['Roulement (ft)', '500', 'Franch. 50 ft (ft)', '1100'],
        ['Vitesse (kt)', '115', 'Conso (L/h)', '35'],
    ];
    FRM.forEach(([l1, v1, l2, v2], i) => {
        const yy = 166 + i * 28;
        field(30, yy, l1, v1); field(214, yy, l2, v2);
    });

    // ---- Section Centrage REPLIÉE ----
    doc.setFillColor(...[19, 28, 48]); doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.roundedRect(30, 282, 359, 24, 4, 4, 'FD');
    doc.setFillColor(...MUT2);
    doc.triangle(372, 288, 380, 288, 376, 295, 'F');          // chevron droite (replié)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(TXT);
    doc.text('CENTRAGE', 40, 298);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); ink(MUT2);
    doc.text('Déplier pour configurer : unités, masse à vide, postes, enveloppe', 96, 298);

    // Boutons du formulaire.
    doc.setFillColor(...CYAN);
    doc.roundedRect(30, 316, 92, 20, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink([2, 6, 23]);
    doc.text('ENREGISTRER', 76, 328, { align: 'center' });
    doc.setDrawColor(...BORD); doc.setLineWidth(0.8);
    doc.roundedRect(130, 316, 70, 20, 3, 3, 'S');
    ink(MUT2);
    doc.text('ANNULER', 165, 328, { align: 'center' });

    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); ink(MUT2);
    doc.text('Avion sans centrage configuré : la section reste repliable et le widget Centrage du dashboard reste masqué pour cet avion.',
        20, 396, { maxWidth: PAGE.w - 40, align: 'left' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
    doc.text('Maquette d\'intégration — aucune donnée réelle', PAGE.w / 2, PAGE.h - 8, { align: 'center' });
}

// ===========================================================================
// PAGE 4 — maquette ÉCRAN : section Centrage DÉPLIÉE (zoom de la configuration)
// ===========================================================================
{
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    const BG = [2, 6, 23], PANEL = [15, 23, 42], INNER = [11, 18, 32];
    const BORD = [42, 53, 72], TXT = [248, 250, 252], MUT2 = [148, 163, 184];
    const CYAN = [56, 189, 248], GRN = [52, 211, 153], AMB = [251, 191, 36], RED2 = [248, 113, 113];

    doc.setFillColor(...BG); doc.rect(0, 0, PAGE.w, PAGE.h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(MUT2);
    doc.text('MAQUETTE ÉCRAN — FENÊTRE « MA FLOTTE » · SECTION CENTRAGE DÉPLIÉE · VALEURS FICTIVES',
        PAGE.w / 2, 16, { align: 'center' });

    doc.setFillColor(...PANEL); doc.setDrawColor(...BORD); doc.setLineWidth(1);
    doc.roundedRect(20, 26, PAGE.w - 40, PAGE.h - 66, 8, 8, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); ink(TXT);
    doc.text('Ma flotte d\'avions', 34, 48);
    doc.setDrawColor(...MUT2); doc.setLineWidth(1);
    doc.line(382, 42, 390, 50); doc.line(390, 42, 382, 50);
    doc.setFont('courier', 'normal'); doc.setFontSize(7); ink(MUT2);
    doc.text('Modifier F-GKQA · DR400/180 — champs avion ci-dessus, section Centrage ci-dessous', 34, 62);

    // ---- Bande de section DÉPLIÉE (chevron bas) ----
    doc.setFillColor(...[19, 28, 48]); doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.roundedRect(30, 70, 359, 22, 4, 4, 'FD');
    doc.setFillColor(...MUT2);
    doc.triangle(374, 77, 382, 77, 378, 84, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(8); ink(TXT);
    doc.text('CENTRAGE', 40, 85);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(GRN);
    doc.text('CONFIGURÉ', 96, 85);

    // ---- Rangée unités ----
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
    doc.text('UNITÉS DE SAISIE', 30, 106);
    const select = (x, w, lab, val) => {
        doc.setFillColor(...INNER); doc.setDrawColor(...BORD); doc.setLineWidth(0.7);
        doc.roundedRect(x, 110, w, 19, 3, 3, 'FD');
        doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); ink(MUT2);
        doc.text(lab, x + 7, 122.5);
        doc.setFont('courier', 'bold'); doc.setFontSize(8.5); ink(CYAN);
        doc.text(val, x + 7 + doc.getTextWidth(lab) + 6, 122.5);
        doc.setFillColor(...MUT2);
        doc.triangle(x + w - 9, 117, x + w - 4, 117, x + w - 6.5, 121.5, 'F');
    };
    select(85, 82, 'Masse :', 'kg');
    select(173, 82, 'Bras :', 'mm');
    doc.setFont('helvetica', 'italic'); doc.setFontSize(5.5); ink(MUT2);
    doc.text('stockage interne : kg / mm', 389, 122, { align: 'right' });

    // ---- Rangée : masse à vide / CG vide / MTOW / densité ----
    const small = (x, w, yy, lab, val, col = CYAN) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); ink(MUT2);
        doc.text(lab.toUpperCase(), x + 2, yy);
        doc.setFillColor(...INNER); doc.setDrawColor(...BORD); doc.setLineWidth(0.7);
        doc.roundedRect(x, yy + 3, w, 19, 3, 3, 'FD');
        doc.setFont('courier', 'bold'); doc.setFontSize(8.5); ink(col);
        doc.text(val, x + 6, yy + 16.5);
    };
    small(30, 86, 138, 'Masse à vide (kg)', '628');
    small(121, 86, 138, 'CG à vide (mm)', '295');
    small(212, 86, 138, 'MTOW (kg)', '1 100');
    small(303, 86, 138, 'Densité (kg/L)', String(AC.fuelDensity).replace('.', ','));

    // ---- Deux tableaux : postes (gauche) / enveloppe (droite) ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(MUT2);
    doc.text('POSTES DE CHARGEMENT', 30, 172);
    doc.text('ENVELOPPE DE CENTRAGE', 214, 172);
    const STATIONS = [
        ['Pilote', '340', '—'], ['Passager 1', '340', '—'], ['Passager 2', '1 050', '—'],
        ['Passager 3', '1 050', '—'], ['Bagages', '1 600', '40 kg'], ['Carburant (L)', '300', '200 L'],
    ];
    const ENV_PTS = AC.envelope.map(([m, a]) => [fmt(m), fmt(a)]);
    const table = (x0, rowsData, heads) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(5); ink(MUT2);
        for (const [lab, x, align] of heads) doc.text(lab, x, 180, align ? { align } : undefined);
        doc.setDrawColor(...BORD); doc.setLineWidth(0.5);
        doc.line(x0, 183, x0 + 175, 183);
        doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
        for (let i = 0; i < rowsData.length; i++) {
            const yy = 183 + (i + 1) * 13;
            const [a, b, c] = rowsData[i];
            ink(TXT); doc.text(a, x0 + 2, yy - 3);
            ink(CYAN); doc.text(b, x0 + 138, yy - 3, { align: 'right' });
            if (c !== undefined) { ink(MUT2); doc.text(c, x0 + 173, yy - 3, { align: 'right' }); }
            doc.setDrawColor(...[23, 32, 51]); doc.setLineWidth(0.3);
            doc.line(x0, yy, x0 + 175, yy);
        }
    };
    table(30, STATIONS, [['NOM', 32], ['BRAS', 168, 'right'], ['MAX', 203, 'right']]);
    table(214, ENV_PTS, [['MASSE (KG)', 352, 'right'], ['BRAS (MM)', 387, 'right']]);
    // Petits boutons « supprimer » en bout de ligne + boutons d'ajout.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(RED2);
    for (let i = 0; i < STATIONS.length; i++) doc.text('×', 26, 183 + (i + 1) * 13 - 3);
    for (let i = 0; i < ENV_PTS.length; i++) doc.text('×', 210, 183 + (i + 1) * 13 - 3);
    const addBtn = (x, w, yy, lab) => {
        doc.setDrawColor(...BORD); doc.setLineWidth(0.8);
        doc.roundedRect(x, yy, w, 15, 3, 3, 'S');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(CYAN);
        doc.text(lab, x + w / 2, yy + 10, { align: 'center' });
    };
    addBtn(30, 106, 272, '+ AJOUTER UN POSTE');
    addBtn(214, 66, 272, '+ POINT');
    doc.setFont('helvetica', 'normal'); doc.setFontSize(5.5); ink(MUT2);
    doc.text('polygone fermé (sens horaire)', 286, 282);

    // ---- Aperçu du centrogramme (sans étiquettes de points) ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink(MUT2);
    doc.text('APERÇU DU CENTROGRAMME', 30, 296);
    doc.setFillColor(...INNER); doc.setDrawColor(...BORD); doc.setLineWidth(0.6);
    doc.roundedRect(30, 300, 359, 180, 4, 4, 'FD');
    drawChart(66, 380, 308, 152, {
        plotBg: INNER, grid: [23, 32, 51], tick: MUT2, axis: BORD, axisLabel: MUT2,
        tickSize: 5.5, axisSize: 6, hidePointLabels: true,
        envFill: [23, 35, 56], envStroke: CYAN, mtow: [239, 68, 68],
        ptTakeoff: GRN, ptArrival: AMB, ptZfw: RED2, ptEmpty: MUT2,
    });
    // Mini légende.
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
    let lx = 34;
    const LEG = [[GRN, 'Décollage'], [AMB, 'Arrivée'], [RED2, 'ZFW'], [MUT2, 'À vide'], [CYAN, 'Enveloppe']];
    for (const [col, lab] of LEG) {
        doc.setFillColor(...col); doc.circle(lx + 2, 486, 2, 'F');
        doc.text(lab, lx + 7, 488.5);
        lx += 10 + doc.getTextWidth(lab) + 8;
    }

    // Boutons + note.
    doc.setFillColor(...CYAN);
    doc.roundedRect(30, 502, 92, 20, 3, 3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink([2, 6, 23]);
    doc.text('ENREGISTRER', 76, 514, { align: 'center' });
    doc.setDrawColor(...BORD); doc.setLineWidth(0.8);
    doc.roundedRect(130, 502, 70, 20, 3, 3, 'S');
    ink(MUT2);
    doc.text('ANNULER', 165, 514, { align: 'center' });
    doc.setFont('helvetica', 'italic'); doc.setFontSize(6.5); ink(MUT2);
    doc.text('Enregistrer met à jour l\'avion de la flotte — le widget Centrage et la page PDF reflètent aussitôt cette configuration.',
        30, 538, { maxWidth: 359 });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); ink(MUT2);
    doc.text('Maquette d\'intégration — aucune donnée réelle', PAGE.w / 2, PAGE.h - 8, { align: 'center' });
}

const out = path.join(root, 'Apercu_Centrogramme_maquette.pdf');
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log(`OK : ${out} (${doc.getNumberOfPages()} pages)`);
console.log(`  Exemple : décollage ${fmt(toM)} kg · CG ${cgTakeoff} mm | arrivée ${fmt(arM)} kg · CG ${cgArrival} mm | ZFW ${fmt(zfM)} kg · CG ${cgZfw} mm`);
console.log(`  Enveloppe : ${okTakeoff ? 'OK' : 'HORS'} · marges ${fwdMargin}/${aftMargin} mm · essence consommée ${AC.burnL} L (${String(burnKg).replace('.', ',')} kg)`);
