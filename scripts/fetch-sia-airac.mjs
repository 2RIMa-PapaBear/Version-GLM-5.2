#!/usr/bin/env node
// ============================================================================
// FETCH SIA AIRAC — base OFFICIELLE France depuis l'export XML du SIA.
//
//   node scripts/fetch-sia-airac.mjs --xml="chemin/XML_SIA_<date>.xml"
//
// Source : « export_xml_bd_SIA » (rubrique Produits numériques du SIA,
// téléchargement manuel à chaque cycle AIRAC). Structure documentée par la
// FAQ SIA (faqzipexports) : <Espace> (nom+type) → <Partie> (géométrie,
// Contour ordonné par Cloture) → <Volume> (plancher/plafond, HorCode,
// Activite = organisme#fréquence).
//
// Sorties dans data/ :
//   sia-airspaces.json     — zones France au format compact openAIP-like
//   freq-services-sia.json — fréquences par organisme (FIS/TWR/APP…)
//   radio-points.json      — navaids France officiels fusionnés
//   sia-airfields.json     — terrains officiels France (usage VFR, statut)
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=').map(decodeURIComponent)));
if (!args.xml) { console.error('Usage : node scripts/fetch-sia-airac.mjs --xml=<XML_SIA_date.xml>'); process.exit(1); }

const xml = fs.readFileSync(args.xml, 'latin1');
const effDate = (xml.match(/effDate="(\d{4}-\d{2}-\d{2})"/) || [])[1] || 'inconnue';
console.log(`Export SIA du ${effDate} (${(xml.length / 1e6).toFixed(1)} Mo)`);

