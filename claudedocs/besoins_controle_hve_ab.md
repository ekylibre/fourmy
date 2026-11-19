# Contrôles HVE et Agriculture biologique — expression des besoins

Brainstorm du 19/11/2026. Sources : `docs/hve/` (plan de contrôle niveau 3
V4.4 2024, grille d'audit v1.15, outils BGA et bilan apparent v1.07, liste
des PPP CMR au 04/09/2026, guide utilisateur Audit-HVE v1.14, note du
10/06/2025 sur la transmission des données d'audit), `docs/ab/` (règlement
(UE) 2018/848, guide de lecture INAO au 26/03/2026, arrêté du 09/12/2019),
pages web citées dans la demande. Rapports de recherche détaillés (sources
au folio ou à la cellule près) : à verser dans `docs/hve/` et `docs/ab/`
(`rapport_hve.md`, `rapport_ab.md`).

## 1. Objectif

Donner à une ferme certifiée **HVE** ou **AB** (ou en conversion) un
**contrôle continu de sa conformité** dans Fourmy, à partir des données
qu'elle saisit déjà (parcelles, cultures, interventions, intrants,
récoltes), et lui **préparer son dossier d'audit**. La ferme arrive à
l'audit en connaissant ses écarts, avec les pièces prêtes.

## 2. Décisions prises

