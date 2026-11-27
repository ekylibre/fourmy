import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Activités et assolement (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Activités : `GET /activities`. */
export const activitiesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      family: z.enum([
        "plant_farming",
        "vine_farming",
        "animal_farming",
        "plant_nursery",
        "processing",
        "wine_making",
        "administering",
        "tool_maintaining",
        "service_delivering",
      ]),
      reference: z.string().nullable(),
      referenceLabel: z.string().nullable(),
      cultivation: z.string().nullable(),
      cultivationLabel: z.string().nullable(),
      color: z.string().nullable(),
      suspended: z.boolean(),
      crop: z
        .object({
          code: z.string(),
          label: z.string(),
          oepp: z.string().nullable(),
          proposed: z.boolean(),
        })
        .nullable(),
      pictureUrl: z.string().nullable(),
      parcelIds: z.array(z.string()),
      areaM2: z.number(),
    }),
  ),
});

/** Références Lexicon des activités : `GET /activities/references`. */
export const activitiesReferencesResponse = z.object({
  items: z.array(
    z.object({
      referenceName: z.string(),
      label: z.string(),
      // Famille Lexicon telle quelle : elle peut sortir de la liste des activités (energy_production…).
      family: z.string(),
      specie: z.string().nullable(),
      specieLabel: z.string().nullable(),
      color: z.string().nullable(),
      pictureUrl: z.string().nullable(),
    }),
  ),
});

/** Itinéraire d'une activité : `GET /activities/:id/itinerary`. */
export const activitiesItineraryResponse = z.object({
  parcels: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      areaM2: z.number(),
      interventions: z.number(),
    }),
  ),
  title: z.string(),
  steps: z.array(
    z.object({
      kind: z.enum(["crop", "cover"]),
      campaign: z.number(),
      name: z.string(),
      color: z.string().nullable(),
      from: z.string(),
      to: z.string(),
      datesFrom: z.enum(["interventions", "campaign", "cover"]),
      attributes: z.array(
        z.object({
          label: z.string(),
          value: z.string(),
        }),
      ),
      marks: z.array(
        z.object({
          interventionIds: z.array(z.string()),
          procedure: z.string(),
          label: z.string(),
          lane: z.enum(["inputs", "works"]),
          status: z.enum(["done", "planned"]),
          at: z.string(),
          from: z.string(),
          to: z.string(),
          day: z.number(),
          details: z.array(
            z.object({
              label: z.string(),
              value: z.string(),
            }),
          ),
          parcels: z.array(
            z.object({
              id: z.string(),
              name: z.string(),
            }),
          ),
          members: z
            .array(
              z.object({
                interventionId: z.string(),
                at: z.string(),
                label: z.string(),
                status: z.enum(["done", "planned"]),
                parcels: z.array(z.string()),
              }),
            )
            .optional(),
        }),
      ),
    }),
  ),
  campaigns: z.array(z.number()),
});

/** Assolements : `GET /crop-plans`. */
export const cropPlansResponse = z.array(
  z.object({
    year: z.number(),
    status: z.enum(["current", "validated", "draft"]),
    currentVersion: z.number().nullable(),
    updatedAt: z.string(),
  }),
);

/** Assolement d'une campagne : `GET /crop-plans/:year`. */
export const cropPlansOneResponse = z.object({
  year: z.number(),
  status: z.enum(["current", "validated", "draft"]),
  revision: z.number(),
  draft: z.object({
    schema: z.literal(1),
    year: z.number(),
    operations: z.array(
      z.union([
        z.object({
          kind: z.literal("split"),
          source: z.string(),
          pieces: z.array(
            z.object({
              key: z.string(),
              name: z.string(),
              shape: geoJsonGeometry,
              areaM2: z.number(),
            }),
          ),
          effectiveOn: z.string(),
        }),
        z.object({
          kind: z.literal("merge"),
          sources: z.array(z.string()),
          result: z.object({
            key: z.string(),
            name: z.string(),
            shape: geoJsonGeometry,
            areaM2: z.number(),
          }),
          effectiveOn: z.string(),
        }),
      ]),
    ),
    assignments: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        role: z.enum(["main", "secondary"]),
        activityId: z.string(),
        startedOn: z.string().nullable(),
        stoppedOn: z.string().nullable(),
        productionId: z.string().optional(),
        itineraryId: z.string().optional(),
        forecasts: z
          .array(
            z.object({
              product: z.string(),
              unit: z.string(),
              yield: z.number().optional(),
              price: z.number().optional(),
              priceUnit: z.string().optional(),
              currency: z.enum(["EUR"]).optional(),
            }),
          )
          .optional(),
      }),
    ),
    covers: z.array(
      z.object({
        id: z.string(),
        key: z.string(),
        kind: z.enum(["sown", "regrowth_cereal", "regrowth_rapeseed"]),
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
        species: z.string(),
        sownOn: z.string(),
        destroyedOn: z.string().nullable(),
        coverId: z.string().optional(),
      }),
    ),
    fallow: z.array(
      z.object({
        key: z.string(),
        capCode: z.string().optional(),
      }),
    ),
    excluded: z.array(z.string()),
  }),
  currentVersion: z.number().nullable(),
  versions: z.array(
    z.object({
      version: z.number(),
      validatedAt: z.string(),
      validatedBy: z.string().nullable(),
      reason: z.string().nullable(),
    }),
  ),
  updatedAt: z.string(),
});

