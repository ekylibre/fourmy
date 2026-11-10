# Matériels

Lot I de [`materiels-entretien-design.md`](materiels-entretien-design.md) :
fiche matériel, compteur d'heures, relevés, marques et logos. Le plan
d'entretien et les échéances viennent avec le lot J.

## Liste (`/f/:ferme/equipments`)

- Menu « Matériels ».
- Par défaut, la liste montre les matériels en service. « Tous » ajoute les
  matériels réformés ou vendus.
- On filtre par nature et on cherche par nom, marque ou n° de série.
- **Colonnes** :
  - logo (celui du matériel, sinon celui de sa marque, sinon un
    pictogramme) ;
  - nature ;
  - marque et modèle ;
  - dernier relevé ;
  - badge « Traccar » si un boîtier est rattaché aujourd'hui.
- **Relevé** : tout membre de la ferme saisit les heures en deux gestes
  (date et valeur).
- **Nouveau matériel** : réservé au responsable.
- **Attelages types** (lot Q) : les compositions habituelles de la ferme
  (matériels dans l'ordre, intervenants), reprises en un clic dans une
  intervention en attelages. Voir « Parcours GPS et attelages » plus bas.

## Compteur et relevés

- **Compteur** :
  - tracteurs et automoteurs ont un compteur d'heures, les autres natures
    non ;
  - c'est réglable sur la fiche (« Compteur d'heures ») ;
  - la migration 0017 a appliqué cette règle aux matériels existants.
- **Contrôle** : un relevé doit rester entre le relevé précédent et le
  suivant, même saisi après coup. Sinon il est refusé (409) avec le relevé
  en cause.
- **Correction motivée** : pour passer outre, on coche « C'est une
  correction », on choisit son type et on saisit un motif. La correction est
  tracée dans le journal d'audit.
  - **Saisie précédente fausse** : les relevés antérieurs plus élevés sont
    écartés (barrés dans la liste).
  - **Compteur remplacé** : le nouveau compteur repart de sa valeur. Les
    **heures d'usage** continuent sur une échelle continue, qui est celle
    dont se serviront les échéances.
- **Saut suspect** : un compteur qui avance plus vite que l'horloge (faute de
  frappe probable) est accepté, avec un avertissement.
- **Suppression** : le responsable peut supprimer un relevé saisi. Un relevé
  issu d'une intervention se corrige par l'intervention.
- **Mobile** (`zero-mobile`) :
  - le pull fournit les relevés, ainsi que la marque, le modèle et le
    compteur des matériels ;
  - le push accepte `meter_readings.created`, idempotent par l'`id` client ;
  - un relevé incohérent revient dans `failed` avec le même message.

## Fiche (`/f/:ferme/equipments/:id`)

L'onglet est dans l'adresse (`?tab=technical|readings|history`).

- **Général** :
  - identité : marque, modèle, n° de série, type constructeur, année, mise
    en service, compteur, identifiants externes ;
  - agrégats : moteur, boîte, ponts, avec leurs numéros ;
  - options montées, datées ;
  - logo, marque, traceurs GPS.
- **Technique** : fiche technique sourcée, au format `fiche_technique.json`
  de la base Arion. Chaque valeur montre sa source (document, page), ses
  alternatives et ses notes. Elle sera remplie par l'import (lot J).
- **Relevés** :
  - courbe des heures d'usage ;
  - liste des relevés : origine, correction, auteur, note.
- **Historique** : interventions où le matériel est entretenu (cible) ou
  utilisé (outil).

## Marques et logos

- **Marque de la ferme** : la marque saisie en texte est rattachée à une
  marque de la ferme, créée au besoin. « CLAAS » et « Claas » sont la même
  marque. Elle porte un **logo** et une **couleur**, partagés par ses
  matériels.
- **Logo** : PNG, JPEG ou SVG, 1 Mo au plus.
  - Son type est vérifié par les octets, pas par l'extension.
  - Un SVG est converti en PNG par le navigateur, pour servir de texture à
    l'avatar 3D (lot M).
- **Fichiers servis** (`GET /assets/:id`) : immuables, avec l'en-tête
  `Content-Security-Policy: sandbox`. Ils sont affichés par `<img>`, donc un
  SVG n'est jamais exécuté.
