# VOLET 2 — DÉCODAGE MÉTÉO observation/prévision (agent 26-27/09/2026)

Lecture seule stricte ; harnais Node 24 hors dépôt, ~80 messages météo rédigés (nominaux,
limites, malformés), horloge figée pour frontières mois/année, TZ=UTC et TZ=Europe/Paris.
Baseline npm test : **534/534 verts** (528→534 depuis le 1ᵉʳ rapport).
Compteurs : **3 MAJEURS · 7 MINEURS · 4 OBSERVATIONS**. Aucune exception non gérée sur les
messages malformés.

## Fiches

- **W1 [MAJEUR] Visibilité française ND/NDZ ignorée par le parseur principal → visi absente
  et « 10 km implicite » dans la catégorie affichée** — `engine.js:40-45` (_parseVisi, regex
  sans suffixe), aval `engine.js:122` + `ui-module.js:204`, racine `core.js:427`
  (`parseVisiToMeters('') = 10000`). Exécuté : `LFRB … 7000ND -RA BKN010…` → visi « » ;
  catégorie VFR au lieu d'IFR pour un 3500ND réel — **2 classes d'écart, sens optimiste**,
  badge de la page principale. `weather.js:328-333` et `vfr-minima.js:75-88` tolèrent le
  suffixe (incohérence). **Fix (S)** : tolérer `(\d{4})(NDZ|ND)?` + `parseVisiToMeters('')`
  → null propagé.
