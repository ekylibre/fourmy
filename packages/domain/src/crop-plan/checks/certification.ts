import { BCAE7_PERMANENT_GRASSLAND, CONVERSION } from "@fourmy/certification-refs";
import type { ControlFinding, CropPlanDraft } from "@fourmy/contracts";
import { harvestStatus, rotationFindings, CONVERSION_STATUS_LABELS, type AbRotationYear } from "../../certification/ab.js";
import { mainCropFindings, plotSizeFindings, speciesFindings, type HveBiodiversityContext } from "../../certification/hve/biodiversity.js";
import { finding } from "../../certification/report.js";
import { historyOf } from "../history.js";
import type { CropPlanActivity, CropPlanHistory } from "../model.js";
import type { ResolvedPlan } from "../resolve.js";
import { bcae7Class } from "./bcae7.js";

/**
 * Certifications sur l'assolement prévu (conception §4.4) : les règles AB et
 * HVE qui dépendent des cultures, appliquées à la campagne préparée.
 * Les fonctions des contrôles existants sont réutilisées ; les constats HVE
 * sont une projection des points.
 */

export interface CropPlanCertificationContext {
  /** Parcelles de départ certifiées AB pendant la campagne : début effectif de la conversion. */
  abParcels: ReadonlyMap<string, { conversionStart: string }>;
  /** Une parcelle au moins certifiée HVE pendant la campagne. */
  hve: boolean;
  /** Réglages de la rotation AB (farm_settings.certification). */
  abRotation: { years: number; sameSpeciesMax: number };
}

interface Input {
  plan: ResolvedPlan;
  draft: CropPlanDraft;
  activities: ReadonlyMap<string, CropPlanActivity>;
  history: CropPlanHistory;
  context: CropPlanCertificationContext;
}

const TEMPORARY_GRASSLAND = new Set(["PTR", "MLG", "GRA", "JAC"]);
const PERMANENT_GRASSLAND = new Set(BCAE7_PERMANENT_GRASSLAND);

/** Culture principale prévue d'une parcelle : celle en place au 1er juin, sinon la première. */
function mainAssignment(draft: CropPlanDraft, key: string) {
  const pivot = `${draft.year}-06-01`;
  const mains = draft.assignments.filter((a) => a.key === key && a.role === "main");
  return mains.find((a) => (!a.startedOn || a.startedOn <= pivot) && (!a.stoppedOn || a.stoppedOn >= pivot)) ?? mains[0];
}

/** Statut AB d'une parcelle du brouillon : toutes ses origines AB, aucune, ou un mélange. */
function abState(origins: { parcelId: string }[], ab: CropPlanCertificationContext["abParcels"]): "ab" | "none" | "mixed" {
  const n = origins.filter((o) => ab.has(o.parcelId)).length;
  return n === 0 ? "none" : n === origins.length ? "ab" : "mixed";
}

