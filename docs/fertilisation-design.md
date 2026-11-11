# Plan prévisionnel de fumure et cahier d'enregistrement : conception

*2026-11-11. Statut : **proposé**, à valider (décisions en §13).*

## Ce que couvre ce document

- **Exigences** : [`fertilisation-exigences.md`](fertilisation-exigences.md), FR-FERT-1 à 40 et NFR-FERT-1 à 7.
- **Décisions du 2026-11-11** :
  - Fourmy calcule la dose et accepte une dose venue d'ailleurs ;
  - on part de la ferme de Pierre, en Nouvelle-Aquitaine ;
  - les tables COMIFER sont embarquées, avec leurs sources, et l'accord du COMIFER est demandé.
- **Règle de calcul** : le **référentiel régional Nouvelle-Aquitaine du 29/07/2025** et ses annexes. Elles ont été lues le 2026-11-11 ; les extraits sont dans `claudedocs/PPF/extraits/`. La conception suit ce référentiel plutôt que le guide COMIFER générique. C'est le référentiel qui est opposable, et il est bien plus simple à calculer (§1, D2).

## 1. Choix structurants

| # | Choix | Écarté | Pourquoi |
|---|---|---|---|
| D1 | **Calcul dans `packages/domain`** (`fertilization/`), en fonctions pures : un terme du bilan = une fonction qui rend `{ valeur, origine, détail }` | Service `services/agro` ; reprise du plugin Ekylibre | Mêmes raisons qu'ADR-17 : quelques centaines de lignes, testables et sans conteneur. Le plugin n'a ni tests ni sources sur ses valeurs, et couvre une région qui n'existe plus |
| D2 | **Écritures et tables du référentiel régional**, pas les formules COMIFER complètes. En Pyrénées-Atlantiques, le maïs suit l'annexe 2.2.b : X = [(Pf + Rf) − (Ri + Mh + Mhp + Mr + MrCi + Nirr + N avant 4 feuilles)] / CAU − Xa (Xa hors de la fraction, vérifié sur la page imprimée), avec Mh lu dans une table (sol × sec ou irrigué) et Ri estimé à partir de l'APL et de la pluie | Mh = TNorg × Km × JN, et les abaques de lixiviation | Le référentiel est la règle opposable (art. 3) et il ne demande pas d'analyse de terre complète. Les formules COMIFER restent possibles pour une autre région (§3.4) |
| D3 | **Référentiels en données versionnées dans le dépôt** (`packages/fertilization-refs`, JSON typés). Chaque table porte sa source, son texte, sa date et sa licence. Le PPF établi garde l'identifiant de version utilisé | Tables en base, administrées à l'écran ; abaques CSV à la manière d'Ekylibre | Les références changent par texte (arrêté, classement annuel des variétés), donc par version publiée et revue. Elles sont testées avec le code. La ferme ne modifie que des **valeurs à elle** (D4) |
| D4 | **Surcharges de la ferme en base** (`fertilization_overrides`) : une valeur, sa portée (ferme, parcelle ou produit), son motif et son justificatif. Exemples : Keq justifié, teneur de l'eau, référence locale de reliquat | Copier tout le référentiel par ferme | Le référentiel autorise ces adaptations (art. 6 et 8) à condition de les justifier. On garde la trace de qui, quand et pourquoi |
| D5 | **Un PPF par parcelle Fourmy et par campagne**, rattaché à la production principale. L'îlot PAC est affiché quand on le connaît | Regroupement en îlots culturaux | Les parcelles Fourmy de Pierre (« Monassut Maïs 2026 ») sont déjà des îlots culturaux : une culture sur une surface. Un regroupement viendra si une ferme le demande (question ouverte 6 des exigences) |
| D6 | **PPF versionné et figé** : brouillon (modifiable), puis établi (version 1 figée : termes, sources, version du référentiel), puis révisé (version n + 1, avec motif). Les versions sont des lignes immuables | Réécrire le PPF en place | NFR-FERT-2 : reproductible des années plus tard. FR-TIME : on retrouve « le PPF à une date » |
| D7 | **Cahier calculé, jamais stocké.** C'est une lecture des interventions réalisées, des productions, des récoltes et des couverts sur la campagne. Seules les données que Fourmy ne peut pas connaître sont saisies (couvert hors production, gestion des résidus) | Table « cahier » remplie à part | FR-FERT-19 : aucune double saisie. Une correction d'intervention (déjà tracée) corrige le cahier |
| D8 | **Contrôles réglementaires dans le cadre des contrôles phyto** : même contrat de résultat (`level`, indicateurs, motif de passage outre), affichés dans la saisie et enregistrés avec l'intervention | Un circuit à part | La saisie, la fiche d'intervention et le motif de passage outre existent déjà (lot 2). Le salarié voit les mêmes feux |
| D9 | **Éditions en pages HTML imprimables** (CSS d'impression, « Imprimer / PDF » du navigateur), plus des exports CSV | Génération PDF côté serveur (pdfkit, Chromium) | Aucune dépendance ni conteneur de plus, rendu identique à l'écran. Le registre phyto exporte déjà en CSV. Un PDF serveur reste possible si les contrôles l'exigent |
| D10 | **Zonage nitrates par commune** : les communes et leur statut (totale, partielle), tirés de l'arrêté de bassin, sont un référentiel. La commune d'une parcelle vient de l'API Géo de l'État (geo.api.gouv.fr, `communeAt` dans `packages/geo-ign`) : le service cadastre de l'API Carto répondait 404 le 2026-11-11. Une commune « partielle » est à confirmer par le responsable | Couche WFS Sandre interrogée en direct | La couche Sandre est encore en millésime 2021, alors que le zonage Adour-Garonne date du 24/08/2026. Une liste de communes datée et sourcée est plus sûre. Les sections cadastrales des communes partielles viendront ensuite |

## 2. Vue d'ensemble

```mermaid
flowchart LR
  subgraph Refs[packages/fertilization-refs<br/>données versionnées]
    R1[NA-2025 : écritures, tables<br/>b, Rf, Mh, Mr, MrCi, Mhp, Ri/APL,<br/>CAU, Nirr, PRO/Keq, plafonds,<br/>fractionnement, calendrier]
    R2[Zonage : communes ZV<br/>Adour-Garonne 2026]
    R3[Classement variétés blé<br/>par campagne]
  end
  subgraph Domain[packages/domain/fertilization]
    N[azote d'un apport]
    B[bilan : termes → dose]
    S[fractionnement]
    C[contrôles : calendrier,<br/>plafonds, conditions]
    Y[objectif de rendement]
  end
  subgraph Base[(PostGIS)]
    A[article_fertilizers<br/>product_analyses]
    P[fertilization_plans<br/>plan_versions]
    SO[parcel_soils + sol régional<br/>soil_analyses, water_sources]
    O[fertilization_overrides]
    I[interventions<br/>productions, récoltes]
    W[daily_weather]
  end
  API[routes/fertilization.ts] --> Domain
  API --> Base
  Domain --> Refs
  WEB[Web : PPF, cahier,<br/>saisie d'intervention, sol, produits] --> API
```

## 3. Domaine (`packages/domain/src/fertilization/`)

### 3.1 Azote d'un apport (FR-FERT-20)

```ts
nitrogenOfInput({ dose, unit, areaHa, composition }): { totalKgHa, mineralKgHa, basis } | { missing: "composition" | "unit" | "density" }
```

**Conversion de la dose** en masse ou en volume de produit par hectare. Les unités utilisées sont celles des interventions :
- `kilogram_per_hectare`, `ton_per_hectare`, `liter_per_hectare`, `cubic_meter_per_hectare` ;
- une quantité absolue divisée par la surface travaillée.

Un volume se convertit en masse avec la densité du produit : 1,3 pour la solution 390, et la notation Lexicon `_d1.3` est reprise.

**Teneur** :
- en % de la masse pour les engrais minéraux ;
- en kg N/t ou kg N/m³ pour les produits organiques.

**Efficace** : le minéral compte en entier. L'organique est multiplié par Keq, selon la famille du produit, le groupe de cultures réceptrice et la période d'apport (§3.3, Xa).

**Exemple (Pierre)** : 161 kg/ha de solution 390 à 30 % donnent 48,3 kg N total et 48,3 kg N efficace.

### 3.2 Objectif de rendement (FR-FERT-11, article 2 du référentiel)

```ts
yieldTarget(history: { campaign: number; yieldQHa: number; soilType?: string }[], campaign): { value, years, excluded, rule } | { missing }
```

**Règle de l'article 2** :
- on prend les 5 dernières campagnes **successives** de l'exploitation pour l'espèce ;
- on écarte la valeur la plus haute et la plus basse ;
- s'il manque une année, on remonte jusqu'à la 6e ;
- avec 5 valeurs ou plus pour un même type de sol, on reste sur ce type de sol ;
- sinon, la référence départementale (annexe « références de rendements » du 03/09/2025, par exemple maïs grain irrigué en 64 : 117 q/ha).

L'historique vient des sorties des interventions de récolte (quantité par hectare ou quantité ÷ surface).

**Exemple (Pierre, maïs, 2021 à 2025)** : rendements de 118,7 / 85,0 / 123,2 / 117,2 / 80,0 q/ha. Sans 123,2 ni 80,0, l'objectif est **107 q/ha**.

### 3.3 Bilan (FR-FERT-10, 11)

```ts
type TermValue = { value: number; origin: "computed" | "measured" | "reference" | "entered" | "override"; source: string; detail?: string };
type BalanceInput = { region, department, cropGroup, species, variety?, soilType, irrigated, opening, yieldTarget, precedent, coverCrop?, grassland?, organicInputs[], irrigationPlan?, rsh?, tillers?, overrides, refs };
computeDose(input): { terms: Record<Term, TermValue | { missing: string }>; equation: "additive" | "cau" | "cau_two_phase" | "pivot" | "ceiling"; dose: { efficient, total } | null; floor30: boolean; ceiling: number | null; warnings[] }
```

`computeDose` choisit l'écriture selon la région, le département, le groupe de cultures et parfois le type de sol (annexe 2). Chaque terme est **résolu** dans cet ordre :
1. surcharge de la ferme ;
2. mesure (analyse) ;
3. valeur calculée à partir des données Fourmy ;
4. référence régionale ;
5. sinon **manquant** (FR-FERT-39).

Le résultat est complet seulement si aucun terme n'est manquant.

**Termes pour la Nouvelle-Aquitaine (Pyrénées-Atlantiques)**

| Terme | Maïs (annexe 2.2.b) | Céréales à paille (2.1.b) | Données Fourmy |
|---|---|---|---|
| **Pf** | b × y ; b selon le palier : moins de 100 q, 2,3 ; de 100 à 120 q, 2,2 ; plus de 120 q, 2,1 | b par variété (classement de la campagne) ou par espèce (triticale 2,6…) | Objectif §3.2, variété de la production |
| **Rf** | Table par type de sol régional : argilo-calcaire 30, sableux 10, limoneux 30, terrasses 15, argileux 40… | Idem (tableau 3) | Type de sol régional de la parcelle (§4.3) |
| **Ri** | Mesure (reliquat) si elle existe. **Sinon, estimation** selon le cas : <br>1. Précédent ordinaire : **APL** = [(A + X préc. + Xa préc. + Mhp préc. + MrCi préc.) − Pf préc.] × coef RPR + Xa avant ouverture, puis Ri lu dans la table sol × APL × pluie du 01/10 au 01/05 ; <br>2. Légumineuse ; <br>3. Prairie ou jachère ; <br>4. Couvert : table par sol | (Ri + Pi) lu dans la table sol × APL × pluie | A : valeur annuelle d'Arvalis (paramètre de la campagne, 140 en 2025). X et Xa du précédent : **apports réalisés** de la campagne précédente. Pf du précédent : **rendement réalisé** × bp. Pluie : `daily_weather`, observée puis normales (comme au lot AB) |
| **Pi** | — | Selon les talles (10 à 40) si le reliquat est mesuré ; sinon compris dans Ri + Pi | Saisie (nombre de talles) |
| **Mh** | Table sol × sec ou irrigué (ou maïs doux et semence) : argilo-calcaire 25 ou 35, sableux 55 ou 70, limoneux 45 ou 60… | Table 11 | Parcelle irriguée (`parcel_soils.irrigated`, lot AB) |
| **Mhp** | Table destruction de printemps ou d'automne × rang × mode d'exploitation × âge | Idem | Historique des productions (prairie, âge, retournement) |
| **Mr** | Table du précédent × ouverture (sortie d'hiver ou avril) : maïs grain −10 ou 0, pailles enfouies −20 ou −10… | Idem | Production précédente et gestion des pailles (export ou enfouissement, d'après les interventions) |
| **MrCi** | Table famille × biomasse × destruction × ouverture | Pour les cultures de printemps seulement | Couvert d'interculture (§4.5) |
| **Nirr** | Q (mm) × T NO3 / 443, compté seulement au-delà de 100 mm. T de référence : 25 mg/L (eau de surface) ou 40 mg/L (eau souterraine), ou la mesure | Idem | Q prévu : irrigations saisies de la campagne précédente (lot AC), ou besoin simulé par le modèle de croissance. Origine de l'eau : point d'eau de la parcelle |
| **CAU** | **0,6 avant 4 feuilles, 0,8 après** : la dose se calcule **en deux temps** | 0,9 (0,8 en conditions défavorables, choix motivé) | — |
| **Xa** | Npro × Q × Keq « bilan » (annexe 5, selon la culture et la période) | Idem | Apports organiques prévus ou réalisés après l'ouverture |

**Résultat** :
- dose négative : aucun apport de type II ou III, et une alerte ;
- dose inférieure à 30 kg N : forfait de 30 kg proposé, à confirmer (article 12) ;
- toujours plafonnée par la dose plafond, quand il y en a une.

**Dose pivot et dose plafond** (annexes 3 et 4) : X + Nirr + Xa ≤ plafond, en azote efficace. Par exemple :
- autres cultures : 210 kg ;
- **vigne : 80 kg N minéral par an et 240 kg N efficace sur 3 ans** (cumul glissant contrôlé sur 3 campagnes) ;
- chanvre : 120 kg.

### 3.4 Autres régions

Ajouter une région, c'est :
- ses tables et son tableau « culture → écriture » dans `fertilization-refs` ;
- au besoin, une **variante d'écriture** dans le domaine, si elle n'existe pas encore.

Écritures prévues : additive [3'], CAU [4], CAU en deux temps (maïs Nouvelle-Aquitaine), efficience [4'], pivot, plafond.

Les formules COMIFER complètes (Mh = TNorg × Km × JN, à partir des jours normalisés tirés de `daily_weather` ; L selon la lame drainante) sont des **sources de terme** optionnelles. Elles servent quand un référentiel les demande, ou quand une ferme fournit une analyse complète. Elles ne font pas partie du premier lot.

### 3.5 Fractionnement (FR-FERT-13)

`splitPlan(dose, crop, region, sowing?)` propose des apports conformes au guide du PAR 7 Nouvelle-Aquitaine (tableaux 6 à 8) :

| Culture | Plafond du 1er apport | Nombre d'apports |
|---|---|---|
| Maïs semé avant le 1er mai | 50 kg efficaces, avant 4 feuilles | 2 au moins au-delà de 120 kg |
| Céréales d'hiver | 50 kg au tallage | 2 de 110 à 160 kg, 3 au-delà |
| Colza | 80 kg à la reprise | 2 de 80 à 170 kg, 3 au-delà |

Une option « réserve pour le pilotage » (40 kg par défaut) laisse le dernier apport « à ajuster ».

Pour le maïs, la part avant 4 feuilles entre dans le calcul (CAU 0,6) : la répartition et la dose sont **calculées ensemble**. Exemple : 50 kg avant 4 feuilles valent 30 kg efficaces ; le reste se divise par 0,8.

### 3.6 Contrôles (FR-FERT-25 à 30)

`checkFertilization(input)` rend des indicateurs au format des contrôles phyto (`ok`, `info`, `warning` ou `danger`, avec un message) :

| Code | Contrôle |
|---|---|
| `calendar` | Période d'interdiction selon le type de fertilisant, la culture en place ou à venir, la zone et les notes. Pyrénées-Atlantiques : fin le 15/01. Maïs irrigué : minéral permis jusqu'au brunissement des soies. Colza : 30 kg sous conditions. Les foliaires sont exemptés |
| `plan` | Pas de PPF établi (avertissement) ; dépassement de la dose du plan sans mesure de pilotage (avertissement) ; dose négative avec un type II ou III (danger) |
| `ceiling` | Dose plafond, et cumul sur 3 ans pour la vigne |
| `first_split` | 1er apport au-delà du plafond de fractionnement |
| `weather` | Sol gelé, enneigé ou détrempé, d'après la météo du jour (déjà connue de la saisie). Signalé comme probable, jamais comme certain |
| `water` | Distance aux cours d'eau (BD TOPO, déjà calculée pour les ZNT) : 2 m pour le type III, 35 ou 10 m pour les autres |
| `composition` | Teneur en N inconnue : l'apport est « à compléter » pour le cahier |
| `aplsh` (lot ultérieur) | Plafond de 70 kg d'APLSH sur couvert ou prairie |

Un `danger` se passe comme pour le phyto : un responsable force avec un motif, enregistré avec l'intervention.

## 4. Modèle de données (migration `0035_fertilization.sql`)

Toutes les tables ont une colonne `farm_id`, la politique RLS `farm_isolation` et les droits `fourmy_app`, comme les autres.

### 4.1 Produits (FR-FERT-5 à 8)

```sql
CREATE TABLE article_fertilizers (
  article_id      uuid PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  farm_id         uuid NOT NULL,
  -- Teneurs : % de la masse (minéraux) ou kg/t, kg/m³ (organiques).
  basis           text NOT NULL CHECK (basis IN ('mass_percent','kg_per_t','kg_per_m3')),
  n_total         numeric CHECK (n_total >= 0),
  n_mineral_share numeric CHECK (n_mineral_share BETWEEN 0 AND 1),   -- organiques : (NH4+NO3)/Ntot
  p2o5 numeric, k2o numeric, so3 numeric,
  density         numeric CHECK (density > 0),                       -- kg/L, pour les liquides
  regulatory_type text CHECK (regulatory_type IN ('0','Ia','Ib','II','III')),
  pro_family      text,          -- clé de la table des produits organiques du référentiel (Keq)
  foliar          boolean NOT NULL DEFAULT false,
  origin          text NOT NULL CHECK (origin IN ('proposed','confirmed','analysis','migrated')),
  source          text,          -- « étiquette », « Lexicon urea_46 », « Ekylibre », « référentiel NA annexe 5 »
  updated_by uuid, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE product_analyses (           -- analyses de produits organiques (FR-FERT-7)
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, article_id uuid NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  sampled_on date NOT NULL, dry_matter numeric, n_total numeric, n_nh4 numeric, c_n numeric, ismo numeric,
  basis text NOT NULL, lab text, document_id uuid, created_by uuid, created_at timestamptz DEFAULT now()
);
```

**Proposition de composition** (domaine, `proposeComposition`), essayée dans cet ordre :
1. Code Lexicon (`urea_46`, `ammonitrate_33`, `liquid_nitrogen_30_d1.3`) → table de correspondance dans `fertilization-refs` ;
2. Nom de forme NPK (`9,5-15-30`, `4-7-28`) → expression régulière ;
3. Famille de produit organique → teneur de l'annexe 5.

Le résultat a l'origine `proposed` tant que l'utilisateur ne l'a pas confirmé.

**Écarts de réalisation (lot AE, 2026-11-11)** :
- Le **nom passe avant le code Lexicon** : chez Pierre, « Solution azotée 32 » est rattachée par erreur à `ammonitrate_33`.
- La table des codes Lexicon est dans `packages/domain/src/fertilization/proposal.ts`, en attendant `fertilization-refs` (lot AF).
- La migration `0035_fertilizers.sql` ne crée que `article_fertilizers` et `product_analyses`. Les autres tables du §4 viendront avec leurs lots.
- L'azote d'un intrant est calculé **dans le navigateur** (fiche et saisie) par la fonction pure du domaine. Le cahier (lot AH) le recalculera côté serveur avec la même fonction.

**Migration Ekylibre** : les relevés `nitrogen_concentration`, `phosphorus_concentration` et `potassium_concentration` des variantes donnent une origine `migrated`. Pierre a 9 variantes concernées. Attention aux unités : `percent` ou `mass_percent`.

### 4.2 PPF (FR-FERT-9 à 18)

```sql
CREATE TABLE fertilization_plans (
  id uuid PRIMARY KEY, farm_id uuid NOT NULL,
  campaign_id uuid NOT NULL REFERENCES campaigns(id),
  land_parcel_id uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  production_id uuid REFERENCES productions(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'main' CHECK (kind IN ('main','cover_exported')),
  status text NOT NULL CHECK (status IN ('draft','established','revised')),
  draft jsonb NOT NULL DEFAULT '{}',        -- saisies du brouillon (valeurs, choix), pas les résultats
  current_version int,                      -- dernière version établie
  UNIQUE (campaign_id, land_parcel_id, kind)
);
CREATE TABLE fertilization_plan_versions (  -- immuables
  plan_id uuid REFERENCES fertilization_plans(id) ON DELETE CASCADE, version int, farm_id uuid NOT NULL,
  established_at timestamptz NOT NULL, established_by uuid NOT NULL,
  reason text,                               -- motif de révision (v > 1)
  referential text NOT NULL,                 -- « NA-2025-07-29@2026.1 »
  method text NOT NULL,                      -- 'cau_two_phase', 'ceiling'…
  external jsonb,                            -- dose venue d'ailleurs : { dose, tool, advisor, date, documentId }
  snapshot jsonb NOT NULL,                   -- entrées + termes {valeur, origine, source} + résultat (§3.3)
  dose_efficient numeric, dose_total numeric,
  PRIMARY KEY (plan_id, version)
);
CREATE TABLE fertilization_plan_applications (  -- apports prévus d'une version (FR-FERT-13)
  plan_id uuid, version int, rank int, farm_id uuid NOT NULL,
  planned_on date, stage text, article_id uuid REFERENCES articles(id),
  product_dose numeric, product_unit text, n_efficient numeric NOT NULL, n_total numeric NOT NULL,
  reserved_for_steering boolean NOT NULL DEFAULT false,
  PRIMARY KEY (plan_id, version, rank),
  FOREIGN KEY (plan_id, version) REFERENCES fertilization_plan_versions ON DELETE CASCADE
);
CREATE TABLE steering_measurements (        -- pilotage (FR-FERT-17)
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, plan_id uuid NOT NULL REFERENCES fertilization_plans(id) ON DELETE CASCADE,
  measured_on date NOT NULL, stage text, tool text NOT NULL, value text, advised_dose numeric, document_id uuid
);
```

**Pourquoi un instantané `snapshot`** : un PPF établi doit être relu tel quel, même si les références, la production ou le sol changent ensuite (D6). Les apports prévus ont leur propre table, pour comparer le prévu et le réalisé en SQL (FR-FERT-21).

### 4.3 Sol, analyses, eau (FR-FERT-31, 32)

```sql
ALTER TABLE parcel_soils
  ADD COLUMN soil_type text,               -- type régional (annexe 7 NA : 'argilo_calcaire', 'limoneux'…)
  ADD COLUMN soil_type_region text,        -- référentiel du type
  ADD COLUMN rooting_depth_cm int;
CREATE TABLE soil_analyses (
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, land_parcel_id uuid NOT NULL REFERENCES land_parcels(id) ON DELETE CASCADE,
  sampled_on date NOT NULL, kind text NOT NULL CHECK (kind IN ('rsh','post_harvest','soil')),
  horizons jsonb,      -- reliquat : [{fromCm,toCm,no3Kg,nh4Kg}] (kg N/ha) ou mg/kg + Da
  values jsonb,        -- analyse de terre : mo, c, n_total, clay, caco3, ph, cec, stones
  lab text, document_id uuid, created_by uuid, created_at timestamptz DEFAULT now()
);
CREATE TABLE water_sources (               -- points d'eau d'irrigation
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, name text NOT NULL,
  origin text NOT NULL CHECK (origin IN ('surface','groundwater')),
  nitrate_mg_l numeric, measured_on date, method text CHECK (method IN ('lab','strip')), document_id uuid
);
ALTER TABLE parcel_soils ADD COLUMN water_source_id uuid REFERENCES water_sources(id) ON DELETE SET NULL;
```

`parcel_soils` existe déjà (lot AB : réserve utile et irrigation) et devient la fiche sol de la parcelle.

**Type de sol proposé** :
- à partir de la réserve utile et de l'annexe 7 (classes de réserve utile) ;
- puis, plus tard, à partir de la carte des sols (RRP du GIS Sol), en lot ultérieur.

Le responsable confirme.

### 4.4 Zonage, campagne, surcharges, justificatifs

```sql
CREATE TABLE farm_nitrate_settings (       -- paramètres de la ferme (FR-FERT-1 à 4)
  farm_id uuid PRIMARY KEY, region text NOT NULL DEFAULT 'nouvelle-aquitaine',
  campaign_start_mmdd text NOT NULL DEFAULT '09-01'
);
CREATE TABLE parcel_nitrate_zones (        -- statut ZV par parcelle (calculé, puis confirmé)
  land_parcel_id uuid PRIMARY KEY REFERENCES land_parcels(id) ON DELETE CASCADE, farm_id uuid NOT NULL,
  insee text, status text NOT NULL CHECK (status IN ('in','partial','out','unknown')),
  zones text[] NOT NULL DEFAULT '{}',      -- 'zar', 'ouest', 'montagne'
  referential text NOT NULL, confirmed_by uuid, confirmed_at timestamptz, note text
);
CREATE TABLE fertilization_overrides (     -- D4
  id uuid PRIMARY KEY, farm_id uuid NOT NULL,
  scope text NOT NULL CHECK (scope IN ('farm','parcel','article')), scope_id uuid,
  term text NOT NULL,                      -- 'keq', 'ri_reference', 'nitrate_water', 'valueA'…
  key jsonb NOT NULL DEFAULT '{}', value numeric NOT NULL,
  reason text NOT NULL, document_id uuid, valid_from date, valid_to date,
  created_by uuid NOT NULL, created_at timestamptz DEFAULT now()
);
CREATE TABLE regulatory_documents (        -- justificatifs (FR-FERT-33) : PDF de labo, sortie d'outil
  id uuid PRIMARY KEY, farm_id uuid NOT NULL, kind text NOT NULL, name text NOT NULL,
  content_type text NOT NULL, bytes bytea NOT NULL, uploaded_by uuid, uploaded_at timestamptz DEFAULT now()
);
```

**Conservation** : les justificatifs et les versions de PPF ne sont jamais supprimés automatiquement. La suppression d'une parcelle est refusée tant qu'un PPF de moins de 5 campagnes la référence, comme `ON DELETE RESTRICT` sur les versions établies.

### 4.5 Couverts et gestion des résidus (FR-FERT-19, 23)

- **Couvert** : une **production** de nature `cover` (nouvelle valeur de `productions.nature`), entre deux cultures principales. Le semis et la destruction sont des interventions existantes. Elle porte l'espèce ou la famille, la biomasse estimée et le fait d'être exportée ou non. L'avoine de Pierre en 2025 est probablement un couvert, à confirmer.
- **Gestion des résidus du précédent** :
  - déduite des interventions (broyage, pressage, enlèvement de pailles) ;
  - sinon saisie dans le PPF : « pailles enfouies » ou « enlevées ».

## 5. Référentiels (`packages/fertilization-refs`)

```
fertilization-refs/
  src/
    index.ts                    # chargement typé, versions, recherche
    regions/nouvelle-aquitaine/
      2025-07-29/               # arrêté référentiel
        meta.json               # texte, date, URL, version du paquet
        methods.json            # culture → écriture (annexe 1, par département)
        b.json  rf.json  mh.json  mr.json  mrci.json  mhp.json
        ri-apl.json  coef-rpr.json  value-a.json (par année)
        cau.json  nirr.json  pro.json (Npro, Keq bilan/cycle/Ri)
        ceilings.json  pivots.json  yields-2025-09-03.json
        splitting-par7.json     # guide PAR 7, tableaux 6 à 8
    calendars/pan7-2023/        # data.gouv.fr (Licence Ouverte 2.0) + notes PAN 7
    zoning/adour-garonne-2026-08-24.json
    varieties/wheat-2026.json   # classement Arvalis/COMIFER de la campagne
    lexicon-fertilizers.json    # code Lexicon → composition
  test/                         # chaque table : forme, unités, clés, sources présentes
```

**Chaque fichier** porte `{ source: { title, organisation, url, date, page }, licence, rows }`.

**Version** : celle du paquet, plus la date du texte. Elle est inscrite dans chaque version de PPF.

**Saisie des tables** : beaucoup de tables des annexes sont du texte extractible (`pdftotext`) ; certaines sont des images et seront saisies à la main. Un test de cohérence recalcule les **exemples** des annexes (par exemple Nirr : 160 mm à 40 mg/L donnent 14 kg).

**Mentions** : COMIFER, INRA (AZOBIL), Arvalis, GREN Nouvelle-Aquitaine sur chaque table. La demande d'accord au COMIFER est une tâche du lot AF.

### 5.1 Saisie des tables (lot AF, 2026-11-11)

Les tables ont été recopiées des annexes, puis vérifiées sur les pages imprimées. Le paquet `@fourmy/fertilization-refs` passe 139 tests : effectifs, valeurs vérifiées une à une, sources, et les 30 exemples Nirr imprimés recalculés par `round(mm × NO3 / 443)`.

**Contenu du paquet** :
- maïs et céréales en bilan CAU : b, Rf, Pi, grilles Ri ou APL × pluie, Mh, Mhp, Mr, MrCi, CAU, Nirr, valeur A ;
- colza, pivot du tournesol, plafonds (légumes, légumineuses, couverts, autres cultures, vigne) ;
- produits organiques : 71 produits et 852 Keq ;
- méthodes par culture et par département, types de sols, rendements de référence, préconisations des reliquats ;
- fractionnement du PAR 7 ;
- calendrier du PAN 7 pour la Nouvelle-Aquitaine (jeu data.gouv du 09/09/2025, 4 306 communes) ;
- zonage Adour-Garonne 2026 (3 312 communes) ;
- variétés de blé 2026.

**Ce que la saisie a appris, et que le moteur du lot AG devra traiter** :
- **Xa reste hors de la fraction** : X = [(Pf + Rf) − (…)] / CAU − Xa.
- **Seuil Nirr** : 100 mm pour le maïs, 120 mm pour les céréales, au-delà strictement. Les tables d'exemple commencent pourtant à 100 mm.
- **Premier apport sur maïs** : le texte dit à la fois « 50 kg d'azote efficace » et « dose < 50 kg ». Il faut retenir la lecture la plus prudente et l'afficher.
- **Valeurs aux bords** : rien ne prévoit les valeurs hors des grilles APL × pluie (APL > 100 kg, pluie hors colonnes) ni les bornes ambiguës (MrCi à 1 et 3 t, prairie de 18 mois à 2 ans). Le moteur refuse et demande une mesure ; il n'extrapole pas.
- **Sols sans estimation** : les sols de marais et sur granite n'ont pas d'estimation de Ri. Il faut une mesure.
- **Keq** : un apport avant l'ouverture prend Keq cycle = Keq Ri + Keq bilan ; un apport après prend Keq bilan = Keq cycle. Les cases `nr`, `ng` et « dire d'expert » demandent une valeur justifiée par la ferme (surcharge).
- **Incohérences des annexes**, recopiées telles quelles et signalées dans les notes des tables :
  - maïs doux : b de 10 ou 12 inversés entre le tableau 1 et le tableau 7 ;
  - avoine : 2,2 contre 2,5 ; blé dur : 3,7 contre 3,5 ;
  - tourteaux de ricin : Keq de 0,7 sur maïs.
- **Calendrier** : Monassut-Audiracq et Saint-Laurent-Bretagne sont en **zone ouest et zone sud** (jeu data.gouv). Pour les céréales d'automne et le type III, l'interdiction court du 01/09 au 15/01 en zone sud, et du **01/07 au 15/01 en zone ouest**, avec des exemptions en juillet-août.
- **Statut ZV du jeu data.gouv** : il date d'avant l'arrêté de 2026 ; 85 communes de Nouvelle-Aquitaine y sont encore « hors ZV ». Le statut ZV vient donc de l'arrêté de bassin, et seuls les drapeaux de zone viennent du calendrier.

### 5.2 Réalisation du calcul (lot AG, 2026-11-11)

- **Écritures calculées** :
  - maïs et sorgho en bilan CAU en deux temps (annexe 2.2.b) ;
  - céréales à paille en bilan CAU (2.1.b) ;
  - dose plafond des autres cultures (annexe 4.4), dont la vigne : 80 kg par an, avec le rappel des 240 kg sur 3 ans.
- **Pas encore calculés** : colza, tournesol (dose pivot), tabac, lin, prairies. Le plan l'indique et accepte la dose d'un outil ou d'un conseiller.
- **Départements 16, 17, 79, 86** : l'annexe permet le bilan additif ou le bilan CAU. L'écriture CAU est retenue, comme dans le reste de la région.
- **Lecture des grilles Ri** : interpolation bilinéaire entre les cases voisines, signalée dans le détail du terme.
  - Une pluie au-delà de la dernière colonne est lue dans cette colonne, où les valeurs plafonnent.
  - Un APL au-delà de 100 kg, ou une pluie en deçà de la première colonne, rend Ri manquant : reliquat à mesurer.
  - Un APL négatif vaut 0.
- **Arrondi** à l'unité sans l'erreur des flottants : 95 × 2,3 = 218,5, arrondi à 219.
- **Pluie** du 1er octobre au 1er mai pour le maïs et au 1er mars pour les céréales, tirée de la météo en cache du modèle de croissance. Les jours à venir prennent les normales, et l'écran le dit.
- **Objectif de rendement** : moyenne olympique des campagnes de la ferme pour la même culture. Le rendement d'une campagne est la moyenne des rendements à l'hectare des récoltes. À défaut, la référence départementale (statistique agricole annuelle).
- **Précédent** :
  - c'est la production de la campagne précédente qui recouvre au moins la moitié de la parcelle (les parcelles de Pierre changent de nom chaque année) ;
  - son azote minéral est la somme des apports de type III comptés ;
  - les apports incalculables (teneur inconnue, type à préciser) sont listés en avertissement.
- **Pas encore faits** :
  - Xa (produits organiques) : il faut rattacher le produit à sa ligne Keq de l'annexe 5 ;
  - le stade et l'outil de pilotage ;
  - les valeurs de la ferme à l'échelle de toute l'exploitation : les surcharges sont propres à chaque plan.

## 6. Contrats (`@fourmy/contracts`, `fertilization.ts`)

- `FertilizerComposition`, `ArticleFertilizerWrite` : zod, unités explicites.
- `BalanceTerm`, `TermValue`, `BalanceResult` (§3.3), `PlanStatus`, `FertilizationPlan`, `PlanVersion`, `PlannedApplication`, `PlanWrite` (brouillon), `PlanEstablish`, `PlanExternalDose`.
- `NitrateZoneStatus`, `ParcelNitrateZone`.
- `SoilAnalysis`, `WaterSource`, `Override`.
- `FertilizationCheck`, intégré à `ComplianceResult`. Les nouveaux codes d'indicateur sont `fert_calendar`, `fert_plan`, `fert_ceiling`, `fert_first_split`, `fert_weather`, `fert_water` et `fert_composition` ; ils restent rétrocompatibles.
- `NitrogenRecordLine` : une ligne du cahier (îlot, interculture, culture, apports, rendement, pratiques).

## 7. API (sous `/api/v1/farms/:farmId`)

| Route | Rôle | Qui |
|---|---|---|
| `GET /fertilization/status?campaign=` | Tableau de bord : parcelles en zone vulnérable, PPF (état, dose), apports à compléter, dépassements, analyse annuelle | membres |
| `GET`/`PUT /fertilization/settings` · `GET`/`PUT /land-parcels/:id/nitrate-zone` | Région, campagne ; statut ZV calculé puis confirmé | responsable pour l'écriture |
| `GET`/`PUT /articles/:id/fertilizer` · `POST /articles/:id/analyses` | Composition, proposition, analyses de produit | responsable |
| `GET /fertilization/plans?campaign=` · `GET /fertilization/plans/:id` (`?version=`) | PPF de la campagne ; un PPF avec ses versions | membres |
| `POST /fertilization/plans/prepare?campaign=` | Brouillons pré-remplis pour toutes les parcelles (FR-FERT-16) | responsable |
| `PUT /fertilization/plans/:id/draft` · `POST /fertilization/plans/:id/compute` | Saisies du brouillon ; calcul, sans enregistrer de version | responsable |
| `POST /fertilization/plans/:id/establish` (`{ reason?, external? }`) | Fige une version (v1, ou v n+1 avec motif) | responsable |
| `POST /fertilization/plans/:id/steering` | Mesure de pilotage (puis révision proposée) | responsable |
| `GET`/`POST /land-parcels/:id/soil-analyses` · `GET`/`POST /water-sources` · `PUT /land-parcels/:id/soil` (élargi) | Sol, analyses, eau | responsable pour l'écriture |
| `GET`/`POST`/`DELETE /fertilization/overrides` | Surcharges justifiées | responsable |
| `POST /fertilization/check` | Contrôles d'un apport en cours de saisie, comme `POST /phyto/check` | membres |
| `GET /fertilization/record?campaign=&format=json\|csv` | Cahier d'enregistrement | membres |
| `GET /fertilization/print/plan?campaign=` · `…/print/record` | Données des éditions (pages imprimables) | membres |
| `POST /regulatory-documents` · `GET /regulatory-documents/:id` | Justificatifs | responsable, membres |

**À la création ou modification d'une intervention de forme `fertilization`** (et d'un semis avec engrais), l'API :
- calcule l'azote apporté ;
- lance `checkFertilization` ;
- enregistre le résultat avec l'intervention, comme la conformité phyto.

