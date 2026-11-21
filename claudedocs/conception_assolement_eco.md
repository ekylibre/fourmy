# Assolement prévisionnel — conception du temps 3 (économique)

*Conception du 21/11/2026, à partir de [`besoins_assolement.md`](besoins_assolement.md) §6 (FR-AS-30 à 34) et des décisions A11, A12 et A16 à A19. Issue #115. S'appuie sur le temps 2 ([`conception_assolement_itk.md`](conception_assolement_itk.md)) : besoins en intrants (IT5), heures de travail et barème BCMA (IT4). Étape suivante : plan en lots, [`workflow_assolement_eco.md`](workflow_assolement_eco.md).*

## 0. Décisions (21/11/2026)

| # | Décision | Conséquence |
|---|---|---|
| A16 | **Prix de vente** saisis par la ferme ; par défaut, les prix Lexicon des productions (cours MATIF, prix européens), avec leur source et leur date. L'API agrifood reste l'objectif, avec un cache. | Deux sources de prix de vente dès le premier lot : Lexicon (chargé) et la saisie. Le client agrifood est écrit, mis en cache et interrogé en tâche de fond ; tant qu'il échoue, Lexicon sert de valeur par défaut. |
| A17 | **Prix des intrants** : un prix par article de la ferme, saisi ; le prix Lexicon est proposé quand il existe. | Table de prix datés de la ferme. Suggestions Lexicon (engrais, phyto, semences, jeux réservés aux adhérents) si le bundle « fourmy » les donne ; sinon la saisie seule. |
| A18 | **Main-d'œuvre** : coût horaire dans les réglages. **Matériels** : coût BCMA « façons culturales » (fixe + variable, carburant compris). | Pas de prix du carburant séparé (déjà dans le coût variable du barème). Les tracteurs se rattachent aussi au barème (coût à l'heure). |
| A19 | **Première version** : produit, charges opérationnelles, marge brute, mécanisation, main-d'œuvre, marge directe ; en prévu, comparé à la campagne précédente. | Charges indirectes réparties par clé et réalisé détaillé : hors temps 3. |

## 1. Principes

| # | Principe | Pourquoi |
|---|---|---|
| E1 | **Un prix est daté et sourcé** : montant HT, unité, date d'effet, source (ferme, Lexicon, BCMA, agrifood) et référence. Changer un prix ajoute une ligne ; l'ancien reste. | FR-AS-31 ; on refait un calcul passé avec les prix de l'époque. |
| E2 | **Calculs purs dans `@fourmy/domain/economics`**, dans le navigateur, sur le brouillon d'assolement, comme les temps de travaux et les intrants. | Réactivité (NFR-AS-2), un seul code. |
| E3 | **Jamais de zéro muet** : un prix inconnu laisse le poste « incomplet », compté et listé (I4 du temps 2). | Une marge sans le prix du semis serait fausse sans le dire. |
| E4 | **Les quantités viennent du temps 2** : besoins en intrants (`inputNeeds`), heures de matériel et de main-d'œuvre (`workload`). Le temps 3 ne fait que les valoriser. | Pas deux calculs des mêmes quantités. |

## 2. Données

### 2.1 Prix de la ferme (migration 0080)

```sql
CREATE TABLE prices (
  id           uuid PRIMARY KEY,
  farm_id      uuid NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('article', 'labour', 'equipment', 'service', 'product')),
  article_id   uuid REFERENCES articles(id) ON DELETE CASCADE,      -- article
  equipment_id uuid REFERENCES equipments(id) ON DELETE CASCADE,    -- equipment (coût propre, à la place du barème)
  activity_id  uuid REFERENCES activities(id) ON DELETE CASCADE,    -- product
  product      text,              -- product : « grain », « paille »… (un ou plusieurs produits par activité, FR-AS-32)
  procedure    text,              -- service : prestation par procédure (ETA)
  unit         text NOT NULL,     -- unité du montant : ton, quintal, kilogram, liter, hour, hectare, unité de l'article
  amount       numeric NOT NULL CHECK (amount >= 0),   -- € HT par unité
  valid_from   date NOT NULL,
  source       text NOT NULL CHECK (source IN ('farm', 'lexicon', 'bcma', 'agrifood', 'purchase')),
  source_ref   text,              -- identifiant de la source (prix Lexicon, code agrifood, ligne BCMA)
  source_date  date,              -- date du prix dans la source
  created_at   timestamptz NOT NULL DEFAULT now(),
  created_by   uuid,
  CHECK ((kind = 'article') = (article_id IS NOT NULL)),
  CHECK ((kind = 'equipment') = (equipment_id IS NOT NULL)),
  CHECK ((kind = 'product') = (activity_id IS NOT NULL AND product IS NOT NULL)),
  CHECK ((kind = 'service') = (procedure IS NOT NULL))
);
-- Prix en vigueur : le dernier valid_from ≤ date, par clé (kind, article, matériel, activité + produit, procédure).
-- RLS farm_isolation ; une seule ligne 'labour' par date (coût horaire).
```

