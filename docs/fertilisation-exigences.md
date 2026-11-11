# Fourmy — Plan prévisionnel de fumure et cahier d'enregistrement (exigences)

> Document produit par `/sc:brainstorm` le 2026-11-11. Il précise
> **FR-REG-3** de [`requirements.md`](requirements.md) §4.10. Il décrit
> **uniquement les exigences**. Conception :
> [`fertilisation-design.md`](fertilisation-design.md).

## 1. Origine

### Sources étudiées le 2026-11-11

Les extraits texte des sources sont rangés dans `claudedocs/PPF/extraits/`. Les fichiers d'origine sont dans `claudedocs/PPF/` et ne sont pas suivis par git.

**Plugin Ekylibre `ekylibre-manuring`** (dernier commit le 24/04/2017)
- Méthode du bilan COMIFER pour les ex-régions Poitou-Charentes (arrêtés de 2012 et 2014) et Aquitaine (code commenté).
- Les abaques sont des CSV.
- Trois éditions : PPF, PPF détaillé et « cahier d'épandage ».
- À reprendre :
  - la structure du calcul : un terme du bilan = une fonction, chaque terme gardé pour la traçabilité ;
  - les référentiels tabulaires versionnés par région ;
  - la séparation entre le prévisionnel et le réalisé.
