# Rapport d'audit — Prévol, 3ᵉ passage (delta) — 01/10/2026

> Prompt : `docs/prompt-audit.md` (§0–§9). Auditeur : ZCode (GLM). Périmètre :
> **delta post-campagne 26-28/09** (29 fiches + 18 majeurs + lots P3/P4),
> **post-bascule AIRAC 2026-10-01** et post-publication v3.1.
> HEAD : `9c0562d6`, arbre propre, `npm test` **747/747** (Node 24, fuseau local).
> Méthode : recalculs indépendants (implémentations de référence écrites hors du
> code de l'app), 3 volets délégués (tenue des correctifs, intégrité des données
> AIRAC, statut P3/P4), revue du code récent, empreintes de production.
> Audit en lecture seule — aucun fichier du dépôt modifié hors du présent rapport.

---

## 1. Synthèse exécutive

**Verdict : CONFORME, avec une exception de fraîcheur à corriger rapidement.**
Aucune régression des campagnes 26-28/09 (24/24 ancres présentes à HEAD, y
compris en production minifiée). La bascule AIRAC 10-01 est complète et
cohérente sur toutes les bases cyclées (espaces 1688 dont P 115, terrains,
pistes, radio, fréquences 138/1 115/failed 0, VAC 420/420, obstacles 13 836,
ancre `airacInForce` identique client/serveur et calée sur le vrai calendrier
AIRAC 2026). Les maths re-vérifiées indépendamment sont exactes.

**Le point noir : la base SUP AIP série A est figée au 16/09** — à la fois dans
le dépôt et en production — alors que le job quotidien censé la rafraîchir
**sort vert** : son crawler ne s'exécute jamais (garde `isMain` défectueux
depuis sa naissance le 17/09, no-op silencieux en CI). Toute SUP publiée par le
SIA depuis le 17/09 — dont celles du jour de bascule AIRAC du 01/10 — est
absente du panneau « Sup AIP (SIA) », sans aucun signe d'âge affiché. C'est le
seul écart au-dessus du mineur ; il porte sur une donnée de sécurité de vol
(fermetures temporaires, ZRT, travaux) et la supervision ment (pipeline vert).

Compteurs du présent passage : **0 BLOQUANT · 1 MAJEUR · 4 MINEURS · 6
observations** (les ~40 P4 connus restent suivis par ailleurs, cf. §6).

---

## 2. Journal des recalculs indépendants

