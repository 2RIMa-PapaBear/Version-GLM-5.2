# Rapport d'audit consolidé — Prévol (2ᵉ audit, multi-agents)

**27/09/2026** — deuxième exécution complète de la charte [`docs/prompt-audit.md`](prompt-audit.md),
cette fois par **6 auditeurs parallèles** (un par domaine), chacun avec recalculs indépendants
sous Node 24, exécution des modules purs, requêtes réelles Open-Meteo/NOAA et confrontation
aux POH/textes officiels. Rapports détaillés par volet : [`docs/audit-2026-09-27/volets/`](audit-2026-09-27/volets/).
Premier audit (mono-auditeur) : [`rapport-audit-2026-09-26.md`](rapport-audit-2026-09-26.md).

**Contexte dépôt** : HEAD `5e82c1a2` ; baseline `npm test` **534/534 verts** (528 → 534 en cours
d'audit) ; ⚠️ **une session parallèle applique des correctifs** (14 fichiers modifiés pendant
l'audit : azba, airspaces, airspace-profile, vfr-minima, go-nogo, navlog-pdf, core,
flight-planner-ui, flight-map-collect, alternates, css + 2 tests) — les constats ci-dessous
sont établis sur l'état audité ; vérifier ce qui reste d'actualité après la vague de correctifs.
Audit en lecture seule : aucun fichier applicatif touché.

---

## 1. Synthèse exécutive

**Verdict : NON CONFORME sur trois points bloquants, dont deux découverts par ce second
audit ; le socle mathématique reste exact partout où il a été recalculé (triangle des vents,
orthodromie, W&B, densité-altitude, facteurs, AIRAC, fréquences — jusqu'au centième).**

Le second passage a surtout révélé des défauts **au-delà** des mathématiques : intégration
API (niveaux de vent inexistants), données pré-remplies (base avions Robin ÷ 2), sémantique
réglementaire (nuit, UTC, ASFC), et defaults optimistes (TAF, SIGMET, seuils modifiables).

| Volet | BLOQ | MAJ | MIN | OBS |
|---|---|---|---|---|
| 1 — Navigation/vents/GPS/relief | 1 | 2 | 9 | 7 |
| 2 — Décodage météo | 0 | 3 | 7 | 4 |
| 3 — GO/NO-GO & carburant | 1 | 3 | 2 | 2 |
| 4 — W&B + perfs décollage | 2 | 3 | 5 | 3 |
| 5 — Espaces/AIRAC/NOTAM | 0 | 4 | 6 | 5 |
| 6 — PDF/socle/ergonomie | 0 | 3 | 4 | 8 |
| **Total (après fusion des doublons inter-volets)** | **3** | **18** | **~31** | **~29** |

En langage pilote, les trois risques qui imposent une action avant le prochain vol :
1. **Le vent de croisière affiché est le vent à 180 m du sol** — caps, vitesse sol, temps et
   carburant fondés sur le mauvais vent (jusqu'à 12 kt et 5° d'écart mesurés).
2. **Les distances de décollage de la famille Robin/DR400 de la base sont deux fois trop
   courtes** par rapport aux POH — le verdict « piste OK » peut l'être à tort.
3. **La réserve carburant d'un vol local est calculée à 10 min** (5 sites de code), sous les
   20 min réglementaires avion et 15 min ULM.

---

## 2. BLOQUANTS (P1)

### B1 — Vent « de croisière » = vent à 180 m AGL (volet 1, N1)
`js/winds-aloft.js:42,69-70,86-93` + `js/wind-layer.js:89,102-106`. **Open-Meteo ne fournit
JAMAIS les niveaux ≥ 1000 m demandés** (`windspeed_1000m…3000m` → null, prouvé en `current`
ET `hourly` sur 2 points) : la liste retombe à [262 ft, 590 ft] AGL et toute croisière au-dessus
reçoit le vent du niveau 180 m. Impact mesuré (Paris, données réelles, vs 925 hPa) : **ΔWCA
5,3° / ΔGS 12,3 kt (12 %)** → sur 150 NM à 35 L/h : 10 min et 6 L. L'étiquette « Vent à
3500 ft » est fausse ; les tests encodent une réponse que l'API ne produit jamais (test vert ≠
preuve). **Fix (M)** : niveaux isobariques `windspeed_975hPa…850hPa` (≈250–5000 ft, dispo en
`hourly`) + interpolation avec l'élévation du modèle ; à défaut borner l'affichage.

