/* ================================================================
 * SERVICE WORKER — PWA shell hors-ligne (mt-shell-v1)
 * ================================================================
 *
 * PHILOSOPHIE / SÉCURITÉ PILOTE
 * ------------------------------
 * Ce Service Worker met en cache le SHELL applicatif (HTML, CSS, JS,
 * icônes, polices, airports.json) afin que le site démarre vite et
 * fonctionne hors-ligne. Il NE MET JAMAIS EN CACHE les données météo
 * (METAR/TAF, stationinfo, géocodage, météo temps réel, radar) : un
 * pilote ne doit jamais voir s'afficher une prévision périmée. Les
 * hôtes de données sont explicitement court-circuités (network-only)
 * — y compris le relais Cloudflare et corsproxy (audit 26/09 : ils
 * n'y figuraient pas, un METAR/PIB vieux de plusieurs jours pouvait
 * être resservi hors-ligne).
 *
 * STRATÉGIES PAR TYPE (audit 26/09)
 * ---------------------------------
 *   navigation HTML        network-first  (index.html toujours à jour)
 *   asset VERSIONNÉ ?v=    cache-first    (URL immuable par construction)
 *   module ES non versionné network-first (fraîcheur du code — les
 *                                          imports internes n'ont pas de ?v=)
 *   tuiles + cells airspaces SWR borné    (rebuildables, cache dédié)
 *   PDF VAC                network-first  dans un cache dédié borné
 *
 * BUMP DE VERSION
 * ---------------
 * Quand le shell change (CSS/JS modifiés), bump mt-shell-v1 → v2 :
 * l'activation supprimera l'ancien cache. Les navigations repassent
 * en network-first pour récupérer le nouveau index.html.
 * ================================================================ */

const CACHE = 'mt-shell-v407';
const TILES_CACHE = 'mt-tiles-v1';   // tuiles + cells airspaces (borné)
const PDF_CACHE = 'mt-pdf-v1';       // cartes VAC consultées (borné)
const TILES_MAX = 1500;              // entrées ; au-delà : cache vidé (rebuildable)
const PDF_MAX = 400;

// Hôtes de DONNÉES : jamais mis en cache (sécurité pilote).
const NO_CACHE_HOSTS = [
    'aviationweather.gov',
    'api.open-meteo.com',
    'nominatim.openstreetmap.org',
    'script.google.com',          // proxy Apps Script (relai CORS météo, historique)
    'workers.dev',                // relais Cloudflare (METAR/TAF/NOTAM/SIGMET/PIB)
    'corsproxy.io',               // relais de repli
    'rainviewer.com',             // radar temps réel — périmé = dangereux
];

// Tuiles cartographiques : rebuildables → cache dédié BORNÉ, SWR.
const TILE_HOSTS = [
    'tile.openstreetmap.org',
    'opentopomap.org',
    's3.amazonaws.com',           // terrarium (terrain 3D)
];

// Ressources stables préchargées à l'installation. On se limite aux
// fichiers à URL fixe (les CSS/JS versionnés ?v= sont mis en cache à
// la volée lors de la première visite en ligne, ce qui évite de devoir
// mettre à jour cette liste à chaque release).
const PRECACHE = [
    './',
    'index.html',
    'notice-fr.html',
    'notice-en.html',
    'favicon.ico',
    'icon.svg',
    'icon-180.png',
    'manifest.webmanifest',
    // Modules JS critiques (sans ?v= — le PRECACHE est invalidé à chaque CACHE bump).
    'js/app.js',
    'js/core.js',
    'js/regional-map.js',
    'js/ui-module.js',
    'js/gps.js',
    'js/data-age.js',
    'js/notam.js',
    'css/style.css',
];

// ----------------------------------------------------------------
// Installation : précache du shell minimal.
// ----------------------------------------------------------------
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE)
            .then((cache) => cache.addAll(PRECACHE).catch(() => {}))
            // skipWaiting : le nouveau SW prend le relais sans attendre
            // la fermeture des onglets existants (adéquat pour un shell).
            .then(() => self.skipWaiting()),
    );
});

// ----------------------------------------------------------------
// Bornage d'un cache rebuildable : au-delà du plafond, on le vide
// entièrement (il se reconstruit à l'usage — simple et fiable).
// ----------------------------------------------------------------
async function trimCache(name, max) {
    try {
        const c = await caches.open(name);
        const keys = await c.keys();
        if (keys.length > max) await caches.delete(name);
    } catch { /* caches indisponible : tant pis */ }
}

// ----------------------------------------------------------------
// Activation : nettoyage des anciens caches + bornes + prise de contrôle.
// ----------------------------------------------------------------
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys.filter((k) => k !== CACHE && k !== TILES_CACHE && k !== PDF_CACHE)
                    .map((k) => caches.delete(k)),
            ))
            .then(() => Promise.all([trimCache(TILES_CACHE, TILES_MAX), trimCache(PDF_CACHE, PDF_MAX)]))
            .then(() => self.clients.claim()),
    );
});

