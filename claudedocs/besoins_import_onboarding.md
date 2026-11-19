# Imports DAPLOS, Geofolia, TelePAC et assistant de premier démarrage — besoins

*Brainstorm du 19/11/2026. Nouveau testeur : un GAEC pilote de Loire-Atlantique
(grandes cultures, fourrages, volailles), dit « le GAEC pilote ». Exigences seulement : la conception viendra avec
`/sc:design`, le plan avec `/sc:workflow`.*

## 1. Contexte

Jusqu'ici, une ferme Fourmy ne naît que d'une **reprise Ekylibre**
(`packages/migrator-ekylibre`, `POST /imports/ekylibre`). Le GAEC pilote n'a jamais
utilisé Ekylibre : ses données viennent de **Geofolia** (Isagri), transmises
par son organisme de conseil, et de sa
déclaration **TelePAC**. Il faut donc :

1. trois imports nouveaux, réutilisables par tout agriculteur ;
2. un **assistant de premier démarrage** qui crée la ferme, importe
   l'historique et fait le paramétrage initial.

### 1.1 Les fichiers du GAEC pilote

Dossier local hors dépôt (`ressources_fourmy/`, données personnelles).

| Fichier | Format | Contenu constaté |
|---|---|---|
| `<SIRET>_<horodatage>.dap` | EDI DAPLOS, texte à largeur fixe, Windows-1252, 536 Ko | Émetteur Geofolia, destinataire l'organisme de conseil. Campagne **2026** seule : 63 parcelles (`DP`) avec leurs contours (`SC`), 421 interventions × parcelle (`PV`), 425 intrants (`VI`), 71 récoltes (`VR`), 126 historiques de cultures (`PH`) |
| `<organisme>_Parcelles et Interventions complet (ZIP)_<horodatage>.zip` | Geofolia JSON (`Field.Json`, `Action.Json`, `IdentificationCodes.json`), Lambert 93, 140 Ko | **63 parcelles** de la récolte 2026 (298,2 ha) : contour, culture, variété, semis, récolte, sol, rendement objectif et réalisé, îlot, cultures N-1 à N-5, conseils P/K, surfaces épandables. **384 actions** (336 réalisées, 48 « plan de fumure ») du 27/05/2025 au 02/10/2026. **120 produits** (phytos avec n° AMM, semences avec code GNIS, engrais avec composition). 1 salarié, 15 produits récoltés |
| `Dossier-PAC-2026_dossier_<PACAGE>_<horodatage>.xml` | TelePAC XML, 520 Ko | Demandeur (SIRET, PACAGE, raison sociale, courriel). **19 îlots, 41 parcelles PAC** (code culture, surface admissible). **340 SNA** (haies, arbres, mares… : V1 143, V4 136, V2 48…) et **16 ZDH**. Effectif animal : 13 200 volailles (AV). Demandes d'aides (écorégime, ICHN, légumineuses, assurance récolte) |

Opérations de la campagne 2026 (Geofolia) :

| Catégorie Geofolia | Opération | Nombre |
|---|---|---|
| Fertilisation | Fertilisation minérale | 113 |
| Autre | Irrigation | 77 |
| Traitement | Traitement phytosanitaire | 62 |
| Récolte | Récolte | 58 |
| Semis/Plantation | Semis direct · Semis de précision | 43 · 5 |
| Fertilisation | Épandage fumier · Épandage lisier | 15 · 9 |
| Autre | Broyage des résidus | 2 |

Cultures 2026 : Mélange CINE (20 parcelles), Bande enherbée (9), Maïs
fourrage, Prairie temporaire, Prairie permanente (7 chacune), orges, blé,
féverole, lin, épinard, carotte, luzerne, avoine noire.

**Constat clé** : DAPLOS et Geofolia décrivent **la même campagne, les mêmes
parcelles et les mêmes interventions**. Le GUID commun est celui du couple
intervention × parcelle (`RecognitionId` Geofolia = `intervention_guid`
DAPLOS) : 421 couples sur 511, les 90 autres étant les apports planifiés,
absents du DAPLOS (voir `conception_import_onboarding.md` §2). L'historique
réellement disponible se limite à 2026, plus le nom des cultures N-1 à N-5.