### B2 — Base avions : distances Robin/DR400 optimistes d'un facteur ≈ 2 (volet 4, A1)
`js/aircraft-database.js:51-58`. DR400-140 : 400/770 ft vs **POH 787/1 444 ft** (doc
constructeur 1002879, 980 kg, SL/ISA) ; DR400-180 : 430/850 vs **1 034/2 001 ft** (AOPA).
Écarts −47 à −58 % — le verdict piste divise la distance réelle par ~1,8 avant même les
facteurs. Cible la famille Robin/CAP/Rallye (~10 fiches) ; Cessna et WT9 sont cohérentes.
**Fix (S)** : reprendre depuis les POH + sourcer chaque fiche.

### B3 — Réserve carburant vol local = 10 min, 5 sites (F1 confirmé et élargi)
`js/flight-planner-ui.js:957,343,1030` · `js/flight-file.js:185-187` · `js/wb-ui.js:31,53`.
< 20 min avion VFR jour (arrêté 24/07/1991, vol local) et < 15 min ULM (arrêté 17/02/2025
art. 4.1.4). Le devis (écran, PDF dossier, widget Centrage) peut présenter comme suffisant un
emport sous le minimum légal. **Fix (S)** : ≥ 20 min jour / 45 nuit partout ; unifier sur 30/45.

---

## 3. MAJEURS (P2)

**Navigation (volet 1)**
- **M1 — Vents de l'instant présent** (`winds-aloft.js:69-70`) : `current.time` = heure de la
  requête ; un plan préparé à l'avance calcule tout sur des vents périmés. Fix (M) : `hourly`
  + fenêtre autour de l'heure estimée de vol. *(F2 confirmé par requête réelle.)*
- **M2 — Z sécu du log de nav PDF calculée sur le profil de REPLI sans relief** ni obstacles
  (`flight-planner-ui.js:417-435,446` → `navlog-pdf.js:268`) : en zone de relief, la colonne
  peut être de plusieurs milliers de pieds trop basse (l'écran, lui, refuse correctement).
  Fix (S) : `zSecu = ''` quand `noTerrain`.

**Décodage météo (volet 2)**
- **M3 — Suffixe visibilité ND/NDZ ignoré par le parseur principal** (`engine.js:40-45`,
  racine `core.js:427` `parseVisiToMeters('')=10000`) : METAR français `7000ND` → visi vide et
  **catégorie optimiste de 2 classes** sur la page principale (VFR au lieu d'IFR pour 3500ND).
  Fix (S) : tolérer le suffixe + vide → inconnu.
- **M4 — TAF sans données à l'heure cible ⇒ « >10 km »/« CAVOK » par défaut → badge VFR et
  minima « ctrl_ok »** (`engine.js:283-286`, `vfr-minima.js:117-118,239`) — **y compris TAF
  PÉRIMÉ et ETA hors validité** ; le repli METAR n'est jamais armé (10000 ≠ null). *(F7
  confirmé, aggravé ×3.)* Fix (S/M) : null quand aucun bloc ne couvre l'heure + test de
  [startH,endH] + repli METAR explicite.
- **M5 — SIGMET France sans aucun filtre géométrique** (`sigmet.js:41-64`, NOAA `:80-85`
  `coords.length===0 ||`) : un orage SIGMÉT sur les Pyrénées met **Lille en NO-GO**
  (conservateur, mais verdict inutilisable les jours d'orage). Fix (M) : distance
  point-polygone (coords déjà extraits). *(Convergent volets 2 et 3.)*

**GO/NO-GO & carburant (volet 3)**
- **M6 — Nuit aéronautique par forfait ±30 min, BIdirectionnel** (F3 requalifié :
  `flight-window.js:89-90`, `engine.js:677,662-663`) : aux équinoxes, la fenêtre reste
  « jour » jusqu'à **+4 min DANS la nuit réglementaire** (Nice 23/09, isAeroNight=false au
  coucher civil exact) ; en été, jusqu'à −15/−17 min de fermeture prématurée (Lille).
  Libellés « Lever civil » trompeurs (sunrise ordinaire). Fix (S) : `SunCalc.getTimes()
  .dawn/.dusk` aux 4 sites.
- **M7 — TEMPO/PROB du TAF ignorés à l'heure d'arrivée estimée** (`vfr-minima.js:114-122`) :
  `TEMPO 4000 RA BKN012` sur la fenêtre d'arrivée → verdict « OK » (optimiste, symétrique
  inverse du M9). Fix (S) : évaluer base + TEMPO actifs, retenir le plus pénalisant.
