import { z } from "zod";

/**
 * Réponses des routes ouvertes, module Personnes et équipes (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Personnes : `GET /people`. */
export const peopleResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      farmId: z.string(),
      name: z.string(),
      userId: z.string().nullable(),
      active: z.boolean(),
      createdAt: z.string(),
      updatedAt: z.string(),
      firstName: z.string().nullable(),
      lastName: z.string().nullable(),
      photo: z
        .object({
          hash: z.string(),
        })
        .nullable(),
      account: z.object({
        status: z.enum(["none", "active", "invited"]),
        role: z.enum(["owner", "worker", "reader", "guest"]).nullable(),
        grant: z
          .object({
            modules: z.object({
              certifications: z.enum(["none", "read", "write"]).optional(),
              farm: z.enum(["none", "read", "write"]).optional(),
              parcels: z.enum(["none", "read", "write"]).optional(),
              activities: z.enum(["none", "read", "write"]).optional(),
              interventions: z.enum(["none", "read", "write"]).optional(),
              phyto: z.enum(["none", "read", "write"]).optional(),
              fertilization: z.enum(["none", "read", "write"]).optional(),
              stocks: z.enum(["none", "read", "write"]).optional(),
              equipments: z.enum(["none", "read", "write"]).optional(),
              people: z.enum(["none", "read", "write"]).optional(),
              economics: z.enum(["none", "read", "write"]).optional(),
            }),
            activities: z.union([z.array(z.string()), z.literal("all")]),
          })
          .nullable()
          .optional(),
      }),
      certiphyto: z.object({
        status: z.enum(["valid", "none", "expiring", "expired"]),
        validUntil: z.string().nullable(),
      }),
      monthHours: z.number().nullable(),
      lastIntervention: z
        .object({
          id: z.string(),
          date: z.string(),
          procedure: z.string(),
        })
        .nullable(),
    }),
  ),
  nextCursor: z.null(),
});

/** Fiche d'une personne : `GET /people/:id`. */
export const peopleOneResponse = z.object({
  id: z.string(),
  farmId: z.string(),
  name: z.string(),
  userId: z.string().nullable(),
  active: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  photo: z
    .object({
      hash: z.string(),
    })
    .nullable(),
  account: z.object({
    status: z.enum(["none", "active", "invited"]),
    role: z.enum(["owner", "worker", "reader", "guest"]).nullable(),
    grant: z
      .object({
        modules: z.object({
          certifications: z.enum(["none", "read", "write"]).optional(),
          farm: z.enum(["none", "read", "write"]).optional(),
          parcels: z.enum(["none", "read", "write"]).optional(),
          activities: z.enum(["none", "read", "write"]).optional(),
          interventions: z.enum(["none", "read", "write"]).optional(),
          phyto: z.enum(["none", "read", "write"]).optional(),
          fertilization: z.enum(["none", "read", "write"]).optional(),
          stocks: z.enum(["none", "read", "write"]).optional(),
          equipments: z.enum(["none", "read", "write"]).optional(),
          people: z.enum(["none", "read", "write"]).optional(),
          economics: z.enum(["none", "read", "write"]).optional(),
        }),
        activities: z.union([z.array(z.string()), z.literal("all")]),
      })
      .nullable()
      .optional(),
  }),
  monthHours: z.number().nullable(),
  lastIntervention: z
    .object({
      id: z.string(),
      date: z.string(),
      procedure: z.string(),
    })
    .nullable(),
  certiphyto: z.object({
    status: z.enum(["valid", "none", "expiring", "expired"]),
    category: z
      .enum([
        "decideur_entreprise",
        "decideur_prestation",
        "operateur",
        "conseil",
        "vente",
      ])
      .nullable(),
    number: z.string().nullable(),
    validUntil: z.string().nullable(),
  }),
  external: z.object({
    ekylibre: z.boolean(),
  }),
  canEditContact: z.boolean(),
  private: z
    .object({
      email: z.string().nullable(),
      mobile: z.string().nullable(),
      address: z.object({
        line1: z.string().nullable(),
        line2: z.string().nullable(),
        postalCode: z.string().nullable(),
        city: z.string().nullable(),
        country: z.string().nullable(),
      }),
      birthDate: z.string().nullable(),
      contract: z.object({
        type: z
          .enum([
            "farmer",
            "permanent",
            "fixed_term",
            "seasonal",
            "apprentice",
            "volunteer",
            "contractor",
          ])
          .nullable(),
        startedOn: z.string().nullable(),
        endedOn: z.string().nullable(),
      }),
    })
    .optional(),
  invitation: z
    .object({
      email: z.string(),
      role: z.enum(["owner", "worker", "reader", "guest"]),
      expiresAt: z.string(),
      sentByEmail: z.boolean(),
      grant: z
        .object({
          modules: z.object({
            certifications: z.enum(["none", "read", "write"]).optional(),
            farm: z.enum(["none", "read", "write"]).optional(),
            parcels: z.enum(["none", "read", "write"]).optional(),
            activities: z.enum(["none", "read", "write"]).optional(),
            interventions: z.enum(["none", "read", "write"]).optional(),
            phyto: z.enum(["none", "read", "write"]).optional(),
            fertilization: z.enum(["none", "read", "write"]).optional(),
            stocks: z.enum(["none", "read", "write"]).optional(),
            equipments: z.enum(["none", "read", "write"]).optional(),
            people: z.enum(["none", "read", "write"]).optional(),
            economics: z.enum(["none", "read", "write"]).optional(),
          }),
          activities: z.union([z.array(z.string()), z.literal("all")]),
        })
        .nullable()
        .optional(),
    })
    .nullable()
    .optional(),
});

/** Interventions d'une personne : `GET /people/:id/interventions`. */
export const peopleInterventionsResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      procedure: z.string(),
      hours: z.number(),
      parcels: z.array(z.string()),
      equipments: z.array(z.string()),
    }),
  ),
  nextCursor: z.string().nullable(),
});

/** Temps de travail d'une personne : `GET /people/:id/work`. */
export const peopleWorkResponse = z.object({
  at: z.string(),
  periods: z.object({
    week: z.object({
      from: z.string(),
      to: z.string(),
      hours: z.number(),
    }),
    month: z.object({
      from: z.string(),
      to: z.string(),
      hours: z.number(),
    }),
    campaign: z.object({
      from: z.string(),
      to: z.string(),
      hours: z.number(),
      label: z.string(),
    }),
    last12: z.object({
      from: z.string(),
      to: z.string(),
      hours: z.number(),
    }),
  }),
  byMonth: z.array(
    z.object({
      month: z.string(),
      hours: z.number(),
    }),
  ),
  byActivity: z.array(
    z.object({
      activityId: z.string().nullable(),
      name: z.string(),
      hours: z.number(),
    }),
  ),
  byProcedure: z.array(
    z.object({
      procedure: z.string(),
      hours: z.number(),
    }),
  ),
});

/** Équipes types : `GET /crew-templates`. */
export const crewTemplatesResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      active: z.boolean(),
      equipmentIds: z.array(z.string()),
      personIds: z.array(z.string()),
      updatedAt: z.string(),
    }),
  ),
});
