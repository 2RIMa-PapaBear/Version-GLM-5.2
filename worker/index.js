/* ================================================================
 * RELAIS MÉTÉO CORS — Cloudflare Worker
 * ================================================================
 * Remplace le relais Google Apps Script (sujet à des phases de
 * surcharge de 8-34 s). Même contrat d'appel :
 *   ?url=<https cible encodée>&ttl=<secondes optionnel>
 *
 * - Cibles autorisées : aviationweather.gov (METAR/TAF/SIGMET/
 *   stations/PIREP), nominatim.openstreetmap.org (recherche
 *   terrain) et sia.aviation-civile.gouv.fr — pour ce dernier,
 *   UNIQUEMENT les PDF de cartes d'aérodrome de l'eAIP (VAC/ADC),
 *   servis en BINAIRE avec cache périphérique de 7 jours (l'URL
 *   contient le cycle AIRAC : elle change à chaque cycle, jamais
 *   périmée). RIEN d'autre : personne ne peut détourner ce relais
 *   pour consommer le quota gratuit du compte (100 k req/jour).
 * - Cache périphérique : 180 s par défaut, paramètre ttl honoré
 *   (30 s mini, 24 h maxi) — mêmes règles que l'ancien relais.
 * - Échec de la cible (réseau ou HTTP) : HTTP 200 + corps 'PROXY_ERROR: …',
 *   le contrat exact de l'ancien relais Apps Script — l'app échoue proprement
 *   sans retry ni erreur console (l'endpoint /api/data/atis, supprimé côté
 *   AviationWeather en 2025, répond 404 à chaque chargement de terrain).
 * - HEAD sans paramètre : 200 immédiat (sondage du watchdog).
 * ================================================================ */

const HOSTS_AUTORISES = new Set([
    'aviationweather.gov',
    'nominatim.openstreetmap.org',
]);

// Cartes PDF de l'eAIP SIA :
//   /media/dvd/eAIP_06_AUG_2026/FRANCE/AIRAC-2026-08-06/html/eAIP/
//   Cartes/LFRS/AD_2_LFRS_ADC_01.pdf   (ADC = carte d'aérodrome, MIA = insertion)
const SIA_CARTE_PDF = /^\/media\/dvd\/eAIP_[A-Z0-9_]+\/FRANCE\/AIRAC-\d{4}-\d{2}-\d{2}\/html\/eAIP\/Cartes\/[A-Z0-9]{4}\/AD_2_[A-Z0-9]{4}_[A-Z0-9_]+\.pdf$/;

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

const TTL_PDF_SEC = 7 * 86400;   // cartes AIRAC : URL par cycle, jamais périmée

export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        if (request.method === 'POST' && url.pathname === '/notam') {
            try {
                return await pibNotam(request);
            } catch (e) {
                return reponse(502, JSON.stringify({ error: String(e.message || e).slice(0, 200) }), 'application/json');
            }
        }
        return handleGet(request, env, ctx);
    },
};

