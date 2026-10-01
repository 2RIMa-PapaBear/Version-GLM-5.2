# P3/P4 du 2ᵉ audit multi-agents (27/09) — liste consolidée avec statut au 27/09 après-midi

> **JOURNAL DES CORRECTIONS (mise à jour 01/10 nuit)** — lire avec les statuts
> ci-dessous, qui ne reflètent plus les derniers lots :
> - **A12-v4 SOURCÉ SUR MANUELS RÉELS (01/10 nuit)** : le « POH public
>   UL 472,5 : 650 ft » cité par le volet 4 était une attribution ERRONÉE —
>   le MV public « UL/Club » 03/2016 (MTOW 472,5 kg, liens pilote) donne
>   décollage **246/826 ft** (revêtu) ou 282/866 (herbe) et
>   **bagages 20 kg** en soute (pas 10). Décisions pilote : bagages
>   **40→20 kg** (MV public §2) ; décollage **650/1 148 conservé**
>   (conservateur, non sourcé — à remplacer par les valeurs du manuel de
>   vol LSA 600 kg de F-HAYA quand relevées) ; atterrissage 246/863 =
>   MV public UL/Club (caveat version 472,5 kg vs LSA 600).
> - **Lot 3 P3 (NON COMMITÉ à ce jour)** : A9-v4 (garde `runwayBelongsToAirport`
>   à l'affichage), A10-v4 (setRunwayLength supprimée, messages « longueur de
>   piste inconnue »), N4-v1 (GS=0 → repli TAS signalé par `gsFallback` + ⚠),
>   A9-v5 (« FLxxx » seulement si la source publie un FL), A10-v5+S5 (escapeHtml
>   de core unifié dans sup-sia/widgets/permalink/radio-points-layer/notam),
>   A7-v5 (libellé rayon réel + section ADSur rendue en local), A5+A6-v5
>   (crawler exporte `cl` + `horTxt`, base 09-03 régénérée — 681 classes /
>   1402 horaires texte — cache IDB v4, popup « classe D », horTxt au profil).
> - **P4 tranche 1 (NON COMMITÉE)** : W12 (SKC reconnu), W13 (VV/// préservé =
>   plafond indéterminé, plus « illimité »), W14 (plus de phénomène fantôme —
>   décomposition stricte en codes connus), N7 (carb-icing : Td > T → null),
>   A11-v5 (repli « USA » restreint aux vrais préfixes FAA), A13-v5 (badge
>   générique pour les codes horaires hors tableau), N17 (KML
>   route/polygone/track jamais waypoint).
> - **Reste P4 (ouvert)** : N5, N9, N10, N11, N12, N13 (WMM2025), N14, N16,
>   A11-v4, A12-v4 (sourcage POH pilote), A13, A12-v5, A14-v5, A15-v5, S9, S10,
>   S11, S12, S13, S14, S15, S16, S17, N6 (temps givrage go-nogo), W11
>   (unification décodeurs — refonte M dédiée).
> - npm 676/676 après tous ces lots.

Statut vérifié dans le code après les campagnes B1-B3 / M1-M18 / fiches 1-29.
Source : docs/audit-2026-09-27/volets/ (plans de volet P1-P4). « COUVERT » = réglé
par un correctif déjà publié ; le reste est OUVERT.

## P3 — mineurs OUVERTS : 9 fiches + 1 partiel (W11) — 12 corrigées le 27/09 : A7, N4(watchdog), N5, N6, N7, S4, A6, A8(perfs), N8, A8(espaces), S7, S8

### Navigation & vents (volet 1)
- **N4** GS=0 (vent ≥ TAS) → repli silencieux GS=TAS sans avertir — `js/winds-aloft.js`
  (reconstruit B1 mais l'avertissement n'existe pas). Fix S : avertir.
- **N6 — CORRIGÉ 27/09** : parseGpx tempéré (garde anti-traversée de rtept) +
  helper _gpxPoint ; 2 points rendus, nom du suivant non volé.
  Test flight-plan-io.test.mjs.