Un `danger` sans motif est refusé (422), avec le même message que pour le phyto.

## 8. Écrans web

- **Menu Réglementaire → « Fertilisation azotée »**, à côté du registre phyto. Un tableau par campagne : parcelle, îlot PAC, zone vulnérable, culture, état du PPF, dose, apporté ou restant, alertes. Boutons :
  - « Préparer les PPF de la campagne » ;
  - « Cahier d'enregistrement » ;
  - « Imprimer ».
- **Fiche PPF** (une parcelle et une campagne) :
  1. Contexte : culture, variété, précédent, sol, irrigation, zone.
  2. **Bilan** : un tableau des termes avec valeur, origine (pastille calculé, mesuré, référence, saisi ou surchargé), source au survol et modification (une surcharge demande un motif). La formule de l'écriture est affichée en tête.
  3. Dose efficace et dose totale, forfait de 30 kg, plafond.
  4. Apports prévus : proposition de fractionnement modifiable, produit, dose de produit.
  5. Dose venue d'ailleurs : saisie, document joint, écart avec le calcul de Fourmy.
  6. « Établir » (puis « Réviser », avec motif) et historique des versions.
- **Cahier** :
  - une section par parcelle : interculture, culture, apports (date, surface, produit, teneur, N total, N efficace), rendement, pratiques ;
  - lignes « à compléter » en jaune ;
  - impression.