async function handleGet(request, env, ctx) {
        if (request.method === 'OPTIONS') return reponse(204, null);
        if (request.method === 'HEAD') return reponse(200, null);
        if (request.method !== 'GET') return reponse(405, 'Méthode non supportée');
        if (request.method === 'OPTIONS') return reponse(204, null);
        if (request.method === 'HEAD') return reponse(200, null);
        if (request.method !== 'GET') return reponse(405, 'Méthode non supportée');

        const params = new URL(request.url).searchParams;
        const cibleBrute = params.get('url');
        if (!cibleBrute) return reponse(400, '<ERREUR paramètre url manquant/>');

        let cible;
        try { cible = new URL(cibleBrute); } catch { return reponse(400, '<ERREUR url invalide/>'); }

        const estSiaCarte = cible.hostname === 'www.sia.aviation-civile.gouv.fr' && SIA_CARTE_PDF.test(cible.pathname);
        const hoteAutorise = HOSTS_AUTORISES.has(cible.hostname)
            || cible.hostname.endsWith('.aviationweather.gov')
            || estSiaCarte;
        if (cible.protocol !== 'https:' || !hoteAutorise) {
            return reponse(403, '<ERREUR hôte non autorisé/>');
        }

        const ttl = estSiaCarte ? TTL_PDF_SEC
            : Math.min(86400, Math.max(30, parseInt(params.get('ttl') || '180', 10) || 180));

        // 1) Cache périphérique d'abord — c'est lui qui rend les hits ~instantanés.
        const cache = caches.default;
        const cle = new Request(cible.toString(), { method: 'GET' });
        const enCache = await cache.match(cle);
        if (enCache) {
            const sortie = reponse(200, enCache.body, enCache.headers.get('Content-Type'));
            sortie.headers.set('X-Cache', 'HIT');
            return sortie;
        }

        // 2) Miss : aller chercher la donnée à la source.
        //    Contrat de l'ancien relais Apps Script, reproduit à l'identique :
        //    tout échec amont est renvoyé en HTTP 200 avec le préfixe
        //    'PROXY_ERROR:' — l'app le détecte et échoue proprement SANS retry
        //    ni erreur console (cas quotidien : /api/data/atis répond 404 pour
        //    tout terrain depuis la refonte 2025 de l'API AviationWeather).
        let amont;
        try {
            amont = await fetch(cible.toString(), {
                headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' },
                redirect: 'follow',
            });
        } catch (e) {
            return reponse(200, `PROXY_ERROR: ${e.message}`);
        }
        if (amont.status !== 200 && amont.status !== 204) {
            const extrait = (await amont.text()).substring(0, 200);
            return reponse(200, `PROXY_ERROR: HTTP ${amont.status} — ${extrait}`);
        }

        // PDF (binaire) : réponse binaire CORS + cache périphérique long.
        const typeAmont = amont.headers.get('Content-Type') || 'text/plain';
        if (typeAmont.includes('application/pdf')) {
            const buf = await amont.arrayBuffer();
            const sortie = reponse(200, buf, 'application/pdf');
            sortie.headers.set('X-Cache', 'MISS');
            ctx.waitUntil(cache.put(cle, new Response(buf, {
                headers: { 'Content-Type': 'application/pdf', 'Cache-Control': `public, max-age=${TTL_PDF_SEC}` },
            })));
            return sortie;
        }

        const corps = await amont.text();
        const type = typeAmont;
        const sortie = reponse(200, corps, type);
        sortie.headers.set('X-Cache', 'MISS');

        // 3) Stocker en cache — sauf page HTML d'erreur d'AviationWeather
        //    (sinon on servirait une erreur pendant tout le ttl).
        const estPageHtml = corps.trim().startsWith('<') && !corps.toLowerCase().includes('<?xml');
        if (!estPageHtml) {
            const aStocker = new Response(corps, {
                headers: {
                    'Content-Type': type,
                    'Cache-Control': `public, max-age=${ttl}`,
                },
            });
            ctx.waitUntil(cache.put(cle, aStocker));
        }
        return sortie;
}

