import type { CertificationSettings, ControlFinding, ControlKind, ControlLevel, ControlSection } from "@fourmy/contracts";
import { finding, section, verdictOf, worstControlLevel } from "./report.js";
import {
  abParcelStatuses,
  conversionFindings,
  copperFindings,
  fertilizerFindings,
  growingModeFindings,
  justificationFindings,
  mixityFindings,
  nitrogenFindings,
  phytoFindings,
  seedFindings,
  equipmentFindings,
  rotationFindings,
  uncontrolledFindings,
  type AbEquipmentEvent,
  type AbRotationYear,
  type AbApplication,
  type AbParcelInput,
  type AbProduction,
  type NonAbProduction,
} from "./ab.js";
import { cmrInterventionFindings, hvePhytoFindings, type HvePhytoContext } from "./hve/phyto.js";
import { hveFertilizationFindings, type HveFertilizationContext } from "./hve/fertilization.js";
import { hveIrrigationFindings, type HveIrrigationContext } from "./hve/irrigation.js";
import { hveBiodiversityFindings, type HveBiodiversityContext } from "./hve/biodiversity.js";
import { HVE_INDICATOR_MIN } from "@fourmy/certification-refs";

/**
 * Moteur des contrôles HVE et AB (claudedocs/conception_controle_hve_ab.md
 * §5) : les règles sont des fonctions pures du contexte d'une campagne
 * (tableau de bord) ou d'une intervention (saisie). Les lots CT2 à CT5
 * ajoutent leurs règles aux listes `CAMPAIGN_SECTIONS` et `INTERVENTION_RULES`.
 */

/** Certification d'une parcelle (table parcel_certifications). */
export interface ParcelCertificationRef {
  parcelId: string;
  kind: ControlKind;
  /** AB : « conversion » ou « certified » (saisi, contrôlé) ; HVE : niveau. */
  level: string | null;
  startedOn: string;
  stoppedOn: string | null;
}

export interface CertificationParcel {
  id: string;
  name: string;
  /** Surface réelle (m²) pendant la campagne. */
  areaM2: number;
}

/** Données d'une campagne, assemblées par l'API (repos/certification-context.ts). */
export interface CertificationContext {
  kind: ControlKind;
  campaign: number;
  period: { from: string; to: string };
  parcels: CertificationParcel[];
  certifications: ParcelCertificationRef[];
  settings: CertificationSettings;
  /**
   * Agriculture biologique : parcelles certifiées, productions, et intrants
   * apportés depuis 7 ans (cuivre) jusqu'à la fin de la période.
   */
  ab?: {
    parcels: AbParcelInput[];
    productions: AbProduction[];
    applications: AbApplication[];
    /** Productions des parcelles non AB de la campagne (mixité). */
    others?: NonAbProduction[];
    /** Usages et nettoyages des matériels (R27). */
    equipment?: AbEquipmentEvent[];
    /** Historique des cultures des parcelles AB (R11). */
    rotation?: Map<string, { name: string; years: AbRotationYear[] }>;
  };
  /** HVE : SAU, traitements et IFT de la période (et des deux précédentes pour la moyenne), références. */
  hve?: { phyto: HvePhytoContext; fertilization?: HveFertilizationContext; irrigation?: HveIrrigationContext; biodiversity?: HveBiodiversityContext };
}

export type CampaignRule = (ctx: CertificationContext) => ControlFinding[];

export interface RuleSection {
  id: string;
  label: string;
  /** HVE : minimum de points de l'indicateur (maximum : somme des items). */
  points?: { min: number; max?: number };
  rules: CampaignRule[];
}

/** Parcelles certifiées pendant la période (au moins un jour en commun). */
export function certifiedParcels(ctx: Pick<CertificationContext, "kind" | "period" | "certifications">): ParcelCertificationRef[] {
  return ctx.certifications.filter((c) => c.kind === ctx.kind && c.startedOn <= ctx.period.to && (c.stoppedOn === null || c.stoppedOn >= ctx.period.from));
}

