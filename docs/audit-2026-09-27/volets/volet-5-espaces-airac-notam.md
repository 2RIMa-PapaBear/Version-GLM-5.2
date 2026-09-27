# VOLET 5 — ESPACES AÉRIENS, AIRAC & NOTAM (agent 27/09/2026)

Lecture seule ; exécutions Node 24 hors dépôt (%TEMP%/audit-prevol-espaces/, 6 contrôleurs,
~180 assertions), croisement champ-à-champ avec le XML SIA officiel (cycle 2026-09-03).
Compteurs : **4 MAJEURS · 6 MINEURS · 5 OBSERVATIONS**.

## Fiches

- **A1 [MAJEUR] AZBA : heures des items D lues en heure LOCALE au lieu d'UTC** —
  `js/azba.js:127-150` (`_statusToday` getHours/getMinutes locaux), `:31-37` (`_toMin` sans
  fuseau), affichage `js/airspaces.js:754-761` sans mention de fuseau. Exécuté (2 fuseaux) :
  item D « 0600-1900 », instant 05:00Z → navigateur UTC : PLANIFIEE (correct) ; navigateur
  Europe/Paris : **ACTIVE** alors que l'activation réelle est à 08:00 locales → statut décalé
  de 1–2 h, les deux sens. Cas SR-SS auto-compensé (contrôlé) ; seules les plages HHMM
  absolues sont faussées. **Fix (S)** : comparer en UTC + afficher « UTC ».
- **A2 [MAJEUR] Limites « ft ASFC » (hauteur/sol) interprétées AMSL** —
  `scripts/fetch-sia-airac.mjs:108-117` (toFt traite ft AMSL et ft ASFC pareil),
  `js/airspace-profile.js:45-50`, `js/airspaces.js:710-718` (étiquette « X ft AMSL » fausse).
  XML 09-03 : **1 302 plafonds + 217 planchers « ft ASFC »** (~4 700 volumes). Exemples
  exécutés : CTR CALVI plafond 2000 ASFC → « 2000 ft AMSL » ; CTA TOULON 1.2 plancher 3500
  ASFC ; R 158 B plafond 5000 ASFC (affiché FL050 !). Impact double sens : plafond ASFC lu
  trop bas → zone **exclue du profil** à tort (`airspace-profile.js:201-202`) ; plancher ASFC
  lu trop bas → conservateur. Écart jusqu'à plusieurs milliers de pieds en montagne.
  **Fix (M)** : exporter le datum (unité 2 = ASFC), afficher tel quel, traiter « plafond ≥
  valeur » dans le filtre (jamais exclure sur plafond ASFC).
- **A3 [MAJEUR] NOTAM Dégagements/Survolés/Autres perdus sur le repli tronçons du worker** —
  `worker/fusion-pib.mjs:59-69` produit ADDeg/ADSur/Other en TABLEAUX de blocs
  [{code,name,cat:[…]}] ; `js/notam.js:281` (flatVfr) et `:437-439` (_renderPib) ne lisent
  que la forme {cat:[…]} ; collectFlat (`:268-280`) les omet. Exécuté sur fixtures : rendu
  « 0 NOTAM », section masquée, _flat vide → disparition écran + compteur + **annexe PDF**
  (navlog-pdf.js:2064-2073) + **activation AZBA**, alors que l'en-tête recompté les compte —
  incohérence observable. Tests du dépôt encodent les DEUX formes contradictoires
  (test/notam.test.mjs:132 vs test/fusion-pib.test.mjs:19). Réserve : forme du PIB SOFIA
  direct non vérifiable hors ligne. **Fix (S-M)** : normaliser en une forme + test 2 formes.
- **A4 [MAJEUR] freq-sia.json resté au cycle 2026-08-06 (périmé depuis le 03/09) sans
  signalement** — pied de page `js/app.js:696-711` affiche le MAX des cycles → « 03/09/2026 »,
  bandeau « CYCLE PÉRIMÉ » seulement si le MAX expire ; garde CI
  `scripts/check-sia-airac.mjs` prend freq-sia COMME RÉFÉRENCE (son propre retard invisible,
  exécuté : « à jour », exit 0) ; `scripts/bascule-airac.mjs:39-43` ne couvre ni freq-sia
  ni vac-sia/. La zone sensible « AIRAC périmé signalé » du 1ᵉʳ rapport est donc
  **partiellement inexacte**. **Fix (S)** : bandeau dès qu'UNE base expire + min/max par
  base ; garde = cycle en vigueur ; compléter la liste FICHIERS de la bascule.
