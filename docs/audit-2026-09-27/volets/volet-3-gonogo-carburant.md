# VOLET 3 — GO/NO-GO, MINIMA VFR, FENÊTRE DE VOL & CARBURANT (agent 27/09/2026)

Contrôles Node v24 hors dépôt (%TEMP%/audit-prevol/gng/), SunCalc 1.8.0 chargé en global,
éphémérides recalculées par routine NOAA indépendante. Lecture seule.
Compteurs : **1 BLOQUANT · 3 MAJEURS · 5 MINEURS · 2 OBSERVATIONS** + 23 conformes.

## Fiches

- **F1 [BLOQUANT] Réserve vol local 10 min — CONFIRMÉ ET ÉLARGI (5 sites, pas 2)** :
  `flight-planner-ui.js:957` + `:343` (devis PDF vol local) + `:1030` (libellé) ;
  `flight-file.js:185-187` (tuile Carburant dossier : `(min + 10 + reserveMin)/60 × burn`) ;
  `wb-ui.js:31,53` (widget Centrage `LOCAL_RESERVE_MIN = 10`). Exécuté : 30 min à 35 L/h →
  5,8 L au lieu de ≥ 11,7 L (20 min). WT9 sauvé « par hasard » par sa majoration perso 5 min
  (`aircraft-database.js:143`) → 15 min conforme ULM, mais la RÈGLE reste non conforme (10 <
  20 avion ; 10 < 15 ULM sans perso). **Fix (S)** : 20/45 certifiés, plancher 15 ULM, unifier
  30/45 ; corriger les 5 sites + libellés.
- **F3 [MAJEUR] Nuit ±30 min — CONFIRMÉ, MAIS PAS UNIFORMÉMENT CONSERVATEUR** :
  `flight-window.js:89-90`, `engine.js:677` (isAeroNight), `engine.js:662-663` (courbe
  jour/nuit du graphique — 4ᵉ site non cité par le 1ᵉʳ rapport), en-tête
  `flight-window.js:5-11` qui baptise le forfait « crépuscules civils » (faux).
  NOAA vs app : **OPTIMISTE aux équinoxes** — Nice 23/09 aeroEnd 17:59Z vs crépuscule civil
  17:55Z → +4,0 min DANS la nuit (hors ±2 min) ; isAeroNight exécuté à l'instant du coucher
  civil → false (jour) le 23/09 (Nice ET Lille) et le 20/03 (Nice). Conservateur ailleurs :
  Lille 21/06 soir −14,8 min / matin +17,1 min après l'aube ; Lille 21/12 −8,2/−10,8 min ;
  Nice 21/06 −5,0/−7,3 min. SunCalc vs NOAA : 0,1–2,9 min (2 cas à 2,6/2,8). Libellés
  « Lever civil / Coucher civil » affichent sunrise/sunset ordinaires
  (`flight-window.js:172-173,193,197`). **Fix (S)** : `SunCalc.getTimes().dawn/.dusk` aux 4
  sites ; corriger libellés + en-tête ; repli « inconnu » si SunCalc absent (actuellement
  false = jour).
- **N1 [MAJEUR — NOUVEAU] Minima dest/dégagement : TEMPO/PROB du TAF ignorés à l'ETA** —
  `vfr-minima.js:114-122` : `tafVisiCeilingAt` n'interroge que `base.visi/nuage`. Exécuté :
  `TAF LFPG 261100Z 2612/2718 04010KT 9999 FEW040 TEMPO 2618/2621 4000 RA BKN012` à 19:30Z →
  10 km/illimité → verdict OK. Biais OPTIMISTE (symétrique inverse du F6). **Fix (S)** :
  évaluer base ET TEMPO actifs à l'heure cible, retenir le plus pénalisant, afficher
  « dont TEMPO ».
- **N2 [MAJEUR — NOUVEAU] Seuils d'alerte modifiables sans plancher ni avertissement → faux GO
  possible** — `weather.js:11-41,225-266,284-316` (`openThresholdsModal`, `getThresholds`
  fusion sans garde, parseInt || défaut), consommé par `go-nogo.js:102-116,358`. Exécuté :
  `35035G55KT CAVOK` → défaut 2 dangers ; seuils `{wind:disabled, gusts:{warning:90,danger:99}}`
  → AUCUNE alerte (GO possible). `visibility.danger=-5000` accepté ; `wind.danger=0` conservé
  au rechargement. Mitigations : catégorie LIFR/IFR indépendante des seuils (exécuté) ;
  infobulle « selon vos réglages ». **Fix (S)** : planchers par seuil (visi danger ≥ 1500 m,
  plafond ≥ 500 ft, vent ≤ limite avion), refuser négatifs/0, marquer « seuils personnalisés ».
- **F6 [MINEUR] confirmé** : plafond METAR TEMPO → 1200 ft au lieu de 2500 (conservateur,
  non signalé). **Fix (S)** : segmenter.
- **F7 [MINEUR] confirmé exécuté** : TAF sans groupes → 10 km/illimité → « ok » (optimiste).
  **Fix (S)** : null → ligne inconnue.
- **N3 [MINEUR — NOUVEAU] SIGMET France sans filtre géométrique** : `sigmet.js:41-63` —
  chemin AEROWEB retourne TOUS les messages des FIR ; orages sur les Pyrénées → NO-GO à Lille
  (faux NO-GO). **Fix (S)** : filtre ≤ ~1,5° du terrain (coords/polygon déjà extraits).
