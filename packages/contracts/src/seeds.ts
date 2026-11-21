import { z } from "zod";
import type { CoverFamilyKey } from "./fertilization.js";

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
export type MixtureComponent = MixtureComponentWrite & { id: string; position: number; legume?: boolean };

export const mixtureComponentsWrite = z
  .array(mixtureComponentWrite)
  .max(20)
  .refine((l) => new Set(l.map((c) => c.label.toLowerCase())).size === l.length, { message: "Une espèce est en double dans le mélange." });

/** Espèces d'un mélange, enregistrées ensemble (PUT /articles/:id/seed/components). */
export const mixtureComponentsSave = z.object({ components: mixtureComponentsWrite });
export type MixtureComponentsSave = z.infer<typeof mixtureComponentsSave>;

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

/** Doses d'un mélange à un semis : une espèce une fois, 20 au plus. */
export const mixtureDoses = z
  .array(mixtureDose)
  .min(1)
  .max(20)
  .refine((l) => new Set(l.map((d) => d.label.toLowerCase())).size === l.length, { message: "Une espèce est en double dans les doses du mélange." });

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

// --- Page Semences (lot SE3) ---------------------------------------------------------

/** Enregistrement de la fiche : la fiche, et l'unité de stock si elle change (facteur 1 seulement). */
export const seedSheetSave = z.object({ unit: z.string().trim().min(1).max(60).optional() }).and(seedSheetWrite);
export type SeedSheetSave = z.infer<typeof seedSheetSave>;

/** Repère de PMG de l'espèce, avec sa source (Arvalis, Terres Inovia). */
export interface SeedTgwReference {
  label: string;
  typicalG: number;
  minG: number | null;
  maxG: number | null;
  typicalStated: boolean;
  org: string;
  url: string;
  note: string | null;
}

/** PMG retenu par défaut pour la semence (lot non compris). */
export interface SeedTgwResolved {
  tgwG: number;
  origin: TgwOrigin;
  from: "lot" | "article" | "reference";
  estimated: boolean;
}

export interface SeedListItem {
  articleId: string;
  name: string;
  /** Unité de stock (articles.unit). */
  unit: string;
  /** Unité reconnue : masse, grains, dose ; null sinon. */
  unitDim: "mass" | "grain" | "dose" | null;
  lexiconRef: string | null;
  organicStatus: "organic" | "conversion" | "conventional" | null;
  seedTreated: boolean | null;
  sheet: SeedSheet | null;
  /** Libellé de l'espèce (taxonomie Lexicon). */
  speciesLabel: string | null;
  /** Espèce et code GNIS lus dans un fichier importé (articles.custom), avant rattachement. */
  importedSpecies: string | null;
  importedGnis: string | null;
  componentCount: number;
  reference: SeedTgwReference | null;
  tgw: SeedTgwResolved | null;
  flags: SeedFlag[];
  looksLikeMixture: boolean;
  /** Stock à la date, dans l'unité de l'article. */
  stock: number;
  /** Interventions qui l'utilisent, par campagne (année de récolte). */
  usage: { campaign: number; interventions: number }[];
}

export interface SeedLotView {
  id: string;
  code: string;
  stock: number;
  seed: LotSeed | null;
}

export interface SeedInterventionUse {
  interventionId: string;
  startedAt: string;
  status: string;
  campaign: number | null;
  parcels: string[];
  quantity: number | null;
  unit: string | null;
  areaHa: number | null;
  /** Densité et dose équivalentes (PMG retenu ; « estimées » s'il vient du repère). */
  grainsPerM2: number | null;
  kgPerHa: number | null;
  estimated: boolean;
}

export interface SeedDetail extends SeedListItem {
  components: MixtureComponent[];
  lots: SeedLotView[];
  interventions: SeedInterventionUse[];
}

/** Espèce proposée sur la fiche : taxonomie Lexicon et catalogue des variétés. */
export interface SeedSpeciesOption {
  species: string;
  label: string;
  legume: boolean;
  hasReference: boolean;
}

// --- Catalogue GNIS et rattachement (lot SE4) ----------------------------------------

