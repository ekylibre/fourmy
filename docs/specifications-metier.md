# Spécifications métier de Fourmy

*Établies le 2026-11-12 à partir de la documentation du dépôt (`docs/` et `claudedocs/`), avant l'envoi de l'application en test à la ferme pilote de grandes cultures. Ce document décrit **ce que fait l'application**, en règles de gestion vérifiables. Le pourquoi et le comment sont dans les documents sources cités entre parenthèses.*

Le plan de test qui s'appuie sur ces règles est dans `claudedocs/plan_de_test_global.md`.

## Lire ce document

- **Règle de gestion** `RG-<DOMAINE>-<n>` : un comportement vérifiable (calcul, autorisation, refus, valeur par défaut). Chaque règle cite sa source.
- **Statut** :
  - ✅ réalisé ;
  - 🟡 partiel ;
  - ⏳ prévu, non réalisé.

  Sans mention, une règle est réalisée.
- **Rôles** (vocabulaire unifié) :
  - **responsable** : `owner`, l'exploitant ;
  - **salarié** : `worker`, la personne de terrain ;
  - **administrateur** : celui de l'instance, en ligne de commande.

  La documentation emploie aussi exploitant/salarié et owner/worker.
- **Date de la frise** : l'application montre la ferme à une date choisie (`?at=AAAA-MM-JJ`). Sauf mention, les calculs (stocks, échéances, végétation, parcellaire) se font à cette date.

## Sommaire