- **Données privées** : les logos restent propres à la ferme. Ils ne sont
  jamais versionnés dans le dépôt.

## API

| Route | Droits |
|---|---|
| `GET /equipments` · `GET /equipments/:id/sheet` · `GET /equipments/:id/readings` · `GET /brands` · `GET /assets/:id` | membre |
| `POST /equipments/:id/readings` (`origin: reference` : responsable) | membre |
| `POST /equipments` · `PUT /equipments/:id` · `POST /equipments/:id/options` · `DELETE /equipment-options/:id` · `DELETE /meter-readings/:id` · `PUT/DELETE /equipments/:id/logo` · `PUT /brands/:id` · `PUT/DELETE /brands/:id/logo` | responsable |

## Plan d'entretien et échéances (lot J)

### Import de la base matériel (Imports › Base matériel)

- **Choix du dossier** : on choisit le dossier d'un matériel au format de
  la base Arion. Le navigateur n'en lit que les fichiers utiles :
  `machine.json`, `sources.json`, `fiche_technique.json`,
  `entretien/plan_entretien.json`, `entretien/fluides.csv`,
  `pieces/pieces_entretien.csv`. Les notices PDF et les images restent sur
  le poste.
- **Rattachement** : au matériel choisi, sinon à celui qui a le même n° de
  série, sinon à un nouveau matériel.
- **Ce qui est créé ou mis à jour** :
  - le **modèle** (plan par défaut, fluides, pièces), propre à la ferme : il
    n'est jamais partagé, faute de droits clairs sur les documents du
    constructeur ;
  - la fiche du matériel (identité, agrégats, fiche technique) et ses
    options montées ;
  - le plan copié sur le matériel ;
  - les fluides ;
  - les pièces, sous forme d'articles `part` de la ferme, dédoublonnés par
    référence et par marque.
- **Visites initiales** : chacune devient une opération ponctuelle
  (« Visite des 100 premières heures »). Sur un tracteur déjà plus âgé que
  la visite, elle est « non applicable ».
- **Options absentes d'usine** : une opération qui mentionne une option
  absente d'usine (prise de force avant, relevage avant, freinage
  pneumatique de remorque) arrive retirée du plan, avec le motif « Option
  absente d'usine ».
- **Réimport** : rejouable sans doublon. Les opérations déjà sur le
  matériel sont **conservées** telles que la ferme les a ajustées, seules
  les nouvelles sont ajoutées.
- **Pilote** :

  | Matériel | Opérations | Non applicables | Fluides | Pièces |
  |---|---|---|---|---|
  | ARION 430 | 59 | 3 | 11 | 54 |
  | ARION 630 C | 62 | 5 | 9 | 43 |

  Les deux tracteurs ont 27 références en commun.

### Onglet Entretien de la fiche

- **Calcul** : les échéances sont calculées à la date de la frise, jamais
  stockées. On peut donc rejouer la ferme dans le temps.
- **Tri** : en retard, bientôt, à renseigner, à jour.
- **Prochaine échéance** : dernière réalisation + périodicité, en heures
  et/ou en mois, au premier terme atteint.
