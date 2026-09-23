// Contrôle géométrique B7 — carte de vol imprimable (maquette LFRV-LFOO).
// Vérifie, sans jugement esthétique (Read n'affiche pas les images) :
//   1. le CONTENU du PDF (textes jsPDF non compressés : titre, codes,
//      échelle, légende, FRÉQUENCES des zones 22/09) ;
//   2. les PIXELS du PNG rendu à 2 px/pt (apercu_carte_vol.png) contre
//      les positions ATTENDUES lues dans le méta jeté par la maquette
//      (test/apercu_flight_map_meta.json — mêmes bornes/alternates que
//      le tracé, convention app « plan + alternates visibles ») :
//      marqueurs LFRV/LFOO, route échantillonnée, couleurs des familles
//      de zones, rose nord, dégagement LFRD, richesse du fond tuilé,
//      repli blanc de la variante sans fond.
// Usage : node test/check-flight-map-pdf.mjs   (après gen-apercu + _pdf2png-cdp)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { PAGE, mapArea, computeMapBounds, pickTileZoom, lonToPx, latToPx }
    = await import(pathToFileURLFix(path.join(root, 'js', 'flight-map-pdf.js')));
function pathToFileURLFix(p) { return 'file:///' + p.replace(/\\/g, '/').replace(/ /g, '%20'); }

let failures = 0;
const ok = (m) => console.log('OK  ' + m);
const ko = (m) => { failures++; console.log('KO  ' + m); };

// ---------- 1. contenu PDF ----------
const pdfMain = fs.readFileSync(path.join(root, 'Apercu_Carte_vol_LFRV-LFOO.pdf'), 'latin1');
const pdfAlt = fs.readFileSync(path.join(root, 'Apercu_Carte_vol_LFRV-LFOO_sans-fond.pdf'), 'latin1');
const pdfLoc = fs.readFileSync(path.join(root, 'Apercu_Carte_vol_local-LFRV.pdf'), 'latin1');
for (const [name, raw, wantTiles] of [
    ['avec fond', pdfMain, true],
    ['sans fond', pdfAlt, false],
]) {
    if (raw.includes('CARTE DE VOL')) ok(`${name} : titre`); else ko(`${name} : titre absent`);
    for (const t of ['LFRV', 'LFOO', 'LFRD', 'dégagement']) {
        if (raw.includes(t)) ok(`${name} : texte « ${t} »`); else ko(`${name} : « ${t} » absent`);
    }
    if (/1:\d[\d ]{3,}/.test(raw)) ok(`${name} : échelle numérique`);
    else ko(`${name} : échelle numérique introuvable`);
    // La maquette embarque les tuiles en PNG (FlateDecode) — le JPEG
    // (DCTDecode) n'apparaît qu'avec la recomposition canvas de l app.
    const imgCount = (raw.match(/\/Subtype \/Image/g) || []).length;
    if (wantTiles && imgCount >= 20) ok(`${name} : ${imgCount} images tuiles embarquées`);
    else if (wantTiles) ko(`${name} : ${imgCount} images seulement (tuiles attendues)`);
    if (!wantTiles && imgCount === 0) ok(`${name} : aucune image (repli vectoriel)`);
    if (!wantTiles && imgCount > 0) ko(`${name} : ${imgCount} images inattendues`);
    if (raw.includes('OpenTopoMap') === wantTiles) ok(`${name} : mention fond cohérente`);
    if (!wantTiles && raw.includes('indisponible')) ok('sans fond : mention repli');
    if (!wantTiles && !raw.includes('indisponible')) ko('sans fond : mention repli absente');
}

// Fréquences des zones SIV/CTR/TMA/CTA (22/09) : un bouquet complet sur
// LFRV-LFOO (TWR pour CTR, APP pour TMA, INFO pour SIV), et JAMAIS de
// fréquence « Sol » ni d'UHF militaire.
{
    const labels = [...pdfMain.matchAll(/\((\d{3}\.\d{3}(?: [A-ZÉÈ .-]+)?)\) Tj/g)].map((m) => m[1]);
    if (labels.length >= 20) ok(`fréquences posées : ${labels.length} étiquettes`);
    else ko(`fréquences : ${labels.length} seulement (< 20)`);
    for (const t of ['RENNES APP', 'LORIENT TWR', 'RENNES INFO', 'LA ROCHELLE INFO']) {
        if (pdfMain.includes(t)) ok(`fréquence « ${t} » posée`);
        else ko(`fréquence « ${t} » absente`);
    }
    for (const [bad, why] of [['121.730', 'fréquence Sol'], ['281.550', 'UHF'], ['231.875', 'UHF']]) {
        if (pdfMain.includes(bad)) ko(`${why} ${bad} présente !`);
        else ok(`aucune ${why} (${bad})`);
    }
    if (pdfLoc.includes('LORIENT TWR')) ok('vol local : fréquence LORIENT TWR posée');
    else ko('vol local : fréquence absente');
}

