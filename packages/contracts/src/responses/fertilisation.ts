import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Fertilisation (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Fertilisation par parcelle : `GET /fertilization/parcels`. */
export const fertilizationParcelsResponse = z.object({
  items: z.array(
    z.object({
      parcelId: z.string(),
      name: z.string(),
      areaM2: z.number(),
      soil: z.object({
        soilType: z.string().nullable(),
        soilTypeRegion: z.string().nullable(),
        rootingDepthCm: z.number().nullable(),
        waterSourceId: z.string().nullable(),
        tawMm: z.number().nullable(),
        irrigated: z.boolean(),
      }),
      zone: z
        .object({
          status: z.enum(["out", "in", "unknown", "partial"]),
          insee: z.string().nullable(),
          commune: z.string().nullable(),
          zones: z.array(z.string()),
          referential: z.string(),
          computedAt: z.string(),
          confirmedAt: z.string().nullable(),
          note: z.string().nullable(),
        })
        .nullable(),
      analyses: z.array(
        z.object({
          sampledOn: z.string(),
          kind: z.enum(["soil", "rsh", "post_harvest"]),
          horizons: z
            .array(
              z.object({
                fromCm: z.number(),
                toCm: z.number(),
                no3KgHa: z.number(),
                nh4KgHa: z.number().nullable(),
              }),
            )
            .nullable(),
          values: z
            .object({
              organicMatterPct: z.number().nullable(),
              nTotalGKg: z.number().nullable(),
              clayGKg: z.number().nullable(),
              caco3GKg: z.number().nullable(),
              ph: z.number().nullable(),
              cecMeq: z.number().nullable(),
              stonesPct: z.number().nullable(),
            })
            .nullable(),
          lab: z.string().nullable(),
          id: z.string(),
          parcelId: z.string(),
          createdAt: z.string(),
        }),
      ),
    }),
  ),
});

/** Plans de fumure : `GET /fertilization/plans`. */
export const fertilizationPlansResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(["main", "cover_exported"]),
      campaign: z.number(),
      parcel: z.object({
        id: z.string(),
        name: z.string(),
        areaM2: z.number(),
      }),
      cropLabel: z.string(),
      zone: z.string().nullable(),
      status: z.enum(["draft", "established", "revised"]),
      currentVersion: z.number().nullable(),
      dose: z.number().nullable(),
      doseOrigin: z.enum(["external", "fourmy"]).nullable(),
      missing: z.number(),
      establishedAt: z.string().nullable(),
    }),
  ),
});

