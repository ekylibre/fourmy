# Retour de test du 10/11/2026

http://localhost:5174/f/a94afd36-5aea-520f-b55f-60457f8a31e8

**UI/UX**

## ajoute un widget qui affiche une synthese des parcours Traccar dans le tableau de bord (selon la date selectionné) quand Traccar est activé

## ajoute sur toutes les listes, la possiblité de selectionner les colonnes à afficher

## Classer les intégrations par théme : Météo / Suivi GPS - Matériels / OAD

## refaire les menus et sous-menu

Cartes > Plan 2D / Plan 3D

Activités

Interventions

Matériels

Equipe

Stocks > Produits phyto / Cuverie

Réglementaire > Registre phyto

Interoperabilité > Intégration / Imports

**Interventions**

dans la création ou l'édition d'une intervention, respecter l'ordre des pavés suivants

1 / Type d'intervention - (Notifications / Infos)

2 / Réalisé / Plannifié - Libre / Attelage avec les durées, le matériels et les intervenants

3 / les parcelles

4 / La météo

5 / Les notes

**Intégrations**

## Ajouter une intégration Weenat (thème : Météo)

inspiration de Ekylibre - https://github.com/ekylibre/ekylibre-weenat
inspiration de Cropivia - /home/djoulin/projects/cropivia_backend
 La documentation : https://docs-dsa.weenat.com/ 
Le swagger : https://dsa.weather-measures.com/docs#/ 

## Ajouter une intégration Sencrop (thème : Météo)

inspiration de Ekylibre - https://github.com/ekylibre/ekylibre-sencrop

# Ajouter le format réglementaire pour le carnet de traitement phytosanitaire (Registre phyto)

https://www.legifrance.gouv.fr/jorf/id/JORFTEXT000053228465

https://agriculture.gouv.fr/le-registre-dutilisation-des-produits-phytopharmaceutiques-au-format-electronique

https://smag.tech/blog/registre-phytosanitaire-numerique/

https://www.isagri.fr/ressources/articles/registre-phytosanitaire-numerique-soyez-pret-pour-2027

Ajoute si besoin de elments au modele et adapte les ecrans et méthodes concernés.

Un exemple d'implementation est disponible dans Cropivia /home/djoulin/projects/cropivia_backend (regarde notamment l'API EPPO)
