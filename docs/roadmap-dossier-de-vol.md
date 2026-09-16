# Roadmap « Dossier de vol complet » — décisions pilote (13/09/2026)

Issue de l'audit du 13/09/2026. **Décisions du pilote enregistrées le 13/09/2026 :**

- **Lot A retenu intégralement SAUF A7 (correctifs UX) et A8 (FPL pré-rempli)** — écartés.
- **Lot B retenu intégralement** (B1→B7).
- **Vérifications C1 + C2 retenues** (« à faire tôt »).
- **Arbitrage ① = C** — proposition automatique (badge « recommandé ») + choix du pilote pour le dégagement carburant. La recommandation combine météo à l'heure estimée + terrain ouvert + absence de NOTAM pénalisant — jamais la météo seule.
- **Arbitrage ② = A** — dossier PDF ~1 Mo SANS VAC intégrées (page de garde datée + attestation « VAC consultées ») ; l'option B (VAC intégrées) reste ouverte pour plus tard, en case optionnelle par terrain.
- **Arbitrage ③ = recommandation acceptée** — **AZBA d'abord** (A2 statuts `hor` puis B2 plages d'activation NOTAM), puis TEMSI (B3).

**Ordre de bataille** : C1 → C2 → A2 → A1 → A3 → A4 → A9 → A5 → A6 → B2 → B1 → B3 → B4 → B5 → B6 → B7.