- **Saisie d'une intervention de fertilisation** :
  - l'azote apporté par hectare s'affiche à côté de la dose ;
  - la dose restante du PPF ;
  - feux des contrôles, comme pour le phyto ;
  - motif pour forcer.
- **Fiche parcelle**, onglet « Sol » : type de sol régional, réserve utile, profondeur, point d'eau, analyses (reliquats, terre), statut ZV.
- **Article fertilisant** (Stocks) : composition, origine (proposée ou confirmée), analyses.
- **Pages imprimables** `/f/:farmId/print/fertilization/plan|record?campaign=`, sans menu, avec des sauts de page par parcelle. Elles portent les mentions réglementaires, la version du référentiel et la date d'impression.

## 9. Pré-remplissage de la campagne (FR-FERT-16)

Pour chaque parcelle ayant une production principale dans la campagne :

| Donnée | D'où elle vient |
|---|---|
| Culture et variété | La production. Le groupe de cultures vient de l'espèce (`zea_mays` donne maïs grain par défaut ; le fourrage se choisit) |
| Précédent | La production de la campagne précédente sur la même parcelle, ou sur la parcelle de même géométrie : les versions changent de nom chaque année chez Pierre, d'où le recoupement géométrique, comme au lot AB |
| Gestion des pailles | Interventions de pressage ou d'enlèvement après la récolte du précédent |
| Ouverture du bilan | Culture de printemps : date de semis prévue, ou le 1er avril. Culture d'hiver : le 1er février |
| Objectif de rendement | §3.2 |
| Sol, irrigation, point d'eau | `parcel_soils` |
| Nirr | Total des irrigations saisies l'an passé, sinon besoin simulé par le modèle de croissance |
| Ri | Reliquat de la campagne s'il existe, sinon estimation APL : précédent réalisé, valeur A, pluie |
| Apports organiques | Ceux déjà réalisés après la récolte du précédent |

