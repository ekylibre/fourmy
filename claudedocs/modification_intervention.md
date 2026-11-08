# modifications des interventions

test sur http://localhost:5173/f/a94afd36-5aea-520f-b55f-60457f8a31e8/interventions

**UI/UX**

## ajouter une iconification à partir de agric (https://github.com/ekylibre/agric)

## ajouter une mode de saisie "carte" avec multi-selection de parcelles

## ajouter une vue show et edit (modifier)

## ajouter une vue index sous forme de kanban, de calendrier et de liste avec la frise à la semaine (lundi au dimanche)

## ajouter une recherche rapide des interventions en mode liste

**Métiers**

## implémenter le controle de la réglementation phyto ( à partir du lexicon )

Permettre d'importer un article depuis le lexicon ou importer les elements phyto à partir d'un numero amm d'un article existant

Calculer la dose maximale, l'autorisation du produit, la ZNT, le DAR et Delai de ré-entrée dans la parcelle et afficher ces indicateurs dans le formulaire d'intervention (depassement dose => feu rouge...)

Regarde les méthodes dans ekylibre pour comprendre la logique métier : /home/djoulin/projects/ekylibre/ekylibre/app/services/phytosanitary et /home/djoulin/projects/ekylibre/ekylibre/app/services/registered_phytosanitary_usage_dose_computation.rb et /home/djoulin/projects/ekylibre/ekylibre/app/controllers/form_objects/backend

Regarde egalement le projet suivant qui implemente le controle phyto pour la fraise : https://github.com/cropivia/cropi-grow-guide et https://github.com/cropivia/cropivia_backend

# implémenter l'enregistrement de la météo dans l'intervention par rapport a la situation des parcelles et à la date de l'intervention

- Ajouter les intégrations suivantes (avec saisie de la clef d'API dans l'integration) :

>> Openweather : https://openweathermap.org/api/
regarde l'implementation dans Ekylibre https://github.com/ekylibre/ekylibre/blob/main/app/integrations/open_weather_map_client.rb
Tu peux tester avec la ferme de Pierre qui possede dejà une clef d'API

>> Meteo Blue : https://docs.meteoblue.com/en/weather-apis/forecast-api/forecast-api-configurator
https://my.meteoblue.com/packages/redoc#section/Overview/Key-Packages
Package agro

>> Openmétéo : https://open-meteo.com/en/docs et https://github.com/open-meteo/open-meteo
ex : https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&hourly=temperature_2m

- Ajouter un widget permettant d'afficher les conditions de pulvérisation par rapport aux données météo
regarde dans ekylibre pour la méthode : https://github.com/ekylibre/ekylibre/blob/main/app/controllers/backend/cells/weather_spraying_cells_controller.rb

- Ajouter les informations météo dans le formulaire de l'intervention (pré-remplie) avec temperature, hygrométrie, vitesse du vent et pluviométrie

## implémenter le calcul de l'IFT

L'Indicateur de Fréquence de Traitements phytopharmaceutiques (IFT) est un indicateur de suivi de l'utilisation des produits phytopharmaceutiques (pesticides) à l’échelle de l’exploitation agricole ou d’un groupe d’exploitations.

DOC : https://api.agriculture.gouv.fr/catalog/api/b93140aa-5e54-54ed-d875-c62235296e1a/doc?page=0d6f597c-360d-47de-af59-7c360dc7de50

API : https://ecoagri.api.agriculture.gouv.fr/ift/v5
API DEV : https://ecoagri-pprd.api.agriculture.gouv.fr/ift/v5




