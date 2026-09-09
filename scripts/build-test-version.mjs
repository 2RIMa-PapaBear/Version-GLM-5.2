// ============================================================================
// BUILD VERSION TEST GPS — construit version-test/ : copie COMPLÈTE de l'app
// prod (même arbre que le miroir Pages) + intégration du suivi GPS.
//
//   node scripts/build-test-version.mjs
//
// NE TOUCHE À AUCUN FICHIER SOURCE : tout est écrit dans version-test/.
// Cette version est destinée au sous-dossier /test/ du dépôt Pages
// (https://2rima-papabear.github.io/metar-taf-pwa/test/) — JAMAIS à Free.fr
// (le GPS exige HTTPS, et le dossier n'est dans aucune liste de déploiement).
//
// Diff appliqué à la COPIE uniquement :
//   1. index.html        : ?v=1.254 → ?v=99.254 (le « 99.x » identifie la
//                          version test, affiché en pied de page) + chargement
//                          de js/gps.js après app.js.
//   2. sw.js             : CACHE mt-shell-vN → mt-shell-test-v1 (cache
//                          indépendant : l'install /test/ ne purge pas /).
//   3. js/regional-map.js: 1 ligne injectée après la création de la carte :
//                          window.__regionalMap = _map (exposition à gps.js).
//   4. js/gps.js         : copié depuis gps-feature/js/gps.js (source).
// ============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'version-test');
const V_TEST = '99.270';      // bump à chaque lot test (bust des caches HTTP/PWA)
const SW_TEST_CACHE = 'mt-shell-test-v17';

const COPY = [
    'index.html', 'sw.js', 'manifest.webmanifest', 'favicon.ico', 'icon.svg',
    'notice-fr.html', 'notice-en.html', 'README.md',
    'js', 'css', 'vendor', 'data',
];

const log = (m) => console.log(m);

// ---- 1. Copie propre --------------------------------------------------------
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
for (const f of COPY) {
    const src = path.join(ROOT, f);
    if (!fs.existsSync(src)) throw new Error(`absent : ${f} — abandon`);
    fs.cpSync(src, path.join(OUT, f), { recursive: true });
}
log(`Copie : ${COPY.length} entrées → version-test/`);

// ---- 2. index.html : versions « 99.x » ---------------------------------------
// (Depuis l'action 8 — GPS intégré aux sources réelles — les balises gps.js
// et leaflet-rotate.js existent déjà : on ne fait que vérifier leur présence.)
const idxPath = path.join(OUT, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
idx = idx.replace(/\?v=\d+\.\d+/g, `?v=${V_TEST}`);
if (!idx.includes(`js/gps.js?v=${V_TEST}`) || !idx.includes(`vendor/leaflet-rotate.js?v=${V_TEST}`))
    throw new Error('balises GPS absentes de index.html — intégration réelle incomplète ?');
fs.writeFileSync(idxPath, idx);
log(`index.html : ?v=${V_TEST} (balises GPS déjà présentes dans la prod)`);

// ---- 3. sw.js : cache indépendant -------------------------------------------
const swPath = path.join(OUT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!/CACHE = 'mt-shell-v\d+'/.test(sw)) throw new Error("CACHE 'mt-shell-vN' introuvable dans sw.js — abandon");
sw = sw.replace(/CACHE = 'mt-shell-v\d+'/, `CACHE = '${SW_TEST_CACHE}'`);
fs.writeFileSync(swPath, sw);
log(`sw.js : CACHE ${SW_TEST_CACHE} (indépendant de la vraie PWA)`);

// ---- 4. (action 8) Le GPS vit désormais dans les sources réelles : la copie
// des dossiers js/ et vendor/ l'embarque telle quelle — vérification de forme.
const rmPath = path.join(OUT, 'js', 'regional-map.js');
const rm = fs.readFileSync(rmPath, 'utf8');
if (!rm.includes('rotate: true') || !rm.includes('window.__regionalMap'))
    throw new Error('regional-map.js sans rotate/__regionalMap — intégration réelle incomplète ?');
if (!fs.existsSync(path.join(OUT, 'js', 'gps.js')) || !fs.existsSync(path.join(OUT, 'vendor', 'leaflet-rotate.js')))
    throw new Error('js/gps.js ou vendor/leaflet-rotate.js absent de la copie');
log('GPS présent dans la copie (issu des sources réelles)');

// js/config.local.js part avec la copie de js/ s'il existe (machine pilote,
// même choix que le miroir) ; sinon stub vide pour zéro 404.
if (!fs.existsSync(path.join(OUT, 'js', 'config.local.js'))) {
    fs.writeFileSync(path.join(OUT, 'js', 'config.local.js'),
        '// [version-test] Stub vide — aucun config.local.js sur la machine de build.\n'
        + "export const PROXY_URL = '';\nexport const OPENAIP_API_KEY = '';\nexport const CORS_PROXY_KEY = '';\n");
    log('js/config.local.js : stub vide (machine sans config)');
}

log('\nVersion test prête : version-test/ (publication /test/ Pages = action 6, feu vert requis).');
