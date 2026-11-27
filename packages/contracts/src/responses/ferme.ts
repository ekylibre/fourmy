import { z } from "zod";
import { geoJsonGeometry } from "../primitives.js";

/**
 * Réponses des routes ouvertes, module Ferme (lot AM7, OpenAPI).
 * Tirées des types des routes (`apps/api`), puis tenues à jour par le test
 * de conformité : chaque réponse réelle doit passer par son schéma.
 */

/** Identité et réglages publics de la ferme : `GET /farm`. */
export const farmResponse = z.object({
  identity: z.object({
    name: z.string(),
    legalName: z.string().nullable(),
    legalForm: z
      .enum(["ei", "earl", "gaec", "scea", "sarl", "sas", "other"])
      .nullable(),
    siret: z.string().nullable(),
    vatNumber: z.string().nullable(),
    nafCode: z.string().nullable(),
    pacage: z.string().nullable(),
    cvi: z.string().nullable(),
    ede: z.string().nullable(),
    phone: z.string().nullable(),
    email: z.string().nullable(),
    legalRep: z
      .union([
        z.object({
          personId: z.string(),
        }),
        z.object({
          name: z.string(),
        }),
      ])
      .nullable(),
  }),
  certifications: z.array(
    z.object({
      kind: z.enum(["phyto_approval", "organic", "hve"]),
      body: z.string().nullable(),
      number: z.string().nullable(),
      level: z.enum(["2", "1", "3"]).nullable(),
      expiresOn: z.string().nullable(),
      id: z.string(),
    }),
  ),
  sites: z.array(
    z.object({
      name: z.string(),
      address: z.object({
        line1: z.string().nullable(),
        line2: z.string().nullable(),
        postalCode: z.string().nullable(),
        city: z.string().nullable(),
        inseeCode: z.string().nullable(),
      }),
      location: z
        .object({
          lat: z.number(),
          lon: z.number(),
        })
        .nullable(),
      locationSource: z.enum(["geocoded", "manual"]).nullable(),
      geocode: z
        .object({
          score: z.number(),
          type: z.enum(["housenumber", "street", "locality", "municipality"]),
        })
        .nullable(),
      radiusM: z.number(),
      id: z.string(),
      isHeadquarters: z.boolean(),
    }),
  ),
  parcelsOutside: z.number().nullable(),
  display: z.object({
    basemap: z.enum(["plan", "ortho"]),
    areaUnit: z.enum(["ha", "a"]),
  }),
  logoAssetId: z.string().nullable(),
  canEdit: z.boolean(),
});

/** Bâtiments et lieux : `GET /places`. */
export const placesResponse = z.object({
  items: z.array(
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
  nextCursor: z.null(),
});
