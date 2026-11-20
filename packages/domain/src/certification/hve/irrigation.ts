import type { ControlFinding } from "@fourmy/contracts";
import { cite, HVE_GRID_SOURCE, irrigationRecordPoints, lowWaterPoints } from "@fourmy/certification-refs";
import { finding, missing } from "../report.js";

/**
 * Indicateur HVE « Gestion de l'irrigation » (lot CT3c, plan de contrôle
 * V4.4 §7) : exploitation non irrigante validée d'office ; 7.1
 * enregistrement des apports ; 7.6 prélèvements en étiage ; items
 * déclaratifs (7.2 à 7.5, 7.7, 7.8) en attente du questionnaire (CT4).
 */

/** Apport d'irrigation (une programmation homogène). */
export interface HveIrrigation {
  interventionId: string;
  day: string;
  parcelIds: string[];
  /** Dose (mm) et surface (m²) ; volume = mm × surface / 1000 (m³). */
  depthMm: number | null;
  areaM2: number;
  method: string | null;
  origin: "surface" | "groundwater" | "network" | "reservoir" | null;
  trigger: string | null;
  mobile: boolean | null;
  /** Matériel affecté à l'intervention. */
  equipment: boolean;
}

/** Parcelle irriguée : les 5 données par parcelle. */
export interface HveIrrigatedParcel {
  id: string;
  name: string;
  productionId: string | null;
  crop: string | null;
  droughtTolerant: boolean | null;
  sownOn: string | null;
  waterSaving: string | null;
  harvested: boolean;
}

export interface HveIrrigationContext {
  irrigations: HveIrrigation[];
  parcels: HveIrrigatedParcel[];
  /** Matériel d'irrigation au parc (enrouleur, pivot…), pour vérifier une exploitation déclarée non irrigante. */
  irrigationEquipment: string[];
}

const n1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const pct = (n: number) => `${n1(n)} %`;
const round = (n: number) => Math.round(n * 10) / 10;
const SOURCE = (item: string, at: string) => `Plan de contrôle HVE niveau 3 V4.4 (2024), ${item} ; ${cite({ ...HVE_GRID_SOURCE, at })}`;
const lowWater = (day: string) => ["06", "07", "08"].includes(day.slice(5, 7));
const volume = (i: HveIrrigation) => ((i.depthMm ?? 0) * i.areaM2) / 1000;

