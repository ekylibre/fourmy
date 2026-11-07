import type {
  Snapshot,
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
    createdAt: now,
    updatedAt: now,
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
    { lotId: "00000000-0000-7000-8000-000000000201", lotCode: "MERLOT-2025", share: 1, attrs: { vintage: 2025, variety: "Merlot" } },
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