**Avancement (13/09 soir — NON PUBLIÉ en racine, en attente de feu vert)** :
- **CANAL TEST EN PLACE** : l'état local de travail (A2 + C2 inclus) est servi sur **https://papabear56.pages-perso.free.fr/test/** (footer `vtest.…`, manifeste « — TEST ») via `npm run deploy:test` — cells/VAC lues depuis la racine (`js/data-base.js`), `config.local.js` jamais uploadé, racine prod vérifiée INCHANGÉE (v1.275). Workflow : modif → `deploy:test` → **approbation du pilote sur /test/** → `npm run pub`.
- **A1 FAIT (13/09 soir, sur /test/)** — carburant réglementaire avec branche dégagement, arbitrage ①=C : bouton « + » dans une 7ᵉ colonne « Dégagement » du panneau Alternates (mode trajet, conservé en mobile) ; **badge « Recommandé »** sur le plus praticable (catégorie de vol + distance à l'ARRIVÉE + H24 SIA − terrain privé — jamais la météo seule, IFR/LIFR jamais proposés) ; choix pilote togglable → recalcul du plan ; bloc Carburant écran à 4 cases (Trajet / Dégagement ICAO / Réserve / **Total requis = trajet + dégagement + réserve 30/45 min**, arrêté 24/07/1991) ; temps de la branche = distance destination→dégagement à la GS moyenne réelle du plan ; W&B : popup « carburant insuffisant » détaille le dégagement ; page 2 du PDF passe à 4 cellules quand un dégagement est choisi ; purge automatique si le terrain quitte la liste (destination changée). npm 285/285 + 4 aperçus PDF régénérés + check géométrique OK.
- **C2 FAIT** — vents Open-Meteo : la croisière (AMSL/QNH) est convertie en AGL via l'élévation du modèle portée par la réponse (`js/winds-aloft.js`, zéro requête supplémentaire) — le vent au-dessus d'un relief n'est plus lu trop haut de l'élévation du sol. + `test/winds-aloft.test.mjs`.
- **A2 FAIT** — champ `hor` SIA mappé (`_expandFileItem`), clé IDB bumpée `sia:airspaces:v3`, statut affiché aux 3 rendus : tooltip/popup de zone sur la carte (« H24 — jour et nuit », « Activation par NOTAM »…), 3ᵉ ligne du tooltip du profil d'élévation, sous-ligne des cadres R/D/P du PDF (« Tir · NOTAM », « Parachutage · H24 »). Le code « TS » (60 zones, sens non documenté par le SIA) est affiché BRUT par prudence — à qualifier.
- **C1 CONSTAT** — le flux NOAA `data/sigmet` ne servait ce soir QUE 15 Convective SIGMET US (tous émis KKCI) : aucun SIGMET France, aucun GAMET (produits hors périmètre NOAA). Le critère SIGMET du GO/NO-GO est donc probablement **muet pour un vol en France**. Suite à arbitrer : source France (open data DGAC / aviation.meteo.fr proxifié par le Worker).
- **LOT A COMPLET sur /test/ (13/09 nuit, vtest.1789303833967) — npm test 303/303** :
  - **A3 FAIT** — limites par avion dans la flotte : « Limite traversier (kt) » (GO/NO-GO : PRUDENCE à 80 % de la limite, NO-GO à la limite — `xwindThresholds`, sinon seuils 12/15) ; « Réserve perso (min) » ajoutée aux 30/45 réglementaires (affichée dans le devis et le PDF : « Réserve (37 min) ») ; chips récapitulatives dans la flotte.
  - **A4 FAIT** — devis carburant en vol local : champ « Durée prévue (min) » dans le widget Centrage (mémorisé) → requis = durée + réserve 30 min (+ perso), affiché « → X L », champ embarqué rouge si insuffisant (même mécanique que la nav).
  - **A9 FAIT** — checklist « Documents à bord » (licence/medical, carnet de vol, documents avion, cartes du jour) dans la modale « À vérifier avant d'imprimer » — 4 cases décochées à chaque impression (aide, sans blocage).
  - **A5 FAIT** — performance ATTERRISSAGE : `correctedLandingDistance` (DA +10 %/1000 ft, vent axial −10 %/+20 % par 10 kt plancher/plafond, mêmes facteurs revêtement que le décollage) ; section « Atterrissage · LFxx » du widget (rebaptisé « Performances piste ») quand le terrain observé est l'ARRIVÉE du plan (ou en vol local) ET que les refs POH « Atterr. roulement / 50 ft » de la flotte sont renseignées (C172 par défaut : 725/1400 ft POH). Verdict marge comme le décollage.
  - **A6 FAIT** — obstacles SIA dans la Z sécu : sommets des obstacles à ±0,5 NM de la route (base AIXM locale) intégrés à la marge mini (CAUTION/DANGER sous 1000 ft/sous la croisière), à la cellule « Obstacle max » du bloc Relief et à la Z sécu par tronçon du log de nav PDF (max(relief, sommet) + 1000 ft).
- **B2 v1 FAIT (13/09 nuit, localhost)** — moteur AZBA `js/azba.js` (pur, 13 tests sur item D RÉELS de la capture SOFIA) : `parseItemD` (plages HHMM, jours du mois `06 12 20`, MON-FRI, SR-SS via SunCalc à la position de la zone, traversant minuit), `notamZoneKeys` (désignateurs R/D/P cités dans l'item E, formats espacés/collés/LF-), `zoneActivation` (statut du jour ACTIVE/PLANIFIEE + référence NOTAM, validités respectées, sans item D = H24 sur la validité). Intégration : tooltip/fiche de zone sur la carte (rouge « ACTIVE maintenant · jusqu'à 17h00 (A 1462/26) » / ambre « Active aujourd'hui 07h00-16h00 »), re-rendu des zones à l'arrivée du dossier NOTAM (event `notam-dossier-ready`), getter `getCurrentNotams()`. **Validation réelle** : capture SOFIA 12/09 → 5 zones détectées (D510, D520, R1, R151, R778), toutes statuées. Restes B2 (v2) : étiquettes de zones actives en couleur sur la carte, récap dans le dossier NOTAM, Z sécu/PDF.
- **B2 v2 FAIT (14/09, localhost, npm 327/327)** — arbitrage pilote « zones actives le jour = trait PLEIN de leur couleur ; non actives = POINTILLÉ façon SIV, couleur inchangée » : `zoneActiveToday` (azba) + style par zone dans le rendu carte (`dashArray '8 5'` + halo, mécanisme SIV réutilisé). **Sémantique de sécurité** : le pointillé exige une PREUVE — un NOTAM du dossier qui CITE la zone (validité en cours) sans aucune plage aujourd'hui ; zone non mentionnée par le dossier (PIB couloir partiel) = trait plein (pas d'info ≠ inactive) ; H24/HX/hors dossier = plein. Mémoïsation (WeakMap clés, Map item D) pour le balayage des 1 526 zones. Validation réelle capture 12/09 : 141 zones hor=NOTAM → 141 pleines / 0 pointillées (dossier partiel ne citant que 5 zones actives — attendu).
- QA : `npm test` **327/327** (17 tests azba au total).
- **B1 COMPLET (13/09 nuit, localhost, npm 336/336)** — v1 écran : panneau « Dossier de vol » à 6 tuiles (Météo avec TAF 3 états dont « sans objet », NOTAM fraîcheur, VAC attestation horodatée à l ouverture + bouton Voir, Carburant requis/embarqué/dégagement, Perfs, Centrage verdict points.takeoff + MTOW) + fixes retours pilote (météo ROUGE → âge via getLastMetarObsMs du badge d âge ; centrage AMBRE → points.takeoff.inside ; widget piste masqué en consultation arrivée → bandeau invitation + atterrissage conservé, garde « destination ≠ observé » retiré). v2 PDF UNIQUE : bouton « Imprimer le dossier de vol » (nav) → modale adaptée → doc = garde datée (6 rubriques pastillées + attestation VAC cycle AIRAC + resp. CB) + page Météo (messages affichés + METAR arrivée) + log complet + annexe NOTAM, pages remontées en tête par doc.movePage (piège : la météo RESTE à n1 après le 1er move — micro-test _diag-movepage.mjs). QA : Apercu_Dossier_LFRV-LFOO.pdf (5 pages, p1=garde p2=météo) + widget takeoff diagnostiqué 3 flux par _diag-takeoff.mjs (Brave headless).

- **B7 MAQUETTE (15/09, localhost, npm 362 — 361 + 1 échec PRÉEXISTANT radio-points)** — carte de secours A5 paysage : maquettes réelles prêtes (voir Lot B), intégration au dossier APRÈS feu vert pilote. Pièges résolus : deltas jsPDF `doc.lines` consécutifs (relatifs au point PRÉCÉDENT) ; le screenshot Brave `--headless=new` n'attend PAS `--virtual-time-budget` (capture vierge) → capture CDP clippée au canvas (`test/_pdf2png-cdp.mjs` ; agent juge sans pixels dans cet env → QA géométrique `test/check-flight-map-pdf.mjs`).

Légende effort : **S** = quelques heures · **M** = 1–2 jours · **L** = 3–5 jours · **XL** = 1–2 semaines.
Workflow inchangé pour tout chantier : maquette/aperçu → feu vert pilote → implémentation → QA réelle.
Aucune publication sans autorisation explicite (`npm run pub` interdit sans feu vert).

---

## Lot A — Gains rapides (sur briques déjà existantes)

- [x] **A1 — Carburant réglementaire avec branche dégagement** (M) — **FAIT 13/09 (canal /test/)**
  Conforme à l'arrêté du 24/07/1991 : trajet + étape vers le dégagement + ROZ 30 min jour / 45 nuit.
  Mise en œuvre selon l'arbitrage ① = C : badge « recommandé » sur l'alternate proposé, clic pilote pour confirmer.
- [x] **A2 — Statuts d'ouverture des zones SIA** (S) — **FAIT 13/09 (non publié)**
  Afficher le champ `hor` de `data/sia-airspaces.json` (H24, HX, HO, NOTAM, TS…) sur le popup de
  zone et le profil d'espaces traversés. Première moitié de l'AZBA. **Premier chantier du lot A** (arbitrage ③).
- [x] **A3 — Limites par avion dans la flotte** (S) — **FAIT 13/09 (canal /test/)**
  Vent traversier max + réserve personnelle + marge perfo par avion, branchées dans le GO/NO-GO
  (remplace les seuils fixes 12/15 kt actuels).
- [x] **A4 — Devis carburant en vol local** (S) — **FAIT 13/09 (canal /test/)**
  Durée estimée + ROZ sans destination (le calculateur exige aujourd'hui départ ≠ arrivée).
- [x] **A5 — Performance atterrissage** (M) — **FAIT 13/09 (canal /test/)**
  Miroir du module décollage sur le terrain d'arrivée : piste en service d'arrivée, vent,
  densité-altitude, contamination → distance d'atterrissage vs LDA.
- [x] **A6 — Z sécu intégrant les obstacles** (M) — **FAIT 13/09 (canal /test/)**
  max(obstacle, relief) par tronçon — base obstacles SIA déjà embarquée.
- ~~A7 — Correctifs UX nomades~~ **ÉCARTÉ (pilote, 13/09)** — tactile 44 px, long-press, paysage iPad,
  thème cockpit jour, double codage pastilles, âge tooltip, mention radar, rewording disclaimer.
- ~~A8 — FPL pré-rempli~~ **ÉCARTÉ (pilote, 13/09)** — message OACI copiable + OVFI.
- [x] **A9 — Checklist documents pilote/avion** (S) — **FAIT 13/09 (canal /test/)**
  Liste décochable (licence, carnet de vol, CDV/attestation RC, certificat d'immatriculation,
  manuel de vol) au moment de l'impression du log.

## Lot B — Chantiers techniques (maquette + feu vert avant implémentation)

- [x] **B1 — Assistant « dossier de vol » + PDF unique** (XL)
  Tuiles de statut Météo / NOTAM / VAC / Carburant / Perfs / Centrage + export du dossier complet.
  Périmètre PDF selon l'arbitrage ② = A (~1 Mo, VAC non intégrées, page de garde datée ;
  option B ultérieure par terrain).
- [x] **B2 — AZBA : activations de zones** (L)
  Plages horaires NOTAM × polygones SIA (« R 71 : active aujourd'hui 14h00–17h00 ») sur la carte
  et dans le dossier. Prolonge A2 — **prioritaire sur B3** (arbitrage ③).
- [x] **B3 — TEMSI + couche vents sur carte** (L)
  Vignettes TEMSI datées + flèches de vent à l'altitude du plan (Open-Meteo). Après B2.
- [ ] **B4 — Sup AIP** (M) — à faire
  Crawl des Sup série A du SIA + filtrage par zone d'information.
- [x] **B5 — Prépa la veille / revalidation le matin** (L)
  Snapshot du dossier en IndexedDB + diff à la réouverture. Extension du watchdog.
- [ ] **B6 — Mode en vol à tuiles** (L) — à faire
  GO/NO-GO revalidé, METAR arrivée, créneau restant, destination ET alternate le plus proche,
  heure d'arrivée recalculée sur la GS réelle GPS → TAF relu à la nouvelle heure.
- [x] **B7 — Carte de vol imprimable** (M) — **FAIT 15/09 (canal /test/, en attente d approbation)**
  Export PDF de la carte régionale avec route + espaces tracés (« carte de secours »).
  → Arbitrages 15/09 : page **A5 paysage en DERNIÈRE page du PDF du dossier** ;
  cadrage AUTO sur le plan (route seule, comme « Cadrer plan », terrains hors
  emprise rabattus au bord) ; calques = **zones SIA étiquetées + terrains et
  alternates** (pas d'étiquettes de tronçons, pas de flèches vent) ; fond
  relief **OpenTopoMap** recomposé en un JPEG canvas (~300 Ko, budget 20 s,
  repli vectoriel blanc hors ligne). Modules `js/flight-map-pdf.js` (pur) +
  `js/flight-map-collect.js` ; tests `flight-map-pdf.test.mjs` (8/8) +
  `check-flight-map-pdf.mjs` (géométrique TOUT OK) + `qa-flight-map-dossier.mjs`
  (E2E réel : bouton → modale → onglet PDF, 6 pages, carte en dernière, JPEG
  canvas, zéro erreur console). **Fix au passage** : `taf-chart-capture.js`
  gelait à jamais si la page passait en arrière-plan pendant l'impression
  (l'onglet PDF ouvert AVANT la génération masque l'app → Chrome suspend les
  rAF) — repli minuteur 250 ms.

## Vérifications de fiabilité (à faire tôt, indépendamment du reste)

- [x] **C1 — Couverture AIRMET France via l'API NOAA** (S) — **CONSTAT FAIT 13/09**
  Vérifier ce que `aviationweather.gov/data/sigmet` renvoie réellement pour la France
  (GAMET absents) ; si incomplet → flux open data DGAC/Météo-France.
  → Constat : flux 100 % US ce soir (15/15 Convective SIGMET KKCI, zéro France, zéro GAMET).
  Le critère SIGMET du GO/NO-GO est muet en France — source à qualifier (voir Avancement).
- [x] **C2 — Vents Open-Meteo : AGL vs altitude de croisière AMSL** (S) — **FAIT 13/09 (non publié)**
  Les niveaux sont AGL, la croisière est QNH : corriger avec l'élévation du terrain sous le
  milieu du tronçon, ou documenter la limite dans l'UI.
  → Fait : conversion par l'élévation du modèle Open-Meteo portée par la réponse elle-même.

---

## Arbitrages — relevés de décision

### ① Dégagement carburant → **C : proposition auto + choix pilote**
Badge « recommandé » sur l'alternate le plus praticable à l'heure estimée (météo + horaires +
NOTAM + distance), sélection confirmée par le pilote. La sélection automatique pure (B, météo
seule) a été écartée : météo ≠ praticable.

### ② Dossier PDF unique → A (14/09) puis **B (16/09, demande pilote)**
Option A d'abord (~1 Mo, attestation « VAC consultées »). Le 16/09, le pilote a demandé
l'option B : **cartes VAC INTÉGRÉES** (départ, arrivée, dégagement) en pages A5 APRÈS la
carte de vol — rendu pdfjs par page (JPEG ~170 dpi), bande titre terrain + AIRAC + i/n,
attestation de la garde corrigée (« jointe au dossier » quand la carte est là).
Pièges découverts : **pdfjs page.render() se SUSPEND indéfiniment dans une page masquée**
(l'onglet PDF prend le focus avant la génération) → rendu dans l'onglet popup hôte (même
origine, script en URL absolue) ; variable de collecte à déclarer AVANT le bloc garde (TDZ).

### ③ AZBA vs TEMSI → **recommandation acceptée : AZBA d'abord**
Deux pas : A2 (statuts `hor`, quasi gratuit) puis B2 (plages d'activation NOTAM). TEMSI (B3)
ensuite en complément simple.
