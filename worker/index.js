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
    },
};

function reponse(statut, corps, type = 'text/plain') {
    return new Response(corps, { status: statut, headers: { ...CORS, 'Content-Type': type } });
}
