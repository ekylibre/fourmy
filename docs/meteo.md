# Météo des interventions

Lot 3 des retours de test (`claudedocs/exigences_interventions.md` : MET-1 à
MET-3). Réalisé le 2026-11-08.

## Fournisseurs (`@fourmy/weather`)

| Fournisseur | Clé | Sert à | Dans Fourmy |
|---|---|---|---|
| **Open-Meteo** | aucune | prévision (16 jours) et historique depuis 1940 (archive ERA5 au-delà de 80 jours) | actif par défaut, sans intégration ; **toujours** pour le passé |
| **OpenWeather** | clé de la ferme | prévision 5 jours, pas de 3 h (l'API gratuite n'a pas d'historique) | intégration « OpenWeather — météo » |
| **meteoblue** | clé de la ferme | prévision horaire, paquet `basic-1h_agro-1h` | intégration « meteoblue — météo agricole », prioritaire |

- Ordre pour une prévision : meteoblue, OpenWeather (intégrations actives),
  puis Open-Meteo ; un fournisseur en panne ou qui ne couvre pas la fenêtre
  laisse la main au suivant. La **source** est toujours enregistrée.
- Les clés sont saisies dans **Intégrations** (chiffrées, testées avant
  d'être enregistrées, jamais réaffichées) et restent sur le serveur : le
  navigateur passe par l'API (`POST /weather/intervention`,
  `GET /weather/spraying`).
- Ferme de Pierre : la clé OpenWeather de son Ekylibre (export restauré,
  lecture seule) est enregistrée dans ses Intégrations.
- Point météo : centre des parcelles de l'intervention (à sa date), sinon
  centre de la ferme.

## Icônes (lot D, retours du 08/11/2026)

Référence commune : les **codes d'icône d'OpenWeather** (`01d`…`50n`,
https://openweathermap.org/weather-conditions#Icon-list), quel que soit le
fournisseur : Open-Meteo (codes WMO + jour/nuit) et meteoblue (pictocodes)
y sont ramenés (`iconFromWmo`, `iconFromMeteoblue`). Le temps **dominant**
d'une période est le plus marquant (orage > neige > pluie > averses >
brouillard > couvert > nuageux > peu nuageux > soleil). Dessin local (icônes
lucide colorées), sans image chargée chez un tiers.

- Fiche : temps dominant, température, hygrométrie, vent, pluie, puis la
  **frise heure par heure** de la période (icône, température, pluie),
  enregistrée avec la météo (`hours`, 48 pas au plus).
- Conditions de pulvérisation : par jour, icône du temps de la journée,
  températures mini / maxi et pluie, puis les créneaux colorés.
- Les météos enregistrées avant les icônes (hors saisie à la main) sont
  complétées par le worker.

## Météo d'une intervention (MET-2)

- Le formulaire **pré-remplit** température, hygrométrie, vent moyen et pluie
  pour le lieu et les dates : observée pour le passé, prévue pour l'avenir
  (planification). Une valeur modifiée à la main passe en « saisie » et n'est
  plus écrasée ; « Reprendre la météo du fournisseur » annule la saisie.
- Moyennes sur les périodes de travail (les pas de temps qui les chevauchent),
  vent maximal, pluie cumulée (`summarize`).
- Enregistrée avec l'intervention (`interventions.weather`) et affichée sur sa
  fiche avec sa source.
- Le **worker** complète la météo des interventions réalisées qui n'en ont pas
  (reprises d'Ekylibre comprises) depuis l'historique d'Open-Meteo, 10 par
  minute ; une panne est réessayée au tour suivant, une requête refusée marque
  l'intervention « sans données ».

## Météo journalière de la ferme (`daily_weather`)

Cache des journées Open-Meteo au centre de la ferme. Il sert au modèle de croissance ([`modele-croissance.md`](modele-croissance.md)), à la pluie des plans de fumure et à la grille d'efficacité des apports d'azote ([`fertilisation.md`](fertilisation.md)).
- **Contenu** : températures minimale et maximale, pluie, ETP FAO-56 et, depuis le lot AL (migration 0041), le vent maximal du jour. La dernière année d'archive est rechargée une fois pour obtenir le vent (`with_wind`).
- **Rafraîchissement** : l'archive est complétée et la prévision rechargée quand elle est périmée. Un seul rafraîchissement à la fois par ferme : les requêtes simultanées (plans imprimés, liste des plans) l'attendent au lieu de le relancer.

## Conditions de pulvérisation (MET-3)

Widget sur le **tableau de bord** (frise sur aujourd'hui) et, toujours, dans
le **formulaire d'un traitement** (colonne de droite) : pour un traitement
passé, les conditions **observées** heure par heure ce jour-là
(`GET /weather/spraying?days=1&from=…`, historique Open-Meteo) ; pour un
traitement à venir, les 3 jours à partir du jour prévu (16 jours au plus) ;
sinon les 3 prochains jours,
un créneau par heure (par 3 h avec OpenWeather), favorable / à surveiller /
défavorable, la raison au survol, le prochain créneau favorable. Seuils repris
d'Ekylibre (`weather_spraying_cells_controller.rb`) :

| Mesure | Favorable | À surveiller | Défavorable |
|---|---|---|---|
| Vent | ≤ 2 m/s (7 km/h) | < 5 m/s (18 km/h) | ≥ 5 m/s |
| Hygrométrie | 75–95 % | 50–75 % ou 95–99 % | sinon |
| Température | 5–25 °C | 0–5 °C ou 25–30 °C | sinon |
| Pluie | ≤ 0,1 mm/h | ≤ 0,3 mm/h | au-delà |

## Tests

`packages/weather/test` (fournisseurs ramenés au même format, résumé,
seuils), `apps/api/test/weather.integration.test.ts` (historique, OpenWeather
actif puis en panne, créneaux, enregistrement, worker),
`apps/web/test/weather.test.tsx` (pré-remplissage, saisie à la main, widget,
fiche, tableau de bord).

## Stations de l'agriculteur : Weenat et Sencrop (lot W, 2026-11-10)

Intégrations du thème Météo (page Intégrations). Références : plugins
Ekylibre `ekylibre-weenat` et `ekylibre-sencrop`.

| | Weenat | Sencrop |
|---|---|---|
| Accès | e-mail (réglage) + mot de passe (secret chiffré) de l'application Weenat | identifiant d'application (réglage) + secret d'application (secret chiffré) |
| Jeton | `POST api-prod.weenat.com/api/api-token-auth/` → JWT (`Authorization: JWT …`), gardé pour la synchro | `POST api.sencrop.com/v1/oauth2/token` (Basic, client credentials) → Bearer ~1 h, renouvelé 1 min avant |
| Stations | `GET /v2/access/plots/` (parcelles Weenat : id, nom, lat, lon) | `GET /v1/me` puis `/users/{id}/devices` (`devicesStatuses[id].contents`) |
| Mesures horaires | `GET /v2/access/plots/{id}/measures/?start&end` (s), fenêtres de 30 j ; RR, T, U, FF, FXY | `GET …/devices/{id}/data/hourly?beforeDate&days&measures`, fenêtres de 7 j ; RAIN_FALL, TEMPERATURE(_MIN/_MAX), RELATIVE_HUMIDITY, WIND_SPEED, WIND_GUST, WIND_DIRECTION, LEAF_WETNESS |

- **Modèle** (migration 0028) : `weather_stations` (fournisseur, identifiant
  externe, nom, position) et `weather_measures` (une ligne par station et par
  heure, valeurs typées et `raw`), RLS par ferme.
- **Synchro** (worker, toutes les heures — `fourmy_due_integrations`) :
  30 jours d'historique à la première, puis depuis la dernière mesure avec
  2 h de recouvrement ; idempotente. Reprise sur 429 et 5xx ; 401/403 :
  intégration en erreur avec un message lisible.
- **Usage** : la météo d'une intervention **passée** prend d'abord les
  mesures de la station active la plus proche des parcelles (moins de 5 km,
  au moins 80 % des heures couvertes) ; la source (« station Weenat
  « nom » à x km, observée ») est enregistrée. Sinon : Open-Meteo
  (historique), comme avant. Les prévisions restent aux fournisseurs de
  prévision (meteoblue, OpenWeather, Open-Meteo).
- **Écran** : page Intégrations › Météo : formulaires Weenat et Sencrop,
  « Tester » liste les stations du compte ; tableau des stations de la ferme
  (dernière mesure, nombre de mesures). API : `GET /weather/stations`.
- **Non vérifié sur un vrai compte** (pas d'identifiants de test) : les
  clients suivent les plugins Ekylibre et sont testés sur des réponses
  simulées. À valider : horodatage Weenat (début ou fin de l'heure), unités
  du vent, nombre de jours maximal par appel Sencrop.
