/**
 * Règles de correspondance Ekylibre → Fourmy, pures et testées.
 */

/** Convertit un volume en litres ; null si l'unité n'est pas un volume connu. */
export function toLiters(value: number | null, unit: string | null): number | null {
  if (value === null || unit === null) return null;
  const factor: Record<string, number> = {
    liter: 1,
    hectoliter: 100,
    cubic_meter: 1000,
    cubic_decimeter: 1,
  };
  const f = factor[unit];
  return f === undefined ? null : value * f;
}

export type ArticleKind = "phyto" | "fertilizer" | "seed" | "harvest" | "wine" | "other";

/**
 * Nature d'un article à partir de la variante Ekylibre. Un n° AMM
 * (`france_maaid`) signe un produit phytopharmaceutique.
 */
export function articleKind(v: { variety: string | null; france_maaid: string | null }): ArticleKind {
  if (v.france_maaid?.trim()) return "phyto"; // AMM vide ('') ≠ phyto
  const variety = v.variety ?? "";
  if (/seed|seedling|plant_seed/.test(variety)) return "seed";
  if (/fertilizer|manure|slurry|preparation/.test(variety)) return "fertilizer";
  if (/wine|must/.test(variety)) return "wine";
  if (/grape|harvest|vegetable|cereal|crop/.test(variety)) return "harvest";
  return "other";
}

/** Nature de production à partir de la famille d'activité Ekylibre. */
/** Familles d'activité reprises (celles d'Ekylibre). */
export const ACTIVITY_FAMILIES = new Set([
  "plant_farming",
  "vine_farming",
  "animal_farming",
  "plant_nursery",
  "processing",
  "wine_making",
  "administering",
  "tool_maintaining",
  "service_delivering",
]);

export function productionNature(
  family: string | null,
): "field_crop" | "vine" | "grassland" | null {
  if (family === "vine_farming") return "vine";
  if (family === "plant_farming") return "field_crop";
  if (family === "animal_farming") return "grassland";
  return null;
}

/**
 * Culture d'une production (taxonomie Lexicon, la même que celle d'Ekylibre :
 * zea_mays, vitis…) : la variété cultivée de l'activité ; une vigne sans
 * variété renseignée reste de la vigne. Sert aux contrôles phyto (usages
 * autorisés par culture) et à l'IFT.
 */
export function cultivationOf(cultivationVariety: string | null, nature: "field_crop" | "vine" | "grassland"): string | null {
  const v = cultivationVariety?.trim().toLowerCase() || null;
  if (v && /^[a-z_]+$/.test(v) && v !== "plant") return v;
  return nature === "vine" ? "vitis" : null;
}

/** Statut d'intervention : seules les interventions réalisées entrent au journal. */
export function interventionStatus(state: string | null): "done" | "planned" | null {
  if (state === "done" || state === "validated") return "done";
  if (state === "in_progress" || state === "request") return "planned";
  return null; // rejected, etc. : non migrées
}

/** Rôle d'un paramètre Ekylibre. */
export function parameterRole(
  type: string,
): "target" | "input" | "output" | "tool" | "doer" | null {
  switch (type) {
    case "InterventionTarget":
      return "target";
    case "InterventionInput":
      return "input";
    case "InterventionOutput":
      return "output";
    case "InterventionTool":
      return "tool";
    case "InterventionDoer":
      return "doer";
    default:
      return null; // InterventionGroupParameter : conteneur logique, ignoré
  }
}

/** Type de contenant à partir de la variété du produit. */
export function containerKind(variety: string | null): "tank" | "silo" | "barrel" | null {
  if (variety === "tank" || variety === "vat") return "tank";
  if (variety === "silo") return "silo";
  if (variety === "barrel" || variety === "cask") return "barrel";
  return null;
}

/**
 * Capacité annoncée par un libellé (« Cuve 50 hl », « Garde vin 5hl ») en
 * litres, pour détecter les saisies incohérentes. null si rien de lisible.
 */
export function capacityFromLabel(label: string | null): number | null {
  if (!label) return null;
  const m = /(\d+(?:[.,]\d+)?)\s*(hl|l)\b/i.exec(label);
  if (!m) return null;
  const value = Number(m[1]!.replace(",", "."));
  return m[2]!.toLowerCase() === "hl" ? value * 100 : value;
}

/** Natures de matériel à compteur d'heures (mêmes que METERED_KINDS de @fourmy/contracts). */
const METERED = new Set(["tractor", "self_propelled_equipment"]);
export const hasHourMeter = (variety: string | null) => METERED.has(variety ?? "");

/**
 * Identifiant Samsys d'un matériel : Ekylibre recopie les matériels de
 * Samsys avec un n° de travail `SAMSYS_<id>`, souvent en double d'un matériel
 * déjà saisi sous le même nom.
 */
export function samsysId(workNumber: string | null): string | null {
  return /^SAMSYS_(.+)$/.exec(workNumber ?? "")?.[1] ?? null;
}

