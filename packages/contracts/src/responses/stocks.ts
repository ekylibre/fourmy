import { z } from "zod";

/**
 * Réponses des routes ouvertes, module Stocks et semences (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Articles : `GET /articles`. */
export const articlesResponse = z.object({
  items: z.array(
    z.object({
      amm: z.string().optional(),
      createdAt: z.string(),
      updatedAt: z.string(),
      id: z.string(),
      farmId: z.string(),
      lexiconRef: z.string().nullable(),
      name: z.string(),
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
      unit: z.string(),
      custom: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  nextCursor: z.null(),
});

/** Composition d'un engrais : `GET /articles/:id/fertilizer`. */
export const articlesFertilizerResponse = z.object({
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
});

/** Fiche semence d'un article : `GET /articles/:id/seed`. */
export const articlesSeedResponse = z.object({
  components: z.array(
    z.object({
      species: z.string().nullable(),
      label: z.string(),
      varietyName: z.string().nullable(),
      gnisCode: z.string().nullable(),
      id: z.string(),
      position: z.number(),
      legume: z.boolean().optional(),
    }),
  ),
  lots: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      stock: z.number(),
      seed: z
        .object({
          tgwG: z.number(),
          origin: z.enum(["label", "reference", "imported", "measured"]),
          on: z.string().nullable(),
        })
        .nullable(),
    }),
  ),
  interventions: z.array(
    z.object({
      interventionId: z.string(),
      startedAt: z.string(),
      status: z.string(),
      campaign: z.number().nullable(),
      parcels: z.array(z.string()),
      quantity: z.number().nullable(),
      unit: z.string().nullable(),
      areaHa: z.number().nullable(),
      grainsPerM2: z.number().nullable(),
      kgPerHa: z.number().nullable(),
      plantsPerHa: z.number().nullable().optional(),
      estimated: z.boolean(),
    }),
  ),
  articleId: z.string(),
  name: z.string(),
  unit: z.string(),
  unitDim: z.enum(["mass", "grain", "dose", "plant"]).nullable(),
  lexiconRef: z.string().nullable(),
  organicStatus: z.enum(["organic", "conventional", "conversion"]).nullable(),
  seedTreated: z.boolean().nullable(),
  sheet: z
    .object({
      species: z.string().nullable(),
      varietyName: z.string().nullable(),
      gnisCode: z.string().nullable(),
      category: z.enum(["farm", "certified"]).nullable(),
      isMixture: z.boolean(),
      grainsPerDose: z.number().nullable(),
      bagKg: z.number().nullable(),
      tgwG: z.number().nullable(),
      tgwOrigin: z
        .enum(["label", "reference", "imported", "measured"])
        .nullable(),
      tgwOn: z.string().nullable(),
      articleId: z.string(),
      updatedAt: z.string(),
    })
    .nullable(),
  speciesLabel: z.string().nullable(),
  importedSpecies: z.string().nullable(),
  importedGnis: z.string().nullable(),
  componentCount: z.number(),
  reference: z
    .object({
      label: z.string(),
      typicalG: z.number(),
      minG: z.number().nullable(),
      maxG: z.number().nullable(),
      typicalStated: z.boolean(),
      org: z.string(),
      url: z.string(),
      note: z.string().nullable(),
    })
    .nullable(),
  tgw: z
    .object({
      tgwG: z.number(),
      origin: z.enum(["label", "reference", "imported", "measured"]),
      from: z.enum(["reference", "article", "lot"]),
      estimated: z.boolean(),
    })
    .nullable(),
  flags: z.array(
    z.enum([
      "tgw_missing",
      "unit_unknown",
      "mixture_empty",
      "species_unknown",
      "tgw_far_from_reference",
    ]),
  ),
  looksLikeMixture: z.boolean(),
  stock: z.number(),
  usage: z.array(
    z.object({
      campaign: z.number(),
      interventions: z.number(),
    }),
  ),
});

/** Composition d'un mélange : `GET /articles/:id/seed/mixture`. */
export const articlesSeedMixtureResponse = z.object({
  articleId: z.string(),
  components: z.array(
    z.object({
      species: z.string().nullable(),
      label: z.string(),
      varietyName: z.string().nullable(),
      gnisCode: z.string().nullable(),
      id: z.string(),
      position: z.number(),
      legume: z.boolean().optional(),
    }),
  ),
  last: z
    .object({
      interventionId: z.string(),
      startedAt: z.string(),
      doses: z.array(
        z.object({
          componentId: z.string().nullable(),
          label: z.string(),
          species: z.string().nullable(),
          kgHa: z.number(),
        }),
      ),
    })
    .nullable(),
});

/** État des stocks : `GET /stock`. */
export const stockResponse = z.object({
  items: z.array(
    z.object({
      articleId: z.string(),
      lotId: z.string(),
      placeId: z.string().nullable(),
      containerId: z.string().nullable(),
      quantity: z.number(),
      unit: z.string(),
      articleName: z.string().optional(),
      articleKind: z.string().optional(),
      lotCode: z.string().optional(),
    }),
  ),
  nextCursor: z.null(),
});

