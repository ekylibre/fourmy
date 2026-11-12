# Parcelles

Lot H des retours de test du 08/11/2026 (15 h 32).

## Créer une parcelle depuis la carte (`/f/:ferme/land-parcels/new`)

Comme l'identificateur de parcelle de Lexicon : on est sur la carte de la
ferme (parcelles existantes en jaune), on clique dans le champ, Fourmy
propose ce qu'il y a à ce point (`GET /land-parcels/identify`, API Carto de
l'IGN, sans clé) :

- la **parcelle PAC** (registre parcellaire graphique, campagnes 2015 à
  2024 ; pour une campagne plus récente, la dernière publiée), avec sa
  culture déclarée (code PAC → libellé et production de référence, table
  Lexicon `lexicon_cap_codes`) et l'**activité de la ferme** proposée
  d'après cette production ;
- les **parcelles cadastrales** du point (IDU, section, numéro, commune,
  contenance) ;
- la parcelle de la ferme déjà présente, le cas échéant : celle dont une
  version vaut pour l'année de la campagne (les parcelles reprises
  d'Ekylibre ont une version close, une par campagne), sinon une version
  ouverte.

Si l'API Carto ne répond pas (panne du 12/11/2026 : tout `apicarto.ign.fr`
en 404), l'écran le signale (« injoignable en partie ») et ne propose que la
parcelle de la ferme.

On choisit la forme (PAC ou cadastrale), on valide les champs pré-remplis
(nom : lieu-dit, section ou culture, campagne ; campagne ; activité) :
`POST /land-parcels/from-map` crée la parcelle (version ouverte au début de
la campagne), sa production pour l'activité, et charge ses références.
Accès : « Parcelles » d'une activité → « Nouvelle parcelle sur la carte »
(l'activité est pré-choisie).

Une parcelle peut correspondre ou non à une parcelle PAC ; elle recoupe une
ou plusieurs parcelles cadastrales.

## Références gardées dans Fourmy (`parcel_references`, migration 0016)

Rafraîchies à la création et par « Actualiser PAC et cadastre »
(`POST /land-parcels/:id/references/refresh`) : parcelles cadastrales que
la parcelle recoupe (avec la surface commune), parcelles PAC au même
endroit pour chaque campagne publiée. Stockées avec leurs géométries :
disponibles hors connexion.

## Fiche (`/f/:ferme/land-parcels/:id`)

Onglets : **Général** (carte avec l'eau, activités par campagne,
certifications, identité), **Cultures** (déclarées à la PAC campagne par
campagne, face aux productions de Fourmy), **Cadastre** (parcelles
recoupées pour plus de 1 % de la surface, contenance et surface commune),
**Eau à proximité** (BD TOPO, distances), **Météo** (conditions de
pulvérisation), **Interventions**. Accès : carte (parcelle choisie),
« Parcelles » d'une activité.

Hors périmètre pour l'instant (rubriques de l'outil Lexicon) : propriétaires,
exploitations et population agricole de la commune, signes de qualité de
la commune, sol et zonages.
