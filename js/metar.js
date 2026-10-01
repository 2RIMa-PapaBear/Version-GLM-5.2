/* ================================================================
 * METAR — DÉCODAGE, SOURCE UNIQUE (W11, audit 27/09 clos le 01/10/2026)
 * ================================================================
 *
 * Avant W11, CINQ chemins de décodage coexistaient à tolérances
 * divergentes (engine analyserMETAR/_parseVent, core parseWindGroupToKt,
 * engine parseWindString sur chaîne formatée, takeoff-performance
 * _parseWindForAxial, weather analyzeWeatherAlerts). Les tolérances
 * avaient été alignées (fiches 10/15, M3) mais l'UNIFICATION restait à
 * faire : elle vit ici. Module PUR — aucun import, testable sous Node,
 * consommé par core.js (re-export compat), engine.js, weather.js,
 * go-nogo.js, takeoff-performance.js, ui-module.js…
 *
 * Unités : tout vent est CONVERTI EN KT (MPS ×1,94384, KMH ÷1,852) —
 * unité attendue par toute l'app. Une visibilité ABSENTE est null
 * (jamais 10 km implicite — ré-audit 26/09 ; o4 : la chaîne VIDE aussi).
 * ================================================================ */

export function parseVisiToMeters(visiStr) {
    // o4 (audit 01/10) : entrée VIDE/absente → null (INCONNUE). L'ancien
    // repli 10 000 m n'était jamais atteint sans garde amont… sauf si un
    // appelant passait '' : piège dormant, fermé ici à la source.
    if (!visiStr || !String(visiStr).trim()) return null;
    if (visiStr.includes('9999') || visiStr.includes('CAVOK')) return 10000;
    const smMatch = visiStr.match(/([PM]?)(\d+)?\s?(?:(\d+)\/(\d+))?SM/);
    if (smMatch) {
        const whole = parseInt(smMatch[2]) || 0;
        const num   = parseInt(smMatch[3]) || 0;
        const den   = parseInt(smMatch[4]) || 1;
        // « M »/« P » (moins de / plus de) : la borne PUBLIÉE est la
        // meilleure granularité disponible — l'affichage porte le « < »/« > »
        // (cf. engine _parseVisi), la valeur reste la borne.
        return Math.round((whole + num / den) * 1609.34);
    }
    const mMatch = visiStr.match(/(\d{4})/);
    return mMatch ? parseInt(mMatch[1], 10) : 10000;
}

/* Groupe vent d'un METAR/TAF brut, toutes unités OACI (fiche n°15, audit
 * 27/09) : KT, MPS (Russie, Chine…) ou KMH selon la région émettrice.
 * Point d'entrée unique — tout est CONVERTI EN KT, unité attendue par
 * l'ensemble de l'app (rose des vents, piste en service, go-nogo, perfs
 * décollage) : MPS ×1.94384, KMH ÷1.852, arrondi à l'entier le plus proche.
 * L'UNITÉ EST EXIGÉE : « 90 8 » sans unité ne fabrique pas de vent fantôme.
 * Retourne { variable, dir, speed, gust, varFrom, varTo } (kt) ou null. */
export function parseWindGroupToKt(raw) {
    const txt = String(raw || '').toUpperCase();
    const m = txt.match(/\b(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS|KMH)\b/);
    if (!m) return null;
    const k = m[4] === 'MPS' ? 1.94384 : m[4] === 'KMH' ? 1 / 1.852 : 1;
    const toKt = v => k === 1 ? parseInt(v, 10) : Math.round(parseInt(v, 10) * k);
    // Variation de direction METAR (« 180V240 ») collée derrière le groupe vent.
    const vMatch = txt.match(/\b(?:\d{3}|VRB)\d{2,3}(?:G\d{2,3})?(?:KT|MPS|KMH)\s(\d{3})V(\d{3})\b/);
    return {
        variable: m[1] === 'VRB',
        dir: m[1] === 'VRB' ? null : parseInt(m[1], 10),
        speed: toKt(m[2]),
        gust: m[3] ? toKt(m[3]) : null,
        varFrom: vMatch ? parseInt(vMatch[1], 10) : null,
        varTo: vMatch ? parseInt(vMatch[2], 10) : null
    };
}

