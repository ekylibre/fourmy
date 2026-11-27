import { z } from "zod";

/**
 * Réponses des routes ouvertes, module Économique (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Prix : `GET /prices`. */
export const pricesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["equipment", "article", "labour", "service", "product"]),
      articleId: z.string().nullable(),
      equipmentId: z.string().nullable(),
      activityId: z.string().nullable(),
      product: z.string().nullable(),
      procedure: z.string().nullable(),
      unit: z.string(),
      amount: z.number(),
      validFrom: z.string(),
      source: z.enum(["farm", "lexicon", "bcma", "agrifood", "purchase"]),
      sourceRef: z.string().nullable(),
      sourceDate: z.string().nullable(),
      note: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

/** Barème des matériels : `GET /machinery-rates`. */
export const machineryRatesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      family: z.string(),
      widthM: z.number().nullable(),
      haH: z.number().nullable(),
      unit: z.string().optional(),
      costPerUnit: z.number().optional(),
      costPerHour: z.number().optional(),
    }),
  ),
});

/** Coûts des matériels : `GET /equipments-rates`. */
export const equipmentsRatesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      widthM: z.number().nullable(),
      machineryRateId: z.string().nullable(),
      suggestedRateId: z.string().nullable(),
      carrier: z.boolean(),
      rate: z
        .object({
          id: z.string(),
          label: z.string(),
          family: z.string(),
          widthM: z.number().nullable(),
          haH: z.number().nullable(),
          unit: z.string().optional(),
          costPerUnit: z.number().optional(),
          costPerHour: z.number().optional(),
        })
        .nullable(),
      suggested: z
        .object({
          id: z.string(),
          label: z.string(),
          family: z.string(),
          widthM: z.number().nullable(),
          haH: z.number().nullable(),
          unit: z.string().optional(),
          costPerUnit: z.number().optional(),
          costPerHour: z.number().optional(),
        })
        .nullable(),
    }),
  ),
});
