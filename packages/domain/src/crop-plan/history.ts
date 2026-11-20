import type { CropPlanHistory, ParcelYearCrop, ResolvedParcel } from "./model.js";

/**
 * Historique d'une parcelle du brouillon (conception §4.6) : celui de ses
 * parcelles de départ, chacune avec sa part de surface. Un morceau de
 * découpe hérite de l'historique de sa parcelle d'origine ; une parcelle
 * fusionnée a plusieurs historiques, que les contrôles vérifient séparément.
 */
export interface ParcelHistoryPart {
  parcelId: string;
  share: number;
  /** Année → culture ; une année absente est inconnue de Fourmy. */
  years: Readonly<Record<number, ParcelYearCrop>>;
}

export function historyOf(parcel: ResolvedParcel, history: CropPlanHistory): ParcelHistoryPart[] {
  return parcel.origins.map((o) => ({ parcelId: o.parcelId, share: o.share, years: history.get(o.parcelId) ?? {} }));
}
