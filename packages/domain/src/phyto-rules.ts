/**
 * Contrôle réglementaire d'un traitement phytosanitaire (exigences PHY-3,
 * PHY-4) : autorisation du produit et de l'usage sur la culture, dose
 * maximale, nombre d'applications, zone non traitée (ZNT) près de l'eau,
 * délai avant récolte (DAR), délai de ré-entrée. Référentiel : E-Phy (ANSES)
 * via Lexicon. Fonctions pures : le serveur fournit les données, le web
 * affiche les feux ; un traitement passé est jugé à sa date.
 *
 * Logique reprise d'Ekylibre (`app/services/phytosanitary`,
 * `registered_phytosanitary_usage_dose_computation.rb`) : un usage vaut pour
 * une culture si ses espèces contiennent la culture, un de ses ancêtres dans
 * la taxonomie (« plant » = traitements généraux) ou un ensemble E-Phy
 * (`ephy_wheat`…) qui la contient.
 */

export type ComplianceLevel = "ok" | "info" | "warning" | "danger";
export type ComplianceCode = "authorization" | "dose" | "applications" | "znt" | "dar" | "reentry";

export interface ComplianceIndicator {
  code: ComplianceCode;
  level: ComplianceLevel;
  message: string;
}

export interface PhytoProductRef {
  amm: string;
  name: string;
  state: string; // authorized | withdrawn | inherited
  startedOn: string | null;
  stoppedOn: string | null;
  reentryDelayHours: number | null;
  natures: string[];
}

export interface PhytoUsageRef {
  id: string;
  cropLabel: string | null;
  species: string[];
  targetLabel: string | null;
  doseQuantity: number | null;
  doseUnitLabel: string | null;
  preHarvestDelayDays: number | null;
  applicationsCount: number | null;
  untreatedBufferAquatic: number | null;
  state: string;
  decisionDate: string | null;
  isDerogation: boolean;
  derogationStartedOn: string | null;
  derogationStoppedOn: string | null;
}

export interface ParcelContext {
  id: string;
  name: string;
  /** Surface traitée (ha) : zone de travail, sinon parcelle. */
  treatedHa: number;
  /** Culture (taxonomie) et ses ancêtres, du plus précis au plus général ; null si inconnue. */
  lineage: string[] | null;
  cultivationLabel: string | null;
  /**
   * Libellés de culture E-Phy admis, quand l'activité les restreint : une
   * jachère (espèce générique « plant ») n'admet que les usages « Jachères et
   * cultures intermédiaires » et « Traitements généraux ».
   */
  cropLabels?: string[] | null;
  /** Données d'eau chargées autour de la ferme. */
  waterLoaded: boolean;
  /** Distance (m) entre la zone traitée et l'eau la plus proche ; null si aucune à proximité. */
  waterDistanceM: number | null;
  waterName: string | null;
  /** Applications du même produit sur la parcelle dans la campagne, celle-ci exclue. */
  previousApplications: number;
  /** Prochaine récolte (réalisée ou planifiée) sur la parcelle après le traitement. */
  nextHarvestAt: string | null;
}

export interface TreatmentCheckInput {
  /** Date du traitement (fin de la dernière période, sinon date prévue). */
  at: string;
  /** Produit tel que saisi dans Fourmy. */
  article: { name: string; amm: string | null; unit: string };
  dose: { quantity: number; per: "hectare" | "total" };
  /** Produit dans le référentiel (null : n° AMM inconnu ou absent). */
  product: PhytoProductRef | null;
  usages: PhytoUsageRef[];
  /** Usage (cible) choisi par l'utilisateur, s'il l'a précisé. */
  usageId?: string | null;
  /** Ensembles de cultures E-Phy : nom → espèces. */
  cropsets: Record<string, string[]>;
  parcels: ParcelContext[];
}

export interface TreatmentCheck {
  articleName: string;
  level: ComplianceLevel;
  indicators: ComplianceIndicator[];
  /** Usages valables sur toutes les cultures traitées (choix de la cible). */
  usages: { id: string; label: string; doseLabel: string | null }[];
  /** Fin du délai avant récolte et de ré-entrée (ISO), si connus. */
  harvestAllowedFrom: string | null;
  reentryAllowedFrom: string | null;
  /** Largeur de la ZNT eau retenue (m), si l'usage en fixe une. */
  zntM: number | null;
  /** Usage retenu : celui choisi, ou le seul possible. */
  usageId: string | null;
}

