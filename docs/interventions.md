# Fourmy — Interventions et procédures (proposition)

> Rédigé le 2026-11-07 après lecture de `zero-mobile`, des définitions de
> procédures d'Ekylibre et de l'usage réel sur les trois fermes migrées.
> **Statut : validée le 2026-11-07** (décisions au §7).

## 1. Constats

### 1.1 Ce qu'Ekylibre fait — et ce qui coûte

Ekylibre décrit **145 procédures** en XML (`config/procedures/*.xml`). Pour
la pulvérisation, par exemple :

- des **filtres** dans une grammaire à lui (`is preparation and can care(plant)`,
  `is equipment and can spray`) ;
- **7 façons d'exprimer la quantité** d'un phyto (`population`, `net_mass`,
  `net_volume`, `mass_area_density`, `volume_area_density`,
  `specific_weight`, `volume_density`), chacune avec ses **formules** de
  conversion (`forward` / `backward`) évaluées par l'interpréteur Procedo ;
- un `reference_name` par rôle (`cultivation`, `plant_medicine`, `driver`,
  `tractor`, `sprayer`) que le client doit connaître ;
- des « actions » (`herbicide`, `fungicide`…), des lectures d'équipement, des
  attributs, des paramètres de groupe, une cardinalité par rôle.

Conséquences observées par `zero-mobile` (docs `p6.5` et `p6.6`) :