1. [Principes transverses](#1-principes-transverses)
2. [Comptes, rôles et fermes](#2-comptes-rôles-et-fermes)
3. [Reprise d'Ekylibre](#3-reprise-dekylibre)
4. [Campagnes, activités et certifications](#4-campagnes-activités-et-certifications)
5. [Parcelles et cartographie](#5-parcelles-et-cartographie)
6. [Interventions](#6-interventions)
7. [Stocks](#7-stocks)
8. [Phytosanitaire : contrôles, registre et IFT](#8-phytosanitaire--contrôles-registre-et-ift)
9. [Météo](#9-météo)
10. [Fertilisation azotée (directive nitrates)](#10-fertilisation-azotée-directive-nitrates)
11. [Cartes de modulation et agrirouter](#11-cartes-de-modulation-et-agrirouter)
12. [Matériels](#12-matériels)
13. [Entretien des matériels](#13-entretien-des-matériels)
14. [Parcours GPS](#14-parcours-gps)
15. [Attelages](#15-attelages)
16. [Télédétection (Sentinel-2)](#16-télédétection-sentinel-2)
17. [Modèle de croissance et irrigation](#17-modèle-de-croissance-et-irrigation)
18. [Plan 3D et jumeau](#18-plan-3d-et-jumeau)
19. [Intégrations](#19-intégrations)
20. [Synchronisation mobile](#20-synchronisation-mobile)
21. [Site public fourmy.org](#21-site-public-fourmyorg)
22. [Hors périmètre et prévu](#22-hors-périmètre-et-prévu)
23. [Points ouverts à arbitrer](#23-points-ouverts-à-arbitrer)

---

## 1. Principes transverses

- **RG-GEN-1** : une seule exploitation par ferme. Les données d'une ferme sont isolées de celles des autres, par `farm_id` et une sécurité par ligne (RLS) sur chaque table métier. (architecture ADR-4)
- **RG-GEN-2** : chaque modification est tracée : qui, quand, d'où (web, mobile, migration, worker), avec l'avant et l'après pour une correction. (FR-TIME-3 ; architecture §4.3)
- **RG-GEN-3** : rien de réglementaire n'est saisi deux fois. Le registre phyto, le cahier de fertilisation, les échéances d'entretien et le stock sont **calculés** à partir des interventions et des mouvements, jamais stockés à part. Corriger une intervention les corrige. (architecture §4.4 ; fertilisation-design D7 ; materiels)
- **RG-GEN-4** : rien n'est effacé dans ce qui a été réalisé. Une intervention réalisée se corrige ou s'annule par contre-passation de ses mouvements. (architecture §4.4 ; interventions §10)
- **RG-GEN-5** : aucune valeur par défaut silencieuse dans un calcul réglementaire. Un terme sans donnée est « manquant ». Un contrôle impossible est « non vérifié », jamais « conforme ». (fertilisation-exigences FR-FERT-39, NFR-FERT-5)
- **RG-GEN-6** : chaque valeur calculée affiche son origine (mesurée, calculée, référence, saisie, valeur de la ferme) et sa source (texte, annexe, page, document constructeur). (NFR-FERT-2, NFR-MAT-3)
- **RG-GEN-7** : un **feu rouge** réglementaire (phyto, nitrates, couverts) n'empêche pas d'enregistrer, mais une réalisation saisie sur le web exige un **motif**. Le motif est conservé et affiché sur la fiche. Le mobile, qui ne connaît pas encore les feux, enregistre et le feu reste visible. (phyto ; fertilisation §Saisie)
- **RG-GEN-8** : l'application fonctionne sans intégration externe. Une intégration en panne dégrade l'affichage (« pas de mesure », « non vérifié ») mais ne bloque jamais un enregistrement. (NFR-MAT-1 ; phyto IFT ; météo)
- **RG-GEN-9** : avant de retirer un justificatif, un couvert, une mesure de pilotage, une analyse, un point d'eau ou une opération, une fenêtre demande confirmation. (fertilisation §Suppressions)
- **RG-GEN-10** : un lien partagé montre la même chose. La date de la frise, l'onglet, la vue et la recherche sont dans l'URL (`?at=`, `?tab=`, `?view=`, `?q=`, `?idx=`, `?sat=`). Les anciennes adresses françaises (`/carte`, `/registre`, `…/modifier`, `?vue=`) redirigent. (architecture §6.4 ; interventions §12)
- **RG-GEN-11** : sur 12 listes, l'utilisateur choisit ses colonnes, mémorisées dans son navigateur. (retours du 10/11, lot U)

## 2. Comptes, rôles et fermes

- **RG-ACC-1** : l'inscription libre est fermée. L'administrateur crée les comptes en ligne de commande, avec un mot de passe lu sur l'entrée standard. Le responsable rattache un compte à sa ferme depuis **Équipe**, avec un rôle. (architecture §5.1 ; deploiement)
- **RG-ACC-2** : pour accéder à une ferme, il faut en être membre. Sinon, l'API répond 403 et le web affiche « Ferme inaccessible ». (architecture §5.1)
- **RG-ACC-3 (responsable)** : tous les droits.
- **RG-ACC-4 (salarié)** : il consulte tout et peut :
  - créer, planifier, réaliser, modifier et annuler des interventions, entretien compris ;
  - saisir un relevé de compteur et la « dernière fois » d'une opération ;
  - créer une intervention depuis des parcours GPS ;
  - écarter une récolte probable ;
  - télécharger les éditions et les fichiers de modulation.
- **RG-ACC-5 (réservé au responsable)** : l'API répond 403 « Opération réservée au responsable de la ferme (owner) » pour :
  - le parcellaire, le sol, les rangs et les certifications ;
  - les activités ;
  - les fiches et plans d'entretien des matériels, les logos, l'avatar, les attelages types ;
  - les relevés « référence » et la suppression d'un relevé ;
  - l'équipe et les personnes ;
  - les intégrations et les imports ;
  - le placement des cuves ;
  - les fertilisants (composition) ;
  - les plans de fumure (saisie, établissement, révision), le zonage, la zone climatique, les points d'eau, les justificatifs ;
  - les cartes de modulation (création, doses, suppression, envoi agrirouter) ;
  - le SIRET et le PACAGE ;
  - les réglages (entretien, parcours GPS) ;
  - l'historique profond Sentinel-2.

  (context.ts `requireOwner` ; documents de domaine)
- **RG-ACC-6** : le menu masque **Équipe** et **Interopérabilité** au salarié. Les écrans réservés au responsable montrent des champs désactivés plutôt que des erreurs. (Layout.tsx)
- **RG-ACC-7** : la session web tient dans un cookie HttpOnly de même origine. Une requête avec cookie venant d'une origine non approuvée est refusée. Le mobile utilise un jeton signé. (architecture §5.1)
- **RG-ACC-8** : un compte peut être membre de plusieurs fermes. La page `/farms` les liste avec le rôle. (FR-ACC-4) 🟡 *(le modèle le permet ; la livraison n'est pas annoncée)*
- ⏳ SSO/OIDC en SaaS ; export complet et suppression RGPD d'une ferme (NFR-SEC-2).

## 3. Reprise d'Ekylibre

- **RG-MIG-1** : la source est toujours une **sauvegarde de tenant** Ekylibre (`.zip`, format 3), restaurée dans une base jetable en lecture seule. Fourmy n'écrit jamais chez Ekylibre. (FR-MIG-4/5)
- **RG-MIG-2** : une reprise se rejoue sans doublon. Les identifiants sont déterministes (UUID v5), et un rejeu met à jour. (architecture §6.1)
- **RG-MIG-3** : ordre de reprise :
  1. campagnes ;
  2. parcellaire ;
  3. bâtiments et cuves ;
  4. matériels ;
  5. articles (rattachés à Lexicon) ;
  6. stocks initiaux ;
  7. interventions et paramètres ;
  8. mouvements.

  Ekylibre 4.37 et 5.0 sont pris en charge. (architecture §6.1)
- **RG-MIG-4** : le rapport donne :
  - les volumes par entité ;
  - les lignes rejetées avec leur raison ;
  - l'écart du registre phyto entre les deux logiciels sur une campagne de référence. Critère : registres identiques. (FR-MIG-3, US-5)
- **RG-MIG-5** : le lancement depuis l'écran **Imports** (responsable) ne donne que le **nom** de la base source, jamais une adresse. L'exécution est asynchrone. (architecture §5.1)
- **RG-MIG-6** : règles de reprise des interventions :
  - une procédure inconnue prend la forme `work` avec le libellé Ekylibre ;
  - une dose dont l'unité finit par `_per_hectare` est une dose par hectare ;
  - les périodes qui se chevauchent sont fusionnées ;
  - les intervenants sont repris par leur nom ;
  - les attelages sont déduits des participations (voir RG-ATT-12) ;
  - une intervention reprise n'est pas recontrôlée (nitrates) et n'est jamais « en retard » au cahier.

  (interventions §9 ; fertilisation-design §5.3)
- **RG-MIG-7** : la reprise crée les activités d'origine et la composition des fertilisants depuis les concentrations Ekylibre, avec l'origine `migrated`. (activites ; FR-FERT-6)

## 4. Campagnes, activités et certifications

- **RG-CAMP-1** : une campagne a une année, un début et une fin. Pour la fertilisation, elle court du 1er septembre au 31 août par défaut, avec une date de début réglable. (architecture §4.3 ; FR-FERT-4)
- **RG-ACT-1** : une production = une parcelle × une campagne × une activité. Le nom d'une activité est unique dans la ferme. Familles : grandes cultures, vigne, élevage, pépinière, transformation, vinification, administration, entretien des outils, prestation. (activites)
- **RG-ACT-2** : une activité se crée depuis une production de référence Lexicon, parmi 473 ; nom, famille, culture et couleur sont pré-remplis. Sans référentiel chargé : « Référentiel Lexicon non chargé ». (activites)
- **RG-ACT-3** : une activité ne se supprime que sans production ; sinon, elle se met en sommeil. Choisir les parcelles d'une campagne crée une production par parcelle ajoutée, sans toucher aux productions des autres activités. (activites)
- **RG-ACT-4** : couleur, dans cet ordre : la couleur choisie, sinon celle de la variété ou de son ancêtre, sinon celle de la production de référence. Image : celle de la variété ou de son ancêtre (`zea_mays` → `zea`), sinon celle de la famille. (activites)
- **RG-ACT-5 (ce que l'activité décide)** :
  - la culture contrôlée par E-Phy ;
  - la culture IFT (`grain_corn` → 1112 Maïs) ;
  - la culture du registre réglementaire ;
  - les usages admis pour une jachère : seulement « Jachères et cultures intermédiaires » et « Traitements généraux ».

  (activites)
- **RG-ACT-6 (certifications)** : AB (en conversion ou certifiée), HVE 1 à 3, AOP/AOC, IGP, Label Rouge, STG, GLOBALG.A.P., Rainforest Alliance, autre. Chacune porte un début, une fin, un organisme et un numéro. Le récapitulatif s'affiche « AB · 3/8 ». (activites)
- **RG-ACT-7** : sur une parcelle AB, ou en conversion, à la date du traitement, un produit sans la mention E-Phy « utilisable en agriculture biologique » est un **feu rouge**. (activites)

## 5. Parcelles et cartographie

- **RG-PARC-1** : une parcelle a des **versions datées** : une géométrie par période, sans chevauchement. Une modification crée une version et clôt la précédente. (architecture §4.3)
- **RG-PARC-2** : un clic sur la carte propose :
  - la parcelle PAC (2015–2024, ou la dernière publiée), avec sa culture déclarée et l'activité correspondante ;
  - les parcelles cadastrales ;
  - la parcelle de la ferme déjà présente.

  « Créer la parcelle » crée en une fois la parcelle (version ouverte au début de la campagne), sa production et ses références. (parcelles)
- **RG-PARC-3** : les références PAC et cadastrales sont stockées et se mettent à jour par « Actualiser PAC et cadastre ». L'onglet Cadastre ne montre que les parcelles recoupées sur plus de 1 %. (parcelles)
- **RG-PARC-4** : fiche parcelle, onglets Général, Cultures, Cadastre, Eau à proximité, Végétation, Sol, Météo, Interventions. (router ; parcelles)
- **RG-PARC-5** : une parcelle référencée par un plan de fumure de moins de 5 campagnes ne peut pas être supprimée. (fertilisation-design §4.4)
- **RG-CARTO-1 (découper)** : la ligne doit entrer et sortir de la surface ; elle n'est jamais prolongée. Plusieurs traversées donnent plusieurs morceaux. Les morceaux partagent exactement leur bord. (carto)
- **RG-CARTO-2 (fusionner)** : les surfaces doivent se toucher ou se chevaucher, sinon refus. Tout ou rien : un refus ne fait perdre aucune surface. (carto)
- **RG-CARTO-3** : un contour qui se croise ou qui est plat est refusé, et la forme revient à son état d'avant. Un polygone à trous est signalé comme non modifiable. Surfaces géodésiques (WGS84) ; le serveur recalcule et fait foi. (carto)
- **RG-CARTO-4** : l'atelier « Outils de dessin (essai) » n'enregistre rien. (carto)
- ⏳ Import et export Telepac (FR-PARC-3), déclaration PAC (FR-REG-2), propriétaires, regroupement en îlots.

## 6. Interventions

### 6.1 Saisie

- **RG-INT-1** : une procédure a :
  - un code Ekylibre conservé, un libellé et une catégorie ;
  - une **forme**, qui impose ses minimums :

    | Forme | Exige |
    |---|---|
    | `work` | ≥ 1 parcelle |
    | `treatment` | ≥ 1 parcelle et ≥ 1 phyto |
    | `fertilization` | ≥ 1 parcelle et ≥ 1 fertilisant |
    | `sowing` | ≥ 1 parcelle et ≥ 1 semence ou plant |
    | `harvest` | ≥ 1 parcelle et ≥ 1 sortie avec destination (lieu, ou cuve pour la vendange) |
    | `maintenance` | ≥ 1 matériel ou bâtiment, sans parcelle ; nature préventive ou curative ; problème obligatoire en curatif |

  Les intrants et sorties doivent appartenir aux natures acceptées par la procédure. (interventions §3)
- **RG-INT-2** : les matériels, produits et intervenants ne sont pas filtrés : ceux les plus utilisés avec la procédure sur 3 ans sont proposés en tête (« Habituels »). (interventions §3.2)
- **RG-INT-3** : une nouvelle intervention est **réalisée** si son début est passé, **à planifier** sinon ; c'est modifiable. Les périodes (au moins une) sont ordonnées et sans chevauchement. Chaque période a une durée qui calcule sa fin, et déplacer le début garde la durée. (interventions §10)
- **RG-INT-4 (ordre du formulaire)** :
  1. Intervention ;
  2. Réalisation et moyens ;
  3. Parcelles et produits (ou matériel entretenu), puis intrants, sorties et motifs ;
  4. Météo ;
  5. Notes.

  (retours du 10/11, lot T)
- **RG-INT-5 (sélection sur carte)** :
  - la bascule entre Liste et Carte garde la sélection ;
  - seules les parcelles existant à la date sont sélectionnables ;
  - un clic ajoute ou retire une parcelle ; Maj + glisser sélectionne un rectangle ;
  - une « zone partielle » dessinée devient la zone de travail de chaque parcelle touchée, avec sa surface ;
  - le serveur recalcule les surfaces.

  (interventions §14)
- **RG-INT-6 (quantités)** :
  - une quantité est par hectare ou totale ;
  - une dose par hectare est multipliée par la surface traitée : somme des surfaces travaillées, sinon zones de travail, sinon surface des parcelles à la date ;
  - une unité incohérente est refusée ;
  - le formulaire affiche le total (« ≈ … au total sur x ha »).

  (interventions §4.3)
- **RG-INT-7 (unité de saisie d'un fertilisant)** :
  - un fertilisant se saisit en t, kg, L ou m³, même stocké dans une autre unité ;
  - la conversion masse/volume passe par la densité de sa composition ;
  - le stock sort dans l'unité de l'article ; l'azote se calcule sur l'unité saisie.
  - Sont refusés :
    - des litres sans densité connue ;
    - une unité non convertible ;
    - un phyto ou une semence hors de son unité (« se saisit dans son unité »).

  (interventions §4.3 ; commit b302414)
- **RG-INT-8** : motifs de traitement : une liste fermée et facultative (herbicide, fongicide, insecticide…), rien de coché par défaut. L'irrigation exige une dose en mm à la réalisation (voir RG-IRR-9). (interventions §4.1, §7.2)
- **RG-INT-9** : une intervention porte un identifiant client et s'enregistre en tout ou rien. Un renvoi ne crée pas de doublon. (interventions §4.3)

### 6.2 Statuts, vues et recherche

- **RG-INT-10** : statuts stockés : planifiée, réalisée, annulée. « En cours » est calculé : une planifiée dont le début est passé. (interventions §10)
- **RG-INT-11** : une planifiée peut être supprimée. Une réalisée s'annule avec un motif, et ses mouvements sont contre-passés à leur date d'origine. Une annulée est en lecture seule. (interventions §4.3, §9)
- **RG-INT-12** : trois vues, dont le choix est gardé dans l'URL (`?view=`) :
  - liste ;
  - kanban (Planifiée, En cours, Réalisée, Annulée) :
    - glisser vers « Réalisée » ouvre la réalisation ;
    - glisser vers « Annulée » demande une confirmation ;
    - un retour en arrière est refusé avec une explication ;
    - les mêmes gestes sont possibles au clavier ;
  - calendrier de la semaine, du lundi au dimanche, qui suit la frise : flèches, « Cette semaine », chaque période à son jour.

  (interventions §12)
- **RG-INT-13** : la recherche porte sur toute la campagne :
  - champs : intervention, parcelle, produit (nom ou AMM), matériel, intervenant, motif, notes ;
  - accents et casse ignorés, tous les mots exigés, recherche dans `?q=` ;
  - objectif : 2 000 interventions en moins de 200 ms.

  (interventions §13)
- **RG-INT-14** : la fiche montre :
  - les périodes, avec le chantier et le temps de travail ;
  - les parcelles et surfaces à la date ;
  - les doses par hectare et totales, la valeur saisie en gras ;
  - les moyens ;
  - la mini-carte et la trace GPS ;
  - les contrôles (phyto, nitrates) avec leur motif, l'IFT, la météo et l'historique.

  (interventions)

### 6.3 Modification et correction

- **RG-INT-15** : une planifiée se modifie directement. Une réalisée donne une **correction tracée** : l'audit garde l'avant et l'après, et la correction contre-passe le **solde net** des mouvements avant de réaliser la nouvelle version. Une correction rejouée n'est pas réappliquée. (interventions §10)
- **RG-INT-16** : une campagne close reste corrigeable, avec un avertissement. Ce que le formulaire n'affiche pas est conservé : surfaces, zones, lots, lieux. (interventions §10)
- **RG-INT-17 (critère de recette)** : après correction d'une dose, le stock et le registre montrent la nouvelle quantité, et l'historique l'ancienne. (exigences_interventions INT-UI-3)

## 7. Stocks

- **RG-STK-1** : le stock à une date est la somme des mouvements jusqu'à cette date, par lot. Toute quantité porte son unité. Fourmy ne connaît pas les prix. (architecture §4.1)
- **RG-STK-2** : réaliser une intervention écrit en une transaction :
  - les mouvements (intrants en négatif, sorties en positif) ;
  - l'audit.

  Le lot le mieux pourvu est utilisé. Une surconsommation est acceptée et signalée (stock négatif). Une sortie exige un lieu. (architecture §4.4, §5.1)
- **RG-STK-3** : écran **Stocks → État des stocks**, en lecture seule. (inventaire)
- ⏳ Achats et ventes saisis, synchronisation Lyvre (FR-STK-3).

## 8. Phytosanitaire : contrôles, registre et IFT

### 8.1 Produits

- **RG-PHY-1** : le référentiel E-Phy (Lexicon) est vérifié chaque jour et remplacé en bloc. Un article se crée depuis le référentiel (nom, autre nom, n° AMM) ou se rattache à un AMM. Les phytos repris avec un AMM sont rattachés d'office. (phyto)
- **RG-PHY-2** : la fiche produit montre les précautions, les EPI et les pictogrammes SGH déduits des mentions H (SGH06 exclut SGH07), avec les pastilles ZNT, DRE et DAR. (phyto)

### 8.2 Contrôle d'un traitement, à sa date

| Contrôle | Rouge | Orange / info |
|---|---|---|
| **Autorisation** | produit retiré ou pas encore autorisé ; aucun usage sur la culture | sans AMM, AMM ou culture inconnus, référentiel absent |
| **Dose** | dose/ha (ramenée à la surface traitée) > maximum | unité non comparable (L/hL, g/m²) |
| **Applications** | maximum par campagne dépassé (même AMM, même parcelle) | — |
| **ZNT** | zone traitée plus proche de l'eau que la ZNT (fossés exclus, cours intermittents compris) | eau non chargée |
| **DAR** | une récolte réalisée ou prévue tombe avant la fin du délai | sinon « récolte possible à partir du … » |
| **DRE** | — | information : « ré-entrée possible le … à … » |
| **Mélange** (arrêté du 07/04/2010) | catégorie 5 avec un autre produit ; deux produits d'une même catégorie 2, 3 ou 4 | — |
| **Bio** | produit non utilisable en AB sur une parcelle AB | — |

- **RG-PHY-3** : un usage vaut pour la culture si ses espèces contiennent la culture, un de ses ancêtres ou un ensemble E-Phy qui la contient. Un usage unique est retenu d'office. Sans choix, on prend la valeur la plus permissive pour la dose et les applications, la plus stricte pour la ZNT et le DAR. (phyto)
- **RG-PHY-4** : le contrôle s'affiche sous chaque intrant, avec un feu global à droite et la bande ZNT sur la carte. La réalisation web d'un traitement rouge exige un motif (RG-GEN-7). (phyto)
- **RG-PHY-5** : l'eau autour des parcelles (BD TOPO de l'IGN, emprise + 200 m) est rechargée tous les 30 jours, ou par « Recharger ». (phyto)

### 8.3 Registre phyto

- **RG-PHY-6** : le registre est calculé à partir des interventions **réalisées** et s'exporte en CSV. (architecture §4.4)
- **RG-PHY-7 (format réglementaire, obligatoire au 01/01/2027)** :
  - une ligne = 1 produit × 1 parcelle traitée ;
  - la dose est en kg/ha, L/ha ou unité/ha, à 4 décimales ;
  - champs dérivés :
    - AMM à 7 chiffres ;
    - heures de début et de fin (heure de Paris) ;
    - surface travaillée ;
    - GPS « lat ; lon » ;
    - mode de conduite bio ;
    - « BBCH nn » ;
    - culture du registre proposée d'après la production (« Maïs grain » → ZEAMX).
  - Les champs obligatoires manquants sont listés (« anomalies »).
  - Exports : CSV réglementaire (« ; », UTF-8 avec BOM) et JSON complet.
  - Pas de télétransmission.

  (phyto §Registre)
- **RG-PHY-8** : seul le responsable écrit le détenteur : SIRET à 14 chiffres, PACAGE à 9 chiffres. (phyto)
- **RG-PHY-9 (applicateur)** : c'est l'intervenant de l'attelage qui porte le matériel de l'intrant, sinon celui qui porte un pulvérisateur, sinon l'attelage unique, sinon tous les intervenants (« applicateur ambigu »). En mode libre, ce sont tous les intervenants. Un attelage sans intervenant donne un feu orange « non renseigné ». (FR-ATT-12)
- ⏳ Cas B à D du registre, prestation de service, délai de rentrée anticipée, volume de bouillie, reprise du SIRET depuis Ekylibre.

### 8.4 IFT

- **RG-PHY-10** : un appel à l'API IFT du ministère est fait par produit et par parcelle, avec :
  - la campagne, l'AMM et la culture IFT ;
  - le type de traitement (cible de l'usage, sinon nature du produit) ;
  - la dose.

  Sans cible, la dose de référence s'applique, avec un avertissement. (phyto)
- **RG-PHY-11** : l'IFT est pondéré par la part de la parcelle traitée. Le bilan de la ferme est une moyenne pondérée par la surface, parcelles non traitées comprises. (phyto)
- **RG-PHY-12** : si l'API est indisponible, l'IFT passe « en attente » avec un nouvel essai 1 h plus tard. « Calculer maintenant » relance. Jamais bloquant. (phyto)

## 9. Météo

- **RG-MET-1** : pour une prévision, l'ordre est meteoblue, OpenWeather (s'ils sont actifs), puis Open-Meteo. Le passé vient d'Open-Meteo, ou d'une station locale (RG-MET-5). La source est toujours enregistrée. (meteo)
- **RG-MET-2** : le point météo est le centre des parcelles à la date, sinon le centre de la ferme. Température, hygrométrie, vent moyen et pluie sont pré-remplis :
  - valeurs observées pour le passé, prévues pour l'avenir ;
  - moyenne sur les périodes, vent maximal, pluie cumulée.

  Une valeur modifiée à la main n'est plus écrasée ; « Reprendre la météo du fournisseur » annule la saisie. (meteo)
- **RG-MET-3** : le worker complète les interventions réalisées sans météo, 10 par minute. (meteo)
- **RG-MET-4 (conditions de pulvérisation)** : créneaux horaires avec une raison au survol et le prochain créneau favorable.

  | | Favorable | À surveiller | Défavorable |
  |---|---|---|---|
  | Vent | ≤ 2 m/s | < 5 m/s | ≥ 5 m/s |
  | Hygrométrie | 75–95 % | 50–75 % ou 95–99 % | autre |
  | Température | 5–25 °C | 0–5 ou 25–30 °C | autre |
  | Pluie | ≤ 0,1 mm/h | ≤ 0,3 mm/h | au-delà |

  (meteo)
- **RG-MET-5** : une intervention passée prend d'abord la station Weenat ou Sencrop active la plus proche, si elle est à moins de 5 km et couvre au moins 80 % des heures. Source affichée : « station … à x km ». Les stations sont synchronisées toutes les heures. 🟡 *(non vérifié sur un vrai compte)* (meteo)
- **RG-MET-6** : les clés des fournisseurs sont testées avant d'être enregistrées, chiffrées, et jamais réaffichées. (meteo ; RG-INTG-2)

## 10. Fertilisation azotée (directive nitrates)

Périmètre : Nouvelle-Aquitaine (PAN 7, PAR 7 NA, référentiel GREN NA du 29/07/2025, zonage Adour-Garonne du 24/08/2026, COMIFER). (fertilisation)

### 10.1 Zonage et obligations

- **RG-NIT-1** : chaque parcelle a un statut de zone vulnérable : dedans, en partie, dehors ou inconnu. Le statut vient de sa commune et de l'arrêté de bassin. Le responsable confirme parcelle par parcelle une commune classée en partie. « Actualiser le zonage » recalcule. (fertilisation-design D10)
- **RG-NIT-2** : en zone vulnérable, sont obligatoires :
  - un plan prévisionnel (PPF) et un cahier d'enregistrement par îlot, fertilisé ou non ;
  - une analyse de sol annuelle au-delà de 3 ha ;
  - la conservation sur 5 campagnes.

  Hors zone vulnérable, ils sont « non obligatoires ». (FR-FERT-2)
- **RG-NIT-3** : zone climatique APLSH par défaut « D'après le département » (Sud-Ouest pour 24, 33, 40, 47 et 64), modifiable par le responsable. (fertilisation-design §5.6)
- **RG-NIT-4** : la page **Réglementaire → Fertilisation azotée** montre :
  - les obligations ;
  - l'encadré « À compléter pour la campagne », en 6 étapes, avec les liens vers chaque écran ;
  - les plans de la campagne ;
  - le suivi de la campagne ;
  - les parcelles ;
  - les points d'eau.

  (fertilisation)

### 10.2 Sols, analyses et points d'eau

- **RG-SOL-1** : la fiche sol porte le type de sol régional (annexe 7), la profondeur d'enracinement et le point d'eau d'irrigation. (fertilisation-design §4.3)
- **RG-SOL-2** : trois types d'analyse, chacun avec un bulletin joint possible :
  - reliquat sortie d'hiver ;
  - reliquat post-récolte par horizons ;
  - analyse de terre (MO, N, argile, calcaire, pH, CEC).

  Une mesure de reliquat l'emporte sur l'estimation. (FR-FERT-11)
- **RG-SOL-3** : un point d'eau a une origine (surface ou souterraine) et une teneur en nitrates. Sans mesure, la référence est 25 mg/L (surface) ou 40 mg/L (souterraine). (fertilisation-design §3.3)

### 10.3 Fertilisants

- **RG-FTZ-1** : la composition d'un fertilisant comprend :
  - N total (%, kg/t ou kg/m³) et sa part minérale ;
  - P2O5, K2O, SO3 ;
  - la densité ;
  - le type réglementaire (0, Ia, Ib, II, III) ;
  - l'indicateur foliaire ;
  - l'origine : proposée, confirmée, analyse ou reprise.

  Fourmy propose une composition d'après le nom (« Urée 46 »), sinon le code Lexicon, sinon la famille organique. Elle est à confirmer. (FR-FERT-5)
- **RG-FTZ-2** : une analyse de produit remplace la référence pendant 5 ans. Un organique se rattache à l'annexe 5 (Keq) et à une dénomination COMIFER ou un C/N (APLSH). (FR-FERT-7)
- **RG-FTZ-3** : N total/ha = dose/ha × teneur. N efficace = N total pour un minéral, N total × Keq pour un organique. Un apport sans teneur est « à compléter ». Un produit sans azote ne figure pas au cahier. (fertilisation-design §3.1)

### 10.4 Plan prévisionnel de fumure (PPF)

- **RG-PPF-1** : un plan par parcelle, par campagne et par type (principal ou couvert exporté). « Préparer les plans » crée les brouillons pré-remplis et liste les manques. (FR-FERT-16)
- **RG-PPF-2 (méthode selon la culture)** :
  - maïs et sorgho : bilan CAU en deux temps ;
  - céréales à paille : bilan CAU ;
  - colza : bilan additif ;
  - autres cultures : dose plafond ;
  - tournesol, tabac, lin et prairies : dose externe seulement.

  (FR-FERT-10)
- **RG-PPF-3** : chaque terme est résolu dans cet ordre :
  1. valeur de la ferme (avec un motif tracé) ;
  2. mesure ;
  3. calcul de Fourmy ;
  4. référence régionale ;
  5. sinon « manquant », et la dose n'est pas calculée.

  Chaque terme affiche sa source. (fertilisation-design §3.3)
- **RG-PPF-4 (maïs, 64)** : X = [(Pf + Rf) − (Ri + Mh + Mhp + Mr + MrCi + Nirr + N avant 4 feuilles)] / CAU − Xa.
  - CAU vaut 0,6 avant 4 feuilles et 0,8 après.
  - Pf = b × objectif, avec b = 2,3, 2,2 ou 2,1 selon l'objectif ; arrondi à l'unité.
  - L'objectif est la moyenne olympique des 5 dernières campagnes. Exemple : 118,7 / 85 / 123,2 / 117,2 / 80 donnent 107 q/ha. À défaut, la référence départementale.

  (fertilisation-design §3.2–3.5)
- **RG-PPF-5** : estimations des termes.
  - **Ri** : estimé par la grille sol × APL × pluie, interpolé. Il est manquant si l'APL dépasse 100 kg ou si la pluie est sous la grille.
  - **Nirr** : Nirr = Q × NO3 / 443, au-delà de 100 mm (maïs). Exemple : 160 mm à 40 mg/L donnent 14 kg.
  - **N avant 4 feuilles (starter)** : l'azote minéral du semis à 30 jours après remplit ce terme, sauf saisie.

  (fertilisation-design §5.2, §5.13)
- **RG-PPF-6** : une valeur hors grille n'est jamais extrapolée : une mesure est demandée. Une dose négative interdit les types II et III. Une dose de moins de 30 kg devient un forfait de 30 kg à confirmer. Les plafonds sont respectés : 210 kg pour les autres cultures, 120 kg pour le chanvre. (fertilisation-design §3.3, §5.1)
- **RG-PPF-7** : une dose d'outil ou de conseiller (outil, conseiller, date, justificatif) remplace la dose calculée. L'écart avec le calcul est montré sans bloquer. (FR-FERT-12)
- **RG-PPF-8 (fractionnement proposé)** :
  - maïs semé avant le 1er mai : premier apport ≤ 50 kg efficaces avant 4 feuilles, 2 apports au-delà de 120 kg ;
  - céréales d'hiver : 50 kg, puis 2 ou 3 apports ;
  - colza : 80 kg.

  La réserve de pilotage (40 kg) laisse le dernier apport « à ajuster ». (FR-FERT-13)
- **RG-PPF-9 (états)** : brouillon, puis **établi** (version 1 figée), puis **révisé** (version n+1, avec motif).
  - Une version est immuable : entrées, termes, résultat, version du référentiel, auteur, date.
  - Le plan doit être établi avant le premier apport de sortie d'hiver. Un apport sans plan établi donne un avertissement.

  (FR-FERT-14/15)
- **RG-PPF-10 (pilotage)** : une mesure (date, stade, outil, valeur, dose conseillée) fixe la dose permise : dose du plan − réserve + dose conseillée. Seule une mesure justifie un dépassement. (FR-FERT-17)
- **RG-PPF-11 (couvert exporté)** : plan séparé, dose saisie de l'extérieur, 70 kg efficaces par défaut (30 à 70 kg en ZAR). (fertilisation-design §5.12)
- **RG-PPF-12** : les justificatifs sont des PDF, JPEG ou PNG, reconnus au contenu, 10 Mio au plus. Ajout et retrait par le responsable, lecture par tous. (fertilisation-design §5.4)

### 10.5 Contrôles à la saisie d'un apport

L'encadré « Directive nitrates » du formulaire se met à jour pendant la saisie. Il montre :
- l'azote total et efficace ;
- le calendrier ;
- le plan et la dose restante ;
- le premier apport ;
- les conditions d'épandage ;
- le couvert ;
- l'APLSH ;
- l'efficacité.

- **RG-CTL-1 (calendrier)** : la période d'interdiction dépend :
  - du type de fertilisant ;
  - de la culture en place ou à venir ;
  - des zones de la commune.

  Exemple : type III sur céréales d'automne, interdit du 01/09 au 15/01 en zone sud. Exceptions :
  - maïs irrigué ;
  - 30 kg sur colza ;
  - un foliaire est hors calendrier.

  Un type inconnu donne « calendrier non vérifié ». (FR-FERT-25)
- **RG-CTL-2 (feu rouge)** : une intervention **réalisée** saisie sur le web en période d'interdiction est refusée sans motif (fenêtre « Feu rouge réglementaire », commune au phyto). Le motif est affiché sur la fiche et au cahier. (fertilisation §Saisie)
- **RG-CTL-3** : messages qui ne bloquent jamais.
  - **Orange** :
    - dépassement de la dose du plan sans mesure ;
    - premier apport au-delà de 50 kg sur maïs ou céréales ;
    - sol gelé (minimum ≤ 0 °C) ;
    - types 0 à II à moins de 35 m d'un cours d'eau ;
    - APLSH au-delà de 70 kg ;
    - apport plus de 15 jours avant le semis du couvert.
  - **Rappel** : pluie ≥ 15 mm, pentes près de l'eau.

  (fertilisation-design §5.3–5.8)
- **RG-CTL-4 (couverts)** : en rouge, avec motif obligatoire : apport sur repousses, sur légumineuses pures, dans les 30 jours avant la destruction, type III sur un CINE, CINE en ZAR. Plafonds : CINE 50 kg, CIE 70 kg, ZAR 30 ou 50 kg. (fertilisation-design §5.8)
- **RG-CTL-5 (efficacité, grille COMIFER 2022)** : note de −2 à 17, d'après :
  - pH et CEC ;
  - la couverture (NDVI) ;
  - la pluie à 3 jours ;
  - le vent ;
  - la température.

  Elle donne une qualité par forme d'engrais (bonne, moyenne, limite, à éviter). Une donnée inconnue donne une fourchette. Sans effet sur la dose. (fertilisation-design §5.7)

### 10.6 Cahier d'enregistrement et couverture des sols

- **RG-CAH-1** : le cahier est calculé, jamais stocké. Pour chaque parcelle, il donne :
  - l'interculture et les résidus ;
  - le couvert ;
  - le semis, la récolte et le rendement ;
  - chaque apport : date, surface, produit, teneur, type, dose dans l'unité saisie, N total et efficace, conditions ;
  - l'APLSH et le pilotage ;
  - le total comparé au plan établi ;
  - les épandages interdits, avec leur motif.

  (FR-FERT-19)
- **RG-CAH-2** : un apport saisi plus de 30 jours après l'épandage est « en retard », sauf s'il est repris d'Ekylibre. (FR-FERT-22)
- **RG-CAH-3** : éditions imprimables (une page par plan) et cahier, en impression ou PDF depuis le navigateur. Le cahier s'exporte en CSV, avec les unités en clair. (fertilisation-design D9, §5.13)
- **RG-COU-1** : couverture des sols en zone vulnérable :
  - après un maïs grain : couvert avant le 01/12, ou cannes broyées et enfouies dans les 15 jours ;
  - récolte du 15/09 au 15/10 : couvert sous 15 jours ;
  - sinon : couvert avant le 30/09 ;
  - maintien 2,5 mois, destruction au plus tôt le 15/11.

  En cas d'écart, « à vérifier ». Le lien « saisir le broyage des cannes » ouvre une intervention pré-remplie. (fertilisation-design §5.5, §5.11)
- ⏳ Type réglementaire calculé d'après l'analyse, élevage et plafond de 170 kg, eDAPLOS, rôle conseiller, mobile hors ligne, autres régions, bilan de Fourmy pour le tournesol, les prairies, le lin et le tabac.

## 11. Cartes de modulation et agrirouter

- **RG-MOD-1** : le responsable crée une carte depuis Cartes → Modulation, l'onglet Végétation d'une parcelle ou « Moduler » sur un apport du plan. Il choisit :
  - un indice (NDVI, NDRE ou NDMI) ;
  - de 2 à 5 zones ;
  - une image de moins de 3 ans, avec au moins 80 % de la parcelle mesurée.

  (modulation)
- **RG-MOD-2 (zonage)** :
  - zones par quantiles, de surfaces voisines ; la zone 1 a l'indice le plus faible ;
  - lissage par deux passes de filtre majoritaire ;
  - pixels sans mesure comblés par le plus proche ;
  - contours découpés par la parcelle.

  (modulation)
- **RG-MOD-3 (doses)** :
  - unités kg/ha, L/ha ou grains/ha ;
  - stratégie compenser, valoriser ou uniforme ;
  - dose de base au milieu, ± un écart en % aux extrêmes ;
  - bornes de la machine ;
  - arrondi à 1 kg, 1 L ou 1 000 grains ;
  - doses modifiables à la main ;
  - quantité totale affichée.

  (modulation)
- **RG-MOD-4 (depuis le plan)** :
  - « Moduler » n'apparaît que si le produit a une teneur ;
  - l'image retenue est la plus proche avant la date prévue ;
  - la case « Garder la dose du plan en moyenne pondérée », cochée, recentre les doses ;
  - avertissement au-delà de 2 % d'écart ;
  - la fiche de la carte compare la dose prévue et la moyenne, et le plan liste ses cartes.

  (modulation)
- **RG-MOD-5 (exports, ouverts à tous les membres)** :
  - **ISO-XML (ISO 11783-10 v4.2)** :
    - une zone par dose, plus « Hors parcelle » à 0 et « Dose par défaut » ;
    - grille à la largeur de travail ;
    - refus au-delà de 250 000 mailles.
  - **Shapefile WGS84** : attributs ZONE, DOSE, UNITE, PRODUIT, INDICE, SURF_HA.

  (modulation)
- **RG-MOD-6 (agrirouter)** :
  - la connexion est faite par le responsable, avec un consentement à usage unique valable 30 min ;
  - les destinataires retenus sont ceux qui ont une route pour l'un des deux formats ;
  - « Envoyé » veut dire accepté par agrirouter, sans accusé de livraison ;
  - l'historique garde la date, le format, les destinataires, l'auteur et l'état ;
  - la déconnexion retire l'intégration même si agrirouter ne répond pas ;
  - sans configuration du serveur, la connexion est désactivée et l'écran le dit.

  🟡 *(aucun essai réel : pas de compte développeur agrirouter)* (modulation)

## 12. Matériels

- **RG-MAT-1** : la liste montre les matériels en service, et « Tous » ajoute les réformés et vendus.
  - Filtre par nature ; recherche par nom, marque ou n° de série.
  - Colonnes : logo, nature, marque et modèle, dernier relevé, badge « Traccar ».
  - « Nouveau matériel » est réservé au responsable ; « Relevé » est ouvert à tous.

  (materiels)
- **RG-MAT-2** : fiche, onglets Général, Technique, Relevés, Historique, Entretien, Pièces, 3D, et Parcours (affiché s'il existe des parcours). L'onglet Historique liste les interventions où le matériel est entretenu ou utilisé. (materiels)
- **RG-MAT-3 (compteur)** : en heures par défaut pour les tracteurs et automoteurs ; aucun pour les autres natures.
  - Un relevé doit rester entre le précédent et le suivant, sinon 409 avec le voisin (« 4 300 h < 4 321 h du 02/11 »).
  - Un saut plus rapide que l'horloge est accepté avec un avertissement.

  (materiels)
- **RG-MAT-4 (correction d'un relevé)** : « C'est une correction » exige un type et un motif.
  - « Saisie fausse » : les relevés antérieurs plus élevés sont barrés.
  - « Compteur remplacé » : la valeur repart de zéro, mais les heures d'usage continuent.
  - La suppression d'un relevé est réservée au responsable, et seulement pour un relevé manuel ou de référence.

  (materiels)
- **RG-MAT-5** : la marque saisie est rattachée à une marque de la ferme, sans tenir compte de la casse. La marque porte un logo et une couleur partagés. Logo :
  - PNG, JPEG ou SVG, 1 Mo au plus, type vérifié par les octets ;
  - un SVG est converti en PNG ;
  - les fichiers sont servis sans exécution possible.

  (materiels)
- **RG-MAT-6 (import « Base matériel »)** :
  - fichiers lus : machine, sources, fiche technique, plan d'entretien, fluides, pièces ;
  - rattachement au matériel choisi, sinon au même n° de série, sinon à un nouveau matériel ;
  - le modèle reste propre à la ferme ;
  - un réimport ne crée pas de doublon et garde les ajustements ;
  - une visite initiale antérieure au matériel est « non applicable » ;
  - une opération liée à une option absente arrive retirée.

  (materiels)
- **RG-MAT-7** : dans la fiche technique, chaque valeur affiche sa source (document, page), ses alternatives et ses notes. (FR-MAT-5)
- **RG-MAT-8 (avatar 3D)** : valeurs dans cet ordre : saisie, puis fiche technique, puis défaut du gabarit, chacune avec sa provenance.
  - Gabarits : tracteur, automoteur, outil traîné, pulvérisateur traîné, outil porté, remorque, équipement fixe.
  - Diamètre des roues calculé depuis le pneu (« 540/65 R30 » → 1,46 m).
  - Proportions d'un tracteur standard : capot haut et étroit, cabine au-dessus du pont arrière, lest à l'avant.
  - Couleur : saisie, sinon marque, sinon gabarit.
  - Un GLB importé (5 Mo et 100 000 triangles au plus) remplace l'avatar, qui reste rétablissable.

  (materiels)
- ⏳ Photo, documents, autres sources d'heures, références équivalentes, périodicité en km.

## 13. Entretien des matériels

- **RG-ENT-1** : les échéances sont calculées à la date de la frise, jamais stockées. Prochaine échéance = dernière réalisation + périodicité (heures et/ou mois), le premier terme atteint s'appliquant. Dernière réalisation, dans cet ordre :
  1. intervention réalisée ;
  2. sinon « dernière fois connue » ;
  3. sinon mise en service.

  (materiels ; FR-MAT-20)
- **RG-ENT-2 (états)** :
  - en retard, bientôt (50 h ou 1 mois par défaut, réglable), à renseigner, à jour ;
  - aussi : non applicable, selon besoin, fait (opération ponctuelle).

  Tri par urgence. Sans relevé, l'échéance suit les mois, avec une mention. (materiels)
- **RG-ENT-3** : « Dernière fois » (tout membre) renseigne une opération ; « Amorcer le plan » (responsable) renseigne toutes celles à renseigner. Le responsable ajuste le plan d'un matériel sans toucher au modèle. (materiels)
- **RG-ENT-4** : une opération réalisée est une **intervention d'entretien** :
  - préventive si une opération du plan est cochée, curative sinon, avec le problème obligatoire ;
  - seule une intervention **réalisée** remet les échéances à zéro ;
  - son relevé de compteur crée un relevé contrôlé comme RG-MAT-3, recréé à la correction et supprimé à l'annulation.

  (materiels)
- **RG-ENT-5** : cocher une opération ajoute ses pièces une seule fois ; pièces et fluides sortent du stock.
  - Contrôle : RAS ou anomalie. Une anomalie propose « Planifier une réparation », pré-remplie.
  - Atelier externe : nom et n° de bon ; les blocs Matériels et Météo sont masqués.

  (materiels)
- **RG-ENT-6 (heures estimées)** : avec Traccar actif, le worker estime les heures de fonctionnement chaque jour, toutes les 15 min. Affichage : « ≈ 4 337 h (estimé) ». Un relevé réel fait foi ; un écart de plus de max(10 h, 10 %) est signalé. (materiels)
- **RG-ENT-7 (pièces à commander)** :
  - horizon de 100 h, 200 h, 3, 6 ou 12 mois ;
  - pièces des opérations dues, regroupées par référence ;
  - besoin, stock à la date et reste à commander ;
  - export CSV.

  (materiels)
- **RG-ENT-8 (alertes par e-mail)** : un récapitulatif par ferme, au plus toutes les heures, aux membres choisis, une seule fois par échéance et par état. Sans SMTP, rien n'est marqué envoyé. (materiels)

## 14. Parcours GPS

- **RG-GPS-1** : le worker découpe les positions Traccar en parcours **de travail** ou **de déplacement**, toutes les 5 min.
  - Une position est « au travail » **seulement** si le boîtier envoie `working`.
  - Un arrêt de plus de 15 min coupe le parcours ; un demi-tour de moins de 15 min ne le coupe pas.
  - Un parcours de moins de 3 min ou de 200 m est écarté.
  - Le découpage est déterministe.

  (parcours-attelages ; workflow 09/11)
- **RG-GPS-2** : réglages par ferme, modifiables par le responsable, avec « Recalculer maintenant » sur 90 jours. Changer un réglage recalcule les parcours libres ; les parcours rattachés restent figés. (parcours-attelages-design §2.4)
- **RG-GPS-3** : onglet Parcours d'un matériel :
  - 30 derniers jours par défaut ;
  - colonnes : date, heures, durée, type, distance, surface couverte, parcelles, outil, état (libre ou rattaché), « trace modifiée » ;
  - filtres ; carte de la sélection.

  Une parcelle est retenue au-delà de 5 % de sa surface ou de 500 m². (materiels)
- **RG-GPS-4 (outil)** : il est trouvé dans cet ordre :
  1. l'attelage d'une intervention ;
  2. l'outil annoncé par le boîtier, relié à la main ;
  3. le seul outil d'une intervention libre.

  Un nom approchant n'est qu'une suggestion. L'onglet d'un outil sans boîtier montre les parcours des tracteurs qui l'ont tiré. (materiels)
- **RG-GPS-5 (créer l'intervention)** : on coche des parcours libres d'un même boîtier, puis un brouillon s'ouvre :
  - attelages ;
  - une période par parcours ;
  - parcelles et zones de travail ;
  - procédures suggérées et indices.

  Rien n'est enregistré avant validation. Refus (409) : parcours déjà rattaché, plusieurs matériels, plus de 50 parcours. (parcours-attelages-design §4.3)
- **RG-GPS-6 (ajouter à une intervention)** : on choisit une intervention du même jour. Les périodes et les parcelles manquantes s'ajoutent. Une intervention réalisée est corrigée, avec la trace « Parcours GPS ajoutés ». Une intervention planifiée reste planifiée. (materiels)
- **RG-GPS-7** : un parcours n'est lié qu'à une intervention. Annuler ou supprimer l'intervention le libère. Des positions arrivées après coup ne modifient jamais un parcours rattaché, mais il prend le badge « trace modifiée » si ses bornes bougent de plus d'une minute. (parcours-attelages-design §6)
- **RG-GPS-8** : le widget « Parcours GPS » du tableau de bord donne, par matériel, sur le jour ou 7 jours : durée, distance, surface, déplacements, parcelles et parcours libres. (materiels)
- **RG-GPS-9** : la couverture d'une parcelle utilise les positions « au travail » et la largeur de l'outil. Validation : +1,5 % par rapport à Traccar. (architecture §6.2)

## 15. Attelages

- **RG-ATT-1** : deux modes.
  - **Libre** (par défaut) : matériels, intervenants et périodes indépendants.
  - **Attelages** : chaque attelage a ≥ 1 matériel, 0 à n intervenants et ≥ 1 période. Deux attelages peuvent travailler en même temps.

  (FR-ATT-1)
- **RG-ATT-2** : périodes.
  - Dans un attelage, sans chevauchement ; entre attelages, chevauchement permis.
  - Un même matériel ou une même personne dans deux attelages qui se chevauchent, dans la même intervention, est une erreur. Entre deux interventions différentes, c'est un avertissement.

  (FR-ATT-2/3)
- **RG-ATT-3** : passer de « attelages » à « libre » demande une confirmation, avec la liste de ce qui est perdu. Passer de « libre » à « attelages » crée un attelage unique. (FR-ATT-4)
- **RG-ATT-4** : deux durées. Le **chantier** va du premier début à la dernière fin ; le **temps de travail** est la somme des périodes. Exemple : 8 h-10 h et 9 h-12 h donnent un chantier de 8 h à 12 h et 5 h de temps de travail. (FR-ATT-5)
- **RG-ATT-5** : attelages types : nom unique, matériels, intervenants. Ils se lisent par tous et s'écrivent par le responsable.
  - « Reprendre un attelage type… » copie matériels et intervenants.
  - « Enregistrer comme attelage type » crée un type depuis la saisie.
  - Modifier un type ne change pas le passé.

  (FR-ATT-6)
- **RG-ATT-6** : en mode attelages, la trace, le calendrier, la recherche et le rejeu 3D utilisent les périodes de l'attelage du matériel ou de la personne. (FR-ATT-7)

## 16. Télédétection (Sentinel-2)

- **RG-SAT-1** : un compte Copernicus (CDSE) **par exploitant**, saisi par le responsable dans Intégrations, avec un budget mensuel facultatif (3 000 requêtes par défaut).
  - Le test d'enregistrement compte les acquisitions des 30 derniers jours (« 9 acquisitions, dont 4 exploitables »).
  - Le secret n'atteint jamais le navigateur.
  - Seule la géométrie des parcelles part chez CDSE.

  (teledetection-design §1, §8.3, §10)
- **RG-SAT-2 (synchronisation)** :
  - toutes les 6 h, sur une fenêtre de 10 jours ;
  - historique depuis le 1er janvier de l'année précédente ;
  - au plus 20 dates par synchronisation ;
  - le budget atteint arrête la synchronisation jusqu'au mois suivant ;
  - un échec n'écrit rien.

  (teledetection-design §3)
- **RG-SAT-3 (mesure)** :
  - nuages, ombres et neige sont exclus ;
  - bords retirés de 10 m ;
  - une date est **exploitable** pour une parcelle si au moins 80 % de la parcelle est mesurée ;
  - une parcelle de moins de 30 pixels est « trop petite pour Sentinel-2 » ;
  - une date nuageuse s'affiche en gris ;
  - **aucune valeur n'est inventée**.

  (teledetection §Règles)
- **RG-SAT-4** : une valeur est **ancienne** au-delà de 20 jours (badge orange). Statut d'une parcelle à la date : à jour, ancienne, aucune, trop petite. (teledetection-design §7)
- **RG-SAT-5 (indices)** :
  - NDVI par défaut, NDRE et NDMI au choix (`?idx=`) ;
  - courbe lissée (Whittaker) ;
  - référence : médiane des années précédentes.

  L'onglet Végétation couvre les 12 mois avant la frise, avec les interventions en repères. (teledetection)
- **RG-SAT-6** : la couche satellite (Aucun, NDVI, Couleurs, Par parcelle) est partagée par la carte 2D et le plan 3D. Elle montre la dernière image exploitable à la date de la frise. La mention « Contient des données Copernicus Sentinel modifiées » figure partout. (teledetection)
- **RG-SAT-7 (récoltes probables non saisies)** :
  - chute du NDVI de ≥ 0,5 à ≤ 0,3 en 45 jours, confirmée par la mesure suivante ;
  - non expliquée par une récolte, un labour, un broyage ou une fauche ;
  - alerte après 30 jours, hors vigne.

  Deux actions : « Saisir la récolte » (pré-remplie) et « Ce n'est pas une récolte ». (teledetection §lot Z)
- ⏳ Bouton « historique profond » dans l'interface (l'API existe), Sentinel-1, LAI, fournisseur de secours.

## 17. Modèle de croissance et irrigation

- **RG-CRO-1** : la saison part du dernier semis réalisé dans les 400 jours. Elle s'arrête à la première récolte, broyage, fauche ou labour réalisé (« Récoltée »). (modele-croissance)
- **RG-CRO-2** : degrés-jours par la moyenne, plafonnés à 30 °C.
  - **Maïs** (base 6) : levée 100, 6 feuilles 380, 10 feuilles 580, floraison 950, maturité 1 850, récoltable 2 050.
  - **Céréales à paille** (base 0) : levée 150, tallage 450, épi 1 cm 1 100, épiaison 1 500, floraison 1 600, maturité 2 350, récoltable 2 550.

  Une autre culture donne « pas de modèle ». (modele-croissance)
- **RG-CRO-3** : chaque date de stade indique son origine : observée, prévue (16 jours) ou « d'après les normales ». Un stade futur s'affiche « vers le … ». Une panne météo utilise le cache, et sans cache le modèle le dit. (modele-croissance)
- **RG-IRR-1** : bilan hydrique FAO-56.
  - Réserve utile de 100 mm par défaut, saisie par le responsable entre 10 et 400 mm.
  - Stress sous 45 % de la réserve accessible.
  - Jours de stress comptés, et à part autour de la floraison.

  (modele-croissance)
- **RG-IRR-2** : une parcelle **déclarée irriguée** sans irrigation saisie est simulée en pilotage idéal, et affiche un « besoin d'irrigation » au lieu du stress. (modele-croissance)
- **RG-IRR-3 (saisie d'une irrigation)** :
  - dose en mm (1 mm = 10 m³/ha), obligatoire à la réalisation, 100 mm au plus ;
  - matériel facultatif (enrouleur, pivot…) ;
  - le volume est affiché ;
  - la dose est refusée sur une autre procédure.

  Une irrigation compte comme une pluie le jour de son début. (modele-croissance)
- **RG-IRR-4** : le tableau de bord signale le stress hydrique, une irrigation à prévoir sous 3 jours (« Saisir l'irrigation », pré-rempli), une floraison sous 10 jours et une culture récoltable sous 15 jours. (modele-croissance)
- ⏳ WOFOST, autres cultures, stations locales, efficience, quotas.

## 18. Plan 3D et jumeau

- **RG-3D-1** : le plan 3D est la ferme à la date de la frise :
  - relief IGN, avec un relief plat signalé en cas de panne ;
  - orthophoto ;
  - bâtiments BD TOPO (6 m par défaut, complétables) ;
  - parcelles et image satellite drapée.

  (architecture §6.3 ; jumeau-3d)
- **RG-3D-2 (végétation)** : la phase vient du NDVI des 240 derniers jours et des interventions : en végétation, en maturation, récolté (chaumes), sol nu, repos pour la vigne. **Rien** sans mesure récente, sauf hauteur tirée du modèle de croissance, et l'encadré le dit. Profils : maïs 2,5 m, triticale 1,2 m, vigne. (jumeau-3d)
- **RG-3D-3 (rangs)** : orientés sur le grand axe de la parcelle, modifiables par le responsable, avec retour à l'automatique. (jumeau-3d)
- **RG-3D-4** : la météo du jour donne l'ambiance : pluie, sol mouillé à partir de 3 mm sur 48 h, gelée. Libellé type : « Pluie, 6,9 mm, 19 à 25 °C · sol mouillé ». (jumeau-3d)
- **RG-3D-5 (cuves)** : chaque cuve est placée automatiquement dans son bâtiment et dimensionnée d'après sa capacité. Le liquide suit la frise. Le responsable peut les déplacer. Au clic : volume, contenu et derniers mouvements. (architecture ADR-10)
- **RG-3D-6 (rejeu)** : on choisit un matériel et le jour de la frise, puis « Charger » et Lecture à ×60, ×300 ou ×900.
  - L'avatar suit la trace, posé sur le relief et orienté selon le cap, avec les outils attelés derrière lui.
  - Toute la journée est tracée en trait léger, et la partie parcourue passe en couleur.

  (materiels §Plan 3D)
- **RG-3D-7 (caméra)** :
  - **Derrière le matériel** (par défaut) : à 25 m, tourne avec le cap ;
  - **Drone** : plongée à 45° sur toute la zone travaillée, rotation lente ; l'avatar est à sa taille réelle ;
  - **Libre**.

  « Tous les matériels suivis » montre leur dernière position sur 30 jours. (materiels)

## 19. Intégrations

- **RG-INTG-1** : les accès externes se configurent **par ferme**, par le responsable, dans Interopérabilité → Intégrations. Ils sont classés par thème : Météo, Suivi GPS – Matériels, Télédétection, OAD. (deploiement ; retours du 10/11)
  - Météo : OpenWeather, meteoblue, Weenat, Sencrop.
  - Suivi GPS – Matériels : Traccar.
  - Télédétection : Copernicus.
  - OAD : agrirouter.
- **RG-INTG-2** : chaque configuration est testée avant d'être enregistrée. Le secret est chiffré et jamais réaffiché. L'adresse d'un service doit être publique et en HTTPS. (deploiement)
- **RG-INTG-3 (fréquences)** :
  - Traccar : chaque minute ;
  - parcours : toutes les 5 min ;
  - heures estimées : toutes les 15 min ;
  - stations : chaque heure ;
  - Sentinel-2 : toutes les 6 h ;
  - destinataires agrirouter : chaque heure.

  (deploiement)
- **RG-INTG-4** : couper une intégration arrête ses synchronisations sans rien supprimer. Les boîtiers Traccar non rattachés sont listés pour être reliés à un matériel. (materiels)

## 20. Synchronisation mobile

- **RG-SYNC-1** : chaque intervention est envoyée en tout ou rien. Le résultat est `applied` ou `failed` avec un motif. Un renvoi ne crée pas de doublon. (architecture §5.3)
- **RG-SYNC-2** : si le serveur a modifié l'intervention depuis le dernier pull, la réponse est 409 et le mobile refait un pull. Une intervention à attelages modifiée par un mobile ancien est refusée avec un message. Les relevés de compteur sont idempotents. (architecture §5.3 ; FR-ATT-8)
- 🟡 L'application mobile (dépôt séparé) ne connaît pas encore les feux réglementaires ni les attelages.

## 21. Site public fourmy.org

- **RG-SITE-1** : « Se connecter » ouvre l'application. La version est calculée depuis Git (`feat` → mineure, `fix` → correctif) et c'est la même sur l'API et sur le site. (site-public-exigences)
- **RG-SITE-2** : le changelog ne retient que `feat` et `fix`, avec la ligne `Public:` à la place du titre si elle existe. La construction échoue si un nom de pilote ou un identifiant interne y figure. (site-public-exigences AU-2/3)
- **RG-SITE-3** : formulaire de contact (nom, e-mail, profil, message, consentement), avec un champ piège et une limite de débit. Rien n'est stocké. Sans SMTP : « indisponible ». Pas de cookie ni de traceur tiers. (site-public-exigences)
- **RG-SITE-4** : captures et vidéos montrant une ferme pilote seulement avec son **accord écrit**, et les paroles qui lui sont prêtées validées par elle. (site-public-exigences ; videos/journee-semis-mais)

## 22. Hors périmètre et prévu

- **Hors périmètre** : CUMA/ETA, réservation et facturation de matériel, prix et coûts (relevant de Lyvre), comptabilité.
- **Prévu** :
  - viticulture et registres (FR-VITI) ;
  - élevage ;
  - planification de campagne ;
  - plugins ;
  - API publique documentée ;
  - MCP/Aiffel ;
  - HVE (indicateurs) ;
  - Telepac ;
  - consoles ISOBUS (FR-GPS-3) ;
  - suivi en direct ;
  - sauvegardes de la base en production ;
  - export RGPD.

## 23. Points ouverts à arbitrer

**À valider avec la ferme pilote**
1. Le **14-48 liquide** est confirmé le 12/11/2026 : 14 % N, 48 % P2O5, densité 1,4, type III, en litres. Cette correction n'existe que dans la base locale. Un nouvel import depuis Ekylibre la ramène en tonnes et à 10 %.
2. **Données de la ferme** :
   - SIRET et PACAGE à saisir (registre réglementaire) ;
   - type de sol, reliquats, analyses d'eau et de terre ;
   - parcelles irriguées non déclarées ;
   - 8 récoltes de maïs 2026 non saisies ;
   - outils Traccar annoncés mais non reliés (« Tigre », « UF1201 », « MC18R ») ;
   - journées sans signal `working`.
3. **Reprise** :
   - 12 cibles rattachées à la mauvaise parcelle à la reprise ;
   - 36 productions à culture générique, en orange « non vérifiable » ;
   - 2 lignes de 2024 sans culture du registre.
4. Le plan d'entretien de l'Arion 430 vient d'une notice antérieure à son n° de série : il est à valider.

**Règles à figer**
5. **Rôles** :
   - les imports sont réservés à `owner` dans le code, mais à un « admin » dans certains documents ;
   - tout membre, salarié compris, peut écarter une récolte probable.
6. **Alertes d'entretien** : récapitulatif horaire réalisé, quotidien dans la conception.
7. **Parcours GPS** : travail détecté seulement par `working`, alors que FR-GPS-11 prévoyait une déduction par la vitesse.
8. **Registre réglementaire** : dose en kg/hL ou L/hL, séparateur GPS, libellé BBCH, contrôle de Luhn du SIRET.
9. **Exigences** :
   - l'exigence IFT parle d'un compte serveur, alors que l'API est ouverte ;
   - les contrôles hors ligne (PHY-3, GEO-1) ne sont pas réalisés (contrôle par le serveur).

**Dépendances externes**
10. Accord du COMIFER (et de l'INRA pour Rf) pour les tables embarquées : la demande est en brouillon. Labellisation COMIFER exigée après le 08/08/2027.
11. PAR 7 NA scanné, avec un recours en cours : calendriers de la zone ouest à confirmer.
12. agrirouter, Weenat et Sencrop jamais essayés avec de vrais comptes. Les CGU de CDSE pour un SaaS ne sont pas tranchées.
13. Droits sur la base matériel Claas et sur les captures d'une ferme pilote avant toute diffusion.
