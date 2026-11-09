import type { Intervention, InterventionCrew, InterventionDisplayStatus, InterventionInput, InterventionOutput, StockMovement } from "@fourmy/contracts";
import { DomainError } from "./time.js";

/**
 * Modification et correction tracée d'une intervention (exigences
 * INT-UI-3). Fonctions pures : la couche service lit, appelle, écrit.
 */

/** Champs d'une intervention que l'on peut modifier (et donc comparer). */
export const EDITABLE_FIELDS = [
  "procedure",
  "staffing",
  "crews",
  "periods",
  "targets",
  "inputs",
  "outputs",
  "tools",
  "doers",
  "purposes",
  "notes",
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
/** Attelage lu (id, rang) ou saisi : seuls libellé, matériels, intervenants et périodes se comparent. */
type EditableCrew = Pick<InterventionCrew, "tools" | "periods"> & { label?: string | null; doers?: InterventionCrew["doers"] };

/** Version lue (intrants avec leur unité) ou saisie (sans) : les deux se comparent. */
export type EditableIntervention = Omit<Pick<Intervention, EditableField>, "inputs" | "outputs" | "staffing" | "crews"> & {
  inputs: InterventionInput[];
  outputs: InterventionOutput[];
  /** Absent : mode libre (clients antérieurs aux attelages). */
  staffing?: Intervention["staffing"];
  crews?: readonly EditableCrew[];
};

const isoPeriods = (value: unknown) =>
  ((value as { startedAt: string; stoppedAt: string }[]) ?? [])
    .map((p) => ({ startedAt: new Date(p.startedAt).toISOString(), stoppedAt: new Date(p.stoppedAt).toISOString() }))
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
const byKey = (key: string) => (a: unknown, b: unknown) =>
  String((a as Record<string, unknown>)[key]).localeCompare(String((b as Record<string, unknown>)[key]));

export type InterventionChanges = Partial<Record<EditableField, { before: unknown; after: unknown }>>;

/** Forme comparable : dates normalisées, unités d'affichage retirées, champs vides égaux à absents. */
function canonical(field: EditableField, value: unknown): unknown {
  if (field === "notes") return (value as string | null | undefined)?.trim() || null;
  if (field === "staffing") return value ?? "free";
  if (field === "periods") return isoPeriods(value);
  if (field === "crews") {
    // Ordre des attelages conservé (rang) ; dans chacun, ordre sans importance.
    return ((value as EditableCrew[]) ?? []).map((c) => ({
      label: c.label?.trim() || null,
      tools: c.tools.map(sortKeys).sort(byKey("equipmentId")),
      doers: (c.doers ?? []).map(sortKeys).sort(byKey("personId")),
      periods: isoPeriods(c.periods),
    }));
  }
  if (field === "tools") return ((value as unknown[]) ?? []).map(sortKeys).sort(byKey("equipmentId"));
  if (field === "doers") return ((value as unknown[]) ?? []).map(sortKeys).sort(byKey("personId"));
  if (field === "inputs" || field === "outputs") {
    // `unit` est ajouté à la lecture (unité de l'article), jamais saisi.
    return ((value as Record<string, unknown>[]) ?? []).map(({ unit: _unit, ...rest }) => sortKeys(rest));
  }
  if (Array.isArray(value)) return value.map(sortKeys);
  return value ?? null;
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  }
  return v;
}

/**
 * Différences entre la version enregistrée et la version saisie, champ par
 * champ (valeurs avant / après, pour l'historique). Rien ne change → erreur.
 */
export function diffIntervention(before: EditableIntervention, after: EditableIntervention): InterventionChanges {
  const changes: InterventionChanges = {};
  // En attelages des deux côtés, matériels, intervenants et périodes de premier
  // niveau sont déduits des attelages : seul le détail des attelages compte.
  const derived = new Set<EditableField>(before.staffing === "crews" && after.staffing === "crews" ? ["tools", "doers", "periods"] : []);
  for (const field of EDITABLE_FIELDS) {
    if (derived.has(field)) continue;
    const b = canonical(field, before[field]);
    const a = canonical(field, after[field]);
    if (JSON.stringify(b) !== JSON.stringify(a)) changes[field] = { before: b, after: a };
  }
  if (Object.keys(changes).length === 0) throw new DomainError("La modification ne change rien.");
  return changes;
}

/**
 * Mouvements encore en vigueur d'une intervention : solde net par lot, lieu,
 * cuve, unité et date. Une intervention déjà corrigée a ses mouvements
 * d'origine, leurs contre-passations et les nouveaux mouvements ; seul le
 * solde doit être contre-passé, sinon le stock serait corrigé deux fois.
 */
export function effectiveMovements(movements: StockMovement[]): StockMovement[] {
  const net = new Map<string, StockMovement>();
  for (const m of movements) {
    const key = [m.lotId, m.placeId ?? "", m.containerId ?? "", m.unit, new Date(m.occurredAt).toISOString()].join("|");
    const seen = net.get(key);
    if (seen) seen.quantity += m.quantity;
    else net.set(key, { ...m, cause: "intervention" });
  }
  // Arrondi au millionième : les sommes de flottants laissent des résidus.
  return [...net.values()]
    .map((m) => ({ ...m, quantity: Math.round(m.quantity * 1e6) / 1e6 }))
    .filter((m) => m.quantity !== 0);
}

/** Une intervention annulée ne se modifie plus. */
export function assertEditable(status: Intervention["status"]): void {
  if (status === "cancelled") throw new DomainError("Intervention annulée : elle ne se modifie plus.");
}

/**
 * Statut affiché : « en cours » = planifiée dont la première période (ou la
 * date prévue) a commencé. Pas de statut supplémentaire en base.
 */
export function displayStatus(i: Pick<Intervention, "status" | "startedAt">, now: string): InterventionDisplayStatus {
  if (i.status === "planned" && i.startedAt && new Date(i.startedAt).getTime() <= new Date(now).getTime()) {
    return "in_progress";
  }
  return i.status;
}
