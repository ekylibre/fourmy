import { PRICE_SCOPE_LABELS, type ForecastValue, type Price, type PriceSuggestion, type YieldReference } from "@fourmy/contracts";
import { median } from "../itk/derive.js";

/**
 * Rendement et prix de vente par défaut d'une culture (temps 3, lot E3,
 * claudedocs/conception_assolement_eco.md §3.2). Chaque valeur garde sa
 * provenance, affichée à côté ; une saisie dans l'assolement l'emporte.
 */

/** Médiane, null si la liste est vide. */
const medianOrNull = (values: readonly number[]): number | null => (values.length ? median(values) : null);

const round1 = (n: number) => Math.round(n * 10) / 10;
const span = (years: number[]) => (years.length === 1 ? `${years[0]}` : `${Math.min(...years)}-${Math.max(...years)}`);

/**
 * Rendement (q/ha) : médiane des rendements de la ferme sur les trois
 * campagnes avant `campaign` ; sinon médiane des trois dernières campagnes
 * Agreste du département ; sinon null.
 */
export function defaultYield(farm: readonly { campaign: number; value: number }[], agreste: readonly YieldReference[], campaign: number, department?: string | null): ForecastValue | null {
  const own = farm.filter((y) => y.campaign < campaign && y.campaign >= campaign - 3 && y.value > 0);
  const m = medianOrNull(own.map((y) => y.value));
  if (m !== null) {
    const years = own.map((y) => y.campaign);
    return { value: round1(m), unit: "quintal_per_hectare", source: "farm", label: `médiane ${span(years)} de la ferme (${own.length} campagne${own.length > 1 ? "s" : ""})` };
  }
  const ref = [...agreste].filter((y) => y.campaign < campaign && y.value > 0).sort((a, b) => b.campaign - a.campaign).slice(0, 3);
  const a = medianOrNull(ref.map((y) => y.value));
  if (a === null) return null;
  return { value: round1(a), unit: ref[0]!.unit, source: "agreste", label: `médiane Agreste${department ? ` ${department}` : ""} ${span(ref.map((y) => y.campaign))}` };
}

/** Ordre des repères pour le prix par défaut : places de marché (agrifood, puis Lexicon), MATIF, prix producteur. */
const SCOPE_ORDER: PriceSuggestion["scope"][] = ["market", "matif", "department", "national"];

const month = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("fr-FR", { timeZone: "UTC", month: "short", year: "numeric" });

/** Prix de vente : celui de la ferme ; sinon le repère le plus proche du marché (agrifood avant Lexicon) ; sinon null. */
export function defaultPrice(farmPrice: Price | null, suggestions: readonly PriceSuggestion[]): ForecastValue | null {
  if (farmPrice) return { value: farmPrice.amount, unit: farmPrice.unit, source: "farm", label: "prix de la ferme", date: farmPrice.validFrom };
  const best = [...suggestions].sort(
    (a, b) =>
      SCOPE_ORDER.indexOf(a.scope) - SCOPE_ORDER.indexOf(b.scope) ||
      Number(b.source === "agrifood") - Number(a.source === "agrifood") ||
      b.date.localeCompare(a.date),
  )[0];
  if (!best) return null;
  const what = best.scope === "market" ? best.label : PRICE_SCOPE_LABELS[best.scope];
  return { value: best.amount, unit: best.unit, source: best.source === "agrifood" ? "agrifood" : "lexicon", label: `${what}, ${month(best.date)}`, date: best.date };
}