- **N7 — CORRIGÉ 27/09** : lat/lon matchés indépendamment de l'ordre (+ rtept
  auto-fermé toléré). Tests flight-plan-io.test.mjs.
- **N8 — CORRIGÉ 27/09** : hystérésis du chrono — départ sur 3 fixes consécutifs
  ≥ VR−5 (précision ≤ 50 m), arrêt après 60 s sous le seuil (roulage/parking) ;
  compteurs réinitialisés à l'arrêt du suivi.

### Météo (volet 2)
- **W11 (PARTIEL, inchangé)** 5 décodeurs METAR parallèles à tolérances divergentes — ND/SM/TEMPO
  alignés depuis (M3, fiche 10, M7) mais l'unification en UN module pur consommé partout
  reste à faire (effort M, refonte architecturale).

### Go/No-Go & minima (volet 3)
- **N4 — CORRIGÉ 27/09** : olive grise UNKNOWN (#9CA3AF, « METAR indisponible »),
  _isWorse neutre sur UNKNOWN (pas de fausse alerte au retour de la donnée).
  Tests watchdog-badge.test.mjs (gris, re-rendu, retour de donnée sans alerte).
- **N5 — CORRIGÉ 27/09** : contexte indisponible → repli CONSERVATEUR (minima
  « contrôlés ») + drapeau `unknown` affiché (« zones indisponibles — repli
  contrôlé ») ; base SIA : `siaAirspacesOk()`/`siaCoversPoint()` exportés
  (airspaces.js) pour distinguer « aucune zone » d'« indisponible » ; pas de
  cache sur unknown (re-tentative au tour suivant). Test vfr-minima.test.mjs.

### Masse & centrage / perfs (volet 4)
- **A6 — CORRIGÉ 27/09** : `pointInEnvelopeTolerant` (±0,5 kg / ±1 mm) branchée sur le
  verdict computeWb — un CG posé sur la limite est « ok », pas « danger ». Tests
  wb-core.test.mjs (strict/tolérant + verdict computeWb sur l'arête).
- **A7 — CORRIGÉ 27/09** : `_dedupeStationNames` au sanitize (+ migration à la
  lecture dans getFleet) → « Passager 2 »…, clés `masses[nom]` uniques de bout
  en bout. Tests fleet.test.mjs (sanitize, migration, computeWb 570/600).
- **A8 — CORRIGÉ 27/09** : `fiftyEffX` dans le layout (position du 50 ft FACTORISÉE =
  XR − marge×échelle) — la barre dessinée démarre là, sa largeur = le chiffre
  affiché. Tests takeoff-profile.test.mjs (facteur ≠ 1 et cas sans facteur).
- **A9** « Piste en service » affichée SANS garde `runwayBelongsToAirport` (5ᵉ chemin ;
  les 4 chemins de calcul sont gardés) — `js/takeoff-ui.js:176`. Fix S : même garde à
  l'affichage.
- **A10** Longueur de piste manuelle : fonctionnalité morte (`setRunwayLength` exportée
  jamais appelée, message inactionnable) — `js/takeoff-performance.js:169`. Fix S :
  supprimer ou rétablir la saisie.

### Espaces / AIRAC / NOTAM (volet 5)
- **A5** Classe d'espace (A–G) du XML SIA non exportée (538 D, 152 E, 102 C, 26 A, 50 G) —
  `scripts/fetch-sia-airac.mjs` (pas de « Classe »). Fix S : exporter + afficher.
- **A6** Horaires d'activation HorTxt non exportés (« TS » affiché brut, 60 zones) —
  `scripts/fetch-sia-airac.mjs:170`. Fix S : exporter HorTxt.
- **A7** Libellé « Zone 30 NM » figé (réel 20 NM réglable 10-40) + ADSur comptés mais
  jamais rendus en local (comptés, non cochables) — `js/notam.js:321` + rendu local. Fix S.
- **A8 — CORRIGÉ 27/09** : exception R/D/P placée AVANT tous les filtres
  d'altitude (plancher MAX_BASE_FT + filtre croisière, profil ET carte
  `airspaces.js _render`) — une R/D/P 20000-24000 survolée à 21000 reste
  visible. NB : la montée de MAX_BASE_FT à FL195 (fiche 2 du lot M) avait déjà
  neutralisé le cas 6000-9500 ; ce fix rend l'exception robuste quel que soit
  le plafond du filtre. Test airspace-profile.test.mjs.
- **A9** `_limitTxt` affiche « FLxxx » pour des limites publiées en ft AMSL ≥ 4000
  multiples de 500 (suppose TA 3000 partout ; calcul correct, étiquette trompeuse) —
  `js/airspaces.js:714-717`. Fix S : FL seulement si la source publie un FL (unité 6).
- **A10** Hygiène XSS : copies locales d'échappement + champs non échappés (sup-sia `_esc`
  + num/start/end/chips bruts ; widgets.js `_escAttr`) — `js/sup-sia.js:308-324`,
  `js/widgets.js:15`. Fix S : escapeHtml de core. (Rejoint S5.)

