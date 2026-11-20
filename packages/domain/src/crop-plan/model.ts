import type { CropPlanDraft, CropPlanParcelKey } from "@fourmy/contracts";

/**
 * Assolement prévisionnel (claudedocs/conception_assolement.md §3) : types
 * du domaine. Le brouillon lui-même (`CropPlanDraft`) est décrit dans
 * `@fourmy/contracts` ; tout ici est pur, sans base ni carte.
 */

/** Parcelle du parcellaire de départ (valide au début de la campagne). */
export interface CropPlanBaseParcel {
  id: string;
  name: string;
  areaM2: number;
}

/** Part d'une parcelle de départ dans une parcelle du brouillon (filiation). */
export interface CropPlanOrigin {
  /** land_parcel_id de la parcelle de départ. */
  parcelId: string;
  /** Part de la surface de la parcelle du brouillon venue de cette origine (0 à 1). */
  share: number;
}

/** Parcelle du brouillon après les découpes et fusions. */
export interface ResolvedParcel {
  key: CropPlanParcelKey;
  name: string;
  areaM2: number;
  /** Parcelle existante (`p:`) ou nouvelle (`n:`). */
  existing: boolean;
  /** Parcelles de départ dont elle provient ; une parcelle existante est sa propre origine. */
  origins: CropPlanOrigin[];
  /** Date d'effet de l'opération qui l'a créée. */
  effectiveOn?: string;
}

/** Activité de la ferme, vue par l'assolement. */
export interface CropPlanActivity {
  id: string;
  name: string;
  family: string;
  /** Code culture PAC (catégorie BCAE 7) ; null s'il n'est pas connu. */
  capCode: string | null;
  /** Espèce (taxonomie), pour la rotation et la mixité AB et la diversité HVE. */
  species?: string | null;
  /** Cycle de la culture (conversion AB). */
  cycle?: "annual" | "semi_perennial" | "perennial";
  legume?: boolean;
  vegetable?: boolean;
}

/** Culture d'une parcelle de départ une année passée (historique). */
export interface ParcelYearCrop {
  /** Code culture PAC de la culture principale ; null : culture connue sans code. */
  main: string | null;
  /** Une culture secondaire (dérobée, couvert) a suivi la culture principale. */
  secondary: boolean;
  /** Espèce et libellé de la culture principale (rotation AB). */
  species?: string | null;
  label?: string | null;
  legume?: boolean;
  /** Couvert ou dérobée de légumineuses. */
  coverLegume?: boolean;
  vegetable?: boolean;
  /** Pérenne, prairie ou fourrage pérenne : hors rotation AB. */
  perennial?: boolean;
}

/** Historique des parcelles de départ : land_parcel_id → année → culture. */
export type CropPlanHistory = ReadonlyMap<string, Readonly<Record<number, ParcelYearCrop>>>;

export const parcelKeyOf = (landParcelId: string): CropPlanParcelKey => `p:${landParcelId}`;

export const emptyDraft = (year: number): CropPlanDraft => ({ schema: 1, year, operations: [], assignments: [], covers: [], fallow: [], excluded: [] });

/** Surface en hectares, à la française (« 12,40 ha »). */
export function formatHa(m2: number): string {
  return `${(Math.round(m2 / 100) / 100).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;
}

/** Pourcentage arrondi (« 35 % »). */
export function formatPct(share: number): string {
  return `${Math.round(share * 1000) / 10} %`.replace(".", ",");
}
