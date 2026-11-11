# Modèle de croissance des cultures

Lot AB, réalisé le 2026-11-11 : FR-TWIN-8 en version simple
([`requirements.md`](requirements.md) §4.9 bis), ADR-17
([`architecture.md`](architecture.md)). Étude d'origine :
`claudedocs/etude_jumeau_3d.md` §3.5.

**Décisions du 2026-11-11** :
- stades par degrés-jours et bilan hydrique, en TypeScript, plutôt que
  WOFOST dans `services/agro` (prévu plus tard, avec l'assimilation du LAI) ;
- affichage dans la fiche parcelle, le plan 3D et le tableau de bord ;
- réserve utile par défaut (100 mm), corrigeable par parcelle, comme les rangs.

**Lot AC, irrigation (2026-11-11)** : procédure « Irrigation » (`watering`)
avec une dose d'eau en mm. Les irrigations réalisées entrent dans le bilan
hydrique des parcelles ciblées (voir « Irrigations saisies »).

## Ce que voit l'utilisateur

- **Fiche parcelle, onglet Végétation, encadré « Modèle de croissance »**
  (au-dessus de la courbe NDVI) :
  - la culture, la date de semis, le stade du jour et les degrés-jours ;
  - la date de chaque stade, avec son origine : météo observée, prévision
    à 16 jours, ou normales ;
  - l'eau disponible et le stress hydrique. Sur une parcelle déclarée
    irriguée, le besoin d'irrigation simulé remplace le stress ;
  - la courbe de l'eau disponible, avec le seuil de stress et la date de la
    frise ;
  - le sol : réserve utile et irrigation, modifiables par le responsable ;
  - les irrigations saisies de la saison (total, nombre, dernière) et un
    bouton « Saisir une irrigation ». Sur la courbe, un trait pointillé marque
    chaque apport.
- **Tableau de bord, widget « Cultures : ce que prévoit le modèle »** :
  signalements à la date de la frise, regroupés par sorte :
  - stress hydrique (en sec, ou malgré les irrigations saisies) ;
  - irrigation à prévoir dans les 3 jours (parcelle irriguée), avec un bouton
    « Saisir l'irrigation » pré-rempli (parcelle, date, dose simulée) ;
  - floraison dans les 10 jours ;
  - récoltable dans les 15 jours.
- **Plan 3D** : sans NDVI récent (nuages, satellite pas encore repassé, date
  à venir), la hauteur des rangs vient du modèle. L'encadré l'indique
  (« dont 3 d'après le modèle de croissance »).

## Règles

**Saison d'une parcelle**
- **Semis** : dernier semis réalisé saisi (procédures de semis des grandes
  cultures) dans les 400 jours qui précèdent la date.
- **Culture** : production de la campagne du semis. Un semis d'automne
  prépare la campagne suivante (année du semis + 5 mois). L'espèce vient de
  `cultivation`, sinon de `species`.
- **Fin** : la première intervention réalisée qui retire le couvert après le
  semis (récolte, broyage, fauche, labour) arrête la simulation. La parcelle
  est alors « Récoltée ».

**Modèles** (`CROP_MODELS`, domaine) : degrés-jours par la méthode de la
moyenne, températures plafonnées à 30 °C, cumulés à partir du jour du semis.

| Culture | Base | Stades (°Cj depuis le semis) |
|---|---|---|
| Maïs (`zea_mays`) | 6 °C | levée 100 · 6 feuilles 380 · 10 feuilles 580 · floraison 950 · maturité physiologique 1 850 · récoltable (grain) 2 050 |
| Céréales à paille (triticale, blé, orge, avoine, seigle) | 0 °C | levée 150 · début tallage 450 · épi 1 cm 1 100 · épiaison 1 500 · floraison 1 600 · maturité 2 350 · récoltable 2 550 |

**Calage sur la ferme de Pierre** (16 saisons de maïs, 2025-2026, météo
Open-Meteo du centre de la ferme) :
- **NDVI** :
  - fin de montée et plateau entre 700 et 1 150 °Cj : la floraison
    (950) tombe dedans ;
  - sous 0,5 vers 1 550 à 1 660 °Cj, et sous 0,3 vers 1 850 °Cj : la
    maturité physiologique.
- **Récoltes saisies en 2025** : vers 2 050 °Cj. Pour un semis du 6 avril,
  le modèle prévoit « récoltable » au 14/09/2025, et la récolte est saisie
  au 16/09.
- **Triticale semé le 30/10/2025** : maturité simulée au 1er juin 2026. Le
  NDVI baisse à partir du 3 juin.

**Bilan hydrique** (FAO-56, coefficient cultural unique)
- **Coefficient cultural (Kc) par degrés-jours** :
  - maïs : 0,3 jusqu'à 6 feuilles, 1,2 de 850 à 1 550 °Cj, puis 0,6 à
    maturité et 0,35 à récoltable ;
  - céréales : 0,4 à 0,7 jusqu'au tallage, 1,15 de 1 300 à 2 000 °Cj, puis
    0,3 à maturité.
- **Réservoir** : la réserve utile saisie (100 mm par défaut). Les racines en
  atteignent 30 % à la levée, puis toute la réserve à la floraison (maïs) ou
  à l'épiaison (céréales).
- **Bilan du jour** :
  - le sol est plein au semis ;
  - la pluie compte en entier, le surplus draine ; pas de ruissellement ;
  - ETc = Ks × Kc × ET0. L'ET0 FAO (Penman-Monteith) vient d'Open-Meteo.
- **Stress** : la culture souffre quand l'eau disponible passe sous
  1 − p = 45 % de la réserve accessible (p = 0,55). Le coefficient de stress
  Ks baisse alors linéairement jusqu'à 0.
- **Jours de stress** :
  - comptés de la levée à la maturité ;
  - à part, ceux autour de la floraison, période la plus sensible : maïs de
    800 à 1 200 °Cj, céréales de 1 400 à 1 900 °Cj.
- **Parcelle irriguée** : de la levée à la maturité, un apport remplit le
  réservoir dès que la réserve facilement utilisable est épuisée. On obtient
  le besoin d'irrigation au lieu d'un stress.

**Irrigations saisies** (lot AC, migration 0033)
- **Saisie** : procédure « Irrigation » (`watering`). « Arrosage des plants »
  et « Arrosage des vignes » comptent aussi. Bloc `irrigation` de
  l'intervention : dose en mm sur les parcelles ciblées (1 mm = 10 m³/ha),
  obligatoire à la réalisation, de 100 mm au plus, et matériel facultatif
  (enrouleur, pivot ou rampe, couverture intégrale, goutte-à-goutte, autre).
  Le formulaire affiche le volume. La dose est refusée sur une autre
  procédure, et sa correction est tracée.
- **Bilan** : une irrigation réalisée entre le semis et la fin de saison
  s'ajoute comme une pluie le jour de son début. Deux irrigations le même
  jour s'additionnent.
- **Apports de la saison** (`waterSupply`) :
  - `rainfed` : pas d'irrigation saisie, parcelle en sec ;
  - `ideal` : pas d'irrigation saisie, parcelle déclarée irriguée. Pilotage
    idéal simulé toute la saison, comme au lot AB ;
  - `recorded` : au moins une irrigation saisie. Jusqu'à aujourd'hui, seules
    la pluie et les doses saisies comptent : un stress peut apparaître
    (apport trop tardif, trop faible, ou oublié). À partir de demain, une
    parcelle déclarée irriguée reprend le pilotage idéal, qui prévoit les
    prochains apports.
- **Signalements** : le stress hydrique est signalé sauf en pilotage idéal ;
  son texte donne la dernière irrigation saisie. « Irrigation à prévoir »
  porte la dose simulée, et compte aussi l'apport du jour.
- **Exemple** (test d'intégration) : deux doses de 30 mm sur un maïs déjà en
  stress profond relèvent la réserve sans lever le stress. 30 mm ne suffisent
  pas à repasser au-dessus du seuil.

**Météo** (`daily_weather`, migration 0032)
- **Point** : un seul, au centre de la ferme.
- **Archive ERA5 d'Open-Meteo** :
  - les 5 années civiles avant la saison (normales) et jusqu'à 6 jours avant
    aujourd'hui ;
  - définitive ;
  - seul ce qui manque est téléchargé.
- **API de prévision** : 7 jours passés et 16 à venir, rafraîchie toutes les
  6 heures. Elle ne remplace jamais une journée d'archive.
- **Au-delà** : normales journalières, moyenne des 5 années précédentes jour
  par jour. Une date de stade calculée ainsi est marquée « d'après les
  normales ».
- **Panne d'Open-Meteo** : le cache sert seul. Sans cache, le modèle
  l'indique.
- **Coût mesuré** : 2 500 jours pour la ferme de Pierre au premier appel,
  puis une requête de prévision toutes les 6 heures au plus. Réponse en
  0,6 s pour 11 parcelles.

**Date de la frise** : la saison est simulée avec toute la météo connue. Les
stades et l'eau sont lus à la date de la frise. Un stade postérieur à cette
date s'affiche « vers le … ».

## Résultats sur la ferme de Pierre (2026)

- **Floraison** : maïs semé du 7 au 16 avril, floraison simulée du 27 au
  30 juin.
- **Maturité** : simulée du 17 au 21 août. Le NDVI passe sous 0,3 entre le
  2 août et le 18 septembre selon les parcelles, le 19 août pour la moitié
  d'entre elles.
- **En sec** (réserve de 100 mm par défaut) : la réserve tombe sous le seuil
  de stress mi-juin, avec environ 22 jours de stress autour de la floraison.
  Pourtant le NDVI reste entre 0,8 et 0,9 : ces parcelles sont
  vraisemblablement irriguées, ou leur sol est plus profond.
- **Déclarées irriguées** : plus de stress, et un besoin d'irrigation simulé
  de 285 à 335 mm par saison, avec une ETc de 510 à 580 mm. Ce sont des
  ordres de grandeur réalistes pour un maïs grain du Sud-Ouest.
- **À faire** : déclarer les parcelles irriguées de Pierre (fiche parcelle →
  « Modifier le sol »), ou saisir ses irrigations. Ekylibre ne stocke ni
  réserve utile, ni irrigation sur la ferme de Pierre (aucune intervention
  d'arrosage dans ses données).

## API

| Route | Rôle |
|---|---|
| `GET /crop-model?at=AAAA-MM-JJ` | `{ at, items: ParcelCropState[], alerts: CropAlert[], weatherMissing }` : parcelles semées, avec un modèle |
| `GET /land-parcels/:id/crop-model?at=` | `{ at, state, days, reason }` : série journalière (degrés-jours, eau, Ks, pluie, ETc, irrigation) jusqu'à la récolte saisie, ou 15 jours après « récoltable » ; `reason` : `no_sowing`, `no_model`, `weather_missing` |
| `POST /interventions`, `…/complete`, `PUT /interventions/:id` | Bloc `irrigation` `{ depthMm, method }` des procédures d'irrigation (lot AC) |
| `PUT /land-parcels/:id/soil` | `{ tawMm, irrigated }` (responsable), réserve de 10 à 400 mm |
| `DELETE /land-parcels/:id/soil` | Retour aux valeurs par défaut (responsable) |

`GET /vegetation3d` utilise aussi le modèle : une parcelle en phase
« pas de mesure récente » prend le couvert du modèle
(`canopy.source: "model"`). Sa hauteur suit les degrés-jours de la levée à la
floraison, avec la même puissance 1,5 que pour le NDVI.

## Code

| Où | Quoi |
|---|---|
| `packages/domain/src/crop-model.ts` | Modèles, degrés-jours, simulation (stades, bilan hydrique, irrigation), état à une date, normales, météo continue |
| `packages/domain/src/vegetation3d.ts` | `canopyFromModel` : couvert du plan 3D d'après le modèle |
| `packages/weather` | `openMeteoDays` : archive et prévision journalières (ET0 FAO) |
| `packages/contracts/src/crop-model.ts` | Types, bornes de la réserve utile |
| `packages/db/migrations/0033_irrigation.sql` | `interventions.irrigation` (dose et matériel) |
| `apps/web/src/features/interventions/IrrigationFields.tsx` | Dose, matériel et volume dans le formulaire d'intervention |
| `packages/db/migrations/0032_crop_model.sql` | `daily_weather` (cache), `parcel_soils` (réserve et irrigation saisies), RLS |
| `apps/api/src/repos/crop-model.ts` | Cache météo, saisons, simulation, signalements, sol |
| `apps/web/src/features/crop-model/` | Encadré de la fiche (`CropModelPanel`), widget du tableau de bord (`CropModelWidget`) |

## Tests

- `packages/domain/test/crop-model.test.ts` :
  - degrés-jours ;
  - modèle par espèce ;
  - dates des stades et arrêt à la récolte ;
  - état à une date ;
  - stress en sec et irrigation ;
  - doses saisies, pilotage idéal après `autoFrom` ;
  - enracinement ;
  - normales et météo continue.
- `packages/weather/test/weather.test.ts` : requêtes journalières d'archive et
  de prévision.
- `apps/api/test/crop-model.integration.test.ts` (Open-Meteo simulé) :
  - stades datés, floraison proche et stress signalés ;
  - cache sans second téléchargement, 5 ans de normales ;
  - série de la fiche ; parcelle sans semis ;
  - sol saisi (refusé à un ouvrier), irrigué : plus de stress ;
  - irrigations saisies : dose obligatoire, relue, refusée hors irrigation,
    correction tracée ; doses comptées dans le bilan ;
  - récolte saisie : saison close ;
  - plan 3D sans NDVI : couvert d'après le modèle.
- `apps/web/test/crop-model.test.tsx` :
  - courbe d'eau observée puis prévue ;
  - encadré de la fiche et déclaration « irriguée » ;
  - culture sans modèle ;
  - widget regroupé par sorte, lien « Saisir l'irrigation » ;
  - saisie d'une irrigation (dose proposée, volume, dose obligatoire) et
    fiche de l'intervention.
- `packages/domain/test/intervention-rules.test.ts`,
  `intervention-edits.test.ts` : règle de la dose, comparaison des doses.

## Limites et suite

- **Précocité des variétés** : non prise en compte. Les seuils du maïs sont
  ceux des variétés de Pierre (demi-tardives). Il faudra des seuils par
  groupe de précocité, voire calés sur le NDVI de chaque parcelle.
- **Céréales** : ni vernalisation ni photopériode. En hiver doux, les stades
  précoces (épi 1 cm) peuvent être prévus trop tôt.
- **Irrigation** :
  - la dose s'applique à toute la parcelle, le jour du début de
    l'intervention. Un tour d'eau sur plusieurs jours se saisit en plusieurs
    interventions ;
  - pas d'efficience d'application (pertes par évaporation ou dérive) ;
  - pas de suivi des volumes prélevés par point de prélèvement, ni de quota.
    Les volumes sont calculables, mais aucun rapport n'existe encore.
- **Sol** :
  - un réservoir unique, plein au semis ;
  - pas de remontées capillaires ni de ruissellement ;
  - une carte des sols (réserve utile automatique) reste à étudier.
- **Météo** : un seul point par ferme. Les stations de la ferme (Weenat,
  Sencrop) ne sont pas encore utilisées.
- **Autres cultures** : vigne, prairies, colza et tournesol n'ont pas encore
  de modèle.
- **Suite prévue** : WOFOST (biomasse, rendement potentiel et limité par
  l'eau) dans `services/agro`, puis l'assimilation du LAI Sentinel-2 (ADR-1,
  ADR-17).
