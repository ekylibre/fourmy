# Contrôle Agriculture Biologique (AB) dans Fourmy : expression des besoins (productions végétales)

Rapport de recherche, 19/11/2026. Périmètre : grandes cultures, maraîchage, viticulture (production au champ). L'élevage est hors périmètre, sauf quand il touche les cultures (effluents, prairies, surfaces fourragères).

## 0. Méthode et sources

| Réf. courte | Source | Lecture | Remarque |
|---|---|---|---|
| **RUE 848** | `docs/ab/CELEX_32018R0848_FR_TXT.pdf` : règlement (UE) 2018/848 du 30/05/2018, JO L 150 du 14/06/2018, 92 pages | Articles 3, 6, 9 à 13, 22 à 30, 34 à 42, 53, 61, annexe II partie I et annexe III lus en entier (outil Read pour les pages 24 à 30, extraction texte `pdftotext` pour le reste) | La page du PDF correspond au folio « L 150/xx » : **p. 57 = L 150/57**. |
| **JOE 2019** | `docs/ab/joe_20191212_0288_0053.pdf` | Lu en entier | C'est l'**arrêté du 9/12/2019** (NOR AGRT1932676A) qui homologue le cahier des charges de la **restauration hors foyer à caractère commercial en AB**, JORF n° 288 du 12/12/2019, texte 53. Il est **sans objet pour la production végétale**. C'est le même texte que JORFTEXT000039481757 (voir plus bas). |
| **GDL** | `docs/ab/GDL_17-04-2026.xlsx` (copie dans `scratchpad/ab/`), une feuille « Guide de lecture » de 493 lignes, colonnes A = article, B = point, C = texte RUE 2018/848 et actes secondaires, D = « Texte GDL actuel », E = date de modification (date Excel), A1 = « dernière modification effectuée le : 26/03/2026 » | Toutes les lignes utiles aux cultures sont lues (art. 2-3, 5-6, 9-11, annexe II partie I, art. 24 avec le RUE 2021/1165, art. 34-36, 42-43, annexe III) | C'est le **guide de lecture INAO** de l'application du règlement bio. Le fichier ne contient **pas** les « notes de lecture » qu'il cite (MRV = matériel de reproduction végétale, « 170 kg ha an N », « Produits phyto », « Biodéchets », « Distribution », « Etiquetage »). |
| Web 1 | agriculture.ec.europa.eu/…/legislation_fr | **HTTP 403** (accès automatisé refusé) | Non lu. |
| Web 2 | Légifrance JORFTEXT000044793347 | Lu | Arrêté du 28/12/2021 : cahier des charges français (CCF) **élevage**. |
| Web 3 | Légifrance JORFTEXT000039481757 | Lu | Arrêté du 9/12/2019 : restauration commerciale (= JOE 2019). |
| Web 4 | Légifrance JORFTEXT000050060154 | Lu | Arrêté du 15/07/2024 : CCF **sel**. |
| Web 5 | agencebio.org/…/les-textes-reglementaires/ | **HTTP 403**, deux fois | Non lu. |
| Complément | EUR-Lex (RUE 2021/1165) | Page vide (protection anti-robot). Le téléchargement direct a été refusé par le garde-fou de la session ; je n'ai pas insisté. | **Le règlement 2021/1165 n'a pas été lu en direct.** Son contenu vient du RUE 848 (art. 24) et du GDL, qui le cite. **Mise à jour du 19/11 : lu à partir du PDF ajouté, voir §8.** |
| Complément | Recherche web (titres des actes 2021/2119, 2021/279, 2020/464) | Résultats de recherche seulement | Identification des actes, sans lecture de leur texte. |

Règle suivie : un chiffre qui n'est dans aucune source lue est signalé « hors sources ».

---

## 1. Cadre réglementaire

### 1.1 Textes européens

- **Règlement (UE) 2018/848** (règlement de base). Il fixe les principes (art. 5-6), les règles de production générales (art. 9), la conversion (art. 10), l'interdiction des OGM (art. 11), les règles végétales (art. 12 + **annexe II partie I**), le matériel hétérogène (art. 13), les produits autorisés (art. 24), la base de données des semences (art. 26), les mesures de précaution (art. 27-29), l'étiquetage (art. 30-33), la notification et le certificat (art. 34-35), les contrôles (art. 37-43) et la collecte et le stockage (**annexe III**).
  - L'art. 61 (p. 55) prévoit une application au « 1er janvier 2021 ». Dans les faits, l'application a été reportée au 1/1/2022 par un règlement modificatif que je n'ai pas lu (hors sources, à vérifier). Le GDL date du 1/1/2022 le début du décompte du cuivre (ligne 420).
- **Actes secondaires cités par le GDL** (texte non lu sauf mention contraire) :
  - **Règlement d'exécution (UE) 2021/1165** : listes limitatives. Annexe I = substances actives phytopharmaceutiques ; annexe II = engrais, amendements, éléments nutritifs ; annexe III = alimentation animale ; annexe IV = nettoyage et désinfection ; annexe V = transformation (partie D : vin). Références GDL lignes 152, 419-435 et 412.
  - **Règlement d'exécution (UE) 2020/464**. Son art. 1 liste les documents à fournir pour la reconnaissance rétroactive de la conversion (GDL l. 94). Le GDL lui rattache aussi les dérogations semences (l. 444, « AD 2020/464 art 25 et annexe II » ; libellé du GDL, non vérifié).
  - **Règlement délégué (UE) 2021/716**, qui modifie le point 1.3 (graines germées) (GDL l. 118).
  - **Règlement délégué (UE) 2020/2146** : règles exceptionnelles en cas de catastrophe (GDL l. 410-416).
  - **Règlement d'exécution (UE) 2021/1279** : changement d'organisme de contrôle (GDL l. 499).
  - **Règlement d'exécution (UE) 2021/2119**, identifié par recherche web (non lu) : « règles détaillées concernant certains registres et déclarations requis de la part des opérateurs […] et les moyens techniques de délivrance des certificats ». Son art. 2 porte sur les registres à conserver, son art. 3 sur les déclarations (via TRACES selon la recherche).
  - **Règlement d'exécution (UE) 2021/279** (contrôles, traçabilité) et **2021/1378** (certificats), identifiés par recherche, non lus.
  - **Règlements (UE) 540/2011 et 2018/1981** (approbation du cuivre au titre du 1107/2009), cités par le GDL l. 420 pour la règle des 28 kg Cu/ha sur 7 ans.
- **Règlement (CE) 1107/2009** : l'art. 9.3 du RUE 848 (p. 25) exige qu'un produit phytopharmaceutique soit aussi autorisé au titre du 1107/2009, d'où l'AMM.
- **Directive 91/676/CEE** (Nitrates) : définit les « effluents d'élevage » du point 1.9.4. **Directive 2011/92/UE**, annexe I : seuils des élevages « industriels » (GDL l. 425 ; seuils non lus).

### 1.2 Textes français identifiés