Les termes encore **manquants** sont listés (« à compléter ») sur le tableau de la campagne.

## 10. Lots

| Lot | Contenu | Exigences |
|---|---|---|
| **AE — Produits et azote apporté** | `article_fertilizers`, proposition de composition (Lexicon, NPK, organiques), migration Ekylibre des teneurs, azote d'un apport dans la saisie et la fiche d'intervention, contrôle `composition` | FR-FERT-5, 6, 7, 20 |
| **AF — Référentiels, sol et zonage** | `packages/fertilization-refs` (Nouvelle-Aquitaine 2025, calendrier PAN 7, zonage Adour-Garonne 2026, variétés de blé 2026), type de sol régional, analyses de sol, points d'eau, statut ZV par parcelle, paramètres de la ferme. Demande d'accord au COMIFER | FR-FERT-1 à 4, 31, 32, 37 à 39 |
| **AG — PPF et calcul** | Domaine (objectif, bilan maïs, céréales, colza, plafonds, fractionnement), PPF versionné, préparation de la campagne, dose venue d'ailleurs, surcharges, écrans PPF | FR-FERT-9 à 16, 38 |
| **AH — Cahier, contrôles et éditions** | Cahier calculé, couverts (`productions.nature = cover`), contrôles calendrier, plan, plafond, fractionnement, météo, eau, pages imprimables et CSV, tableau de bord, justificatifs | FR-FERT-19 à 23, 25, 26, 30, 33, 34, 36 |
| AI — ensuite | Pilotage et révision, APLSH, grille d'efficacité, couverture des sols, lien avec la modulation, rôle conseiller, mobile | FR-FERT-17, 18, 27 à 29, 35, 40 ; NFR-FERT-7 |

