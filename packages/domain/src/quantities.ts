import { DomainError } from "./time.js";
import { convertQuantity } from "./fertilization/units.js";
import { convertSeedQuantity, seedConversionGap, seedRate, type SeedConversionCtx } from "./seeds/units.js";

/**
 * Quantité à mouvementer en stock à partir d'un paramètre saisi.
 * - quantité absolue fournie → elle prime ;
 * - dose par hectare (`<unité>_per_hectare`) → dose × surface traitée ;
 * - sinon, la quantité saisie.
 * Une unité de saisie autre que celle de l'article (kg d'un engrais stocké en
 * tonnes, litres d'un produit stocké en tonnes avec sa densité) est convertie ;
 * une unité non convertible est refusée plutôt que devinée.
 * Semence (`seed` fourni) : grains, doses et masse se convertissent par le PMG
 * et le nombre de grains par dose ; dose en grains/m² (`_per_square_meter`).
 */
export function toStockQuantity(input: {
  quantity: number | null;
  unit: string | null;
  articleUnit: string;
  areaHa: number | null;
  absolute?: number;
  /** Densité du produit (kg/L), pour passer d'une masse à un volume. */
  density?: number | null;
  /** Semence : PMG retenu et grains par dose (claudedocs/conception_semences.md §3.3). */
  seed?: SeedConversionCtx;
}): number {
  if (input.absolute !== undefined) return input.absolute;
  if (input.quantity === null || input.unit === null) {
    throw new DomainError("Quantité ou unité manquante pour le mouvement de stock.");
  }
  if (input.seed) return seedStockQuantity(input.quantity, input.unit, input.articleUnit, input.areaHa, input.seed);
  const rate = /^(.+)_per_hectare$/.exec(input.unit);
  const unit = rate ? rate[1]! : input.unit;
  const quantity = convertQuantity(input.quantity, unit, input.articleUnit, input.density);
  if (quantity === null) {
    throw new DomainError(
      rate
        ? `Dose en ${input.unit} incompatible avec l'unité de l'article (${input.articleUnit}).`
        : `Unité ${input.unit} différente de celle de l'article (${input.articleUnit}) : fournir stock.quantity.`,
    );
  }
  if (rate) {
    if (input.areaHa === null || input.areaHa <= 0) {
      throw new DomainError("Dose par hectare sans surface traitée : préciser une zone de travail ou une parcelle cible.");
    }
    return quantity * input.areaHa;
  }
  return quantity;
}

const SEED_GAP_MESSAGES = {
  unit_unknown: (from: string, to: string) => `Unité ${from} non convertible en ${to} pour cette semence.`,
  grains_per_dose_missing: () => "Nombre de grains par dose inconnu : compléter la fiche de la semence.",
  tgw_missing: () => "PMG inconnu : compléter la fiche de la semence pour passer des grains à la masse.",
  dimension: () => "Les plants se comptent à la pièce : ils ne se convertissent ni en kg ni en grains.",
};

function seedStockQuantity(quantity: number, unit: string, articleUnit: string, areaHa: number | null, ctx: SeedConversionCtx): number {
  const { unit: base, perM2 } = seedRate(unit);
  const gap = seedConversionGap(base, articleUnit, ctx);
  if (gap) throw new DomainError(SEED_GAP_MESSAGES[gap](base, articleUnit));
  const converted = convertSeedQuantity(quantity, base, articleUnit, ctx)!;
  if (perM2 === null) return converted;
  if (areaHa === null || areaHa <= 0) {
    throw new DomainError("Dose par surface sans surface traitée : préciser une zone de travail ou une parcelle cible.");
  }
  return converted * areaHa * 10_000 * perM2;
}

/** Choix du lot consommé : le lot qui a le plus de stock disponible à la date. */
export function pickLot(candidates: { lotId: string; available: number }[]): string | null {
  const withStock = candidates.filter((c) => c.available > 0).sort((a, b) => b.available - a.available);
  return withStock[0]?.lotId ?? null;
}
