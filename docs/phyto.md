# Réglementation phytosanitaire

Lot 2 des retours de test (`claudedocs/exigences_interventions.md` : PHY-1 à
PHY-4, GEO-1, IFT-1). Réalisé le 2026-11-08.

## Sources (toutes ouvertes, sans compte)

| Donnée | Source | Dans Fourmy |
|---|---|---|
| Produits, usages autorisés (dose, délai avant récolte, ZNT, nombre d'applications), ensembles de cultures | **Lexicon** (OSFarm), paquet `phytosanitary` — catalogue E-Phy de l'ANSES et AMM 120 jours du ministère | tables `phyto_products`, `phyto_usages`, `phyto_cropsets`, `phyto_target_pfi` |
| Parenté des espèces (zea_mays → zea → poaceae → plant) | Lexicon, paquet `taxonomy` | table `taxonomy` |
| Cours d'eau et plans d'eau | **BD TOPO de l'IGN** (WFS Géoplateforme : tronçons et surfaces hydrographiques), la même source que l'hydrographie de Lexicon, avec les tracés | table `water_items`, par ferme (RLS) |
| IFT | **API IFT v5** du ministère de l'Agriculture | `interventions.ift` |

- Paquets Lexicon : `https://lexicon-packages.osfarm.org` (`index.json`,
  versions, `manifest.json`, CSV gzip). Le worker vérifie chaque jour ; une
  nouvelle version remplace l'ancienne d'un bloc (`@fourmy/lexicon`,
  `COPY` dans une transaction). Le `structure.sql` des paquets n'est jamais
  exécuté : seuls les noms de colonnes en sont lus. CLI :
  `node packages/lexicon/dist/cli.js [--force]`.
- L'API REST de Lexicon (`/phytosanitary/usages.json`…) n'expose ni le délai
  de ré-entrée ni les dates de retrait ; les paquets les contiennent.
- Eau : emprise de toutes les parcelles de la ferme + 200 m, rechargée tous
  les 30 jours par le worker, ou à la demande (page Produits phyto).
- IFT : préproduction `https://ecoagri-pprd.api.agriculture.gouv.fr/ift/v5/api` par défaut (local, dev), production `https://ecoagri.api.agriculture.gouv.fr/ift/v5/api` à régler par `FOURMY_IFT_API_URL` sur la seule production (sans compte dans les deux cas).

## Contrôle d'un traitement (`@fourmy/domain`, `checkTreatment`)

Pour chaque produit phyto, à la **date du traitement** (un traitement de 2016
est jugé sur la réglementation de 2016) :

| Indicateur | Rouge si… | Orange si… |
|---|---|---|
| Autorisation | produit retiré ou pas encore autorisé à la date ; aucun usage valable sur la culture d'une parcelle | pas de n° AMM, AMM inconnu, culture inconnue, référentiel non chargé |
| Dose maximale | dose à l'hectare (saisie, ou totale ramenée à la surface traitée) au-dessus du maximum | unité non comparable (L/hL, g/m²…) |
| Applications | maximum par campagne dépassé (même n° AMM, même parcelle) | — |
| ZNT | la zone traitée (zone de travail, sinon la parcelle) est plus près de l'eau que la ZNT ; distance réelle PostGIS, **fossés exclus**, cours d'eau intermittents compris | eau non chargée autour de la ferme |
| Délai avant récolte | une récolte (réalisée ou planifiée) tombe avant la fin du délai | — (sinon : « récolte possible à partir du… ») |
| Ré-entrée | — | — (information : « ré-entrée possible le … à … ») |

- Un usage vaut pour une culture si ses espèces contiennent la culture, un
  de ses ancêtres (« plant » = traitements généraux) ou un ensemble E-Phy qui
  la contient (logique d'Ekylibre).
- **Cible** : la saisie peut préciser l'usage (cible) de chaque produit ;
  sinon la valeur la plus permissive pour la dose et les applications, la
  plus stricte pour la ZNT et le délai avant récolte.
- **Culture** : `productions.cultivation` (taxonomie), reprise de la
  `cultivation_variety` d'Ekylibre ; une vigne sans variété reste `vitis`.
- **Unités** des articles repris (« Litre », « Kg », « Sac de 12 kg »)
  ramenées au litre ou au kilo.

## Pictogrammes réglementaires (lot D)

Sur la fiche (intrants) et dans le formulaire (sous le produit) : les
**pictogrammes de danger SGH** (CLP), déduits des mentions H du produit
(`phyto_risks`, paquet Lexicon `phytosanitary`) par la correspondance CLP
complète (`hazardPictograms`, préséances : SGH06 exclut SGH07…), plus des
pastilles **ZNT**, **DRE** (délai de ré-entrée) et **DAR** (délai avant
récolte). `GET /phyto/articles` donne pictogrammes, mentions et délai de
ré-entrée.

## IFT : cible et type de traitement (retours du 08/11, 15 h 32)

Comme Ekylibre (`pfi_client_api.rb`) : l'usage retenu de chaque produit
(choisi, ou le seul possible) donne sa **cible PFI** (`cibleIdMetier`, table
`phyto_target_pfi`) et le **type de traitement** de cette cible
(`default_treatment_type`) ; sans usage connu, le type se déduit de la
nature du produit. Sans cible, l'API appliquait la dose de référence de la
culture (avertissement AV1).

## Saisie : usage et carte

- L'usage retenu s'affiche toujours sous le produit (libellé, dose
  maximale) ; la liste n'apparaît que s'il y a plusieurs usages possibles.
- La carte du formulaire montre les cours d'eau de la ferme et la bande de
  ZNT autour des parcelles choisies (`POST /phyto/water/buffer`).

## Précautions d'emploi et mélanges (lot F)

Colonne de droite du formulaire, par produit : pictogrammes, mentions
« utilisable en AB » et « biocontrôle », conditions d'emploi de l'usage
retenu, mentions restrictives et protection de l'opérateur (EPI), d'après
E-Phy (migration 0013, `GET /phyto/articles`).

**Mélange** (arrêté du 7 avril 2010 modifié par celui du 12 juin 2015,
règle d'Ekylibre `mix_category_code_validator.rb`, `checkMixture`) : un
produit de catégorie 5 ne se mélange avec aucun autre ; deux produits d'une
même catégorie 2, 3 ou 4 ne se mélangent pas. Un mélange interdit est un
feu rouge (`compliance.mixture`) : motif obligatoire pour enregistrer.

## Activités

La culture contrôlée vient de l'**activité** de la parcelle (docs/activites.md) :
jachère → usages des jachères ; usage retenu d'office s'il est le seul
possible ; culture IFT de la production de référence.

## Saisie, fiche, registre

- **Formulaire** : contrôle en direct (`POST /phyto/check`) affiché sous
  chaque intrant, avec le choix de la cible ; synthèse de l'intervention
  (feu global) dans la colonne de droite. Une réalisation avec un feu rouge
  demande un **motif** (« alerte + motif ») ; le serveur refuse une
  réalisation web rouge sans motif. Depuis le mobile (qui ne connaît pas
  encore les feux), la réalisation est enregistrée, feu rouge visible.
- **Carte de la fiche** d'un traitement : cours d'eau et plans d'eau à moins
  de 200 m au-delà de la ZNT (fossés en pointillés) et bande de ZNT la plus
  exigeante des produits autour de la zone traitée
  (`GET /interventions/:id/water`, largeur `zntM` du contrôle).
- **Fiche** : contrôle enregistré à la saisie (`interventions.compliance`,
  avec le motif), sinon calculé à la date (`GET /interventions/:id/compliance`,
  reprises d'Ekylibre comprises) ; IFT par produit et parcelle.
- **Carte** : délais en cours sur la parcelle sélectionnée (ré-entrée
  interdite jusqu'au…, récolte possible à partir du…).
- **Registre phyto** : bilan IFT de la campagne (ferme, segments, parcelles).
- **Produits phyto** (menu) : version du référentiel, eau chargée, articles
  et leur rattachement E-Phy ; rattacher un n° AMM, ajouter un produit depuis
  le référentiel (recherche par nom, autre nom commercial ou n° AMM).

## IFT (`apps/api/src/repos/ift.ts`)

Un appel par produit et par parcelle : campagne (année du traitement), n°
AMM, culture IFT (libellé de la culture, sinon de ses ancêtres dans la
taxonomie : « Blé tendre » → « Blé »), type de traitement d'après la nature
E-Phy (herbicide T21, fongicide T23, insecticide T22, autre T24), unité L/ha
ou kg/ha, dose à l'hectare. IFT × part de la parcelle réellement traitée.
Total de l'intervention et bilan de campagne : moyenne pondérée par les
surfaces (parcelles non traitées comprises pour la ferme). Calculé par le
worker ; API indisponible → « en attente », nouvel essai une heure plus tard.

## Constat sur les fermes pilotes (2026-11-08)

- Pierre : 24 produits sur 24 rattachés par leur n° AMM (certains sous un
  autre nom commercial, ex. BARBARIAN ST = GLISTER ULTRA 360) ; 135 cours
  d'eau et plans d'eau autour de la ferme. Exemple de feu rouge réel : un
  écoulement intermittent traverse Lespourcy Maïs 2025 sur 110 m.
- 36 productions de Pierre n'ont qu'une culture générique dans Ekylibre :
  autorisation « non vérifiable » (orange) sur ces parcelles.

## Registre au format réglementaire (lot X, 2026-11-10)

**Textes** : règlement d'exécution (UE) 2023/564 modifié par 2025/2203
(électronique obligatoire au 1/01/2027) ; arrêté du 24/12/2025
(JORFTEXT000053228465) ; notice ministérielle du 22/09/2026 (intitulés
standard des champs, référentiels des cultures et des stades BBCH). Pas de
format de fichier imposé : « lisible par machine », un champ = une
information ; JSON complet pour les enquêtes statistiques (SAIO). Pas de
télétransmission ; conservation 5 ans ; remise sans tarder au contrôle.

**Périmètre v1** : cas A (traitement de surfaces : plein champ, vigne,
tunnels). Hors v1 : cas B (espaces fermés : serres permanentes, stockage),
C (traitement de semences) et D (semis de semences traitées), prestation de
service (`siretBeneficiaire`), délai de rentrée anticipée, volume de
bouillie.

**Modèle** (migration 0027) :
- `ref_phyto_crops` (375 cultures/situations : code, dénomination, code
  OEPP, référence BBCH) et `ref_bbch_stages` (2 368 stades), chargés depuis
  les tableurs du ministère (agriculture.gouv.fr/telecharger/156212 et
  156203) ;
- `farms.siret` (14 chiffres) et `farms.pacage` (9 chiffres) : détenteur ;
- `activities.crop_code` : culture réglementaire choisie ; sans choix,
  `fourmy_activity_crop` la **propose** d'après le libellé Lexicon de la
  production de référence, puis le nom de l'activité (dénomination la plus
  longue qui commence le libellé : « Maïs grain » → Maïs `ZEAMX`). Les
  variétés saisies comme espèce (DKC5196…) ne gênent pas : la culture vient
  de l'activité ;
- `interventions.bbch` : stade BBCH du traitement (facultatif).

**Une ligne** = un produit phyto × une parcelle traitée d'une intervention
réalisée (`officialRegisterLine`, `@fourmy/domain`) :

| Champ | Source |
|---|---|
| `idTraitement`, `idIntervention` | paramètre intrant : paramètre cible ; intervention (regroupe un mélange) |
| `siretApplicateur` | SIRET de la ferme |
| `nomProduit`, `numeroAMMProduit` | article (AMM à 7 chiffres, sinon vide) |
| `dateIntervention`, `heureDebut`, `heureFin` | première et dernière période, heure de Paris |
| `doseProduitValeur`, `doseProduitUnite` | quantité par hectare, ou totale ramenée à la surface traitée de l'intervention ; kg/ha, L/ha, unité/ha ; 4 décimales |
| `usageCible` | cible de l'usage E-Phy retenu par le contrôle |
| `modeApplication` | libellé de la procédure |
| `surfaceTraitee` | zone travaillée, sinon surface de la parcelle à la date (ha) |
| `coordonneesGps` | point de la parcelle, « lat ; lon » (WGS84) — pas de référence RPG de l'exploitant (le RPG de l'IGN est anonyme) |
| `cultureOepp` | culture de l'activité de la production de la parcelle |
| `codeBbch` | stade de l'intervention (« BBCH 57 ») |
| `modeDeConduite` | « Oui » si la parcelle est certifiée bio à la date |

`anomalies` liste les champs obligatoires manquants (non exportée en CSV).

**API** : `GET /registers/phyto/official?campaign=AAAA` (JSON avec
anomalies), `&format=csv` (intitulés standard, « ; », UTF-8 avec BOM),
`&format=export` (JSON complet : détenteur, campagne, champs d'enquête
`campagne`, `pacage`, `surfaceParcelle`, `partSurfaceTraitee`) ;
`GET|PUT /settings/identity` (SIRET, PACAGE ; écriture responsable) ;
`GET /reference/phyto-crops`, `GET /reference/bbch?crop=CODE`.

**Écrans** : Registre phyto › onglet « Format réglementaire » (détenteur,
lignes, champs à compléter, exports) ; Activités : culture du registre
(proposée ou choisie) ; formulaire d'un traitement : stade BBCH (stades de
la culture des parcelles) ; fiche : stade.

**Points laissés ouverts** (textes divergents) : dose en kg/hL ou L/hL
acceptée par la notice mais pas par l'arrêté (on exporte une dose à
l'hectare) ; séparateur des coordonnées (« ; » du tableur annexe) ; BBCH
exporté sous le libellé du référentiel (« BBCH 57 », « Stade 1 »).

**Fermes pilotes** (2026-11-10) : mêmes lignes que le registre existant,
année par année (Pierre 2015-2026, Frédéric 2020-2023). Seul manque
systématique : le SIRET, à saisir. Restent 33 doses sans unité (2020) chez
Frédéric, 1 chez Pierre (2021), et 2 lignes de 2024 sans culture chez
Pierre ; « Prairie temporaire » n'a pas de culture proposée (à choisir).