/** Plan de fumure : `GET /fertilization/plans/:id`. */
export const fertilizationPlansOneResponse = z.object({
  id: z.string(),
  kind: z.enum(["main", "cover_exported"]),
  campaign: z.number(),
  parcel: z.object({
    id: z.string(),
    name: z.string(),
    areaM2: z.number(),
  }),
  status: z.enum(["draft", "established", "revised"]),
  currentVersion: z.number().nullable(),
  draft: z.object({
    yieldTarget: z.number().nullable().optional(),
    strawReturned: z.boolean().nullable().optional(),
    irrigationMm: z.number().nullable().optional(),
    nBefore4Leaves: z.number().nullable().optional(),
    tillers: z.number().nullable().optional(),
    unfavourable: z.boolean().optional(),
    valueA: z.number().nullable().optional(),
    overrides: z
      .object({
        Pf: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Rf: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Ri: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Pi: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Mh: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Mhp: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Mr: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        MrCi: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        M: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Fleg: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Fass: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Mha: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Nirr: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Xa: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        CAU: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
        Nbefore4: z
          .object({
            value: z.number(),
            reason: z.string(),
          })
          .optional(),
      })
      .optional(),
    applications: z
      .array(
        z.object({
          stage: z.string(),
          plannedOn: z.string().nullable(),
          articleId: z.string().nullable(),
          nKgHa: z.number(),
          reservedForSteering: z.boolean(),
        }),
      )
      .optional(),
    external: z
      .object({
        doseKgNHa: z.number(),
        tool: z.string(),
        advisor: z.string().nullable(),
        computedOn: z.string(),
      })
      .nullable()
      .optional(),
    note: z.string().nullable().optional(),
    openingOn: z.string().nullable().optional(),
    sowingPeriod: z.string().nullable().optional(),
    rapeseed: z
      .object({
        biomassEndWinterKgM2: z.number().nullable(),
        biomassStartWinterKgM2: z.number().nullable(),
        legumeCompanion: z.boolean(),
        organicHistory: z
          .object({
            product: z.string(),
            frequency: z.enum([
              "every_year",
              "two_in_three",
              "every_two",
              "every_three_or_more",
            ]),
          })
          .nullable(),
      })
      .optional(),
    organics: z
      .array(
        z.object({
          articleId: z.string(),
          quantity: z.number(),
          plannedOn: z.string(),
        }),
      )
      .optional(),
  }),
  context: z.object({
    department: z.string().nullable(),
    crop: z.string(),
    cropLabel: z.string(),
    variety: z.string().nullable(),
    soilType: z.string().nullable(),
    irrigated: z.boolean(),
    previous: z
      .object({
        crop: z.string(),
        label: z.string(),
        parcelName: z.string(),
        yieldRealized: z.number().nullable(),
        xMineral: z.number().nullable(),
        strawReturned: z.boolean().nullable(),
        uncounted: z.array(z.string()),
      })
      .nullable(),
    yieldTarget: z
      .object({
        value: z.number(),
        origin: z.enum(["reference", "computed", "entered"]),
        detail: z.string(),
      })
      .nullable(),
    rain: z
      .object({
        mm: z.number(),
        from: z.string(),
        to: z.string(),
        normalsFrom: z.string().nullable(),
      })
      .nullable(),
    rsh: z
      .object({
        kgNHa: z.number(),
        sampledOn: z.string(),
      })
      .nullable(),
    water: z.object({
      origin: z.enum(["surface", "groundwater"]).nullable(),
      no3MgL: z.number().nullable(),
      name: z.string().nullable(),
    }),
    irrigationMm: z
      .object({
        value: z.number(),
        detail: z.string(),
      })
      .nullable(),
    zone: z.string().nullable(),
    opening: z.object({
      on: z.string(),
      origin: z.enum(["default", "rsh", "entered"]),
    }),
    sowing: z.object({
      period: z.string().nullable(),
      sownOn: z.string().nullable(),
    }),
    starter: z
      .object({
        kgNHa: z.number(),
        from: z.string(),
        to: z.string(),
      })
      .nullable()
      .optional(),
    cover: z
      .object({
        campaign: z.number(),
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
        exported: z.boolean(),
        biomass: z.enum(["le_1", "1_3", "ge_3"]).nullable(),
        destructionMode: z
          .enum(["harvest", "mechanical", "chemical", "frost", "grazing"])
          .nullable(),
        notes: z.string().nullable(),
        sowingInterventionId: z.string().nullable(),
        components: z
          .array(
            z.object({
              label: z.string(),
              species: z.string().nullable(),
              kgHa: z.number().nullable(),
            }),
          )
          .nullable(),
        id: z.string(),
        parcelId: z.string(),
      })
      .nullable(),
    organics: z.array(
      z.object({
        date: z.string(),
        product: z.string(),
        planned: z.boolean(),
        nTotalKgHa: z.number(),
        period: z.string(),
        xa: z.number(),
        ri: z.number(),
        keq: z.object({
          bilan: z.number().nullable(),
          ri: z.number().nullable(),
          cycle: z.number().nullable(),
        }),
        missing: z.string().nullable(),
        notRecommended: z.boolean(),
      }),
    ),
  }),
  result: z.object({
    method: z.string(),
    annex: z.string().nullable(),
    equation: z.string(),
    terms: z.object({
      Pf: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Rf: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Ri: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Pi: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Mh: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Mhp: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Mr: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      MrCi: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      M: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Fleg: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Fass: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Mha: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Nirr: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Xa: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      CAU: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
      Nbefore4: z
        .union([
          z.object({
            value: z.number(),
            origin: z.enum([
              "override",
              "reference",
              "measured",
              "computed",
              "entered",
            ]),
            source: z.string(),
            detail: z.string().optional(),
          }),
          z.object({
            missing: z.string(),
          }),
        ])
        .optional(),
    }),
    dose: z.number().nullable(),
    ceiling: z.number().nullable(),
    floor30: z.boolean(),
    negative: z.boolean(),
    warnings: z.array(z.string()),
    missing: z.array(z.string()),
  }),
  proposedApplications: z.array(
    z.object({
      stage: z.string(),
      plannedOn: z.string().nullable(),
      articleId: z.string().nullable(),
      nKgHa: z.number(),
      reservedForSteering: z.boolean(),
    }),
  ),
  versions: z.array(
    z.object({
      version: z.number(),
      establishedAt: z.string(),
      establishedBy: z.string().nullable(),
      reason: z.string().nullable(),
      referential: z.string(),
      method: z.string(),
      external: z
        .object({
          doseKgNHa: z.number(),
          tool: z.string(),
          advisor: z.string().nullable(),
          computedOn: z.string(),
        })
        .nullable()
        .optional(),
      doseEfficient: z.number().nullable(),
      applications: z.array(
        z.object({
          stage: z.string(),
          plannedOn: z.string().nullable(),
          articleId: z.string().nullable(),
          nKgHa: z.number(),
          reservedForSteering: z.boolean(),
          nTotal: z.number(),
        }),
      ),
      snapshot: z.object({
        context: z.object({
          department: z.string().nullable(),
          crop: z.string(),
          cropLabel: z.string(),
          variety: z.string().nullable(),
          soilType: z.string().nullable(),
          irrigated: z.boolean(),
          previous: z
            .object({
              crop: z.string(),
              label: z.string(),
              parcelName: z.string(),
              yieldRealized: z.number().nullable(),
              xMineral: z.number().nullable(),
              strawReturned: z.boolean().nullable(),
              uncounted: z.array(z.string()),
            })
            .nullable(),
          yieldTarget: z
            .object({
              value: z.number(),
              origin: z.enum(["reference", "computed", "entered"]),
              detail: z.string(),
            })
            .nullable(),
          rain: z
            .object({
              mm: z.number(),
              from: z.string(),
              to: z.string(),
              normalsFrom: z.string().nullable(),
            })
            .nullable(),
          rsh: z
            .object({
              kgNHa: z.number(),
              sampledOn: z.string(),
            })
            .nullable(),
          water: z.object({
            origin: z.enum(["surface", "groundwater"]).nullable(),
            no3MgL: z.number().nullable(),
            name: z.string().nullable(),
          }),
          irrigationMm: z
            .object({
              value: z.number(),
              detail: z.string(),
            })
            .nullable(),
          zone: z.string().nullable(),
          opening: z.object({
            on: z.string(),
            origin: z.enum(["default", "rsh", "entered"]),
          }),
          sowing: z.object({
            period: z.string().nullable(),
            sownOn: z.string().nullable(),
          }),
          starter: z
            .object({
              kgNHa: z.number(),
              from: z.string(),
              to: z.string(),
            })
            .nullable()
            .optional(),
          cover: z
            .object({
              campaign: z.number(),
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
              exported: z.boolean(),
              biomass: z.enum(["le_1", "1_3", "ge_3"]).nullable(),
              destructionMode: z
                .enum(["harvest", "mechanical", "chemical", "frost", "grazing"])
                .nullable(),
              notes: z.string().nullable(),
              sowingInterventionId: z.string().nullable(),
              components: z
                .array(
                  z.object({
                    label: z.string(),
                    species: z.string().nullable(),
                    kgHa: z.number().nullable(),
                  }),
                )
                .nullable(),
              id: z.string(),
              parcelId: z.string(),
            })
            .nullable(),
          organics: z.array(
            z.object({
              date: z.string(),
              product: z.string(),
              planned: z.boolean(),
              nTotalKgHa: z.number(),
              period: z.string(),
              xa: z.number(),
              ri: z.number(),
              keq: z.object({
                bilan: z.number().nullable(),
                ri: z.number().nullable(),
                cycle: z.number().nullable(),
              }),
              missing: z.string().nullable(),
              notRecommended: z.boolean(),
            }),
          ),
        }),
        result: z.object({
          method: z.string(),
          annex: z.string().nullable(),
          equation: z.string(),
          terms: z.object({
            Pf: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Rf: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Ri: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Pi: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Mh: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Mhp: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Mr: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            MrCi: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            M: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Fleg: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Fass: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Mha: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Nirr: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Xa: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            CAU: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
            Nbefore4: z
              .union([
                z.object({
                  value: z.number(),
                  origin: z.enum([
                    "override",
                    "reference",
                    "measured",
                    "computed",
                    "entered",
                  ]),
                  source: z.string(),
                  detail: z.string().optional(),
                }),
                z.object({
                  missing: z.string(),
                }),
              ])
              .optional(),
          }),
          dose: z.number().nullable(),
          ceiling: z.number().nullable(),
          floor30: z.boolean(),
          negative: z.boolean(),
          warnings: z.array(z.string()),
          missing: z.array(z.string()),
        }),
        draft: z.object({
          yieldTarget: z.number().nullable().optional(),
          strawReturned: z.boolean().nullable().optional(),
          irrigationMm: z.number().nullable().optional(),
          nBefore4Leaves: z.number().nullable().optional(),
          tillers: z.number().nullable().optional(),
          unfavourable: z.boolean().optional(),
          valueA: z.number().nullable().optional(),
          overrides: z
            .object({
              Pf: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Rf: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Ri: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Pi: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Mh: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Mhp: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Mr: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              MrCi: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              M: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Fleg: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Fass: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Mha: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Nirr: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Xa: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              CAU: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
              Nbefore4: z
                .object({
                  value: z.number(),
                  reason: z.string(),
                })
                .optional(),
            })
            .optional(),
          applications: z
            .array(
              z.object({
                stage: z.string(),
                plannedOn: z.string().nullable(),
                articleId: z.string().nullable(),
                nKgHa: z.number(),
                reservedForSteering: z.boolean(),
              }),
            )
            .optional(),
          external: z
            .object({
              doseKgNHa: z.number(),
              tool: z.string(),
              advisor: z.string().nullable(),
              computedOn: z.string(),
            })
            .nullable()
            .optional(),
          note: z.string().nullable().optional(),
          openingOn: z.string().nullable().optional(),
          sowingPeriod: z.string().nullable().optional(),
          rapeseed: z
            .object({
              biomassEndWinterKgM2: z.number().nullable(),
              biomassStartWinterKgM2: z.number().nullable(),
              legumeCompanion: z.boolean(),
              organicHistory: z
                .object({
                  product: z.string(),
                  frequency: z.enum([
                    "every_year",
                    "two_in_three",
                    "every_two",
                    "every_three_or_more",
                  ]),
                })
                .nullable(),
            })
            .optional(),
          organics: z
            .array(
              z.object({
                articleId: z.string(),
                quantity: z.number(),
                plannedOn: z.string(),
              }),
            )
            .optional(),
        }),
      }),
    }),
  ),
  steering: z.object({
    measurements: z.array(
      z.object({
        measuredOn: z.string(),
        stage: z.string().nullable(),
        tool: z.string(),
        value: z.string().nullable(),
        advisedKgNHa: z.number(),
        notes: z.string().nullable(),
        id: z.string(),
        planId: z.string(),
        createdAt: z.string(),
      }),
    ),
    reservedKgNHa: z.number(),
    allowedDose: z.number().nullable(),
  }),
  prescriptions: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      stage: z.string().nullable(),
      product: z.string(),
      unit: z.string(),
      targetRate: z.number(),
      meanRate: z.number(),
      createdAt: z.string(),
    }),
  ),
});

