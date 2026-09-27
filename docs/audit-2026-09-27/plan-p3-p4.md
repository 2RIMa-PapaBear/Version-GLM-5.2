# P3/P4 du 2ᵉ audit multi-agents (27/09) — liste consolidée avec statut au 27/09 après-midi

Statut vérifié dans le code après les campagnes B1-B3 / M1-M18 / fiches 1-29.
Source : docs/audit-2026-09-27/volets/ (plans de volet P1-P4). « COUVERT » = réglé
par un correctif déjà publié ; le reste est OUVERT.

## P3 — mineurs OUVERTS (16 + 1 partiel) — 6 corrigés le 27/09 : A7, N4, N5, N6, N7, S4

### Navigation & vents (volet 1)
- **N4** GS=0 (vent ≥ TAS) → repli silencieux GS=TAS sans avertir — `js/winds-aloft.js`
  (reconstruit B1 mais l'avertissement n'existe pas). Fix S : avertir.
- **N6 — CORRIGÉ 27/09** : parseGpx tempéré (garde anti-traversée de rtept) +
  helper _gpxPoint ; 2 points rendus, nom du suivant non volé.
  Test flight-plan-io.test.mjs.
- **N7 — CORRIGÉ 27/09** : lat/lon matchés indépendamment de l'ordre (+ rtept
  auto-fermé toléré). Tests flight-plan-io.test.mjs.
- **N8** Chrono GPS sans hystérésis : un fix isolé ≥ VR−5 démarre le chrono, durée jusqu'à
  l'arrêt du suivi — `js/gps.js:424-425,520-523,358`. Fix S : 2-3 fixes consécutifs +
  accuracy bornée + arrêt ~60 s sous seuil.

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
- **A6 (OUVERT)** CG exactement sur la limite : asymétrique (arrière = dehors, avant = dedans) ;
  convention POH = limites inclusives — `js/wb-core.js:70-78,181-183`. Fix S : tolérance
  d'arête ≤ 1 mm.
- **A7 — CORRIGÉ 27/09** : `_dedupeStationNames` au sanitize (+ migration à la
  lecture dans getFleet) → « Passager 2 »…, clés `masses[nom]` uniques de bout
  en bout. Tests fleet.test.mjs (sanitize, migration, computeWb 570/600).
- **A8** Schéma coupe : barre marge DESSINÉE ≠ marge CHIFFRÉE (brut vs ×1,20 ; +63 m
  surestimés sur le cas type) — `js/takeoff-profile.js:190-197`. Fix S : dessiner la marge
  factorisée.
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
- **A8** R/D/P « toujours visibles » : exception limitée aux planchers ≤ 5000 ft (filtre
  AVANT l'exception) — `js/airspace-profile.js:196,201` + `js/airspaces.js:905-906`. Fix S :
  exception avant filtre ou documenter.
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
- **S7** Heures en heure locale sans marque de fuseau sur le dossier PDF (heure
  d'OBSERVATION du METAR — par nature UTC — imprimée en locale, generatedLabel, VAC,
  flight-file) — `js/flight-planner-ui.js:695,723,848`, `js/navlog-pdf.js:2233`,
  `js/flight-file.js:331,533`. Fix S : suffixer « UTC ».
- **S8** Cibles tactiles < 44 px sur boutons critiques (règle CSS limitée à 6 sélecteurs ;
  « Voir » VAC 22 px, « Imprimer » 26 px, poubelle vol 19 px…) — `css/style.css:112-118`.
  Fix S : généraliser min-height 44 px sous `pointer: coarse`.

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
