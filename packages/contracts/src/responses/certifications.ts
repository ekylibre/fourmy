import { z } from "zod";

/**
 * Réponses des routes ouvertes, module Certifications (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Certifications : `GET /certifications`. */
export const certificationsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      landParcelId: z.string(),
      kind: z.enum([
        "other",
        "organic",
        "hve",
        "aop",
        "igp",
        "label_rouge",
        "stg",
        "globalgap",
        "rainforest",
      ]),
      level: z.string().nullable(),
      label: z.string().nullable(),
      certifier: z.string().nullable(),
      reference: z.string().nullable(),
      startedOn: z.string(),
      stoppedOn: z.string().nullable(),
    }),
  ),
});

/** Certifications d'une parcelle : `GET /land-parcels/:id/certifications`. */
export const landParcelsCertificationsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      landParcelId: z.string(),
      kind: z.enum([
        "other",
        "organic",
        "hve",
        "aop",
        "igp",
        "label_rouge",
        "stg",
        "globalgap",
        "rainforest",
      ]),
      level: z.string().nullable(),
      label: z.string().nullable(),
      certifier: z.string().nullable(),
      reference: z.string().nullable(),
      startedOn: z.string(),
      stoppedOn: z.string().nullable(),
    }),
  ),
});

/** Dérogations semences : `GET /seed-derogations`. */
export const seedDerogationsResponse = z.object({
  items: z.array(
    z.object({
      species: z.string(),
      variety: z.string().nullable(),
      articleId: z.string().nullable(),
      grantedOn: z.string(),
      season: z.number(),
      quantity: z.number().nullable(),
      unit: z.string().nullable(),
      reference: z.string().nullable(),
      certifier: z.string().nullable(),
      id: z.string(),
    }),
  ),
});

/** Contrôles disponibles : `GET /control/availability`. */
export const controlAvailabilityResponse = z.object({
  hve: z.boolean(),
  ab: z.boolean(),
});

/** Contrôle HVE ou AB : `GET /control/:kind`. */
export const controlOneResponse = z.object({
  kind: z.enum(["hve", "ab"]),
  campaign: z.number(),
  period: z.object({
    from: z.string(),
    to: z.string(),
  }),
  verdict: z.enum(["ok", "warning", "danger", "missing", "na"]),
  sections: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      level: z.enum(["ok", "warning", "danger", "missing", "na"]),
      findings: z.array(
        z.object({
          ruleId: z.string(),
          level: z.enum(["ok", "warning", "danger", "missing", "na"]),
          message: z.string(),
          refs: z.object({
            parcelIds: z.array(z.string()).optional(),
            interventionIds: z.array(z.string()).optional(),
            articleIds: z.array(z.string()).optional(),
          }),
          source: z.string(),
          value: z.number().optional(),
          threshold: z.number().optional(),
          unit: z.string().optional(),
          points: z
            .object({
              got: z.number(),
              max: z.number(),
            })
            .optional(),
          breach: z
            .object({
              inao: z.string(),
              label: z.string(),
              class: z.enum(["minor", "major", "critical"]),
              measure: z.string(),
              unconfirmed: z.boolean().optional(),
            })
            .optional(),
          missing: z
            .array(
              z.object({
                what: z.string(),
                where: z.enum([
                  "farm",
                  "settings",
                  "questionnaire",
                  "production",
                  "article",
                  "intervention",
                  "parcel",
                ]),
                id: z.string().optional(),
              }),
            )
            .optional(),
          gridDivergence: z.string().optional(),
        }),
      ),
      points: z
        .object({
          got: z.number(),
          max: z.number(),
          min: z.number(),
        })
        .optional(),
    }),
  ),
  refsVersion: z.string(),
  computedAt: z.string(),
  exportedAt: z.string().nullable(),
  changedSinceExport: z.boolean(),
});