## 2. Décisions prises (19/11/2026)

| # | Sujet | Décision |
|---|---|---|
| D1 | DAPLOS et Geofolia | **Deux imports indépendants, dédoublonnés** par l'identifiant d'origine : chaque format s'importe seul ; le second complète le premier sans doublon |
| D2 | Parcellaire de référence | **Parcelles culturales Geofolia/DAPLOS = parcelles Fourmy.** TelePAC y rattache îlots, n° et codes cultures PAC par recouvrement. Sans Geofolia ni DAPLOS, TelePAC crée les parcelles |
| D3 | Entrée dans l'assistant | **L'administrateur crée le compte** (inscription toujours fermée) ; à la première connexion d'un compte sans ferme, l'assistant crée la ferme puis enchaîne imports et paramétrage |
| D4 | Données nouvelles retenues | Haies et arbres déclarés (SNA, ZDH) · cultures N-1 à N-5 · plan de fumure prévisionnel |
| D5 | Hors périmètre | **Élevage** (13 200 volailles) : non importé dans ce lot (l'élevage N1 n'est pas réalisé) ; l'effectif est seulement affiché dans le rapport d'import |

## 3. Objectifs

- **O1** Un agriculteur venant de Geofolia, d'un logiciel exportant DAPLOS,
  ou n'ayant que sa déclaration PAC, retrouve dans Fourmy son parcellaire,
  ses activités et sa campagne d'interventions **sans ressaisie**.
- **O2** Les données importées respectent le modèle Fourmy : activités →
  productions (parcelle × campagne), six formes d'intervention, catalogue
  de procédures, articles rapprochés des référentiels (E-Phy, Lexicon).
  Elles alimentent donc le registre phyto, le cahier de fertilisation,
  le bilan hydrique et la carte comme une saisie.
- **O3** Un nouvel utilisateur passe d'un compte vide à une ferme
  opérationnelle en une session guidée, en étant sûr de ce qui a été
  importé et de ce qui ne l'a pas été.
- **O4** Validé avec les fichiers du GAEC pilote (critères chiffrés au §9).

## 4. Exigences communes aux imports (FR-IMP)

- **FR-IMP-1 (M)** Un import se fait en deux temps : **analyse** (lecture du
  fichier, aucun écrit en base) puis **validation** par le responsable. L'analyse
  produit un aperçu : parcelles sur la carte, activités proposées, interventions
  par procédure, produits rapprochés ou non, anomalies.
- **FR-IMP-2 (M)** **Idempotence et provenance.** Toute entité importée garde
  sa source (`daplos`, `geofolia`, `telepac`) et son identifiant d'origine. Un
  même fichier réimporté ne crée rien en double ; un import d'une autre source
  portant les mêmes identifiants **complète** l'entité existante (D1).
- **FR-IMP-3 (M)** **Non destructif.** Un import n'efface jamais une donnée
  saisie dans Fourmy. En cas de conflit sur une entité déjà modifiée dans
  Fourmy, la valeur de Fourmy est gardée et le conflit figure au rapport.
- **FR-IMP-4 (M)** **Rapprochement des référentiels**, proposé puis
  confirmable :
  - phytos et adjuvants par **n° AMM** → produit E-Phy (Lexicon) ;
  - semences par **code GNIS** / espèce → variété ;
  - cultures (code espèce DAPLOS/Geofolia, code culture PAC) → production de
    référence Lexicon (`lexicon_cap_codes` pour la PAC) → activité ;
  - engrais et amendements → article de la ferme avec sa composition
    (N, P₂O₅, K₂O, MgO, SO₃, oligo-éléments, MS, C/N) ;
  - salariés → personnes de l'équipe.
  Ce qui reste non rapproché est créé comme article ou activité de la ferme et
  signalé, jamais ignoré en silence.
- **FR-IMP-5 (M)** **Rapport d'import** consultable ensuite : comptes créés,
  complétés, ignorés (avec la raison), conflits, contrôles réglementaires en
  défaut (dose, usage, calendrier nitrates) sur les interventions importées.
