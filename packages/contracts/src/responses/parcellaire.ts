import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Parcellaire (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Parcelles : `GET /land-parcels`. */
export const landParcelsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.object({
        id: z.string(),
        landParcelId: z.string(),
        shape: geoJsonGeometry,
        areaM2: z.number(),
        valid: z.object({
          lower: z.string(),
          upper: z.string().nullable(),
        }),
        pacIslet: z.string().optional(),
        viti: z
          .object({
            variety: z.string().optional(),
            rootstock: z.string().optional(),
            rowSpacingM: z.number().optional(),
            plantSpacingM: z.number().optional(),
            densityPerHa: z.number().optional(),
            plantedOn: z.string().optional(),
          })
          .optional(),
      }),
    }),
  ),
  nextCursor: z.null(),
});

/** Noms des parcelles : `GET /land-parcels/names`. */
export const landParcelsNamesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
    }),
  ),
});

/** Fiche d'une parcelle : `GET /land-parcels/:id/sheet`. */
export const landParcelsSheetResponse = z.object({
  id: z.string(),
  name: z.string(),
  shape: geoJsonGeometry,
  areaM2: z.number(),
  center: z.tuple([z.number(), z.number()]),
  pacIslet: z.string().nullable(),
  since: z.string(),
  until: z.string().nullable(),
  productions: z.array(
    z.object({
      year: z.number(),
      declared: z.boolean().optional(),
      activity: z
        .object({
          id: z.string(),
          name: z.string(),
          color: z.string().nullable(),
          pictureUrl: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  cadastre: z.array(
    z.object({
      idu: z.string(),
      label: z.string().nullable(),
      areaM2: z.number().nullable(),
      overlapM2: z.number().nullable(),
      geometry: geoJsonGeometry,
    }),
  ),
  cap: z.array(
    z.object({
      id: z.string(),
      year: z.number(),
      cropCode: z.string().nullable(),
      cropLabel: z.string().nullable(),
      areaM2: z.number().nullable(),
      overlapM2: z.number().nullable(),
      source: z.enum(["telepac", "rpg"]).optional(),
      islet: z.string().nullable().optional(),
      parcelNumber: z.string().nullable().optional(),
    }),
  ),
  islets: z
    .array(
      z.object({
        ref: z.string(),
        number: z.string().nullable(),
        year: z.number(),
        overlapM2: z.number().nullable(),
      }),
    )
    .optional(),
  referencesFetchedAt: z.string().nullable(),
  water: z.array(
    z.object({
      id: z.string(),
      name: z.string().nullable(),
      kind: z.string(),
      permanent: z.boolean().nullable(),
      ditch: z.boolean(),
      distanceM: z.number(),
      geometry: geoJsonGeometry,
    }),
  ),
  interventions: z.array(
    z.object({
      id: z.string(),
      procedure: z.string(),
      status: z.string(),
      at: z.string().nullable(),
    }),
  ),
});

/** Semis de couverts d'une parcelle : `GET /land-parcels/:id/cover-crop/sowings`. */
export const landParcelsCoverCropSowingsResponse = z.object({
  items: z.array(
    z.object({
      interventionId: z.string(),
      startedAt: z.string(),
      components: z.array(
        z.object({
          label: z.string(),
          species: z.string().nullable(),
          kgHa: z.number().nullable(),
        }),
      ),
      family: z
        .enum([
          "cruciferes",
          "graminees_seigle_avoine",
          "graminees_ray_grass",
          "legumineuses",
          "hydrophyllacees",
          "melange_graminees_legumineuses",
          "melange_cruciferes_legumineuses",
        ])
        .nullable(),
      legumes: z.number(),
    }),
  ),
});

/** Indices de végétation d'une parcelle : `GET /land-parcels/:id/indices`. */
export const landParcelsIndicesResponse = z.object({
  parcelId: z.string(),
  index: z.enum(["ndvi", "ndre", "ndmi"]),
  from: z.string(),
  to: z.string(),
  parcelPixels: z.number(),
  tooSmall: z.boolean(),
  points: z.array(
    z.object({
      date: z.string(),
      mean: z.number().nullable(),
      p10: z.number().nullable(),
      p90: z.number().nullable(),
      validRatio: z.number(),
      usable: z.boolean(),
    }),
  ),
  smoothed: z.array(
    z.object({
      date: z.string(),
      value: z.number(),
    }),
  ),
  reference: z.array(
    z.object({
      date: z.string(),
      median: z.number(),
      years: z.number(),
    }),
  ),
  referenceYears: z.array(z.number()),
  interventions: z.array(
    z.object({
      id: z.string(),
      procedure: z.string(),
      at: z.string(),
    }),
  ),
  attribution: z.string(),
});

/** Éléments du paysage : `GET /landscape-features`. */
export const landscapeFeaturesResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: geoJsonGeometry,
      properties: z.object({
        id: z.string(),
        kind: z.string(),
        label: z.string().nullable(),
        capType: z.string().nullable(),
        widthM: z.number().nullable(),
        areaM2: z.number().nullable(),
        campaign: z.number().nullable(),
      }),
    }),
  ),
});

