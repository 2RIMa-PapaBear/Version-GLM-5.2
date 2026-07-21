/* ================================================================
 * BRIEFING PDF — Briefing météo pré-vol (jsPDF + captures)
 * ================================================================
 *
 * Sections :
 *  - En-tête, terrain, catégorie de vol
 *  - Fréquences, tableau valeurs clés
 *  - Alertes, créneau jour
 *  - Graphique METAR/TAF (capture canvas)
 *  - Message brut
 *  - Rose des vents départ (SVG → PNG)
 *  - Page 2 (Navigation) : graphique TAF dest, navigation,
 *    fréquences dest, rose des vents dest, profil élévation
 *
 * DÉPENDANCES : jsPDF (vendor), html2canvas (CDN pour le canvas).
 * ================================================================ */

import { state, I18N, memoGet, parseVisiToMeters, getCeiling } from './core.js';
import { parseWindString, selectBestRunway, renderWindCompass } from './engine.js';
import { analyzeWeatherAlerts, analyzeForecastAlerts } from './weather.js';
import { getAirportByICAO } from './ui-module.js';
import { computeFlightPlan, getDefaultAircraftPerf } from './flight-planner.js';

const CAT_COLORS = {
    VFR:  { r: 74,  g: 222, b: 128 },
    MVFR: { r: 56,  g: 189, b: 248 },
    IFR:  { r: 248, g: 113, b: 113 },
    LIFR: { r: 217, g: 70,  b: 239 },
};

function formatUTC(d) {
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())} Z`;
}

function _ensureSpace(doc, y, needed, PH, M) {
    if (y + needed > PH - 18) { doc.addPage(); return M; }
    return y;
}

function _sectionTitle(doc, text, x, y) {
    doc.setFillColor(56, 189, 248);
    doc.rect(x, y - 3, 3, 5, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(text, x + 5, y + 1);
    return y + 7;
}

function _getCategory(visiM, ceilHund) {
    if (ceilHund < 5 || visiM < 1600) return { cat: 'LIFR' };
    if (ceilHund < 10 || visiM < 4800) return { cat: 'IFR' };
    if (ceilHund <= 30 || visiM <= 8000) return { cat: 'MVFR' };
    return { cat: 'VFR' };
}

function _drawKeyValueTable(doc, rows, x, y, width) {
    const colW = width / 2;
    const rowH = 6.5;
    doc.setFillColor(240, 242, 245);
    doc.rect(x, y, width, rowH, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 100, 100);
    const isFr = state.lang === 'fr';
    doc.text(isFr ? 'Paramètre' : 'Parameter', x + 3, y + 4.5);
    doc.text(isFr ? 'Valeur' : 'Value', x + colW + 3, y + 4.5);
    y += rowH;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    rows.forEach((row, i) => {
        if (i % 2 === 1) { doc.setFillColor(248, 250, 252); doc.rect(x, y, width, rowH, 'F'); }
        doc.setTextColor(100, 100, 100);
        doc.text(String(row[0]), x + 3, y + 4.5);
        doc.setTextColor(30, 30, 30);
        doc.setFont('helvetica', 'bold');
        doc.text(String(row[1]), x + colW + 3, y + 4.5);
        doc.setFont('helvetica', 'normal');
        y += rowH;
    });
    doc.setDrawColor(220, 220, 220);
    doc.rect(x, y - rows.length * rowH - rowH, width, (rows.length + 1) * rowH);
    doc.line(x + colW, y - rows.length * rowH - rowH, x + colW, y);
    return y + 3;
}

function _drawDaylightWindow(doc, lat, lon, isFr, x, y, PW) {
    const M = 10;
    if (typeof SunCalc === 'undefined') return y;
    const now = new Date();
    const times = SunCalc.getTimes(now, lat, lon);
    if (!times.sunrise || !times.sunset) return y;
    const aeroStart = new Date(times.sunrise.getTime() - 30 * 60000);
    const aeroEnd = new Date(times.sunset.getTime() + 30 * 60000);
    const fmt = (d) => `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')} Z`;
    const inWindow = now >= aeroStart && now <= aeroEnd;
    const afterSunset = now > aeroEnd;
    let label, color;
    if (afterSunset) { label = isFr ? '⚠ NUITS AÉRO' : '⚠ AERO NIGHT'; color = [239, 68, 68]; }
    else if (inWindow) { label = isFr ? `Ouvert — ${Math.floor((aeroEnd-now)/60000/60)}h${String(Math.round((aeroEnd-now)/60000%60)).padStart(2,'0')} restantes` : `Open`; color = [16, 185, 129]; }
    else { label = isFr ? `Fermé (ouvre ${fmt(aeroStart)})` : `Closed`; color = [245, 158, 11]; }
    doc.setFillColor(...color);
    doc.roundedRect(x, y, PW - 2 * M, 8, 1, 1, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(label, x + 3, y + 5.5);
    y += 12;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(80, 80, 80);
    doc.text(isFr ? `Lever ${fmt(times.sunrise)} | Coucher ${fmt(times.sunset)}` : `Sunrise ${fmt(times.sunrise)} | Sunset ${fmt(times.sunset)}`, x, y);
    return y + 5;
}

