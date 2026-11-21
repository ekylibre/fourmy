# Points ouverts de Fourmy

*Recensés le 2026-11-12 dans toute la documentation (`docs/`, `claudedocs/`, README, historique Git) et dans le journal de recette. Revus le 2026-11-16 (déploiement, TIKA, projet GitHub, agrirouter) et le 2026-11-20 (imports, contrôles HVE et AB). Mis à jour le 2026-11-13 après les lots « Équipe et personnes » (P1 à P5), « Ma ferme » (F1 à F5) et « Itinéraires techniques » (T0 à T3). Cette liste alimente la roadmap du projet GitHub [Fourmy — Roadmap](https://github.com/orgs/ekylibre/projects/2) : les points P1 et P2 y sont les issues n° 1 à 37 du dépôt, dans l'ordre de cette liste (jalons « Envoi ferme pilote » et « Fin 2026 ») ; les points P3 y sont des brouillons. Le suivi se fait désormais dans le projet GitHub.*

Chaque point se lit ainsi : **titre** : description. *nature · priorité · source*.

**Priorités :**
- **P1** : avant l'envoi à la ferme pilote ;
- **P2** : dans les prochaines semaines ;
- **P3** : plus tard.

**Natures :** bug, évolution, donnée, décision, externe, juridique, doc, exploitation, dette.

**Numérotation :** les points 1 à 94 gardent leur numéro du 12/11. Les points nouveaux commencent à 95 et sont rangés dans leur thème.

## Mise à jour du 2026-11-21

- **Semences (SE1 à SE8, PR #121 à #127, puis la PR de SE8)** : Stocks → Semences, fiche (espèce, variété, code GNIS, conditionnement, PMG avec repères Arvalis et Terres Inovia), PMG par lot, catalogue officiel des variétés, rattachement proposé (code GNIS, espèce importée, référence Lexicon, nom repris d'Ekylibre), semis en grains/m², kg/ha, milliers ou doses avec conversion figée, mélanges dosés par espèce, couverts repris du semis, utilisation par campagne et export CSV (`docs/semences.md`). Restent les points 129 à 134 (thème 18, issues #129 à #134).
- **Recette locale (SE8)** : ferme pilote de grandes cultures reprise d'Ekylibre (26 semences, toutes les unités reconnues ; le rattachement proposé passe de 1 à 26 semences grâce aux noms « Semence de maïs - DKC5065 », dont 14 avec leur code GNIS) et ferme test des imports Geofolia (42 propositions, 23 sûres).

## Mise à jour du 2026-11-20

Du 17 au 20/11 : imports et assistant de premier démarrage, puis contrôles HVE et Agriculture biologique.

- **Imports (IM1 à IM6, PR #81 à #86)** : DAPLOS, Geofolia et TelePAC importés de bout en bout, historique N-1 à N-5, annulation d'un import, assistant de premier démarrage avec reprise d'une sauvegarde Ekylibre (`docs/imports.md`). Reste la recette avec l'exploitant testeur (IM7, point 121).
- **Contrôles HVE et AB (CT1 à CT6a, PR #87 à #96 ; puis #98 et #99)** : menu « Contrôle HVE » / « Contrôle AB » sous Réglementaire dès qu'une parcelle est certifiée ; quatre indicateurs HVE (biodiversité avec IAE, stratégie phytosanitaire avec CMR et IFT certifié, fertilisation avec bilan azoté et couverture des sols calculée, irrigation), questionnaire annuel ; contrôle AB des règles R1 à R34 (conversion déduite, phyto, cuivre, fertilisants de l'annexe II, 170 N, semences et dérogations, mixité, matériel, rotation ; règles hors contrôle dites « non contrôlé ») ; feux à la saisie ; registre AB et liasse HVE exportés (`docs/controles-hve-ab.md`).
- **Prérequis traités** : version consolidée du règlement 2021/1165 au 01/01/2026 lue (PR #99, `docs/ab/rapport_ab.md` §8.6).
- **Restent** (thème 16) : export de la grille HVE officielle remplie (118), grille de référence remplie à la main (119), confirmations d'un organisme certificateur (120), recette des imports (121).
- **Qualité** : le test `lexicon`, instable en CI (délai de 5 s face au verrou du référentiel), est corrigé (PR #97).
- **Projet GitHub** : nouvelles issues #100 (point 118), #101 (119), #102 (120), #103 (121), jalon « Fin 2026 ».
- **Assolement prévisionnel, temps 1 (AS1a à AS4, PR #105, #106, #108 à #111)** : retour de l'exploitant testeur « je ne trouve pas comment créer l'assolement 2027 ». Menu Assolement dans Activités, écran carte et liste, affectation, dérobées, couverts, découpe et fusion datées, contrôles en direct (BCAE 7, délais de retour Triple Performance, AB et HVE, ZNT, captages, Natura 2000), validation et versions (`docs/assolement.md`). Restent les points 122 à 128 (thème 17, issues #112 à #118) ; correctif du contrôle HVE et AB en direct (PR #107).

## Mise à jour du 2026-11-16

Le matin, aucun commit depuis le 13/11 (dernier : PR #56). L'après-midi et le soir : reprise de l'intégration agrirouter (ci-dessous).

### agrirouter, point d'avancement du 16/11 au soir

Besoins : `claudedocs/besoins_agrirouter.md` ; conception et lots : `claudedocs/conception_agrirouter.md` ; fonctionnement : `docs/modulation.md`.

- **Portail agrirouter (production)** : application « Fourmy », marque Ekylibre, Deep URL `https://fourmy.org/agrirouter`, version 1 soumise pour revue avec 4 capacités (TaskData en envoi et réception, Shapefile en envoi, TimeLog et Device Description EFDI en réception), client OAuth de dev.fourmy.org. Jeton obtenu et flux d'événements ouvert en production (essais en lecture seule). Identifiants dans le `.env.prod` des ressources, sauf l'ID de version (après « Testing approved »).
- **Décisions** : machines virtuelles (VCU) retirées du périmètre ; parcelles poussées de Fourmy vers agrirouter seulement ; travaux reçus proposés en intervention, à valider.
- **Lots** :

  | Lot | Contenu | État |
  |---|---|---|
  | AR1 | connexion conforme à la revue, Deep URL, déconnexion constatée | ✅ fusionné (#61) |
  | AR2 | écoute des événements, fichiers reçus rangés et confirmés | PR #62 à relire |
  | AR3 | file d'envoi, reprise après coupure | PR #63 (sur #62) |
  | AR4 | TaskData reçus lus, proposés en intervention | PR #64 (sur #63) |
  | AR5 | descriptions de machine et journaux EFDI versés aux parcours | PR #65 (sur #64) |
  | AR6 | machines virtuelles | retiré |
  | AR7 | synchro des parcelles (AgmaSync) | à faire, après la réponse du support |
  | AR8 | préparation de la revue d'implémentation | à faire |

- **Bloquant** : aucun essai réel tant que la version 1 n'est pas « Testing approved » et sans compte IO-Tool. Le message au support (accès IO-Tool, validation de la version, déclaration des parcelles, échantillons, contrat) est rédigé et reste à envoyer (point 111).
- **Essayé sur** : un TaskData réel public (console Topcon, isoxml-js, Apache 2.0) et des messages synthétiques. Doses, surfaces, DDI et EFDI sont à confirmer sur de vrais fichiers (point 114).

État vérifié le 16/11 :

- **Avancés** :
  - 95 : le déploiement est fait. dev.fourmy.org et fourmy.org servent la version 0.113.1 (commit `eeeffbf` du 13/11, 19:15), qui contient tous les lots du 12 et 13/11. Il reste à vérifier sur dev.fourmy.org le préchargement IGN, la copie hors ligne et le worker (point 2) ;
  - 105 : la première demande de fusion (`dom-natif`) est ouverte chez OSFarm le 13/11 ([osfarm/itineraire-technique#47](https://github.com/osfarm/itineraire-technique/pull/47)), sans relecture pour l'instant. Les huit autres attendent sa fusion.
- **Projet GitHub** (mis à jour le 16/11) :
  - nouvelles issues : #57 (point 95, P1), #58 (point 98, P2), #59 (point 105, P2) ;
  - passent « In Progress » : #14, #24, #31, #57 et #59 ;
  - le brouillon du point 17 est clos et archivé.
  - agrirouter (soir) : #20 (point 55) passe « In Progress », avec un commentaire d'avancement ; nouvelles issues #66 (point 111), #67 (112), #68 (113), #69 (114).
- **Avancés par agrirouter** :
  - 55 : application enregistrée, connexion conforme, essais en lecture seule sur la production ; l'essai sur console attend la validation de la version et l'IO-Tool ;
  - 46 : une carte revenue réalisée d'une console est reconnue et proposée avec l'intervention (AR4, PR #64).
- **Fait (code, PR à fusionner)** : 57, réception agrirouter (AR2 à AR5, PR #62 à #65).
- **Nouveaux** : 111 à 117 (thème 9).
- **Hors dépôt** : `claudedocs/PPF/` (sources COMIFER, PAR 7 et leurs extraits pour la fertilisation, environ 29 Mo de documents sous droits) est ignoré par `.gitignore` et reste sur le poste.

## Mise à jour du 2026-11-13

- **Fait** :
  - 17 : reprise du SIRET depuis Ekylibre, par l'import de l'identité de la ferme ;
  - 104 : `docs/interventions.md` §7.1 renvoie déjà à la conception de l'équipe.
- **Avancés** :
  - 15 : le contrôle de Luhn du SIRET est fait ;
  - 35 : le champ « Outil annoncé par Traccar » existe sur la fiche de l'outil, il reste à le renseigner ;
  - 64 : SIRET et PACAGE se saisissent dans « Ma ferme », ou sont repris d'Ekylibre ;
  - 71 : accord écrit obtenu le 12/11 pour les captures, il reste à faire valider les phrases prêtées ;
  - 80 : le rôle « Lecture seule » existe.
- **Nouveaux** :
  - 95 à 97 : déploiement et mobile ;
  - 98 à 104 : « Ma ferme » et équipe ;
  - 105 à 110 : itinéraires techniques, nouveau thème 15.
- **Projet GitHub** : les nouveaux points P1 et P2 (95, 98 et 105) n'ont pas encore d'issue. Le brouillon du point 17 est à clore.
- **Aussi livré le 13/11** (sans point ouvert) : menu du compte et changement de mot de passe, onglets Équipe et Préférences dans « Ma ferme », version en pied de menu, attente du préchargement IGN signalée, liste de TIKA masquée au départ.

## Récapitulatif

| Thème | P1 | P2 | P3 | Total |
|---|---|---|---|---|
| 1. Mise en production et exploitation | 3 | 2 | 2 | 7 |
| 2. Mobile | 0 | 2 | 2 | 4 |
| 3. Interventions, interface web, ferme et équipe | 0 | 2 | 9 | 11 |
| 4. Phyto et registre | 0 | 2 | 1 | 3 |
| 5. Fertilisation | 0 | 4 | 6 | 10 |
| 6. Matériels et entretien | 0 | 0 | 7 | 7 |
| 7. GPS et attelages | 1 | 2 | 4 | 7 |
| 8. Télédétection, croissance, modulation, 3D | 0 | 1 | 10 | 11 |
| 9. Intégrations externes | 0 | 8 | 7 | 15 |
| 10. Données de la ferme pilote | 5 | 4 | 0 | 9 |
| 11. Site public et vidéos | 1 | 2 | 1 | 4 |
| 12. Juridique et partenariats | 0 | 1 | 3 | 4 |
| 13. Dette technique et qualité | 0 | 3 | 6 | 9 |
| 14. Nouveaux domaines | 0 | 0 | 7 | 7 |
| 15. Itinéraires techniques | 0 | 1 | 5 | 6 |
| 16. Imports, contrôles HVE et AB | 0 | 4 | 0 | 4 |
| 17. Assolement prévisionnel | 0 | 3 | 4 | 7 |
| **Total** | **10** | **41** | **74** | **125** |

Plus trois points faits (17, 104 et 57, ce dernier en PR à fusionner), hors du total.

## 1. Mise en production et exploitation

1. **Sauvegardes de la base et coffre des clés** : planifier les sauvegardes et garder `FOURMY_SECRETS_KEY` et `BETTER_AUTH_SECRET` à part. Depuis AR2, sauvegarder aussi le volume `fourmy_agrirouter_files` (fichiers reçus, non renvoyés par agrirouter). *exploitation · P1 · deploiement.md « Sauvegardes »*
2. **Vérifier le worker sur dev.fourmy.org** : Traccar, Copernicus, IFT, Lexicon, eau, parcours, et depuis le 13/11 le préchargement IGN. *exploitation · P1 · plan_de_test §8 T-PHY-6*
3. **Production Eyona** : domaine, adresse de l'application (`app.fourmy.org` ?), cible de « Se connecter », API IFT de production. *décision · P2 · deploiement.md, site-public-exigences §6*
4. **Boîte contact@fourmy.org et SMTP** : sans eux, pas de formulaire de contact, pas d'alertes d'entretien, et les invitations se font par lien copié (équipe, décision 7). *externe · P2 · site-public-exigences §6*
5. **Webhook Dokploy du site** : vérifier le secret de redéploiement. *exploitation · P3 · deploiement.md*
95. **Déployer les lots du 12 et 13/11 sur dev.fourmy.org**, puis vérifier le préchargement IGN et la copie hors ligne. Le déploiement comprend :
    - les migrations 0044 à 0053, appliquées au démarrage de l'API ;
    - le volume `fourmy_ign_cache`, monté dans l'API et dans le worker ;
    - l'accès au dépôt GitHub du fork TIKA, à la construction de l'image.

    **Avancé le 16/11** : version 0.113.1 en ligne sur dev.fourmy.org et fourmy.org. Il reste les vérifications.

    *exploitation · P1 · conception_ma_ferme §8, conception_itineraires_techniques §12 quater*
96. **Surveiller la place prise par le cache IGN** sur le serveur (seuil de confirmation à 2 Go par ferme). *exploitation · P3 · conception_ma_ferme §13*

## 2. Mobile (zero-mobile)

6. **Build EAS et essai sur appareil** : carte, précache, note de version, fusion de `fourmy-backend`, synchro des personnes (lot P5). Passe en P1 si l'envoi inclut le mobile. *évolution · P2 · README*
7. **Contrat des attelages** dans le pull et le push (`staffing`, `crews`). *évolution · P2 · FR-ATT-8*
8. **Feux réglementaires et contrôles hors ligne** (phyto, nitrates) : périmètre à trancher. *décision · P3 · specs §20, §23*
97. **Copie hors ligne de la ferme sur le mobile** : MapLibre Native, tuiles du relais IGN. *évolution · P3 · besoins_ma_ferme décision 12, conception_ma_ferme §12*

## 3. Interventions, interface web, ferme et équipe

9. **Relevé de compteur en fin de chantier** dans le formulaire : l'API l'accepte déjà. *évolution · P2 · FR-MAT-60*
10. **« Réalisée d'emblée » en une seule requête** : une coupure entre la création et la réalisation laisse une intervention planifiée. *bug · P3 · plan_de_test §8*
11. **Messages d'erreur** : « Accès refusé … (owner) » sur Équipe et Intégrations, préfixe « Règle métier — ». *bug · P3 · plan_de_test §8*
12. **Procédures propres à une ferme** : ajout et masquage. *évolution · P3 · interventions.md §3*
13. **« Parcelle inconnue » après une modification** : vu une fois, non reproduit. *bug · P3 · plan_de_test §8*
98. **Valider les décisions de conception de « Ma ferme »**, déjà construites (§13, points 1 à 7) :
    - identité portée par `farms` ;
    - adresse portée par le site siège ;
    - cache IGN sur un volume disque ;
    - toutes les tuiles passent par l'API ;
    - service worker écrit à la main ;
    - hors ligne en consultation seulement ;
    - zoom 18 autour des parcelles, seuils de 2 Go et 500 Mo.

    *décision · P2 · conception_ma_ferme §13*
99. **En-tête imprimé du registre phyto officiel** (logo, raison sociale, SIRET), comme le plan de fumure. *évolution · P3 · conception_ma_ferme §12 quater*
100. **E-mail d'échéance des certifications**, une fois le SMTP en place. Aujourd'hui, l'alerte est sur le tableau de bord. *évolution · P3 · conception_ma_ferme §12 quater*
101. **Archive PMTiles pour la copie navigateur**, seulement si des fermes dépassent largement 50 000 tuiles. *évolution · P3 · conception_ma_ferme §12 septies*
102. **Coût de main-d'œuvre**, à rouvrir avec le coût des chantiers. *évolution · P3 · besoins_equipe_personnes §6*
103. **Export de paie des temps de travaux**. *évolution · P3 · besoins_equipe_personnes décision 8*
104. ~~**Décision §7.1 de `docs/interventions.md`**~~ : **fait**. Elle renvoie à `docs/equipe-personnes-design.md` depuis la revue du 12/11. *doc · P2 · besoins_equipe_personnes §7*

## 4. Phyto et registre

14. **Export PDF du registre phyto** : la route répond 501. *évolution · P2 · routes/registers.ts*
15. **Figer le format réglementaire** : dose en kg/hL ou L/hL, séparateur GPS, libellé BBCH. Le contrôle de Luhn du SIRET est fait (« Ma ferme » F1). *décision · P2 · specs §23.8*
16. **Cas B à D de l'arrêté**, prestation de service, délai de rentrée anticipée, volume de bouillie. *évolution · P3 · phyto.md*
17. ~~**Reprise du SIRET depuis Ekylibre**~~ : **fait le 2026-11-13**. L'import reprend l'identité de la ferme (SIRET, TVA, NAF, forme juridique, adresse), sans écraser ce qui est déjà saisi (« Ma ferme » F3). *évolution · P3 · specs §8.3*

## 5. Fertilisation

18. **Envoyer la demande d'accord au COMIFER** (et à l'INRAE pour Rf) : désigner l'expéditeur. *juridique · P2 · demande_accord_COMIFER.md*
19. **Labellisation COMIFER** : cahier des charges et coût ; exigée après le 08/08/2027. *externe · P3 · fertilisation-design §12.3*
20. **PAR 7 Nouvelle-Aquitaine** : calendriers « zone Ouest », Béarn, tableau des couverts ; suivre le recours. *externe · P2 · fertilisation-exigences §8*
21. **Valider les lectures choisies par Fourmy** : annexe 5, grille d'efficacité, zone APLSH par défaut, premier apport sur maïs. *décision · P2 · fertilisation.md*
22. **Comparer le plan avec la méthode actuelle de la ferme pilote** (cas de référence). *validation · P2 · fertilisation-exigences §8*
23. **Apport d'automne quand la parcelle suivante existe déjà** : il reste compté au précédent, pas en ligne d'apport. *limite · P3 · plan_de_test §8 T-FERT-5*
24. **Adaptations 2 à 11 du tableau 12 et limite de 20 % de la SAU**. *évolution · P3 · fertilisation.md*
25. **Cultures non couvertes** : couvert exporté, tournesol, prairies, lin, tabac ; type réglementaire calculé d'après l'analyse. *évolution · P3 · specs §10*
26. **Autres régions**. *évolution · P3 · fertilisation-exigences §7*
27. **Mise à jour annuelle des références** : valeur A, classement des variétés de blé. *donnée · P3 · fertilisation-design §12.5*

## 6. Matériels et entretien

28. **Photos et documents d'un matériel** (lot fichiers). *évolution · P3 · FR-MAT-6/7/58*
29. **Rattacher les entretiens repris d'Ekylibre au plan**. *évolution · P3 · FR-MAT-59*
30. **Plan d'entretien des bâtiments et des cuves**. *évolution · P3 · FR-MAT-62*
31. **Autres sources d'heures et périodicités** : Karnott, chantiers, km, pièces équivalentes. *évolution · P3 · FR-MAT-15/43/61*
32. **Rattacher les fluides préconisés à des articles**. *évolution · P3 · materiels.md*
33. **Relevés** : le motif de correction manque dans la colonne Note, et un cadre vide s'affiche. *bug · P3 · plan_de_test §8*
34. **Fréquence des alertes d'entretien** : horaire ou quotidienne. *décision · P3 · specs §23.6*

## 7. GPS et attelages

35. **Relier les outils annoncés par Traccar** (« Tigre », « UF1201 », « MC18R ») : sinon, la procédure suggérée est fausse. Depuis le 12/11, le champ « Outil annoncé par Traccar » de la fiche de l'outil fait le lien, et les parcours libres sont reliés dès l'enregistrement. Il reste à le renseigner pour ces trois outils. *donnée · P1 · plan_de_test §8*
36. **Travail sans signal `working`** : confirmer la décision, ou déduire le travail de la vitesse ou de l'outil. *décision · P2 · specs §23.7*
37. **Lien d'un parcours vers le rejeu**. *évolution · P2 · FR-GPS-14*
38. **Attelage 3D d'après l'attribut `tool`**, outil articulé en virage. *évolution · P3 · FR-MAT-85*
39. **Plusieurs matériels dans une même sélection de parcours**. *évolution · P3 · FR-GPS-25*
40. **Sens du compteur `appliedArea`** des boîtiers. *externe · P3 · parcours-attelages §8*
41. **Suivi en direct** : aujourd'hui, la dernière position seulement. *évolution · P3 · FR-VIZ-5*

## 8. Télédétection, croissance, modulation et 3D

42. **Outils de relief** : profil, pente, ombrage, courbes de niveau (US-4). *évolution · P2 · FR-VIZ-4*
43. **Bouton « historique profond »** : l'API existe. *évolution · P3 · teledetection.md*
44. **Test Copernicus : nombre d'images exploitables**. *évolution · P3 · plan_de_test §8 T-INTG-2*
45. **Modulation** :
    - prévenir quand l'image ne s'y prête pas (sol nu) ;
    - ne pas proposer par défaut une image postérieure à la frise ;
    - zonage sur plusieurs années.

    *évolution · P3 · plan_de_test §8*
46. **Lier une carte de modulation à l'intervention qui l'applique**. Avancé le 16/11 : une carte revenue réalisée d'une console est reconnue et citée dans la proposition d'intervention (AR4) ; le lien n'est pas encore gardé sur l'intervention. *évolution · P3 · modulation.md*
47. **Signalements** : semis non saisi, confirmation NDMI ou Sentinel-1. *évolution · P3 · teledetection.md*
48. **Sentinel-1, LAI, fournisseur de secours**. *évolution · P3 · specs §16*
49. **Modèle de croissance** : précocité, vernalisation, autres cultures, stations locales. *évolution · P3 · modele-croissance.md*
50. **WOFOST et assimilation du LAI** (`services/agro`). *évolution · P3 · FR-TWIN-8*
51. **Irrigation** : efficience, volumes par point, quotas, carte des sols. *évolution · P3 · modele-croissance.md*
52. **Rendu 3D** : vigne par LiDAR, plantes et vent, lumière, 3D Tiles, Cesium ou Giro3D. *évolution · P3 · jumeau-3d.md*

## 9. Intégrations externes

53. **API Carto de l'IGN** : en 404 le 12/11 (PAC et cadastre) ; à revérifier. *externe · P2 · plan_de_test §8*
54. **Weenat et Sencrop avec de vrais comptes**. *externe · P2 · meteo.md*
55. **agrirouter en conditions réelles** : compte développeur, essai sur console. **Avancé le 16/11** : compte développeur validé, application et version 1 enregistrées en production, client OAuth de dev.fourmy.org, connexion conforme à la revue (AR1, #61). Reste l'essai sur console. *externe · P2 · modulation.md*
56. **CGU de CDSE pour un SaaS**. *juridique · P2 · specs §23.12*
57. ~~**Réception agrirouter** (TimeLogs, doses appliquées) et consoles ISOBUS~~ : **fait le 16/11**, PR #62 à #65 à fusionner. Fichiers reçus rangés et confirmés, TaskData proposés en intervention, journaux EFDI versés aux parcours GPS. *évolution · P3 · FR-GPS-3*
58. **Telepac et déclaration PAC**. *évolution · P3 · FR-PARC-3, FR-REG-2*
59. **Synchronisation Lyvre** : stocks, consommations, pièces. *évolution · P3 · FR-STK-3, US-8*
60. **Serveur MCP pour Aiffel**. *évolution · P3 · FR-API-2, US-7*
61. **Capteurs génériques** : OGC SensorThings, API DSA de Weenat. *évolution · P3 · FR-CAP-2, FR-TWIN-9*
111. **Écrire au support agrirouter** (support@agrirouter.com) : compte IO-Tool, passage de la version 1 en « Testing approved », déclaration des parcelles (AgmaSync), échantillons TaskData et EFDI, contrat de participation. Message rédigé le 16/11. *externe · P2 · besoins_agrirouter §3*
112. **Synchro des parcelles (AgmaSync, lot AR7)** : exploitation, parcelles et contours poussés vers agrirouter, chargement initial, révisions. À coder après la réponse du support sur la déclaration. *évolution · P2 · conception_agrirouter §8*
113. **Préparer la revue d'implémentation (lot AR8)** : deux fermes de démonstration, testeurs DKE invités, déroulé écrit, `docs/agrirouter.md`. *doc · P2 · conception_agrirouter §11*
114. **Confirmer sur de vrais fichiers avec l'IO-Tool** : envoi d'une carte, redélivraison après coupure (question B), DDI de dose et de surface (2, 7, 12, 116), messages EFDI (DDI 141, 397, 66 à 68, forme G4). *externe · P2 · conception_agrirouter §12*
115. **Purger les fichiers envoyés** à agrirouter après 90 jours (volume `fourmy_agrirouter_files`). Les fichiers reçus sont gardés et doivent être sauvegardés (point 1). *exploitation · P3 · conception_agrirouter §3*
116. **Fuseau horaire par ferme** : les heures des consoles sans fuseau sont lues à l'heure de Paris. *évolution · P3 · conception_agrirouter AR4*
117. **Produits reçus d'une console vers les intrants** : correspondance entre le nom du produit de la console et l'article de la ferme ; aujourd'hui, produit et dose s'affichent seulement dans le bandeau. Sections d'un matériel à garder sur sa fiche. *évolution · P3 · conception_agrirouter AR4, AR5*

## 10. Données de la ferme pilote

62. **14-48 liquide** : corriger l'article dans Ekylibre (litres, 14 % N, 48 % P2O5, densité 1,4), ou garder les corrections locales à la reprise. *donnée · P1 · specs §23.1*
63. **Apport du 16/04/2026** : il est saisi en kg/ha ; le passer en L/ha s'il s'agissait de litres. *donnée · P1 · plan_de_test §8*
64. **SIRET et PACAGE** : à saisir dans « Ma ferme », onglet Identité. Le SIRET est repris d'Ekylibre s'il y est renseigné. *donnée · P1 · specs §23.2*
65. **Types de sol, reliquats, analyses de terre et d'eau**. *donnée · P1 · specs §23.2*
66. **Claas Arion 430** :
    - importer la base matériel ;
    - valider le plan (notice antérieure au n° de série) et l'amorcer (50 opérations en retard sinon) ;
    - renseigner marque, modèle et année ;
    - confirmer la prise de force avant ;
    - saisir l'historique.

    *donnée · P1 · plan_de_test §8 T-ENT-1*
67. **Parcelles irriguées à déclarer**. *donnée · P2 · specs §23.2*
68. **8 récoltes de maïs 2026 à saisir**. *donnée · P2 · specs §23.2*
69. **Défauts de la reprise** : 12 cibles sur la mauvaise parcelle, 36 productions à culture générique, 2 lignes 2024 sans culture. *donnée · P2 · specs §23.3*
70. **ZNT de Lespourcy** : fossé ou cours d'eau ? *donnée · P2 · plan_de_test §8*

## 11. Site public et vidéos

71. **Accord écrit de la ferme pilote et validation de ses phrases**, avant toute diffusion de captures ou de la vidéo. L'accord écrit pour les captures est obtenu (12/11). Il reste à faire valider les phrases qui lui sont prêtées (vidéo, site). *juridique · P1 · RG-SITE-4*
72. **Roadmap publique** : contenu à valider. *doc · P2 · site-public-exigences §6*
73. **Page `/fourmy/` d'ekylibre.com** : relecture et date de bascule. *décision · P2 · site-public-exigences §6*
74. **Vidéo du semis** : musique, voix off, tracteur générique. *évolution · P3 · videos/journee-semis-mais*

## 12. Juridique et partenariats

75. **Droits sur la base matériel Claas**. *juridique · P2 · specs §23.13*
76. **Préparer l'ouverture du dépôt en AGPL** : retirer les noms des pilotes et les contours de leurs parcelles. *juridique · P3 · deploiement.md*
77. **Licence des plugins privés**. *juridique · P3 · FR-PLG-4*
78. **Dépôt de la marque à l'INPI**. *juridique · P3 · requirements §8*

## 13. Dette technique et qualité

79. **Documentation OpenAPI**. *doc · P2 · FR-API-1*
80. **Figer les rôles** : qui lance les imports (`owner` ou admin), le droit d'un salarié d'écarter une récolte probable. Le rôle « Lecture seule » existe depuis le 12/11. *décision · P2 · specs §23.5*
81. **Garder les documents d'état à jour** (README, requirements) à chaque lot. *doc · P2 · recensement du 12/11*
82. **RGPD** : export complet et suppression d'une ferme. *évolution · P3 · NFR-SEC-2*
83. **SSO/OIDC en SaaS**, multi-exploitation annoncée. *évolution · P3 · FR-ACC-2/4*
84. **Compression Timescale compatible avec la RLS** ; NATS. *dette · P3 · architecture §11*
85. **Tests web sous Node 25 sans `NODE_OPTIONS`**. *dette · P3 · mémoire du poste de dev*
86. **Recette à rejouer** : modulation depuis le plan, fertilisation complète, plusieurs matériels. *qualité · P3 · plan_de_test §8*
87. **i18n et procédure d'auto-hébergement**. *évolution · P3 · NFR-UX-2, NFR-OSS-1*

## 14. Nouveaux domaines

88. **Viticulture** : interventions, déclaration de récolte, registre de cave et DRM, parcellaire viticole. *évolution · P3 · FR-VITI-1..4*
89. **Élevage** : N1 (lots), puis N2 (individus et registre), puis N3 (EDE/BDNI). *évolution · P3 · requirements §4.2*
90. **Plugins** : manifeste de permissions, isolation. *évolution · P3 · FR-PLG-1..5*
91. **Planification de campagne**. *évolution · P3 · FR-PLAN-1*
92. **Indicateurs HVE**. *évolution · P3 · FR-REG-4*
93. **Traçabilité des lots**, de l'intrant à la récolte. *évolution · P3 · FR-STK-4*
94. **Standards d'échange** : NGSI-LD, eDAPLOS, ADAPT. *évolution · P3 · FR-API-4*

## 15. Itinéraires techniques

105. **Reverser les contributions TIKA à OSFarm** : neuf demandes de fusion en série (la 9e, `transcription-a-la-demande`, ajoutée le 13/11), depuis le fork `ekylibre/itineraire-technique`, relues par David et Bertrand.
     - La première (`dom-natif`) est ouverte depuis le 13/11 : [osfarm/itineraire-technique#47](https://github.com/osfarm/itineraire-technique/pull/47), en attente de relecture.
     - OSFarm doit choisir comment publier sur npm : une version à chaque fusion, ou une seule version 1.3.0 à la fin.

     *externe · P2 · conception_itineraires_techniques §7, §12 ter*
106. **Revenir au paquet npm d'OSFarm** une fois tout publié, et archiver le fork. *dette · P3 · conception_itineraires_techniques §7*
107. **Itinéraire prévisionnel d'une activité** : un modèle d'interventions, en dates relatives au semis, appliqué aux parcelles. *évolution · P3 · besoins_itineraires_techniques §8*
108. **Comparaison prévu / réalisé** (vue « avant / après » de TIKA, cassée chez OSFarm). *évolution · P3 · besoins_itineraires_techniques §8*
109. **Éditeur TIKA branché sur Fourmy**. *évolution · P3 · besoins_itineraires_techniques §8*
110. **Export vers Triple Performance et diagramme climatique** (normales du point météo de la ferme). *évolution · P3 · besoins_itineraires_techniques §8*

## 16. Imports, contrôles HVE et AB

Besoins, conception et plans : `claudedocs/besoins_import_onboarding.md`, `claudedocs/workflow_import_onboarding.md` ; `claudedocs/besoins_controle_hve_ab.md`, `claudedocs/conception_controle_hve_ab.md`, `claudedocs/workflow_controle_hve_ab.md`. Mode d'emploi : `docs/imports.md`, `docs/controles-hve-ab.md`.

118. **Export de la grille HVE officielle v1.15 remplie (CT6b)** : classeur du ministère embarqué dans le dépôt (choix du 20/11), écriture des seules cellules de saisie (environ 250 libellés sur 8 onglets, en zones de texte), recalcul à l'ouverture ; test de recalcul par LibreOffice comparé au tableau de bord. Attend la grille de référence (119). *évolution · P2 · workflow_controle_hve_ab CT6* — issue #100
119. **Grille HVE de référence remplie à la main** pour la ferme de test, dans `docs/hve/grille-audit-hvev4-v1.15 - libreoffice.xlsx` (version lisible sous LibreOffice, hors dépôt) : sert à vérifier les points de Fourmy item par item et la correspondance de l'export (118). *donnée · P2 · workflow_controle_hve_ab, prérequis P2* — issue #101
120. **Confirmations d'un organisme certificateur bio** : plafond de 170 kg N/ha par année civile ou par campagne (réglage existant) ; dépassement du cuivre rattaché au manquement n° 328 (marqué « à confirmer »). *externe · P2 · workflow_controle_hve_ab, prérequis P3* — issue #102
121. **Recette des imports et de l'assistant avec l'exploitant testeur (IM7)** : fichiers DAPLOS, Geofolia et TelePAC réels, parcours de l'assistant, écarts à corriger. *donnée · P2 · workflow_import_onboarding IM7* — issue #103

## 17. Assolement prévisionnel

122. **Essai de l'écran d'assolement avec l'exploitant testeur** : préparer 2027 sur sa ferme, retours à intégrer. *donnée · P2 · workflow_assolement Q5* — issue #112
123. **Relecture des repères agronomiques** (délais de retour, précédents) par un agronome ; soja (2 ans ou 4 à 6 ans) et pomme de terre en priorité. *donnée · P2 · workflow_assolement Q3* — issue #113
124. **Temps 2 : itinéraires techniques** à l'affectation (catalogue Lexicon, ITK de la ferme), interventions proposées puis confirmées, temps de travaux (OSRM), besoins en intrants. *évolution · P2 · besoins_assolement §5* — issue #114
125. **Temps 3 : module économique** (prix des intrants par la clé d'adhérent Lexicon, prix de vente par l'API agrifood de la Commission, rendements et marges). *évolution · P3 · besoins_assolement §6* — issue #115
126. **Découpe : report des interventions prévues** sur les morceaux et annulation d'une découpe validée. *évolution · P3 · workflow_assolement AS3* — issue #116
127. **Mobile : parcellaire à la date d'effet d'une découpe** (synchronisation qui ne voit le changement qu'à la synchronisation complète suivante). *dette · P3 · workflow_assolement AS3* — issue #117
128. **BCAE 7 : barème à points de la plaine du Rhin** (liste des communes de l'arrêté BCAE) et liste des légumineuses de l'exemption à vérifier sur la notice Télépac 2026. *donnée · P3 · docs/pac/rapport_pac.md* — issue #118

## 18. Semences

Besoins, conception et plan : `claudedocs/besoins_semences.md`, `claudedocs/conception_semences.md`, `claudedocs/workflow_semences.md`. Mode d'emploi : `docs/semences.md`.

129. **Faculté germinative et pertes à la levée** : faut-il les saisir pour passer d'une densité de plantes visée à une densité de semis ? Lié au temps 2 de l'assolement (124). *décision · P3 · besoins_semences §7 q1* — issue #129
130. **Unités des semences reprises** : elles sont reconnues à la volée (« Sac de 50 000 grains », « Mille graines ») ; proposer aussi de réécrire l'unité des articles en unité canonique, sur confirmation ? *décision · P3 · besoins_semences §7 q2* — issue #130
131. **Prix indicatifs des semences** (Germineo, réservé aux membres) : sur la fiche dès maintenant, ou avec le temps 3 de l'assolement (125) ? *décision · P3 · besoins_semences §7 q3* — issue #131
132. **Semences de ferme** : suivre le triage à façon et la CVO (contribution volontaire obligatoire) ? *décision · P3 · besoins_semences §7 q4* — issue #132
133. **Application mobile : semences** : unités de semis (grains/m², kg/ha, doses) avec le champ `seed` synchronisé, et espèces d'un mélange (non encore synchronisées) pour saisir la dose de chaque espèce. *évolution · P2 · conception_semences §6, workflow_semences SE8* — issue #133
134. **Rattachement des semences de l'exploitant testeur** : 42 propositions sur la ferme test des imports (23 sûres par le code GNIS), à confirmer avec lui avant de les appliquer. *donnée · P2 · recette SE8* — issue #134
