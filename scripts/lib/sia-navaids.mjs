// ============================================================================
// SIA RADIO LAYER — couche OFFICIELLE SIA des radiophares et points VFR
// France pour data/radio-points.json.
//
// RÈGLE PILOTE (rappelée le 16/09) : « la base, ce sont les fichiers SIA,
// à prendre en priorité et à compléter si besoin par openAIP — et non
// l'inverse. » L'instantané data/sia-radio-layer.json (navaids + VRP,
// rafraîchi à chaque cycle AIRAC par scripts/fetch-sia-airac.mjs) EST la
// base ; openAIP ne vient que COMPLÉTER (reste du monde). Le robot
// scripts/fetch-radio-points.mjs REFUSE de générer sans cet instantané et
// VÉRIFIE l'intégrité de la couche avant d'écrire — l'incident du 14/09
// (régénération openAIP seule) avait détruit pendant 2 jours fréquences
// RadioNav, noms+portées ET les VRP officiels (0/6121 avec description).
//
// Règles de fusion (validées 29/08 et 14/09, commits 99702179/7ed86324) :
//   - navaids retenus : VOR, VOR-DME, VORTAC, NDB et DME-ATT (DME ENR) —
//     distinction CONSERVÉE (décision pilote 27/09 : VOR-DME = hexagone
//     dans un cadre + préfixe (D), DME ENR = rectangle ; 51 VOR-DME et 19
//     DME-ATT en France) ; TACAN = azimut militaire UHF non recevable sur
//     VOR classique → EXCLU (symbole en réserve) ;
//   - fréquence/méta officielles des <RadioNav> (Frequence, NomPhraseo,
//     Portee) rapprochées par « TYPE IDENT » ;
//   - rapprochement openAIP par ident ET proximité (<0,35° lat / 0,5° lon)
//     — l'ident seul collisionne mondialement (LDV Bretagne ↔ Champagne) ;
//   - navaids SIA absents d'openAIP AJOUTÉS (7 VOR-DME : BT, CNM, LSE,
//     MEN, ROA, TOU, CAV) ;
//   - 7ᵉ élément : [nom phraséologique, portée NM] ;
//   - VRP : les points VFR officiels SIA (NavFix type VFR, description
//     officielle) REMPLACENT les points openAIP de France.
// ============================================================================
import fs from 'node:fs';

/** Parse l'export XML SIA (AIRAC) → { effDate, navaids:[{k,ident,lat,lon,f,u,n,r}],
 *  tacans:[{ident,lat,lon}] } — les TACAN (exclus du rendu) sont listés
 *  à part pour retirer leurs jumeaux openAIP (doublon « CGC 116.2 » à
 *  côté du VOR-DME CNA Cognac — retour pilote 27/09). */
