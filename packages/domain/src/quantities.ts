import { DomainError } from "./time.js";

/**
 * Quantité à mouvementer en stock à partir d'un paramètre saisi.
 * - quantité absolue fournie → elle prime ;
 * - dose par hectare (`<unité>_per_hectare`) → dose × surface traitée ;
 * - sinon, la quantité saisie, si son unité est celle de l'article.
 * Toute incohérence d'unité est refusée plutôt que devinée.
 */
export function toStockQuantity(input: {
  quantity: number | null;
  unit: string | null;
  articleUnit: string;
  areaHa: number | null;
  absolute?: number;
}): number {
  if (input.absolute !== undefined) return input.absolute;
  if (input.quantity === null || input.unit === null) {
    throw new DomainError("Quantité ou unité manquante pour le mouvement de stock.");
  }
  const rate = /^(.+)_per_hectare$/.exec(input.unit);
  if (rate) {
    if (rate[1] !== input.articleUnit) {
      throw new DomainError(`Dose en ${input.unit} incompatible avec l'unité de l'article (${input.articleUnit}).`);
    }
    if (input.areaHa === null || input.areaHa <= 0) {
      throw new DomainError("Dose par hectare sans surface traitée : préciser une zone de travail ou une parcelle cible.");
    }
    return input.quantity * input.areaHa;
  }
  if (input.unit !== input.articleUnit) {
    throw new DomainError(`Unité ${input.unit} différente de celle de l'article (${input.articleUnit}) : fournir stock.quantity.`);
  }
  return input.quantity;
}

/** Choix du lot consommé : le lot qui a le plus de stock disponible à la date. */
export function pickLot(candidates: { lotId: string; available: number }[]): string | null {
  const withStock = candidates.filter((c) => c.available > 0).sort((a, b) => b.available - a.available);
  return withStock[0]?.lotId ?? null;
}