- **Dernière réalisation** : la plus récente des réalisations (interventions
  d'entretien, lot K), sinon la « dernière fois connue », sinon la mise en
  service.
- **Sans rien de connu**, l'opération est « à renseigner » :
  - **Dernière fois** (tout membre) : date et heures de la dernière
    réalisation, pour une opération ;
  - **Amorcer le plan** : la même date pour toutes les opérations à
    renseigner (révision complète à l'achat, par exemple).
- **Réalisation sans relevé d'heures** : les heures sont interpolées entre
  deux relevés. Sinon, l'échéance ne suit que les mois.
- **Plan ajustable par le responsable** : libellé, type, périodicité,
  exécutant (exploitant ou atelier agréé), retrait du plan. Une opération
  copiée du modèle ne modifie que ce matériel.
- **Fluides préconisés** : organe, produit, norme, capacité, source.
- **Seuil « bientôt »** : 50 h ou 1 mois par défaut, réglable sur la page
  Entretien par le responsable.

### Onglet Pièces

Le référentiel des pièces d'entretien du matériel : famille, référence
constructeur, désignation, quantité, position dans le catalogue, opérations
qui les utilisent.

### Tableau de bord de l'entretien (`/f/:ferme/maintenance`)

- On y accède par le bouton « Entretien » de la liste des matériels, ou par
  la carte « Entretien » du tableau de bord de la ferme.
- La page liste, pour tous les matériels, les opérations en retard et à
  venir, par urgence, ainsi que les matériels qui ont des échéances à
  renseigner.

### API (lot J)

| Route | Droits |
|---|---|
| `GET /equipments/:id/maintenance?at=` · `GET /maintenance/due?at=` · `GET /equipment-models` · `GET /settings/maintenance` | membre |
| `PUT /plan-operations/:id/baseline` · `POST /equipments/:id/plan/baseline` | membre |
| `POST /equipments/:id/plan` · `PUT /plan-operations/:id` · `POST /equipments/:id/plan/apply-model` · `POST /imports/equipment-bundle` · `PUT /settings/maintenance` | responsable |

## Interventions d'entretien (lot K)

Une opération d'entretien réalisée **est une intervention** de forme
`maintenance` (procédure « Réparation et maintenance »). Le formulaire
d'intervention s'adapte à cette forme.

### Saisie

- **Matériels entretenus** : une carte par matériel, avec :
  - le **compteur** (heures), qui rappelle le dernier relevé. Il est
    facultatif mais demandé, et il n'est saisi que pour une intervention
    réalisée ;
  - les **opérations du plan** : en retard et bientôt d'abord, les autres
    dans « Autres opérations du plan » ;
  - pour un **contrôle**, le résultat : RAS ou anomalie, avec ce qui a été
    constaté.
- **Nature** :
  - **préventive** dès qu'une opération du plan est cochée, **curative**
    sinon ;
  - modifiable ;
  - une intervention curative réalisée demande le **problème constaté**.
- **Atelier externe** : un nom libre et un n° de bon ou de facture
  facultatif, pour le rapprochement dans Lyvre.
- **Pièces et fluides** : ce sont des intrants. Cocher une opération ajoute
  ses pièces une seule fois, rattachées au matériel. Elles sortent du stock
  comme tout intrant.
- **Champs masqués** pour un entretien : « Matériels » (outils) et
  « Météo ».
- **Colonne de droite** : pour chaque matériel, le dernier relevé, les
  échéances en retard ou proches et les fluides préconisés.

### Pré-remplissage (FR-MAT-55)

- **Onglet Entretien d'un matériel** :
  - « Réaliser » ou « Planifier » sur une opération ouvre
    `interventions/new?procedure=equipment_maintenance&equipment=…&operations=…&status=done|planned`
    pré-rempli, pièces comprises ;
  - « Réparation » ouvre une saisie curative.
- **Fiche d'une intervention avec une anomalie** : « Planifier une
  réparation » ouvre une saisie curative planifiée. Le problème y est déjà
  rempli.

### Effets

- **Seule une intervention réalisée** remet à zéro les échéances des
  opérations cochées.
  - L'échéance repart des heures relevées par l'intervention.
  - Sans relevé, les heures sont interpolées entre deux relevés, sinon
    l'échéance ne suit que les mois.
- **Relevé créé** : le compteur saisi devient un relevé d'origine
  `intervention`, contrôlé comme un relevé saisi (409 s'il est plus bas que
  le précédent).
  - Il est recréé à chaque correction de l'intervention.
  - Il est supprimé si l'intervention est annulée, et les échéances
    reviennent à la réalisation précédente.
- **Fiche d'intervention** : un bloc « Entretien » montre la nature, le
  problème, l'atelier, le compteur et les opérations avec leur résultat.
- **Compatibilité** : sans bloc `maintenance` (ancien mobile, interventions
  migrées d'Ekylibre), rien de plus n'est exigé. Une intervention
  d'entretien sans opération se lit comme curative.

### Hors lot K

- **Fluides en intrants** : les fluides préconisés ne sont pas encore
  rattachés à des articles. On les ajoute à la main comme intrants de
  nature « fluide ».
- **Relevé en fin de chantier** (FR-MAT-60) : le contrat et l'API
  l'acceptent déjà (`tools[].meter`), mais le champ n'apparaît pas encore
  dans le formulaire des interventions de champ.

## Traccar, pièces à commander, alertes (lot L)

### Heures estimées (FR-MAT-13 et 14)

- **Constat** : les boîtiers du pilote ne remontent pas de compteur.
- **Calcul** : toutes les 15 minutes, le worker déduit des positions
  Traccar la **durée de fonctionnement de chaque jour**. C'est la somme des
  écarts entre positions consécutives quand le matériel roule (> 1 km/h)
  ou travaille.
  - Chaque écart est plafonné à 5 minutes, pour ne pas compter un trou de
    transmission.
  - Les jours sont en heure de Paris.
  - Le résultat va dans `equipment_usage_days`.
  - On ne parcourt que les matériels à compteur des fermes dont
    l'intégration Traccar est active. Les deux derniers jours sont
    recalculés, pour les positions arrivées en retard.
- **Heures du jour** : dernier relevé réel + heures des jours qui le
  suivent, affichées « ≈ 4 337 h (estimé) ». Un nouveau relevé saisi recale
  l'estimation sans rien réécrire.
- **Écart** : un relevé réel éloigné de l'estimation de plus de 10 h, ou de
  10 % des heures estimées, est accepté avec un avertissement. Le relevé
  saisi fait foi.
- **Coupure** : couper l'intégration arrête le calcul, mais rien n'est
  supprimé.

### Pièces à commander (`/f/:ferme/maintenance/parts`)

- **Horizon** : 100 h, 200 h, 3, 6 ou 12 mois.
- **Pièces retenues** : celles des opérations dont l'échéance tombe dans
  l'horizon, en retard ou à renseigner comprises.
  - Elles sont regroupées par article (référence constructeur).
  - On voit le besoin, le stock à la date et ce qu'il reste à commander.
- **Calcul** :
  - les heures sont projetées sur le rythme d'usage de la dernière année
    (relevés et estimations) ;
  - une opération qui revient plusieurs fois dans l'horizon compte autant
    de fois.
- **Export** : CSV (point-virgule, UTF-8).

### Alertes par e-mail (FR-MAT-25)

- **Réglage** : sur la page Entretien, le responsable choisit les membres
  à prévenir.
- **Envoi** : toutes les heures au plus, le worker envoie un récapitulatif
  par ferme des opérations passées à « bientôt » ou « en retard ».
  - Le SMTP utilisé est celui déjà configuré (`FOURMY_SMTP_*`).
  - Chaque échéance n'est signalée qu'**une fois par état**
    (`maintenance_alerts`).
- **Sans SMTP ou sans destinataire** : rien n'est marqué envoyé. L'envoi
  part dès que la configuration est faite.

### API (lot L)

| Route | Droits |
|---|---|
| `GET /maintenance/parts?hours=&months=&at=` | membre |
| `PUT /settings/maintenance` (`notify` : membres à prévenir) | responsable |

## Logo 2D et avatar 3D (lot M)

### Avatar généré (`@fourmy/equipment-3d`)

- **Modèle** : un modèle glTF à l'échelle réelle. Il donne la silhouette
  et les proportions, **pas le dessin du constructeur**.
- **Tracteur d'après le kit** : tous les tracteurs partent du dessin
  « tracteur bleu » du kit Ekylibre (`apps/web/public/kit/tracteur.svg`).
  - Ce dessin est une illustration isométrique : on ne peut pas en tirer
    un volume automatiquement. Le modèle 3D est donc redessiné d'après
    lui.
  - Parties reprises : toit blanc et gyrophare, vitres teintées, capot
    effilé au dessus plus clair, liseré blanc, calandre sombre et phares,
    ailes galbées, échappement, rétroviseurs, pneus à crampons, jantes et
    moyeux orangés. Environ 4 000 triangles.
  - Ajusté par les données de l'avatar : longueur, largeur, hauteur,
    empattement, diamètre des roues, couleurs (carrosserie et ses nuances,
    vitres, pneus, jantes), logo.
  - Couleurs par défaut, celles du dessin : carrosserie `#3FBEE0`, vitres
    `#5C2930`, pneus `#4F1F26`, jantes `#E89E00`.
- **Rendu en aplats**, comme l'illustration : matériaux sans éclairage
  (`KHR_materials_unlit`), teinte de chaque face précalculée selon son
  orientation (dessus plus clairs, flanc droit et arrière plus sombres).
  Le rendu ne dépend donc pas de la lumière de la scène.
- **Visuel 2D par défaut** : sans logo propre ni logo de marque, un
  tracteur affiche ce dessin dans les listes et les fiches.
- **Gabarits** :
  - tracteur ;
  - automoteur ;
  - outil traîné ;
  - pulvérisateur traîné, avec sa rampe dépliée à la largeur de travail ;
  - outil porté ;
  - remorque ;
  - équipement fixe.
- **Valeurs** : chacune indique sa provenance. La valeur saisie l'emporte
  sur la fiche technique, qui l'emporte sur le défaut du gabarit.
  - **Dimensions** : longueur, empattement, largeur, et hauteur (hauteur
    de cabine + rayon arrière).
  - **Roues** : diamètre calculé depuis les pneus. En métrique,
    « 420/85 R38 » donne 1,68 m. En pouces, « 16.9 R38 » se calcule avec
    une série 85 implicite.
  - **Couleur** : la couleur de la marque de la ferme, sinon celle du
    gabarit.
- **Logo** : le logo PNG du matériel ou de sa marque, posé sur les flancs.
  Pour un SVG, c'est sa version PNG qui sert.
- **Repère** : l'avant suit +Z en glTF.
  - Le cap Cesium vaut le cap boussole − 90°. Ce sens est vérifié sur
    l'aperçu.
  - Origine : au sol sous l'essieu arrière (tracteur), au point d'attelage
    (outil).
- **Génération** : le même code tourne dans l'API et dans le navigateur.
  - L'API génère à la demande (`GET /equipments/:id/avatar.glb`), avec un
    ETag qui est l'empreinte des paramètres et du logo, et un cache en
    mémoire.
  - Le navigateur recalcule l'aperçu à chaque réglage.

### Onglet 3D de la fiche

- **Aperçu** : Cesium, de trois quarts avant.
- **Réglage** (responsable) : gabarit, dimensions, couleurs, logo. Les
  valeurs non saisies restent déduites. « Tout déduire » efface la saisie.
- **Modèle importé** : un GLB de 5 Mo et 100 000 triangles au plus, dont
  l'en-tête est vérifié. Il remplace l'avatar généré, et on peut rétablir
  l'avatar généré ensuite.

### Plan 3D

- **Rejeu d'une trace** : l'avatar remplace le point.
  - Il est posé sur le relief et orienté selon le cap, calculé entre deux
    points de la trace et conservé à l'arrêt.
  - Il garde une taille minimale à l'écran quand on dézoome.
  - Le logo s'affiche au-dessus jusqu'à 2 km de distance.
- **« Suivre le matériel »** (activé par défaut) : la caméra se place
  derrière l'avatar, à 25 m, et tourne avec son cap pendant la lecture.
  Couper l'interrupteur revient à la vue d'ensemble de la trace. Le suivi
  intégré de Cesium n'est pas utilisé : il attend le volume englobant du
  modèle, qui n'est jamais disponible pour un modèle posé sur le relief.
- **Tracé de la trace** : posé sur les altitudes du relief (+0,5 m), dans
  une collection de lignes, sans worker de géométrie. Les lignes drapées
  arrêtaient la vue sous Firefox.
- **Logo au-dessus du véhicule** : c'est sa version PNG. Un SVG sans
  dimensions n'est pas une texture WebGL valide.
- **Attelage** : les autres matériels (non tracteurs) des interventions
  réalisées qui utilisent ce matériel, sur leurs périodes de travail, sont
  attelés derrière lui. En mode attelage (lot N), seuls les outils du même
  attelage comptent, sur les périodes de cet attelage : deux tracteurs du
  même chantier ne tirent plus chacun les outils de l'autre. Ils sont reculés de la distance d'attelage du
  tracteur, le long du cap (`GET /tracks/hitches`).
- **« Tous les matériels suivis »** : la dernière position connue de chaque
  matériel rattaché à un boîtier, à la date de la frise, sur 30 jours au
  plus (`GET /tracks/latest`).

### Limites

- **Attribut `tool` de Traccar** : il n'est pas encore utilisé pour
  l'attelage. Seules les interventions servent.
- **Outil traîné** : il suit le cap du tracteur, sans articulation en
  virage.
- **Logo JPEG** : il n'est pas plaqué sur l'avatar. Il faut un PNG ou un
  SVG.

## Parcours GPS et attelages (lots N à R, 2026-11-10)

Exigences et design : [`parcours-attelages.md`](parcours-attelages.md),
[`parcours-attelages-design.md`](parcours-attelages-design.md).

### Onglet Parcours de la fiche (`?tab=tracks`)

Visible quand le matériel a au moins un parcours sur les 400 derniers
jours, comme tracteur suivi ou comme outil reconnu.

- **Parcours** : le worker découpe les positions en sessions de **travail**
  (attribut `working` du boîtier) et de **déplacement**, toutes les 5 min
  (`track_sessions`, migration 0023). Un arrêt de plus de 15 min coupe la
  session ; les sessions trop courtes sont écartées.
- **Liste** (30 derniers jours par défaut, période au choix) : date,
  heures, durée, type, distance, surface couverte, parcelles travaillées,
  outil, état (libre ou rattaché à une intervention, badge « trace
  modifiée » si le recalcul diffère).
- **Filtres** : période, type, parcelle, état. **Carte** des parcours
  cochés avec leur surface couverte.
- **Outil** : celui que le boîtier annonce (attribut `tool`), relié à un
  matériel **à la main** par `external_ids.traccarTool` sur ce matériel.
  Un nom approchant n'est qu'une suggestion, jamais appliquée seule.
- **Outil** (fiche d'un outil sans boîtier) : les parcours des tracteurs
  pendant qu'il y était attelé, avec une colonne « Tracteur ».
- **Réglages « Parcours GPS »** (page Entretien, responsable) : seuils de
  découpage par ferme (arrêt, durée et distance minimales, vitesse, part et
  surface minimales d'une parcelle), et « Recalculer maintenant ». Les
  changer recalcule les parcours libres ; les parcours rattachés restent
  figés.

### Parcours → intervention (lot P)

- Cocher un ou plusieurs parcours d'un même boîtier, puis :
  - **Créer l'intervention** : formulaire pré-rempli en mode attelages,
    statut réalisé (tracteur et outil, conducteur habituel, une période par
    parcours, parcelles et zones travaillées), avec un bandeau de
    procédures suggérées et d'indices (outil déduit de l'habitude, aucun
    conducteur connu…) ;
  - **Ajouter à une intervention** du même jour : périodes et parcelles
    ajoutées à l'attelage du tracteur, correction tracée si elle est
    réalisée.
- Un parcours rattaché n'est plus cochable. Annuler ou supprimer
  l'intervention le libère (migration 0024).
- La fiche d'intervention liste ses « Parcours GPS rattachés ».

### Attelages types (lot Q, `/f/:ferme/equipments/crew-templates`)

- Liste pour tous, création, modification, mise hors service et
  suppression pour le responsable (migration 0025).
- Dans le formulaire d'intervention, « Reprendre un attelage type… »
  remplit les matériels et intervenants d'un attelage ; « Enregistrer comme
  attelage type » crée un modèle depuis un attelage saisi.
- L'intervention copie la composition : modifier ou supprimer un attelage
  type ne change pas le passé.

### API

| Route | Accès |
|---|---|
| `GET /equipments/:id/track-sessions` · `GET /track-sessions/:id` | membre |
| `POST /track-sessions/draft` · `GET/POST /interventions/:id/track-sessions` | membre |
| `POST /track-sessions/recompute` · `PUT /settings/tracks` | responsable |
| `GET /crew-templates` · `POST`, `PUT`, `DELETE /crew-templates[/:id]` | membre · responsable |