### 2.2 Références Lexicon chargées (migration 0080, synchronisation)

| Table Fourmy | Jeu Lexicon | Accès | Usage |
|---|---|---|---|
| `lexicon_production_yields` | `productions.master_production_yields` | libre | rendement Agreste par production, département et campagne (défaut du rendement prévisionnel) |
| `lexicon_production_prices` | `productions.master_production_prices` | libre | cours MATIF et prix de marché par espèce (défaut du prix de vente) |
| `lexicon_market_prices` | `eu_market_prices` | libre | prix européens par produit et marché (repli des prix de vente, copie de l'API agrifood) |
| `lexicon_input_prices` | `fertilizers`, `phytosanitary_prices`, `seeds` | adhérents | prix des intrants proposés (si le bundle « fourmy » les donne, sinon absents) |

### 2.3 Prix de vente agrifood (A12, A16)

- Table `market_prices` : code produit, marché, stade, semaine, prix €/t, récupéré le. Remplie par une tâche du worker (une fois par semaine), qui interroge `GET /api/cereal/prices` pour les codes utilisés par la ferme ; échec → rien n'est effacé, l'erreur est journalisée.
- Correspondance code produit → espèce et débouché (`BLTPAN`, `BLTFOUR`, `ORGBRAS`…) reprise de Lexicon (`eu_market_prices.rb`), dans `@fourmy/certification-refs/src/economics/eu-market-codes.ts`.

### 2.4 Prévisions de la production (existant, réservé au temps 1)

`Assignment.forecasts` : `{ product, yield, unit, price?, currency }[]`, recopié dans `productions.attrs.forecasts` à la validation (comme `itineraryId`). Absent : défauts calculés (§3.2).

### 2.5 Réglages

`farm_settings.crop_plan.economics` : coût horaire de la main-d'œuvre (€/h), et option « matériels à leur coût horaire BCMA pour la route ».

## 3. Règles du domaine (`packages/domain/src/economics/`)

### 3.1 Prix en vigueur

`priceAt(prices, key, day)` : dernier prix de la clé à la date. `convertPrice(price, toUnit, ctx)` : €/t → €/q, €/kg → €/t, €/L ↔ €/kg par la densité (unités du stock, fonctions du temps 2) ; inconvertible → null.

### 3.2 Rendement et prix de vente par défaut

Pour une production, dans l'ordre :
1. **saisis** dans l'assolement (`forecasts`) ;
2. **rendement** : médiane des récoltes de la ferme pour l'activité sur les 3 dernières campagnes (sorties des interventions de récolte ramenées à l'hectare), sinon rendement Agreste du département (Lexicon), sinon inconnu ;
3. **prix** : prix « produit » de la ferme pour l'activité (table `prices`), sinon dernier prix agrifood du code de l'activité, sinon dernier prix Lexicon (MATIF, marché), sinon inconnu.

Chaque valeur affiche sa source (« 112 q/ha, médiane 2024-2026 de la ferme », « 250,50 €/t, MATIF déc. 2025, Lexicon »).

### 3.3 Charges

- **Opérationnelles** : `inputNeeds` (temps 2) par production × prix en vigueur de l'article (converti dans l'unité du stock). Intrant générique ou sans prix → poste incomplet.
- **Mécanisation** : pour chaque passage daté (`workload`) et chaque matériel de l'étape :
  - ligne BCMA à l'hectare → coût par unité (€/ha) × surface ;
  - ligne BCMA à l'heure (tracteur) → coût par heure × heures (champ + route) ;
  - prix propre du matériel (table `prices`, kind `equipment`) prioritaire sur le barème ;
  - type du barème sans matériel de la ferme → coût BCMA de la ligne, ou prix de prestation de la procédure (kind `service`) s'il existe.
- **Main-d'œuvre** : heures des personnes (`workload`) × coût horaire des réglages.

