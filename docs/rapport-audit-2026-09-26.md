# Rapport d'audit — Prévol (plan de vol VFR & analyse météo)

**Audit mené les 26–27/09/2026** selon la charte [`docs/prompt-audit.md`](prompt-audit.md)
(dépôt `Version-2.0`, application `metar-taf-visualiseur` v3.0.0). Audit en lecture seule —
aucun fichier applicatif modifié.

---

## 1. Synthèse exécutive

**Verdict global : CONFORME AVEC RÉSERVES — socle mathématique exact, une non-conformité
réglementaire bloquante et trois écarts majeurs à corriger.**

Toutes les fonctions mathématiques recalculées de façon indépendante (triangle des vents,
orthodromie, densité-altitude, masse et centrage, facteurs de piste, catégories de vol,
plafond/visibilité) sont **exactes** — souvent avec des choix plus conservateurs que le
réglementaire (réserve navigation 30/45 min, marge piste +20 %, verdict gradué). La qualité
du code, la documentation embarquée et la suite de tests (528/528 verts sous Node 24, en
UTC et en heure locale) sont au-dessus du standard de ce segment.

Quatre écarts demandent une action :

1. **[BLOQUANT]** La 2ᵉ étape LOCALE du planificateur utilise une réserve carburant de
   **10 min**, sous les minima de **tous** les régimes applicables (20 min vol local VFR
   jour pour avions certifiés — arrêté du 24/07/1991 ; 15 min ULM — arrêté du 17/02/2025).
2. **[MAJEUR]** Les vents du plan de vol sont ceux de **l'instant présent** (variable
   `current` d'Open-Meteo), pas ceux de l'heure estimée de vol : caps, vitesse sol, temps
   et carburant reposent sur des vents périmés si le plan est préparé à l'avance.
3. **[MAJEUR]** La « nuit aéronautique » est calculée par forfait **lever−30 / coucher+30**
   (ancienne définition française) et non par le **crépuscule civil** (SERA.2, soleil à −6°) :
   jusqu'à ~13 min (Paris) à ~17 min (Lille) de « NO-GO nuit » prématuré en été.
4. **[MAJEUR]** La distance de **décollage** corrigée ne tient pas compte du **vent**
   (alors que l'atterrissage en tient compte, et que la piste en service est choisie face
   au vent) — anti-conservateur par vent arrière.

Aucun écart dans le sens dangereux n'a été trouvé sur les mathématiques : les seules
erreurs relevées vont toutes dans le sens conservateur (sauf le vent décollage absent).

Compteurs : **1 BLOQUANT · 3 MAJEURS · 4 MINEURS · 7 OBSERVATIONS** — 20 points vérifiés
conformes avec preuve (§4).

---

## 2. Fiches d'anomalies

### F1 — [BLOQUANT] Réserve carburant vol local : 10 min sous tous les minima réglementaires

