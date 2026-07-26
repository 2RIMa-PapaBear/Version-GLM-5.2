import { state, I18N, fetchAvecRelais, memoGet } from './core.js';
import { getAirportByICAO } from './ui-module.js';
import { parseVisiToMeters, getCeiling, CAT_COLORS } from './core.js';

export async function showAlternates(icao) {
    const container = document.getElementById('alternates-container');
    if (!container) return;

    const apt = getAirportByICAO(icao);
    const memo = memoGet(icao);
    const lat = memo?.lat ?? apt?.lat ?? null;
    const lon = memo?.lon ?? apt?.lon ?? null;

    if (lat == null || lon == null) {
        container.style.display = 'none';
        return;
    }

    try {

        const stationsUrl = `https://aviationweather.gov/api/data/stationinfo?bbox=${lat - 3},${lon - 3},${lat + 3},${lon + 3}&format=json&_t=${Date.now()}`;
        const stations = await fetchAvecRelais(stationsUrl, 'json');
        if (!Array.isArray(stations)) { container.style.display = 'none'; return; }

        const nearby = stations
            .map(s => ({
                code: s.icaoId || s.id,
                name: s.site || s.name || '',
                lat: s.lat, lon: s.lon,
                dist: Math.pow(s.lat - lat, 2) + Math.pow(s.lon - lon, 2),
            }))
            .filter(s => s.code && /^[A-Z]{4}$/.test(s.code) && s.code !== icao.toUpperCase())
            .sort((a, b) => a.dist - b.dist)
            .slice(0, 12);

        if (nearby.length === 0) { container.style.display = 'none'; return; }

        const metarUrl = `https://aviationweather.gov/api/data/metar?ids=${nearby.map(s => s.code).join(',')}&format=json&_t=${Date.now()}`;
        const metars = await fetchAvecRelais(metarUrl, 'json');
        if (!Array.isArray(metars)) { container.style.display = 'none'; return; }

        const metarByCode = {};
        metars.forEach(m => {
            const code = (m.icaoId || m.stationId || '').toUpperCase();
            if (code) metarByCode[code] = m.rawOb || m.rawMetar || m.rawText || '';
        });

        const rows = nearby
            .map(s => {
                const raw = metarByCode[s.code.toUpperCase()];
                if (!raw) return null;
                const cat = _categoryFromMetar(raw);
                if (!cat) return null;
                return { ...s, cat, raw };
            })
            .filter(Boolean);

        if (rows.length === 0) { container.style.display = 'none'; return; }

        const catPriority = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };
        rows.sort((a, b) => (catPriority[a.cat.cat] ?? 9) - (catPriority[b.cat.cat] ?? 9) || a.dist - b.dist);

        _render(rows.slice(0, 6), icao);
        container.style.display = 'block';

    } catch (e) {
        console.warn('Alternates load failed:', e);
        container.style.display = 'none';
    }
}

