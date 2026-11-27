import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Phytosanitaire et registres (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Produits phyto de la ferme : `GET /phyto/articles`. */
export const phytoArticlesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      unit: z.string(),
      amm: z.string().nullable(),
      product: z
        .object({
          name: z.string(),
          state: z.string(),
          stoppedOn: z.string().nullable(),
        })
        .nullable(),
      hazards: z.array(z.string()),
      risks: z.array(
        z.object({
          code: z.string(),
          phrase: z.string(),
        }),
      ),
      reentryDelayHours: z.number().nullable(),
      operatorProtection: z.string().nullable(),
      restrictedMentions: z.string().nullable(),
      mixCodes: z.array(z.number()),
      organic: z.boolean(),
      biocontrol: z.boolean(),
      copper: z
        .union([
          z.object({
            g: z.number(),
            per: z.enum(["kg", "L"]),
            from: z.enum(["article", "ephy"]),
          }),
          z.object({
            from: z.literal("unknown"),
          }),
        ])
        .optional(),
    }),
  ),
});

/** Recherche de produits phyto : `GET /phyto/products`. */
export const phytoProductsResponse = z.object({
  items: z.array(
    z.object({
      id: z.number(),
      amm: z.string(),
      name: z.string(),
      otherNames: z.array(z.string()),
      natures: z.array(z.string()),
      state: z.string(),
      stoppedOn: z.string().nullable(),
      reentryDelayHours: z.number().nullable(),
    }),
  ),
});

/** État du référentiel phyto : `GET /phyto/status`. */
export const phytoStatusResponse = z.object({
  referential: z.object({
    phytosanitary: z.string().nullable(),
    taxonomy: z.string().nullable(),
    loadedAt: z.string().nullable(),
  }),
  water: z.object({
    syncedAt: z.string().nullable(),
    items: z.number(),
    lastError: z.string().nullable(),
  }),
  articles: z.object({
    phyto: z.number(),
    linked: z.number(),
    withoutAmm: z.number(),
    unknownAmm: z.number(),
  }),
});

/** IFT de la campagne : `GET /phyto/ift`. */
export const phytoIftResponse = z.object({
  campaign: z.number(),
  total: z.number(),
  segments: z.record(z.string(), z.number()),
  pendingInterventions: z.number(),
  parcels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      areaM2: z.number(),
      ift: z.number(),
      segments: z.record(z.string(), z.number()),
    }),
  ),
});

/** Points d'eau pour les ZNT : `GET /phyto/water`. */
export const phytoWaterResponse = z.object({
  type: z.literal("FeatureCollection"),
  features: z.array(
    z.object({
      type: z.literal("Feature"),
      geometry: geoJsonGeometry,
      properties: z.object({
        id: z.string(),
        name: z.string().nullable(),
        kind: z.string(),
        permanent: z.boolean().nullable(),
        ditch: z.boolean(),
      }),
    }),
  ),
});

/** Délais avant récolte et rentrée d'une parcelle : `GET /phyto/parcels/:id/delays`. */
export const phytoParcelsDelaysResponse = z.object({
  reentry: z
    .object({
      until: z.string(),
      product: z.string(),
      interventionId: z.string(),
    })
    .nullable(),
  harvest: z
    .object({
      from: z.string(),
      product: z.string(),
      interventionId: z.string(),
    })
    .nullable(),
});

/** Cultures du référentiel phyto : `GET /reference/phyto-crops`. */
export const referencePhytoCropsResponse = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      oepp: z.string().nullable(),
      bbchRef: z.string().nullable(),
    }),
  ),
});

/** Registre phytosanitaire : `GET /registers/phyto`. */
export const registersPhytoResponse = z.union([
  z.string(),
  z.object({
    campaign: z.number(),
    items: z.array(
      z.object({
        interventionId: z.string(),
        doneOn: z.string(),
        parcelName: z.string(),
        areaM2: z.number(),
        productName: z.string(),
        quantity: z.number(),
        unit: z.string(),
        applicators: z.array(z.string()),
        crop: z.string().optional(),
        amm: z.string().optional(),
      }),
    ),
  }),
]);

/** Conditions de pulvérisation : `GET /weather/spraying`. */
export const weatherSprayingResponse = z
  .object({
    source: z.enum([
      "manual",
      "open_meteo",
      "openweather",
      "meteoblue",
      "weenat",
      "sencrop",
    ]),
    kind: z.enum(["observed", "forecast"]),
    latitude: z.number(),
    longitude: z.number(),
    slots: z.array(
      z.object({
        at: z.string(),
        stepHours: z.number(),
        level: z.enum(["go", "caution", "stop"]),
        reasons: z.array(z.string()),
        temperatureC: z.number().nullable(),
        humidityPct: z.number().nullable(),
        windKmh: z.number().nullable(),
        precipitationMm: z.number().nullable(),
        icon: z.string().nullable().optional(),
      }),
    ),
  })
  .nullable();
