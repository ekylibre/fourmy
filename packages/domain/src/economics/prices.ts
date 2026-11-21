import { priceKey, type Price } from "@fourmy/contracts";
import { convertQuantity } from "../fertilization/units.js";
import { convertSeedQuantity, type SeedConversionCtx } from "../seeds/units.js";

/**
 * Prix de la ferme (temps 3, lot E1, claudedocs/conception_assolement_eco.md §3.1) :
 * prix en vigueur à une date, conversion d'un prix dans une autre unité.
 */

/** Prix en vigueur à `day` (AAAA-MM-JJ) : dernière date d'effet, puis dernière saisie. */
export function priceAt(prices: readonly Price[], key: string, day: string): Price | null {
  let best: Price | null = null;
  for (const p of prices) {
    if (priceKey(p) !== key || p.validFrom > day) continue;
    if (!best || p.validFrom > best.validFrom || (p.validFrom === best.validFrom && p.createdAt > best.createdAt)) best = p;
  }
  return best;
}

/** Prix en vigueur de chaque clé à `day`. */
export function currentPrices(prices: readonly Price[], day: string): Map<string, Price> {
  const out = new Map<string, Price>();
  for (const key of new Set(prices.map(priceKey))) {
    const p = priceAt(prices, key, day);
    if (p) out.set(key, p);
  }
  return out;
}

/**
 * Montant d'un prix exprimé par `toUnit` : 580 €/t → 58 €/q ; €/L → €/kg par la
 * densité ; semences (kg, doses, grains) par le PMG et les grains par dose.
 * Null si les unités ne se convertissent pas.
 */
export function convertPrice(amount: number, fromUnit: string, toUnit: string, ctx: { density?: number | null; seed?: SeedConversionCtx } = {}): number | null {
  if (fromUnit === toUnit) return amount;
  // Combien de `fromUnit` dans une `toUnit` : le prix d'une `toUnit`.
  const perTo = ctx.seed ? convertSeedQuantity(1, toUnit, fromUnit, ctx.seed) : convertQuantity(1, toUnit, fromUnit, ctx.density);
  return perTo === null ? null : amount * perTo;
}