- **A5 [MINEUR] Classe d'espace (A–G) perdue pour les 1 526 zones SIA** — le XML publie
  `<Classe>` (538 D, 152 E, 102 C, 26 A, 50 G — CTR CANNES 1 = D contrôlé) mais
  fetch-sia-airac ne l'exporte pas ; openAIP écarté par dédoublonnage. Utile au pilotage
  (SERA.5005). **Fix (S)** : exporter + afficher.
- **A6 [MINEUR] Horaires d'activation HorTxt perdus — « TS » affiché brut** (60 zones) —
  XML publie « 0700 - au plus tard de 1900 ou SS+30 » etc. (4 700 HorTxt) ;
  fetch-sia-airac.mjs:170 n'exporte que HorCode. **Fix (S)** : exporter HorTxt.
- **A7 [MINEUR] Libellé « Zone 30 NM » figé + ADSur compté mais jamais rendu en local** —
  `notam.js:321` (codé dur) vs rayon réel 20 NM réglable 10–40 ; collectFlatLocal injecte
  ADSur dans _flat (dénominateur « X/Y cochés ») mais le rendu local n'affiche pas la
  section → NOTAM comptés, jamais cochables. Exécuté. **Fix (S)**.
- **A8 [MINEUR] R/D/P « toujours visibles » : exception limitée aux planchers ≤ 5000 ft** —
  `airspace-profile.js:196` (filtre AVANT l'exception R/D/P ligne 201) ; idem rendu carte
  `airspaces.js:905-906`. Exécuté : R/D/P 6000–9500 survolée à 3500 → exclue, contrairement
  à la doc du module. **Fix (S)** : exception avant filtre ou documenter.
- **A9 [MINEUR] `_limitTxt` affiche « FLxxx » pour des limites publiées en ft AMSL ≥ 4000
  multiples de 500** — `airspaces.js:714-717` : [4500 ft] → « FL045 ». À QNH 990, FL050 ≈
  4730 ft AMSL — l'étiquette suggère un niveau FL pour une limite calée QNH ; suppose TA
  3000 partout. Le CALCUL du profil reste en pieds (correct) — impact étiquetage.
  **Fix (S)** : « FLxxx » seulement si la SOURCE publie un FL (unité 6).
- **A10 [MINEUR] Hygiène XSS : 2 nouvelles copies locales d'échappement + champs non
  échappés** — `sup-sia.js:322-324` (copie _esc), `sup-sia.js:308-310` (num/start/end/chips
  non échappés — données robot maison, risque faible), `widgets.js:15` (_escAttr, 3ᵉ
  implémentation). Étend F13. **Fix (S)** : escapeHtml de core partout.
- **A11 [OBSERVATION] atc-info.js : repli « USA » pour tout code 3-4 lettres** —
  `atc-info.js:25-29` : EHGR/LOWW → « VFR Charts (FAA) » (mauvais pays).
- **A12 [OBSERVATION] Cache VAC : invalidation par cycle correcte** (clé code:VAC:airac,
  repli marqué stale) **mais sans purge des cycles passés** (~300 Ko × 421 terrains
  accumulés à chaque bascule) ; l'index vac-sia dépend d'une régénération hors bascule (A4).
- **A13 [OBSERVATION] Codes d'horaires eAIP non restitués** — 324 « HOR ATS » sans badge
  (table H24/HO/HX/HJ/HN incomplète) + 2 troncatures du scrape LFSL.
- **A14 [OBSERVATION] 10 navaids TACAN US (133.x MHz) classés « VOR »** — aucun en France ;
  classification par bande `radio-points.js:54-60`.
- **A15 [OBSERVATION] FL→ft calage 1013 implicite** (±800 ft à QNH extrême, couvert par la
  tolérance 1000 ft mais non documenté) ; **SIA_COVERAGE commentée trompeusement** — les DOM
  (Guadeloupe/Guyane/Réunion) sont HORS bbox et servis openAIP uniquement alors que la base
  SIA les contient.

## Vérifications conformes (preuves — extraits)

1. Cycle AIRAC pur : pivots exacts au jour près (09-03 périmé le 01/10 00:00Z ; 10-01
   périmé le 29/10). 15/15.
2. Paternité SIA datée : cycle le plus récent, jamais saisi à la main (bandeau existe, cf. A4
   pour sa limite max).
3. LFRV champ-à-champ vs XML : élévation 440 ft, AdMagVar 0,34 (2025) exacts.
4. Conversions limites : FL065→6500, 1000 m→3281, SFC→0.
5. Point-dans-polygone : 4 000 points vs winding number indépendant — 0 désaccord ; aucun
   anneau interne dans les données.
6. Tronçons traversés (CTR Cannes) : bornes ±0,01 vs balayage indépendant.
7. Précédence SIA > openAIP exécutée sur données réelles (cellule 47_-3 : 12/18 doublons
   écartés, fréquences léguées, _rdpKey robuste).
8. NOTAM purs : périodes UTC exactes, filtrage VFR conforme, rayon 10–40 défaut 20,
   decToSofiaDms exact (arrondis, pôles), waypointLegs couvre chaque point, fusion dédupliquée.
9. Zéro cache NOTAM : client + worker (« pas de cache ») + garde d'origine.
10. Échappement NOTAM (title/period/data-nid) confirmé ; corps : `<` échappé (suffisant).
11. Traduction : l'app ne traduit RIEN elle-même (itemE SOFIA ou brut) — aucun contresens
    introduit.
12. AZBA parseur : 6 formes réelles + minuit + wrap semaine conformes ; zoneActiveToday
    CONSERVATEUR (H24/vide/non mentionnée = trait plein).
13. SUP : bornes incluses, TTL 24 h, repli périmé, matching par mot significatif ; 97/121 en
    vigueur.
14. Fréquences : chaîne complète exécutée vs eAIP — CTR RENNES 120.505, DINARD 120.155,
    QUIMPER 118.625, TMA→APP 134.200, SIV→FIS ; UHF/GONIO écartées ; jamais d'invention
    (ST-BRIEUC→null) ; overrides par indicatif câblés.
15. Obstacles : 13 836, croisement champ-à-champ exact (pylône 22033 : lat/long/318/167/N) ;
    0 cas elev<hFt ; 89 % balisés.
16. Corridor 0,5 NM vs calcul indépendant : mêmes 3 obstacles, frac monotone.
17. radio-points : parse réel (3 435 VOR / 1 690 NDB / 6 404 VRP), antiméridien géré,
    XSS _esc couvre toutes les insertions.
18. VAC : VAC du cycle précédent IMPOSSIBLE à servir comme courante (clé par cycle) ;
    garde blob > 500.
19. SW : cellules SWR borné, /notam hors cache.

## Re-vérification 1ᵉʳ rapport

- « AIRAC périmé signalé automatiquement » (§4.12 conforme) → **INFIRMÉ PARTIELLEMENT** : le
  bandeau ne voit que le MAX des cycles ; freq-sia (08-06) périmé depuis 23 jours invisible,
  garde CI aveugle (A4).
- F13 (_esc radio-points-layer.js:28) → **CONFIRMÉ + ÉTENDU** : couverture XSS complète
  (aucune injection), mais 2 autres copies (sup-sia.js:322, widgets.js:15) + champs non
  échappés dans sup-sia.js (A10).
- Échappements NOTAM commit 9f56a37d → confirmés.

## Non-vérifiables

SOFIA réel (sémantique fl_upper, forme des blocs en direct, repli tronçons HTTP 400), items D
réels (parseur éprouvé sur formes documentées), datum AGL openAIP (non transporté), valeurs
officielles SIV non attestées localement, rendus visuels (qa-*.mjs non exécutés), npm test non
rejoué (528/528 au 1ᵉʳ audit ; les tests du dépôt ont d'ailleurs RÉVÉLÉ l'incohérence A3).

**Plan volet** : P1 = A1 (S), A2 (M) — valeurs de décision en vol ; P2 = A3 (S-M), A4 (S) ;
P3 = A5–A10 (S) ; P4 = A11–A15.
Scripts : %TEMP%/audit-prevol-espaces/t1…t6.
