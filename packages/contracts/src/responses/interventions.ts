import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Interventions (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Interventions réalisées et prévues : `GET /interventions`. */
export const interventionsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      farmId: z.string(),
      procedure: z.string(),
      status: z.enum(["done", "cancelled", "planned"]),
      startedAt: z.string().nullable(),
      stoppedAt: z.string().nullable(),
      periods: z.array(
        z.object({
          startedAt: z.string(),
          stoppedAt: z.string(),
        }),
      ),
      targets: z.array(
        z.object({
          kind: z.enum(["land_parcel", "equipment", "place", "container"]),
          id: z.string(),
          meter: z
            .object({
              value: z.number(),
              correction: z.enum(["fix", "replacement"]).nullable().optional(),
              correctionReason: z.string().nullable().optional(),
            })
            .optional(),
          workedAreaM2: z.number().optional(),
          workingZone: geoJsonGeometry.optional(),
        }),
      ),
      inputs: z.array(
        z.object({
          articleId: z.string(),
          quantity: z.number(),
          per: z.enum(["total", "hectare"]),
          unit: z.string(),
          lotId: z.string().optional(),
          from: z
            .object({
              placeId: z.string().optional(),
              containerId: z.string().optional(),
            })
            .optional(),
          equipmentId: z.string().optional(),
          mixture: z
            .array(
              z.object({
                componentId: z.string().nullable(),
                label: z.string(),
                species: z.string().nullable(),
                kgHa: z.number(),
              }),
            )
            .optional(),
        }),
      ),
      outputs: z.array(
        z.object({
          articleId: z.string(),
          quantity: z.number(),
          per: z.enum(["total", "hectare"]),
          unit: z.string(),
          lotId: z.string().optional(),
          to: z
            .object({
              placeId: z.string().optional(),
              containerId: z.string().optional(),
            })
            .optional(),
        }),
      ),
      tools: z.array(
        z.object({
          equipmentId: z.string(),
          meter: z
            .object({
              value: z.number(),
              correction: z.enum(["fix", "replacement"]).nullable().optional(),
              correctionReason: z.string().nullable().optional(),
            })
            .optional(),
        }),
      ),
      doers: z.array(
        z.object({
          personId: z.string(),
        }),
      ),
      staffing: z.enum(["crews", "free"]),
      crews: z.array(
        z.object({
          id: z.string(),
          rank: z.number(),
          label: z.string().nullable(),
          templateId: z.string().nullable(),
          tools: z.array(
            z.object({
              equipmentId: z.string(),
              meter: z
                .object({
                  value: z.number(),
                  correction: z
                    .enum(["fix", "replacement"])
                    .nullable()
                    .optional(),
                  correctionReason: z.string().nullable().optional(),
                })
                .optional(),
            }),
          ),
          doers: z.array(
            z.object({
              personId: z.string(),
            }),
          ),
          periods: z.array(
            z.object({
              startedAt: z.string(),
              stoppedAt: z.string(),
            }),
          ),
        }),
      ),
      purposes: z.array(
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
      ),
      notes: z.string().nullable(),
      origin: z.enum(["import", "mobile", "web", "migration", "plugin"]),
      clientId: z.string().nullable(),
      createdAt: z.string(),
      updatedAt: z.string(),
      spanS: z.number().nullable().optional(),
      workDurationS: z.number().nullable().optional(),
      bbch: z
        .object({
          code: z.string(),
          label: z.string(),
        })
        .nullable()
        .optional(),
      shared: z.boolean().optional(),
      compliance: z
        .object({
          level: z.enum(["ok", "warning", "danger", "info"]),
          checkedAt: z.string(),
          referential: z.string().nullable(),
          checks: z.array(
            z.object({
              articleId: z.string(),
              articleName: z.string(),
              level: z.enum(["ok", "warning", "danger", "info"]),
              indicators: z.array(
                z.object({
                  code: z.enum([
                    "organic",
                    "dose",
                    "applications",
                    "reentry",
                    "authorization",
                    "znt",
                    "dar",
                    "applicator",
                  ]),
                  level: z.enum(["ok", "warning", "danger", "info"]),
                  message: z.string(),
                }),
              ),
              usages: z.array(
                z.object({
                  id: z.string(),
                  label: z.string(),
                  doseLabel: z.string().nullable(),
                }),
              ),
              usageId: z.string().nullable(),
              harvestAllowedFrom: z.string().nullable(),
              reentryAllowedFrom: z.string().nullable(),
              zntM: z.number().nullable().optional(),
              usageConditions: z.string().nullable().optional(),
            }),
          ),
          reason: z.string().nullable(),
          mixture: z
            .object({
              level: z.enum(["ok", "danger"]),
              issues: z.array(
                z.object({
                  articleIds: z.array(z.string()),
                  message: z.string(),
                }),
              ),
            })
            .nullable()
            .optional(),
        })
        .nullable()
        .optional(),
      nitrateCheck: z
        .object({
          level: z.enum(["ok", "warning", "danger", "info"]),
          nitrogen: z
            .object({
              totalKgHa: z.number(),
              efficientKgHa: z.number().nullable(),
            })
            .nullable(),
          indicators: z.array(
            z.object({
              code: z.enum([
                "fert_calendar",
                "fert_plan",
                "fert_first_split",
                "fert_composition",
                "fert_frost",
                "fert_wet",
                "fert_water",
                "fert_slope",
                "fert_aplsh",
                "fert_efficiency",
                "fert_cover",
              ]),
              level: z.enum(["ok", "warning", "danger", "info"]),
              message: z.string(),
              parcelName: z.string().optional(),
            }),
          ),
          reason: z.string().nullable(),
          checkedAt: z.string(),
        })
        .nullable()
        .optional(),
      certificationCheck: z
        .object({
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
          checkedAt: z.string(),
          reason: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      justification: z.string().nullable().optional(),
      ift: z
        .object({
          status: z.enum(["pending", "unavailable", "ok"]),
          total: z.number().nullable(),
          lines: z.array(
            z.object({
              articleId: z.string(),
              parcelId: z.string(),
              ift: z.number().nullable(),
              segment: z.string().nullable(),
              doseReference: z.number().nullable(),
              warning: z.string().nullable(),
              segmentCode: z.string().nullable().optional(),
              certifiedId: z.string().nullable().optional(),
              signature: z.string().nullable().optional(),
            }),
          ),
          computedAt: z.string().nullable(),
          error: z.string().nullable(),
          retryAt: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
      weather: z
        .object({
          source: z.enum([
            "manual",
            "open_meteo",
            "openweather",
            "meteoblue",
            "weenat",
            "sencrop",
          ]),
          kind: z.enum(["manual", "observed", "forecast"]),
          temperatureC: z.number().nullable(),
          humidityPct: z.number().nullable(),
          windKmh: z.number().nullable(),
          precipitationMm: z.number().nullable(),
          windMaxKmh: z.number().nullable().optional(),
          fetchedAt: z.string().nullable().optional(),
          station: z
            .object({
              name: z.string(),
              distanceM: z.number(),
            })
            .nullable()
            .optional(),
          icon: z.string().nullable().optional(),
          hours: z
            .array(
              z.object({
                at: z.string(),
                icon: z.string().nullable(),
                temperatureC: z.number().nullable(),
                precipitationMm: z.number().nullable(),
                windKmh: z.number().nullable(),
              }),
            )
            .optional(),
        })
        .nullable()
        .optional(),
      maintenance: z
        .object({
          nature: z.enum(["preventive", "corrective"]),
          problem: z.string().nullable(),
          workshop: z
            .object({
              name: z.string(),
              reference: z.string().nullable().optional(),
            })
            .nullable(),
          operations: z.array(
            z.object({
              equipmentId: z.string(),
              operationId: z.string(),
              label: z.string(),
              kind: z.string(),
              result: z.enum(["done", "ok", "anomaly"]),
              note: z.string().nullable(),
            }),
          ),
        })
        .nullable()
        .optional(),
      irrigation: z
        .object({
          depthMm: z.number(),
          method: z
            .enum(["other", "reel", "pivot", "sprinkler", "drip"])
            .nullable(),
          origin: z
            .enum(["surface", "groundwater", "network", "reservoir"])
            .nullable()
            .optional(),
          trigger: z
            .enum([
              "weather",
              "probe",
              "model",
              "advice",
              "observation",
              "schedule",
            ])
            .nullable()
            .optional(),
          mobile: z.boolean().nullable().optional(),
        })
        .nullable()
        .optional(),
      sowing: z
        .object({
          technique: z.enum([
            "direct",
            "precision",
            "conventional",
            "planting",
            "broadcast",
          ]),
        })
        .nullable()
        .optional(),
      periodPrecision: z.enum(["day", "time"]).optional(),
      affectsStock: z.boolean().optional(),
    }),
  ),
  nextCursor: z.null(),
});

