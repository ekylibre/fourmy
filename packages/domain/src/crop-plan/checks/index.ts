import type { ControlSection, CropPlanDraft, CropPlanSettings } from "@fourmy/contracts";
import { section } from "../../certification/report.js";
import type { CropPlanActivity, CropPlanBaseParcel, CropPlanHistory } from "../model.js";
import { resolveParcels, type ResolvedPlan } from "../resolve.js";
import { agronomyFindings } from "./agronomy.js";
import { bcae7Findings, bcae7Parcels } from "./bcae7.js";
import { abPlanFindings, hvePlanFindings, type CropPlanCertificationContext } from "./certification.js";
import { regulatoryFindings, type CropPlanZones } from "./regulatory.js";

export * from "./bcae7.js";
export * from "./agronomy.js";
export * from "./certification.js";
export * from "./regulatory.js";

/**
 * Contrôles de l'assolement en direct (conception §4, FR-AS-9) : un appel
 * par geste dans le navigateur, le même à la validation sur le serveur.
 * Sections : PAC, Agronomie, Certifications, Réglementaire.
 */
export interface CropPlanCheckInput {
  base: CropPlanBaseParcel[];
  draft: CropPlanDraft;
  activities: ReadonlyMap<string, CropPlanActivity>;
  history: CropPlanHistory;
  settings: CropPlanSettings;
  certification: CropPlanCertificationContext;
  /** Zonages des parcelles de départ (captages, Natura 2000, points d'eau). */
  zones?: CropPlanZones;
}

export interface CropPlanCheckResult {
  plan: ResolvedPlan;
  sections: ControlSection[];
}

export function checkCropPlan(input: CropPlanCheckInput): CropPlanCheckResult {
  const { base, draft, activities, history, settings, certification } = input;
  const plan = resolveParcels(base, draft);
  const parcels = bcae7Parcels(plan, draft, activities, history);
  // Ferme entièrement AB : toutes les parcelles de départ certifiées.
  const allOrganic = base.length > 0 && base.every((p) => certification.abParcels.has(p.id));
  const sections: ControlSection[] = [
    section("pac", "PAC", bcae7Findings(parcels, { year: draft.year, allOrganic, alsaceRhinePlain: settings.alsaceRhinePlain })),
    section("agronomy", "Agronomie", agronomyFindings(parcels, draft.year, settings.returnIntervals)),
  ];
  const ctx = { plan, draft, activities, history, context: certification };
  const certFindings = [...abPlanFindings(ctx), ...hvePlanFindings(ctx)];
  if (certFindings.length) sections.push(section("certification", "Certifications", certFindings));
  sections.push(section("regulatory", "Réglementaire", regulatoryFindings({ plan, draft, activities, history, zones: input.zones ?? {} })));
  return { plan, sections };
}
