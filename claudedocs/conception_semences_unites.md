# Conception : unités des semences reprises et plants à la pièce

*Issue [#130](https://github.com/ekylibre/fourmy/issues/130). Besoins : `claudedocs/besoins_semences_unites.md` (FR-SU-1 à 13, NF-SU-1 à 4, décisions U1 et U2 du 28/11/2026). Conception du 28/11/2026.*

## 1. Principe : un changement de libellé, sans facteur

La réécriture ne convertit **aucune quantité**. Chaque unité reprise reçoit le code canonique de **même grandeur** :

| Unité reprise | Code canonique | Facteur |
|---|---|---|
| « Sac de 50 000 grains », quelle que soit la casse ou les espaces | `dose`, avec 50 000 grains par dose sur la fiche | 1 |
| « 1000 grains », « Mille grains », « Mille graines » | `thousand` | 1 |
| « Kg », « Kilogramme » | `kilogram` | 1 |
| « graines », « grains » | `grain` | 1 |
| « unity », « unité », « plant », « pièce », « pied », « motte » | `plant` (comptage à l'unité) | 1 |

Un sac reste un sac, un millier reste un millier. Les quantités en base ne bougent donc pas, et NF-SU-1 tient par construction : stock à toute date, registre, interventions passées et utilisation par campagne sont identiques. Une unité qui demanderait un facteur n'est pas proposée (par exemple « 50 000 grains » sans « sac » : 50 000 grains sans dose, sans code de même grandeur). Elle reste reconnue à la volée, comme aujourd'hui.

**Où l'unité est écrite.** Une réécriture touche, pour l'article, ces endroits seulement :

| Table | Colonne | Lignes réécrites |
|---|---|---|
| `articles` | `unit` | l'article |
| `stock_movements` | `unit` | les mouvements de ses lots ; le stock est groupé par `m.unit` (`repos/stock.ts`), il faut donc tout réécrire ensemble |
| `intervention_parameters` | `unit` | les intrants et sorties qui le citent ; on garde le suffixe : `Sac de 50 000 grains_per_hectare` devient `dose_per_hectare` |
| `prices` | `unit` | ses prix (un prix « par sac » devient « par dose », même montant) |
| `seed_derogations` | `unit` | ses dérogations AB |
| `article_seeds` | `grains_per_dose` | renseigné pour une dose (créé si la fiche n'existe pas) |

Les modulations (`prescriptions.unit`) visent un produit écrit en texte libre, pas un article : elles ne bougent pas. Les événements déjà émis (`outbox`) et l'historique (`audit_log`) gardent l'unité de leur époque.

## 2. Précisions de l'utilisateur (28/11/2026)

- **Trois sortes d'unités de stock** pour une semence :
  - un **comptage à l'unité** : `unity`, `unité`, plant, pièce, pied, motte. Tout cela devient `plant` ;
  - une **quantité de grains** : la dose (un sac de N grains), le grain, le millier ;
  - une **masse** : le kg.
- **Unité d'usage = unité de stock par surface.** Une dose de semis ou de plantation s'écrit dans l'unité de stock de la semence, rapportée à la surface : plants/ha, kg/ha, doses/ha. C'est la forme `<code>_per_hectare` déjà en place (`storedUnit`). Le grain/m² reste la seule exception, pour la densité de semis des grains.
- **Conséquence pour les semences déjà reprises en `unity`** (une dans la base de développement) : elles passent du grain au comptage à l'unité. Elles ne se convertissent plus en kg par le PMG, et leur fiche n'affiche plus de PMG.

## 3. Réponses aux questions ouvertes des besoins

1. **Libellé d'une dose.** Le libellé est déjà calculé à partir de l'unité et de la fiche (`stockUnitLabel`). `dose` avec 50 000 grains par dose s'affiche « doses de 50 000 grains », le nombre reste visible. Rien n'est à ajouter.
2. **Plants biologiques.** Le contrôle AB des semences (`certification-controls`) raisonne sur l'article de type semence et sur son statut bio, pas sur l'unité : un plant bio est couvert. Les dérogations portent leur propre quantité et leur unité, réécrites avec l'article (§1).
3. **Plants de vigne et arbres.** Ils entrent dans la page Semences comme toute semence en plants. Rien de propre à la vigne n'est ajouté (S8 reste vrai pour le suivi du vignoble lui-même).

## 4. Domaine (`packages/domain/src/seeds/units.ts`)

### 4.1 La dimension « plant »

```ts
export type SeedUnit =
  | { dim: "mass"; kg: number }
  | { dim: "grain"; grains: number }
  | { dim: "dose"; grains: number | null }
  | { dim: "plant" };                          // nouveau (U2)

export const SEED_UNIT_CODES = ["kilogram", "thousand", "grain", "dose", "plant", "million", "gram"] as const;
const PLANT_WORDS = new Set(["plant", "plants", "piece", "pieces", "pied", "pieds", "motte", "mottes", "unity", "unite", "unites", "plant a repiquer", "plants a repiquer"]);
```

- `parseSeedUnit` reconnaît `PLANT_WORDS`. « unity », « unite » et « unites » quittent `GRAIN_WORDS` pour `PLANT_WORDS` (§2).
- `convertSeedQuantity` : plant vers plant, facteur 1 ; plant vers une autre dimension, null.
- `seedConversionGap` renvoie un nouveau motif `"dimension"` pour plant contre masse ou grains (FR-SU-12). Il donne le message « Les plants se comptent à la pièce : ils ne se convertissent ni en kg ni en grains. »
- `seedUnitChoices("plant")` renvoie `["plant"]`.
- `seedEquivalents` : pour un plant, `{ plantsPerHa, plantsPerM2 }`, les grains et le kg à null. Le type gagne ces deux champs facultatifs.
- `seedCrossesDimension` (`repos/interventions.ts`) refuse plant contre grains ou masse.

### 4.2 Unité canonique

```ts
/** Code canonique de même grandeur, pour la réécriture (facteur 1) ; null si aucun. */
export function canonicalSeedUnit(unit: string, sheetGrainsPerDose: number | null):
  | { code: SeedUnitCode; grainsPerDose: number | null }
  | { conflict: { unitGrains: number; sheetGrains: number } }
  | null;
```

- Une unité déjà canonique renvoie null : il n'y a rien à faire.
- « Sac de N grains » donne `{ code: "dose", grainsPerDose: N }`. Une fiche qui porte un autre nombre donne `conflict` (FR-SU-6).
- `thousand`, `kilogram`, `grain` et `plant` sont tirés de la forme reconnue, avec un facteur 1 vérifié : `convertSeedQuantity(1, unit, code) === 1`. Sinon, la fonction renvoie null.
- « unity », « unité », « pièce », « pied » donnent `plant`, sans choix à faire (§2).

Tests du domaine : toutes les variantes de la base de développement (§1 des besoins), les conflits, le facteur 1 de chaque proposition, et le plant dans chaque fonction de conversion.

## 5. API

### 5.1 Proposer (`GET /seeds/units`, membres)

```ts
type UnitRewrite = {
  articleId: string; name: string;
  from: string;                 // unité actuelle
  to: SeedUnitCode | null;      // proposée ; null en conflit
  grainsPerDose: number | null;
  conflict: { unitGrains: number; sheetGrains: number } | null;
  stock: { quantity: number; label: string };   // stock du jour, identique avant et après
  usage: { movements: number; interventions: number; prices: number };
};
// → { items: UnitRewrite[] }
```

La route lit les articles de type semence de la ferme, applique `canonicalSeedUnit` et compte les lignes concernées par article. Elle est réservée aux membres, comme la page Semences, et n'est **pas** ouverte aux accès externes (elle va dans `CLOSED_ROUTES`, écran interne).

### 5.2 Réécrire (`POST /seeds/units`, `requireOwner`)

```ts
body: { items: { articleId: string; to: SeedUnitCode }[] }   // 1 à 200
→ { rewritten: { articleId, from, to }[]; skipped: { articleId, reason }[] }
```

- **Une transaction par article** (NF-SU-2) : si un article échoue, les autres sont quand même réécrits, et lui seul est rendu dans `skipped`.
- Contrôle de nouveau, dans la transaction : unité actuelle inchangée depuis la proposition, `to` égal à l'unité proposée, pas de conflit, facteur 1.
- Mises à jour, toutes avec `WHERE` sur l'article, ses lots ou ses paramètres :

  ```sql
  UPDATE articles SET unit = $to, custom = custom || {"unitRewrite": {"from": $from, "at": now, "by": $user}} …
  UPDATE stock_movements m SET unit = $to FROM lots l WHERE l.id = m.lot_id AND l.article_id = $a AND m.unit = $from;
  UPDATE intervention_parameters SET unit = $to || substr(unit, length($from) + 1)
    WHERE ref_type = 'article' AND ref_id = $a AND (unit = $from OR unit LIKE $from || '\_per\_%');
  UPDATE prices SET unit = $to WHERE article_id = $a AND unit = $from;
  UPDATE seed_derogations SET unit = $to WHERE article_id = $a AND unit = $from;
  INSERT INTO article_seeds (...) ON CONFLICT (article_id) DO UPDATE SET grains_per_dose = $n   -- dose seulement
  INSERT INTO audit_log (entity 'article', action 'unit_rewritten', diff { from, to, grainsPerDose, rows })   -- FR-SU-7
  ```

- **Vérification avant validation.** On relit le stock par lot, à aujourd'hui et au 1er janvier de chaque campagne qui a des mouvements, avant et après. Un écart lève une erreur et annule la transaction de cet article : c'est le garde-fou de NF-SU-1.
- **Événement** `article.updated` dans l'outbox, pour que le mobile relise l'article (NF-SU-4).

### 5.3 Plants dans les routes existantes

- `POST /seeds` et le catalogue acceptent `unit: "plant"` (FR-SU-9) : `parseSeedUnit` les fait passer.
- Les contrats : `SeedListItem.unitDim` gagne `"plant"` ; `seedEquivalents` dans la réponse de l'aperçu de semis gagne `plantsPerHa`.
- L'export CSV d'utilisation par campagne écrit « plants » dans la colonne unité.

## 6. Reprises et imports (NF-SU-3)

### 6.1 Migrateur Ekylibre (`packages/migrator-ekylibre/src/migrate.ts`)

Aujourd'hui, une nouvelle reprise écrit `unit = excluded.unit` sur l'article et l'unité d'Ekylibre sur les mouvements. Il faut donc :

- sur l'article : `unit = CASE WHEN articles.custom->'unitRewrite'->>'from' = excluded.unit THEN articles.unit ELSE excluded.unit END`. Une unité changée dans Ekylibre depuis, autre que celle d'origine, l'emporte : c'est une vraie modification ;
- sur les mouvements et les paramètres d'intervention repris : on applique la même correspondance, lue une fois par article (`from` → unité canonique), avant l'insertion. Le suffixe `_per_hectare` est gardé.

### 6.2 Imports DAPLOS et Geofolia (`repos/import-apply.ts`)

Ils créent les articles avec l'unité du fichier ou les rattachent à un article existant. Un article rattaché garde son unité, ce qui est déjà le cas. Pour un article créé, l'unité canonique est écrite directement si elle existe avec un facteur 1 (`canonicalSeedUnit`), et `unitRewrite.from` garde l'unité du fichier. Les nouvelles semences importées n'ont donc pas besoin de la réécriture.

## 7. Web

- **Page Semences** : un encadré « N semences ont une unité reprise d'un autre logiciel » (FR-SU-1), pour l'`owner` et seulement s'il y en a. Il ouvre une fenêtre avec la liste (FR-SU-3) :
  - pour chaque semence : son nom, l'unité actuelle, l'unité proposée, le stock du jour (« 12 doses de 50 000 grains → 12 doses de 50 000 grains ») et l'usage (« 126 mouvements, 34 interventions ») ;
  - une case à cocher par semence, toutes cochées au départ ; les conflits sont listés à part, non cochables, avec la façon de les régler (corriger le nombre de grains par dose sur la fiche) ;
  - le bouton « Réécrire 11 semences », puis une notification avec le nombre réécrit et les ignorées.
- **Plants** (FR-SU-9 à 11) :
  - `stockUnitLabel` affiche « plants » ;
  - la fiche de semence masque le PMG, ses repères et la densité en grains/m² ;
  - à la saisie du semis (`SeedLine`), on choisit entre plants/ha et plants au total, et l'équivalence affichée est « 8 000 plants/ha · 0,8 plant/m² » ;
  - la création d'une semence propose « Plants (à la pièce) » parmi les unités.

## 8. Tests

- **Domaine** : la table du §4.2 en cas de test (dont `unity` et « unité » en plants), plus les plants dans `parseSeedUnit`, `convertSeedQuantity`, `seedConversionGap`, `seedUnitChoices` et `seedEquivalents`.
- **API, réécriture** :
  - une ferme de test avec une semence de chaque forme reprise, ses lots, une réception, un semis à l'hectare, un prix et une dérogation AB ;
  - avant et après : stock à trois dates, registre, utilisation par campagne et détail de l'intervention, identiques ;
  - les lignes de toutes les tables du §1 réécrites, l'historique écrit ;
  - un conflit ignoré, un `worker` refusé (403), une unité changée entre la proposition et la réécriture ignorée ;
  - une seconde réécriture ne propose plus rien.
- **API, plants** : `POST /seeds` avec « Plant », la réception, la plantation à 8 000 plants/ha sur 1,5 ha (stock en baisse de 12 000), une saisie en kg refusée (FR-SU-12).
- **Migrateur** : une nouvelle reprise d'une ferme dont une semence est réécrite garde l'unité canonique, et ses mouvements repris sont dans cette unité.
- **Web** : l'encadré et la fenêtre (choix, conflit, envoi), la fiche d'une semence en plants (sans PMG), la saisie de plantation en plants/ha.

## 9. Découpage proposé (pour `/sc:workflow`)

| Lot | Contenu | Dépend de |
|---|---|---|
| **SU1** | Domaine : dimension plant, `canonicalSeedUnit`, tests | — |
| **SU2** | API et web des plants : `POST /seeds`, contrats, fiche, saisie du semis, CSV | SU1 |
| **SU3** | Réécriture : `GET` et `POST /seeds/units`, vérification du stock, historique, outbox | SU1 |
| **SU4** | Web de la réécriture : encadré et fenêtre de la page Semences | SU3 |
| **SU5** | Migrateur et imports : correspondance gardée, unité canonique à la création | SU3 |

Pas de migration de schéma : `articles.custom` (jsonb) porte `unitRewrite`, et `article_seeds.grains_per_dose` existe. Taille totale estimée : moyenne (5 lots S ou M).
