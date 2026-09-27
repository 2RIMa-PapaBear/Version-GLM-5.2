# VOLET 4 — MASSE & CENTRAGE + PERFORMANCES DÉCOLLAGE (agent 27/09/2026, HEAD 5e82c1a2)

Recalculs indépendants (scripts %TEMP%/audit-prevol/), exécution réelle des modules purs
Node 24, stub localStorage. Aucun des 11 fichiers du périmètre modifié par la session
parallèle (git status vérifié ; core.js/engine.js cités sur leur état présent décalé).
Compteurs : **2 BLOQUANTS · 3 MAJEURS · 5 MINEURS · 3 OBSERVATIONS**.

## Fiches

- **A1 [BLOQUANT] Base avions : distances décollage DR400/Robin optimistes d'un facteur ≈2** —
  `js/aircraft-database.js:51-58` : DR400-120 400/760, -140 400/770, -160 420/800, -180
  430/850, DR401 440/840, DR500 480/920, CAP10 380/700, Rallye 420/800 (ft). POH Robin
  DR400 « 135 CDI » (doc 1002879 rév. 1, 980 kg, dur sec, sans vent, SL/ISA) : roulement
  240 m = **787 ft**, 15 m = 440 m = **1 444 ft** ; AOPA DR400/180 (1 100 kg) :
  **1 034/2 001 ft**. Écarts −47 à −58 %. Ces nombres pilotent le verdict piste : sur le cas
  bout-en-bout, la référence « 50 ft = 244 m » contre 440 m POH divise la distance par ~1,8
  AVANT les facteurs. L'avertissement d'en-tête ne change pas l'usage. (C172 830/1400 et
  WT9 cohérents — cible la famille Robin/CAP/Rallye ≈ 10 fiches.)
  **Fix (S)** : reprendre depuis les POH + sourcer chaque fiche.
- **A2 [BLOQUANT] Réserve vol locale 10 min — F1 confirmé dans wb-ui.js** (5ᵉ site) :
  `js/wb-ui.js:31,53` `LOCAL_RESERVE_MIN = 10`, libellé « réserve finale 10 min (vol local
  de jour en vue du terrain) » l.187. 10 < 15 ULM (arrêté 17/02/2025 art. 4.1.4) < 20 avion
  jour (arrêté 24/07/1991). **Fix (S)** : ≥ 20/45.
- **A3 [MAJEUR — confirme F4] Facteur VENT absent du DÉCOLLAGE** —
  `takeoff-performance.js:215-260,444-447` (aucun vent) vs atterrissage l.284-287
  (−10 %/10 kt face ; +20 %/10 kt arrière). Quantifié (DR400-160, 800 m herbe, +1 %,
  500 ft, 30 °C) : app 461 m ; avec facteur vent : face 10 kt → 415 m (app pessimiste
  46 m) ; **arrière 10 kt → 553 m (app optimiste de 92 m, −17 %)**. **Fix (S)** : réutiliser
  la composante longitudinale déjà calculée (l.615-631) + étiquette.