function _render(rows, destIcao) {
    const isFr = state.lang === 'fr';
    const list = document.getElementById('alternates-list');
    if (!list) return;

    const catColors = CAT_COLORS;

    const lblCat = isFr ? 'Cat.' : 'Cat.';
    const lblVisi = isFr ? 'Visi' : 'Visi';
    const lblCeil = isFr ? 'Plafond' : 'Ceiling';
    const lblWind = isFr ? 'Vent' : 'Wind';

    let html = `<div class="alternates-grid">`;
    html += `<div class="alt-header">${isFr ? 'Terrain' : 'Airfield'}</div>`;
    html += `<div class="alt-header">${lblCat}</div>`;
    html += `<div class="alt-header">${lblVisi}</div>`;
    html += `<div class="alt-header">${lblCeil}</div>`;
    html += `<div class="alt-header">${lblWind}</div>`;

    rows.forEach(r => {
        const color = catColors[r.cat.cat];
        const visiM = r.cat.visiM;
        const ceilFt = r.cat.ceilHund === 999 ? null : r.cat.ceilHund * 100;
        const wind = r.cat.wind;

        const visiStr = visiM >= 10000 ? '>10km' : `${visiM}m`;
        const ceilStr = ceilFt !== null ? `${ceilFt}ft` : (isFr ? '∞' : '∞');
        const windStr = wind ? `${wind.dir === null ? 'VRB' : String(wind.dir).padStart(3, '0') + '°'} ${wind.speed}${wind.gust ? 'G' + wind.gust : ''}` : '—';

        html += `
            <div class="alt-cell alt-cell-name" title="${escapeHtml(r.name)}" data-icao="${escapeHtml(r.code)}">
                <span class="alt-code">${escapeHtml(r.code)}</span>
                <span class="alt-name">${escapeHtml(r.name)}</span>
            </div>
            <div class="alt-cell" style="color:${color}; font-weight:800;">${r.cat.cat}</div>
            <div class="alt-cell" style="${visiM < 5000 ? 'color:#FCA5A5;' : ''}">${visiStr}</div>
            <div class="alt-cell" style="${ceilFt !== null && ceilFt < 1500 ? 'color:#FCA5A5;' : ''}">${ceilStr}</div>
            <div class="alt-cell">${windStr}</div>
        `;
    });
    html += `</div>`;

    html += `<div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.5;">
        <i data-lucide="info" style="width:13px;height:13px;vertical-align:middle;"></i>
        ${isFr
            ? `Alternates viables autour de <strong>${escapeHtml(destIcao)}</strong>, triés par viabilité (catégorie de vol puis proximité). Cliquez un terrain pour le charger.`
            : `Viable alternates around <strong>${escapeHtml(destIcao)}</strong>, sorted by flight category then proximity. Click a field to load it.`}
    </div>`;

    list.innerHTML = html;
    if (window.lucide) window.lucide.createIcons({ root: list });

    list.querySelectorAll('.alt-cell-name').forEach(cell => {
        cell.style.cursor = 'pointer';
        cell.addEventListener('click', () => {
            const targetIcao = cell.dataset.icao;
            if (targetIcao) {
                document.getElementById('icaoInput').value = targetIcao;
                document.getElementById('btn-fetch-metar').click();
            }
        });
    });
}

function _categoryFromMetar(raw) {
    const visiMatch = raw.match(/KT(?:\s+\d{3}V\d{3})?\s+(\d{4})\b/);
    const visiM = visiMatch ? (parseInt(visiMatch[1], 10) === 9999 ? 10000 : parseInt(visiMatch[1], 10)) : parseVisiToMeters('');

    let ceilHund = 999;
    const cloudMatches = [...raw.matchAll(/\b(BKN|OVC)(\d{3})/g)];
    cloudMatches.forEach(m => {
        const alt = parseInt(m[2], 10);
        if (alt < ceilHund) ceilHund = alt;
    });
    const vvMatch = raw.match(/\bVV(\d{3})\b/);
    if (vvMatch) ceilHund = parseInt(vvMatch[1], 10);
    if (/CAVOK|NSC|SKC|NCD/.test(raw)) ceilHund = 999;

    const windMatch = raw.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?KT\b/);
    const wind = windMatch ? {
        variable: windMatch[1] === 'VRB',
        dir: windMatch[1] === 'VRB' ? null : parseInt(windMatch[1], 10),
        speed: parseInt(windMatch[2], 10),
        gust: windMatch[3] ? parseInt(windMatch[3], 10) : null,
    } : null;

    let cat;
    if (ceilHund < 5 || visiM < 1600) cat = 'LIFR';
    else if (ceilHund < 10 || visiM < 4800) cat = 'IFR';
    else if (ceilHund <= 30 || visiM <= 8000) cat = 'MVFR';
    else cat = 'VFR';

    return { cat, visiM, ceilHund, wind };
}

function escapeHtml(text) {
    const el = document.createElement('div');
    el.textContent = String(text || '');
    return el.innerHTML;
}
