# Visualiseur METAR/TAF

**Météo aéronautique en temps réel pour pilotes VFR** — décodage et visualisation
graphique des METAR/TAF, planification de vol, performances décollage et log de nav,
dans une PWA installable qui fonctionne aussi hors ligne.

🌐 **Application en ligne :** <http://papabear56.free.fr/>

---

## Fonctionnalités

### Météo & briefing
- **METAR / TAF** décodés en clair et visualisés graphiquement (rose des vents
  animée, sélecteur de piste en service, tendances sur 24 h).
- **Widgets météo** : température / point de rosée, tendance de pression,
  **givrage carburateur** (zones à risque), niveau de congélation, vents en
  altitude, plafond & visibilité.
- **SIGMET / AIRMET** et **PIREP** (rapports de pilotes) autour du terrain.
- **Radar de précipitations** (RainViewer) en superposition carte.
- **Fenêtre de vol jour VFR** avec alerte de nuit (crépuscules calculés).
- **Mode cockpit** (briefing express ultra-lisible) et **mode nuit** (vision
  scotopique préservée).
- **Watchdog** : surveillance active des terrains favoris.

### Navigation
- **Planificateur de vol** : recherche de terrain par code OACI (validation
  alphanumérique, ex. CNU8 ou K6RE), waypoints intelligents ou libres,
  alternates, compagnie du trajet, autocomplétion.
- **Carte régionale** (Leaflet) : route, étiquettes de tronçons
  (cap / distance / temps), espaces aériens (openAIP), radar.
- **Profil d'élévation** du trajet (Open-Meteo) en NM par tronçon.
- **Météo de route** sur chaque waypoint, créneaux de vol par étape.
- **Permalien complet** du plan de vol (départ / destination / waypoints),
  partageable par QR code.
- **Sauvegarde / import** du plan de vol : JSON natif, **GPX** et **KML**.

### Performances & masse
- **Performance décollage** : flotte d'avions personnalisable (Cessna, Piper,
  Robin, DR400…), correction densité-altitude, revêtement de piste (herbe,
  dur sec/humide/contaminé), piste en service pilotée par la rose des vents,
  schéma en coupe (roulement → rotation → franchissement 50 ft) avec marge
  restante ou manque.
- **Masse & centrage** : centrogramme par avion (enveloppe, postes, carburant),
  points Décollage / Arrivée / ZFW, page dédiée du PDF, pré-remplissage depuis
  le plan de nav en mode navigation.
- **Log de nav PDF** (3–4 pages) : waypoints, alternates, météo, terrain,
  performances et centrage — généré dans le navigateur, sans serveur.

### Général
- **PWA** installable (mobile / bureau), fonctionne **hors ligne** (service
  worker + cache), mise à jour automatique à chaque déploiement.
- **Interface française / anglaise**, thème sombre.
- Données mises en cache côté client pour la réactivité (mode avion toléré).

## Sources de données

| Source | Usage |
|---|---|
| [aviationweather.gov](https://aviationweather.gov/) | METAR, TAF, PIREP, SIGMET, ATIS, infos stations |
| [Open-Meteo](https://open-meteo.com/) | Prévisions, élévation, vents en altitude |
| [openAIP](https://www.openaip.net/) | Terrains et espaces aériens |
| [RainViewer](https://rainviewer.com/) | Radar de précipitations |
| Relais CORS (Google Apps Script) | Proxy met en cache les requêtes météo |

## Développement

Prérequis : **Node.js ≥ 18** (tests `node --test`).

```bash
npm install     # devDependencies (basic-ftp pour le déploiement)
npm test        # suite complète (~140 tests : cœur, plan de vol, perfs, centrage…)
```

- `index.html` — application (vanilla JS, modules ES, aucun framework).
- `js/` — modules applicatifs (`engine`, `weather`, `flight-planner`,
  `takeoff-performance`, `wb-core`, `navlog-pdf`…), volontairement découplés
  et testables sous Node.
- `test/` — tests unitaires + **pages d'aperçu** autonomes (QA visuelle des
  schémas, génération d'aperçus PDF) — non exécutées par `npm test`.
- `vendor/` — dépendances bundlées (Leaflet, jsPDF, pdf.js, Lucide) pour un
  fonctionnement 100 % hors ligne.
- `apps-script/` — code du relais CORS (proxy météo avec cache).

## Déploiement

À chaque push sur `Version-2.0`, **GitHub Actions** déploie automatiquement par
FTP sur Free.fr, bump les versions PWA et committe le marqueur `[deploy]`
(workflow `.github/workflows/deploy-ftp.yml`, secrets `FTP_SERVER`,
`FTP_USER`, `FTP_PASSWORD`).

En local, la routine complète tient en une commande :

```bash
npm run pub -- "message du commit"   # commit + push + attente du déploiement
```

## Crédits & licences

- [Leaflet](https://leafletjs.com/) (BSD-2) — cartographie.
- [jsPDF](https://github.com/parallax/jsPDF) (MIT) — log de nav PDF.
- [Mozilla pdf.js](https://github.com/mozilla/pdf.js) (Apache-2.0) — aperçus PDF.
- [Lucide](https://lucide.dev/) (Apache-2.0) — icônes (dont l'avion du schéma
  de décollage, tracé `plane-takeoff`).
- Données aéronautiques : aviationweather.gov (NOAA), openAIP et contributeurs.

## ⚠️ Avertissement

Cet outil est une **aide au briefing** : il agrège et met en forme des
informations publiques. Il ne remplace ni les sources officielles (SIA,
NOTAM, aviationweather.gov), ni le jugement du pilote, ni les performances
du manuel de vol de l'aéronef. **Responsabilité du commandant de bord.**
