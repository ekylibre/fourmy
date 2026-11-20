import type { CropPlanContext, CropPlanDraft } from "@fourmy/contracts";
import type { CropPlanCheckInput } from "./checks/index.js";
import type { CropPlanActivity, ParcelYearCrop } from "./model.js";

/**
 * Contexte de l'API (JSON) → entrée des contrôles (conception §4.1). Partagé
 * par l'écran (contrôles à chaque geste) et l'API (validation) : les deux
 * calculent sur les mêmes données.
 */
export function cropPlanCheckInput(context: CropPlanContext, draft: CropPlanDraft): CropPlanCheckInput {
  const activities = new Map<string, CropPlanActivity>(context.activities.map((a) => [a.id, { ...a }]));
  const history = new Map<string, Record<number, ParcelYearCrop>>(
    Object.entries(context.history).map(([id, years]) => [id, Object.fromEntries(Object.entries(years).map(([y, c]) => [Number(y), c]))]),
  );
  return {
    base: context.parcels.map(({ id, name, areaM2 }) => ({ id, name, areaM2 })),
    draft,
    activities,
    history,
    settings: context.settings,
    certification: {
      abParcels: new Map(Object.entries(context.certification.abParcels)),
      hve: context.certification.hve,
      abRotation: context.certification.abRotation,
    },
    zones: context.zones ?? {},
  };
}
