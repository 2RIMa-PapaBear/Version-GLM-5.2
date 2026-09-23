// Tests B7 — carte de vol imprimable : projection Web Mercator, emprise
// (marge/plancher/ratio page), choix de zoom et couverture des tuiles,
// rendu de la page A5 paysage avec le VRAI jsPDF (sans DOM), sémantiques
// de repli (fond indisponible) et anti-collision des étiquettes.
import test from 'node:test';
import { ok, equal } from 'node:assert/strict';
globalThis.self = globalThis;
globalThis.window = globalThis;
const jspdfMod = await import('../vendor/jspdf.umd.min.js');
const jsPDF = jspdfMod.default?.jsPDF || globalThis.jspdf?.jsPDF;
const {
    lonToPx, latToPx, groundMPerPx,
    computeMapBounds, pickTileZoom, tileRangeFor, safeTileRange,
    mapArea, drawFlightMapPage,
} = await import('../js/flight-map-pdf.js');

// 1×1 gris — JPEG minimal (DCTDecode embarqué tel quel par jsPDF, plus
// fiable qu'un PNG 1 px pour un test de débit).
const JPEG1 = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/2gAMAwEAAhEDEQA/AKgA/9k=';

const LFRV = { lat: 47.7192, lon: -2.7233, code: 'LFRV', name: 'Vannes Golfe du Morbihan', role: 'dep' };
const LFOO = { lat: 46.9360, lon: -1.7890, code: 'LFOO', name: 'Les Sables-d Olonne Talmont', role: 'dest' };

test('projection Mercator : origine, sens, résolution au sol', () => {
    equal(Math.round(lonToPx(-180, 0)), 0);
    equal(Math.round(lonToPx(0, 0)), 128);
    ok(lonToPx(179.999, 0) < 256);
    equal(Math.round(latToPx(0, 0)), 128);
    // y croît vers le sud (Mercator) : latitude plus haute = y plus petit.
    ok(latToPx(50, 5) < latToPx(40, 5));
    // Équateur z0 : 156 543 m/px (tuile 360°/256 px, rayon Web Mercator).
    ok(Math.abs(groundMPerPx(0, 0) - 156543.03) < 1);
    ok(groundMPerPx(60, 0) < groundMPerPx(0, 0));   // cos(latitude)
});

test('computeMapBounds : contient les points, marge, plancher 30 NM, ratio page', () => {
    const b = computeMapBounds([LFRV, LFOO]);
    ok(b.minLat < LFOO.lat && b.maxLat > LFRV.lat);
    ok(b.minLon < LFRV.lon && b.maxLon > LFOO.lon);
    // Marge de 15 % de chaque côté de la plus grande dimension.
    const spanLat = (b.maxLat - b.minLat) * 60;
    const spanLon = (b.maxLon - b.minLon) * 60 * Math.cos(47.3 * Math.PI / 180);
    ok(spanLat > 60 * (LFRV.lat - LFOO.lat) * 1.29);
    ok(spanLon > 60 * Math.abs(LFOO.lon - LFRV.lon) * Math.cos(47.3 * Math.PI / 180) * 1.29);

    // Point unique (vol local) : plancher de 30 NM de span.
    const b1 = computeMapBounds([LFRV]);
    const s1 = (b1.maxLat - b1.minLat) * 60;
    ok(s1 >= 30 - 0.1);

    // Extension de la dimension courte au ratio de la zone utile : la
    // carte remplira la page au lieu de s'y letter-boxer.
    const ar = mapArea().w / mapArea().h;
    const b2 = computeMapBounds([LFRV, LFOO], [], { aspect: ar });
    const w2 = (b2.maxLon - b2.minLon) * 60 * Math.cos(47.3 * Math.PI / 180);
    const h2 = (b2.maxLat - b2.minLat) * 60;
    ok(Math.abs(w2 / h2 - ar) < 0.03, `ratio ${w2 / h2} vs ${ar}`);

    // Sans point : null (l appelant saute la page).
    equal(computeMapBounds([]), null);
});

