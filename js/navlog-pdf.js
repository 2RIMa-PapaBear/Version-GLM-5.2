// Log de nav VFR — génération PDF A5, reproduction du modèle « Log de nav A5 v2 ».
//
// Ce module est VOLONTAIREMENT SANS IMPORT : drawNavLogPdf() est une fonction
// pure (constructeur jsPDF + données normalisées), testable sous Node sans DOM.
// La collecte des données applicatives (plan de vol, flotte, METAR, piste)
// est faite par l'appelant (flight-planner-ui.js).
//
// Typographie harmonisée : corps 9 pt partout (libellés, valeurs, transpondeur,
// fréquences, cellules, légende), titres de sections 10 pt, titre du document
// 11 pt. Seuls les en-têtes du tableau restent à 8 pt (libellés denses) et le
// METAR en courier 7,5 pt (code).
//
// Structure (coordonnées en points, relevées sur le modèle puis ajustées) :
//   - bandeau titre noir « VFR Flight Log »
//   - bande sections « Pilote / Détail vol » + « Avion » + « Paramètres »
//   - bloc gauche : pilote, heures, horomètres, distance, temps de vol
//     (valeurs collées après le libellé : « Distance : 142 NM »)
//   - bloc transpondeur vert (7500/7600/7700/7000) + fréquences (121.5 rouge)
//   - Notes : 1re ligne = METAR de départ en code, puis lignes vierges
//   - tableau de nav (RM/CM élargie, HEA/HRA égalisées) :
//     FROM/TO · Dist restante · Distance · Z sécu · Z retenue · RM/CM · Tsv/Tav · HEA · HRA
//   - 3 cadres Check (Croisière / Point Tournant / Vent Arrière) + légende
//     6 mnémoniques par colonne, séparées par des filets verticaux

const PAGE = { w: 419.53, h: 595.32 };

const INK = [17, 24, 39];        // #111827
const MUTED = [107, 114, 128];   // #6B7280
const LINE = [156, 163, 175];    // #9CA3AF
const DARK = [55, 65, 81];       // #374151 (bandes)
const BANDL = [229, 231, 235];   // #E5E7EB (en-tête tableau)
const GREEN_BG = [232, 245, 233];
const GREEN_INK = [27, 94, 32];
const GREEN_BD = [102, 187, 106];
const RED = [220, 38, 38];

// Tailles de police harmonisées.
const SZ = { body: 9, title: 10, doc: 11, thead: 8 };

// Colonnes du tableau de nav : en-têtes « Dist restante » et « Z retenue » sur
// deux lignes → colonnes compactes, FROM/TO élargie. RM/CM large, HEA = HRA.
const COLS = [17.8, 114, 146, 184, 214, 248, 290, 327.7, 365.2, 402.7];
const HEADERS = [['FROM/TO'], ['Dist', 'restante'], ['Distance'], ['Z sécu'], ['Z', 'retenue'], ['RM/CM'], ['Tsv/Tav'], ['HEA'], ['HRA']];
const ROW_H = 22;
const N_ROWS = 9;   // lignes du tableau (remplies puis vierges à compléter en vol)

function _setInk(doc, rgb) { doc.setTextColor(rgb[0], rgb[1], rgb[2]); }

// Découpe un texte long (METAR) pour tenir dans une largeur donnée.
function _wrap(doc, text, maxW) {
    const words = String(text || '').split(' ');
    const lines = [];
    let cur = '';
    for (const w of words) {
        const t = cur ? cur + ' ' + w : w;
        if (doc.getTextWidth(t) > maxW && cur) { lines.push(cur); cur = w; }
        else cur = t;
    }
    if (cur) lines.push(cur);
    return lines;
}

/**
 * Dessine le log de nav et retourne le document jsPDF (non sauvegardé).
 * @param {Function} jsPDFCtor constructeur jsPDF (window.jspdf.jsPDF)
 * @param {Object} d  données normalisées :
 *   aircraftType, aircraftReg, qnh, windDir, windKt, runway,
 *   distanceNm, timeLabel, metarRaw,
 *   rows[] { from, to, distRemain, dist, zSecu, zRet, rm, cm, tsv, tav }
 */