/** 7.1 : R = données manquantes / (7 × apports + 5 × parcelles). */
export function irrigationRecordFindings(ctx: HveIrrigationContext): ControlFinding[] {
  const perApplication = ctx.irrigations.map((i) => [
    ["date", true],
    ["volume", i.depthMm !== null],
    ["surface", i.areaM2 > 0],
    ["mode", i.method !== null],
    ["matériel", i.equipment || i.mobile !== null],
    ["origine de l'eau", i.origin !== null],
    ["facteur déclenchant", i.trigger !== null],
  ] as const);
  const perParcel = ctx.parcels.map((p) => [
    ["culture", p.crop !== null],
    ["variété tolérante ou non", p.droughtTolerant !== null],
    ["date de semis", p.sownOn !== null],
    ["pratiques économes en eau", p.waterSaving !== null],
    ["rendement", p.harvested],
  ] as const);
  const n = 7 * ctx.irrigations.length + 5 * ctx.parcels.length;
  const absent = [...perApplication, ...perParcel].flat().filter(([, ok]) => !ok).length;
  const r = n ? (absent / n) * 100 : 0;
  const got = ctx.irrigations.some((i) => i.depthMm !== null) ? irrigationRecordPoints(r) : 0;
  const lacks = [
    ...ctx.irrigations.flatMap((i, k) => perApplication[k]!.filter(([, ok]) => !ok).map(([what]) => missing(`${what} de l'apport du ${i.day.split("-").reverse().join("/")}`, "intervention", i.interventionId))),
    ...ctx.parcels.flatMap((p, k) => perParcel[k]!.filter(([, ok]) => !ok).map(([what]) => missing(`${what} (${p.name})`, "production", p.productionId ?? p.id))),
  ];
  // Les données manquantes font baisser la note (barème de la grille) : le constat reste conforme, avec la liste à compléter.
  return [
    finding({
      ruleId: "hve.7.1",
      level: "ok",
      message: `${ctx.irrigations.length} apport(s) sur ${ctx.parcels.length} parcelle(s) : ${absent} donnée(s) manquante(s) sur ${n} (${pct(r)}) : ${got} point(s).${absent ? ` À compléter : ${[...new Set(lacks.map((l) => l.what.replace(/ \(.*| de l'apport.*/, "")))].join(", ")}.` : ""}`,
      value: round(r),
      unit: "%",
      points: { got, max: 6 },
      refs: { interventionIds: ctx.irrigations.map((i) => i.interventionId), parcelIds: ctx.parcels.map((p) => p.id) },
      source: SOURCE("§7.1 p. 81-82", "onglet Irrigation, M51"),
    }),
  ];
}

/** 7.6 : part du volume prélevé dans le milieu en juin, juillet, août. */
export function lowWaterFindings(ctx: HveIrrigationContext): ControlFinding[] {
  const total = ctx.irrigations.reduce((s, i) => s + volume(i), 0);
  if (!total) return [];
  const unknown = ctx.irrigations.filter((i) => i.origin === null);
  // Eau d'une retenue : prélevée au remplissage, supposé hors étiage (à justifier par l'exploitant).
  const direct = ctx.irrigations.filter((i) => i.origin !== "reservoir" && lowWater(i.day)).reduce((s, i) => s + volume(i), 0);
  const share = (direct / total) * 100;
  const got = lowWaterPoints(share);
  return [
    finding({
      ruleId: "hve.7.6",
      level: "ok",
      message: `${Math.round(direct).toLocaleString("fr-FR")} m³ prélevés dans le milieu en juin, juillet et août sur ${Math.round(total).toLocaleString("fr-FR")} m³ (${pct(share)}) : ${got} point(s). Eau des retenues comptée hors étiage.`,
      value: round(share),
      unit: "%",
      points: { got, max: 5 },
      missing: unknown.length ? unknown.map((i) => missing("origine de l'eau", "intervention", i.interventionId)) : undefined,
      source: SOURCE("§7.6 p. 85-86", "onglet Irrigation, AC190"),
    }),
  ];
}

export function hveIrrigationFindings(ctx: HveIrrigationContext): ControlFinding[] {
  if (!ctx.irrigations.length) {
    const equipment = ctx.irrigationEquipment;
    return [
      finding({
        ruleId: "hve.7",
        level: equipment.length ? "warning" : "na",
        message: equipment.length
          ? `Aucun apport d'irrigation enregistré, mais du matériel d'irrigation au parc (${equipment.join(", ")}) : enregistrez les apports, ou confirmez que l'exploitation n'irrigue pas.`
          : "Exploitation non irrigante : indicateur validé d'office (sans objet).",
        source: SOURCE("§7 p. 81", "onglet SYNTHESE, L47"),
      }),
    ];
  }
  const declarative: [string, string, number][] = [
    ["hve.7.2", "7.2 Outils de mesure (sondes, tensiomètres, OAD)", 2],
    ["hve.7.3", "7.3 Matériels optimisant les apports", 6],
    ["hve.7.4", "7.4 Démarche collective de gestion de la ressource", 2],
    ["hve.7.5", "7.5 Pratiques économes en eau", 6],
  ];
  return [
    ...irrigationRecordFindings(ctx),
    ...lowWaterFindings(ctx),
    ...declarative.map(([ruleId, label, max]) =>
      finding({
        ruleId,
        level: "missing",
        message: `${label} : à déclarer dans le questionnaire HVE annuel.`,
        points: { got: 0, max },
        missing: [missing(label, "questionnaire")],
        source: SOURCE(`§${ruleId.slice(4)}`, "onglet Irrigation"),
      }),
    ),
  ];
}
