# Imports de fichiers : DAPLOS, Geofolia, TelePAC

Importer l'historique d'une ferme qui ne vient pas d'Ekylibre : EDI DAPLOS
(`.dap`, `.edi`), export ZIP « Parcelles et Interventions complet » de
Geofolia, dossier PAC XML de TelePAC. Besoins :
[`claudedocs/besoins_import_onboarding.md`](../claudedocs/besoins_import_onboarding.md) ;
conception : [`claudedocs/conception_import_onboarding.md`](../claudedocs/conception_import_onboarding.md) ;
plan : [`claudedocs/workflow_import_onboarding.md`](../claudedocs/workflow_import_onboarding.md).

## État

| Lot | Contenu | État |
|---|---|---|
| IM1 Socle | dépôt, reconnaissance, suivi, décisions, abandon, purge ; référentiel AgroEDI | ✅ |
| IM2 Geofolia | lecture, rapprochement, écriture | ✅ |
| IM3 TelePAC | îlots, parcelles PAC, haies et arbres déclarés | ✅ |
| IM4 DAPLOS | lecteur `ekylibre/agroedei-edifact-daplos-reader` 2.0.0, dédoublonnage avec Geofolia | ✅ |
| IM5 | historique N-1…N-5, apports prévus, annulation, page Imports | ✅ |
| IM6 | assistant de premier démarrage | ✅ |
| IM7 | recette avec l'exploitant testeur (fichiers réels, assistant) | ⏳ à planifier (point 121 de `claudedocs/points_ouverts.md`) |

Les trois formats s'importent de bout en bout : export Geofolia (IM2),
dossier PAC TelePAC (IM3), EDI DAPLOS (IM4).

## Parcours (API)

Toutes les routes sont sous `/api/v1/farms/:farmId`. Dépôt, décisions et
abandon : responsable seulement ; le suivi se lit par tous les membres.

| Route | Effet |
|---|---|
| `POST /imports/files` (multipart, champ `file`, 50 Mo au plus) | Reconnaît le format, lit le fichier, le stocke (une fois par contenu et par ferme), crée un import `analyzed` avec son aperçu : **201**. Le même contenu redéposé reprend l'analyse en attente : **200**. Format inconnu, fichier vide ou illisible : **422** ; trop gros : **413** |
| `GET /imports` | Imports de la ferme (fichiers et reprises Ekylibre), du plus récent au plus ancien |
| `GET /imports/:id` | Un import : état, fichier (nom, taille, sha256, expiration ; jamais le contenu), aperçu, décisions, rapport |
| `PUT /imports/:id/decisions` | Décisions de l'utilisateur (remplacent les précédentes), aperçu recalculé depuis le fichier. Import qui n'est plus « analysé » : **409** |
| `POST /imports/:id/discard` | Abandon ; le fichier est supprimé s'il ne sert à aucun autre import |
| `POST /imports/:id/apply` | Écriture, **202** puis suivi par `GET /imports/:id` : rapprochement recalculé, une transaction pour le fichier, rapport (`report`). Avertissement bloquant, fichier expiré, autre import en cours : **409** |
| `POST /imports/:id/revert` | Annulation d'un import de fichier terminé (voir plus bas) : `{ run, revert }`, rapport d'annulation aussi dans `report.revert`. Import non terminé, reprise Ekylibre, déjà annulé : **409** |

États : `analyzed` → `running` → `completed` | `failed` ; `analyzed` →
`discarded` ; `completed` → `reverted` (IM5, en une transaction). La reprise
Ekylibre garde `running` → `completed` | `failed`.

Contrats : `packages/contracts/src/imports.ts` (`importRunView`,
`importPreview`, `importDecisions`).

## Geofolia (lot IM2)

Ce que devient l'export « Parcelles et Interventions complet » :