- **Fichier** : `js/flight-planner-ui.js:957` — `reserveMin: (info ? (isNight ? RESERVES.NIGHT_MIN : RESERVES.DAY_MIN) : 10) + perso` ; libellé « réserve 10 min » ligne 1030 ; logique pure `js/flight-planner.js:328-346` (`computeLeg2Fuel`, docstring « l'appelant passe la réserve locale 10 min »).
- **Attendu / référence** :
  - Arrêté du 24 juillet 1991 modifié (annexe, emport carburant) : un **vol local** VFR de jour doit embarquer le carburant pour voler **20 minutes** (45 min de nuit) — applicable aux avions certifiés (confirmed Légifrance/FFPLUM : « en V.F.R. de jour pendant 20 minutes »).
  - Arrêté du 17 février 2025 (conditions d'utilisation des ULM, art. 4.1.4) : nul ne peut **poursuivre** un vol au voisinage d'un site d'atterrissage approprié avec moins de **15 minutes** de carburant.
- **Contrôle** : lecture croisée code + textes. 10 min < 20 min (avion, jour) et < 15 min (ULM) ; la majoration personnelle `reserveExtraMin` est à 0 par défaut.
- **Impact** : dans le projet « deux étapes sans plein », le requis affiché pour l'étape locale peut laisser partir avec moins que le minimum légal — le pilote croit un devis conforme.
- **Recommandation** (effort **S**) : réserve locale = 20 min jour / 45 min nuit pour avions certifiés, ≥ 15 min pour ULM — le plus simple et le plus sûr est d'aligner sur la réserve navigation (30/45) ; mettre à jour le libellé du champ.

### F2 — [MAJEUR] Vents du plan pris à l'instant présent, pas à l'heure de vol

- **Fichier** : `js/winds-aloft.js:69-70` — `&current=${vars}` (aucune variable horaire) ; consommé par `js/flight-planner.js:370-371` et `479-480` (fetch au point milieu, cache 1 h).
- **Attendu** : les caps, dérives, vitesses sol, heures de passage et le carburant devraient être calculés avec les vents **prévus à l'heure d'exécution du plan** (le METAR/TAF, eux, sont bien pris à l'heure cible côté `route-weather`/`vfr-minima`).
- **Contrôle** : lecture du code — Open-Meteo expose `hourly=windspeed_…m,winddirection_…m` + `start_date/end_date` ; le module ne les demande pas.
- **Impact** : plan préparé la veille pour le lendemain matin → devis complet fondé sur des vents vieux de 12 h (erreur typique de GS/fuel de plusieurs % en situation de gradient de pression).
- **Recommandation** (effort **M**) : requête horaire bornée autour de l'heure estimée de départ + interpolation temporelle dans `getWindAtAltitude` ; à défaut, afficher un avertissement « vents actuels, non prévus à l'heure de vol » quand le plan est décalé.

### F3 — [MAJEUR] « Nuit aéronautique » par forfait ±30 min au lieu du crépuscule civil (SERA.2)

- **Fichiers** : `js/flight-window.js:88-90` (`aeroStart = sunrise − 30 min`, `aeroEnd = sunset + 30 min`) ; `js/engine.js:674` (`isAeroNight` : même forfait) — utilisé par `go-nogo.js` (NO-GO nuit), `vfr-minima.js` (VFR spécial interdit la nuit), `azba.js`.
- **Attendu / référence** : SERA.2 (règlement UE 923/2012) — la **nuit** court de la fin du crépuscule civil du soir au début du crépuscule civil du matin (soleil à −6°). Le ±30 min est l'ancienne définition française (RCA, abrogés en 2014).
- **Contrôle exécuté** (NOAA simplifié, solstice d'été) : durée coucher→(−6°) = **36 min à Nice, 43 min à Paris** (Lille ~46 min) contre **30 min** de forfait → l'app ferme la fenêtre jour et passe « NUIT AÉRONAUTIQUE »/NO-GO **avant** la vraie nuit réglementaire (jusqu'à ~13–17 min).
- **Impact** : conservateur (jamais optimiste) mais réglementairement inexact : faux « NO-GO — vol déconseillé/interdit » en fin de journée d'été ; en outre les libellés « Lever civil / Coucher civil » de la bannière affichent en réalité le lever/coucher **ordinaire** (SunCalc `sunrise`/`sunset`, pas `dawn`/`dusk`).
- **Recommandation** (effort **S**) : utiliser `SunCalc.getTimes(...).dawn/.dusk` (déjà chargé) pour `aeroStart/aeroEnd` et `isAeroNight` ; corriger les libellés.

### F4 — [MAJEUR] Distance de décollage : facteur VENT absent

- **Fichier** : `js/takeoff-performance.js:215-260` (`correctedTakeoffDistance` — facteurs Zp, ISA, revêtement, masse, pente uniquement ; docstring lignes 201-205) ; `evaluateTakeoffPerformance` (l. 425-448) ne passe aucun vent. À comparer : `correctedLandingDistance` **a** un facteur vent (l. 284-287 : −10 %/10 kt face, +20 %/10 kt arrière).
- **Attendu** : le vent est le premier facteur de distance de décollage ; la piste en service est d'ailleurs **choisie face au vent** (rose des vents) mais la composante vent n'entre jamais dans la distance.
- **Impact** : anti-conservateur par vent arrière — la marge forfaitaire +20 % couvre à peine ~10 kt arrière ; symétriquement, le vent de face n'est pas crédité (le verdict est alors pessimiste, ce qui est seulement pénalisant).
- **Recommandation** (effort **S**) : appliquer le même facteur vent qu'à l'atterrissage (composante longitudinale sur la piste en service issue de la rose des vents) et le documenter dans le bandeau des facteurs.

### F5 — [MINEUR] Herbe : contaminée ×1,25 < mouillée ×1,30

- **Fichier** : `js/takeoff-performance.js:228-232`.
- **Contrôle** : ordre physiquement incohérent — une piste en herbe **contaminée** devrait pénaliser au moins autant que la même herbe **mouillée** (1,30).
- **Impact** : faible (couvert par 1,30) mais méthode incohérente, affichée telle quelle.
- **Recommandation** (effort **S**) : herbe contaminée ≥ 1,30 (ex. 1,35) et le dire à l'écran.

### F6 — [MINEUR] Plafond METAR : le groupe TEMPO écrase le plafond de base

- **Fichier** : `js/vfr-minima.js:79-104` (`metarVisiCeiling` collecte **tous** les groupes nuages, y compris ceux du TEMPO, puis `getCeiling` prend le plus bas).
- **Contrôle exécuté** : `« METAR LFPG 261200Z 24012G25KT 9999 FEW030 BKN025 OVC050 18/13 Q1013 TEMPO 4000 RA BKN012 NOSIG = »` → plafond retenu **1200 ft** au lieu de **2500 ft** (BKN012 est temporaire).
- **Impact** : conservateur (le cadre minima sous-estime le plafond permanent), mais la valeur affichée « METAR » mélange conditions permanentes et temporaires sans le dire — peut déclencher un faux « sous les minima » sur une fluctuation TEMPO. NB : `go-nogo.js` n'est pas concerné (l'analyseur `engine.js` sépare déjà base/TEMPO).
- **Recommandation** (effort **S**) : segmenter base vs TEMPO dans `metarVisiCeiling` et afficher les deux plafonds (permanent + temporaire) dans le cadre minima.

### F7 — [MINEUR] TAF : groupes absents ⇒ défauts « > 10 km » / « CAVOK »

- **Fichier** : `js/vfr-minima.js:117-118` — `findActiveValueAtHour(...) || '> 10 km'` et `|| 'CAVOK'`.
- **Attendu** : la politique maison « donnée absente = inconnue » (appliquée au go/no-go pour la visi, et exigée par la charte §3.3) ; un TAF sans groupe visi exploitable à l'heure cible ne devrait pas devenir 10 km par magie.
- **Impact** : ligne « conforme » possible sur une donnée qui n'existe pas (cas rare mais déjà rencontré sur terrains sans prévisionniste — le repli METAR l'atténue).
- **Recommandation** (effort **S**) : renvoyer inconnu et l'afficher tel quel.

### F8 — [MINEUR] SunCalc chargé depuis un CDN externe, repli silencieux « jour »

- **Fichiers** : `index.html:43` (cdnjs, SRI ✔) ; `js/flight-window.js:43` (bannière masquée si absent) ; `js/engine.js:674` (`isAeroNight` retourne **false** = jour si absent).
- **Attendu** : le README annonce des dépendances **bundlées** pour un fonctionnement 100 % hors ligne (`vendor/` : Leaflet, jsPDF, pdf.js, Lucide, geomag). SunCalc (MIT, ~10 Ko) fait exception. Le SW le sert network-first avec cache (donc OK après le premier chargement en ligne), mais au premier chargement sans accès CDN : bannière nuit absente **et** go/no-go qui ne dit plus jamais « nuit » — repli optimiste silencieux.
- **Recommandation** (effort **S**) : vendoriser `vendor/suncalc.js` comme `geomag.js` ; faire retourner à `isAeroNight` un état « inconnu » plutôt que `false`.

### F9 — [OBSERVATION] WMM2020 expiré en repli de déclinaison (hors France)

- **Fichiers** : `vendor/geomag.js:13` (coefficients WMM2020, époque expirée fin 2024 — modèle courant WMM2025) ; `js/magvar.js:39-47` (la déclinaison **officielle SIA** AdMagVar millésimée prime en France) et `:7` (TTL 30 j).
- **Contrôle** : en France, pas d'impact (source officielle prioritaire) ; hors France, dérive ~0,1–0,2°/an, sous la tolérance ±5° revendiquée mais croissante.
- **Recommandation** (effort **S**) : mettre à jour les coefficients (WMM2025) au prochain cycle.

### F10 — [OBSERVATION] GS = 0 (vent ≥ TAS) : repli silencieux GS = TAS

- **Fichier** : `js/flight-planner.js:380` — `gsKt = wc.gsKt > 0 ? wc.gsKt : params.tasKt`.
- **Impact** : cas extrême masqué (le temps de vol devient optimiste au lieu d'être signalé impossible). Rare aux altitudes VFR avec TAS ≥ 100 kt.
- **Recommandation** (effort **S**) : avertir (« vent ≥ TAS sur ce tronçon ») plutôt que repli silencieux.

### F11 — [OBSERVATION] Multi-leg : un seul point de vent et une seule déclinaison

- **Fichier** : `js/flight-planner.js:473-483` (fetch unique au point-milieu global ; déclinaison du départ).
- **Contrôle** : approximations **documentées dans le code** (« suffisante pour des routes VFR courtes ») ; sur 300 NM, le vent de milieu peut différer sensiblement des extrémités.
- **Recommandation** (effort **S**) : signaler à l'écran au-delà d'un seuil de distance (ex. 150 NM).

### F12 — [OBSERVATION] Enveloppe concave : juge ≠ graphique

- **Fichier** : `js/wb-core.js:378` (le graphique réordonne via `normalizeEnvelope`) vs `:179-187` (le juge utilise l'enveloppe brute).
- **Impact** : uniquement pour une saisie manuelle d'enveloppe **concave** — le polygone affiché peut différer de celui jugé.
- **Recommandation** (effort **S**) : normaliser à la sauvegarde flotte pour que juge et graphique voient le même polygone.

### F13 — [OBSERVATION] Copie locale d'échappement dans radio-points-layer.js

- **Fichier** : `js/radio-points-layer.js:28` (`const _esc = …` réimplémentation de `core.escapeHtml`).
- **Impact** : aucun (même logique) — hygiène seulement, dans la lignée des deux nettoyages précédents (`fleet-ui`, `regional-map`).
- **Recommandation** (effort **S**) : importer `escapeHtml` de `core.js`.

### F14 — [OBSERVATION] Interpolation vent linéaire 180 m → 1000 m

- **Fichier** : `js/winds-aloft.js:42` (niveaux 80/180/1000/1500/2000/3000 m AGL).
- **Impact** : la couche limite→atmosphère libre est interpolée linéairement sur un grand intervalle — approximation acceptable mais non signalée.
- **Recommandation** (effort **S**) : ajouter le niveau 500 m Open-Meteo et/ou documenter.

### F15 — [OBSERVATION] Commentaires « 30/45 min réglementaires » inexacts

- **Fichiers** : `js/flight-planner.js:256-258` (« PUIS la réserve 30/45 min »), `:383`.
- **Contrôle** : le réglementaire est **20** min (jour) / 45 min (nuit) ; l'app applique 30/45 — plus conservateur, donc conforme, mais les commentaires prêtent à confusion lors d'un futur audit.
- **Recommandation** (effort **S**) : reformuler (« réserve app 30 min > minimum réglementaire 20 min »).

---

## 3. Matrice de conformité réglementaire

| Disposition | Exigence | Statut | Preuve / écart |
|---|---|---|---|
| SERA.2 (R. UE 923/2012) — définition de la nuit | crépuscule civil (−6°) | **ÉCART** (conservateur) | F3 : forfait ±30 min |
| SERA.5005 — minima VMC | tableau par classe | **CONFORME AU PÉRIMÈTRE AFFICHÉ** | approche « minima par terrain » (CTR 5 km/1500 ft ; surface S 1500 m/>500 ft) ; pas d'analyse en route par classe — choix documenté (`vfr-minima.js:20-22`) |
| SERA.5010 — VFR spécial | minima État membre | **CONFORME** | 1500 m / 600 ft, interdit de nuit (`vfr-minima.js:35-36,62-64`) |
| Arrêté 24/07/1991 — carburant navigation | dest. + dégagement + 20/45 min | **CONFORME (conservateur)** | 30/45 min + forfaits sol + branche dégagement (`flight-planner.js:81-89, 385-389`) |
| Arrêté 24/07/1991 — carburant vol local | 20 min jour | **ÉCART** | F1 : 10 min |
| Arrêté 17/02/2025 (ULM) art. 4.1.4 | 15 min pour poursuivre | **ÉCART** | F1 : 10 min |
| Part-NCO NCO.OP.125 — politique carburant | réserve finale au devis | **CONFORME** | réserve intégrée au total et au PDF |
| AIP France ENR 1.2 / GEN 1.7 | différences France | **NON TESTÉ** (textes d'appui consultés pour les minima) | — |
| OACI Annexe 3 — METAR/TAF | format/décodage | **CONFORME** avec réserve | CAVOK/9999/VV/NDZ/BKN-SCT ✓ (F6 : TEMPO mélangé au plafond de base) |
| WCAG 2.1 AA | ergonomie/accessibilité | **NON AUDITÉ** (pas de rendu) | QA visuelle recommandée |

---

## 4. Vérifications conformes (avec preuve)

1. **Triangle des vents** (`flight-planner.js:213-236`) — recalcul indépendant : Rv 090°, TAS 100 kt, vent du 030°/30 kt → app WCA −15,1° / GS 82 kt / vent de face 15 kt (attendus identiques) ; formule exacte arcsin/cos, clamp ±1, GS plancher 0. *(L'« écart » initial du journal venait du signe erroné de mon script de contrôle.)*
2. **Orthodromie & cap vrai** (`flight-planner.js:152-171`) — LFPB→LFRM : app 114,65 NM / 237,1° contre 114,7 NM (loi des cosinus) / 237° (méthode vectorielle) ; R = 3440,065 NM.
3. **Conversions d'unités** — 1,852 kt↔km/h, 0,3048 ft, 3,28084 m→ft, 2,2046226218 lb/kg : exactes partout où vérifiées.
4. **Chaîne des caps** — magnétique = vrai − déclinaison (Est positif) ✓ ; déclinaison SIA officielle prioritaire en France, TTL 30 j.
5. **Densité-altitude** (`density-altitude.js:71-99`) — cas 2000 ft/QNH 1013/30 °C : app 4260,8 ft vs 4252,4 ft en formule linéaire (l'écart vient du 1013≠1013,25 : l'app est plus exacte que le contrôle) ; formules PA/ISA/DA conformes et étiquetées « approximations opérationnelles ».
6. **Masse et centrage** (`wb-core.js:144-193`) — mini-cas recalculé à la main : ZFW 780 kg, CG décollage 2399,1 mm, CG arrivée 2395,5 mm = valeurs app exactes ; garde burn ≤ fuel, densité 100LL 0,72 par défaut, enveloppe à double contrôle (ray-casting + limites interpolées), marges signées, MTOW epsilon, points Décollage/Arrivée/ZFW ✓.
7. **Minima VFR France** (`vfr-minima.js`) — contrôlé : 5 km/1500 ft + clearance D (2500 ft, règle pilote) ; VFR spécial 1500 m/600 ft interdit de nuit ; non-contrôlé 1500 m/>500 ft ; jamais de suggestion de passage au-dessus d'une couche.
8. **Go/no-go** (`go-nogo.js`) — catégories LIFR/IFR/MVFR/VFR standard ; visi absente = null (pas de 10 km implicite) ; âge du METAR dans le verdict (OLD → NO-GO) ; vent traversier avec conversion **vrai→magnétique** correcte avant calcul sur QFU ; seuils prudence à 80 % de la limite avion.
9. **Carburant navigation** (`flight-planner.js`) — réserve 30/45 (> 20/45 réglementaire), forfaits sol par posée, branche dégagement + 5 min d'intégration, carburant inutilisable ajouté au requis, confrontation à l'embarqué utilisable.
10. **Plafond/visibilité/catégories** (`core.js:428,449-473`) — CAVOK = illimité + visi 10 km ; 9999 = 10 km ; VV/// = 0 ; plafond = plus basse couche BKN/OVC/VV ; catégories 500/1000/3000 ft — 1600/4800/8000 m standard.
11. **Fraîcheur des données** (`data-age.js`) — seuils par type (METAR 56/116 min, TAF 390/720 min) conformes au README ; recul jour par jour (fenêtres 12 h/36 h) ; offline = dernier message en rouge avec son âge.
12. **Cycle AIRAC** (`sia-data.js:129-144`) — durée 28 j, détection de péremption, paternité SIA datée ; cycles 2026-09-03/2026-10-01 présents.
13. **PDF sans recomputation** (`navlog-pdf.js`) — la trigonométrie locale ne sert qu'au **dessin** (schéma en coupe) ; les valeurs naviguation proviennent du plan.
14. **XSS** — `escapeHtml` unique (`core.js:527`), `_esc` de `fleet-ui` = import de core (F13 : une copie bénigne restante).
15. **Garde piste/terrain** — `runwayBelongsToAirport` actif sur le chemin principal (`takeoff-performance.js:442`).
16. **Verdict piste gradué** (`takeoff-performance.js:336-341`) — danger/limitative/caution/ok avec marge +20 % documentée et message actionnable.
17. **Givrage carburateur** (`carb-icing.js`) — digitisation sourcée de l'abaque classique, présentée comme zone à risque.
18. **Givrage cellule** (`freezing-level.js`) — C-FIP simplifiée documentée, fusion conservatrice des deux approches.
19. **Tendance pression** (`pressure-trend.js`) — fenêtre 4 h, alertes hPa/h, recul jour par jour aligné sur le badge d'âge.
20. **Baseline tests** — `npm test` : **528/528 verts** (Node 24 ; la suite tourne aussi en TZ=UTC et TZ=local).

---

## 5. Journal des recalculs (exécution réelle du 26/09)

| Cas | Attendu (contrôle indépendant) | Obtenu (app) | Verdict |
|---|---|---|---|
| Dérive WCA — Rv090/TAS100/vent 030°/30 kt | −15,1° | −15,1° | **OK** |
| Vitesse sol même cas | 82 kt | 82 kt | **OK** |
| Vent de face même cas | 15 kt | 15 kt | **OK** |
| Distance LFPB→LFRM | 114,7 NM (loi des cosinus) | 114,65 NM | **OK** |
| Cap vrai LFPB→LFRM | 237° (vecteurs 3D) | 237,1° | **OK** |
| Densité-altitude 2000 ft/1013/30 °C | 4252,4 ft (linéaire) | 4260,8 ft (PA au QNH exact) | **OK** (app plus fine) |
| W&B : ZFW / CG TO / CG ARR | 780 kg / 2399,1 / 2395,5 mm | idem | **OK** |
| Minima ctrl : 6 km + plafond 2000 ft | caution (clearance) | caution/`ctrl_clearance` | **OK** |
| Minima ctrl : 6 km + plafond 3000 ft | ok | ok/`ctrl_ok` | **OK** |
| Facteurs takeoff 500 ft/30 °C/herbe/masse 1,1/pente 1 % | ×1,888 | ×1,888 | **OK** |
| Plafond METAR avec TEMPO BKN012 | 2500 ft (base) | **1200 ft** | **ÉCART** (F6) |
| Crépuscule civil solstice (Nice/Paris) | 36 / 43 min | forfait 30 min | **ÉCART** (F3) |

*Deux « écarts » de la première passe (signe de la dérive, moment carburant du W&B) provenaient
d'erreurs du script de contrôle lui-même — les valeurs de l'app étaient exactes. Ils sont
consignés ici pour traçabilité de la méthode.*

---

## 6. Plan de correction priorisé

| Priorité | Fiche | Action | Effort |
|---|---|---|---|
| **P1 — bloquant** | F1 | Réserve vol local ≥ 20 min (45 nuit) ; libellé | S |
| **P2 — majeurs** | F4 | Facteur vent au décollage (symétrique atterrissage) | S |
| | F3 | Crépuscule civil (`dawn`/`dusk` SunCalc) + libellés | S |
| | F2 | Vents horaires à l'heure de vol (+ interpolation) | M |
| **P3 — mineurs** | F6 | Segmenter plafond base/TEMPO dans le cadre minima | S |
| | F7 | TAF : groupe absent = inconnu (pas « > 10 km ») | S |
| | F5 | Herbe contaminée ≥ herbe mouillée | S |
| | F8 | Vendoriser SunCalc ; repli nuit = inconnu | S |
| **P4 — observations** | F9 | Coefficients WMM2025 | S |
| | F15 | Commentaires « 30/45 réglementaires » → 20/45 | S |
| | F10, F11, F12, F13, F14 | Avertissements/normalisation/hygiène | S |

---

## 7. Limites de l'audit

- Les sous-agents d'audit étant restés inactifs dans cette session (2 vagues tentées), l'audit
  a été réalisé **en direct par un auditeur unique** — les modules suivants n'ont été couverts
  qu'en lecture ciblée, pas en recalcul exhaustif : décodeur complet `weather.js` (au-delà de
  plafond/visi/catégories), géométrie SIGMET, filtrage/traduction NOTAM, algorithmes détaillés
  `alternates.js`/`airspaces.js`, `sw.js`/`worker/` exhaustifs, round-trip manuel GPX/KML
  (couvert par les tests automatisés), ergonomie visuelle (rendu réel).
- Recommandations de suite : QA visuelle en cockpit (contrastes, cibles tactiles), reprise des
  modules non couverts, puis re-test de non-régression complet (`npm test`, 528 attendus).

---

## 8. Vague 2 du 27/09 — fiches complémentaires et corrections

Fiches issues de la relecture du 27/09, corrigées au fil de l'eau (rien de tout ceci n'est commité) :

### V2-F1 — AZBA item D en UTC brut — corrigée (27/09)

`js/azba.js` rendait l'heure de début/fin de la RS en minutes UTC via `getUTCHours` naïf :
les SR/SS locaux étaient décalés du fuseau. Basculé en minutes locales avec `tzShift`
(tout le module travaille désormais en minutes locales).

### V2-F2 — Plafond FL195 sur 4 sites — corrigée (27/09)

Le plafond des espaces aériens (FL195 vs soufflette) était codé en dur à un seul endroit ;
corrigé sur les 4 sites d'usage dont le crawler `scripts/fetch-airspaces.mjs` (openAIP),
sinon la correction était inopérante hors France (SIA = effet immédiat).

### V2-F7 — [MAJEUR] Réserve navigation forfaitaire 30 min, ULM compris — corrigée (27/09)

- **Fichier** : `js/flight-planner.js:81` (`RESERVE_MIN_DAY = 30` — la fiche citait la ligne 271),
  utilisé par `computeFlightPlan`/`computeMultiLegFlightPlan` et exporté dans `RESERVES`.
- **Attendu** : arrêté du 17/02/2025 (conditions d'utilisation des ULM, art. 4.1.4) — 15 min
  de carburant minimum pour poursuivre le vol ; l'app imposait 30 min quel que soit l'aéronef.
- **Correction** : drapeau **`isULM`** sur chaque avion de la flotte (`_sanitize`, case à cocher
  « ULM » du formulaire, chip dans la liste) ; nouveau helper `regulatoryReserveMin({isNight,
  isULM})` → **15 min jour ULM**, avion certifié conservé à 30/45 (mini réglementaire 20/45,
  l'app reste volontairement au-dessus), nuit ULM = 45 par prudence. `RESERVES.DAY_MIN_ULM`
  exporté ; PDF/navlog affichent la réserve effective (déjà dynamique via `fuel.reserveMin`).
- **Tests** : `regulatoryReserveMin` (matrice avion/ULM × jour/nuit + traversée `computeFuel`)
  et round-trip flotte (`addAircraft`/`updateAircraft`/import `"true"`) — 561/561, TZ locale
  et TZ=UTC.
- **Reste ouvert (F1 vague 1)** : les devis **vol local** à 10 min (`js/wb-ui.js:31`,
  `js/flight-planner-ui.js` devis local, `js/flight-file.js`) — la correction devra utiliser
  20/45 avion et 15 ULM, le drapeau `isULM` est prêt pour ça.
