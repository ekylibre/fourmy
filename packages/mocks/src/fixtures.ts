import type {
  Snapshot,
  InterventionHistoryEntry,
  LandParcelVersion,
  LandParcelAt,
  PlaceVersion,
  PlaceAt,
  ContainerVersion,
  ContainerAt,
  Equipment,
  Production,
  ContainerContents,
  TrackCoverage,
} from "@fourmy/contracts";
import { PROCEDURES, SHAPE_LABELS, TREATMENT_PURPOSE_LABELS } from "@fourmy/contracts";
import type { Activity, Article, Intervention, Person, PhytoRegisterEntry, ProcedureCatalogue, StockLevel } from "@fourmy/contracts";

/**
 * Jeu de données de démonstration — anonymisé, inspiré d'une petite ferme
 * viticole (un bâtiment, deux cuves) + une parcelle de grandes cultures.
 * Sert aux mocks MSW et aux écrans avant l'API réelle. Les fixtures issues
 * des vrais exports (agent B) remplaceront ceci dans `fixtures/`.
 */

export const DEMO_FARM_ID = "00000000-0000-7000-8000-000000000001";
const now = "2026-06-15T10:00:00.000Z";

export const demoLandParcels: LandParcelVersion[] = [
  {
    id: "00000000-0000-7000-8000-0000000000a1",
    landParcelId: "00000000-0000-7000-8000-0000000000a0",
    shape: {
      type: "MultiPolygon",
      coordinates: [[[[0.52, 44.84], [0.521, 44.84], [0.521, 44.841], [0.52, 44.841], [0.52, 44.84]]]],
    },
    areaM2: 12500,
    pacIslet: "12",
    viti: { variety: "Merlot", rowSpacingM: 2, plantSpacingM: 1, densityPerHa: 5000 },
    valid: { lower: "2020-01-01T00:00:00.000Z", upper: null },
  },
  {
    id: "00000000-0000-7000-8000-0000000000b1",
    landParcelId: "00000000-0000-7000-8000-0000000000b0",
    shape: {
      type: "MultiPolygon",
      coordinates: [[[[0.53, 44.85], [0.533, 44.85], [0.533, 44.853], [0.53, 44.853], [0.53, 44.85]]]],
    },
    areaM2: 48000,
    pacIslet: "07",
    valid: { lower: "2020-01-01T00:00:00.000Z", upper: null },
  },
];

export const demoProductions: Production[] = [
  {
    id: "00000000-0000-7000-8000-0000000000c1",
    farmId: DEMO_FARM_ID,
    campaignId: "00000000-0000-7000-8000-0000000000d1",
    landParcelId: "00000000-0000-7000-8000-0000000000a0",
    nature: "vine",
    species: "Vitis vinifera",
    activityId: "00000000-0000-7000-8000-0000000000f1",
    createdAt: now,
    updatedAt: now,
  },
];

/** Activité de la parcelle de démonstration (lot C). */
export const demoActivities: Activity[] = [
  {
    id: "00000000-0000-7000-8000-0000000000f1",
    name: "Vignes AOP",
    family: "vine_farming",
    reference: "vine",
    referenceLabel: "Vigne",
    cultivation: "vitis",
    cultivationLabel: "Vigne",
    color: null,
    suspended: false,
    crop: { code: "27001", label: "Vigne", oepp: "VITVI", proposed: true },
    pictureUrl: null,
    parcelIds: ["00000000-0000-7000-8000-0000000000a0"],
    areaM2: 12_000,
  },
];

export const demoPlaces: PlaceVersion[] = [
  {
    id: "00000000-0000-7000-8000-0000000000e1",
    placeId: "00000000-0000-7000-8000-0000000000e0",
    kind: "building",
    footprint: {
      type: "Polygon",
      coordinates: [[[0.525, 44.845], [0.5255, 44.845], [0.5255, 44.8454], [0.525, 44.8454], [0.525, 44.845]]],
    },
    heightM: 6,
    source: "ign",
    valid: { lower: "2015-01-01T00:00:00.000Z", upper: null },
  },
];

