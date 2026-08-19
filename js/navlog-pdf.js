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
//
// Page 2 — « Calcul de navigation » : reproduction compacte du bloc écran du
// planificateur (flight-planner-ui.js, _renderResult), sans le bouton
// « Log de nav PDF » : ligne Départ → Destination, paramètres saisis, puis
// lignes denses de cellules (Distance/Caps/Déclinaison, Vent à l'altitude de
// croisière + dérive + GS + temps de vol, Carburant, Relief — titres de
// section repliés dans les libellés), tableau des waypoints et note de bas
// de page. La compaction verticale laisse au tableau la place d'afficher
// 8 à 10 tronçons. Les couleurs claires du thème sombre sont assombries
// d'un cran pour rester lisibles sur papier blanc.
//
// Page 3 — « Performances et terrain » :
//   - performances de décollage du terrain de DÉPART (METAR frais capturé à
//     la génération) : cellules Roulement / 50 ft / densité-altitude / réf.
//     avion, revêtement, longueur de piste et marge, + barre visuelle
//     roulement vs piste disponible (reproduction du widget écran),
//   - profil d'élévation de la route redessiné (même langage visuel que le
//     canvas elevation-chart.js : aire orangée, ligne de croisière bleue
//     pointillée, waypoints ambre),
//   - tableau des alternates viables à ± 50 NM de la route (catégorie de vol,
//     visi, plafond, vent, écart gauche/droite).
//
// Chaque page porte en pied, SOUS le cadre extérieur (bande de marge), un
// court avertissement d'utilisation.

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

// Palette page 2 : équivalents « impression » des couleurs du thème écran.
const BLUE = [2, 132, 199];       // --primary #38BDF8 → sky-600 (valeurs, freq, totaux)
const TEAL = [13, 148, 136];      // --secondary #2DD4BF → teal-600 (temps de vol)
const AMBER = [180, 83, 9];       // #F59E0B → amber-700 (dérive forte, marge réduite)
const GREEN = [5, 150, 105];      // #10B981 → emerald-600 (marge ok)
const REDTX = [185, 28, 28];      // #EF4444 → red-700 (marge dangereuse)
const CELL_BG = [243, 244, 246];  // fond fp-cell (#F3F4F6)

// Palette page 3 : profil de relief + alternates (écran → papier).
const ORANGE_BG = [254, 234, 215];   // aire sous la courbe (#FB923C 35 % → orange-100)
const ORANGE = [234, 88, 12];        // ligne de terrain (#FB923C → orange-600)
const AMBER_LN = [245, 158, 11];     // marqueurs waypoints (#FBBF24 → amber-500)
const PLOT_BG = [248, 250, 252];     // fond du graphique
const CAT_PRINT = {                  // CAT_COLORS écran → équivalents papier
    VFR: [5, 150, 105], MVFR: [2, 132, 199], IFR: [185, 28, 28], LIFR: [146, 22, 138],
};
const LVL_FILL = {                   // fonds clairs de la barre de marge décollage
    ok: [209, 250, 229], caution: [254, 243, 199], danger: [254, 226, 226],
};

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

// Coupe un texte (nom d'aérodrome, waypoints) à la largeur disponible.
function _trunc(doc, text, maxW) {
    let t = String(text ?? '');
    if (doc.getTextWidth(t) <= maxW) return t;
    while (t.length > 1 && doc.getTextWidth(t + '…') > maxW) t = t.slice(0, -1);
    return t + '…';
}

// Avertissement d'utilisation, identique sur les 3 pages : une seule ligne
// 6 pt centrée dans la bande de marge sous le cadre extérieur.
function _footer(doc, isFr) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6); _setInk(doc, MUTED);
    doc.text(isFr
        ? 'Document généré automatiquement — aide à la préparation. Vérifiez chaque valeur avant le vol (météo, POH, VAC, NOTAM).'
        : 'Automatically generated preparation aid — verify every value before flight (weather, POH, charts, NOTAM).',
        PAGE.w / 2, 590.2, { align: 'center' });
}

// ---------------------------------------------------------------------------
// Helpers partagés pages 2 et 3 (reproduction des styles écran .fp-cell /
// .fp-section) — prennent doc en 1er paramètre (module sans état).
// ---------------------------------------------------------------------------

