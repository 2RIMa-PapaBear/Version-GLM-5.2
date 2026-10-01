/* CHARGEUR DE LIBS À LA DEMANDE (externalisé d'un script inline, S15
 * audit 27/09 — la page n'a plus AUCUN script inline, la CSP script-src
 * peut se passer d'unsafe-inline).
 *
 * Libs lourdes chargées À LA DEMANDE (perf : −521 Ko au démarrage de
 * l'app). Leaflet (+ CSS + plugin rotate) : à l'ouverture de la carte
 * régionale (js/regional-map.js). jsPDF : à la première génération de PDF
 * (js/flight-planner-ui.js). Sans ?v= : le réseau-first du SW garantit la
 * fraîcheur, le CACHE bumpé par déploiement purge les entrées vieilles.
 * async=false → les scripts s'exécutent dans l'ordre de la liste. */
window.__libPromises = {};
window.__chargerLib = function (urls) {
    return Promise.all((Array.isArray(urls) ? urls : [urls]).map(function (u) {
        if (!window.__libPromises[u]) {
            window.__libPromises[u] = new Promise(function (resolve, reject) {
                var el;
                if (u.endsWith('.css')) {
                    el = document.createElement('link');
                    el.rel = 'stylesheet'; el.href = u;
                } else {
                    el = document.createElement('script');
                    el.src = u; el.async = false;
                }
                el.onload = function () { resolve(u); };
                el.onerror = function () { delete window.__libPromises[u]; reject(new Error('chargement impossible : ' + u)); };
                document.head.appendChild(el);
            });
        }
        return window.__libPromises[u];
    }));
};

/* Bouton « notice » (S15) : l'ancien onclick= inline exigeait 'unsafe-inline'
 * dans la CSP — même comportement en addEventListener. Ce script est le
 * DERNIER du <body> : le bouton existe déjà quand il s'exécute. */
(function () {
    var btn = document.getElementById('btn-notice');
    if (btn) btn.addEventListener('click', function () {
        window.location.href = document.documentElement.lang === 'en' ? 'notice-en.html' : 'notice-fr.html';
    });
})();
