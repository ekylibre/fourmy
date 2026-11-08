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
