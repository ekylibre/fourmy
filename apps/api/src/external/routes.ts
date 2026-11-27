import type { AccessModule } from "@fourmy/contracts";

/**
 * Routes ouvertes aux accès restreints (claudedocs/conception_api_mcp.md §6.1,
 * lot AM1) : membre `guest`, puis clés d'API et applications OAuth. Chemins
 * relatifs à `/api/v1/farms/:farmId`, motifs Hono tels que déclarés.
 *
 * Refus par défaut : une route absente d'ici répond 404 à un accès restreint.
 * Toute route GET de la ferme figure soit dans `OPEN_ROUTES`, soit dans
 * `CLOSED_ROUTES` (test external-routes.test.ts) : une nouvelle route oblige à
 * choisir. Lot AM1 : lecture seulement.
 */

export type OpenRoute = { method: "GET"; path: string; module: AccessModule; summary: string };

const get = (path: string, module: AccessModule, summary: string): OpenRoute => ({ method: "GET", path, module, summary });

export const OPEN_ROUTES: readonly OpenRoute[] = [
  // Ferme
  get("/farm", "farm", "Identité et réglages publics de la ferme"),
  get("/places", "farm", "Bâtiments et lieux"),

  // Parcellaire
  get("/land-parcels", "parcels", "Parcelles"),
  get("/land-parcels/names", "parcels", "Noms des parcelles"),
  get("/land-parcels/:id/sheet", "parcels", "Fiche d'une parcelle"),
  get("/land-parcels/:id/cover-crop/sowings", "parcels", "Semis de couverts d'une parcelle"),
  get("/land-parcels/:id/indices", "parcels", "Indices de végétation d'une parcelle"),
  get("/landscape-features", "parcels", "Éléments du paysage"),
  get("/water-sources", "parcels", "Points d'eau"),
  get("/remote-sensing/parcels", "parcels", "Télédétection : parcelles suivies"),
  get("/remote-sensing/anomalies", "parcels", "Télédétection : anomalies"),
  get("/remote-sensing/scenes", "parcels", "Télédétection : scènes disponibles"),
  get("/remote-sensing/status", "parcels", "Télédétection : état"),
  // État consolidé du web (carte, listes) : équipements, cuves et lieux retirés si leur module est fermé.
  get("/snapshot", "parcels", "État de la ferme à une date (parcelles, productions…)"),
  // Fonds de carte IGN (données publiques relayées par la ferme) : la carte du web en dépend.
  get("/ign/tiles/:layer/:z/:x/:y", "parcels", "Tuiles de fond de carte IGN"),

  // Activités et assolement
  get("/activities", "activities", "Activités"),
  get("/activities/references", "activities", "Références Lexicon des activités"),
  get("/activities/:id/itinerary", "activities", "Itinéraire d'une activité"),
  get("/crop-plans", "activities", "Assolements"),
  get("/crop-plans/:year", "activities", "Assolement d'une campagne"),
  get("/technical-itineraries", "activities", "Itinéraires techniques"),
  get("/technical-itineraries/history", "activities", "Itinéraires réalisés"),
  get("/technical-itineraries/:id", "activities", "Itinéraire technique"),

  // Interventions
  get("/interventions", "interventions", "Interventions réalisées et prévues"),
  get("/interventions/:id", "interventions", "Détail d'une intervention"),
  get("/interventions/:id/compliance", "interventions", "Contrôle réglementaire d'une intervention"),
  get("/interventions/:id/water", "interventions", "Points d'eau proches d'une intervention"),
  get("/land-parcels/:id/itinerary", "interventions", "Interventions d'une parcelle"),
  get("/procedures", "interventions", "Types d'intervention"),
  get("/reference/bbch", "interventions", "Stades BBCH"),

  // Phytosanitaire et registres
  get("/phyto/articles", "phyto", "Produits phyto de la ferme"),
  get("/phyto/products", "phyto", "Recherche de produits phyto"),
  get("/phyto/status", "phyto", "État du référentiel phyto"),
  get("/phyto/ift", "phyto", "IFT de la campagne"),
  get("/phyto/water", "phyto", "Points d'eau pour les ZNT"),
  get("/phyto/parcels/:id/delays", "phyto", "Délais avant récolte et rentrée d'une parcelle"),
  get("/reference/phyto-crops", "phyto", "Cultures du référentiel phyto"),
  get("/registers/phyto", "phyto", "Registre phytosanitaire"),
  get("/weather/spraying", "phyto", "Conditions de pulvérisation"),

  // Fertilisation
  get("/fertilization/parcels", "fertilization", "Fertilisation par parcelle"),
  get("/fertilization/plans", "fertilization", "Plans de fumure"),
  get("/fertilization/plans/:id", "fertilization", "Plan de fumure"),
  get("/fertilization/record", "fertilization", "Cahier d'enregistrement"),
  get("/fertilizers", "fertilization", "Fertilisants"),
  get("/land-parcels/:id/fertilization", "fertilization", "Fertilisation d'une parcelle"),
  get("/prescriptions", "fertilization", "Cartes de modulation"),
  get("/prescriptions/:id", "fertilization", "Carte de modulation"),

  // Stocks et semences
  get("/articles", "stocks", "Articles"),
  get("/articles/:id/fertilizer", "stocks", "Composition d'un engrais"),
  get("/articles/:id/seed", "stocks", "Fiche semence d'un article"),
  get("/articles/:id/seed/mixture", "stocks", "Composition d'un mélange"),
  get("/stock", "stocks", "État des stocks"),
  get("/containers", "stocks", "Cuves et contenants"),
  get("/containers/:id/contents", "stocks", "Contenu d'une cuve"),
  get("/seeds", "stocks", "Semences"),
  get("/seeds/species", "stocks", "Espèces semées"),
  get("/seeds/usage", "stocks", "Utilisation des semences"),
  get("/seeds/catalog", "stocks", "Catalogue des variétés"),

  // Matériels
  get("/equipments", "equipments", "Matériels"),
  get("/equipments/:id/sheet", "equipments", "Fiche d'un matériel"),
  get("/equipments/:id/maintenance", "equipments", "Entretien d'un matériel"),
  get("/equipments/:id/readings", "equipments", "Relevés de compteur"),
  get("/maintenance/due", "equipments", "Entretiens à faire"),
  get("/maintenance/parts", "equipments", "Pièces d'entretien"),
  get("/equipment-models", "equipments", "Modèles de matériel"),
  get("/brands", "equipments", "Marques"),

  // Personnes et équipes
  get("/people", "people", "Personnes"),
  get("/people/:id", "people", "Fiche d'une personne"),
  get("/people/:id/interventions", "people", "Interventions d'une personne"),
  get("/people/:id/work", "people", "Temps de travail d'une personne"),
  get("/crew-templates", "people", "Équipes types"),

  // Économique
  get("/prices", "economics", "Prix"),
  get("/machinery-rates", "economics", "Barème des matériels"),
  get("/equipments-rates", "economics", "Coûts des matériels"),

  // Certifications
  get("/certifications", "certifications", "Certifications"),
  get("/land-parcels/:id/certifications", "certifications", "Certifications d'une parcelle"),
  get("/seed-derogations", "certifications", "Dérogations semences"),
  get("/control/availability", "certifications", "Contrôles disponibles"),
  get("/control/:kind", "certifications", "Contrôle HVE ou AB"),
  get("/control/ab/parcels", "certifications", "Contrôle AB : parcelles"),
  get("/control/ab/seeds", "certifications", "Contrôle AB : semences"),
  get("/control/hve/iae", "certifications", "Contrôle HVE : infrastructures agroécologiques"),
  get("/control/hve/irrigated", "certifications", "Contrôle HVE : irrigation"),
  get("/control/hve/questionnaire", "certifications", "Contrôle HVE : questionnaire"),
];

