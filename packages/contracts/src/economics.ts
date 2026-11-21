import { z } from "zod";
import { uuid } from "./primitives.js";

/**
 * Module économique de l'assolement (temps 3, claudedocs/conception_assolement_eco.md).
 * Lot E1 : prix de la ferme, datés et sourcés (principe E1).
 */

export const priceKind = z.enum(["article", "labour", "equipment", "service", "product"]);
export type PriceKind = z.infer<typeof priceKind>;
export const priceSource = z.enum(["farm", "lexicon", "bcma", "agrifood", "purchase"]);
export type PriceSource = z.infer<typeof priceSource>;

export const PRICE_KIND_LABELS: Record<PriceKind, string> = {
  article: "Intrants",
  equipment: "Matériels",
  labour: "Main-d'œuvre",
  service: "Services",
  product: "Produits",
};
export const PRICE_SOURCE_LABELS: Record<PriceSource, string> = {
  farm: "saisi",
  lexicon: "Lexicon",
  bcma: "barème BCMA",
  agrifood: "Commission européenne (agrifood)",
  purchase: "achat",
};

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date au format AAAA-MM-JJ");

/** Unités d'un montant : celles du stock (codes ou libellés repris) et l'heure, l'hectare. */
export const PRICE_UNITS = ["kilogram", "ton", "quintal", "liter", "hectoliter", "cubic_meter", "unity", "dose", "thousand", "hour", "hectare"] as const;

/** Ajout d'un prix (une ligne datée). */
export const priceWrite = z
  .object({
    id: uuid.optional(),
    kind: priceKind,
    articleId: uuid.nullable().default(null),
    equipmentId: uuid.nullable().default(null),
    activityId: uuid.nullable().default(null),
    product: z.string().trim().min(1).max(60).nullable().default(null),
    procedure: z.string().max(80).nullable().default(null),
    unit: z.string().trim().min(1, "Unité obligatoire.").max(40),
    amount: z.number().min(0, "Montant positif.").max(99_999_999),
    validFrom: isoDate,
    source: priceSource.default("farm"),
    sourceRef: z.string().max(200).nullable().default(null),
    sourceDate: isoDate.nullable().default(null),
    note: z.string().trim().max(500).nullable().default(null),
  })
  .superRefine((p, ctx) => {
    const need = (ok: boolean, path: string, message: string) => !ok && ctx.addIssue({ code: "custom", path: [path], message });
    need((p.kind === "article") === !!p.articleId, "articleId", "Un prix d'intrant désigne un article, et lui seul.");
    need((p.kind === "equipment") === !!p.equipmentId, "equipmentId", "Un prix de matériel désigne un matériel, et lui seul.");
    need((p.kind === "product") === !!(p.activityId && p.product), "product", "Un prix de produit désigne une activité et un produit.");
    need((p.kind === "service") === !!p.procedure, "procedure", "Un prix de prestation désigne une procédure.");
  });
export type PriceWrite = z.input<typeof priceWrite>;

export const pricesWrite = z.object({ items: z.array(priceWrite).min(1).max(2000) });
export type PricesWrite = z.input<typeof pricesWrite>;

export interface Price {
  id: string;
  kind: PriceKind;
  articleId: string | null;
  equipmentId: string | null;
  activityId: string | null;
  product: string | null;
  procedure: string | null;
  unit: string;
  amount: number;
  validFrom: string;
  source: PriceSource;
  sourceRef: string | null;
  sourceDate: string | null;
  note: string | null;
  createdAt: string;
}

/** Clé d'un prix : ce dont il est le prix. */
export const priceKey = (p: Pick<Price, "kind" | "articleId" | "equipmentId" | "activityId" | "product" | "procedure">) =>
  [p.kind, p.articleId ?? "", p.equipmentId ?? "", p.activityId ?? "", p.product ?? "", p.procedure ?? ""].join("|");

/**
 * Prix proposé (lot E2) : repère tiré d'une référence, à reprendre ou non.
 * `scope` : département de la ferme, France, ou marché (place de cotation).
 */
export interface PriceSuggestion {
  source: PriceSource;
  scope: "department" | "national" | "matif" | "market";
  label: string;
  amount: number;
  unit: string;
  /** Date du prix dans la source. */
  date: string;
  /** Identifiant de la ligne dans la source (repris dans `sourceRef`). */
  ref: string;
}

export interface YieldReference {
  campaign: number;
  value: number;
  unit: string;
}

/** Repères Lexicon d'une activité végétale : prix de vente proposés, rendements Agreste du département. */
export interface ProductSuggestions {
  department: string | null;
  items: {
    activityId: string;
    production: string | null;
    specie: string | null;
    suggestions: PriceSuggestion[];
    yields: YieldReference[];
  }[];
}

export const PRICE_SCOPE_LABELS: Record<PriceSuggestion["scope"], string> = {
  department: "prix producteur du département",
  national: "prix producteur France",
  matif: "MATIF",
  market: "marché européen",
};

/** Origine d'une valeur prévue (rendement, prix) : saisie dans l'assolement ou défaut calculé. */
export type ForecastSource = "plan" | "farm" | "agreste" | "agrifood" | "lexicon";

export const FORECAST_SOURCE_LABELS: Record<ForecastSource, string> = {
  plan: "saisi dans l'assolement",
  farm: "ferme",
  agreste: "Agreste",
  agrifood: "Commission européenne (agrifood)",
  lexicon: "Lexicon",
};

/** Valeur prévue et sa provenance, affichée à côté (« 112 q/ha, médiane 2024-2026 de la ferme »). */
export interface ForecastValue {
  value: number;
  unit: string;
  source: ForecastSource;
  label: string;
  date?: string | null;
}

/** Contexte économique d'une campagne d'assolement (lot E3), par activité. */
export interface EcoContextActivity {
  activityId: string;
  production: string | null;
  specie: string | null;
  /** Rendements réalisés de la ferme (q/ha), par campagne. */
  farmYields: { campaign: number; value: number }[];
  agreste: YieldReference[];
  suggestions: PriceSuggestion[];
  /** Prix de vente du produit principal saisi dans le module Économique, en vigueur au début de la campagne. */
  farmPrice: Price | null;
  /** Défauts calculés (domaine `defaultYield`, `defaultPrice`). */
  yield: ForecastValue | null;
  price: ForecastValue | null;
}

export interface EcoContext {
  year: number;
  department: string | null;
  activities: EcoContextActivity[];
  /** Coût horaire de la main-d'œuvre en vigueur. */
  labour: Price | null;
}
