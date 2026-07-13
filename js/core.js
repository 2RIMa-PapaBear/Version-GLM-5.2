/* ================================================================
 * CORE — Fondations : constantes, état, utilitaires, fetch
 * ================================================================ */

import { PROXY_URL } from './config.local.js';

export const UNIFIED_RED = "#BF360C";
export const PALETTE = ["#1976D2", "#F57C00", "#00ACC1", "#5D4037", "#3949AB", "#455A64"];
export const REGEX_BLOCKS_PATTERN = /(PROB\d{2}\s+TEMPO|PROB\d{2}|TEMPO|BECMG|NOSIG|FM\d{4,6}Z?|TL\d{4}Z?|AT\d{4}Z?)/g;

export const I18N = {
    fr: {
        placeholderIcao: "code oaci ou ville...",
        placeholderTaf: "collez un message taf/metar ici...",
        lblArrival: "Heure d'arrivée prévue (UTC):",
        lblSource: "Source des données :",
        lblAeroHours: "<i data-lucide='sun' class='icon-sm'></i> <i data-lucide='moon' class='icon-sm'></i> Heures Aéronautiques (Lever -30min / Coucher +30min)",
        errNoTaf: "Impossible de lire le message météo.",
        errNoData: "Aucune donnée récente trouvée pour",
        errNetwork: "Erreur de connexion. Vérifiez votre réseau.",
        errInvalidIcao: "Veuillez entrer un code aéroport valide à 4 lettres.",
        errInvalidHpp: "Format d'heure invalide. Utilisez HH:MM.",
        searchInProgress: "Recherche en cours...",
        localTimeFormat: " (Il est actuellement {time} à {name} : {temp}°C, QNH {qnh} hPa [temps réel])",
        footerWarning: "Avertissement : Cet outil est fourni à titre indicatif. Ne pas utiliser pour la préparation des vols.",
        legClr: "Clair", legFew: "Peu", legSct: "Épars",
        legBkn: "Fragmenté", legOvc: "Couvert", legVv: "Invisible",
        
        lblCloud: "Plafond", 
        lblWeather: "Météo", 
        lblVisi: "Visibilité",
        lblWind: "Vent moyen\n(KT)", 
        lblSun: "Soleil",
        lblTemp: "T° / Rosée", 
        lblQnh: "QNH", 
        lblTafTemp: "Temp°",
        
        txtMax: "Max", txtMin: "Mini", prefixLight: "Faible ", prefixHeavy: "Forte ",
        validFrom: "du", validTo: "au", validAt: "à", validH: "h00",
        lblAirport: "Aéroport :", lblSearching: "(Recherche du nom...)", lblObservation: "Observation :",
        aeroDay: "Jour aéro", aeroNight: "Nuit aéro", toggleLangTitle: "Passer en Anglais",
        btnAddFavorite: "<i data-lucide='star' class='icon-sm'></i> Ajouter aux favoris",
        btnReadMetar: "<i data-lucide='volume-2' class='icon-sm'></i> Lire METAR",
        btnStopAudio: "<i data-lucide='square' class='icon-sm'></i> Stop",
        btnBriefingPdf: "Briefing PDF",
        nightModeTitle: "Mode nuit (vision nocturne)",
        favorisTitle: "<i data-lucide='star' class='icon-sm'></i> Favoris",
        favorisEmpty: "Aucun favori. Ajoutez un aéroport avec le bouton ci-dessous.",
        warnClosest: "Attention : Aucun message {type} disponible pour {req}. Affichage du plus proche ({found}).",
        errNoMsgNear: "Aucun message {type} trouvé près de {req}.",
        errDb: "Erreur : Impossible de contacter la base de données des aéroports.",
        errZone: "Erreur : Aucun aéroport compatible trouvé dans la zone.",
        minimaTitle: "<i data-lucide='settings' class='icon-sm'></i> Réglages des Minimums VFR",
        lblCeiling: "Plafond (ft)",
        lblVisi: "Visibilité (m)",
        lblWindThreshold: "Vent (kt)",
        lblGusts: "Rafales (kt)",
        lblTemperature: "Température (°C)",
        lblQnhThreshold: "QNH (hPa)",
        lblWarning: "Préavis (Orange)",
        lblDanger: "Danger (Rouge)",
        lblHigh: "Haut",
        lblLow: "Bas",
        btnSave: "Enregistrer les seuils",
        btnReset: "Valeurs par défaut",
        noAlerts: "<i data-lucide='check-circle' class='icon-sm'></i> Conditions VFR OK",
        lblPlannedArrival: "Heure d'arrivée prévue :",
        lblCeilingUnlimited: "Illimité",
        lblErrorPrefix: "Erreur : ",
        lblGraphTz: "Heures du graphique : UTC (Zulu)",
        lblMetarFrom: "METAR de",
        lblTafFrom: "TAF de",
        alertCeilingWarn: "Plafond bas",
        alertCeilingDang: "Plafond critique",
        alertVisiWarn: "Visibilité réduite",
        alertVisiDang: "Visibilité critique",
        alertWindWarn: "Vent fort",
        alertWindDang: "Vent très fort",
        alertGustWarn: "Rafales fortes",
        alertGustDang: "Rafales critiques",
        alertsTitle: "ALERTES MINIMA VFR",
        configThresholds: "Configurer",
        noRecentSearch: "Aucune recherche récente.",
        clearHistory: "Vider l'historique",
        alertThunderstorm: "Orage",
        alertCumulonimbus: "Cumulonimbus",
        alertToweringCu: "Towering Cumulus",
        alertHail: "Grêle",
        alertIcing: "Givrage",
        dicoMeteo: {
            "RA":"Pluie","SN":"Neige","DZ":"Bruine","GR":"Grêle","GS":"Grésil",
            "SG":"Neige en grains","IC":"Cristaux de glace","PL":"Granules de glace",
            "SH":"Averse","TS":"Orage","FZ":"Se congelant","BC":"Bancs",
            "BL":"Chasse-haute","DR":"Chasse-basse","MI":"Mince","PR":"Partiel",
            "FG":"Brouillard","BR":"Brume","HZ":"Brume sèche","FU":"Fumée",
            "VA":"Cendres","DU":"Poussière","SA":"Sable",
            "NSW":"Fin Phéno","VV///":"Ciel invisible"
        },
        // ---- Calques carte régionale (radar / espaces) ----
        mapLayerRadar: "Radar",
        mapLayerAirspaces: "Espaces",
        mapRadarPlay: "Lecture",
        mapRadarPause: "Pause",
        mapRadarAnimationClock: "Horloge animation",
        mapRadarLayers: "Couches radar",
        mapAirspacesTitle: "Espaces aériens (CTR, TMA, classes...)",
        mapPrecipAnimation: "Animation précipitations",
        // ---- PIREPs & info terrain (Phase 4) ----
        freqsAndAirfieldInfo: "Fréquences & info terrain",
        pirepTitle: "PIREP",
        // ---- UX Phase 5 (cockpit, share) ----
        cockpitModeTitle: "Briefing express (vue cockpit)",
        shareTitle: "Partager ce briefing",
        // ---- Watchdog Phase 6 ----
        watchdogTitle: "Surveillance des favoris"
    },
    en: {
        placeholderIcao: "icao code or city...",
        placeholderTaf: "paste a taf/metar message here...",
        lblArrival: "Planned arrival time (UTC):",
        lblSource: "Weather data source:",
        lblAeroHours: "<i data-lucide='sun' class='icon-sm'></i> <i data-lucide='moon' class='icon-sm'></i> Aeronautical Hours (Sunrise -30m / Sunset +30m)",
        errNoTaf: "Unable to parse weather message.", errNoData: "No recent data found for",
        errNetwork: "Connection error. Please check your network.", errInvalidIcao: "Please enter a valid 4-letter code.",
        errInvalidHpp: "Invalid time format. Use HH:MM.", searchInProgress: "Searching...",
        localTimeFormat: " (Currently at {time} in {name}: {temp}°C, QNH {qnh} hPa [live])",
        footerWarning: "Warning: Informational purposes only. Do not use for flight preparation.",
        legClr: "Clear", legFew: "Few", legSct: "Scattered", legBkn: "Broken", legOvc: "Overcast", legVv: "Invisible",
        
        lblCloud: "Ceiling", 
        lblWeather: "Weather", 
        lblVisi: "Visibility", 
        lblWind: "Avg Wind\n(KT)", 
        lblSun: "Sun",
        lblTemp: "Temp/Dew", 
        lblQnh: "QNH", 
        lblTafTemp: "Temp°",
        
        txtMax: "Max", txtMin: "Min", prefixLight: "Light ", prefixHeavy: "Heavy ",
        validFrom: "from", validTo: "to", validAt: "at", validH: ":00",
        lblAirport: "Airport:", lblSearching: "(Searching name...)", lblObservation: "Observation:",
        aeroDay: "Aero Day", aeroNight: "Aero Night", toggleLangTitle: "Switch to French",
        btnAddFavorite: "<i data-lucide='star' class='icon-sm'></i> Add to favorites",
        btnReadMetar: "<i data-lucide='volume-2' class='icon-sm'></i> Read METAR",
        btnStopAudio: "<i data-lucide='square' class='icon-sm'></i> Stop",
        btnBriefingPdf: "Briefing PDF",
        nightModeTitle: "Night mode (night vision)",
        favorisTitle: "<i data-lucide='star' class='icon-sm'></i> Favorites",
        favorisEmpty: "No favorites. Add an airport below.",
        warnClosest: "Warning: No {type} message available for {req}. Displaying the closest one ({found}).",
        errNoMsgNear: "No {type} message found near {req}.",
        errDb: "Error: Unable to contact the airport database.",
        errZone: "Error: No compatible airport found in this area.",
        minimaTitle: "<i data-lucide='settings' class='icon-sm'></i> VFR Minima Settings",
        lblCeiling: "Ceiling (ft)",
        lblVisi: "Visibility (m)",
        lblWindThreshold: "Wind (kt)",
        lblGusts: "Gusts (kt)",
        lblTemperature: "Temperature (°C)",
        lblQnhThreshold: "QNH (hPa)",
        lblWarning: "Warning (Orange)",
        lblDanger: "Danger (Red)",
        lblHigh: "High",
        lblLow: "Low",
        btnSave: "Save thresholds",
        btnReset: "Reset to default",
        noAlerts: "<i data-lucide='check-circle' class='icon-sm'></i> VFR Conditions OK",
        lblPlannedArrival: "Planned arrival time:",
        lblCeilingUnlimited: "Unlimited",
        lblErrorPrefix: "Error: ",
        lblGraphTz: "Graph times : UTC (Zulu)",
        lblMetarFrom: "METAR from",
        lblTafFrom: "TAF from",
        alertCeilingWarn: "Low ceiling",
        alertCeilingDang: "Critical ceiling",
        alertVisiWarn: "Reduced visibility",
        alertVisiDang: "Critical visibility",
        alertWindWarn: "Strong wind",
        alertWindDang: "Critical wind",
        alertGustWarn: "Strong gusts",
        alertGustDang: "Critical gusts",
        alertsTitle: "VFR MINIMA ALERTS",
        configThresholds: "Configure",
        noRecentSearch: "No recent searches.",
        clearHistory: "Clear History",
        alertThunderstorm: "Thunderstorm",
        alertCumulonimbus: "Cumulonimbus",
        alertToweringCu: "Towering Cumulus",
        alertHail: "Hail",
        alertIcing: "Icing",
        dicoMeteo: {
            "RA":"Rain","SN":"Snow","DZ":"Drizzle","GR":"Hail","GS":"Small Hail",
            "SG":"Snow Grains","IC":"Ice Crystals","PL":"Ice Pellets",
            "SH":"Showers","TS":"Thunderstorm","FZ":"Freezing","BC":"Patches",
            "BL":"Blowing","DR":"Low Drifting","MI":"Shallow","PR":"Partial",
            "FG":"Fog","BR":"Mist","HZ":"Haze","FU":"Smoke",
            "VA":"Volcanic Ash","DU":"Dust","SA":"Sand",
            "NSW":"No Sig Weather","VV///":"Invisible Sky"
        },
        // ---- Regional map layers (radar / airspaces) ----
        mapLayerRadar: "Radar",
        mapLayerAirspaces: "Airspaces",
        mapRadarPlay: "Play",
        mapRadarPause: "Pause",
        mapRadarAnimationClock: "Animation clock",
        mapRadarLayers: "Radar layers",
        mapAirspacesTitle: "Airspaces (CTR, TMA, classes...)",
        mapPrecipAnimation: "Precipitation animation",
        // ---- PIREPs & airfield info (Phase 4) ----
        freqsAndAirfieldInfo: "Frequencies & airfield info",
        pirepTitle: "PIREP",
        // ---- UX Phase 5 (cockpit, share) ----
        cockpitModeTitle: "Briefing express (cockpit view)",
        shareTitle: "Share this briefing",
        // ---- Watchdog Phase 6 ----
        watchdogTitle: "Favorites watchdog"
    }
};