export const demoContainers: ContainerVersion[] = [
  {
    id: "00000000-0000-7000-8000-0000000000f1",
    containerId: "00000000-0000-7000-8000-0000000000f0",
    kind: "tank",
    capacityL: 50000,
    shape3d: { x: 2, y: 2, z: 0, radius: 1.5, height: 7 },
    placement: "auto",
    valid: { lower: "2015-01-01T00:00:00.000Z", upper: null },
  },
  {
    id: "00000000-0000-7000-8000-0000000000f3",
    containerId: "00000000-0000-7000-8000-0000000000f2",
    kind: "tank",
    capacityL: 30000,
    shape3d: { x: 6, y: 2, z: 0, radius: 1.2, height: 6 },
    placement: "auto",
    valid: { lower: "2015-01-01T00:00:00.000Z", upper: null },
  },
];

export const demoEquipments: Equipment[] = [
  {
    id: "00000000-0000-7000-8000-000000000101",
    farmId: DEMO_FARM_ID,
    name: "Tracteur Claas Arion 430",
    kind: "tractor",
    state: "available",
    createdAt: now,
    updatedAt: now,
  },
];

const parcelNames = ["Les Rouffiats", "Grande pièce"];
export const demoLandParcelsAt: LandParcelAt[] = demoLandParcels.map((v, i) => ({
  id: v.landParcelId,
  name: parcelNames[i] ?? `Parcelle ${i + 1}`,
  version: v,
}));

export const demoPlacesAt: PlaceAt[] = demoPlaces.map((v) => ({ id: v.placeId, name: "Chai", version: v }));

export const demoContainersAt: ContainerAt[] = demoContainers.map((v, i) => ({
  id: v.containerId,
  placeId: demoPlaces[0]!.placeId,
  name: `Cuve ${i + 1}`,
  version: v,
}));

export const demoSnapshot: Snapshot = {
  at: now,
  landParcels: demoLandParcelsAt,
  productions: demoProductions,
  places: demoPlacesAt,
  containers: demoContainersAt.map((c) => ({ ...c, volumeL: c.version.capacityL * 0.6 })),
  equipments: demoEquipments,
};

export const demoContainerContents: ContainerContents = {
  containerId: "00000000-0000-7000-8000-0000000000f0",
  at: now,
  volumeL: 30000,
  composition: [
    { lotId: "00000000-0000-7000-8000-000000000201", lotCode: "MERLOT-2025", share: 1, attrs: { vintage: 2025, varieties: ["Merlot"] } },
  ],
  lastMovements: [
    { occurredAt: "2025-10-02T08:00:00.000Z", quantityL: 30000, cause: "intervention" },
  ],
};

export const demoTrackCoverage: TrackCoverage = {
  equipmentId: "00000000-0000-7000-8000-000000000101",
  byParcel: [
    { landParcelId: "00000000-0000-7000-8000-0000000000b0", parcelName: "Grande pièce", durationS: 5400, areaM2: 48000 },
  ],
};

// --- Ajouts pour l'interface web (agent E) ---------------------------------


export const DEMO_USER_ID = "00000000-0000-7000-8000-00000000de00";
export const demoMyFarms = [{ id: DEMO_FARM_ID, name: "Ferme de démonstration", role: "owner" as const }];

export const demoArticles: Article[] = [
  {
    id: "00000000-0000-7000-8000-000000000301",
    farmId: DEMO_FARM_ID,
    lexiconRef: null,
    name: "Fongicide X",
    kind: "phyto",
    unit: "liter",
    amm: "2100001",
    createdAt: now,
    updatedAt: now,
  },
  {
    id: "00000000-0000-7000-8000-000000000302",
    farmId: DEMO_FARM_ID,
    lexiconRef: null,
    name: "Raisin",
    kind: "harvest",
    unit: "liter",
    createdAt: now,
    updatedAt: now,
  },
];