## 11. Tests

- **Domaine** :
  - azote d'un apport (unités, densité, organique avec Keq) ;
  - objectif de rendement (règle olympique, 6e année, référence départementale) ;
  - **cas chiffrés des annexes**, termes et dose de bout en bout :
    - maïs en Pyrénées-Atlantiques, sol limoneux irrigué, précédent maïs grain, sans reliquat (estimation APL) ;
    - céréale d'hiver avec talles ;
    - vigne en plafond, cumul sur 3 ans ;
  - fractionnement du maïs en deux temps (CAU 0,6 et 0,8) ;
  - calendrier : Pyrénées-Atlantiques, maïs irrigué, foliaire exempté, colza 30 kg.
- **Référentiels** : forme, unités, présence des sources, et recalcul des exemples imprimés dans les annexes (tableaux Nirr, APL).
- **API (intégration)** :
  - préparation de la campagne sur une ferme synthétique ;
  - établissement, puis révision : la v1 reste lisible à l'identique après un changement du sol ;
  - intervention hors calendrier refusée sans motif ;
  - cahier tiré des interventions ;
  - droits (salarié en lecture).
- **Recette sur la ferme de Pierre** :
  - PPF maïs 2027 : objectif de 107 q/ha (§3.2), apports 2026 comme précédent ;
  - cahier 2026 : ses 7 apports de 2026.
  - Comparaison avec la dose de son conseiller, s'il en a une (question ouverte 5).