- **FR-IMP-6 (M)** Les interventions importées passent par les **mêmes règles
  de forme** que la saisie (`validateIntervention`). Une règle qu'un historique
  ne peut pas satisfaire (voir FR-EVO-5) est relâchée **pour l'origine import
  seulement** et signalée.
- **FR-IMP-7 (S)** Un import **se rejoue** sans l'assistant, depuis « Ma
  ferme » → Imports, pour une campagne suivante (le GAEC pilote exportera 2027).
- **FR-IMP-8 (S)** Annuler un import validé : retire ce qu'il a créé et qui n'a
  pas été modifié depuis.
- **FR-IMP-9 (M)** Réservé au **responsable** de la ferme (comme l'import
  Ekylibre).

## 5. Import EDI DAPLOS (FR-DAP)

- **FR-DAP-1 (M)** Lecture avec le paquet
  [`@osfarm/agroedei-edifact-daplos-reader`](https://github.com/osfarm/agroedei-edifact-daplos-reader)
  (MIT, npm, v1.0.12) : décodage Windows-1252, coordonnées en WGS 84, codes
  AEE complétés de leurs libellés. Les manques constatés du paquet sont
  corrigés dans le paquet lui-même, pas contournés dans Fourmy : fork
  `ekylibre/agroedei-edifact-daplos-reader` (2.0.0, 19/11/2026), puis
  proposition à OSFarm.
- **FR-DAP-2 (M)** Contrôle de l'en-tête : SIRET de l'exploitation (`DATF`)
  égal au SIRET de la ferme, sinon import refusé (ou confirmation explicite).
- **FR-DAP-3 (M)** Parcelles (`DP` + contours `SC`) → parcelles et versions
  de la campagne ; production (`PS`) → activité ; historique (`PH`) →
  productions des campagnes antérieures (FR-EVO-3).
- **FR-DAP-4 (M)** Interventions (`PV`) avec intrants (`VI`), récoltes (`VR`)
  et surfaces → interventions Fourmy selon la correspondance du §8 ; une
  intervention DAPLOS répétée sur plusieurs parcelles avec le même identifiant
  devient **une** intervention à plusieurs parcelles.
- **FR-DAP-5 (S)** Fichiers DAPLOS d'autres émetteurs (Mes Parcelles, Smag,
  coopératives) : même import ; un jeu d'essai public du paquet OSFarm sert
  aux tests.

## 6. Import Geofolia JSON (FR-GEO)

- **FR-GEO-1 (M)** Entrée : le **ZIP** exporté par Geofolia
  (« Parcelles et Interventions complet ») ; `Field.Json` et `Action.Json`
  exigés, `IdentificationCodes.json` donne le SIRET (contrôle comme FR-DAP-2).
  Encodage UTF-8 avec BOM ; géométries en Lambert 93 reprojetées.
- **FR-GEO-2 (M)** Parcelles (`Fields`) : contour, nom, code, commune, n°
  d'îlot, culture (`RNCropCode`, espèce), variété, dates de semis et de
  récolte, **type de sol**, **rendement objectif et réalisé**, destination
  (pâturée, fauchée…), résidus. Parcelles principales et zones éventuelles
  (`ParentId1`, `PlotKind`).