// ----------------------------------------------------------------
// Aide : classification des requêtes.
// ----------------------------------------------------------------
function isWeatherData(url) {
    const host = url.hostname;
    return NO_CACHE_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}
function isTile(url) {
    const host = url.hostname;
    return TILE_HOSTS.some((h) => host === h || host.endsWith('.' + h))
        || url.pathname.startsWith('/data/airspaces/cells/');
}
const isVacPdf = (url) =>
    url.origin === self.location.origin && url.pathname.toLowerCase().endsWith('.pdf');
const isVersioned = (url) => /[?&]v=\d/.test(url.search);

// ----------------------------------------------------------------
// Stratégie : Stale-While-Revalidate dans un cache donné (borné).
// Sert le cache immédiatement s'il existe, puis rafraîchit en arrière.
// ----------------------------------------------------------------
async function staleWhileRevalidate(request, cacheName = CACHE) {
    const cache = await caches.open(cacheName);
    const cached = await cache.match(request);
    const network = fetch(request).then((response) => {
        if (response && (response.ok || response.status === 0 || response.type === 'opaque')) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    }).catch(() => cached); // réseau mort → on retombe sur le cache.
    return cached || network;
}

// ----------------------------------------------------------------
// Stratégie : cache-first (assets versionnés — URL immuable).
// ----------------------------------------------------------------
async function cacheFirst(request) {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: false });
    if (cached) return cached;
    const response = await fetch(request);
    if (response && (response.ok || response.status === 0)) {
        cache.put(request, response.clone()).catch(() => {});
    }
    return response;
}

// ----------------------------------------------------------------
// Stratégie : Network-first (navigations HTML, modules, PDF VAC).
// ----------------------------------------------------------------
async function networkFirst(request, cacheName = CACHE) {
    const cache = await caches.open(cacheName);
    try {
        // cache:'no-cache' — REVALIDATION systématique auprès du serveur : sans
        // cela, le fetch() du SW honore le cache HTTP heuristique du navigateur
        // (Free.fr n'envoie pas de Cache-Control) et peut resservir un module
        // PÉRIMÉ des heures durant alors même que le shell vient d'être mis à
        // jour (bug « le pilote voit une vieille app », 06/09).
        const response = await fetch(request, { cache: 'no-cache' });
        if (response && response.ok) {
            cache.put(request, response.clone()).catch(() => {});
        }
        return response;
    } catch {
        // Hors-ligne : on retombe sur le cache de la requête demandée,
        // puis sur la racine en dernier recours (navigations).
        return (await cache.match(request))
            || (cacheName === CACHE ? (await cache.match('./')) : null)
            || Response.error();
    }
}

// ----------------------------------------------------------------
// Routage des requêtes.
// ----------------------------------------------------------------
self.addEventListener('fetch', (event) => {
    const req = event.request;
    const url = new URL(req.url);

    // 1) Données météo / géocodage / radar : network-only, JAMAIS de cache.
    //    (Sécurité pilote — une donnée périmée serait dangereuse.)
    //    Réponse explicite par le réseau, requête DÉRIVÉE (cache:no-cache,
    //    le chemin éprouvé de l'ancien networkFirst). PIÈGE (trouvé en QA
    //    26/09) : le handler nomme la requête `req` — une ligne écrivant
    //    `request` (indéfini) jetait ReferenceError à CHAQUE requête de
    //    données, et l'exception silencieuse du handler gelait l'appel.
    if (isWeatherData(url)) {
        event.respondWith(fetch(req, { cache: 'no-cache' }).catch(() => Response.error()));
        return;
    }

    // 2) Navigations (pages HTML) : network-first.
    if (req.mode === 'navigate') {
        event.respondWith(networkFirst(req));
        return;
    }
    if (req.method !== 'GET') return;

    // 3) Assets VERSIONNÉS (?v=N) : cache-first — l'URL change à chaque
    //    release, son contenu est immuable ; inutile de revalider.
    if (url.origin === self.location.origin && isVersioned(url)) {
        event.respondWith(cacheFirst(req));
        return;
    }

    // 4) Tuiles + cells d'espaces aériens : SWR dans le cache borné.
    if (isTile(url)) {
        event.respondWith(staleWhileRevalidate(req, TILES_CACHE));
        return;
    }

    // 5) PDF VAC : network-first (fraîcheur AIRAC) dans un cache borné.
    if (isVacPdf(url)) {
        event.respondWith(networkFirst(req, PDF_CACHE));
        return;
    }

    // 6) Reste du shell (modules ES non versionnés, CSS, vendor,
    //    airports.json, polices, suncalc CDN) : network-first pour
    //    garantir la fraîcheur du code.
    event.respondWith(networkFirst(req));
});
