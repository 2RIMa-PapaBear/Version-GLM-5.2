# VOLET 6 — SORTIES & DOSSIER + SOCLE + ERGONOMIE (agent 26-27/09/2026)

Lecture seule, HEAD 5e82c1a2 ; PDF réellement générés sous Node (fixtures), contrastes WCAG
calculés, tests exécutés aux 3 fuseaux (UTC/Paris/Kiritimati 60/60 ×3).
Compteurs : **0 bloquant propre · 3 MAJEURS · 5 MINEURS · 8 OBSERVATIONS**.

## Fiches

- **S1 [MAJEUR] CSP : tuiles OpenTopoMap absentes de connect-src → fond de la carte de vol
  PDF bloqué silencieusement** — `index.html:9` vs `js/flight-map-collect.js:162`
  (`fetch https://${host}.tile.opentopomap.org/…`) ; `catch { failed++ }` → repli vectoriel
  avec message FAUX « Fond de carte indisponible (hors ligne) » (`flight-map-pdf.js:552`)
  alors que l'app est en ligne. Grep exhaustif : 2 hôtes codés en dur, seul s3.amazonaws.com
  est autorisé. Même classe que le CSV OurAirports historique. Les tuiles ÉCRAN passent par
  <img> (img-src https:) — seule la carte PDF est touchée. **Fix (S)** : ajouter
  a/b/c.tile.opentopomap.org + test QA.
- **S2 [MAJEUR] Worker : cache edge SIGMET sans Cache-Control → TTL ~2 h au lieu de 4 min** —
  `worker/index.js:587-591` (put sans en-tête) alors que le commentaire vise 4 min et que les
  routes voisines sont bornées (TEMSI 600/1800 s, fronts, proxy 30 s–24 h). Un SIGMET fraîchement
  émis peut rester invisible des heures. Seul put non borné des 5 usages de caches.default.
  **Fix (S)** : `Cache-Control: public, max-age=240` + test.
- **S3 [MAJEUR] Suppression d'un vol GPS irréversible sans confirmation, cible ≈ 19 px** —
  `js/gps.js:530` (poubelle 13 px + padding 3 px), `:556-558` (volDel immédiat). Adjacente
  aux boutons Trace/GPX/KML/CSV — appui erroné plausible en turbulence. Les suppressions de
  flotte SONT couvertes (4 confirm() dans fleet-ui). **Fix (S)** : confirm() ou double
  geste + cible ≥ 44 px.
- **S4 [MINEUR] Permalink : plan aller-retour (dest = départ) perdu à l'encodage** —
  `js/permalink.js:66` (`dest !== icaoU` saute dest ET wp) alors que le décodeur l'autorise
  (« aller-retour autorisé, retour pilote 25/09 ») et que le modal promet « voit exactement
  ce que vous voyez ». Exécuté : round-trip nominal OK (91 car.) ; aller-retour → dest null,
  wp "" — PERDU. **Fix (S)** : retirer la condition.
- **S5 [MINEUR] 4 copies locales d'échappement HTML (exigence « un seul escapeHtml »)** —
  `permalink.js:225-232` (escapeAttr), `widgets.js:15` (_escAttr, & et " seulement),
  `radio-points-layer.js:28` (_esc = F13), `notam.js:355` (replace(/</g) ad hoc corps) ;
  en prime `widgets.js:131` insère ${msg} non échappé (msgs internes). Les 4 échappeurs XML
  (GPX/KML) sont légitimes. **Fix (S)** : importer core.escapeHtml.
- **S6 [MINEUR] analyserTAF : mois lu en HEURE LOCALE au milieu d'un contexte UTC** —
  `engine.js:140` (getMonth local vs getUTCMonth l.134 + inferStartYear local). Fenêtre
  locale≠UTC : un TAF « 3112/0112 » peut s'afficher « du 31/09 ». Non couvert par les tests
  (60/60 aux 3 fuseaux). **Fix (S)** : getUTCMonth + test à date frontalière.
- **S7 [MINEUR] Heures en heure locale sans marqueur de fuseau sur le dossier PDF** —
  `flight-planner-ui.js:695` (heure d'OBSERVATION du METAR — par nature UTC — imprimée en
  locale), `:723/:848` (generatedLabel), `navlog-pdf.js:2233` (VAC), `flight-file.js:331/533`.
  Les périodes NOTAM sont correctement en UTC avec Z. **Fix (S)** : suffixer « UTC ».
- **S8 [MINEUR] Cibles tactiles < 44 px sur boutons critiques** — la règle 44 px
  (css/style.css:112-117) ne couvre que 6 sélecteurs ; hors couverture : « Voir » VAC 22 px,
  « Imprimer le dossier de vol » 26 px, « Ouvrir la flotte » 24 px, visionneuse VAC 28 px,
  .btn-lang-toggle 30, .btn-close-modal 32, .plan-io-btn 32, .alt-divert 26, poubelle vol
  ≈ 19 px (S3). **Fix (S)** : généraliser min-height 44 px sous pointer:coarse.
- **S9 [OBSERVATION] QR de partage via tiers (api.qrserver.com)** — l'URL complète du plan
  part chez le tiers à chaque ouverture du modal (divulgué dans confidentialite.html:63).
  Piste : encodeur QR local ~10 Ko. **(M)**
- **S10 [OBSERVATION] Mode cockpit : épurement réel, grossissement marginal** (GO/NO-GO
  1.1 em, fenêtre 1.05 em) — « lisibilité à 2 m » non jugeable en code → QA visuelle.
- **S11 [OBSERVATION] Arrondis assumés écran/PDF (distances au NM entier — documenté) ;
  commentaire « ±50 NM » obsolète dans navlog-pdf.js:47 et ?? 50 l.1050 alors que l'appel
  réel est 25 NM / 8** (flight-planner-ui.js:629 = écran).
- **S12 [OBSERVATION] Alternates : le PDF montre plus que l'écran en aller-retour**
  (écran exige toVal ≠ dep ; PDF construit sur les waypoints complets) — conservateur,
  harmoniser.
- **S13 [OBSERVATION] Cells AIRAC en SWR non versionnées** — après bascule, 1ᵉʳ rendu
  possible sur le cycle précédent, corrigé au rechargement. Piste : versionner par cycle.
- **S14 [OBSERVATION] Proxy générique ?url= du worker sans garde d'Origin** (la garde ne
  couvre que /notam /temsi /fronts /sigmet) — consommation possible du quota ; aucune donnée
  privée.