export function drawNavLogPdf(jsPDFCtor, d) {
    const doc = new jsPDFCtor({ unit: 'pt', format: [PAGE.w, PAGE.h], orientation: 'portrait' });
    doc.setFont('helvetica', 'normal');

    // Champ « Libellé : valeur » — la valeur (gras) est collée au libellé avec
    // une espace : « Distance : 142 NM ». Retourne l'abscisse de fin de valeur.
    const _field = (label, value, x, y) => {
        doc.setFont('helvetica', 'normal'); doc.setFontSize(SZ.body); _setInk(doc, INK);
        doc.text(label, x, y);
        const vx = x + doc.getTextWidth(label) + 3;
        if (value != null && value !== '') {
            doc.setFont('helvetica', 'bold');
            doc.text(String(value), vx, y);
        }
        return vx;
    };
    // Trait de saisie manuelle (sous un champ laissé vide).
    const _rule = (x1, x2, y) => { doc.setDrawColor(...LINE); doc.setLineWidth(0.4); doc.line(x1, y + 1.2, x2, y + 1.2); };

    // ---- Bandeau titre ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text('VFR Flight Log', PAGE.w / 2, 25.2, { align: 'center' });

    // ---- Cadre extérieur + bande sections ----
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');
    doc.setFillColor(...DARK);
    doc.rect(16.4, 35.4, 386.3, 14.3, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, [255, 255, 255]);
    doc.text('Pilote / Détail vol', 46.1, 45.4);
    // « Avion » et « Paramètres » centrés sur les colonnes du dessous
    // (transpondeur 175-290, fréquences 290-403), elles-mêmes rétrécies pour
    // laisser la largeur au bloc « Pilote / Détail vol » (17,8 → 175).
    doc.text('Avion', 242.5, 45.4, { align: 'center' });
    doc.text('Paramètres', 346.3, 45.4, { align: 'center' });

    // ---- Bloc gauche : libellés + valeurs collées / zones à remplir ----
    // Structure : Pilote 17,8→195 (large), Avion = transpondeur (195→290),
    // Paramètres = fréquences (290→403). Bordures verticales prolongées jusqu'aux
    // blocs du dessous. Toujours 6 pt d'espace entre un cadre et son texte.
    const PAD = 6;
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    doc.line(195, 49.7, 195, 92);
    doc.line(290, 49.7, 290, 92);

    const ROWS_Y = [50.9, 65.1, 79.2, 93.4, 107.5, 121.7, 135.9];
    // Baseline centrée verticalement dans sa ligne (ligne ~14,2 pt, capitale ~6,5 pt).
    const B = i => ROWS_Y[i] + 10.4;

    // Colonne 1 (Pilote / détail vol) — champs inconnus : trait à remplir à la main.
    let vx = _field('Pilote :', '', 17.8, B(0)); _rule(vx + 2, 188, B(0));
    vx = _field('Hr Départ :', '', 17.8, B(1)); _rule(vx + 2, 188, B(1));
    vx = _field('Hr Arrivée :', '', 17.8, B(2)); _rule(vx + 2, 188, B(2));
    vx = _field('Horamètre Départ :', '', 17.8, B(3)); _rule(vx + 2, 188, B(3));
    vx = _field('Horamètre Arrivée :', '', 17.8, B(4)); _rule(vx + 2, 188, B(4));
    _field('Distance :', `${d.distanceNm ?? ''} NM`, 17.8, B(5));
    _field('Temps de vol :', d.timeLabel ?? '', 17.8, B(6));

    // Colonne 2 (Avion) — alignée sur le bloc transpondeur (x=195), texte à PAD du cadre.
    _field('Type :', d.aircraftType || '', 195 + PAD, B(0));
    _field('Immat :', d.aircraftReg || '', 195 + PAD, B(1));
    vx = _field('C/sign :', '', 195 + PAD, B(2)); _rule(vx + 2, 290 - PAD, B(2));

    // Colonne 3 (Paramètres) — alignée sur le bloc fréquences (x=290).
    _field('QNH :', d.qnh || '', 290 + PAD, B(0));
    _field('Vent :', d.windDir != null ? `${d.windDir}/${String(d.windKt ?? '').padStart(2, '0')} Kt` : '', 290 + PAD, B(1));
    _field('Piste en service :', d.runway || '', 290 + PAD, B(2));

    // ---- Bloc transpondeur (fond vert, x=195 aligné sur la colonne Avion) ----
    // Texte aligné à GAUCHE avec marge : « 7500 : Détournement ».
    doc.setFillColor(...GREEN_BG); doc.setDrawColor(...GREEN_BD); doc.setLineWidth(0.6);
    doc.rect(195, 92, 95, 56.8, 'FD');
    const TSP = [['7500', 'Détournement'], ['7600', 'Panne radio'], ['7700', 'Détresse'], ['7000', 'VFR']];
    TSP.forEach(([code, lab], i) => {
        const y = [93.4, 107.5, 121.2, 135.4][i] + 10.2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
        doc.text(code, 195 + PAD, y);
        const w = doc.getTextWidth(code);
        doc.setFont('helvetica', 'normal'); _setInk(doc, GREEN_INK);
        doc.text(` : ${lab}`, 195 + PAD + w, y);
    });

    // ---- Bloc fréquences (121.500 en rouge, x=290 aligné sur Paramètres) ----
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.rect(290, 92, 112.7, 56.8, 'S');
    const FRQ = [
        ['123.500', 'Aérodrome', false],
        ['130.000', 'Fréq. montagne', false],
        ['123.450', 'Comm/aéronefs', false],
        ['121.500', 'Fréq. détresse', true],
    ];
    FRQ.forEach(([f, lab, isRed], i) => {
        const y = [93.4, 108.2, 122.4, 136.5][i] + 10.2;
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body);
        _setInk(doc, isRed ? RED : INK);
        doc.text(f, 290 + PAD, y);
        doc.setFont('helvetica', 'normal');
        _setInk(doc, isRed ? RED : MUTED);
        doc.text(lab, 334, y);
    });

    // ---- Notes : METAR de départ en 1re ligne, puis lignes vierges ----
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, INK);
    doc.text('Notes :', 18.2, 175.4);
    doc.setFont('courier', 'normal'); doc.setFontSize(7.5); _setInk(doc, INK);
    const noteLines = d.metarRaw ? _wrap(doc, d.metarRaw, 380) : [];
    noteLines.slice(0, 2).forEach((l, i) => doc.text(l, 17.9, 184.5 + i * 13));
    if (noteLines.length > 2) doc.text('…', 380, 210.5);
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    for (let i = 0; i < 6; i++) doc.line(17.9, 188 + i * 13, 402.7, 188 + i * 13);

    // ---- Tableau de nav ----
    const T_TOP = 256, T_HEAD_H = 27;
    doc.setFillColor(...BANDL);
    doc.rect(COLS[0], T_TOP, COLS[COLS.length - 1] - COLS[0], T_HEAD_H, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.thead); _setInk(doc, INK);
    HEADERS.forEach((lines, i) => {
        const cx = (COLS[i] + COLS[i + 1]) / 2;
        if (lines.length === 2) {
            // En-tête sur deux lignes, bloc centré verticalement dans la bande.
            doc.text(lines[0], cx, T_TOP + 12.5, { align: 'center' });
            doc.text(lines[1], cx, T_TOP + 21.5, { align: 'center' });
        } else {
            doc.text(lines[0], cx, T_TOP + 17, { align: 'center' });
        }
    });
    // Lignes de données puis lignes vierges.
    const nData = Math.min((d.rows || []).length, N_ROWS);
    for (let r = 0; r < N_ROWS; r++) {
        const yTop = T_TOP + T_HEAD_H + r * ROW_H;
        const base = yTop + 14.5;
        if (r < nData) {
            const row = d.rows[r];
            doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
            doc.text(`${row.from}-${row.to}`, (COLS[0] + COLS[1]) / 2, base, { align: 'center' });
            doc.setFont('helvetica', 'normal');
            const cells = [row.distRemain, row.dist, row.zSecu, row.zRet, `${row.rm}/${row.cm}`, '', '', ''];
            cells.forEach((v, i) => {
                if (v !== '' && v != null) doc.text(String(v), (COLS[i + 1] + COLS[i + 2]) / 2, base, { align: 'center' });
            });
            // Tsv/Tav : « 21/19 » — le temps AVEC vent (Tav) est en gras.
            if (row.tsv !== '' && row.tav !== '') {
                const cx = (COLS[6] + COLS[7]) / 2;
                const sep = `${row.tsv}/`;
                doc.setFont('helvetica', 'normal');
                const w1 = doc.getTextWidth(sep);
                doc.setFont('helvetica', 'bold');
                const w2 = doc.getTextWidth(String(row.tav));
                const x0 = cx - (w1 + w2) / 2;
                doc.setFont('helvetica', 'normal'); _setInk(doc, INK);
                doc.text(sep, x0, base);
                doc.setFont('helvetica', 'bold');
                doc.text(String(row.tav), x0 + w1, base);
            }
        }
        doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
        doc.line(COLS[0], yTop + ROW_H, COLS[COLS.length - 1], yTop + ROW_H);
    }
    // Grille verticale + contour.
    doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
    for (let i = 1; i < COLS.length - 1; i++) doc.line(COLS[i], T_TOP, COLS[i], T_TOP + T_HEAD_H + N_ROWS * ROW_H);
    doc.setDrawColor(...INK); doc.setLineWidth(0.6);
    doc.rect(COLS[0], T_TOP, COLS[COLS.length - 1] - COLS[0], T_HEAD_H + N_ROWS * ROW_H, 'S');

    // ---- Cadres Check ----
    const CHECKS = [
        [16.4, 117.8, 'Check Croisière', 41.9],
        [134.0, 138.0, 'Check Point Tournant', 158.9],
        [271.9, 130.8, 'Check Vent Arrière', 298.7],
    ];
    for (const [x, w, lab, tx] of CHECKS) {
        doc.setFillColor(...DARK);
        doc.rect(x, 486.7, w, 12.1, 'F');
        doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.title); _setInk(doc, [255, 255, 255]);
        doc.text(lab, tx, 496.2);
    }

    // ---- Légende des mnémoniques (6 lettres par colonne, filets séparateurs) ----
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.rect(16.4, 503.8, 386.3, 77.1, 'S');
    doc.line(133.5, 503.8, 133.5, 580.9);
    doc.line(269.5, 503.8, 269.5, 580.9);
    const LEGEND = [
        [['P', 'Paramètres'], ['I', 'Instruments'], ['A', 'Altitude'], ['G', 'Gyro / Cap'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
        [['T', 'Top / Estimé Point Suiv.'], ['R', 'Route / Cap'], ['A', 'Altitude'], ['M', 'Moteur / Météo'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
        [['D', 'Dégivrage'], ['R', 'Richesse'], ['A', 'Altitude'], ['G', 'Gyro / Cap'], ['E', 'Essence'], ['R', 'Radio/Radio Nav']],
    ];
    const LEG_X = [17.9, 138.5, 274.4];
    LEGEND.forEach((col, c) => {
        col.forEach(([letter, meaning], r) => {
            const y = 512.3 + r * 11.5;
            doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.body); _setInk(doc, INK);
            doc.text(letter, LEG_X[c], y);
            doc.setFont('helvetica', 'normal');
            doc.text(`: ${meaning}`, LEG_X[c] + 8, y);
        });
    });

    return doc;
}