// ----------------------------------------------------------------
// POST /notam — PIB NOTAM officiel SOFIA-Briefing pour un plan de
// vol (10/09). Entrée JSON : { route:[OACI…], validFrom, durationMin,
// flLower, flUpper, widthNm, radiusAdNm }. Le Worker joue la session
// (cookie JSESSIONID) puis l'opération postNarrowRoutePibRequest, et
// renvoie le PIB JSON INTERNE (double parse fait ici). Cible FIXÉE
// (hôte + opération) : ce relais ne peut pas être détourné en proxy
// générique. Pas de cache : les NOTAM doivent être frais.
// ----------------------------------------------------------------
async function pibNotam(request) {
    const SOFIA = 'https://sofia-briefing.aviation-civile.gouv.fr';
    const params = await request.json();
    const route = (params.route || []).filter(c => /^[A-Z][A-Z0-9]{3}$/.test(String(c || '').toUpperCase()));
    if (route.length < 1) return reponse(400, JSON.stringify({ error: 'route vide' }), 'application/json');

    // 1. Session (cookie) — un GET préalable suffit.
    const page = await fetch(`${SOFIA}/sofia/pages/notamform.html`, { headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' } });
    const cookie = (page.headers.get('Set-Cookie') || '').split(';')[0];

    // 2. Requête PIB (contrat reverse-engineéré — cf mémoire notam-sofia-api).
    const body = new URLSearchParams({
        ':operation': params.area ? 'postAreaPibRequest' : 'postNarrowRoutePibRequest',
        'valid_from': params.validFrom || new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        'duration': String(params.durationMin || 1200),
        'traffic': 'V',   // VFR uniquement (retour pilote 10/09 : exclure les NOTAM IFR-only)
        'fl_lower': String(params.flLower ?? 0),
        'fl_upper': String(params.flUpper ?? 999),
        'width': String(params.widthNm || 15),
        'radiusAD': String(params.radiusAdNm || 30),
        'uuid': crypto.randomUUID(),
        'isFromSofia': 'true',
    });
    if (params.area) {
        // Mode VOL LOCAL (retour pilote 10/09) : cylindre autour du terrain.
        body.set('lat', String(params.area.lat || ''));
        body.set('long', String(params.area.long || ''));
        body.set('radius', String(params.area.radiusNm || 30));
    } else {
        route.forEach(c => body.append('route[]', c));
    }

    const appelSofia = async (extra) => {
        const b = new URLSearchParams(body);
        for (const [k, v] of Object.entries(extra || {})) b.set(k, v);
        const res = await fetch(`${SOFIA}/sofia`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                ...(cookie ? { 'Cookie': cookie } : {}),
                'Referer': `${SOFIA}/sofia/pages/notamform.html`,
                'X-Requested-With': 'XMLHttpRequest',
                'Accept': 'application/json, text/javascript, */*; q=0.01',
                'User-Agent': 'papabear56-meteo-relais/1.0',
            },
            body: b.toString(),
        });
        const txt = await res.text();
        if (res.status !== 200 || !txt.trim().startsWith('{')) throw new Error(`SOFIA HTTP ${res.status}`);
        return JSON.parse(JSON.parse(txt)['status.message']);
    };

    const inner = await appelSofia({});
    if (!inner || !inner.listnotams) throw new Error('PIB sans listnotams');

    // Dossiers des POINTS DE PASSAGE (retour pilote 10/09) : SOFIA ne remplit
    // ADDep/ADDes que pour le premier/dernier terrain — chaque tronçon partant
    // du point de passage rapporte SON dossier (vérifié : LFRV→1, LFRC→6).
    // Appels parallèles côté Worker, ajoutés comme waypointDossiers.
    const legs = Array.isArray(params.legs) ? params.legs : [];
    if (legs.length) {
        const dossiers = await Promise.all(legs.map(async ([a, b]) => {
            if (!/^[A-Z][A-Z0-9]{3}$/.test(a) || !/^[A-Z][A-Z0-9]{3}$/.test(b)) return [a, null];
            try {
                // Corps tronçon PROPRE : opération narrow-route SANS les
                // paramètres zone (lat/long/radius) — sinon SOFIA répond une
                // zone sans dossier AD (bug « NOTAM AD absents en vol local »).
                const lp = new URLSearchParams();
                for (const [k, v] of body.entries()) {
                    if (k === 'route[]' || k === 'lat' || k === 'long' || k === 'radius') continue;
                    if (k === ':operation') { lp.set(k, 'postNarrowRoutePibRequest'); continue; }
                    lp.append(k, v);
                }
                lp.append('route[]', a); lp.append('route[]', b);
                const res = await fetch(`${SOFIA}/sofia`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/x-www-form-urlencoded',
                        ...(cookie ? { 'Cookie': cookie } : {}),
                        'Referer': `${SOFIA}/sofia/pages/notamform.html`,
                        'X-Requested-With': 'XMLHttpRequest',
                        'Accept': 'application/json, text/javascript, */*; q=0.01',
                        'User-Agent': 'papabear56-meteo-relais/1.0',
                    },
                    body: lp.toString(),
                });
                const t = await res.text();
                if (res.status !== 200 || !t.trim().startsWith('{')) return [a, null];
                const leg = JSON.parse(JSON.parse(t)['status.message']);
                const dep = {};
                let n = 0;
                for (const [cat, list] of Object.entries(leg.listnotams?.ADDep || {}))
                    if (Array.isArray(list) && list.length) { dep[cat] = list; n += list.length; }
                return [a, n ? dep : {}];
            } catch { return [a, null]; }
        }));
        inner.waypointDossiers = Object.fromEntries(dossiers.filter(([a]) => a));
    }
    return reponse(200, JSON.stringify(inner), 'application/json');
}

function reponse(statut, corps, type = 'text/plain') {
    return new Response(corps, { status: statut, headers: { ...CORS, 'Content-Type': type } });
}
