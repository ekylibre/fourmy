import { BCAE7_PERMANENT_GRASSLAND } from "@fourmy/certification-refs";
import type { ControlFinding, CropPlanContext, CropPlanDraft } from "@fourmy/contracts";
import { finding } from "../../certification/report.js";
import { formatPct, type CropPlanActivity, type CropPlanHistory } from "../model.js";
import type { ResolvedPlan } from "../resolve.js";
import { bcae7Class } from "./bcae7.js";

/**
 * Phyto et réglementaire sur l'assolement (conception §4.5, décision A9) :
 * rappels et points à vérifier, jamais bloquants. Zonages copiés de Lexicon
 * (aires d'alimentation de captage des agences de l'eau, Natura 2000) ;
 * points d'eau de la BD TOPO (contrôle phyto).
 */

export type CropPlanZones = CropPlanContext["zones"];

const GRASS = new Set(["JAC", "MLG", "PTR", "GRA", ...BCAE7_PERMANENT_GRASSLAND]);
const PERMANENT = new Set(BCAE7_PERMANENT_GRASSLAND);
/** Seuil de part de surface en dessous duquel un recoupement est ignoré (bords imprécis). */
const MIN_SHARE = 0.01;
/** ZNT minimale le long des points d'eau. */
const ZNT_M = 5;

const SOURCES = {
  znt: "Arrêté du 4 mai 2017 modifié, art. 12 (zone non traitée d'au moins 5 m le long des points d'eau) ; points d'eau : IGN BD TOPO",
  catchment: "Aires d'alimentation de captage d'eau potable (agences de l'eau, jeu Lexicon protected_water_zones) ; programme d'actions local",
  natura: "Code de l'environnement, art. L414-4 (évaluation des incidences Natura 2000) ; sites : MNHN / INPN (jeu Lexicon protected_natural_zones)",
};

interface Input {
  plan: ResolvedPlan;
  draft: CropPlanDraft;
  activities: ReadonlyMap<string, CropPlanActivity>;
  history: CropPlanHistory;
  zones: CropPlanZones;
}

/** Zonages d'une parcelle du brouillon : ceux de ses parcelles de départ, au prorata. */
function zonesOf(origins: { parcelId: string; share: number }[], zones: CropPlanZones) {
  const catchments = new Map<string, number>();
  const natura = new Map<string, { nature: string; share: number }>();
  let water: { name: string | null; distanceM: number } | null = null;
  for (const o of origins) {
    const z = zones[o.parcelId];
    if (!z) continue;
    for (const c of z.catchments) catchments.set(c.name, (catchments.get(c.name) ?? 0) + c.share * o.share);
    for (const n of z.natura2000) natura.set(n.name, { nature: n.nature, share: (natura.get(n.name)?.share ?? 0) + n.share * o.share });
    if (z.water && (!water || z.water.distanceM < water.distanceM)) water = z.water;
  }
  return { catchments, natura, water };
}

export function regulatoryFindings({ plan, draft, activities, history, zones }: Input): ControlFinding[] {
  const out: ControlFinding[] = [];
  const pivot = `${draft.year}-06-01`;
  const inNatura: string[] = [];
  const naturaKeys: string[] = [];
  for (const p of plan.parcels) {
    const mains = draft.assignments.filter((a) => a.key === p.key && a.role === "main");
    const main = mains.find((a) => (!a.startedOn || a.startedOn <= pivot) && (!a.stoppedOn || a.stoppedOn >= pivot)) ?? mains[0];
    const act = main ? activities.get(main.activityId) : undefined;
    if (!act) continue;
    const code = act.capCode?.toUpperCase() ?? null;
    // Culture susceptible d'être traitée : tout sauf herbe, prairie et jachère.
    const treated = !code || !GRASS.has(code);
    const z = zonesOf(p.origins, zones);
    const refs = { parcelIds: [p.key] };

    if (treated && z.water && z.water.distanceM < ZNT_M) {
      out.push(
        finding({
          ruleId: "reg.znt",
          level: "warning",
          message: `${p.name} : ${act.name.toLowerCase()} à ${Math.round(z.water.distanceM)} m d'un point d'eau${z.water.name ? ` (${z.water.name})` : ""} : zone non traitée d'au moins ${ZNT_M} m, plus selon le produit.`,
          refs,
          source: SOURCES.znt,
        }),
      );
    }
    const catchments = [...z.catchments].filter(([, share]) => share >= MIN_SHARE);
    if (treated && catchments.length) {
      out.push(
        finding({
          ruleId: "reg.catchment",
          level: "warning",
          message: `${p.name} : ${catchments.map(([name, share]) => `${formatPct(Math.min(share, 1))} en aire d'alimentation de captage${name ? ` « ${name} »` : ""}`).join(", ")} : vérifier le programme d'actions (phyto, azote) avant d'y prévoir ${act.name.toLowerCase()}.`,
          refs,
          source: SOURCES.catchment,
        }),
      );
    }
    const sites = [...z.natura].filter(([, n]) => n.share >= MIN_SHARE);
    if (!sites.length) continue;
    const previous = p.origins.map((o) => history.get(o.parcelId)?.[draft.year - 1]?.main?.toUpperCase()).find((c) => c && PERMANENT.has(c));
    if (previous && bcae7Class(code) === "cultivated") {
      out.push(
        finding({
          ruleId: "reg.natura2000.grassland",
          level: "warning",
          message: `${p.name} : prairie permanente retournée pour ${act.name.toLowerCase()} en site Natura 2000 (${sites.map(([name]) => name).join(", ")}) : évaluation des incidences possible, à vérifier auprès de la DDT.`,
          refs,
          source: SOURCES.natura,
        }),
      );
    } else {
      inNatura.push(`${p.name} (${sites.map(([name, n]) => `${name}, ${n.nature.toUpperCase()}`).join(" ; ")})`);
      naturaKeys.push(p.key);
    }
  }
  if (inNatura.length) {
    out.push(
      finding({
        ruleId: "reg.natura2000",
        level: "na",
        message: `En site Natura 2000 : ${inNatura.join(", ")}. Les travaux et aménagements listés localement demandent une évaluation des incidences.`,
        refs: { parcelIds: naturaKeys },
        source: SOURCES.natura,
      }),
    );
  }
  return out;
}