/** Cuves et contenants : `GET /containers`. */
export const containersResponse = z.object({
  items: z.array(
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
  nextCursor: z.null(),
});

/** Contenu d'une cuve : `GET /containers/:id/contents`. */
export const containersContentsResponse = z.object({
  containerId: z.string(),
  at: z.string(),
  volumeL: z.number(),
  composition: z.array(
    z.object({
      lotId: z.string(),
      lotCode: z.string(),
      share: z.number(),
      attrs: z.record(z.string(), z.unknown()).optional(),
    }),
  ),
  lastMovements: z.array(
    z.object({
      occurredAt: z.string(),
      quantityL: z.number(),
      cause: z.string(),
    }),
  ),
  origins: z.record(z.string(), z.number()),
});

/** Semences : `GET /seeds`. */
export const seedsResponse = z.object({
  items: z.array(
    z.object({
      articleId: z.string(),
      name: z.string(),
      unit: z.string(),
      unitDim: z.enum(["mass", "grain", "dose", "plant"]).nullable(),
      lexiconRef: z.string().nullable(),
      organicStatus: z
        .enum(["organic", "conventional", "conversion"])
        .nullable(),
      seedTreated: z.boolean().nullable(),
      sheet: z
        .object({
          species: z.string().nullable(),
          varietyName: z.string().nullable(),
          gnisCode: z.string().nullable(),
          category: z.enum(["farm", "certified"]).nullable(),
          isMixture: z.boolean(),
          grainsPerDose: z.number().nullable(),
          bagKg: z.number().nullable(),
          tgwG: z.number().nullable(),
          tgwOrigin: z
            .enum(["label", "reference", "imported", "measured"])
            .nullable(),
          tgwOn: z.string().nullable(),
          articleId: z.string(),
          updatedAt: z.string(),
        })
        .nullable(),
      speciesLabel: z.string().nullable(),
      importedSpecies: z.string().nullable(),
      importedGnis: z.string().nullable(),
      componentCount: z.number(),
      reference: z
        .object({
          label: z.string(),
          typicalG: z.number(),
          minG: z.number().nullable(),
          maxG: z.number().nullable(),
          typicalStated: z.boolean(),
          org: z.string(),
          url: z.string(),
          note: z.string().nullable(),
        })
        .nullable(),
      tgw: z
        .object({
          tgwG: z.number(),
          origin: z.enum(["label", "reference", "imported", "measured"]),
          from: z.enum(["reference", "article", "lot"]),
          estimated: z.boolean(),
        })
        .nullable(),
      flags: z.array(
        z.enum([
          "tgw_missing",
          "unit_unknown",
          "mixture_empty",
          "species_unknown",
          "tgw_far_from_reference",
        ]),
      ),
      looksLikeMixture: z.boolean(),
      stock: z.number(),
      usage: z.array(
        z.object({
          campaign: z.number(),
          interventions: z.number(),
        }),
      ),
    }),
  ),
});

/** Espèces semées : `GET /seeds/species`. */
export const seedsSpeciesResponse = z.object({
  items: z.array(
    z.object({
      species: z.string(),
      label: z.string(),
      legume: z.boolean(),
      hasReference: z.boolean(),
    }),
  ),
});

/** Utilisation des semences : `GET /seeds/usage`. */
export const seedsUsageResponse = z.union([
  z.string(),
  z.object({
    campaign: z.number(),
    by: z.enum(["species", "article"]),
    groups: z.array(
      z.object({
        key: z.string(),
        label: z.string(),
        species: z.string().nullable(),
        speciesLabel: z.string().nullable(),
        unit: z.string().nullable(),
        articles: z.array(
          z.object({
            articleId: z.string(),
            name: z.string(),
          }),
        ),
        activities: z.array(z.string()),
        done: z.object({
          interventions: z.number(),
          areaHa: z.number(),
          stockQuantity: z.number().nullable(),
          kg: z.number().nullable(),
          grains: z.number().nullable(),
          kgPerHa: z
            .object({
              mean: z.number(),
              min: z.number(),
              max: z.number(),
            })
            .nullable(),
          grainsPerM2: z
            .object({
              mean: z.number(),
              min: z.number(),
              max: z.number(),
            })
            .nullable(),
          estimated: z.boolean(),
          unconvertible: z.number(),
        }),
        planned: z.object({
          interventions: z.number(),
          areaHa: z.number(),
          stockQuantity: z.number().nullable(),
          kg: z.number().nullable(),
          grains: z.number().nullable(),
          kgPerHa: z
            .object({
              mean: z.number(),
              min: z.number(),
              max: z.number(),
            })
            .nullable(),
          grainsPerM2: z
            .object({
              mean: z.number(),
              min: z.number(),
              max: z.number(),
            })
            .nullable(),
          estimated: z.boolean(),
          unconvertible: z.number(),
        }),
      }),
    ),
  }),
]);

/** Catalogue des variétés : `GET /seeds/catalog`. */
export const seedsCatalogResponse = z.object({
  items: z.array(
    z.object({
      gnisCode: z.string(),
      varietyName: z.string(),
      species: z.string(),
      speciesLabel: z.string(),
      registeredOn: z.string().nullable(),
      legume: z.boolean(),
      reference: z
        .object({
          label: z.string(),
          typicalG: z.number(),
          minG: z.number().nullable(),
          maxG: z.number().nullable(),
          typicalStated: z.boolean(),
          org: z.string(),
          url: z.string(),
          note: z.string().nullable(),
        })
        .nullable(),
      proposedUnit: z.string(),
      proposedGrainsPerDose: z.number().nullable(),
    }),
  ),
});