// Cellule .fp-cell : fond gris clair arrondi, libellé majuscule grisé,
// valeur en gras (couleur/taille pilotables — surbrillances écran).
function _cell(doc, x, yc, w, h, label, value, opt = {}) {
    doc.setFillColor(...CELL_BG); doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.roundedRect(x, yc, w, h, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(String(label).toUpperCase(), x + 7, yc + 9.5, { charSpace: 0.5 });
    doc.setFont('courier', 'bold'); doc.setFontSize(opt.size || 10.5);
    _setInk(doc, opt.color || INK);
    doc.text(_trunc(doc, value ?? '—', w - 14), x + 7, yc + h - 8);
}

// Section .fp-section : filet supérieur + titre majuscule grisé éventuel.
// Retourne l'ordonnée de départ du contenu.
function _section(doc, L, R, title, ys) {
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(L, ys, R, ys);
    if (title) {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); _setInk(doc, MUTED);
        doc.text(String(title).toUpperCase(), L + 1.5, ys + 11, { charSpace: 0.6 });
        return ys + 16;
    }
    return ys + 6;
}

// Bandeau d'alerte (marge réduite / décollage critique) — même style que le
// bandeau « relief » de la page 2. Retourne l'ordonnée après le bandeau.
function _alertBanner(doc, L, R, W, y, danger, text) {
    const lines = _wrap(doc, text, W - 14);
    const h = Math.max(15, lines.length * 9 + 7);
    doc.setFillColor(...(danger ? [254, 226, 226] : [254, 243, 199]));
    doc.setDrawColor(...(danger ? [248, 113, 113] : [245, 158, 11]));
    doc.setLineWidth(0.5);
    doc.roundedRect(L, y, W, h, 2.5, 2.5, 'FD');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5);
    _setInk(doc, danger ? REDTX : AMBER);
    lines.forEach((l, i) => doc.text(l, L + 7, y + 10 + i * 9));
    return y + h + 8;
}

