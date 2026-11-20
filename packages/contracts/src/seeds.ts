import { z } from "zod";

/**
 * Semences (claudedocs/conception_semences.md) : fiche d'une semence
 * (article_seeds), espèces d'un mélange, PMG d'un lot, et attributs d'un
 * intrant semence d'une intervention (conversion figée, doses d'un mélange).
 */

/** Origine du PMG : étiquette du sac, mesure à la ferme, repère de l'espèce, fichier importé. */
export const tgwOrigin = z.enum(["label", "measured", "reference", "imported"]);
export type TgwOrigin = z.infer<typeof tgwOrigin>;

export const TGW_ORIGIN_LABELS: Record<TgwOrigin, string> = {
  label: "Étiquette",
  measured: "Mesuré à la ferme",
  reference: "Repère de l'espèce, à confirmer",
  imported: "Importé d'un fichier",
};

export const seedCategory = z.enum(["certified", "farm"]);
export type SeedCategory = z.infer<typeof seedCategory>;

export const SEED_CATEGORY_LABELS: Record<SeedCategory, string> = {
  certified: "Semence certifiée",
  farm: "Semence de ferme",
};

/** PMG en grammes : de la luzerne (2 g) à la féverole (600 g) ; borne large. */
const tgwG = z.number().positive().lt(2000);
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const gnis = z.string().trim().min(1).max(20);
const name = z.string().trim().min(1).max(120);

/** Fiche d'une semence, telle qu'elle s'écrit (PUT /articles/:id/seed). */
export const seedSheetWrite = z
  .object({
    species: z.string().trim().min(1).max(120).nullable().default(null),
    varietyName: name.nullable().default(null),
    gnisCode: gnis.nullable().default(null),
    category: seedCategory.nullable().default(null),
    isMixture: z.boolean().default(false),
    grainsPerDose: z.number().int().positive().nullable().default(null),
    bagKg: z.number().positive().nullable().default(null),
    tgwG: tgwG.nullable().default(null),
    tgwOrigin: tgwOrigin.nullable().default(null),
    tgwOn: day.nullable().default(null),
  })
  .refine((s) => (s.tgwG === null) === (s.tgwOrigin === null), { message: "Le PMG et son origine vont ensemble.", path: ["tgwOrigin"] })
  .refine((s) => !s.isMixture || (s.species === null && s.tgwG === null), {
    message: "Un mélange n'a ni espèce unique ni PMG : ses espèces se listent à part.",
    path: ["isMixture"],
  });
export type SeedSheetWrite = z.infer<typeof seedSheetWrite>;
export type SeedSheet = SeedSheetWrite & { articleId: string; updatedAt: string };

/** Espèce d'un mélange (sans proportion : la dose se saisit au semis). */
export const mixtureComponentWrite = z.object({
  species: z.string().trim().min(1).max(120).nullable().default(null),
  label: name,
  varietyName: name.nullable().default(null),
  gnisCode: gnis.nullable().default(null),
});
export type MixtureComponentWrite = z.infer<typeof mixtureComponentWrite>;
export type MixtureComponent = MixtureComponentWrite & { id: string; position: number };

export const mixtureComponentsWrite = z
  .array(mixtureComponentWrite)
  .max(20)
  .refine((l) => new Set(l.map((c) => c.label.toLowerCase())).size === l.length, { message: "Une espèce est en double dans le mélange." });

/** PMG d'un lot de semence (lots.attrs.seed) : l'emporte sur celui de l'article. */
export const lotSeedWrite = z.object({ tgwG, origin: tgwOrigin, on: day.nullable().default(null) });
export type LotSeed = z.infer<typeof lotSeedWrite>;

/**
 * Conversion figée sur l'intrant d'une intervention : le PMG et le nombre de
 * grains par dose qui ont servi. Une correction ultérieure du PMG ne change
 * pas les stocks passés.
 */
export const seedConversion = z.object({
  tgwG: tgwG.nullable(),
  tgwOrigin: tgwOrigin.nullable(),
  grainsPerDose: z.number().int().positive().nullable(),
  /** PMG tiré du repère de l'espèce : quantités estimées. */
  estimated: z.boolean(),
});
export type SeedConversion = z.infer<typeof seedConversion>;

/** Dose d'une espèce d'un mélange au semis, en kg/ha (S7). */
export const mixtureDose = z.object({
  componentId: z.string().uuid().nullable().default(null),
  label: name,
  species: z.string().trim().min(1).max(120).nullable().default(null),
  kgHa: z.number().positive().max(1000),
});
export type MixtureDose = z.infer<typeof mixtureDose>;

/** Espèce semée d'un couvert (cover_crops.components). */
export const coverComponent = z.object({ label: name, species: z.string().nullable(), kgHa: z.number().positive().nullable() });
export type CoverComponent = z.infer<typeof coverComponent>;

/** Ce qui manque à une semence pour convertir ou contrôler (FR-SE-4). */
export const seedFlag = z.enum(["tgw_missing", "unit_unknown", "mixture_empty", "species_unknown", "tgw_far_from_reference"]);
export type SeedFlag = z.infer<typeof seedFlag>;

export const SEED_FLAG_LABELS: Record<SeedFlag, string> = {
  tgw_missing: "PMG inconnu",
  unit_unknown: "Unité non reconnue",
  mixture_empty: "Mélange sans espèces",
  species_unknown: "Espèce inconnue",
  tgw_far_from_reference: "PMG loin du repère de l'espèce",
};
