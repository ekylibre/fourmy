import type { CropPlanDraft, CropPlanParcelKey } from "@fourmy/contracts";
import type { CropPlanActivity, ResolvedParcel } from "./model.js";

/**
 * Récapitulatif de l'assolement (FR-AS-8) : surfaces par activité et par
 * famille, part de la surface, écart avec la campagne précédente,
 * parcelles sans culture prévue. Seule la culture principale compte dans
 * les surfaces ; les cultures dérobées sont comptées à part.
 */

export interface CropPlanSummaryLine {
  activityId: string;
  name: string;
  family: string;
  areaM2: number;
  /** Part de la surface du parcellaire. */
  share: number;
  /** Surface de l'activité à la campagne précédente (0 si absente). */
  previousM2: number;
  parcelCount: number;
}

export interface CropPlanSummary {
  totalM2: number;
  assignedM2: number;
  fallowM2: number;
  unassigned: { keys: CropPlanParcelKey[]; areaM2: number };
  byActivity: CropPlanSummaryLine[];
  byFamily: { family: string; areaM2: number; share: number; previousM2: number }[];
  /** Cultures dérobées : surface par activité. */
  secondary: { activityId: string; name: string; areaM2: number }[];
  /** Découpes et fusions en attente de validation. */
  operations: { splits: number; merges: number; newParcels: number };
}

export function summarizeCropPlan(
  parcels: ResolvedParcel[],
  draft: CropPlanDraft,
  activities: ReadonlyMap<string, CropPlanActivity>,
  /** Surface par activité à la campagne précédente. */
  previous: ReadonlyMap<string, number> = new Map(),
): CropPlanSummary {
  const area = new Map(parcels.map((p) => [p.key, p.areaM2]));
  const totalM2 = parcels.reduce((s, p) => s + p.areaM2, 0);
  const share = (m2: number) => (totalM2 > 0 ? m2 / totalM2 : 0);

  const main = new Map<string, { areaM2: number; parcels: Set<string> }>();
  const secondary = new Map<string, number>();
  const assignedKeys = new Set<string>();
  for (const a of draft.assignments) {
    const m2 = area.get(a.key);
    if (m2 === undefined) continue; // parcelle disparue : signalée par la validation
    if (a.role === "secondary") {
      secondary.set(a.activityId, (secondary.get(a.activityId) ?? 0) + m2);
      continue;
    }
    assignedKeys.add(a.key);
    const line = main.get(a.activityId) ?? { areaM2: 0, parcels: new Set<string>() };
    // Deux cultures principales successives sur une parcelle : chacune compte la surface.
    if (!line.parcels.has(a.key)) {
      line.areaM2 += m2;
      line.parcels.add(a.key);
    }
    main.set(a.activityId, line);
  }
  const fallowKeys = new Set(draft.fallow.map((f) => f.key).filter((k) => area.has(k) && !assignedKeys.has(k)));

  const activityIds = new Set([...main.keys(), ...previous.keys()]);
  const byActivity: CropPlanSummaryLine[] = [...activityIds]
    .map((id) => {
      const act = activities.get(id);
      const line = main.get(id);
      return {
        activityId: id,
        name: act?.name ?? "Activité inconnue",
        family: act?.family ?? "",
        areaM2: line?.areaM2 ?? 0,
        share: share(line?.areaM2 ?? 0),
        previousM2: previous.get(id) ?? 0,
        parcelCount: line?.parcels.size ?? 0,
      };
    })
    .sort((a, b) => b.areaM2 - a.areaM2 || b.previousM2 - a.previousM2 || a.name.localeCompare(b.name, "fr"));

  const families = new Map<string, { areaM2: number; previousM2: number }>();
  for (const l of byActivity) {
    const f = families.get(l.family) ?? { areaM2: 0, previousM2: 0 };
    f.areaM2 += l.areaM2;
    f.previousM2 += l.previousM2;
    families.set(l.family, f);
  }

  const unassignedKeys = parcels.filter((p) => !assignedKeys.has(p.key) && !fallowKeys.has(p.key)).map((p) => p.key);
  const sum = (keys: Iterable<string>) => [...keys].reduce((s, k) => s + (area.get(k as CropPlanParcelKey) ?? 0), 0);

  return {
    totalM2,
    assignedM2: sum(assignedKeys),
    fallowM2: sum(fallowKeys),
    unassigned: { keys: unassignedKeys, areaM2: sum(unassignedKeys) },
    byActivity,
    byFamily: [...families]
      .map(([family, f]) => ({ family, areaM2: f.areaM2, share: share(f.areaM2), previousM2: f.previousM2 }))
      .sort((a, b) => b.areaM2 - a.areaM2),
    secondary: [...secondary].map(([id, m2]) => ({ activityId: id, name: activities.get(id)?.name ?? "Activité inconnue", areaM2: m2 })),
    operations: {
      splits: draft.operations.filter((o) => o.kind === "split").length,
      merges: draft.operations.filter((o) => o.kind === "merge").length,
      newParcels: parcels.filter((p) => !p.existing).length,
    },
  };
}