| Geofolia | Fourmy |
|---|---|
| Parcelle principale (`PlotKind` 1) | parcelle, version ouverte au premier jour du fichier ; reliée à une parcelle existante si leurs contours se recouvrent à 80 % (IoU) |
| Parcelle secondaire : couvert d'interculture (CINE, CIE, CIPAN, engrais vert ; usage « biomasse » sans récolte) | couvert de la parcelle (`cover_crops`, contrôles nitrates) : famille d'après les semences semées (radis + trèfle → mélange crucifères-légumineuses…), semis et destruction, exporté ou non, campagne de la culture qui suit. Ni activité ni production |
| Parcelle secondaire : dérobée (épinard, second maïs…) | production datée de la même parcelle que sa principale (`MainPlotId`) |
| Culture | production **datée** (semis → récolte) ; activité (une par libellé), production de référence Lexicon : code combiné AgroEDI (avec le jeu réservé), sinon code d'espèce filtré par saison et usage, sinon libellé ; production (`attrs` : variété, dates, rendements, sol, conseils, surfaces épandables) |
| Produit | article : phyto et adjuvant (n° AMM, rapproché d'E-Phy), semence (GNIS), fertilisant et amendement (composition `article_fertilizers`, origine `imported`) ; l'eau n'est pas un article |
| Produit récolté | article de récolte (t, q, t MS) |
| Salarié | personne |
| Action × parcelle (`RecognitionId`) | intervention : une action, scindée par doses ; une récolte par parcelle ; irrigation en mm ; « Plan de fumure » (`ZK3`) → planifiée |

Interventions importées : origine `import`, **sans mouvement de stock**,
périodes du jour entier à l'heure de Paris (`period_precision = day` :
« réalisée le 01/04/2026 (heures non connues) », hors temps de travaux),
récolte sans destination admise, contrôles phyto et nitrates passés comme à
la saisie (un feu rouge est enregistré et compté au rapport, sans bloquer).
Une intervention qu'une règle refuse est laissée de côté et rapportée.

Dédoublonnage (`import_links`) : parcelles par numéro de travail
(`plot.work_number`), cultures par campagne et numéro (`crop.parcel`),
activités par libellé (`crop.label`), articles et personnes par identifiant
Geofolia, interventions par couple (`agri.crop_zone`, le GUID commun avec
DAPLOS). Un réimport ne crée rien ; une entité déjà importée n'est jamais
réécrite.

Recette (export réel, 19/11/2026) : 41 parcelles, 43 productions datées,
20 couverts d'interculture, 13 activités, 133 articles, 414 interventions,
en 13 s ; 18 traitements en feu rouge (10 pour des produits retirés).

## TelePAC (lot IM3)

Ce que devient le dossier PAC exporté de TelePAC (XML « Echanges-producteur ») :

