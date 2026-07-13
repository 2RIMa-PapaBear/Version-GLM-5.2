/* ================================================================
 * BRIEFING PDF — Génération d'un briefing météo imprimable
 * ================================================================
 *
 * OBJECTIF
 * --------
 * Produire un document PDF récapitulatif du briefing météo pré-vol,
 * tel qu'exigé par la majorité des aéroclubs et des instructeurs.
 * Le pilote peut l'imprimer, l'archiver, le signer et l'envoyer à
 * son instructeur ou au club avant le vol.
 *
 * Le PDF contient :
 *  - En-tête : terrain, date/heure de génération, type de message.
 *  - Message brut (METAR/TAF) en monospace.
 *  - Catégorie de vol (VFR/MVFR/IFR/LIFR) avec code couleur.
 *  - Vent, visibilité, plafond, QNH, température.
 *  - Meilleure piste suggérée (composante traversière).
 *  - Alertes minimas VFR actives.
 *  - Créneau de vol jour (lever/coucher civil) si disponible.
 *  - Pied de page : avertissement + source.
 *
 * DÉPENDANCE
 * ----------
 * jsPDF (vendor/jspdf.umd.min.js), chargé globalement (window.jspdf).
 * ================================================================ */

import { state, I18N, memoGet, parseVisiToMeters, getCeiling } from './core.js';
import { parseWindString, selectBestRunway } from './engine.js';
import { getThresholds, analyzeWeatherAlerts, analyzeForecastAlerts } from './weather.js';
import { getAirportByICAO } from './ui-module.js';

// Palette de couleurs par catégorie de vol (valeurs RGB pour jsPDF).
const CAT_COLORS = {
    VFR:  { r: 74,  g: 222, b: 128 },
    MVFR: { r: 56,  g: 189, b: 248 },
    IFR:  { r: 248, g: 113, b: 113 },
    LIFR: { r: 217, g: 70,  b: 239 },
};

/**
 * Convertit une heure UTC en chaîne lisible "JJ/MM/AAAA HH:MM Z".
 */