- **N4 [MINEUR — NOUVEAU] Watchdog : favori sans METAR = silence** — `watchdog.js:133-135,147`
  (`if (!raw) continue;`) : olive périmée jamais signalée, contredit « jamais une donnée
  périmée présentée comme courante ». **Fix (S)** : état UNKNOWN (olive grise).
- **N5 [MINEUR — NOUVEAU] Contexte d'espace indisponible ⇒ « réputé non contrôlé » sans
  drapeau** — `vfr-minima.js:134,159` : CTR non résolue → minima assouplis 1500 m/500 ft,
  direction OPTIMISTE silencieuse. **Fix (S)** : verdict unknown/prudence si contexte non établi.
- **N6 [OBSERVATION] Givrage** : `evaluateIcingRisk(3000,'FEW030')` → null (FEW ≠ plafond)
  alors que givrage possible en FEW sous isotherme ; go-nogo appelle SANS tempC/tdC alors que
  fetchFreezingLevel les fournit (`go-nogo.js:289` les jette) — voie C-FIP réservée au widget.
- **N7 [OBSERVATION] carb-icing** : `evaluateCarbIcing(10,12)` → spread −2, serious — Td > T
  non gardé (donnée impossible acceptée).

## Vérifications conformes (extraits avec preuve)

1. Matrice minima France : 13 cas exécutés conformes (contrôlé 5 km/1500/2500 clearance,
   spécial 1500/600 nuit interdit, non-contrôlé 1500/>500 STRICT, absents → unknown).
2. Chaîne TZ-invariante (UTC vs Europe/Paris identiques).
3. Cas dégénérés : null → null ; 78°N soleil de minuit → null ; SunCalc absent → false
   (confirmé exécuté).
4. `xwindThresholds` 12/15 · 10/12 · 6/8 · 12(plafonnée)/25 — conforme « 80 % limite ».
5. Vrai→magnétique avant QFU (`go-nogo.js:204`, `engine.js:222-252`).
6. Ordre du verdict + monotonie NO-GO (jamais rétrogradé) ; chaîne exécutée bout en bout.
7. Âge METAR : old ≥116 → NO-GO, aging 56–116 → CAUTION.
8. Catégories LIFR/IFR/MVFR/VFR standard, visi absente = null, indépendantes des seuils perso.
9. Watchdog règles : réplique exécutée 9 METAR + 3 pièges (RMK, 261230Z, 1200W, ND/NDZ) —
   conformes ; fréquence 15 min (min 5), anti-spam sur transitions, relance 15 s après échec.
10. Carburant navigation chaîne complète (roulage ×2 + intégration/posée, réserve 30/45 >
    20/45, dégagement GS réelle + 5 min, inutilisable, embarqué plafonné au utilisable) :
    recalcul manuel LFPB→LFRM WT9 + dégagement LFRN : 56,03 L vs app 56,1 L (+0,1 %).
11. Géométrie : LFPB→LFRM (coords dépôt airports.json) = 108,183 NM / 236,34° = contrôles
    indépendants exacts.
12. Cohérence plan ↔ W&B ↔ PDF : resolveLoads (embarqué = totalL, brûlé = tripFuelL,
    conservateur), densité 0,72 défaut, WT9 113 L utilisables, PDF reprend le bloc fuel SANS
    recomputation.
13. Alertes : embarqué < requis → rouge + pop-up centrage ; pas de suivi « réserve entamée »
    en vol (hors périmètre briefing, noté).
14. DA : 4260,8 vs 4253 (+8 ft, PA au QNH exact).
15. Givrage cellule : BKN035/isotherme 3000 → danger ; BKN060 → caution ; fusion conservatrice.
16. Carb-icing grille conforme à l'abaque CAA digitisée.
17. Périmètre minima : DEP METAR moment, DEST/DIV TAF à ETA (DIV +30 min), étapes-posées
    seules, repli METAR explicite, contexte zones posées au sol (CTR > TMA/CTA).
18. Visi absente = inconnu généralisé (formats 1/2SM→3219 m, 3500NDZ, BKN043SC tolérés).
19. night-mode.js = thème uniquement (aucune éphéméride) ✓.

## Re-vérification premier rapport

- F1 CONFIRMÉ + ÉLARGI (5 sites).
- F3 CONFIRMÉ ; l'assertion « conservateur, jamais optimiste » est **INFIRMÉE** : +4,0 min
  dans la nuit le 23/09 à Nice (et isAeroNight=false au coucher civil exact, 23/09 Nice+Lille,
  20/03 Nice) ; 4 sites concernés (2 de plus que cités).
- F7 CONFIRMÉ exécuté + nouveau défaut voisin N1 (TEMPO ignoré, optimiste).
- **Correction du journal du 26/09** : « LFPB→LFRM 114,65 NM / 237,1° » non reproductible avec
  les coordonnées du dépôt (airports.json : 48,9694/2,4414 → 47,9486/0,2017 = 108,18 NM /
  236,34°) — autre couple de points dans mon contrôle d'époque ; verdict « OK » fondé mais
  ligne du journal à corriger dans le rapport consolidé.

## Non-vérifiables

Texte exact art. 4.1.4 arrêté 17/02/2025 (Légifrance 403 — existence confirmée par décision CE
21/11/2025 n° 503693 qui le cite ; relire avant correction définitive de F1) ; comportement
Open-Meteo `freezing_level_height` sans passage 0 °C ; chemins réseau de collectVfrMinima
(jugés sur lecture, pures exécutées) ; rendu réel du modal des seuils et des PDF (flux tracé).

**Priorités volet** : P1 F1 (S) · P2 F3 (S), N1 (S), N2 (S) · P3 F6, F7, N3, N4, N5 (S) ·
P4 N6, N7.