/** Identifiants externes d'un matériel : n° de travail (immatriculation…) ou id Samsys. */
export function equipmentExternalIds(e: { work_number: string | null }): Record<string, string> {
  const samsys = samsysId(e.work_number);
  if (samsys) return { samsys };
  return e.work_number ? { ekylibre_work_number: e.work_number } : {};
}

/** Date de mise en service : la date de naissance Ekylibre, sauf l'époque Unix (valeur par défaut). */
export function commissionedAt(bornAt: Date | null): Date | null {
  if (!bornAt || bornAt.getUTCFullYear() <= 1970) return null;
  return bornAt;
}

// ---- Attelages (FR-ATT-10, docs/parcours-attelages-design.md §7) ----------

/** Matériel motorisé : tracteur ou automoteur (il porte un attelage). */
export function isMotorised(variety: string | null): boolean {
  return /tractor|self_propelled/.test(variety ?? "");
}

export type Span = { startedAt: string; stoppedAt: string };

/** Fusionne les périodes qui se recouvrent ; deux périodes qui se touchent restent distinctes. */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.stoppedAt > s.startedAt).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out.at(-1);
    if (last && s.startedAt < last.stoppedAt) {
      if (s.stoppedAt > last.stoppedAt) last.stoppedAt = s.stoppedAt;
    } else out.push({ ...s });
  }
  return out;
}

function overlapMs(a: Span[], b: Span[]): number {
  let ms = 0;
  for (const x of a)
    for (const y of b) {
      const from = x.startedAt > y.startedAt ? x.startedAt : y.startedAt;
      const to = x.stoppedAt < y.stoppedAt ? x.stoppedAt : y.stoppedAt;
      if (to > from) ms += Date.parse(to) - Date.parse(from);
    }
  return ms;
}

/** Matériel (`tool`) ou intervenant (`doer`) d'une intervention Ekylibre. */
export type CrewMember = { paramId: number; role: "tool" | "doer"; productId: number | null; motorised: boolean };

export type CrewPlan =
  | { staffing: "crews"; rule: 1 | 2; crews: { paramIds: number[]; periods: Span[] }[] }
  /** `ambiguous` : plusieurs motorisés et plusieurs intervenants, sans participations (règle 3). */
  | { staffing: "free"; ambiguous: boolean };

/**
 * Attelages d'une intervention reprise (FR-ATT-10), dans l'ordre :
 * 1. participations (périodes par matériel ou par personne) : un attelage
 *    par matériel motorisé participant, avec ses périodes ; chaque autre
 *    membre rejoint l'attelage dont les périodes recouvrent le plus les
 *    siennes, sinon le premier. Sans motorisé participant (participations
 *    des seules personnes), on passe à la règle 2 ;
 * 2. au plus un motorisé ou au plus un intervenant : un seul attelage avec
 *    tous les membres et les périodes de l'intervention ;
 * 3. sinon mode libre, « attelage ambigu ».
 * Sans matériel, ou sans période, aucun attelage n'est possible : mode libre.
 */
export function crewsOf(input: { members: CrewMember[]; periods: Span[]; participations: Map<number, Span[]> }): CrewPlan {
  const { members, participations } = input;
  if (!members.some((m) => m.role === "tool")) return { staffing: "free", ambiguous: false };

  // Règle 1.
  const leaders: { productId: number; periods: Span[]; paramIds: number[] }[] = [];
  for (const m of members) {
    if (m.role !== "tool" || !m.motorised || m.productId === null) continue;
    const own = mergeSpans(participations.get(m.productId) ?? []);
    if (!own.length) continue;
    const known = leaders.find((l) => l.productId === m.productId);
    if (known) known.paramIds.push(m.paramId);
    else leaders.push({ productId: m.productId, periods: own, paramIds: [m.paramId] });
  }
  if (leaders.length) {
    leaders.sort((a, b) => a.periods[0]!.startedAt.localeCompare(b.periods[0]!.startedAt) || a.productId - b.productId);
    const crews = leaders.map((l) => ({ paramIds: [...l.paramIds], periods: l.periods }));
    const placed = new Set(leaders.flatMap((l) => l.paramIds));
    for (const m of members) {
      if (placed.has(m.paramId)) continue;
      const own = m.productId === null ? [] : mergeSpans(participations.get(m.productId) ?? []);
      let best = 0;
      let bestMs = 0;
      crews.forEach((c, i) => {
        const ms = overlapMs(own, c.periods);
        if (ms > bestMs) [best, bestMs] = [i, ms];
      });
      crews[best]!.paramIds.push(m.paramId);
    }
    return { staffing: "crews", rule: 1, crews };
  }

  const periods = mergeSpans(input.periods);
  if (!periods.length) return { staffing: "free", ambiguous: false };
  // Règle 2.
  const distinct = (role: "tool" | "doer", only: (m: CrewMember) => boolean) =>
    new Set(members.filter((m) => m.role === role && only(m)).map((m) => m.productId ?? `param:${m.paramId}`)).size;
  if (distinct("tool", (m) => m.motorised) <= 1 || distinct("doer", () => true) <= 1)
    return { staffing: "crews", rule: 2, crews: [{ paramIds: members.map((m) => m.paramId), periods }] };
  // Règle 3.
  return { staffing: "free", ambiguous: true };
}
