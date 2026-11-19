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
| IM2 Geofolia | lecture, rapprochement, écriture | à faire |
| IM3 TelePAC | îlots, parcelles PAC, haies et arbres déclarés | à faire |
| IM4 DAPLOS | lecteur `ekylibre/agroedei-edifact-daplos-reader` 2.0.0 | à faire |
| IM5 | historique N-1…N-5, plan de fumure, annulation, page Imports | à faire |
| IM6 | assistant de premier démarrage | à faire |

Après IM1, un fichier est reconnu et suivi, mais aucun format n'est encore
lu : l'aperçu le dit (avertissement bloquant).

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

États : `analyzed` → `running` → `completed` | `failed` ; `analyzed` →
`discarded` ; `completed` → `reverting` → `reverted` (IM5). La reprise
Ekylibre garde `running` → `completed` | `failed`.

Contrats : `packages/contracts/src/imports.ts` (`importRunView`,
`importPreview`, `importDecisions`).

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
- API : `apps/api/test/file-imports.integration.test.ts`.
