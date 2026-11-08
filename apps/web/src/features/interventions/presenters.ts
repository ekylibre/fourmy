import type { InterventionDisplayStatus, InterventionHistoryEntry, InterventionInput } from "@fourmy/contracts";
import { TREATMENT_PURPOSE_LABELS } from "@fourmy/contracts";
import { formatNumber, formatPeriod, procedureLabel, unitLabel } from "../../app/labels";

/** Date de référence d'une intervention : fin de la dernière période, sinon début prévu. */
export const interventionDay = (i: { stoppedAt: string | null; startedAt: string | null; createdAt: string }) => i.stoppedAt ?? i.startedAt ?? i.createdAt;

/** Statuts affichés, « en cours » compris (calculé, voir displayStatus). */
export const STATUS: Record<InterventionDisplayStatus, { label: string; color: string }> = {
  planned: { label: "Planifiée", color: "paille" },
  in_progress: { label: "En cours", color: "ardoise" },
  done: { label: "Réalisée", color: "lichen" },
  cancelled: { label: "Annulée", color: "gray" },
};

/** Résolution des identifiants en noms (parcelles de toutes dates, matériels, articles, personnes). */
export interface Names {
  parcel: Map<string, string>;
  equipment: Map<string, string>;
  article: Map<string, { name: string; unit: string; amm?: string | null }>;
  person: Map<string, string>;
}

export function targetName(names: Names, t: { kind: string; id: string }): string {
  if (t.kind === "land_parcel") return names.parcel.get(t.id) ?? "parcelle inconnue";
  if (t.kind === "equipment") return names.equipment.get(t.id) ?? "matériel";
  return "lieu";
}

export function quantityText(names: Names, q: { articleId: string; quantity: number; per: string; unit?: string }): string {
  const a = names.article.get(q.articleId);
  const unit = unitLabel(q.unit ?? a?.unit);
  return `${a?.name ?? "?"} ${formatNumber(q.quantity, 3)} ${unit}${q.per === "hectare" ? "/ha" : ""}`;
}

export const short = (list: string[]) => (list.length > 3 ? `${list.slice(0, 3).join(", ")} +${list.length - 3}` : list.join(", "));

const ACTIONS: Record<string, string> = {
  planned: "Planifiée",
  completed: "Réalisée",
  updated: "Modifiée",
  corrected: "Corrigée",
  cancelled: "Annulée",
};
export const actionLabel = (a: string) => ACTIONS[a] ?? a;

const FIELDS: Record<string, string> = {
  procedure: "Intervention",
  periods: "Périodes",
  targets: "Cibles",
  inputs: "Intrants",
  outputs: "Sorties",
  tools: "Matériels",
  doers: "Intervenants",
  purposes: "Motifs",
  notes: "Notes",
};

/** Une valeur d'historique (forme canonique du domaine) en texte lisible. */
function valueText(names: Names, field: string, value: unknown): string {
  if (value === null || value === undefined) return "—";
  const list = Array.isArray(value) ? (value as Record<string, unknown>[]) : [];
  switch (field) {
    case "procedure":
      return procedureLabel(String(value));
    case "periods":
      return list.map((p) => formatPeriod(String(p.startedAt), String(p.stoppedAt))).join(" ; ") || "—";
    case "targets":
      return list.map((t) => targetName(names, t as { kind: string; id: string })).join(", ") || "—";
    case "inputs":
    case "outputs":
      return list.map((q) => quantityText(names, q as unknown as InterventionInput)).join(" · ") || "—";
    case "tools":
      return list.map((t) => names.equipment.get(String(t.equipmentId)) ?? "?").join(", ") || "—";
    case "doers":
      return list.map((d) => names.person.get(String(d.personId)) ?? "?").join(", ") || "—";
    case "purposes":
      return (value as string[]).map((p) => TREATMENT_PURPOSE_LABELS[p as keyof typeof TREATMENT_PURPOSE_LABELS] ?? p).join(", ") || "—";
    default:
      return String(value);
  }
}

/** Changements d'une entrée d'historique : « Intrants : Fongicide X 2 L/ha → Fongicide X 1,5 L/ha ». */
export function changeLines(names: Names, entry: InterventionHistoryEntry): { field: string; before: string; after: string }[] {
  return Object.entries(entry.changes ?? {}).map(([field, c]) => ({
    field: FIELDS[field] ?? field,
    before: valueText(names, field, c.before),
    after: valueText(names, field, c.after),
  }));
}