## 12. Risques et points ouverts

1. **Saisie des tables des annexes** : environ 130 pages, dont des tables en image ; c'est le gros du lot AF. Une erreur de saisie fausse une dose. Contre-mesure : double relecture et recalcul des exemples des annexes.
2. **Accord du COMIFER** (et de l'INRA pour Rf) : en attendant, les mentions de source sont affichées, et le référentiel régional, document administratif public, est la source principale.
3. **Labellisation COMIFER** : à demander après le lot AG, avec ce document et les tests de cas chiffrés. La tolérance de 2 ans court depuis le 08/08/2025, donc jusqu'au 08/08/2027.
4. **Type de sol régional** : Pierre ne l'a pas saisi ; la réserve utile seule ne suffit pas toujours. À demander à Pierre : limons, terrasses ou boulbènes du Béarn ?
5. **Valeur A et classement des variétés** : publiés chaque année (A en début d'année, variétés en février). Fourmy doit dire quand la valeur de l'année manque et utiliser la valeur par défaut du tableau 6, avec la mention.
6. **Arrêté PAR 7 Nouvelle-Aquitaine scanné** : le calendrier « zone Ouest » reste à confirmer. Le jeu data.gouv.fr (calendrier par commune) devrait le contenir ; à vérifier au lot AF.
7. **Couverts** : nouvelle nature de production, avec un impact sur le plan 3D (rangs et couvert) et le modèle de croissance, qui doivent l'ignorer ou l'afficher.

## 13. Décisions à valider

| # | Question | Proposition |
|---|---|---|
| V1 | Écritures du référentiel régional plutôt que formules COMIFER complètes (D2) | **Oui** |
| V2 | Référentiels en données versionnées dans le dépôt, surcharges en base (D3, D4) | **Oui** |
| V3 | Un PPF par parcelle Fourmy (D5), sans regroupement en îlots pour l'instant | **Oui** |
| V4 | Éditions en pages imprimables (D9), sans PDF serveur | **Oui** |
| V5 | Couvert = production de nature `cover` (§4.5) | **Oui** |
| V6 | Ordre des lots : AE, AF, AG, AH, puis AI | **Oui** ; AE et AF peuvent avancer en parallèle |
