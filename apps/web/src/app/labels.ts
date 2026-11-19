import { unitLabel } from "@fourmy/contracts";

/** Libellés français des codes métier (procédures Ekylibre, natures, unités). */

import { PROCEDURE_LABELS } from "@fourmy/contracts";

/** Libellé officiel Ekylibre ; à défaut, le code rendu lisible. */
export function procedureLabel(code: string): string {
  return PROCEDURE_LABELS[code] ?? code.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Toutes les procédures, triées par libellé (sélecteur avec recherche). */
export const PROCEDURE_OPTIONS = Object.entries(PROCEDURE_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label, "fr"));

export const NATURE_LABELS: Record<string, string> = {
  field_crop: "Grandes cultures",
  vine: "Vigne",
  grassland: "Prairie",
};

/** Couleurs des natures de production (carte) — palette Lyvre. */
export const NATURE_COLORS: Record<string, string> = {
  field_crop: "#D9A441", // paille
  vine: "#7A3B5C", // lie-de-vin (seule exception, lisible sur l'ortho)
  grassland: "#6FB08E", // lichen clair
  none: "#8A948E",
};

export const ARTICLE_KIND_LABELS: Record<string, string> = {
  phyto: "Phytosanitaire",
  fertilizer: "Fertilisant",
  seed: "Semence",
  harvest: "Récolte",
  wine: "Vin",
  part: "Pièce",
  fluid: "Fluide",
  other: "Autre",
};

// Libellés d'unités : partagés avec l'API (itinéraires techniques), dans les contrats.
export { unitLabel };

/** Unités proposées à la saisie d'un intrant, selon l'unité de l'article. */
export function doseUnits(articleUnit: string): { value: string; label: string }[] {
  return [
    { value: `${articleUnit}_per_hectare`, label: `${unitLabel(articleUnit)}/ha (dose)` },
    { value: articleUnit, label: `${unitLabel(articleUnit)} (quantité totale)` },
  ];
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export function formatNumber(n: number, digits = 2): string {
  return n.toLocaleString("fr-FR", { maximumFractionDigits: digits });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

/** Période de travail : « 10/06/2026 08:00 → 10:00 », ou sur deux jours. */
export function formatPeriod(startedAt: string, stoppedAt: string): string {
  const sameDay = new Date(startedAt).toDateString() === new Date(stoppedAt).toDateString();
  const end = sameDay
    ? new Date(stoppedAt).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })
    : formatDateTime(stoppedAt);
  return `${formatDateTime(startedAt)} → ${end}`;
}

/**
 * Période connue au jour près (intervention importée d'un autre logiciel) :
 * « le 01/04/2026 », ou « du 01/04/2026 au 02/04/2026 ». La fin est le
 * minuit qui suit le dernier jour.
 */
export function formatDays(startedAt: string, stoppedAt: string): string {
  const last = new Date(new Date(stoppedAt).getTime() - 1);
  const first = formatDate(startedAt);
  const end = formatDate(last.toISOString());
  return first === end ? `le ${first}` : `du ${first} au ${end}`;
}

/** Volume lisible : mégaoctets entiers, gigaoctets à une décimale. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Go`;
  return `${Math.max(1, Math.round(bytes / 1e6)).toLocaleString("fr-FR")} Mo`;
}
