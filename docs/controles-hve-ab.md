# Contrôles HVE et Agriculture biologique

Fourmy prépare l'audit de certification de l'exploitation : Haute Valeur
Environnementale (niveau 3, référentiel V4, option A) et Agriculture
biologique (production végétale). Les contrôles sont calculés à partir des
saisies ; ils ne remplacent pas la décision de l'organisme certificateur.

Besoins, conception et plan : [`claudedocs/besoins_controle_hve_ab.md`](../claudedocs/besoins_controle_hve_ab.md),
[`claudedocs/conception_controle_hve_ab.md`](../claudedocs/conception_controle_hve_ab.md),
[`claudedocs/workflow_controle_hve_ab.md`](../claudedocs/workflow_controle_hve_ab.md).
Sources et analyse des textes : [`docs/hve/rapport_hve.md`](hve/rapport_hve.md),
[`docs/ab/rapport_ab.md`](ab/rapport_ab.md) (les pièces officielles, PDF et
tableurs, restent hors du dépôt).

## Où les trouver

- **Menu Réglementaire** : « Contrôle HVE » et « Contrôle AB » apparaissent dès
  qu'une parcelle porte la certification pendant la campagne de la frise
  (certifications de parcelle, page Activités).
- **Page de contrôle** : verdict de la campagne, sections et constats ; chaque
  constat cite sa source (texte, version, page ou cellule de la grille).
  - Feux : conforme, à vérifier, non conforme, **données manquantes** (jamais
    compté conforme : ce qui manque est listé), sans objet.
  - HVE : points de chaque indicateur, seuil de 10 ; onglets IAE,
    Questionnaire, Parcelles irriguées.
  - AB : manquement du catalogue national de l'INAO et mesure encourue ; le
    feu suit la classe (mineur : orange ; majeur ou critique : rouge) ;
    onglets Parcelles (statut de conversion) et Semences (statut, dérogations).
  - Réglages (responsable) : période HVE de 12 mois, campagne seule ou moyenne
    sur trois ans, notation IFT, Beaujolais, élevage ; repères de rotation AB.
- **Saisie d'une intervention** : section « Certification » en direct, comme le
  contrôle phyto. Une réalisation saisie sur le web avec un feu rouge demande
  un motif ; champ « Justification » pour un traitement ou un apport sur une
  parcelle AB.
- **Exports** (responsable) : registre AB et liasse HVE en zip (synthèse
  imprimable et CSV). L'export est enregistré sur le calcul ; la page signale
  ensuite les données modifiées depuis.

## Ce qui est contrôlé

### HVE (plan de contrôle V4.4, grille v1.15)

| Indicateur | Calculé | Déclaré (questionnaire annuel) |
|---|---|---|
| Biodiversité | 4.1 IAE (socle sur les terres arables, poids, diversité ; IAE TelePAC validées dans l'onglet IAE), 4.2 taille des parcelles, 4.3 culture principale, 4.4 nombre d'espèces | 4.5 espèces animales, 4.6 ruches, 4.7 variétés et races menacées, 4.8 qualité biologique du sol |
| Stratégie phytosanitaire | 5.1 CMR (liste ministérielle datée), 5.2 surfaces non traitées (IAE comprises), 5.3 IFT (API du ministère, IFT signés), 5.8 diversité variétale | 5.5 surveillance, 5.6 méthodes alternatives, 5.7 limitation des fuites, 5.9 inter-rang |
| Fertilisation | 6.1 bilan azoté (table des exportations du 23/06/2026), 6.3 azote organique, 6.4 outils d'aide à la décision, 6.5 SAU non fertilisée, 6.6 légumineuses, 6.7 couverture des sols (cahier de fertilisation) | azote des animaux, OPI, OAD des cultures mineures, inter-rang |
| Irrigation | exploitation non irrigante validée d'office, 7.1 enregistrement, 7.6 prélèvements en étiage | 7.2 à 7.5 |

### Agriculture biologique (règlements 2018/848 et 2021/1165 consolidé au 01/01/2026)

| Règles | Contrôle |
|---|---|
| R1, R2, R5 | statut de conversion déduit (C1, C2, AB), redémarrage après un produit interdit, produit phyto non utilisable en AB |
| R7, R10, R13 | mixité (même espèce en AB et hors AB ; un genre englobe ses espèces, une culture générique comme « plant » n'est comparée à rien et reçoit une note « espèce à préciser », issue #166), hors-sol, serres chauffées |
| R11 | rotation (légumineuse sur N ans, même espèce au plus K ans, maraîchage) : orange seulement |
| R14 à R17 | fertilisants de l'annexe II, azote minéral, élevages industriels, 170 kg N/ha d'effluents |
| R20, R21 | justification des traitements, cuivre (28 kg/ha sur 7 ans, teneur en cuivre métal d'après E-Phy ou saisie) |
| R24, R25 | semences et plants, dérogations |
| R27 | matériel à usage mixte (procédure « Nettoyage du matériel ») |
| autres | listées « non contrôlé », avec la raison |

## État

| Lot | Contenu | État |
|---|---|---|
| CT1 | socle : menu, page, contrôle à la saisie, réglages | ✅ PR #87 |
| CT2 | AB essentiel : conversion, phyto, cuivre, fertilisants, 170 N | ✅ PR #88 |
| CT3 | HVE : phyto (CT3a), fertilisation (CT3b), irrigation (CT3c) | ✅ PR #89 à #91 |
| CT4 | HVE : biodiversité (CT4a), questionnaire (CT4b) | ✅ PR #92, #93 |
| CT5 | AB : semences, mixité, hors-sol, justification (CT5a) ; matériel, rotation (CT5b) | ✅ PR #94, #95 |
| CT6a | registre AB et liasse HVE | ✅ PR #96 |
| — | 6.7 couverture des sols calculée ; règlement 2021/1165 consolidé | ✅ PR #98, #99 |
| CT6b | export de la grille HVE officielle remplie | ⏳ attend la grille de référence |

## Ce qui reste

Suivi dans [`claudedocs/points_ouverts.md`](../claudedocs/points_ouverts.md) (thème 16) et dans le projet GitHub :

- **Grille HVE de référence** remplie à la main pour la ferme de test (point 119), dans la version du classeur lisible sous LibreOffice (`docs/hve/grille-audit-hvev4-v1.15 - libreoffice.xlsx`, hors dépôt). Elle permet de vérifier les points de Fourmy item par item.
- **Export de la grille officielle remplie** (CT6b, point 118), une fois la grille de référence disponible.
- **Confirmations d'un organisme certificateur** (point 120) : période du plafond de 170 kg N/ha (année civile ou campagne, réglable) ; rattachement du cuivre au manquement n° 328.

Limites connues :
- IFT calculés avant le 20/11/2026 : non signés, à recalculer depuis la fiche de l'intervention.
- Clones de vigne non enregistrés (5.8) ; une réponse par item déclaratif, sans détail par famille de cultures.
- Produits de nettoyage (R28) : la liste de l'annexe IV du 2021/1165 ne s'applique qu'au 01/01/2028.