- **S15 [OBSERVATION] CSP 'unsafe-inline' + script anti-flash mort** — le script l.51-57 lit
  'night-mode-enabled', clé supprimée par la migration : le retirer permettrait un script-src
  propre.
- **S16 [OBSERVATION] Pas de harnais TZ permanent dans npm test** (la double exécution était
  ponctuelle) — ajouter des steps CI TZ=UTC et TZ=Europe/Paris.
- **S17 [OBSERVATION] Fragilité du cycle d'import regional-map ↔ flight-planner-ui**
  (ReferenceError selon l'ordre d'évaluation ; l'ordre d'app.js fonctionne).

## Vérifications conformes (preuves — extraits)

1. **PDF sans recomputation nav** : navlog-pdf.js sans import ; trigonométrie locale = dessin
   uniquement ; valeurs = plan/legs collectés.
2. **Formats identiques écran/PDF** : fmtEte ≡ fmtTime formule pour formule ; carburant
   page 2 = objet plan.fuel.
3. **Perfs du PDF = même moteur + METAR refetché à la génération** (evaluateTakeoffFromRaw
   réutilise densityAltitude/correctedTakeoffDistance/_takeoffVerdict/garde piste).
4. **Facteurs W&B PDF miroirs exacts** de wb-core (mm/ft/in, lb).
5. **Annexe NOTAM = cochés écran** (getSelectedNotams lit les cases) ; helpers locaux
   identiques car. par car. (UTC avec Z) ; repli « dossier entier si rien coché » documenté.
6. **Pagination > 9 tronçons EXÉCUTÉE** : longroute 3 pages, 14wp 4 pages, centro 4 pages ;
   tests 10/14/20/28/80 tronçons 26/26 verts.
7. **Ordre du dossier vérifié sur le /Kids du PDF** (garde/log/météo/NOTAM/carte/VAC).
8. **Permalink nominal round-trip + injection neutralisée 2×** (strip + regex stricte).
9. **sw.js conforme** : météo network-only (7 hôtes court-circuités, no-cache), assets ?v=
   cache-first, shell/modules network-first, caches bornés 1500/400, bump mt-shell-v407 +
   purge à l'activation.
10. **Worker /notam propre** : zéro cache, Origin vérifiée sur les 4 routes à compte, cible
    SOFIA fixée, ZZxx filtrés, secrets en env (absents du repo — vérifié git check-ignore),
    erreurs tronquées.
11. **dev-notam-relay.mjs = miroir exact du contrat worker**, lié à 127.0.0.1.
12. **CSP couvre tout le reste** (davidmegginson présent — le CSV historique).
13. **Persistance socle** : db.js try/catch + versions + péremption 30 j + LRU 200 ; Open-Meteo
    5 min/30 min avec repli « dernier relevé connu » signalé.
14. **taf-chart-capture** capture le moteur réel, restauration intégrale dans finally.
15. **Contrastes tokens exécutés** : clair 17,85/5,77 ; sombre 15,89/6,56 — AA ; dim 2,93/3,05
    (tertiaire canvas → QA).
16. **Suppressions flotte couvertes** (4 confirm()) ; « × » waypoint réversible.

## Re-vérification 1ᵉʳ rapport

- F1 : **NON CORRIGÉ, toujours bloquant** — et le PDF du dossier vol local EMBARQUE le devis
  sous-minima (flight-planner-ui.js:343).
- F8 SunCalc CDN : **CONFIRMÉ non corrigé** (SRI présent et correct ; repli isAeroNight=false
  toujours optimiste).
- F13 _esc radio-points : **CONFIRMÉ non corrigé** (+ S5 : 3 autres copies).
- XSS regional-map 2ᵉ copie : **CORRIGÉ, tient** (import core systématique, commentaire
  l.1181). fleet-ui _esc = import : **tient**. notam title/period échappés : **tient**.
- CSP davidmegginson : **tient** — mais même classe réintroduite (S1 opentopomap).
- Doublon workers.dev sw.js : corrigé.

## QA visuelle recommandée

Carte de vol PDF en conditions déployées (S1 : fond relief présent ?), mode cockpit à 2 m,
contrastes dim plein soleil/pénombre, cibles en gants (19-26 px), modal partage/QR (cas
aller-retour S4), impression A5 réelle (olives carburant, TAF JPEG), effet de bord capture
TAF ~200 ms, rafraîchissement 60 s des tuiles dossier.

## Non-vérifiables

Exécution browser réelle (SW install/activate, CSP effective, Free.fr), TTL exact du cache
edge Cloudflare sans en-tête (valeur documentée ~2 h), comportement api.qrserver.com,
lisibilité réelle des impressions, réseaux SOFIA/AEROWEB vivants, volets hors périmètre.

**Plan volet** : P2 = S1 (S), S2 (S), S3 (S) ; P3 = S4-S8 (S) ; P4 = S9-S17.
