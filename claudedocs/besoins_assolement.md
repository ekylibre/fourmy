# Assolement prévisionnel — expression des besoins

*Brainstorm du 20/11/2026, à partir de `docs/assolement/todo.md` (note de l'équipe, hors dépôt). Étapes suivantes : `/sc:design` (conception), puis `/sc:workflow` (plan).*

## 1. Contexte

Retour d'un exploitant testeur : « je ne trouve pas comment créer l'assolement 2027 ».

Dans Fourmy aujourd'hui :
- **Productions** : une parcelle × une activité × une campagne, éventuellement datées (`started_on`, `stopped_on`) ; plusieurs par parcelle et par campagne (cultures successives).
- **Campagnes** : créées implicitement (imports, affectation d'une activité, fiche parcelle) ; aucun geste « préparer la campagne 2027 ».
- **Parcelles** : versions datées (`land_parcel_versions.valid`) ; création depuis la carte (PAC, cadastre).
- **Outils carto** : découpe, fusion, mesure, dessin (`packages/carto`, `CartoEditor`), testés ; utilisés seulement pour le choix des parcelles d'une intervention et dans un atelier qui n'enregistre rien.
- **Contrôles réutilisables** : rotation et mixité AB, statut de conversion, diversité HVE (4.3, 4.4), contrôle phyto (ZNT, eau), zonage nitrates.
- **Frise TIKA** : itinéraires d'une parcelle (campagne, rotation) et d'une activité.
- **Lexicon** : productions et codes PAC (`lexicon_cap_codes`), rendements et prix de vente par culture et département, itinéraires techniques de référence (`technical_workflows`, 1 321 ; `technical_workflow_sequences`), modèles d'interventions, prix des intrants (engrais, semences, phyto : jeux réservés aux membres ; GNR ouvert), prix de marché européens (`eu_market_prices`), RICA, budgets types.

## 2. Objectifs

1. **Temps 1, assolement** : préparer, sur un seul écran, la répartition des cultures de la campagne à venir (parcelles, découpes et fusions, activités, dates théoriques), avec un récapitulatif qui se construit au fil de la saisie et des contrôles en direct ; le valider, puis le réviser (sortie d'hiver).
2. **Temps 2, itinéraires et temps de travaux** : associer un itinéraire technique à chaque production pour prévoir les interventions, les temps de travaux (personnes, matériels, trajets) et les besoins en intrants.
3. **Temps 3, économique** : prix des intrants, des matériels, de la main-d'œuvre, des services et des produits ; rendements et prix prévisionnels ; indicateurs technico-économiques (produits, charges, marges) par production, par activité et pour l'assolement.

## 3. Décisions (20/11/2026)

| # | Décision |
|---|---|
| A1 | **Périmètre** : besoins des trois temps exprimés maintenant ; conception, plan et réalisation du **temps 1** d'abord. Le modèle du temps 1 doit accueillir les temps 2 et 3 sans reprise. |
| A2 | **Découpe et fusion** : elles créent de **nouvelles parcelles datées** (nouvelles versions à partir du début de la campagne préparée) ; les campagnes passées restent inchangées. Pas de zones de culture à l'intérieur d'une parcelle. |
| A3 | **Brouillon puis validation** : l'assolement d'une campagne se construit en brouillon, sans toucher aux productions ; la validation crée ou met à jour les productions (et les parcelles découpées ou fusionnées) ; un assolement validé peut être rouvert et révisé. Un seul brouillon par campagne (pas de scénarios concurrents au temps 1). |
| A4 | **Contrôles en direct dès le temps 1** : PAC (conditionnalité), certifications AB et HVE, agronomie de la rotation, phyto et réglementaire. |
| A5 | **Campagne = année de récolte** : un blé semé en octobre 2026 appartient à la campagne 2027. |
| A6 | **BCAE 7** : Fourmy calcule les deux critères, rotation (annuel 35 % et pluriannuel) et diversification (barème de l'annexe 5), et dit lequel est respecté ; exemptions appliquées. |
| A7 | **Cultures secondaires dès le temps 1** : dérobées et couverts d'interculture (CIPAN) se saisissent dans l'assolement ; ils comptent pour la BCAE 7 et alimentent les couverts du cahier de fertilisation. |
| A8 | **Repères agronomiques** d'après **Triple Performance** (jeu Lexicon `production_documentations`, CC-BY-SA, ou API du wiki) ; valeurs par défaut réglables par la ferme. |
| A9 | **Phyto et réglementaire** : ZNT, aires de captage et zones Natura 2000 dès le temps 1. |
| A10 | **Interventions prévues** (temps 2) : proposées d'après l'itinéraire, puis confirmées par l'utilisateur. |
| A11 | **Prix réservés** (temps 3) : clé d'adhérent Lexicon (`FOURMY_LEXICON_API_KEY`, bundle « fourmy », déjà géré) ; ajouter au bundle les jeux de prix des intrants (`seeds`, `fertilizers`, `phytosanitary_prices`), avec attribution. |
| A12 | **Prix de vente** : appel direct de l'**API agrifood de la Commission européenne** (`https://api.tech.ec.europa.eu/agrifood`, `GET /api/cereal/prices`, documentation OpenAPI `/agrifood/v3/api-docs`), prix de la France (`memberStateCodes=FR`) ; correspondance code produit → espèce reprise de Lexicon (`lib/datasources/eu_market_prices.rb`) ; cotations quotidiennes FranceAgriMer des céréales en complément ; pas de MATIF. |

## 4. Exigences fonctionnelles — temps 1 (assolement)

### Accès et campagne

- **FR-AS-1** Bouton « Assolement » en haut de la page Activités, pour la campagne choisie : « Préparer l'assolement 2027 » s'il n'existe pas, « Modifier » sinon. La campagne est créée au besoin (année de récolte ; dates par défaut du 1er janvier au 31 décembre, ou selon le réglage de la ferme).
- **FR-AS-2** Point de départ proposé : le parcellaire en place à la fin de la campagne précédente, avec la culture précédente de chaque parcelle ; les productions déjà saisies pour la campagne (imports, saisie) sont reprises dans le brouillon.
- **FR-AS-3** Ferme sans parcelle : l'écran propose de créer le parcellaire (dessin, import TelePAC, parcelles PAC ou cadastre) avant l'affectation.

### Écran unique

- **FR-AS-4** Carte du parcellaire de la campagne : chaque parcelle colorée selon son activité prévue, sinon hachurée avec sa culture précédente ; étiquettes (nom, surface, précédent → prévu).
- **FR-AS-5** Sélection simple : une parcelle (clic), plusieurs (clic additionnel, lasso ou rectangle), toutes celles d'une activité précédente.
- **FR-AS-6** **Découpe** d'une parcelle (ligne tracée) et **fusion** de parcelles contiguës, avec les outils carto existants ; surfaces calculées en direct ; résultat en brouillon, appliqué à la validation (A2).
- **FR-AS-7** **Affectation** d'une activité à la sélection : crée une production prévue par parcelle (parcelle × activité × campagne) avec un début et une fin théoriques (proposés d'après l'activité ou la campagne précédente, modifiables) ; plusieurs productions successives possibles (culture principale puis dérobée) ; retrait d'une affectation.
- **FR-AS-8** **Récapitulatif** qui se consolide à chaque geste : surface par activité et par famille (ha, % de la SAU), parcelles sans activité, surfaces découpées ou fusionnées, comparaison avec la campagne précédente.
- **FR-AS-9** **Contrôles en direct** (A4) dans un panneau, chacun avec ses parcelles concernées sur la carte et sa source :
  - PAC : BCAE 7 rotation (critère annuel 35 %, critère pluriannuel par parcelle sur 4 ans) ou diversification (barème), selon le choix de la ferme, avec les exemptions ; prairies permanentes ; part de surfaces non productives si elle s'applique ;
  - certifications : AB (rotation, mixité, statut de conversion prévu des récoltes), HVE (culture principale, nombre d'espèces, et autres items calculables à partir de l'assolement) ;
  - agronomie : délai de retour d'une culture, alternance hiver et printemps, familles botaniques, successions déconseillées (repères réglables) ;
  - phyto et réglementaire : culture prévue sur une parcelle concernée par une ZNT, une aire de captage ou une interdiction connue.
- **FR-AS-10** **Validation** : vérifie que toutes les parcelles ont une activité ou sont marquées « sans culture » (jachère, gel), affiche les contrôles restants (non bloquants, sauf incohérence de données), puis applique le brouillon (parcelles datées, productions) dans une seule transaction.
- **FR-AS-11** **Révision** : un assolement validé se rouvre ; les modifications repassent par le brouillon, puis par une nouvelle validation (sortie d'hiver, semis perturbés). Les productions qui ont déjà des interventions réalisées ne sont jamais supprimées en silence.
- **FR-AS-12** **Historique** : qui a validé, quand, et ce qui a changé d'une version à l'autre de l'assolement.
- **FR-AS-13** **Frise** : l'assolement prévu apparaît dans la frise TIKA des parcelles et des activités (rotation passée et prévue).

## 5. Exigences fonctionnelles — temps 2 (itinéraires techniques, temps de travaux)

- **FR-AS-20** À l'affectation d'une activité, choix d'un **itinéraire technique** (ITK) : suite d'interventions prévisionnelles en dates relatives (au semis, à la récolte) ou absolues, avec procédures, intrants et doses, matériels et personnes.
- **FR-AS-21** **Catalogue d'ITK** : itinéraires de référence de Lexicon (`technical_workflows`, `technical_workflow_sequences`, `intervention_models`), et **ITK de la ferme** construits à partir des interventions passées d'une activité (proposition « refaire comme en 2026 »), modifiables et enregistrables.
- **FR-AS-22** À la validation de l'assolement, les interventions prévues de l'ITK sont créées (statut « prévue ») sur les parcelles, ou mises à jour lors d'une révision.
- **FR-AS-23** **Temps de travaux** : par intervention, durée au champ (surface × débit de chantier du matériel ou de l'attelage) et durée de route (trajets du siège ou du site aux parcelles par OSRM) ; cumul par personne, par matériel, par période (pointes de travail).
- **FR-AS-24** **Besoins en intrants** : quantités par produit (semences, engrais, phyto) d'après les doses de l'ITK et les surfaces ; comparaison avec les stocks.
- **FR-AS-25** **Récapitulatif enrichi** : temps de travaux, kilomètres, besoins en intrants par activité et pour l'assolement.

## 6. Exigences fonctionnelles — temps 3 (économique)

- **FR-AS-30** **Module « Économique »** : consulter, affecter et modifier en masse les prix :
  - intrants (semences, engrais, phyto, carburant) ;
  - matériels (coût horaire ou à l'hectare) ;
  - main-d'œuvre (coût horaire) ;
  - services (prestations, ETA) ;
  - produits (prix de vente).
- **FR-AS-31** **Sources de prix proposées** : Lexicon (prix des intrants, GNR, prix de vente et rendements par culture et département, prix de marché européens, RICA), prix d'achat réels des articles, saisie ; la date et la source de chaque prix sont gardées.
- **FR-AS-32** Dans l'assolement, **rendements et prix prévisionnels** d'un ou plusieurs produits de chaque production, avec des valeurs par défaut (exemple : parcelle « Le Champ », 2027 : 95 q/ha à 220 €/t).
- **FR-AS-33** **Indicateurs technico-économiques**, sur le modèle d'`ekylibre-economic` :
  - produits (rendement × prix) ;
  - charges opérationnelles (intrants de l'ITK) ;
  - marge brute ;
  - charges de mécanisation et de main-d'œuvre ;
  - marge directe ;
  - charges indirectes réparties par clé (surface, temps de travaux).

  Ces indicateurs se donnent par production, par activité, à l'hectare et pour l'assolement, en prévu puis en réalisé.
- **FR-AS-34** **Récapitulatif économique** de l'assolement ; comparaison entre la campagne préparée et la précédente.

## 7. Exigences non fonctionnelles

- **NFR-AS-1 Un seul écran** : tout le temps 1 se fait sans quitter la page (carte, sélection, découpe, affectation, récapitulatif, contrôles).
- **NFR-AS-2 Réactivité** : récapitulatif et contrôles à jour en moins d'une seconde après un geste, pour une ferme de 300 parcelles.
- **NFR-AS-3 Brouillon sûr** : rien ne change dans les productions, les parcelles ni les contrôles des autres modules avant la validation ; le brouillon se sauvegarde au fil de l'eau (fermer la page ne perd rien).
- **NFR-AS-4 Historique intact** : les campagnes passées, leurs parcelles et leurs interventions ne sont jamais modifiées par l'assolement (A2).
- **NFR-AS-5 Droits** : le responsable prépare et valide ; les autres membres consultent.
- **NFR-AS-6 Sources citées** : chaque contrôle cite sa règle (fiche de conditionnalité, plan de contrôle HVE, règlement AB, repère agronomique) ; les référentiels sont versionnés comme `certification-refs`.
- **NFR-AS-7 Mobile** : consultation de l'assolement validé sur tablette ; la préparation se fait sur ordinateur.

## 8. Récits utilisateur et critères d'acceptation (temps 1)

- **US-AS-1** *Préparer 2027.* Depuis Activités, « Préparer l'assolement 2027 » ouvre l'écran avec le parcellaire de fin 2026 et les précédents ; la campagne 2027 existe ensuite.
- **US-AS-2** *Affecter.* Je sélectionne trois parcelles et j'affecte « Blé tendre » : le récapitulatif ajoute leur surface au blé ; les contrôles se mettent à jour (par exemple « Le Champ : blé sur blé, retour en 1 an »).
- **US-AS-3** *Découper.* Je coupe une parcelle de 12 ha en deux morceaux de 7 et 5 ha et j'affecte une culture à chacun ; après validation, deux parcelles existent à partir du 01/01/2027, et la parcelle d'origine reste intacte en 2026.
- **US-AS-4** *Valider.* Toutes les parcelles ont une activité : je valide ; les productions 2027 existent, avec leurs dates théoriques ; la page Activités et la frise les montrent.
- **US-AS-5** *Réviser.* En mars, je rouvre l'assolement validé, je remplace un colza gelé par un tournesol et je revalide ; l'historique garde les deux versions.
- **US-AS-6** *Contrôler.* Une parcelle certifiée AB porte la même espèce en AB et hors AB : le panneau signale la mixité ; une parcelle sans changement de catégorie sur 4 ans est signalée au titre de la BCAE 7.

## 9. Questions ouvertes

Tranchées le 20/11/2026 (décisions A5 à A12). Restent, pour la conception :

1. **Triple Performance** : les pages du wiki sont du texte libre ; aucune propriété structurée (délai de retour, précédents favorables) n'a été trouvée (recherche par l'API du wiki, 20/11). Il faudra constituer une table de repères (délai de retour par culture ou famille, successions déconseillées) en citant pour chaque valeur la page Triple Performance d'où elle vient, à relire par un agronome.
2. **API agrifood** : le 20/11/2026, `/api/cereal/products`, `/markets` et `/prices` répondaient en erreur 500 (« The API cannot provide results ») ; l'ancienne adresse `ec.europa.eu/agrifood` redirige vers la nouvelle. Prévoir un cache des prix côté Fourmy et un repli sur le jeu Lexicon `eu_market_prices` (même source, copie datée).
3. **Cotations FranceAgriMer** : publiées sur VISIONet (page HTML de séries chronologiques, référencée par data.gouv.fr) ; format d'extraction et fréquence de rafraîchissement à vérifier.
4. **Bundle Lexicon** : ajout des jeux de prix réservés au bundle « fourmy », à demander à l'équipe Lexicon ; attribution à afficher (Cereapro, Germineo).

## 10. Sources

- Note de l'équipe : `docs/assolement/todo.md` (hors dépôt).
- Fiche conditionnalité 2026, BCAE 7 « La rotation et la diversification des cultures » (Télépac) : critère annuel de 35 %, critère pluriannuel par parcelle sur 4 ans, diversification (annexe 5), exemptions (AB, 10 ha de terres arables ou moins, herbe dominante ; pas de contrôle sous 30 ha de SAU en 2026), catégories de culture (annexes 3 et 4).
- `ekylibre/ekylibre-economic` : `ActivityEconomic` (produits, charges proportionnelles et fixes, marge brute, charges indirectes par clé de répartition, prévu et réalisé), `EuPriceApi` (agridata, prix des céréales et du vin).
- [Prix des céréales françaises, mise à jour quotidienne](https://www.data.gouv.fr/datasets/prix-des-cereales-francaises-mise-a-jour-quotidienne) (FranceAgriMer, VISIONet).
- [Triple Performance, productions](https://wiki.tripleperformance.fr/wiki/Productions) (CC-BY-SA 4.0).
- Lexicon : liste des jeux de données (`technical_workflows`, `intervention_models`, `eu_market_prices`, `fertilizers`, `seeds`, `phytosanitary_prices`, `fuel_prices`, `rica`, `budgets`, `graphic_parcels`, `protected_water_zones`).
- Fourmy : `docs/activites.md`, `docs/carto.md`, `docs/parcelles.md`, `docs/controles-hve-ab.md`.