// Fréquences A/A-AFIS des terrains du plan (retour pilote 22/09) :
// ligne « 122.605 AFIS » sous le code du terrain, A/A seule quand
// c'est la seule (LFOO), rien pour les terrains sans service.
{
    for (const [t, pdf] of [
        ['122.605 AFIS', pdfMain],      // LFRV départ (A/A identique : une ligne)
        ['123.355 A/A', pdfMain],       // LFOO arrivée
        ['119.605 AFIS', pdfMain],      // LFEQ alternate
        ['122.605 AFIS', pdfLoc],       // LFRV vol local
    ]) {
        if (pdf.includes(t)) ok(`terrain « ${t} » posé`);
        else ko(`terrain « ${t} » absent`);
    }
    if (pdfMain.includes('121.405 AFIS')) ok('terrain LFRE « 121.405 AFIS » posé');
    else ko('terrain LFRE absent');
}

// ---------- 2. positions attendues (mêmes bornes que le tracé) ----------
// La maquette écrit test/apercu_flight_map_meta.json — la convention est
// celle de l'app : l'emprise couvre la route ET les alternates (+15 %).
const meta = JSON.parse(fs.readFileSync(path.join(root, 'test', 'apercu_flight_map_meta.json'), 'utf8'));
const LFRV = meta.route[0], LFOO = meta.route[meta.route.length - 1];
const LFRD = meta.alternates.find((a) => a.code === 'LFRD');
const route = [LFRV, LFOO];
const b = meta.bounds;
const z = pickTileZoom(b);
const map = mapArea();
const bx0 = lonToPx(b.minLon, z), bx1 = lonToPx(b.maxLon, z);
const by0 = latToPx(b.maxLat, z), by1 = latToPx(b.minLat, z);
const s = Math.min(map.w / (bx1 - bx0), map.h / (by1 - by0));
const ox = map.x + (map.w - (bx1 - bx0) * s) / 2 - bx0 * s;
const oy = map.y + (map.h - (by1 - by0) * s) / 2 - by0 * s;
const toPt = (lat, lon) => [ox + lonToPx(lon, z) * s, oy + latToPx(lat, z) * s];

// ---------- décodeur PNG (colorType 6/2, depth 8) ----------
function readPng(file) {
    const buf = fs.readFileSync(file);
    if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('pas un PNG');
    let pos = 8, w = 0, h = 0, colorType = 6;
    const idat = [];
    while (pos < buf.length) {
        const len = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + len);
        if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); colorType = data[9]; }
        if (type === 'IDAT') idat.push(data);
        pos += 12 + len;
    }
    const bpp = colorType === 6 ? 4 : 3;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const stride = w * bpp;
    const px = Buffer.alloc(h * stride);
    for (let y = 0; y < h; y++) {
        const f = raw[y * (stride + 1)];
        const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
        const prev = y ? px.subarray((y - 1) * stride, y * stride) : null;
        const cur = px.subarray(y * stride, (y + 1) * stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= bpp ? cur[x - bpp] : 0, bb = prev ? prev[x] : 0, c = (x >= bpp && prev) ? prev[x - bpp] : 0;
            let v = line[x];
            if (f === 1) v += a; else if (f === 2) v += bb; else if (f === 3) v += (a + bb) >> 1;
            else if (f === 4) {
                const p = a + bb - c, pa = Math.abs(p - a), pb = Math.abs(p - bb), pc = Math.abs(p - c);
                v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? bb : c);
            }
            cur[x] = v & 255;
        }
    }
    return { w, h, bpp, px, get: (x, y) => {
        x = Math.max(0, Math.min(w - 1, Math.round(x))); y = Math.max(0, Math.min(h - 1, Math.round(y)));
        const i = y * stride + x * bpp;
        return [px[i], px[i + 1], px[i + 2]];
    } };
}

const near = (p, ref, tol) => Math.abs(p[0] - ref[0]) <= tol && Math.abs(p[1] - ref[1]) <= tol && Math.abs(p[2] - ref[2]) <= tol;
const S = 2;   // PNG rendu à 2 px / pt

function scanWindow(img, cx, cy, rad, ref, tol) {
    for (let y = cy - rad; y <= cy + rad; y++) {
        for (let x = cx - rad; x <= cx + rad; x++) {
            if (x < 0 || y < 0 || x >= img.w || y >= img.h) continue;
            if (near(img.get(x, y), ref, tol)) return true;
        }
    }
    return false;
}

const ROUTE_BLUE = [3, 105, 161];
const INK = [17, 24, 39];
const AMBER = [180, 83, 9];
const CTRL_BLUE = [37, 99, 235];
const RED = [220, 38, 38];