| Texte | Objet | Apport au contrôle des cultures |
|---|---|---|
| **Arrêté du 28/12/2021** (NOR AGRT2136935A, JORF 31/12/2021, JORFTEXT000044793347) | Cahier des charges français (CCF) de la production biologique d'**animaux d'élevage** (escargots, autruches, cailles, lamas/alpagas) et options nationales (densités volailles, vide sanitaire…). Abroge l'arrêté du 5/01/2010. | Faible pour les cultures. Seul point utile : **mesure transitoire titre II ch. 3**. Pour nettoyer et désinfecter les **bâtiments de production végétale**, seuls les produits de son **annexe I** sont autorisés (critères : biodégradabilité, substances exclues, biocides déclarés ; rodenticides en pièges seulement). Le GDL (l. 433) renvoie à cette annexe I « dans l'attente d'une liste harmonisée ». |
| **Arrêté du 9/12/2019** (NOR AGRT1932676A, JORF n° 288 du 12/12/2019, JORFTEXT000039481757 = le PDF `joe_…`) | CCF de la **restauration hors foyer commerciale** en bio (catégories « +50/75/95 % », « plats et menus »). | **Aucun** pour la production. Il est encore visé sous l'ancien règlement 834/2007. |
| **Arrêté du 15/07/2024** (NOR AGRT2419718A, JORF 31/07/2024, JORFTEXT000050060154) | CCF de la production biologique du **sel** (abroge l'arrêté du 24/06/2024). | **Aucun** pour les cultures. Seul intérêt : un modèle de rédaction de registre (« dates, nom, substances actives, lieu »). |
| **Guide de lecture INAO** (GDL, version au 26/03/2026) | Interprétation officielle française du RUE 848 et des actes secondaires, ligne par ligne | **Essentiel.** Il donne les règles opérationnelles absentes du règlement : C1/C2, rotation en maraîchage (3 espèces), engrais vert de 30 jours, cuivre, effluents « industriels », séparation du stockage, nettoyage du matériel, mixité par variétés, serres chauffées, notification. |

### 1.3 Qui contrôle, et à quelle fréquence

- **Autorité compétente** : en France, l'**INAO** (le GDL lui attribue les dérogations, le catalogue des mesures, la reconnaissance rétroactive). Elle délègue le contrôle à des **organismes de contrôle / certificateurs (OC)** agréés, sous les conditions de l'art. 40 (p. 45) : procédure d'évaluation des risques, contrôle type, catalogue de mesures. Le GDL ne nomme aucun OC.
- **Un seul OC par opérateur** et par catégorie de produits dans un État membre (art. 35.4 p. 41 ; GDL l. 484).
- **Fréquence** (art. 38.3, p. 43) : vérification de conformité **au moins une fois par an**, avec inspection physique sur place. Exception : après **3 années consécutives** sans manquement portant atteinte à l'intégrité et avec une faible probabilité de manquement, l'intervalle entre deux inspections physiques peut monter à **24 mois au plus**. S'y ajoutent un pourcentage de contrôles **inopinés**, des contrôles supplémentaires et des **échantillons** (art. 38.4). Les pourcentages sont fixés par actes d'exécution (art. 38.9), **non lus ; chiffres hors sources**.
- Le contrôle est fondé sur le **risque** (art. 38.2) : taille, ancienneté, résultats passés, **mixité**, dérogations, sous-traitance…
- **Points contrôlés en priorité** (art. 38.1 p. 42-43) : mesures de précaution, **séparation** bio / conversion / non bio et registres associés, **parcelles reconnues rétroactivement** et unités non bio.
- **Sanctions.** Un catalogue commun des mesures existe (art. 41.4) ; l'INAO l'applique depuis le 1/11/2014 (GDL l. 494). On y trouve le déclassement du lot (art. 42.1), puis la suspension ou le retrait du certificat (art. 42.2). En cas de retrait, la **période de carence est d'au moins 1 an** (GDL l. 494).
- Le compte rendu de contrôle est **contresigné** par l'opérateur (art. 38.6).

---

## 2. Règles de production végétale vérifiables à partir des données d'exploitation

Notation : « 848 » = RUE 2018/848 ; « A-II-I » = annexe II partie I ; « p. » = page du PDF ; « GDL l. » = ligne de la feuille du guide (date de mise à jour entre parenthèses).

### 2.1 Conversion

- **R1. Durée de conversion** (A-II-I 1.7.1, p. 57).
  - **2 ans au moins avant l'ensemencement** pour les cultures annuelles.
  - **2 ans avant l'utilisation comme aliment bio** pour les pâturages et fourrages pérennes.
  - **3 ans avant la première récolte bio** pour les cultures pérennes autres que fourrages (vigne, vergers).
  - Le GDL (l. 96, 98 ; 30/09/2021) la rend opérationnelle **à la parcelle** :
    - **C1** = végétaux récoltés dans les **12 premiers mois** après le début de conversion : vendus en conventionnel ;
    - **C2** = récoltés **à partir du 13e mois** : vendables « en conversion vers l'AB » ;
    - **AB** = annuelles **semées ou repiquées au plus tôt 24 mois** après le début de conversion ; pérennes **récoltées au moins 36 mois** après.
  - Annuelles et semi-pérennes (fraise, artichaut, asperge, herbe, safran) : 2 ans. Pérennes (verger, vigne, houblon, lavande) : 3 ans.
  - **Changement de culture en cours de conversion** (GDL l. 125, 99) : une pérenne implantée oblige à 3 ans de bio. Si le matériel végétatif est conventionnel, la récolte n'est bio qu'après **deux périodes de végétation**, sauf dérogation 1.8.5.1.
- **R2. Mention « en conversion »** (848 art. 10.4 et art. 30.3, p. 26 et 37). Elle n'est admise que si une **conversion d'au moins 12 mois avant la récolte** est respectée et si le produit contient **un seul ingrédient végétal agricole**. Pour le vin, il faut des raisins C2/C3 et aucun autre ingrédient agricole : pas d'enrichissement, pas de mutage (GDL l. 101). Le logo UE est interdit sur les produits en conversion (art. 33.1, p. 39).
- **R3. Date de début** (848 art. 10.2, p. 26). La conversion débute **au plus tôt à la notification**. En France, la date de début correspond à la réalisation conjointe de l'**engagement auprès de l'OC** et de la **notification à l'Agence Bio** (GDL l. 92). La notification doit précéder l'engagement, avec une **tolérance de 15 jours** (GDL l. 473).
- **R4. Reconnaissance rétroactive** (848 art. 10.3, p. 26). Elle n'est possible que dans deux cas : (a) parcelles sous mesures d'un programme du règlement 1305/2013 garantissant l'absence de produits non autorisés (MAEC) ; (b) zones naturelles ou surfaces **non traitées pendant au moins 3 ans** avec des produits non autorisés. Les pièces sont fixées par l'art. 1 du RUE 2020/464 et la demande est adressée à l'INAO (GDL l. 94). Ces parcelles sont ciblées par le contrôle (art. 38.1 b).
- **R5. Reconversion après un traitement non autorisé** (A-II-I 1.7.3 et 1.7.4, p. 57-58). Un traitement avec un produit non autorisé impose **une nouvelle période de conversion**. Elle peut être réduite en cas de lutte obligatoire imposée par l'autorité ou d'essai approuvé. La **récolte qui suit le traitement** n'est vendable ni en bio ni en conversion. Une contamination peut aussi **prolonger** la conversion (1.7.2).
- **R6. Terres liées à l'élevage** (A-II-I 1.7.5, p. 58). La conversion porte sur toute la surface qui produit des aliments pour animaux. Elle peut être réduite à **1 an** pour les pâturages et parcours d'espèces **non herbivores** (sauf après un traitement non autorisé, 1.7.4.2).

### 2.2 Exploitation entière, mixité et parallélisme

- **R7. Principe** (848 art. 9.2, p. 25) : **l'ensemble de l'exploitation** est géré en conformité avec le règlement. Dérogation (art. 9.7) : l'exploitation peut être scindée en unités bio, en conversion et non bio, **clairement et effectivement séparées**. Pour les végétaux non bio, il faut des **variétés différentes, facilement distinguables** (art. 9.7 b).
  - **Ce qui est admis** (GDL l. 78-80, 21/06/2022) :
    - la même variété en bio et C2, en bio et C1, ou en C2 et C1 (ce n'est pas une mixité interdite), avec une traçabilité de la mise en culture à la vente ;
    - la date de récolte comme critère de distinction, si chaque récolte est achevée avant le début de la suivante et que les récoltes de statuts différents ne sont jamais présentes ensemble ;
    - critères **acceptés** : couleur du grain de maïs, blé barbu ou non seulement si les grains se distinguent visuellement, pêche blanche ou jaune, ronde ou plate, couleur du cépage (rouge ou blanc).
  - **Ce qui n'est pas admis** :
    - maïs grain et maïs ensilage de variétés non distinguables ;
    - mélange céréalier d'un côté et culture pure d'une espèce du mélange de l'autre ;
    - **un bâtiment, un tunnel ou une serre utilisé en bio ne peut servir à des végétaux non bio**, même facilement distinguables.
  - Unités contiguës : elles sont permises si elles sont matérialisées (haie, talus, chemin, clôture) (GDL l. 23, 75).
- **R8. Pérennes ≥ 3 ans** (848 art. 9.8, p. 25). Les mêmes variétés, ou des variétés non distinguables, peuvent coexister sous **plan de conversion**. La dernière partie entre en conversion dès que possible et doit être convertie **en 5 ans au plus**. Obligations :
  - (a) informer l'OC du **début de chaque récolte au moins 48 h avant** ;
  - (b) à la fin de la récolte, déclarer les **quantités exactes récoltées** par unité et les mesures de séparation ;
  - (c) faire confirmer le plan **chaque année** par l'OC.
  - Le GDL (l. 81, 83) étend cette dérogation aux **luzernes et prairies en place depuis au moins 3 ans**. La mixité des pâturages, autrefois admise, n'existe plus.
- **R9. Obligations en cas de mixité** (848 art. 9.10, p. 26) : séparer les **intrants** des unités bio et non bio, séparer les **produits obtenus**, tenir des **registres ad hoc** prouvant la séparation. Les centres de recherche, pépinières, multiplicateurs de semences et sélectionneurs sont exemptés de l'exigence de variétés distinctes (art. 9.9), pas de l'art. 9.10 (GDL l. 85).

### 2.3 Sol, rotation et légumineuses

- **R10. Culture en sol** (A-II-I 1.1 et 1.2, p. 57). Les cultures sont produites dans un **sol vivant** en lien avec le sous-sol et la roche-mère. La **production hydroponique est interdite** ; l'aéroponie et l'aquaponie végétale le sont aussi (GDL l. 116).
  - **Exceptions** :
    - germes et endives en eau claire (1.3, modifié par le RUE 2021/716 ; milieux inertes de l'annexe II du RUE 2021/1165 seulement, GDL l. 118) ;
    - pots de plantes **ornementales et aromatiques vendues avec le pot** (1.4 a) ;
    - **plants en containers** à repiquer (1.4 b) ;
    - « demarcated beds » en Finlande, Suède et Danemark seulement (1.5).
  - Plantes cultivées toute leur vie en sacs ou pots (hors ornementales et aromatiques) : **non certifiables** (GDL l. 45). Micropousses sur terreau : impossibles (GDL l. 114).
  - **Apports de terre non bio interdits** (GDL l. 51).
- **R11. Rotation pluriannuelle** (A-II-I 1.9.2 a, p. 59), hors pâturages et fourrages pérennes. Elle comprend des **légumineuses obligatoires**, en culture principale ou de couverture, et d'autres engrais verts. Le GDL (l. 136-137, 11/07/2024) précise :
  - la rotation est appréciée **par parcelle** et sur l'ensemble du cycle ;
  - en grandes cultures, **la même culture tous les ans alternée avec un engrais vert ou une dérobée n'est pas une rotation**. Plusieurs céréales d'espèces différentes peuvent se suivre, voire **2 ans de la même espèce**, à condition qu'il y ait de la diversité **avec légumineuse(s)** ;
  - en **maraîchage**, le cycle compte **au moins 3 espèces différentes**. Une culture de cycle court (radis, salade) ne peut être répétée **qu'une fois** par rotation ;
  - un engrais vert ou une légumineuse ne compte parmi les 3 espèces que s'il reste en place **au moins 30 jours** (**3 semaines** pour un sorgho d'été). La solarisation ne remplace pas une espèce ;
  - une culture issue d'un **re-semis naturel compte 2 fois** ;
  - **aucune rotation type ni seuil chiffré** n'est donné pour les grandes cultures : appréciation par l'OC.
- **R12. Serres et pérennes** (1.9.2 b) : engrais verts, légumineuses à court terme, diversité végétale. Le GDL l. 138 ne fait que **recommander**, sans obligation chiffrée.
- **R13. Serres chauffées** (GDL l. 43 et 51, principe art. 5 c / 6 b) : chauffage **uniquement par énergies renouvelables**. L'obligation s'applique aux exploitations entrées en conversion depuis le 1/1/2020 ; pour les autres, à partir du **1/1/2030**. La production de plants est exclue.

### 2.4 Fertilisation

- **R14. Fertilisants autorisés seulement** (A-II-I 1.9.3, p. 59). Les engrais et amendements ne sont permis que si les rotations et les apports organiques ne suffisent pas : seulement ceux autorisés au titre de l'art. 24 (= **annexe II du RUE 2021/1165**), **dans la mesure nécessaire**, avec un **registre d'utilisation**.
  - Le GDL (l. 133, 141) exige un **bilan de fertilisation préalable**, la priorité aux matières bio de l'exploitation et un usage modéré des produits solubles.
  - Exclusions relevées par le GDL :
    - **boues d'IAA** et **boues de STEP** (l. 425-426) ;
    - **vinasses ammoniacales** (l. 426) ;
    - **silicates de sodium ou de potassium et acide silicique** comme fertilisants (l. 142) ;
    - terre végétale ou forestière dans les terreaux (l. 114).
  - Produits animaux transformés (farines de sang, de plumes…) : conformes aux règlements 1069/2009 et 142/2011 (l. 426).
  - Matières organiques conventionnelles : il faut une **garantie non-OGM** du fournisseur (art. 11 ; GDL l. 103-105).
- **R15. Engrais minéraux azotés interdits** (A-II-I 1.9.8, p. 59).
- **R16. Plafond de 170 kg N par an et par hectare de SAU**, issu des **effluents d'élevage** au sens de la directive 91/676/CEE, dans les unités bio et en conversion (A-II-I 1.9.4, p. 59).
  - Il ne s'applique **qu'au** fumier, fumier séché, fiente de volaille déshydratée, compost d'excréments solides (fiente comprise), fumier composté et excréments liquides (lisier).
  - En cas d'**accord écrit d'épandage** entre opérateurs bio, le plafond est calculé sur l'ensemble des unités concernées (1.9.5).
  - La note de lecture INAO « 170 kg ha an N » est citée par le GDL (l. 144) mais **absente du fichier**.
- **R17. Effluents d'élevages industriels interdits** : la réponse est **oui**, selon le GDL l. 425 qui reprend la mention « Provenance d'élevages industriels interdite » de l'annexe II du RUE 2021/1165.
  - Sont exclus « à partir du 1er janvier 2021 » les effluents d'élevages **sur caillebotis ou grilles intégraux** ou **en cages**, **dépassant les seuils de l'annexe I de la directive 2011/92/UE**. Ces seuils, en nombre de places, sont **hors sources**.
  - **Digestats** : seulement ceux d'unités alimentées par des matières de l'annexe II (pas de boues). Un éleveur bio qui apporte ses effluents doit en reprendre le digestat au prorata.
- **R18. Préférence pour les effluents et matières organiques bio, de préférence compostés** (1.9.2 c). Le compostage est défini par le GDL (l. 139) : montée en température, réduction de volume… Un dépôt de fumier en tas ou un « compostage de surface » **n'est pas** un compost.
- **Autres points.** Micro-organismes (1.9.6), activateurs de compost (1.9.7) et préparations biodynamiques (1.9.9) sont autorisés. Les préparations naturelles peu préoccupantes conformes au « CDC plantes consommables » (arrêté du 14/06/2021) le sont aussi (GDL l. 142).

### 2.5 Protection des plantes

- **R19. Priorité à la prévention** (A-II-I 1.10.1, p. 59) : prédateurs naturels, choix des espèces, variétés et matériel hétérogène, rotation, techniques culturales, méthodes mécaniques, solarisation.
  - **Vapeur** : sous **cultures protégées** seulement, **10 cm de profondeur au plus**.
  - Le GDL (l. 150, 19/06/2025) définit « culture protégée » (serres, tunnels, films, mulchs) et autorise le désherbage thermique, électrique ou physique.
  - Paillages : naturels, **biodégradables NF EN 17033**, papier, ou non biodégradables récupérés. Les paillages **oxodégradables sont interdits**.
- **R20. Produits phytopharmaceutiques** (A-II-I 1.10.2 ; 848 art. 9.3 et 24) : seuls ceux autorisés à la fois en bio (**annexe I du RUE 2021/1165**, substances actives) et au titre du 1107/2009 (AMM), **en cas de menace avérée**, **dans la mesure nécessaire**. L'opérateur tient des **registres justifiant la nécessité** de chaque usage.
  - Hors 1107/2009 et utilisables (GDL l. 53, 152) : macro-organismes auxiliaires (autorisation nationale s'ils sont non indigènes) et « barrières physiques » (argiles, lithothamne, glues et mastics naturels, cire d'abeille ; pas sur les produits récoltés).
- **R21. Cuivre** (GDL l. 420, 05/11/2024, citant les règlements 540/2011 et 2018/1981) : « seules les utilisations entraînant une application totale maximale de **28 kg de cuivre par hectare sur une période de 7 ans** peuvent être autorisées ».
  - Le **lissage** n'est possible que si l'AMM le prévoit.
  - Si l'AMM mentionne **4 kg Cu/ha/an** au plus, cette dose annuelle s'impose, sans lissage.
  - Sinon, chaque année est **décomptée des 28 kg sur 7 ans à partir du 1/1/2022**.
  - Les **engrais foliaires et oligo-éléments** ne doivent pas servir d'usage fongicide. En cas de mésusage avéré, leur cuivre est **comptabilisé**.
- **R22. Pièges** (1.10.3) : ils empêchent la dissémination et le contact avec la culture. **Tous les pièges** (y compris à phéromones) sont **retirés et éliminés** après usage.
- **R23. Pas de rayonnements ionisants ni d'OGM** (art. 9.4 et 11) ; pas de variétés OGM en semences (GDL l. 103).

### 2.6 Semences et matériel de reproduction

- **R24. Matériel bio obligatoire** (A-II-I 1.8.1, p. 58). Pour être bio, le matériel doit provenir d'une plante-mère conduite en bio pendant **une génération**, ou **deux périodes de croissance** pour les pérennes (1.8.2). Il faut privilégier le matériel adapté à l'AB (1.8.3).
- **R25. Dérogation pour matériel en conversion ou non bio** (1.8.5.1 à 1.8.5.5, p. 58-59).
  - Elle n'est possible que si la **base de données nationale** (art. 26.1, p. 33) montre que le besoin n'est pas couvert. L'opérateur doit la **consulter avant** de demander.
  - **Plantules exclues** de la dérogation : les plants doivent être bio. Les **plants de pommes de terre**, eux, sont dans la base.
  - Le matériel non bio doit être **non traité**, sauf avec des produits admis pour le traitement des semences (art. 24.1) ou si un traitement est prescrit pour raisons phytosanitaires.
  - L'autorisation est obtenue **avant le semis**, **individuelle, pour une saison** ; l'autorité répertorie les quantités.
  - **Fin des dérogations au 31/12/2035** (848 art. 53.1, p. 52), avec une possible anticipation ou prolongation par acte délégué après le 1/1/2028.
  - La note de lecture INAO « MRV » est **absente du fichier**. La base française (nom, URL) n'est pas dans les sources lues.
- **R26. Matériel hétérogène biologique** (848 art. 3 point 18, p. 19 ; art. 13, p. 27-28) : ensemble végétal non variétal, notifié aux organismes officiels, inscrit sur une liste, et commercialisable hors certification variétale. Il n'y a pas de règle de contrôle chiffrée côté agriculteur.
- **Semences de ferme** : l'art. 6 i) (p. 24) encourage l'usage de matériel de reproduction issu de l'exploitation, sous réserve du droit des obtentions végétales. Il doit être produit en bio (1.8.2).

### 2.7 Irrigation

- **Aucune règle spécifique dans les sources lues.** On ne trouve que le principe d'« utilisation responsable » de l'eau (848 art. 5 c, cité par le GDL l. 43) et l'interdiction de l'hydroponie, des fertilisants non autorisés dans l'eau et de la fertirrigation avec des produits hors annexe II (par conséquence de R14). Pas de seuil.

### 2.8 Nettoyage du matériel et des locaux

- **R27. Matériel à usage mixte** (GDL l. 72, 30/09/2021, art. 9.2). Il est possible **avec un nettoyage approprié entre les usages**, ou avec le **déclassement d'un volume tampon**, proportionné au risque. Si un nettoyage complet est impossible, **l'usage mixte est interdit**. Le nettoyage est fait **avant usage**, **enregistré** dans un registre ad hoc, avec des produits de l'**annexe IV du RUE 2021/1165**.
- **R28. Produits de nettoyage et désinfection** (A-II-I 1.11, p. 60 ; annexe III 7.5, p. 87) : seulement ceux autorisés au titre de l'art. 24. Pour les bâtiments de production végétale, le GDL (l. 433) renvoie à une liste nationale. Le CCF élevage du 28/12/2021 (titre II ch. 3, annexe I) restreint ces produits à son annexe I.

### 2.9 Récolte, transport, stockage

- **R29. Stockage** (annexe III point 7, p. 87).
  - Identification des **lots**. Produits bio et en conversion identifiables **à tout moment**.
  - **Interdiction de stocker des intrants non autorisés** dans les unités de production bio ou en conversion (7.2).
  - Stockage commun : séparation, mesures anti-mélange, **nettoyage contrôlé et enregistré** avant le stockage bio (7.4).
  - Le GDL (l. 89, 05/11/2024) précise qu'en cas de mixité, un même local est possible si les intrants AB et conventionnels sont dans des **enceintes séparées, fermées, identifiées** (au moins des armoires distinctes). Une ferme 100 % bio ne peut pas stocker pour le compte d'un tiers des intrants non autorisés.
- **R30. Collecte et transport** (annexe III points 1, 2 et 5, p. 85-86).
  - En collecte simultanée : informations jours, heures, circuits.
  - Emballages fermés et étiquetés : opérateur, produit, **code de l'OC**, **n° de lot** relié aux registres de l'art. 34.5.
  - À la réception : contrôle de la fermeture et des étiquettes, **résultat inscrit au registre**.
  - Véhicules ayant transporté du non bio : nettoyage contrôlé et enregistré (3 b, aliments pour animaux).

### 2.10 Précaution, contamination, manquement

- **R31. Mesures de précaution** (848 art. 28.1, p. 35) : identifier les risques de contamination et les étapes critiques, mettre en place des mesures et les réexaminer. C'est un objet de contrôle (art. 38.1 a).
- **R32. Soupçon de non-conformité** (art. 27 et 28.2, p. 34-35) : identifier et **isoler** le lot, vérifier, ne pas le vendre en bio, **informer l'OC** si le soupçon persiste. Un produit est **déclassé** si l'opérateur a utilisé un produit non autorisé ou n'a pas pris les précautions (art. 29.2, p. 36).
- **R33. Certificats des fournisseurs** (art. 35.6, p. 41) : l'opérateur **vérifie les certificats** de ses fournisseurs (semences bio, plants, fertilisants issus de fermes bio, prestataires).
- **R34. Catastrophes** (art. 22, p. 31 ; RUE 2020/2146) : l'État membre peut accorder des dérogations temporaires. En France, une dérogation pour l'achat de fourrage non bio se demande à l'INAO **avant l'achat** (GDL l. 416).

### 2.11 Spécifiques

- **Champignons** (A-II-I 2.1, p. 60) : substrats limitatifs. Les fumiers non bio sont admis **seulement si le bio est indisponible** et à **25 % en poids au plus** des composants avant compostage.
- **Cueillette sauvage** (2.2) : zone non traitée depuis **au moins 3 ans** avec des produits non autorisés.
- **Vin** (848 art. 18, annexe II partie VI ; GDL l. 400-412) : raisins et matières premières **100 % bio** ; produits œnologiques de l'**annexe V partie D** du RUE 2021/1165. Désalcoolisation interdite ; traitements thermiques à 75 °C au plus. Toute pratique nouvelle depuis le 1/8/2010 est interdite tant qu'elle n'est pas admise en bio. Tout cela relève de la cave, pas de la parcelle, et sort du périmètre « culture ».

---

## 3. Obligations documentaires

| Obligation | Référence | Contenu |
|---|---|---|
| **Notification** de l'activité | 848 art. 34.1 (p. 39) ; GDL l. 473-474 | Avant toute mise en marché bio ou en conversion **et avant la période de conversion**. En France, en ligne auprès de l'**Agence Bio** (http://notification.agencebio.org), avant l'engagement OC (tolérance de 15 jours). Elle désigne l'OC. La liste des opérateurs est publique sur agencebio.org (art. 34.6 ; GDL l. 479-480). |
| **Engagement OC et déclaration descriptive** | 848 art. 39.1 d (p. 44-45) | Déclaration signée et tenue à jour : **description complète de l'unité** bio ou en conversion et des activités ; **mesures pratiques** ; engagements (informer les acheteurs, accepter le transfert du dossier, **informer en cas de retrait**, conservation du dossier **5 ans** par le dernier OC). |
| **Certificat** | 848 art. 35 (p. 40-41) | Délivré par l'OC (modèle annexe VI, électronique si possible). **Indispensable avant de vendre** en bio ou en conversion. Catégorie (a) : végétaux non transformés, y compris semences. |
| **Registres généraux** | 848 art. 34.5 (p. 40), art. 39.1 a (p. 44) ; RUE 2021/2119 art. 2 (non lu) | Registres des activités prouvant la conformité. |
| **Registre parcelles et récoltes** | A-II-I **1.12** (p. 60) | « Registres relatifs aux parcelles concernées et à la quantité récoltée ». |
| **Registre des fertilisants** | A-II-I 1.9.3 (p. 59) | Utilisation des engrais et amendements. Le GDL attend un **bilan ou plan de fertilisation**. |
| **Registre phyto avec justification** | A-II-I 1.10.2 (p. 59) | Registres **justifiant la nécessité** de chaque usage. C'est plus que le registre phyto réglementaire classique. |
| **Registres de séparation (mixité)** | 848 art. 9.10 c (p. 26) | Preuve de la séparation des unités, intrants et produits. |
| **Plan de conversion des pérennes** | 848 art. 9.8 (p. 25) | Plan confirmé chaque année. Préavis de **48 h avant récolte**, déclaration des quantités après récolte. |
| **Dérogation semences** | A-II-I 1.8.5 (p. 58-59) | Consultation de la base, autorisation **avant semis**, par saison. |
| **Reconnaissance rétroactive** | 848 art. 10.3, RUE 2020/464 art. 1 ; GDL l. 94 | Formulaire INAO et pièces (attestations MAEC, preuves d'absence de traitement depuis au moins 3 ans). |
| **Accord d'épandage** | A-II-I 1.9.5 | Accord écrit avec un opérateur bio pour les effluents excédentaires. |
| **Nettoyage** | GDL l. 72 ; annexe III 3 b et 7.4 c | Registre des nettoyages du matériel mixte, des locaux et des véhicules. |
| **Stockage et lots, réception** | annexe III 1, 2, 5, 7 | Lots ↔ registres ; contrôles à réception consignés. |
| **Garanties non-OGM** | 848 art. 11.4 ; GDL l. 103-109 | Confirmation du vendeur pour les intrants non bio achetés (plus de modèle imposé). |
| **Soupçon de manquement** | 848 art. 27, 28.2 | Information de l'OC. |

---

## 4. Tableau de rapprochement avec Fourmy

Légende de la colonne « Fourmy » : **Oui**, **Part.** (partiellement), **Non**.

| # | Règle (réf.) | Données nécessaires | Fourmy | Ce qui manque |
|---|---|---|---|---|
| R1 | Durée de conversion, C1/C2/AB (A-II-I 1.7.1 ; GDL l. 96-98) | Date de début de conversion **par parcelle**, culture annuelle ou pérenne, date de semis ou plantation, date de récolte | **Part.** (certification AB par parcelle avec début et fin ; niveau « conversion / certifiée » saisi ; activités, interventions de semis et récolte datées) | Le **statut C1/C2/C3/AB doit être calculé** à partir de la date de début, et non saisi. Il manque un attribut **pérenne / annuelle / semi-pérenne** par production, la **date de plantation** des pérennes et une alerte « récolte vendue en conversion < 12 mois » ou « semis bio < 24 mois ». |
| R2 | Mention « en conversion » (848 art. 10.4, 30.3) | Statut à la récolte, produit mono-ingrédient | **Part.** (récoltes, lots) | **Statut AB du lot de récolte** (C1/C2/AB), hérité de la parcelle à la date de récolte. |
| R3 | Début = notification + engagement OC (art. 10.2 ; GDL l. 92, 473) | Date de notification Agence Bio, date d'engagement OC | **Part.** (organisme, n°, date de début) | Champs **date de notification** et **date d'engagement** au niveau de l'**exploitation**. Contrôle de cohérence : début de conversion ≥ notification - 15 jours. |
| R4 | Rétroactivité (art. 10.3) | Indicateur « reconnue rétroactivement », justificatif | **Non** | Champ et pièce jointe (décision INAO). L'historique N-1…N-5 des interventions peut **étayer** l'absence de traitement depuis au moins 3 ans. |
| R5 | Reconversion après traitement non autorisé (1.7.3) | Interventions phyto et fertilisation sur parcelle AB + statut AB du produit | **Oui (phyto)** : feu rouge E-Phy | **Conséquence** à ajouter : la récolte suivante est déclassée et la conversion redémarre. Côté fertilisation, il faut un contrôle « intrant non autorisé » (voir R14). Cas « lutte obligatoire » à noter. |
| R6 | Terres fourragères et parcours (1.7.5) | Usage fourrager, espèces animales | **Part.** (cultures fourragères) | Lien parcelle ↔ atelier d'élevage (hors périmètre). |
| R7 | Mixité, variétés distinguables (art. 9.7 ; GDL l. 78-80) | Pour chaque campagne : parcelles bio et non bio, **espèce + variété**, **abris / serres** | **Part.** (cultures et variétés par activité, certification par parcelle) | Règle de détection : **même espèce en bio et en non bio la même campagne**, puis vérification de la distinction des variétés (liste des critères GDL : à saisir, non automatisable à 100 %). Il manque l'**identification des abris et serres** (interdiction de mixité sous un même abri) et le **type de culture** (mélange vs pure). |
| R8 | Plan de conversion des pérennes, 48 h, quantités (art. 9.8) | Plan, date prévue de récolte, quantités par unité | **Part.** (récoltes et rendements) | Objet « **plan de conversion** » (échéance de 5 ans), **notification à l'OC 48 h avant récolte** (rappel), **déclaration des quantités** par unité. |
| R9 | Séparation intrants et produits (art. 9.10) | Stocks par statut, lots, affectation des intrants | **Part.** (stocks et lots) | **Statut AB du lot** et du lieu de stockage, **séparation** des stocks d'intrants (enceinte AB / non AB). |
| R10 | Culture en sol, hydroponie (1.1-1.4) | Mode de culture : plein champ, abri sol, hors-sol, pot, container | **Non** | Attribut « **mode de culture / support** » de la production. Alerte si hors-sol sur parcelle AB, sauf pots d'ornementales ou aromatiques et plants. |
| R11 | Rotation et légumineuses (1.9.2 a ; GDL l. 136-137) | Historique des cultures par parcelle (N-1…N-5), **famille botanique**, couverts avec **dates de semis et de destruction** | **Oui / Part.** (historique N-1…N-5 et couverts d'interculture) | **Famille « légumineuse »** sur chaque culture et couvert (Fourmy a `family = "legumineuses"` pour les couverts), **durée du couvert ≥ 30 j** (21 j pour un sorgho d'été), compte des **espèces distinctes en maraîchage (≥ 3)**, détection de la **monoculture alternée avec engrais vert**. La notion de « cycle de rotation » maraîcher (plusieurs cultures par an) demande les **séries ou planches**. |
| R12 | Serres et pérennes : engrais verts (1.9.2 b) | Couverts sous abri ou inter-rang | **Part.** | Signal non bloquant (recommandation). |
| R13 | Serres chauffées en énergie renouvelable (GDL l. 43) | Abri chauffé, énergie, date d'entrée en conversion | **Non** | Attribut abri « chauffé / source d'énergie ». |
| R14 | Fertilisants autorisés (1.9.3, annexe II RUE 2021/1165) | Produit, composition, **statut « utilisable en AB »** (annexe II), dose | **Part.** (fertilisants et compositions, cahier de fertilisation, plans) | **Référentiel des matières utilisables en AB** (annexe II du 2021/1165 : il faut un référentiel, comme E-Phy pour la phyto ; l'annexe n'a pas été lue). Il manque aussi la **qualification de chaque matière** (catégorie annexe II, OGM, boues exclues) et un **feu rouge** fertilisant non autorisé sur parcelle AB. |
| R15 | Pas d'engrais minéral azoté (1.9.8) | Composition N + nature minérale ou de synthèse | **Part.** (composition, types de fertilisant au sens Nitrates) | Règle simple : **N minéral > 0 sur parcelle AB → rouge** (à affiner avec le référentiel). |
| R16 | 170 kg N/ha SAU/an d'effluents (1.9.4) | N total des **effluents d'élevage** épandus (types listés), **SAU bio + conversion**, année civile | **Part.** (fertilisants organiques avec origine animale, doses, N ; Fourmy calcule déjà des plafonds Directive Nitrates pour les couverts) | Calcul **annuel N total** des effluents au sens 1.9.4 (et pas N efficace), rapporté à la **SAU des unités AB**. Il manque la base exacte (exploitation ou parcelle : voir §6), la prise en compte des **accords d'épandage** et l'**exclusion des produits hors liste** (ex. digestat, farines : à confirmer). |
| R17 | Effluents d'élevages industriels interdits (annexe II RUE 2021/1165 ; GDL l. 425) | **Provenance** de l'effluent : élevage bio / conventionnel, système (caillebotis intégral, cages), taille vs seuils 2011/92/UE | **Part.** (origine animale = espèce) | **Fiche fournisseur d'effluent** : statut bio, mode de logement, effectif, attestation. Pour un digestat : intrants du méthaniseur. |
| R18 | Préférence pour la matière organique bio et compostée (1.9.2 c) | Origine bio de la matière, compostée ou non | **Non** | Attributs « **issu de l'AB** » et « **composté** ». |
| R19 | Prévention (1.10.1), vapeur ≤ 10 cm sous abri, paillages | Interventions de désherbage mécanique et thermique, paillage | **Part.** (interventions et matériels) | Type de paillage (biodégradable NF EN 17033 / oxo interdit), profondeur de la vapeur, culture protégée. |
| R20 | Phyto autorisés (1.10.2, annexe I RUE 2021/1165) | AMM, mention « utilisable en AB » (E-Phy) | **Oui** (feu rouge déjà en place) | Il manque la **justification de la nécessité** (cible, observation, BSV, seuil), qui est une exigence propre du 1.10.2. Les **produits hors AMM** (macro-organismes, barrières physiques, PNPP) ne sont pas dans E-Phy : leur statut AB est à gérer. **Traitement de semences** : à contrôler aussi (R25). |
| R21 | Cuivre : 28 kg/ha sur 7 ans, ou 4 kg/an si l'AMM le dit (GDL l. 420) | Teneur en **Cu métal** de chaque produit, dose, surface, date ; mention AMM (lissage ou 4 kg/an) ; **engrais foliaires contenant du Cu** | **Part.** (dose et AMM ; composition E-Phy probable) | **Cumul glissant sur 7 ans par ha et par parcelle** depuis le 1/1/2022. Il manque la conversion dose → kg Cu métal, la lecture de la condition d'AMM (SPe1 / 4 kg) et l'**ajout du Cu des engrais foliaires** en cas de mésusage. |
| R22 | Pièges retirés (1.10.3) | Pose et retrait | **Non** | Intervention « pose / retrait de piège ». Faible enjeu. |
| R23 | OGM interdits (art. 11) | Variété OGM, garanties fournisseur | **Part.** (variété, n° GNIS) | Attestation non-OGM pour les intrants non bio, liste des variétés OGM. |
| R24 | Semences et plants bio (1.8.1) | Pour chaque lot semé ou planté : **statut bio / conversion / non bio**, **non traité**, fournisseur et son certificat | **Non** (variété et n° GNIS seulement) | Attributs du lot de semence : **« bio »**, **« non traité »**, n° de certificat fournisseur, **ferme / achat**. Contrôle : **semence non bio sur parcelle AB sans dérogation → rouge** ; **plantule non bio → rouge** (pas de dérogation possible). |
| R25 | Dérogation semences (1.8.5) | N° et date de l'autorisation, espèce, variété, quantité, saison | **Non** | Objet « **dérogation** » (date < semis, saison, quantité autorisée vs semée). Lien avec la base nationale (art. 26). |
| R26 | Matériel hétérogène (art. 13) | Type de matériel | **Non** | Valeur « matériel hétérogène bio » dans le type de semence. |
| — | Irrigation | — | Oui (dose, méthode) | Rien à contrôler côté règlement, sauf la **fertirrigation** (intrants → R14). |
| R27 | Nettoyage du matériel mixte (GDL l. 72) | Matériel utilisé sur parcelles AB et non AB, **ordre des interventions**, nettoyage enregistré, produit | **Part.** (matériels utilisés par intervention, dates) | Détection **matériel passé du non AB à l'AB** (pulvérisateur, semoir, moissonneuse, épandeur) **sans nettoyage enregistré entre les deux** ; intervention « nettoyage » avec produit (annexe IV) ; volume tampon déclassé. |
| R28 | Produits de nettoyage autorisés (1.11) | Produit utilisé | **Non** | Référentiel annexe IV du 2021/1165 et annexe I du CCF. |
| R29 | Stockage et lots (annexe III 7) | Lieux de stockage, statut des lots, intrants stockés | **Part.** (stocks et lots) | **Statut AB des lots** et des lieux, interdiction de stocker des intrants non AB dans les unités AB (sauf enceinte séparée), nettoyage avant stockage. |
| R30 | Transport et réception (annexe III 1, 2, 5) | Bons de livraison, n° de lot, code OC | **Part.** (lots) | **Code OC** sur les documents de sortie, contrôle à réception. |
| R31-R32 | Précaution, contamination | Analyse de risques (dérive des voisins…) | **Non** | Champ libre et plan de mesures ; registre des soupçons et des déclassements. |
| R33 | Certificats des fournisseurs (art. 35.6) | N° de certificat, date de validité du fournisseur | **Non** | Annuaire des fournisseurs avec certificat bio et validité. |
| Doc. | Notification, certificat, registres (§3) | — | **Part.** (registre phyto, cahier de fertilisation, organisme, n°) | **Registre AB consolidé** (parcelles, statut, cultures, intrants, récoltes, ventes, dérogations, nettoyages) **exportable pour l'OC**. |

**Bilan.** Fourmy couvre déjà le socle : parcelles datées, certification par parcelle, historique des cultures, interventions avec intrants, E-Phy, récoltes, lots, matériels. Les gros manques sont **le statut bio des semences et des fertilisants**, **le statut AB des lots et des stocks**, **les objets réglementaires** (dérogation, plan de conversion, notification, accord d'épandage) et **le calcul du statut C1/C2/AB**.

---

## 5. Règles à fort enjeu et faciles à automatiser : classement proposé

Critères : enjeu = gravité selon le catalogue des mesures (déclassement du lot ou de la parcelle, art. 42) ; facilité = données déjà présentes ou un seul attribut à ajouter.

| Rang | Règle | Enjeu | Facilité | Pourquoi |
|---|---|---|---|---|
| 1 | **R20 Phyto non autorisé sur parcelle AB** (déjà fait) + **R5 conséquence** (reconversion, récolte suivante déclassée) | Très fort (perte du statut) | Très facile | Feu rouge existant ; il reste à afficher la conséquence et à figer le statut de la parcelle. |
| 2 | **R1/R2 Statut C1/C2/AB calculé** par parcelle et par récolte | Très fort (vente en AB d'un produit qui ne l'est pas) | Facile | Date de début de certification + dates de semis et récolte + attribut pérenne. |
| 3 | **R21 Cumul cuivre sur 7 ans** | Fort (viticulture, maraîchage) | Facile à moyen | Doses et AMM connues ; il manque la teneur en Cu métal et la condition d'AMM. |
| 4 | **R15/R14 Fertilisant non autorisé ou azote minéral** sur parcelle AB | Fort | Moyen | Compositions présentes ; il faut un référentiel « utilisable en AB » (annexe II du 2021/1165, liste commerciale type « intrants utilisables en AB »). |
| 5 | **R16 Plafond de 170 kg N d'effluents par ha SAU AB et par an** | Fort | Facile | N total des produits organiques d'origine animale déjà connu ; seul le périmètre de calcul est à trancher. |
| 6 | **R24/R25 Semences et plants non bio sans dérogation** | Fort (point classique de non-conformité) | Moyen | Deux attributs à ajouter au lot de semence (bio, non traité) et un objet « dérogation » ; le contrôle devient immédiat. |
| 7 | **R7 Mixité même espèce bio / non bio** la même campagne | Fort (mixité interdite) | Facile pour la détection, l'appréciation reste manuelle | Cultures par parcelle et certification déjà connues. On signale et on demande le critère de distinction. |
| 8 | **R27 Matériel mixte sans nettoyage** | Moyen à fort (contamination) | Moyen | Matériels par intervention déjà saisis ; il faut ajouter l'intervention « nettoyage ». |
| 9 | **R11 Rotation** (légumineuses, monoculture, 3 espèces en maraîchage, couvert ≥ 30 j) | Moyen (appréciation de l'OC) | Moyen | Historique N-1…N-5 et couverts déjà présents ; il manque la famille botanique. Ce sera un indicateur orange, pas un verdict. |
| 10 | **R10 Hors-sol sur parcelle AB** | Fort mais rare | Facile si l'attribut existe | Un seul attribut « mode de culture ». |
| 11 | **R9/R29 Statut AB des lots et des stocks**, séparation | Fort lors d'un audit | Moyen à difficile | Touche le modèle des stocks. |
| 12 | **R8 Pérennes en plan de conversion** (préavis de 48 h) | Moyen | Moyen | Rappels et déclarations. |

Ordre de réalisation suggéré :

1. **Statut AB calculé** (R1/R2) et conséquences du phyto (R5).
2. **Cuivre** (R21) et **170 N** (R16).
3. **Statut AB des semences** et dérogations (R24/R25).
4. **Référentiel fertilisants AB** (R14/R15/R17).
5. **Mixité** (R7) et **nettoyage du matériel** (R27).
6. **Rotation** (R11).
7. **Registre AB exportable** (§3).

---

## 6. Ambiguïtés et questions ouvertes

> **Mise à jour du 19/11/2026** (sources du §8). Chaque question porte désormais un statut : **[Résolue]**, **[Partiellement résolue]**, **[Décidée]** (tranchée par l'utilisateur) ou **[Ouverte]**. Le texte d'origine est conservé ; la réponse suit la flèche « → ».

1. **[Résolue]** → Le RUE 2021/1165 est lu (§8.2). Annexe I : la mention E-Phy reste le bon outil, l'AB-4 cite « e-phy » comme moyen de contrôle documentaire (AB-4 p. 34). Fertilisants : référentiel **par catégorie de matière** de l'annexe II, pas par nom commercial (§8.2.4). Annexe IV : les parties A, B et C sont vides dans la version lue (§8.2.5). Reste à vérifier : les modifications de l'annexe postérieures au 16/07/2021 (non lues).
   Texte d'origine : **Le RUE 2021/1165 n'a pas été lu directement** (EUR-Lex inaccessible). Les listes annexe I (phyto), II (fertilisants) et IV (nettoyage) et leurs conditions d'usage restent à obtenir. Il faut décider si Fourmy s'appuie sur la mention E-Phy (phyto) et sur quel référentiel pour les fertilisants : annexe II brute, ou liste commerciale de produits « utilisables en AB ». Ce référentiel n'est pas dans les sources lues.
2. **Notes de lecture INAO absentes.** Le GDL renvoie à des notes non incluses dans le xlsx : MRV (semences), « 170 kg ha an N », « Produits phyto », « Biodéchets compostés ou fermentés », « Etiquetage », « Distribution ». Elles contiennent probablement les modalités de calcul du 170 N et de la dérogation semences. **À récupérer** (site INAO).
   → **[Ouverte]** Aucun des documents ajoutés ne contient ces notes de lecture. Ils couvrent cependant une partie de leur objet : procédure semences (§8.3.4) et contrôle du 170 N (« calcul des quantités d'azote utilisées par ha/an », AB-4 p. 32).
3. **Périmètre du 170 kg N.** Le texte dit « par an/hectare de surface agricole utilisée » dans les unités bio ou en conversion (1.9.4). Faut-il une moyenne sur la SAU bio de l'exploitation ou un plafond par parcelle ? Est-ce l'année civile ou la campagne ? Prend-on le N total ou le N efficace ? Fourmy calcule aujourd'hui du N **efficace** pour la directive Nitrates : la règle bio parle de N des effluents (vraisemblablement total, à confirmer par la note INAO).
   → **[Décidée / partiellement résolue]** L'utilisateur a tranché : plafond **« par hectare et par parcelle »**. C'est plus strict qu'une moyenne sur la SAU et donc compatible avec le texte. Côté INAO, la méthode de contrôle est « calcul des quantités d'azote utilisées par ha/an » (AB-4 p. 32). Le dépassement est le manquement **n° 40, classé mineur** : avertissement au 1er constat, déclassement du lot (DL) en récurrence (AB-4 p. 121). **Restent ouverts** : N total ou efficace, année civile ou campagne. Aucun document ne le précise. La question de savoir si les **digestats** (catégorie distincte de l'annexe II, 1165 p. 14) comptent dans le plafond reste aussi ouverte.
4. **Élevages « industriels ».** Les seuils de l'annexe I de la directive 2011/92/UE (places de porcs, volailles…) sont **hors sources**. L'agriculteur ne connaît pas toujours le mode de logement de l'élevage fournisseur : faut-il une attestation fournisseur systématique ?
   → **[Partiellement résolue]** L'annexe II porte la mention « Provenance d'élevages industriels interdite » sur six catégories (1165 p. 13, 14, 16), sans définir « industriel ». Les seuils restent **hors sources**. L'usage de ces produits sans tenir compte de la restriction est le manquement **n° 364, mineur** : AV au 1er constat, DL + DPA (déclassement du lot et de la parcelle) en récurrence (AB-4 p. 121). L'OC contrôle à partir des fiches techniques, factures et BL (AB-4 p. 32). Aucun document n'impose une attestation-type ; elle reste une bonne pratique à proposer dans Fourmy.
5. **Date d'application.** L'art. 61 du texte lu indique le 1/1/2021, le GDL évoque des exclusions « à partir du 1er janvier 2021 » et le décompte du cuivre au 1/1/2022. Le report à 2022 vient d'un texte non lu.
   → **[Résolue, indirectement]** Le RUE 2021/1165 doit s'appliquer « à partir de la date d'application du règlement (UE) 2018/848 » (considérant 20, p. 4). Il est « applicable à partir du 1er janvier 2022 » (art. 13, p. 8). Les documents INAO datent leur version 01 du 01/01/2022 (AB-4 p. 4 ; CIR p. 4 ; DIR p. 3). La date d'application effective est donc le **1/1/2022**. Le règlement modificatif lui-même n'a toujours pas été lu.
6. **Statut de conversion dans Fourmy.** Le modèle `parcel_certifications` a `level` = « conversion » ou « certified » saisi à la main. Faut-il le **déduire** (C1/C2/AB) de `started_on` et de la culture, ou garder la saisie et contrôler la cohérence ? Que faire en cas de **reconversion** après un traitement interdit : nouvelle ligne de certification ?
   → **[Décidée + résolue]** Le statut C1/C2/AB est **déduit**, pas saisi (décision de l'utilisateur). L'AB-4 fixe la date de départ :
   - au plus tôt la **date d'engagement**, s'il n'y a pas de manquement impactant au contrôle initial ; sinon, la date de **remise en conformité** (p. 11) ;
   - pour une **nouvelle parcelle** d'un opérateur déjà certifié : jamais avant la réception de sa déclaration écrite par l'OC, ou avant la déclaration de mise en conversion sur **TELEPAC** si la case de transmission à Cartobio est cochée (p. 12).

   Reconversion : la mesure **DPA** « déclasse la parcelle » et « une nouvelle période de conversion est exigée » (p. 103). Il faut donc **clore la certification en cours et ouvrir une nouvelle ligne** à la date de remise en conformité.
   Les OC transmettent à Cartobio le **niveau de conversion**, la **date de début de conversion** et la **culture principale annuelle** de chaque parcelle (CIR p. 35). Le calcul de Fourmy doit produire ces trois champs.
7. **Mixité.** La distinction des variétés relève de l'appréciation (liste d'exemples non exhaustive). La même variété est admise entre bio et C2 ou C1, mais pas entre bio et non bio. Une alerte automatique ne peut que signaler. Faut-il un champ « critère de distinction » validé par l'OC ?
   → **[Ouverte]** Les documents INAO n'ajoutent aucun critère de distinction. Ils donnent la gravité :
   - mixité dans une configuration non autorisée « notamment au regard des espèces et des variétés » : manquement **n° 31, majeur** (DL, puis AV + DL ; AB-4 p. 119) ;
   - insuffisance des mesures de séparation : n° 32, mineur ;
   - absence de registre ad hoc : n° 33, mineur.

   Le contrôle porte sur la **séparation (visuel) + registre de séparation** (AB-4 p. 29). Le champ « critère de distinction » reste une bonne idée, sans exigence formelle.
8. **Rotation en grandes cultures.** Il n'y a ni durée minimale ni fréquence chiffrée de légumineuses (« appréciation globale », GDL l. 136). Quelles règles Fourmy affiche-t-il : la règle maraîchère (3 espèces) ; pour les grandes cultures, au moins une légumineuse sur N années (N à fixer, **hors sources**) ?
   → **[Résolue : il n'existe pas de critère chiffré]** Aucun des six documents ajoutés ne donne de seuil de rotation. La rotation se contrôle sur le **cahier de culture** et par visite des parcelles (AB-4 p. 30 et 32). « Absence de rotation des cultures (ou rotation inadaptée) » est le manquement **n° 39, mineur** : AV, puis DL en récurrence (AB-4 p. 121). En grandes cultures, Fourmy ne peut donc afficher qu'un **indicateur orange** (règles du GDL), pas un verdict.
9. **Cuivre.** Il faut connaître la teneur en cuivre métal de chaque spécialité (E-Phy ou étiquette) et la condition d'AMM (lissage ou 4 kg/an). Le décompte sur 7 ans démarre au 1/1/2022 : pour une parcelle convertie depuis, faut-il compter les applications d'avant la conversion ?
   → **[Partiellement résolue]** La formulation du RUE 2021/1165 est confirmée : « Conformément au règlement d'exécution (UE) n° 540/2011, seules les utilisations entraînant une application totale maximale de 28 kg de cuivre par hectare sur une période de 7 ans peuvent être autorisées » (annexe I, p. 12). Elle vaut pour cinq composés : hydroxyde, oxychlorure, oxyde, bouillie bordelaise, sulfate tribasique. Le texte ne parle **ni de lissage ni de 4 kg/an** : ces modalités viennent du GDL et des AMM. Le mot « cuivre » n'apparaît dans **aucun** des cinq documents INAO. Il n'y a ni point de contrôle ni manquement propre. Le manquement générique **n° 328** (produit autorisé utilisé « dans des conditions d'utilisation non conformes », mineur, AV puis SPC + DL ; AB-4 p. 112) est le plus proche. C'est une interprétation à confirmer avec un OC. **Restent ouverts** : la prise en compte des applications d'avant la conversion et la teneur en Cu métal de chaque spécialité.
10. **Semences.** La base de données nationale (art. 26) et son mode de consultation ne figurent pas dans les sources. La procédure française (demande à l'OC ou à l'INAO, délais) est dans la note MRV absente. La mention « non traité » pour du non bio est-elle disponible chez les fournisseurs (n° GNIS) ?
   → **[Largement résolue]**
   - **Base** : www.semences-plants-biologiques.org (CIR p. 14).
   - **Décision** : la dérogation MRV est la seule **déléguée à l'OC**, et non à l'INAO (CIR p. 6 et 8, citant l'art. 3 al. 1 du règlement délégué 2020/2146).
   - **Pièces contrôlées** : la dérogation (« site semences bio »), ou l'attestation de non-disponibilité en bio pour du matériel en conversion (AB-4 p. 31). Aussi les **étiquettes avec la mention « non traité »**, l'attestation non-OGM, et la **date d'autorisation comparée au cahier de culture** et aux pratiques régionales (AB-4 p. 32).
   - **Délais** : aucun délai chiffré pour les MRV. Une dérogation obtenue **après le semis** est un manquement (n° 38). Les délais de 4 mois et 1 mois (CIR p. 12) concernent les dérogations instruites par l'INAO.
   - **Encore ouvert** : la disponibilité de la mention « non traité » dans les données fournisseurs (n° GNIS).
11. **Irrigation.** Aucune règle bio spécifique n'est trouvée ; seul le contrôle des intrants en fertirrigation s'applique. À confirmer avec un OC.
   → **[Inchangée, confirmée]** Les documents ajoutés ne contiennent aucune règle d'irrigation. L'AB-1 cite seulement la « contamination par l'eau d'irrigation ou ruissellement » parmi les causes possibles de contamination (p. 12), et l'eau parmi les matrices analysables (p. 20).
12. **Produits de nettoyage.** La liste nationale est « dans l'attente d'une liste harmonisée » (GDL l. 433) ; l'annexe I du CCF élevage s'applique aux bâtiments de production végétale. Quel référentiel Fourmy adopte-t-il ?
   → **[Résolue]** Dans la version lue, l'annexe IV partie B du RUE 2021/1165 (bâtiments et installations de production végétale, y compris le stockage à la ferme) **ne contient aucun produit** (p. 25). L'art. 5.4 (p. 6) permet donc de continuer à utiliser les produits autorisés avant 2022 au titre du 834/2007 ou du droit national. Pour la production végétale, le manquement n° 366 (AB-4 p. 114) renvoie lui-même au « CC-F, titre 2, chap 3 et Annexe I ». **Référentiel retenu : annexe I du CCF élevage du 28/12/2021**, à remplacer quand l'annexe IV partie B sera remplie. L'usage d'un produit hors liste est le manquement **n° 366, mineur** (AV, AV en récurrence).
13. **Registres « justifiant la nécessité »** des phyto (1.10.2) : quel niveau de preuve l'OC attend-il (observation, BSV, seuil de nuisibilité) ? Fourmy pourrait relier le traitement au BSV ou à l'observation de la parcelle.
   → **[Partiellement résolue]** Le manquement **n° 44** (mineur, aucune mesure au 1er constat, AV en récurrence ; AB-4 p. 122) définit le défaut de justification ainsi : « sans mise en œuvre préalable des mesures citées au point 1.10.1 ». La preuve attendue est donc celle des **mesures préventives** (rotation, variétés, désherbage mécanique…) plus que celle d'un seuil. Pièces contrôlées : cahier de culture, fiche technique, factures, visite des parcelles et des stocks (AB-4 p. 33). Le niveau de détail attendu (BSV, observation) n'est pas précisé.
14. **Fréquence et contrôles inopinés.** Les pourcentages minimaux (art. 38.9) sont fixés par actes d'exécution non lus.
   → **[Résolue]** En France, pour les producteurs :
   - **1 contrôle complet sur site par an** ;
   - au moins **10 % de contrôles supplémentaires** fondés sur le risque ;
   - des **contrôles par sondage** égaux à **50 %** du nombre de producteurs certifiés de la catégorie ;
   - **10 %** des contrôles sur site **sans préavis** (AB-4 p. 13-16 ; CIR p. 5 et 32) ;
   - des **prélèvements** chez au moins **5 %** des opérateurs engagés individuellement, et 2 % des membres de groupes (AB-1 p. 5).
15. **Textes français fournis.** Deux des trois arrêtés (restauration 2019, sel 2024) sont **hors périmètre** des cultures. Le CCF élevage 2021 n'apporte que les produits de nettoyage. Il n'y a **pas de CCF « productions végétales »** dans la liste : les règles végétales viennent de l'UE et du GDL.
   → **[Confirmée]** La CIR (p. 5) énumère les seuls CCF en vigueur que les OC contrôlent : élevage, restauration commerciale, sel. Il n'existe aucun CCF végétal. L'**AB-2** ajouté concerne lui aussi la seule restauration commerciale.
16. **Élevage** (pour mémoire, quand il touche les cultures) : conversion des terres fourragères (1.7.5), plafond 170 N et accords d'épandage (1.9.4-1.9.5), mixité des pâturages supprimée (GDL l. 83), lien au sol des digestats (GDL l. 425), densité animale limitée à 170 kg N (annexe II partie II 1.6.6, non lue en détail).
   → **[Sans objet ici]** Hors périmètre. On note seulement que l'AB-4 contient les points de contrôle élevage (p. 39-68) et les manquements de la partie 7 du catalogue (p. 127-141).
17. **[Décidée]** La **liste CMR** (côté HVE) est **sans objet** pour le contrôle AB (décision de l'utilisateur).

---

## 7. Sources

- Règlement (UE) 2018/848, JO L 150 du 14/06/2018, `docs/ab/CELEX_32018R0848_FR_TXT.pdf` : pages 18-19, 22-28, 31-37, 39-47, 52-53, 55, 57-61, 85-87.
- Arrêté du 9/12/2019 (restauration commerciale bio), JORF n° 288 du 12/12/2019, `docs/ab/joe_20191212_0288_0053.pdf` ; https://www.legifrance.gouv.fr/loda/id/JORFTEXT000039481757
- Guide de lecture INAO, `docs/ab/GDL_17-04-2026.xlsx` (feuille « Guide de lecture », dernière modification le 26/03/2026), lignes citées.
- Arrêté du 28/12/2021 (CCF élevage) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000044793347
- Arrêté du 15/07/2024 (CCF sel) : https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000050060154
- Non lus (HTTP 403) : https://agriculture.ec.europa.eu/farming/organic-farming/legislation_fr ; https://www.agencebio.org/decouvrir-le-bio/les-textes-reglementaires/
- Recherche web, identification seulement : RUE 2021/2119 (https://eur-lex.europa.eu/eli/reg_impl/2021/2119/oj/eng ; version consolidée https://www.certipaq.com/wp-content/uploads/2023/10/BIO_RUE-2021-2119-version-consolidee-18112022.pdf), RUE 2021/279 (https://eur-lex.europa.eu/eli/reg_impl/2021/279/oj?locale=fr), RUE 2020/464 (https://www.certipaq.com/wp-content/uploads/2022/10/BIO-RUE-2020-464-version-consolidee-25112021.pdf).
- Code Fourmy consulté en lecture : `packages/db/migrations/0015_certifications.sql`, `apps/api/src/repos/registers.ts`, `apps/api/src/repos/fertilization-record.ts`, `packages/db/migrations/0033_irrigation.sql`.

---

## 8. Compléments (sources ajoutées le 19/11/2026)

**Méthode.** Les six PDF ont été extraits avec `pdftotext -layout`, avec un repère par page. Les tableaux du catalogue national des mesures (AB-4, annexe 3) se lisent mal en texte : la colonne de classe (mineur, majeur, critique) est perdue. Les pages 112 à 123 et 162 ont donc été **vérifiées visuellement**. Pour les autres lignes citées, seules les mesures (1er constat, récurrence) viennent du texte ; la classe n'est donnée que lorsqu'elle a été vérifiée.

**Notation.**
- « 1165 p. n » = page du PDF du RUE 2021/1165 ; la page n correspond au folio JO **L 253/(n + 12)**, par exemple p. 12 = L 253/24.
- « AB-4 p. », « CIR p. », « AB-1 p. », « DIR p. » = pagination « n/total » imprimée en pied de page.
- Mesures du catalogue (AB-4 p. 103-104) :
  - **AV** : avertissement ;
  - **DL** : déclassement du lot ou de la récolte ;
  - **DPA** : déclassement de la parcelle (ou des animaux), avec nouvelle période de conversion exigée ;
  - **SPC** : suspension partielle de certification ;
  - **SC** : suspension complète ;
  - **RC** : retrait complet, qui interdit tout engagement auprès d'un autre OC pendant 1 an ;
  - « / » : pas de mesure, simple remise en conformité.

### 8.1 Identification des documents

| Réf. courte | Fichier | Titre, version, date | Objet | Apport au contrôle des cultures |
|---|---|---|---|---|
| **1165** | `CELEX_32021R1165_FR_TXT.pdf` (36 p.) | **Règlement d'exécution (UE) 2021/1165** de la Commission du 15/07/2021, JO L 253 du 16/07/2021, **version initiale** (pas une consolidation) | Il autorise certains produits et substances en bio et en établit les listes limitatives. Il abroge le 889/2008 (art. 11, p. 7). Il est applicable au **1/1/2022**, les art. 5.1 à 5.3 (nettoyage) et 7 au 1/1/2024 (art. 13, p. 8). | **Fort.** Annexe I (phyto), annexe II (fertilisants), annexe IV (nettoyage). Les modifications postérieures au 16/07/2021 **n'ont pas été lues**. |
| **CIR** | `INAO-CIR-2021-03_21-09-2026.pdf` (39 p.) | **Circulaire INAO-CIR-2021-03 v8** du 17/09/2026 | Délégation de tâches aux OC dans le domaine de l'AB. | **Moyen.** Elle répartit les dérogations entre INAO et OC : seule la dérogation semences est déléguée à l'OC. Elle fixe la procédure et les délais d'instruction INAO, désigne la base semences, organise Cartobio (niveau et date de conversion des parcelles), les fréquences de contrôle et la « contextualisation » des mesures. |
| **AB-1** | `INAO_DEC_CONT_AB_1_21-09-2026.pdf` (23 p.) | **Décision INAO-DEC-CONT-AB-1 v8** du 17/09/2026 | Dispositions de contrôle communes (DCC) relatives à la **stratégie analytique** : prélèvements et analyses. | **Moyen.** Elle fixe la fréquence des prélèvements, les matrices au champ, la valeur de référence pesticides et la conduite de l'enquête. |
| **AB-2** | `INAO-DEC-CONT-AB-2.pdf` (25 p.) | **Décision INAO-DEC-CONT-AB-2 v2**, datée 14/10/2019 et 23/02/2021 ; bases juridiques 834/2007 et 889/2008 | DCC du cahier des charges **restauration hors foyer à caractère commercial**. | **Aucun.** Même périmètre que l'arrêté du 9/12/2019 (JOE 2019). |
| **AB-4** | `INAO-DEC-CONT-AB-4_22-09-2026.pdf` (170 p.) | **Décision INAO-DEC-CONT-AB-4 v10** du 17/09/2026 | DCC relatives à la **certification bio**, c'est-à-dire le plan de contrôle commun des OC. Contenu : processus de certification (§2), fréquences et risques (§3), **points de contrôle et méthodes** (§4.2, p. 18-99), gestion des manquements (§5-6), certificat (§7), modèle de **déclaration d'engagement** (annexe 1, p. 107-108), **évaluation des risques** (annexe 2, p. 109-111) et **catalogue national des mesures** (annexe 3, p. 112-170, « CAC juin 2026 »). | **Essentiel.** Il dit ce que l'OC vérifie, sur quelles pièces, et la sanction de chaque manquement. |
| **DIR** | `INAO-DIR-CAC-7_01-10-2026.pdf` (4 p.) | **Directive INAO-DIR-CAC-7 v2** du 30/09/2026 | Principes généraux du contrôle de la production biologique. | **Faible.** Elle définit les méthodes de contrôle (documentaire à distance ; sur site : visuel, documentaire, mesure, analytique) et la vérification du retour à la conformité. |

Remarque : la date des noms de fichiers (21-09, 22-09, 01-10-2026) ne correspond pas à la date des documents. C'est probablement la date de téléchargement.

### 8.2 Règlement d'exécution (UE) 2021/1165

#### 8.2.1 Articles utiles aux cultures

- **Art. 1** (p. 4). Une substance de l'annexe I n'est utilisable que dans un produit qui remplit trois conditions : (a) il est autorisé au titre du 1107/2009 (AMM) ; (b) il est utilisé selon les conditions de cette autorisation ; (c) il respecte les conditions de l'annexe du 540/2011.
- **Art. 2** (p. 4-5). Les produits de l'annexe II doivent aussi respecter le droit des fertilisants (2003/2003, 2019/1009) et des sous-produits animaux (1069/2009, 142/2011).
- **Art. 5.2** (p. 5). Seuls les produits de l'**annexe IV partie B** sont permis pour nettoyer et désinfecter « les bâtiments et installations utilisés pour la production végétale, y compris pour le stockage dans une exploitation agricole ».
- **Art. 5.4** (p. 6). En attendant leur inscription à l'annexe IV, les produits autorisés avant 2022 au titre du 834/2007 **ou du droit national** restent utilisables.

#### 8.2.2 Annexe I : substances actives phytopharmaceutiques (p. 9-12)

**Structure.** Le préambule (p. 9) pose les règles communes :
- conditions de l'AMM et du 540/2011 ; les « conditions plus restrictives » propres au bio figurent en **dernière colonne** ;
- phytoprotecteurs, synergistes, coformulants et adjuvants admis s'ils sont autorisés au titre du 1107/2009 ;
- usage **contre les organismes nuisibles** seulement, et seulement si les mesures du point 1.10.1 (prévention) ne suffisent pas.

Les substances sont réparties en quatre sous-catégories :

| Sous-catégorie | Règle d'inclusion | Page |
|---|---|---|
| 1. Substances de base (partie C du 540/2011) | Celles d'origine végétale ou animale issues de denrées alimentaires, marquées d'un astérisque, sont admises, y compris « autres substances de base d'origine végétale ou animale et issues de denrées alimentaires ». Les autres ne le sont que si elles sont listées. **Jamais comme herbicides.** | p. 9-10 |
| 2. Substances à faible risque (partie D), hors micro-organismes | Seulement si elles sont listées (COS-OGA, cérévisane, phosphate ferrique, laminarine). | p. 10-11 |
| 3. Micro-organismes | **Tous** ceux des parties A, B et D du 540/2011, s'ils ne proviennent pas d'OGM. | p. 11 |
| 4. Autres substances | Seulement celles du tableau (spinosad, soufre, huiles de paraffine, pyréthrines, kaolin, cuivre…). | p. 11-12 |

**Conditions d'usage notables (dernière colonne).**

| Substance | Condition | Page |
|---|---|---|
| **Composés de cuivre** (hydroxyde, oxychlorure, oxyde, bouillie bordelaise, sulfate tribasique ; n° 10E) | « Conformément au règlement d'exécution (UE) n° 540/2011, seules les utilisations entraînant une application totale maximale de 28 kg de cuivre par hectare sur une période de 7 ans peuvent être autorisées » | p. 12 |
| Phosphate diammonique | « Uniquement pour pièges » | p. 10 |
| Phéromones et autres sémiochimiques | « Uniquement pour pièges et distributeurs » | p. 11 |
| Deltaméthrine, lambda-cyhalothrine | « Uniquement pour pièges avec appâts spécifiques contre Batrocera oleae et Ceratitis capitata » | p. 12 |
| Éthylène | « Uniquement sur les bananes et les pommes de terre » ; agrumes contre la mouche des fruits | p. 11 |
| Acides gras ; huiles de citronnelle, girofle, colza, menthe verte, orange, mélaleuque | « Toutes utilisations autorisées, sauf en tant qu'herbicide » | p. 11-12 |
| Chlorhydrate de chitosane | Issu d'Aspergillus, de l'aquaculture biologique ou de la pêche durable | p. 9 |
| Cérévisane ; micro-organismes | « Ne provenant pas d'OGM » | p. 10-11 |
| Laminarine | Varech issu de l'aquaculture biologique ou récolté durablement | p. 11 |
| Azadirachtine | Extrait de graines de neem | p. 12 |
| Protéines hydrolysées | « à l'exclusion de la gélatine » | p. 11 |

**Limites chiffrées.** La **seule limite de dose chiffrée de l'annexe I est celle du cuivre**. Le texte ne mentionne **ni lissage ni plafond annuel de 4 kg** : ces modalités viennent du GDL l. 420 et des AMM (§2.5 R21). Les autres conditions portent sur la forme d'usage (pièges), la culture, l'interdiction comme herbicide ou l'origine.

**Pour Fourmy.**
- L'AB-4 désigne « e-phy » comme pièce de contrôle documentaire de l'art. 1 (AB-4 p. 34). Le feu rouge fondé sur la mention E-Phy est donc le bon mécanisme.
- Il faut **vérifier (hors sources)** que la mention E-Phy reflète les restrictions « uniquement pour pièges ». Sinon, une pulvérisation de deltaméthrine ou de phosphate diammonique sur une parcelle AB doit déclencher une alerte propre.

#### 8.2.3 Annexe II : engrais, amendements du sol et éléments nutritifs (p. 13-17)

**Préambule** (p. 13) : conformité au droit des fertilisants et des sous-produits animaux. Les préparations de micro-organismes sont admises (renvoi au point 1.9.6). La première colonne s'intitule « **Produits composés ou produits contenant uniquement les matières reprises dans la liste ci-dessous** ». Ce titre est la clé du référentiel (§8.2.4).

**Catégories listées.** « EI » = mention « **Provenance d'élevages industriels interdite** ».

| Groupe | Catégories et conditions | Page |
|---|---|---|
| **Effluents d'élevage** | Fumiers (excréments + matière végétale) **EI** ; fumier séché et fiente de volaille déshydratée **EI** ; compost d'excréments d'animaux solides, y compris fientes et fumiers compostés **EI** ; excréments d'animaux liquides, « après fermentation contrôlée et/ou dilution appropriée » **EI** | p. 13 |
| **Composts et déchets** | Mélange composté ou fermenté de **déchets ménagers** : triés à la source, uniquement végétaux et animaux, collecte fermée agréée par l'État membre ; plafonds en mg/kg de MS : Cd 0,7, Cu 70, Ni 25, Pb 45, Zn 200, Hg 0,4, Cr total 70, Cr VI non détectable. **Tourbe** : horticulture seulement (maraîchage, floriculture, arboriculture, pépinière). **Compost de champignonnières** : substrat initial limité aux produits de l'annexe. **Lombricompost** et déjections d'insectes. **Guano**. Mélange composté ou fermenté de **matières végétales**, y compris fermentation anaérobie pour biogaz. | p. 13 |
| **Digestat** | Digestat de biogaz contenant des sous-produits animaux codigérés avec des matières de l'annexe. Sont admis les sous-produits animaux de **catégorie 3** et le contenu du tube digestif de **catégorie 2** (1069/2009). **EI**. Procédés conformes au 142/2011. « Ne pas appliquer sur les parties comestibles de la plante ». | p. 14 |
| **Produits animaux transformés** | Farines de sang, d'onglons, de corne, d'os (y compris dégélatinisés), de poissons, de viande, de plumes, poils et chiquettes ; laine ; fourrure (chrome VI non détectable dans la MS) ; poils ; produits laitiers ; protéines hydrolysées (« ne pas appliquer sur les parties comestibles ») | p. 14 |
| **Matières végétales** | Produits et sous-produits organiques végétaux (ex. tourteaux d'oléagineux, coque de cacao, radicelles de malt) ; protéines hydrolysées végétales ; algues (procédés physiques, extraction aqueuse ou fermentation ; bio ou récolte durable) ; sciures et copeaux, écorces compostées, cendres de bois (« bois non traités chimiquement après abattage ») | p. 14 |
| **Phosphates et potasse** | Phosphate naturel tendre (≥ 25 % P₂O₅) ; phosphate aluminocalcique (≥ 30 % P₂O₅, « limitée aux sols basiques (pH > 7,5) ») ; scories de déphosphoration (≥ 12 % ou 10 % P₂O₅) ; sel brut de potasse (≥ 9 % K₂O, 2 % MgO) ; sulfate de potassium ; vinasse et extraits (« Exclusion des vinasses ammoniacales »). Teneurs en cadmium et contaminants : 90 mg/kg P₂O₅ jusqu'au 15/07/2022, limites du 2019/1009 ensuite. | p. 14-15 |
| **Calcium, magnésium, soufre, oligo-éléments** | Carbonate de calcium (origine naturelle) ; résidus de mollusques (aquaculture bio ou pêche durable) ; **coquilles d'œufs EI** ; carbonate de calcium et magnésium, kiésérite (origine naturelle) ; solution de chlorure de calcium (« uniquement pour le traitement foliaire des pommiers, en prévention d'une carence en calcium ») ; gypse (≥ 25 % CaO, 35 % SO₃) ; chaux résiduaires de sucrerie et de saline sous vide ; soufre élémentaire ; engrais inorganique à oligo-éléments ; chlorure de sodium ; poudres de roche, argiles | p. 16 |
| **Matières humiques et divers** | Léonardite et xylite (sous-produits miniers) ; acides humiques et fulviques (hors sels d'ammonium) ; chitine (aquaculture bio ou pêche durable) ; sédiments anaérobies d'eau douce (sapropèle ; plafonds de métaux jusqu'au 15/07/2022) ; biochar (matières végétales seulement ; HAP ≤ 4 mg/kg MS jusqu'au 15/07/2022) | p. 16-17 |

**Points à retenir.**
- **Six catégories** portent la mention « élevages industriels interdite » : fumiers, fumier séché et fiente déshydratée, compost d'excréments solides, excréments liquides, digestat contenant des sous-produits animaux, coquilles d'œufs. L'annexe **ne définit pas** « élevage industriel » (renvoi du GDL l. 425 à la directive 2011/92/UE ; seuils hors sources).
- Les quatre catégories d'**effluents** de la p. 13 recouvrent la liste du point 1.9.4 (plafond de 170 N). Le **digestat** est une catégorie séparée : son entrée dans le plafond n'est pas tranchée par les sources.
- **Absences** : aucune boue (STEP, IAA), aucun engrais azoté de synthèse, aucun silicate. Ils sont **exclus par le caractère limitatif** de la liste, ce qui concorde avec le GDL (l. 142, 425-426) et le point 1.9.8.

#### 8.2.4 Constituer un référentiel « fertilisant utilisable en AB »

**Conclusion : par catégorie de matière, pas par nom commercial.** Trois raisons :

1. L'annexe II liste des **matières**, jamais des marques. Selon le titre de sa première colonne, un produit composé est admis s'il ne contient **que** des matières de la liste, dans leurs conditions.
2. Dans les sources lues, aucune liste officielle de produits commerciaux n'existe. La mention « **utilisable en AB** » (UAB) d'un certificat ne vise que les **aliments composés pour animaux** et les **mélanges de semences fourragères** (CIR p. 39). Les fertilisants n'ont donc pas de certification UAB dans ces textes.
3. L'OC contrôle l'usage des engrais à partir du **cahier de culture, des fiches techniques, des factures et BL et du stock**, et vérifie la « cohérence avec les besoins » (AB-4 p. 32-34). Il raisonne donc sur la **composition déclarée** du produit.

**Modèle proposé.**

1. **Table de référence versionnée.** Une cinquantaine d'entrées de l'annexe II (en comptant chaque farine animale à part), chacune avec un code, un libellé, un groupe (tableau ci-dessus), une date de version du texte et des **conditions structurées** :
   - `industrial_origin_forbidden` ;
   - `no_edible_parts` (digestat, protéines hydrolysées) ;
   - `horticulture_only` (tourbe) ;
   - `soil_ph_min = 7.5` (phosphate aluminocalcique) ;
   - `foliar_apple_only` (chlorure de calcium) ;
   - `natural_origin_only` ;
   - `untreated_wood` ;
   - `organic_or_sustainable_harvest` (algues, mollusques, chitine) ;
   - plafonds de métaux ;
   - `counts_in_170N` (effluents du 1.9.4).
2. **Qualification de chaque fertilisant.** Chaque fertilisant de Fourmy, produit commercial ou effluent de ferme, reçoit une ou plusieurs **catégories** et ses **pièces** : fiche technique, attestation de l'élevage fournisseur (non industriel, bio ou non), garantie non-OGM, intrants du méthaniseur pour un digestat.
3. **Règle sur une parcelle AB.**
   - **Rouge** si une catégorie est hors annexe II ou si le produit contient de l'azote minéral de synthèse (manquement n° 4, majeur).
   - **Orange** « justificatif requis » si une condition n'est pas vérifiable automatiquement : origine d'élevage, bois non traité, pH du sol.
   - **Vert** sinon.
4. Une liste commerciale tierce peut **aider la saisie** (préremplir les catégories), mais elle n'est pas la source de vérité (hors sources).
5. **Versionnement.** La version lue est celle de 2021. Les modifications ultérieures de l'annexe II (non lues) devront être intégrées par version datée, comme pour E-Phy.

#### 8.2.5 Annexe IV : nettoyage et désinfection (p. 25)

- Les **parties A, B et C n'ont que leur titre** : aucun produit n'y figure dans la version lue. La **partie B** couvre les « bâtiments et installations utilisés pour la production végétale, y compris pour le stockage dans une exploitation agricole ».
- La **partie D** liste les produits de l'ancienne annexe VII du 889/2008 qui **ne peuvent pas être utilisés comme biocides** : soude et potasse caustiques, acide oxalique, essences de plantes (sauf huiles de lin, lavande, menthe poivrée), acides nitrique et phosphorique, carbonate de sodium, sulfate de cuivre, permanganate de potassium, tourteaux de graines de thé, acide humique, acides peroxyacétiques (sauf acide peracétique).
- **Conséquence.** Faute de liste UE, l'art. 5.4 s'applique. Le catalogue renvoie, pour la production végétale, au « CC-F, titre 2, chap 3 et Annexe I » (manquement n° 366, AB-4 p. 114). Le référentiel de Fourmy pour R28 est donc l'**annexe I du CCF élevage du 28/12/2021**.

### 8.3 Ce que les documents INAO disent du contrôle en production végétale

#### 8.3.1 Organisation du contrôle

- **Fréquences** (année civile, AB-4 p. 13-16 ; CIR p. 5, 31-33 ; AB-1 p. 5) :
  - 1 contrôle **complet** sur site par an ;
  - au moins **10 %** des opérateurs en contrôle **supplémentaire** sur risque ;
  - des contrôles **par sondage** égaux à **50 %** des producteurs certifiés de la catégorie ;
  - **10 %** des contrôles sur site **sans préavis** ;
  - des **prélèvements** chez au moins **5 %** des opérateurs engagés individuellement (2 % des membres d'un groupe).
- **Refus de contrôle.** Un report de contrôle sans motif exceptionnel vaut **refus de contrôle** (AB-4 p. 13) : manquement n° 13, critique, SC puis RC (p. 115).
- **Méthodes** (DIR p. 3-4) :
  - contrôle documentaire à distance ;
  - sur site : visuel (parcelles), documentaire (registres, certificats, BL, factures, analyses), **mesure des parcelles**, analytique ;
  - la production en cours est contrôlée sur place ; les **lots produits depuis le précédent contrôle** sont contrôlés « par sondage » sur une période représentative.
- **Critères de risque** (AB-4 annexe 2, p. 109-111) : SAU, ancienneté, résultats des 3 dernières années, « **en production végétale : sensibilité de la culture aux maladies et ravageurs** », mixité, dérogations (9.8 cultures pérennes, 10.3 rétroactivité), **proximité de parcelles conventionnelles**. Pour un plan de conversion 9.8, le contrôle a lieu **pendant la récolte** (p. 17).
- **Dates clés** (AB-4 p. 10-12) :
  - la **date d'engagement** est la date de signature du contrat si la notification à l'Agence Bio suit dans les **15 jours**, sinon la date de notification ;
  - le **début de conversion** est au plus tôt la date d'engagement, ou la date de remise en conformité en cas de manquement au contrôle initial ;
  - pour une **nouvelle parcelle**, le début est au plus tôt la réception de la déclaration écrite par l'OC, ou la déclaration de mise en conversion sur **TELEPAC** (case de transmission Cartobio cochée).
  - Nuance avec le §3 : le GDL disait que la notification précède l'engagement, avec 15 jours de tolérance. L'AB-4 demande de notifier « dès » la signature du contrat, dans les 15 jours.
- **Cartobio** (CIR p. 35). Depuis le 1/1/2024, les OC transmettent la géolocalisation des parcelles AB avec leur **niveau de conversion**, leur **date de début de conversion** et leur **culture principale annuelle**. Les imports de parcellaires SMAG, MesParcelles, MSA et nCVI sont cités comme cas d'exception.
- **Certificat.** Sa validité va au plus jusqu'au **31 mars N+2** après le dernier contrôle complet (AB-4 p. 106). L'OC statue dans les **6 mois** suivant l'engagement (p. 11).
- **Manquements.**
  - Un **soupçon étayé** entraîne l'interdiction provisoire de vendre en bio (p. 100).
  - L'opérateur a **15 jours ouvrés** pour présenter un plan d'action (p. 100).
  - La **récurrence** s'apprécie **par opérateur**, pas par parcelle ni par variété. À partir du 3e constat, la mesure est au moins aussi grave que la précédente (p. 105).
  - L'OC peut « contextualiser » une mesure, en plus sévère ou, si c'est justifié, en plus léger (CIR p. 34).
- **Analyses** (AB-1).
  - **Aucun seuil de déclassement** n'est fixé ; l'opérateur a une obligation de moyens (p. 11).
  - Une substance non autorisée à **0,02 mg/kg** ou plus, sans prise en compte de l'incertitude, crée un doute substantiel : **blocage des lots** (p. 13).
  - Cette valeur tombe à la limite de quantification en cas de suspicion, d'opérateur à risque, d'alerte, d'**herbicide**, de résidus multiples, etc. (p. 13-14).
  - Au champ, le prélèvement privilégie la plante entière en culture annuelle, les feuilles, rameaux puis fruits en culture pérenne, la terre et les adventices pour les herbicides (p. 6).
  - La fiche de prélèvement décrit les **cultures voisines et leur statut bio ou non bio** (p. 9).
  - L'enquête s'appuie sur le « **plan de traitement de la culture et des cultures avoisinantes** » (p. 14). Le registre de Fourmy est directement utile ici.
  - Si l'opérateur déclare lui-même un produit non autorisé, l'OC relève le manquement sans prélever (p. 5).

#### 8.3.2 Points de contrôle et pièces exigées (AB-4 §4.2)

| Point (texte) | Ce qui est contrôlé | Méthode et pièces | AB-4 p. |
|---|---|---|---|
| 848 art. 9.3 | Produits et substances utilisés | **Cahier de culture**, étiquettes des produits stockés, factures, fiches techniques ; visite des stocks | 21 |
| 848 art. 11 | OGM | Garanties et **attestations non-OGM**, étiquettes, documents d'accompagnement | 21-22 |
| 848 art. 28.1, 27, 28.2 | Mesures de précaution, soupçon | Enregistrements et procédures ; registre des réclamations, autocontrôles, analyses | 22 |
| 848 art. 34.5 ; RUE 2021/2119 art. 2-3 | Registres, comptabilité, déclaration d'engagement | Contrôle documentaire des registres et documents comptables | 23, 28 |
| 848 art. 35.6 | Certificats des fournisseurs | Certificats, **enregistrement de la vérification par l'opérateur**, cohérence factures d'achat et certificats | 23 |
| 848 art. 9.2, 9.7, 9.10 | Exploitation entière ; mixité | Visite des installations ; **absence d'achat d'intrants interdits** ; **registre de séparation** ; registre ad hoc | 29 |
| 848 art. 5 c, 6 b | Chauffage des serres | Visite des serres ; **facture d'électricité** | 30 |
| 848 art. 6 d | Mesures préventives (**rotation**…) | Cahier de culture ; visite des parcelles | 30 |
| 848 art. 6 i ; A-II-I 1.8.1 | Semences et MRV | Cahier de culture ; stock de semences ; factures, BL, certificats, étiquettes | 30-31 |
| 848 art. 9.8 | Mixité des pérennes | **Dérogation INAO** et respect de ses conditions (plan de conversion) ; **information de l'OC (date, quantité)** | 30 |
| A-II-I 1.1, 1.2, 1.4 | Pas de hors-sol ni d'hydroponie ; pots et containers | Visite ; composition des substrats | 30-31 |
| A-II-I 1.7.1 | Durée de conversion avant vente | **Cahier de culture, assolements, dates de semis et de récolte**, factures, BL | 31 |
| A-II-I 1.7.2, 1.7.3 | Conversion prolongée ou abaissée | Factures, BL ; **courrier INAO** fixant la durée | 31 |
| A-II-I 1.8.5.1 | Dérogation MRV | **Dérogation (site semences bio)**, ou attestation de non-disponibilité en bio pour du matériel en conversion | 31 |
| A-II-I 1.8.5.3 | MRV non bio : traitement | BL, facture, **étiquettes (mention non traité)**, attestation non-OGM | 32 |
| A-II-I 1.8.5.4 | Date de l'autorisation | **Cahier de culture et date d'autorisation** ; « cohérence date enregistrée et les pratiques régionales » | 32 |
| A-II-I 1.9.1, 1.9.2 | Travail du sol, rotation, engrais verts, matières organiques bio | Cahier de culture, BL, factures, certificats ; visite des parcelles et des stocks d'intrants | 32 |
| A-II-I 1.9.3 ; 1165 art. 2 | Engrais et amendements | Cahier de culture, **fiches techniques**, factures, BL ; stocks ; « **cohérence avec les besoins** » | 32, 34 |
| A-II-I 1.9.4 | 170 kg N | « **Calcul des quantités d'azote utilisées par ha/an** » | 32 |
| A-II-I 1.9.5 | Accord d'épandage | **Accords d'épandage**, **certificat bio des coopérants** | 32 |
| A-II-I 1.9.6 à 1.9.9 | Micro-organismes, activateurs, fertilisants (dont 1.9.8) | Cahier de culture, fiches techniques, garanties non-OGM ; stocks | 33 |
| A-II-I 1.10.1 à 1.10.3 | Prévention, produits phyto, pièges | Cahier de culture, fiche technique, factures ; « **justification et registre** » ; visite ; vapeur ; pièges | 33 |
| 1165 art. 1 | Produits phyto | Cahier de culture, fiches techniques, **e-phy** | 34 |
| A-II-I 1.11 ; 1165 art. 5.2 ; annexe III 7.5 | Produits de nettoyage | **Registre de nettoyage**, fiches techniques, BL, factures ; stocks | 26, 33, 34 |
| A-II-I 1.12 | Cahier de culture | Cahier de culture, registres | 33 |
| Annexe III 7.2 | Intrants stockés | Visite de **l'ensemble des locaux** | 34 |
| Annexe III 1, 5, 7.1, 7.4 | Collecte, réception, stockage, mixité du stockage | Jours, heures et circuits de collecte ; preuves du contrôle à réception ; procédure de stockage ; visite des zones | 24-26 |
| RUE 2020/2146 art. 4.2 | Dérogations exceptionnelles (catastrophes) | Justificatifs | 27 |

**Le cahier de culture** est la pièce centrale : il figure dans la méthode de contrôle de la plupart des points ci-dessus. Le catalogue sanctionne aussi le défaut d'information de l'OC sur « **le programme de production, ventilé par parcelles** » (2021/2119 art. 3 ; manquement n° 49). Un export « registre AB » de Fourmy (§3) doit donc couvrir trois choses :
- le cahier de culture par parcelle : assolement, semis, intrants, récoltes ;
- le programme de production par parcelle ;
- les pièces justificatives liées : dérogations, attestations, certificats des fournisseurs, accords d'épandage, nettoyages.

#### 8.3.3 Catalogue des manquements et sanctions pour les règles R1 à R34

Classe vérifiée visuellement, sauf mention « (texte) ». La première mesure est celle du 1er constat, la seconde celle de la récurrence.

| Règle | N° (AB-4 p.) | Manquement (résumé) | Classe | 1er constat → récurrence |
|---|---|---|---|---|
| R1, R2 Conversion | 27 (117) | Produits vendus comme bio avant la fin de la conversion | Majeur | DL → SC |
| R1, R2 | 28 (118) | Produits végétaux vendus « en conversion » avant la conversion minimale requise | Majeur | DL → SC |
| R1, R9 | 30 (118) | Bio + conversion sans registre ad hoc de séparation, séparation effective | Mineur | / → AV |
| R3 | 365 (112) | Vente avec référence bio **sans être certifié** | Majeur | AV → SPC |
| R4 | 348 (117) | Pratique dérogatoire sans autorisation (non demandée ou trop tard), conditions techniques respectées | Mineur | / → AV |
| R5, R20 Phyto non autorisé | **4** (112) | Usage de substances ou produits non autorisés (renvois : art. 24.1, A-II-I **1.9.8**, 1165 art. 1 à 4) | Majeur | **DL + DPA** → SC + DL + DPA |
| R5, R31 | 5 (112) | Présence de produits non autorisés due à des négligences de précaution (cultures au champ, sol) | Majeur | DL (+ DPA) → SPC + DL + DPA |
| R31, R32 | 6 (112) | Présence de produits non autorisés dans les produits certifiables (dérive, origine non identifiée) | Majeur | DL → DL |
| R31 | 46 (122) | Pollution accidentelle démontrée d'une parcelle | Majeur | DL → DL |
| R14, R20, R21 | 328 (112) | Produit autorisé mais **conditions d'utilisation non conformes** | Mineur | AV → SPC + DL |
| R7 Mixité | **31** (119) | Mixité dans une configuration non autorisée (espèces, variétés) ; plan de conversion non tenu à 5 ans | Majeur | DL → AV + DL |
| R7, R9 | 32 (119) | Mesures de séparation insuffisantes | Mineur | AV → AV |
| R9 | 33 (119) | Pas de registre ad hoc, séparation effective | Mineur | / → AV |
| R9, R29 | 3 (112) | Mélange de produits bio, en conversion ou non bio | Majeur | DL → DL |
| R8 | 351 (119) | Pas d'information de l'OC 48 h avant récolte, ni des quantités | Mineur | / → AV |
| R10 | 36 (120) | **Hydroponie** | **Critique** | SPC → RC |
| R10 | 354 (120) | Conditions du hors-sol (1.4) non respectées | Majeur | DL → DL |
| R10 | 369 (120) | Graines germées ou endives : support non conforme | Majeur | DL → SPC |
| R11 Rotation | **39** (121) | « Absence de rotation des cultures (ou rotation inadaptée) » | Mineur | AV → DL |
| R11 | 370 (121) | Travail du sol ne préservant pas la matière organique, la stabilité, la biodiversité | Mineur | AV → DL |
| R13 | 362 (120) | Énergie non renouvelable pour chauffer les serres (conversion depuis le 1/1/2020 ; pas les plants) ; **empêche la 1re certification** | Majeur | DL → SC |
| R14 | 41 (121) | Engrais autorisés **sans justification étayée** (pas de mise en œuvre préalable du 1.9.2) | Mineur | AV → DL |
| R16 170 N | **40** (121) | Dépassement de 170 kg N/an/ha de SAU | Mineur | AV → DL |
| R16 | 42 (122) | Coopération d'épandage non conforme ou sans accord écrit | Mineur | AV → AV |
| R17 | **364** (121) | Engrais autorisés sans respecter l'interdiction des élevages industriels | Mineur | AV → DL + DPA |
| R19 | 371 (122) | Vapeur hors culture protégée ou à plus de 10 cm | Mineur | AV → DL |
| R19 | 363 (122) | Techniques polluantes, **paillages fragmentables** | Majeur | DL → DL + DPA |
| R20 | 44 (122) | Phyto autorisé **sans justification étayée** (pas de mise en œuvre préalable du 1.10.1) | Mineur | / → AV |
| R22 | 45 (122) | Pièges et distributeurs non conformes | Mineur | / → AV |
| R23 OGM | 7 (113) | Usage d'OGM, y compris dans les MRV et les engrais | Majeur | DL + DPA → SC + DL + DPA |
| R24, R25 Semences | **37** (120) | MRV **OGM ou traités** avec un produit non autorisé ; **plants non bio** (plants productifs dans les 3 mois après mise en terre, ornementales) | Majeur | DL → SPC |
| R24, R25 | **38** (121) | MRV non bio, non traité, non OGM, **sans dérogation ou dérogation obtenue après semis** | Mineur | AV → DL (DPA pour les plants de PPAM et petits fruits) |
| R25 | 349 (121) | MRV non bio de statut « **hors dérogation** » (dérogation refusée ou non demandée) | Majeur | DL → DL (AV pour les semences de base, sur notification du SOC) |
| R25 | 359 (121) | Semences ou plants en conversion sans preuve de non-disponibilité en bio | Mineur | / → AV |
| R25 | 407 (121) | MRV non bio sous autorisation générale (plants fruitiers) sans enregistrement des quantités | Mineur | AV → AV |
| R27 Nettoyage | 350 (115) | **Absence** de mesures de précaution ou de nettoyage « d'un bout à l'autre de la chaîne de production » | Majeur | SPC → SC |
| R27 | 19, 20 (115-116) | Description insuffisante des mesures ; mesures insuffisantes (19) ou suffisantes (20) en pratique | Mineur | 19 : AV → SPC ; 20 : / → AV |
| R28 | 366 (114) | Nettoyage avec des produits non autorisés (dès qu'une liste UE ou française existe) | Mineur | AV → AV |
| R29 | 34 (120) | Stockage d'intrants non autorisés, sans preuve d'usage sur les unités bio (exploitations **non mixtes**) | Mineur | AV → SC |
| R29 | 306, 307, 308 (162) | Stockage ne permettant pas d'identifier ou d'isoler le bio ; pas de preuve du nettoyage des zones (sales : 307 ; propres : 308) | Mineur | 306 : AV → DL ; 307 : AV → DL (DL d'emblée en vrac mixte) ; 308 : / → AV |
| R30 | 295, 296 (160, texte) | Collecte simultanée mal maîtrisée ; jours, heures, circuits non tenus | (texte) | 295 : AV → DL ; 296 : / → AV |
| R30, R33 | 22, 23 (116) | Pas de preuve du contrôle à réception ; conformité invérifiable (22) ou vérifiable (23) | 22 majeur, 23 mineur | 22 : DL → SC ; 23 : / → AV |
| R30 | 403 (117) | Rupture de traçabilité portant atteinte à l'intégrité | Majeur | DL → SPC |
| R32 | 26 (116) | Non-respect des art. 27 et 28.2 | Mineur | AV → DL |
| R32 | 367, 368 (116-117) | Défaut de collaboration à l'enquête | 367 majeur, 368 mineur | 367 : DL → DL + SPC ; 368 : AV → AV |
| R32 | 402, 406 (117) | Non-respect d'un blocage de lot ; clients non informés | Majeur | 402 : SPC → SC ; 406 : SPC → RC |
| Registres (§3) | **50** (123) | Cahier de culture absent ou mal tenu, **ne permettant pas** de s'assurer de la conformité | Majeur | **DL + DPA** → SPC |
| Registres | 51 (123) | Défaut de tenue sans doute sur la conformité | Mineur | / → AV |
| Registres | 49 (123) | Programme de production ventilé par parcelles non communiqué à l'OC | Mineur | / → AV |
| Registres | 21, 24 (116) | Pas de comptabilité matière ; déséquilibre **important** entre entrées et sorties, intrants compris | **Critique** | SC → RC |
| Registres | 25 (116) | Déséquilibre mineur entre entrées et sorties | Mineur | AV → AV |
| Engagement | 14 (115) | Description de l'unité incomplète ou erronée | Mineur | / → AV |
| R12, R18, R26, R34 | — | Pas de manquement propre relevé. R18 est couvert indirectement par 41 et 370, R34 par le point de contrôle 2020/2146 art. 4.2 (p. 27). | — | — |
| R21 Cuivre | — | **Aucun manquement propre ; « cuivre » n'apparaît pas dans les documents INAO.** Rattachement probable au n° 328 (interprétation). | — | — |

**Lecture.** Mineur, majeur et critique se définissent ainsi (AB-4 p. 102) :
- **mineur** : pas d'atteinte à l'intégrité du produit ; au plus un AV au 1er constat ;
- **majeur** : atteinte à l'intégrité ; DL au moins ;
- **critique** : manquement grave, répété ou intentionnel ; suspension ou retrait.

Les règles les plus lourdes pour un cultivateur sont :
- l'**hydroponie** (critique) ;
- la **comptabilité matière** absente ou très déséquilibrée (critique) ;
- le **produit non autorisé** (majeur, DL + DPA d'emblée) ;
- le **cahier de culture inexploitable** (majeur, DL + DPA d'emblée) ;
- l'**OGM** (majeur, DL + DPA d'emblée).

À l'inverse, le **170 N**, la **rotation** et la **semence non bio sans dérogation** (n° 38) sont **mineurs** au 1er constat, avec DL en récurrence.

#### 8.3.4 Points demandés en particulier

- **Conversion.**
  - Le contrôle se fait sur le cahier de culture, les assolements et les dates de semis et de récolte (p. 31). Les manquements 27 et 28 (DL) le sanctionnent.
  - Les sigles **C1 et C2** n'apparaissent dans l'AB-4 que pour l'alimentation animale (p. 42 ; catalogue p. 136). Pour les cultures, ils viennent du GDL.
  - Le calcul déduit retenu par l'utilisateur, la date de départ de l'AB-4 (p. 11-12) et l'export Cartobio (CIR p. 35) sont cohérents entre eux.
- **Phyto non autorisé.**
  - Manquement n° 4 : DL + DPA dès le 1er constat. DPA = parcelle déclassée, nouvelle conversion (p. 103). Cela confirme R5.
  - Contrôle : cahier de culture, fiches, e-phy, stocks (p. 21, 33, 34).
  - Analyses : référence de 0,02 mg/kg, ramenée à la limite de quantification pour les herbicides (AB-1 p. 13).
- **Fertilisants.**
  - Manquements : n° 4 (non autorisé, y compris azote minéral du 1.9.8), n° 41 (sans justification), n° 364 (élevages industriels), n° 328 (conditions non conformes).
  - L'OC vérifie la **cohérence avec les besoins** (p. 32). Le bilan de fertilisation demandé par le GDL est la pièce qui y répond.
  - L'AB-1 prévoit l'analyse des **matières fertilisantes (métaux lourds)** et des **sols (herbicides)** (AB-1 p. 20).
- **170 N.**
  - Contrôle par calcul « par ha/an » (p. 32) ; manquement n° 40, mineur, AV → DL.
  - Le plafond **par hectare et par parcelle** retenu par l'utilisateur est plus strict que le texte : il ne crée pas de risque de non-détection.
  - N total ou efficace et période de calcul : **non précisés**.
- **Semences et dérogations.**
  - *Procédure.* La décision est **déléguée à l'OC** (CIR p. 8) ; c'est la seule dérogation dans ce cas, toutes les autres relèvent de l'INAO (CIR p. 6).
  - *Instruction.* L'OC instruit « au moyen notamment de la base de données **www.semences-plants-biologiques.org** » (CIR p. 14). Il peut consulter le pôle Bio de l'INAO et fait un bilan annuel de ses décisions.
  - *Contrôle.* Dérogation consultée sur le site semences bio ; date d'autorisation comparée à la date de semis du cahier de culture ; étiquette « non traité » ; attestation non-OGM (AB-4 p. 31-32).
  - *Délais.* **Aucun délai chiffré** pour les MRV ; seule compte l'antériorité au semis (manquement 38 « dérogation obtenue post-semis »).
  - *Pour les dérogations INAO* (9.8, 10.3, catastrophes) : saisie sur https://sve.derogationbio.inao.gouv.fr ou formulaire papier. Délai réglementaire de **4 mois** après dossier complet ; délai recommandé d'**1 mois** en urgence ; **silence de 4 mois = acceptation** (CIR p. 12-13).
  - *Rétroactivité.* La demande 10.3 passe d'abord par l'OC, qui rédige un « rapport écrit final » par parcelle (CIR p. 12).
  - *Remarques.* Le catalogue cite « 2021/2146 art. 3.1 » au n° 38 (p. 121) ; c'est probablement le 2020/2146 cité par la CIR. Le §1.1 rattachait la dérogation semences au RUE 2020/464 d'après un libellé du GDL. La CIR la rattache à l'**art. 3 al. 1 du règlement délégué 2020/2146** (p. 8 et 14).
- **Mixité.**
  - Contrôle visuel de la séparation et registre de séparation (p. 29). Pour les pérennes (9.8) : dérogation INAO, plan de conversion, information de l'OC sur la date et les quantités (p. 30), contrôle en période de récolte (p. 17).
  - Manquements : n° 31 (majeur), 32 et 33 (mineurs), 351 (préavis de 48 h, mineur).
  - Le plan de conversion 9.8 est une autorisation **INAO** (CIR p. 7).
- **Nettoyage.**
  - Produits : n° 366 (mineur) ; référentiel = annexe I du CCF, puisque la partie B de l'annexe IV est vide.
  - Mesures de nettoyage « d'un bout à l'autre de la chaîne » : n° 350 si elles sont absentes (majeur, SPC → SC), n° 19 et 20 si elles sont insuffisantes ou mal décrites.
  - Zones de stockage : n° 307 et 308.
  - Aucun manquement ne vise nommément le **matériel agricole mixte**. Le nettoyage d'un pulvérisateur ou d'une moissonneuse relève des n° 350, 19 et 20 et, s'il y a contamination, des n° 5 et 6.
  - L'AB-1 prévoit, pour vérifier l'efficacité d'un nettoyage, un échantillon de matière première et un de produit fini (p. 10).
- **Rotation.** Pas de critère chiffré (§6 question 8). Manquement n° 39, mineur.
- **Cuivre.** Seule la formule de l'annexe I s'applique (1165 p. 12). Rien dans les documents INAO (§6 question 9).

### 8.4 Conséquences pour Fourmy

1. **Graduer les alertes selon le catalogue.**
   - **Rouge** : manquements **majeurs ou critiques** (DL d'emblée) : produit non autorisé, MRV traité ou plant non bio, mixité non autorisée, hors-sol ou hydroponie, serre chauffée non renouvelable, cahier de culture inexploitable.
   - **Orange** : manquements **mineurs** (AV), qui deviennent rouges en récurrence : 170 N, rotation, semence non bio sans dérogation, justification phyto ou fertilisant, préavis de 48 h.
   - Fourmy peut afficher le **n° de manquement** et la mesure encourue à côté de chaque alerte.
2. **Ajuster le classement du §5.** Le 170 N (R16, rang 5) et la dérogation semences (R24/R25, rang 6) ont un enjeu de 1er constat plus faible que prévu (mineur). Les plants non bio et les MRV traités (n° 37), les **serres chauffées** (n° 362) et le **hors-sol** (n° 354) sont majeurs. Le **cahier de culture complet** (n° 50, DL + DPA) et la **comptabilité matière** (n° 21 et 24, critiques) justifient de remonter l'export « registre AB » (§3) dans l'ordre de réalisation.
3. **Statut C1/C2/AB déduit.** Il démarre à la date d'engagement, à la date de remise en conformité ou, pour une nouvelle parcelle, à la déclaration OC ou TELEPAC (AB-4 p. 11-12). En cas de DPA, la ligne est close et une nouvelle conversion s'ouvre. Les trois champs Cartobio (niveau, date de début, culture principale) doivent être exposés.
4. **Fertilisants.** Référentiel annexe II **par catégorie**, versionné (§8.2.4), avec un drapeau `counts_in_170N` et des pièces : attestation d'élevage, fiche technique.
5. **Semences.** Champs : bio, conversion ou non bio ; « non traité » ; n° et **date** de dérogation ; contrôle date de dérogation < date de semis ; lien vers www.semences-plants-biologiques.org.
6. **Nettoyage.** Référentiel = annexe I du CCF élevage, jusqu'à ce que l'annexe IV partie B du 1165 soit remplie.

### 8.5 Sources ajoutées

- Règlement d'exécution (UE) 2021/1165 du 15/07/2021, JO L 253 du 16/07/2021, version initiale, `docs/ab/CELEX_32021R1165_FR_TXT.pdf` : p. 1-12 (articles, annexe I), 13-17 (annexe II), 25 (annexe IV) lues en entier ; annexes III et V parcourues (hors périmètre).
- INAO-CIR-2021-03 v8 du 17/09/2026, `docs/ab/INAO-CIR-2021-03_21-09-2026.pdf` : p. 1-20 et 31-39 lues ; p. 21-30 (formulaires OFIS) non détaillées.
- INAO-DEC-CONT-AB-1 v8 du 17/09/2026, `docs/ab/INAO_DEC_CONT_AB_1_21-09-2026.pdf` : lu en entier.
- INAO-DEC-CONT-AB-2 v2 (2019, 2021), `docs/ab/INAO-DEC-CONT-AB-2.pdf` : p. 1-7 et recherche par mots ; identifié comme hors périmètre.
- INAO-DEC-CONT-AB-4 v10 du 17/09/2026, `docs/ab/INAO-DEC-CONT-AB-4_22-09-2026.pdf` : p. 1-39 (certification, fréquences, points de contrôle généraux et végétaux), 100-123 (manquements, catalogue généraux, agricoles, végétaux) et 160-162 (collecte et stockage) lues ; p. 112-123 et 162 vérifiées visuellement ; parties élevage, aquaculture, transformation et import non lues.
- INAO-DIR-CAC-7 v2 du 30/09/2026, `docs/ab/INAO-DIR-CAC-7_01-10-2026.pdf` : lue en entier.
- Recherche du mot « cuivre » dans le texte des cinq documents INAO : aucune occurrence.
