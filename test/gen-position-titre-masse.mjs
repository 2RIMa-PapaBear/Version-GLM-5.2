// PDF de DÉCISION pour la position du titre « Masse (kg) » du centrogramme :
// 4 vignettes (A/B/C/D) reproduisant la bande gauche du graphe (cadre,
// graduations, titre vertical, bord du graphe) — l'utilisateur désigne la
// lettre voulue. Usage : node test/gen-position-titre-masse.mjs
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

const INK = [17, 24, 39], MUTED = [107, 114, 128], LINE = [156, 163, 175];
const BANDL = [229, 231, 235], PLOT_BG = [248, 250, 252], BLUE = [2, 132, 199];
const PAGE = { w: 419.53, h: 595.32 };
const doc = new jsPDF({ unit: 'pt', format: [PAGE.w, PAGE.h], orientation: 'portrait' });
const ink = (c) => doc.setTextColor(c[0], c[1], c[2]);
const fmt = (n) => String(n);

doc.setFillColor(17, 24, 39);
doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
doc.setFont('helvetica', 'bold'); doc.setFontSize(11); ink([255, 255, 255]);
doc.text('Position du titre « Masse (kg) » — choisissez A, B, C ou D', PAGE.w / 2, 25.2, { align: 'center' });
doc.setDrawColor(...INK); doc.setLineWidth(0.8);
doc.rect(15, 29.9, 388.6, 551.9, 'S');

// Vignette : reproduit la bande gauche (cadre → graphe) avec le titre à la
// position de la variante. xG = bord gauche du graphe ; labels finissant à
// xG−labGap ; titre centré à titleX.
function vignette(yTop, letter, label, labGap, titleX) {
    const H = 108, xG = 150, xR = 390;
    // Cadre extérieur (comme sur la page réelle) + repère.
    doc.setDrawColor(...[220, 38, 38]); doc.setLineWidth(1);
    doc.line(58, yTop, 58, yTop + H);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6); ink([220, 38, 38]);
    doc.text('cadre', 58, yTop - 3, { align: 'center' });
    // Zone de tracé + axes + quelques graduations.
    doc.setFillColor(...PLOT_BG);
    doc.rect(xG, yTop, xR - xG, H, 'F');
    doc.setDrawColor(...BANDL); doc.setLineWidth(0.4);
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
    for (let i = 0; i <= 4; i++) {
        const gy = yTop + (1 - i / 4) * H;
        doc.line(xG, gy, xR, gy);
        ink(MUTED);
        doc.text(fmt(600 + i * 150), xG - labGap, gy + 2.2, { align: 'right' });
    }
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(xG, yTop, xG, yTop + H);
    // Polygone enveloppe réduit pour le contexte visuel.
    const env = [[0.05, 0.55], [0.6, 0.72], [0.92, 0.8], [0.92, 0.95], [0.05, 0.98]];
    const pts = env.map(([fx, fy]) => [xG + fx * (xR - xG), yTop + fy * H]);
    const segs = pts.slice(1).map((p, i) => [p[0] - pts[i][0], p[1] - pts[i][1]]);
    doc.setFillColor(227, 242, 253); doc.setDrawColor(...BLUE); doc.setLineWidth(1.2);
    doc.lines(segs, pts[0][0], pts[0][1], [1, 1], 'FD', true);
    // Titre à la position testée.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7); ink(INK);
    doc.text('Masse (kg)', titleX, yTop + H / 2, { align: 'center', angle: 90 });
    // Lettre + description.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); ink(INK);
    doc.text(letter, 24, yTop + 16);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(8); ink(MUTED);
    doc.text(label, 34, yTop + 14);
}

vignette(58, 'A', 'collé au bord gauche du graphe (labels reculés)', 12, 150 - 3);
vignette(186, 'B', 'dans le couloir, à mi-chemin graphe / labels (labels reculés)', 16, 150 - 9);
vignette(314, 'C', 'à gauche des graduations, proche d\u2019elles (comme le site)', 5, 150 - 5 - 13 - 10);
vignette(442, 'D', 'proche du cadre extérieur, à gauche des graduations', 5, 23);

doc.setFont('helvetica', 'italic'); doc.setFontSize(8); ink(MUTED);
doc.text('Indiquez la lettre correspondant à la position voulue (ou « entre B et C »).', PAGE.w / 2, 570, { align: 'center' });

const out = path.join(root, 'Apercu_Position_titre_masse.pdf');
fs.writeFileSync(out, Buffer.from(doc.output('arraybuffer')));
console.log('OK : ' + out);