function _drawFrequencies(doc, icao, isFr, x, y, width) {
    const apt = getAirportByICAO(icao);
    if (!apt?.frequencies?.length) return y;
    y = _sectionTitle(doc, isFr ? `Fréquences — ${icao}` : `Frequencies — ${icao}`, x, y);
    const colW = width / 2;
    const rowH = 5;
    let col = 0, rowY = y;
    apt.frequencies.slice(0, 8).forEach(f => {
        const fx = x + (col % 2) * colW;
        doc.setFont('courier', 'bold');
        doc.setFontSize(9);
        doc.setTextColor(30, 30, 30);
        doc.text(f.freq.toFixed(3), fx + 2, rowY + 3.5);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 100, 100);
        doc.text(`${f.type || ''} ${f.name || ''}`.trim().slice(0, 20), fx + 20, rowY + 3.5);
        col++;
        if (col % 2 === 0) rowY += rowH;
    });
    return rowY + (col % 2 === 0 ? 3 : rowH + 3);
}

/**
 * Capture la rose des vents en PNG via SVG.
 */
function _captureCompass(windStr, runways, apt) {
    return new Promise((resolve) => {
        if (!windStr || !runways) { resolve(null); return; }
        const tmpId = '_pdf-cmp-' + Date.now();
        const tmp = document.createElement('div');
        tmp.id = tmpId;
        tmp.style.cssText = 'position:absolute; left:-9999px; top:0; width:300px; background:#0F172A; padding:10px;';
        document.body.appendChild(tmp);
        try { renderWindCompass(tmpId, windStr, runways, null, apt); } catch { tmp.remove(); resolve(null); return; }
        const svg = tmp.querySelector('svg');
        if (!svg) { tmp.remove(); resolve(null); return; }
        // Nettoie filtres + convertit CSS transform en attribut SVG.
        svg.querySelectorAll('filter').forEach(f => f.remove());
        svg.querySelectorAll('[filter]').forEach(el => el.removeAttribute('filter'));
        svg.querySelectorAll('[stroke^="url(#"]').forEach(el => el.setAttribute('stroke', '#FB923C'));
        svg.querySelectorAll('.wind-arrow').forEach(g => {
            const dir = g.getAttribute('data-wind-dir');
            const cx = g.getAttribute('data-cx');
            const cy = g.getAttribute('data-cy');
            if (dir && cx && cy) { g.setAttribute('transform', `rotate(${dir} ${cx} ${cy})`); g.removeAttribute('style'); }
        });
        svg.setAttribute('width', '280');
        svg.setAttribute('height', '310');
        const svgStr = '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(svg);
        const dataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 560; canvas.height = 620;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, 560, 620);
            ctx.drawImage(img, 0, 0, 560, 620);
            tmp.remove();
            try { resolve(canvas.toDataURL('image/png')); } catch { resolve(null); }
        };
        img.onerror = () => { tmp.remove(); resolve(null); };
        img.src = dataUrl;
    });
}