- **M8 — Seuils d'alerte modifiables sans plancher** (`weather.js:11-41,225-266`) :
  désactiver « vent » et monter « rafales » à 99 → `35035G55KT CAVOK` sans aucune alerte
  (faux GO possible) ; négatifs acceptés. Fix (S) : planchers + marquage « seuils
  personnalisés ».

**W&B / performances (volet 4)**
- **M9 — Facteur VENT absent du DÉCOLLAGE** (F4 confirmé et quantifié :
  `takeoff-performance.js:215-260`) : 10 kt de vent arrière → app optimiste de **92 m** sur
  le cas type (l'atterrissage, lui, a le facteur). Fix (S).
- **M10 — Libellés d'état de piste INVERSÉS** (`takeoff-ui.js:94-101`,
  `takeoff-performance.js:317-328`) : herbe sèche affichée « contaminée », et **contaminée
  affichée « humide »** (optimiste). Les pourcentages restent justes. Fix (S).
- **M11 — Enveloppe concave déformée à l'enregistrement** (F12 transformé :
  `aircraft-fleet.js:318` + `wb-core.js:107-121`) : le tri angulaire autour du centroïde
  peut **accepter des CG hors l'enveloppe saisie** (439 points d'une grille « U » acceptés à
  tort). Enveloppes convexes usuelles épargnées. Fix (M).

**Espaces / AIRAC / NOTAM (volet 5)**
- **M12 — AZBA : heures des items D lues en heure LOCALE au lieu d'UTC** (`azba.js:127-150`) :
  statuts « ACTIVE » décalés de 1–2 h, les deux sens (Annexe 15 : item D en UTC). Fix (S).
- **M13 — Limites « ft ASFC » interprétées AMSL** (`scripts/fetch-sia-airac.mjs:108-117`,
  aval `airspace-profile.js:45-50`) : **1 302 plafonds + 217 planchers** du cycle 09-03
  concernés (CTR CALVI, CTA TOULON, R 158 B…) — une zone contenant l'altitude de vol peut être
  exclue du profil ; étiquettes « ft AMSL »/« FLxxx » factuellement fausses. Fix (M).
- **M14 — NOTAM Dégagements/Survolés/Autres silencieusement perdus sur le repli tronçons du
  worker** (`worker/fusion-pib.mjs:59-69` vs `js/notam.js:281,437-439`) : formes
  incompatibles — écran « 0 NOTAM », compteur incohérent, annexe PDF et AZBA privés du NOTAM.
  Les tests du dépôt encodent les deux formes contradictoires. Fix (S-M).
- **M15 — freq-sia.json resté au cycle 2026-08-06 (périmé depuis le 03/09) sans signalement**
  (`app.js:696-711` n'affiche que le MAX des cycles ; garde CI `check-sia-airac.mjs` prend
  freq-sia comme référence ; `bascule-airac.mjs` ne couvre ni freq-sia ni vac-sia). La zone
  sensible « AIRAC périmé signalé » du 1ᵉʳ audit est partiellement inexacte. Fix (S).

