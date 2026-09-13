/* ================================================================
 * AZBA — Activation des zones aériennes par NOTAM (B2, roadmap 13/09)
 * ================================================================
 *
 * PRINCIPE
 * --------
 * Le SIA publie des zones réglementées « par NOTAM » (champ hor =
 * 'NOTAM' ×156 zones) ou à horaires variables (HX ×540) : leur
 * activation RÉELLE vit dans les plages de l'ITEM D des NOTAM du
 * dossier SOFIA déjà chargé par l'app. Ce module croise :
 *
 *   désignateur de zone (R 71, D 56B, P 23…, via la clé _rdpKey
 *   d'airspaces.js passée par l'appelant)  ×  désignateurs cités
 *   dans l'item E des NOTAM  ×  plages de l'item D  →  statut du
 *   jour : ACTIVE maintenant / active aujourd'hui hh-hh / —.
 *
 * Module PUR (aucune dépendance DOM/réseau) — testé sous Node sur des
 * item D RÉELS de la capture SOFIA du 12/09 :
 *   "0600-1900" · "0630-1530" · "06 12 20 0700-1600, 09 16 0700-1030"
 *   "SR-SS" · "MON-FRI 1200-SS"
 *
 * LIMITES ASSUMÉES (v1) : les plages item D sont lues en HEURE LOCALE
 * du navigateur (un pilote qui vole en France lit des NOTAM en heure
 * locale de terrain) ; SR/SS sont fournis par l'appelant (leverages/
 * couchers calculés à la position de la zone via SunCalc). Un NOTAM
 * sans item D = activation permanente pendant sa validité.
 * ================================================================ */

const WEEKDAYS = { MON: 1, TUE: 2, WED: 3, THU: 4, FRI: 5, SAT: 6, SUN: 7 };

/** « HHMM » → minutes depuis minuit ; SR/SS via sunTimes (minutes). */
function _toMin(token, sunTimes) {
    if (token === 'SR') return sunTimes?.sr ?? 6 * 60 + 30;
    if (token === 'SS') return sunTimes?.ss ?? 19 * 60 + 45;
    if (/^\d{4}$/.test(token)) return parseInt(token.slice(0, 2), 10) * 60 + parseInt(token.slice(2), 10);
    return null;
}

/**
 * Parse l'ITEM D en groupes de contraintes.
 * @param {string} str Item D brut (« 06 12 20 0700-1600, 09 16 0700-1030 »).
 * @returns {Array<{days:Set<number>|null, weekdays:Set<number>|null,
 *   from:string|null, to:string|null}>|null}
 *   days = jours du mois (1-31), weekdays = 1(LUN)..7(DIM),
 *   from/to = 'HHMM' | 'SR' | 'SS' (null = pas de contrainte).
 *   null = pas d'item D (activation permanente sur la validité).
 */
export function parseItemD(str) {
    const s0 = String(str || '').trim().toUpperCase().replace(/\s+/g, ' ');
    if (_parseMemo.has(s0)) return _parseMemo.get(s0);
    const r = _parseItemD(s0);
    _parseMemo.set(s0, r);
    return r;
}

// Mémo : le rendu de carte interroge le statut de chaque zone (jusqu'à
// 1 526 items) contre chaque NOTAM du dossier — clés et plages sont
// calculées UNE fois par NOTAM / par item D.
const _parseMemo = new Map();
const _keysMemo = new WeakMap();

function _parseItemD(s) {
    if (!s || s === 'H24' || s === 'DAILY') return null;

    const out = [];
    for (const gRaw of s.split(',')) {
        const g = gRaw.trim();
        if (!g) continue;

        let days = null, weekdays = null;
        let from = null, to = null;

        // Plage horaire du groupe (premier couple from-to présent).
        const mPlage = g.match(/\b(SR|SS|\d{4})\s?-\s?(SR|SS|\d{4})\b/);
        if (mPlage) { from = mPlage[1]; to = mPlage[2]; }

        for (const t of g.split(/\s+/)) {
            if (t === 'DAILY' || t === 'H24') continue;
            // Intervalle de jours de semaine (MON-FRI).
            const wdRange = t.match(/^(MON|TUE|WED|THU|FRI|SAT|SUN)-(MON|TUE|WED|THU|FRI|SAT|SUN)$/);
            if (wdRange) {
                weekdays ??= new Set();
                for (let d = WEEKDAYS[wdRange[1]]; ; d = d % 7 + 1) {
                    weekdays.add(d);
                    if (d === WEEKDAYS[wdRange[2]]) break;
                }
                continue;
            }
            if (WEEKDAYS[t]) { (weekdays ??= new Set()).add(WEEKDAYS[t]); continue; }
            // Jour du mois (1-31) — les heures à 4 chiffres et les plages
            // ont déjà été traitées / ignorées.
            if (/^\d{1,2}$/.test(t) && +t >= 1 && +t <= 31) { (days ??= new Set()).add(+t); continue; }
        }

        out.push({ days, weekdays, from, to });
    }
    return out.length ? out : null;
}

/**
 * Désignateurs R/D/P cités dans un NOTAM (item E, éventuellement
 * traduction FR), normalisés comme les clés _rdpKey des zones
 * (« R71 », « D56B »…). Sert au rapprochement NOTAM ↔ zone SIA.
 * @returns {Set<string>}
 */
