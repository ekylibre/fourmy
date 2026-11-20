# Contrôle HVE niveau 3 (référentiel V4) : expression des besoins pour Fourmy

Rapport de recherche documentaire, 19/11/2026. Lecture seule du dépôt ; aucun fichier de Fourmy modifié.

## 0. Sources et méthode

| Abréviation | Fichier / URL | Version | Lu |
|---|---|---|---|
| **PdC4** | `docs/hve/Plan_controle_niveau3_V4.4_2024.pdf` | V4.4 du 01/01/2025, 118 p. | intégralement (texte extrait, annexes 3 et 9 survolées) |
| **PdC3** | `docs/hve/plan_de_controle_niveau_3_option_a_04.pdf` | **V3 du 31/12/2016** (option A, annexes avec arrêtés 2011/2016 incluant l'option B), 105 p. | sections cadre, option B, arrêté 2016 |
| **Grille** | `docs/hve/grille-audit-hvev4-v1.15 - vf_0.xlsx` | v1.15 (19/05/2026), 20 onglets | onglets Biodiversité, Phyto, Fertilisation, Irrigation, Surfaces, SYNTHESE, Paramètres, Scoring_GC, Suivi modif (formules extraites) |
| **Guide** | `docs/hve/Guide_Utilisateur_Audit-HVE.v1.14vf.pdf` | grilles v1.13 et + , 18 p. | intégralement |
| **BGA** | `docs/hve/Outil_calcul_BGA_HVE.v1.07.xlsx` | v1.07 | onglets BGA, E1, E2, E3, S2 |
| **BA** | `docs/hve/Outil_calcul_Bilan_apparent_HVE.v1.07.xlsx` | v1.07 | onglets Bilan apparent, E1 à E4, S1 à S4 |
| **CMR** | `docs/hve/HVE_Liste des PPP classés CMR_au_04.09.26.vf_.xlsx` | 04/09/2026 (+ onglets 21/10/2025, 29/10/2024) | intégralement (analyse statistique) |
| **Certibase** | `docs/hve/2025-06-10_Information usagers_Transmission des données d'audits HVE.pdf` | 10/06/2025, 2 p. | intégralement |
| **Web** | https://agriculture.gouv.fr/certification-environnementale-mode-demploi-pour-les-exploitations | page datée du 08/09/2026 | accès automatisé **réussi** (résumé par l'outil, pas de lecture brute) |
| **ExpN** | `docs/hve/Exportations_azote_productions_vegetales-23062026.pdf` | mise à jour du 23/06/2026, 8 p. | intégralement (ajout du 19/11/2026, §8.1) |
| **FAQ** | `docs/hve/FAQ HVEv2022.V3-vf.pdf` | « HVEv2022 – v3 – Août 2025 », 72 p., 261 questions | sommaire intégral ; réponses des parties Identification, Biodiversité, Phyto, Fertilisation, Irrigation (ajout du 19/11/2026, §8.2) |
| **PdC22** | `docs/hve/Plan_controle_niveau3_v4_2022.pdf` | V4 du 22/11/2022, 120 p. | comparaison automatique mot à mot avec PdC4, puis relecture des sections modifiées (ajout du 19/11/2026, §8.3) |

Références : « PdC4 §4.1.2.3 p.29 » = section et numéro de page imprimé du plan. Pour la grille, « Grille/Phyto!P55 » = onglet et cellule.

Non lus car absents du dossier lors de la première rédaction : la **FAQ HVE V4**, la **table des exportations d'azote** (PDF du ministère) et la **liste COMIFER des OAD**. Les deux premières ont été ajoutées le 19/11/2026 et sont exploitées au §8. La liste COMIFER des OAD reste absente.

---

## 1. Cadre

### 1.1 Niveaux
- **Niveau 1 : supprimé** par le décret n°2023-990 du 25/10/2023 (Web). PdC4 ne le mentionne plus.
- **Niveau 2 :** référentiel de « 16 exigences » (Web, plan de contrôle V1 de 2011). Dans la grille, l'équivalence niveau 2 d'autres démarches se saisit dans Identification, 4e partie (Guide §2.2.1). Ce n'est pas un prérequis de calcul pour le niveau 3.
- **Niveau 3 = HVE :** 4 indicateurs composites (biodiversité, stratégie phytosanitaire, fertilisation, irrigation). Chaque indicateur somme les points de ses items. **Il est validé si sa note est ≥ 10 points. Les 4 doivent être validés** (PdC4 §1.2 p.8, §2.2.1 p.13 ; Grille/SYNTHESE!L44:L47). Tous les items applicables doivent être notés, même quand les 10 points sont déjà atteints (PdC4 §1.2).

### 1.2 Option A et option B
- **V4 (depuis le 01/01/2023) : il n'y a plus d'options.** Le référentiel V4 correspond à l'ancienne approche thématique (« option A »), avec de nouveaux items. Le mot « option » n'apparaît dans PdC4 qu'au §2.3 (mesures transitoires).
- **Option B (V3 2016)** : elle reste applicable seulement aux exploitations certifiées avant le 01/01/2023 dont le certificat court au-delà du 31/12/2024. Ces exploitations peuvent faire leurs audits de suivi selon V3 A ou V3 B jusqu'à l'échéance, mais **le renouvellement en V3 est impossible** (PdC4 §2.3 p.14, §3.5 p.24). Un certificat dure 3 ans, et le plus tardif a donc été émis le 31/12/2022 : *on en déduit* qu'il n'existe plus de certificat V3 valide en novembre 2026. Cette déduction n'est pas écrite dans les sources. Le §3 la détaille quand même pour mémoire.
- La page Web ne parle pas d'option A/B.

### 1.3 Période de référence
- La **campagne évaluée** est la dernière campagne achevée à la date de l'audit (campagne n). Sa période de 12 mois est fixée avant l'audit avec l'OC ou la structure collective. Elle est la même pour tous les indicateurs et, si possible, calée sur l'exercice comptable (PdC4 Glossaire p.4 ; Guide §2.2.1 : saisie « aaaa-aa », année civile « 2025-25 » admise depuis la grille v1.14).
- Moyennes pluriannuelles possibles pour l'IFT, le bilan azoté, la quantité de substances actives et la quantité d'azote (horticulture) : n, n-1, n-2 (voir items).
- Si 2 campagnes complètes se sont écoulées depuis l'audit précédent, **les 2 sont évaluées**, avec une grille par campagne (PdC4 §1.2 p.9).
- **Surfaces réelles, et non développées** : une surface portant plusieurs cultures dans la campagne ne compte qu'une fois (PdC4 §4 p.26, §6.1.1).
- Périmètre : toutes les surfaces dont l'exploitation a la responsabilité, vérifiées sur le registre parcellaire PAC, complété au besoin par baux, titres, CVI… (PdC4 Glossaire). La surface de l'exploitation = SAU + SNE + SNA + ZDH + marais salants.

### 1.4 Qui contrôle, quand
- **OC agréé**, accrédité NF EN ISO/CEI 17065 ou 17021, avec référent technique et auditeurs habilités (PdC4 §1.3).
- **Certification individuelle**, cycle de 3 ans (PdC4 §2.1.3, §2.2) :
  - audit initial sur place ;
  - au moins un audit de suivi sur place, au plus tard 10 mois avant l'échéance ;
  - audit de renouvellement au plus tard 3 mois avant l'échéance ;
  - durée normale ½ journée (4 h), réductible à 2h30-3h ;
  - rapport envoyé dans les 15 jours.
- **Cadre collectif** (PdC4 §3) :
  - contrôle interne annuel de toutes les exploitations ;
  - « synthèse de collectif » à transmettre au plus tard 1 mois avant l'audit externe ;
  - audit externe annuel de la structure et d'un échantillon de n = √N (N ≤ 49), 1,5√N (50-399) ou 2√N (> 399), allégé après 2 audits sans écart majeur.
- **Grille d'audit obligatoire** (celle du ministère, ou un outil validé par lui). Elle est conservée 5 ans après la fin de validité (PdC4 §1.2 p.9).
- **Certibase** (Certibase, Guide §1) :
  - depuis le 28/05/2025, les OC importent les grilles dans Certibase. Les onglets ne doivent pas être modifiés ;
  - données transmises : identité, SIRET ou CVI, coordonnées, performances environnementales ;
  - conservation : 10 ans pour les données personnelles, 30 ans pour les performances et les données géographiques ;
  - finalités : pilotage, annuaire HVE (sur accord de l'exploitant) et statistiques.

---

## 2. Indicateurs du niveau 3 V4 (ancienne « option A »)

Points maximum affichés par la grille (cellules « Max points accessibles ») : Biodiversité 36, Phyto 63, Fertilisation 53, Irrigation 34. Ces maxima sont théoriques (toutes filières confondues) : les items spécifiques sont **proratisés par la part de SAU concernée**.

### 2.1 Biodiversité (8 items, seuil ≥ 10)

| Item | Formule | Barème | Source |
|---|---|---|---|
| **4.1 IAE** (max 9) | **Critère obligatoire (socle) :** Σ surfaces équivalentes des IAE portées par ou adjacentes aux **terres arables** / surface en terres arables **≥ 4 %**. S'il échoue : 0 point à l'item. **Dispense** si : terres arables < 10 ha, ou PT + jachères + légumineuses > 75 % des terres arables, ou herbe (PP+PT) + riz > 75 % de la SAU. | Socle seul, sans point | PdC4 §4.1.1 p.26-27 ; Grille/Biodiversité!W41,T48 |
| | **Poids des IAE :** Σ surfaces équivalentes de toutes les IAE de l'exploitation / **surface totale de l'exploitation** (SAU+SNE+SNA+ZDH…) | <4 % : 0 ; [4,5[ : 1 ; [5,6[ : 2 ; [6,7[ : 3 ; [7,8[ : 4 ; [8,9[ : 5 ; [9,10[ : 6 ; ≥10 % : 7 | PdC4 §4.1.2.3 p.29 ; Grille!W53 |
| | **Diversité :** au moins 3 familles parmi aquatique, herbager, ligneux, rocheux, sans minimum de surface | 2 points | PdC4 §4.1.3 p.29 ; Grille!W56 |
| **4.2 Taille des parcelles** (max 5) | (surface des PP, quelle que soit la taille, + surfaces des parcelles hors PP de taille **< 6 ha**) / SAU. La parcelle s'entend comme unité culturale (une espèce). Deux parcelles RPG contiguës de même culture ne font qu'une, sauf si une IAE linéaire les sépare. | <40 % : 0 ; [40,50[ : 1 ; [50,60[ : 2 ; [60,70[ : 3 ; [70,80[ : 4 ; ≥80 % : 5 | PdC4 §4.2 p.30-31 ; Grille!S85 |
| **4.3 Poids de la culture principale** (max 5) | surface de la culture principale (hors PP) / (SAU − PP). Notion d'espèce (blé dur ≠ blé tendre). Chaque tranche de 10 % de SAU en PT ≤ 5 ans compte comme une culture ; même règle pour les mélanges. Les cultures successives sur une même surface se divisent (2 légumes : surface/2). | ≥60 % : 0 ; [50,60[ : 1 ; [40,50[ : 2 ; [30,40[ : 3 ; [20,30[ : 4 ; <20 % : 5 | PdC4 §4.3 p.31-32 ; Grille!Q112 |
| **4.4 Espèces végétales cultivées** (max 6) | Nombre d'espèces, cultures dérobées et CIPAN comprises (pas les variétés). Mélange : espèces semées. PT : pure = 1, mélange simple = 2, mélange complexe graminées + légumineuses = 3. PP : 1 espèce par tranche de 10 % de SAU. | Si culture principale ≥ 60 % : 6 esp. = 1 … 10 = 5. Sinon (ou 100 % PP) : 5 = 1 … 10 = 6. Grille : min(max(n−5,0),5) ou min(max(n−4,0),6) | PdC4 §4.4 p.33-34 ; Grille!O154 |
| **4.5 Espèces animales élevées** (max 3) | Espèces (pas races), hors abeilles, élevées pour un produit ou un service | 0-1 : 0 ; 2 : 1 ; 3 : 2 ; ≥4 : 3 | PdC4 §4.5 p.34-35 ; Grille!L180 |
| **4.6 Ruches** (max 1) | ≥ 3 ruches sédentaires, en état de fonctionnement, sur des parcelles de l'exploitation pendant toute la campagne | 1 point | PdC4 §4.6 p.35 |
| **4.7 Variétés, races, espèces menacées** (max 6) | Variétés de l'annexe 3 (valables seulement dans la région citée). Races « menacées d'être perdues pour l'agriculture » de l'arrêté du 29/04/2015 modifié (dernière version 25/05/2023). | 1 point par élément, plafond 3 (végétal) + 3 (animal) | PdC4 §4.7 p.36, annexe 3 p.92-104 |
| **4.8 Qualité biologique du sol** (max 1) | Test bêche OPVT (5 blocs de 20×20×25 cm, janvier-mars, avant toute intervention, sur culture d'hiver ou pérenne de 10 ans et plus, résultats et photos déposés à l'OPVT), ou analyse de biomasse moléculaire microbienne en laboratoire, sur au moins une parcelle | 1 point. Le test vaut 3 campagnes ; l'analyse doit dater de l'année précédant l'audit | PdC4 §4.8 p.37-38 |

**IAE : règles de comptabilisation** (PdC4 §4.1.1.2 et §4.1.2.2 p.27-29, annexe 2 p.89-91, Grille/Paramètres!B5:H25)

Conversion : linéaire (m) × coefficient (m²/m) ou nombre d'arbres × 30 m², divisé par 10 000 pour obtenir des ha. Pour les surfaciques : ha × coefficient.

| IAE | Unité | Coef. | Famille | Socle (CO) | Poids (CP) |
|---|---|---|---|---|---|
| Haie (largeur ≤ 20 m, arbustes obligatoires) | m lin. | 20 | ligneux | x | x |
| Alignement d'arbres (couronnes espacées de moins de 5 m) | m lin. | 10 | ligneux | x | x |
| Arbre isolé | arbre | 30 | ligneux | x | x |
| Bosquet (≤ 50 a) | m² | 1,5 | ligneux | x | x |
| Mare (≤ 50 a, hors bassin plastique ou béton et hors retenue d'irrigation) | m² | 1,5 | aquatique | x | x |
| Fossé non maçonné (≤ 10 m, hors fossé entretenu par la collectivité) | m lin. | 10 | aquatique | x | x |
| Mur traditionnel en pierres (larg. 0,1-2 m, haut. 0,5-2 m) | m lin. | 1 | rocheux | x | x |
| Bordure non productive (≥ 5 m, ou ≥ 1 m en lisière de forêt ; pour le CP, ≥ 1 m aussi en bordure de champ) | m lin. | 9 | herbager | x | x |
| Jachère (sans utilisation 1/03-31/08, sans phyto) | m² | 1 | herbager | x | x |
| Jachère mellifère (15/04-15/10) | m² | 1,5 | herbager | x | x |
| Zone humide (tourbière, roselière) | m² | 2 | aquatique | | x |
| Verger haute-tige (< 100 arbres/ha, sans phyto) | m² | 3 | ligneux | | x |
| Bande enherbée intra-parcellaire (≥ 1 m) | m lin. | 9 | herbager | | x |
| PP, landes, parcours en Natura 2000 | m² | 1,5 | herbager | | x |
| Zone herbacée mise en défens (5-10 m) | m lin. | 9 | herbager | | x |
| « Autres milieux » surfaciques (sans intrant ni labour depuis 5 ans) | m² | 1 | herbager | | x |
| « Autres milieux » linéaires (ruines : rocheux) | m lin. | 5 | rocheux/herbager | | x |

Règles complémentaires :
- **Adjacence** : élément porté par une terre arable (socle) ou par une parcelle de l'exploitation (poids), ou linéaire touchant la parcelle *par sa longueur*. Un linéaire adjacent à un autre linéaire lui-même adjacent est aussi compté.
- **Cumul** : interdit pour le socle (on retient l'IAE à la plus grande surface convertie) ; autorisé pour le poids, en déduisant la surface au sol de l'IAE portée (ex. jachère − mare).
- **Linéaire mitoyen** entre deux exploitations : ½ longueur pour le socle, longueur pleine pour le poids.
- **Exigences qualitatives** :
  - maintien des haies de moins de 10 m, des bosquets et mares ≤ 50 a ;
  - pas de taille ni de coupe d'arbres du 16/03 au 15/08 ;
  - **aucun traitement phyto (biocontrôle compris) ni fertilisant** sur l'IAE, sauf lutte obligatoire (L.251-3-1 CRPM) et déjections des animaux au pâturage dans certains cas.
- **Maîtrise** : l'exploitant doit avoir la maîtrise de l'entretien.
- **Contrôle** : plan parcellaire à échelle adaptée ; vérification terrain d'au moins 10 % de la surface convertie et d'au moins une IAE par famille. Un inventaire exhaustif n'est pas obligatoire (PdC4 §4.1.4 p.30).

### 2.2 Stratégie phytosanitaire (10 items, seuil ≥ 10)

Familles de cultures : grandes cultures et PT ; vigne ; arboriculture ; légumes, fruits hors arboriculture et PPAM ; horticulture et pépinière. Une exploitation multi-familles obtient : items communs + Σ (note de l'item spécifique × part de SAU de la famille). Exemple : 5 + 15×0,7 + 7×0,2 + 10×0,1 = 17,9 (PdC4 §5 p.39-40). La grille applique ce prorata **item par item** (Grille/Phyto!R383).

| Item | Famille | Formule | Barème | Source |
|---|---|---|---|---|
| **5.1 CMR** (max 2) | commun | **CMR1** : si au moins un produit classé CMR1 *à la date de l'utilisation* a été utilisé pendant la campagne, **l'indicateur phyto est invalidé, donc la certification refusée**, sauf dérogation par arrêté interministériel. **CMR2** : absence d'herbicide CMR2 = 1 point ; absence de produit non herbicide CMR2 = 1 point. | 0-2. Avec CMR1, tous les items phyto restent à 0 (« AUDIT NON VALIDE ») | PdC4 §5.1 p.40-41 ; Guide §2.4.1 ; Grille/Phyto!P22:P25, SYNTHESE!L45 |
| **5.2 Surfaces non traitées** (max 10) | commun | SAU sans aucun phyto hors biocontrôle (traitements obligatoires exceptés) / SAU. PP traitées localement : seule la surface traitée est exclue. Comptent aussi : (1) IAE « sous le seuil SAU » à leur surface réelle (bordures 1-5 m, bandes tampons 5-10 m, haies < 10 m, fossés et cours d'eau < 5 m), **contribution plafonnée à moins de 5 % de la SAU** ; (2) sans plafond : jachères (fixes, mellifères, faune sauvage, fleuries), vergers haute-tige, tourbières, alignements d'arbres, arbres agroforestiers et isolés. Pas de coefficient de pondération ici. | S ≤ 5 % : 0, puis +1 par tranche de 10 points (]5,15] = 1 … ]95,100] = 10). Grille : min(roundup(max(S−5 %,0)/10 %),10) | PdC4 §5.2 p.41-42 ; Grille!P55 |
| **5.3 IFT** (max 10 en GC/vigne, 6 en arbo, proratisés par la surface) | GC+PT, vigne, arboriculture | IFT **herbicides** et IFT **hors herbicides** (= fongicides-bactéricides + insecticides-acaricides + autres), calculés selon le guide méthodologique IFT **avec les services numériques du ministère** (API « Atelier de calcul de l'IFT »). Le **biocontrôle et le traitement de semences sont exclus** de la notation (mais calculés dans le bilan). Les PP sont exclues. Valeur retenue : IFT de la campagne n ou moyenne triennale (n, n-1, n-2) selon l'année du cycle (tableau p.43). | Pc = plancher (20e percentile), Pf = plafond (70e percentile, enquêtes SSP), x = (Pf−Pc)/4. **GC et vigne, par type** : IFT > Pf : 0 ; ]Pc+3x, Pf] : 1 ; ]Pc+2x, Pc+3x] : 2 ; ]Pc+x, Pc+2x] : 3 ; ]Pc, Pc+x] : 4 ; ≤ Pc : 5. **Arbo** : 0 / 0,6 / 1,2 / 1,8 / 2,4 / 3. Points × (surface de la famille / SAU). | PdC4 §5.3 p.42-47 ; Grille!H109:R112, M119:M124 |
| **5.4 Quantité de substances actives** (max 5, proratisé) | horticulture | P = kg de sa appliqués par an (hors biocontrôle). Fourchette Vpc-Vpf = Σ (fourchette annexe 4 en kg/ha/an × ha × durée en années) ; 1 an la 1re année, 2 ans la 2e, moyenne triennale ensuite. | x = (Vpf−Vpc)/4 ; P ≥ Vpf : 0 … P < Vpc : 5 ; × part horti/SAU | PdC4 §5.4 p.47-48, annexe 4 p.105 |
| **5.5 Surveillance active** (max 3) | commun | C1 outil de diagnostic précoce ou de modélisation du risque (pièges, modèles, kits, lecture du BSV tracée au cahier « vu BSV n°X ») = 1 point. C2 participation à une prospection collective (FREDON, GDON…) = 1 point. C3 observateur pour le BSV sur des cultures représentant > 50 % des cultures annuelles ou > 75 % des pérennes (prairies exclues) = 2 × (surface représentée / SAU). | plafond 3 | PdC4 §5.5 p.48-51 ; Grille!R199:R200 |
| **5.6 Méthodes alternatives** (max 3 hors horti, 6 en horti) | vigne, horti, autres | % SAU où au moins une méthode physique (matériel de l'annexe 5) ou de biocontrôle **a remplacé** un traitement chimique, notée au cahier. Inter-rang seul (vigne, arbo, maïs, betterave, tournesol, colza, PdT) : 2/3 de la surface. Cultures courtes : prorata de la durée (ex. 4 mois sur 12 = 1/3). | Hors horti : < 25 % : 0 ; [25 ; 37,5[ : 1 ; [37,5 ; 50[ : 1,5 ; [50 ; 62,5[ : 2 ; [62,5 ; 75[ : 2,5 ; ≥ 75 % : 3. Horti : < 25 % : 0 ; 25-50 : 2 ; 50-75 : 4 ; ≥ 75 : 6. Pondéré par les parts de SAU. | PdC4 §5.6 p.51-52 ; Grille!P239:P242 |
| **5.7 Limitation des fuites** (max 2) | commun | Nombre d'équipements de l'annexe 6 (aire de remplissage, buses anti-dérive, coupure de tronçons GPS, PerformancePulvé classes 1-3…). Un équipement compte seulement s'il équipe **tous** les appareils de la famille. | 1 point par équipement, plafond 2 | PdC4 §5.7 p.52-53, annexe 6 p.108-109 |
| **5.8 Diversité spécifique et variétale** (vigne max 2, autres max 6, pondéré) | vigne, arbo, légumes/fleurs/fruits pleine terre, hors sol | Vigne : clones (1 : 0, 2 : 1, ≥ 3 : 2 ; cépages si ≥ 3 ; sélection massale de plus de 3 individus). Autres : par espèce, 2 variétés = 1, ≥ 3 = 2, plafond 6 par type. | Grille : min(n2 + 2·n3, 6) × part de SAU | PdC4 §5.8 p.53-54 ; Grille!L275:L299 |
| **5.9 Couvert inter-rang** (max 3, pondéré) | vigne, arbo et pérennes, horti pleine terre | % de l'inter-rang couvert toute la campagne (sol nu toléré pendant la levée d'un resemis, sauf du 1/11 au 1/03). **Aucune destruction chimique.** | < 50 % : 0 ; [50,75[ : 1 ; [75,100[ : 2 ; 100 % : 3 | PdC4 §5.9 p.54-55 |
| **5.10 Recyclage des eaux d'irrigation** (hors sol) | légumes hors sol ; horti hors sol | Hors horti : volume recyclé et traité / volume utilisé. Horti : surfaces équipées (système total ou partiel) / surface hors sol. | Hors horti : 1 point par tranche de 10 % (]0,10] = 1 … ]90,100] = 10). Horti total : 25-50 : 2 ; 50-75 : 4 ; ≥ 75 : 6. Partiel : 1/2/3. × part de SAU | PdC4 §5.10 p.55-57 |

**Références IFT** (PdC4 p.43-46 ; Grille/Scoring_GC, Scoring_Viticulture, Scoring_Arboriculture) :
- **Grandes cultures** : plancher et plafond par **ancienne région administrative** (ex. Alsace : herbicides 1-1,7, hors herbicides 0,26-1,15). Deux échelles coexistent depuis le 12/07/2024 : « en cours » (enquêtes 2014/2017/2021) et « ancienne ». L'ancienne est admise pour les exploitations déjà certifiées V4 jusqu'à la fin de la campagne 2025 (Grille!J109). L'échelle choisie doit être déclarée.
- **Pomme de terre** : références recalées sur sa part dans l'assolement, par exemple Pc = 0,8×1,55 + 0,2×13,46. L'IFT de l'exploitation est pondéré de la même façon.
- **Vigne** : références par **bassin viticole** du département du siège, avec des cas particuliers (07/26 nord/sud, 69/71 Beaujolais) et une correction manuelle possible (Grille v1.14).
- **Arboriculture** : moyenne régionale pondérée par la composition du verger (jusqu'à 15 espèces dans Surfaces!145-159).
- Moyennes pluriannuelles : les plafonds et planchers sont recalculés avec les assolements n-1 et n-2.
- **Contrôle** : bilans IFT édités par le logiciel ou l'Atelier IFT acceptés sans recalcul si la **signature électronique** du bilan ou des IFT unitaires est valide et si le bilan est cohérent avec le cahier (PdC4 §5.3.4 p.47).

### 2.3 Gestion de la fertilisation (9 items, seuil ≥ 10)

| Item | Formule | Barème | Source |
|---|---|---|---|
| **6.1 Bilan azoté** (max 8, corrigé des cultures mineures) | **BGA ou bilan apparent**, au choix, en **azote total** (et non efficace), ramené à l'ha de SAU. Campagne n, ou moyenne sur 2 ou 3 campagnes, avec la même méthode sur toutes. Cultures « principales » = celles présentes dans la table ministérielle des exportations. Les cultures « mineures » sont exclues, ou incluses avec export nul si l'exploitant le choisit. Fixation symbiotique et dépôts atmosphériques non comptés. Engrais foliaires comptés. | **Bilan apparent ET OTEX herbivore** (4500, 4600, 4700, 4810, 4820, 4830, 4840, 8320, 8330, 8340, 8420) : B > 90 : 0 ; ]70,90] : 2 ; ]50,70] : 4 ; ]30,50] : 6 ; ≤ 30 : 8. **Tous les autres cas** (dont la BGA) : B > 50 : 0 ; ]40,50] : 2 ; ]30,40] : 5 ; ]20,30] : 7 ; ≤ 20 : 8. Si cultures mineures ≥ 5 % de SAU : note × (1 − part mineure). | PdC4 §6.1 p.58-68 ; Grille/Fertilisation!AD55, AF55, P64 |
| **6.2 Quantité d'azote** (horti, max 5, proratisé) | F = kg N/an ; fourchette de l'annexe 4 × ha × durée ; même logique que 5.4 | F ≥ Vpf : 0 … F < Vpc : 5 ; × part horti/SAU | PdC4 §6.2 p.68-69 |
| **6.3 Part de l'azote organique** (max 4) | N organique total / N total apporté sur la SAU (minéral + organique ; part organique des organo-minéraux au numérateur, N total au dénominateur). N organique = Q1 (production des animaux) − Q2 (effluents cédés) − Q3 (abattu par traitement) + Q4 (effluents de tiers) + Q5 (autres engrais organiques). Restitutions au pâturage incluses. | < 25 % : 0 ; [25,35[ : 1 ; [35,45[ : 2 ; [45,55[ : 3 ; ≥ 55 % : 4 | PdC4 §6.3 p.69-71 ; Grille!P122 (saisie en t N) |
| **6.4 OAD** (principales max 3, mineures max 7) | **GC** : PPF = 1 ; + PPF Aj sur ≥ 50 % de la surface GC principale = 1 ; + ODP sur ≥ 50 % = 1 ; ou OPI = 3 × (surface de blé sous OPI / surface GC principale). **Prairies** : PPF = 1. **Vigne, arbo, maraîchage** (si ≥ 50 % de la surface) : PPF 1,5 × part ; PPF Aj ou ODP 1,5 × part. Plafond 3. **Cultures mineures** (si ≥ 5 % de SAU) : % sous PPF Aj ou ODP ≤ 30 : 0 ; ]30,40] : 1 … ]90,100] : 7 ; + 1 si PPF sur plus de 50 % ; plafond 7. Note globale [bilan + OAD] = (1−S)(bilan + OAD principales) + S × OAD mineures. Liste des OAD : COMIFER. Analyse de sol valable 5 ans. | | PdC4 §6.4 p.71-73 ; Grille!P168:P191 |
| **6.5 % SAU non fertilisée** (max 10) | Herbe et cultures sans aucun apport azoté (minéral, organique, effluent, compost), hors déjections des animaux au pâturage, / SAU | S ≤ 5 % : 0, puis +1 par tranche de 10 points, jusqu'à 10 | PdC4 §6.5 p.74 ; Grille!L215 |
| **6.6 Légumineuses** (max 4) | % de SAU en protéagineux, légumes secs (soja compris), prairies artificielles de légumineuses, mélanges avec légumineuses, PT en mélange complexe, inter-rang en légumineuses (sans destruction chimique). **Exclus** : légumineuses récoltées en vert (petit pois, haricot vert…), interculture, oléagineux hors soja, PP. | < 5 % : 0 ; [5,10[ : 2 ; [10,15[ : 3 ; ≥ 15 % : 4 | PdC4 §6.6 p.74-75 ; Grille!P243 |
| **6.7 Couverture des sols** (max 4 en terres arables, 3 en pérennes, pondéré) | **Hors pérennes**, socle obligatoire : la durée réglementaire de couvert est respectée sur **100 %** de la surface (hors zone vulnérable : BCAE 6, 6 semaines entre le 1/09 et le 30/11 ; en ZV : PAN/PAR), sinon 0. Couvert sans discontinuité. Couverts admis : culture d'automne ou d'hiver, prairie, CIPAN ou dérobée sans engrais minéral, repousses de colza, repousses de céréales (≤ 20 % de l'interculture longue), légumineuses en mélange, cannes de maïs ou sorgho broyées et enfouies. **Pérennes et horti** : % d'inter-rang couvert (comme 5.9). | **Hors ZV** (100 % à 6 semaines au minimum) : 7 sem. 0,5/1 ; 8 sem. 1/2 ; 9 sem. 1,5/3 ; ≥ 10 sem. 2/4. **ZV** : 9 sem. 0,5/1 ; 10 sem. 1/2 ; 11 sem. 1,5/3 ; ≥ 12 sem. 2/4. Dans chaque paire, la 1re valeur vaut pour 75 % ≤ C < 100 %, la 2e pour C = 100 %. Inter-rang : 50-75 : 1 ; 75-100 : 2 ; 100 % : 3. Moyenne pondérée par la SAU. | PdC4 §6.7 p.75-78 ; Grille!AI288:AJ289, Q300 |
| **6.8 Matériels optimisant les fertilisants** (horti, max 6) | % de surface horti avec engrais à libération lente ou solution fertilisante localisée | 25-50 : 2 ; 50-75 : 4 ; ≥ 75 : 6 ; × part de SAU | PdC4 §6.8 p.79 |
| **6.9 Recyclage des eaux** (hors sol, max 6) | surfaces équipées / surface hors sol | total 2/4/6, partiel 1/2/3 ; × part de SAU | PdC4 §6.9 p.79-80 |

**Détail du bilan azoté**

*BGA* (PdC4 p.60-63 ; outil BGA) :
- **Formule** : E1 + E2 − S1, puis + E3.
- **E1** = E1.1 + E1.2 − E1.3, avec :
  - E1.1 = Σ effectif × norme N/animal (arrêté du 19/12/2011 modifié, PAN) × mois de présence / 12 ;
  - E1.2 = Σ effluents importés × teneur ;
  - E1.3 = Σ effluents exportés × teneur.
- **E2** = autres organiques et organo-minéraux importés (quantité × teneur).
- **E3** = Σ engrais minéraux (quantité × teneur).
- **S1** = S1.1 (cultures non fourragères) + S1.2 (fourragères hors herbe) + S1.3 (herbe), avec :
  - S1.1 et S1.2 dans l'outil (onglet S2) : quantité récoltée (t) × MS réelle / MS de référence × teneur N (kg/t à MS de référence) ; référentiel **COMIFER 2013** intégré (organes grain et paille, légumes, fruits, vergers, porte-graines…) ;
  - S1.3 : herbe fauchée (t MS × teneur) + herbe pâturée par **bilan fourrager** : besoins = 5 t MS × UGB, moins les fourrages consommés hors pâturage (stocks, ou rendements × surface ± achats et ventes, avec abattement de 20 % sur les rendements au champ), puis × 30 (rotation rapide) ou 25 (rotation lente) kg N/t MS.
- **Paille** recyclée en fumier : comptée comme exportation.
- **Transhumance collective** : rejets au prorata du temps passé sur l'exploitation.

*Bilan apparent* (PdC4 p.63-65 ; outil BA) :
- **Entrées** :
  - E1 = organiques importés ;
  - E2 = aliments, fourrages et paille achetés (t × MS × N/t MS ; protéines × 16 %) ;
  - E3 = animaux achetés (nombre × poids × teneur, annexe 7 : 24 kg N/t de poids vif chez les bovins…) ;
  - E4 = engrais minéraux.
- **Sorties** :
  - S1 = effluents vendus ou donnés ;
  - S2 = cultures vendues ou cédées ;
  - S3 = animaux vendus ;
  - S4 = lait (litres × TP en g/L / 1000 / C, avec C = 6,06 pour la vache et la brebis, 5,74 pour la chèvre), produits laitiers, œufs.
- **Formule** : (E1+E2+E3) − (S1+S2+S3+S4) + E4, ramené à l'ha de SAU.
- **Teneurs par défaut** :
  - effluents : annexe 8, ou bordereaux, ou analyses ; digestats seulement sur analyse ;
  - minéraux et organo-minéraux : étiquette (NF U42-001) ;
  - aliments et fourrages : annexe 9 ;
  - UGB : annexe 10.
- **Contrôle** (PdC4 §6.1.5) : méthode, OTEX (justifiée, éventuellement par un chiffre d'affaires des ateliers herbivores ≥ 2/3), complétude des postes, cohérence avec le cahier de fumure et la comptabilité.

### 2.4 Gestion de l'irrigation (8 items, seuil ≥ 10)

**Exploitation non irrigante : indicateur validé d'office**, après vérification qu'il n'y a pas de matériel d'irrigation (PdC4 §7 p.81 ; Grille/SYNTHESE!L47 « Sans objet »).

| Item | Formule | Barème | Source |
|---|---|---|---|
| **7.1 Enregistrement** (max 6) | Par apport : **7 données** (date et période étiage ou non, volume estimé, surface, mode, matériel, origine de l'eau, facteur déclenchant). Par parcelle : **5 données** (culture, variété tolérante ou non, date de semis, autres pratiques d'économie d'eau, rendement). N = 7A + 5P ; R = données manquantes / N. Un « apport » = une programmation homogène. Le pilotage informatisé en hors-sol tient lieu d'enregistrement. Sans calcul possible des apports : 0 point. | R < 10 % : 6 ; [10,20[ : 4 ; [20,30[ : 2 ; ≥ 30 % : 0 | PdC4 §7.1 p.81-82 ; Grille!M51 |
| **7.2 Outils de mesure** (max 2) | Offre (tensiomètres, sondes capacitives, TDR, capteurs, station météo connectée…) = 1 ; demande (ETP, potentiel hydrique, apex, dendromètre) = 1 ; OAD mixte = 2. Pluviomètre et bulletins exclus. Horti : % de surface pilotée 50-75 : 1 ; ≥ 75 : 2. | plafond 2 | PdC4 §7.2 p.82-83 |
| **7.3 Matériels optimisant** (max 6) | SAU irriguée équipée (télégestion, goutte-à-goutte, basse pression, modulation…) / SAU irriguée | < 25 : 0 ; 25-50 : 2 ; 50-75 : 4 ; ≥ 75 : 6 | PdC4 §7.3 p.83-84 |
| **7.4 Démarche collective** (max 2) | Adhésion à une gestion collective de la ressource | 2 | PdC4 §7.4 p.84 |
| **7.5 Pratiques économes** (max 6) | SAU irriguée avec couverture estivale, non-labour ou TCS, paillage, densité réduite, porte-greffes, variétés tolérantes (enregistrées par un institut) / SAU irriguée | < 25 : 0 ; 25-50 : 2 ; 50-75 : 4 ; ≥ 75 : 6 | PdC4 §7.5 p.84-85 |
| **7.6 Prélèvements en étiage** (max 5) | Prélèvements directs dans le milieu en **juin, juillet, août** / tous les prélèvements de la campagne, remplissage des retenues compris (l'eau stockée hors étiage n'est pas comptée en étiage) | ≥ 90 % : 0 ; [80,90[ : 1 ; [60,80[ : 2 ; [40,60[ : 3 ; [20,40[ : 4 ; < 20 % : 5 | PdC4 §7.6 p.85-86 ; Grille!AC190 |
| **7.7 Recyclage** (horti hors sol, max 6) | identique à 5.10 horti | × part de SAU | PdC4 §7.7 |
| **7.8 Eaux de pluie** (hors sol, max 1) | Dispositif de récupération présent et utilisé | 1 × part du hors-sol dans la SAU | PdC4 §7.8 |

Contrôle 7.1 : la somme des volumes du cahier doit être cohérente avec le volume prélevé (compteurs).

---

## 3. Option B (V3 2016, obsolète en V4)

Source : PdC3, annexe « arrêté du 20/06/2011 », partie II, p.77-78. Deux indicateurs doivent être respectés :

| Indicateur | Seuil |
|---|---|
| % de la SAU en IAE (particularités topographiques de l'art. D.615-50-1 CRPM, version 2011) **ou** % de la SAU en prairies permanentes de plus de 5 ans | ≥ 10 % **ou** ≥ 50 % |
| **Poids des intrants dans le chiffre d'affaires** = coût des intrants / CA | **≤ 30 %** : 1 an la 1re année, 2 ans la 2e, moyenne triennale glissante ensuite |

**Intrants inclus** :
- eau, gaz, électricité, eau d'irrigation ;
- fournitures non stockées ;
- transport sur achats et ventes ;
- approvisionnements : semences, engrais, amendements, phytos, produits vétérinaires, aliments grossiers et concentrés achetés, carburants et lubrifiants, combustibles, fournitures stockées ;
- prestations liées aux carburants, phytos et fertilisants ; carburant forfaitaire de **30 L/ha**.

**Intrants exclus** : main-d'œuvre, amortissements, variations de stock (sauf choix documenté de l'exploitant), intra-consommations, entraide.

**CA inclus** : ventes, variations de stock, production immobilisée, produits annexes (travaux à façon, pensions, locations, agritourisme…), **moins les achats d'animaux**.

**CA exclus** : subventions, impôts et taxes (accises comprises), intra-consommation, autoconsommation.

En V4, aucun indicateur économique n'existe. Le chiffre d'affaires n'intervient qu'au contrôle de l'OTEX herbivore du bilan apparent (≥ 2/3 du CA, PdC4 §6.1.5).

Pour mémoire, l'ancienne **option A V3** différait de V4, par exemple : IAE ≥ 4 % puis +2 points par point de %, pas d'item CMR, item « MAE », OAD de type I et II (PdC3 annexe arrêté 2016 p.80-84). Elle n'est plus applicable aux nouveaux audits.

---

## 4. Liste CMR

**Contenu** (fichier du 04/09/2026, « établie à partir de la base E-Phy téléchargée le 04/09/2026 »).
- Une ligne par **nom commercial**. Colonnes :
  - A Nom du produit ;
  - **B N° d'autorisation** (propre au produit : PCP, etc.) ;
  - **C N° AMM** (AMM du produit de référence) ;
  - D Type (AMM, Second nom, PCP = permis de commerce parallèle) ;
  - E Substances actives et concentrations (séparées par « | ») ;
  - F Fonctions (Herbicide, Fongicide, Insecticide…, combinées par « | ») ;
  - **G « CMR1 » ou « CMR2 »** ;
  - H Nom du produit de référence associé ;
  - I Statut AUTORISE/RETIRE ;
  - J date de 1re autorisation ;
  - K date de retrait (dates au format série Excel ; « NA » si aucune).
- Une couleur signale les lignes nouvelles ou modifiées (non exploitable en données).
- 2 482 lignes : 2 258 CMR2 et 224 CMR1 ; 1 528 autorisées et 954 retirées ; **759 AMM distinctes et 1 560 n° d'autorisation distincts**.
- Pour les Second nom et AMM, B = C ; pour les PCP, B ≠ C.
- **Seuls 7 produits CMR1 sont encore autorisés** : 8-hydroxyquinoléine (BELTANOL-L, V-NOL), halosulfuron-méthyl (PERMIT), flurochloridone (RACER ME, FLUO 250 CS, RIDER, BUDGET FLUROCHLORIDONE). Substances CMR1 les plus fréquentes : époxiconazole, diméthomorphe, pyraclostrobine.
- Le classeur contient **3 onglets datés** : 04/09/26 (2 482 lignes), 21/10/25 (2 307) et 29/10/24 (2 301). Le classement est publié **au niveau du produit**, pas de la substance.

**Usage dans l'audit** (PdC4 §5.1 ; Guide §2.4.1 ; Grille/Phyto!L11-M23) :
- **Item 5.1, CMR1** : condition éliminatoire. Un seul usage d'un produit classé CMR1 « à date de l'utilisation » pendant la campagne invalide l'indicateur phyto, donc l'audit, sauf arrêté de dérogation dont les références sont saisies dans la grille.
- **CMR2** : ce n'est pas une pénalité mais une perte de points (1 point pour les herbicides, 1 point pour les autres).
- **Vérification** : cahier d'enregistrement phyto, étiquettes, factures d'achat.
- Pour l'auditeur, la grille se résume à trois listes déroulantes Oui/Non. Le calcul est à la charge de l'exploitant ou de son logiciel.

---

## 5. Points de contrôle documentaires (pièces à présenter)

Synthèse de PdC4 (§2.1.1 : « L'exploitant doit préparer, avant la date de l'audit, l'ensemble des documents ») :

| Pièce | Items | Source |
|---|---|---|
| Registre parcellaire PAC (RPG, surfaces graphiques), baux, titres, CVI, **plan parcellaire** avec les IAE localisées à une échelle adaptée | périmètre, 4.1-4.4, 6.6 | §4.1.4, §4.2.4 |
| Justificatifs des cultures et IAE plus en place le jour de l'audit (factures de semences, ventes, documents techniques, jachères mellifères) | 4.1, 4.3, 4.4, 4.7 | §4 p.26, §4.1.4 |
| **Cahier d'enregistrement des pratiques phytosanitaires** : îlot ou parcelle, culture, produit, dose ou quantité, surface traitée, PP comprises ; méthodes alternatives (méthode, matériel, parcelle, culture, surface) ; mention « vu BSV n°X » | 4.1 (IAE non traitées), 5.1, 5.2, 5.3, 5.5, 5.6 | §5.2.4, §5.6.3 |
| Bilans IFT **signés électroniquement** (Atelier IFT ou logiciel connecté), par campagne | 5.3 | §5.3.4 |
| Étiquettes et factures des PPP | 5.1 | §5.1.2 |
| Factures, contrats de prestation ou d'entraide pour les matériels (annexes 5 et 6), inventaire des pulvérisateurs | 5.6, 5.7 | §5.7.3 |
| Attestations FREDON/GDON, animateur BSV, abonnements à des OAD, relevés de pièges | 5.5 | §5.5.3 |
| Liste des parcelles pérennes avec la modalité d'enherbement et le type de couvert | 5.9, 6.7 | §5.9.3 |
| **Cahier d'enregistrement de la fertilisation / cahier d'épandage**, comptabilité (bons de livraison, factures d'engrais) | 4.1, 6.1, 6.3, 6.5 | §6.1.5, §6.3.4, §6.5.3 |
| **Bordereaux d'échange d'effluents cosignés** par le donneur et le receveur ; analyses d'effluents et de digestats | 6.1, 6.3 | §6.3.4 |
| Effectifs animaux (registres bovins, ovins…), production laitière, temps passé dehors par les vaches laitières | 4.5, 6.1, 6.3 | §4.5.4, §6.3.4 |
| Justificatif d'OTEX (si bilan apparent) | 6.1 | §6.1.5 |
| Sorties d'OAD de fertilisation (PPF, ajustement, pilotage), analyses de sol de moins de 5 ans | 6.4 | §6.4.3 |
| Justificatifs de localisation en ZV et de la durée PAN/PAR | 6.7 | §6.7.3 |
| Récépissé CERFA 13995 de déclaration des ruches | 4.6 | §4.6.2 |
| Accusé de réception OPVT (test bêche) ou compte rendu de laboratoire (biomasse microbienne) | 4.8 | §4.8.3 |
| Attestation de l'organisme de sélection (races menacées), factures de semences (variétés menacées) | 4.7 | §4.7.4 |
| **Cahier d'enregistrement de l'irrigation** (12 données), volumes prélevés (compteurs) | 7.1, 7.6 | §7.1.3, §7.6.3 |
| Enregistrements des mesures et OAD d'irrigation, attestation d'adhésion à une démarche collective, preuves de tolérance variétale | 7.2-7.5 | §7.2.3-7.5.3 |
| Identification pour la grille et Certibase : date d'audit, cadre, type d'audit, OC, auditeur, campagne, durée, raison sociale, SIRET (14 chiffres) ou CVI (10), CP, commune, accord annuaire, statut juridique, activité principale, OTEX | toutes | Guide §2.2.1 |

---

## 6. Rapprochement avec Fourmy

Légende : **Oui** = donnée présente et exploitable ; **Part.** = présente mais incomplète ou sans la sémantique HVE ; **Non** = absente. La colonne « manque » sépare la saisie (S), le référentiel (R) et le calcul (C).

### 6.0 Socle commun
| Besoin | Fourmy | Manque |
|---|---|---|
| Campagne HVE de 12 mois paramétrable (exercice comptable) | Part. (campagnes culturales) | C : période d'audit libre, identique pour tous les indicateurs ; gestion n, n-1, n-2 |
| SAU, surface totale de l'exploitation (SNE, SNA, ZDH) | Part. (parcelles, îlots PAC) | S : SNE, SNA, ZDH (bâtiments, chemins…) ; C : surface **réelle** et non développée |
| Classement des surfaces (terres arables, PP, PT ≤ 5 ans, jachères ≤ 5 / ≥ 6 ans, codes TA/PP de l'IT 2024-482) | Part. (codes PAC importés) | R : correspondance code PAC → catégorie de l'onglet Surfaces (≈ 60 lignes) ; C : âge des prairies et jachères |
| Familles HVE (GC, vigne, arbo, légumes/PPAM, horti ; pleine terre, abri, hors sol) | Part. (Lexicon) | R : correspondance culture → famille ; S : hors sol, sous abri |
| Zone vulnérable nitrates, département, région, bassin viticole | Part. (géométrie) | R : couches ZV et bassins viticoles ; correspondance département → ancienne région |
| OTEX, SIRET, CVI | Part. (SIRENE présent) | S : OTEX, CVI |

### 6.1 Biodiversité
| Item | Données nécessaires | Fourmy | Manque |
|---|---|---|---|
| 4.1 IAE | inventaire typé (17 types), longueur, surface ou nombre, adjacence à une terre arable ou à une parcelle, mitoyenneté, absence d'intrant, respect du maintien et de la période de taille, maîtrise de l'entretien, famille | **Part.** : `farm_landscape_features` (haies, arbres isolés, alignements, bosquets, mares, fossés, murs, bandes) + BD TOPO | R : coefficients et familles de l'annexe 2 ; S : types absents (zones humides, verger haute-tige, bande intra-parcellaire, zone mise en défens, Natura 2000, autres milieux, jachère mellifère vs jachère) ; C : adjacence géométrique « par la longueur », ½ longueur pour le socle, dédoublonnage (socle : max ; poids : déduction), tests de dispense ; S : attestations qualitatives (pas de taille du 16/03 au 15/08, pas d'intrant) |
| 4.2 Taille des parcelles | unités culturales, espèce, fusion des parcelles contiguës de même espèce sauf IAE linéaire séparatrice | **Part.** (géométries datées) | C : fusion topologique par espèce et coupure par IAE |
| 4.3 Culture principale | surfaces par espèce, PT par tranches de 10 %, mélanges, cultures successives | **Part.** (productions, espèces) | C : règles de tranches et de division des successions |
| 4.4 Nb d'espèces | espèces semées (mélanges détaillés), dérobées et CIPAN, type de mélange prairial | **Part.** (couverts avec famille, cultures) | S : composition spécifique des mélanges et couverts ; R : graminée ou légumineuse |
| 4.5 Espèces animales | espèces élevées et finalité | **Non** | S : atelier élevage (au minimum espèces et effectifs) |
| 4.6 Ruches | nombre, sédentarité, parcelles | **Non** | S |
| 4.7 Menacées | variétés (annexe 3 par région), races (arrêté 2015) | **Non** (variété peut-être présente sur les semences) | R : annexe 3 et arrêté races ; C : contrôle par région |
| 4.8 Sol | test bêche (date, accusé OPVT) ou analyse microbiologique | **Non** | S : pièce justificative datée, validité 3 ans |

### 6.2 Stratégie phytosanitaire
| Item | Données | Fourmy | Manque |
|---|---|---|---|
| 5.1 CMR | interventions phyto (n° AMM et n° d'autorisation, date), classement CMR1/2 **à la date d'utilisation**, fonction herbicide ou non | **Part.** : AMM + E-Phy ; classement CMR « ? » | R : import de la liste ministérielle (clé = **n° d'autorisation, col. B**, et non l'AMM de référence col. C, pour les PCP) et **historisation** des versions ; C : contrôle éliminatoire CMR1, points CMR2 herbicides / autres ; S : référence de l'arrêté de dérogation |
| 5.2 Surfaces non traitées | parcelles sans phyto hors biocontrôle, traitements obligatoires, traitements localisés sur PP (surface traitée), IAE non traitées (surface réelle, plafond 5 %) | **Part.** (interventions, surfaces) | R : marqueur biocontrôle (liste L.253-5/7 DGAL) ; S : traitement obligatoire ou localisé ; C : agrégation et plafond |
| 5.3 IFT | IFT H et HH par campagne, hors biocontrôle et semences, signatures, assolement n-2…n, références Pc/Pf par région, bassin ou verger | **Part.** : IFT via l'API du ministère | C : bilan HVE (catégories séparées, moyenne 1-3 ans, pondération PdT et familles) ; R : tables Scoring_GC, Viti et Arbo (en cours et ancienne) ; stockage des **signatures** |
| 5.4 Quantité de sa (horti) | kg de sa par produit (dose × concentration), durées de culture mensuelles | **Part.** (dose, AMM) | R : concentrations en sa (E-Phy) ; S : surfaces horti mensuelles ; R : annexe 4 |
| 5.5 Surveillance | outils de diagnostic, BSV consulté, prospection, observateur BSV et surface représentée | **Non** | S (oui/non + justificatifs) |
| 5.6 Méthodes alternatives | interventions mécaniques ou biocontrôle remplaçant un traitement, inter-rang, durée de culture | **Part.** (interventions de travail du sol possibles) | R : annexe 5 (matériels) ; S : drapeau « remplace un traitement », inter-rang |
| 5.7 Fuites | inventaire des équipements de tous les pulvérisateurs | **Non** | S + R annexe 6 |
| 5.8 Diversité variétale | variétés, clones ou cépages par espèce | **Part.** (semences ou plants ?) | S : variété ou clone sur les pérennes |
| 5.9 Inter-rang | modalité d'enherbement, largeur, continuité, destruction | **Non** | S |
| 5.10 Recyclage | volumes recyclés ou surfaces équipées hors sol | **Non** | S |

### 6.3 Fertilisation
| Item | Données | Fourmy | Manque |
|---|---|---|---|
| 6.1 BGA | apports minéraux (quantité × %N), organiques (N total), effluents produits (effectifs × normes PAN × durée), importés et exportés, rendements par organe (grain/paille, MS), herbe fauchée et pâturée (UGB, stocks) | **Part.** : fertilisants N/P/K, récoltes, bilan azoté, PPF, cahier | R : table ministérielle des exportations (+ COMIFER 2013 de l'outil), normes PAN par animal, annexes 8-10 ; S : élevage, paille exportée, teneur en MS ; C : distinction culture principale / mineure, méthode HVE en **N total** (vérifier que le bilan Fourmy n'est pas en N efficace ou en bilan prévisionnel), moyenne pluriannuelle, correction mineures, barème selon méthode et OTEX |
| 6.1 Bilan apparent | achats d'aliments, fourrages, paille, animaux ; ventes de cultures, animaux, lait (TP), œufs, effluents | **Non** (hors récoltes) | S : flux d'achats et de ventes (comptabilité) |
| 6.2 N horti | kg N, surfaces horti mensuelles | Part. | S, R annexe 4 |
| 6.3 % N organique | N organique et minéral apporté, part organique des organo-minéraux, restitutions au pâturage | **Part.** | R : N organique / minéral des produits ; S : pâturage |
| 6.4 OAD | type d'OAD (PPF, PPF Aj, ODP, OPI) par surface, liste COMIFER | **Part.** (PPF Fourmy = outil PPF ? à faire reconnaître) | R : liste COMIFER ; S : OAD utilisés |
| 6.5 SAU non fertilisée | parcelles sans aucun apport N | **Oui** (dérivable des interventions) | C |
| 6.6 Légumineuses | surfaces de légumineuses éligibles, mélanges, inter-rang | **Part.** (espèce Lexicon) | R : famille fabacées + exclusions (récolte en vert, interculture, oléagineux hors soja) |
| 6.7 Couverture des sols | dates de récolte et semis, couverts (dates, type), destruction (mécanique ou chimique), ZV, durée PAN/PAR | **Part.** : couverts d'interculture (dates, famille) | C : durée continue en semaines par parcelle, socle 100 % ; R : ZV et PAR ; S : repousses (colza, céréales ≤ 20 %), cannes broyées, mode de destruction |
| 6.8, 6.9 | horti, hors sol | Non | S |

### 6.4 Irrigation
| Item | Données | Fourmy | Manque |
|---|---|---|---|
| Exploitation irrigante | oui/non, absence de matériel | Part. | S |
| 7.1 Enregistrement | par apport : date ou période, volume, surface, mode, matériel, origine, déclencheur ; par parcelle : culture, variété tolérante, date de semis, pratiques, rendement | **Part.** : dose (mm) et volumes ; culture, semis, rendement | S : mode, matériel, origine de l'eau, déclencheur, tolérance de la variété ; C : taux de complétude R = M/N |
| 7.2-7.5 | outils, matériels (surface équipée), démarche collective, pratiques économes | **Non** | S |
| 7.6 Étiage | volumes prélevés par date, distinction prélèvement direct / retenue | **Part.** (volumes datés) | S : origine (retenue remplie hors étiage) ; C : part juin-août |
| 7.7, 7.8 | hors sol | Non | S |

### 6.5 Certification et sorties
| Besoin | Fourmy | Manque |
|---|---|---|
| Certification HVE par ferme et par parcelle (dates, organisme) | **Oui** | type d'audit (initial, suivi, renouvellement), cadre individuel ou collectif, n° de certificat |
| Pré-remplissage de la **grille d'audit v1.15** (onglets Surfaces, Biodiversité, Phyto, Fertilisation, Irrigation) | Non | C : export vers le format de la grille ; **ne pas modifier sa structure** (import Certibase) |
| Ligne « Synthese_coll » (structures collectives) | Non | optionnel |

---

## 7. Ambiguïtés et questions ouvertes

*Mise à jour du 19/11/2026 après lecture de la FAQ, de la table des exportations et du plan V4 de 2022 (§8), et intégration des décisions de l'utilisateur.* Statuts : **Résolu** (une source tranche), **Tranché** (décision de l'utilisateur, sans source qui tranche), **Partiel**, **Ouvert**.

Décisions de l'utilisateur, à appliquer sans les rediscuter :
- quand la grille d'audit v1.15 diverge du plan, Fourmy suit la grille à la lettre ;
- option A (référentiel V4) seule ;
- questionnaire annuel pour les items déclaratifs ;
- la liste CMR ministérielle et les mentions de danger E-Phy sont censées concorder.

**Écarts entre le plan V4.4 et la grille v1.15**
1. **IAE, poids, borne à 4 %** : le plan exige un socle ≥ 4 %, mais la formule de la grille (Biodiversité!W53) donne les points seulement si le socle est > 4 % (strict). La grille trouve donc 0 point quand le socle vaut exactement 4 %.
   → **Tranché** : Fourmy applique la grille (> 4 %). La FAQ ne traite pas ce cas.
2. **Surfaces non traitées** : le plan *plafonne* la contribution des IAE sous le seuil SAU (« moins de 5 % de la SAU »). La grille (Phyto!P55) met **l'item à 0** si la saisie dépasse 5 % de la SAU.
   → **Tranché** : grille. La FAQ (Q133 p.43, Q148 p.45) ne parle pas du dépassement. Pour l'item 6.5, la FAQ parle bien d'un plafond, et non d'une mise à 0 (Q229 p.65 : « plafonné à 5 % »).
3. **Culture principale, 100 % PP** : le plan dit « poids = 0 », ce qui donne 5 points selon le barème. La grille (Q112) renvoie 0 point si PP = 100 %. Elle exige aussi la saisie de la surface de la culture principale.
   → **Tranché** : grille. La FAQ ne traite pas ce cas.
4. **Correction des cultures mineures** : le plan la déclenche si la part est « au moins 5 % » ; la grille seulement si elle dépasse 5 % (Fertilisation!M62). Même écart pour l'OAD des cultures mineures.
   → **Tranché** : grille. La FAQ ne traite pas ce cas.
5. **Numéros d'annexe** : la grille renvoie aux « annexes 6 et 7 » pour les matériels, le plan V4.4 aux annexes 5 et 6.
   → **Résolu** : la grille et la FAQ (Q172 p.51, Q196 p.56, Q202 p.56) gardent la numérotation du **plan de 2022**. Celui-ci avait une annexe 3 « races menacées », supprimée en V4.4, si bien que les annexes suivantes ont toutes été renumérotées (§8.3). Dans Fourmy, citer les annexes par leur titre plutôt que par leur numéro.
6. **Couverture des sols en ZV** : la grille note sur des durées absolues (9 à 12 semaines). Que faire si un PAR impose plus de 9 semaines ?
   → **Résolu** par la FAQ Q242 p.67 : en zone vulnérable, les points se comptent au-delà de 8 semaines, « quelle que soit la durée obligatoire de couvert, qu'elle soit inférieure ou supérieure à 8 semaines ». Il n'y a rien à saisir, et la grille est donc conforme. Seul le socle se vérifie par rapport à la durée du PAN/PAR. Autres règles de la FAQ sur cet item : voir §8.2.

**Questions de fond**
7. **Référence en cas de divergence** : grille ou plan ?
   → **Tranché** : grille v1.15 à la lettre ; les écarts sont signalés dans l'interface.
8. **Abattement de 20 % du bilan fourrager** : il figure en note dans l'outil BGA mais n'est pas appliqué par ses formules (S2!H335).
   → **Ouvert**. La FAQ Q218 p.62 précise seulement que les outils BGA et BA ne sont pas obligatoires, et que l'OC doit de toute façon vérifier les calculs.
9. **CMR « à date de l'utilisation »**
   → **Partiel**.
   - Résolu par la FAQ Q127 p.42 : on retient la classification à la date du **traitement**. La seule référence est le tableau du ministère, élaboré par l'Anses à partir d'E-Phy.
   - Restent ouverts :
     - l'archivage de chaque version publiée de la liste (le classeur n'en contient que 3) ;
     - la clé de rapprochement (n° d'autorisation, col. B) ;
     - le cas des mentions de danger (§8.4).
   - **Nouveau** (FAQ Q129 p.42) : le contrôle porte aussi sur les **traitements de semences et les engrais**.
10. **Biocontrôle**
    → **Partiel**.
    - Les définitions sont fixées par la FAQ Q138 p.44 (art. L.253-6 CRPM), Q157 p.48 (liste trimestrielle, lien ecophytopic.fr) et Q189-190 p.54-55 (macro-organismes : biocontrôle, mais pas produits phytopharmaceutiques).
    - La liste elle-même reste à importer : elle ne fait pas partie du corpus.
11. **Table ministérielle des exportations d'azote et FAQ V4**
    → **Résolu** : elles ont été ajoutées et sont exploitées au §8.
12. **Bilan azoté de Fourmy**
    → **Ouvert** : il faut encore vérifier le code. Les exigences sont maintenant précisées par la FAQ :
    - rendements **réels**, pas prévisionnels (Q214 p.61) ;
    - SAU totale au dénominateur, mais seulement les cultures « principales » au calcul (Q215 p.61) ;
    - en BGA, tout ce qui est récolté sort, quel que soit son devenir (Q216 p.61).
13. **IFT de Fourmy**
    → **Ouvert** : il faut encore vérifier le code. La FAQ confirme que la **signature électronique** est obligatoire, et qu'un calcul fait hors de l'outil du ministère ou de son API ne peut pas être validé (Q166 p.49, Q167 p.50).
14. **IAE PAC → HVE**
    → **Résolu** dans le sens de la recommandation (proposition automatique, puis validation par l'exploitant) :
    - pour les éléments communs avec la BCAE 8, les définitions, unités et coefficients sont **identiques** (FAQ Q42 p.25) ;
    - les règles de comptabilisation de la conditionnalité valent pour le critère obligatoire, mais **pas** pour le poids des IAE (même question) ;
    - une déclaration PAC n'est ni nécessaire ni suffisante : le constat se fait sur site (Q43 p.25, Q62 p.29) ;
    - SNA et SNE ne sont pas automatiquement des IAE (Q56 p.28) ;
    - couverts et légumineuses PAC ne sont pas des IAE (Q90-91 p.34) ;
    - une jachère PAC compte à la fois en SAU « gelée » et en IAE « jachère » (Q96 p.35, Q106 p.37).
15. **Données hors parcellaire**
    → **Tranché** : un questionnaire annuel par ferme.
16. **Option B**
    → **Tranché** : option A (V4) seule, sans option B.
17. **Exploitations multi-campagnes**
    → **Confirmé**. Il faut deux calculs indépendants. Selon la FAQ Q213 p.61, la campagne doit être la même pour les 4 indicateurs ; si la campagne n n'est pas finalisée, l'audit porte sur n-1.
18. **Horticulture et pépinière**
    → **Partiel**.
    - Le périmètre est précisé :
      - l'annexe horticole ne vaut que pour les productions ornementales (référentiel MPS-ABC, FAQ Q168 p.50) ;
      - la fraise hors sol n'est pas de l'horticulture (Q222 p.63) ;
      - les légumes non plus (Q260 p.72).
    - La décision de reporter cette famille reste à prendre.

**Questions nouvelles (19/11/2026)**
19. **Arbres fruitiers dans la BGA** : depuis le 23/06/2026, la table ne donne plus de formule de « besoins ». Elle donne la teneur des fruits (kg N/t) et, séparément, celle des parties pérennes (kg N/ha).
    - L'ancienne formule était : teneur des fruits × rendement + teneur des parties pérennes (ExpN, suivi des modifications p.1).
    - Le texte ne dit plus explicitement que les parties pérennes comptent en exportation. **Ouvert**.
20. **Légumes et fruits** : la colonne % MS est presque toujours vide, et la teneur est donnée en kg/t.
    - *Hypothèse* : il s'agit de tonnes de produit brut récolté.
    - Elle reste à confirmer, car l'unité « t MF » n'est écrite que pour la betterave et le chou fourragers.
21. **Mentions de danger et CMR** : aucune source ne relie le classement CMR aux mentions H (§8.4).
    - La concordance retenue par l'utilisateur sert de contrôle de cohérence ; la liste ministérielle reste la référence opposable (FAQ Q127).
    - Le cas des produits « CMR catégorie supplémentaire » est à exclure de CMR1/CMR2 (FAQ Q128 p.42).

---

## 8. Compléments (sources ajoutées le 19/11/2026)

### 8.1 Table des exportations d'azote (ExpN, mise à jour du 23/06/2026)

**Objet.** « Table de référence pour le calcul de l'item Bilan azoté de la certification Haute Valeur Environnementale ».
- Versions successives (suivi des modifications, p.1) : version initiale du 17/10/2022, puis corrections du 02/01/2023, du 19/01/2023, du 31/03/2023 (suppression des « Vignes » au profit de « Raisin »), du 13/04/2023, du 20/03/2024 et du 23/06/2026.
- La version du 23/06/2026 :
  - remplace les colonnes « besoins » et « potentiel de rendement » des parties 5 et 6 par des **teneurs** ;
  - ajoute la canne à sucre, la tomate sous abri, les fraises, la banane, le citron, l'orange, le pamplemousse, l'avocat et la mangue.
- Sources citées par la table : COMIFER 2013 « Teneurs en N des organes végétaux récoltés », dires d'experts, Unilet (légumes d'industrie), Chambres d'agriculture de Bretagne, INRAE, CTIFL (légumes frais), Anitta (tabac), SOeS et ANSES 2013, note CTIFL du 31/07/2012, Cirad.

**Structure** (6 parties, p.2-8) :

| Partie | Colonnes | Unité de teneur | Lignes (comptage manuel) |
|---|---|---|---|
| 1. Grandes cultures (céréales, oléagineux, protéagineux, cultures industrielles) | culture, organe (grain, paille, épi entier, racine, tubercule, feuilles, tige), **% MS récolte** (MS de référence), **teneur en N**, unité ; pour la paille, un second bloc « en fonction du tonnage de pailles exportées » (% MS paille, teneur, unité) | kg/t (à la MS de référence) | 47 |
| 2. Fourrages et cultures fourragères | culture, organe, **type de récolte** (pâture, ensilage, foin, déshydratée, foin précoce ou tardif, regain, pâturage à rotation rapide ou lente…), % MS, teneur, unité | kg/t MS (ou kg/t MF pour la betterave et le chou fourragers ; unité absente pour le chanvre) | 28 |
| 3. Porte-graines | culture, organe (graine), **rendement standard** (kg/ha), teneur | kg/t | 16 |
| 4. Légumes | espèce, organe, **destination** F (frais) ou I (industrie), % MS (rarement renseigné), rendement moyen (t/ha), teneur | kg/t (unité absente pour l'oignon) | 73 (environ 63 espèces ; « résidus de culture » en ligne distincte pour plusieurs fruits-légumes) |
| 5. Fruits (fraises, ananas, petits fruits) | culture, organe, teneur | kg/t | 8 |
| 6. Arbres fruitiers et vignes | jeunes vergers par âge (1re, 2e, 3e année) ; vergers en production : type, espèce, âge d'entrée, **teneur des fruits** (kg N/t) et **teneur des parties pérennes** (kg N/ha) | kg N/ha (jeunes vergers) ; kg N/t + kg N/ha | 3 + 21 |

Total : **environ 196 lignes**. Le comptage est manuel, à quelques lignes près selon le découpage culture/organe.

**Exemples** (valeurs lues dans la table) :

| Culture | Organe | % MS réf. | Teneur N | Unité |
|---|---|---|---|---|
| Blé tendre | grain | 85 | 18 | kg/t |
| Blé tendre | paille (masse récoltée) / (tonnage exporté) | 85 / 88 | 4 / 5,7 | kg/t |
| Colza | grain | 91 | 29 | kg/t |
| Maïs | grain / épi entier | 85 / 81 | 12 / 11 | kg/t |
| Betterave sucrière | racine | « 16 % sucre » | 1,1 | kg/t |
| Pomme de terre conso. | tubercule | 22 | 3,4 | kg/t |
| Luzerne | foin | — | 28,0 | kg/t MS |
| Prairie (PP ou PT, graminées ou multi-espèces) | pâturage rotation rapide / lente | — | 30,0 / 25,0 | kg/t MS |
| Carotte « Flakkee » (I) | racine | 12 | 1,7 | kg/t |
| Pommier (dès la 3e feuille) | fruits / parties pérennes | — | 0,6 / 80 | kg N/t / kg N/ha |
| Raisin (dès la 3e feuille) | fruits / parties pérennes | — | 2,0 / 20 | kg N/t / kg N/ha |
| Jeune verger, 1re année | — | — | 20 | kg N/ha |

**Cultures « principales » et « mineures » (item 6.1).** La table elle-même ne définit pas ces notions. Elles viennent du plan, qui appelle principales les cultures présentes dans la table (§2.3), et la FAQ le confirme :
- **principale = culture qui a une référence d'exportation dans la table**. Par exemple, « les fraises disposant d'une référence d'exportation d'azote, un calcul du bilan azoté doit être réalisé » : elles ne sont donc pas mineures (FAQ Q219 p.62) ;
- seules les surfaces en cultures principales entrent dans le bilan. L'exploitant peut, s'il le souhaite, intégrer les cultures mineures « en entrées seulement ». Le bilan en kg N est ramené à l'ha de **SAU totale** (Q215 p.61) ;
- *conséquence pour Fourmy* : la correspondance culture Fourmy/Lexicon → ligne de la table détermine le statut principal ou mineur. Toute culture sans correspondance est mineure, et sa part de SAU déclenche la correction de l'item 6.1 et l'OAD des cultures mineures (seuil de la grille : > 5 %, décision n°4).

**Utilisation dans un calcul de BGA** (sorties S1.1 et S1.2) :
- **Formule de base** : exportation (kg N) = quantité récoltée à la MS de référence (t) × teneur (kg N/t). La note (2) des parties 1 à 4 dit : « Quantité d'azote par unité de masse de matière végétale à la teneur en MS de référence ».
- **Conversion en MS** : si la récolte est pesée à une autre teneur en MS, il faut ramener la masse à la MS de référence (t × MS réelle / MS de référence). C'est la formule de l'outil BGA (§2.3) ; la table ne l'écrit pas, elle fournit seulement la MS de référence.
- **Fourrages** : en kg/t MS, il faut une masse en t MS. Les deux exceptions sont la betterave fourragère et le chou fourrager, en kg/t MF.
- **Herbe pâturée** : on applique 30 ou 25 kg N/t MS selon la rotation, au tonnage issu du bilan fourrager (§2.3).
- **Paille** : deux références. La colonne « masse de récolte » se combine avec le rendement en grain de la culture ; la colonne « tonnage de pailles exportées » s'applique au tonnage de paille effectivement exporté.
- **Rendement** : rendements réels, pas prévisionnels (FAQ Q214 p.61). La teneur s'applique **quel que soit le rendement réalisé** : les rendements de la table sont illustratifs (FAQ Q220 p.62). La FAQ l'emporte sur les notes « plage de rendement pour laquelle les valeurs sont valables » des parties 3 et 4.
- **Vergers** : voir la question ouverte n°19 (formule des parties pérennes).
- **Alignement avec l'outil BGA v1.07** : il contient déjà la canne à sucre, le manguier, l'avocatier, le bananier, le citronnier et l'ananas. En revanche, aucun libellé « sous abri » n'y a été trouvé (tomate sous abri). Il faut comparer les deux ligne à ligne avant tout import.

**Extraction.**
- `pdftotext -layout` restitue un texte tabulaire lisible, mais pas directement analysable :
  - libellés sur plusieurs lignes (« Blé / améliorant », « Orge / brassicole », « Pomme de / terre conso. ») ;
  - nom de culture centré verticalement entre deux organes, d'où des rattachements ambigus (« résidus de culture » de l'asperge ou de l'aubergine ; « plante entière ensilée » du sorgho fourrager ou du maïs) ;
  - unités manquantes (chanvre, oignon) et cellule textuelle « 16 % sucre » ;
  - deux blocs de colonnes pour la paille.
- *Recommandation* : avec environ 200 lignes, une **saisie semi-manuelle** (extraction automatique puis relecture ligne à ligne contre le PDF) revient moins cher qu'un analyseur. Le référentiel doit porter :
  - culture, organe, type de récolte ou destination, % MS de référence, teneur, unité (kg/t, kg/t MS, kg/t MF, kg N/ha) ;
  - teneur des parties pérennes, âge d'entrée en production ;
  - date de version de la table (23/06/2026), pour l'historisation.

### 8.2 FAQ HVE v2022 (v3, août 2025) : réponses utiles

Champ : « s'applique à la certification HVE selon la version 4 (2022) du référentiel […] (toute version du plan de contrôle à partir de janvier 2025) » (FAQ p.1). Les références « Qn p.x » renvoient au numéro de question et à la page imprimée, qui est identique à la page du PDF.

**Surfaces et parcelles**
- SAU (périmètre) :
  - landes, parcours, alpages et estives **collectifs** : hors SAU de l'exploitation ; individuels : SAU (Q6 p.15, Q131 p.42) ;
  - taillis à courte rotation : « autres cultures permanentes » (Q7 p.15) ;
  - potager ou verger d'autoconsommation non déclaré à la PAC et ≤ 1 500 m² : non compté (Q12 p.16) ;
  - sapins de Noël : SAU (glossaire de PdC4, §8.3).
- **Cultures dérobées** : hors SAU, mais leurs traitements et fertilisants comptent dans l'IFT et le bilan azoté (Q8 p.15).
- Semences : classées dans la catégorie de la culture. Luzerne, trèfle et ray-grass porte-graines vont en « surfaces en herbe » (Q10 p.15).
- Surface totale (dénominateur du poids des IAE) :
  - chaque surface ne compte qu'une fois entre SAU, SNA, SNE et ZDH (Q59 p.29) ;
  - tous les bâtiments, habitation comprise, vont en SNA (Q58 p.28) ;
  - les forêts ne sont **pas** à déclarer en SNA (Q61 p.29) ;
  - toutes les surfaces réelles comptent, pas seulement celles déclarées à la PAC (Q60 p.29).
- Parcelle de culture pérenne arrachée : elle reste en SAU si l'arrachage a lieu après la récolte. Si l'arrachage a lieu avant la récolte, elle passe en jachère (SAU gelée et IAE) ou dans la culture de remplacement selon le couvert et l'usage ; sinon elle sort de la SAU (Q105 p.37).
- **Item 4.2, unités culturales** :
  - la parcelle s'entend comme unité culturale ;
  - une bordure non productive ou une bande enherbée intra-parcellaire sépare deux unités de même culture (Q108-109 p.38), **si elle court sur toute la longueur ou la largeur** de la parcelle (Q110 p.38).
- **Item 4.3** :
  - maïs grain et maïs ensilage forment la même espèce et s'additionnent (Q111 p.38) ;
  - c'est la surface qui fait foi, pas le chiffre d'affaires (Q112 p.38) ;
  - liste des espèces : catalogue GEVES (Q113, Q116 p.39).
- **Item 4.4** :
  - les jachères ne comptent pas comme espèces (Q115 p.39) ;
  - la vigne compte automatiquement pour 1 espèce (Q114 p.39) ;
  - les points des prairies temporaires (1 à 3 selon le mélange) ne dépendent pas de la surface (Q118 p.40).

**IAE (item 4.1)**
- Voir la question n°14 (PAC et HVE).
- IAE sur SNA et SNE : elles comptent pour le poids et la diversité (Q57 p.28).
- Cumul illimité pour le poids (Q64 p.30).
- Bande enherbée de plus de 5 m en bout de champ : elle compte comme bordure non productive (linéaire) ; la surface au-delà de 5 m ne peut pas être comptée en « autres milieux » (Q65 p.30).
- Haie de plus de 10 m de large : elle sort de la SAU, donc de la SAU non traitée (Q67 p.30).
- Ne sont pas des IAE :
  - chemins (Q45 p.25) ;
  - cours d'eau (Q51 p.27) ;
  - bois pâturés (Q44 p.25) ;
  - retenues d'irrigation (Q84 p.33) ;
  - peupleraies (Q86 p.33) ;
  - murs de soutènement (Q104 p.37) ;
  - landes, parcours et PP hors Natura 2000 (Q92 p.34).
- Non-maîtrise : un linéaire de bord de route ou de chemin communal, ou situé chez un particulier, n'est pas une IAE de l'exploitation (Q54 p.28, Q103 p.37).
- Haies, bosquets et mares soumis à maintien : ils doivent être présents le jour de l'audit (Q107 p.38).

**Autres items de biodiversité**
- Ruches : présence permanente sur 12 mois (Q121 p.40). Les ruches à bourdons sous serre (Q119) et la transhumance (Q120 p.40) sont exclues.
- Races équines et asines menacées : liste provisoire en Q124 p.41.
- Test bêche : il peut se faire sur une culture de printemps, de janvier à mars, avant toute intervention (Q125 p.41).

**CMR (5.1)**
- La classification retenue est celle à la **date du traitement** (Q127 p.42).
- La « CMR catégorie supplémentaire » est distincte de CMR1 et CMR2 ; il faut vérifier chaque produit dans la liste (Q128 p.42).
- Les **traitements de semences et les engrais sont inclus** dans le contrôle CMR1 et CMR2 (Q129 p.42).

**Surfaces non traitées (5.2)**
- Raisonnement sur **100 % de la surface et 100 % de la durée de la campagne** : un seul traitement, en début de campagne, après récolte ou sur une seule culture de la rotation, exclut la parcelle (Q132, Q134-135 p.43).
- Seule exception : le traitement localisé sur une PP (Q132, Q136 p.43).
- Traitement contre la chenille des prairies : la parcelle est exclue (Q137 p.44).
- Une parcelle traitée **uniquement en biocontrôle** compte comme non traitée (Q141 p.44).
- Une semence traitée n'exclut pas la parcelle (Q143 p.45).
- La conduite « façon AB » sans certification ne suffit pas (Q142 p.45).
- Les SNE ne sont pas éligibles (Q144 p.45).
- Les ZNT réglementaires ne comptent que si elles n'ont effectivement reçu aucun produit (Q145-146 p.45).
- Tournières enherbées des cultures pérennes : intégrables jusqu'à 5 m (bordure) ou 10 m (bande tampon) (Q133 p.43).
- Les surfaces se mesurent au plus près, sans estimation forfaitaire (Q147 p.45).

**IFT (5.3)**
- Produits pris en compte : herbicides, insecticides (y compris acaricides et nématicides), fongicides (y compris bactéricides), régulateurs, molluscicides (Q151 p.46, Q160 p.48).
- Exclus de la notation :
  - **biocontrôle** (note trimestrielle) et **PNPP** (Q151 p.46, Q157 p.48, Q161 p.49) ;
  - rodenticides, répulsifs et taupicides, dévitalisation des souches (tableau Q159 p.48) ;
  - adjuvants (Q160 p.48).
- Le cuivre homologué en AB **compte** ; certains soufres de biocontrôle sont exclus (Q158 p.48).
- Jachères : intégrées à l'IFT grandes cultures. PP : exclues, qu'elles soient traitées ou non (Q156 p.48).
- Surface de calcul : la SAU totale de la parcelle, bordures incluses (Q153 p.47).
- Calcul par parcelle puis moyenne pondérée, ou calcul global, au choix (Q162 p.49).
- Références régionales : celles de la **région du siège** pour toutes les surfaces ; en vigne, le bassin du siège (Q165 p.49).
- Signature électronique obligatoire (Q166 p.49, Q167 p.50).
- Une parcelle de grandes cultures non traitée compte à la fois en 5.2 et en 5.3 (Q164 p.49).
- Les certifiés V3 gardent l'ancienne méthode IFT (Q155 p.47) : sans objet ici (option A V4 seule).

**Méthodes alternatives (5.6)**
- Inter-rang seul (vigne, arboriculture, cultures en ligne à larges écarts) : 2/3 de la parcelle. **Rang seul : 1/3** (Q176 p.52).
- Rang + inter-rang : 100 % ; dans tous les autres cas, le principe est le « tout ou rien » (Q175 p.52).
- Une méthode appliquée sur une partie de la parcelle vaut pour toute la parcelle, hors cas 2/3 et 1/3. Une PP compte comme un tout (Q183 p.53).
- La méthode doit avoir économisé un passage de produit. Un traitement chimique postérieur ne la disqualifie pas. Pour une culture courte, la méthode doit couvrir un cycle complet (Q178 p.52, Q188 p.54).
- Une parcelle ne compte qu'une fois (Q182 p.53).
- Sont admis :
  - travail superficiel du sol (Q186 p.54) ;
  - macro-organismes (trichogrammes) (Q189-190 p.54-55) ;
  - association de deux variétés de colza (CEPP) (Q193 p.55).
- Sont exclus :
  - labour (Q186 p.54) ;
  - pâturage (Q192 p.55) ;
  - sous-solage (Q194 p.55) ;
  - nichoirs, pièges de comptage, plantes compagnes (Q173, Q185, Q187 p.51-54).

**Fuites (5.7), diversité variétale (5.8), inter-rang (5.9)**
- 5.7 :
  - une aire de remplissage collective compte (Q196 p.56) ;
  - les gestes réglementaires (EVPP), l'incorporateur, la pente du local et les OAD météo ne comptent pas (Q199-202 p.56).
- 5.8 :
  - pas de surface minimale par variété (Q203 p.57) ;
  - la pondération par la surface est celle de la grille (Q204 p.57) ;
  - **la pomme de terre suit les grandes cultures** : elle n'a pas accès à l'item 5.8 et sort des surfaces de pondération « légumes » (Q205 p.57).
- 5.9 :
  - % = part d'inter-rangs couverts × part de la largeur couverte (Q210 p.58) ;
  - **tout travail du sol de l'inter-rang donne 0 point** (Q211 p.59) ;
  - miscanthus et canne à sucre sont des « autres cultures pérennes », couvertes en totalité sous conditions (Q207-208 p.57-58).

**Bilan azoté (6.1) et pâturage**
- Rendements réels (Q214 p.61).
- SAU totale ; seules les cultures principales sont calculées (Q215 p.61).
- BGA : exportation de tout ce qui est récolté, vendu ou stocké. Bilan apparent : seulement ce qui sort de l'exploitation pendant la campagne (Q216 p.61).
- L'OTEX est définie par l'exploitant (Q217 p.62). Outils BGA et BA facultatifs (Q218 p.62).
- Teneur de la table valable quel que soit le rendement (Q220 p.62).
- **Tout apport d'azote compte**, y compris un adjuvant azoté (Q221 p.62).
- **Aléa climatique assuré** : mesure exceptionnelle validée par la CNCE le 05/07/2023. Sur justificatif de l'assureur ou de l'expert, les pertes indemnisables peuvent être intégrées au calcul du bilan (Q212 p.60). La FAQ annonce que la mesure peut être revue.
- Pâturage :
  - les déjections au pâturage ne font pas perdre le statut « non fertilisé » (Q227 p.64) ;
  - la FAQ n'ajoute rien sur le calcul de l'herbe pâturée dans la BGA : le bilan fourrager du plan (§2.3) reste la seule règle.

**Autres items de fertilisation**
- 6.4 OAD :
  - une analyse de sol peut valoir pour plusieurs parcelles homogènes (Q223 p.63) ;
  - c'est l'usage de l'OAD qui est vérifié, pas le respect de ses préconisations (Q224 p.63) ;
  - les analyses de moûts ne comptent pas (Q225 p.63).
- 6.5 :
  - seul l'azote compte (Q226 p.64) ;
  - les effluents épandus excluent la parcelle (Q227 p.64) ;
  - forêts, bassins d'orage et SNA ne comptent pas (Q228 p.64) ;
  - **tournières non fertilisées de 1 à 5 m gérées comme IAE : comptées, plafonnées à 5 %** (Q229 p.65).
- 6.6 : les mélanges contenant des légumineuses comptent en totalité, sans coefficient (Q230 p.65).
- 6.7 Couverture des sols :
  - **surfaces en ZV et hors ZV** : le socle se vérifie séparément pour chaque zone, les points se calculent par zone puis se pondèrent par la part de SAU de chacune (Q233 p.66) ;
  - semaines entières : 7 jours = 1 semaine, 14 jours = 2 semaines (Q235 p.66) ;
  - les semaines additionnelles doivent **suivre** la durée réglementaire (Q236 p.66) ;
  - la surface couverte le moins longtemps est le facteur limitant. Exemple : 2 ha couverts 7 sem. 2 j + 4 ha couverts 8 sem. 1 j + 4 ha de PP → « 100 % couvert 7 semaines » ou « 80 % couvert 8 semaines » (Q237 p.67) ;
  - sans dates de semis ou de destruction, 0 point. Sans traçabilité par parcelle, on retient le semis le plus tardif et la destruction la plus précoce. Couvert gelé : date du 1er gel (Q234 p.66) ;
  - une CIPAN ou une dérobée ayant reçu un engrais minéral n'est pas un couvert, et ce pendant toute sa présence (Q238-239 p.67) ;
  - les jachères comptent si elles ne sont pas détruites (Q240 p.67) ;
  - toute destruction chimique est exclue, même si la directive nitrates l'autorise (Q241 p.67) ;
  - ZV au-delà de 8 semaines : voir la question n°6 (Q242 p.67) ;
  - dérogation BCAE 6 de novembre 2023 : audit initial = 2 points ; suivi ou renouvellement = points de l'année précédente (Q243 p.68).

**Irrigation**
- La seule lutte antigel ne rend pas l'exploitation irrigante (Q244 p.69). Seule l'eau d'irrigation compte (lavage de légumes exclu, Q245 p.69).
- Prélèvement dans le milieu naturel : cours d'eau, nappe, **puits et forages**, lac de barrage, canal (Q246-247 p.69, Q259 p.71). L'eau d'un ouvrage de stockage n'est pas un prélèvement direct (Q246).
- Retenue collinaire : alimentée par ruissellement et déconnectée du réseau. L'eau prélevée hors étiage puis stockée ne compte pas en étiage, mais un pompage en nappe en juin-août compte (Q256, Q258 p.71). Un bras mort compte comme milieu (Q257 p.71).
- Étiage : mêmes mois partout, outre-mer compris (Q255 p.70).
- 7.1 :
  - volumes mesurés **ou estimés** (Q248 p.69) ;
  - cahier commun possible entre deux exploitations (Q249 p.69) ;
  - **le matériel ne se précise que s'il est mobile**. Avec un matériel fixe, le mode d'irrigation suffit et la donnée « matériel » n'est pas manquante (Q250 p.69-70) ;
  - données conservées au moins 1 an (Q251 p.70).
- 7.2 : le pluviomètre est exclu ; la station météo vaut 1 point « offre » si ses données sont effectivement utilisées (Q252 p.70).
- 7.4 : Canal du Bas-Rhône Languedoc et Canal de Provence éligibles (Q253 p.70).
- 7.5 : d'autres pratiques sont admissibles si une publication d'institut prouve leur efficacité et si elles sont contrôlables (Q254 p.70).
- 7.8 : seulement les cultures hors sol (Q261 p.72).

**Règles de la FAQ qui modifient une formule ou un barème du §2**

| Item | Modification | Réf. |
|---|---|---|
| 5.1 CMR | Assiette élargie aux **traitements de semences et aux engrais** (le §2.2 ne parlait que des produits phyto) | Q129 p.42 |
| 5.2 | Exclusion de la parcelle pour **tout** traitement de la campagne, toutes rotations confondues ; parcelle 100 % biocontrôle = non traitée ; semence traitée sans effet | Q132, Q134, Q141, Q143 |
| 5.6 | Nouveau coefficient **1/3 pour le rang seul** (le §2.2 ne citait que 2/3 pour l'inter-rang) ; méthode partielle = parcelle entière | Q176 p.52, Q183 p.53 |
| 5.8 | Pomme de terre hors item, et hors surfaces de pondération légumes | Q205 p.57 |
| 5.9 / 6.7 pérennes | Travail du sol de l'inter-rang = 0 point ; % = inter-rangs couverts × part de largeur | Q210-211 p.58-59 |
| 6.1 | Intégration possible des pertes assurées (aléa climatique) ; adjuvant azoté compté | Q212 p.60, Q221 p.62 |
| 6.5 | Tournières non fertilisées (IAE de 1 à 5 m) admises, **plafonnées à 5 %** | Q229 p.65 |
| 6.7 | Pondération ZV / hors ZV ; semaines entières (7 j) ; surface limitante (100 % ou ≥ 75 %) ; points ZV au-delà de 8 semaines quel que soit le PAR ; dérogation BCAE 6 2023 | Q233-237, Q242-243 |
| 7.1 | Donnée « matériel » non exigée pour un matériel fixe (diminue N et M dans R = M/N) | Q250 p.69 |
| 7.6 | Puits, forages, lacs de barrage et canaux = milieu naturel (numérateur s'ils sont prélevés en juin-août) | Q247, Q259 |

### 8.3 Plan V4 de 2022 (PdC22) et plan V4.4 de 2024 (PdC4) : différences qui changent un calcul

**Méthode.**
- Comparaison automatique, mot à mot, des textes extraits, puis relecture des sections touchées.
- Beaucoup d'écarts ne sont qu'apparents : symboles « ≤ » perdus à l'extraction de PdC4, pagination, numéros de notes. Ils n'ont pas été retenus. Par exemple, les barèmes de 4.1, 4.3, 4.4, 4.5, 5.2, 5.6, 6.5, 6.6 et 7.1 à 7.6 sont identiques.
- Ne sont listées ci-dessous que les règles de calcul modifiées.

| Point | PdC22 (22/11/2022) | PdC4 (V4.4, 01/01/2025) | Effet |
|---|---|---|---|
| Niveau 1 | Attestation de niveau 1 valide exigée pour certifier le niveau 3 ; un non-respect du niveau 1 retire la certification | Exigence supprimée | Condition de validation en moins |
| SAU (glossaire) | Cultures hors sol en SAU | Cultures hors sol **et sapins de Noël** en SAU | Dénominateurs |
| Numéros d'annexe | Annexe 3 « races menacées », annexe 4 variétés, **annexes 6 et 7** matériels, annexes 8 à 11 azote et UGB | Annexe 3 « races » supprimée, d'où un décalage de 1 : annexes 5 et 6 matériels, annexes 7 à 10 azote et UGB | Explique les renvois de la grille et de la FAQ (question n°5) |
| 4.7 Races menacées | Liste de l'annexe 3 (source INRA, novembre 2014 ; bovins, ovins, caprins, porcins, asins, équins) | Arrêté du 29/04/2015 modifié, colonne « races menacées d'être perdues pour l'agriculture » (dernière version 25/05/2023) | Liste éligible différente (équins et asins : liste provisoire de la FAQ Q124) |
| 5.3 IFT grandes cultures | Une seule échelle de notation | Depuis juillet 2024, **deux échelles** (« en cours » et « ancienne ») ; l'échelle utilisée doit être déclarée | Choix de l'échelle (déjà au §2.2) |
| 5.8 Diversité | Familles : vigne, arboriculture, « légumes, fruits hors arboriculture, PPAM », « horticulture-pépinière » | Vigne, arboriculture, « légumes, fleurs, fruits hors arboriculture, PPAM **de pleine terre** », « **hors sol** » | Périmètre et pondération |
| 5.9 Couvert inter-rang | Vigne, arboriculture, horticulture-pépinière. S = % de surface « avec un couvert végétal permanent par rapport à la surface de la culture concernée » ; modalités « rang + inter-rang, tous les rangs, 1 rang sur 2 ou 3 » × largeur de la bande ; la période de couverture démarre au semis | Ajout des **« autres cultures pérennes »**. S = % de surface **couverte en inter-rang** ; le rang et le pied des arbres n'ont pas à être couverts ; un sol nu est toléré pendant la levée d'un couvert ressemé, sauf du 1/11 au 1/03 ; modalités par inter-rang × largeur du couvert | Numérateur, dénominateur et périmètre |
| 5.10 Recyclage hors sol | Hors horticulture : **0 % ≤ R ≤ 10 % → 1 point** (même à 0 %). Horticulture : total R < 50 % → 2, partiel R < 50 % → 1 (sans borne basse) ; pas de prorata écrit | Hors horticulture : **0 % < R** ≤ 10 % → 1. Horticulture : **25 % ≤ R** < 50 % → 2 (total) ou 1 (partiel). Points **rapportés à la part de SAU** de chaque famille hors sol | Barème et prorata. La grille v1.15 suit PdC4 (Phyto!N363:N366) |
| 6.1 Contrôle OTEX | Documents justifiant l'OTEX ; cahier de fumure **ou** comptabilité | Cohérence avec les activités déclarées, ou, en cas de doute, CA des OTEX listées ≥ 2/3 du CA ; cahier de fumure **et** comptabilité | Choix du barème (bilan apparent herbivore) |
| 6.4 OAD | « Outil PPF ODP » ; aucune règle propre aux prairies | « ODP **avec diagnostic de nutrition** » ; **prairies (PT et PP) : 1 point si un PPF est utilisé ; pas de PPF Aj ni d'ODP pour les prairies** | Éligibilité des OAD et points prairies |
| 6.7 Pérennes | Comme 5.9 (2022) | Comme 5.9 (2024) | Idem |
| 6.9 Recyclage (fertilisation) | Horticulture-pépinière hors sol seulement (définition reprise du volet horticole de 5.10) | **Toutes les cultures hors sol** (légumes, fruits, PPAM et horticulture-pépinière), deux ratios (total ou partiel), points rapportés à la surface hors sol / SAU | Périmètre |
| 7.8 Eaux de pluie | 1 point si le dispositif est présent et utilisé | 1 point **rapporté à la part des cultures hors sol dans la SAU** | Prorata |

Pour Fourmy, ces écarts n'ont d'intérêt que pour relire un audit ancien. Les calculs suivent PdC4 et la grille v1.15 (décision n°7).

### 8.4 Contrôle CMR et mentions de danger

**Réponse : non.** Ni la FAQ, ni PdC22, ni PdC4 ne disent que le classement CMR découle des mentions de danger. Aucun des trois textes ne cite H340, H350, H360, H341, H351 ou H361, ni le règlement (CE) n°1272/2008 (CLP). Recherche faite dans les trois textes intégraux.

Ce que disent les sources :
- PdC22 et PdC4 §5.1.1 (texte identique, p.40) : « Si au moins un produit visé par le règlement (CE) n°1107/2009, qui à date de l'utilisation est classé cancérigène, mutagène et/ou toxique pour la reproduction de catégorie 1, a été utilisé […] » (même formule pour la catégorie 2). §5.1.2 : vérification « sur la base du cahier d'enregistrement des traitements phytosanitaires, des étiquettes des produits utilisés et des factures d'achat » ; « La liste sera mise à disposition sur le site du ministère ».
- FAQ Q127 p.42 : « Les références de classification à utiliser pour les audits sont uniquement dans le tableau disponible sur la page HVE du site Alim'Agri, tableau élaborée à partir de la base de donnes E-Phy par l'Anses » (sic).
- FAQ Q128 p.42 : « La catégorie "CMR catégorie complémentaire" est distincte des catégories CMR1 et CMR2 utilisées dans l'item. Il faut dans tous les cas vérifier au cas par cas la présence du produit parmi la liste des produits classés CMR. »

Analyse :
- La liste ministérielle est **la seule référence opposable**.
- La correspondance H340/H350/H360 → catégorie 1 et H341/H351/H361 → catégorie 2 relève du règlement CLP. Elle est **hors corpus** et n'est pas reprise par les textes HVE.
- *Interprétation* : la « catégorie supplémentaire » de Q128 correspond vraisemblablement aux effets sur ou via l'allaitement (H362 dans le CLP). Elle ne doit donc pas être assimilée à CMR1 ou CMR2.

Pour Fourmy, conformément à la décision de l'utilisateur (concordance supposée) :
1. Classer d'abord par la liste ministérielle (clé : n° d'autorisation), dans sa version en vigueur à la date du traitement.
2. Ne recourir aux mentions H d'E-Phy que pour un **contrôle de cohérence** (signaler les discordances) ou pour un produit absent de la liste. Ce second usage reste à confirmer, car la FAQ dit « uniquement » le tableau.
3. Exclure H362.
4. Étendre le contrôle aux semences traitées et aux engrais (Q129).