/* Vent en entrée « souple » (W11) : accepte le GROUPE BRUT (« 21006KT
 * 170V250 », « 12012MPS ») ET la chaîne FORMATÉE du panneau METAR
 * (« 210° 06KT 170V250 », « VRB 10G20KT ») — remplace les deux parseurs
 * parallèles d'antan (engine.parseWindString, takeoff._parseWindForAxial,
 * qui lisait « 12012MPS » comme 12 KT !). Unité toujours exigée.
 * Retour = même forme que parseWindGroupToKt, ou null. */
export function parseWindLoose(str) {
    if (!str) return null;
    // « 270° 15KT » → « 27015KT » : on ne colle QUE l'espace intérieur
    // direction/vitesse — l'espace AVANT la variation 170V250 doit survivre
    // (le parseur canonique l'exige), et une variation collée derrière
    // l'unité (formats affichés) est rattrapée en secours ci-dessous.
    const clean = String(str).toUpperCase()
        .replace(/°/g, '')
        .replace(/\b(VRB|\d{3})\s+(\d{2,3})(?!\d)/g, '$1$2')
        // Variation collée derrière l'unité (formats affichés anciens) :
        // on rend l'espace que le parseur canonique exige.
        .replace(/(KT|MPS|KMH)(?=\d{3}V\d{3}\b)/g, '$1 ');
    const w = parseWindGroupToKt(clean);
    if (!w) return null;
    if (w.varFrom == null) {
        const v = clean.match(/(?:KT|MPS|KMH)(\d{3})V(\d{3})/);
        if (v) { w.varFrom = parseInt(v[1], 10); w.varTo = parseInt(v[2], 10); }
    }
    return w;
}

/* Plafond (centaines de ft ; 999 = illimité) d'un segment nuages —
 * BKN/OVC/VV constituent le plafond, FEW/SCT non. Déplacé de core.js. */
export function getCeiling(nuageStr) {
    if (!nuageStr || nuageStr.includes('CAVOK') || nuageStr.includes('NSC') || nuageStr.includes('SKC') || nuageStr.includes('NCD')) return 999;
    if (nuageStr.includes('VV///')) return 0;

    let lowest = 999;
    const regexRaw = /(BKN|OVC|VV)(\d{3})(?!ft)/g;
    let match;
    while ((match = regexRaw.exec(nuageStr)) !== null) {
        const alt = parseInt(match[2], 10);
        if (alt < lowest) lowest = alt;
    }

    const regexParsed = /(BKN|OVC|VV)\s+(\d+)ft/g;
    while ((match = regexParsed.exec(nuageStr)) !== null) {
        const alt = parseInt(match[2], 10) / 100;
        if (alt < lowest) lowest = alt;
    }

    return lowest;
}

/* RVR — portée visuelle de piste (W12, audit 27/09 : jamais extraite).
 * OACI Annexe 3 : R26/0600 · R26L/0600V1200 (variable) · R26/M0050
 * (moins de) · R26/P2000 (plus de) · tendance optionnelle /U /D /N.
 * Valeurs en MÈTRES. Pur.
 * @returns {Array<{rwy:string, minM:number, maxM:number,
 *            lessThan:boolean, moreThan:boolean, trend:string|null}>} */
export function parseRvr(raw) {
    const out = [];
    const re = /\bR(\d{2}[LRC]?)\/([MP]?)(\d{4})(?:V([MP]?)(\d{4}))?(?:\/([UDN]))?\b/g;
    let m;
    while ((m = re.exec(String(raw || ''))) !== null) {
        out.push({
            rwy: m[1],
            minM: parseInt(m[3], 10),
            maxM: m[5] ? parseInt(m[5], 10) : parseInt(m[3], 10),
            lessThan: m[2] === 'M' || m[4] === 'M',
            moreThan: m[2] === 'P' || m[4] === 'P',
            trend: m[6] || null,
        });
    }
    return out;
}