- **A4 [MAJEUR] Libellés d'état de piste INVERSÉS** — herbe sèche affichée « contaminée »,
  mouillée « contaminée », **contaminée « humide » (sens optimiste)** —
  `takeoff-ui.js:94-101` (seuils hérités de l'ancien jeu) + `takeoff-performance.js:317-328`
  (`wet = 1,25 / contaminated ≥ 1,30` — l'inverse des facteurs 1,20/1,25/1,30). Les
  pourcentages restent justes. **Fix (S)** : piloter les libellés depuis l'état
  {wet, contaminated, soft} réel.
- **A5 [MAJEUR] Enveloppe concave silencieusement déformée À L'ENREGISTREMENT** —
  `aircraft-fleet.js:318` (normalize à la sauvegarde) + `wb-core.js:107-121` (tri angulaire
  autour du centroïde — faux si centroïde hors polygone). Exécuté (grilles) : enveloppe « L »
  concave → 637/1 824 points divergents ; enveloppe « U » → **439 points hors-polygone-saisi
  deviennent ACCEPTÉS** (CG hors enveloppe intenté déclaré « dans l'enveloppe ») + 247
  exclus. Enveloppes convexes usuelles non touchées ; normalizeEnvelope idempotent (F12 du
  1ᵉʳ rapport : le symptôme juge≠graphique n'existe plus — la racine est pire).
  **Fix (M)** : conserver le contour simple d'origine (détection auto-intersection +
  correction minimale) ou avertir à la saisie concave.
  **CORRIGÉ 27/09 (fiche 16 — variante « avertir »)** : `normalizeEnvelope` SUPPRIMÉE ;
  l'ordre des sommets est conservé tel quel de la saisie flotte jusqu'au centrogramme/PDF
  (sanitize, aperçu, widget, page Centrage du journal). La fenêtre Flotte exige désormais
  la saisie en périmètre (note sous le tableau) et signale l'auto-croisement en rouge
  (`envelopeSelfCrossings` dans wb-core) au lieu de réécrire l'enveloppe. Tests : ordre
  saisi préservé en flotte + enveloppe concave à échancrure → point interdit HORS
  enveloppe, verdict `danger` (609/609). NB : enveloppes déjà enregistrées sous l'ancien
  code convexe → ordre périmètre conservé ; si concave, l'ordre d'origine a été détruit à
  l'enregistrement → ressaisir en suivant le POH.
- **A6 [MINEUR] CG exactement sur la limite : asymétrique** — arrière = dehors, avant =
  dedans (ray-casting strict `wb-core.js:70-78` + `>=fwd && <=aft` l.181-183). Convention
  POH : limites inclusives. Exécuté (constructions binaires exactes : 900 kg à 2 600 =
  limite arrière → « HORS LIMITES »). **Fix (S)** : tolérance d'arête ≤ 1 mm.
- **A7 [MINEUR] Deux postes homonymes : masse comptée DEUX fois** — `wb-core.js:162` (clé
  nom), pas de dédoublonnage au sanitize (`aircraft-fleet.js:329-344`). Exécuté : 2 postes
  « Passager », 70 kg saisis → décollage 760 kg au lieu de 690, CG faussé. **Fix (S)** :
  rejeter/suffixer les doublons.
- **A8 [MINEUR] Schéma coupe : la barre marge dessinée ≠ marge chiffrée** —
  `takeoff-profile.js:190-197` : barre = piste − 50 ft BRUT (402 m) alors que l'étiquette
  = piste − 50 ft ×1,20 (+339 m) → marge visuelle surestimée de 63 m sur le cas type.
  **Fix (S)**.
- **A9 [MINEUR] « Piste en service » affichée SANS garde runwayBelongsToAirport (5ᵉ chemin,
  affichage)** — `takeoff-ui.js:176` reprend state.activeRunwayName tel quel. Les 4 chemins
  de CALCUL sont gardés (la régression ④ du commit 9f56a37d tient côté calcul).
  **Fix (S)** : même garde à l'affichage.
- **A10 [MINEUR] Longueur de piste manuelle : fonctionnalité morte, message inactionnable**
  — `setRunwayLength` jamais appelée, clé jamais écrite/lue ; le verdict « unknown » invite
  à « renseignez la longueur de piste » sans UI possible. **Fix (S)** : supprimer ou
  rétablir la saisie.
- **A11 [OBSERVATION] Pente SIA : repli silencieux sur la piste PRINCIPALE si le numéro en
  service ne matche pas** (`takeoff-performance.js:514-515`) → longueur/pente
  désynchronisables dans ce cas bord.
- **A12 [OBSERVATION] Fiche WT9 : bagages max 40 kg (défaut générique) vs 10 kg POH ;
  roulement 540 ft non sourcé (POH public UL 472,5 : 650 ft, −17 %)** — fiche « config club
  LSA 600 kg » non publiée : sourcer. Atterrissage 246/863 ft = POH EXACT, enveloppe
  120 mm ≈ plage 20-30 % MAC (118,5 mm), unusable 6 ≈ 5,8 L.
- **A13 [OBSERVATION] Météo du terrain AFFICHÉE appliquée à un autre terrain demandé** —
  `takeoff-performance.js:425-429` : getPerformanceData() (affiché) mais verdict du terrain
  demandé. **Fix (S)** : refuser si ≠.

## Vérifications conformes (extraits)

1. Moments/CG trois points : ZFW 790,00/1 969,68 · TO 862,00/1 832,31 · ARR 833,20/1 884,41
   = contrôles indépendants au centième ; CG arrivée recule avec bras carburant avant CG
   (physique ✓).
2. Garde burn ≤ fuel (exécuté 50/200 L → 36 kg).
3. Sanitize : négatifs → 0, virgule acceptée, MTOW epsilon, densité 0,72 gardée (0,5–1,2).
4. Enveloppe interpolée : limites exactes, hors plage → null → « hors enveloppe ».
5. Conversions lb/kg, ft/in/mm exactes.
6. WT9 : mon calcul indépendant (2×80+10 kg, 60/30 L) = app exact (TO 567,2/2 794,64 ;
   ARR 545,6/2 803,14) ; concordances POH détaillées.
7. DA : 4 260,79 ft = charte au ft près (4 261,07 avec gradient OACI exact — écart 0,29 ft) ;
   étiquetage « approximations opérationnelles » présent.
8. Facteurs méthode référence TOUS exécutés exacts (Zp 1,15²=1,3225 ; ISA ; masse ×1,20/+10 %
   sans crédit à la baisse ; pente |symétrique| documentée ; PA négative sans crédit) ;
   étiquetage estimation en tête de module + +X % au bandeau.
9. Atterrissage : vent 35 kt face → ×0,70 ; 40 kt arrière → ×1,60 ; mouillée ×1,15.
10. runwayLevel : signe/unités du « manque » corrects (m), sans piste → unknown informatif.
11. QFU rose : 240°/12 sur 09/27 → 27 pour dec 0/+1/−30 ; Mag = Vrai − D correct.
12. Garde piste/terrain : 4 chemins de calcul gardés (⑤ affichage = A9).
13. XSS value= postes : _esc = import core ✓ (core.js:612 état présent).
14. VR chrono : 50 kt sans avion ; VR−5 flotte active, plancher 10 ; WT9 VR 50 → 45 kt
    = 23,15 m/s ✓.
15. runways-geo : priorité SIA puis OurAirports (IndexedDB versionné, timeout), ne choisit
    pas de piste → pas de garde requise.
16. Round-trip flotte : sanitize complet, id préservé, import normalisé PUR.

## Re-vérification 1ᵉʳ rapport

- **F4 vent décollage : CONFIRMÉ + quantifié** (optimiste 92 m par 10 kt arrière) → A3.
- **F5 herbe contaminée<mouillée : CONFIRMÉ exécuté** (+ test du dépôt qui encode
  l'incohérence) **et aggravé** : libellés en plus inversés (A4), dont contaminée affichée
  « humide » (optimiste).
- **F12 enveloppe concave : TRANSFORMÉ** — juge/graphique alignés depuis le correctif 26/09
  (normalize à l'enregistrement, idempotent), MAIS la normalisation déforme l'intention du
  pilote sur les concaves et peut ACCEPTER des CG hors enveloppe saisie (A5) — racine plus
  grave que le symptôme.
- **F1 : confirmé dans wb-ui.js** (5ᵉ site du périmètre).

## Non-vérifiables

POH exact du WT9 « LSA 600 kg » club (fiche non publiée — contrôle par cohérence structurelle
contre le POH public UL 472,5) ; les ~100 autres fiches une à une (recoupements ponctuels
cohérents hors Robin) ; rendu visuel réel ; réseau/cache OurAirports en conditions ;
longueurs/pentes SIA par terrain (XML réels) ; extraction texte des POH scannés sous Node.

Sources externes : POH DR400 135 CDI (Vliegclub Seppe), POH WT9 (Kjeller), AOPA DR400 1994,
BEA F-GABZ.

**Plan volet** : P1 = A1 + A2 ; P2 = A3, A4, A5 (M) ; P3 = A6-A10 (S) ; P4 = A11-A13 (S).