| TelePAC | Fourmy |
|---|---|
| Demandeur | fiche « Ma ferme » : SIRET, n° PACAGE, raison sociale, courriel, seulement s'ils sont vides |
| Parcelle PAC | reliée à la parcelle de la ferme qui la recouvre (IoU ≥ 0,8), sinon parcelle créée avec une production de la campagne (activité d'après le code culture, table `lexicon_cap_codes`) ; une parcelle qui a déjà une culture pour la campagne n'en reçoit pas d'autre |
| Îlot, parcelle PAC | références `cap_islet` et `cap` de chaque parcelle recouverte (5 % de la plus petite surface au moins), avec la surface commune, le code culture et la surface admissible |
| SNA, ZDH | éléments du paysage déclarés (`farm_landscape_features`) : couche « Éléments déclarés à la PAC » de la carte, `GET /landscape-features` ; une SNA créée dans la campagne, sans `numeroSna`, est gardée sous la référence `<campagne>-creation-<numeroSnacreationTas>` |
| Effectifs animaux | mentionnés au rapport, non importés |

Types de SNA (le code d'origine est gardé ; table **déduite** d'un dossier
réel 2026 d'après la géométrie et la largeur, les notices TelePAC décrivant
les types sans publier leurs codes) :

| Code | Élément |
|---|---|
| V1 | arbre isolé (point) |
| V2 | alignement d'arbres |
| V3 | bosquet |
| V4 | haie |
| V5 | bois |
| B2 | fossé non maçonné |
| B3 | mare |
| A2 | mur traditionnel en pierres |
| autre (A1…) | autre élément, signalé |

Écarts de surface de plus de 5 % entre la parcelle PAC et la parcelle
reliée : listés à l'aperçu. Surfaces TelePAC en ares.

Recette (fichiers réels, 19/11/2026) : après l'export Geofolia, les
41 parcelles PAC se relient aux 41 parcelles (aucune création, aucune
culture doublée) ; 41 références de parcelle et d'îlot ; 355 éléments du
paysage (135 haies, 143 arbres isolés, 48 alignements, 16 ZDH…) ; 7 écarts
de surface signalés.

## DAPLOS (lot IM4)

Lu par le lecteur d'OSFarm, dans le fork d'Ekylibre fixé par Git
(`github:ekylibre/agroedei-edifact-daplos-reader#8eaf6a6`, version 2.0.0 :
libellés lus dans la table AgroEDI de chaque champ, segment `DP` corrigé).
Avec une clé Lexicon, les libellés du jeu `agroedi` (`lexicon_agroedi_codes`)
lui sont passés et l'emportent sur les siens.

| DAPLOS | Fourmy |
|---|---|
| Exploitation (`DA` de nature `TF`) | SIRET, PACAGE, raison sociale (champs vides seulement) ; adresse au siège, s'il n'en a pas (siège créé s'il manque) |
| Culture (`DP`) et contour (`PS`/`SC`, Lambert 93) | parcelle (numéro de travail, comme Geofolia) et production datée ; activité nommée d'après l'espèce, le complément, la saison et l'usage (« Avoine noire d'hiver — grain ») |
| Culture qui recouvre une autre culture de la campagne | culture secondaire sur la même terre : couvert d'interculture (moutarde, navette, radis, phacélie, usage « biomasse ») ou dérobée |
| Précédents (`PH`) | historique N-1…N-5 (productions déclarées) |
| Intervention (`PV`) | couple intervention × parcelle, même GUID que Geofolia (`agri.crop_zone`) ; regroupé par jour, opération et statut, puis par doses |
| Intrant (`VI`, composition `IC`) | article par nom (sans identifiant dans DAPLOS) ; **dose par hectare du fichier** ; eau d'irrigation en dose (mm) |
| Récolte (`VR`) | quantité de la parcelle (t), rendement |

DAPLOS ne relie pas une culture secondaire à sa culture principale : deux
cultures d'une campagne dont l'une recouvre l'autre pour moitié au moins
(même îlot PAC ou îlot inconnu) occupent la même terre ; la culture
principale est celle qui n'est pas un couvert, puis celle de plus petit
numéro de travail. Vérifié sur un export réel comparé à Geofolia : 63
cultures sur 63 retrouvent la même terre, 20 couverts sur 20.

**Avec Geofolia** (US-IMP-2), dans les deux ordres, la ferme est la même à
l'arrivée (recette sur les fichiers réels, 19/11/2026 : 41 parcelles,
43 productions, 20 couverts, 511 couples) :

- Geofolia puis DAPLOS : rien de créé (421 couples déjà importés) ;
- DAPLOS puis Geofolia : Geofolia ajoute les 90 apports du plan de fumure
  (absents du DAPLOS) et les 51 couples que le DAPLOS donne sans intrant
  (semis sans semence, fertilisations sans fertilisant : laissés de côté à
  l'import du DAPLOS seul, motif au rapport) ;
- DAPLOS n'ayant pas d'identifiant d'action, des couples que Geofolia
  sépare (même jour, même opération, mêmes doses) y forment une seule
  intervention : 388 interventions contre 414 ;
- les activités gardent le nom du premier fichier importé.

## Historique, apports prévus, annulation (lot IM5)

**Historique N-1…N-5** (Geofolia `NMinus1Crop`…, DAPLOS `PH`) : une
production **déclarée** (`productions.declared`) par terre et par campagne
passée, campagnes créées au besoin, activité trouvée comme pour les cultures
de la campagne. Une parcelle qui a déjà une culture pour cette campagne n'en
reçoit pas ; un second fichier (DAPLOS après Geofolia) relie au lieu de
doubler (lien `crop.history`). Aucune intervention, aucune version de
parcelle antidatée. Lue par : la fiche parcelle (onglet Cultures, « historique
importé »), le précédent de la fertilisation (`previousOf` prend la première
forme connue de la parcelle quand aucune ne couvre la campagne passée), la
liste des activités d'une campagne passée. Ignorée par : la carte et le plan
3D, le modèle de culture, la télédétection, les temps de travail, les
itinéraires d'une activité, et (déjà) la culture contrôlée à une date
(`fourmy_production_at`). Recette sur les fichiers réels : 41 parcelles ×
5 campagnes, précédent 2026 trouvé pour les 41 parcelles.

**Apports prévus** (plan de fumure Geofolia, statut `ZK1`/`ZK3`) :
interventions planifiées, notées « Prévu dans Geofolia ». Le PPF de Fourmy
n'en est pas modifié.

**Annulation** (`POST /imports/:id/revert`) : ce que l'import a créé (liens
`created`) est supprimé, dans l'ordre inverse des dépendances
(interventions, éléments du paysage, couverts, cultures, parcelles,
activités, articles, personnes, campagnes), avec les références PAC posées
par l'import. Est **gardé et signalé** ce qui a été modifié dans Fourmy depuis
(journal d'audit, origine autre que l'import) ou que des données saisies
depuis utilisent (intervention réalisée avec mouvement de stock, culture qui
porte un plan de fumure, parcelle ciblée par une autre intervention, avec un
sol, une analyse, une seconde version…, article en stock ou employé…). Ce
qui était seulement relié n'est jamais touché, pas plus que l'identité de la
ferme ni l'adresse du siège. Les liens des entités gardées restent : un
réimport les retrouve.