function formatUTC(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Z`;
}

/**
 * Génère et télécharge (ou ouvre) le PDF du briefing météo.
 * Utilise les données actuellement affichées dans le dashboard.
 */
export function generateBriefingPDF() {
    const tr = I18N[state.lang] || {};
    const isFr = state.lang === 'fr';

    // jsPDF est chargé via <script> UMD → window.jspdf.jsPDF.
    const { jsPDF } = window.jspdf;
    if (!jsPDF) {
        console.error('jsPDF non chargé');
        return;
    }

    const raw = document.getElementById('tafInput')?.value?.trim() || '';
    const parsed = state.lastParsed;

    if (!raw || !parsed) {
        // Pas de données : on génère quand même un PDF avec un message d'absence.
        _generateEmptyPDF(jsPDF, isFr);
        return;
    }

    const icao = parsed.code || '----';
    const apt = getAirportByICAO(state.requestedIcao || icao);
    const memo = memoGet(icao);
    const airportName = apt?.name || memo?.name || icao;
    const now = new Date();
    const isMetar = parsed.isMetar;

    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297;           // Dimensions A4 en mm.
    const M = 15;                         // Marge.
    let y = M;

    // ---- En-tête ----
    doc.setFillColor(2, 6, 23);
    doc.rect(0, 0, PW, 28, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(isFr ? 'BRIEFING MÉTÉO PRÉ-VOL' : 'PRE-FLIGHT WEATHER BRIEFING', M, 13);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(56, 189, 248);
    doc.text(`METAR / TAF Visualizer`, M, 19);
    doc.setTextColor(180, 180, 180);
    doc.setFontSize(8);
    doc.text(isFr ? 'Généré le' : 'Generated', PW - M, 13, { align: 'right' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.text(formatUTC(now), PW - M, 18, { align: 'right' });
    y = 34;

    // ---- Terrain ----
    doc.setTextColor(40, 40, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`${airportName} (${icao})`, M, y);
    y += 7;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    doc.setTextColor(100, 100, 100);
    const typeLabel = isMetar ? (isFr ? 'METAR / SPECI (observation)' : 'METAR / SPECI (observation)') : (isFr ? 'TAF (prévision)' : 'TAF (forecast)');
    doc.text(`${isFr ? 'Type' : 'Type'}: ${typeLabel}`, M, y);
    if (parsed.validity) {
        y += 5;
        doc.text(`${isFr ? 'Validité' : 'Validity'}: ${parsed.validity}`, M, y);
    }
    y += 8;

    // ---- Ligne séparatrice ----
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, PW - M, y);
    y += 7;

    // ---- Catégorie de vol (gros bloc coloré) ----
    const visiStr = parsed.base?.visi?.[0]?.val;
    const nuageStr = parsed.base?.nuage?.[0]?.val;
    const visiM = parseVisiToMeters(visiStr || '');
    const ceilHund = getCeiling(nuageStr || '');
    const catObj = _getCategory(visiM, ceilHund);

    const catColors = CAT_COLORS[catObj.cat] || CAT_COLORS.VFR;
    doc.setFillColor(catColors.r, catColors.g, catColors.b);
    doc.roundedRect(M, y, PW - 2 * M, 16, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(catObj.cat, M + 6, y + 11);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text(isFr ? 'Catégorie de vol' : 'Flight category', M + 6 + 22, y + 11);
    y += 22;

    // ---- Tableau des valeurs clés ----
    const windStr = parsed.base?.vent?.[0]?.val;
    const wind = windStr ? parseWindString(windStr) : null;
    const qnhStr = parsed.base?.qnh?.[0]?.val || '';
    const tempStr = parsed.base?.temp?.[0]?.val || '';
    const ceilFt = ceilHund === 999 ? null : ceilHund * 100;

    const rows = [
        [isFr ? 'Vent' : 'Wind', wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3, '0') + '°'} ${wind.speed}${wind.gust ? 'G' + wind.gust : ''} KT` : '—'],
        [isFr ? 'Visibilité' : 'Visibility', visiStr ? (visiM >= 10000 ? '> 10 km' : `${visiM} m`) : '—'],
        [isFr ? 'Plafond' : 'Ceiling', ceilFt !== null ? `${ceilFt} ft` : (isFr ? 'Illimité' : 'Unlimited')],
        [isFr ? 'QNH' : 'QNH', qnhStr || '—'],
        [isFr ? 'Température' : 'Temperature', tempStr || '—'],
    ];

    // Meilleure piste si disponible.
    if (apt && apt.runways && wind) {
        const rwyData = selectBestRunway(apt.runways, wind);
        if (rwyData.active) {
            const xw = wind.speed * Math.sin((wind.dir - rwyData.active.hdg) * Math.PI / 180);
            rows.push([isFr ? 'Piste active' : 'Active runway', `${rwyData.active.name} — ${isFr ? 'travers' : 'crosswind'}: ${Math.abs(xw).toFixed(0)} KT`]);
        }
    }

    y = _drawKeyValueTable(doc, rows, M, y, PW - 2 * M);

    // ---- Alertes minimas VFR ----
    let alerts = [];
    if (isMetar) alerts = analyzeWeatherAlerts(raw);
    else {
        const targetH = state.manualTargetHour === null
            ? (now.getUTCHours() + now.getUTCMinutes() / 60)
            : state.manualTargetHour;
        alerts = analyzeForecastAlerts(parsed, targetH);
    }

    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text(isFr ? 'Alertes minimas VFR' : 'VFR minima alerts', M, y);
    y += 5;

    if (alerts.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(9);
        doc.setTextColor(16, 185, 129);
        doc.text(isFr ? '✓ Conditions VFR OK — aucune alerte' : '✓ VFR conditions OK — no alerts', M, y);
        y += 6;
    } else {
        alerts.forEach(alert => {
            const isDanger = alert.level === 'danger';
            doc.setFillColor(isDanger ? 254 : 245, isDanger ? 226 : 158, isDanger ? 226 : 11);
            doc.roundedRect(M, y - 4, PW - 2 * M, 7, 1, 1, 'F');
            doc.setTextColor(isDanger ? 127 : 120, isDanger ? 29 : 53, isDanger ? 29 : 0);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9);
            let label = alert.title;
            if (alert.value !== null && alert.category !== 'phenomenon') {
                const unit = alert.category === 'ceiling' ? ' ft' : (alert.category === 'visibility' ? ' m' : (alert.category === 'wind' || alert.category === 'gusts' ? ' kt' : ''));
                label = `${alert.title}: ${alert.value}${unit}`;
            }
            doc.text(`⚠ ${label}`, M + 3, y);
            y += 8;
        });
    }

    y += 4;

    // ---- Créneau de vol jour (si météo + position disponibles) ----
    if (typeof SunCalc !== 'undefined' && memo && memo.lat != null) {
        y = _drawDaylightWindow(doc, memo.lat, memo.lon, isFr, M, y, PW);
    }

    // ---- Message brut ----
    if (y > PH - 70) { doc.addPage(); y = M; }
    y += 4;
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, PW - M, y);
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(40, 40, 40);
    doc.text(isFr ? 'Message brut' : 'Raw message', M, y);
    y += 5;

    doc.setFont('courier', 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(60, 60, 60);
    const rawLines = doc.splitTextToSize(raw, PW - 2 * M);
    // Fond gris léger pour le bloc.
    const rawBlockH = rawLines.length * 4.2 + 4;
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(M, y - 3, PW - 2 * M, rawBlockH, 1, 1, 'F');
    doc.text(rawLines, M + 3, y + 2);
    y += rawBlockH + 6;

    // ---- Pied de page (sur chaque page) ----
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(220, 220, 220);
        doc.line(M, PH - 14, PW - M, PH - 14);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(150, 150, 150);
        doc.text(isFr ? 'Document généré à titre indicatif. Ne pas utiliser pour la préparation des vols.' : 'Informational document only. Do not use for flight preparation.', M, PH - 9);
        doc.text(`${isFr ? 'Source' : 'Source'}: AviationWeather.gov`, PW - M, PH - 9, { align: 'right' });
        doc.text(`${i}/${pageCount}`, PW / 2, PH - 9, { align: 'center' });
    }

    // ---- Sauvegarde ----
    const dateStr = `${now.getUTCFullYear()}${String(now.getUTCMonth() + 1).padStart(2, '0')}${String(now.getUTCDate()).padStart(2, '0')}`;
    doc.save(`Briefing_${icao}_${dateStr}.pdf`);
}

