import { getProcedure, type ItkContent, type ItineraryRef, type PlannedItem, type PlannedState } from "@fourmy/contracts";
import { scheduleSteps } from "./schedule.js";

/**
 * Interventions prévues d'une campagne d'après les ITK des productions
 * (lot IT3, claudedocs/conception_assolement_itk.md §7) : proposition, puis
 * rapprochement avec les interventions déjà générées. Pur : le dépôt lit et
 * écrit, ces fonctions décident.
 */

export interface PlannedProduction {
  id: string;
  parcelId: string;
  parcelName: string;
  areaM2: number;
  activityName: string;
  campaign: number;
  itineraryId: string;
  /** Semis et récolte prévus (production, sinon dates types de l'activité). */
  sowingOn: string | null;
  harvestOn: string | null;
}

export interface PlannedItinerary {
  id: string;
  name: string;
  revision: number;
  content: Pick<ItkContent, "steps">;
}

/** Ce qu'une intervention prévue porte, et dont l'empreinte détecte une modification à la main. */
export interface PlannedSignatureInput {
  procedure: string;
  day: string;
  targets: { id: string; workedAreaM2: number | null }[];
  inputs: { articleId: string; quantity: number; unit: string }[];
  equipmentIds: string[];
  personIds: string[];
}

/** Empreinte stable (FNV-1a 32 bits) d'une intervention prévue : ordre et arrondis neutralisés. */
export function plannedSignature(x: PlannedSignatureInput): string {
  const round = (n: number | null) => (n === null ? null : Math.round(n * 1000) / 1000);
  const canonical = JSON.stringify([
    x.procedure,
    x.day,
    x.targets.map((t) => [t.id, round(t.workedAreaM2)]).sort(),
    x.inputs.map((i) => [i.articleId, round(i.quantity), i.unit]).sort(),
    [...x.equipmentIds].sort(),
    [...x.personIds].sort(),
  ]);
  let h = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i++) {
    h ^= canonical.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Proposition d'une intervention : un passage d'une étape sur une production. */
export interface PlannedProposal extends Omit<PlannedItem, "state" | "interventionId" | "itineraryChanged"> {
  revision: number;
  stepId: string;
  occurrence: number;
  campaign: number;
  purposes: string[];
  crewTemplateId: string | null;
  equipmentIds: string[];
  personIds: string[];
  people: number | null;
  notes: string | null;
}

export const plannedKey = (productionId: string, stepId: string, occurrence: number) => `${productionId}:${stepId}:${occurrence}`;

/** Une proposition par production, étape et passage (pas de regroupement au premier lot, §13.1). */
export function proposeInterventions(productions: readonly PlannedProduction[], itineraries: ReadonlyMap<string, PlannedItinerary>): PlannedProposal[] {
  const out: PlannedProposal[] = [];
  for (const p of productions) {
    const itk = itineraries.get(p.itineraryId);
    if (!itk) continue;
    for (const { step, occurrences } of scheduleSteps(itk.content, { sowingOn: p.sowingOn, harvestOn: p.harvestOn, year: p.campaign })) {
      const label = step.label?.trim() || getProcedure(step.procedure).label;
      const generic = step.inputs.filter((i) => !i.articleId);
      for (const { occurrence, on } of occurrences) {
        out.push({
          key: plannedKey(p.id, step.id, occurrence),
          productionId: p.id,
          parcelId: p.parcelId,
          parcelName: p.parcelName,
          activityName: p.activityName,
          itineraryId: itk.id,
          itineraryName: itk.name,
          revision: itk.revision,
          stepId: step.id,
          occurrence,
          campaign: p.campaign,
          procedure: step.procedure,
          label: occurrences.length > 1 ? `${label} (${occurrence + 1}/${occurrences.length})` : label,
          day: on,
          areaM2: Math.round(p.areaM2 * step.share),
          optional: step.optional,
          inputs: step.inputs.map((i) => ({ articleId: i.articleId ?? null, label: i.label, dose: i.dose, unit: i.unit })),
          purposes: step.purposes ?? [],
          crewTemplateId: step.staffing.crewTemplateId ?? null,
          equipmentIds: step.staffing.equipmentIds,
          personIds: step.staffing.personIds,
          people: step.staffing.people ?? null,
          notes: generic.length ? `Intrants à préciser : ${generic.map((i) => `${i.label} ${String(i.dose).replace(".", ",")} ${i.unit.replace(/_per_hectare$/, "/ha").replace(/_/g, " ")}`).join(" ; ")}` : null,
        });
      }
    }
  }
  return out;
}

/** Intervention générée existante (non annulée), avec l'empreinte de son contenu actuel. */
export interface ExistingPlanned {
  id: string;
  status: "planned" | "done" | "cancelled";
  ref: ItineraryRef;
  /** Empreinte recalculée sur l'intervention telle qu'elle est en base. */
  currentHash: string;
}

export interface ReconciledItem {
  state: PlannedState;
  proposal: PlannedProposal | null;
  existing: ExistingPlanned | null;
  /** Empreinte de ce que la génération écrirait (proposition) ; null pour un retrait. */
  hash: string | null;
}

/**
 * Rapprochement (conception §7) par clé production, étape, passage :
 * créer, mettre à jour ou retirer ce qui est généré et intact ; garder ce
 * qui a été modifié à la main, réalisé ou annulé.
 */
export function reconcilePlanned(proposals: readonly PlannedProposal[], existing: readonly ExistingPlanned[], signatureOf: (p: PlannedProposal) => string | null): ReconciledItem[] {
  const byKey = new Map(existing.map((e) => [plannedKey(e.ref.productionId, e.ref.stepId, e.ref.occurrence), e]));
  const seen = new Set<string>();
  const out: ReconciledItem[] = [];
  for (const p of proposals) {
    const e = byKey.get(p.key);
    seen.add(p.key);
    const hash = p.day ? signatureOf(p) : null;
    if (!p.day) out.push({ state: e ? (e.status === "planned" ? "modified" : "done") : "undated", proposal: p, existing: e ?? null, hash });
    else if (!e) out.push({ state: "create", proposal: p, existing: null, hash });
    else if (e.status !== "planned") out.push({ state: "done", proposal: p, existing: e, hash });
    else if (e.currentHash !== e.ref.hash) out.push({ state: "modified", proposal: p, existing: e, hash });
    else out.push({ state: e.ref.hash === hash ? "same" : "update", proposal: p, existing: e, hash });
  }
  for (const [key, e] of byKey) {
    if (seen.has(key)) continue;
    if (e.status !== "planned") continue; // réalisée : n'est plus une « prévue »
    out.push({ state: e.currentHash === e.ref.hash ? "remove" : "modified", proposal: null, existing: e, hash: null });
  }
  return out;
}
