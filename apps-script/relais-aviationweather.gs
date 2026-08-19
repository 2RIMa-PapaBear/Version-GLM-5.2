/**
 * =====================================================================
 * RELAI CORS AviationWeather — avec cache court-terme (CacheService)
 * =====================================================================
 * DÉPLOYEMENT (important — ne pas créer un NOUVEAU déploiement, l'URL
 * changerait et l'app devrait être reconfigurée) :
 *   1. Ouvrir https://script.google.com → le projet du relai.
 *   2. Remplacer tout le code par ce fichier.
 *   3. Déployer → Gérer les déploiements → ✎ Modifier → Version :
 *      « Nouvelle version » → Déployer.
 *
 * Contrat côté client (js/core.js, fetchAvecRelais) :
 *   GET /exec?url=<cible encodée>[&ttl=secondes]
 *   → corps texte brut de la cible ; « PROXY_ERROR: … » en cas d'échec.
 *
 * Cache (motif des gels/404/latences Google observés 2026-08-19 : le
 * cache court-circuite les cold starts et le routage edge instable) :
 *   - clé = SHA-256 de l'URL cible ; valeur ≤ 90 Ko (limite Google 100 Ko) ;
 *   - TTL par défaut 180 s ; &ttl= l'ajuste (30 s à 3600 s). Le client
 *     appelle stationinfo (quasi statique) avec &ttl=3600 ;
 *   - jamais de cache pour les pages HTML d'erreur d'AviationWeather sous
 *     charge : le client les détecte et retente, les cacher rendrait les
 *     3 tentatives identiques et les ferait toutes échouer.
 *
 * Sécurité quota : le relai n'accepte QUE aviationweather.gov. Le script
 * est public (« Tout le monde ») : sans allowlist, quiconque connaît
 * l'URL pourrait s'en servir comme proxy ouvert et brûler le quota
 * quotidien UrlFetchApp. Pour autoriser un autre hôte : ALLOWED_HOSTS.
 */

const DEFAULT_TTL_SEC = 180;
const MIN_TTL_SEC = 30;
const MAX_TTL_SEC = 3600;
const MAX_CACHEABLE_CHARS = 90000;   // limite CacheService : 100 Ko / valeur
const ALLOWED_HOSTS = ['aviationweather.gov'];

function doGet(e) {
    const url = String(e.parameter.url || '').trim();
    const hostMatch = url.match(/^https?:\/\/([^\/?#:]+)/i);
    const host = (hostMatch ? hostMatch[1] : '').toLowerCase();
    const allowed = ALLOWED_HOSTS.some(h => host === h || host.endsWith('.' + h));
    if (!hostMatch || !allowed) {
        return ContentService.createTextOutput(
            'PROXY_ERROR: paramètre url manquant, invalide ou hôte non autorisé');
    }

    // TTL optionnel demandé par le client, borné.
    let ttl = DEFAULT_TTL_SEC;
    const reqTtl = parseInt(e.parameter.ttl, 10);
    if (!isNaN(reqTtl)) ttl = Math.min(MAX_TTL_SEC, Math.max(MIN_TTL_SEC, reqTtl));

    const key = 'wx:' + Utilities.base64EncodeWebSafe(
        Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, url)).substring(0, 40);

    const cache = CacheService.getScriptCache();
    const hit = cache.get(key);
    if (hit !== null) return ContentService.createTextOutput(hit);

    let body;
    try {
        const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
        const code = res.getResponseCode();
        body = res.getContentText();
        if (code !== 200) {
            return ContentService.createTextOutput(
                'PROXY_ERROR: HTTP ' + code + ' — ' + body.substring(0, 200));
        }
    } catch (err) {
        return ContentService.createTextOutput('PROXY_ERROR: ' + err);
    }

    const looksHtml = body.trim().startsWith('<');   // page d'erreur → pas de cache
    if (!looksHtml && body.length <= MAX_CACHEABLE_CHARS) {
        try { cache.put(key, body, ttl); } catch (err) { /* quota cache dépassé : ignorer */ }
    }
    return ContentService.createTextOutput(body);
}
