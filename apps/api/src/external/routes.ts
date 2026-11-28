import { z } from "zod";
import { articleKind, priceKind, proposal, proposalList, proposalStatus, proposalWrite, seedUsageBy, vegetationIndex, type AccessModule } from "@fourmy/contracts";
import * as R from "@fourmy/contracts/responses";

/**
 * Routes ouvertes aux accès restreints (claudedocs/conception_api_mcp.md §6.1,
 * lot AM1) : membre `guest`, puis clés d'API et applications OAuth. Chemins
 * relatifs à `/api/v1/farms/:farmId`, motifs Hono tels que déclarés.
 *
 * Refus par défaut : une route absente d'ici répond 404 à un accès restreint.
 * Toute route GET de la ferme figure soit dans `OPEN_ROUTES`, soit dans
 * `CLOSED_ROUTES` (test external-routes.test.ts) : une nouvelle route oblige à
 * choisir. Lot AM1 : lecture seulement ; lot AM8 : une écriture, le dépôt
 * d'une proposition (`POST /proposals`, module Interventions en écriture).
 */

/** Paramètre de requête d'une route ouverte (documentation OpenAPI, lot AM7). */
export type QueryParam = { name: string; schema: z.ZodType; description: string; required: boolean };

export type OpenRoute = {
  method: "GET" | "POST";
  path: string;
  module: AccessModule;
  summary: string;
  /** Réponse JSON (200), vérifiée par le test de conformité ; null pour une réponse binaire. */
  response: z.ZodType | null;
  query: QueryParam[];
  /** Type de contenu d'une réponse binaire (tuiles). */
  binary?: string;
  /** Corps JSON d'une écriture (POST), réponse 201. */
  body?: z.ZodType;
};

/** Schémas des routes ouvertes hors de @fourmy/contracts/responses, par nom de composant OpenAPI. */
export const EXTRA_SCHEMAS: Readonly<Record<string, z.ZodType>> = { proposals: proposalList, proposal, proposalWrite };

const get = (path: string, module: AccessModule, summary: string, response: z.ZodType | null, query: QueryParam[] = [], binary?: string): OpenRoute => ({
  method: "GET",
  path,
  module,
  summary,
  response,
  query,
  ...(binary ? { binary } : {}),
});

const post = (path: string, module: AccessModule, summary: string, body: z.ZodType, response: z.ZodType): OpenRoute => ({
  method: "POST",
  path,
  module,
  summary,
  response,
  query: [],
  body,
});

const param = (name: string, schema: z.ZodType, description: string, required = false): QueryParam => ({ name, schema, description, required });
const DAY = z.iso.date();
/** Paramètres de requête courants. */
const q = {
  at: param("at", z.string(), "Date de l'état (AAAA-MM-JJ ou ISO 8601), défaut maintenant"),
  campaign: param("campaign", z.int(), "Campagne (année), défaut l'année en cours"),
  year: param("year", z.int(), "Campagne (année), défaut l'année en cours"),
  index: param("index", vegetationIndex, "Indice de végétation, défaut ndvi"),
  from: (d: string, required = false) => param("from", DAY, `Début (AAAA-MM-JJ) ; ${d}`, required),
  to: (d: string, required = false) => param("to", DAY, `Fin (AAAA-MM-JJ) ; ${d}`, required),
  day: (name: string, d: string) => param(name, DAY, d),
  dateTime: (name: string, d: string) => param(name, z.string(), `${d} (ISO 8601)`),
  int: (name: string, d: string, required = false) => param(name, z.int(), d, required),
  text: (name: string, d: string, required = false) => param(name, z.string(), d, required),
  uuid: (name: string, d: string, required = false) => param(name, z.uuid(), `${d} (identifiant)`, required),
  enumOf: (name: string, values: readonly string[], d: string) => param(name, z.enum(values as [string, ...string[]]), d),
  format: (values: string[]) => param("format", z.enum(values as [string, ...string[]]), `Format : ${values.join(", ")} (défaut json)`),
};