// ---- Parseurs : éléments complets OU self-closing ; l'attribut lk peut
// contenir des [crochets] mais jamais de « > ». ----
const each = (tag, cb) => {
    let m;
    const r = new RegExp(`<${tag} ([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
    while ((m = r.exec(xml))) cb(m[1] || '', m[2] || '');
};
const attr = (s, name) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '';
const txt = (body, tag) => (body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() ?? null;

// ---------------------------------------------------------------------------
// 1. ESPACES — Espace (type+nom) + Partie (contour ordonné) + Volume
//    (plancher/plafond + Activite « ORGANISME#FREQ MHz »).
// ---------------------------------------------------------------------------
const espaces = new Map();
each('Espace', (attrs) => {
    espaces.set(attr(attrs, 'lk'), { type: '', nom: '', parties: [] });
});
// type + nom propres (les éléments Espace complets les portent)
each('Espace', (attrs, body) => {
    const e = espaces.get(attr(attrs, 'lk'));
    if (!e) return;
    e.type = txt(body, 'TypeEspace') || e.type;
    e.nom = txt(body, 'Nom') || e.nom;
});
// Le Contour ne donne que les ANCHRES : les cercles officiels y sont
// définis par cwa(lat lon:rayon:unité:centre…) sur la 1ʳᵉ ligne et le
// reste n'est que quelques points sur le cercle — relier les ancres par
// des cordes déforme la zone (RMZ QUIBERON = triangle au lieu d'un disque
// 3 NM). Le SIA publie aussi <Geometrie> : le contour DENSIFIÉ complet
// (~200 pts pour un cercle). On l'utilise quand il est cohérent avec les
// ancres (toutes présentes, même ordre cyclique au sens près — validé sur
// tout l'AIRAC 2026-09-03 : 1345/2063 parties, TOUTES les zones cwa) ;
// sinon repli sur les ancres seules (zones Pje/TrPla/Vol… sans Geometrie).
const _geomCoherent = (anchors, gpts) => {
    if (anchors.length < 3 || gpts.length < anchors.length) return false;
    let gp = gpts;
    if (gp.length > 1 && Math.abs(gp[0][0] - gp[gp.length - 1][0]) < 1e-4
        && Math.abs(gp[0][1] - gp[gp.length - 1][1]) < 1e-4) gp = gp.slice(0, -1);
    const idx = [];
    for (const [alon, alat] of anchors) {
        const j = gp.findIndex(([glon, glat]) => Math.abs(glat - alat) < 1e-4 && Math.abs(glon - alon) < 1e-4);
        if (j < 0) return false;
        idx.push(j);
    }
    const s = (idx[0] === idx[idx.length - 1]) ? idx.slice(0, -1) : idx;
    if (s.length < 2 || new Set(s).size !== s.length) return false;
    for (const dir of [1, -1]) {
        let wraps = 0;
        for (let i = 0; i < s.length; i++) {
            const a = s[i], b = s[(i + 1) % s.length];
            if (dir === 1 && b < a) wraps++;
            if (dir === -1 && b > a) wraps++;
        }
        if (wraps <= 1) return true;
    }
    return false;
};
each('Partie', (attrs, body) => {
    const elLk = attr((body.match(/<Espace [^>]*>/) || [''])[0], 'lk') || attr(attrs, 'lk').replace(/\[[^\]]*\]$/, '');
    const esp = espaces.get(elLk);
    if (!esp) return;
    // Contour : « seq,Cloture=n,lat lon,type(…) \t oui » — ordre = séquence.
    const lignes = (txt(body, 'Contour') || '').split('\n').map(l => l.trim()).filter(Boolean);
    const anchors = lignes
        .map(l => (l.split(',')[2] || '').split(' ').map(Number))
        .filter(c => c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(([lat, lon]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]);
    const geom = ((txt(body, 'Geometrie') || '').split('\n').map(l => l.trim()).filter(Boolean)
        .map(l => l.split(',').map(Number))
        .filter(c => c.length === 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
        .map(([lat, lon]) => [Math.round(lon * 1e4) / 1e4, Math.round(lat * 1e4) / 1e4]));
    const ring = _geomCoherent(anchors, geom) ? geom : anchors;
    if (ring.length >= 3) esp.parties.push({ nom: txt(body, 'NomPartie') || '', ring });
});
console.log(`  espaces: ${espaces.size}, parties avec contour: ${[...espaces.values()].reduce((a, e) => a + e.parties.length, 0)}`);

const toFt = (val, unit) => {
    if (val == null) return null;
    const v = parseFloat(String(val).replace(',', '.'));
    if (!Number.isFinite(v)) return null;
    if (/^FL/i.test(unit)) return v * 100;
    if (/^ft/i.test(unit)) return v;
    if (/^m$/i.test(unit)) return Math.round(v * 3.28084);
    if (/^SFC/i.test(unit)) return 0;
    return v;
};

const TYPE_NUM = {
    CTR: 4, TMA: 5, CTA: 34, SIV: 33, ATZ: 6,
    P: 3, R: 15, D: 2,          // interdite / réglementée / dangereuse
    Pje: 1,                      // parachutage
    Vol: 14, TrPla: 14, TrPVL: 14, TrVL: 14,   // planeurs / vol à voile
    TMZ: 11, RMZ: 12, 'RMZ-TMZ': 11,
};
const zonesOut = [];
each('Volume', (attrs, body) => {
    const partieLk = attr((body.match(/<Partie [^>]*\/>/) || body.match(/<Partie [^>]*>/) || [''])[0], 'lk');
    const espLk = partieLk.replace(/\[[^\]]*\]$/, '');
    const esp = espaces.get(espLk);
    if (!esp || !esp.parties.length) return;
    const ty = TYPE_NUM[esp.type];
    if (!ty) return;   // « Aer », « other », MSA… : hors périmètre carte VFR

    const lo = toFt(txt(body, 'Plancher'), txt(body, 'PlancherRefUnite')) ?? 0;
    const up = toFt(txt(body, 'Plafond'), txt(body, 'PlafondRefUnite'));
    if (up == null || up <= 0) return;

    const partie = esp.parties.find(p => p.nom && partieLk.endsWith(`[${p.nom}]`)) || esp.parties[0];
    // Activite « APP MELUN#SEINE INFO 134.300 » → organisme + fréquence.
    const act = (txt(body, 'Activite') || '');
    const freqMatch = act.match(/(\d{3}\.\d{2,3})/);
    const whoMatch = act.split('#')[1]?.replace(/\d{3}\.\d{2,3}/, '').trim() || '';

    zonesOut.push({
        i: attr(attrs, 'pk'),
        n: `${esp.type} ${esp.nom}${partie.nom && partie.nom !== '.' ? ' ' + partie.nom : ''}`,
        ty,
        lo: [lo, /FL/i.test(txt(body, 'PlancherRefUnite') || '') ? 6 : 1],
        up: [up, /FL/i.test(txt(body, 'PlafondRefUnite') || '') ? 6 : 1],
        f: freqMatch ? [{ value: freqMatch[1], name: whoMatch.toUpperCase() }] : null,
        hor: txt(body, 'HorCode') || '',
        g: { t: 1, c: [partie.ring] },
    });
});
fs.writeFileSync(path.join(ROOT, 'data', 'sia-airspaces.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), airac: effDate, count: zonesOut.length, items: zonesOut,
}));
const withFreq = zonesOut.filter(z => z.f).length;
console.log(`espaces : ${zonesOut.length} zones officielles (${withFreq} avec fréquence) → data/sia-airspaces.json`);

// ---------------------------------------------------------------------------
// 2. FRÉQUENCES par organisme (Service complet : FIS/TWR/APP + terrain).
// ---------------------------------------------------------------------------
const services = new Map();
each('Frequence', (attrs, body) => {
    // Le lk porte tout : [territoire][code AD][FIS/TWR/… Nom][fréq].
    const m = attr(attrs, 'lk').match(/\[([A-Z]{2})\]\[(FIS|TWR|APP|GND|DEL|ATIS) ([^\]]+)\]\[(\d{3}\.\d{2,3})\]/);
    if (!m) return;
    const key = `${m[2]} ${m[3]}`;
    (services.get(key) ?? services.set(key, []).get(key)).push({
        freq: m[4], ad: m[1], hor: txt(body, 'HorCode') || '', rem: (txt(body, 'Remarque') || '').trim(),
    });
});
fs.writeFileSync(path.join(ROOT, 'data', 'freq-services-sia.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), airac: effDate, services: Object.fromEntries(services),
}));
console.log(`fréquences organismes : ${services.size} services → data/freq-services-sia.json`);

// ---------------------------------------------------------------------------
// 3. RADIOphares France (VOR/NDB) — fusion dans radio-points.json (les
//    fréquences openAIP sont conservées par correspondance d'ident).
// ---------------------------------------------------------------------------
const navaids = [];
each('NavFix', (attrs, body) => {
    if (!/^\[LF\]/.test(attr(attrs, 'lk'))) return;
    const t = txt(body, 'NavType');
    if (t !== 'VOR' && t !== 'NDB') return;
    const lat = parseFloat(txt(body, 'Latitude')), lon = parseFloat(txt(body, 'Longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    navaids.push([t === 'VOR' ? 'vor' : 'ndb', txt(body, 'Ident') || '', Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5]);
});
const rpPath = path.join(ROOT, 'data', 'radio-points.json');
const rp = JSON.parse(fs.readFileSync(rpPath, 'utf8'));
const siaIdent = new Map(navaids.map(n => [n[1], n]));
const merged = [];
for (const o of rp.navaids) {
    const s2 = siaIdent.get(o[1]);
    if (s2) { merged.push([s2[0], s2[1], s2[2], s2[3], o[4], o[5]]); siaIdent.delete(o[1]); }
    else merged.push(o);
}
for (const s2 of siaIdent.values()) merged.push([s2[0], s2[1], s2[2], s2[3], null, null]);
rp.navaids = merged;
rp.siaAirac = effDate;
fs.writeFileSync(rpPath, JSON.stringify(rp));
console.log(`radio-points.json : ${rp.navaids.length} navaids (dont ${navaids.length} officiels SIA)`);

// ---------------------------------------------------------------------------
// 4. TERRAINS officiels France (+ élévation et déclinaison magnétique
//    officielles — AdRefAltFt / AdMagVar millésimé MagVarDate).
// ---------------------------------------------------------------------------
const airfields = [];
const adLkToIcao = new Map();   // lk « [LF][BT] » → LFBT (pour les pistes)
each('Ad', (attrs, body) => {
    if (!/^\[LF\]/.test(attr(attrs, 'lk'))) return;
    const code = 'LF' + (txt(body, 'AdCode') || '');
    if (!/^[A-Z][A-Z0-9]{3}$/.test(code)) return;
    adLkToIcao.set(attr(attrs, 'lk'), code);
    const lat = parseFloat(txt(body, 'ArpLat')), lon = parseFloat(txt(body, 'ArpLong'));
    const elev = parseInt(txt(body, 'AdRefAltFt') || '', 10);
    const magVar = parseFloat(String(txt(body, 'AdMagVar') || '').replace(',', '.'));
    airfields.push({
        code, nom: txt(body, 'AdNomComplet') || code, carto: txt(body, 'AdNomCarto') || '',
        lat: Number.isFinite(lat) ? lat : null, lon: Number.isFinite(lon) ? lon : null,
        statut: txt(body, 'AdStatut') || '', vfr: txt(body, 'TfcVfr') === 'oui', ifr: txt(body, 'TfcIfr') === 'oui',
        prive: txt(body, 'TfcPrive') === 'oui',
        elevFt: Number.isFinite(elev) ? elev : null,
        magVar: Number.isFinite(magVar) ? magVar : null, magVarYear: txt(body, 'MagVarDate') || null,
    });
});
fs.writeFileSync(path.join(ROOT, 'data', 'sia-airfields.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), airac: effDate, count: airfields.length, items: airfields,
}));
console.log(`terrains France : ${airfields.length} → data/sia-airfields.json`);

// ---------------------------------------------------------------------------
// 4bis. PISTES officielles France (section <RwyS>) — longueur/largeur en
// MÈTRES, revêtement, piste principale, orientation vraie, seuils (lat/lon/
// alt, déplacés compris). Les seuils du XML SIA sont exacts (même source
// que les cartes) : ils remplacent avantageusement le CSV OurAirports.
// ---------------------------------------------------------------------------
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
const runways = {};
{
    const s = xml.indexOf('<RwyS>'); const e = xml.indexOf('</RwyS>', s);
    const seg = s >= 0 && e > s ? xml.slice(s, e) : '';
    const blocks = seg.match(/<Rwy pk="[^"]*" lk="(\[LF\]\[..\])\[[^\]]*\]">[\s\S]*?(?=<Rwy pk=|<\/RwyS>|$)/g) || [];
    for (const b of blocks) {
        const lk = (b.match(/lk="(\[LF\]\[..\])/) || [])[1];
        const icao = adLkToIcao.get(lk);
        if (!icao) continue;
        const t = (tag) => txt(b, tag);
        const pair = t('Rwy') || '';
        const [n1, n2] = pair.split('/');
        const thr = (i) => {
            const lat = num(t(`LatThr${i}`)), lon = num(t(`LongThr${i}`));
            if (lat == null || lon == null) return null;
            const dLat = num(t(`LatDThr${i}`)), dLon = num(t(`LongDThr${i}`));
            return {
                id: i === 1 ? n1 : n2, lat: Math.round(lat * 1e6) / 1e6, lon: Math.round(lon * 1e6) / 1e6,
                altFt: num(t(`AltFtThr${i}`)),
                d: (dLat != null && dLon != null) ? { lat: Math.round(dLat * 1e6) / 1e6, lon: Math.round(dLon * 1e6) / 1e6, altFt: num(t(`AltFtDThr${i}`)) } : null,
            };
        };
        const r = {
            d: pair,
            len: num(t('Longueur')), wid: num(t('Largeur')),
            surf: t('Revetement') || '',
            main: t('Principale') === 'oui',
            brg: num(t('OrientationGeo')),
            t1: thr(1), t2: thr(2),
        };
        if (!r.d || r.len == null) continue;
        (runways[icao] ??= []).push(r);
    }
}
fs.writeFileSync(path.join(ROOT, 'data', 'sia-runways.json'), JSON.stringify({
    generatedAt: new Date().toISOString(), airac: effDate,
    count: Object.values(runways).reduce((a, v) => a + v.length, 0), items: runways,
}));
console.log(`pistes officielles : ${Object.values(runways).reduce((a, v) => a + v.length, 0)} pistes / ${Object.keys(runways).length} terrains → data/sia-runways.json`);

// ---------------------------------------------------------------------------
// 4ter. POINTS VFR officiels France (NavFix type VFR) — remplacent les
// points openAIP en France : 1098 points AVEC description officielle
// (« VRP-Cavaillon (Pont TGV sur la Durance) ») contre 675 sans.
// ---------------------------------------------------------------------------
const vrpsSia = [];
each('NavFix', (attrs, body) => {
    if (!/^\[LF\]/.test(attr(attrs, 'lk'))) return;
    if (txt(body, 'NavType') !== 'VFR') return;
    const lat = parseFloat(txt(body, 'Latitude')), lon = parseFloat(txt(body, 'Longitude'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    const desc = (txt(body, 'Description') || '').replace(/\s+/g, ' ').trim();
    vrpsSia.push([txt(body, 'Ident') || '', Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, 'FR', desc || null]);
});
{
    // Priorité SIA : les points VFR openAIP de France sont écartés.
    rp.vrps = rp.vrps.filter(v => v[3] !== 'FR').concat(vrpsSia);
    rp.counts = rp.counts || {};
    rp.counts.vrpsSia = vrpsSia.length;
    rp.siaVrpAirac = effDate;
    fs.writeFileSync(rpPath, JSON.stringify(rp));
}
console.log(`points VFR officiels : ${vrpsSia.length} (openAIP FR écartés) → data/radio-points.json`);
