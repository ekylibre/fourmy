# Conception : mixité AB (R7) et cultures génériques

*Issue [#166](https://github.com/ekylibre/fourmy/issues/166). Besoins : `claudedocs/besoins_ab_mixite.md` (FR-MX-1 à 7, NF-MX-1 à 3, décisions M1 et M2). Conception du 28/11/2026, réalisée dans la même PR.*

## 1. Principe : la lignée de chaque culture

Chaque production porte, en plus de son espèce, sa **lignée** : son taxon, puis ses parents jusqu'au genre, en gardant seulement les rangs fins (variété, sous-espèce, espèce, genre).

| Culture | Lignée |
|---|---|
| `avena_sativa` (espèce) | `["avena_sativa", "avena"]` |
| `avena` (genre) | `["avena"]` |
| `brassica_napus_napus` (sous-espèce) | `["brassica_napus_napus", "brassica_napus", "brassica"]` |
| `plant`, `fabaceae`, `equipment`, aucune | `null` (générique, FR-MX-1) |

Une culture est générique si son taxon est absent de la taxonomie, ou si son rang est la famille ou au-dessus.

**Même espèce pour R7** (FR-MX-4, décision M2) : deux lignées `a` et `b` se recoupent si l'une contient le taxon de l'autre (`a.includes(b[0]) || b.includes(a[0])`). Les cas :
- `avena` et `avena_sativa` : oui ;
- `avena_sativa` et `avena_strigosa` : non, aucune des deux ne contient l'autre, seul le genre est commun ;
- sous-espèce et son espèce : oui.

La lignée se calcule en SQL, dans la requête qui lit les productions : une sous-requête récursive sur `taxonomy`, qui s'arrête au genre. On ne fait donc pas de requête par production (NF-MX-3). Le domaine reçoit des tableaux et ne lit pas la taxonomie.

## 2. Domaine

- **`certification/taxonomy.ts`**, nouveau, exporté :
  - `mixityLineage(species, lineage)` : la lignée à utiliser. `lineage === undefined` (un appelant ancien, un test) revient à `[species]`, l'espèce supposée précise. C'est ce qui tient NF-MX-2.
  - `sameSpeciesForMixity(a, b)` : la règle du §1.
- **`AbProduction`** et les productions hors AB gagnent `lineage?: string[] | null`.
- **`mixityFindings`** :
  - une production AB de lignée `null` donne une note `na` par libellé (FR-MX-3) : « {libellé} : espèce à préciser sur l'activité pour contrôler la mixité (R7). » Elle renvoie à l'activité, sans effet sur le verdict, puisque `na` est le rang le plus bas de `worstControlLevel` ;
  - les productions AB sont groupées par leur taxon (`lineage[0]`). Pour chaque groupe, les productions hors AB retenues sont celles dont la lignée se recoupe avec celle du groupe. Une production hors AB générique ne l'est jamais (FR-MX-2) ;
  - la suite est inchangée : variétés inconnues, même variété, variétés différentes (FR-MX-5) ;
  - le libellé : « {AB} (AB) et {hors AB} (hors AB) » quand les libellés hors AB diffèrent, sinon le libellé seul (FR-MX-6).
- **Assolement** (`crop-plan/checks/certification.ts`, FR-MX-7) :
  - `CropPlanActivity` gagne `speciesLineage?: string[] | null` ;
  - la mixité groupe et compare avec `sameSpeciesForMixity` ;
  - une lignée `null` est ignorée, sans note.

## 3. API

- **Fragment SQL partagé** `speciesLineage(expr)`, dans `repos/certification-ab.ts`, exporté :

  ```sql
  (WITH RECURSIVE l AS (
     SELECT reference_name, parent, rank, 0 AS depth FROM taxonomy WHERE reference_name = <expr>
     UNION ALL SELECT t.reference_name, t.parent, t.rank, l.depth + 1
     FROM taxonomy t JOIN l ON t.reference_name = l.parent WHERE l.rank <> 'genus' AND l.depth < 10)
   SELECT CASE WHEN (SELECT rank FROM l WHERE depth = 0) IN ('genus','specie','subspecie','variety')
               THEN array_agg(reference_name ORDER BY depth) FILTER (WHERE rank IN ('genus','specie','subspecie','variety')) END
   FROM l)
  ```

- **Où il sert :**
  - `abProductions` (`lineage`) et `nonAbProductions`. Les productions hors AB sans culture sont désormais renvoyées, avec une lignée `null` ;
  - `crop-plans.ts`, dans le chargement des activités (`speciesLineage`).
- **Contrats** : aucun changement de réponse. Le constat est un `ControlFinding` habituel.

## 4. Tests

- **Domaine** (`certification-ab-ct5.test.ts`) :
  - le cas de l'issue (PPAM et prairie en `plant`) : pas de mixité, une note `na` ;
  - genre contre espèce : même variété, non conforme ;
  - variétés différentes : conforme ;
  - variété inconnue : à renseigner ;
  - deux espèces du même genre : rien ;
  - les tests existants, sans lignée : inchangés ;
  - `sameSpeciesForMixity` et `mixityLineage` à part.
- **Domaine** (`crop-plan-checks.test.ts`) : la mixité de l'assolement avec des lignées (générique ignorée, genre et espèce).
- **API** (`certification-ab.integration.test.ts` ou un nouveau fichier) : une ferme avec des PPAM `plant` en AB et une prairie `plant` hors AB, puis de l'avoine `avena` en AB et de l'avoine noire `avena_sativa` hors AB. Le contrôle AB 2026 donne la note, et pas de faux R7 ; la même variété d'avoine donne un R7 non conforme. La lignée est calculée par la vraie taxonomie.
