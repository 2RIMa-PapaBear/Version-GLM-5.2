# Prompt d'audit — Prévol (logiciel de plan de vol VFR et d'analyse météo)

> Prompt professionnel, auto-suffisant, à remettre à un auditeur (IA ou humain).
> Version adaptée au dépôt le 26/09/2026 — application « Prévol »
> (`package.json` : `metar-taf-visualiseur` v3.0.0), PWA vanilla JS sans framework.

---

## 0. Rôle et mission

Tu es auditeur senior d'applications aéronautiques pour l'aviation générale. Tu combines quatre expertises :
le calcul opérationnel du pilote (navigation, altimétrie, carburant, masse et centrage, performances),
la réglementation aéronautique française et européenne (SERA, Part-NCO, arrêtés DGAC),
la qualité logicielle (exactitude numérique, robustesse, intégrité des données)
et l'ergonomie en environnement cockpit.

Tu auditotes **Prévol** : météo aéronautique en temps réel (METAR/TAF décodés et visualisés),
planification de vol (planificateur, carte régionale, log de nav PDF), performances de décollage,
masse et centrage, GO/NO-GO, NOTAM — une PWA installable qui fonctionne **hors ligne**, destinée à un
pilote VFR volant en France (flotte : avions légers certifiés et ULM/LSA type WT9 Dynamic).

Contexte décisif : le pilote peut prendre une décision de vol (départ, niveau, déroutement, annulation)
sur la seule foi d'une valeur produite par ce logiciel. Tout écart de calcul est donc un risque
opérationnel, pas un simple bug d'affichage.

L'audit est **en lecture seule** : tu produces un rapport, tu ne modifies pas le code (sauf mission
expresse complémentaire).

Quatre volets d'égale importance :
1. Exactitude mathématique de toutes les fonctions de calcul de vol ;
2. Conformité aux règles VFR applicables en France ;
3. Ergonomie pour un usage en vol ;
4. Robustesse des données et des calculs.

## 1. Méthode imposée — à appliquer à CHAQUE fonction auditée

1. **Localiser** la fonction (fichier `js/*.js`, ligne précise).
2. **Extraire** la formule ou l'algorithme réellement implémenté (citer le code).
3. **Recalculer indépendamment** sur au moins 3 jeux d'essai : nominal, cas limite, cas dégénéré
   (division par zéro, vent nul, donnée manquante, antipode…) — sans jamais réutiliser le code de l'application.
4. **Comparer** à des valeurs de référence : calcul manuel (formule / règle à calcul E6B), table officielle,
   éphémérides IMCCE ou NOAA, manuel de vol d'un aéronef type de la flotte.
5. **Vérifier la conformité réglementaire** de la règle métier associée (citer la disposition exacte, §6).
6. **Tracer** le résultat dans une fiche d'anomalie normalisée (§8).

Interdictions absolues :
- ne jamais « valider par lecture » sans recalcul chiffré ;
- ne jamais considérer un test existant (`test/*.test.mjs`, ~528 tests `npm test`) comme preuve de
  justesse — il peut encoder l'erreur qu'il teste ;
- ne jamais modifier le code pendant l'audit ;
- signaler toute formule dont tu ne peux pas retracer la source (réglementaire, physique ou manuel de vol).

## 2. Cartographie du périmètre réel (modules du dépôt)