/** Points d'eau : `GET /water-sources`. */
export const waterSourcesResponse = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      origin: z.enum(["surface", "groundwater"]),
      nitrateMgL: z.number().nullable(),
      measuredOn: z.string().nullable(),
      method: z.enum(["lab", "strip"]).nullable(),
      id: z.string(),
      parcels: z.number(),
    }),
  ),
});

/** Télédétection : parcelles suivies : `GET /remote-sensing/parcels`. */
export const remoteSensingParcelsResponse = z.object({
  at: z.string(),
  index: z.enum(["ndvi", "ndre", "ndmi"]),
  items: z.array(
    z.object({
      parcelId: z.string(),
      versionId: z.string(),
      status: z.enum(["ok", "none", "stale", "too_small"]),
      date: z.string().nullable(),
      ageDays: z.number().nullable(),
      mean: z.number().nullable(),
      p10: z.number().nullable(),
      p50: z.number().nullable(),
      p90: z.number().nullable(),
      validRatio: z.number().nullable(),
      parcelPixels: z.number(),
    }),
  ),
  images: z.array(
    z.object({
      date: z.string(),
      kind: z.enum(["ndvi", "rgb"]),
      bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
      url: z.string(),
    }),
  ),
  attribution: z.string(),
});

/** Télédétection : anomalies : `GET /remote-sensing/anomalies`. */
export const remoteSensingAnomaliesResponse = z.object({
  items: z.array(
    z.object({
      parcelId: z.string(),
      parcelName: z.string(),
      from: z.string(),
      to: z.string(),
      high: z.number(),
      low: z.number(),
      confirmed: z.boolean(),
      dueSince: z.string(),
      suggestedProcedure: z.string(),
    }),
  ),
});

/** Télédétection : scènes disponibles : `GET /remote-sensing/scenes`. */
export const remoteSensingScenesResponse = z.object({
  items: z.array(
    z.object({
      date: z.string(),
      validRatio: z.number(),
      images: z.array(z.enum(["ndvi", "rgb"])),
    }),
  ),
});

/** Télédétection : état : `GET /remote-sensing/status`. */
export const remoteSensingStatusResponse = z.object({
  enabled: z.boolean(),
  lastSceneOn: z.string().nullable(),
  usage: z.object({
    month: z.string(),
    requests: z.number(),
    pu: z.number(),
    budget: z.number(),
  }),
});

/** État de la ferme à une date (parcelles, productions…) : `GET /snapshot`. */
export const snapshotResponse = z.object({
  at: z.string(),
  landParcels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.object({
        id: z.string(),
        landParcelId: z.string(),
        shape: geoJsonGeometry,
        areaM2: z.number(),
        valid: z.object({
          lower: z.string(),
          upper: z.string().nullable(),
        }),
        pacIslet: z.string().optional(),
        viti: z
          .object({
            variety: z.string().optional(),
            rootstock: z.string().optional(),
            rowSpacingM: z.number().optional(),
            plantSpacingM: z.number().optional(),
            densityPerHa: z.number().optional(),
            plantedOn: z.string().optional(),
          })
          .optional(),
      }),
    }),
  ),
  productions: z.array(
    z.object({
      id: z.string(),
      farmId: z.string(),
      campaignId: z.string(),
      landParcelId: z.string(),
      nature: z.enum(["field_crop", "vine", "grassland"]),
      createdAt: z.string(),
      updatedAt: z.string(),
      species: z.string().optional(),
      activityId: z.string().nullable().optional(),
    }),
  ),
  places: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      version: z.object({
        id: z.string(),
        placeId: z.string(),
        kind: z.enum(["building", "room", "storage"]),
        source: z.enum(["manual", "ign", "ekylibre"]),
        valid: z.object({
          lower: z.string(),
          upper: z.string().nullable(),
        }),
        footprint: geoJsonGeometry.optional(),
        heightM: z.number().optional(),
      }),
    }),
  ),
  containers: z.array(
    z.object({
      id: z.string(),
      placeId: z.string(),
      name: z.string(),
      version: z.object({
        id: z.string(),
        containerId: z.string(),
        kind: z.enum(["tank", "silo", "barrel"]),
        capacityL: z.number(),
        shape3d: z
          .object({
            x: z.number(),
            y: z.number(),
            z: z.number(),
            radius: z.number(),
            height: z.number(),
          })
          .nullable(),
        placement: z.enum(["manual", "auto"]),
        valid: z.object({
          lower: z.string(),
          upper: z.string().nullable(),
        }),
      }),
      volumeL: z.number(),
    }),
  ),
  equipments: z.array(
    z.object({
      id: z.string(),
      farmId: z.string(),
      name: z.string(),
      kind: z.string(),
      createdAt: z.string(),
      updatedAt: z.string(),
      state: z.string().optional(),
    }),
  ),
});