/** Cahier d'enregistrement : `GET /fertilization/record`. */
export const fertilizationRecordResponse = z.union([
  z.string(),
  z.object({
    campaign: z.number(),
    from: z.string(),
    to: z.string(),
    parcels: z.array(
      z.object({
        parcelId: z.string(),
        name: z.string(),
        areaHa: z.number(),
        soilType: z.string().nullable(),
        zone: z.string().nullable(),
        crop: z.string(),
        variety: z.string().nullable(),
        sownOn: z.string().nullable(),
        harvestedOn: z.array(z.string()),
        yieldQHa: z.number().nullable(),
        interculture: z.array(
          z.object({
            date: z.string(),
            label: z.string(),
          }),
        ),
        cover: z
          .object({
            campaign: z.number(),
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
            exported: z.boolean(),
            biomass: z.enum(["le_1", "1_3", "ge_3"]).nullable(),
            destructionMode: z
              .enum(["harvest", "mechanical", "chemical", "frost", "grazing"])
              .nullable(),
            notes: z.string().nullable(),
            sowingInterventionId: z.string().nullable(),
            components: z
              .array(
                z.object({
                  label: z.string(),
                  species: z.string().nullable(),
                  kgHa: z.number().nullable(),
                }),
              )
              .nullable(),
            id: z.string(),
            parcelId: z.string(),
          })
          .nullable(),
        soilCover: z
          .object({
            level: z.enum(["ok", "warning", "info"]),
            situation: z.enum(["none", "long", "short_after_rapeseed"]),
            messages: z.array(z.string()),
            previousParcelId: z.string().nullable().optional(),
            harvestedOn: z.string().nullable().optional(),
          })
          .nullable(),
        steering: z.array(
          z.object({
            measuredOn: z.string(),
            stage: z.string().nullable(),
            tool: z.string(),
            value: z.string().nullable(),
            advisedKgNHa: z.number(),
            notes: z.string().nullable(),
            id: z.string(),
            planId: z.string(),
            createdAt: z.string(),
          }),
        ),
        aplsh: z
          .object({
            from: z.string(),
            to: z.string(),
            kgNHa: z.number(),
            ceiling: z.number(),
            over: z.boolean(),
            missing: z.array(z.string()),
          })
          .nullable(),
        noPlowing: z.boolean().nullable(),
        applications: z.array(
          z.object({
            interventionId: z.string(),
            date: z.string(),
            recordedOn: z.string(),
            late: z.boolean(),
            procedure: z.string(),
            areaHa: z.number(),
            product: z.string(),
            content: z.string().nullable(),
            nitrateType: z.string().nullable(),
            doseLabel: z.string(),
            nTotalKgHa: z.number().nullable(),
            nEfficientKgHa: z.number().nullable(),
            missing: z.string().nullable(),
            efficiency: z
              .object({
                level: z.enum(["ok", "warning", "info"]),
                message: z.string(),
              })
              .nullable(),
          }),
        ),
        totalNKgHa: z.number(),
        plannedDose: z.number().nullable(),
        planVersion: z.number().nullable(),
      }),
    ),
    toComplete: z.number(),
    late: z.number(),
    forced: z.array(
      z.object({
        interventionId: z.string(),
        date: z.string(),
        parcels: z.array(z.string()),
        reason: z.string().nullable(),
      }),
    ),
  }),
]);