export function notamZoneKeys(notam) {
    let keys = _keysMemo.get(notam);
    if (keys) return keys;
    keys = new Set();
    const texts = [notam?.itemE, notam?.multiLanguage?.itemE];
    for (const txt of texts) {
        const s = String(txt || '').toUpperCase();
        // « ZONE R 71 », « R71 », « D 56 B », « P 23 », « LF-R278A »…
        const re = /(?:^|[^A-Z0-9])(?:LF-)?([RDP])\s?(\d{1,3})\s?([A-Z])?(?![A-Z0-9])/g;
        let m;
        while ((m = re.exec(s)) !== null) {
            keys.add(m[1] + m[2] + (m[3] || ''));
        }
    }
    _keysMemo.set(notam, keys);
    return keys;
}

/** Statut des groupes d'un item D POUR AUJOURD'HUI (date locale du
 *  navigateur). Retourne {state, detail} : active / today (plage à
 *  venir aujourd'hui) / off (aucun groupe ne joue aujourd'hui). */
function _statusToday(groups, nowD, sunTimes) {
    const dom = nowD.getDate();
    const wd = nowD.getDay() === 0 ? 7 : nowD.getDay();   // 1=LUN..7=DIM
    const nowMin = nowD.getHours() * 60 + nowD.getMinutes();
    const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, '0')}${String(min % 60).padStart(2, '0')}`;

    let upcoming = null;
    for (const g of groups) {
        if (g.days && !g.days.has(dom)) continue;
        if (g.weekdays && !g.weekdays.has(wd)) continue;

        let a = g.from ? _toMin(g.from, sunTimes) : 0;
        let b = g.to ? _toMin(g.to, sunTimes) : 24 * 60;
        if (a == null || b == null) continue;
        if (b <= a) {   // plage traversant minuit (1900-0600)
            if (nowMin >= a || nowMin < b) return { state: 'active', detail: `${hhmm(a)}-${hhmm(b)}` };
        } else if (nowMin >= a && nowMin < b) {
            return { state: 'active', detail: `${hhmm(a)}-${hhmm(b)}` };
        } else if (nowMin < a) {
            upcoming ??= { state: 'today', detail: `${hhmm(a)}-${hhmm(b)}` };
        }
    }
    return upcoming || { state: 'off', detail: '' };
}

/**
 * Statut d'activation d'une zone pour l'instant présent.
 * @param {string} zoneKey clé _rdpKey de la zone (« R71 », « D56B »…).
 * @param {Array} notams items plats du dossier courant (structure
 *   js/notam.js : itemD, itemE, startValidity, endValidity, series…).
 * @param {number} [now=Date.now()]
 * @param {{sr:number, ss:number}|null} [sunTimes] lever/coucher à la
 *   position de la zone, en minutes locales (null → approximations).
 * @returns {{status:'ACTIVE'|'PLANIFIEE', detail:string,
 *   notam:{series:string, number:number, year:number}}|null}
 *   null = aucun NOTAM du dossier ne concerne cette zone.
 */
export function zoneActivation(zoneKey, notams, now = Date.now(), sunTimes = null) {
    if (!zoneKey || !Array.isArray(notams) || !notams.length) return null;
    const nowD = new Date(now);
    let planned = null;

    for (const n of notams) {
        if (!notamZoneKeys(n).has(zoneKey)) continue;
        const st = Date.parse(n.startValidity || '');
        const en = Date.parse(n.endValidity || '');
        if (Number.isFinite(st) && now < st) continue;   // pas encore en vigueur
        if (Number.isFinite(en) && now > en) continue;   // périmé

        const groups = parseItemD(n.itemD);
        const r = groups
            ? _statusToday(groups, nowD, sunTimes)
            : { state: 'active', detail: 'H24' };        // sans item D : permanent sur la validité
        const ref = { series: String(n.series || ''), number: n.number || 0, year: n.year || 0 };
        if (r.state === 'active') return { status: 'ACTIVE', detail: r.detail, notam: ref };
        if (r.state === 'today' && !planned) planned = { status: 'PLANIFIEE', detail: r.detail, notam: ref };
    }
    return planned;
}

/**
 * La zone joue-t-elle AUJOURD'HUI — arbitrage pilote 13/09 (B2 v2) :
 * zone active le jour du vol = TRAIT PLEIN de sa couleur ; zone à
 * activation « par NOTAM » (champ hor SIA) sans AUCUNE activation ce
 * jour dans le dossier = POINTILLÉ (représentation SIV, couleur
 * inchangée).
 *
 * Prudence : H24 = toujours pleine ; tout hor ≠ « NOTAM » (HX, HO…) ou
 * zone hors désignateur R/D/P ou dossier non chargé = PLEIN (statu
 * quo — l'absence d'information ne prouve pas l'inactivité).
 *
 * @param {{hor:string|null, key:string|null}} zone hor SIA + clé _rdpKey.
 * @returns {boolean} true = trait plein.
 */
export function zoneActiveToday(zone, notams, now = Date.now(), sunTimes = null) {
    const hor = String(zone?.hor || '').toUpperCase();
    const key = zone?.key;
    if (hor !== 'NOTAM' || !key || !Array.isArray(notams) || !notams.length) return true;
    // PREUVE d'inactivité requise : un NOTAM MENTIONNE la zone (désignateur
    // cité, validité en cours) mais aucune de ses plages ne joue aujourd'hui
    // → pointillé. Un dossier qui ne couvre pas la zone (PIB du couloir,
    // NOTAM hors route) n'est PAS une preuve d'inactivité → trait plein.
    let mentioned = false;
    for (const n of notams) {
        if (!notamZoneKeys(n).has(key)) continue;
        const st = Date.parse(n.startValidity || '');
        const en = Date.parse(n.endValidity || '');
        if ((Number.isFinite(st) && now < st) || (Number.isFinite(en) && now > en)) continue;
        mentioned = true;
        if (zoneActivation(key, [n], now, sunTimes)) return true;   // activation du jour
    }
    return !mentioned;
}