### Sorties / socle / ergonomie (volet 6)
- **S4 — CORRIGÉ 27/09** : garde `dest !== icao` retirée → dest = départ encodé
  (QA navigateur : modal partage → ?icao=LFRV&mode=nav&dest=LFRV pour un
  aller-retour). Pas de test permanent (imports DOM lourds), QA manuelle OK.
- **S5** 4 copies locales d'échappement HTML (permalink escapeAttr, widgets `_escAttr` +
  `${msg}` brut l.131, radio-points-layer `_esc`, notam replace ad hoc) — Fix S : importer
  core.escapeHtml. (Rejoint A10.)
- **S7 — CORRIGÉ 27/09** : toutes les heures du dossier en UTC MARQUÉ
  (« HH:MM UTC ») : ref des tuiles page de garde, generatedLabel (page de garde
  + météo + carte), « VAC consultée » (flight-file ×2). Fini l'heure locale non
  libellée mêlée aux périodes NOTAM en Z.
- **S8 — CORRIGÉ 27/09** : règle `pointer: coarse` étendue à .btn-lang-toggle,
  .btn-close-modal, .plan-io-btn, .alt-divert, .gps-vol-del, .mp-vac-btn,
  #ff-print, #to-ldg-fleet, button[data-vac] — min-height 44 px s'impose aux
  hauteurs inline/fixes.

### Déjà COUVERTS par les campagnes (pour mémoire)
- F6 TEMPO plafond mélangé → **M7** · F7 TAF sans groupes → **M4** · N3 SIGMET géo →
  **M5** · S6/W10 TAF mois local → **getUTCMonth en place (engine.js:144)** · W11
  tolérances → alignées (partiel ci-dessus). P2 du volet 6 : S1 CSP opentopomap → **M16**,
  S2 TTL SIGMET worker → **M17**, S3 confirm suppression vol GPS → **M18**.

## P4 — observations OUVERTES (30)

### Navigation & vents (volet 1)
- **N5** Cache déclinaison : TTL 30 j GLOBAL (rafraîchi par n'importe quelle écriture,
  pas par entrée) — `js/magvar.js:7,14-31`.
- **N9** wind-layer : plan à 6000 ft → sélecteur affiche 2000 (flèches justes) —
  `js/wind-layer.js:146,176-179`.
- **N10** Commentaire GPS obsolète « > 35 kt » vs code VR−5/50 kt — `js/gps.js:20-21`.
- **N11** Clé cache déclinaison arrondie au degré (~60 NM) — impact ≤ 0,1° —
  `js/magvar.js:126-130`.
- **N12** Trace GPS : sauts non filtrés à l'export (accuracy exportée jamais utilisée) —
  `js/gps-vols.js:111-122`.
- **N13** WMM2020 extrapolé vs NOAA WMM2025 : +0,13 à +0,17° (LFPB, Brest) — sans impact
  France (SIA prioritaire). Fix : coefficients WMM2025.
- **N14** geomag : paramètre altitude attendu en KILOMÈTRES (latent, toujours 0) —
  `vendor/geomag.js:123-127`.