| Domaine | Modules (`js/`) | Points d'audit prioritaires |
|---|---|---|
| Plan de vol & navigation | `flight-planner.js`, `flight-planner-ui.js`, `flight-plan-io.js`, `alternates.js`, `regional-map.js`, `magvar.js`, `flight-mode.js` | Caps/distances/temps par tronçon, ortho vs loxo, déclinaison (geomag), alternates (8 terrains ±25 NM régulièrement espacés), round-trip JSON/GPX/KML |
| Vents & GPS | `winds-aloft.js`, `wind-layer.js`, `gps.js`, `gps-vols.js` | Interpolation temporelle/verticale des vents (Open-Meteo), triangle des vents, chrono décollage (VR −5 kt, 50 kt sans avion), trace, export GPX/KML |
| Météo observée/prévue | `weather.js`, `route-weather.js`, `pressure-trend.js`, `fronts.js`, `temsi.js`, `radar-layer.js`, `sigmet.js`, `data-age.js` | Décodage METAR/TAF (Annexe 3), CAVOK, tendances, échéances TEMSI, SIGMET/AIRMET actifs, badges d'âge (METAR : vert < 1 h, rouge ≈ 2 h ; TAF : vert < 6 h 30, rouge > 12 h) |
| Phénomènes dérivés | `freezing-level.js`, `carb-icing.js`, `night-mode.js`, `flight-window.js` | Isotherme 0 °C, critères givrage carburation (règle empirique à sourcer), crépuscules civils (±2 min vs IMCCE/NOAA), fenêtre de vol jour & alerte nuit |
| GO/NO-GO & minima | `go-nogo.js`, `vfr-minima.js`, `watchdog.js` | Table SERA.5005 par classe d'espace traversé, plafond/visi vs minima, visi absente = inconnue, surveillance des favoris |
| Masse & centrage | `wb-core.js`, `wb-ui.js`, `fleet-ui.js`, `aircraft-fleet.js`, `aircraft-database.js` | Centrogrammes pré-remplis (Cessna, Piper, Robin… WT9), enveloppe, points Décollage/Arrivée/ZFW, carburant, postes |
| Performances décollage | `takeoff-performance.js`, `takeoff-profile.js`, `takeoff-ui.js`, `density-altitude.js`, `runway-surface.js`, `runways-geo.js` | Densité-altitude, revêtements (herbe, dur sec/humide/contaminé), pente, piste en service pilotée par la rose des vents, marge vs longueur de piste, schéma 50 ft |
| Relief & profil | `route-elevation.js`, `elevation-chart.js`, `terrain-tiles.js` | Profil d'élévation (Open-Meteo) en NM par tronçon, marges de franchissement, secteurs + fréquences superposés |
| Espaces, AIRAC, NOTAM | `airspaces.js`, `airspace-profile.js`, `airspace-freq.js`, `sia-data.js`, `azba.js`, `notam.js`, `sup-sia.js`, `vac-viewer.js`, `atc-info.js`, `freq-sia.js`, `radio-points.js` | Base SIA XML AIRAC prioritaire + openAIP, cycle 28 j et péremption, dossier SOFIA (plan ou rayon 10–40 NM, plafond FL du plan, filtrage VFR), SUP, VAC (421 terrains, cache IndexedDB) |
| Sorties & dossier | `navlog-pdf.js`, `flight-map-pdf.js`, `taf-chart-capture.js`, `flight-file.js`, `permalink.js` | Log de nav PDF multi-pages (> 9 tronçons), cohérence EXACTE écran ↔ PDF, alternates, centrage, NOTAM cochés en annexe |
| Socle | `core.js`, `engine.js`, `config.js`, `db.js`, `data-base.js`, `widgets.js`, `cockpit-mode.js`, `sw.js`, `worker/` | Échappement HTML (un seul `escapeHtml` dans `core.js` — chasser les copies locales), service worker (stratégies/bornes de cache), relais CORS Cloudflare (cache météo, `POST /notam` sans cache) |

## 3. Fonctions mathématiques de vol — points de contrôle détaillés

### 3.1 Navigation et triangle des vents
- Dérive et correction de cap : WCA = arcsin(W·sin θ / TAS), θ = angle vent-route ;
  GS = TAS·cos(WCA) − W·cos θ. Vérifier les conventions de signes (vent « du » vs « vers »)
  dans `flight-planner.js` et l'étiquetage des tronçons sur `regional-map.js`.
- Vecteur de test de référence à recalculer : route vraie 090°, TAS 100 kt, vent du 030°/30 kt
  → cap vrai ≈ 075°, GS ≈ 82 kt (tolérance ±1° / ±1 kt).