/** Fertilisants : `GET /fertilizers`. */
export const fertilizersResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      kind: z.string(),
      unit: z.string(),
      lexiconRef: z.string().nullable(),
      composition: z
        .object({
          basis: z.enum(["mass_percent", "kg_per_t", "kg_per_m3"]),
          nTotal: z.number(),
          nMineralShare: z.number().nullable(),
          p2o5: z.number().nullable(),
          k2o: z.number().nullable(),
          so3: z.number().nullable(),
          density: z.number().nullable(),
          nitrateType: z.enum(["0", "Ia", "Ib", "II", "III"]).nullable(),
          foliar: z.boolean(),
          cN: z.number().nullable().optional(),
          aplshProduct: z.string().nullable().optional(),
          proProduct: z.string().nullable().optional(),
        })
        .nullable(),
      origin: z
        .enum(["proposed", "imported", "migrated", "confirmed", "analysis"])
        .nullable(),
      source: z.string().nullable(),
      proposal: z
        .object({
          basis: z.enum(["mass_percent", "kg_per_t", "kg_per_m3"]),
          nTotal: z.number(),
          nMineralShare: z.number().nullable(),
          p2o5: z.number().nullable(),
          k2o: z.number().nullable(),
          so3: z.number().nullable(),
          density: z.number().nullable(),
          nitrateType: z.enum(["0", "Ia", "Ib", "II", "III"]).nullable(),
          foliar: z.boolean(),
          cN: z.number().nullable().optional(),
          aplshProduct: z.string().nullable().optional(),
          proProduct: z.string().nullable().optional(),
          source: z.string(),
        })
        .nullable(),
      analyses: z.array(
        z.object({
          sampledOn: z.string(),
          basis: z.enum(["kg_per_t", "kg_per_m3"]),
          dryMatter: z.number().nullable(),
          nTotal: z.number(),
          nNh4: z.number().nullable(),
          cN: z.number().nullable(),
          lab: z.string().nullable(),
          id: z.string(),
          articleId: z.string(),
        }),
      ),
      usage: z.number(),
      abCategories: z.array(z.string()).nullable(),
      effluentOrigin: z
        .enum(["organic", "unknown", "conventional", "industrial"])
        .nullable(),
    }),
  ),
});