**Page Imports** (`/f/:ferme/imports`, responsable) : dépôt d'un fichier,
aperçu (parcelles, cultures, campagnes passées, couverts, interventions par
procédure, activités, laissés de côté, avertissements, SIRET à confirmer),
import, rapport, annulation ; liste des imports de la ferme. Composants
`FileImport`, `ImportPreview`, `ImportReport` repris par l'assistant (IM6).

## Assistant de premier démarrage (lot IM6)

Pour un compte « à embarquer » (`create-user --onboarding`,
[`deploiement.md`](deploiement.md)) : après la connexion, `/farms` mène à
`/onboarding` s'il n'a aucune ferme, ou reprend l'assistant d'une ferme dont
la mise en route n'est pas finie (`farm_settings.onboarding`).

| Étape | Écran | Appels |
|---|---|---|
| 1 Ma ferme | nom, raison sociale, SIRET, PACAGE, adresse ; « Pré-remplir depuis un fichier » | `POST /me/onboarding/identity` (rien n'est gardé), `POST /me/farms` |
| 2 Mes fichiers | dépôt multiple, format reconnu, aide « où trouver cet export » | `POST /imports/files` |
| 3 Aperçu | aperçu de chaque fichier (`ImportPreview` sans ses boutons) | `GET /imports` |
| 4 Rapprochements | noms des activités, personnes à reprendre, articles reconnus ou créés | `PUT /imports/:id/decisions` |
| 5 Paramétrage | liens vers Ma ferme, Équipe, Activités, Intégrations (nouvel onglet) | — |
| 6 Import | Geofolia, puis DAPLOS, puis dossier PAC (les parcelles culturales d'abord, D2), un fichier après l'autre ; rapports | `POST /imports/:id/apply` |
| 7 Fin | liens : tableau de bord, carte, interventions, registre, fertilisation, Imports | `PUT /farm/onboarding` (`completedAt`) |

`POST /me/farms` crée, dans une transaction : la ferme, l'adhésion du
responsable, ses réglages (`onboarding: { step: "files" }`), la campagne de
l'année, la personne liée au compte, l'adresse du siège (géocodée si l'IGN la
trouve), et consomme le droit du compte (`users.farm_creation_quota`) : deux
envois simultanés ne créent qu'une ferme ; sans droit, **403**.
`PUT /farm/onboarding` (responsable) enregistre l'étape, ou la fin
(`completed: true`). Chaque étape est gardée : fermer la page reprend au
même endroit.

Recette : assistant parcouru de bout en bout avec les trois fichiers réels
de la ferme pilote (e2e local, `FOURMY_IMPORT_SAMPLES`) : 41 parcelles,
tableau de bord atteint sans intervention en base.

## Reprise d'Ekylibre depuis une sauvegarde déposée

Dans l'assistant (« Mes fichiers ») et sur la page Imports : le responsable
dépose la **sauvegarde de tenant** Ekylibre (zip, format 3 : `manifest.yml`
et `<tenant>.sql`, **2 Go au plus**). Le travail lourd est fait par le
**worker**, pas par l'API.

1. `POST /imports/ekylibre/upload` (corps brut `application/zip`, nom dans
   `X-File-Name`) : l'API écrit le zip **en flux** sur le volume partagé
   avec le worker (`FOURMY_EKYLIBRE_UPLOADS_DIR`), vérifie la sauvegarde
   (manifeste, tenant, format, dump) et crée l'import `running`
   (`report.phase = queued`). Pas une sauvegarde : **400** ; plus de 2 Go :
   **413** ; un autre import en cours : **409** ; `EKYLIBRE_SOURCES_URL`
   absent : **503**. nginx relaie cette route seule jusqu'à 2 Go, sans tampon.
2. Le worker (toutes les 15 s, hors de sa boucle) restaure le dump dans une
   **base jetable** `ekylibre_src_up_<import>` (`apps/api/src/ekylibre/restore.ts`) :
   PostGIS et le schéma du tenant créés par le serveur ; instructions
   exécutées sous le rôle `fourmy_restore` (sans connexion ni privilège) et
   **filtrées par liste blanche** (tables, séquences, index, vues, types,
   fonctions `plpgsql`/`sql`, déclencheurs, contraintes, `COPY … FROM stdin`,
   `setval`, réglages de session connus) ; ignorés : propriétaires, droits,
   commentaires, schéma, extensions ; **refusés et comptés** : changement de
   rôle, `COPY … PROGRAM` ou fichier serveur, `DO`, fonctions en autre
   langage, règles, écritures directes, commandes psql. La base passe en
   lecture seule ; l'import devient « à valider » (`analyzed`, compte rendu
   dans `report.restore`).
3. `POST /imports/:id/apply` : la migration existante
   (`@fourmy/migrator-ekylibre`) est confiée au worker
   (`phase = migrate-queued`), puis la clé OpenWeatherMap et le siège comme
   pour la reprise par base source ; base et fichier supprimés ensuite.
4. Abandon ou échec : base et fichier supprimés par le worker
   (`phase = cleaned`).

Recette locale sur deux sauvegardes réelles : 21 Mo (restaurée en 12 s,
migrée en 1,4 s : 111 parcelles, 26 interventions) et 80 Mo (15 s + 6 s :
162 parcelles, 588 interventions) ; aucune erreur de restauration,
7 `CREATE RULE` écartées (inutiles à la reprise).
Pas d'annulation pour cette reprise (celle de la migration Ekylibre n'existe
pas) ; un rejeu ne duplique pas (UUID v5 du migrateur).

