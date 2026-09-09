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
const V_TEST = '99.268';      // bump à chaque lot test (bust des caches HTTP/PWA)
const SW_TEST_CACHE = 'mt-shell-test-v15';

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

// ---- 2. index.html : versions « 99.x » + chargement du module GPS -----------
const idxPath = path.join(OUT, 'index.html');
let idx = fs.readFileSync(idxPath, 'utf8');
idx = idx.replace(/\?v=\d+\.\d+/g, `?v=${V_TEST}`);
const anchor = `<script type="module" src="js/app.js?v=${V_TEST}"></script>`;
if (!idx.includes(anchor)) throw new Error('ancre app.js introuvable dans index.html — abandon');
idx = idx.replace(anchor, anchor + `\n    <script type="module" src="js/gps.js?v=${V_TEST}"></script>`);
// Plugin de rotation (gps-feature/vendor/) : APRÈS leaflet.min.js
const leafAnchor = `<script src="vendor/leaflet.min.js?v=${V_TEST}" defer></script>`;
if (!idx.includes(leafAnchor)) throw new Error('ancre leaflet.min.js introuvable dans index.html — abandon');
idx = idx.replace(leafAnchor, leafAnchor + `\n    <script src="vendor/leaflet-rotate.js?v=${V_TEST}" defer></script>`);
fs.writeFileSync(idxPath, idx);
log(`index.html : ?v=${V_TEST} + js/gps.js + vendor/leaflet-rotate.js chargés`);

// ---- 3. sw.js : cache indépendant -------------------------------------------
const swPath = path.join(OUT, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
if (!/CACHE = 'mt-shell-v\d+'/.test(sw)) throw new Error("CACHE 'mt-shell-vN' introuvable dans sw.js — abandon");
sw = sw.replace(/CACHE = 'mt-shell-v\d+'/, `CACHE = '${SW_TEST_CACHE}'`);
fs.writeFileSync(swPath, sw);
log(`sw.js : CACHE ${SW_TEST_CACHE} (indépendant de la vraie PWA)`);

// ---- 4. regional-map.js : plugin rotation + exposition de la carte (copie seule)
const rmPath = path.join(OUT, 'js', 'regional-map.js');
let rm = fs.readFileSync(rmPath, 'utf8');
const mapAnchor = "_map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19 }).setView([lat, lon], 7);";
if (!rm.includes(mapAnchor)) throw new Error('ancre création carte introuvable dans js/regional-map.js — abandon');
rm = rm.replace(mapAnchor,
    "_map = L.map(el, { zoomControl: true, attributionControl: true, maxZoom: 19, rotate: true }).setView([lat, lon], 7);"
    + '\n        window.__regionalMap = _map;   // [TEST GPS] carte exposée à js/gps.js');
fs.writeFileSync(rmPath, rm);
log('js/regional-map.js : rotate:true + window.__regionalMap exposé (copie seule)');

// ---- 5. Module GPS + plugin de rotation --------------------------------------
fs.copyFileSync(path.join(ROOT, 'gps-feature', 'js', 'gps.js'), path.join(OUT, 'js', 'gps.js'));
fs.mkdirSync(path.join(OUT, 'vendor'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'gps-feature', 'vendor', 'leaflet-rotate.js'), path.join(OUT, 'vendor', 'leaflet-rotate.js'));
log('js/gps.js + vendor/leaflet-rotate.js copiés (gps-feature/)');

// js/config.local.js part avec la copie de js/ s'il existe (machine pilote,
// même choix que le miroir) ; sinon stub vide pour zéro 404.
if (!fs.existsSync(path.join(OUT, 'js', 'config.local.js'))) {
    fs.writeFileSync(path.join(OUT, 'js', 'config.local.js'),
        '// [version-test] Stub vide — aucun config.local.js sur la machine de build.\n'
        + "export const PROXY_URL = '';\nexport const OPENAIP_API_KEY = '';\nexport const CORS_PROXY_KEY = '';\n");
    log('js/config.local.js : stub vide (machine sans config)');
}

log('\nVersion test prête : version-test/ (publication /test/ Pages = action 6, feu vert requis).');