| # | Décision |
|---|---|
| D1 | **Usage : les deux.** Un **tableau de bord de conformité** par campagne (indicateurs, feux, écarts à corriger) et un **export du dossier d'audit** (grille HVE pré-remplie, registre AB). |
| D2 | **Déclencheur : les certifications des parcelles** (Activités). L'entrée de menu apparaît sous **Réglementaire** dès qu'au moins une parcelle a une certification HVE (resp. AB, conversion ou certifiée) active pendant la campagne affichée. HVE se contrôle sur **toute l'exploitation** (la certification HVE porte sur l'exploitation entière). |
| D3 | **HVE : niveau 3, référentiel V4, « option A » seule.** L'option B (part des intrants dans le chiffre d'affaires) n'existe plus en V4 depuis le 1/1/2023 ; elle n'est pas couverte. |
| D4 | **Alertes à la saisie**, sur le modèle du feu phyto existant : feu orange ou rouge quand une intervention met une règle en défaut, en plus du tableau de bord. |
| D5 | **Périmètre AB : productions végétales** (grandes cultures, maraîchage, viticulture au champ). L'élevage est hors périmètre, sauf quand il touche les cultures (effluents épandus, terres fourragères). La cave (vinification bio) est hors périmètre. |
| D6 | **Grille HVE v1.15 à la lettre** quand elle diverge du plan de contrôle (4 bornes) ; l'écart est signalé dans le détail de l'item. |
| D7 | **Plafond AB de 170 kg N** d'effluents d'élevage : **par hectare et par parcelle** (chaque parcelle AB ou en conversion, par an). |
| D8 | **Statut de conversion AB déduit** (C1, C2, AB) des dates ; la saisie « conversion / certifiée » n'est plus qu'un contrôle de cohérence. |
| D9 | **Classement CMR** : liste ministérielle et mentions de danger E-Phy (H340/H350/H360 = CMR1, H341/H351/H361 = CMR2) sont censées concorder ; Fourmy utilise la liste ministérielle datée et signale toute discordance avec E-Phy. |
| D10 | **Questionnaire HVE annuel** par ferme pour les items déclaratifs (ruches, test bêche, surveillance, équipements…). |
| D12 | **Rotation AB en grandes cultures** (aucun seuil officiel, « appréciation globale » du guide INAO) : trois repères du guide, **en orange seulement**, par parcelle — aucune légumineuse sur les **N** dernières campagnes ; la même espèce plus de **K** années de suite ; monoculture alternée avec un engrais vert. **N = 5** et **K = 2** par défaut (l'historique N-1…N-5 et le guide), réglables par ferme selon ce que l'organisme accepte. En maraîchage, la règle chiffrée du guide (≥ 3 espèces, engrais vert ≥ 30 jours) s'applique telle quelle. |
| D11 | **Ordre de réalisation** : celui du §9 (question 9) est retenu. |

## 3. Constats des sources

### 3.1 HVE niveau 3 (V4)

- **Quatre indicateurs, chacun ≥ 10 points**, tous validés pour la
  certification : biodiversité (max 36), stratégie phytosanitaire (max 63),
  fertilisation (max 53), irrigation (max 34 ; **validé d'office** pour
  une exploitation non irrigante sans matériel d'irrigation).
- **Période** : dernière campagne achevée, 12 mois si possible calés sur
  l'exercice comptable ; moyenne n, n-1, n-2 possible pour l'IFT et le
  bilan azoté.
- **Condition éliminatoire** : un seul usage d'un produit **CMR1** (à la
  date de l'utilisation) pendant la campagne invalide l'indicateur phyto,
  donc la certification (sauf arrêté de dérogation).
- **La grille ministérielle v1.15 fait foi** (importée dans Certibase
  depuis le 28/05/2025) ; elle est plus stricte que le plan de contrôle
  sur 4 bornes (IAE = 4 %, IAE sous le seuil SAU > 5 %, 100 % de prairies
  permanentes, cultures mineures = 5 %).
- Beaucoup d'items sont **déclaratifs** (ruches, test bêche, surveillance
  BSV, équipements des pulvérisateurs, démarche collective d'irrigation…).

Indicateurs et données (détail, formules et barèmes : `rapport_hve.md` §2) :

| Indicateur | Items calculables depuis Fourmy | Items à déclarer |
|---|---|---|
| Biodiversité | IAE (socle 4 % des terres arables, poids sur la surface totale, ≥ 3 familles) à partir des éléments du paysage PAC et BD TOPO ; taille des parcelles ; poids de la culture principale ; nombre d'espèces | espèces animales, ruches, variétés et races menacées, qualité biologique du sol |
| Phyto | CMR1 (éliminatoire) et CMR2 ; surfaces non traitées ; IFT herbicides et hors herbicides contre les références régionales (plancher, plafond) ; diversité variétale | surveillance active, méthodes alternatives (en partie), équipements anti-fuites, couvert inter-rang |
| Fertilisation | bilan azoté (BGA, N total) ; part d'azote organique ; SAU non fertilisée ; légumineuses ; couverture des sols (durée en semaines, socle 100 %) ; OAD (le PPF de Fourmy) | OAD externes, éléments d'élevage du bilan |
| Irrigation | complétude du cahier d'irrigation ; part des prélèvements en étiage (juin-août) | mode, matériel, origine de l'eau, facteur déclenchant (champs à ajouter à l'intervention), outils de mesure, matériels, démarche collective, pratiques économes |

### 3.2 Agriculture biologique

- Règlement (UE) 2018/848 (annexe II partie I) et guide de lecture INAO :
  pas de note globale, mais des **règles** dont la violation déclasse un
  lot ou une parcelle. Contrôle annuel par un organisme certificateur.
- Règles **vérifiables automatiquement** (détail et références :
  `rapport_ab.md` §2 et §5), par enjeu :
  1. **phyto non autorisé** sur parcelle AB (déjà en feu rouge) **et sa
     conséquence** : récolte suivante déclassée, conversion qui redémarre ;
  2. **statut de conversion calculé** par parcelle et par récolte : C1
     (récolte dans les 12 premiers mois), C2 (à partir du 13e mois), AB
     (annuelle semée ≥ 24 mois, pérenne récoltée ≥ 36 mois après le début) ;
  3. **cuivre** : 28 kg Cu/ha sur 7 ans glissants depuis le 1/1/2022 (ou
     4 kg/ha/an si l'AMM le prévoit) ;
  4. **fertilisants** : pas d'azote minéral ; seulement les matières de
     l'annexe II du règlement 2021/1165 ; pas d'effluents d'élevages
     industriels ;
  5. **170 kg N/ha/an** issus des effluents d'élevage ;
  6. **semences et plants bio** (non bio seulement sur dérogation obtenue
     avant le semis, en semence non traitée ; jamais de plants non bio) ;
  7. **mixité** : même espèce en bio et en non bio la même campagne
     (variétés facilement distinguables exigées ; jamais sous le même abri) ;
  8. **matériel commun** bio / non bio sans nettoyage enregistré ;
  9. **rotation** : légumineuses ; en maraîchage, au moins 3 espèces et
     engrais vert d'au moins 30 jours (pas de seuil chiffré en grandes
     cultures : indicateur, pas verdict) ;
  10. **hors-sol** interdit (sauf pots d'ornementales et aromatiques, plants).
- **Aucune règle propre à l'irrigation** (seulement les intrants en
  fertirrigation).

## 4. Exigences fonctionnelles

### 4.1 Commun

- **FR-CTL-1 (menu)** : sous **Réglementaire**, une entrée « Contrôle HVE »
  et une entrée « Contrôle AB », visibles seulement si la campagne affichée
  a au moins une parcelle certifiée correspondante (D2). Elles disparaissent
  pour une campagne sans certification.
- **FR-CTL-2 (tableau de bord)** : par campagne, une page de synthèse :
  verdict global, puis chaque indicateur (HVE) ou règle (AB) avec son
  **feu** (vert : conforme ; orange : à vérifier ou donnée manquante ;
  rouge : non conforme), sa valeur, son seuil, et **le détail cliquable**
  qui mène aux interventions, parcelles ou produits en cause.
- **FR-CTL-3 (données manquantes)** : chaque calcul liste les données qui
  lui manquent (champ non saisi, référentiel absent) avec un lien pour les
  compléter ; une donnée manquante n'est jamais comptée comme conforme.
- **FR-CTL-4 (alertes à la saisie, D4)** : à l'enregistrement d'une
  intervention, les règles qui s'appliquent à elle sont évaluées et
  affichées comme le feu phyto actuel (sans bloquer la saisie).
- **FR-CTL-5 (export du dossier, D1)** : export par campagne, daté,
  reproductible (mêmes données → même export).
- **FR-CTL-6 (historique)** : les résultats d'une campagne close sont
  conservés (une modification ultérieure des données est signalée comme
  écart avec le dernier calcul exporté).

### 4.2 HVE

- **FR-HVE-1 (période)** : campagne HVE de 12 mois à date de début
  réglable (exercice comptable), choix campagne seule ou moyenne
  pluriannuelle pour l'IFT et le bilan azoté.
- **FR-HVE-2 (surfaces)** : SAU, terres arables, prairies permanentes et
  temporaires (âge), jachères, surface totale de l'exploitation (SAU + SNA
  + ZDH…), classées depuis les codes PAC des parcelles ; surfaces **réelles**.
- **FR-HVE-3 (biodiversité)** : IAE à partir des éléments du paysage
  (TelePAC, BD TOPO), avec les **coefficients et familles de l'annexe 2**,
  l'**adjacence** aux terres arables, le socle de 4 % (et ses dispenses),
  le poids et la diversité ; taille des parcelles ; culture principale ;
  nombre d'espèces (cultures, dérobées, couverts, mélanges). La conversion
  des éléments PAC en IAE HVE est **proposée** et **validée** par
  l'exploitant (définitions différentes).
- **FR-HVE-4 (CMR)** : référentiel de la **liste ministérielle des PPP CMR**
  (clé : n° d'autorisation, pas l'AMM de référence), **versionné** (le
  classement compte à la date de l'utilisation). CMR1 utilisé : indicateur
  phyto invalidé, feu rouge à la saisie. CMR2 : points perdus, feu orange.
  Le contrôle porte aussi sur les **semences traitées** et les **engrais**
  qui contiennent un produit classé (FAQ Q129). La liste ministérielle est
  la **seule référence** (FAQ Q127) : les mentions de danger E-Phy ne
  servent qu'à signaler une discordance (D9).
- **FR-HVE-4 bis (surfaces non traitées)** : une parcelle traitée une seule
  fois dans la campagne est exclue ; une parcelle traitée seulement en
  biocontrôle compte comme non traitée (FAQ).
- **FR-HVE-5 (IFT)** : IFT herbicides et hors herbicides de l'exploitation,
  **hors biocontrôle et traitement de semences**, comparés aux références
  plancher / plafond de l'ancienne région (grandes cultures) ou du bassin
  viticole (vigne) ; barème par quarts ; prorata par famille de cultures.
- **FR-HVE-6 (fertilisation)** : bilan azoté en **azote total** (balance
  globale), SAU non fertilisée, part d'azote organique, légumineuses,
  couverture des sols (durée continue en **semaines entières** par
  parcelle, calcul séparé en zone vulnérable et hors zone, la surface la
  moins longtemps couverte étant le facteur limitant ; en zone vulnérable,
  points au-delà de 8 semaines quel que soit le programme régional, FAQ
  Q242), OAD (PPF de Fourmy). Exportations d'azote : **table ministérielle
  du 23/06/2026** (rendement réel ramené à la matière sèche de référence ×
  teneur, FAQ Q214 et Q220) ; une culture est « principale » si elle figure
  dans la table. La table se saisit en référentiel semi-manuellement
  (PDF mal structuré).
- **FR-HVE-7 (irrigation)** : « exploitation non irrigante » validée
  d'office ; sinon complétude du cahier (7 données par apport, 5 par
  parcelle) et part des prélèvements en étiage.
- **FR-HVE-8 (questionnaire)** : les items déclaratifs (ruches, test bêche,
  surveillance, équipements, démarche collective, races et variétés
  menacées, espèces animales) se saisissent dans un **questionnaire annuel
  par ferme**, avec pièces justificatives jointes.
- **FR-HVE-9 (export)** : pré-remplissage de la **grille d'audit
  ministérielle v1.15** (onglets Surfaces, Biodiversité, Phyto,
  Fertilisation, Irrigation) **sans en modifier la structure** (importée
  dans Certibase), plus les pièces : bilan IFT, cahiers phyto,
  fertilisation et irrigation, plan parcellaire avec les IAE.

### 4.3 Agriculture biologique

- **FR-AB-1 (statut calculé)** : statut C1 / C2 / AB de chaque parcelle à
  chaque date et de chaque récolte, calculé depuis le début de conversion
  (certification de la parcelle), la culture (annuelle, semi-pérenne,
  pérenne) et les dates de semis ou de plantation et de récolte ; la saisie
  « conversion / certifiée » devient un contrôle de cohérence.
- **FR-AB-2 (traitement interdit)** : un phyto non autorisé sur une parcelle
  AB (feu rouge existant) **déclasse la récolte suivante** et marque la
  parcelle à reconvertir (sauf lutte obligatoire, à justifier).
- **FR-AB-3 (cuivre)** : cumul de cuivre métal par parcelle sur 7 ans
  glissants depuis le 1/1/2022, contre 28 kg/ha (seule limite chiffrée de
  l'annexe I du règlement 2021/1165, p. 12 ; le guide INAO ajoute le
  lissage et les 4 kg/ha/an quand l'AMM les prévoit) ; feu orange à 80 %, rouge au-delà ; cuivre des engrais
  foliaires compté s'il sert de fongicide.
- **FR-AB-4 (fertilisants)** : sur parcelle AB, feu rouge pour un engrais
  azoté minéral ou une matière non utilisable en AB. Le référentiel se
  construit **par catégorie de matière** de l'annexe II du règlement
  2021/1165 (un produit n'est admis que s'il ne contient que des matières
  listées ; boues exclues faute d'y figurer ; six catégories, dont les
  digestats, interdites en provenance d'élevages industriels) : chaque
  fertilisant de la ferme est rattaché à sa ou ses catégories ; plafond de 170 kg N/ha/an
  d'effluents d'élevage **par parcelle** (D7) : orange à 80 %, rouge
  au-delà, à la saisie et au tableau de bord.
- **FR-AB-5 (semences)** : statut des semences et plants (bio, en
  conversion, non bio ; traité ou non) et dérogations accordées par
  l'organisme certificateur après consultation de
  semences-plants-biologiques.org (date d'obtention avant le semis,
  saison, quantité) ; feu rouge pour une semence non bio sans dérogation ou
  un plant non bio sur parcelle AB.
- **FR-AB-6 (mixité)** : signalement d'une même espèce cultivée en bio et en
  non bio la même campagne, avec le critère de distinction des variétés à
  renseigner.
- **FR-AB-7 (matériel)** : signalement d'un matériel passé d'une parcelle
  non AB à une parcelle AB sans intervention « nettoyage » enregistrée
  entre les deux.
- **FR-AB-8 (rotation, D12)** : frise des cultures et couverts de chaque
  parcelle avec trois repères en orange seulement — légumineuse sur les N
  dernières campagnes, même espèce au plus K années de suite, pas de
  monoculture alternée avec un engrais vert (N = 5, K = 2, réglables par
  ferme) ; en maraîchage, au moins 3 espèces et engrais verts d'au moins
  30 jours (21 pour un sorgho d'été).
- **FR-AB-7 bis (produits de nettoyage)** : l'annexe IV du règlement
  2021/1165 est vide dans la version lue ; le référentiel est l'annexe I
  du cahier des charges français élevage (arrêté du 28/12/2021), auquel
  renvoie le catalogue INAO (manquement n° 366).
- **FR-AB-10 (gravité INAO)** : chaque règle affiche le **manquement du
  catalogue national des mesures** (INAO-DEC-CONT-AB-4, v10 du
  17/09/2026) : numéro, classe (mineur, majeur, critique) et mesure
  encourue (ex. conversion n° 27-28 et phyto non autorisé n° 4 : majeurs,
  déclassement du lot ; semence sans dérogation n° 38 et 170 N n° 40 :
  mineurs ; plants non bio n° 37 et mixité n° 31 : majeurs ; hors-sol :
  critique). Le feu de la règle en découle : rouge pour majeur et
  critique, orange pour mineur.
- **FR-AB-9 (registre AB exportable)** : parcelles et statuts, cultures,
  intrants (phyto avec justification, fertilisants, semences et
  dérogations), récoltes et leur statut, nettoyages ; export pour
  l'organisme certificateur.

## 5. Exigences non fonctionnelles

- **NFR-1 (traçabilité des règles)** : chaque contrôle cite sa source
  (article, point, cellule de grille) et la version du référentiel.
- **NFR-2 (référentiels versionnés)** : liste CMR, références IFT,
  coefficients IAE, fertilisants utilisables en AB : chargés avec leur date
  de validité, jamais modifiés en place.
- **NFR-3 (pas de faux vert)** : une donnée manquante donne orange, jamais
  vert.
- **NFR-4 (performance)** : tableau de bord d'une ferme de 200 ha et 1 000
  interventions par campagne en moins de 3 s ; alertes de saisie en moins
  de 500 ms.
- **NFR-5 (charte)** : feux et libellés cohérents avec le contrôle phyto et
  la page Intégrations (feu vert allumé / éteint, orange, rouge).
- **NFR-6 (droits)** : lecture par tous les membres ; questionnaire,
  validation des IAE et export par le responsable.

## 6. Récits utilisateurs et critères d'acceptation

- **US-1** — En tant qu'exploitant HVE, j'ouvre « Contrôle HVE » et je vois
  mes 4 indicateurs avec leurs points et les items à compléter.
  *Accepté si* : les points calculés égalent ceux de la grille v1.15
  saisie à la main sur une ferme de test ; un indicateur sous 10 points est
  rouge ; l'irrigation d'une ferme sans irrigation est « validée d'office ».
- **US-2** — Je saisis un traitement avec un produit CMR1 sur une ferme HVE.
  *Accepté si* : feu rouge à la saisie, avec le motif et la date de
  classement ; le tableau de bord passe l'indicateur phyto en « invalidé ».
- **US-3** — Je télécharge ma grille d'audit pré-remplie.
  *Accepté si* : le fichier s'ouvre dans Excel, garde la structure de la
  grille v1.15, et ses onglets de calcul donnent les mêmes points que le
  tableau de bord.
- **US-4** — En tant qu'exploitant en conversion AB, je vois pour chaque
  parcelle son statut (C1, C2, AB) et la date de passage au statut suivant.
  *Accepté si* : une parcelle entrée en conversion le 1/05/2025 donne C1
  pour une récolte au 1/04/2026, C2 au 1/06/2026, et une annuelle semée
  le 2/05/2027 est AB.
- **US-5** — J'épands un engrais azoté minéral sur une parcelle AB.
  *Accepté si* : feu rouge à la saisie ; la règle apparaît non conforme dans
  « Contrôle AB » avec un lien vers l'intervention.
- **US-6** — Ma vigne AB a reçu 25 kg de cuivre/ha depuis 2022.
  *Accepté si* : feu orange (au-delà de 80 % du plafond), avec le cumul par
  année ; le traitement qui ferait dépasser 28 kg est rouge à la saisie.
- **US-7** — Je sème une semence non bio sans dérogation sur une parcelle AB.
  *Accepté si* : feu rouge ; avec une dérogation obtenue avant le semis pour
  cette saison, feu vert.
- **US-8** — Le menu « Contrôle AB » n'apparaît que pour une campagne où au
  moins une parcelle est en conversion ou certifiée AB.

## 7. Ce qu'il faut ajouter à Fourmy (synthèse des écarts)

| Domaine | Ajout |
|---|---|
| Référentiels | liste CMR versionnée ; références IFT HVE (régions, bassins) ; coefficients IAE (annexe 2) ; table des exportations d'azote (ministère / COMIFER) ; fertilisants utilisables en AB (annexe II du règlement 2021/1165) ; teneur en cuivre métal des produits |
| Productions | culture annuelle, semi-pérenne ou pérenne ; date de plantation des pérennes ; mode de culture (plein champ, abri, hors-sol) ; composition des mélanges et couverts ; famille botanique (légumineuses) |
| Intrants | semences et plants : bio, non traité, dérogation ; fertilisants : utilisable en AB, provenance des effluents |
| Interventions | justification d'un traitement (AB) ; irrigation : mode, matériel, origine de l'eau, facteur déclenchant ; intervention « nettoyage » du matériel ; mode de destruction des couverts |
| Ferme | questionnaire HVE annuel ; dates de notification Agence Bio et d'engagement auprès de l'organisme ; dérogations semences |
| Surfaces | SNA, ZDH et surface totale ; zone vulnérable ; ancienne région et bassin viticole |
| IFT | conserver par catégorie (herbicides, hors herbicides, biocontrôle, semences) et la **signature** de l'API du ministère (exigée par l'audit pour ne pas recalculer) |

## 8. Hors périmètre

- HVE option B ; HVE niveau 2 ; horticulture et cultures hors-sol HVE
  (surfaces mensuelles), à reporter.
- AB : élevage, transformation et cave, étiquetage et vente, collecte et
  transport (hors registre des récoltes).
- Transmission directe à Certibase ou aux organismes certificateurs
  (l'export est déposé par l'exploitant ou l'auditeur).

## 9 bis. Compléments de lecture (19/11/2026)

Les rapports `docs/hve/rapport_hve.md` et `docs/ab/rapport_ab.md` ont un
§8 « Compléments » (table des exportations d'azote, FAQ HVE V4, plan V4
2022, règlement 2021/1165, documents de contrôle INAO). Points restant à
vérifier :

- **HVE** : abattement de 20 % du bilan fourrager (outil BGA) ; formule des
  parties pérennes des vergers (absente de la table depuis le 23/06/2026) ;
  bilan azoté et IFT de Fourmy à confronter au calcul HVE (N total
  réalisé ; IFT par catégorie et signature) à la conception.
- **AB** : le cuivre n'apparaît dans aucun document INAO (rattachement au
  manquement n° 328 à confirmer avec un organisme) ; versions consolidées
  du règlement 2021/1165 non lues ; notes de lecture INAO (170 N, semences)
  toujours absentes.
- **Priorités** : le catalogue INAO classe le 170 N et la semence sans
  dérogation en **mineurs**, le cahier de culture et la comptabilité
  matière (registre AB) en majeurs ou critiques. L'ordre validé (D11) est
  gardé ; l'export du registre AB pourrait remonter avant les règles
  mineures, à décider à la planification.

## 9. Questions (réponses du 19/11/2026)

Réponses : 1 → D6 ; 2 → pièces ajoutées dans `docs/hve/` (table des
exportations d'azote, FAQ HVE V4, plan de contrôle V4 2022) et `docs/ab/`
(règlement 2021/1165, circulaire et décisions INAO de contrôle bio) ; 3 →
aucun autre texte ; 4 → D7 ; 5 → D8 ; 6 → options au §10 ; 7 → D9 ;
8 → D10 ; 9 → D11 ; 6 → D12 (option « règles du guide, seuils réglables »).

Questions initiales :

1. **Grille ou plan en cas d'écart** (4 bornes) : suivre la grille v1.15 à
   la lettre (recommandé : c'est elle qui sert à l'audit) et signaler
   l'écart ?
2. **Pièces manquantes à fournir** : FAQ HVE V4, table ministérielle des
   exportations d'azote, liste COMIFER des OAD, liste DGAL des produits de
   biocontrôle (E-Phy a un indicateur biocontrôle : suffit-il ?) ;
   règlement d'exécution 2021/1165 (listes des produits autorisés en AB) ;
   notes de lecture INAO « 170 kg N », « MRV » (semences), « produits
   phyto ». Pages Commission et Agence Bio non lisibles automatiquement.
3. **Liens fournis hors sujet** : JORFTEXT000044793347 est le cahier des
   charges français de l'élevage, JORFTEXT000050060154 celui du sel,
   JORFTEXT000039481757 la restauration commerciale bio. Y avait-il un autre
   texte à viser pour les productions végétales ?
4. **170 kg N** : à l'échelle de l'exploitation (SAU bio et en conversion)
   ou de la parcelle ? Année civile ou campagne ? Azote total (probable) ?
5. **Statut de conversion** : le déduire entièrement (FR-AB-1) et faire de
   la saisie « conversion / certifiée » un simple contrôle, d'accord ?
6. **Rotation en grandes cultures** : aucune règle chiffrée ; quel repère
   afficher (ex. au moins une légumineuse sur 5 ans, à valider) ?
7. **CMR** : la liste ministérielle (3 versions datées dans le classeur) ou
   les mentions de danger E-Phy (H340/H350/H360 et H341/H351/H361, déjà en
   base) ? Recommandation : la liste ministérielle, qui fait foi en audit,
   E-Phy en secours entre deux versions.
8. **Questionnaire HVE** : accepté comme saisie annuelle, ou certains items
   déclaratifs sont-ils à ignorer en v1 (le score affiché est alors un
   minimum) ?
9. **Ordre de réalisation** : proposition — 1) socle commun (menu,
   tableau de bord, alertes) ; 2) AB : statut calculé, phyto, cuivre,
   fertilisants, 170 N ; 3) HVE : CMR, IFT, fertilisation, irrigation ;
   4) HVE biodiversité (IAE) et questionnaire ; 5) AB semences, mixité,
   matériel, rotation ; 6) exports (grille v1.15, registre AB).
