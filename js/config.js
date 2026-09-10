/* ================================================================
 * CONFIG — configuration publique de l'application (aucun secret).
 * ================================================================
 *
 * Valeurs PAR DÉFAUT vides : sans surcharge, la météo est servie en
 * DIRECT depuis aviationweather.gov (API ouverte CORS) et openAIP
 * n'est interrogé qu'avec les fichiers statiques locaux en repli.
 *
 * La surcharge locale — js/config.local.js, GITIGNORÉE car elle porte
 * l'URL du relais Apps Script privé (quota) et la clé openAIP — est
 * appliquée au démarrage par applyLocalOverride() (app.js). Présente
 * en développement et sur le FTP Free.fr, elle est absente du miroir
 * public GitHub Pages : l'application y fonctionne sur les défauts.
 * ================================================================ */

export const config = {
    // Relais CORS Cloudflare (URL publique, aucune donnée secrète) : valeur
    // PAR DÉFAUT pour tous les canaux — le miroir Pages n'a pas de
    // config.local.js (jamais déployé), il lui faut le relais (météo, cartes
    // VAC). config.local.js peut toujours surcharger.
    PROXY_URL: 'https://meteo-relais.papabear56.workers.dev',
    // Route NOTAM du relais (POST /notam, PIB SOFIA) — surchargeable localement
    // via config.local.js (ex. wrangler dev : http://127.0.0.1:8787/notam).
    NOTAM_RELAY_URL: 'https://meteo-relais.papabear56.workers.dev/notam',
    OPENAIP_API_KEY: '',
    // Clé corsproxy.io — repli météo du miroir public quand aviationweather.gov
    // bloque CORS (fréquent : leurs backends n'envoient pas toujours ACAO).
    CORS_PROXY_KEY: '',
};

/** Applique js/config.local.js si présent (silencieux sinon). */
export async function applyLocalOverride() {
    try {
        const m = await import('./config.local.js');
        if (m.PROXY_URL) config.PROXY_URL = m.PROXY_URL;
        if (m.OPENAIP_API_KEY) config.OPENAIP_API_KEY = m.OPENAIP_API_KEY;
        if (m.CORS_PROXY_KEY) config.CORS_PROXY_KEY = m.CORS_PROXY_KEY;
        if (m.NOTAM_RELAY_LOCAL) config.NOTAM_RELAY_URL = m.NOTAM_RELAY_LOCAL;
    } catch { /* absent (miroir public) : on garde les défauts */ }
}
