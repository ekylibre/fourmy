import type { ControlFinding, ControlLevel } from "@fourmy/contracts";
import {
  ANNEX_II_BY_CODE,
  ANNEX_II_SOURCE,
  BREACH_MEASURE_LABELS,
  breachOf,
  cite,
  CONVERSION,
  CONVERSION_SOURCES,
  COPPER,
  COPPER_SOURCE,
  ORGANIC_NITROGEN,
  ORGANIC_NITROGEN_SOURCE,
  type CropCycle,
} from "@fourmy/certification-refs";
import { finding, missing } from "./report.js";

/**
 * Règles de l'Agriculture biologique, lot CT2 (claudedocs/conception_controle_hve_ab.md
 * §5.2) : statut de conversion déduit, produits phytopharmaceutiques et
 * fertilisants autorisés, cuivre, 170 kg N. Le feu suit la classe du
 * manquement INAO : rouge si majeur ou critique, orange si mineur.
 */

/** Intrant apporté sur une parcelle, ramené à l'hectare. */
export interface AbApplication {
  interventionId: string;
  /** Date de l'apport (AAAA-MM-JJ). */
  day: string;
  parcelId: string;
  articleId: string;
  product: string;
  kind: "phyto" | "fertilizer";
  /** Phyto : utilisable en AB (mention E-Phy ou statut de l'article) ; null : inconnu. */
  organicAllowed?: boolean | null;
  /** Cuivre métal (kg/ha) ; null : produit cuprique, teneur ou dose inconnue ; absent : pas de cuivre. */
  copperKgHa?: number | null;
  /** Fertilisant : catégories de l'annexe II ; null : non renseignées. */
  categories?: string[] | null;
  effluentOrigin?: "organic" | "conventional" | "industrial" | "unknown" | null;
  /** Engrais azoté minéral (type III) : interdit. */
  syntheticNitrogen?: boolean;
  /** Azote total (kg/ha) ; null : inconnu. */
  nTotalKgHa?: number | null;
}

export interface AbProduction {
  id: string;
  parcelId: string;
  label: string;
  cycle: CropCycle;
  /** Semis ou plantation (AAAA-MM-JJ). */
  sownOn: string | null;
  /** Récolte (fin de la production). */
  harvestOn: string | null;
}

export interface AbParcelInput {
  id: string;
  name: string;
  areaM2: number;
  /** Début de la conversion (début de la certification AB). */
  startedOn: string;
  /** Niveau saisi : « conversion » ou « certified ». */
  declaredLevel: string | null;
}

export type ConversionStatus = "C1" | "C2" | "AB";
export const CONVERSION_STATUS_LABELS: Record<ConversionStatus, string> = {
  C1: "1re année de conversion (vendu en conventionnel)",
  C2: "en conversion vers l'AB",
  AB: "Agriculture biologique",
};

// --- Dates ---------------------------------------------------------------------

function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

const fr = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const kg = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });

/** Constat avec le manquement INAO d'une règle et le feu qui en découle. */
function breach(rule: string): { breach: ControlFinding["breach"]; level: ControlLevel } {
  const b = breachOf(rule);
  if (!b) return { breach: undefined, level: "warning" };
  return {
    breach: {
      inao: b.number,
      label: b.label,
      class: b.class,
      measure: b.first.map((m) => BREACH_MEASURE_LABELS[m]).join(" + "),
      ...(b.unconfirmed ? { unconfirmed: true } : {}),
    },
    level: b.class === "minor" ? "warning" : "danger",
  };
}

// --- Produits interdits et conversion ---------------------------------------------------

/** Apport d'un produit interdit en AB (remet la conversion à zéro). */
export function isForbidden(a: AbApplication): boolean {
  if (a.kind === "phyto") return a.organicAllowed === false;
  if (a.syntheticNitrogen) return true;
  return !!a.categories?.length && a.categories.some((c) => !ANNEX_II_BY_CODE[c]);
}

/**
 * Début effectif de la conversion d'une parcelle : le début de la
 * certification, ou le dernier apport interdit qui le suit (la conversion
 * redémarre, annexe II partie I 1.7.1 et manquement n° 4 : « DPA »).
 */
export function conversionStart(parcel: AbParcelInput, applications: AbApplication[]): { start: string; resetBy: AbApplication | null } {
  const resets = applications.filter((a) => a.parcelId === parcel.id && a.day >= parcel.startedOn && isForbidden(a)).sort((a, b) => a.day.localeCompare(b.day));
  const last = resets.at(-1) ?? null;
  return { start: last ? last.day : parcel.startedOn, resetBy: last };
}