/** Périmètre du contrôle : parcelles certifiées et surface (section commune aux deux contrôles). */
const perimeter: CampaignRule = (ctx) => {
  const certified = certifiedParcels(ctx);
  const ids = new Set(certified.map((c) => c.parcelId));
  const areaHa = ctx.parcels.filter((p) => ids.has(p.id)).reduce((sum, p) => sum + p.areaM2, 0) / 10_000;
  const totalHa = ctx.parcels.reduce((sum, p) => sum + p.areaM2, 0) / 10_000;
  const fr = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
  const message =
    ctx.kind === "hve"
      ? `HVE porte sur l'exploitation entière (${fr(totalHa)} ha) : ${ids.size} parcelle(s) déclarée(s) certifiée(s).`
      : `${ids.size} parcelle(s) en conversion ou certifiée(s) AB, ${fr(areaHa)} ha sur ${fr(totalHa)} ha.`;
  return [
    finding({
      ruleId: `${ctx.kind}.perimeter`,
      level: ids.size ? "ok" : "na",
      message,
      value: ctx.kind === "hve" ? totalHa : areaHa,
      unit: "ha",
      refs: { parcelIds: [...ids] },
      source: ctx.kind === "hve" ? "Plan de contrôle HVE niveau 3 V4.4, §2" : "Règlement (UE) 2018/848, art. 9.2 et 9.7",
    }),
  ];
};

const inPeriod = (ctx: CertificationContext) => (ctx.ab?.applications ?? []).filter((a) => a.day >= ctx.period.from && a.day <= ctx.period.to);
const parcelNames = (ctx: CertificationContext) => new Map((ctx.ab?.parcels ?? []).map((p) => [p.id, p.name]));

/** Statut de conversion des parcelles AB à la fin de la période (lot CT2). */
export function abStatuses(ctx: CertificationContext) {
  return ctx.ab ? abParcelStatuses(ctx.ab.parcels, ctx.ab.productions, ctx.ab.applications, ctx.period.to) : [];
}

/** Sections de chaque contrôle ; fertilisation, irrigation (CT3) et biodiversité (CT4) à venir. */
export const CAMPAIGN_SECTIONS: Record<ControlKind, RuleSection[]> = {
  hve: [
    { id: "perimeter", label: "Périmètre", rules: [perimeter] },
    {
      id: "biodiversity",
      label: "Biodiversité",
      points: { min: HVE_INDICATOR_MIN },
      rules: [(ctx) => (ctx.hve?.biodiversity ? hveBiodiversityFindings(ctx.hve.biodiversity) : [])],
    },
    { id: "phyto", label: "Stratégie phytosanitaire", points: { min: HVE_INDICATOR_MIN }, rules: [(ctx) => (ctx.hve ? hvePhytoFindings(ctx.hve.phyto) : [])] },
    {
      id: "fertilization",
      label: "Gestion de la fertilisation",
      points: { min: HVE_INDICATOR_MIN },
      rules: [(ctx) => (ctx.hve?.fertilization ? hveFertilizationFindings(ctx.hve.fertilization, ctx.hve.phyto.answers?.interRowCoverPercent) : [])],
    },
    {
      id: "irrigation",
      label: "Gestion de l'irrigation",
      points: { min: HVE_INDICATOR_MIN },
      rules: [(ctx) => (ctx.hve?.irrigation ? hveIrrigationFindings(ctx.hve.irrigation) : [])],
    },
  ],
  ab: [
    { id: "perimeter", label: "Périmètre", rules: [perimeter] },
    { id: "conversion", label: "Conversion", rules: [(ctx) => conversionFindings(abStatuses(ctx))] },
    {
      id: "treatments",
      label: "Traitements",
      rules: [
        (ctx) => phytoFindings(inPeriod(ctx), parcelNames(ctx)),
        (ctx) => justificationFindings(inPeriod(ctx), parcelNames(ctx)),
        (ctx) => copperFindings(ctx.ab?.parcels ?? [], ctx.ab?.applications ?? [], ctx.period.to),
      ],
    },
    { id: "seeds", label: "Semences et plants", rules: [(ctx) => seedFindings(inPeriod(ctx), parcelNames(ctx))] },
    {
      id: "production",
      label: "Mode de production",
      rules: [(ctx) => growingModeFindings(ctx.ab?.productions ?? [], parcelNames(ctx)), (ctx) => mixityFindings(ctx.ab?.productions ?? [], ctx.ab?.others ?? [])],
    },
    {
      id: "rotation",
      label: "Rotation",
      rules: [(ctx) => (ctx.ab?.rotation ? rotationFindings(ctx.ab.rotation, ctx.campaign, ctx.settings.rotationYears, ctx.settings.rotationSameSpeciesMax) : [])],
    },
    { id: "equipment", label: "Matériel à usage mixte", rules: [(ctx) => equipmentFindings(ctx.ab?.equipment ?? [], ctx.period.from, ctx.period.to)] },
    {
      id: "fertilization",
      label: "Fertilisation",
      rules: [(ctx) => fertilizerFindings(inPeriod(ctx), parcelNames(ctx)), (ctx) => nitrogenFindings(ctx.ab?.parcels ?? [], inPeriod(ctx), ctx.period.from, ctx.period.to)],
    },
    { id: "uncontrolled", label: "Règles non contrôlées", rules: [() => uncontrolledFindings()] },
  ],
};