- **W2 [MAJEUR] TAF sans valeur à l'heure cible ⇒ « >10 km »/« CAVOK » par défaut — badge
  VFR et minima « OK », Y COMPRIS TAF PÉRIMÉ et heure hors fenêtre (F7 confirmé, étendu ×3)** —
  `engine.js:283-286` (getForecastAtHour défauts), `vfr-minima.js:117-118` + `:239` (le
  repli METAR n'est JAMAIS armé car visiM=10000 ≠ null), `ui-module.js:238`. Exécutés :
  (1) TAF sans groupes → VFR + `ctrl_ok` sur donnée inexistante ; (2) **ETA hors validité**
  (TAF 2612/2712, ETA 27/18Z) → `ctrl_ok` — le TAF périmé « certifie » la destination ;
  (3) heure murale hors axe (TAF encore en vigueur, affiché à 00:30Z) → VFR par défaut alors
  que l'axe réel = MVFR + TEMPO LIFR. **Fix (S/M)** : null quand aucun bloc ne couvre l'heure
  (catégorie « — », verdict unknown, repli METAR explicite) ; tester h ∈ [startH,endH].
- **W3 [MAJEUR] SIGMET France : aucun critère géométrique → GO/NO-GO « national » ; voie
  NOAA : coords vides = « toujours près »** — `sigmet.js:41-64` (branche EN_FRANCE sans
  filtre de distance, radiusDeg ignoré), `go-nogo.js:175-183` (danger → NO-GO), NOAA
  `sigmet.js:80-85` (`coords.length === 0 ||` = proche partout, _isNearFromText mort).
  Exécuté : SIGMET orage Bretagne (4830N 00400W) → retenu pour Nice comme pour Paris →
  NO-GO partout en France les jours d'orage (conservateur, inutilisable). **Fix (M)** :
  filtre distance point-polygone (coords déjà extraits, ~100 NM terrain/couloir route) ;
  supprimer le `||` à coords vides. (Rejoint N3 du volet 3.)
- **W4 [MINEUR] F6 re-confirmé et étendu** : plafond TEMPO mélangé à la base dans
  `vfr-minima.js:85-101` (verdict `sp_needed` au lieu de `ctrl_ok` : BKN012 TEMPO → 1200 ft)
  ET dans `weather.js:336-342` (alerte « Plafond bas 1200 ft ») ET (lecture) dans
  `route-weather.js:442-446` + `regional-map.js:1252-1256` (pastilles). **engine.js SAIN**
  (catégorie sur baseSeg seul — confirme le 1ᵉʳ rapport). **Fix (S)** : arrêter la collecte
  au token TEMPO|BECMG|NOSIG ; signaler le plafond temporaire à part.
- **W5 [MINEUR] Message tronqué → visi aberrante silencieuse** : `analyserMETAR('LFPO 2612')`
  → visi « 2612 m », catégorie IFR (collage partiel lu comme visi). **Fix (S)** : n'accepter
  le 4-chiffres qu'après groupe vent/horodatage (pattern seenWind de vfr-minima), invalider
  sans JJJJJJZ.
- **W6 [MINEUR] Visi US fractionnaire : dénominateur lu en milles entiers** :
  `parseVisiToMeters('1/2 SM (0.8 km)')` = **3219 m** (2 SM !) — espace optionnel mal placé
  `core.js:429-434` vs chaîne « 3/4 SM (1.2 km) » produite par engine.js:43. KXXX 3/4SM →
  MVFR au lieu de LIFR. Formes mixtes 1 1/2 SM exactes ; weather.js:334 convertit juste.
  **Fix (S)** : regex tolérante.
- **W7 [MINEUR] Vent en MPS non décodé** (Annexe 3 §4.1.5.2) : `engine.js:31/206`,
  `weather.js:325` — UUEE 24008MPS → vent vide ; 24025G35MPS ≈ 49G68 kt sans alerte.
  Limité hors France. **Fix (S)** : MPS ×1,94384.
- **W8 [MINEUR] Orage non détecté dans TSRAGR/TSRASN** — `weather.js:353-354` : `6000
  TSRAGR BKN020CB` → alerte CB seulement, ni Orage ni Grêle (danger) ; TSRASN → rien.
  TS/+TSRA/TSRA/VCTS OK. La traduction engine affiche bien « Orage Pluie Grêle ». **Fix (S)** :
  /TS/ par token temps.
- **W9 [MINEUR] SIGMET : validité temporelle jamais vérifiée** — SIGMET `VALID 201200/201800`
  (J-6) retenu tel quel. Faible en pratique (sources actives, relais 240 s) mais NO-GO
  fantôme possible si relais périmé. **Fix (S)** : parser VALID et écarter expirés.
- **W10 [MINEUR] Frontière de mois en heure locale : TAF daté d'un mois de trop** —
  `engine.js:140` (getMonth LOCAL vs getUTCMonth ailleurs). Exécuté : 30/09 22:30Z sous
  TZ=Paris, TAF 3023/0106 (7 h) → validité « du 30/10 au 01/11 », endH 54 au lieu de 30 —
  blocs TEMPO hors axe. Fenêtre ~1-2 h par changement de mois, auto-résolue. **Fix (S)** :
  getUTCMonth + recul jour par jour (comme data-age). (Rejoint S6 du volet 6.)
- **W11 [OBSERVATION] 5 décodeurs METAR parallèles à tolérances divergentes** : engine
  (ND✗ SM✓ TEMPO✓), weather (ND✓ SM✓ TEMPO✗), vfr-minima (ND✓ SM partiel TEMPO✗),
  route-weather + regional-map (ND✗ SM✗ → 10 km implicites, TEMPO✗). Même 3500ND SCT030 →
  3 réponses différentes selon l'écran. **Fix (M)** : un module pur unique consommé partout.
- **W12 [OBSERVATION] RVR jamais extrait ; SKC (US) non reconnu** (`engine.js:47`) ;
  RMK ignoré proprement. **Fix (S)**.
- **W13 [OBSERVATION] VV/// et ////// deviennent « illimité » dans la chaîne PARSÉE** :
  `_parseNuage` transforme VV/// en 'VV' → getCeiling('VV')=999. Le METAR brut est sauvé par
  hasard (segment brut → 0 ✓) mais les TAF parsés (TEMPO VV/// avec bonne visi) passent pour
  illimités. **Fix (S)** : conserver VV/// tel quel.
- **W14 [OBSERVATION] Groupe inconnu « traduit » en phénomène fantôme** : XYZABC → « XY ZA
  Bancs » (BC contenu dans le bruit). **Fix (S)** : tokens exclusivement composés de codes
  connus.

## Vérifications conformes (extraits)

1. En-tête/horodatage : 20 messages exacts (préfixe date, SPECI, code OACI).
2. Vent : 24012G25KT, 00000KT (CALME), VRB, 170V250 réinjecté, /////KT vide sans fausser.
3. Visi : 9999 ≠ CAVOK (nuages affichés sous 9999) ; ND/NDZ dans weather+vfr-minima ✓ ;
   CAVOK = groupe atomique (3 conditions) ; RVR non confondu ; US entiers/P6SM/M1/4 ✓.
4. 4678 : intensités, TS/+TSRA/VCTS/SHRA/FZFG/GR/-SN fidèles (sauf W8) ; pas de faux orage
   sur SHRA.
5. Nuages/plafond : ×100 ft ; plafond = plus basse ≥5/8 (SCT010 seul → pas d'alerte) ;
   VV002 → 200 ft ; NSC/NCD/CAVOK illimité ; CB/TCU détectés.
6. T/Td (M=négatif, M50/M55) ; QNH ; A2992 → 1013 hPa (×33,8639 exact).
7. TREND : NOSIG ignoré ; TEMPO bloc séparé [12-14] non mélangé (engine) ; BECMG hérite.
8. TAF : validité avec minuit (12→36), TEMPO/PROB30/FM/BECMG, TX/TN jour+heure EXACTS, AMD,
   sans validité → repli sans crash.
9. Alertes : bornes ≥ vérifiées (14/15/24/25 kt ; rafales 29/30 ; plafond 1500/500 ;
   visi 5000/1500 cohérents minima CTR France) ; donnée absente = PAS d'alerte ;
   analyzeForecastAlerts intègre le TEMPO à l'heure cible.
10. Route/dossier : ETA = now + totalTimeMin ; substitution station proche marquée (« * »,
    « METAR LFXX · 12 NM ») ; absents → unknown. Pastilles couloir = observations courantes
    (libellé cohérent).
11. data-age : bornes EXACTES au minute près (55/56 ; 115/116 ; 389/390 ; 719/720) ; recul
    jour par jour ✓ (302350Z lu 01/10 → fresh 20 min) ; SPECI temporel ; offline rouge+âge ;
    intégration go-nogo OLD→NO-GO.
12. pressure-trend : fenêtre 4 h ; −6/2 h → −3,0 hPa/h danger ; inHg A2992→1013 (Δ exact) ;
    < 2 points → null ; **1ᵉʳ du mois : le correctif du 1ᵉʳ audit TIENT** (span 10 h, pas de
    tendance ≈ 0). (En-tête fichier dit « 3h », code 4 h — cosmétique.)
13. TEMSI : échéances UTC+locale justes aux 2 fuseaux, été comme hiver ; la plus proche de
    l'heure cible (ETA si plan) mise en avant ; AUCUNE interpolation temporelle.
14. Robustesse : 10+ malformés → aucune exception (seuls W5/W14 fabriques silencieuses).
15. Baseline 534/534.

## Re-vérification 1ᵉʳ rapport

- F6 : **CONFIRMÉ non corrigé, étendu** (weather.js + pastilles route/regional ; engine sain).
- F7 : **CONFIRMÉ non corrigé, aggravé ×3** : verdict `ctrl_ok` (pas qu'affichage) ; repli
  METAR jamais armé (10000 ≠ null) ; même défaut moteur pour badge + ETA hors validité +
  heure hors fenêtre (W2).

## Non-vérifiables

route-weather/_categoryFromMetar et regional-map/_categoryFromMetar privés (lecture ; jumeaux
exportés prouvés) ; radar-layer (Leaflet — lecture conforme : dernière trame passée, UTC,
« prév. », manifeste 10 min) ; chaînes réseau réelles non sollicitées ; rendus canvas/DOM ;
widgets.js (hors périmètre).

⚠ **Modifications concurrentes détectées PENDANT l'audit** : js/azba.js, js/airspaces.js,
js/airspace-profile.js, js/flight-map-collect.js, scripts/fetch-airspaces.mjs + 2 tests
modifiés par une autre session (« correctif 27/09 ») — hors périmètre météo ; exécutions sur
l'état antérieur.

**Plan volet** : P1 = W1 (S), W2 (S/M), W3 (M) ; P2 = W4-W10 (S) ; P3 = W11 (M) ; P4 = W12-W14.