const RANK: Record<ComplianceLevel, number> = { ok: 0, info: 1, warning: 2, danger: 3 };
export const worstLevel = (levels: ComplianceLevel[]): ComplianceLevel =>
  levels.reduce<ComplianceLevel>((w, l) => (RANK[l] > RANK[w] ? l : w), "ok");

const day = (iso: string) => iso.slice(0, 10);
const frDate = (iso: string) => new Date(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
const frDateTime = (iso: string) =>
  new Date(iso).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
const fmt = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 3 });
const plusDays = (iso: string, days: number) => new Date(new Date(iso).getTime() + days * 86_400_000).toISOString();
const plusHours = (iso: string, hours: number) => new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();

// --- Unités -------------------------------------------------------------------

/**
 * Unité d'un article en litres ou kilogrammes : « Litre », « L », « Kg »,
 * « Kilogramme », « Sac de 12 kg »… (libellés repris d'Ekylibre).
 */
export function articleUnitBase(unit: string): { base: "L" | "kg"; factor: number } | null {
  const u = unit.trim().toLowerCase();
  const packed = u.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|l|ml)\b/);
  if (packed) {
    const n = Number(packed[1]!.replace(",", "."));
    const [base, f] = { kg: ["kg", 1], g: ["kg", 0.001], l: ["L", 1], ml: ["L", 0.001] }[packed[2] as "kg"] as ["L" | "kg", number];
    return { base, factor: n * f };
  }
  if (/^(l|litre|liter|litres|liters)$/.test(u)) return { base: "L", factor: 1 };
  if (/^(ml|millilitre|milliliter)$/.test(u)) return { base: "L", factor: 0.001 };
  if (/^(kg|kilogramme|kilogram|kilogrammes|kilograms)$/.test(u)) return { base: "kg", factor: 1 };
  if (/^(g|gramme|gram|grammes|grams)$/.test(u)) return { base: "kg", factor: 0.001 };
  return null;
}

/** Dose maximale d'un usage par hectare, en L ou kg (seules les doses à l'hectare se comparent). */
export function usageDosePerHa(u: Pick<PhytoUsageRef, "doseQuantity" | "doseUnitLabel">): { base: "L" | "kg"; value: number } | null {
  if (u.doseQuantity === null || !u.doseUnitLabel) return null;
  const m = u.doseUnitLabel.trim().match(/^(L|mL|kg|g)\/ha$/i);
  if (!m) return null;
  const unit = m[1]!.toLowerCase();
  const [base, factor] = ({ l: ["L", 1], ml: ["L", 0.001], kg: ["kg", 1], g: ["kg", 0.001] } as const)[unit as "l"];
  return { base, value: u.doseQuantity * factor };
}

// --- Validité à une date ----------------------------------------------------

export function productValidAt(p: PhytoProductRef, at: string): { valid: boolean; reason?: string } {
  const d = day(at);
  if (p.startedOn && d < p.startedOn) return { valid: false, reason: `pas encore autorisé (AMM du ${frDate(p.startedOn)})` };
  if (p.stoppedOn && d > p.stoppedOn) return { valid: false, reason: `retiré le ${frDate(p.stoppedOn)}` };
  if (p.state !== "authorized" && !p.stoppedOn) return { valid: false, reason: "retiré (date inconnue)" };
  return { valid: true };
}

export function usageValidAt(u: PhytoUsageRef, at: string): boolean {
  const d = day(at);
  if (u.isDerogation && u.derogationStartedOn && u.derogationStoppedOn) return d >= u.derogationStartedOn && d <= u.derogationStoppedOn;
  if (u.state === "authorized") return true;
  // Usage retiré : valable avant la décision de retrait.
  return !!u.decisionDate && d < u.decisionDate;
}

/** L'usage couvre-t-il la culture (lignée taxonomique) ? */
export function usageCovers(u: PhytoUsageRef, lineage: string[], cropsets: Record<string, string[]>): boolean {
  const names = new Set(lineage.flatMap((n) => [n, n.replace(/^x_/, "")]));
  return u.species.some((s) => names.has(s) || (cropsets[s] ?? []).some((c) => names.has(c) || names.has(c.replace(/^x_/, ""))));
}

/**
 * Usages génériques (espèce « plant ») qui ne visent pas une culture en place :
 * proposés seulement quand l'activité les admet (jachère : `cropLabels`).
 */
export const NON_CROP_USAGE_LABELS = ["Jachères et cultures intermédiaires", "Jevi", "Jardin d'amateur"];