- Chaîne des caps : cap vrai → cap magnétique (`magvar.js` + `vendor/geomag.js`) → cap compas.
  Vérifier le modèle embarqué (WMM2020 d'après le code) : **son époque de validité a expiré
  fin 2024** (modèle courant : WMM2025, valide 2025–2030) — évaluer l'écart de déclinaison en France
  et exiger la mise à jour ou la justification ; vérifier le signe Est/Ouest et l'altitude passée au modèle.
- Conversions d'unités : 1 NM = 1852 m ; 1 ft = 0,3048 m ; kt ↔ km/h ↔ m/s ;
  1 inHg = 33,8639 hPa ; 1 US gal = 3,78541 L ; 1 lb = 0,45359237 kg.
- Distances : orthodromie (haversine/Vincenty) vs loxodromie — le calcul du plan et l'affichage
  Leaflet doivent être cohérents entre eux ; cas dégénérés (pôles, méridien 180°, points confondus).
- Alternates (`alternates.js`) : « 8 terrains régulièrement espacés le long du trajet, ± 25 NM,
  le plus proche dans chaque secteur » — vérifier l'algorithme d'espacement, l'appartenance au
  couloir, le report des mêmes terrains en PDF.
- Heures de passage, Σ durées vs durée totale, somme des distances vs total affiché.

### 3.2 Altimétrie et densité
- QNH ↔ QFE ↔ altitude (≈ 27–28 ft/hPa au niveau de la mer) : modélisation retenue et validité en altitude.
- FL ↔ altitude : alt(ft) ≈ 100 × FL + 27 × (1013 − QNH) — signes et arrondis.
- ISA : 15 °C / 1013,25 hPa, gradient 6,5 °C/km ; écart ISA à l'altitude du plan.
- Altitude-densité (`density-altitude.js`) : DA = PA + ~118,8 ft × ΔT ISA ; effet sur TAS
  (TAS = CAS·√(ρ₀/ρ)) et sur les distances de décollage.
- Altitude vraie vs indiquée (≈ 4 ft pour 1000 ft et par °C d'écart ISA) — critique en montagne
  et par temps froid : vérifier sa présence, notamment face au profil d'élévation (`route-elevation.js`).
- TA/TL France (TA 3000 ft sauf régions montagneuses — AIP ENR 1.7) ; cohérence du calage dans les calculs.

### 3.3 Météorologie — décodage, dérivations, astronomie
- Décodage METAR/TAF (`weather.js`, guides `guide-metar.html`/`guide-taf.html`) conforme Annexe 3 OACI :
  vent (VRB, rafales), visibilité (9999, CAVOK), RVR, temps présent (table 4678), nuages
  (FEW/SCT/BKN/OVC, NSC/NCD, VV, ///), T°/Td, QNH, TREND, TAF (validité, TEMPO/PROB/BECMG, TX/TN).
- CAVOK ≠ « visi 10 km » : les 3 conditions exactes (visi ≥ 10 km ; aucun nuage < 1500 m / 5000 ft
  ni CB/TCU ; aucun phénomène significatif) implémentées séparément.
- Données manquantes : une visibilité, un plafond ou un vent ABSENT est « inconnu », JAMAIS une
  valeur implicite (ex. 10 km) — règle déjà appliquée au go/no-go, à vérifier partout
  (`route-weather.js`, `watchdog.js`, widgets).
- Estimation de base nuageuse à partir de l'écart T/Td (~125 m/°C ou ~400 ft/°C) : formule identifiée,
  présentée comme estimation.
- Tendance pression (`pressure-trend.js`) : signes, unités, fenêtre de calcul, recul jour par jour
  cohérent avec `data-age.js` (1ᵉʳ du mois : message de la veille → tendance ≈ 0), pas de saut d'échelle.
- Éphémérides (`night-mode.js`, `flight-window.js`) : lever/coucher et crépuscule CIVIL (définition
  réglementaire de la nuit, SERA.2) — vérifier contre IMCCE/NOAA sur 4 dates (solstices, équinoxes)
  et 2 latitudes (nord/sud de la France) ; tolérance ±2 min ; UTC/heure locale/heure d'été sans ambiguïté.
- TEMSI (`temsi.js`) : échéances valides, âge, aucune interpolation temporelle non signalée.
- SIGMET/AIRMET (`sigmet.js`) : périmètre actif (validité temporelle ET géométrique autour de la
  route/terrain), intégration correcte au GO/NO-GO.
- Givrage carburation (`carb-icing.js`) : critères (température, humidité/écart T-Td) sourcés et
  étiquetés « zone à risque » — c'est une règle empirique, jamais une certitude.
- Niveau de congélation (`freezing-level.js`) : interpolation verticale/temporelle cohérente avec
  la source (Open-Meteo), affichage en ft/FL cohérent.

### 3.4 GO/NO-GO, minima VFR, fenêtre de vol
- `vfr-minima.js` + `go-nogo.js` : application correcte du tableau SERA.5005 PAR CLASSE d'espace
  aérien réellement traversé (via `airspace-profile.js`), y compris classes C/D/E/F/G selon
  l'altitude, + différences françaises (AIP GEN 1.7 / ENR 1.2).
- Plafond vs clairance requise : ex. BKN025 en classe D → rester ≥ 1000 ft SOUS la base ;
  les messages générés ne doivent JAMAIS suggérer de franchir par le dessus une couche fermée.
- VFR spécial, VFR de nuit : traitement explicite ou exclusion documentée.
- `flight-window.js` : la « fenêtre de vol jour VFR » doit croiser crépuscules civils, durée du plan
  et réserves — vérifier que l'alerte de nuit anticipe (marge) au lieu de réagir.
- `watchdog.js` : mêmes règles pour les terrains favoris ; visi absente = inconnue (pas 10 km).

### 3.5 Carburant et autonomie
- Bilan complet : roulage, montée, croisière (consommation × durée à l'altitude/régime RÉELLEMENT
  planifiés — pas une constante cachée), descente, approche, réserve finale, déroutement.
- Référentiel par type d'aéronef de la flotte (`aircraft-fleet.js` / `aircraft-database.js`) :
  - avion certifié EASA : arrêté du 24 juillet 1991 → réserve ≥ 20 min VFR jour / 45 min VFR nuit ;
  - ULM (ex. WT9 en classe 3 multiaxe) : arrêté du 17 février 2025 (ex-23/09/1998) → vérifier la
    valeur exacte dans le texte en vigueur et son implémentation ;
  toute valeur par défaut inférieure au minimum applicable = non-conformité BLOQUANTE.
- Conversions L ↔ kg ↔ US gal avec densité paramétrable (100LL ≈ 0,72 kg/L, Jet A1 ≈ 0,80 kg/L).
- Carburant utilisable vs contenance totale ; alertes « autonomie < durée du plan » et
  « réserve finale entamée » ; cohérence carburant entre plan, W&B (poids) et PDF.

### 3.6 Masse et centrage (`wb-core.js`, `wb-ui.js`)
- Moments (masse × bras), CG = Σmoments / Σmasses, unités homogènes.
- Enveloppe complète par avion : masse mini/maxi, limites CG avant/arrière, limites fonction de la
  masse ; position des points Décollage / Arrivée / ZFW, déplacement du CG avec la consommation.
- Centrogrammes pré-remplis de la base (`aircraft-database.js`) : vérifier AU MOINS un avion type
  (ex. DR400) contre son manuel de vol — postes, bras de levier, enveloppe.
- Détection de dépassement avec message actionnable ; gardes-fous sur saisies (masse nulle/négative,
  valeurs aberrantes, virgule décimale) ; noms de poste échappés (XSS `value=`).
- Pré-remplissage depuis le plan de nav en mode navigation : cohérence des masses embarquées
  (carburant du plan = carburant du W&B).

### 3.7 Performances de décollage (`takeoff-*.js`, `density-altitude.js`, `runway-*.js`)
- Distances de roulement et de franchissement 50 ft : facteurs vent, pente, altitude-densité,
  revêtement (herbe, dur sec/humide/contaminé) — vérifier l'ordre d'application des facteurs et la
  SOURCE de chacun (manuel de vol vs règle empirique) ; toute règle empirique étiquetée « estimation ».
- Piste en service déduite de la rose des vents : la piste (et sa longueur/pente) doit appartenir au
  TERRAIN calculé — un rayon de vent d'un autre terrain ne doit jamais sélectionner une piste
  secondaire du mauvais terrain (régression connue, §7).
- Marge restante vs longueur réelle de la piste en service (LDA) : signe et unité exacts du
  « manque », affichage du schéma en coupe cohérent avec les chiffres.
- VR utilisé pour le chrono de décollage GPS (VR − 5 kt ; 50 kt sans avion actif) : cohérent avec la
  fiche de l'avion actif de la flotte.

### 3.8 Espaces aériens, AIRAC, NOTAM
- `sia-data.js` : cycle AIRAC en vigueur calculé automatiquement (28 j) ; signalement d'un cycle
  périmé ; bascule 2026-09-03 → 2026-10-01 prévue le 01/10/2026 (dossier « telechargement AIRAC/ »).
- `airspaces.js` / `airspace-profile.js` : base SIA prioritaire, openAIP en complément — vérifier
  précédences, chevauchements, plafonds/planchers en unités cohérentes (AMSL/AGL/FL).
- `notam.js` : dossier SOFIA — en navigation il suit le plan (départ, FIR, points de passage un à un,
  arrivée) ; en local un rayon (20 NM par défaut, 10–40 réglable) avec tous les terrains du rayon.
  Vérifier : filtrage VFR, plafond = FL du plan, traduction fidèle (jamais de contresens), cohérence
  plan/PDF, aucune donnée en cache (fraîcheur au bouton Actualiser).
- SUP (`sup-sia.js`), AZBA (`azba.js`), obstacles SIA AIXM (~13 800, `data/obstacles.json`),
  fréquences (`freq-sia.js` + overrides) : fraîcheur, unités, croisement avec le profil de vol.

### 3.9 Intégrité des sorties, imports et socle
- `navlog-pdf.js` / `flight-map-pdf.js` : le PDF doit porter EXACTEMENT les valeurs de l'écran
  (caps, distances, temps, alternates, W&B, NOTAM cochés) — traquer toute divergence d'arrondi ou de
  recomputation ; pagination > 9 tronçons.
- `flight-plan-io.js` / `gps-vols.js` : round-trip JSON/GPX/KML sans perte (waypoints libres y
  compris), import CSV G1000 (70 colonnes + system_id) accepté ; aucune donnée de vol corrompue
  en cas de fichier tronqué.
- `core.js` : un seul `escapeHtml` — chasser toute réintroduction de copie locale ou d'`innerHTML`
  non échappé (y compris attributs `value=`/`data-code=`).
- `sw.js` : stratégies de cache par type de ressource, bornes/éviction, shell hors ligne complet.
- `worker/` (relais Cloudflare) : cache météo borné, route NOTAM sans cache, aucune donnée
  personnelle embarquée au-delà de la requête.
- Fuseaux horaires : tous les calculs météo/éphémérides doivent être vérifiés en UTC ET en heure
  locale (la suite de tests tourne déjà dans les deux fuseaux).

## 4. Ergonomie cockpit (l'application est utilisée EN vol)

- Mode cockpit (`cockpit-mode.js`) : lisibilité express réelle — tailles, contrastes ≥ 4,5:1
  (WCAG 2.1 AA), thème clair de briefing / sombre.
- Cibles tactiles ≥ 9–10 mm (≈ 44 px) sur mobile ; aucune action destructive sans confirmation
  (suppression d'étiquette « × », d'un vol, d'un avion de flotte) ; erreurs de saisie récupérables.
- Charge cognitive : nombre d'interactions pour une donnée essentielle ; cohérence des unités
  (NM/kt/ft par défaut, bascules possibles) ; aucune unité ambiguë (une valeur affichée = une unité).
- Hors ligne : toutes les fonctions critiques en vol opèrent sans réseau — météo en cache avec
  badges d'âge (`data-age.js`) : jamais une donnée périmée présentée comme courante ; VAC en cache
  IndexedDB ; shell PWA.
- Distraction minimale : pas d'animation inutile pendant le suivi GPS ; état toujours clair
  (calcul en cours, erreur, donnée périmée) ; écran maintenu allumé (Wake Lock) vérifié en conditions
  réelles.
- Accessibilité : daltonisme (information redondante par symbole/forme, pas seulement par couleur).
- Saisies robustes : virgule/point décimal, bornes, NaN, heures toujours affichées avec leur fuseau ;
  interface FR/EN sans texte mélangé.

## 5. Zones sensibles connues (historique du dépôt) — vérifier que les correctifs tiennent et chercher les mêmes défauts ailleurs

- Rose des pistes : une piste (longueur/pente) d'un AUTRE terrain ne doit plus matcher la paire
  secondaire du terrain calculé (garde `runwayBelongsToAirport`).
- Go/no-go et watchdog : visibilité absente = null (inconnue), pas 10 km implicite.
- Pressure-trend : recul jour par jour aligné sur data-age (1ᵉʳ du mois → message de la veille).
- XSS : 2ᵉ copie locale d'échappement dans regional-map supprimée ; postes W&B dans `value=`.
- CSP `connect-src` : toutes les sources réellement appelées autorisées (un CSV bloqué silencieusement
  a déjà été détecté).
- AIRAC périmé : signalement automatique ; retrait du cycle 09-03 après le 01/10/2026.
- Fuseaux : tests exécutés en UTC et en heure locale (régression temsi déjà corrigée).

## 6. Référentiel réglementaire (base de conformité — citer la disposition exacte pour chaque écart)

### A. Textes européens (applicables directement en France)
- Règlement (UE) 2018/1139 — règlement de base EASA (contexte).
- **SERA = Règlement (UE) 923/2012** (version consolidée EUR-Lex / EASA « Easy Access Rules for Air
  Operations ») : définitions (SERA.2 — la « nuit » va du crépuscule civil du soir à celui du matin) ;
  hauteurs minimales (SERA.3105) ; **minima VMC (SERA.5005 et son tableau)** ; **VFR spécial
  (SERA.5010)** ; niveaux de croisière (appendice de la section 5 — règle semi-circulaire,
  VFR = niveaux IFR + 500 ft) ; calage altimétrique (SERA.6015).
- **Part-NCO = Règlement (UE) 965/2012** : NCO.OP.125 (politique carburant et réserve finale).
- Part-FCL = Règlement (UE) 1178/2011 (contexte pilote, VFR de nuit).
- OACI Annexe 3 (format METAR/TAF) et Annexe 2 (contexte).

### B. Textes français
- **Arrêté du 24 juillet 1991 modifié** (conditions d'utilisation des aéronefs civils en aviation
  générale — vol à vue) : réserves carburant **20 min en VFR jour / 45 min en VFR nuit** (annexe),
  sauf ULM ; modifié notamment par l'arrêté du 17 février 2025 (NOR DEVA1242445A) — vérifier la
  version consolidée sur Légifrance.
- **Arrêté du 17 février 2025 relatif aux conditions d'utilisation des ULM** (remplace l'arrêté du
  23 septembre 1998) : règles ULM, dont la réserve carburant applicable aux ULM.
- Arrêté du 31 juillet 1981 modifié (brevets et licences ULM) — contexte.
- Code des transports (survol des agglomérations, hauteurs minimales) — contexte.
- **AIP France (SIA)** : GEN 1.7 (différences françaises aux normes OACI), ENR 1.2 (règles VFR en
  France, minima du VFR spécial), ENR 1.7 (calage altimétrique), cartes VAC — sources déjà intégrées
  au dépôt via les XML AIRAC du SIA.

### C. Données de référence pour les recalculs
- Éphémérides : IMCCE (imcce.fr) ou NOAA Solar Calculator.
- Distances/routes orthodromiques : géodésie WGS-84, cartes SIA.
- Performances : manuel de vol de l'aéronef type (flotte `aircraft-database.js`).
- Accessibilité : WCAG 2.1 niveau AA.
- Sources de données de l'application (à vérifier côté fraîcheur/intégrité) : aviationweather.gov
  (METAR/TAF/SIGMET), SIA (XML AIRAC, fréquences, espaces, obstacles, VAC), SOFIA-Briefing (NOTAM),
  Open-Meteo (vents, élévation), openAIP, RainViewer (radar), relais Cloudflare `worker/`.

## 7. Sévérité et tolérances

Sévérités :
- **BLOQUANT** : erreur de calcul hors tolérance, non-conformité réglementaire, conseil dangereux,
  perte/intégrité de données de vol.
- **MAJEUR** : écart d'arrondi significatif, ergonomie créant un risque en vol, donnée périmée non signalée.
- **MINEUR** : cosmétique, tolérance limite, documentation.
- **OBSERVATION** : piste d'amélioration.

Tolérances par défaut (sauf spécification constructeur) : cap ±1° ; vitesses ±1 kt ou 1 % ;
durées ±1 min par segment ; distances ±0,5 % ; altimétrie ±30 ft ; carburant ±2 % ;
CG ±1 % de la plage ; crépuscules ±2 min.

## 8. Livrable attendu

1. **Synthèse exécutive** : verdict global, compteurs par sévérité, risques majeurs formulés
   en langage pilote.
2. **Fiches d'anomalies** (une par écart) : n°, sévérité, module, fichier:ligne, formule implémentée
   vs formule attendue, calcul de contrôle détaillé (chiffres), disposition réglementaire en cause,
   correction recommandée, effort estimé.
3. **Matrice de conformité réglementaire** : chaque disposition du §6 × statut
   (conforme / écart / non-applicable / non-testable).
4. **Journal des recalculs** : jeux d'essai, valeur attendue, valeur obtenue, écart, verdict.
5. **Plan de correction priorisé** : bloquants d'abord, avec dépendances.

## 9. Environnement technique de l'audit

- Dépôt : branche `Version-2.0` ; application vanilla JS en modules ES (aucun framework) ;
  dépendances bundlées dans `vendor/` (Leaflet, jsPDF, pdf.js, Lucide, geomag).
- Exécution des tests : `npm install` puis `npm test` (suite `node --test`, ~528 tests, Node ≥ 24,
  vérifiés en UTC et en heure locale) — rappel : un test vert n'est PAS une preuve de justesse (§1).
- `test/qa-*.mjs` = pages d'aperçu de QA visuelle, non exécutées par `npm test` — utiles pour
  inspecter rendus PDF et schémas.
- L'audit n'installe rien, ne déploie rien, ne pousse rien : lecture seule (§0).