/**
 * Statut d'une récolte : C1 dans les 12 premiers mois, AB pour une culture
 * annuelle ou semi-pérenne semée 24 mois après le début (pérenne : récoltée
 * 36 mois après), C2 sinon.
 */
export function harvestStatus(start: string, cycle: CropCycle, sownOn: string | null, harvestOn: string): ConversionStatus {
  if (harvestOn < addMonths(start, CONVERSION.c1Months)) return "C1";
  if (cycle === "perennial") return harvestOn >= addMonths(start, CONVERSION.perennialHarvestMonths) ? "AB" : "C2";
  return sownOn && sownOn >= addMonths(start, CONVERSION.annualSowingMonths) ? "AB" : "C2";
}

export interface AbParcelStatus {
  parcelId: string;
  name: string;
  areaM2: number;
  declaredLevel: string | null;
  startedOn: string;
  conversionStart: string;
  resetBy: { interventionId: string; day: string; product: string } | null;
  /** Statut des récoltes de la période ; sans production, celui d'une culture annuelle semée à la fin de la période. */
  status: ConversionStatus;
  productions: { id: string; label: string; cycle: CropCycle; sownOn: string | null; harvestOn: string; status: ConversionStatus }[];
}

/** Statut de conversion des parcelles AB à la fin d'une période (FR-AB-1, D8 : déduit, jamais saisi). */
export function abParcelStatuses(parcels: AbParcelInput[], productions: AbProduction[], applications: AbApplication[], to: string): AbParcelStatus[] {
  const rank: Record<ConversionStatus, number> = { C1: 0, C2: 1, AB: 2 };
  return parcels.map((p) => {
    const { start, resetBy } = conversionStart(p, applications);
    const prods = productions
      .filter((x) => x.parcelId === p.id)
      .map((x) => {
        const harvestOn = x.harvestOn && x.harvestOn < to ? x.harvestOn : to;
        return { id: x.id, label: x.label, cycle: x.cycle, sownOn: x.sownOn, harvestOn, status: harvestStatus(start, x.cycle, x.sownOn, harvestOn) };
      });
    const status = prods.length ? prods.reduce<ConversionStatus>((w, x) => (rank[x.status] < rank[w] ? x.status : w), "AB") : harvestStatus(start, "annual", to, to);
    return {
      parcelId: p.id,
      name: p.name,
      areaM2: p.areaM2,
      declaredLevel: p.declaredLevel,
      startedOn: p.startedOn,
      conversionStart: start,
      resetBy: resetBy ? { interventionId: resetBy.interventionId, day: resetBy.day, product: resetBy.product } : null,
      status,
      productions: prods,
    };
  });
}

const CONVERSION_SOURCE = CONVERSION_SOURCES.map(cite).join(" ; ");

/** R1, R2 : statut déduit, comparé au niveau saisi sur la certification. */
export function conversionFindings(statuses: AbParcelStatus[]): ControlFinding[] {
  return statuses.map((s) => {
    const label = CONVERSION_STATUS_LABELS[s.status];
    const since = s.resetBy ? `conversion redémarrée le ${fr(s.conversionStart)} (${s.resetBy.product})` : `conversion depuis le ${fr(s.startedOn)}`;
    if (s.declaredLevel === "certified" && s.status !== "AB") {
      const b = breach(s.status === "C1" ? "R1" : "R2");
      return finding({
        ruleId: "ab.R1",
        level: "warning",
        message: `${s.name} : déclarée certifiée AB, mais ${since} : récoltes ${s.status} (${label}). Les vendre comme biologiques serait un manquement.`,
        breach: b.breach,
        refs: { parcelIds: [s.parcelId] },
        source: CONVERSION_SOURCE,
      });
    }
    return finding({
      ruleId: "ab.R1",
      level: "ok",
      message:
        s.declaredLevel === "conversion" && s.status === "AB"
          ? `${s.name} : ${since}, durée de conversion atteinte : la certification peut passer en AB.`
          : `${s.name} : ${since}, récoltes ${s.status} (${label}).`,
      refs: { parcelIds: [s.parcelId] },
      source: CONVERSION_SOURCE,
    });
  });
}

// --- Traitements -------------------------------------------------------------------