- **FR-GEO-3 (M)** Cultures **N-1 à N-5** → productions passées de la
  parcelle (nom de culture rapproché d'une production de référence), sans
  intervention (FR-EVO-3).
- **FR-GEO-4 (M)** Actions → interventions (§8) : dates, parcelles et
  **surface travaillée**, intrants et quantités, récoltes et quantités,
  météo saisie (température, vent, hygrométrie), motif, volume de bouillie,
  enfouissement, auteur de la dernière modification.
- **FR-GEO-5 (M)** Statut : « Réalisée » → intervention réalisée ;
  « Plan de fumure » → **intervention planifiée** de fertilisation, et
  reprise dans le **plan prévisionnel de fumure** de la campagne (FR-EVO-6).
- **FR-GEO-6 (S)** Conseils de fumure P, K, Mg… et surfaces épandables
  (SNE, distances aux cours d'eau) conservés sur la parcelle pour le module
  fertilisation.
- **FR-GEO-7 (C)** Analyse de sol référencée (`SoilAnalysisId`) : reprise si
  l'export la contient (ce n'est pas le cas au GAEC pilote).

## 7. Import TelePAC XML (FR-PAC)

Réalise FR-PARC-3 (import) des exigences v1 ; l'export reste à faire.

- **FR-PAC-1 (M)** Demandeur → **fiche de la ferme** : raison sociale,
  SIRET, n° PACAGE, adresse, courriel (proposés, l'utilisateur confirme).
- **FR-PAC-2 (M)** Îlots et parcelles PAC de la campagne → références PAC
  (`parcel_references`, `kind = cap`) : n° d'îlot, n° de parcelle, code
  culture, surface admissible, contour. Rattachement aux parcelles Fourmy
  **par recouvrement** (D2), avec la surface commune.
- **FR-PAC-3 (M)** Sans parcelles Geofolia/DAPLOS : chaque parcelle PAC
  crée une parcelle Fourmy, et son code culture une production via
  `lexicon_cap_codes`.
- **FR-PAC-4 (M)** **SNA et ZDH** (haies, alignements d'arbres, arbres
  isolés, mares, bosquets ; densification des haies) → **éléments du paysage
  déclarés** de la ferme (FR-EVO-4), visibles sur la carte et dans le plan 3D,
  avec catégorie, largeur et parcelles touchées.
- **FR-PAC-5 (S)** Écart entre surface PAC et surface culturale signalé par
  parcelle au rapport.
- **FR-PAC-6 (C)** Effectifs animaux et demandes d'aides : lus et affichés au
  rapport, non importés (D5).

## 8. Correspondance avec le modèle Fourmy

### 8.1 Interventions

| Geofolia (DAPLOS équivalent) | Procédure Fourmy | Forme |
|---|---|---|
| Fertilisation minérale | `mineral_fertilizing` | `fertilization` |
| Épandage fumier, Épandage lisier | `organic_fertilizing` | `fertilization` |
| Traitement phytosanitaire | `spraying` | `treatment` |
| Semis direct, Semis de précision | `sowing` (technique conservée, FR-EVO-7) | `sowing` |
| Récolte | `harvest` (`grains_harvest` pour les grains) | `harvest` |
| Irrigation (intrant « Eau », mm ou m³) | `watering` (bloc irrigation, bilan hydrique) | `work` |
| Broyage des résidus | `crop_residues_grinding` | `work` |
| Toute autre opération | procédure du code AEE si connue, sinon `work` avec le libellé d'origine | `work` |

La table de correspondance fait partie des exigences de test : chaque code
d'opération AEE rencontré doit avoir une cible déclarée.

### 8.2 Autres entités

| Source | Fourmy |
|---|---|
| Culture de la parcelle (espèce, variété) | activité (famille `plant_farming`, production de référence, variété) + production parcelle × campagne |
| Produits (phyto, adjuvant, semence, engrais, eau) | articles de la ferme, rapprochés (FR-IMP-4) |
| Salariés (`Employees`) ; auteur des modifications | personnes de l'équipe (sans compte) |
| Récolte (quantité, unité q/t) | sortie de l'intervention, rendement |
| Îlot, parcelle PAC | référence PAC de la parcelle |
| SNA, ZDH | élément du paysage déclaré |

## 9. Évolutions du modèle proposées (FR-EVO)

À trancher en conception ; ce sont des besoins, pas des schémas.

- **FR-EVO-1 (M)** **Création d'une ferme hors reprise Ekylibre** (siège,
  campagne courante, préférences par défaut), aujourd'hui inexistante.
- **FR-EVO-2 (M)** **Provenance générique** : pour toute entité, source et
  identifiant d'origine, interrogeables (dédoublonnage D1, annulation
  FR-IMP-8). `import_runs` passe de « Ekylibre » à toutes les sources, avec
  aperçu et rapport.
- **FR-EVO-3 (M)** **Productions historiques** : une production d'une
  campagne passée sans intervention ni contour propre (la parcelle de 2026
  sert de support), marquée « déclarée ». Sert au précédent cultural de la
  fertilisation et aux rotations.
- **FR-EVO-4 (M)** **Éléments du paysage déclarés** par la ferme (haies,
  arbres, mares, ZDH), distincts de la couche BD TOPO de l'IGN mais
  affichés de la même façon ; utiles aux ZNT et à la conditionnalité.
