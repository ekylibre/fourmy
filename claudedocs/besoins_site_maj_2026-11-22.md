# Mise à jour du site fourmy.org après les développements du 19 au 22/11

*Brainstorm du 22/11/2026. Pages concernées : Fonctionnalités (`apps/site/src/content/features.yaml`), Comparatif (`comparatif.yaml` et `pages/comparatif.astro`), Nouveautés (`nouveautes.yaml`), captures (`apps/site/src/assets/captures/`). Dernière mise à jour du site : 18/11 (PR #76 à #78).*

## 1. Objectif

Le site décrit Fourmy au 18/11. Depuis, sept chantiers sont arrivés (PR #79 à #151) et n'y figurent pas :

| Chantier | PR | Où dans l'application |
|---|---|---|
| Imports DAPLOS, Geofolia, TéléPAC ; historique N-1 à N-5 ; annulation | #81-#85 | Ma ferme → Imports |
| Assistant de premier démarrage, reprise d'Ekylibre | #86 | premier démarrage |
| Contrôles HVE (4 indicateurs, questionnaire, liasse) et AB (règles R1-R34, registre AB) | #87-#99 | Réglementaire → Contrôle HVE / Contrôle AB |
| Assolement prévisionnel (carte et liste, découpe et fusion datées, contrôles en direct, versions) | #105-#119 | Activités → Assolement |
| Semences (fiche, catalogue GNIS, PMG, semis en grains/m², mélanges, utilisation) | #121-#128 | Stocks → Semences |
| Itinéraires techniques de la ferme, interventions prévues, temps de travaux (BCMA, OSRM), besoins en intrants | #136-#142 | Activités → Itinéraires, onglets de l'assolement |
| Module économique : prix datés, références Lexicon et marchés, marges prévisionnelles, comparaison au réalisé N-1, prix des intrants | #144-#150 | Économique, onglet Économie de l'assolement |

But : qu'un agriculteur ou un conseiller qui lit fourmy.org voie ces fonctions, avec leur statut réel, leurs captures et leur place face aux autres logiciels.

## 2. Exigences fonctionnelles

### Page Fonctionnalités (`features.yaml`)

- **FR-SITE-M1** : une entrée par fonction nouvelle, rangée dans le module de l'application où elle se trouve, avec le statut, la version d'arrivée (`since`) et la capture quand elle existe. Proposition :

  | id | module | titre (proposé) | statut |
  |---|---|---|---|
  | `assolement` | activites | Assolement prévisionnel sur la carte | en-test |
  | `itk-ferme` | activites | Itinéraires techniques de la ferme, tirés de l'historique | en-test |
  | `interventions-prevues` | interventions | Interventions prévues créées depuis l'assolement | en-test |
  | `temps-travaux` | activites | Temps de travaux et pointes de la campagne | en-test |
  | `besoins-intrants` | stocks | Besoins en intrants comparés aux stocks | en-test |
  | `semences` | stocks | Semences : catalogue officiel, PMG, semis en grains/m² | disponible ou en-test (Q1) |
  | `marges` | economie (nouveau module) | Marges prévisionnelles par activité | en-test |
  | `prix-references` | economie | Prix de la ferme et prix de référence | en-test |
  | `controle-hve` | reglementaire | Contrôle HVE | en-test |
  | `controle-ab` | reglementaire | Contrôle Agriculture biologique | en-test |
  | `imports` | interoperabilite | Import DAPLOS, Geofolia et TéléPAC | en-test |
  | `assistant` | ferme | Assistant de premier démarrage | en-test |

- **FR-SITE-M2** : nouveau module « Prévisionnel et économie » (ou « Économique », nom du menu de l'application), placé dans l'ordre du menu.
- **FR-SITE-M3** : l'entrée `itineraires` existante (frise TIKA du réalisé) reste. Son texte renvoie aux ITK de la ferme pour ne pas confondre les deux.
- **FR-SITE-M4** : les textes décrivent ce que l'agriculteur obtient, sans nom de testeur ni de ferme (règle d'anonymat du dépôt), et disent les limites. Par exemple : plan de fumure en Nouvelle-Aquitaine seulement ; marges jusqu'à la marge directe (décision A19).

### Comparatif (`comparatif.yaml`, `comparatif.astro`)

- **FR-SITE-C1** : cases de Fourmy mises à jour :
  - PAC : « import du dossier TéléPAC ; pas d'export » ;
  - Documents de certification : « contrôles HVE et AB, registre AB, liasse HVE ; grille officielle à venir ».
- **FR-SITE-C2** : nouveau groupe « Prévisionnel et économie », avec ces critères :
  - assolement prévisionnel ;
  - contrôles réglementaires sur l'assolement (BCAE 7, délais de retour, AB et HVE) ;
  - itinéraires techniques et interventions prévues ;
  - temps de travaux ;
  - besoins en intrants ;
  - marges prévisionnelles ;
  - comparaison au réalisé.
- **FR-SITE-C3** : nouveaux critères dans « Matériels, stocks et échanges » :
  - reprise depuis d'autres logiciels (DAPLOS, Geofolia, Ekylibre) ;
  - semences (catalogue officiel, PMG).
- **FR-SITE-C4** : chaque case de MesParcelles, Smag Farmer et Geofolia sur un critère nouveau renvoie à la page de l'éditeur lue, et la date du comparatif avance. Si rien n'est trouvé chez l'éditeur, la case vaut `nt`, qui ne prouve pas une absence.
- **FR-SITE-C5** : encadrés à mettre à jour.
  - « Ce qui distingue Fourmy », points à ajouter :
    - les contrôles réglementaires en direct pendant qu'on prépare l'assolement ;
    - les itinéraires tirés de l'historique de la ferme ;
    - les temps de travaux avec les vrais trajets routiers ;
    - les marges avec des prix de référence publics.
  - « Ce que Fourmy ne fait pas encore » :
    - retirer « Pas de dossier de certification HVE » et le remplacer par la grille officielle à venir ;
    - ajouter « pas de charges indirectes ni de coût complet ».

### Nouveautés (`nouveautes.yaml`)

- **FR-SITE-N1** : un titre par jour de livraison. Proposition :
  - 19/11 : « Imports DAPLOS, Geofolia et TéléPAC, assistant de démarrage » ;
  - 20/11 : « Contrôles HVE et bio, assolement prévisionnel, semences » ;
  - 21/11 : « Itinéraires techniques, temps de travaux et marges » ;
  - 22/11 : « Prix de référence des intrants ».
- **FR-SITE-N2** : la construction refuse les termes de la liste noire. Les commits qui citent un testeur (recette) doivent avoir une ligne `Public:` ou une entrée dans `public-overrides.json`. Il faut le vérifier à la construction.

### Captures

- **FR-SITE-K1** : nouvelles captures, sur la ferme de grandes cultures de l'exploitant testeur (accord écrit pour des captures publiques), ajoutées à `apps/web/e2e/captures-accueil.spec.ts` ou à une spec voisine :
  - `assolement` : carte 2027 avec les contrôles ;
  - `itk` : éditeur ou frise de l'ITK maïs ;
  - `temps-travaux` : heures par mois et pointes ;
  - `marges` : onglet Économie ;
  - `controle-hve` : tableau de bord ;
  - `semences` : liste ou fiche ;
  - `imports` : page Imports ou assistant.
- **FR-SITE-K2** : données de capture préparées sur la base de développement, jamais sur dev.fourmy.org. Sont concernés : le brouillon 2027 affecté avec les ITK, et les prix nécessaires aux marges (Q3).
### Page d'accueil et README

- **FR-SITE-A1** : les encadrés de la page d'accueil (`index.astro`) citent les nouveaux chantiers : assolement prévisionnel, ITK et temps de travaux, marges, contrôles HVE et AB, imports. Au moins une nouvelle capture y figure (assolement).
- **FR-SITE-A2** : l'aperçu du produit dans le README (#79) liste les mêmes fonctions et renvoie aux guides (`docs/assolement.md`, `docs/economie.md`, `docs/semences.md`, `docs/controles-hve-ab.md`, `docs/imports.md`).

- **FR-SITE-K3** : sur les captures, ni nom de compte ni photo (règle de `snap`). Pas de nom de la GAEC.

## 3. Exigences non fonctionnelles

- **NFR-1** : le site se construit sans erreur (Astro, captures WebP, liste noire du changelog). La CI passe.
- **NFR-2** : chaque affirmation sur un concurrent est sourcée et datée. Un « non » n'est écrit que si l'éditeur le dit.
- **NFR-3** : les statuts suivent la décision D1 : tout est « disponible ». Les limites connues sont écrites dans le texte de chaque fonction, pas dans son statut.
- **NFR-4** : la page reste lisible sur téléphone. Le comparatif garde le défilement horizontal du tableau.

## 4. Critères d'acceptation

- Toute fonction des sept chantiers apparaît sur la page Fonctionnalités, dans le bon module, avec son statut. Au moins 5 d'entre elles ont une capture.
- Le comparatif a son groupe « Prévisionnel et économie ». Chaque case concurrente est sourcée et la nouvelle date est affichée.
- La page Nouveautés titre les livraisons du 19 au 22/11.
- `pnpm --filter @fourmy/site build` passe ; les pages se relisent dans le navigateur, à la largeur d'un ordinateur et d'un téléphone.

## 5. Questions ouvertes

1. **Statuts** : tout en « en test » jusqu'à la recette avec les exploitants, ou les semences en « disponible » (recette locale faite, SE8) ?
2. **Module** : un module « Prévisionnel et économie » qui regroupe assolement, ITK, temps de travaux et marges ? Ou l'ordre exact du menu de l'application (assolement et ITK sous Activités, module Économique à part) ?
3. **Captures économiques** : l'onglet Économie de la ferme de l'exploitant testeur montre des prix et des marges. Trois options :
   - (a) prix de référence publics seulement (Lexicon, MATIF), repris par « Reprendre » ;
   - (b) pas de capture des marges ;
   - (c) ses vrais prix, avec son accord en plus.
4. **Comparatif** : relire les pages des trois éditeurs pour les critères nouveaux seulement, ou tout le tableau, avec une nouvelle date pour tout ?
5. **Périmètre** : la page d'accueil (encadrés et captures) et l'aperçu du README (#79) sont-ils aussi à mettre à jour, ou seulement Fonctionnalités, Comparatif et Nouveautés ?

## 6. Décisions du 22/11/2026

- **D1 (Q1)** : toutes les nouvelles fonctions sont « disponible ». Les statuts proposés au §2 passent tous à `disponible`.
- **D2 (Q2)** : rangement dans l'ordre du menu de l'application :
  - assolement, ITK et temps de travaux sous Activités ;
  - interventions prévues sous Interventions ;
  - semences et besoins en intrants sous Stocks ;
  - nouveau module « Économique » pour les prix et les marges ;
  - contrôles HVE et AB sous Réglementaire ;
  - imports sous Interopérabilité ;
  - assistant sous Ma ferme.
- **D3 (Q3)** : les captures des marges ne montrent que des prix publics (Lexicon, MATIF), repris par « Reprendre » sur la base de développement. Aucun prix propre à l'exploitant testeur n'apparaît.
- **D4 (Q4, Q5)** : le périmètre couvre Fonctionnalités, Comparatif, Nouveautés, l'accueil et le README. Pour le comparatif, on relit les pages des trois éditeurs sur les critères nouveaux, et la date passe au jour de cette relecture. Les autres cases gardent leur source du 18/11.