export function parseSiaNavaids(xml) {
    const effDate = (xml.match(/effDate="(\d{4}-\d{2}-\d{2})"/) || [])[1] || 'inconnue';
    const each = _each(xml);
    const NAV_KIND = { VOR: 'vor', 'VOR-DME': 'vor-dme', VORTAC: 'vor-dme', NDB: 'ndb', 'DME-ATT': 'dme' };
    // RadioNav TOUS territoires : l'export SIA publie aussi les moyens
    // FRONTALIERS des pays voisins ([LS] Suisse, [EB] Belgique, [LI] Italie,
    // [ED] Allemagne…) qui figurent sur les cartes françaises — leur nom est
    // dans <Station> (le <NomPhraseo> français n'existe que pour [LF]).
    const navFreq = new Map();   // "TYPE IDENT" → { f, u, n (nom), r (portée NM) }
    each('RadioNav', (attrs, body) => {
        const m = (each.attr(attrs, 'lk') || '').match(/^\[[A-Za-z]{2}\]\[([A-Z-]+) ([^\]]+)\]$/);
        if (!m) return;
        const f = parseFloat(String(each.txt(body, 'Frequence') || '').replace(',', '.'));
        if (!Number.isFinite(f)) return;
        const portee = parseInt(String(each.txt(body, 'Portee') || ''), 10);
        navFreq.set(`${m[1]} ${m[2]}`, {
            f, u: m[1] === 'NDB' ? 1 : 2,
            n: ((each.txt(body, 'NomPhraseo') || '').trim() || (each.txt(body, 'Station') || '').trim()) || null,
            r: Number.isFinite(portee) && portee > 0 ? portee : null,
        });
    });
    const navaids = [];
    const tacans = [];
    each('NavFix', (attrs, body) => {
        // [LF] France + moyens FRONTALIERS des pays voisins (base officielle
        // des cartes françaises) — les autres types (WPT/VRP/PNP hors [LF])
        // restent hors périmètre.
        const pre = each.attr(attrs, 'lk').split(']')[0] + ']';
        const isFr = /^\[lf\]$/i.test(pre);
        const isRadioNavType = t => ['VOR', 'VOR-DME', 'VORTAC', 'NDB', 'DME-ATT', 'TACAN'].includes(t);
        const t = each.txt(body, 'NavType');
        if (!isFr && !isRadioNavType(t)) return;
        const lat = parseFloat(each.txt(body, 'Latitude')), lon = parseFloat(each.txt(body, 'Longitude'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        if (t === 'TACAN') {
            // Exclus du rendu (azimut militaire UHF) — mais connus, pour
            // retirer leurs jumeaux openAIP de la couche France.
            tacans.push({ ident: each.txt(body, 'Ident') || '', lat, lon });
            return;
        }
        if (!NAV_KIND[t]) return;
        const ident = each.txt(body, 'Ident') || '';
        if (!ident) return;                     // garde : Ident malformé (LFDD du flux réel)
        const fq = navFreq.get(`${t} ${ident}`);
        navaids.push({
            k: NAV_KIND[t], ident,
            lat: Math.round(lat * 1e5) / 1e5, lon: Math.round(lon * 1e5) / 1e5,
            f: fq?.f ?? null, u: fq?.u ?? null, n: fq?.n ?? null, r: fq?.r ?? null,
        });
    });
    return { effDate, navaids, tacans };
}

/** Points VFR officiels SIA (NavFix type VFR) → [[Ident, lat, lon, 'FR', description], …]. */
export function parseSiaVrps(xml) {
    const each = _each(xml);
    const vrps = [];
    each('NavFix', (attrs, body) => {
        if (!/^\[LF\]/.test(each.attr(attrs, 'lk'))) return;
        if (each.txt(body, 'NavType') !== 'VFR') return;
        const lat = parseFloat(each.txt(body, 'Latitude')), lon = parseFloat(each.txt(body, 'Longitude'));
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
        const desc = (each.txt(body, 'Description') || '').replace(/\s+/g, ' ').trim();
        vrps.push([each.txt(body, 'Ident') || '', Math.round(lat * 1e5) / 1e5, Math.round(lon * 1e5) / 1e5, 'FR', desc || null]);
    });
    return vrps;
}

/**
 * Fusionne les navaids SIA dans un objet radio-points (MUTÉ sur place).
 * Les données SIA PRIMENT : coordonnées/fréquence officielles remplacent
 * celles d'openAIP (qui ne complète que les champs inconnus du SIA).
 */
export function mergeIntoRadioPoints(rp, sia, { effDate } = {}) {
    const metaOf = (s) => (s.n || s.r) ? [s.n, s.r] : null;
    // TACAN exclus du rendu : retirer leurs jumeaux openAIP (même ident +
    // proximité, règle du rapprochement) — sinon un « VOR » fantôme doublonne
    // la station officielle (CGC 116.2 à côté du VOR-DME CNA Cognac).
    const tacans = sia.tacans || [];
    let droppedTacans = 0;
    if (tacans.length) {
        const before = (rp.navaids || []).length;
        rp.navaids = (rp.navaids || []).filter((o) => !tacans.some((tc) =>
            o[1] === tc.ident && Math.abs(o[2] - tc.lat) < 0.35 && Math.abs(o[3] - tc.lon) < 0.5));
        droppedTacans = before - rp.navaids.length;
    }
    const pending = (sia.navaids || []).map((s) => ({ ...s, used: false }));
    // RÈGLE PILOTE (répétée le 27/09) : « pour la France uniquement la base
    // SIA » — tout navaid openAIP (type numérique) situé sur le territoire
    // français est retiré : ce que le SIA publie est déjà fusionné, ce qu'il
    // ne publie pas (VOR militaires non publiés, ex. AMU Ambérieu) n'a pas
    // à figurer sur la carte. Les moyens FRONTALIERS du SIA (PASSEIRY…)
    // sont fusionnés comme les [LF] — un openAIP voisin reste remplacé.
    const FR = { latMin: 41.2, latMax: 51.2, lonMin: -5.8, lonMax: 9.8 };
    // Exception FRONTALIÈRE : un openAIP n'est gardé dans le cadre France
    // que s'il correspond à une station SIA (ident + proximité) — il sera
    // remplacé par l'officielle à l'étape suivante (PAS→PASSEIRY).
    const twinOfSia = (o) => (sia.navaids || []).some((s) =>
        s.ident === o[1] && Math.abs(s.lat - o[2]) < 0.35 && Math.abs(s.lon - o[3]) < 0.5);
    const beforeFr = (rp.navaids || []).length;
    rp.navaids = (rp.navaids || []).filter((o) => {
        if (typeof o[0] === 'string') return true;              // déjà SIA
        const lat = o[2], lon = o[3];
        const inFr = lat >= FR.latMin && lat <= FR.latMax && lon >= FR.lonMin && lon <= FR.lonMax;
        return !inFr || twinOfSia(o);
    });
    const droppedOpenAipFr = beforeFr - rp.navaids.length;
    const merged = (rp.navaids || []).map((o) => {
        const s = pending.find((n) => !n.used && n.ident === o[1]
            && Math.abs(n.lat - o[2]) < 0.35 && Math.abs(n.lon - o[3]) < 0.5);
        if (!s) return o;
        s.used = true;
        return [s.k, s.ident, s.lat, s.lon, s.f ?? o[4] ?? null, s.u ?? o[5] ?? null, metaOf(s)];
    });
    let added = 0;
    for (const s of pending) if (!s.used) { merged.push([s.k, s.ident, s.lat, s.lon, s.f, s.u, metaOf(s)]); added++; }
    rp.navaids = merged;
    rp.counts = rp.counts || {};
    rp.counts.navaidsSia = pending.length;
    rp.counts.navaidsTacanTwin = droppedTacans;
    rp.counts.navaidsOpenAipFrDropped = droppedOpenAipFr;
    const airac = effDate || sia.airac || sia.effDate;
    if (airac) rp.siaAirac = airac;
    return { matched: pending.length - added, added, droppedTacans, droppedOpenAipFr, total: pending.length };
}

/** VRP : les points VFR officiels SIA REMPLACENT les points openAIP de
 *  France (priorité SIA — descriptions officielles). */
export function applySiaVrps(rp, vrps, { effDate } = {}) {
    rp.vrps = (rp.vrps || []).filter((v) => v[3] !== 'FR').concat(vrps || []);
    rp.counts = rp.counts || {};
    rp.counts.vrpsSia = (vrps || []).length;
    const airac = effDate;
    if (airac) rp.siaVrpAirac = airac;
    return rp.counts.vrpsSia;
}

/**
 * Contrôle d'intégrité AVANT écriture : la base SIA doit être intégralement
 * présente dans le fichier final. Retourne null si OK, sinon la 1re anomalie.
 */
export function verifySiaLayer(rp, snap) {
    for (const s of (snap.navaids || [])) {
        const ok = (rp.navaids || []).some((n) => n[1] === s.ident
            && Math.abs(n[2] - s.lat) < 1e-4 && Math.abs(n[3] - s.lon) < 1e-4
            && (s.f == null || n[4] === s.f)
            && (s.n == null || (Array.isArray(n[6]) && n[6][0] === s.n)));
        if (!ok) return `navaid SIA absent ou dégradé : ${s.ident} (${s.k})`;
    }
    if (Array.isArray(snap.vrps)) {
        const fr = (rp.vrps || []).filter((v) => v[3] === 'FR');
        if (fr.length !== snap.vrps.length) {
            return `VRP SIA : ${fr.length} points FR dans le fichier, ${snap.vrps.length} attendus`;
        }
    }
    return null;
}

/** Charge l'instantané data/sia-radio-layer.json, ou null si absent/invalide. */
export function loadSiaRadioLayer(siaPath) {
    try {
        const snap = JSON.parse(fs.readFileSync(siaPath, 'utf8'));
        return Array.isArray(snap?.navaids) ? snap : null;
    } catch {
        return null;
    }
}

// ---- Parseurs XML (éléments complets OU self-closing ; l'attribut lk peut
// contenir des [crochets] mais jamais de « > ») — identiques au pipeline
// AIRAC historique. ----
function _each(xml) {
    const fn = (tag, cb) => {
        let m;
        const r = new RegExp(`<${tag} ([^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g');
        while ((m = r.exec(xml))) cb(m[1] || '', m[2] || '');
    };
    fn.attr = (s, name) => (s.match(new RegExp(`${name}="([^"]*)"`)) || [])[1] || '';
    fn.txt = (body, tag) => (body.match(new RegExp(`<${tag}>([^<]*)</${tag}>`)) || [])[1]?.trim() ?? null;
    return fn;
}