/** Fertilisation d'une parcelle : `GET /land-parcels/:id/fertilization`. */
export const landParcelsFertilizationResponse = z.object({
  parcelId: z.string(),
  name: z.string(),
  areaM2: z.number(),
  soil: z.object({
    soilType: z.string().nullable(),
    soilTypeRegion: z.string().nullable(),
    rootingDepthCm: z.number().nullable(),
    waterSourceId: z.string().nullable(),
    tawMm: z.number().nullable(),
    irrigated: z.boolean(),
  }),
  zone: z
    .object({
      status: z.enum(["out", "in", "unknown", "partial"]),
      insee: z.string().nullable(),
      commune: z.string().nullable(),
      zones: z.array(z.string()),
      referential: z.string(),
      computedAt: z.string(),
      confirmedAt: z.string().nullable(),
      note: z.string().nullable(),
    })
    .nullable(),
  analyses: z.array(
    z.object({
      sampledOn: z.string(),
      kind: z.enum(["soil", "rsh", "post_harvest"]),
      horizons: z
        .array(
          z.object({
            fromCm: z.number(),
            toCm: z.number(),
            no3KgHa: z.number(),
            nh4KgHa: z.number().nullable(),
          }),
        )
        .nullable(),
      values: z
        .object({
          organicMatterPct: z.number().nullable(),
          nTotalGKg: z.number().nullable(),
          clayGKg: z.number().nullable(),
          caco3GKg: z.number().nullable(),
          ph: z.number().nullable(),
          cecMeq: z.number().nullable(),
          stonesPct: z.number().nullable(),
        })
        .nullable(),
      lab: z.string().nullable(),
      id: z.string(),
      parcelId: z.string(),
      createdAt: z.string(),
    }),
  ),
});