/** Itinéraires techniques : `GET /technical-itineraries`. */
export const technicalItinerariesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      activityId: z.string().nullable(),
      activityName: z.string().nullable(),
      production: z.string().nullable(),
      system: z.enum(["organic", "conventional"]),
      cycle: z.enum(["annual", "perennial"]),
      origin: z.enum(["manual", "history", "copy"]),
      active: z.boolean(),
      revision: z.number(),
      steps: z.number(),
      procedures: z.array(z.string()),
      missing: z.number(),
      updatedAt: z.string(),
    }),
  ),
});

/** Itinéraires réalisés : `GET /technical-itineraries/history`. */
export const technicalItinerariesHistoryResponse = z.object({
  items: z.array(
    z.object({
      year: z.number(),
      productions: z.number(),
      interventions: z.number(),
    }),
  ),
});

/** Itinéraire technique : `GET /technical-itineraries/:id`. */
export const technicalItinerariesOneResponse = z.object({
  source: z.record(z.string(), z.unknown()).nullable(),
  notes: z.string().nullable(),
  content: z.object({
    schema: z.literal(1),
    steps: z.array(
      z.object({
        id: z.string(),
        procedure: z.string(),
        anchor: z.union([
          z.object({
            kind: z.literal("sowing"),
            offsetDays: z.number(),
          }),
          z.object({
            kind: z.literal("harvest"),
            offsetDays: z.number(),
          }),
          z.object({
            kind: z.literal("date"),
            monthDay: z.string(),
            yearOffset: z.union([z.literal(0), z.literal(-1)]),
          }),
        ]),
        share: z.number(),
        optional: z.boolean(),
        inputs: z.array(
          z.object({
            kind: z.enum([
              "other",
              "phyto",
              "fluid",
              "harvest",
              "fertilizer",
              "seed",
              "wine",
              "part",
            ]),
            label: z.string(),
            dose: z.number(),
            unit: z.enum([
              "kilogram_per_hectare",
              "liter_per_hectare",
              "quintal_per_hectare",
              "ton_per_hectare",
              "cubic_meter_per_hectare",
              "unity_per_hectare",
              "grain_per_square_meter",
              "grain_per_hectare",
              "thousand_per_hectare",
              "dose_per_hectare",
            ]),
            articleId: z.string().optional(),
          }),
        ),
        staffing: z.object({
          equipmentIds: z.array(z.string()),
          personIds: z.array(z.string()),
          crewTemplateId: z.string().optional(),
          people: z.number().optional(),
          machineryRateId: z.string().optional(),
        }),
        label: z.string().optional(),
        windowDays: z.number().optional(),
        repeat: z
          .object({
            count: z.number(),
            everyDays: z.number(),
          })
          .optional(),
        purposes: z
          .array(
            z.enum([
              "other",
              "herbicide",
              "fungicide",
              "insecticide",
              "acaricide",
              "molluscicide",
              "nematicide",
              "growth_regulator",
              "biostimulant",
              "desiccation",
            ]),
          )
          .optional(),
        workRateHaH: z.number().optional(),
        notes: z.string().optional(),
        evidence: z
          .object({
            parcels: z.number(),
            ofParcels: z.number(),
            campaigns: z.array(z.number()),
            from: z.string().optional(),
            to: z.string().optional(),
            note: z.string().optional(),
            observedRateHaH: z.number().optional(),
            observedSamples: z.number().optional(),
          })
          .optional(),
      }),
    ),
    startMonthDay: z.string().optional(),
  }),
  missing: z.array(
    z.object({
      stepId: z.string(),
      kind: z.enum(["equipment", "article", "person", "crew_template"]),
      id: z.string(),
      label: z.string().nullable(),
    }),
  ),
  example: z.object({
    sowingOn: z.string(),
    harvestOn: z.string(),
    year: z.number(),
  }),
  name: z.string(),
  origin: z.enum(["manual", "history", "copy"]),
  id: z.string(),
  activityId: z.string().nullable(),
  cycle: z.enum(["annual", "perennial"]),
  updatedAt: z.string(),
  revision: z.number(),
  active: z.boolean(),
  activityName: z.string().nullable(),
  production: z.string().nullable(),
  system: z.enum(["organic", "conventional"]),
});