- **FR-EVO-5 (M)** **Destination de récolte facultative pour l'historique
  importé** : Geofolia n'en donne pas, la règle `harvest` l'exige. Proposition :
  destination « non renseignée (import) », signalée.
- **FR-EVO-6 (S)** Plan de fumure prévisionnel alimenté par des
  interventions planifiées importées (lien avec `docs/fertilisation.md`).
- **FR-EVO-7 (S)** Technique de semis (direct, précision, à la volée)
  portée par l'intervention, plutôt que de nouvelles procédures.
- **FR-EVO-8 (S)** Type de sol, rendement objectif et conseils P/K portés
  par la parcelle ou la production.
- **FR-EVO-9 (S)** Compte **sans ferme** (créé par l'administrateur) qui
  ouvre l'assistant au lieu d'une erreur.

## 10. Assistant de premier démarrage (FR-ONB)

- **FR-ONB-1 (M)** **Entrée** : l'administrateur crée le compte (D3) ; à la
  première connexion d'un compte sans ferme, l'assistant s'ouvre. Le
  responsable d'une ferme existante peut aussi le relancer pour l'étape
  d'import.
- **FR-ONB-2 (M)** **Étapes**, dans cet ordre, chacune passable sauf la
  première :
  1. **Ma ferme** : SIRET, n° PACAGE, raison sociale, siège (adresse ou
     point sur la carte). Pré-rempli par TelePAC si le fichier est déposé
     d'abord.
  2. **Mes fichiers** : dépôt de un à plusieurs fichiers (`.dap`, `.zip`
     Geofolia, `.xml` TelePAC), **format reconnu automatiquement**, ordre
     d'import décidé par Fourmy (TelePAC → Geofolia → DAPLOS).
  3. **Aperçu** : parcelles sur la carte IGN, surface totale, activités
     proposées, interventions par procédure et par campagne, éléments du
     paysage, anomalies (FR-IMP-1).
  4. **Rapprochements** : cultures → activités, produits non reconnus,
     salariés → personnes ; tout est pré-rempli, l'utilisateur corrige.
  5. **Paramétrage** : campagne courante, couleurs des activités, unités,
     préférences (comme dans « Ma ferme »), équipe à inviter, intégrations
     facultatives (Traccar, stations météo, Copernicus).
  6. **Import** : exécution avec progression, puis rapport (FR-IMP-5).
  7. **Fin** : arrivée sur le tableau de bord de la ferme, avec les liens
     vers le registre phyto, le cahier de fertilisation et la carte.
- **FR-ONB-3 (M)** **Reprise** : l'avancement est enregistré ; quitter et
  revenir reprend à la même étape, fichiers déjà analysés compris.
- **FR-ONB-4 (M)** Aucune donnée n'est écrite avant l'étape 6 (hors fiche
  de la ferme, étape 1).
- **FR-ONB-5 (S)** Aide en contexte : où trouver chaque export (Geofolia :
  menu d'export « Parcelles et Interventions complet » ; TelePAC : dossier
  PAC → export XML ; DAPLOS : demande à l'organisme de conseil).
- **FR-ONB-6 (S)** Utilisable sur tablette (largeur 768 px), au même niveau
  que le reste de l'application web.
- **FR-ONB-7 (C)** Sans aucun fichier : création des parcelles depuis la
  carte (PAC anonyme, cadastre), comme aujourd'hui.

## 11. User stories et critères d'acceptation

**US-IMP-1** — En tant que responsable venant de Geofolia, je dépose mon ZIP
et je retrouve ma campagne.
- Avec le ZIP du GAEC pilote : **63 parcelles**, **298,2 ha** (±0,1 ha), une
  activité par culture rapprochée (14 cultures), **384 interventions**
  dont 336 réalisées et 48 planifiées, chacune sur ses parcelles.
- Les 51 produits à n° AMM (phytos et adjuvants) sont rapprochés d'E-Phy et le
  registre phyto 2026 de la ferme liste les **62 traitements**.
- Les 77 irrigations alimentent le bilan hydrique des parcelles concernées.

**US-IMP-2** — Je dépose ensuite mon fichier DAPLOS : rien n'est doublé.
- Après Geofolia puis DAPLOS (et dans l'ordre inverse) : toujours 63
  parcelles et le même nombre d'interventions ; le rapport indique
  « complétées » et non « créées ».

**US-IMP-3** — Je dépose ma déclaration PAC.
- La fiche de la ferme propose le SIRET, le n° PACAGE et la raison sociale
  du dossier PAC.
- Chaque parcelle Fourmy porte son îlot et sa parcelle PAC 2026 (19 îlots,
  41 parcelles PAC rattachées) ; les écarts de surface sont listés.
- **340 SNA et 16 ZDH** apparaissent sur la carte comme éléments déclarés.
- Le rapport mentionne 13 200 volailles, non importées.

**US-IMP-4** — Je réimporte le même fichier : rien ne change, le rapport
l'indique.

**US-ONB-1** — En tant que nouvel utilisateur (compte créé par
l'administrateur), je me connecte et l'assistant me guide jusqu'au tableau
de bord de ma ferme.
- Recette de bout en bout avec les trois fichiers du GAEC pilote, sur
  dev.fourmy.org, sans intervention en base.
- Fermer le navigateur à l'étape 4 puis revenir reprend à l'étape 4.

## 12. Exigences non fonctionnelles

- **NFR-1** Analyse de chacun des fichiers du GAEC pilote en moins de 30 s,
  import complet des trois en moins de 2 min.
- **NFR-2** Un import validé est **atomique** (tout ou rien) par fichier.
- **NFR-3** Sécurité des fichiers déposés : taille maximale, ZIP contrôlé
  (bombe de décompression, chemins), XML sans entités externes, aucun code
  exécuté depuis le fichier.
- **NFR-4** Données personnelles : fichiers bruts conservés au plus le temps
  de l'assistant (ou durée à fixer), accessibles au seul responsable, isolés
  par ferme (RLS).
- **NFR-5** Tests automatisés sur des **jeux anonymisés** dérivés des
  fichiers du GAEC pilote (comme les fixtures Ekylibre) ; les fichiers réels ne
  vont pas dans le dépôt.
- **NFR-6** Libellés et messages en français, conformes à la charte Lyvre.

## 13. Hors périmètre

- Élevage (lots, effectifs) : D5.
- Export TelePAC et déclaration PAC (FR-REG-2).
- Export DAPLOS vers les coopératives ou conseillers.
- Inscription libre sur fourmy.org.

## 14. Questions ouvertes

1. **Campagnes antérieures** : L'exploitant peut-il exporter 2024 et 2025 depuis
   Geofolia ? L'historique d'interventions s'arrête aujourd'hui à 2026.
2. ~~**« Mélange CINE »** (20 parcelles)~~ : ce sont les 20 cultures DAPLOS
   `ZDA` (moutarde blanche), donc un **couvert d'interculture**
   (`conception_import_onboarding.md` §5.8). Reste à le confirmer avec
   l'exploitant (mélange multi-espèces à dominante moutarde ?).
3. **Destination des récoltes** (FR-EVO-5) : valeur « non renseignée » ou
   lieu par défaut (silo, stockage de la ferme) ?
4. **Personnes du GAEC** : seul un salarié figure dans Geofolia ; les
   associés (dont l'auteur des saisies) sont-ils à créer comme personnes ?
5. **Plan de fumure** : les 48 actions planifiées remplacent-elles un PPF
   calculé par Fourmy, ou sont-elles affichées à côté pour comparaison ?
6. **Dictionnaires Geofolia** : `CategoryEnum` / `ProductTypeEnum` des
   produits ne sont pas documentés ; table à établir sur les données ou à
   demander à Isagri.
7. **Paquet DAPLOS** : dépendance npm telle quelle ou contribution
   préalable (types, tests) chez OSFarm ?
8. **Accord de l'exploitant** pour des jeux de test anonymisés dans le dépôt et,
   plus tard, des captures sur fourmy.org (comme pour Pierre).
9. **Durée de conservation** des fichiers déposés (NFR-4).

## 15. Suite

`/sc:design` sur ce document (provenance, productions historiques,
éléments du paysage, machine d'état de l'assistant, découpage en lots),
puis `/sc:workflow`.