/** Variété du catalogue officiel (SEMAE, via Lexicon), avec ce que Fourmy propose pour la fiche. */
export interface SeedCatalogItem {
  gnisCode: string;
  varietyName: string;
  species: string;
  speciesLabel: string;
  registeredOn: string | null;
  legume: boolean;
  reference: SeedTgwReference | null;
  /** Unité de stock proposée : doses pour le maïs et le tournesol, kg sinon. */
  proposedUnit: string;
  proposedGrainsPerDose: number | null;
}

/** Nouvelle semence : depuis le catalogue (fiche pré-remplie) ou saisie libre. */
export const seedCreate = z.object({
  name: name,
  unit: z.string().trim().min(1).max(60),
  sheet: seedSheetWrite,
});
export type SeedCreate = z.infer<typeof seedCreate>;

/** Rattachement proposé d'une semence au référentiel (FR-SE-12, 28, 29). */
export interface SeedAttachProposal {
  articleId: string;
  name: string;
  species: string | null;
  speciesLabel: string | null;
  varietyName: string | null;
  gnisCode: string | null;
  isMixture: boolean;
  /** Pourquoi : « code GNIS 512E492 au catalogue », « espèce importée « Blé tendre » »… */
  reason: string;
  /** Sûr : code GNIS trouvé au catalogue. Sinon, à confirmer. */
  sure: boolean;
  /** Approché : libellé proche, ou fichier et catalogue en désaccord. Jamais appliqué sans confirmation. */
  approximate: boolean;
}

/** Rattacher : les semences choisies parmi les propositions. */
export const seedAttachWrite = z.object({ articleIds: z.array(z.string().uuid()).min(1).max(500) });
export type SeedAttachWrite = z.infer<typeof seedAttachWrite>;

// --- Mélanges et couverts (lot SE6) --------------------------------------------------

/** Espèces d'un mélange et doses du dernier semis, proposées à la saisie (FR-SE-13b). */
export interface SeedMixture {
  articleId: string;
  components: MixtureComponent[];
  last: { interventionId: string; startedAt: string; doses: MixtureDose[] } | null;
}

/** Semis réalisé sur une parcelle, que le couvert peut reprendre (FR-SE-16). */
export interface CoverSowingProposal {
  interventionId: string;
  startedAt: string;
  /** Semences semées : leurs espèces et leur dose. */
  components: CoverComponent[];
  /** Famille du couvert déduite des espèces ; null si elle ne se déduit pas. */
  family: CoverFamilyKey | null;
  legumes: number;
}

// --- Utilisation par campagne (lot SE7) ---------------------------------------------

/** Moyenne pondérée par la surface, et écart entre parcelles (minimum, maximum). */
export interface SeedDensityRange {
  mean: number;
  min: number;
  max: number;
}

/** Utilisation réalisée ou prévue d'une semence (ou d'une espèce) sur une campagne (FR-SE-24). */
export interface SeedUsageFigures {
  interventions: number;
  areaHa: number;
  /** Quantité dans l'unité du stock (regroupement par semence seulement) ; null si rien n'est convertible. */
  stockQuantity: number | null;
  kg: number | null;
  grains: number | null;
  kgPerHa: SeedDensityRange | null;
  grainsPerM2: SeedDensityRange | null;
  /** Une valeur passe par un PMG repère. */
  estimated: boolean;
  /** Intrants dont la dose ne se convertit pas (PMG inconnu, unité illisible) : comptés, sans bloquer. */
  unconvertible: number;
}

export const seedUsageBy = z.enum(["article", "species"]);
export type SeedUsageBy = z.infer<typeof seedUsageBy>;

export interface SeedUsageGroup {
  /** Identifiant de la semence, ou taxon de l'espèce (`sans-espece` à défaut). */
  key: string;
  label: string;
  species: string | null;
  speciesLabel: string | null;
  /** Unité du stock (par semence). */
  unit: string | null;
  /** Semences regroupées (par espèce : les variétés comparées, FR-SE-25). */
  articles: { articleId: string; name: string }[];
  activities: string[];
  done: SeedUsageFigures;
  planned: SeedUsageFigures;
}

export interface SeedUsage {
  campaign: number;
  by: SeedUsageBy;
  groups: SeedUsageGroup[];
}
