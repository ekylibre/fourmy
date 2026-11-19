# Activités

Lot C des retours de test du 08/11/2026. Comme dans Ekylibre, une
**activité** de la ferme (Maïs, Jachère, Vignes AOP, Chai…) regroupe ses
productions : une production = une parcelle × une campagne.

## Modèle (migration 0011)

| Table | Contenu |
|---|---|
| `activities` (RLS) | nom (unique par ferme), famille (`plant_farming`, `vine_farming`, `animal_farming`, `plant_nursery`, `processing`, `wine_making`, `administering`, `tool_maintaining`, `service_delivering`), production de référence, variété cultivée, couleur, en sommeil, `deduced` |
| `productions.activity_id` | activité de la production |
| `lexicon_productions` | 473 productions de référence Lexicon (`grain_corn`, `fallow`, `vine`…) : famille, espèce, libellé, couleur |
| `lexicon_production_ift` | production de référence → culture de l'API IFT (`grain_corn` → 1112 Maïs) |
| `lexicon_pictures` | images d'Ekylibre : 9 familles d'activité, ~230 variétés (nom latin) |

- Référentiel : paquets Lexicon `productions` et `agricultural_pictures`,
  synchronisés par le worker avec `phytosanitary` et `taxonomy` (en local :
  `seed:dev` ou `corepack pnpm --filter @fourmy/lexicon sync`). Tables vides :
  l'API l'annonce au démarrage, et une référence est refusée avec « Référentiel
  Lexicon non chargé » plutôt que « inconnue ».
- Image d'une activité (`fourmy_activity_picture`) : sa variété cultivée ou
  l'ancêtre le plus proche dans la taxonomie (`zea_mays` → `zea`), sinon sa
  famille. Servie sans session : `GET /api/v1/lexicon/pictures/:domaine/:nom`.
- Fermes sans activités (antérieures, fixtures) : `fourmy_ensure_activities`
  en déduit une par (nature, culture), marquée `deduced`. La reprise
  d'Ekylibre crée les activités de la ferme d'origine (même famille,
  référence, variété) et retire les activités déduites devenues vides.

## Cultures successives : productions datées (migration 0063)

Une parcelle peut porter plusieurs cultures la même campagne (culture
principale puis dérobée). Une production peut avoir une date de début et de
fin (`productions.started_on`, `stopped_on` : semis → récolte, remplies par
les imports de fichiers). La culture d'une parcelle à une date est donnée par
`fourmy_production_at(parcelle, jour)` : la production datée en place ce
jour-là, sinon une production non datée de la campagne, sinon une production
datée de la campagne même hors de ses dates. Le contrôle phyto, l'IFT, le
registre et le cahier de fertilisation l'emploient.

**Alerte de saisie** : quand deux productions datées d'une parcelle se
recoupent pendant une intervention (planification, réalisation,
modification), Fourmy prévient (« À vérifier ») et dit quelle culture le
contrôle retient, sans bloquer.

Les couverts d'interculture (CINE, CIE) ne sont pas des productions : ils
vont dans `cover_crops` (fertilisation, lot AI).

## Couleur par défaut

Nomenclature d'Ekylibre `db/nomenclatures/colors.yml` (193 variétés,
migration 0014 `variety_colors`) : la couleur de la variété cultivée ou de
son ancêtre le plus proche (`fourmy_variety_color`), sinon celle de la
production de référence ; une couleur choisie l'emporte.

## Ce que l'activité décide

- **Culture contrôlée** (usages E-Phy) : variété de l'activité, sinon celle
  de sa production de référence, sinon celle de la production.
- **Jachère** (référence `fallow`…) : espèce générique « plant », usages
  « Jachères et cultures intermédiaires » et « Traitements généraux »
  seulement. À l'inverse, une culture en place n'admet pas les usages
  génériques des jachères, Jevi et jardins d'amateur.
- **Usage retenu d'office** quand un seul usage du produit vaut pour
  l'activité des parcelles (modifiable s'il y en a plusieurs).
- **Culture IFT** : celle de la production de référence (Lexicon), sinon
  rapprochement par libellé.
- **Image** sur la fiche d'une intervention (parcelles) et dans le
  formulaire (activités des parcelles choisies).

## Écran « Activités » (`/f/:ferme/activities`)

Par famille : image, nom, référence, culture, parcelles et surface de la
campagne de la frise. Le responsable crée une activité depuis une
production de référence (nom, famille, culture et couleur pré-remplis),
la modifie, la met en sommeil, la supprime (si elle n'a plus de
productions) et choisit ses parcelles d'une campagne
(`PUT /activities/:id/parcels`) : une production par parcelle ajoutée ; les
productions des autres activités (cultures successives) ne bougent pas.

## Pilotes (reprise locale du 08/11/2026)

- Pierre : Maïs (`grain_corn`, 116 productions), Jachère (`fallow`, 36),
  Avoine, Triticale, Prairie temporaire. Les 36 jachères, auparavant
  « culture inconnue », sont contrôlées sur les usages des jachères.
- Frédéric : Vignes AOP, Plantations nouvelles (`vine`), Chai, Gestion
  administrative, Maintenance équipements.

## Certifications des parcelles (lot G)

`parcel_certifications` (migration 0015, RLS) : AB (en conversion,
certifiée), HVE 1 à 3, AOP/AOC, IGP, Label Rouge, STG, GLOBALG.A.P.,
Rainforest Alliance, autre cahier des charges ; début, fin, organisme, n°.

- Saisie : « Parcelles » d'une activité → « Certifications » d'une parcelle
  (`POST /land-parcels/:id/certifications`, `PUT|DELETE /certifications/:id`).
- **Récapitulatif par activité** : par certification, parcelles certifiées
  pendant la campagne (« AB · 3/8 »).
- Fiche d'une intervention : certifications de chaque parcelle à sa date.
- **Contrôle phyto** : une parcelle AB (ou en conversion) à la date du
  traitement n'admet que les produits « utilisables en agriculture
  biologique » (mention E-Phy) ; sinon feu rouge.