/** R5, R20 : produit phytopharmaceutique non utilisable en AB sur une parcelle AB. */
export function phytoFindings(applications: AbApplication[], names: Map<string, string>): ControlFinding[] {
  return applications
    .filter((a) => a.kind === "phyto" && a.organicAllowed !== true)
    .map((a) => {
      const where = names.get(a.parcelId) ?? "parcelle";
      if (a.organicAllowed === null || a.organicAllowed === undefined) {
        return finding({
          ruleId: "ab.R5",
          level: "missing",
          message: `${where}, ${fr(a.day)} : ${a.product} — statut AB inconnu (sans n° AMM connu d'E-Phy). Indiquez-le sur l'article.`,
          missing: [missing("statut AB du produit", "article", a.articleId)],
          refs: { parcelIds: [a.parcelId], interventionIds: [a.interventionId], articleIds: [a.articleId] },
          source: "Règlement (UE) 2018/848, annexe II partie I 1.10.2 ; règlement 2021/1165, annexe I",
        });
      }
      const b = breach("R5");
      return finding({
        ruleId: "ab.R5",
        level: b.level,
        message: `${where}, ${fr(a.day)} : ${a.product} n'est pas utilisable en AB. La récolte est déclassée et la conversion de la parcelle redémarre (sauf lutte obligatoire, à justifier auprès de l'organisme certificateur).`,
        breach: b.breach,
        refs: { parcelIds: [a.parcelId], interventionIds: [a.interventionId], articleIds: [a.articleId] },
        source: "Règlement (UE) 2018/848, annexe II partie I 1.10.2 ; règlement 2021/1165, annexe I",
      });
    });
}

/**
 * R21 : cuivre métal cumulé sur 7 ans glissants par parcelle (jusqu'à `to`),
 * apports `current` (saisie) compris. Orange à 80 %, orange avec le
 * manquement au-delà (n° 328, mineur, rattachement à confirmer).
 */
export function copperFindings(parcels: { id: string; name: string }[], applications: AbApplication[], to: string): ControlFinding[] {
  const from = addMonths(to, -12 * COPPER.years);
  return parcels.flatMap((p) => {
    const apps = applications.filter((a) => a.parcelId === p.id && a.copperKgHa !== undefined && a.day > from && a.day <= to);
    if (!apps.length) return [];
    const known = apps.filter((a) => typeof a.copperKgHa === "number");
    const unknown = apps.filter((a) => a.copperKgHa === null);
    const total = Math.round(known.reduce((sum, a) => sum + a.copperKgHa!, 0) * 10) / 10;
    const over = total > COPPER.maxKgPerHa;
    const near = total >= Math.round(COPPER.maxKgPerHa * COPPER.warnShare * 10) / 10;
    const b = over ? breach("R21") : { breach: undefined, level: "ok" as ControlLevel };
    const window = `sur ${COPPER.years} ans jusqu'au ${fr(to)}`;
    return [
      finding({
        ruleId: "ab.R21",
        level: over ? b.level : near ? "warning" : "ok",
        message: `${p.name} : ${kg(total)} kg de cuivre métal/ha ${window} (plafond ${COPPER.maxKgPerHa} kg sur ${COPPER.years} ans)${over ? " : plafond dépassé" : near ? " : proche du plafond" : ""}${unknown.length ? ` ; ${unknown.length} apport(s) non comptés, teneur ou dose inconnue` : ""}.`,
        value: total,
        threshold: COPPER.maxKgPerHa,
        unit: "kg Cu/ha",
        ...(b.breach ? { breach: b.breach } : {}),
        missing: unknown.map((a) => missing(`teneur en cuivre de ${a.product}`, "article", a.articleId)),
        refs: { parcelIds: [p.id], interventionIds: apps.map((a) => a.interventionId), articleIds: [...new Set(apps.map((a) => a.articleId))] },
        source: cite(COPPER_SOURCE),
      }),
    ];
  });
}

// --- Fertilisation -------------------------------------------------------------------