export const OPEN_ROUTES: readonly OpenRoute[] = [
  // Ferme
  get("/farm", "farm", "Identité et réglages publics de la ferme", R.farmResponse),
  get("/places", "farm", "Bâtiments et lieux", R.placesResponse, [q.at]),

  // Parcellaire
  get("/land-parcels", "parcels", "Parcelles", R.landParcelsResponse, [q.at]),
  get("/land-parcels/names", "parcels", "Noms des parcelles", R.landParcelsNamesResponse),
  get("/land-parcels/:id/sheet", "parcels", "Fiche d'une parcelle", R.landParcelsSheetResponse),
  get("/land-parcels/:id/cover-crop/sowings", "parcels", "Semis de couverts d'une parcelle", R.landParcelsCoverCropSowingsResponse, [q.campaign]),
  get("/land-parcels/:id/indices", "parcels", "Indices de végétation d'une parcelle", R.landParcelsIndicesResponse, [q.index, q.from("défaut : un an avant to"), q.to("défaut : aujourd'hui")]),
  get("/landscape-features", "parcels", "Éléments du paysage", R.landscapeFeaturesResponse, [q.int("campaign", "Campagne PAC des éléments ; toutes par défaut")]),
  get("/water-sources", "parcels", "Points d'eau", R.waterSourcesResponse),
  get("/remote-sensing/parcels", "parcels", "Télédétection : parcelles suivies", R.remoteSensingParcelsResponse, [q.day("at", "Jour (AAAA-MM-JJ), défaut aujourd'hui"), q.index]),
  get("/remote-sensing/anomalies", "parcels", "Télédétection : anomalies", R.remoteSensingAnomaliesResponse, [q.from("défaut : un an avant to"), q.to("défaut : aujourd'hui")]),
  get("/remote-sensing/scenes", "parcels", "Télédétection : scènes disponibles", R.remoteSensingScenesResponse, [q.from("défaut : un an avant to"), q.to("défaut : aujourd'hui")]),
  get("/remote-sensing/status", "parcels", "Télédétection : état", R.remoteSensingStatusResponse),
  // État consolidé du web (carte, listes) : équipements, cuves et lieux retirés si leur module est fermé.
  get("/snapshot", "parcels", "État de la ferme à une date (parcelles, productions…)", R.snapshotResponse, [q.at]),
  // Fonds de carte IGN (données publiques relayées par la ferme) : la carte du web en dépend.
  get("/ign/tiles/:layer/:z/:x/:y", "parcels", "Tuiles de fond de carte IGN", null, [], "image/png"),

  // Activités et assolement
  get("/activities", "activities", "Activités", R.activitiesResponse, [q.year]),
  get("/activities/references", "activities", "Références Lexicon des activités", R.activitiesReferencesResponse, [q.text("q", "Recherche dans les libellés"), q.text("family", "Famille d'activité (plant_farming, vine_farming…)")]),
  get("/activities/:id/itinerary", "activities", "Itinéraire d'une activité", R.activitiesItineraryResponse, [q.year]),
  get("/crop-plans", "activities", "Assolements", R.cropPlansResponse),
  get("/crop-plans/:year", "activities", "Assolement d'une campagne", R.cropPlansOneResponse),
  get("/technical-itineraries", "activities", "Itinéraires techniques", R.technicalItinerariesResponse, [q.uuid("activityId", "Activité"), q.enumOf("active", ["true", "false"], "Itinéraires actifs ou archivés")]),
  get("/technical-itineraries/history", "activities", "Itinéraires réalisés", R.technicalItinerariesHistoryResponse, [q.uuid("activityId", "Activité", true)]),
  get("/technical-itineraries/:id", "activities", "Itinéraire technique", R.technicalItinerariesOneResponse),

  // Interventions
  get("/interventions", "interventions", "Interventions réalisées et prévues", R.interventionsResponse, [q.enumOf("status", ["planned", "done", "cancelled"], "État"), q.int("campaign", "Campagne (année) : toute la campagne ; sinon from et to"), q.from("obligatoire sans campaign ; 366 jours au plus"), q.to("obligatoire sans campaign")]),
  get("/interventions/:id", "interventions", "Détail d'une intervention", R.interventionsOneResponse),
  get("/interventions/:id/compliance", "interventions", "Contrôle réglementaire d'une intervention", R.interventionsComplianceResponse),
  get("/interventions/:id/water", "interventions", "Points d'eau proches d'une intervention", R.interventionsWaterResponse),
  get("/land-parcels/:id/itinerary", "interventions", "Interventions d'une parcelle", R.landParcelsItineraryResponse, [q.year, q.int("years", "Nombre de campagnes (1 à 20), défaut 1")]),
  get("/procedures", "interventions", "Types d'intervention", R.proceduresResponse),
  get("/reference/bbch", "interventions", "Stades BBCH", R.referenceBbchResponse, [q.text("crop", "Code culture du référentiel phyto", true)]),
  // Propositions (lot AM8) : un accès en écriture propose, le responsable de la ferme accepte ou refuse.
  get("/proposals", "interventions", "Propositions déposées par cet accès", proposalList, [q.enumOf("status", proposalStatus.options, "État : pending, accepted, rejected, expired")]),
  get("/proposals/:id", "interventions", "Une proposition et sa décision", proposal),
  post("/proposals", "interventions", "Proposer une intervention (contrôlée à blanc, à valider par le responsable)", proposalWrite, proposal),

  // Phytosanitaire et registres
  get("/phyto/articles", "phyto", "Produits phyto de la ferme", R.phytoArticlesResponse),
  get("/phyto/products", "phyto", "Recherche de produits phyto", R.phytoProductsResponse, [q.text("q", "Nom ou numéro AMM")]),
  get("/phyto/status", "phyto", "État du référentiel phyto", R.phytoStatusResponse),
  get("/phyto/ift", "phyto", "IFT de la campagne", R.phytoIftResponse, [q.int("campaign", "Campagne (année)", true)]),
  get("/phyto/water", "phyto", "Points d'eau pour les ZNT", R.phytoWaterResponse),
  get("/phyto/parcels/:id/delays", "phyto", "Délais avant récolte et rentrée d'une parcelle", R.phytoParcelsDelaysResponse, [q.dateTime("at", "Instant de référence, défaut maintenant")]),
  get("/reference/phyto-crops", "phyto", "Cultures du référentiel phyto", R.referencePhytoCropsResponse),
  get("/registers/phyto", "phyto", "Registre phytosanitaire", R.registersPhytoResponse, [q.campaign, q.format(["json", "csv", "pdf"])]),
  get("/weather/spraying", "phyto", "Conditions de pulvérisation", R.weatherSprayingResponse, [q.int("days", "Nombre de jours (1 à 5), défaut 3"), q.dateTime("from", "Début, défaut maintenant")]),

  // Fertilisation
  get("/fertilization/parcels", "fertilization", "Fertilisation par parcelle", R.fertilizationParcelsResponse, [q.at]),
  get("/fertilization/plans", "fertilization", "Plans de fumure", R.fertilizationPlansResponse, [q.campaign]),
  get("/fertilization/plans/:id", "fertilization", "Plan de fumure", R.fertilizationPlansOneResponse),
  get("/fertilization/record", "fertilization", "Cahier d'enregistrement", R.fertilizationRecordResponse, [q.campaign, q.format(["json", "csv"])]),
  get("/fertilizers", "fertilization", "Fertilisants", R.fertilizersResponse),
  get("/land-parcels/:id/fertilization", "fertilization", "Fertilisation d'une parcelle", R.landParcelsFertilizationResponse),
  get("/prescriptions", "fertilization", "Cartes de modulation", R.prescriptionsResponse, [q.uuid("parcel", "Parcelle")]),
  get("/prescriptions/:id", "fertilization", "Carte de modulation", R.prescriptionsOneResponse),

  // Stocks et semences
  get("/articles", "stocks", "Articles", R.articlesResponse, [q.enumOf("kind", articleKind.options, "Nature d'article")]),
  get("/articles/:id/fertilizer", "stocks", "Composition d'un engrais", R.articlesFertilizerResponse),
  get("/articles/:id/seed", "stocks", "Fiche semence d'un article", R.articlesSeedResponse, [q.at]),
  get("/articles/:id/seed/mixture", "stocks", "Composition d'un mélange", R.articlesSeedMixtureResponse),
  get("/stock", "stocks", "État des stocks", R.stockResponse, [q.at, q.uuid("article", "Article"), q.uuid("place", "Lieu de stockage")]),
  get("/containers", "stocks", "Cuves et contenants", R.containersResponse, [q.at]),
  get("/containers/:id/contents", "stocks", "Contenu d'une cuve", R.containersContentsResponse, [q.at]),
  get("/seeds", "stocks", "Semences", R.seedsResponse, [q.at]),
  get("/seeds/species", "stocks", "Espèces semées", R.seedsSpeciesResponse),
  get("/seeds/usage", "stocks", "Utilisation des semences", R.seedsUsageResponse, [q.campaign, q.enumOf("by", seedUsageBy.options, "Regroupement, défaut article"), q.format(["json", "csv"])]),
  get("/seeds/catalog", "stocks", "Catalogue des variétés", R.seedsCatalogResponse, [q.text("q", "Recherche"), q.text("species", "Espèce")]),

  // Matériels
  get("/equipments", "equipments", "Matériels", R.equipmentsResponse),
  get("/equipments/:id/sheet", "equipments", "Fiche d'un matériel", R.equipmentsSheetResponse),
  get("/equipments/:id/maintenance", "equipments", "Entretien d'un matériel", R.equipmentsMaintenanceResponse, [q.at]),
  get("/equipments/:id/readings", "equipments", "Relevés de compteur", R.equipmentsReadingsResponse),
  get("/maintenance/due", "equipments", "Entretiens à faire", R.maintenanceDueResponse, [q.at]),
  get("/maintenance/parts", "equipments", "Pièces d'entretien", R.maintenancePartsResponse, [q.at, q.int("hours", "Horizon en heures de compteur"), q.int("months", "Horizon en mois, défaut 3")]),
  get("/equipment-models", "equipments", "Modèles de matériel", R.equipmentModelsResponse),
  get("/brands", "equipments", "Marques", R.brandsResponse),

  // Personnes et équipes
  get("/people", "people", "Personnes", R.peopleResponse, [q.day("at", "Jour (AAAA-MM-JJ), défaut aujourd'hui")]),
  get("/people/:id", "people", "Fiche d'une personne", R.peopleOneResponse, [q.day("at", "Jour (AAAA-MM-JJ), défaut aujourd'hui")]),
  get("/people/:id/interventions", "people", "Interventions d'une personne", R.peopleInterventionsResponse, [q.from("obligatoire", true), q.to("obligatoire", true), q.int("cursor", "Décalage, défaut 0"), q.int("limit", "1 à 100, défaut 20")]),
  get("/people/:id/work", "people", "Temps de travail d'une personne", R.peopleWorkResponse, [q.day("at", "Jour (AAAA-MM-JJ), défaut aujourd'hui")]),
  get("/crew-templates", "people", "Équipes types", R.crewTemplatesResponse),

  // Économique
  get("/prices", "economics", "Prix", R.pricesResponse, [q.enumOf("kind", priceKind.options, "Nature de prix"), q.day("at", "Jour (AAAA-MM-JJ), défaut aujourd'hui"), q.enumOf("history", ["1"], "1 : tout l'historique")]),
  get("/machinery-rates", "economics", "Barème des matériels", R.machineryRatesResponse, [q.text("procedure", "Type d'intervention"), q.text("q", "Recherche")]),
  get("/equipments-rates", "economics", "Coûts des matériels", R.equipmentsRatesResponse),

  // Certifications
  get("/certifications", "certifications", "Certifications", R.certificationsResponse),
  get("/land-parcels/:id/certifications", "certifications", "Certifications d'une parcelle", R.landParcelsCertificationsResponse),
  get("/seed-derogations", "certifications", "Dérogations semences", R.seedDerogationsResponse),
  get("/control/availability", "certifications", "Contrôles disponibles", R.controlAvailabilityResponse, [q.campaign]),
  get("/control/:kind", "certifications", "Contrôle HVE ou AB", R.controlOneResponse, [q.campaign]),
  get("/control/ab/parcels", "certifications", "Contrôle AB : parcelles", R.controlAbParcelsResponse, [q.campaign]),
  get("/control/ab/seeds", "certifications", "Contrôle AB : semences", R.controlAbSeedsResponse, [q.campaign]),
  get("/control/hve/iae", "certifications", "Contrôle HVE : infrastructures agroécologiques", R.controlHveIaeResponse, [q.campaign]),
  get("/control/hve/irrigated", "certifications", "Contrôle HVE : irrigation", R.controlHveIrrigatedResponse, [q.campaign]),
  get("/control/hve/questionnaire", "certifications", "Contrôle HVE : questionnaire", R.controlHveQuestionnaireResponse, [q.campaign]),
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
  "/accesses": "gestion des accès externes",
  "/accesses/:id/log": "gestion des accès externes",
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
  "/seeds/units": "écran interne (réécriture des unités reprises)",
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