/** Contrôle AB : parcelles : `GET /control/ab/parcels`. */
export const controlAbParcelsResponse = z.object({
  campaign: z.number(),
  period: z.object({
    from: z.string(),
    to: z.string(),
  }),
  items: z.array(
    z.object({
      parcelId: z.string(),
      name: z.string(),
      areaM2: z.number(),
      declaredLevel: z.string().nullable(),
      startedOn: z.string(),
      conversionStart: z.string(),
      resetBy: z
        .object({
          interventionId: z.string(),
          day: z.string(),
          product: z.string(),
        })
        .nullable(),
      status: z.enum(["C1", "C2", "AB"]),
      productions: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          cycle: z.enum(["annual", "semi_perennial", "perennial"]),
          sownOn: z.string().nullable(),
          harvestOn: z.string(),
          status: z.enum(["C1", "C2", "AB"]),
        }),
      ),
    }),
  ),
});

/** Contrôle AB : semences : `GET /control/ab/seeds`. */
export const controlAbSeedsResponse = z.object({
  campaign: z.number(),
  items: z.array(
    z.object({
      articleId: z.string(),
      name: z.string(),
      organicStatus: z
        .enum(["organic", "conventional", "conversion"])
        .nullable(),
      seedTreated: z.boolean().nullable(),
      firstSownOn: z.string(),
      parcels: z.array(z.string()),
    }),
  ),
});

/** Contrôle HVE : infrastructures agroécologiques : `GET /control/hve/iae`. */
export const controlHveIaeResponse = z.object({
  campaign: z.number(),
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      capType: z.string().nullable(),
      type: z.string().nullable(),
      proposed: z.boolean(),
      validated: z.boolean(),
      shared: z.boolean(),
      quantity: z.number(),
      unit: z.enum(["m", "m2", "tree"]).nullable(),
      equivalentM2: z.number().nullable(),
      onArable: z.boolean(),
    }),
  ),
});

/** Contrôle HVE : irrigation : `GET /control/hve/irrigated`. */
export const controlHveIrrigatedResponse = z.object({
  campaign: z.number(),
  period: z.object({
    from: z.string(),
    to: z.string(),
  }),
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      productionId: z.string().nullable(),
      crop: z.string().nullable(),
      droughtTolerant: z.boolean().nullable(),
      sownOn: z.string().nullable(),
      waterSaving: z.string().nullable(),
      harvested: z.boolean(),
    }),
  ),
  irrigations: z.number(),
});

/** Contrôle HVE : questionnaire : `GET /control/hve/questionnaire`. */
export const controlHveQuestionnaireResponse = z.object({
  id: z.string().nullable(),
  campaign: z.number(),
  answers: z.object({
    biodiversity: z.object({
      animalSpecies: z.number().nullable().optional(),
      hives: z.boolean().nullable().optional(),
      threatenedVarieties: z.number().nullable().optional(),
      threatenedBreeds: z.number().nullable().optional(),
      soilBiology: z
        .enum(["none", "spade_test", "microbial_analysis"])
        .nullable()
        .optional(),
    }),
    phyto: z.object({
      diagnosticTool: z.boolean().nullable().optional(),
      collectiveProspection: z.boolean().nullable().optional(),
      bsvObserverPercent: z.number().nullable().optional(),
      alternativeMethodsPercent: z.number().nullable().optional(),
      leakEquipment: z.number().nullable().optional(),
      interRowCoverPercent: z.number().nullable().optional(),
    }),
    fertilization: z.object({
      livestockNitrogenKg: z.number().nullable().optional(),
      opiWheatPercent: z.number().nullable().optional(),
      minorOadPercent: z.number().nullable().optional(),
      minorPpf: z.boolean().nullable().optional(),
      coverRegulatory: z.boolean().nullable().optional(),
      coverWeeks: z.number().nullable().optional(),
      coverPercent: z.number().nullable().optional(),
      vulnerableZone: z.boolean().nullable().optional(),
    }),
    irrigation: z.object({
      supplyTool: z.boolean().nullable().optional(),
      demandTool: z.boolean().nullable().optional(),
      mixedTool: z.boolean().nullable().optional(),
      efficientEquipmentPercent: z.number().nullable().optional(),
      collective: z.boolean().nullable().optional(),
      waterSavingPercent: z.number().nullable().optional(),
    }),
  }),
  updatedAt: z.string().nullable(),
});