## Reconnaissance du format

Par le contenu, jamais par l'extension (`packages/importers/src/detect.ts`) :

- archive zip contenant `Field.Json` et `Action.Json` (à la racine ou dans un
  dossier) → Geofolia ;
- XML dont la racine est `producteurs` (espace `urn:x-telepac:…`) → TelePAC ;
- texte dont la première ligne est `EI` suivi d'un SIRET → DAPLOS.

## Données

| Table | Contenu |
|---|---|
| `import_files` (RLS) | fichier déposé : format, nom, taille, sha256, contenu ; unique par (ferme, sha256) ; expire après 30 jours |
| `import_runs` (RLS) | suivi de tous les imports : `file_id`, `format`, `preview`, `decisions`, `created_by` en plus de la reprise Ekylibre |
| `import_links` (RLS) | provenance : (espace de noms, clé source) → (entité, id), import, créé ou seulement relié ; sert au dédoublonnage et à l'annulation (IM2, IM5) |
| `lexicon_agroedi_codes`, `lexicon_agroedi_crops` | dictionnaire AgroEDI (Lexicon) : libellés par table, cultures simples et combinées → production |
| `lexicon_productions.agroedi_crop_code`, `.season` | code d'espèce AgroEDI et saison des productions de référence |

Le worker supprime chaque jour les fichiers expirés (sauf pendant une
écriture ou une annulation) et abandonne les analyses restées sans fichier.

## Sécurité des fichiers

- 50 Mo par fichier (limite du corps de requête, comme le relais nginx).
- Archives zip (`unzip` de `@fourmy/isoxml`) : chemins sans `..` ni racine,
  entrées chiffrées et zip64 refusés, taille décompressée et taux de
  compression bornés (200 Mo, ×100 pour les imports), sortie bornée par la
  taille annoncée, somme de contrôle vérifiée.