export const demoPeople: Person[] = [
  {
    id: "00000000-0000-7000-8000-000000000601",
    farmId: DEMO_FARM_ID,
    name: "Camille",
    role: "tractoriste",
    userId: null,
    active: true,
    createdAt: now,
    updatedAt: now,
  },
];

export const demoInterventions: Intervention[] = [
  {
    id: "00000000-0000-7000-8000-000000000401",
    farmId: DEMO_FARM_ID,
    procedure: "spraying",
    status: "done",
    startedAt: "2026-06-10T08:00:00.000Z",
    stoppedAt: "2026-06-10T09:00:00.000Z",
    periods: [{ startedAt: "2026-06-10T08:00:00.000Z", stoppedAt: "2026-06-10T09:00:00.000Z" }],
    targets: [{ kind: "land_parcel", id: "00000000-0000-7000-8000-0000000000a0" }],
    inputs: [{ articleId: "00000000-0000-7000-8000-000000000301", quantity: 2, per: "hectare", unit: "liter" }],
    outputs: [],
    tools: [],
    doers: [{ personId: "00000000-0000-7000-8000-000000000601" }],
    staffing: "free",
    crews: [],
    purposes: ["fungicide"],
    notes: null,
    origin: "mobile",
    clientId: "00000000-0000-7000-8000-000000000401",
    createdAt: now,
    updatedAt: now,
  },
];

/** Historique de l'intervention de démo : saisie puis réalisée sur mobile. */
export const demoInterventionHistory: InterventionHistoryEntry[] = [
  {
    id: "00000000-0000-7000-8000-000000000701",
    at: "2026-06-10T09:05:00.000Z",
    action: "completed",
    actor: DEMO_USER_ID,
    actorName: "Camille",
    origin: "mobile",
    reason: null,
    changes: null,
  },
];

/** Catalogue des procédures ; la pulvérisation est l'habitude de la ferme de démo. */
export const demoProcedures: ProcedureCatalogue = {
  shapes: SHAPE_LABELS,
  purposes: TREATMENT_PURPOSE_LABELS,
  items: PROCEDURES.map((p) =>
    p.code === "spraying"
      ? { ...p, usage: 1, suggestions: { tools: [], inputs: ["00000000-0000-7000-8000-000000000301"], doers: ["00000000-0000-7000-8000-000000000601"] } }
      : { ...p, usage: 0, suggestions: { tools: [], inputs: [], doers: [] } },
  ),
};

export const demoStock: StockLevel[] = [
  {
    articleId: "00000000-0000-7000-8000-000000000301",
    articleName: "Fongicide X",
    articleKind: "phyto",
    lotId: "00000000-0000-7000-8000-000000000501",
    lotCode: "LOT-A",
    placeId: "00000000-0000-7000-8000-0000000000e0",
    containerId: null,
    quantity: 18,
    unit: "liter",
  },
  {
    articleId: "00000000-0000-7000-8000-000000000302",
    articleName: "Raisin",
    articleKind: "harvest",
    lotId: "00000000-0000-7000-8000-000000000502",
    lotCode: "LOT-B",
    placeId: null,
    containerId: "00000000-0000-7000-8000-0000000000f0",
    quantity: -5,
    unit: "liter",
  },
];

export const demoPhytoRegister: PhytoRegisterEntry[] = [
  {
    interventionId: "00000000-0000-7000-8000-000000000401",
    doneOn: "2026-06-10T09:00:00.000Z",
    parcelName: "Les Rouffiats",
    areaM2: 12500,
    crop: "Merlot",
    productName: "Fongicide X",
    amm: "2100001",
    quantity: 2,
    unit: "liter_per_hectare",
    applicators: ["Camille"],
  },
];
