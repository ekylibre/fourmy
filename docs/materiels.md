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
