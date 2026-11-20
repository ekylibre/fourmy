# Semences — expression des besoins

*Brainstorm du 20/11/2026. Étapes suivantes : `/sc:design` (conception), puis `/sc:workflow` (plan).*

## 1. Contexte

Demande : une entrée **Stocks → Semences**, à partir des semences de Lexicon et de celles des interventions, avec le **PMG** (poids de mille grains), qui permet de passer d'une dose en grains à une masse.

### Dans Fourmy aujourd'hui

- **Articles** `kind = 'seed'`. Colonnes utiles : `name`, `unit`, `lexicon_ref`, `organic_status`, `seed_treated`. Les imports Geofolia et DAPLOS écrivent aussi `custom.species` et `custom.gnis`.
- **Pas de page dédiée.** Les semences n'apparaissent que dans :
  - l'état des stocks ;
  - la saisie des interventions ;
  - le contrôle AB (onglet Semences : statut bio, dérogations) ;
  - le contrôle HVE (semences traitées).
- **Unités hétérogènes.** Une base de démonstration reprise d'Ekylibre et la ferme pilote en grandes cultures comptent 100 semences. Leur unité est écrite de 10 façons différentes :
  - « kilogram », « Kg » et « Kilogramme » ;
  - « Sac de 50 000 grains », « sac de 50 000 grains » et « Sac  de 50 000 grains » (avec deux espaces) ;
  - « Mille grains », « Mille graines », « graines » et « unity ».
- **Conversions.** `convertQuantity` ne connaît que la masse et le volume : un sac de 50 000 grains ne se convertit pas en milliers de grains ni en kg (refus explicite, testé).
- **Doses saisies.** Celles des semis dans les interventions : 180 en milliers/ha, 92 en kg/ha, 16 en kg, 14 sans unité, 4 en milliers, 1 en unités/ha.
- **Couverts** (`cover_crops`) : une espèce ou une famille en texte, sans lien avec l'article semé. Les mélanges importés (« Couvertsol novation 2 », « Avoine + TI + Radis + Phacélie ») ont l'espèce « Mélange ».

### Dans Lexicon

