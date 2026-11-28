import { z } from "zod";

/**
 * Réponses des routes ouvertes, module Matériels (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Matériels : `GET /equipments`. */
export const equipmentsResponse = z.object({
  items: z.array(
    z.object({
      due: z
        .object({
          overdue: z.number(),
          soon: z.number(),
          unknown: z.number(),
        })
        .nullable(),
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      state: z.string().nullable(),
      brand: z.string().nullable(),
      brandId: z.string().nullable(),
      model: z.string().nullable(),
      serialNumber: z.string().nullable(),
      year: z.number().nullable(),
      meterUnit: z.enum(["hours"]).nullable(),
      logoAssetId: z.string().nullable(),
      logoSource: z.enum(["equipment", "brand"]).nullable(),
      lastReading: z
        .object({
          readAt: z.string(),
          value: z.number(),
          origin: z.enum(["manual", "reference", "intervention", "traccar"]),
        })
        .nullable(),
      tracked: z.boolean(),
      type: z
        .enum([
          "sower",
          "tractor",
          "fixed_equipment",
          "connected_object",
          "self_propelled",
          "rotary_harrow",
          "plough",
          "disc_harrow",
          "cultivator",
          "roller",
          "shredder",
          "mounted_sprayer",
          "trailed_sprayer",
          "fertilizer_spreader",
          "trailer",
          "other_tool",
        ])
        .nullable()
        .optional(),
    }),
  ),
});

/** Fiche d'un matériel : `GET /equipments/:id/sheet`. */
export const equipmentsSheetResponse = z.object({
  id: z.string(),
  name: z.string(),
  kind: z.string(),
  state: z.string().nullable(),
  brand: z.string().nullable(),
  brandId: z.string().nullable(),
  model: z.string().nullable(),
  serialNumber: z.string().nullable(),
  year: z.number().nullable(),
  meterUnit: z.enum(["hours"]).nullable(),
  logoAssetId: z.string().nullable(),
  logoSource: z.enum(["equipment", "brand"]).nullable(),
  lastReading: z
    .object({
      readAt: z.string(),
      value: z.number(),
      origin: z.enum(["manual", "reference", "intervention", "traccar"]),
    })
    .nullable(),
  tracked: z.boolean(),
  manufacturerType: z.string().nullable(),
  commissionedAt: z.string().nullable(),
  aggregates: z.array(
    z.object({
      organ: z.string(),
      designation: z.string().optional(),
      serial: z.string().optional(),
    }),
  ),
  technical: z.unknown(),
  externalIds: z.record(z.string(), z.string()),
  notes: z.string().nullable(),
  brandInfo: z
    .object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      logoAssetId: z.string().nullable(),
      equipments: z.number(),
    })
    .nullable(),
  options: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      label: z.string(),
      from: z.string(),
      to: z.string().nullable(),
    }),
  ),
  readings: z.array(
    z.object({
      id: z.string(),
      equipmentId: z.string(),
      readAt: z.string(),
      value: z.number(),
      usage: z.number(),
      status: z.enum(["valid", "superseded"]),
      origin: z.enum(["manual", "reference", "intervention", "traccar"]),
      correction: z.enum(["fix", "replacement"]).nullable(),
      correctionReason: z.string().nullable(),
      interventionId: z.string().nullable(),
      authorName: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      interventionId: z.string(),
      procedure: z.string(),
      status: z.string(),
      startedAt: z.string().nullable(),
      role: z.enum(["target", "tool"]),
      parcels: z.array(z.string()),
    }),
  ),
  trackers: z.array(
    z.object({
      deviceId: z.string(),
      from: z.string(),
      to: z.string().nullable(),
    }),
  ),
  type: z
    .enum([
      "sower",
      "tractor",
      "fixed_equipment",
      "connected_object",
      "self_propelled",
      "rotary_harrow",
      "plough",
      "disc_harrow",
      "cultivator",
      "roller",
      "shredder",
      "mounted_sprayer",
      "trailed_sprayer",
      "fertilizer_spreader",
      "trailer",
      "other_tool",
    ])
    .nullable()
    .optional(),
  due: z
    .object({
      overdue: z.number(),
      soon: z.number(),
      unknown: z.number(),
    })
    .nullable()
    .optional(),
  estimate: z
    .object({
      usage: z.number(),
      estimatedHours: z.number(),
      since: z.string(),
    })
    .nullable()
    .optional(),
  usageDays: z
    .array(
      z.object({
        day: z.string(),
        hours: z.number(),
      }),
    )
    .optional(),
});

