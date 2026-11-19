import type { CertificationSettings, ControlFinding, ControlKind, ControlLevel, ControlSection } from "@fourmy/contracts";
import { finding, section, verdictOf, worstControlLevel } from "./report.js";

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
}

export type CampaignRule = (ctx: CertificationContext) => ControlFinding[];

export interface RuleSection {
  id: string;
  label: string;
  /** HVE : minimum et maximum de points de l'indicateur. */
  points?: { min: number; max: number };
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

/** Sections de chaque contrôle ; les règles arrivent avec les lots CT2 à CT5. */
export const CAMPAIGN_SECTIONS: Record<ControlKind, RuleSection[]> = {
  hve: [{ id: "perimeter", label: "Périmètre", rules: [perimeter] }],
  ab: [{ id: "perimeter", label: "Périmètre", rules: [perimeter] }],
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
}

export type InterventionRule = (input: InterventionCertificationInput) => ControlFinding[];

/** Règles de saisie, par contrôle ; ajoutées par les lots CT2 à CT5. */
export const INTERVENTION_RULES: Record<ControlKind, InterventionRule[]> = { hve: [], ab: [] };

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
