/* ANTI-FLASH THÈME (S15, audit 27/09) — appelé en <head> par un <script>
 * classique SANS defer/async : synchrone, bloquant, exécuté AVANT le
 * premier rendu. L'app est sombre par défaut : si le pilote a choisi le
 * thème clair, on pose la classe theme-light avant la première peinture —
 * sinon il prend un flash sombre→clair (l'ancien script inline lisait
 * 'night-mode-enabled', clé de l'ancien mode nuit rouge, supprimée depuis
 * par night-mode.js : il ne faisait plus RIEN, et imposait 'unsafe-inline'
 * dans la CSP). Fichier externe → plus aucun script inline dans la page. */
try {
    if (localStorage.getItem('theme-mode') === 'light') {
        document.documentElement.classList.add('theme-light');
    }
} catch (e) { /* mode privé : thème par défaut (sombre) */ }
