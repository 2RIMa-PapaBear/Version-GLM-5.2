/* ================================================================
 * RELAIS MÉTÉO CORS — Cloudflare Worker
 * ================================================================
 * Remplace le relais Google Apps Script (sujet à des phases de
 * surcharge de 8-34 s). Même contrat d'appel :
 *   ?url=<https cible encodée>&ttl=<secondes optionnel>
 *
 * - Cibles autorisées : aviationweather.gov (METAR/TAF/SIGMET/
 *   stations/PIREP) et nominatim.openstreetmap.org (recherche
 *   terrain). RIEN d'autre : personne ne peut détourner ce relais
 *   pour consommer le quota gratuit du compte (100 k req/jour).
 * - Cache périphérique : 180 s par défaut, paramètre ttl honoré
 *   (30 s mini, 24 h maxi) — mêmes règles que l'ancien relais.
 * - Échec de la cible (réseau ou HTTP) : on répond 502 avec un
 *   corps commençant par '<' — l'app y reconnaît une « page HTML
 *   inattendue » et déclenche son retry habituel avec le message
 *   « AviationWeather momentanément indisponible (réessayez) ».
 * - HEAD sans paramètre : 200 immédiat (sondage du watchdog).
 * ================================================================ */

const HOSTS_AUTORISES = new Set([
    'aviationweather.gov',
    'nominatim.openstreetmap.org',
]);

const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
    'Access-Control-Allow-Headers': '*',
};

export default {
    async fetch(request, env, ctx) {
        if (request.method === 'OPTIONS') return reponse(204, null);
        if (request.method === 'HEAD') return reponse(200, null);
        if (request.method !== 'GET') return reponse(405, 'Méthode non supportée');

        const params = new URL(request.url).searchParams;
        const cibleBrute = params.get('url');
        if (!cibleBrute) return reponse(400, '<ERREUR paramètre url manquant/>');

        let cible;
        try { cible = new URL(cibleBrute); } catch { return reponse(400, '<ERREUR url invalide/>'); }

        const hoteAutorise = HOSTS_AUTORISES.has(cible.hostname)
            || cible.hostname.endsWith('.aviationweather.gov');
        if (cible.protocol !== 'https:' || !hoteAutorise) {
            return reponse(403, '<ERREUR hôte non autorisé/>');
        }

        const ttl = Math.min(86400, Math.max(30, parseInt(params.get('ttl') || '180', 10) || 180));

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
        let amont;
        try {
            amont = await fetch(cible.toString(), {
                headers: { 'User-Agent': 'papabear56-meteo-relais/1.0' },
                redirect: 'follow',
            });
        } catch (e) {
            return reponse(502, `<ERREUR cible injoignable : ${e.message}/>`);
        }
        if (!amont.ok) return reponse(502, `<ERREUR cible HTTP ${amont.status}/>`);

        const corps = await amont.text();
        const type = amont.headers.get('Content-Type') || 'text/plain';
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
    },
};

function reponse(statut, corps, type = 'text/plain') {
    return new Response(corps, { status: statut, headers: { ...CORS, 'Content-Type': type } });
}
