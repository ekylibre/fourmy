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
