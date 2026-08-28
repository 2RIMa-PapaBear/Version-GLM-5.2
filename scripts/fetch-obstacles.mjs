#!/usr/bin/env node
// ============================================================================
// FETCH OBSTACLES — base OFFICIELLE SIA (export AIXM « Obstacles Model »).
//
//   node scripts/fetch-obstacles.mjs [--xml="chemin/AIXM4.5_all_FR_OM_<date>.xml"]
//
// Source : produit « export_xml_bd_SIA » du SIA (téléchargement manuel à
// chaque cycle AIRAC, même page que XML_SIA). Structure documentée par la FAQ
// SIA (Data_Catalogue/Obstacles.XLSX, tableau A1-6) :
//   <Obs> <ObsUid mid> (geoLat/geoLong en degrés-minutes-secondes)
//         txtName (numéro officiel), txtDescrType (« Pylône », « Eolienne(s) »…),
//         codeLgt Y/N (balisage lumineux), codeGroup Y/N,
//         valElev (altitude du SOMMET, ft), valHgt (hauteur sol, ft).
// 13 800 obstacles France — hauteur ET altitude toujours renseignées, balisage
// lumineux inclus (ce qu'openAIP ne fournit pas).
//
// Sans --xml : prend le AIXM4.5_all_FR_OM_*.xml le plus récent du dossier
// « telechargement AIRAC/ ». La date AIRAC du fichier est reportée dans
// data/obstacles.json (pied de page/traçabilité).
//
// Catégories (constantes partagées avec js/radio-points.js — 21 types SIA
// regroupés en 6 familles d'icônes, le type EXACT restant dans le popup) :
//   0 EOLIENNE      Eolienne(s)
//   1 ANTENNE       Pylône, Mât, Antenne, Treillis métallique, Portique, Câble
//   2 CHEMINEE      Cheminée, Torchère, Centrale thermique
//   3 CHATEAU_D_EAU Château d'eau, Silo
//   4 BATIMENT      Bâtiment, Tour, Eglise, Phare marin, Pile de pont, Grue
//   5 AUTRE         Autre, Terril, Derrick
//
// Format de sortie (compact, ~700 Ko) :
//   { generatedAt, airac, source: 'SIA', counts,
//     obstacles: [[cat, lat, lon, hFt, elevFt, lgt(0|1), name, type], …] }
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'data', 'obstacles.json');

// -- Fichier source : --xml=… ou le plus récent du dossier de téléchargement --
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));
let xmlPath = args.xml;
if (!xmlPath) {
    const dir = path.join(ROOT, 'telechargement AIRAC');
    const cands = fs.existsSync(dir)
        ? fs.readdirSync(dir).filter(f => /^AIXM4\.5_all_FR_OM_.*\.xml$/i.test(f)).sort()
        : [];
    if (!cands.length) {
        console.error('Aucun AIXM4.5_all_FR_OM_*.xml — passez --xml=<fichier> ou posez-le dans « telechargement AIRAC/ ».');
        process.exit(1);
    }
    xmlPath = path.join(dir, cands.at(-1));
}
console.log(`Source : ${path.basename(xmlPath)}`);
const xml = fs.readFileSync(xmlPath, 'utf8');

const airac = (xml.match(/effDate="(\d{4}-\d{2}-\d{2})"/) || [])[1]
    || (path.basename(xmlPath).match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || '';

/** DMS SIA (« 482936.00N » / « 0015526.00W ») → degrés décimaux.
 *  Partie entière de longueur fixe : latitude 2+2+2 chiffres, longitude
 *  3+2+2 ; les décimales appartiennent aux secondes. */
function dmsToDeg(v) {
    const m = String(v).trim().match(/^(\d+)(?:\.(\d+))?\s*([NSEW])$/i);
    if (!m) return null;
    const hemi = m[3].toUpperCase();
    const dLen = /[NS]/.test(hemi) ? 2 : 3;
    if (m[1].length !== dLen + 4) return null;
    const deg = +m[1].slice(0, dLen);
    const min = +m[1].slice(dLen, dLen + 2);
    const sec = +(m[1].slice(dLen + 2) + '.' + (m[2] || '0'));
    const d = deg + min / 60 + sec / 3600;
    return /[SW]/.test(hemi) ? -d : d;
}

const TYPE_TO_CAT = [
    [/^eolienne/i, 0],
    [/pyl|^mâ|^mat|antenne|treillis|portique|câble|cable/i, 1],
    [/chemin|torch|thermique/i, 2],
    [/château|chateau|silo/i, 3],
    [/bâtiment|batiment|tour|église|eglise|phare|pile de pont|grue/i, 4],
    // tout le reste (Autre, Terril, Derrick…) → 5
];

const obstacles = [];
const byCat = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
const byType = {};
let skip = 0;
const r5 = (v) => Math.round(v * 1e5) / 1e5;
for (const [, body] of xml.matchAll(/<Obs>([\s\S]*?)<\/Obs>/g)) {
    const g = (tag) => (body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() ?? null;
    const lat = dmsToDeg(g('geoLat'));
    const lon = dmsToDeg(g('geoLong'));
    if (lat == null || lon == null) { skip++; continue; }
    const type = g('txtDescrType') || 'Autre';
    let cat = 5;
    for (const [re, c] of TYPE_TO_CAT) if (re.test(type)) { cat = c; break; }
    const hFt = parseFloat(g('valHgt'));
    const elevFt = parseFloat(g('valElev'));
    obstacles.push([
        cat, r5(lat), r5(lon),
        Number.isFinite(hFt) ? Math.round(hFt) : null,
        Number.isFinite(elevFt) ? Math.round(elevFt) : null,
        g('codeLgt') === 'Y' ? 1 : 0,
        (g('txtName') || '').slice(0, 12) || null,
        type.slice(0, 24),
    ]);
    byCat[cat]++;
    byType[type] = (byType[type] ?? 0) + 1;
}

const out = {
    generatedAt: new Date().toISOString(),
    airac: airac || null,
    source: 'SIA',
    counts: { total: obstacles.length, byCat, skipped: skip },
    obstacles,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out));
const kb = (fs.statSync(OUT).size / 1024).toFixed(0);
console.log(`OK : ${OUT} (${kb} Ko) — ${obstacles.length} obstacles SIA (AIRAC ${airac || '?'}, ${skip} rejetés)`);
console.log('  familles :', Object.entries(byCat).map(([c, n]) => `${c}:${n}`).join(' '));
console.log('  types SIA :', Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t}:${n}`).join(' · '));