test('zoom tuile : borné pour l impression A5, tuiles couvrant l emprise', () => {
    const b = computeMapBounds([LFRV, LFOO], [], { aspect: mapArea().w / mapArea().h });
    const z = pickTileZoom(b);
    ok(z >= 6 && z <= 12, `z=${z}`);
    const wpx = lonToPx(b.maxLon, z) - lonToPx(b.minLon, z);
    ok(wpx <= 3800, `largeur px ${wpx} déraisonnable`);

    const r = tileRangeFor(b, z);
    // Chaque coin de l emprise tombe DANS la grille (bornes incluses).
    ok(Math.floor(lonToPx(b.minLon, z) / 256) >= r.x0);
    ok(Math.floor(lonToPx(b.maxLon, z) / 256) <= r.x0 + r.nx - 1);
    ok(Math.floor(latToPx(b.maxLat, z) / 256) >= r.y0);
    ok(Math.floor(latToPx(b.minLat, z) / 256) <= r.y0 + r.ny - 1);

    // Garde-fou burst : la France entière doit dézoomer sous 48 tuiles.
    const big = { minLat: 42, maxLat: 51, minLon: -5, maxLon: 8 };
    const rs = safeTileRange(big, pickTileZoom(big));
    ok(rs.nx * rs.ny <= 48, `${rs.nx}x${rs.ny} tuiles`);
});

test('drawFlightMapPage : page ajoutée, contenus rendus, images embarquées', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    const b = computeMapBounds([LFRV, LFOO], [{ lat: 47.35, lon: -2.2 }], { aspect: mapArea().w / mapArea().h });
    const z = pickTileZoom(b);
    const r = safeTileRange(b, z);
    const images = [];
    for (let ix = 0; ix < r.nx; ix++) for (let iy = 0; iy < r.ny; iy++) images.push({ ix, iy, data: JPEG1, fmt: 'JPEG' });
    const zone = {
        // À l OUEST de la route, loin de l étiquette LFRV (une zone centrée
        // sur le terrain de départ verrait son étiquette refusée par
        // l anti-collision — c est le comportement voulu).
        rings: [[[47.6, -3.3], [47.6, -2.9], [47.25, -2.9], [47.25, -3.3]]],
        color: [220, 38, 38], fill: [220, 38, 38], label: 'D-TEST', sub: 'SFC - FL115',
    };
    const okDraw = drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO · dégagement LFRD',
        generatedLabel: 'lun. 15/09/2026 21:00',
        bounds: b,
        tiles: { z, grid: { x0: r.x0, y0: r.y0, nx: r.nx, ny: r.ny, images } },
        route: [LFRV, LFOO],
        alternates: [{ lat: 47.35, lon: -2.2, code: 'LFRD' }, { lat: 47.2, lon: -1.4, code: 'LFRQ', diversion: true }],
        zones: [zone],
        legend: [{ label: 'Zones R · P · D', color: [220, 38, 38] }],
    });
    equal(okDraw, true);
    equal(doc.getNumberOfPages(), n0 + 1);
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('CARTE DE VOL'));
    ok(raw.includes('LFRV'));
    ok(raw.includes('LFOO'));
    ok(raw.includes('LFRQ'));
    ok(raw.includes('D-TEST'));
    ok(raw.includes('SFC - FL115'));
    ok(raw.includes('DCTDecode'), 'tuiles JPEG embarquées');
    ok(raw.includes('Dégagement') || raw.includes('dégagement'), 'mention dégagement');
    // jsPDF déduplique les images identiques : 35 tuiles identiques = 1
    // seul XObject embarqué (~300 o) — le PDF reste petit.
    ok(doc.output('arraybuffer').byteLength > 6000);
});

test('fréquences A/A-AFIS des terrains : ligne posée sous le code (22/09)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b, tiles: null,
        route: [
            { ...LFRV, freq: '122.605 AFIS' },
            { ...LFOO, freq: '123.355 A/A' },
        ],
        alternates: [{ lat: 47.35, lon: -2.2, code: 'LFEQ', freq: '119.605 AFIS' }],
        zones: [],
    });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('122.605 AFIS'), 'AFIS du départ posé');
    ok(raw.includes('123.355 A/A'), 'A/A de l arrivée posée');
    ok(raw.includes('119.605 AFIS'), 'AFIS de l alternate posé');
});