/** Entretien d'un matériel : `GET /equipments/:id/maintenance`. */
export const equipmentsMaintenanceResponse = z.object({
  equipmentId: z.string(),
  at: z.string(),
  settings: z.object({
    soonHours: z.number(),
    soonMonths: z.number(),
    notify: z.array(z.string()),
  }),
  usageNow: z.number().nullable(),
  usageEstimated: z.boolean(),
  model: z
    .object({
      id: z.string(),
      label: z.string(),
      warning: z.string().nullable(),
      sources: z.array(z.unknown()),
    })
    .nullable(),
  operations: z.array(
    z.object({
      id: z.string(),
      code: z.string().nullable(),
      label: z.string(),
      kind: z.enum([
        "replacement",
        "adjustment",
        "inspection",
        "cleaning",
        "greasing",
        "oil_change",
        "bleeding",
        "visit",
      ]),
      everyHours: z.number().nullable(),
      everyMonths: z.number().nullable(),
      firstHours: z.number().nullable(),
      performer: z.enum(["workshop", "member"]),
      requiresOption: z.string().nullable(),
      condition: z.string().nullable(),
      source: z
        .object({
          id: z.string(),
          page: z.unknown(),
        })
        .nullable(),
      baselineAt: z.string().nullable(),
      baselineHours: z.number().nullable(),
      archivedAt: z.string().nullable(),
      archivedReason: z.string().nullable(),
      fromModel: z.boolean(),
      parts: z.array(
        z.object({
          articleId: z.string(),
          name: z.string(),
          reference: z.string().nullable(),
          quantity: z.number(),
          unit: z.string(),
        }),
      ),
      due: z.object({
        operationId: z.string(),
        status: z.enum([
          "done",
          "unknown",
          "ok",
          "overdue",
          "soon",
          "on_demand",
          "not_applicable",
        ]),
        last: z
          .object({
            at: z.string(),
            usage: z.number().nullable(),
            source: z.enum(["intervention", "baseline", "commissioning"]),
          })
          .nullable(),
        nextUsage: z.number().nullable(),
        nextDate: z.string().nullable(),
        remainingHours: z.number().nullable(),
        remainingDays: z.number().nullable(),
        usageNow: z.number().nullable(),
        reason: z.string().nullable(),
      }),
    }),
  ),
  fluids: z.array(
    z.object({
      id: z.string(),
      organ: z.string(),
      fluid: z.string(),
      standard: z.string().nullable(),
      viscosity: z.string().nullable(),
      capacity: z.string().nullable(),
      capacityMaxL: z.number().nullable(),
      note: z.string().nullable(),
      source: z
        .object({
          id: z.string(),
          page: z.unknown(),
        })
        .nullable(),
    }),
  ),
  parts: z.array(
    z.object({
      id: z.string(),
      articleId: z.string(),
      name: z.string(),
      reference: z.string().nullable(),
      family: z.string().nullable(),
      quantity: z.number().nullable(),
      catalog: z.record(z.string(), z.string().nullable()).nullable(),
      note: z.string().nullable(),
      operations: z.array(z.string()),
    }),
  ),
});

/** Relevés de compteur : `GET /equipments/:id/readings`. */
export const equipmentsReadingsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      equipmentId: z.string(),
      readAt: z.string(),
      value: z.number(),
      usage: z.number(),
      status: z.enum(["valid", "superseded"]),
      origin: z.enum(["manual", "reference", "intervention", "traccar"]),
      correction: z.enum(["fix", "replacement"]).nullable(),
      correctionReason: z.string().nullable(),
      interventionId: z.string().nullable(),
      authorName: z.string().nullable(),
      note: z.string().nullable(),
    }),
  ),
});

/** Entretiens à faire : `GET /maintenance/due`. */
export const maintenanceDueResponse = z.object({
  items: z.array(
    z.object({
      equipmentId: z.string(),
      equipmentName: z.string(),
      equipmentKind: z.string(),
      operationId: z.string(),
      label: z.string(),
      kind: z.enum([
        "replacement",
        "adjustment",
        "inspection",
        "cleaning",
        "greasing",
        "oil_change",
        "bleeding",
        "visit",
      ]),
      performer: z.enum(["workshop", "member"]),
      due: z.object({
        operationId: z.string(),
        status: z.enum([
          "done",
          "unknown",
          "ok",
          "overdue",
          "soon",
          "on_demand",
          "not_applicable",
        ]),
        last: z
          .object({
            at: z.string(),
            usage: z.number().nullable(),
            source: z.enum(["intervention", "baseline", "commissioning"]),
          })
          .nullable(),
        nextUsage: z.number().nullable(),
        nextDate: z.string().nullable(),
        remainingHours: z.number().nullable(),
        remainingDays: z.number().nullable(),
        usageNow: z.number().nullable(),
        reason: z.string().nullable(),
      }),
    }),
  ),
  byEquipment: z.record(
    z.string(),
    z.object({
      overdue: z.number(),
      soon: z.number(),
      unknown: z.number(),
    }),
  ),
});

/** Pièces d'entretien : `GET /maintenance/parts`. */
export const maintenancePartsResponse = z.object({
  at: z.string(),
  horizon: z.object({
    hours: z.number().nullable(),
    months: z.number().nullable(),
  }),
  items: z.array(
    z.object({
      articleId: z.string(),
      name: z.string(),
      reference: z.string().nullable(),
      family: z.string().nullable(),
      unit: z.string(),
      needed: z.number(),
      inStock: z.number(),
      toOrder: z.number(),
      operations: z.array(z.string()),
      equipments: z.array(z.string()),
    }),
  ),
});

/** Modèles de matériel : `GET /equipment-models`. */
export const equipmentModelsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      brand: z.string(),
      model: z.string(),
      manufacturerType: z.string().nullable(),
      operations: z.number(),
      own: z.boolean(),
    }),
  ),
});

/** Marques : `GET /brands`. */
export const brandsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      color: z.string().nullable(),
      logoAssetId: z.string().nullable(),
      equipments: z.number(),
    }),
  ),
});