- une **pulvérisation complète ne peut pas être enregistrée** par l'API v2 :
  l'interpréteur de formules lève `Dont known how to manage node:
  ActorPresenceTest` / `Division` dès qu'il y a une cible ou un intrant ;
- l'API **n'est pas idempotente** (doublons en zone blanche) ;
- le mobile ne gère **qu'une procédure** (pulvérisation), codée à la main, avec
  un analyseur partiel de la grammaire des filtres et un miroir des 7 handlers.

### 1.2 Ce que les fermes utilisent vraiment

Mesuré sur les trois fermes migrées (780 interventions) :

| Constat | Chiffre |
|---|---|
| Procédures utilisées | **37 sur 145** |
| Procédures « travail mécanique » (cible + matériel + personne, sans intrant) | **plus de la moitié** (labour, hersage, déchaumage, taille, épamprage, rognage, relevage…) |
| Unités d'intrants rencontrées | `kg`, `L`, `kg/ha`, `L/ha`, `t/ha`, `milliers/ha` — **jamais** `L/hL` ni `kg/hL` |
| Unités de sorties | `t`, `q/ha` |
| Interventions sur plusieurs périodes | 14/603 (grandes cultures), **50/151 (viticulture)** |
| Personnes distinctes par ferme | 1 à 9 |
| « Actions » renseignées | 100 % … mais **toutes cochées par défaut** : inexploitables |

**Six formes d'intervention couvrent les 37 procédures utilisées.** Ce qui
distingue « labour » de « hersage », c'est le **nom**, pas la structure.

## 2. Principes

1. **Une procédure est une donnée, pas du code.** Pas de grammaire, pas de
   formule : un code, un libellé, une **forme** et quelques listes (cibles,
   natures d'intrants et de sorties, matériels suggérés).
2. **Peu de formes, un seul formulaire.** Le formulaire (web et mobile)
   affiche ses sections selon la forme de la procédure. Ajouter une procédure =
   ajouter une ligne au catalogue.
3. **Deux façons d'exprimer une quantité** : totale, ou **par hectare**
   (multipliée par la surface traitée à la date). Les « handlers » disparaissent.
4. **Les règles vivent dans le domaine**, en fonctions pures partagées par
   l'API, le web et le mobile (`@fourmy/contracts` / `@fourmy/sdk`).
5. **Idempotent partout** : identifiant client (UUID v7), tout ou rien par
   intervention (déjà en place dans la synchro).
6. **Compatible avec la migration** : les codes de procédures d'Ekylibre sont
   conservés ; une procédure inconnue reste lisible.

## 3. Le catalogue de procédures

### 3.1 Six formes

| Forme | Cibles | Intrants | Sorties | Effets et règles |
|---|---|---|---|---|
| `work` — travail | parcelles (≥ 1) | facultatifs (consommables) | — | aucun mouvement obligatoire |
| `treatment` — traitement | parcelles (≥ 1) | **phytos ≥ 1**, dose par ha ou totale | — | **registre phyto** ; motif facultatif (herbicide, fongicide…) |
| `fertilization` — fertilisation | parcelles (≥ 1) | **fertilisants ≥ 1** | — | plan de fumure (après la tranche) |
| `sowing` — semis, plantation | parcelles (≥ 1) | **semences / plants ≥ 1** (kg/ha, milliers/ha…) | — | démarre la **production** de la campagne (espèce, variété) |
| `harvest` — récolte | parcelles (≥ 1) | — | **récolte ≥ 1**, totale ou rendement/ha | **destination obligatoire** (lieu ou cuve) |
| `maintenance` — entretien | matériel ou bâtiment (≥ 1), relevé de compteur par matériel | pièces, fluides, fournitures (rattachés au matériel) | — | pas de parcelle ; bloc `maintenance` : nature (préventif / curatif, problème exigé en curatif), atelier, opérations du plan réalisées, qui remettent à zéro les échéances (voir [`materiels.md`](materiels.md)) |

Une procédure peut **élargir** sa forme : `vine_spraying_with_fertilizing` est
un `treatment` qui accepte aussi des fertilisants.

### 3.2 Définition d'une procédure

```ts
{
  code: "spraying",                  // code Ekylibre conservé
  label: "Pulvérisation",            // libellé officiel (locale fra d'Ekylibre)
  shape: "treatment",
  category: "crops" | "vine" | "equipment" | "general",   // regroupement à l'écran
  inputKinds: ["phyto"],             // natures d'articles acceptées en intrant
  outputKinds: [],                   // natures d'articles acceptées en sortie
}
```

Les matériels, produits et personnes ne sont plus **filtrés** par une
grammaire : ils sont **suggérés** d'après les **habitudes de la ferme** —
`GET /procedures` renvoie, pour chaque procédure, son usage et les matériels,
produits et intervenants les plus utilisés avec elle sur les 3 dernières
années. Ils apparaissent en premier (« Habituels ») ; tout reste
sélectionnable. (Décidé à la réalisation, à la place d'une liste figée
`toolHints` : les habitudes réelles valent mieux qu'une table de natures.)

### 3.3 Catalogue v1

Les **37 procédures utilisées** par les fermes pilotes, plus les procédures
courantes absentes des données (binage, roulage, irrigation…). Extrait :

| Catégorie | Forme `work` | Forme spécifique |
|---|---|---|
| Cultures | labour, déchaumage, hersage, binage, roulage, broyage des résidus | pulvérisation, désherbage chimique (`treatment`) · fertilisation (`fertilization`) · semis « tout-en-un », semis (`sowing`) · récolte (`harvest`) |
| Vigne | taille, épamprage, écimage-rognage, relevage, pliage, tirage des bois, tonte, entretien intercep, chaussage, déchaussage, construction du palissage | pulvérisation avec/sans fertilisation (`treatment`) · épandage engrais (`fertilization`) · plantation, complantation (`sowing`) · vendange (`harvest`, destination cuve) |
| Matériel, bâtiments | — | réparation et maintenance, entretien des installations (`maintenance`) |

Le catalogue est **versionné dans `@fourmy/contracts`** (même catalogue pour
l'API, le web et le mobile, disponible hors ligne). Les procédures **propres à
une ferme** (ajout, masquage) viendront plus tard, par une table et par les
plugins.

## 4. Le modèle d'intervention

### 4.1 Ce qui reste

```ts
Intervention {
  id                 // UUID client (idempotence)
  procedure          // code du catalogue
  status             // planned | done | cancelled
  periods[]          // ≥ 1 { startedAt, stoppedAt } — plusieurs demi-journées en vigne
  targets[]          // { kind: land_parcel | equipment | place | container, id,
                     //   workedAreaM2?  (surface réellement traitée si partielle),
                     //   workingZone?   (géométrie, ex. tirée de la trace GPS) }
  inputs[]           // { articleId, quantity, per: "total" | "hectare", lotId?, from? }
  outputs[]          // { articleId, quantity, per: "total" | "hectare", to (lieu/cuve) }
  tools[]            // { equipmentId }
  doers[]            // { personId }
  purposes[]         // traitement : herbicide, fongicide, insecticide… (facultatif)
  notes
  origin             // web | mobile | migration | plugin
}
```

`startedAt` / `stoppedAt` d'une intervention = début de la première période,
fin de la dernière.

### 4.2 Ce qui disparaît (par rapport à Ekylibre)

| Ekylibre | Fourmy |
|---|---|
| `reference_name` par paramètre (`driver`, `plant_medicine`…) | le rôle suffit (`targets`, `inputs`, `tools`, `doers`) ; la procédure dit le reste |
| 7 « handlers » de quantité + formules Procedo | `per: "total" \| "hectare"` + l'unité de l'article |
| Grammaire de filtres `is … can …` | `inputKinds`, `outputKinds` (listes simples) + suggestions tirées de l'historique |
| Paramètres de groupe, lectures d'équipement, attributs | supprimés (rien ne les utilise dans les données) |
| « Actions » cochées par défaut | `purposes` facultatif, saisi seulement si connu |
| Coûts, prescriptions, demandes | Lyvre (coûts) ; prescriptions et planification : après la tranche |

### 4.3 Règles (domaine, fonctions pures)

- Les **cibles** respectent la forme (parcelles, ou matériel/bâtiment pour
  `maintenance`) ; au moins une.
- Les **intrants** et **sorties** sont de natures acceptées par la procédure ;
  minimums selon la forme (§3.1).
- Une **dose par hectare** est multipliée par la **surface traitée** : somme
  des `workedAreaM2` si renseignés, sinon zones de travail, sinon surfaces des
  parcelles **à la date**. Une unité incohérente est refusée (déjà en place).
- Une **sortie** exige une destination (déjà en place).
- Les périodes sont ordonnées et ne se chevauchent pas.
- **Annuler** une intervention réalisée = contre-passer ses mouvements
  (`cancelled`) ; une intervention planifiée peut être supprimée.
- **Modifier** une intervention planifiée = mise à jour directe ; une
  intervention réalisée = **correction tracée** (§10) ; une annulée ne se
  modifie plus.

Ces règles sont **les mêmes** sur le serveur, le web et le mobile : le
mobile valide hors ligne exactement ce que le serveur acceptera.

### 4.4 Lien avec les traces GPS

La couverture calculée depuis Traccar (US-1 : surface travaillée par parcelle)
peut **pré-remplir** `workedAreaM2` et `workingZone` d'une intervention sur la
même journée et le même matériel. C'est ce qui rend la dose par hectare juste
quand seule une partie de la parcelle est traitée.

## 5. Correspondance avec Ekylibre (migration)

| Ekylibre | Fourmy |
|---|---|
| `procedure_name` | `procedure` (même code) ; inconnue du catalogue → forme `work`, libellé officiel d'Ekylibre |
| `InterventionTarget` (parcelle, culture) | `targets` (`land_parcel`, culture → sa parcelle) — déjà migré |
| `InterventionInput` + `quantity_value` / `quantity_unit_name` | `inputs` : `per: "hectare"` si l'unité finit par `_per_hectare`, sinon `total` |
| `InterventionOutput` | `outputs` |
| `InterventionTool` | `tools` |
| `InterventionDoer` | `doers` → `people` (voir §7, question 1) |
| `intervention_working_periods` | `periods` |
| `actions` | **non migrées** (cochées par défaut, sans valeur) |

## 6. Ce qui change

### 6.1 Dans Fourmy

- **Contrats** : catalogue des procédures (formes, ~50 procédures), schéma
  d'intervention (périodes, `per`, `purposes`, personnes), règles de forme.
- **Base** : périodes de travail, personnes (`people`), motifs ;
  le stockage des paramètres actuel (rôle + référence + quantité + unité)
  est conservé.
- **API** : `GET /procedures` ; validation par forme à la planification et à
  la réalisation ; personnes ; la synchro mobile transporte le catalogue et
  les personnes.
- **Migrateur** : périodes, personnes, `per` déduit de l'unité.
- **Web** : un formulaire unique piloté par la forme (sections cibles,
  intrants, sorties, matériels, personnes, périodes).

### 6.2 Dans zero-mobile

- **Client API** : l'API v2 d'Ekylibre est remplacée par l'API Fourmy
  (`/sync/pull`, `/sync/push`, résultat par intervention — déjà conçu pour
  l'état de synchro par intervention de l'app).
- **Schéma local v5** : catalogue Fourmy, parcelles, articles, matériels,
  personnes ; une table de paramètres unique ; périodes.
- **Formulaire** : le formulaire « pulvérisation » devient le formulaire
  générique par forme ; on réutilise ses briques (choix des parcelles sur la
  carte, saisie des intrants).
- **Supprimé** : analyseur de filtres, miroir des 7 handlers, `reference_name`.

## 7. Décisions (2026-11-07)

1. **Personnes** : une liste de personnes par ferme (nom, rôle, lien
   éventuel avec un compte) ; les intervenants d'Ekylibre sont **migrés**
   (nom seulement). Les fixtures restent anonymisées.
2. **Motifs de traitement** : **liste fermée, facultative** (herbicide,
   fongicide, insecticide, régulateur de croissance, biostimulant…), rien de
   coché par défaut ; les « actions » d'Ekylibre ne sont pas migrées.
3. **Authentification** : **better-auth avant zero-mobile** — l'API et le web
   passent à de vrais comptes, puis l'app mobile s'y connecte.

## 8. Ordre de réalisation

1. ✅ **Fourmy — interventions et procédures** : catalogue et règles de forme
   (contrats + domaine), base (périodes, personnes, motifs), API, migrateur,
   formulaire web unique. Réalisé le 2026-11-07 — voir §9.
2. ✅ **Fourmy — comptes** : better-auth (comptes locaux), remplacement de
   l'identité de développement, rattachement des personnes aux comptes
   (réalisé le 2026-11-07 ; voir docs/architecture.md, Authentification).
3. ✅ **zero-mobile** : client Fourmy, schéma local v5, formulaire par forme,
   push par intervention sur `/sync/push` (branche `fourmy-backend` de
   zero-mobile, 2026-11-07 ; voir son `docs/fourmy-backend.md`). Côté
   Fourmy : la synchro tire aussi lieux, cuves et le compte rattaché à
   chaque personne ; l'origine de l'app (`zeromobile://`) est de confiance.