/**
 * Capture le canvas du graphique en PNG.
 */
function _captureChartCanvas() {
    const canvas = document.getElementById('tafCanvas');
    if (!canvas || canvas.width === 0) return null;
    try { return canvas.toDataURL('image/png'); } catch { return null; }
}

// ----------------------------------------------------------------
// Fonction principale
// ----------------------------------------------------------------

export async function generateBriefingPDF() {
    const isFr = state.lang === 'fr';
    const { jsPDF } = window.jspdf;
    if (!jsPDF) { console.error('jsPDF non chargé'); return; }

    const raw = document.getElementById('tafInput')?.value?.trim() || '';
    const parsed = state.lastParsed;
    if (!raw || !parsed) { _emptyPDF(jsPDF, isFr); return; }

    const icao = parsed.code || '----';
    const apt = getAirportByICAO(state.requestedIcao || icao);
    const memo = memoGet(icao);
    const airportName = apt?.name || memo?.name || icao;
    const now = new Date();
    const isMetar = parsed.isMetar;
    const toInput = document.getElementById('route-to-input');
    const destIcao = toInput ? toInput.value.trim().toUpperCase() : '';
    const isNavMode = document.body.classList.contains('mode-nav') && destIcao && /^[A-Z]{4}$/.test(destIcao);

    // Pré-calcule la navigation si mode nav.
    let navPlan = null;
    if (isNavMode) {
        const perf = getDefaultAircraftPerf();
        const cruiseInput = document.getElementById('fp-cruise-alt');
        const cruiseFt = cruiseInput ? parseInt(cruiseInput.value, 10) : 2500;
        navPlan = await computeFlightPlan(state.requestedIcao, destIcao, {
            cruiseAltFt: cruiseFt, tasKt: perf.tasKt, fuelBurnLph: perf.fuelBurnLph, isNight: false,
        }).catch(() => null);
    }

    // Capture les graphiques et roses des vents AVANT le rendu PDF.
    const chartDepPng = _captureChartCanvas();
    const windStrDep = parsed.base?.vent?.[0]?.val;
    const compassDepPng = (windStrDep && apt?.runways) ? await _captureCompass(windStrDep, apt.runways, apt) : null;
    let compassDestPng = null;
    if (isNavMode) {
        const destApt = getAirportByICAO(destIcao);
        const destWind = state.lastParsed?.base?.vent?.[0]?.val;
        if (destApt?.runways && destWind) compassDestPng = await _captureCompass(destWind, destApt.runways, destApt);
    }

    // ---- Rendu PDF ----
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const PW = 210, PH = 297, M = 10;
    let y = M;

    // En-tête.
    doc.setFillColor(2, 6, 23);
    doc.rect(0, 0, PW, 20, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(15);
    doc.text(isFr ? 'BRIEFING MÉTÉO PRÉ-VOL' : 'PRE-FLIGHT BRIEFING', M, 9);
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(56, 189, 248);
    doc.text('METAR / TAF Visualizer', M, 14);
    doc.setTextColor(180, 180, 180);
    doc.text(isFr ? 'Généré le' : 'Generated', PW - M, 9, { align: 'right' });
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.text(formatUTC(now), PW - M, 14, { align: 'right' });
    y = 26;

    // Terrain.
    doc.setTextColor(40, 40, 40);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(12);
    doc.text(`${airportName} (${icao})`, M, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(100, 100, 100);
    doc.text(`${isMetar ? 'METAR' : 'TAF'}${parsed.validity ? ' | ' + parsed.validity : ''}`, M, y);
    y += 6;

    // Catégorie de vol.
    const visiStr = parsed.base?.visi?.[0]?.val;
    const nuageStr = parsed.base?.nuage?.[0]?.val;
    const visiM = parseVisiToMeters(visiStr || '');
    const ceilHund = getCeiling(nuageStr || '');
    const catObj = _getCategory(visiM, ceilHund);
    const catC = CAT_COLORS[catObj.cat] || CAT_COLORS.VFR;
    doc.setFillColor(catC.r, catC.g, catC.b);
    doc.roundedRect(M, y, PW - 2 * M, 14, 2, 2, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(20);
    doc.text(catObj.cat, M + 5, y + 10);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text(isFr ? 'Catégorie de vol' : 'Flight category', M + 28, y + 10);
    y += 20;

    // Fréquences.
    y = _drawFrequencies(doc, state.requestedIcao || icao, isFr, M, y, PW - 2 * M);

    // Tableau valeurs clés.
    const windStr = parsed.base?.vent?.[0]?.val;
    const wind = windStr ? parseWindString(windStr) : null;
    const qnhStr = parsed.base?.qnh?.[0]?.val || '';
    const tempStr = parsed.base?.temp?.[0]?.val || '';
    const ceilFt = ceilHund === 999 ? null : ceilHund * 100;
    const rows = [
        [isFr ? 'Vent' : 'Wind', wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3,'0')+'°'} ${wind.speed}${wind.gust?'G'+wind.gust:''} KT` : '—'],
        [isFr ? 'Visi' : 'Visi', visiStr ? (visiM >= 10000 ? '>10km' : visiM+'m') : '—'],
        [isFr ? 'Plafond' : 'Ceiling', ceilFt !== null ? ceilFt+' ft' : (isFr?'Illimité':'Unl')],
        [isFr ? 'QNH' : 'QNH', qnhStr || '—'],
        [isFr ? 'Temp' : 'Temp', tempStr || '—'],
    ];
    if (apt?.runways && wind) {
        const rwy = selectBestRunway(apt.runways, wind);
        if (rwy.active) rows.push([isFr?'Piste':'Rwy', `${rwy.active.name} travers ${Math.abs(wind.speed*Math.sin((wind.dir-rwy.active.hdg)*Math.PI/180)).toFixed(0)}KT`]);
    }
    y = _drawKeyValueTable(doc, rows, M, y, PW - 2 * M);

    // Alertes.
    let alerts = isMetar ? analyzeWeatherAlerts(raw) : analyzeForecastAlerts(parsed, state.manualTargetHour ?? (now.getUTCHours()+now.getUTCMinutes()/60));
    y += 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(isFr ? 'Alertes minima VFR' : 'VFR minima alerts', M, y);
    y += 4;
    if (alerts.length === 0) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(16, 185, 129);
        doc.text(isFr ? '✓ Conditions VFR OK' : '✓ VFR OK', M, y);
        y += 5;
    } else {
        alerts.forEach(a => {
            y = _ensureSpace(doc, y, 8, PH, M);
            const d = a.level === 'danger';
            doc.setFillColor(d?254:245, d?226:158, d?226:11);
            doc.roundedRect(M, y-3, PW-2*M, 6, 1, 1, 'F');
            doc.setTextColor(d?127:120, d?29:53, d?29:0);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.text(`⚠ ${a.title}${a.value!=null && a.category!=='phenomenon' ? ': '+a.value+(a.category==='ceiling'?' ft':a.category==='visibility'?' m':' kt') : ''}`, M+2, y+1);
            y += 7;
        });
    }
    y += 3;

    // Créneau jour.
    if (typeof SunCalc !== 'undefined' && memo?.lat != null) {
        y = _drawDaylightWindow(doc, memo.lat, memo.lon, isFr, M, y, PW);
    }

    // Graphique METAR.
    if (chartDepPng) {
        y = _sectionTitle(doc, isFr ? 'Graphique METAR' : 'METAR chart', M, y);
        const c = document.getElementById('tafCanvas');
        const cw = c?.width || 800, ch = c?.height || 300;
        const imgW = PW - 2 * M;
        const imgH = imgW * ch / cw;
        y = _ensureSpace(doc, y, imgH + 2, PH, M);
        doc.setFillColor(2, 6, 23);
        doc.roundedRect(M, y, imgW, imgH, 2, 2, 'F');
        doc.addImage(chartDepPng, 'PNG', M+1, y+1, imgW-2, imgH-2);
        y += imgH + 5;
    }

    // Message brut.
    y = _ensureSpace(doc, y, 30, PH, M);
    doc.setDrawColor(220, 220, 220);
    doc.line(M, y, PW-M, y);
    y += 5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(40, 40, 40);
    doc.text(isFr ? 'Message brut' : 'Raw message', M, y);
    y += 4;
    doc.setFont('courier', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(60, 60, 60);
    const rawLines = doc.splitTextToSize(raw, PW - 2*M);
    const rawH = rawLines.length * 3.8 + 3;
    y = _ensureSpace(doc, y, rawH, PH, M);
    doc.setFillColor(245, 247, 250);
    doc.roundedRect(M, y-2, PW-2*M, rawH, 1, 1, 'F');
    doc.text(rawLines, M+2, y+1);
    y += rawH + 5;

    // Rose des vents départ.
    if (compassDepPng) {
        y = _ensureSpace(doc, y, 55, PH, M);
        y = _sectionTitle(doc, isFr ? 'Rose des vents — départ' : 'Wind compass — departure', M, y);
        doc.setFillColor(15, 23, 42);
        doc.roundedRect(M, y, 55, 55, 2, 2, 'F');
        doc.addImage(compassDepPng, 'PNG', M+1, y+1, 53, 53);
        y += 58;
    }

    // ---- Page 2 : Navigation ----
    if (isNavMode && navPlan) {
        doc.addPage();
        y = M;

        // Calcul de navigation.
        y = _sectionTitle(doc, isFr ? 'Calcul de navigation' : 'Flight plan', M, y);
        const navRows = [
            [isFr?'Route':'Route', `${navPlan.from.icao} → ${navPlan.to.icao}`],
            [isFr?'Distance':'Distance', `${navPlan.distanceNm} NM (${navPlan.distanceKm} km)`],
            [isFr?'Cap vrai':'True hdg', `${navPlan.trueCourse}°`],
            [isFr?'Cap mag.':'Mag hdg', `${navPlan.magHeading}°`],
            [isFr?'Vent':'Wind', navPlan.wind ? `${navPlan.wind.dir}° ${navPlan.wind.speed}KT` : '—'],
            [isFr?'Vsol':'GS', `${Math.round(navPlan.groundSpeed)}KT`],
            [isFr?'Temps':'ETE', navPlan.legTimeMin>=60 ? `${Math.floor(navPlan.legTimeMin/60)}h${String(navPlan.legTimeMin%60).padStart(2,'0')}` : `${navPlan.legTimeMin}min`],
            [isFr?'Carburant':'Fuel', `${navPlan.fuel.tripFuelL}+${navPlan.fuel.reserveL}=${navPlan.fuel.totalL}L`],
        ];
        y = _drawKeyValueTable(doc, navRows, M, y, PW - 2*M);

        // Fréquences destination.
        y = _ensureSpace(doc, y, 20, PH, M);
        y = _drawFrequencies(doc, destIcao, isFr, M, y, PW - 2*M);

        // Rose des vents destination.
        if (compassDestPng) {
            y = _ensureSpace(doc, y, 55, PH, M);
            y = _sectionTitle(doc, isFr ? 'Rose des vents — destination' : 'Wind compass — destination', M, y);
            doc.setFillColor(15, 23, 42);
            doc.roundedRect(M, y, 55, 55, 2, 2, 'F');
            doc.addImage(compassDestPng, 'PNG', M+1, y+1, 53, 53);
            y += 58;
        }

        // Profil d'élévation.
        if (navPlan.elevationProfile?.points?.length) {
            y = _ensureSpace(doc, y, 50, PH, M);
            y = _sectionTitle(doc, isFr ? "Profil d'élévation" : 'Elevation profile', M, y);
            y = _drawElevationSimple(doc, navPlan.elevationProfile, navPlan.cruiseAltFt, navPlan.from.icao, navPlan.to.icao, M, y, PW - 2*M, 45);
        }
    }

    // Pied de page.
    const pageCount = doc.internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        doc.setDrawColor(220, 220, 220);
        doc.line(M, PH-8, PW-M, PH-8);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(6);
        doc.setTextColor(150, 150, 150);
        doc.text(isFr ? 'Document indicatif. Source : AviationWeather.gov' : 'Informational. Source: AviationWeather.gov', M, PH-4);
        doc.text(`${i}/${pageCount}`, PW/2, PH-4, { align: 'center' });
    }

    // Sauvegarde.
    const fileDate = `${now.getUTCFullYear()}${String(now.getUTCMonth()+1).padStart(2,'0')}${String(now.getUTCDate()).padStart(2,'0')}`;
    doc.save(`Briefing_${icao}_${fileDate}.pdf`);
}

/**
 * Profil d'élévation simple en vectoriel jsPDF.
 */
function _drawElevationSimple(doc, profile, cruiseFt, fromIcao, toIcao, x, y, w, h) {
    const pts = profile.points;
    const padL = 22, padR = 6, padT = 4, padB = 10;
    const plotW = w - padL - padR, plotH = h - padT - padB;
    let yMin = Math.min(profile.minFt, cruiseFt) - 200;
    let yMax = Math.max(profile.maxFt, cruiseFt) + 200;
    if (yMax - yMin < 500) yMax = yMin + 500;
    const xOf = f => x + padL + f * plotW;
    const yOf = e => y + padT + (1 - (e - yMin) / (yMax - yMin)) * plotH;
    // Fond.
    doc.setFillColor(245, 247, 250);
    doc.rect(x + padL, y + padT, plotW, plotH, 'F');
    // Barres terrain.
    const barW = Math.max(0.5, plotW / pts.length);
    pts.forEach(p => {
        doc.setFillColor(251, 146, 60);
        doc.rect(xOf(p.frac) - barW/2, yOf(p.elevFt), barW, y + padT + plotH - yOf(p.elevFt), 'F');
    });
    // Ligne croisière.
    if (cruiseFt > yMin && cruiseFt < yMax) {
        const yc = yOf(cruiseFt);
        doc.setDrawColor(56, 189, 248);
        doc.setLineWidth(0.4);
        for (let dx = 0; dx < plotW; dx += 3) doc.line(x+padL+dx, yc, x+padL+dx+1.5, yc);
        doc.setTextColor(56, 189, 248);
        doc.setFontSize(6);
        doc.text(cruiseFt + 'ft', x+padL+1, yc-1);
    }
    // Labels.
    doc.setTextColor(100, 100, 100);
    doc.setFontSize(6);
    doc.setFont('helvetica', 'bold');
    doc.text(fromIcao, x+padL+1, y+padT+3);
    doc.text(toIcao, x+padL+plotW-1, y+padT+3, { align: 'right' });
    doc.setLineWidth(0.2);
    return y + h + 3;
}

function _emptyPDF(jsPDF, isFr) {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text(isFr ? 'Briefing — aucune donnée' : 'Briefing — no data', 15, 20);
    doc.setFontSize(10);
    doc.text(isFr ? 'Chargez un METAR ou TAF.' : 'Load a METAR or TAF.', 15, 35);
    doc.save('Briefing_vide.pdf');
}