### 3.4 Indicateurs (FR-AS-33, A19)

Par production, par activité (somme et à l'hectare) et pour l'assolement :

| Indicateur | Calcul |
|---|---|
| Produit | Σ rendement × surface × prix, par produit |
| Charges opérationnelles | intrants valorisés |
| **Marge brute** | produit − charges opérationnelles |
| Mécanisation | matériels valorisés |
| Main-d'œuvre | heures × coût horaire |
| **Marge directe** | marge brute − mécanisation − main-d'œuvre |

Chaque poste porte un drapeau « incomplet » et la liste de ce qui manque (prix d'un article, rendement, coût horaire).

### 3.5 Comparaison avec la campagne précédente (A19)

Colonne N-1 par activité :
- **prévu N-1** si un assolement N-1 avec ITK existe ;
- sinon **réalisé N-1 simplifié** : produit = récoltes enregistrées × prix ; charges opérationnelles = intrants des interventions réalisées × prix ; mécanisation et main-d'œuvre = heures réalisées (périodes ≤ 24 h, règle de la recette du temps 2) × coûts.

## 4. API

| Méthode et chemin | Rôle |
|---|---|
| `GET /prices?kind=&at=` | Prix en vigueur à la date, par clé, avec l'historique sur demande (`?history=1`). Membres. |
| `POST /prices` | Ajout en masse (`{ items: PriceWrite[] }`), une ligne datée par prix ; responsable. |
| `DELETE /prices/:id` | Retire une ligne saisie par erreur ; responsable. |
| `GET /prices/suggestions?kind=article` | Pour chaque article : prix Lexicon proposé (par AMM pour un phyto, par nom pour un engrais ou une semence), avec sa date et sa méthode (observé, estimé). |
| `GET /crop-plans/:year/eco-context` | Prix en vigueur, rendements et prix par défaut par activité (et leurs sources), coût horaire, campagne précédente (prévu ou réalisé simplifié). |

## 5. Interface

- **Module « Économique »** (menu principal, `/f/:ferme/economics`), un onglet par nature (FR-AS-30) :
  - **Intrants** : articles (semences, engrais, phyto, autres) avec le prix en vigueur, sa source et sa date, le prix Lexicon proposé (« Reprendre »), la saisie ;
  - **Matériels** : ligne du barème et coûts BCMA (€/ha ou €/h), prix propre facultatif ; tracteurs rattachables ;
  - **Main-d'œuvre** : coût horaire ;
  - **Services** : prestations par procédure (€/ha) ;
  - **Produits** : prix de vente par activité et produit, avec agrifood et MATIF proposés.

  Modification en masse : sélection de lignes, puis « prix à… » ou « + x % », avec une date d'effet.
- **Assolement, panneau Affecter** : rendement et prix prévus, préremplis par défaut avec leur source, modifiables.
- **Assolement, onglet « Économie »** : indicateurs par activité (total et à l'hectare), total de l'assolement, colonne N-1, postes incomplets listés avec un lien vers le module.

## 6. Tests

| Niveau | Contenu |
|---|---|
| Domaine | prix en vigueur à une date ; conversions de prix (€/t ↔ €/q, €/L ↔ €/kg par la densité) ; rendement par défaut (historique > Agreste) ; marges sur un exemple chiffré à la main ; postes incomplets ; mécanisation (barème à l'hectare, à l'heure, prix propre, prestation) |
| API | prix datés (ajout en masse, en vigueur à une date, droits) ; suggestions Lexicon ; contexte (défauts et sources) ; client agrifood (réponse, erreur 500, cache) |
| Web | module Économique (saisie, masse, reprise d'une suggestion) ; onglet Économie |
| e2e | prix saisis, assolement avec ITK, onglet Économie : marge directe affichée et postes incomplets |

## 7. Risques

| Risque | Parade |
|---|---|
| L'API agrifood reste en panne | Lexicon (MATIF, prix européens) par défaut, source affichée ; la tâche réessaie chaque semaine |
| Jeux de prix Lexicon réservés absents du bundle | La saisie suffit ; vérifié au lot E2, sinon demande à l'équipe Lexicon |
| Unités hétérogènes (articles repris : « Kilogramme », « Sac de 50 000 grains ») | Conversions du temps 2 ; un prix inconvertible rend le poste incomplet, jamais nul |
| Rendements de la ferme mal saisis (unités, surfaces) | Médiane, bornes de vraisemblance par espèce, source affichée ; saisie prioritaire |