/**
 * Détermine la catégorie de vol (reflet de core.getFlightCategory).
 * Dupliqué ici pour garder le module briefing autonome et éviter une
 * dépendance circulaire.
 */
function _getCategory(visiM, ceilHund) {
    if (ceilHund < 5 || visiM < 1600) return { cat: 'LIFR' };
    if (ceilHund < 10 || visiM < 4800) return { cat: 'IFR' };
    if (ceilHund <= 30 || visiM <= 8000) return { cat: 'MVFR' };
    return { cat: 'VFR' };
}

/**
 * Dessine un tableau clé/valeur à deux colonnes.
 * @returns {number} La nouvelle position Y.
 */
function _drawKeyValueTable(doc, rows, x, y, width) {
    const colW = width / 2;
    const rowH = 7;

    // En-tête du tableau.
    doc.setFillColor(240, 242, 245);
    doc.rect(x, y, width, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    const isFr = state.lang === 'fr';
    doc.text(isFr ? 'Paramètre' : 'Parameter', x + 3, y + 5);
    doc.text(isFr ? 'Valeur' : 'Value', x + colW + 3, y + 5);
    y += rowH;

    // Lignes.
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    rows.forEach((row, i) => {
        if (i % 2 === 1) {
            doc.setFillColor(248, 250, 252);
            doc.rect(x, y, width, rowH, 'F');
        }
        doc.setTextColor(100, 100, 100);
        doc.text(String(row[0]), x + 3, y + 5);
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'bold');
        doc.text(String(row[1]), x + colW + 3, y + 5);
        doc.setFont('helvetica', 'normal');
        y += rowH;
    });

    // Bordure.
    doc.setDrawColor(220, 220, 220);
    doc.rect(x, y - rows.length * rowH - rowH, width, (rows.length + 1) * rowH);
    doc.line(x + colW, y - rows.length * rowH - rowH, x + colW, y);

    return y + 4;
}