export const MEMO_MAX = 50;

// ================================================================
// Store — État global encapsulé
// ================================================================
// L'état est divisé en domaines fonctionnels pour rendre le flux
// de données traçable. Chaque domaine expose des getters/setters
// nommés au lieu d'un accès direct aux propriétés.
// ================================================================

const _state = {
    // --- Langue & i18n ---
    lang: 'fr',

    // --- Requête en cours ---
    isMetar: false,
    warningMessage: '',
    lastCacheKey: null,
    lastParsed: null,
    lastRenderState: null,
    // Code OACI demandé par l'utilisateur (peut différer de res.code quand on
    // affiche le terrain le plus proche). Sert à récupérer les pistes du terrain
    // d'atterrissage réel, pas du terrain dont la météo est affichée.
    requestedIcao: null,

    // --- Interaction graphique ---
    manualTargetHour: null,
    forcedRunway: null,
    isDragging: false,
    graphMetrics: null,
    sunLineHitboxes: [],

    // --- Cache (internes, accédés via sunCacheGet/Set & memoGet/Set) ---
    _sunCache: {},
    _sunCacheOrder: [],
    _memo: {},
    _memoOrder: [],

    // --- Timers / RAF ---
    rafId: null,
    horlogeInterval: null,
    debounceTimer: null,

    // --- Callbacks ---
    refreshCallback: null,

    // --- UI transitoire ---
    baseInfoString: '',
};