Implémentations de référence écrites à la main (aucune réutilisation du code de
l'app) : résolution vectorielle du triangle des vents, loi des cosinus
sphériques (R = 6 371,0088 km), formule du cap initial, algorithme NOAA complet
de calcul des crépuscules (éq. du lever du soleil), formes ISA/altitude-densité.
72 vérifications numériques → **0 échec imputable à l'app** dans les tolérances §7
(4 écarts initiaux étaient des bugs de mes grilles de référence : convention de
signe WCA, attente IMC là où le VFR spécial de jour est légal, clés de retour
du parseur vent, décalage de 12 h de mon compteur de jours juliens NOAA —
l'app avait raison dans les 4 cas, recalculs de contrôle faits).

### 2.1 Triangle des vents (`flight-planner.js:276` windCorrection)

| Jeu d'essai | Référence indépendante | App | Verdict |
|---|---|---|---|
| Route 090, TAS 100, vent du 030/30 | cap vrai 74,94° (WCA 15,06°), GS 81,57 kt | 74,9° / 82 kt | ✓ (±1°/±1 kt) |
| même cas : composantes | travers −25,98 kt (de la gauche), face +15 kt | −26 / +15 | ✓ signes conformes « vent du » |
| vent arrière pur du 270/30 | GS 130 | 130 | ✓ |
| vent de travers = TAS (090/90, TAS 90) | WCA ±90°, GS 0 | +90° / 0 | ✓ |
| vent de face > TAS (000/80, TAS 50) | GS négatif → 0 | 0 | ✓ plafonné, repli signalé (N4) |
| vent nul / TAS 0 | GS = TAS / 0 sans crash | 110 / 0 | ✓ |

La solution est la forme exacte (GS = TAS·cos WCA − composante de face), pas
l'approxination : conforme à la règle E6B.

### 2.2 Distances et caps (`greatCircleDistanceNm`, `trueCourseDeg`)

| Jeu d'essai | Référence (loi des cosinus, R 6 371,0088 km) | App (haversine, R 3 440,065 NM) | Écart |
|---|---|---|---|
| LFPG→LFMN | 374,900 NM | 374,899 NM | < 0,001 % |
| LFQB→LFRV | 143,912 NM | 143,912 NM | < 0,001 % |
| équateur 10° de longitude | 600,405 NM | 600,405 NM | < 0,001 % |
| points confondus | 0 | 0 | ✓ |
| antipode (0,0)→(0,180) | π·R = 10 807,3 NM | 10 807,3 | ✓ |
| cap initial LFPG→LFMN | 147,23° | 147,23° | 0 |

### 2.3 Altimétrie / densité (`density-altitude.js`)

PA = elev + 27×(1013,25 − QNH) ✓ (0 ft, QNH 980 → 898 ft = 27×33,25) ;
ISA 1,98 °C/1 000 ft ✓ ; DA = PA + 118,8×ΔISA ✓ sur 4 jeux (niveau mer
standard → 0 ft ; 2 000 ft ISA+19 → 4 252 ft ; 500 ft QNH 985 → 372 ft ;
entrées null → null). Conversions FL↔ft conscientes de l'unité publiée
(`airspaces.js:796`, `airspace-profile.js:51`) — étiquette FL seulement si la
source publie un FL (A9-v5 tenu).

### 2.4 Unités / décodage (`core.js`)

MPS ×1,94384 (12 MPS → 23 kt ✓), KMH ÷1,852 (20 KMH → 11 kt ✓), KT identité,
rafales converties, VRB et variation 180V240 décodés, **groupe sans unité →
null** (pas de vent fantôme) ; visibilité 9999→10 km, 8000→8 km, 1 1/2SM →
2 414 m (fusion des deux groupes ✓ fiche 10), M1/4SM → 402 m, 3SM → 4 828 m.

### 2.5 Minima VMC SERA.5005 (`core.js:547-596`) — 9 jeux

Contrôlé jour/nuit × contrôlé/non contrôlé : VMC ok (6 km/3 000 ft),
MARGINAL clearance (plafond 2 000 < 2 500 : rester ≥ 1 000 ft SOUS la base —
jamais de suggestion de franchissement par-dessus), VFR spécial de jour
possible (plafond 800 ≥ 600 ft, visi ≥ 1 500 m → MARGINAL, pas IMC ✓),
IMC de nuit en spécial (nuit = visi de table 5 km), non contrôlé jour
1 600 m/1 000 ft → VMC (règle ≤ 140 kt), plafond ≤ 500 ft → MARGINAL
SERA.3105 (fiche 8 tenue), **visi null ne juge pas** (l'autre critère décide).
Dérogation française 5 km en contrôlé (CTRL_VISI_M 5 000) ✓ GEN 1.7.

### 2.6 Crépuscules civils — SunCalc 1.8.0 (cdnjs, SRI) vs NOAA indépendant

8 combinaisons (Lille 50,63°N / Perpignan 42,74°N × 2 équinoxes, 2 solstices
2026) : écarts de 0,15 à **2,2 min** — dans la tolérance ±2 min (1 cas à 2,1,
1 cas à 2,2 : différence entre deux algorithmes approchés, aucun biais
systématique ; contrôle absolu par première principes : aube civile Lille
équinoxe ≈ 05:17 UT calculée à la main vs 05:19 rendu ✓). Le garde repli
±30 min si dawn/dusk indisponible (hautes latitudes) reste en place
(`flight-window.js:96-102`). Définition nuit = crépuscules civils (SERA.2) ✓.

### 2.7 Déclinaison magnétique — WMM2020 extrapolé vs officiel SIA 2025

| Point | WMM2020+SV extrapolé au 01/10/26 | Officiel SIA (AdMagVar 2025) | Écart |
|---|---|---|---|
| Paris (LFPG) | 2,25° E | 1,85° | **+0,40°** |
| Lille (LFQQ) | 2,40° E | 1,97° | +0,43° |
| Strasbourg (LFST) | 3,69° E | 3,23° | +0,46° |
| Brest (LFRB) | 0,17° E | −0,27° | +0,44° |

Le repli WMM2020 surestime la déclinaison Est de ≈ +0,4° en 2026 (dérive
séculaire non modélisée depuis 2020). **Impact borné** : en France, les caps du
plan utilisent `getDeclinationForIcao(départ)` → valeur officielle SIA en
priorité (`magvar.js:42`) ; le WMM ne sert que hors France / terrain inconnu /
points hors terrain (`getMagneticDeparture(lat,lon)`). Erreur maximale sur le
cap magnétique ≈ 0,4° < tolérance ±1°. Quantifie l'observation N13 (P4 :
migration WMM2025 un jour).

### 2.8 Carburant / enveloppe (re-calculs de non-régression)

computeFuel 1 h à 24 L/h + réserve 45 min → 24/18/42 L ✓ ;
LOCAL_RESERVE_MIN 20/45 (avion) et 15 (ULM) présents avec `regulatoryReserveMin`
(arrêté 24/07/1991 + arrêté ULM 17/02/2025) ✓ ; enveloppe W&B sans réordonnancement
des sommets + `envelopeSelfCrossings` + tolérance d'arête ±0,5 kg/±1 mm ✓ (fiche 16).

---

## 3. Tenue des correctifs 26-28/09 (volet A — 24 ancres)

**Aucun correctif perdu.** 21/24 strictement présents à HEAD (citations
fichier:ligne relevées pour chacun, de `winds-aloft.js:47` — niveaux isobariques
1 000→700 hPa + vent à l'heure de vol — à `azba.js:39` modulo 1440,
`flight-map-pdf.js:176` troncature `getTextWidth`, `navlog-pdf.js:2169` garde
`Number.isFinite>0`, `wake-lock.js` verrou synchrone, `gps-vols.js:134`
bornage 10 s, `takeoff-ui.js:181` garde `runwayBelongsToAirport`,
`notam.js` rayon réel + ADSur rendus, crawler `cl`+`horTxt`, réserve ULM,
POH Robin entiers, pente/vent défavorables, `flightWin`, givrage ≤ 10 000 ft…).
3 écarts, aucun fonctionnel :

| # | Ancre | Constat |
|---|---|---|
| 13 | découplage couches fiche 19 | mécanisme **déménagé** dans `regional-map.js:20/225/837` (événement `restore-free-waypoint`) ; `_pendingFreeWps` bien supprimé partout — évolution d'architecture, intention tenue |
| 14 | `normalizeEnvelope` | fonction **supprimée** (remplacée par le diagnostic d'auto-croisements, intention fiche 16 renforcée) — aucun tri angulaire subsistant |
| 19 | escapeHtml unifié | **reliquat réel** : `sup-sia.js:322-323` garde un `_esc` local complet (5 usages l. 309-315) malgré l'import de core → fiche M3 ci-dessous (hygiène : le local échappe le même jeu `&<>"'`, pas de trou XSS) |

Empreintes en production (minifiée) : ancre AIRAC `2026,6,9` + `airacInForce`
présents dans `js/sia-data.js` servi ; `js/zone-crosses.js` servi (200, 2 391 o)
et code des croix présent dans `js/airspaces.js` servi — la publication du
30/09-01/10 est bien partie en prod.

---

## 4. Intégrité des données AIRAC 10-01 (volet B)

Cycles : freq-sia **10-01** (138 terrains / 1 115 fréquences / failed 0),
sia-airspaces **10-01** (1 688 = items, g.c. présents 1 688/1 688, 0 anneau
< 3 points, 0 coordonnée non finie, horTxt 92,5 %), obstacles **10-01**
(13 836), sia-airfields / sia-runways / sia-radio-layer / freq-aa / freq-services
**10-01**, radio-points SIA **10-01**, VAC **10-01** (420 PDF = index, 0 PDF
< 20 Ko, 119,4 Mio). Zones P : **115** (type `ty=3`), conforme au rattrapage
du 30/09 ; distribution cl : D 476, E 119, C 50, G 30, A 16, vide 997 (zones
P/R/D non classées). **Aucune base restée en 09-03.**

Ancre `airacInForce` (`sia-data.js:175`, ancre 2026-07-09, pas 28 j) : ancre
et formule strictement identiques dans les 4 exemplaires (client + 3 scripts),
verrouillées par `test/sia-data.test.mjs:89-103` ; la série produite
(…→08-06→09-03→**10-01**) coïncide avec le calendrier AIRAC réel 2026. Les
caches clients freq-sia / zones v6 / rubriques AD rejettent désormais un cache
du cycle précédent dès le jour de bascule (9d13400a) — les caches
radio-points/obstacles restent au TTL seul (fiche m2).

Garde-fous CI : `airac-sia-xml` contrôle 7 bases contre le cycle calendaire
(échec → notification), `airac-obstacles` idem ; le one-shot de bascule a été
retiré proprement (9c0562d6). Course du garde-fou le jour de bascule : fiche m4.

---

## 5. Fiches d'anomalies du présent passage

### M1 — MAJEUR — Base SUP AIP figée au 16/09, pipeline vert (crawler jamais exécuté)

- **Module** : `scripts/fetch-sup-sia.mjs:95` × `.github/workflows/update-airac-eaip.yml:53` × `js/sup-sia.js` (aucun affichage d'âge).
- **Constat** : `data/sup-sia.json` — `generatedAt 2026-09-16T18:13:40Z`, dernier commit le 17/09 (d9219aa9, création). Le job quotidien exécute `node scripts/fetch-sup-sia.mjs` : runs verts du 01/10 (05:28Z et 11:15Z) **sans aucune écriture ni commit**. Cause : le garde `const isMain = import.meta.url === pathToFileURLSafe(process.argv[1])` fabrique un `file:///` à la main — **sans résolution du chemin relatif ni encodage des espaces** — qui ne matche jamais l'`import.meta.url` réel en CI (le crawler jumeau `fetch-freq-sia.mjs:362` utilise la forme canonique `path.resolve(argv[1]) === fileURLToPath(import.meta.url)`, lui, fonctionne). `main()` ne démarre pas, l'étape sort 0 : **no-op silencieux depuis la naissance du script** (le robot hebdo, qui l'appelle depuis le 17/09, est tout aussi muet).
- **Effet pilote** : toute SUP publiée du 17/09 au 01/10 est absente du panneau « Sup AIP (SIA) » — en production aussi (vérifié : prod = 16/09). Le panneau filtre « en vigueur aujourd'hui », donc l'absence est invisible ; aucun badge d'âge ne l'aurait signalé de toute façon. Les SUP portent des fermetures temporaires et ZRT : retard d'information de sécurité de vol de 15 jours et comptant.
- **Correction recommandée** : remplacer le garde par la forme canonique de `fetch-freq-sia.mjs` (1 ligne + import), relancer le job, pousser ; en durcissement : afficher l'âge de la base dans le panneau (comme les badges METAR/TAF) et faire échouer le job si `generatedAt` > 7 j. Effort : S (15 min + run).
- **Réglementaire** : intégrité/fraîcheur des données de préparation de vol (AIP/SUP, source SIA) — la règle maison « la base, ce sont les fichiers SIA » est validée par ailleurs.

### m2 — MINEUR — Caches VRP et obstacles à TTL seul, non ancrés par cycle AIRAC

- `js/radio-points.js:231-253` (VRP, clé data-v5) et `:264-281` (obstacles) : fraîcheur `WEEK_MS` seule, alors que les payloads embarquent `siaVrpAirac`/`airac`. Même famille que le défaut corrigé par 9d13400a (bandeau « cycle périmé » jusqu'à 7 j après bascule). Fix S : même garde `cached.parsed.airac < airacInForce()` que freq-sia/zones.

### m3 — MINEUR — Reliquat d'unification XSS : `_esc` local dans sup-sia.js

- `js/sup-sia.js:322-323` garde une implémentation locale d'échappement (5 usages) malgré l'import de `core.escapeHtml` (l. 19). Fonctionnellement sûr (même jeu de caractères) mais c'est exactement la dérive que S5/A10-v5 devait éliminer. Fix S : remplacer les 5 appels par l'import existant.

### m4 — MINEUR — Garde-fou AIRAC en course avec le job de mise à jour (faux rouge le jour de bascule)

- `update-airac-eaip.yml` : les jobs `airac-sia-xml`/`airac-obstacles` démarrent en parallèle de `update` — le 01/10 05:28Z, le garde a lu freq-sia/VAC encore en 09-03 pendant que `update` commitait le 10-01 → run rouge pour rien (vérifié dans les logs). Fix S : `needs: update` sur les garde-fous (ils ne servent qu'à alerter sur un retard *persistant*, pas à courir contre l'update).

### m5 — MINEUR — LFHB et LFTB : VAC présentes, terrains absents de la base mondiale

- `data/airports.json` ne contient ni LFHB ni LFTB alors que leurs VAC et index 10-01 existent (`data/vac-sia/`) et qu'ils figurent dans `sia-airfields.json`. La recherche/fiche terrain s'appuie sur la base mondiale → ces deux terrains sont introuvables par l'outil malgré leur carte. Fix S : injection depuis sia-airfields à la génération d'airports.json (ou fusion à la lecture).

### Observations

- **o1** — Cron quotidien `10 6 * * *` du 01/10 **non déclenché** (les 3 runs existants du workflow sont tous `workflow_dispatch`) : à surveiller demain 06:10Z ; si récidive, le schedule ne s'applique pas (vérifier l'onglet Actions / désactivation).
- **o2** — Ancre `airacInForce` dupliquée à l'identique en 4 exemplaires (client + 3 scripts) : cohérente et testée, mais factoriser un jour (scripts/lib) pour éviter la divergence à la prochaine mutation d'ancre.
- **o3** — freq-sia 10-01 : 138 terrains/1 115 fréquences contre 141/1 139 au 09-03 (failed 0) : probable consolidation SIA, à confirmer sur l'eAIP à la prochaine édition.
- **o4** — `parseVisiToMeters('')` → 10 000 m (repli implicite sur chaîne vide) : piège dormant — tous les appelants actuels gardent l'absence en amont (vérifié un à un) mais la fonction devrait renvoyer null sur chaîne vide ; au passage le préfixe M/P des SM est ignoré en magnitude (M1/4SM = « moins de 402 m » rendu 402 m). METAR US uniquement.
- **o5** — Traces du cycle 09-03 dans « telechargement AIRAC/ » (XML+AIXM, ~69 Mo, gitignorés) : nettoyage disque prévu par ailleurs, à faire.
- **o6** — WMM2020 extrapolé : surestimation ≈ +0,4° en France en 2026 (§2.7) — impact borné par la priorité SIA ; migration WMM2025 (N13) quand opportun.

---

## 6. Statut réel des P3/P4 du 2ᵉ audit (volet C)

Préambule : les commits 9d2be11b / 8d6ddfee / 1f037aba cités par le journal ont
disparu du dépôt (filter-repo du 01/10) **mais leur contenu est bien à HEAD** —
tout le « NON COMMITÉ » du 27/09 soir est en réalité publié. Vérification
item par item :

### P3 — statut

| Item | Statut HEAD | Preuve |
|---|---|---|
| N4 GS=0 → repli TAS signalé | **CORRIGÉ** | `flight-planner.js:341` drapeau `gsFallback` + ⚠ UI `flight-planner-ui.js:1302` |
| A9-v4 garde piste à l'affichage | **CORRIGÉ** | `takeoff-ui.js:179-181` |
| A10-v4 setRunwayLength morte | **CORRIGÉ** | `takeoff-performance.js:169` supprimée, messages « longueur inconnue » |
| A5-v5 export classe SIA | **CORRIGÉ** | `fetch-sia-airac.mjs:198` |
| A6-v5 export HorTxt | **CORRIGÉ** | `fetch-sia-airac.mjs:199` |
| A7-v5 rayon réel + ADSur rendus | **CORRIGÉ** | `notam.js:320` + l.77/290 |
| A9-v5 FL seulement si unité 6 | **CORRIGÉ** | `airspaces.js:811-814` |
| A10-v5+S5 escapeHtml unifié | **PARTIEL** | unifiés partout SAUF `sup-sia.js:322` (→ fiche m3, croisé volet A) |
| W11 unification décodeurs | **PARTIEL** | tolérances alignées ; **5 chemins de décodage subsistent** (engine `_parse*`, canonique core, `parseWindString` l.226, `_parseWindForAxial` takeoff:768, `analyzeWeatherAlerts` weather:341) — refonte M non entamée |

### P4 — statut (intitulés complets dans `docs/audit-2026-09-27/plan-p3-p4.md`)

**CORRIGÉS sans que le fichier ne le reflète (5) :** S9 (QR tiers → encodeur
local `permalink.js:25`, plus aucune trace qrserver), S12 (alternates écran et
PDF = même `getEnRouteAlternates(pts, 25, 8)` via `flight-planner-ui.js:638`),
S13 (caches AIRAC par cycle — le 9d13400a du 30/09, nuance : les cells openAIP
mondiales restent TTL 7 j, hors AIRAC), S14 (garde d'origine du worker
`worker/index.js:46`, datée audit 26/09), S17 (import regional-map ↔
flight-planner-ui devenu unidirectionnel). Plus W12-SKC, W13 (VV/// préservé
`engine.js:73`), W14 (décomposition stricte), N7 (Td>T → null), A11-v5 (USA
restreint K/PA/PH/PG/TJ), A13-v5 (badge HOR générique), N17 (KML
route/polygone jamais waypoint) — tous confirmés.

**OUVERTS confirmés (17) :** N5 (cache déclinaison TTL 30 j global reprisé à
chaque écriture, `magvar.js:7,26`), N9 (plan 6 000 ft → sélecteur vents
retombe à 2 000, `wind-layer.js:126,158` — ALTS plafonne à 4 500), N10
(commentaire GPS « >35 kt » obsolète vs VR−5/50, `gps.js:20`), N11 (clé cache
déclinaison arrondie au degré ≈ 60 NM, `magvar.js:126`), N12 (filtrage
arrêt/mouvement ajouté à l'export GPS mais accuracy toujours décorative),
N13 (WMM2020 : aucune coefficient 2025 au dépôt ; **notre mesure 01/10 :
+0,40 à +0,46° vs SIA officiel 2025** — cf. §2.7), N14 (geomag : altitude
attendue en multiples du rayon terrestre — latent, toujours 0), N16 (Σ temps
par tronçon arrondis ≠ total affiché, `flight-planner.js:506→680`), N6 (go-nogo
appelle `evaluateIcingRisk` sans thermo — `go-nogo.js:233` jette
humidity/dewPointC pourtant retournés par freezing-level), A11-v4 (pente :
repli silencieux piste principale si numéro en service sans match,
`takeoff-performance.js:628`), A12-v4 (WT9 bagages 40 kg et roulement 540 ft
non sourcés, `aircraft-database.js:157-172`), A12-v5 (cache VAC sans purge
des cycles passés, `vac-viewer.js:95` — choix assumé « mieux que rien »),
A13-v4 (perfs écran : `getPerformanceData` mélange toujours requestedIcao et
le METAR affiché, la voie propre `evaluateTakeoffFromRaw` ne sert qu'au PDF),
A15-v5 (calage 1013 implicite non documenté + SIA_COVERAGE sans DOM), S10
(mode cockpit : grossissement à trancher en QA visuelle), S11 (commentaires
« ±50 NM » obsolètes dans navlog-pdf vs 25 NM réel), S15 (CSP unsafe-inline +
script anti-flash mort lisant une clé supprimée `night-mode-enabled`), S16
(pas de harnais TZ permanent dans `npm test` ni CI), W11 (cf. P3), W12-RVR
(RVR jamais extrait — SKC seul corrigé).

Aucun de ces ouverts ne dépasse le mineur ; rien de nouveau au-dessus.

---

## 7. Matrice de conformité — delta

Tous les statuts de la matrice du 28/09 (SERA.5005/SERA.3105/SERA.2,
Part-NCO NCO.OP.125, arrêtés 24/07/1991 & 17/02/2025, Part-FCL) sont
reconfirmés par les re-calculs §2 (réserves 20/45/15 ✓, table VMC par classe ✓,
crépuscules civils ✓, clearance 1 000 ft sous la base ✓). Variations du jour :

| Disposition | Statut | Écart |
|---|---|---|
| Fraîcheur/intégrité SUP AIP (source SIA, préparation de vol) | **écart** | fiche M1 |
| Fraîcheur caches AIRAC client (freq/zones/AD) | conforme | 9d13400a vérifié en prod |
| idem VRP/obstacles | écart mineur | fiche m2 |
| Calendrier AIRAC (bascule J, signalement retard) | conforme | garde-fous verts post-bascule ; faux rouge du jour J = m4 |
| WMM / déclinaisons | conforme (tolérances) | o6 quantifié |
| Reste de la matrice 28/09 | inchangé conforme | — |

## 8. Plan de correction priorisé — EXÉCUTÉ

1. **M1 — CORRIGÉ/PUBLIÉ le 01/10 au soir** : garde isMain canonique, base
   régénérée (116 SUP, +11/−16), badge d'âge UTC + ⚠ ≥3 j (fini le repli
   Date.now() mensonger), garde CI anti-no-op (échec si generatedAt > 60 min).
   Run CI 36896244602 vert, prod vérifiée. Au passage : m3 réglé le même jour.
2. **m2 — CORRIGÉ le 01/10** : `airacCacheOk` (pur) + marqueurs
   siaAirac/siaVrpAirac portés jusqu'au cache par `parseRadioPoints`,
   obstacles ancrés sur `airac` ; clés IDB `data-v6` / `obstacles-sia2`
   (re-téléchargement immédiat pour les clients existants). +3 tests.
3. **m4 — CORRIGÉ le 01/10** : `needs: update` sur airac-sia-xml et
   airac-obstacles — plus de course contre la mise à jour le jour de
   bascule (run de validation 36898565962 vert, ordre update → gardes →
   deploy confirmé).
4. **m3 — CORRIGÉ le 01/10** (avec M1) : `_esc` sup-sia remplacé par
   l'import core.escapeHtml existant (5 appels).
5. **m5 — CORRIGÉ le 01/10** : LFHB Biscarosse Hydrobase et LFTB Marignane
   Berre ajoutées à `data/airports.json` (coordonnées/élévations SIA 10-01,
   surface W, version base 1.16 → cache IDB invalidé).
6. P4 connus (N13 WMM2025, W11 unification décodeurs, o4 parseVisiToMeters…)
   — cadence au choix du pilote ; rien de nouveau au-dessus du mineur.
7. Nettoyages : **o5 FAIT** (2 XML 09-03, 70 Mo, supprimés) ; **o1 VÉRIFIÉ**
   (cron actif — run `schedule` du 01/10 à 13:04Z vert, latence GitHub ~7 h) ;
   **o3 RÉSOLU le 01/10 — requalifié anomalie RÉELLE en cours de route** :
   l'eAIP balise ses révisions AIRAC (ancienne valeur en `<del>`, nouvelle en
   `<ins>`) ; `strip()` gardait les deux textes → cellule « 121.200 121.205
   MHz » ne matchait plus le parseur → fiches à fréquences amendées VIDES.
   Les 3 terrains disparus étaient ceux aux fréquences changées au 10-01
   (LFPT Pontoise, LFRQ Quimper, LFRZ Saint-Nazaire — dont un contrôlé).
   Fix : le texte `<del>` (hors vigueur) est jeté avant l'effacement des
   balises, pour toutes les cellules. Ré-extraction : **141 terrains,
   1 183 fréquences** (vs 138/1 115 — +68 lignes amendées récupérées sur
   l'ensemble des fiches), LFPT TWR 121.205 en vigueur. +1 test de
   régression (fixture del/ins). Demain 06:10Z, le robot quotidien
   re-testera automatiquement l'extracteur.

---

## 9. Environnement

Node 24.14 (fuseau Europe/Paris), `npm test` 747/747 (751 après exécution du
plan, §8) ;
scripts de recalcul écrits hors dépôt (tmp ZCode) ; production interrogée en
lecture seule (`papabear56.pages-perso.free.fr`).