const img = readPng(path.join(root, 'test', 'apercu_carte_vol.png'));
if (img.w === 1191 && img.h === 840) ok(`PNG ${img.w}x${img.h} (2 px/pt)`); else ko(`PNG ${img.w}x${img.h}, attendu 1191x840`);

// Marqueurs dép/arrivée : disque bleu route.
for (const [code, p] of [['LFRV', LFRV], ['LFOO', LFOO]]) {
    const [x, y] = toPt(p.lat, p.lon);
    if (scanWindow(img, x * S, y * S, 10, ROUTE_BLUE, 55)) ok(`marqueur ${code} à la position attendue`);
    else ko(`marqueur ${code} introuvable à (${(x * S).toFixed(0)},${(y * S).toFixed(0)})`);
}

// Route : 15 échantillons, au moins 13 doivent croiser le bleu route (±4 px).
{
    const a = toPt(LFRV.lat, LFRV.lon), c = toPt(LFOO.lat, LFOO.lon);
    let hits = 0;
    for (let i = 1; i <= 15; i++) {
        const t = i / 16;
        const x = (a[0] + (c[0] - a[0]) * t) * S, y = (a[1] + (c[1] - a[1]) * t) * S;
        if (scanWindow(img, x, y, 5, ROUTE_BLUE, 55)) hits++;
    }
    if (hits >= 13) ok(`route tracée (${hits}/15 échantillons bleus)`);
    else ko(`route : ${hits}/15 échantillons seulement`);
}

// Couleurs des familles de zones présentes dans la zone carte.
{
    const mx = map.x * S, my = map.y * S, mw = map.w * S, mh = map.h * S;
    const count = (ref, tol) => {
        let n = 0;
        for (let y = my; y < my + mh; y += 4) for (let x = mx; x < mx + mw; x += 4) {
            if (near(img.get(x, y), ref, tol)) n++;
        }
        return n;
    };
    for (const [name, ref, min] of [
        ['zones contrôlées (bleu)', CTRL_BLUE, 25],
        ['zones R/P/D (rouge)', RED, 15],
        ['ambre (ATZ / dégagement)', AMBER, 15],
    ]) {
        const n = count(ref, 45);
        if (n >= min) ok(`${name} : ${n} px`); else ko(`${name} : ${n} px (< ${min})`);
    }

    // Fond tuilé : richesse chromatique (relief OpenTopoMap).
    const colors = new Set();
    for (let i = 0; i < 400; i++) {
        const x = mx + Math.random() * mw, y = my + Math.random() * mh;
        const p = img.get(x, y);
        colors.add((p[0] >> 3) + ',' + (p[1] >> 3) + ',' + (p[2] >> 3));
    }
    if (colors.size > 40) ok(`fond tuilé riche (${colors.size} couleurs quantifiées / 400 pts)`);
    else ko(`fond pauvre : ${colors.size} couleurs — tuiles absentes ?`);
}

// Rose nord (coin haut droit de la zone carte).
{
    const nx = (map.x + map.w - 16) * S, ny = (map.y + 7) * S;
    if (scanWindow(img, nx, ny + 10 * S, 26, INK, 60)) ok('rose nord présente');
    else ko('rose nord introuvable');
}

// Dégagement LFRD Dinard : losange ambre à sa position projetée, RABATTU
// au bord le plus proche s'il sort de la zone carte (formule du tracé —
// avec les alternates dans l'emprise, convention app, il est en général
// à l'intérieur ; le clamp reste vérifié par les tests unitaires).
{
    const [rx, ry] = toPt(LFRD.lat, LFRD.lon);
    const expX = Math.min(Math.max(rx, map.x + 8), map.x + map.w - 8) * S;
    const expY = Math.min(Math.max(ry, map.y + 8), map.y + map.h - 8) * S;
    if (scanWindow(img, expX, expY, 24, AMBER, 55)) ok('dégagement LFRD à sa position attendue');
    else ko(`dégagement LFRD introuvable ((${expX.toFixed(0)},${expY.toFixed(0)}))`);
}

// Variante sans fond : la zone carte reste claire (repli blanc).
{
    const img2 = readPng(path.join(root, 'test', 'apercu_carte_vol_sans-fond.png'));
    const cx = (map.x + map.w / 2) * S, cy = (map.y + map.h / 2) * S;
    let light = 0, n = 0;
    for (let i = 0; i < 200; i++) {
        const p = img2.get(cx + (Math.random() - 0.5) * map.w * S * 0.8, cy + (Math.random() - 0.5) * map.h * S * 0.8);
        if (p[0] > 200 && p[1] > 200) light++;
        n++;
    }
    if (light / n > 0.55) ok(`repli blanc (${Math.round((light / n) * 100)} % de pixels clairs au centre)`);
    else ko(`repli : seulement ${Math.round((light / n) * 100)} % clairs`);
}

console.log(failures ? `${failures} ÉCHEC(S)` : 'TOUT OK');
process.exit(failures ? 1 : 0);