- Rien n'est exécuté ni écrit sur disque ; le contenu ne quitte jamais l'API.
- Les messages d'erreur disent ce qui est attendu, sans détail technique.

## Codes AgroEDI

`packages/importers/src/aee.ts` traduit les codes AgroEDI en concepts Fourmy,
**table par table** (un code n'est unique que dans sa table : `ZKE` est un
semis de précision en table 14, un amendement en table 5) :

| Table | Usage | Exemples |
|---|---|---|
| 14 nature d'intervention | procédure | `SEX` → `spraying`, `SEM` → `mineral_fertilizing`, `SEU` / `ZKE` → `sowing` (direct / précision), `SER` → `harvesting` (`grains_harvest` pour un usage grain), `SEO` → `plant_watering` ; inconnu → `generic_tillage` (catégorie `ZF8`) ou `technical_task` |
| 11 état | statut | `ZK1` prévu → planifiée, `ZK2` réalisé |
| 5 nature d'intrant | nature d'article, motif | `ZIU` herbicide, `ZJC` engrais minéral, `ZJB` effluent, `ZJE` eau, `ZJF` semence |
| 6 effluents | forme et espèce | `SCA` fumier de bovins, `SCU` fumier de poulets de chair |
| 20 composition | teneurs | `NT` azote total, `PT` P₂O₅, `KT` K₂O… |
| 36 unités | unités Fourmy | `LTR` → `liter`, `ZKK` → `liter_per_hectare` ; `ZHK` (rendement, hors table 36) → `ton_per_hectare` |

Les libellés affichés viennent du dictionnaire AgroEDI de Lexicon.

## Référentiel Lexicon avec clé

Le dictionnaire AgroEDI est réservé aux adhérents OSFarm : il vient du bundle
`fourmy` de l'API Lexicon, synchronisé par le worker quand
`FOURMY_LEXICON_API_KEY` est fournie ([`deploiement.md`](deploiement.md)).
Sans clé, le dépôt public suffit au reste de Fourmy ; le jeu `agroedi` est
alors signalé absent et les imports se rabattent sur les codes d'espèce des
productions de référence.

En local : `FOURMY_LEXICON_API_KEY=lex_… corepack pnpm --filter @fourmy/lexicon sync`.

## Tests

- `@fourmy/importers` : reconnaissance, codes AgroEDI, géométries
  (Lambert 93 → WGS 84 contre PostGIS), aperçu. Les fichiers réels ne sont
  jamais dans le dépôt : `FOURMY_IMPORT_SAMPLES=<dossier>` les fait
  reconnaître en local.
- `@fourmy/isoxml` : limites de l'`unzip` (bombe, traversée, taille annoncée
  fausse, chiffrement, somme de contrôle).
- `@fourmy/lexicon` : bundle avec clé, jeu `agroedi`, somme de contrôle.
- API : `apps/api/test/file-imports*.integration.test.ts` (socle, Geofolia,
  TelePAC, DAPLOS et dédoublonnage dans les deux ordres, historique,
  annulation complète et partielle).
- Web : `apps/web/test/file-imports.test.tsx` ; e2e
  `apps/web/e2e/file-imports.spec.ts` (dépôt → aperçu → import → rapport →
  annulation, sur une ferme créée pour l'occasion) et
  `apps/web/e2e/onboarding.spec.ts` (compte neuf → trois fichiers → reprise à
  l'étape 4 → tableau de bord ; compte sans droit).
- API : `apps/api/test/onboarding.integration.test.ts` (création avec et
  sans droit, double envoi, identité depuis les trois formats) ;
  `ekylibre-restore.test.ts` (découpage du dump, liste blanche) et
  `ekylibre-upload.integration.test.ts` (sauvegarde synthétique avec des
  instructions malveillantes : restaurée sans elles, base en lecture seule,
  nettoyage ; vraie sauvegarde en local avec `FOURMY_EKYLIBRE_SAMPLES`).
- Jeux anonymisés (`packages/importers/test/fixtures`) : tirés des exports
  réels d'une même ferme par `scripts/anonymize-*.mjs` ; le jeu DAPLOS est
  calé sur le jeu Geofolia (mêmes parcelles, mêmes GUID anonymisés, même
  déplacement des géométries).