/** Détail d'une intervention : `GET /interventions/:id`. */
export const interventionsOneResponse = z.object({
  id: z.string(),
  farmId: z.string(),
  procedure: z.string(),
  status: z.enum(["done", "cancelled", "planned"]),
  startedAt: z.string().nullable(),
  stoppedAt: z.string().nullable(),
  periods: z.array(
    z.object({
      startedAt: z.string(),
      stoppedAt: z.string(),
    }),
  ),
  targets: z.array(
    z.object({
      kind: z.enum(["land_parcel", "equipment", "place", "container"]),
      id: z.string(),
      meter: z
        .object({
          value: z.number(),
          correction: z.enum(["fix", "replacement"]).nullable().optional(),
          correctionReason: z.string().nullable().optional(),
        })
        .optional(),
      workedAreaM2: z.number().optional(),
      workingZone: geoJsonGeometry.optional(),
    }),
  ),
  inputs: z.array(
    z.object({
      articleId: z.string(),
      quantity: z.number(),
      per: z.enum(["total", "hectare"]),
      unit: z.string(),
      lotId: z.string().optional(),
      from: z
        .object({
          placeId: z.string().optional(),
          containerId: z.string().optional(),
        })
        .optional(),
      equipmentId: z.string().optional(),
      mixture: z
        .array(
          z.object({
            componentId: z.string().nullable(),
            label: z.string(),
            species: z.string().nullable(),
            kgHa: z.number(),
          }),
        )
        .optional(),
    }),
  ),
  outputs: z.array(
    z.object({
      articleId: z.string(),
      quantity: z.number(),
      per: z.enum(["total", "hectare"]),
      unit: z.string(),
      lotId: z.string().optional(),
      to: z
        .object({
          placeId: z.string().optional(),
          containerId: z.string().optional(),
        })
        .optional(),
    }),
  ),
  tools: z.array(
    z.object({
      equipmentId: z.string(),
      meter: z
        .object({
          value: z.number(),
          correction: z.enum(["fix", "replacement"]).nullable().optional(),
          correctionReason: z.string().nullable().optional(),
        })
        .optional(),
    }),
  ),
  doers: z.array(
    z.object({
      personId: z.string(),
    }),
  ),
  staffing: z.enum(["crews", "free"]),
  crews: z.array(
    z.object({
      id: z.string(),
      rank: z.number(),
      label: z.string().nullable(),
      templateId: z.string().nullable(),
      tools: z.array(
        z.object({
          equipmentId: z.string(),
          meter: z
            .object({
              value: z.number(),
              correction: z.enum(["fix", "replacement"]).nullable().optional(),
              correctionReason: z.string().nullable().optional(),
            })
            .optional(),
        }),
      ),
      doers: z.array(
        z.object({
          personId: z.string(),
        }),
      ),
      periods: z.array(
        z.object({
          startedAt: z.string(),
          stoppedAt: z.string(),
        }),
      ),
    }),
  ),
  purposes: z.array(
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
  ),
  notes: z.string().nullable(),
  origin: z.enum(["import", "mobile", "web", "migration", "plugin"]),
  clientId: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
  history: z.array(
    z.object({
      id: z.string(),
      at: z.string(),
      action: z.string(),
      actor: z.string(),
      actorName: z.string().nullable(),
      origin: z.string(),
      reason: z.string().nullable(),
      changes: z
        .record(
          z.string(),
          z.object({
            before: z.unknown(),
            after: z.unknown(),
          }),
        )
        .nullable(),
    }),
  ),
  spanS: z.number().nullable().optional(),
  workDurationS: z.number().nullable().optional(),
  bbch: z
    .object({
      code: z.string(),
      label: z.string(),
    })
    .nullable()
    .optional(),
  shared: z.boolean().optional(),
  compliance: z
    .object({
      level: z.enum(["ok", "warning", "danger", "info"]),
      checkedAt: z.string(),
      referential: z.string().nullable(),
      checks: z.array(
        z.object({
          articleId: z.string(),
          articleName: z.string(),
          level: z.enum(["ok", "warning", "danger", "info"]),
          indicators: z.array(
            z.object({
              code: z.enum([
                "organic",
                "dose",
                "applications",
                "reentry",
                "authorization",
                "znt",
                "dar",
                "applicator",
              ]),
              level: z.enum(["ok", "warning", "danger", "info"]),
              message: z.string(),
            }),
          ),
          usages: z.array(
            z.object({
              id: z.string(),
              label: z.string(),
              doseLabel: z.string().nullable(),
            }),
          ),
          usageId: z.string().nullable(),
          harvestAllowedFrom: z.string().nullable(),
          reentryAllowedFrom: z.string().nullable(),
          zntM: z.number().nullable().optional(),
          usageConditions: z.string().nullable().optional(),
        }),
      ),
      reason: z.string().nullable(),
      mixture: z
        .object({
          level: z.enum(["ok", "danger"]),
          issues: z.array(
            z.object({
              articleIds: z.array(z.string()),
              message: z.string(),
            }),
          ),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
  nitrateCheck: z
    .object({
      level: z.enum(["ok", "warning", "danger", "info"]),
      nitrogen: z
        .object({
          totalKgHa: z.number(),
          efficientKgHa: z.number().nullable(),
        })
        .nullable(),
      indicators: z.array(
        z.object({
          code: z.enum([
            "fert_calendar",
            "fert_plan",
            "fert_first_split",
            "fert_composition",
            "fert_frost",
            "fert_wet",
            "fert_water",
            "fert_slope",
            "fert_aplsh",
            "fert_efficiency",
            "fert_cover",
          ]),
          level: z.enum(["ok", "warning", "danger", "info"]),
          message: z.string(),
          parcelName: z.string().optional(),
        }),
      ),
      reason: z.string().nullable(),
      checkedAt: z.string(),
    })
    .nullable()
    .optional(),
  certificationCheck: z
    .object({
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
      checkedAt: z.string(),
      reason: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  justification: z.string().nullable().optional(),
  ift: z
    .object({
      status: z.enum(["pending", "unavailable", "ok"]),
      total: z.number().nullable(),
      lines: z.array(
        z.object({
          articleId: z.string(),
          parcelId: z.string(),
          ift: z.number().nullable(),
          segment: z.string().nullable(),
          doseReference: z.number().nullable(),
          warning: z.string().nullable(),
          segmentCode: z.string().nullable().optional(),
          certifiedId: z.string().nullable().optional(),
          signature: z.string().nullable().optional(),
        }),
      ),
      computedAt: z.string().nullable(),
      error: z.string().nullable(),
      retryAt: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
  weather: z
    .object({
      source: z.enum([
        "manual",
        "open_meteo",
        "openweather",
        "meteoblue",
        "weenat",
        "sencrop",
      ]),
      kind: z.enum(["manual", "observed", "forecast"]),
      temperatureC: z.number().nullable(),
      humidityPct: z.number().nullable(),
      windKmh: z.number().nullable(),
      precipitationMm: z.number().nullable(),
      windMaxKmh: z.number().nullable().optional(),
      fetchedAt: z.string().nullable().optional(),
      station: z
        .object({
          name: z.string(),
          distanceM: z.number(),
        })
        .nullable()
        .optional(),
      icon: z.string().nullable().optional(),
      hours: z
        .array(
          z.object({
            at: z.string(),
            icon: z.string().nullable(),
            temperatureC: z.number().nullable(),
            precipitationMm: z.number().nullable(),
            windKmh: z.number().nullable(),
          }),
        )
        .optional(),
    })
    .nullable()
    .optional(),
  maintenance: z
    .object({
      nature: z.enum(["preventive", "corrective"]),
      problem: z.string().nullable(),
      workshop: z
        .object({
          name: z.string(),
          reference: z.string().nullable().optional(),
        })
        .nullable(),
      operations: z.array(
        z.object({
          equipmentId: z.string(),
          operationId: z.string(),
          label: z.string(),
          kind: z.string(),
          result: z.enum(["done", "ok", "anomaly"]),
          note: z.string().nullable(),
        }),
      ),
    })
    .nullable()
    .optional(),
  irrigation: z
    .object({
      depthMm: z.number(),
      method: z
        .enum(["other", "reel", "pivot", "sprinkler", "drip"])
        .nullable(),
      origin: z
        .enum(["surface", "groundwater", "network", "reservoir"])
        .nullable()
        .optional(),
      trigger: z
        .enum([
          "weather",
          "probe",
          "model",
          "advice",
          "observation",
          "schedule",
        ])
        .nullable()
        .optional(),
      mobile: z.boolean().nullable().optional(),
    })
    .nullable()
    .optional(),
  sowing: z
    .object({
      technique: z.enum([
        "direct",
        "precision",
        "conventional",
        "planting",
        "broadcast",
      ]),
    })
    .nullable()
    .optional(),
  periodPrecision: z.enum(["day", "time"]).optional(),
  affectsStock: z.boolean().optional(),
});

/** Contrôle réglementaire d'une intervention : `GET /interventions/:id/compliance`. */
export const interventionsComplianceResponse = z.object({
  reason: z.string().nullable(),
  level: z.enum(["ok", "warning", "danger", "info"]),
  checkedAt: z.string(),
  referential: z.string().nullable(),
  checks: z.array(
    z.object({
      articleId: z.string(),
      articleName: z.string(),
      level: z.enum(["ok", "warning", "danger", "info"]),
      indicators: z.array(
        z.object({
          code: z.enum([
            "organic",
            "dose",
            "applications",
            "reentry",
            "authorization",
            "znt",
            "dar",
            "applicator",
          ]),
          level: z.enum(["ok", "warning", "danger", "info"]),
          message: z.string(),
        }),
      ),
      usages: z.array(
        z.object({
          id: z.string(),
          label: z.string(),
          doseLabel: z.string().nullable(),
        }),
      ),
      usageId: z.string().nullable(),
      harvestAllowedFrom: z.string().nullable(),
      reentryAllowedFrom: z.string().nullable(),
      zntM: z.number().nullable().optional(),
      usageConditions: z.string().nullable().optional(),
    }),
  ),
  mixture: z
    .object({
      level: z.enum(["ok", "danger"]),
      issues: z.array(
        z.object({
          articleIds: z.array(z.string()),
          message: z.string(),
        }),
      ),
    })
    .nullable()
    .optional(),
});

/** Points d'eau proches d'une intervention : `GET /interventions/:id/water`. */
export const interventionsWaterResponse = z.object({
  zntM: z.number().nullable(),
  buffer: z.unknown(),
  water: z.object({
    type: z.literal("FeatureCollection"),
    features: z.array(z.unknown()),
  }),
});

/** Interventions d'une parcelle : `GET /land-parcels/:id/itinerary`. */
export const landParcelsItineraryResponse = z.object({
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

/** Types d'intervention : `GET /procedures`. */
export const proceduresResponse = z.object({
  shapes: z.object({
    fertilization: z.string(),
    maintenance: z.string(),
    sowing: z.string(),
    work: z.string(),
    treatment: z.string(),
    harvest: z.string(),
  }),
  purposes: z.object({
    other: z.string(),
    herbicide: z.string(),
    fungicide: z.string(),
    insecticide: z.string(),
    acaricide: z.string(),
    molluscicide: z.string(),
    nematicide: z.string(),
    growth_regulator: z.string(),
    biostimulant: z.string(),
    desiccation: z.string(),
  }),
  items: z.array(
    z.object({
      usage: z.number(),
      suggestions: z.object({
        tools: z.array(z.string()),
        inputs: z.array(z.string()),
        doers: z.array(z.string()),
      }),
      code: z.string(),
      label: z.string(),
      shape: z.enum([
        "fertilization",
        "maintenance",
        "sowing",
        "work",
        "treatment",
        "harvest",
      ]),
      category: z.enum(["equipment", "vine", "crops", "general"]),
      inputKinds: z.array(
        z.enum([
          "other",
          "phyto",
          "fluid",
          "harvest",
          "fertilizer",
          "seed",
          "wine",
          "part",
        ]),
      ),
      outputKinds: z.array(
        z.enum([
          "other",
          "phyto",
          "fluid",
          "harvest",
          "fertilizer",
          "seed",
          "wine",
          "part",
        ]),
      ),
      legacy: z.boolean(),
      icon: z.string(),
    }),
  ),
});

/** Stades BBCH : `GET /reference/bbch`. */
export const referenceBbchResponse = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      label: z.string(),
      description: z.string().nullable(),
    }),
  ),
});