/**
 * Routes GET de la ferme jamais ouvertes aux accès restreints, avec la raison.
 * Fichiers et images lourds, intégrations, réglages, synchronisation mobile,
 * écrans internes : ils ne servent pas un client externe, ou exposent ce que
 * le module ne couvre pas.
 */
export const CLOSED_ROUTES: Readonly<Record<string, string>> = {
  "/agrirouter/inbox": "intégration",
  "/agrirouter/inbox/:id/file": "intégration",
  "/integrations": "intégration",
  "/imports": "imports",
  "/imports/:id": "imports",
  "/members": "membres",
  "/sync/pull": "synchronisation mobile",
  "/assets/:id": "fichier",
  "/settings/certification": "réglages",
  "/settings/crop-plan": "réglages",
  "/settings/identity": "réglages",
  "/settings/maintenance": "réglages",
  "/settings/spraying": "réglages",
  "/settings/tracks": "réglages",
  "/fertilization/settings": "réglages",
  "/geocode": "service externe",
  "/geocode/reverse": "service externe",
  "/land-parcels/identify": "service externe",
  "/ign/cache": "tuiles",
  "/ign/cache/manifest": "tuiles",
  "/terrain/heightmap/:z/:x/:y": "tuiles",
  "/plan3d": "3D",
  "/landscape3d": "3D",
  "/vegetation3d": "3D",
  "/equipments/:id/avatar": "3D",
  "/equipments/:id/avatar.glb": "3D",
  "/remote-sensing/images/:date/:kind": "image",
  "/people/:id/photo": "image",
  "/people/me": "propre fiche (session)",
  "/crop-model": "modèle de culture (écran interne)",
  "/land-parcels/:id/crop-model": "modèle de culture (écran interne)",
  "/land-parcels/:id/modulation-dates": "écran interne",
  "/crop-plans/:year/context": "écran interne de l'assolement",
  "/crop-plans/:year/eco-context": "écran interne de l'assolement",
  "/crop-plans/:year/eco-previous": "écran interne de l'assolement",
  "/crop-plans/:year/inputs-context": "écran interne de l'assolement",
  "/crop-plans/:year/itk-context": "écran interne de l'assolement",
  "/crop-plans/:year/versions/:version": "instantané d'assolement (non filtrable par activité)",
  "/prices/suggestions/articles": "écran interne",
  "/prices/suggestions/products": "écran interne",
  "/seeds/attach": "écran interne",
  "/fertilization/documents": "fichiers",
  "/fertilization/documents/:id": "fichiers",
  "/prescriptions/:id/files/:format": "fichiers",
  "/prescriptions/recipients": "intégration",
  "/registers/phyto/official": "export officiel (fichier)",
  "/control/:kind/export": "export (fichier)",
  "/tracks": "traces GPS",
  "/tracks/coverage": "traces GPS",
  "/tracks/hitches": "traces GPS",
  "/tracks/latest": "traces GPS",
  "/tracks/summary": "traces GPS",
  "/track-sessions/:id": "traces GPS",
  "/equipments/:id/track-sessions": "traces GPS",
  "/interventions/:id/track-sessions": "traces GPS",
  "/weather/stations": "intégration météo",
};

export const FARM_PREFIX = "/api/v1/farms/:farmId";

const OPEN_INDEX = new Map(OPEN_ROUTES.map((r) => [`${r.method} ${FARM_PREFIX}${r.path}`, r]));

/** La route Hono (méthode et motif complet) est-elle ouverte ? */
export function openRoute(method: string, fullPath: string): OpenRoute | undefined {
  return OPEN_INDEX.get(`${method === "HEAD" ? "GET" : method} ${fullPath}`);
}
