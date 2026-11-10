import type { StaffingBody } from "./crews.js";

/**
 * Applicateur d'un produit phytosanitaire (FR-ATT-12, design §4.4) : en mode
 * attelage, les intervenants de l'attelage qui porte le pulvérisateur. La
 * même règle est répliquée en SQL (`fourmy_input_applicators`, migration
 * 0026) pour le registre ; les deux sont testées sur les mêmes cas.
 *
 * 1. Mode libre : tous les intervenants.
 * 2. Attelages : celui qui contient le matériel saisi sur l'intrant.
 * 3. Sinon, l'unique attelage qui contient un pulvérisateur.
 * 4. Sinon, l'attelage s'il n'y en a qu'un.
 * 5. Sinon, tous les intervenants : applicateur ambigu.
 *
 * Un attelage retenu sans intervenant donne une liste vide : applicateur
 * « non renseigné ».
 */

export type ApplicatorRule = "free" | "input" | "sprayer" | "single" | "ambiguous";

export interface Applicators {
  personIds: string[];
  rule: ApplicatorRule;
  /** Rang de l'attelage retenu (règles 2 à 4). */
  crewIndex: number | null;
}

/** Ce qu'il faut savoir d'un matériel pour reconnaître un pulvérisateur. */
export interface SprayerHint {
  kind?: string | null;
  avatarTemplate?: string | null;
}

/** Pulvérisateur : nature `sprayer` / `self_propelled_sprayer`, ou modèle d'avatar `*sprayer*`. */
export const isSprayer = (e: SprayerHint | undefined): boolean =>
  !!e && (e.kind === "sprayer" || e.kind === "self_propelled_sprayer" || !!e.avatarTemplate?.includes("sprayer"));

const unique = (ids: string[]) => [...new Set(ids)];

export function applicatorsOf(
  body: Pick<StaffingBody, "staffing" | "crews" | "doers">,
  input: { equipmentId?: string | null },
  equipment: (id: string) => SprayerHint | undefined = () => undefined,
): Applicators {
  const crews = body.staffing === "crews" ? (body.crews ?? []) : [];
  const all = () =>
    unique(body.staffing === "crews" ? crews.flatMap((c) => (c.doers ?? []).map((d) => d.personId)) : (body.doers ?? []).map((d) => d.personId));
  if (body.staffing !== "crews") return { personIds: all(), rule: "free", crewIndex: null };
  const pick = (k: number, rule: ApplicatorRule): Applicators => ({ personIds: unique((crews[k]!.doers ?? []).map((d) => d.personId)), rule, crewIndex: k });

  if (input.equipmentId) {
    const k = crews.findIndex((c) => c.tools.some((t) => t.equipmentId === input.equipmentId));
    if (k >= 0) return pick(k, "input");
  }
  const sprayers = crews.map((c, k) => (c.tools.some((t) => isSprayer(equipment(t.equipmentId))) ? k : -1)).filter((k) => k >= 0);
  if (sprayers.length === 1) return pick(sprayers[0]!, "sprayer");
  if (crews.length === 1) return pick(0, "single");
  return { personIds: all(), rule: "ambiguous", crewIndex: null };
}
