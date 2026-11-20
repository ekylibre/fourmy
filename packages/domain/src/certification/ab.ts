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
  kind: "phyto" | "fertilizer" | "seed";
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
  /** Phyto : justification de la nécessité saisie sur l'intervention (R20). */
  justified?: boolean;
  /** Semence ou plant (R24, R25) : statut bio, traité, plant (repiquage), dérogation obtenue pour la saison. */
  organicStatus?: "organic" | "conversion" | "conventional" | null;
  seedTreated?: boolean | null;
  plant?: boolean;
  derogation?: { grantedOn: string; reference: string | null } | null;
}

export interface AbProduction {
  id: string;
  parcelId: string;
  label: string;
  /** Espèce (taxonomie) et variété, pour la mixité (R7) ; mode de culture (R10, R13). */
  species?: string | null;
  variety?: string | null;
  cultivationMode?: string | null;
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

// --- Lot CT5a : semences, justification, hors-sol et serres, mixité --------------------------

/** R24, R25 : semences et plants semés sur une parcelle AB. */
export function seedFindings(applications: AbApplication[], names: Map<string, string>): ControlFinding[] {
  const source = "Règlement (UE) 2018/848, annexe II partie I 1.8.1 à 1.8.5, p. 58-59";
  return applications
    .filter((a) => a.kind === "seed" && a.organicStatus !== "organic")
    .map((a) => {
      const where = `${names.get(a.parcelId) ?? "parcelle"}, ${fr(a.day)}`;
      const refs = { parcelIds: [a.parcelId], interventionIds: [a.interventionId], articleIds: [a.articleId] };
      if (a.organicStatus === null || a.organicStatus === undefined) {
        return finding({ ruleId: "ab.R24", level: "missing", message: `${where} : ${a.product} — statut biologique de la semence à renseigner sur l'article.`, missing: [missing("statut biologique de la semence", "article", a.articleId)], refs, source });
      }
      const status = a.organicStatus === "conversion" ? "en conversion" : "non biologique";
      if (a.plant) {
        const b = breach("R24");
        return finding({ ruleId: "ab.R24", level: b.level, message: `${where} : plants ${status} (${a.product}) : les plants doivent être biologiques, sans dérogation possible.`, breach: b.breach, refs, source });
      }
      if (a.seedTreated === null || a.seedTreated === undefined) {
        return finding({ ruleId: "ab.R24", level: "missing", message: `${where} : ${a.product} (${status}) — traitement de la semence à renseigner sur l'article.`, missing: [missing("semence traitée ou non", "article", a.articleId)], refs, source });
      }
      if (a.seedTreated) {
        const b = breach("R24");
        return finding({ ruleId: "ab.R24", level: b.level, message: `${where} : semence ${status} traitée (${a.product}), interdite en AB.`, breach: b.breach, refs, source });
      }
      if (!a.derogation) {
        const b = breach("R25_none");
        return finding({ ruleId: "ab.R25", level: b.level, message: `${where} : semence ${status} (${a.product}) sans dérogation pour la saison.`, breach: b.breach, refs, source });
      }
      if (a.derogation.grantedOn > a.day) {
        const b = breach("R25");
        return finding({
          ruleId: "ab.R25",
          level: b.level,
          message: `${where} : semence ${status} (${a.product}), dérogation obtenue après le semis (le ${fr(a.derogation.grantedOn)}).`,
          breach: b.breach,
          refs,
          source,
        });
      }
      return finding({
        ruleId: "ab.R25",
        level: "ok",
        message: `${where} : semence ${status} non traitée (${a.product}) sous dérogation${a.derogation.reference ? ` n° ${a.derogation.reference}` : ""} du ${fr(a.derogation.grantedOn)}.`,
        refs,
        source,
      });
    });
}

/** R20 : traitement autorisé en AB sans justification de sa nécessité (orange : n° 44, mineur). */
export function justificationFindings(applications: AbApplication[], names: Map<string, string>): ControlFinding[] {
  const unjustified = applications.filter((a) => a.kind === "phyto" && a.organicAllowed === true && a.justified === false);
  const byIntervention = new Map<string, AbApplication[]>();
  for (const a of unjustified) byIntervention.set(a.interventionId, [...(byIntervention.get(a.interventionId) ?? []), a]);
  return [...byIntervention.values()].map((apps) => {
    const a = apps[0]!;
    const b = breach("R20");
    return finding({
      ruleId: "ab.R20",
      level: b.level,
      message: `${names.get(a.parcelId) ?? "parcelle"}, ${fr(a.day)} : traitement (${[...new Set(apps.map((x) => x.product))].join(", ")}) sans justification de sa nécessité (observation, risque, échec des mesures préventives).`,
      breach: b.breach,
      refs: { parcelIds: [...new Set(apps.map((x) => x.parcelId))], interventionIds: [a.interventionId] },
      source: "Règlement (UE) 2018/848, annexe II partie I 1.10.2",
    });
  });
}

/** R10, R13 : culture hors sol, en pot ou en conteneur, serre chauffée, sur une parcelle AB. */
export function growingModeFindings(productions: AbProduction[], names: Map<string, string>): ControlFinding[] {
  return productions.flatMap((p) => {
    const where = `${names.get(p.parcelId) ?? "parcelle"} (${p.label})`;
    const refs = { parcelIds: [p.parcelId] };
    if (p.cultivationMode === "soilless") {
      const b = breach("R10_hydroponic");
      return [finding({ ruleId: "ab.R10", level: b.level, message: `${where} : culture hors sol, interdite en AB (sauf exceptions du point 1.4).`, breach: b.breach, refs, source: "Règlement (UE) 2018/848, annexe II partie I 1.1 et 1.4" })];
    }
    if (p.cultivationMode === "pot" || p.cultivationMode === "container") {
      return [finding({ ruleId: "ab.R10", level: "warning", message: `${where} : culture en pot ou en conteneur, admise seulement dans les cas du point 1.4 (plants, plantes ornementales et aromatiques vendues en pot) : à vérifier.`, refs, source: "Règlement (UE) 2018/848, annexe II partie I 1.4" })];
    }
    if (p.cultivationMode === "heated_shelter") {
      return [finding({ ruleId: "ab.R13", level: "warning", message: `${where} : serre chauffée : le chauffage doit être d'origine renouvelable (sauf plants), à justifier.`, refs, source: "Règlement (UE) 2018/848, annexe II partie I 1.6.6 ; INAO n° 362" })];
    }
    return [];
  });
}

/**
 * R7 : mixité, même espèce cultivée en AB et hors AB la même campagne. Variétés
 * différentes : admis (à distinguer) ; même variété : non conforme (n° 31) ;
 * variété inconnue : à renseigner.
 */
export function mixityFindings(abProductions: AbProduction[], others: { species: string; label: string; variety: string | null }[]): ControlFinding[] {
  const out: ControlFinding[] = [];
  const bySpecies = new Map<string, AbProduction[]>();
  for (const p of abProductions) if (p.species) bySpecies.set(p.species, [...(bySpecies.get(p.species) ?? []), p]);
  for (const [species, ab] of bySpecies) {
    const non = others.filter((o) => o.species === species);
    if (!non.length) continue;
    const label = ab[0]!.label;
    const abVarieties = ab.map((p) => p.variety?.trim().toLowerCase() ?? null);
    const nonVarieties = non.map((o) => o.variety?.trim().toLowerCase() ?? null);
    const source = "Règlement (UE) 2018/848, art. 9.7 et 9.8";
    if ([...abVarieties, ...nonVarieties].includes(null)) {
      out.push(finding({ ruleId: "ab.R7", level: "missing", message: `${label} cultivé(e) en AB et hors AB : variétés à renseigner (critère de distinction).`, missing: ab.filter((p) => !p.variety).map((p) => missing(`variété (${p.label})`, "production", p.id)), refs: { parcelIds: ab.map((p) => p.parcelId) }, source }));
      continue;
    }
    const shared = abVarieties.filter((v) => nonVarieties.includes(v));
    if (shared.length) {
      const b = breach("R7");
      out.push(finding({ ruleId: "ab.R7", level: b.level, message: `${label} : même variété (${[...new Set(shared)].join(", ")}) en AB et hors AB la même campagne : mixité non autorisée.`, breach: b.breach, refs: { parcelIds: ab.map((p) => p.parcelId) }, source }));
    } else {
      out.push(finding({ ruleId: "ab.R7", level: "ok", message: `${label} : cultivé(e) en AB et hors AB avec des variétés différentes, facilement distinguables : séparation et registre à tenir.`, refs: { parcelIds: ab.map((p) => p.parcelId) }, source }));
    }
  }
  return out;
}

// --- Lot CT5b : matériel à usage mixte, rotation, règles non contrôlées ----------------------

/** Usage ou nettoyage d'un matériel (interventions réalisées). */
export interface AbEquipmentEvent {
  equipmentId: string;
  equipment: string;
  interventionId: string;
  /** Début de l'intervention (ISO). */
  at: string;
  kind: "use" | "cleaning";
  /** Usage : toutes les parcelles ciblées sont en AB (ou en conversion) à cette date. */
  organic: boolean;
  parcelIds: string[];
}

/**
 * R27 : un matériel utilisé sur une parcelle AB après un usage hors AB, sans
 * nettoyage enregistré entre les deux (orange : description insuffisante des
 * mesures, n° 19 ; l'absence de toute mesure, n° 350, relève de l'audit).
 */
export function equipmentFindings(events: AbEquipmentEvent[], from: string, to: string): ControlFinding[] {
  const out: ControlFinding[] = [];
  const byEquipment = new Map<string, AbEquipmentEvent[]>();
  for (const e of events) byEquipment.set(e.equipmentId, [...(byEquipment.get(e.equipmentId) ?? []), e]);
  for (const list of byEquipment.values()) {
    const sorted = [...list].sort((a, b) => a.at.localeCompare(b.at));
    for (let i = 1; i < sorted.length; i++) {
      const cur = sorted[i]!;
      const prev = sorted[i - 1]!;
      const day = cur.at.slice(0, 10);
      if (cur.kind !== "use" || !cur.organic || day < from || day > to) continue;
      if (prev.kind === "use" && !prev.organic) {
        const b = breach("R27_unrecorded");
        out.push(
          finding({
            ruleId: "ab.R27",
            level: b.level,
            message: `${cur.equipment} : utilisé sur une parcelle AB le ${fr(day)} après un usage hors AB le ${fr(prev.at.slice(0, 10))}, sans nettoyage enregistré entre les deux.`,
            breach: b.breach,
            refs: { parcelIds: cur.parcelIds, interventionIds: [prev.interventionId, cur.interventionId] },
            source: "Règlement (UE) 2018/848, art. 9.2 et annexe II partie I 1.11 ; GDL INAO l. 72",
          }),
        );
      }
    }
  }
  return out;
}

/** Une campagne d'une parcelle AB pour la rotation. */
export interface AbRotationYear {
  campaign: number;
  /** Espèce de la culture principale ; null : aucune production connue. */
  species: string | null;
  label: string | null;
  legume: boolean;
  /** Couvert ou dérobée de légumineuses (famille du couvert). */
  coverLegume: boolean;
  vegetable: boolean;
  /** Pérenne, prairie ou fourrage pérenne : hors rotation. */
  perennial: boolean;
}

/**
 * R11 : rotation pluriannuelle par parcelle AB, sur N campagnes (réglable) :
 * une légumineuse au moins (culture ou couvert), la même espèce au plus K
 * années de suite, 3 espèces au moins en maraîchage. Repères du guide de
 * lecture INAO, appréciés par l'organisme certificateur : orange seulement
 * (n° 39, mineur).
 */
export function rotationFindings(history: Map<string, { name: string; years: AbRotationYear[] }>, campaign: number, years: number, sameSpeciesMax: number): ControlFinding[] {
  const source = "Règlement (UE) 2018/848, annexe II partie I 1.9.2 a ; GDL INAO l. 136-137 (11/07/2024)";
  const out: ControlFinding[] = [];
  for (const [parcelId, { name, years: all }] of history) {
    const window = all.filter((y) => y.campaign > campaign - years && y.campaign <= campaign).sort((a, b) => a.campaign - b.campaign);
    const current = window.find((y) => y.campaign === campaign);
    if (!current || current.perennial) continue;
    const known = window.filter((y) => y.species);
    const refs = { parcelIds: [parcelId] };
    if (known.length < years) {
      out.push(
        finding({
          ruleId: "ab.R11",
          level: "missing",
          message: `${name} : ${known.length} campagne(s) connue(s) sur ${years} : historique de culture à compléter (imports N-1 à N-5).`,
          missing: [missing(`historique de culture (${years} campagnes)`, "parcel", parcelId)],
          refs,
          source,
        }),
      );
      continue;
    }
    const issues: string[] = [];
    if (!window.some((y) => y.legume || y.coverLegume)) issues.push(`aucune légumineuse (culture ou couvert) en ${years} campagnes`);
    let run = 1;
    let longest = 1;
    for (let i = 1; i < known.length; i++) {
      run = known[i]!.species === known[i - 1]!.species && known[i]!.campaign === known[i - 1]!.campaign + 1 ? run + 1 : 1;
      longest = Math.max(longest, run);
    }
    if (longest > sameSpeciesMax) issues.push(`même espèce ${longest} années de suite (repère : ${sameSpeciesMax} au plus)`);
    if (window.some((y) => y.vegetable)) {
      const species = new Set(known.filter((y) => y.vegetable).map((y) => y.species));
      if (species.size < 3) issues.push(`${species.size} espèce(s) légumière(s) seulement (3 au moins en maraîchage)`);
    }
    const sequence = known.map((y) => `${y.campaign} ${y.label ?? y.species}`).join(", ");
    if (issues.length) {
      const b = breach("R11");
      out.push(finding({ ruleId: "ab.R11", level: "warning", message: `${name} : rotation à justifier : ${issues.join(" ; ")} (${sequence}).`, breach: b.breach, refs, source }));
    } else {
      out.push(finding({ ruleId: "ab.R11", level: "ok", message: `${name} : rotation diversifiée avec légumineuse (${sequence}).`, refs, source }));
    }
  }
  return out;
}

/** Règles du règlement que Fourmy ne contrôle pas (ou pas encore), dites explicitement. */
export const AB_UNCONTROLLED: [rule: string, label: string, reason: string][] = [
  ["R3", "Date de début de la conversion", "date de début lue sur la certification de la parcelle (notification à l'Agence Bio non vérifiée)"],
  ["R4", "Reconnaissance rétroactive", "décision de l'organisme certificateur, hors saisie"],
  ["R6", "Terres liées à l'élevage", "élevage hors du périmètre (production végétale)"],
  ["R8", "Pérennes en plan de conversion (préavis de 48 h)", "déclarations à l'organisme certificateur non suivies"],
  ["R9", "Obligations en cas de mixité (séparation, registre)", "registre et séparation des lots non suivis ; la mixité elle-même est contrôlée (R7)"],
  ["R12", "Serres et pérennes : engrais verts, légumineuses", "recommandation sans seuil chiffré"],
  ["R18", "Préférence pour les effluents bio et compostés", "préférence, sans seuil"],
  ["R19", "Priorité à la prévention (vapeur, paillages)", "pratiques non saisies"],
  ["R22", "Pièges et distributeurs", "non saisis"],
  ["R23", "OGM et rayonnements ionisants", "attestations fournisseurs non suivies"],
  ["R26", "Matériel hétérogène biologique", "type de semence non saisi"],
  ["R28", "Produits de nettoyage et de désinfection", "liste des produits admis non intégrée ; produits du nettoyage à présenter à l'audit"],
  ["R29", "Stockage des produits et des intrants", "stocks sans statut AB"],
  ["R30", "Collecte et transport", "hors périmètre de l'exploitation"],
  ["R31", "Mesures de précaution (dérive, contaminations)", "appréciation de l'audit"],
  ["R32", "Soupçon de non-conformité", "procédure d'enquête, hors saisie"],
  ["R33", "Certificats des fournisseurs", "certificats non rattachés aux achats"],
  ["R34", "Catastrophes, dérogations exceptionnelles", "décision de l'autorité, hors saisie"],
];

export function uncontrolledFindings(): ControlFinding[] {
  return AB_UNCONTROLLED.map(([rule, label, reason]) =>
    finding({ ruleId: `ab.${rule}`, level: "na", message: `${rule} ${label} : non contrôlé par Fourmy (${reason}).`, source: "docs/ab/rapport_ab.md §2 et §8.3.3" }),
  );
}