/**
 * Dessine le log de nav et retourne le document jsPDF (non sauvegardé).
 * @param {Function} jsPDFCtor constructeur jsPDF (window.jspdf.jsPDF)
 * @param {Object} d  données normalisées :
 *   aircraftType, aircraftReg, qnh, windDir, windKt, runway,
 *   distanceNm, timeLabel, metarRaw,
 *   rows[] { from, to, distRemain, dist, zSecu, zRet, rm, cm, tsv, tav },
 *   calc (optionnel) → ajoute une 2e page « Calcul de navigation » :
 *   { isFr, fromIcao, fromName, toIcao, toName, waypoints, cruiseAltFt,
 *     tasKt, fuelBurnLph, isNight, distanceNm, distanceKm, trueCourse,
 *     magHeading, declination, wind {dir,speedKt}|null, driftDeg,
 *     groundSpeed, timeLabel, fuel {tripL,reserveL,totalL,reserveMin},
 *     clearance {maxFt,minClearanceFt,level}|null, isMultiLeg,
 *     legs[] {from,to,dist,hdg,eteLabel,fuelL,freq} },
 *   perf (optionnel) → ajoute une 3e page « Performances et terrain » :
 *   { isFr, fromIcao, toIcao, runway,
 *     takeoff { da, groundRollM, fiftyFtM, runwayLengthM, marginM, level,
 *               message, refLabel, surfaceLabel, surfaceSoft, surfacePct } | null,
 *     profile { fromIcao, toIcao, distTotalKm, minFt, maxFt, cruiseAltFt,
 *               points[{frac,elevFt}], waypoints[{icao,frac}] } | null,
 *     alternates { maxOffsetNm, rows[{code,name,cat,visiStr,ceilStr,
 *                 windStr,offsetNm,side}] } | null }
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

    _footer(doc, !(d.calc?.isFr === false || d.perf?.isFr === false));

    // ---- Page 2 : « Calcul de navigation » (bloc écran du planificateur) ----
    if (d.calc) _drawCalcPage(doc, d.calc);

    // ---- Page 3 : « Performances et terrain » ----
    if (d.perf) _drawPerfPage(doc, d.perf);

    return doc;
}

// ---------------------------------------------------------------------------
// Page 2 — « Calcul de navigation » : reproduction du bloc écran du
// planificateur (flight-planner-ui.js, _renderResult), SANS le bouton
// « Log de nav PDF ». Mêmes bandeau/cadre que la page 1 pour former une
// paire cohérente ; cellules gris clair façon .fp-cell, valeurs en gras
// (courier ≈ DM Mono à l'écran), sections séparées par un filet comme les
// .fp-section (border-top).
// ---------------------------------------------------------------------------
function _drawCalcPage(doc, c) {
    const fr = c.isFr !== false;
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    doc.setFont('helvetica', 'normal');

    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const FRAME_BOT = 581.8;                    // bas du cadre extérieur
    const pad3 = (v) => String(v ?? '').padStart(3, '0');
    const cell = (x, yc, w, h, label, value, opt) => _cell(doc, x, yc, w, h, label, value, opt);
    const section = (title, ys) => _section(doc, L, R, title, ys);

    // ---- Bandeau titre + cadre extérieur (identiques à la page 1) ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Calcul de navigation' : 'Flight plan', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    // ---- Ligne mono « LFPB → LFRM » (en-tête du bloc écran) ----
    doc.setFont('courier', 'normal'); doc.setFontSize(8); _setInk(doc, MUTED);
    doc.text(`${c.fromIcao} → ${c.toIcao}`.replace('→', '-'), L + 1.5, 45);

    // ---- Ligne Départ → Destination (libellés + noms complets + flèche) ----
    const RIGHT_X = MID + 12, HALF_W = 180;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(fr ? 'DÉPART' : 'FROM', L + 1.5, 57, { charSpace: 0.6 });
    doc.text(fr ? 'DESTINATION' : 'TO', RIGHT_X, 57, { charSpace: 0.6 });
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10.5); _setInk(doc, INK);
    doc.text(_trunc(doc, `${c.fromIcao} · ${c.fromName}`, HALF_W), L + 1.5, 69);
    doc.text(_trunc(doc, `${c.toIcao} · ${c.toName}`, HALF_W), RIGHT_X, 69);
    // Flèche entre les deux (pas de glyphe → en helvetica standard : tracée).
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.9);
    doc.line(MID - 6, 65.5, MID + 7, 65.5);
    doc.line(MID + 2.5, 61.5, MID + 7, 65.5);
    doc.line(MID + 2.5, 69.5, MID + 7, 65.5);

    // ---- Paramètres saisis (inputs écran, valeurs en bleu « saisie ») ----
    // Mise en page COMPACTE : les cellules résultats sont regroupées en
    // lignes de 4 / 3 / 2 (titres de section repliés dans les libellés) pour
    // laisser au tableau des waypoints la place d'afficher 8 à 10 tronçons.
    let y = 80;
    cell(L, y, W, 27, fr ? 'Waypoints (optionnel)' : 'Waypoints (optional)',
         c.waypoints || '—', { color: c.waypoints ? BLUE : MUTED });
    y += 31;
    const pw = (W - 3 * 7 - 68) / 3;
    cell(L, y, pw, 27, fr ? 'Alt. croisière (ft)' : 'Cruise alt (ft)', c.cruiseAltFt ?? '—', { color: BLUE });
    cell(L + pw + 7, y, pw, 27, fr ? 'Vitesse air (kt)' : 'TAS (kt)', c.tasKt ?? '—', { color: BLUE });
    cell(L + 2 * (pw + 7), y, pw, 27, fr ? 'Conso (L/h)' : 'Burn (L/h)', c.fuelBurnLph ?? '—', { color: BLUE });
    cell(L + 3 * (pw + 7), y, 68, 27, fr ? 'Vol de nuit' : 'Night',
         c.isNight ? (fr ? 'Oui' : 'Yes') : (fr ? 'Non' : 'No'), { color: BLUE });
    y += 33;

    // ---- Ligne résultats : Distance / Cap vrai / Cap magnétique / Déclinaison ----
    const cw4 = (W - 3 * 7) / 4;
    y = section(null, y);
    cell(L, y, cw4, 27, fr ? 'Distance' : 'Distance', `${c.distanceNm ?? '—'} NM`, { size: 9.5 });
    // Suffixe km discret collé après la valeur, comme à l'écran.
    doc.setFont('courier', 'bold'); doc.setFontSize(9.5);
    const wMain = doc.getTextWidth(`${c.distanceNm ?? '—'} NM`);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text(`(${c.distanceKm ?? '—'} km)`, L + 7 + wMain + 3, y + 20);
    cell(L + cw4 + 7, y, cw4, 27, fr ? 'Cap vrai (TC)' : 'True course', `${pad3(c.trueCourse)}°`);
    cell(L + 2 * (cw4 + 7), y, cw4, 27, fr ? 'Cap magnétique' : 'Magnetic heading',
         `${pad3(c.magHeading)}°`, { color: BLUE, size: 12 });
    cell(L + 3 * (cw4 + 7), y, cw4, 27, fr ? 'Déclinaison' : 'Declination',
         `${(c.declination ?? 0) > 0 ? '+' : ''}${c.declination ?? 0}°`);
    y += 31;

    // ---- Ligne vent / dérive / vitesse sol / temps de vol ----
    y = section(null, y);
    cell(L, y, cw4, 27, fr ? `Vent à ${c.cruiseAltFt ?? ''} ft` : `Wind at ${c.cruiseAltFt ?? ''} ft`,
         c.wind ? `${pad3(c.wind.dir)}° / ${c.wind.speedKt} kt` : '—', { size: 9.5 });
    const dr = c.driftDeg;
    cell(L + cw4 + 7, y, cw4, 27, fr ? 'Dérive' : 'Drift',
         c.wind ? `${(dr ?? 0) > 0 ? '+' : ''}${dr ?? '—'}°` : '—',
         Math.abs(dr ?? 0) >= 10 ? { color: AMBER, size: 9.5 } : { size: 9.5 });
    cell(L + 2 * (cw4 + 7), y, cw4, 27, fr ? 'Vitesse sol (GS)' : 'Ground speed', `${c.groundSpeed ?? '—'} kt`, { size: 9.5 });
    cell(L + 3 * (cw4 + 7), y, cw4, 27, fr ? 'Temps de vol' : 'Flight time',
         c.timeLabel || '—', { color: TEAL, size: 11 });
    y += 31;

    // ---- Ligne carburant : Trajet / Réserve / Total requis ----
    y = section(null, y);
    const fw = (W - 2 * 12) / 3;
    cell(L, y, fw, 27, fr ? 'Trajet' : 'Trip', `${c.fuel?.tripL ?? '—'} L`);
    cell(L + fw + 12, y, fw, 27, `${fr ? 'Réserve' : 'Reserve'} (${c.fuel?.reserveMin ?? ''} min)`, `${c.fuel?.reserveL ?? '—'} L`);
    cell(L + 2 * (fw + 12), y, fw, 27, fr ? 'Total requis' : 'Total req.', `${c.fuel?.totalL ?? '—'} L`, { color: BLUE, size: 12 });
    y += 31;

    // ---- Ligne relief (si disponible) : Altitude max sol / Marge mini ----
    const cl = c.clearance;
    if (cl) {
        const clColor = cl.level === 'danger' ? REDTX : (cl.level === 'caution' ? AMBER : GREEN);
        const cw = (W - 16) / 2;
        y = section(null, y);
        cell(L, y, cw, 27, fr ? 'Altitude max sol' : 'Max terrain', `${cl.maxFt ?? '—'} ft`);
        cell(L + cw + 16, y, cw, 27, fr ? 'Marge mini' : 'Min clearance',
             `${(cl.minClearanceFt ?? 0) >= 0 ? '+' : ''}${cl.minClearanceFt ?? '—'} ft`, { color: clColor });
        y += 31;
        if (cl.level !== 'ok') {
            const danger = cl.level === 'danger';
            y = _alertBanner(doc, L, R, W, y, danger,
                danger
                    ? (fr ? 'Altitude de croisière SOUS le relief — augmentez l\'altitude' : 'Cruise altitude BELOW terrain — climb higher')
                    : (fr ? 'Marge de franchissement réduite (< 1000 ft)' : 'Reduced terrain clearance (< 1000 ft)')) - 2;
        }
    }

    // ---- Tableau Détail des waypoints (multi-waypoints uniquement) ----
    const legs = (c.isMultiLeg && Array.isArray(c.legs)) ? c.legs : [];
    if (legs.length) {
        y = section(`${fr ? 'Détail des waypoints' : 'Leg details'} (${legs.length})`, y);
        // Colonnes : 1re à gauche, les autres alignées à droite (comme .fp-navlog).
        // Réparties sur toute la largeur : « 26 min » (ETE) et « 120.300 AFIS »
        // (Fréq) sont larges — des colonnes resserrées à droite se chevauchaient.
        // La fréquence est tronquée si elle dépasse sa colonne (~86 pt).
        const COLR = [178, 224, 270, 316, R - 5];
        const FREQ_W = COLR[4] - COLR[3] - 10;
        const HEADS = fr ? ['Tronçon', 'Dist', 'Cap', 'ETE', 'Conso', 'Fréq']
                         : ['Leg', 'Dist', 'Hdg', 'ETE', 'Fuel', 'Freq'];
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
        doc.text(HEADS[0].toUpperCase(), L + 1.5, y + 8, { charSpace: 0.4 });
        for (let i = 1; i < HEADS.length; i++) {
            doc.text(HEADS[i].toUpperCase(), COLR[i - 1], y + 8, { align: 'right', charSpace: 0.4 });
        }
        const headBot = y + 11;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
        doc.line(L, headBot, R, headBot);

        // Hauteur de ligne adaptative : tout faire tenir au-dessus de la note
        // de bas de page (2 lignes + marge). Filets de séparation discrets.
        const FOOT_TOP = FRAME_BOT - 24;
        let rowH = Math.min(13.5, Math.floor((FOOT_TOP - headBot) / (legs.length + 1)));
        if (rowH < 10) rowH = 10;
        const rowLine = (row, idx) => {
            const base = headBot + idx * rowH + rowH - 3.5;
            doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, INK);
            doc.text(`${row.from} → ${row.to}`.replace('→', '-'), L + 1.5, base);
            const vals = [`${row.dist} NM`, `${pad3(row.hdg)}°`, row.eteLabel, `${row.fuelL} L`];
            doc.setFont('courier', 'normal');
            vals.forEach((v, i) => doc.text(String(v ?? '—'), COLR[i], base, { align: 'right' }));
            if (row.freq) { _setInk(doc, BLUE); doc.text(_trunc(doc, row.freq, FREQ_W), COLR[4], base, { align: 'right' }); }
        };
        legs.forEach((lg, i) => {
            rowLine(lg, i);
            if (i < legs.length - 1) {
                doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
                doc.line(L, headBot + (i + 1) * rowH, R, headBot + (i + 1) * rowH);
            }
        });
        // Ligne TOTAL (gras, bleu, filet supérieur — comme tr.total à l'écran).
        const totBase = headBot + (legs.length + 1) * rowH - 3.5;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.6);
        doc.line(L, headBot + legs.length * rowH, R, headBot + legs.length * rowH);
        doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, BLUE);
        doc.text(fr ? 'TOTAL' : 'TOTAL', L + 1.5, totBase);
        const tots = [`${c.distanceNm ?? '—'} NM`, '—', c.timeLabel || '—', `${c.fuel?.tripL ?? '—'} L`];
        tots.forEach((v, i) => doc.text(String(v), COLR[i], totBase, { align: 'right' }));
        doc.text('—', COLR[4], totBase, { align: 'right' });
        y = headBot + (legs.length + 1) * rowH + 10;
    }

    // ---- Note de bas de page (référence POH, comme à l'écran) ----
    // Ancrée en bas du cadre : avec la mise en page compacte, le tableau des
    // waypoints est plus ou moins long mais la note reste au même endroit.
    const note = fr
        ? 'Calculs basés sur le vent Open-Meteo à l\'altitude de croisière et l\'élévation du relief. Le POH de l\'avion reste la référence légale.'
        : 'Computations based on Open-Meteo winds at cruise altitude and terrain elevation. The aircraft POH remains the legal reference.';
    const fy = FRAME_BOT - 24;
    doc.setDrawColor(...MUTED); doc.setLineWidth(0.5);
    doc.circle(L + 3.5, fy + 1, 3.2, 'S');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    doc.text('i', L + 3.5, fy + 3.2, { align: 'center' });
    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); _setInk(doc, MUTED);
    _wrap(doc, note, W - 13).slice(0, 2).forEach((l, i) => doc.text(l, L + 11, fy + 2.5 + i * 9));

    _footer(doc, fr);
}

// ---------------------------------------------------------------------------
// Page 3 — « Performances et terrain » : perfs de décollage du départ
// (widget écran takeoff-ui.js), profil d'élévation de la route
// (elevation-chart.js) et alternates à ± 50 NM de la route (alternates.js).
// Mêmes bandeau/cadre/cellules que la page 2 pour former un document cohérent.
// ---------------------------------------------------------------------------
function _drawPerfPage(doc, p) {
    const fr = p.isFr !== false;
    doc.addPage([PAGE.w, PAGE.h], 'portrait');
    doc.setFont('helvetica', 'normal');

    const L = 16.4, R = 402.7, W = R - L, MID = (L + R) / 2;
    const cell = (x, yc, w, h, label, value, opt) => _cell(doc, x, yc, w, h, label, value, opt);
    const section = (title, ys) => _section(doc, L, R, title, ys);

    // ---- Bandeau titre + cadre extérieur (identiques aux pages 1-2) ----
    doc.setFillColor(17, 24, 39);
    doc.rect(16.4, 14.3, 386.3, 16.2, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(SZ.doc); _setInk(doc, [255, 255, 255]);
    doc.text(fr ? 'Performances et terrain' : 'Performance & terrain', MID, 25.2, { align: 'center' });
    doc.setDrawColor(...INK); doc.setLineWidth(0.8);
    doc.rect(15, 29.9, 388.6, 551.9, 'S');

    // ---- Ligne mono « LFPB → LFRM » (même en-tête que la page 2) ----
    doc.setFont('courier', 'normal'); doc.setFontSize(8); _setInk(doc, MUTED);
    doc.text(`${p.fromIcao} → ${p.toIcao}`.replace('→', '-'), L + 1.5, 45);

    let y = 56;

    // ---- Section 1 : performances de décollage (terrain de départ) ----
    const rwyTxt = p.runway ? ` · RWY ${p.runway}` : '';
    y = section(fr ? `Performances de décollage — ${p.fromIcao}${rwyTxt}` : `Takeoff performance — ${p.fromIcao}${rwyTxt}`, y);
    const t = p.takeoff;
    if (t) {
        const lvl = t.level === 'danger' ? 'danger' : (t.level === 'caution' ? 'caution' : 'ok');
        const lvlColor = lvl === 'danger' ? REDTX : (lvl === 'caution' ? AMBER : GREEN);

        const cw4 = (W - 3 * 7) / 4;
        cell(L, y, cw4, 27, fr ? 'Roulement' : 'Ground roll', `${t.groundRollM} m`);
        cell(L + cw4 + 7, y, cw4, 27, fr ? 'Franch. 50 ft' : '50 ft obstacle', `${t.fiftyFtM} m`);
        cell(L + 2 * (cw4 + 7), y, cw4, 27, fr ? 'Densité-alt.' : 'Density alt.', `${t.da} ft`);
        cell(L + 3 * (cw4 + 7), y, cw4, 27, fr ? 'Réf. avion (m)' : 'A/C ref (m)', t.refLabel, { size: 9.5 });
        y += 33;

        const cw3 = (W - 2 * 7) / 3;
        cell(L, y, cw3, 27, fr ? 'Longueur piste' : 'Runway length',
             t.runwayLengthM != null ? `${t.runwayLengthM} m` : '—');
        const surfTxt = t.surfacePct ? `${t.surfaceLabel} +${t.surfacePct} %` : (t.surfaceLabel || '—');
        cell(L + cw3 + 7, y, cw3, 27, fr ? 'Revêtement' : 'Surface', surfTxt,
             { color: t.surfaceSoft ? AMBER : INK, size: surfTxt.length > 13 ? 9 : 10.5 });
        cell(L + 2 * (cw3 + 7), y, cw3, 27, fr ? 'Marge (50 ft)' : 'Margin (50 ft)',
             t.marginM != null ? `${t.marginM >= 0 ? '+' : ''}${t.marginM} m` : '—',
             { color: t.marginM != null ? lvlColor : MUTED, size: 12 });
        y += 33;

        // Barre visuelle marge (reproduction du widget écran) : roulement plein,
        // franchissement 50 ft en teinte claire, sur la piste disponible.
        if (t.runwayLengthM != null && t.runwayLengthM > 0) {
            const BH = 20;
            doc.setFillColor(...CELL_BG); doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
            doc.rect(L, y, W, BH, 'FD');
            const fiftyW = W * Math.min(1, t.fiftyFtM / t.runwayLengthM);
            const rollW = W * Math.min(1, t.groundRollM / t.runwayLengthM);
            doc.setFillColor(...LVL_FILL[lvl]);
            doc.rect(L, y, fiftyW, BH, 'F');
            doc.setFillColor(...lvlColor);
            doc.rect(L, y, rollW, BH, 'F');
            // Petite légende sous la barre (pastilles couleur + échelle).
            doc.setFont('helvetica', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
            let lx = L + 1;
            const legend = [
                [lvlColor, fr ? 'Roulement' : 'Roll'],
                [LVL_FILL[lvl], fr ? 'Franch. 50 ft' : '50 ft'],
                [CELL_BG, fr ? 'Piste disponible' : 'Runway'],
            ];
            for (const [bg, lab] of legend) {
                doc.setFillColor(...bg); doc.setDrawColor(...LINE); doc.setLineWidth(0.4);
                doc.rect(lx, y + BH + 5, 5, 5, 'FD');
    doc.text(lab, lx + 8, y + BH + 9.5);
                lx += 8 + doc.getTextWidth(lab) + 10;
            }
            // Échelle à droite de la légende : longueur totale de piste.
            doc.text(`${t.runwayLengthM} m`, R, y + BH + 9.5, { align: 'right' });
            y += BH + 20;
        } else {
            y += 4;
        }

        // Bandeau d'alerte si la marge est réduite ou critique.
        if (lvl !== 'ok' && t.marginM != null) {
            y = _alertBanner(doc, L, R, W, y, lvl === 'danger', t.message);
        } else {
            y += 2;
        }
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Performances de décollage indisponibles (METAR de départ inaccessible)'
                    : 'Takeoff performance unavailable (no departure METAR)', L + 1.5, y + 6);
        y += 14;
    }

    // ---- Section 2 : profil d'élévation de la route ----
    // (tiret entre les OACI : le glyphe → n'existe pas en WinAnsi)
    const pr = p.profile;
    y = section(fr ? `Profil d'élévation — ${pr?.fromIcao ?? p.fromIcao} - ${pr?.toIcao ?? p.toIcao}`
                   : `Elevation profile — ${pr?.fromIcao ?? p.fromIcao} - ${pr?.toIcao ?? p.toIcao}`, y);
    if (pr?.points?.length) {
        y = _drawElevationChart(doc, pr, L, R, y, fr);
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Profil d\'élévation indisponible (relief Open-Meteo inaccessible)'
                    : 'Elevation profile unavailable (Open-Meteo terrain unavailable)', L + 1.5, y + 6);
        y += 14;
    }

    // ---- Section 3 : alternates viables le long de la route ----
    const al = p.alternates;
    y = section(fr ? `Alternates le long de la route (± ${al?.maxOffsetNm ?? 50} NM)`
                   : `En-route alternates (± ${al?.maxOffsetNm ?? 50} NM)`, y);
    if (al?.rows?.length) {
        // Colonnes : terrain à gauche (code + nom), les autres à droite.
        // Écartées de ~9 pt : « 320° 10G25 kt » (vent) et « ÉCART ROUTE »
        // sont larges en courier 7,5 — des colonnes resserrées se chevauchaient.
        const CX = { cat: 214, visi: 250, ceil: 291, wind: 358, off: R - 5 };
        const HEADS = fr ? ['Terrain', 'Cat.', 'Visi', 'Plafond', 'Vent', 'Écart']
                         : ['Airfield', 'Cat.', 'Vis', 'Ceiling', 'Wind', 'Off rte'];
        doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, MUTED);
        doc.text(HEADS[0].toUpperCase(), L + 1.5, y + 8, { charSpace: 0.4 });
        const cols = [CX.cat, CX.visi, CX.ceil, CX.wind, CX.off];
        for (let i = 1; i < HEADS.length; i++) {
            doc.text(HEADS[i].toUpperCase(), cols[i - 1], y + 8, { align: 'right', charSpace: 0.4 });
        }
        const headBot = y + 11;
        doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
        doc.line(L, headBot, R, headBot);

        const ROW_H = 15;
        al.rows.forEach((r, i) => {
            const base = headBot + i * ROW_H + ROW_H - 4;
            // Code OACI gras + nom tronqué en gris.
            doc.setFont('courier', 'bold'); doc.setFontSize(8); _setInk(doc, INK);
            doc.text(r.code, L + 1.5, base);
            const nameX = L + 1.5 + doc.getTextWidth(r.code) + 5;
            doc.setFont('helvetica', 'normal'); doc.setFontSize(7); _setInk(doc, MUTED);
            doc.text(_trunc(doc, r.name, CX.cat - 8 - nameX), nameX, base);
            // Catégorie colorée (palette écran adaptée au papier).
            doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
            _setInk(doc, CAT_PRINT[r.cat] || MUTED);
            doc.text(r.cat, CX.cat, base, { align: 'right' });
            doc.setFont('courier', 'normal'); doc.setFontSize(7.5); _setInk(doc, INK);
            doc.text(r.visiStr, CX.visi, base, { align: 'right' });
            doc.text(r.ceilStr, CX.ceil, base, { align: 'right' });
            doc.text(r.windStr, CX.wind, base, { align: 'right' });
            doc.setFont('courier', 'bold');
            doc.text(`${r.offsetNm} NM ${r.side}`, CX.off, base, { align: 'right' });
            if (i < al.rows.length - 1) {
                doc.setDrawColor(...BANDL); doc.setLineWidth(0.3);
                doc.line(L, headBot + (i + 1) * ROW_H, R, headBot + (i + 1) * ROW_H);
            }
        });
        y = headBot + al.rows.length * ROW_H + 4;

        doc.setFont('helvetica', 'italic'); doc.setFontSize(7); _setInk(doc, MUTED);
        const note = fr
            ? `Terrains de dérivation à moins de ${al.maxOffsetNm} NM de la route prévue, triés par catégorie de vol puis écart. METAR capturés à la génération du PDF.`
            : `Diversion fields within ${al.maxOffsetNm} NM of the planned route, sorted by flight category then offset. METARs captured when the PDF was generated.`;
        _wrap(doc, note, W - 4).slice(0, 2).forEach((l, i) => doc.text(l, L + 1.5, y + 7 + i * 8.5));
        y += 12;
    } else {
        doc.setFont('helvetica', 'italic'); doc.setFontSize(8); _setInk(doc, MUTED);
        doc.text(fr ? 'Alternates indisponibles (stations ou METAR inaccessibles)'
                    : 'Alternates unavailable (stations or METARs unavailable)', L + 1.5, y + 6);
        y += 14;
    }

    _footer(doc, fr);
}

// ---------------------------------------------------------------------------
// Profil d'élévation redessiné en jsPDF — même langage visuel que le canvas
// elevation-chart.js (aire orangée sous la courbe, ligne de croisière bleue
// pointillée, waypoints ambre, grille + labels ft/km), adapté au papier blanc.
// Retourne l'ordonnée Y après le graphique.
// ---------------------------------------------------------------------------
function _drawElevationChart(doc, pr, L, R, yTopSection, fr) {
    const xL = L + 42, xR = R - 6;
    const yT = yTopSection + 4, CH = 128, yB = yT + CH;
    const plotW = xR - xL;

    // Échelle Y : englobe le terrain + l'altitude de croisière (comme le web).
    let yMin = Math.min(pr.minFt, pr.cruiseAltFt) - 200;
    let yMax = Math.max(pr.maxFt, pr.cruiseAltFt) + 200;
    if (yMax - yMin < 500) yMax = yMin + 500;
    const xOf = f => xL + f * plotW;
    const yOf = e => yT + (1 - (e - yMin) / (yMax - yMin)) * CH;

    // Fond + grille horizontale avec labels (5 lignes).
    doc.setFillColor(...PLOT_BG);
    doc.rect(xL, yT, plotW, CH, 'F');
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5);
    const ySteps = 4;
    for (let i = 0; i <= ySteps; i++) {
        const elev = yMin + (yMax - yMin) * i / ySteps;
        const gy = yT + (1 - i / ySteps) * CH;
        doc.setDrawColor(...BANDL); doc.setLineWidth(0.4);
        doc.line(xL, gy, xR, gy);
        _setInk(doc, MUTED);
        doc.text(`${Math.round(elev)} ft`, xL - 4, gy + 2.2, { align: 'right' });
    }

    // Aire sous la courbe (polygone fermé vers le bas du graphe).
    const pts = pr.points;
    const segs = [[0, yOf(pts[0].elevFt) - yB]];           // montée au 1er point
    for (let i = 1; i < pts.length; i++) {
        const px = xOf(pts[i].frac) - xOf(pts[i - 1].frac);
        const py = yOf(pts[i].elevFt) - yOf(pts[i - 1].elevFt);
        segs.push([px, py]);
    }
    segs.push([0, yB - yOf(pts[pts.length - 1].elevFt)]);  // retour au bas
    doc.setFillColor(...ORANGE_BG);
    doc.lines(segs, xOf(pts[0].frac), yB, [1, 1], 'F', false);

    // Ligne de terrain.
    const lineSegs = segs.slice(1, -1);
    doc.setDrawColor(...ORANGE); doc.setLineWidth(1.4);
    doc.lines(lineSegs, xOf(pts[0].frac), yOf(pts[0].elevFt), [1, 1], 'S', false);

    // Axe X bas + labels distance (km) — bornés dans le graphe pour ne pas
    // déborder du cadre (le 1er/dernier label sont décalés vers l'intérieur).
    doc.setDrawColor(...LINE); doc.setLineWidth(0.5);
    doc.line(xL, yB, xR, yB);
    doc.setFont('courier', 'normal'); doc.setFontSize(6.5); _setInk(doc, MUTED);
    const xSteps = 5;
    for (let i = 0; i <= xSteps; i++) {
        const frac = i / xSteps;
        const lab = `${Math.round(frac * pr.distTotalKm)} km`;
        const w = doc.getTextWidth(lab);
        const lx = Math.max(xL + w / 2 + 1, Math.min(xOf(frac), xR - w / 2 - 1));
        doc.text(lab, lx, yB + 10, { align: 'center' });
    }

    // Waypoints intermédiaires : filet vertical pointillé + pastille + ICAO.
    // Labels OACI (départ/arrivée/waypoints) posés SOUS la ligne de croisière
    // pointillée — posés en haut du graphe ils la chevauchaient (elle est haute
    // quand la croisière domine largement le relief).
    const cruiseDrawn = pr.cruiseAltFt > yMin && pr.cruiseAltFt < yMax;
    const codeY = cruiseDrawn ? Math.min(yOf(pr.cruiseAltFt) + 12, yB - 6) : yT + 9;
    if (pr.waypoints?.length) {
        for (const wp of pr.waypoints) {
            if (wp.frac == null) continue;
            const wx = xOf(wp.frac);
            doc.setDrawColor(...AMBER_LN); doc.setLineWidth(0.8);
            doc.setLineDashPattern([3, 3], 0);
            doc.line(wx, yT, wx, yB);
            doc.setLineDashPattern([], 0);
            doc.setFillColor(...AMBER_LN);
            doc.circle(wx, yT + 3, 2.2, 'F');
            doc.setFont('helvetica', 'bold'); doc.setFontSize(6.5); _setInk(doc, AMBER);
            doc.text(wp.icao, wx, codeY, { align: 'center' });
        }
    }

    // Ligne altitude de croisière (pointillée bleue) + label au-dessus.
    if (cruiseDrawn) {
        const yc = yOf(pr.cruiseAltFt);
        doc.setDrawColor(...BLUE); doc.setLineWidth(1.2);
        doc.setLineDashPattern([6, 4], 0);
        doc.line(xL, yc, xR, yc);
        doc.setLineDashPattern([], 0);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(7); _setInk(doc, BLUE);
        doc.text(`${Math.round(pr.cruiseAltFt)} ft`, xL + 4, yc - 4);
    }

    // Labels départ / arrivée, sous la ligne de croisière (comme les waypoints).
    doc.setFont('courier', 'bold'); doc.setFontSize(7.5); _setInk(doc, INK);
    doc.text(pr.fromIcao, xL + 3, codeY);
    doc.text(pr.toIcao, xR - 3, codeY, { align: 'right' });

    return yB + 16;
}