/**
 * Dessine le créneau de vol jour (lever/coucher civil) si SunCalc est dispo.
 */
function _drawDaylightWindow(doc, lat, lon, isFr, x, y, PW) {
    const M = 15;
    const now = new Date();
    const times = SunCalc.getTimes(now, lat, lon);

    if (!times.sunrise || !times.sunset) return y;

    // Heures aéronautiques : lever -30min / coucher +30min.
    const aeroStart = new Date(times.sunrise.getTime() - 30 * 60000);
    const aeroEnd = new Date(times.sunset.getTime() + 30 * 60000);

    const fmt = (d) => {
        const pad = (n) => String(n).padStart(2, '0');
        return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Z`;
    };

    // Vérifie si on est actuellement en fenêtre de vol.
    const inWindow = now >= aeroStart && now <= aeroEnd;
    const afterSunset = now > aeroEnd;

    let windowLabel;
    let windowColor;
    if (afterSunset) {
        windowLabel = isFr ? '⚠ NUIT AÉRONAUTIQUE — vol VFR de jour non autorisé' : '⚠ AERONAUTICAL NIGHT — day VFR not permitted';
        windowColor = [239, 68, 68];
    } else if (inWindow) {
        const remaining = Math.round((aeroEnd - now) / 60000);
        const hLeft = Math.floor(remaining / 60);
        const mLeft = remaining % 60;
        windowLabel = isFr ? `Fenêtre de vol OUVERTE — ${hLeft}h${String(mLeft).padStart(2, '0')} restantes avant la nuit` : `Flight window OPEN — ${hLeft}h${String(mLeft).padStart(2, '0')} before night`;
        windowColor = [16, 185, 129];
    } else {
        windowLabel = isFr ? `Fenêtre de vol pas encore ouverte (ouvre à ${fmt(aeroStart)})` : `Flight window not yet open (opens at ${fmt(aeroStart)})`;
        windowColor = [245, 158, 11];
    }

    doc.setFillColor(windowColor[0], windowColor[1], windowColor[2]);
    doc.roundedRect(x, y, PW - 2 * M, 10, 1.5, 1.5, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(windowLabel, x + 4, y + 6.5);
    y += 14;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(80, 80, 80);
    doc.text(isFr ? `Lever civil: ${fmt(times.sunrise)}   |   Coucher civil: ${fmt(times.sunset)}` : `Civil sunrise: ${fmt(times.sunrise)}   |   Civil sunset: ${fmt(times.sunset)}`, x, y);
    y += 4;
    doc.setTextColor(120, 120, 120);
    doc.setFontSize(8);
    doc.text(isFr ? `Heures aéronautiques: ${fmt(aeroStart)} — ${fmt(aeroEnd)}` : `Aeronautical hours: ${fmt(aeroStart)} — ${fmt(aeroEnd)}`, x, y);

    return y + 6;
}

/**
 * Génère un PDF minimal quand aucune donnée météo n'est chargée.
 */
function _generateEmptyPDF(jsPDF, isFr) {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text(isFr ? 'Briefing météo — aucune donnée' : 'Weather briefing — no data', 15, 25);
    doc.setFontSize(11);
    doc.text(isFr ? 'Veuillez charger un METAR ou TAF avant de générer le briefing.' : 'Please load a METAR or TAF before generating the briefing.', 15, 40);
    doc.save('Briefing_vide.pdf');
}