**PDF / socle (volet 6)**
- **M16 — CSP : tuiles OpenTopoMap absentes de connect-src** (`index.html:9` vs
  `flight-map-collect.js:162`) : fond de la carte de vol du **dossier PDF** systématiquement
  en repli avec un message FAUX « hors ligne » — même classe que le CSV OurAirports
  historique. Fix (S).
- **M17 — Cache edge SIGMET sans Cache-Control** (`worker/index.js:587-591`) : TTL ~2 h au
  lieu des 4 min visées — un SIGMET fraîchement émis peut rester invisible des heures. Fix (S).
- **M18 — Suppression d'un vol GPS sans confirmation, cible ≈ 19 px** (`gps.js:530,556-558`)
  — les suppressions de flotte, elles, sont gardées. Fix (S).

---

## 4. Corrections apportées au rapport du 26/09

| Constat initial | Statut après 2ᵉ audit |
|---|---|
| F1 réserve locale 10 min (2 sites) | **Confirmé, élargi à 5 sites** (wb-ui, flight-file, PDF) |
| F2 vents instant présent | **Confirmé** (requête réelle) et **dépassé** par B1 (niveaux inexistants) |
| F3 nuit ±30 min « conservateur » | **Requalifié** : bidirectionnel — optimiste jusqu'à +4 min aux équinoxes (M6) |
| F4 vent décollage absent | **Confirmé et quantifié** (92 m / 10 kt arrière) → M9 |
| F5 herbe contaminée < mouillée | **Confirmé et aggravé** : libellés en plus inversés (M10) |
| F6 plafond TEMPO | **Confirmé, étendu à 4 sites** (weather, pastilles route/carte) |
| F7 défauts TAF | **Confirmé, aggravé ×3** (verdict ctrl_ok, repli METAR jamais armé, TAF périmé) → M4 |
| F12 enveloppe concave juge≠graphique | **Transformé** : alignés depuis le correctif, mais la normalisation déforme l'intention (M11, plus grave) |
| F14 interpolation 180→1000 m | **Infirmé** : le niveau 1000 m n'est jamais renvoyé — symptôme du B1 |
| Journal « LFPB→LFRM 114,65 NM / 237,1° » | **Corrigé** : coordonnées du dépôt (airports.json) → 108,18 NM / 236,34° (contrôles croisés exacts — verdict inchangé) |
| « AIRAC périmé signalé automatiquement » | **Partiellement infirmé** : le bandeau ne voit que le cycle MAX (M15) |

Constats du 1ᵉʳ audit confirmés tels quels : WMM2020 (+0,17°/an hors France, SIA prioritaire
en France), GS repli TAS, vent milieu unique, SunCalc CDN (SRI correct, repli optimiste),
copies `_esc`, XSS historiques corrigés et tenant, garde piste/terrain (4 chemins de calcul).

---

## 5. Matrice de conformité réglementaire (mise à jour)

| Disposition | Statut | Écarts |
|---|---|---|
| SERA.2 — nuit = crépuscule civil | **ÉCART** | M6 (±30 min, bidirectionnel) |
| SERA.5005 — minima VMC | **CONFORME au périmètre affiché** (minima par terrain, doctrine France) | pas d'analyse en route (choix documenté) |
| SERA.5010 — VFR spécial | **CONFORME** (1500 m/600 ft, nuit interdit) | M4 peut le masquer (défauts TAF) |
| Arrêté 24/07/1991 — carburant navigation | **CONFORME** (30/45 > 20/45) | — |
| Arrêté 24/07/1991 — carburant vol local | **ÉCART** | **B3** (10 min < 20) |
| Arrêté 17/02/2025 art. 4.1.4 — ULM 15 min | **ÉCART** | **B3** (10 min < 15) |
| NCO.OP.125 — politique carburant | **CONFORME** | — |
| OACI Annexe 3 — METAR/TAF | **ÉCARTS de décodage** | M3 (ND/NDZ), M4 (défauts), MPS (W7), fractions US (W6), TSRAGR (W8) |
| OACI Annexe 15 — item D NOTAM en UTC | **ÉCART** | M12 (AZBA en heure locale) |
| AIP France — datum des limites (AMSL/ASFC) | **ÉCART** | M13 (ASFC lu AMSL) |
| Fraîcheur AIRAC par base | **ÉCART** | M15 (freq-sia 23 j de retard invisible) |
| WCAG 2.1 AA | **PARTIEL** | contrastes texte AA ✓ ; cibles 19–32 px hors 44 px (S8) |

