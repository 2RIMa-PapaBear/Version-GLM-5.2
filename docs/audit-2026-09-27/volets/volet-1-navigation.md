# VOLET 1 — NAVIGATION, VENTS, GPS & RELIEF (agent 27/09/2026)

Audit lecture seule, recalculs indépendants (scripts hors dépôt dans C:\Users\descr\prevol-audit-tmp\).
Requêtes Open-Meteo/NOAA réelles le 27/09/2026 ~06:45 locale.

**Synthèse** : socle géométrique/trigonométrique exact au dixième près. Découverte majeure hors
premier rapport : **Open-Meteo ne fournit JAMAIS les niveaux de vent ≥ 1000 m demandés** (null
silencieux en `current` comme en `hourly`) → le « vent à l'altitude de croisière » est le vent à
180 m AGL. Seul BLOQUANT du volet + 2 MAJEURS + 9 MINEURS + 7 OBSERVATIONS.

## Fiches

- **N1 [BLOQUANT]** Niveaux ≥ 1000 m inexistants → vent croisière = vent 180 m AGL.
  `js/winds-aloft.js:42,69-70,86-93` ; idem grille `js/wind-layer.js:89,102-106`.
  Preuve : requêtes réelles Paris+Lyon — `windspeed_1000m/1500m/2000m/3000m` → null (current ET
  hourly) ; `windspeed_120m` OK ; `windspeed_925hPa` OK. L'API n'expose `wind_speed_Xm` qu'à
  10/80/120/180 m AGL. Donc winds = [262 ft, 590 ft] → toute croisière ≥ ~590 ft AGL reçoit le
  vent du niveau 180 m. Impact mesuré (Paris 12:00 : 180 m = 12,8 km/h du 164° ; 925 hPa ≈ 2500 ft
  = 36,1 km/h du 216°) sur Rv090/TAS100 : WCA réelle +9,1°/GS 110,2 kt contre app +3,8°/97,9 kt →
  **Δ 5,3° de cap, 12,3 kt (12 %)** ; sur 150 NM à 35 L/h : 10 min et 6 L. Étiquette écran
  « Vent à 3500 ft » fausse (`flight-planner-ui.js:1261`) ; tests winds-aloft encodent une réponse
  à 3+ niveaux que l'API ne produit jamais. **Fix (M)** : niveaux isobariques `windspeed_975hPa…
  850hPa` (≈250/1500/2500/3300/5000 ft, dispo en hourly) + interpolation avec l'élévation du
  modèle ; à défaut borner l'affichage (« vent niveau 180 m »).
- **N2 [MAJEUR]** Vents de l'instant présent (`current.time` = heure de la requête), pas de
  l'heure de vol — CONFIRME F2. `winds-aloft.js:69-70` ; `flight-planner.js:370-371,479-480` ;
  `wind-layer.js:106`. **Fix (M)** : hourly + start/end_date autour de l'heure estimée.
- **N3 [MAJEUR]** PDF log de nav : colonne « Z sécu » calculée sur le profil de REPLI sans relief
  (et sans obstacles). `flight-planner-ui.js:417-435` (`zSecuFor` ne vérifie pas `noTerrain`),
  `:446`, `navlog-pdf.js:268`. L'écran est correct (`clearance = null` sur repli,
  `flight-planner.js:402-405,526-527`) mais la Z sécu du TABLEAU PDF l'ignore — en relief elle
  peut être de plusieurs milliers de pieds trop basse, bandeau d'avertissement uniquement sur la
  page profil. **Fix (S)** : `zSecu = ''` quand `noTerrain` + mention.
- **N4 [MINEUR]** GS=0 (vent ≥ TAS) → repli silencieux GS=TAS (CONFIRME F10). Exécuté : vent
  120 kt face → GS 0 remplacé par 100. **Fix (S)** : avertir.
- **N5 [MINEUR]** Cache déclinaison : TTL 30 j GLOBAL (`__ts` rafraîchi par n'importe quelle
  écriture) — la garantie « 30 j » n'est pas tenue par entrée. `magvar.js:7,14-15,22-31`.
- **N6 [MINEUR]** Import GPX tiers : `rtept` sans `<name>` avale le `rtept` SUIVANT (regex à
  groupe optionnel traversant). `flight-plan-io.js:123-127`. Exécuté : 2 rtept → 1 point, le
  (3,4) perdu, nom « AVEC » affecté au mauvais point. Fichiers de l'app insensibles (name
  toujours présent). **Fix (S)** : garde `(?:(?!rtept)[\s\S])*?`.
- **N7 [MINEUR]** Import GPX : attributs `lon` avant `lat` non reconnus → 0 point (erreur claire,
  pas de corruption). `flight-plan-io.js:123,129`. **Fix (S)** : matcher chaque attribut
  indépendamment.
- **N8 [MINEUR]** Chrono GPS sans filtrage/hystérésis : un fix isolé ≥ VR−5 (accuracy non testée)
  démarre le chrono ; durée étendue jusqu'à l'arrêt du suivi (parking inclus). `gps.js:424-425,
  520-523,358`. **Fix (S)** : 2-3 fixes consécutifs + accuracy bornée + arrêt après ~60 s sous
  seuil.
- **N9 [MINEUR]** wind-layer : plan à 6000 ft → sélecteur affiche 2000 pendant que les flèches
  sont à l'altitude du plan. `wind-layer.js:146,176-179`.
- **N10 [MINEUR]** Commentaire GPS obsolète « > 35 kt » vs code VR−5/50 kt. `gps.js:20-21`.
- **N11 [MINEUR]** `getMagneticDeclination` : clé cache arrondie au degré (~60 NM de rayon).
  `magvar.js:126-130`. Impact ≤0,1°.
- **N12 [MINEUR]** Trace GPS : sauts de position non filtrés à l'export (accuracy exportée mais
  jamais utilisée). `gps-vols.js:111-122`.
- **N13 [OBSERVATION]** WMM2020 extrapolé vs NOAA WMM2025 : LFPB 2,30/2,13 (+0,17°), Brest
  0,18/0,054 (+0,13°) — CONFIRME F9, chiffré. Sans impact France (SIA prioritaire, vérifié
  `sia-data.js:155-158`). Fix : coefficients WMM2025.
- **N14 [OBSERVATION]** geomag : paramètre altitude en KILOMÈTRES (commenté « altM » dans
  magvar.js:94) — `field(49,2,914)` = 0,65° vs 2,30° à 0 : physiquement impossible. Aucun impact
  actuel (toujours 0). Latent. `vendor/geomag.js:123-127`.
- **N15 [OBSERVATION]** Multi-leg : vent milieu unique + déclinaison départ sans alerte écran
  (CONFIRME F11). `flight-planner.js:473-483`.
- **N16 [OBSERVATION]** Σ temps de tronçons arrondis ≠ total (total = round(Σ non arrondis)).
  `flight-planner.js:499-511`. Artefact d'affichage ≤0,5 min/tronçon.
- **N17 [OBSERVATION]** KML : LineString mono-coordonnée importée comme waypoint.
  `flight-plan-io.js:173`.

## Vérifications conformes (preuves)

1. Triangle des vents — 9 cas vs résolution VECTORIELLE indépendante : identiques (Rv090/TAS100/
   030/30 → WCA −15,1°, GS 82, face 15, travers 26 ; référence 74,94°/81,57).
2. Orthodromie LFPB→LFRM : app 114,6505 NM / 237,128° ; contrôles (loi cosinus, haversine,
   vecteurs 3D) 114,651 NM / 237,13° — écart < 0,001 NM.
3. Dégénérés : points confondus (0 NM, pas de NaN), antiméridien (60,04 NM, cap 090/270 exacts).
4. Chaîne caps : « East is least » ✔ ; priorité SIA → LS → WMM ✔.
5. getWindAtAltitude : interpolation ✔ (exécuté : 19 kt/209° attendu exact), AMSL→AGL ✔,
   circulaire 350→10 par 000 ✔, bornes ✔, cache TTL 1 h ✔.
6. Direction Open-Meteo = d'origine (« du »), cohérente partout ; flèches carte +180° ✔.
7. Constantes unités : toutes exactes (1,852 / 3,28084 / 0,3048 / 1,94384 / 3440,065…).
8. Cross-track alternates LFOP/LFPB→LFRM : app 45,43 NM D / ATD 34,34 = formulary (équirect
   45,49/35,35). (Premier chiffre 15,82 = bug de MON script — traçé.)
9. Algorithme 8 alternates : ancres (i+0,5)·route/8, couloir ±25 NM sur polyligne, glouton rayon
   25 NM, dédoublonnage, < 8 terrains, vol local = proximité ; écran et PDF appellent la MÊME
   fonction `getEnRouteAlternates(pts, 25, 8)` (alternates.js:311 / flight-planner-ui.js:629).
10. Seuil chrono : VR−5, plancher 10 ; sans avion 50 kt = 25,72 m/s ✔ ; sessions < 5 min
    supprimées + finalisation orphelins ✔.
11. Round-trip JSON↔GPX↔KML : fidélité 1e-6°, noms accentués/entités préservés, ele 3500 ft →
    1067 m ✔, rebuild identique.
12. Fichiers tronqués : points complets uniquement, aucune coordonnée corrompue ; JSON → erreur
    claire.
13. Exports GPS : GPX 1.1 complet, KML gx:Track apparié, CSV G1000 (×3,28084/×1,94384/×196,85
    exacts), vario ±2 points vérifié, filtre immobilité ✔.
14. Relief : échantillonnage ~1 pt/3 NM, m→ft ✔, evaluateClearance (600→caution, −400→danger,
    obstacles au pire point, 1000 ft) ✔ ; marge JAMAIS calculée sur repli à l'écran ✔ ;
    corridor obstacles 0,5 NM ✔.
15. Terrarium : décodage (R×256+G+B/256)−32768 exact, Mercator slippy, bilinéaire ✔.
16. Grille vent : couverture totale ≤ maxPoints, repli 2000 ft non mémorisé ✔.
17. Étiquettes tronçons : valeurs PRISES du plan ; repli = cap vrai recalculé − déclinaison
    tronçon + ortho, temps omis (jamais inventé) ✔.
18. flight-mode.js : UI seule, aucun calcul ✔.

## Re-vérification premier rapport

- F2 vents current → **CONFIRMÉ** (requête réelle : current.time = instant présent).
- F9 WMM2020 → **CONFIRMÉ CHIFFRÉ** (+0,17° LFPB, +0,13° Brest vs WMM2025).
- F10 GS repli TAS → **CONFIRMÉ** (exécuté).
- F11 vent milieu/déclinaison départ → **CONFIRMÉ**.
- F14 interpolation 180→1000 m → **INFIRMÉ EN L'ÉTAT** : le niveau 1000 m n'est JAMAIS renvoyé
  (null) — l'interpolation n'a jamais lieu ; le défaut réel est N1 (aucun niveau > 180 m).

## Non-vérifiables

Rendu navigateur (Leaflet/canvas/DOM tactile), bases locales non chargées sous Node
(airports.json/AIRAC/obstacles → _corridorAirports, getOfficialDeclination par lecture),
IndexedDB réel, comportement futur de l'API Open-Meteo (constat daté 27/09, 2 points),
relais Cloudflare, exactitude 925 hPa vs altitude vraie (ordre de grandeur seulement).

**Plan volet** : P1 N1 (M) ; P2 N2 (M), N3 (S) ; P3 N4/N6/N7/N8 (S) ; P4 N5/N9-N17 (S).
Scripts de contrôle : C:\Users\descr\prevol-audit-tmp\ (hors dépôt).