/** L'usage vaut-il pour la parcelle : lignée de sa culture et libellés admis par son activité. */
export function usageFitsParcel(u: PhytoUsageRef, p: Pick<ParcelContext, "lineage" | "cropLabels">, cropsets: Record<string, string[]>): boolean {
  if (!p.lineage || !usageCovers(u, p.lineage, cropsets)) return false;
  const label = u.cropLabel ?? "";
  return p.cropLabels ? p.cropLabels.includes(label) : !NON_CROP_USAGE_LABELS.includes(label);
}

const usageLabel = (u: PhytoUsageRef) => [u.cropLabel, u.targetLabel].filter(Boolean).join(" — ");

// --- Contrôle -----------------------------------------------------------------

export function checkTreatment(input: TreatmentCheckInput): TreatmentCheck {
  const { at, article, product, cropsets, parcels } = input;
  const indicators: ComplianceIndicator[] = [];
  const result = (extra: Partial<TreatmentCheck> = {}): TreatmentCheck => ({
    articleName: article.name,
    level: worstLevel(indicators.map((i) => i.level)),
    indicators,
    usages: [],
    harvestAllowedFrom: null,
    reentryAllowedFrom: null,
    zntM: null,
    usageId: null,
    ...extra,
  });

  if (!article.amm) {
    indicators.push({ code: "authorization", level: "warning", message: `${article.name} : pas de n° AMM, contrôle impossible. Rattachez le produit au référentiel.` });
    return result();
  }
  if (!product) {
    indicators.push({ code: "authorization", level: "warning", message: `${article.name} : n° AMM ${article.amm} absent du référentiel E-Phy.` });
    return result();
  }
  const validity = productValidAt(product, at);
  if (!validity.valid) {
    indicators.push({ code: "authorization", level: "danger", message: `${product.name} (AMM ${product.amm}) : ${validity.reason}.` });
  }

  // Usages valables à la date, par parcelle.
  const valid = input.usages.filter((u) => usageValidAt(u, at));
  const known = parcels.filter((p) => p.lineage);
  const unknown = parcels.filter((p) => !p.lineage);
  if (unknown.length) {
    indicators.push({
      code: "authorization",
      level: "warning",
      message: `Culture inconnue sur ${unknown.map((p) => p.name).join(", ")} : autorisation non vérifiable.`,
    });
  }
  const byParcel = new Map(known.map((p) => [p.id, valid.filter((u) => usageFitsParcel(u, p, cropsets))]));
  const uncovered = known.filter((p) => byParcel.get(p.id)!.length === 0);
  if (uncovered.length) {
    indicators.push({
      code: "authorization",
      level: "danger",
      message: `Aucun usage autorisé de ${product.name} sur ${uncovered.map((p) => `${p.cultivationLabel ?? "cette culture"} (${p.name})`).join(", ")}.`,
    });
  } else if (validity.valid && known.length) {
    indicators.push({ code: "authorization", level: "ok", message: `${product.name} autorisé sur ${[...new Set(known.map((p) => p.cultivationLabel))].join(", ")}.` });
  }

  // Usages communs à toutes les parcelles connues (choix de la cible).
  const common = known.length ? valid.filter((u) => known.every((p) => byParcel.get(p.id)!.includes(u))) : valid;
  // Un seul usage possible pour l'activité des parcelles : il est retenu d'office.
  const chosen = input.usageId ? (common.find((u) => u.id === input.usageId) ?? null) : common.length === 1 ? common[0]! : null;
  const applicable = chosen ? [chosen] : common;
  const choiceNote = chosen ? "" : applicable.length > 1 ? " (cible non précisée : valeur la plus permissive des usages possibles)" : "";

  // Dose maximale.
  const unit = articleUnitBase(article.unit);
  const totalHa = parcels.reduce((t, p) => t + p.treatedHa, 0);
  const appliedPerHa = unit
    ? input.dose.per === "hectare"
      ? input.dose.quantity * unit.factor
      : totalHa > 0
        ? (input.dose.quantity * unit.factor) / totalHa
        : null
    : null;
  const maxima = applicable.map(usageDosePerHa).filter((d): d is { base: "L" | "kg"; value: number } => d !== null && d.base === unit?.base);
  if (applicable.length && appliedPerHa !== null && unit && maxima.length) {
    const max = Math.max(...maxima.map((m) => m.value));
    const level: ComplianceLevel = appliedPerHa > max * 1.0001 ? "danger" : "ok";
    indicators.push({
      code: "dose",
      level,
      message:
        level === "danger"
          ? `Dose ${fmt(appliedPerHa)} ${unit.base}/ha au-dessus du maximum autorisé (${fmt(max)} ${unit.base}/ha)${choiceNote}.`
          : `Dose ${fmt(appliedPerHa)} ${unit.base}/ha, maximum ${fmt(max)} ${unit.base}/ha${choiceNote}.`,
    });
  } else if (applicable.length) {
    indicators.push({ code: "dose", level: "warning", message: "Dose non comparable au maximum autorisé (unité différente ou inconnue)." });
  }

  // Nombre d'applications par campagne.
  const counts = applicable.map((u) => u.applicationsCount).filter((n): n is number => n !== null && n > 0);
  if (applicable.length && counts.length === applicable.length) {
    const max = Math.max(...counts);
    const over = parcels.filter((p) => p.previousApplications + 1 > max);
    indicators.push(
      over.length
        ? { code: "applications", level: "danger", message: `Plus de ${max} application(s) dans la campagne sur ${over.map((p) => `${p.name} (${p.previousApplications + 1}e)`).join(", ")}.` }
        : { code: "applications", level: "ok", message: `Applications dans la campagne : maximum ${max}${choiceNote}.` },
    );
  }

  // ZNT eau : distance réelle entre la zone traitée et l'eau.
  const buffers = applicable.map((u) => u.untreatedBufferAquatic).filter((n): n is number => n !== null && n > 0);
  let zntM: number | null = null;
  if (applicable.length && buffers.length) {
    const znt = chosen ? buffers[0]! : Math.max(...buffers);
    zntM = znt;
    const missing = parcels.filter((p) => !p.waterLoaded);
    const near = parcels.filter((p) => p.waterLoaded && p.waterDistanceM !== null && p.waterDistanceM < znt);
    if (near.length) {
      indicators.push({
        code: "znt",
        level: "danger",
        message: `ZNT de ${znt} m non respectée : ${near
          .map((p) => {
            const water = p.waterName ? `« ${p.waterName} »` : "un point d'eau";
            return p.waterDistanceM! < 0.5
              ? `${p.name} touche ${water} (cours d'eau qui traverse ou borde la zone traitée)`
              : `${p.name} à ${Math.round(p.waterDistanceM!)} m de ${water}`;
          })
          .join(", ")}.`,
      });
    } else if (missing.length) {
      indicators.push({ code: "znt", level: "warning", message: `ZNT de ${znt} m : cours d'eau non chargés autour de la ferme, distance non vérifiée.` });
    } else {
      const closest = parcels.filter((p) => p.waterDistanceM !== null).sort((a, b) => a.waterDistanceM! - b.waterDistanceM!)[0];
      indicators.push({
        code: "znt",
        level: "ok",
        message: closest
          ? `ZNT de ${znt} m respectée (eau la plus proche à ${Math.round(closest.waterDistanceM!)} m de ${closest.name}).`
          : `ZNT de ${znt} m respectée (pas d'eau à proximité).`,
      });
    }
  }

  // Délai avant récolte.
  let harvestAllowedFrom: string | null = null;
  const delays = applicable.map((u) => u.preHarvestDelayDays).filter((n): n is number => n !== null && n > 0);
  if (delays.length) {
    const dar = chosen ? delays[0]! : Math.max(...delays);
    harvestAllowedFrom = plusDays(at, dar);
    const early = parcels.filter((p) => p.nextHarvestAt && p.nextHarvestAt < harvestAllowedFrom!);
    indicators.push(
      early.length
        ? { code: "dar", level: "danger", message: `Délai avant récolte de ${dar} j non respecté : récolte le ${early.map((p) => `${frDate(p.nextHarvestAt!)} (${p.name})`).join(", ")}, possible à partir du ${frDate(harvestAllowedFrom)}.` }
        : { code: "dar", level: "info", message: `Délai avant récolte : ${dar} j, récolte possible à partir du ${frDate(harvestAllowedFrom)}.` },
    );
  }

  // Délai de ré-entrée.
  let reentryAllowedFrom: string | null = null;
  if (product.reentryDelayHours) {
    reentryAllowedFrom = plusHours(at, product.reentryDelayHours);
    indicators.push({ code: "reentry", level: "info", message: `Ré-entrée dans la parcelle possible le ${frDateTime(reentryAllowedFrom)} (délai de ${product.reentryDelayHours} h).` });
  }

  return result({
    usages: common.map((u) => ({ id: u.id, label: usageLabel(u) || u.id, doseLabel: u.doseQuantity !== null ? `${fmt(u.doseQuantity)} ${u.doseUnitLabel ?? ""}`.trim() : null })),
    harvestAllowedFrom,
    reentryAllowedFrom,
    zntM,
    usageId: chosen?.id ?? null,
  });
}