- À éviter :
  - les valeurs codées en dur (CAU 0,8, nitrates 40 mg/L, défaut 170 et 30) ;
  - les valeurs par défaut silencieuses ;
  - l'absence de tests ;
  - les abaques par cultivar ;
  - des bugs de bornes (périodes Keq à cheval sur l'année, unités du colza).
- Ni calendrier d'épandage, ni plafond de 170 kg, ni fractionnement.
- Pierre n'a jamais utilisé ce module : les tables `manure_management_plans` sont vides. En revanche, ses engrais principaux portent leur teneur N, P, K (`nitrogen_concentration`…), que la migration Fourmy ne reprend pas.

**COMIFER, guide « Calcul de la fertilisation azotée », 2013** (brochure du dossier PPF)
- Équation générale et écritures opérationnelles :
  - [3'] Pf = Pi + Ri + Mh + Mhp + Mr + MrCi + Nirr + X + Xa − L − Rf ;
  - [4], avec CAU ;
  - [4'], « efficience » P0.
- Calcul de chaque poste, prairies, fractionnement et pilotage, 18 fiches cultures.
- La règle de cohérence : tous les termes sont évalués avec la même écriture.
- Le choix entre Keq « bilan » et Keq « cycle », selon que Ri et Pi sont mesurés.

**COMIFER, pages « postes du bilan » et « fiches cultures »**, et leurs tables (lues le 2026-11-11)

| Table | Contenu |
|---|---|
| Keq des produits organiques | Mise à jour du 09/12/2024 (digestats), environ 130 lignes |
| Composition des produits | Environ 45 produits |
| Mr | 20 précédents × 2 dates d'ouverture |
| MrCi | 7 familles × biomasse × destruction × ouverture |
| Mhp | Retournement de prairie, avec coefficient d'exploitation |
| Rf | 4 sols × 4 profondeurs, © INRA AZOBIL |
| Pi céréales | Selon les talles |
| b du maïs | Par paliers de rendement |
| b du blé tendre et du blé dur | Classement des variétés **2026**, republié chaque année |
| Outil Mh | Excel 2012, formules et jours normalisés de 20 stations |
| Abaques L | Lixiviation selon la lame drainante |

Aucune licence de réutilisation n'est affichée.

**Autres documents COMIFER et filières** (dossier PPF)
- APLSH 2024 : azote potentiellement libéré jusqu'en sortie d'hiver, pour les plafonds du PAN 7 sur couverts et prairies. Classeur de références par produit, zone climatique et quinzaine d'apport.
- Grille d'efficacité des apports minéraux (2022) : note de risque de volatilisation, sans effet sur la dose.
- PPAM (forfaits), CTIFL fruits et légumes (X = B − F), plaquette CIVE (mai 2025).
- Outils de pilotage (SCE 2016) : stratégie « X − 40 », environ 20 outils.

**Réglementation** (vérifiée le 2026-11-11)

| Texte | Contenu utile |
|---|---|
| Arrêté du 19/12/2011 modifié le 30/01/2023 (**PAN 7**), annexe I | Contenu du PPF (partie IV) et du cahier, calendrier d'interdiction (partie I), plafond de 170 kg (partie V), conditions d'épandage (partie VI), couverture des sols (partie VII), types de fertilisants 0, Ia, Ib, II, III |
| **Référentiel régional Nouvelle-Aquitaine** du 29/07/2025 (GREN) | Méthode par culture : bilan, dose pivot ou dose plafond. Objectif de rendement = moyenne olympique des 5 dernières campagnes. Keq régionaux. **Outil labellisé COMIFER exigé**, avec 2 ans de tolérance pour un outil conforme. Dose minimale de 30 kg |
| **PAR 7 Nouvelle-Aquitaine** du 09/07/2024 et guide de la DREAL du 16/10/2026 | Fractionnement : 1er apport plafonné à 50 kg sur céréales et maïs, 80 kg sur colza. Couverts : implantés au plus tard le 30/09, maintenus 2,5 mois. Tolérance de 30 jours pour remplir le cahier |
| **Zonage Adour-Garonne** du 24/08/2026 | **Pierre est en zone vulnérable** : Monassut-Audiracq et Saint-Laurent-Bretagne y figurent en totalité |

Un PAN 8 est annoncé pour 2028.

**Données ouvertes**
- Sandre, service WFS : couches des zones vulnérables. Encore en millésime 2021.
- data.gouv.fr, « PAN nitrates : périodes minimales d'interdiction d'épandage » (Licence Ouverte 2.0) :
  - périodes par commune et zone ;
  - périodes par région, culture et type de fertilisant.
- DREAL Nouvelle-Aquitaine : zones d'actions renforcées (ZAR) et « partie Ouest ».

### Ce que Fourmy a déjà
- Interventions de la forme `fertilization`. Pierre en a 61 depuis 2015 : solutions azotées, urée, NPK, amendements calciques.
- Productions par campagne, avec l'espèce et la variété.
- Précédent déductible de l'historique des productions.
- Récoltes : sorties des interventions, rendement réalisé.
- Irrigations saisies avec leur dose en mm (lot AC).
- Réserve utile par parcelle (lot AB).
- Météo journalière en cache : Open-Meteo, températures et pluie.
- Satellite : biomasse, indices, cartes de modulation (lot AD).
- Îlots PAC sur les versions de parcelles.
- Rôles responsable et salarié.

## 2. Décisions du 2026-11-11

1. **Calcul et saisie.** Fourmy **calcule la dose** par la méthode du bilan COMIFER, en visant la labellisation. Chaque terme est visible et sourcé. Fourmy **accepte aussi une dose venue d'ailleurs** (conseiller, outil labellisé comme AzoFert), avec sa source. Le PPF, le cahier et les contrôles réglementaires sont toujours tenus par Fourmy.
2. **Périmètre de départ : la ferme de Pierre.**
   - Région Nouvelle-Aquitaine.
   - Grandes cultures au **bilan** : maïs, céréales à paille, colza.
   - **Dose plafond** pour les autres cultures, dont la vigne de Frédéric.
   - Engrais minéraux et produits organiques reçus ou achetés.
   - Méthode et référentiels paramétrés par région, pour en ajouter d'autres sans code.
   - Le **plafond de 170 kg N organique/ha** (effluents produits sur l'exploitation) attend l'élevage N1. Seuls les apports d'effluents reçus sont comptés d'ici là.
3. **Référentiels COMIFER embarqués.**
   - Chaque ligne porte sa source (document, organisme, date de mise à jour) et une mention COMIFER/INRA.
   - Les valeurs restent modifiables par la ferme ou son conseiller.
   - Une demande d'accord de réutilisation est adressée au COMIFER.

## 3. Utilisateurs et objectifs

| Qui | Ce qu'il veut |
|---|---|
| **Exploitant** (responsable) | Établir son PPF à temps : à l'ouverture du bilan, avant le 1er apport de sortie d'hiver. Connaître la dose et le nombre d'apports par parcelle. Être en règle au contrôle (conditionnalité ESG 2) sans double saisie |
| **Salarié** | Saisir un apport (intervention) et être prévenu s'il sort du plan ou du calendrier |
| **Conseiller, technicien** | Paramétrer ou corriger les termes (analyses, références locales), apporter une dose calculée ailleurs, éditer les documents |
| **Contrôleur** (lecteur des documents) | PPF et cahier complets, datés, avec les pièces justificatives (analyses, sorties de l'outil) |

Objectifs mesurables :
- Le PPF de Pierre pour la campagne 2027 (maïs) s'établit **en moins de 15 minutes**, pour toute la ferme, à partir de ce que Fourmy sait déjà.
- Le cahier de la campagne 2026 se produit **sans saisie supplémentaire** à partir de ses interventions, à part les données que Fourmy ne peut pas connaître : teneurs en N absentes, couverts non saisis.

## 4. Exigences fonctionnelles

Identifiants : `FR-FERT-<n>`. Priorités : **M** (première version), **S** (souhaitée), **L** (plus tard).

### 4.1 Situation réglementaire de la ferme et des parcelles

- **FR-FERT-1 (M)** Fourmy indique pour chaque îlot ou parcelle s'il est **en zone vulnérable** : en totalité, en partie ou non.
  - Il le déduit de la commune et des couches officielles (Sandre, arrêtés de bassin).
  - Le responsable peut corriger le zonage, avec sa source.
  - Le millésime du zonage est affiché. Pour Pierre : arrêté Adour-Garonne du 24/08/2026.
- **FR-FERT-2 (M)** Fourmy en déduit les obligations de la ferme :
  - PPF et cahier pour chaque îlot cultural en zone vulnérable, fertilisé ou non ;
  - analyse de sol annuelle au-delà de 3 ha en zone vulnérable ;
  - conservation pendant 5 campagnes.

  Une ferme sans îlot en zone vulnérable peut quand même tenir un PPF et un cahier, que Fourmy présente comme « non obligatoire ».
- **FR-FERT-3 (S)** Zones particulières, quand l'information existe : zone d'actions renforcées (ZAR), zone « Ouest » de Nouvelle-Aquitaine, montagne. Elles changent le calendrier et les règles de couverture des sols.
- **FR-FERT-4 (M)** Campagne de fertilisation : du 1er septembre au 31 août par défaut, ou 12 mois choisis par l'exploitant. Le cahier couvre la période d'une récolte de culture principale à la suivante.

### 4.2 Produits fertilisants

- **FR-FERT-5 (M)** Chaque article fertilisant porte sa **composition** :
  - N total ;
  - part minérale (NH4 et NO3) pour les produits organiques ;
  - P2O5, K2O et SO3 en facultatif ;
  - unité de référence : % de la masse, kg/t ou kg/m³.

  Il porte aussi son **type réglementaire** (0, Ia, Ib, II ou III) et, pour un produit organique, sa **famille COMIFER**, qui sert au Keq.
- **FR-FERT-6 (M)** Fourmy **propose** la composition :
  - à partir du nom d'un engrais minéral courant (« 9,5-15-30 », « Urée 46 », « Solution azotée 390 ») ;
  - à partir du référentiel Lexicon ;
  - ou à partir de la table COMIFER des produits organiques.

  La **migration Ekylibre reprend les teneurs** `nitrogen_concentration`, `phosphorus_concentration` et `potassium_concentration` des variantes. La valeur proposée est signalée comme telle tant qu'elle n'est pas confirmée.
- **FR-FERT-7 (M)** Une **analyse de produit organique** (date, MS, N total, N-NH4, C/N) remplace la valeur de référence pour les apports qui suivent. Elle est valable 5 ans, conformément au référentiel Nouvelle-Aquitaine.
- **FR-FERT-8 (S)** Le type réglementaire est calculé à partir de l'analyse (C/N, Nmin/Ntot, ISMO) selon les définitions de l'annexe I du PAN 7.

### 4.3 Plan prévisionnel de fumure (PPF)

- **FR-FERT-9 (M)** **Un PPF par îlot cultural et par culture principale**, pour une campagne. Un couvert d'interculture exporté qui demande un calcul de dose a son propre PPF.

  Le PPF comporte **au moins** ce que l'annexe I, partie IV du PAN 7 exige :
  1. l'îlot, sa surface et son type de sol ;
  2. la culture et sa période d'implantation ;
  3. la date d'ouverture du bilan ;
  4. l'azote absorbé à l'ouverture, si le bilan est ouvert après le semis ;
  5. l'objectif de production ;
  6. la part de légumineuses pour une association ;
  7. les irrigations prévues et la teneur en nitrate de l'eau ;
  8. le reliquat sortie hiver mesuré, ou l'analyse d'azote ou de matière organique, quand il en existe une ;
  9. la quantité d'azote **efficace et totale** à apporter ;
  10. la même quantité pour **chaque apport prévu**.
- **FR-FERT-10 (M)** La **méthode par culture** suit le référentiel régional :
  - **bilan prévisionnel** pour le maïs, le sorgho, les céréales à paille, le colza, le lin, le tabac, certaines porte-graines et les prairies ;
  - **dose pivot** pour le tournesol (Nouvelle-Aquitaine) ;
  - **dose plafond** pour les autres cultures (vigne, légumes, vergers).

  L'écriture du bilan, c'est-à-dire la liste des termes et l'usage ou non du CAU, est un **paramètre de la région**, appliqué de manière cohérente à tous ses termes.
- **FR-FERT-11 (M)** **Calcul du bilan.** Chaque terme est calculé, saisi ou repris d'une référence. Il affiche sa valeur, son origine (calculé, mesuré, référence COMIFER ou régionale avec la date, saisi par untel) et sa formule.

  | Terme | D'où vient la valeur |
  |---|---|
  | **Pf** | b × objectif de rendement, b selon l'espèce, la variété (classement de l'année) et le palier de rendement ; ou forfait par hectare |
  | **Objectif de rendement** | Proposé : moyenne des 5 dernières campagnes de l'exploitation pour cette culture, sans la plus faible ni la plus forte, d'après les récoltes saisies. Sinon une référence locale. Modifiable, avec un avertissement s'il dépasse nettement l'historique |
  | **Pi** | Céréales d'hiver : selon le nombre de talles. Colza : selon la biomasse (pesée, estimation visuelle, satellite). 0 pour une culture de printemps pas encore semée |
  | **Ri** | Reliquat **mesuré**, saisi ou importé d'une analyse : date, profondeur, NO3 et NH4 par horizon, avec la règle NH4 sur 0-40 cm. À défaut, une référence régionale. Une mesure doit être utilisée si elle existe |
  | **Mh** | Formule COMIFER : TNorg × Km × JN, avec Km selon l'argile et le CaCO3 et FSyst selon la gestion des résidus et la fréquence des apports organiques. **JN calculés avec la météo de la ferme**. À défaut d'analyse de sol, une référence régionale |
  | **Mhp** | D'après l'historique : prairie retournée, son âge, la saison, le mode d'exploitation |
  | **Mr** | D'après la production précédente sur la parcelle et la gestion de ses résidus (enfouis ou exportés, d'après les interventions) |
  | **MrCi** | D'après le couvert d'interculture : espèce, biomasse, date de destruction |
  | **Nirr** | Volume d'irrigation prévu (mm), proposé d'après les campagnes précédentes ou le modèle de croissance, × teneur en nitrate de l'eau (mesurée ou par bandelette). **Sans teneur connue, Fourmy la demande et ne suppose rien** |
  | **Xa** | Apports organiques prévus et déjà faits : N total × Keq. Keq « bilan » si Ri et Pi sont mesurés, Keq « cycle » sinon, comme le recommande COMIFER |
  | **Rf** | Selon le type de sol et la profondeur |
  | **L** | Lixiviation, en général négligée. Elle corrige un reliquat mesuré avant de fortes pluies, avec la lame drainante tirée de la météo |

  Règles de résultat :
  - une dose calculée **négative interdit les apports de type II et III** ;
  - une dose inférieure à 30 kg passe au **forfait de 30 kg**, si le référentiel le prévoit ;
  - la dose plafond de la culture est toujours respectée.
- **FR-FERT-12 (M)** **Dose venue d'ailleurs.** Au lieu du calcul, ou en plus, le PPF accepte une dose saisie, avec son origine : nom de l'outil (de préférence labellisé COMIFER) ou du conseiller, date, et pièce jointe facultative (la sortie de l'outil). Fourmy montre l'écart avec son propre calcul quand il a pu le faire, sans bloquer.
- **FR-FERT-13 (M)** **Répartition en apports.** Pour chaque apport prévu, le PPF donne :
  - la date ou le stade visé ;
  - le produit ;
  - la dose de produit ;
  - l'azote efficace et l'azote total.

  Fourmy **propose un fractionnement** conforme aux règles régionales. En Nouvelle-Aquitaine :
  - céréales d'hiver : 1er apport de 50 kg au plus, 2 apports à partir de 110 kg, 3 au-delà de 160 kg ;
  - colza : 1er apport de 80 kg au plus, 2 apports à partir de 80 kg, 3 au-delà de 170 kg ;
  - maïs semé avant le 1er mai : 1er apport de 50 kg au plus avant 2 feuilles, 2 apports au-delà de 120 kg.

  Il propose aussi une part **réservée au pilotage** (stratégie « X − 40 »).
- **FR-FERT-14 (M)** **Calendrier du PPF.** Fourmy rappelle que le PPF doit être établi à l'ouverture du bilan, au plus tard avant le 1er apport de sortie d'hiver, ou avant le 2e en cas de fractionnement. Une intervention de fertilisation sur un îlot sans PPF établi déclenche un avertissement.
- **FR-FERT-15 (M)** **États du PPF.** Un PPF est :
  - **brouillon** : modifiable ;
  - **établi** : daté et signé par un responsable ;
  - **révisé** : nouvelle version datée, avec le motif (objectif revu, mesure de pilotage, reliquat reçu).

  Les versions sont conservées : on retrouve **le PPF tel qu'il était à une date** (modèle temporel de Fourmy, FR-TIME).
- **FR-FERT-16 (S)** **PPF de toute la ferme en une fois** : Fourmy pré-remplit tous les îlots de la campagne à partir des productions, des précédents, des analyses et des références. L'exploitant ne complète que ce qui manque. Une liste « à compléter » indique, pour chaque îlot, les données absentes.
- **FR-FERT-17 (S)** **Pilotage en cours de saison.** On enregistre une mesure : date, stade, outil (N-Tester, Jubil, satellite…), valeur et dose conseillée. Le dernier apport est ajusté. Le dépassement de la dose prévisionnelle n'est permis que s'il est justifié par une mesure ; la justification est conservée. Les indices satellite de Fourmy peuvent être présentés comme repère, sans valeur d'outil de pilotage reconnu.
- **FR-FERT-18 (S)** **Lien avec la modulation (lot AD)** : une carte de modulation peut partir de la dose d'un apport du PPF, la moyenne pondérée restant égale à cette dose.

### 4.4 Cahier d'enregistrement

- **FR-FERT-19 (M)** Le cahier est **tiré des interventions réalisées**, sans double saisie. Il comporte au moins ce qu'exige l'annexe I, partie IV du PAN 7, pour chaque îlot :
  - l'îlot, sa surface et son type de sol ;
  - l'**interculture** précédente :
    - la gestion des résidus et des repousses, et leur date de destruction ;
    - le couvert : exporté ou non, espèces, dates d'implantation et de destruction ou de récolte ;
    - les apports sur le couvert ;
  - la **culture principale** :
    - la culture, sa date d'implantation et le rendement réalisé ;
    - pour **chaque apport** : date, surface, fertilisant, teneur en N et **quantité d'azote totale** (et efficace) ;
    - les dates de récolte ou de fauche ;
  - les **pratiques culturales** : techniques culturales simplifiées (pas de labour sur 3 campagnes) ou semis direct sous couvert, déduits des interventions de travail du sol.
- **FR-FERT-20 (M)** **Azote d'une intervention.** Fourmy calcule l'azote apporté par hectare à partir de la dose et de la composition du produit (FR-FERT-5), en total et en efficace. Il l'affiche dans la saisie et dans la fiche de l'intervention. Si la teneur est inconnue, l'intervention est signalée « à compléter » pour le cahier.
- **FR-FERT-21 (M)** **Écarts au plan.** Pour chaque îlot, Fourmy compare ce qui a été apporté à ce qui était prévu : dose restante, dépassement, apport hors plan. Un dépassement sans justification de pilotage est signalé.
- **FR-FERT-22 (M)** **Délai d'enregistrement.** Le cahier doit être tenu à jour après chaque épandage ; le guide Nouvelle-Aquitaine tolère 30 jours. Fourmy l'affiche comme « à jour » ou « en retard » et date chaque ligne de sa saisie.
- **FR-FERT-23 (S)** **Couverts d'interculture** : saisie simple d'un couvert (semis, espèces, destruction) quand il n'existe pas comme production. Contrôle de la couverture obligatoire (FR-FERT-27).
- **FR-FERT-24 (L)** **Élevage**, avec l'élevage N1 :
  - cheptel : production laitière, temps passé à l'extérieur ;
  - **plafond de 170 kg N organique/ha de SAU**, calculé sur toute l'exploitation ;
  - bordereaux d'échange d'effluents cosignés ;
  - stockage au champ (îlot, dépôt, reprise ; 9 mois au plus, pas de retour avant 3 ans).

### 4.5 Contrôles réglementaires à la saisie

- **FR-FERT-25 (M)** **Calendrier d'interdiction d'épandage.** À la saisie ou à la planification d'un apport, Fourmy vérifie la période d'interdiction selon :
  - le type de fertilisant ;
  - la culture en place ou à venir ;
  - la zone (nationale, régionale, ZAR, montagne, notes particulières).

  Pour les Pyrénées-Atlantiques, la période se termine le 15 janvier au lieu du 31.

  Il tient compte des exceptions : maïs irrigué jusqu'au brunissement des soies, 30 kg sur colza sous conditions, irrigation, compléments foliaires.

  Les périodes viennent du jeu de données officiel (data.gouv.fr, Licence Ouverte) et des arrêtés régionaux, avec leur date. Un apport interdit déclenche un avertissement bloquant, qu'un responsable peut forcer en donnant un motif tracé (dérogation agro-météo, erreur de date).
- **FR-FERT-26 (M)** **Conditions d'épandage**, rappelées à la saisie et vérifiées quand c'est possible :
  - sol gelé, enneigé ou détrempé : interdit, sauf exceptions ; la météo du jour est déjà connue de Fourmy ;
  - distance aux cours d'eau : 2 m pour le type III, 35 m (ou 10 m avec une bande enherbée) pour les autres types ;
  - pente près d'un cours d'eau.

  Les cours d'eau de la BD TOPO sont déjà affichés pour les ZNT phyto.
- **FR-FERT-27 (S)** **Couverture des sols en interculture longue** : couvert implanté au plus tard le 30/09 en Nouvelle-Aquitaine, maintenu 2,5 mois, détruit au plus tôt le 15/11. Repousses admises sur 20 % de la surface au plus. Broyage et enfouissement des cannes de maïs. Fourmy signale les écarts d'après les interventions.
- **FR-FERT-28 (S)** **Plafonds APLSH** : 70 kg (ou 100 ou 20 kg selon le cas) d'azote potentiellement libéré jusqu'en sortie d'hiver sur les couverts et prairies. Fourmy cumule l'APLSH de chaque apport depuis la récolte du précédent, selon la zone climatique, la quinzaine d'apport et le produit ou son analyse.
- **FR-FERT-29 (S)** **Efficacité d'un apport minéral** (grille COMIFER 2022) : note de risque de volatilisation calculée à partir du pH, de la CEC, de la couverture, de la pluie à 3 jours, du vent et de la température. Affichée à la planification avec la prévision météo, et tracée pour les apports passés. Elle ne change pas la dose.
- **FR-FERT-30 (M)** **Analyse de sol annuelle** : Fourmy rappelle l'obligation (au-delà de 3 ha en zone vulnérable, une analyse par campagne sur une des 3 cultures principales) et indique si elle est faite.

### 4.6 Analyses et justificatifs

- **FR-FERT-31 (M)** **Analyses de sol** par parcelle :
  - reliquat (date, horizons, NO3 et NH4) ;
  - matière organique, carbone, azote total ;
  - argile, CaCO3, pH, CEC.

  Elles alimentent le calcul (Ri, Mh, Rf) et la grille d'efficacité. La saisie se fait à la main ou par import (format du laboratoire ou CSV). Le PDF du laboratoire peut être joint.
- **FR-FERT-32 (M)** **Analyse d'eau d'irrigation** (teneur en nitrate), par point d'eau ou par parcelle.
- **FR-FERT-33 (M)** Les **justificatifs** sont conservés au moins 5 campagnes et joints au dossier de contrôle :
  - analyses ;
  - sorties d'outils et doses venues d'ailleurs ;
  - mesures de pilotage ;
  - motifs de dérogation.

### 4.7 Documents et exports

- **FR-FERT-34 (M)** **Éditions PDF** : le PPF de la ferme, synthèse et fiche par îlot avec le détail du bilan, et le cahier d'enregistrement. Elles portent les mentions réglementaires, la campagne, la date d'établissement et les sources des références. Elles doivent être lisibles par un contrôleur sans Fourmy.
- **FR-FERT-35 (S)** Exports CSV du PPF et du cahier. **eDAPLOS** (échange avec les coopératives et les conseillers) reste à étudier : aucun texte ne l'impose.
- **FR-FERT-36 (S)** Tableau de bord de la campagne : îlots sans PPF, apports à compléter, dépassements, interdictions forcées, analyse annuelle faite ou non.

### 4.8 Référentiels

- **FR-FERT-37 (M)** Les référentiels sont des **jeux de données versionnés**. Chacun indique sa région (ou « national »), son texte ou document source, sa date de mise à jour et ses conditions de réutilisation.

  Référentiels prévus :
  - b par culture, palier et variété ;
  - Pi, Mr, MrCi, Mhp, Rf, L ;
  - Keq et composition des produits organiques ;
  - frein hydrique et dates d'absorption ;
  - doses pivots et plafonds régionaux ;
  - règles de fractionnement ;
  - calendriers ;
  - APLSH ;
  - zonage.

  Le classement des variétés de blé change chaque année : la version de la campagne s'applique.
- **FR-FERT-38 (M)** Une ferme ou son conseiller peut **remplacer une valeur de référence** pour ses parcelles : référence locale, observatoire de reliquats. La valeur remplacée reste tracée (qui, quand, pourquoi). Un PPF établi garde les valeurs utilisées à sa date, même si le référentiel change ensuite.
- **FR-FERT-39 (M)** **Aucune valeur par défaut silencieuse.** Un terme sans donnée ni référence est affiché « manquant ». Le calcul n'est complet que lorsque tous les termes de l'écriture régionale ont une valeur. Fourmy peut proposer une référence prudente, signalée comme telle.

### 4.9 Rôles

- **FR-FERT-40 (M)** Le **responsable** établit et révise les PPF, force une interdiction avec un motif et modifie les références de la ferme. Le **salarié** consulte les PPF et voit les contrôles lors de ses saisies d'interventions. Un rôle **conseiller** (lecture et proposition de PPF, sans droit sur les interventions) est souhaité (S). Il dépend de la gestion des membres.

## 5. Exigences non fonctionnelles

- **NFR-FERT-1 Exactitude.**
  - Le calcul est une fonction pure du domaine, testée sur des **cas de référence chiffrés** : exemples du guide COMIFER 2013 (colza, blé), cas de la ferme de Pierre recalculés à la main ou avec un outil labellisé.
  - Les unités sont explicites : kg N/ha, kg N/t ou m³, %, mm, mg NO3/L.
  - Les conversions sont testées.
- **NFR-FERT-2 Traçabilité.** Chaque valeur d'un PPF dit d'où elle vient : référence et version, mesure, saisie ou calcul. Le PPF tel qu'établi est reproductible à l'identique des années plus tard.
- **NFR-FERT-3 Labellisation COMIFER.** La méthode, les écritures et les sorties suivent le cahier des charges de labellisation, à obtenir auprès du COMIFER. Les écarts connus sont documentés. Le référentiel Nouvelle-Aquitaine tolère 2 ans un outil conforme non labellisé.
- **NFR-FERT-4 Réglementation datée.** Chaque règle cite son texte : PAN 7, PAR 7 Nouvelle-Aquitaine, référentiel du 29/07/2025, zonage du 24/08/2026. Un changement de texte (PAN 8 annoncé pour 2028, nouveau zonage) se fait par une **nouvelle version de référentiel**, pas par du code.
- **NFR-FERT-5 Prudence.** Fourmy **aide** à respecter la réglementation, sans s'y substituer. Les écrans et les éditions le disent. Un contrôle qui ne peut pas être fait faute de données (zonage incertain, distance inconnue) est signalé comme « non vérifié », jamais comme « conforme ».
- **NFR-FERT-6 Données ouvertes et sources.**
  - Les jeux de données publics (data.gouv.fr, Sandre) sont repris avec leur licence et leur date.
  - Les tables COMIFER et INRA portent leur mention de source, en attendant l'accord demandé.
- **NFR-FERT-7 Hors ligne.** Sur le mobile, la saisie d'un apport hors ligne garde les contrôles de calendrier et de dose restante, à partir des données synchronisées.

## 6. User stories et critères d'acceptation

**US-F1 — Établir le PPF de la campagne (exploitant).** Pierre ouvre la campagne 2027. Fourmy lui propose un PPF pour chaque îlot en maïs :
- objectif de rendement d'après ses 5 dernières récoltes ;
- précédent ;
- irrigation prévue d'après 2026 ;
- type de sol.

Fourmy liste ce qui manque : reliquat ou analyse, teneur en nitrate de l'eau. Une fois ces données saisies, la dose, le détail de chaque terme et 2 apports conformes au fractionnement régional s'affichent. Pierre établit le PPF ; il est daté et ne bouge plus. Critères :
- chaque terme affiche sa source ;
- une donnée absente n'est jamais remplacée sans le dire ;
- le PDF contient les 10 éléments de l'annexe I.

**US-F2 — Dose de mon conseiller (exploitant).** Le technicien a calculé 175 kg N avec un outil labellisé. Pierre saisit 175 kg, l'outil et la date, et joint la sortie de l'outil. Le PPF est établi avec cette dose. Fourmy montre son propre calcul (par exemple 168 kg) à titre de comparaison.

**US-F3 — Saisir un apport (salarié).** Un salarié saisit un apport de solution azotée 390 sur un îlot de maïs. Fourmy affiche :
- l'azote apporté : 161 kg/ha × 30 % ≈ 48 kg N/ha (dose moyenne de Pierre). Une dose en L/ha est convertie avec la densité, soit 1,3 kg/L pour la solution 390 ;
- la dose restante au plan.

Un apport le 10 janvier (type III, culture de printemps) est signalé interdit. Critères :
- l'apport apparaît dans le cahier sans autre saisie ;
- un apport sans teneur en N connue est signalé « à compléter ».

**US-F4 — Contrôle (contrôleur).** Un contrôleur demande le PPF et le cahier de la campagne 2026. Le responsable édite les deux PDF et le dossier des justificatifs. Critères :
- les documents couvrent tous les îlots en zone vulnérable, y compris les îlots non fertilisés ;
- chaque apport porte sa date, sa surface, son produit, sa teneur et l'azote total ;
- les écarts au plan sont justifiés ou signalés.

**US-F5 — Pilotage (exploitant).** Une mesure N-Tester au stade 2 nœuds conseille 40 kg de plus que prévu. Pierre l'enregistre. Le PPF est révisé (version 2, motif « pilotage N-Tester ») et le dépassement est justifié dans le cahier.

**US-F6 — Vigne (vigneron).** Frédéric établit son PPF en dose plafond. Fourmy reprend la dose plafond régionale selon l'objectif de rendement, et le calendrier propre aux vignes (interdiction du 15/12 au 15/01). Le cahier liste ses apports au sol et ses foliaires azotés.

## 7. Hors périmètre de la première version

- L'élevage et le plafond de 170 kg sur les effluents produits, les bordereaux et le stockage au champ (FR-FERT-24) : avec l'élevage N1.
- Les régions autres que la Nouvelle-Aquitaine. La structure les permet, mais leurs référentiels restent à réunir.
- La déclaration annuelle des flux d'azote : Bretagne seulement, aucune obligation en Nouvelle-Aquitaine.
- Le phosphore et le potassium (P et K) au-delà de l'affichage des apports : pas d'obligation nitrates.
- Le bilan dynamique en cours de saison (type AzoFert). Le PPF peut être révisé à la main (FR-FERT-15, 17).

## 8. Questions ouvertes

1. **Accord COMIFER.** Qui écrit au COMIFER, et Ekylibre ou Fourmy en sont-ils membres ? Faut-il aussi un accord de l'INRA pour la table Rf (© AZOBIL) ?
2. **Labellisation.** Faut-il viser la labellisation COMIFER dès la première version, ou après un an d'usage ? Il faut le cahier des charges et le coût de la labellisation.
3. **Arrêté PAR 7 Nouvelle-Aquitaine.** Le texte n'a pu être lu (PDF scanné). Il faut confirmer :
   - les calendriers « zone Ouest », légumes, vigne et vergers ;
   - l'appartenance du Béarn à la zone Ouest ;
   - le tableau des couverts.

   Le recours de la FNSEA et des JA contre ce PAR est en cours.
4. **Reliquats de Pierre.** Fait-il mesurer ses reliquats sortie hiver, et par quel laboratoire ? Un import du format du laboratoire serait utile. A-t-il des analyses d'eau d'irrigation ? Des analyses de terre récentes (MO, argile, CaCO3) pour Mh ?
5. **Méthode utilisée aujourd'hui par Pierre** : conseiller de coopérative, outil, papier ? C'est notre cas de référence pour vérifier les calculs (NFR-FERT-1).
6. **Îlot cultural.** Le PPF se fait par îlot cultural, mais Fourmy raisonne en parcelles. Faut-il regrouper les parcelles d'une même culture dans un même îlot PAC, ou une parcelle Fourmy vaut-elle un îlot cultural ?
7. **Couverts d'interculture.** Faut-il des productions de couvert (avoine de Pierre en 2025 ?) ou une simple saisie dans le cahier (FR-FERT-23) ?
8. **Mobile.** Faut-il que `zero-mobile` montre les contrôles de calendrier et l'azote apporté hors ligne dès la première version (NFR-FERT-7) ?

## 9. Suite

`/sc:design` : modèle, référentiels, moteur du bilan, contrôles, éditions. Ensuite, découpage en lots :
- produits et composition, migration des teneurs ;
- référentiels ;
- PPF et calcul ;
- cahier et contrôles ;
- éditions.