| Jeu | Contenu | Accès |
|---|---|---|
| `variants` (Ekylibre, CC-BY-SA) | 213 articles de semence et de plant ; unité kg (160) ou unité (53) ; indicateur `thousand_grains_mass` sur 210 d'entre eux | ouvert |
| `seed_varieties` (SEMAE, catalogue GNIS) | 21 592 variétés : code GNIS, espèce (taxon), nom, date d'inscription | ouvert |
| `seeds` (Germineo) | 53 espèces avec dose de semis indicative, relevés de prix hebdomadaires, prix mensuel au kilo | membres (clé d'adhérent) |

**Le PMG de Lexicon est presque toujours une valeur par défaut** : 203 fiches sur 210 indiquent 50 g. Seules quelques-unes semblent réelles : maïs 300 g, blé 42 g, tournesol 47 g, luzerne 2 g. Il ne peut pas servir de référence.

Les codes GNIS des imports se retrouvent dans le catalogue SEMAE. Exemple : les variétés de blé et d'avoine de la ferme pilote y sont toutes, avec leur espèce.

## 2. Objectifs

1. **Un catalogue des semences de la ferme** : espèce, variété, PMG, unité, stock, statut bio, usage.
2. **Des doses de semis comprises dans toutes les unités du métier** (grains/m², milliers de grains/ha, kg/ha, doses/ha) et converties sans deviner vers l'unité du stock.
3. **Les mélanges décrits par leurs espèces**, pour la fertilisation, la HVE, la BCAE 7 et l'AB.
4. **L'utilisation par campagne** (quantités, surfaces, densités), qui prépare les besoins en semences de l'assolement (temps 2) et leur coût (temps 3).

## 3. Décisions (20/11/2026)

| # | Décision |
|---|---|
| S1 | **Périmètre** : catalogue, création depuis le catalogue GNIS, conversions à la saisie, utilisation par campagne. |
| S2 | **PMG** : saisi pour chaque semence (il figure sur l'étiquette du sac). À défaut, Fourmy propose un **repère par espèce**, tiré d'une source citée (Arvalis, Terres Inovia…) et signalé « à confirmer ». Le PMG de Lexicon (50 g par défaut) n'est jamais repris tel quel. |
| S3 | **Doses** : une semence vendue à la dose porte son **nombre de grains par dose** (sac de 50 000 grains de maïs, dose de 150 000 graines de tournesol). Doses, milliers de grains et kg se convertissent entre eux par le PMG. |
| S4 | **Mélanges** : un mélange liste ses espèces ; les légumineuses sont repérées. |
| S5 | **PMG par lot** : chaque lot de stock peut porter son PMG (étiquette du sac) ; l'article porte le PMG par défaut, utilisé pour un lot qui n'en a pas. |
| S6 | **Repères de PMG par espèce** : tirés des références Arvalis et Terres Inovia, licence de réutilisation à vérifier avant d'en reprendre les valeurs. |
| S7 | **Dose de chaque espèce d'un mélange** : saisie à l'intervention, en kg/ha ; pas de proportions figées sur l'article. |
| S8 | **Plants** (vigne, arboriculture, mottes de maraîchage) : plus tard. La page ne traite que les semences. |

## 4. Besoins fonctionnels

### 4.1 Menu et page

- **FR-SE-1** : entrée **Semences** dans le menu Stocks, entre « État des stocks » et « Produits phyto ». Page `/f/:ferme/seeds`.
- **FR-SE-2** : liste des semences de la ferme. Colonnes :
  - nom, espèce, variété et code GNIS ;
  - unité de stock ;
  - PMG et son origine (saisi, repère à confirmer, inconnu) ;
  - grains par dose ;
  - bio (statut AB) et traitée ;
  - stock à la date de la frise ;
  - nombre d'interventions de la campagne.

  Colonnes choisies et mémorisées, comme les autres listes.
- **FR-SE-3** : filtres par espèce, par campagne d'utilisation, « sans PMG », « mélanges », « non bio ».
- **FR-SE-4** : des repères signalent ce qui manque pour convertir ou contrôler :
  - « PMG inconnu » ;
  - « unité non reconnue » ;
  - « mélange sans composition » ;
  - « espèce inconnue ».

  Chacun a son action : « Compléter ».

### 4.2 Fiche d'une semence

- **FR-SE-5** : identité :
  - nom ;
  - espèce (taxon Lexicon, nom français) ;
  - variété (nom et code GNIS) ;
  - catégorie : semence de ferme ou certifiée (besoin à confirmer) ;
  - bio : statut AB, traitée ou non, lien vers la dérogation AB de la campagne s'il en existe une.
- **FR-SE-6** : conditionnement :
  - unité de stock (kg, milliers de grains, dose) ;
  - nombre de grains par dose ;
  - poids d'un sac en kg, pour une semence vendue au poids.
- **FR-SE-7** : PMG par défaut de l'article, en grammes, avec sa date et son origine (étiquette, mesure à la ferme, repère par espèce). Chaque lot de stock peut porter son propre PMG, qui l'emporte pour les semis de ce lot (S5) ; la fiche liste les lots et leur PMG. Le repère s'affiche à côté d'un PMG saisi qui s'en écarte beaucoup (plus de 30 %), pour attraper une erreur de saisie ; le seuil reste à fixer.
- **FR-SE-8** : interventions qui l'utilisent, regroupées par campagne :
  - date ;
  - parcelle ;
  - dose saisie ;
  - densité en grains/m² ;
  - dose en kg/ha.
- **FR-SE-9** : modification réservée au responsable de la ferme ; consultation pour les autres membres.

### 4.3 Créer une semence

- **FR-SE-10** : « Ajouter une semence » : recherche dans le catalogue GNIS (SEMAE via Lexicon) par nom de variété ou par espèce. Le choix remplit l'espèce, la variété et le code. Fourmy propose ensuite l'unité (dose pour le maïs et le tournesol, kg sinon) et le repère de PMG de l'espèce.
- **FR-SE-11** : création libre, sans catalogue : semence de ferme, mélange du commerce, espèce hors catalogue.
- **FR-SE-12** : une semence arrivée par un import ou une saisie d'intervention, sans espèce, peut être **rattachée** au catalogue après coup, avec une proposition d'après le nom ou le code GNIS déjà présent.

### 4.4 Mélanges

- **FR-SE-13** : un mélange liste ses espèces et, si connue, leur variété ; aucune proportion n'est figée sur l'article (S7).
- **FR-SE-13b** : au semis d'un mélange, l'intervention saisit la **dose de chaque espèce en kg/ha** ; la dose du mélange en est la somme, et c'est elle qui fait baisser le stock du mélange. Les doses de la dernière intervention du même mélange sont proposées.
- **FR-SE-14** : les légumineuses (trèfles, vesces, féverole, pois…) sont repérées d'après l'espèce. La part de légumineuses s'affiche.
- **FR-SE-15** : le PMG d'un mélange n'est pas calculé et sa dose se saisit en kg/ha. La densité de chaque espèce en grains/m² s'affiche quand son PMG repère est connu.
- **FR-SE-16** : la composition sert :
  - au cahier de fertilisation : un couvert à légumineuses ;
  - à la diversité des cultures HVE ;
  - à la BCAE 7 : un couvert à plusieurs espèces ;
  - à l'AB : chaque composant a son statut.

  Le couvert d'une parcelle reprend les espèces semées et leur dose, d'après l'intervention de semis.

### 4.5 Conversions

- **FR-SE-17** : unités reconnues pour une semence :
  - masse : g, kg, q, t ;
  - grains : unité, milliers, millions ;
  - doses : dose de N grains ;
  - par hectare (`…_per_hectare`) ou par mètre carré pour les grains : **grains/m²**.
- **FR-SE-18** : les règles de conversion :
  - masse (kg) = nombre de grains × PMG (g) ÷ 1 000 000 ;
  - une dose de N grains = N grains ;
  - grains/m² × 10 000 = grains/ha.
- **FR-SE-19** : sans PMG, aucune conversion entre grains et masse : la saisie dans l'autre dimension est refusée et le message dit quoi compléter (règle actuelle : « rien n'est deviné »). Avec un PMG repère (« à confirmer »), la conversion se fait et la quantité est marquée « estimée ».
- **FR-SE-20** : la saisie d'un semis (web et mobile) propose les unités de la semence. Exemple : grains/m², milliers/ha, kg/ha et doses/ha pour un maïs à la dose dont le PMG est connu. L'équivalent s'affiche pendant la frappe : « 9 grains/m² ≈ 90 000 grains/ha ≈ 1,8 dose/ha ≈ 27 kg/ha ».
- **FR-SE-21** : le mouvement de stock d'un semis est converti dans l'unité du stock (`toStockQuantity`).
- **FR-SE-22** : la fiche d'une intervention de semis affiche la densité en grains/m² et la dose en kg/ha, quelle que soit l'unité saisie.
- **FR-SE-23** : les unités écrites librement des articles existants sont reconnues :
  - « Sac de 50 000 grains » (casse et espaces quelconques) devient une dose de 50 000 grains ;
  - « Mille grains » et « Mille graines » deviennent des milliers de grains ;
  - « Kg » et « Kilogramme » deviennent des kg ;
  - « graines » devient une unité.

  Une unité non reconnue est signalée (FR-SE-4) et ne bloque rien d'autre.

### 4.6 Utilisation par campagne

- **FR-SE-24** : onglet ou vue « Utilisation » : par semence et par campagne :
  - quantité semée dans l'unité du stock, en kg et en grains quand c'est convertible ;
  - surface semée ;
  - densité moyenne et écart entre parcelles ;
  - activités concernées.
- **FR-SE-25** : regroupement par espèce, pour comparer les variétés d'une même culture.
- **FR-SE-26** : export CSV.
- **FR-SE-27** : interventions prévues comprises, et distinguées. Elles préparent les commandes. Plus tard, l'assolement validé et ses itinéraires (temps 2) donneront les besoins de la campagne à venir.

### 4.7 Imports et reprises

- **FR-SE-28** : les imports Geofolia et DAPLOS rattachent la semence à la variété du catalogue GNIS par son code, et à l'espèce. Un code absent du catalogue est gardé tel quel et signalé.
- **FR-SE-29** : la reprise d'Ekylibre garde l'unité d'origine (FR-SE-23) et le `lexicon_ref`. L'espèce est déduite du `lexicon_ref` quand il en désigne une (`triticale_seed` → triticale).

## 5. Besoins non fonctionnels

- **NF-SE-1, sources citées** : SEMAE pour le catalogue des variétés, Ekylibre (CC-BY-SA) pour les articles types, la source de chaque repère de PMG, Germineo (accès membres) pour les prix et doses indicatives. Aucune valeur de référence sans source.
- **NF-SE-2, rien n'est deviné** : une conversion impossible est refusée et expliquée ; une valeur estimée est marquée comme telle partout où elle apparaît (saisie, fiche, registre, exports).
- **NF-SE-3, catalogue GNIS consultable sans Lexicon distant** : il est chargé dans la base comme les autres jeux Lexicon (`ifPublished`). Sans lui, la création libre reste possible.
- **NF-SE-4, cloisonnement** : les semences restent propres à chaque ferme (RLS), comme les autres articles ; seuls les référentiels sont partagés.
- **NF-SE-5, compatibilité** : les doses déjà saisies ne changent pas. Les conversions nouvelles s'appliquent à l'affichage et aux saisies futures. Un recalcul des stocks passés se fait à la demande et reste réversible (à confirmer en conception).
- **NF-SE-6, accessibilité et mobile** : la liste et la fiche sont utilisables au téléphone ; la saisie d'un semis sur le mobile propose les mêmes unités.
- **NF-SE-7, données de testeurs** : les jeux de test sont anonymisés (« ferme pilote ») ; aucun fichier réel dans le dépôt.

## 6. Récits utilisateur et critères d'acceptation

**R1 : catalogue.** Comme exploitant, je vois mes semences avec leur espèce, leur PMG et leur stock.
- La ferme pilote affiche ses semences de blé et d'avoine avec la variété du catalogue GNIS.
- Une semence sans PMG porte « PMG inconnu » et « Compléter ».

**R2 : création.** Comme exploitant, j'ajoute une variété en tapant son nom.
- Taper « Thermidor » propose « Blé tendre — Thermidor (512E492) ».
- Le choix remplit l'espèce et propose un PMG repère « à confirmer », avec sa source.

**R3 : saisie en grains.** Comme chauffeur, je saisis un maïs en grains/m².
- Maïs à la dose de 50 000 grains, PMG 300 g, 9 grains/m² sur 10 ha : la fiche affiche 90 000 grains/ha, 1,8 dose/ha et 27 kg/ha. Le stock baisse de 18 doses.
- Sans PMG : la saisie en kg/ha d'une semence stockée en doses est refusée, avec « PMG inconnu : compléter la fiche de la semence ».

**R4 : mélange.** Comme exploitant, je décris mon mélange de couvert.
- « Avoine + TI + Radis + Phacélie » liste ses quatre espèces ; le trèfle incarnat est repéré comme légumineuse.
- Au semis, je saisis avoine 8, trèfle incarnat 4, radis 2, phacélie 1 kg/ha : la dose du mélange est 15 kg/ha, le stock baisse d'autant, et le couvert de la parcelle reprend les quatre espèces et leur dose.
- Au semis suivant du même mélange, ces doses sont proposées.

**R5 : utilisation.** Comme exploitant, je vois ce que j'ai semé en 2026 pour préparer mes commandes.
- Par semence : quantité, surface, densité moyenne ; par espèce : les variétés côte à côte ; export CSV.

**R6 : unités existantes.** Comme exploitant repris d'Ekylibre, mes semences en « Sac de 50 000 grains » sont reconnues.
- « Sac  de 50 000 grains » (deux espaces) et « sac de 50 000 grains » deviennent une dose de 50 000 grains.
- La conversion en milliers de grains se fait sans PMG ; vers les kg, il faut le PMG.

## 7. Questions ouvertes

Tranchées le 20/11/2026 : PMG par lot (S5), source des repères (S6, licence acceptée le même jour), dose des mélanges (S7), plants (S8).

1. **Faculté germinative et pertes à la levée** : faut-il les saisir pour passer d'une densité de plantes visée à une densité de semis (temps 2) ?
2. **Unités existantes** : reconnaître seulement à la volée (FR-SE-23), ou proposer aussi de réécrire l'unité des articles, sur confirmation ?
3. **Prix** (Germineo, réservé aux membres) : afficher le prix indicatif sur la fiche dès maintenant, ou attendre le temps 3 de l'assolement ?
4. **Semences de ferme** : faut-il suivre le triage à façon et la CVO (contribution volontaire obligatoire) ?
