# Fourmy

**Le jumeau numérique de la ferme.** Fourmy est la réécriture complète
d'Ekylibre : productions, parcellaire, interventions, stocks, planification,
capteurs, traces GPS et matériels, dans un modèle daté qui permet de revoir la
ferme à n'importe quelle date, en 2D comme en 3D.

- **Lyvre** garde l'argent et le droit (achats, ventes, facturation,
  comptabilité, juridique) ; Fourmy garde le physique.
- Un **assistant IA** (Claude, Aiffel…) consulte la ferme par le serveur MCP de
  Fourmy et y propose des interventions, que le responsable valide ; les
  logiciels tiers passent par l'API ouverte (clés d'API ou OAuth).
- Des **plugins** tiers, open source ou privés, étendent Fourmy.

Licence : AGPL-3.0. Site du projet : fourmy.org. Présentation : ekylibre.com.

## Aperçu

[![Rejeu 3D d'une pulvérisation : trace GPS du pulvérisateur sur le relief et la photo IGN, avec la dose, la météo, l'IFT et la surface travaillée en incrustation](apps/site/src/assets/captures/accueil-3d.png)](https://fourmy.org/videos/accueil-pulverisation.mp4)

*Rejeu 3D d'une pulvérisation (cliquer pour lancer la vidéo, 19 s). Une [seconde vidéo](https://fourmy.org/videos/accueil-broyage.mp4) montre un broyage. Les captures viennent d'une ferme de grandes cultures pilote, avec l'accord de l'exploitant.*

| Contrôle réglementaire | Parcellaire | Interopérabilité |
|---|---|---|
| [![Fiche d'un traitement : pictogrammes, ZNT, contrôle des doses et des usages](apps/site/src/assets/captures/accueil-reglementaire.png)](apps/site/src/assets/captures/accueil-reglementaire.png) | [![Fiche d'une parcelle : culture, PAC, cadastre et photo IGN](apps/site/src/assets/captures/accueil-parcellaire.png)](apps/site/src/assets/captures/accueil-parcellaire.png) | [![Intervention tirée du GPS : attelage, parcours et trace sur la photo IGN](apps/site/src/assets/captures/accueil-interoperabilite.png)](apps/site/src/assets/captures/accueil-interoperabilite.png) |
| Doses, usages, ZNT et pictogrammes vérifiés à chaque traitement | Culture, îlot PAC, cadastre et photo IGN de chaque parcelle | Attelage et parcours tirés du GPS du tracteur |

| Assolement prévisionnel | Temps de travaux | Marges prévisionnelles |
|---|---|---|
| [![Assolement de la campagne suivante en plein écran sur la photo IGN : découpe, fusion et cultures prévues](apps/site/src/assets/captures/assolement.png)](apps/site/src/assets/captures/assolement.png) | [![Heures de travail par semaine de la campagne prévue, pointes et capacité de la ferme](apps/site/src/assets/captures/temps-travaux.png)](apps/site/src/assets/captures/temps-travaux.png) | [![Onglet Économie de l'assolement : produit, charges et marge directe par activité](apps/site/src/assets/captures/marges.png)](apps/site/src/assets/captures/marges.png) |
| Cultures, dérobées et couverts ; BCAE 7, délais de retour, bio et HVE contrôlés en direct | Itinéraires tirés de l'historique, barème BCMA, trajets OSRM, pointes | Produit, charges et marge directe par activité, prix de référence publics |

## Documentation

| Document | Contenu |
|---|---|
| [`docs/requirements.md`](docs/requirements.md) | Exigences v1, user stories, fermes pilotes, première tranche de 7 jours |
| [`docs/architecture.md`](docs/architecture.md) | Choix d'architecture (ADR), modèle de données, API, 3D, plugins, organisation multi-agent |
| [`docs/site-public-exigences.md`](docs/site-public-exigences.md) | Site public fourmy.org : exigences validées (présentation, fonctionnalités par module, comparatif, nouveautés automatiques, installation, contact, page ekylibre.com, logo) |
| [`docs/deploiement.md`](docs/deploiement.md) | Déploiement Docker / Dokploy : services, variables, premier démarrage (dev puis production Eyona) |
| [`docs/interventions.md`](docs/interventions.md) | Interventions et procédures simplifiées (validé ; étapes 1 à 3 réalisées) : 6 formes, catalogue, modèle, correspondance Ekylibre, impacts Fourmy et zero-mobile |
| [`docs/workflow.md`](docs/workflow.md) | Plan d'implémentation de la première tranche : jour 1 des fondations, tâches des 7 agents, recette |
| [`docs/phyto.md`](docs/phyto.md) · [`docs/meteo.md`](docs/meteo.md) | Contrôle réglementaire des traitements (E-Phy, ZNT, IFT, mélanges), registre au format réglementaire 2027 ; météo des interventions, stations Weenat et Sencrop |
| [`docs/teledetection.md`](docs/teledetection.md) | NDVI des parcelles (Sentinel-2, Copernicus), courbe et comparaison aux années précédentes, images sur la carte et le plan 3D |
| [`docs/jumeau-3d.md`](docs/jumeau-3d.md) | Plan 3D du jumeau : rangs de végétation selon l'état observé, météo du jour (pluie, brume, sol mouillé, gelée) |
| [`docs/modele-croissance.md`](docs/modele-croissance.md) | Modèle de croissance : stades par degrés-jours, bilan hydrique, besoin d'irrigation, signalements |
| [`docs/modulation.md`](docs/modulation.md) | Cartes de modulation (zonage Sentinel-2, doses par zone, ISO-XML et Shapefile) et envoi aux machines par agrirouter |
| [`docs/activites.md`](docs/activites.md) · [`docs/parcelles.md`](docs/parcelles.md) · [`docs/carto.md`](docs/carto.md) | Activités et productions ; création de parcelles (PAC, cadastre) et fiche ; outils de cartographie |
| [`docs/materiels.md`](docs/materiels.md) | Matériels : fiche, compteur et relevés, plan d'entretien et échéances, interventions d'entretien, pièces à commander, alertes, avatar 3D (mode d'emploi et API) |
| [`docs/parcours-attelages.md`](docs/parcours-attelages.md) · [`docs/parcours-attelages-design.md`](docs/parcours-attelages-design.md) | Parcours GPS d'un matériel, intervention tirée des parcours, attelages dans l'intervention : exigences et design |
| [`docs/materiels-entretien.md`](docs/materiels-entretien.md) · [`docs/materiels-entretien-design.md`](docs/materiels-entretien-design.md) | Matériels et entretien : exigences (et bilan de réalisation), design (et écarts à la réalisation) |
| [`docs/equipe-personnes-design.md`](docs/equipe-personnes-design.md) | Équipe et personnes : fiche personne, données personnelles, rôle lecture seule, temps de travaux, invitations, import Ekylibre, synchro mobile |
| [`docs/routage-osrm.md`](docs/routage-osrm.md) | Routage tracteur (OSRM auto-hébergé) : trajets du rejeu recalés sur la route |
| [`docs/acces-externes.md`](docs/acces-externes.md) · [`claudedocs/conception_api_mcp.md`](claudedocs/conception_api_mcp.md) | API ouverte et serveur MCP : clés d'API, applications OAuth, invité restreint, droits par module et par activité, propositions à valider, journal, OpenAPI (lots AM0 à AM8) |
| [`docs/imports.md`](docs/imports.md) · [`claudedocs/conception_import_onboarding.md`](claudedocs/conception_import_onboarding.md) | Imports DAPLOS, Geofolia et TelePAC, assistant de premier démarrage : besoins, conception, plan (lots IM1 à IM7) et état |
| [`docs/modele-parcelles-activites-productions.md`](docs/modele-parcelles-activites-productions.md) | Modèle des parcelles (versions datées, filiation), campagnes, activités, productions et assolement : modèle conceptuel, liens entre tables, règles |
| [`docs/assolement.md`](docs/assolement.md) · [`claudedocs/conception_assolement.md`](claudedocs/conception_assolement.md) | Assolement prévisionnel : préparer, découper et fusionner, contrôles en direct (PAC, agronomie, certifications, réglementaire), valider ; besoins des trois temps, conception, plan (lots AS1 à AS4) |
| [`docs/economie.md`](docs/economie.md) · [`claudedocs/conception_assolement_eco.md`](claudedocs/conception_assolement_eco.md) | Module économique : prix datés de la ferme, références Lexicon et prix de marché, rendement et prix par défaut, marges de l'assolement, comparaison au réalisé N-1 (lots E1 à E6) |
| [`docs/semences.md`](docs/semences.md) · [`claudedocs/conception_assolement_itk.md`](claudedocs/conception_assolement_itk.md) | Semences (catalogue officiel, PMG, semis, mélanges) ; itinéraires techniques de la ferme, interventions prévues, temps de travaux et besoins en intrants (lots IT1 à IT6) |
| [`docs/controles-hve-ab.md`](docs/controles-hve-ab.md) · [`claudedocs/conception_controle_hve_ab.md`](claudedocs/conception_controle_hve_ab.md) | Contrôles HVE (niveau 3) et Agriculture biologique : ce qui est contrôlé, où, exports ; besoins, conception, plan (lots CT1 à CT6) et état |
| [`docs/specifications-metier.md`](docs/specifications-metier.md) | Spécification métier : toutes les règles de gestion (RG-…), par domaine |
| [`claudedocs/besoins_ma_ferme.md`](claudedocs/besoins_ma_ferme.md) · [`claudedocs/conception_ma_ferme.md`](claudedocs/conception_ma_ferme.md) | « Ma ferme » : fiche de l'exploitation, sites, cache IGN sur le serveur, copie hors ligne dans le navigateur |
| [`claudedocs/besoins_itineraires_techniques.md`](claudedocs/besoins_itineraires_techniques.md) · [`claudedocs/conception_itineraires_techniques.md`](claudedocs/conception_itineraires_techniques.md) | Itinéraires techniques d'une parcelle et d'une activité (TIKA, fork `ekylibre/itineraire-technique` et reversement à OSFarm) |
| [`claudedocs/besoins_agrirouter.md`](claudedocs/besoins_agrirouter.md) · [`claudedocs/conception_agrirouter.md`](claudedocs/conception_agrirouter.md) | agrirouter : application enregistrée, exigences de la revue, écoute des événements, file d'envoi, lecture des TaskData et EFDI, synchro des parcelles ; lots AR1 à AR8 et leur état |
| [`claudedocs/besoins_navigation_compte.md`](claudedocs/besoins_navigation_compte.md) | Navigation : menu du compte, onglets Équipe et Préférences de « Ma ferme », version en pied de menu |
| [`claudedocs/points_ouverts.md`](claudedocs/points_ouverts.md) | Points ouverts, par thème et priorité (alimente la roadmap GitHub) |

## État du projet (2026-11-28)

| Étape | État |
|---|---|
| Exigences (`/sc:brainstorm`) | ✅ terminé |
| Architecture (`/sc:design`) | ✅ stack confirmée (TypeScript + service Python, React + Mantine), exports vérifiés |
| Plan d'implémentation (`/sc:workflow`) | ✅ rédigé (`docs/workflow.md`) |
| Jour 1 — fondations (agent 0) | ✅ gel terminé (contrats, db+RLS, API, CI, mocks, agro) |
| Agent A — domaine | ✅ logique pure + vue registre phyto |
| Agent B — migration Ekylibre | ✅ 3 fermes migrées, registre phyto identique, fixtures anonymisées |
| Agent D — API métier | ✅ autorisation par ferme, snapshot, cuves, stocks, interventions (US-2), registre phyto (JSON/CSV), synchro mobile, imports |
| Agent C — Traccar et traces | ✅ synchro réelle (7 592 positions), rejeu CZML, couverture validée contre Traccar (+1,5 %) |
| Agent E — interface web | ✅ React + Mantine (charte Lyvre) : tableau de bord, carte IGN + traces, interventions, stocks, cuverie, registre, imports ; parcours e2e en CI |
| Agent F — plan 3D | ✅ relief et photo IGN, bâtiments (hauteurs BD TOPO), cuverie placée et remplie selon la frise, rejeu 3D des traces, placement manuel des cuves |
| Interventions et procédures simplifiées (étape 1) | ✅ 6 formes, catalogue, périodes, personnes, motifs, annulation, habitudes de la ferme ; migrateur et formulaire web |
| Comptes better-auth (étape 2) | ✅ comptes locaux, sessions cookie + bearer (mobile), équipe (membres, personnes ↔ comptes) |
| Intégrations par ferme | ✅ module Intégrations (Traccar) : accès chiffrés par ferme, testés avant enregistrement, worker de synchro chaque minute |
| Déploiement | ✅ Dokploy : dev.fourmy.org et fourmy.org en ligne depuis le 07/11 (image construite par la CI) ; sauvegardes de la base à mettre en place |
| Site public fourmy.org | ✅ présentation, fonctionnalités par module (à jour du 22/11), comparatif, nouveautés automatiques (RSS), installation, contact ; page Fourmy d'ekylibre.com sur une branche |
| zero-mobile (étape 3) | ✅ branche `fourmy-backend` : compte Fourmy, catalogue, formulaire générique par forme, push par intervention ; vérifié contre l'API — reste le passage sur appareil |
| Retours de test des pilotes (interventions, phyto, activités, parcelles) | ✅ lots A à H : saisie pleine page, contrôle réglementaire, précautions et mélanges, activités, certifications, parcelles depuis la carte (PAC, cadastre) |
| Matériels et entretien (lots I à M) | ✅ fiche et relevés d'heures, plan d'entretien et échéances, import de la base matériel, interventions d'entretien, heures estimées par Traccar, pièces à commander, alertes, avatar 3D et rejeu dans le plan 3D (`docs/materiels.md`) |
| Parcours GPS et attelages (lots N à R) | ✅ attelages dans l'intervention (mode libre conservé), parcours GPS par matériel, intervention tirée des parcours, attelages types, applicateur au registre phyto, reprise Ekylibre et synchro mobile (`docs/parcours-attelages.md` §8) |
| Retours de test du 10/11/2026 (lots S à X) | ✅ menus en sections, intégrations par thème, formulaire d'intervention réordonné, choix des colonnes des listes, widget Parcours GPS du tableau de bord, registre phyto au format réglementaire (OEPP, BBCH, SIRET), stations Weenat et Sencrop (`claudedocs/workflow_retours_10112026.md`) |
| Télédétection, croissance, irrigation, 3D (lots Y à AC) | ✅ Sentinel-2 par ferme (NDVI, NDRE, NDMI), récoltes probables, végétation et météo du plan 3D, modèle de croissance, bilan hydrique et irrigations (`docs/teledetection.md`, `docs/modele-croissance.md`, `docs/jumeau-3d.md`) |
| Modulation (lot AD) | ✅ cartes de modulation par zones, export ISO-XML et Shapefile, envoi agrirouter (`docs/modulation.md`) |
| agrirouter (lots AR1 à AR5, 16/11) | 🟡 application « Fourmy » enregistrée en production (version 1 soumise pour revue). AR1 fusionné : connexion conforme à la revue, lancée aussi depuis agrirouter (`fourmy.org/agrirouter`), déconnexion constatée. AR2 à AR5 fusionnés (#62 à #65, 18/11) : écoute des événements et fichiers reçus, file d'envoi avec reprise, TaskData reçus proposés en intervention, journaux EFDI versés aux parcours GPS. Pas encore d'essai sur console (IO-Tool et validation de la version attendus) ; AR7 (parcelles) et AR8 (revue) à faire (`claudedocs/conception_agrirouter.md`) |
| Fertilisation azotée (lots AE à AQ) | ✅ zonage nitrates, sols et analyses, plan prévisionnel de fumure (Nouvelle-Aquitaine), contrôles à la saisie, cahier d'enregistrement ; saisie des engrais en kg ou en litres (`docs/fertilisation.md`) |
| Équipe et personnes (lots P1 à P5) | ✅ équipe en pavés (onglet de « Ma ferme » depuis le 13/11) et fiche personne (photo, coordonnées réservées, contrat, Certiphyto), rôle lecture seule, temps de travaux d'après les interventions, invitations par email ou lien, import Ekylibre des personnes, fiche et heures pour le mobile (`docs/equipe-personnes-design.md`) |
| Plan 3D et matériels (12/11) | ✅ vue pleine hauteur, couches en barre d'icônes, plein écran, barre de temps ; outil Traccar attelé au rejeu ; trajets recalés par OSRM ; types de matériel porteurs de l'avatar, largeur de rampe (`docs/jumeau-3d.md`, `docs/routage-osrm.md`, `docs/materiels.md`) |
| « Ma ferme » (lots F1 à F5, 13/11) | ✅ fiche de l'exploitation (identité, certifications, logo, reprise Ekylibre), sites géocodés, réglages regroupés, cache IGN sur le serveur (fonds, relief, bâtiments) préchargé par le worker, copie hors ligne dans le navigateur (`claudedocs/conception_ma_ferme.md`) |
| Itinéraires techniques (lots T0 à T3, 13/11) | ✅ frise TIKA d'une parcelle (campagne ou rotation) et d'une activité (vue fusionnée, groupes, descente sur une parcelle) ; fork TIKA `v1.3.0-ekylibre.3`, reversement à OSFarm à faire (`claudedocs/conception_itineraires_techniques.md`) |
| Navigation et compte (13/11) | ✅ menu du compte en haut à droite (profil, ferme, mot de passe, déconnexion), équipe et préférences dans « Ma ferme », version en pied de menu (`claudedocs/besoins_navigation_compte.md`) |
| Imports et assistant (lots IM1 à IM6, 17-19/11) | ✅ DAPLOS, Geofolia et TelePAC de bout en bout, historique N-1 à N-5, annulation d'un import, assistant de premier démarrage et reprise d'une sauvegarde Ekylibre ; recette avec l'exploitant testeur à faire (IM7) (`docs/imports.md`) |
| Assolement prévisionnel, temps 1 (lots AS1a à AS4, 20/11) | ✅ menu Assolement dans Activités ; carte et liste des parcelles, affectation des cultures, dérobées, couverts, découpe et fusion datées ; contrôles en direct (BCAE 7, délais de retour, AB et HVE, ZNT, captages, Natura 2000) ; validation qui crée productions, parcelles et couverts, versions ; essai avec l'exploitant testeur à faire (`docs/assolement.md`) |
| Assolement, temps 2 : itinéraires techniques (lots IT1 à IT6, 21/11) | ✅ ITK de la ferme tirés de l'historique et édités, affectés dans l'assolement ; interventions prévues créées sur demande ; temps de travaux (débits des matériels, barème BCMA, trajets OSRM, pointes) ; besoins en intrants comparés aux stocks (`docs/assolement.md`) |
| Assolement, temps 3 : économique (lots E1 à E6, 21-22/11) | ✅ module Économique : prix datés de la ferme, références Lexicon (rendements, prix des productions, prix des engrais, phyto et semences du bundle `fourmy`), prix européens ; marges jusqu'à la marge directe dans l'onglet Économie de l'assolement, comparées au réalisé N-1 ; recette avec les fermes de test à faire (`docs/economie.md`) |
| Semences (lots SE1 à SE8, 20-21/11) | ✅ Stocks → Semences : fiche (espèce, variété, code GNIS, PMG avec repères Arvalis et Terres Inovia), PMG par lot, catalogue officiel des variétés, rattachement proposé ; semis en grains/m², kg/ha, milliers ou doses, stock converti ; mélanges dosés par espèce, couverts repris du semis ; utilisation par campagne et export CSV (`docs/semences.md`) |
| Contrôles HVE et AB (lots CT1 à CT6a, 19-20/11) | 🟡 menu Réglementaire selon les certifications ; HVE niveau 3 (quatre indicateurs, IAE, questionnaire, IFT certifié) ; AB (règles R1 à R34, conversion déduite, cuivre, annexe II consolidée au 01/01/2026, semences, rotation) ; feux à la saisie ; registre AB et liasse HVE. Reste l'export de la grille HVE officielle remplie, qui attend une grille de référence remplie à la main (`docs/controles-hve-ab.md`) |
| Registre phyto imprimable (22/11) | ✅ édition au format réglementaire en A4 paysage, en-tête de la ferme commun avec le plan de fumure, `?format=pdf` (#162) (`docs/phyto.md`) |
| Déploiement du 22/11 | ✅ CI de `main` de nouveau verte (#151) ; OSRM en service sur dev.fourmy.org (graphe Aquitaine + Pays de la Loire) ; nginx résout l'API à chaque requête (#154, après une panne de 502) ; prix d'intrants Lexicon chargés (clé `bundle:fourmy`) (`docs/deploiement.md`) |
| API ouverte et serveur MCP (lots AM0 à AM8, 27-28/11) | ✅ droits par module (aucun, lecture, lecture et propositions) et par activité, appliqués par la RLS ; invité restreint ; clés d'API et applications OAuth (consentement, une ferme) ; journal et débit ; serveur MCP (`/mcp`, 14 outils) ; `openapi.json` et page `/developpeurs` ; propositions d'interventions contrôlées à blanc et validées dans « À valider ». Connecteur Claude et recette R5 validés sur dev.fourmy.org. Suites : outil MCP des marges (#178), page « Mes accès » (#179) (`docs/acces-externes.md`) |
| Migration réelle et recette | ✅ trois fermes reprises (08/11) ; recettes des 11 et 12/11 sur la ferme pilote de grandes cultures (`claudedocs/plan_de_test_global.md`), spécification métier (`docs/specifications-metier.md`) |

### À reprendre

La liste complète des points ouverts (150 au 22/11/2026, par thème et par
priorité) est dans `claudedocs/points_ouverts.md` ; elle alimente la
roadmap du projet GitHub [Fourmy — Roadmap](https://github.com/orgs/ekylibre/projects/2)
(issues pour P1 et P2, brouillons pour P3). Avant l'envoi à la ferme pilote :
sauvegardes de la base et coffre des clés, outils Traccar reliés, données de
la ferme à compléter (SIRET, sols, 14-48 liquide dans Ekylibre, Arion 430)
et validation par la ferme pilote des phrases qui lui sont prêtées (l'accord
écrit pour les captures est obtenu).

Recettes avec les deux fermes de test, sur dev.fourmy.org (au 22/11 : ITK de
l'exploitant testeur recréés ; ferme de la GAEC copiée depuis la base de
développement, compte de son responsable et intégration Traccar, boîtiers à
partager côté Traccar) : relecture des itinéraires (point 135), assolement
2027 (#112), prix et marges (#157), matériels au barème BCMA (#155).

agrirouter (point 55 et suivants) : envoyer le message au support (IO-Tool,
validation de la version 1, déclaration des parcelles, contrat), puis essayer
sur console avec l'IO-Tool avant la synchro des parcelles (AR7) et la revue
(AR8). AR2 à AR5 sont fusionnés.

### Démarrage local

```bash
corepack pnpm install
docker compose -f docker/compose.dev.yml up -d   # FOURMY_DB_PORT=5434 si un PostgreSQL local occupe 5432 (adapter DATABASE_URL)
export DATABASE_URL=postgres://fourmy:fourmy@localhost:5432/fourmy
corepack pnpm build && corepack pnpm migrate
corepack pnpm --filter @fourmy/api seed:dev  # compte dev@fourmy.local, owner de toutes les fermes + référentiel Lexicon
corepack pnpm dev                              # API :3000, web :5173 (relaie /api)
```

- **API qui ne démarre pas en `dev`** (constaté le 2026-11-13 sous Node 25 :
  `Cannot find module '…/src/app.js'`, le mode `--experimental-strip-types`
  ne relie pas les imports `.js` aux sources `.ts`) : lancer l'API compilée,
  `corepack pnpm --filter @fourmy/api start`, après `corepack pnpm build`.
  Une modification de l'API demande alors de reconstruire et de relancer.
- **Worker** (`corepack pnpm --filter @fourmy/api worker`) : il traite le
  préchargement IGN de « Ma ferme », les parcours et les synchros. Sans lui,
  un téléchargement IGN reste en attente (la page le signale au bout de
  3 minutes). Ne pas lancer les tests de l'API pendant qu'il tourne sur la
  même base : il prend les tâches créées par les tests.
- La version en pied de menu est servie en local par Vite (`/version.json`,
  calculée depuis l'historique Git).

Le **référentiel Lexicon** (productions de référence et images des activités,
E-Phy, taxonomie) est copié dans la base : par le worker en production
(`corepack pnpm --filter @fourmy/api worker`), par `seed:dev` en local, ou à
la demande avec `corepack pnpm --filter @fourmy/lexicon sync`. Sans lui,
l'API l'annonce au démarrage : activités sans image, références refusées,
contrôle phyto faux.

Application web : http://localhost:5173 — connexion avec le compte affiché
par `seed:dev` (e-mail prérempli en développement). Parcours de bout en bout :
API + `vite preview` démarrés, puis `DATABASE_URL=… corepack pnpm --filter @fourmy/web e2e`.
Les navigateurs pilotables s'installent une fois :
`corepack pnpm --filter @fourmy/web exec playwright install chromium firefox`
(Firefox ne rejoue que le plan 3D, avec `E2E_FIREFOX=1`, sur un poste avec carte
graphique ; la CI n'a pas de WebGL sous Firefox).

### Site public, version et nouveautés

- `apps/site` (Astro) : fourmy.org — `corepack pnpm --filter @fourmy/site dev`.
- **Version et nouveautés automatiques** (`packages/release`) : calculées depuis
  les commits conventionnels à chaque construction (`feat` → version mineure,
  `fix` → correctif ; `docs`, `chore`… ne comptent pas). Le titre du commit
  devient l'entrée publique, sans sa portée ; le corps n'est jamais publié.
  Pour l'écrire pour les agriculteurs, ajouter au message une ligne
  `Public: <texte>` — ou `Public: non` pour ne pas l'afficher. Un nom de
  pilote ou une adresse e-mail dans une entrée publique fait échouer la
  construction (`packages/release/denylist.txt`). Aperçu :
  `node packages/release/dist/cli.js`.
- **Captures** des fonctionnalités (API et application démarrées) :
  `CAPTURES=1 DATABASE_URL=… corepack pnpm --filter @fourmy/web exec playwright test e2e/captures.spec.ts`.
- **Logo** : `packages/ui-lyvre/brand/` (générateur `generate.py`).

### Comptes

Comptes locaux **better-auth** (e-mail + mot de passe) : cookie de session
pour le web, jeton signé `Authorization: Bearer` (en-tête `set-auth-token` à
la connexion) pour le mobile. L'inscription libre est fermée : le responsable de la ferme
invite une personne depuis sa fiche (page **Équipe**), par email ou par un
lien à lui transmettre ; elle crée son compte en acceptant. L'administrateur
peut aussi créer un compte (`user:create`).

```bash
# mot de passe lu sur l'entrée standard (jamais en argument)
corepack pnpm --filter @fourmy/api user:create --email salarie@ferme.fr --name "Camille"
```

En production : `BETTER_AUTH_SECRET` (obligatoire), `BETTER_AUTH_URL`,
`FOURMY_TRUSTED_ORIGINS` (voir `.env.example`).
