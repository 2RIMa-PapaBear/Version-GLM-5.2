/* ================================================================
 * DATA-BASE — Chemin des données VOLUMINEUSES partagées avec la prod
 * ================================================================
 *
 * Le canal test (dossier /test/ du même hébergement) publie l'état local
 * de travail SANS les deux gros dossiers — data/airspaces/cells/
 * (~257 Mo de cellules openAIP) et data/vac-sia/ (~123 Mo de cartes
 * VAC) — qui restent servis depuis la RACINE, déjà en ligne et tenus à
 * jour par les déploiements normaux. Ce helper réécrit ces chemins en
 * absolu-racine quand l'app tourne sous /test/ ; en racine (prod) et
 * en local, il retourne le chemin inchangé.
 */
const IS_TEST_CHANNEL = typeof location !== 'undefined'
    && /^\/test\//.test(location.pathname);

/**
 * URL d'une donnée volumineuse (cellules, VAC) : relative en prod,
 * absolue-racine depuis le canal test.
 * @param {string} path Chemin relatif (« data/airspaces/cells/… »).
 * @returns {string}
 */
export function bigDataUrl(path) {
    return IS_TEST_CHANNEL ? '/' + String(path).replace(/^\//, '') : path;
}