---

## 6. Plan de correction global

- **P1 — bloquants** : B1 (niveaux isobariques, M), B2 (reprise POH famille Robin, S), B3
  (réserve locale ≥ 20/45 sur les 5 sites, S).
- **P2 — majeurs** : M1 (vents horaires, M), M6 (dawn/dusk, S), M9 (vent décollage, S),
  M10 (libellés, S), M13 (datum ASFC, M), M12 (UTC, S), M14 (formes NOTAM, S-M), M15 (bandeau
  min par base + garde, S), M16 (CSP, S), M17 (TTL SIGMET, S), M18 (confirmation, S), M2
  (Z sécu repli, S), M3 (ND/NDZ, S), M4 (null au lieu de défauts, S/M), M5 (filtre géo, M),
  M7 (TEMPO à l'ETA, S), M8 (planchers seuils, S), M11 (enveloppe concave, M).
- **P3 — mineurs (~31)** et **P4 — observations (~29)** : voir les fiches par volet —
  l'essentiel en effort S : GPX rtept sans nom (perte de point), postes homonymes W&B (masse
  doublée), mois local TAF, heures PDF sans fuseau, cibles tactiles, watchdog favori muet,
  contexte espace inconnu « réputé non contrôlé », 5ᵉ chemin d'affichage de la garde piste,
  code mort longueur de piste, copie locale d'échappement ×4…
- **Après correctifs** : `npm test` (attendu ≥ 534), re-vérification des zones corrigées par
  un audit delta, et QA visuelle (liste au volet 6 : carte PDF en conditions déployées, mode
  cockpit, contrastes dim, cibles en gants).

---

## 7. Ce qui est vérifié EXACT (à conserver)

Triangle des vents (9 cas vs résolution vectorielle), orthodromie et caps (3 méthodes
concordantes, cas dégénérés inclus), conversions d'unités exhaustives, chaîne des caps avec
priorité déclinaison SIA, W&B trois points au centième + garde burn≤fuel + sanitize,
densité-altitude (écart 0,29 ft au gradient OACI exact), facteurs « méthode de référence »
exécutés exacts, alternates (algorithme + même fonction écran/PDF), round-trips GPX/KML/JSON
(fichiers réels, tronqués), exports GPS (G1000 exacts), Terrarium, profil d'élévation et
corridor obstacles 0,5 NM, cycle AIRAC pur (pivots au jour près), précédence SIA>openAIP,
point-dans-polygone (0 désaccord/4 000 points), fréquences eAIP champ à champ, obstacles AIXM
champ à champ, dossiers NOTAM purs (UTC, filtrage VFR, rayon), zéro cache NOTAM, AZBA
parseur (6 formes) et conservatisme, SUP, badges d'âge au minute près, TEMSI aux 2 fuseaux,
robustesse décodage (0 exception), SW conforme (météo network-only, caches bornés), worker
/notam propre, CSP complet hors M16, PDF = valeurs écran sans recomputation, pagination
> 9 tronçons exécutée, contrastes AA, suppressions flotte gardées.

## 8. Limites

Réseau SOFIA/AEROWEB vivant non sollicité, rendus navigateur/PDF réels non ouverts (lecture +
génération Node), POH du WT9 « club » non publiés (contrôle par cohérence structurelle),
~100 fiches avions non vérifiées une à une, comportement futur de l'API Open-Meteo (constat
daté 27/09). Détail complet des non-vérifiables dans chaque volet.