test('repli vectoriel : sans tuiles, la carte reste tracée et le mentionne', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    ok(drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b, tiles: null,
        route: [LFRV, LFOO], zones: [], alternates: [],
    }));
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('indisponible'), 'mention fond indisponible');
    ok(!raw.includes('DCTDecode'));
});

test('fond recomposé en image unique (mode single)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    ok(drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b,
        tiles: { z: pickTileZoom(b), single: { data: JPEG1, fmt: 'JPEG' } },
        route: [LFRV, LFOO], zones: [], alternates: [],
    }));
    ok(Buffer.from(doc.output('arraybuffer')).toString('latin1').includes('DCTDecode'));
});

test('étiquettes de zones : anti-collision (la 2e zone au même endroit n est pas étiquetée)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    const ring = [[[47.45, -2.86], [47.45, -2.56], [47.15, -2.56], [47.15, -2.86]]];
    drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b, tiles: null,
        route: [LFRV, LFOO], alternates: [],
        zones: [
            { rings: ring, color: [220, 38, 38], fill: [220, 38, 38], label: 'ZZA', sub: 'SFC - FL115' },
            { rings: ring, color: [37, 99, 235], fill: [37, 99, 235], label: 'ZZB', sub: 'SFC - FL115' },
        ],
    });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('ZZA'));
    ok(!raw.includes('ZZB'), 'ZZB chevauche ZZA : étiquette refusée');
});

test('étiquette 3 lignes : la fréquence est posée sous les bornes (22/09)', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    const ring = [[[47.6, -3.3], [47.6, -2.9], [47.25, -2.9], [47.25, -3.3]]];
    drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b, tiles: null,
        route: [LFRV, LFOO], alternates: [],
        zones: [{
            rings: ring, color: [37, 99, 235], fill: [37, 99, 235],
            label: 'CTR QUIMPER', sub: 'SFC - 1500 ft', kind: 'CTR',
            freq: '118.625 QUIMPER TWR',
        }],
    });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('CTR QUIMPER'));
    ok(raw.includes('SFC - 1500 ft'));
    ok(raw.includes('118.625 QUIMPER TWR'), '3e ligne fréquence présente');
});

test('étiquette avec fréquence : position de REPLI quand le centre est pris', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const b = computeMapBounds([LFRV, LFOO]);
    // Deux zones SUPERPOSÉES pourvues de fréquence : la 2e ne peut pas
    // prendre le centre (réservation 3 lignes de la 1re) — elle doit
    // trouver un décalage de repli au lieu de disparaître. Les deux
    // fréquences finissent dans le PDF.
    const ring = [[[47.45, -2.86], [47.45, -2.56], [47.15, -2.56], [47.15, -2.86]]];
    drawFlightMapPage(doc, {
        isFr: true, routeLabel: 'LFRV - LFOO', bounds: b, tiles: null,
        route: [LFRV, LFOO], alternates: [],
        zones: [
            { rings: ring, color: [37, 99, 235], fill: [37, 99, 235], label: 'TMA ZFA', sub: '2500 - FL115', kind: 'TMA', freq: '134.200 RENNES APP' },
            { rings: ring, color: [37, 99, 235], fill: [37, 99, 235], label: 'CTR ZFB', sub: 'SFC - 1500 ft', kind: 'CTR', freq: '118.625 QUIMPER TWR' },
        ],
    });
    const raw = Buffer.from(doc.output('arraybuffer')).toString('latin1');
    ok(raw.includes('TMA ZFA') && raw.includes('134.200 RENNES APP'));
    ok(raw.includes('CTR ZFB') && raw.includes('118.625 QUIMPER TWR'),
        'la 2e zone a trouvé une position de repli : fréquence visible');
});

test('garde-fou : sans emprise, aucune page ajoutée', () => {
    const doc = new jsPDF({ unit: 'pt', format: 'a5' });
    const n0 = doc.getNumberOfPages();
    equal(drawFlightMapPage(doc, { bounds: null }), false);
    equal(doc.getNumberOfPages(), n0);
});
