import { unitLabel } from "@fourmy/contracts";

/**
 * Mise en forme des réponses des outils MCP (API-17) : texte en français,
 * unités explicites, listes de 50 éléments au plus avec un curseur.
 */

export const PAGE_SIZE = 50;

const nf = (digits: number) => new Intl.NumberFormat("fr-FR", { maximumFractionDigits: digits });

/** Nombre à la française (« 2,38 »). */
export const num = (v: number | null | undefined, digits = 2) => (v === null || v === undefined || Number.isNaN(v) ? null : nf(digits).format(v));

/** Surface en hectares, arrondie au centième. */
export const ha = (m2: number | null | undefined) => (m2 === null || m2 === undefined ? null : Math.round(m2 / 100) / 100);
export const haText = (m2: number | null | undefined) => (m2 === null || m2 === undefined ? "?" : `${num(m2 / 10_000)} ha`);

/** Date du jour en France (« 25/02/2026 »). */
export const day = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleDateString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric" }) : null;
/** Date et heure en France (« 25/02/2026 07:30 »). */
export const dayTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString("fr-FR", { timeZone: "Europe/Paris", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : null;
/** Jour ISO (AAAA-MM-JJ) en France. */
export const isoDay = (d: Date) => d.toLocaleDateString("sv-SE", { timeZone: "Europe/Paris" });

/** Quantité avec son unité (« 150 kg/ha », « 3,2 L »). */
export function quantity(q: number | null | undefined, unit: string | null | undefined, per?: string | null) {
  if (q === null || q === undefined) return null;
  const u = unitLabel(unit);
  return `${num(q, 3)}${u ? ` ${u}` : ""}${per === "hectare" && !u.endsWith("/ha") ? "/ha" : ""}`;
}

/** Comparaison sans casse ni accents. */
export const fold = (s: string | null | undefined) =>
  (s ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
export const matches = (needle: string | undefined, ...hay: (string | null | undefined)[]) => !needle || hay.some((h) => fold(h).includes(fold(needle)));

/** Page d'une liste : 50 éléments à partir du curseur (un décalage). */
export function page<T>(items: T[], cursor: string | undefined) {
  const start = Math.max(0, Number.parseInt(cursor ?? "0", 10) || 0);
  const slice = items.slice(start, start + PAGE_SIZE);
  const next = start + PAGE_SIZE < items.length ? String(start + PAGE_SIZE) : null;
  return { items: slice, total: items.length, nextCursor: next, start };
}

/** Mention de pagination à ajouter au résumé. */
export const pageNote = (p: { total: number; start: number; items: unknown[]; nextCursor: string | null }) =>
  p.total > p.items.length
    ? ` Éléments ${p.start + 1} à ${p.start + p.items.length} sur ${p.total}${p.nextCursor ? ` ; suite avec curseur="${p.nextCursor}"` : ""}.`
    : "";

/** Pluriel simple : « 3 parcelles », « 1 parcelle ». */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n > 1 ? many : one}`;