## 9. Réalisation (étape 1)

- **Contrats** : `packages/contracts/src/procedures.ts` (catalogue, formes,
  motifs) et `entities/interventions.ts` (forme structurée) ; synchro mobile
  en forme structurée (`body_json` au pull, corps structuré au push) avec la
  collection `people`.
- **Domaine** : `validateIntervention` (règles de forme, plan / réalisation),
  `storedUnit` / `splitUnit`. Annuler une intervention réalisée contre-passe
  ses mouvements **à leur date d'origine** : l'historique du stock montre
  qu'elle n'a pas eu lieu ; `createdAt` garde la date de l'annulation.
- **Base** : migration `0006` (personnes, périodes, motifs, notes, statut
  `cancelled`, attributs de paramètres). Stockage inchangé : une ligne par
  rôle dans `intervention_parameters` (unité suffixée `_per_hectare`).
- **API** : `POST /interventions`, `/:id/complete`, `/:id/cancel` (motif),
  `GET /procedures` (catalogue + habitudes), `GET|POST|PATCH /people`.
- **Migrateur** : intervenants « Worker » → personnes (nom seul), périodes
  depuis `intervention_working_periods` (chevauchements fusionnés ; à défaut
  début/fin de l'intervention). Fixtures : personnes renommées
  « Personne N », hauteurs IGN des bâtiments exclues (donnée dérivée).
- **Web** : formulaire unique piloté par la forme (périodes multiples,
  quantités par hectare ou totales, sortie + destination, motifs, notes,
  habitudes en premier), annulation avec motif, annulées masquables.

## 10. Fiche et correction tracée (2026-11-08)

Exigences : `claudedocs/exigences_interventions.md` (INT-UI-2, INT-UI-3).

- **API** : `GET /interventions/:id` (intervention + historique tiré du
  journal d'audit : action, auteur, motif, champs modifiés avant/après) ;
  `PUT /interventions/:id` (corps de saisie complet, `reason` et
  `correctionId` facultatifs ; réponse `{ intervention, warnings }`) ;
  `GET /interventions?campaign=2026` (toute la campagne, bornes de la table
  `campaigns`, sinon l'année civile).
- **Planifiée** : mise à jour directe, audit `updated`, événement
  `intervention.updated`.
- **Réalisée** : le **solde net** des mouvements de l'intervention est
  contre-passé (`effectiveMovements` : une intervention déjà corrigée n'est
  jamais contre-passée deux fois, annulation comprise), puis la nouvelle
  version est réalisée comme à la première fois (lots, lieux, alertes de
  stock négatif). Audit `corrected` avec l'avant et l'après ; événements
  `intervention.corrected` et `stock.moved`. Le registre phyto suit (vue sur
  les paramètres).
- **Idempotence** : `correctionId` devient l'identifiant de l'entrée d'audit ;
  rejouée, la correction n'est pas réappliquée.
- **Campagne close** (`stops_on` dépassée) : correction possible, avec une
  alerte dans `warnings`. Motif facultatif.
- **Rôles** : owner et worker, comme la réalisation et l'annulation.
- **Statut affiché** : `displayStatus` (domaine) calcule « en cours »
  (planifiée dont le début est passé) ; rien n'est stocké.
- **Écrans** :
  - **Fiche** `/f/:ferme/interventions/:id` (clic sur une ligne de la liste) :
    périodes, parcelles et surfaces **à la date de l'intervention** (pas de la
    frise), intrants et sorties par hectare et au total (la valeur saisie en
    gras, l'autre calculée sur la surface traitée), moyens, mini-carte des
    parcelles et zones travaillées, trace GPS des matériels pendant les
    périodes, historique (action, auteur, motif, avant → après). Une
    intervention reprise d'Ekylibre sans modification le dit.
  - **Fiche** (lot D) : chaque période avec sa durée et ses intervenants
    (icônes), l'activité et son image pour chaque parcelle, les
    pictogrammes réglementaires des intrants phyto, la météo façon
    meteoblue (temps dominant, frise horaire).
  - **Saisie en pleine page** (retours du 08/11/2026), même mise en page
    partout : **nouvelle** `…/interventions/new`, **réalisation** d'une
    planifiée `…/:id/complete`, **modification** `…/:id/edit`. À gauche le
    formulaire ; à droite les conditions de pulvérisation (traitement), la
    carte des parcelles (bouton « Carte ») et la synthèse du contrôle
    réglementaire ; le détail du contrôle est sous chaque intrant. Après
    l'enregistrement : la fiche de l'intervention.
  - Nouvelle intervention : **réalisée** si son début est passé, **à
    planifier** s'il est à venir (le choix reste modifiable). Chaque période
    a une **durée** qui calcule la fin ; déplacer le début garde la durée.
  - **Modification** : le formulaire prérempli ; réalisée → « Correction
    tracée », motif facultatif ; planifiée → date prévue. Ce que le
    formulaire n'affiche pas est conservé tel quel : surface travaillée et
    zone de travail des cibles, lot et lieu de prélèvement des intrants, lot
    des sorties.
  - **Liste** : noms des parcelles de toutes dates (`GET /land-parcels/names`),
    plus de « parcelle d'une autre date ».
  - Sans WebGL, les cartes sont remplacées par un message (`MapBoundary`) :
    la fiche et la page Carte restent utilisables.

## 11. Icônes des procédures (2026-11-08)

Exigence INT-UI-1. Icônes du jeu **Agric** d'Ekylibre
(github.com/ekylibre/agric, licence MIT).

- **Correspondance** : `packages/contracts/src/procedure-icons.ts`
  (`PROCEDURE_ICONS`, repli `SHAPE_ICONS` par forme) ; chaque procédure du
  catalogue porte son `icon`. Ekylibre n'associe pas d'icône aux procédures :
  la correspondance est propre à Fourmy. L'icône `vine` d'Agric est le logo
  du réseau social Vine : non utilisée.
- **Dessins** : seuls ceux utilisés sont intégrés, dans
  `apps/web/src/icons/agric.ts` (généré, commit Agric et licence en tête).
  Agric n'est pas publié sur npm. Après un changement de correspondance :
  `node apps/web/scripts/agric-icons.mjs <clone d'agric>` (refuse une icône
  importée sous une licence autre que MIT, ISC, CC0, Apache-2.0, OFL).
- **Composant** : `ProcedureIcon` (couleur du texte, décorative sauf avec
  `title`). Affiché dans la liste des interventions et le choix de la
  procédure du formulaire ; fiche, kanban et calendrier le reprendront.
- **Test** : toute icône du catalogue a son dessin ; les 37 procédures des
  pilotes ont une icône propre.

## 12. Vues de la semaine (2026-11-08)

Exigence INT-UI-4.

- **Semaine** : celle du jour de la frise, du lundi au dimanche ; semaine
  précédente / suivante (la suivante peut dépasser aujourd'hui : on planifie),
  « Cette semaine ». Les données viennent de `GET /interventions?campaign=`
  (et de la campagne voisine quand la semaine enjambe le 1er janvier).
- **Vue** choisie gardée dans l'adresse (`?view=list|kanban|calendar`) et,
  à défaut, dans le navigateur.
- **Liste** : semaine par défaut, interrupteur « Toute la campagne » ; tri par
  date, intervention, statut ; clic sur une ligne → fiche ; menu d'actions
  (fiche, réaliser, annuler).
- **Kanban** : Planifiée, En cours (calculée), Réalisée, Annulée. Glisser vers
  « Réalisée » ouvre la réalisation, vers « Annulée » la confirmation ; un
  retour en arrière est refusé avec une explication. Le menu de chaque carte
  offre les mêmes actions au clavier.
- **Calendrier** : sept colonnes ; chaque période à son jour avec ses heures
  (une intervention sur plusieurs jours apparaît chaque jour) ; une
  intervention planifiée sans période à sa date prévue.
- Code : `apps/web/src/features/interventions/week.ts` (semaine, créneaux),
  `views.tsx` (trois vues).

## 13. Recherche rapide (2026-11-08)

Exigence INT-UI-5. Champ de recherche de la vue Liste, sur **toute la
campagne** de la frise (pas seulement la semaine) : intervention, parcelle,
produit (nom ou n° AMM), matériel, intervenant, motif, notes. Insensible aux
accents et à la casse ; tous les mots tapés doivent se retrouver
(« monassut semis »). La requête est dans l'adresse (`?q=`), donc partageable.
Filtrage côté client (`search.ts`) : 2 000 interventions indexées et filtrées
en moins de 200 ms (test).

## 14. Saisie sur carte (2026-11-08)

Exigence INT-UI-6. Dans le formulaire, « Parcelles » bascule entre **Liste**
et **Carte** ; la sélection est commune aux deux.

- **Carte** (photo IGN, parcelles de la date de l'intervention) : clic pour
  ajouter ou retirer une parcelle, **Maj + glisser** pour toutes celles d'un
  rectangle, « Voir sur la carte » pour centrer une parcelle choisie.
- **Zone partielle** : dessinée avec l'éditeur carto commun (`docs/carto.md`),
  découpée sur chaque parcelle touchée (`zones.ts`, `clipToParcel`) ; chaque
  morceau devient la `workingZone` de sa parcelle et sa surface (géodésique,
  identique à PostGIS) le `workedAreaM2`. Une parcelle touchée est ajoutée à
  la sélection ; la zone se retire pour revenir à la parcelle entière.
- **Surface traitée** affichée (zones comprises) ; chaque dose par hectare
  montre son total estimé. Le serveur recalcule à l'enregistrement.
- Carte chargée à la demande (en mode Carte seulement) ; sans WebGL, un
  message la remplace, la liste reste utilisable.