/** Cartes de modulation : `GET /prescriptions`. */
export const prescriptionsResponse = z.object({
  items: z.array(
    z.object({
      name: z.string(),
      plan: z
        .object({
          planId: z.string(),
          stage: z.string().nullable(),
          targetRate: z.number(),
        })
        .nullable(),
      date: z.string(),
      id: z.string(),
      createdAt: z.string(),
      unit: z.enum(["kg_ha", "l_ha", "seeds_ha"]),
      product: z.string(),
      widthM: z.number(),
      parcelName: z.string(),
      parcelAreaM2: z.number(),
      index: z.enum(["ndvi", "ndre", "ndmi"]),
      parcelId: z.string(),
      zoneCount: z.number(),
      strategy: z.enum(["compensate", "boost", "uniform"]),
      baseRate: z.number(),
      modulationPct: z.number(),
      minRate: z.number(),
      maxRate: z.number(),
      totalQuantity: z.number(),
      lastSentAt: z.string().nullable(),
    }),
  ),
});

/** Carte de modulation : `GET /prescriptions/:id`. */
export const prescriptionsOneResponse = z.object({
  id: z.string(),
  name: z.string(),
  parcelId: z.string(),
  parcelName: z.string(),
  parcelAreaM2: z.number(),
  date: z.string(),
  index: z.enum(["ndvi", "ndre", "ndmi"]),
  zoneCount: z.number(),
  product: z.string(),
  unit: z.enum(["kg_ha", "l_ha", "seeds_ha"]),
  strategy: z.enum(["compensate", "boost", "uniform"]),
  baseRate: z.number(),
  modulationPct: z.number(),
  minRate: z.number(),
  maxRate: z.number(),
  widthM: z.number(),
  totalQuantity: z.number(),
  plan: z
    .object({
      planId: z.string(),
      stage: z.string().nullable(),
      targetRate: z.number(),
    })
    .nullable(),
  createdAt: z.string(),
  zones: z.array(
    z.object({
      rate: z.number(),
      code: z.number(),
      meanIndex: z.number(),
      minIndex: z.number(),
      maxIndex: z.number(),
      areaM2: z.number(),
      geometry: geoJsonGeometry,
    }),
  ),
  sends: z.array(
    z.object({
      id: z.string(),
      format: z.enum(["shape", "isoxml"]),
      channel: z.literal("agrirouter"),
      recipients: z.array(
        z.object({
          id: z.string(),
          name: z.string(),
        }),
      ),
      sentAt: z.string(),
      sentBy: z.string().nullable(),
      status: z.enum(["error", "partial", "queued", "sent"]),
      error: z.string().nullable(),
      nextAttemptAt: z.string().nullable(),
    }),
  ),
});