export function abPlanFindings({ plan, draft, activities, history, context }: Input): ControlFinding[] {
  if (!context.abParcels.size) return [];
  const out: ControlFinding[] = [];
  const rotation = new Map<string, { name: string; years: AbRotationYear[] }>();
  const abSpecies = new Map<string, { label: string; keys: string[] }>();
  const otherSpecies = new Map<string, string[]>();

  for (const p of plan.parcels) {
    const state = abState(p.origins, context.abParcels);
    if (state === "mixed") {
      out.push(
        finding({
          ruleId: "ab.plan.mixed-parcel",
          level: "danger",
          message: `${p.name} : réunit des surfaces certifiées AB et non certifiées ; la fusion sera refusée à la validation.`,
          refs: { parcelIds: [p.key] },
          source: "Règlement (UE) 2018/848, art. 9.7 (séparation des unités)",
        }),
      );
      continue;
    }
    const a = mainAssignment(draft, p.key);
    const act = a ? activities.get(a.activityId) : undefined;
    if (act?.species && state === "ab") {
      const x = abSpecies.get(act.species) ?? { label: act.name, keys: [] };
      x.keys.push(p.key);
      abSpecies.set(act.species, x);
    } else if (act?.species) otherSpecies.set(act.species, [...(otherSpecies.get(act.species) ?? []), p.key]);
    if (state !== "ab") continue;

    // Statut prévu de la récolte (conversion déduite, jamais saisie).
    const start = p.origins.map((o) => context.abParcels.get(o.parcelId)!.conversionStart).sort().at(-1)!;
    if (a && act) {
      const harvestOn = a.stoppedOn ?? `${draft.year}-07-15`;
      const status = harvestStatus(start, act.cycle ?? "annual", a.startedOn, harvestOn);
      out.push(
        finding({
          ruleId: "ab.plan.harvest-status",
          level: "na",
          message: `${p.name} : récolte ${draft.year} de ${act.name.toLowerCase()} prévue en ${status} (${CONVERSION_STATUS_LABELS[status]}).`,
          refs: { parcelIds: [p.key] },
          source: `Règlement (UE) 2018/848, annexe II partie I 1.7 (conversion : ${CONVERSION.annualSowingMonths} mois avant semis, ${CONVERSION.perennialHarvestMonths} mois avant récolte des pérennes)`,
        }),
      );
    }

    // Rotation (R11) : historique de l'origine principale, plus la culture prévue.
    const origin = [...historyOf(p, history)].sort((x, y) => y.share - x.share)[0];
    const years: AbRotationYear[] = Object.entries(origin?.years ?? {}).map(([y, c]) => ({
      campaign: Number(y),
      species: c.species ?? null,
      label: c.label ?? null,
      legume: !!c.legume,
      coverLegume: !!c.coverLegume,
      vegetable: !!c.vegetable,
      perennial: !!c.perennial,
    }));
    const coverLegume = draft.covers.some((c) => c.key === p.key) && draft.assignments.some((x) => x.key === p.key && x.role === "secondary" && activities.get(x.activityId)?.legume);
    years.push({
      campaign: draft.year,
      species: act?.species ?? null,
      label: act?.name ?? null,
      legume: !!act?.legume,
      coverLegume,
      vegetable: !!act?.vegetable,
      perennial: act?.cycle === "perennial",
    });
    rotation.set(p.key, { name: p.name, years });
  }

  out.push(...rotationFindings(rotation, draft.year, context.abRotation.years, context.abRotation.sameSpeciesMax));

  // Mixité (R7) : même espèce en AB et hors AB la même campagne.
  for (const [species, ab] of abSpecies) {
    const others = otherSpecies.get(species);
    if (!others) continue;
    out.push(
      finding({
        ruleId: "ab.R7",
        level: "warning",
        message: `${ab.label} prévu(e) en AB et hors AB : mixité, à cultiver avec des variétés différentes, facilement distinguables.`,
        refs: { parcelIds: [...ab.keys, ...others] },
        source: "Règlement (UE) 2018/848, art. 9.7 et 9.8",
      }),
    );
  }
  return out;
}

/** HVE 4.2 à 4.4 sur les surfaces prévues : projection des points. */
export function hvePlanFindings({ plan, draft, activities, context }: Input): ControlFinding[] {
  if (!context.hve) return [];
  const crops: HveBiodiversityContext["crops"] = [];
  const plots: HveBiodiversityContext["plots"] = [];
  let arableM2 = 0;
  for (const p of plan.parcels) {
    const a = mainAssignment(draft, p.key);
    const act = a ? activities.get(a.activityId) : undefined;
    const code = act?.capCode ?? (draft.fallow.find((f) => f.key === p.key) ? "JAC" : null);
    const cls = bcae7Class(code);
    if (cls === "cultivated" || cls === "arable-excluded" || cls === "not-exploited") arableM2 += p.areaM2;
    // Une unité culturale par parcelle : les parcelles contiguës d'une même culture ne sont pas réunies ici.
    plots.push({ areaM2: p.areaM2, permanentGrassland: !!code && PERMANENT_GRASSLAND.has(code) });
    if (!act) continue;
    crops.push({
      species: act.species ?? act.id,
      label: act.name,
      areaM2: p.areaM2,
      permanentGrassland: !!code && PERMANENT_GRASSLAND.has(code),
      temporaryGrassland: !!code && TEMPORARY_GRASSLAND.has(code),
    });
  }
  const sauM2 = plan.parcels.reduce((s, p) => s + p.areaM2, 0);
  const coverSpecies = [
    ...draft.covers.flatMap((c) => c.species),
    ...draft.assignments.filter((a) => a.role === "secondary").map((a) => activities.get(a.activityId)?.species ?? a.activityId),
  ];
  const ctx: HveBiodiversityContext = {
    sauM2,
    totalM2: sauM2,
    arableM2,
    arableGrassFallowLegumeM2: 0,
    grassRiceM2: 0,
    iae: [],
    plots,
    crops,
    coverSpecies,
  };
  return [...plotSizeFindings(ctx), ...mainCropFindings(ctx), ...speciesFindings(ctx)].map((f) => ({
    ...f,
    message: `Projection ${draft.year} : ${f.message}`,
  }));
}