- **N16** Σ temps de tronçons arrondis ≠ total (artefact d'affichage ≤ 0,5 min/tronçon) —
  `js/flight-planner.js:499-511`.
- **N17** KML : LineString mono-coordonnée importé comme waypoint — `js/flight-plan-io.js:173`.

### Météo (volet 2)
- **W12** RVR jamais extrait ; SKC (US) non reconnu — `js/engine.js:47`.
- **W13** VV/// et ////// deviennent « illimité » dans les TAF parsés (le METAR brut est
  sauvé par son segment brut) — `_parseNuage`/getCeiling.
- **W14** Groupe inconnu « traduit » en phénomène fantôme (XYZABC → « XY ZA Bancs ») —
  filtrer sur tokens exclusivement connus.

### Go/No-Go (volet 3)
- **N6** Givrage : go-nogo appelle `evaluateIcingRisk` SANS tempC/tdC (les jette alors que
  fetchFreezingLevel les fournit) — `js/go-nogo.js:289`.
- **N7** carb-icing : Td > T non gardé (spread −2 → serious sur donnée impossible) —
  `evaluateCarbIcing`.

### Masse & centrage (volet 4)
- **A11** Pente SIA : repli silencieux sur la piste PRINCIPALE si le numéro en service ne
  matche pas — `js/takeoff-performance.js:514-515`.
- **A12** Fiche WT9 : bagages max 40 kg (défaut générique) vs 10 kg POH ; roulement 540 ft
  non sourcé (POH public : 650 ft). Sourcage côté pilote.
- **A13** Météo du terrain AFFICHÉE appliquée à un autre terrain demandé —
  `js/takeoff-performance.js:425-429`. Fix S : refuser si ≠.

### Espaces / NOTAM (volet 5)
- **A11** atc-info : repli « USA » pour tout code 3-4 lettres (EHGR/LOWW → « VFR Charts
  (FAA) ») — `js/atc-info.js:25-29`.
- **A12** Cache VAC : sans purge des cycles passés (~300 Ko × 421 terrains accumulés par
  bascule) — `js/vac-viewer.js`.
- **A13** 324 « HOR ATS » sans badge (table H24/HO/HX/HJ/HN incomplète) + 2 troncatures du
  scrape LFSL.
- **A14** 10 navaids TACAN US (133.x) classés « VOR » — aucun en France —
  `js/radio-points.js:54-60`.
- **A15** FL→ft calage 1013 implicite non documenté (±800 ft à QNH extrême) ;
  SIA_COVERAGE trompeuse (DOM hors bbox, servis openAIP).

### Sorties / socle (volet 6)
- **S9** QR de partage via tiers (api.qrserver.com : l'URL du plan part chez le tiers ;
  piste encodeur QR local ~10 Ko).
- **S10** Mode cockpit : grossissement marginal — à juger en QA visuelle à 2 m.
- **S11** Commentaires obsolètes « ±50 NM » dans navlog-pdf (réel 25 NM/8) — cosmétique.
- **S12** Alternates : le PDF montre plus que l'écran en aller-retour (conservateur) —
  harmoniser.
- **S13** Cells AIRAC en SWR non versionnées par cycle (1ᵉʳ rendu possible sur l'ancien
  cycle, corrigé au rechargement) — piste : versionner par cycle.
- **S14** Proxy générique `?url=` du worker sans garde d'Origin (quota consommable ;
  aucune donnée privée).
- **S15** CSP 'unsafe-inline' + script anti-flash mort (clé 'night-mode-enabled'
  supprimée par la migration) — le retirer permettrait un script-src propre.
- **S16** Pas de harnais TZ permanent dans npm test (ajouter steps CI TZ=UTC et
  TZ=Europe/Paris) — les tests azba ne mordent qu'en runner non-UTC.
- **S17** Fragilité du cycle d'import regional-map ↔ flight-planner-ui (l'ordre d'app.js
  fonctionne ; TDZ si inversé — cf. fiche 19 qui a déjà sécurisé le fichier).

### Déjà COUVERT
- N15 (volet 1) multi-leg vent milieu → **fiche 20** (fetchWindsAloftMulti par segment).