/** R14, R15, R17 : fertilisants hors annexe II, azote minéral, effluents d'élevage industriel. */
export function fertilizerFindings(applications: AbApplication[], names: Map<string, string>): ControlFinding[] {
  const source = cite(ANNEX_II_SOURCE);
  return applications
    .filter((a) => a.kind === "fertilizer")
    .flatMap((a) => {
      const where = `${names.get(a.parcelId) ?? "parcelle"}, ${fr(a.day)}`;
      const refs = { parcelIds: [a.parcelId], interventionIds: [a.interventionId], articleIds: [a.articleId] };
      if (a.syntheticNitrogen) {
        const b = breach("R15");
        return [finding({ ruleId: "ab.R15", level: b.level, message: `${where} : ${a.product} est un engrais azoté minéral, interdit en AB.`, breach: b.breach, refs, source })];
      }
      if (!a.categories?.length) {
        return [
          finding({
            ruleId: "ab.R14",
            level: "missing",
            message: `${where} : ${a.product} — catégories de l'annexe II non renseignées sur le fertilisant.`,
            missing: [missing("catégories AB du fertilisant", "article", a.articleId)],
            refs,
            source,
          }),
        ];
      }
      const outside = a.categories.filter((c) => !ANNEX_II_BY_CODE[c]);
      if (outside.length) {
        const b = breach("R14");
        return [finding({ ruleId: "ab.R14", level: b.level, message: `${where} : ${a.product} contient une matière hors de l'annexe II${outside.some((c) => c !== "outside") ? ` (${outside.filter((c) => c !== "outside").join(", ")})` : ""}.`, breach: b.breach, refs, source })];
      }
      const ei = a.categories.map((c) => ANNEX_II_BY_CODE[c]!).filter((c) => c.industrialForbidden);
      if (!ei.length) return [];
      if (a.effluentOrigin === "industrial") {
        const b = breach("R17");
        return [finding({ ruleId: "ab.R17", level: b.level, message: `${where} : ${a.product} provient d'un élevage industriel, interdit en AB.`, breach: b.breach, refs, source })];
      }
      if (a.effluentOrigin === "organic" || a.effluentOrigin === "conventional") return [];
      return [
        finding({
          ruleId: "ab.R17",
          level: "warning",
          message: `${where} : ${a.product} (${ei.map((c) => c.label.toLowerCase()).join(", ")}) — provenance de l'élevage à justifier (élevage industriel interdit).`,
          refs,
          source,
        }),
      ];
    });
}

/** Apport compté dans le plafond de 170 kg N/ha (effluents d'élevage) ; null : on ne sait pas. */
function counts170(a: AbApplication): boolean | null {
  if (a.kind !== "fertilizer" || a.syntheticNitrogen) return false;
  if (!a.categories?.length) return null;
  return a.categories.some((c) => ANNEX_II_BY_CODE[c]?.counts170N);
}

/** R16 : azote total des effluents d'élevage par parcelle AB et par période (orange au-delà : n° 40, mineur). */
export function nitrogenFindings(parcels: { id: string; name: string }[], applications: AbApplication[], from: string, to: string): ControlFinding[] {
  return parcels.flatMap((p) => {
    const apps = applications.filter((a) => a.parcelId === p.id && a.day >= from && a.day <= to && counts170(a) !== false);
    if (!apps.length) return [];
    const counted = apps.filter((a) => counts170(a) === true && typeof a.nTotalKgHa === "number");
    const unknown = apps.filter((a) => counts170(a) === null || a.nTotalKgHa === null || a.nTotalKgHa === undefined);
    const total = Math.round(counted.reduce((sum, a) => sum + a.nTotalKgHa!, 0));
    const over = total > ORGANIC_NITROGEN.maxKgPerHa;
    const near = total >= Math.round(ORGANIC_NITROGEN.maxKgPerHa * ORGANIC_NITROGEN.warnShare * 10) / 10;
    const b = over ? breach("R16") : null;
    return [
      finding({
        ruleId: "ab.R16",
        level: over ? b!.level : near ? "warning" : "ok",
        message: `${p.name} : ${total} kg N/ha d'effluents d'élevage du ${fr(from)} au ${fr(to)} (plafond ${ORGANIC_NITROGEN.maxKgPerHa} kg)${over ? " : plafond dépassé" : near ? " : proche du plafond" : ""}${unknown.length ? ` ; ${unknown.length} apport(s) non comptés (catégorie ou teneur inconnue)` : ""}.`,
        value: total,
        threshold: ORGANIC_NITROGEN.maxKgPerHa,
        unit: "kg N/ha",
        ...(b?.breach ? { breach: b.breach } : {}),
        missing: unknown.map((a) => missing(counts170(a) === null ? `catégories AB de ${a.product}` : `teneur en azote ou dose de ${a.product}`, "article", a.articleId)),
        refs: { parcelIds: [p.id], interventionIds: apps.map((a) => a.interventionId) },
        source: cite(ORGANIC_NITROGEN_SOURCE),
      }),
    ];
  });
}