/** Rapport d'une campagne (sans les champs d'enregistrement : date de calcul, export). */
export function evaluateCampaign(ctx: CertificationContext, sections: RuleSection[] = CAMPAIGN_SECTIONS[ctx.kind]) {
  const out: ControlSection[] = sections.map((s) => section(s.id, s.label, s.rules.flatMap((rule) => rule(ctx)).map(finding), s.points));
  return { kind: ctx.kind, campaign: ctx.campaign, period: ctx.period, verdict: verdictOf(out), sections: out };
}

// --- Saisie d'une intervention -------------------------------------------------------

/** Intervention en saisie, avec les certifications de ses parcelles à sa date. */
export interface InterventionCertificationInput {
  procedure: string;
  /** Date de l'intervention (AAAA-MM-JJ). */
  day: string;
  parcelIds: string[];
  /** Certifications actives à la date, par parcelle. */
  certifications: ParcelCertificationRef[];
  inputs: { articleId: string; quantity: number; per: "hectare" | "total"; unit?: string }[];
  equipmentIds: string[];
  justification: string | null;
  /**
   * Agriculture biologique : parcelles AB de l'intervention, intrants saisis
   * (ramenés à l'hectare, par parcelle) et apports réalisés avant (cumuls du
   * cuivre sur 7 ans et de l'azote sur l'année).
   */
  ab?: {
    parcels: { id: string; name: string }[];
    current: AbApplication[];
    history: AbApplication[];
    /** Matériel venu d'une parcelle non AB sans nettoyage depuis (R27). */
    uncleaned?: { equipment: string; lastUseOn: string }[];
  };
  /** HVE : produits phytopharmaceutiques saisis (n° d'autorisation), pour le classement CMR à la date. */
  hve?: { products: { articleId: string; product: string; authorization: string | null }[] };
}

export type InterventionRule = (input: InterventionCertificationInput) => ControlFinding[];

/** Saisie AB : produits interdits, et cumuls cuivre et azote avec l'apport saisi. */
const abIntervention: InterventionRule = (input) => {
  if (!input.ab) return [];
  const { parcels, current, history } = input.ab;
  const names = new Map(parcels.map((p) => [p.id, p.name]));
  const year = input.day.slice(0, 4);
  const withCopper = parcels.filter((p) => current.some((a) => a.parcelId === p.id && a.copperKgHa !== undefined));
  const withEffluent = parcels.filter((p) => current.some((a) => a.parcelId === p.id && a.kind === "fertilizer" && !a.syntheticNitrogen));
  const all = [...history, ...current];
  return [
    ...phytoFindings(current, names),
    ...justificationFindings(current, names),
    ...seedFindings(current, names),
    ...(input.ab.uncleaned ?? []).map((u) =>
      finding({
        ruleId: "ab.R27",
        level: "warning",
        message: `${u.equipment} : dernier usage hors AB le ${u.lastUseOn.split("-").reverse().join("/")}, sans nettoyage enregistré depuis : enregistrez le nettoyage avant cette intervention.`,
        source: "Règlement (UE) 2018/848, art. 9.2 ; GDL INAO l. 72",
      }),
    ),
    ...fertilizerFindings(current, names),
    ...copperFindings(withCopper, all, input.day > `${year}-12-31` ? input.day : `${year}-12-31`),
    ...nitrogenFindings(withEffluent, all, `${year}-01-01`, `${year}-12-31`).filter((f) => f.level !== "ok" || (f.value ?? 0) > 0),
  ];
};

/** Règles de saisie, par contrôle. */
export const INTERVENTION_RULES: Record<ControlKind, InterventionRule[]> = {
  hve: [(input) => (input.hve ? cmrInterventionFindings(input.day, input.hve.products) : [])],
  ab: [abIntervention],
};

/**
 * Constats de certification d'une intervention ; `null` si aucune de ses
 * parcelles n'est certifiée à sa date ou si aucune règle ne la concerne
 * (rien n'est enregistré : coût nul pour une ferme sans certification).
 */
export function evaluateIntervention(
  input: InterventionCertificationInput,
  rules: Record<ControlKind, InterventionRule[]> = INTERVENTION_RULES,
): { level: ControlLevel; findings: ControlFinding[] } | null {
  const kinds = new Set(input.certifications.map((c) => c.kind));
  const findings = [...kinds].flatMap((k) => rules[k].flatMap((rule) => rule(input))).map(finding);
  if (!findings.length) return null;
  return { level: worstControlLevel(findings.map((f) => f.level)), findings };
}