/**
 * Store public — seul point d'accès à l'état global.
 * L'objet lui-même est immutable (freeze) ; les propriétés internes
 * sont accessibles en lecture via les getters ci-dessous et en écriture
 * via les setters. Cela permet d'ajouter des logs, de la validation
 * ou de la réactivité ultérieurement sans casser les modules consommateurs.
 */
export const state = new Proxy(_state, {
    get(target, prop) {
        return target[prop];
    },
    set(target, prop, value) {
        const old = target[prop];
        target[prop] = value;
        return true;
    },
});

// Pour rétro-compatibilité : `sunCache` et `memo` sont désormais
// des propriétés virtuelles qui délèguent aux préfixes internes.
Object.defineProperty(_state, 'sunCache', {
    get() { return _state._sunCache; },
    set(v) { _state._sunCache = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'sunCacheOrder', {
    get() { return _state._sunCacheOrder; },
    set(v) { _state._sunCacheOrder = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'memo', {
    get() { return _state._memo; },
    set(v) { _state._memo = v; },
    enumerable: true,
});
Object.defineProperty(_state, 'memoOrder', {
    get() { return _state._memoOrder; },
    set(v) { _state._memoOrder = v; },
    enumerable: true,
});
// Supprime currentLanguage (doublon de lang, jamais lu) — ignoré par le proxy.
// Supprime lastLoadedICAO et lastFocusedElement (jamais utilisés).

export function sunCacheSet(key, val) {
    if (!state.sunCache[key]) {
        state.sunCacheOrder.push(key);
        if (state.sunCacheOrder.length > MEMO_MAX) delete state.sunCache[state.sunCacheOrder.shift()];
    }
    state.sunCache[key] = val;
}
export function sunCacheGet(key) { return state.sunCache[key]; }

export function memoSet(icao, val) {
    if (!state.memo[icao]) {
        state.memoOrder.push(icao);
        if (state.memoOrder.length > MEMO_MAX) delete state.memo[state.memoOrder.shift()];
    }
    state.memo[icao] = val;
}
export function memoGet(icao) { return state.memo[icao]; }

export function parseVisiToMeters(visiStr) {
    if (!visiStr) return 10000;
    if (visiStr.includes('9999') || visiStr.includes('CAVOK')) return 10000;
    const smMatch = visiStr.match(/([PM]?)(\d+)?\s?(?:(\d+)\/(\d+))?SM/);
    if (smMatch) {
        const whole = parseInt(smMatch[2]) || 0;
        const num   = parseInt(smMatch[3]) || 0;
        const den   = parseInt(smMatch[4]) || 1;
        return Math.round((whole + num / den) * 1609.34);
    }
    const mMatch = visiStr.match(/(\d{4})/);
    return mMatch ? parseInt(mMatch[1], 10) : 10000;
}

/**
 * Trouve la valeur active d'un bloc de données à une heure cible donnée.
 * Parcourt les blocs du dernier au premier ; retourne la valeur du premier bloc
 * dont la plage [start, end) contient targetHour et dont val est truthy.
 */
export function findActiveValueAtHour(blocks, targetHour) {
    if (!blocks || !blocks.length) return null;
    for (let i = blocks.length - 1; i >= 0; i--) {
        const b = blocks[i];
        if (targetHour >= b.start && targetHour < b.end && b.val) return b.val;
    }
    return null;
}

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

export function getFlightCategory(visiM, ceilHundFt) {
    if (ceilHundFt < 5  || visiM < 1600) return { cat: 'LIFR', class: 'cat-lifr' };
    if (ceilHundFt < 10 || visiM < 4800) return { cat: 'IFR',  class: 'cat-ifr'  };
    if (ceilHundFt <= 30 || visiM <= 8000) return { cat: 'MVFR', class: 'cat-mvfr' };
    return { cat: 'VFR', class: 'cat-vfr' };
}

export function getWeatherIcon(nuageStr, tempsStr) {
    if (tempsStr) {
        const t = tempsStr.toLowerCase();
        if (t.includes('orage') || t.includes('thunderstorm') || t.includes('ts')) return 'cloud-lightning';
        if (t.includes('neige') || t.includes('snow') || t.includes('grésil') || t.includes('hail') || t.includes('gr')) return 'cloud-snow';
        if (t.includes('pluie') || t.includes('rain') || t.includes('averse') || t.includes('showers') || t.includes('bruine') || t.includes('drizzle') || t.includes('dz')) return 'cloud-rain';
        if (t.includes('brouillard') || t.includes('fog') || t.includes('brume') || t.includes('mist') || t.includes('fg')) return 'cloud-fog';
    }
    if (nuageStr) {
        if (nuageStr.includes('VV')) return 'cloud-fog';
        if (nuageStr.includes('OVC')) return 'cloud';
        if (nuageStr.includes('BKN')) return 'cloudy';
        if (nuageStr.includes('SCT')) return 'cloud-sun';
        if (nuageStr.includes('FEW')) return 'sun';
    }
    return 'sun';
}

export function inferStartYear(day, month) {
    const now = new Date();
    let year = now.getFullYear();
    const tafDate = new Date(year, month - 1, day);
    const today   = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    if ((tafDate - today) / (1000 * 60 * 60 * 24) > 2) year--;
    return year;
}

export function traduireCode(codeBrut) {
    if (!codeBrut) return '';
    const tr = I18N[state.lang];
    const dico = tr.dicoMeteo;
    return codeBrut.split(' ').map(token => {
        if (!token) return '';
        if (dico[token]) return dico[token];
        let prefixe = '', reste = token;
        if (reste.startsWith('-')) { prefixe = tr.prefixLight; reste = reste.substring(1); }
        else if (reste.startsWith('+')) { prefixe = tr.prefixHeavy; reste = reste.substring(1); }
        const parts = [];
        for (let i = 0; i < reste.length; i += 2) {
            const chunk = reste.substring(i, i + 2);
            parts.push(dico[chunk] || chunk);
        }
        return prefixe + parts.join(' ');
    }).filter(Boolean).join(' ');
}

const _escapeEl = typeof document !== 'undefined' ? document.createElement('div') : null;
export function escapeHtml(text) {
    if (!_escapeEl) return text;
    _escapeEl.textContent = text;
    return _escapeEl.innerHTML;
}

// ----------------------------------------------------------------
// Revêtements de piste — traduction des codes (ASP, GRE, CON...)
// Défini ici (core) pour être réutilisable sans cycle d'import.
// ----------------------------------------------------------------
export const SURFACE_LABELS = {
    ASP: { fr: 'Asphalte', en: 'Asphalt' },
    BIT: { fr: 'Bitume traité', en: 'Bituminous' },
    BRI: { fr: 'Briques', en: 'Brick' },
    CLA: { fr: 'Argile', en: 'Clay' },
    COM: { fr: 'Composite', en: 'Composite' },
    CON: { fr: 'Béton', en: 'Concrete' },
    COP: { fr: 'Composite dur', en: 'Composite' },
    COR: { fr: 'Corail', en: 'Coral' },
    GRE: { fr: 'Terre tassée', en: 'Graded dirt' },
    GRS: { fr: 'Herbe', en: 'Grass' },
    GVL: { fr: 'Gravier', en: 'Gravel' },
    ICE: { fr: 'Glace', en: 'Ice' },
    LAT: { fr: 'Latérite', en: 'Laterite' },
    MAC: { fr: 'Macadam', en: 'Macadam' },
    MEM: { fr: 'Membrane', en: 'Membrane' },
    MIX: { fr: 'Mixte traité', en: 'Treated mix' },
    PEM: { fr: 'Part-béton', en: 'Part-concrete' },
    PER: { fr: 'Permanent', en: 'Permanent' },
    PSP: { fr: 'Tôles', en: 'Steel planking' },
    SAN: { fr: 'Sable', en: 'Sand' },
    SNO: { fr: 'Neige', en: 'Snow' },
    U:   { fr: 'Inconnu', en: 'Unknown' },
    WAT: { fr: 'Eau (hydravion)', en: 'Water' },
};

// Codes "mous" (sensibles à l'humidité, roulement allongé).
export const SOFT_SURFACES = new Set(['GRE', 'GRS', 'GVL', 'CLA', 'SAN', 'LAT']);

/**
 * Traduit un code de revêtement en texte.
 * @param {string} code
 * @param {string} [lang] 'fr'/'en', défaut state.lang.
 */
export function surfaceLabel(code, lang) {
    const l = lang || (state.lang) || 'fr';
    const info = SURFACE_LABELS[code];
    if (!info) return code || '—';
    return l === 'fr' ? info.fr : info.en;
}

/**
 * Proxy météo.
 *
 * aviationweather.gov ne supporte pas CORS → on passe par un proxy Google
 * Apps Script dont l'URL est définie dans js/config.local.js (fichier séparé,
 * gitignoré). L'URL reste visible côté navigateur (inévitable en 100% statique)
 * mais elle est ainsi centralisée et isolée du code applicatif.
 *
 * Nominatim et Open-Meteo supportent CORS nativement → appel direct.
 */
export async function fetchAvecRelais(url, type = 'text') {
    // Nominatim supporte CORS nativement — appel direct.
    if (url.includes('nominatim.openstreetmap.org')) {
        try {
            const res = await fetch(url);
            if (!res.ok) throw new Error("Erreur de l'API de recherche de ville");
            return type === 'json' ? await res.json() : await res.text();
        } catch (e) {
            throw new Error("Lieu introuvable sur la carte ou service surchargé.");
        }
    }

    const proxyUrl = `${PROXY_URL}?url=${encodeURIComponent(url)}`;
    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 25000);
        const res = await fetch(proxyUrl, { signal: controller.signal });
        clearTimeout(timeoutId);
        const rawData = await res.text();

        if (rawData.startsWith('PROXY_ERROR:')) throw new Error(`Google n'a pas pu joindre la cible : ${rawData}`);
        if (rawData.trim().startsWith('<') && !rawData.toLowerCase().includes('<?xml')) throw new Error("HTML inattendu reçu au lieu des données météo.");

        return type === 'json' ? JSON.parse(rawData) : rawData;
    } catch (e) {
        if (e.name === 'AbortError') throw new Error("Délai d'attente dépassé (plus de 25s). Réessayez la recherche.");
        throw e;
    }
}

// ----------------------------------------------------------------
// File d'attente pour Open-Meteo (évite le rate-limit HTTP 429).
// L'API gratuite limite le nombre de requêtes par minute. On sérialise
// les appels avec un délai et un cache session pour éviter les doublons.
// ----------------------------------------------------------------
let _omRunning = false;
const _omCache = new Map();
const _omPending = new Map(); // url → Promise (pour dédupliquer les appels simultanés)
const _OM_DELAY = 1500;       // ms entre chaque appel Open-Meteo.
const _OM_RETRY_BASE = 3000;  // ms délai de base pour retry sur 429.

/**
 * Fetch Open-Meteo avec file d'attente, déduplication et cache session.
 * @param {string} url URL Open-Meteo complète.
 * @returns {Promise<Object|null>} Données JSON, ou null si échec.
 */
export async function fetchOpenMeteo(url) {
    // Cache session (5 min) : évite de refetcher la même URL.
    const cached = _omCache.get(url);
    if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;

    // Déduplication : si la même URL est déjà en cours, on partage le résultat.
    if (_omPending.has(url)) return _omPending.get(url);

    const promise = _omFetchQueued(url);
    _omPending.set(url, promise);
    try {
        const data = await promise;
        return data;
    } finally {
        _omPending.delete(url);
    }
}

async function _omFetchQueued(url) {
    // Attend que les requêtes précédentes soient terminées.
    while (_omRunning) {
        await new Promise(r => setTimeout(r, 100));
    }
    _omRunning = true;

    try {
        // Re-vérifie le cache au cas où une requête identique vient de finir.
        const cached = _omCache.get(url);
        if (cached && Date.now() - cached.ts < 5 * 60 * 1000) return cached.data;

        // Retry avec backoff exponentiel sur 429.
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const res = await fetch(url);
                if (res.status === 429) {
                    const wait = _OM_RETRY_BASE * (attempt + 1);
                    console.warn(`Open-Meteo 429, retry ${attempt + 1}/3 dans ${wait}ms`);
                    await new Promise(r => setTimeout(r, wait));
                    continue;
                }
                if (!res.ok) {
                    console.warn(`Open-Meteo HTTP ${res.status}`);
                    return null;
                }
                const data = await res.json();
                _omCache.set(url, { data, ts: Date.now() });
                return data;
            } catch (e) {
                console.warn('Open-Meteo fetch error:', e.message);
                return null;
            }
        }
        console.warn('Open-Meteo: 3 retries épuisés pour', url.slice(0, 60));
        return null;
    } finally {
        // Délai avant de libérer pour la prochaine requête.
        await new Promise(r => setTimeout(r, _OM_DELAY));
        _omRunning = false;
    }
}