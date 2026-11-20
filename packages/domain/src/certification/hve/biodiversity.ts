import type { ControlFinding } from "@fourmy/contracts";
import {
  cite,
  HVE_GRID_SOURCE,
  IAE_BASE_MIN,
  IAE_BY_CODE,
  IAE_DIVERSITY_POINTS,
  IAE_SOURCE,
  iaeEquivalentM2,
  iaeWeightPoints,
  mainCropPoints,
  smallPlotsPoints,
  speciesCountPoints,
} from "@fourmy/certification-refs";
import { finding, missing } from "../report.js";

/**
 * Indicateur HVE « Biodiversité » (lot CT4, plan de contrôle V4.4 §4) :
 * 4.1 IAE (socle sur les terres arables, poids, diversité), 4.2 taille des
 * parcelles, 4.3 poids de la culture principale, 4.4 nombre d'espèces ;
 * 4.5 à 4.8 déclaratifs (questionnaire).
 */

/** IAE de l'exploitation : type HVE (proposé d'après TelePAC, ou validé), quantité dans l'unité du type. */
export interface HveIae {
  id: string;
  label: string;
  /** Type HVE ; null : élément sans équivalent HVE (bois, zone de densification). */
  type: string | null;
  validated: boolean;
  /** Linéaire mitoyen d'une autre exploitation : moitié de la longueur au socle. */
  shared: boolean;
  /** Mètres, m² ou nombre d'arbres. */
  quantity: number;
  /** Porté par une terre arable ou adjacent par sa longueur (tampon de 1 m, ≥ 50 %). */
  onArable: boolean;
  /** Surface réelle au sol (m²), pour l'item 5.2 ; null : inconnue (arbre isolé). */
  realM2: number | null;
}

export interface HveBiodiversityContext {
  /** Surfaces (m²) : SAU, surface totale de l'exploitation (SAU + surfaces non agricoles), terres arables. */
  sauM2: number;
  totalM2: number;
  arableM2: number;
  /** Dispenses du socle : prairies temporaires + jachères + légumineuses (terres arables) ; herbe (PP + PT) + riz (SAU). */
  arableGrassFallowLegumeM2: number;
  grassRiceM2: number;
  iae: HveIae[];
  /** 4.2 : unités culturales (parcelles contiguës de même espèce fusionnées). */
  plots: { areaM2: number; permanentGrassland: boolean }[];
  /** 4.3, 4.4 : cultures de la campagne. */
  crops: { species: string; label: string; areaM2: number; permanentGrassland: boolean; temporaryGrassland: boolean }[];
  /** Espèces des couverts d'interculture et dérobées. */
  coverSpecies: string[];
}

const n1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const pct = (n: number) => `${n1(n)} %`;
const round = (n: number) => Math.round(n * 10) / 10;
const SOURCE = (item: string, at: string) => `Plan de contrôle HVE niveau 3 V4.4 (2024), ${item} ; ${cite({ ...HVE_GRID_SOURCE, at })}`;

/** 4.1 : socle, poids et diversité des IAE. */
export function iaeFindings(ctx: HveBiodiversityContext): ControlFinding[] {
  const typed = ctx.iae.filter((f) => f.type && IAE_BY_CODE[f.type]);
  const counted = typed.filter((f) => f.validated);
  const pending = typed.filter((f) => !f.validated);
  const eq = (f: HveIae, base: boolean) => iaeEquivalentM2(IAE_BY_CODE[f.type!]!, base && f.shared && IAE_BY_CODE[f.type!]!.unit === "m" ? f.quantity / 2 : f.quantity);
  // Socle : IAE « socle » portées par les terres arables ou adjacentes.
  const baseM2 = counted.filter((f) => IAE_BY_CODE[f.type!]!.base && f.onArable).reduce((s, f) => s + eq(f, true), 0);
  const baseShare = ctx.arableM2 ? (baseM2 / ctx.arableM2) * 100 : 0;
  const exempt =
    ctx.arableM2 < 100_000
      ? "moins de 10 ha de terres arables"
      : ctx.arableGrassFallowLegumeM2 > 0.75 * ctx.arableM2
        ? "prairies temporaires, jachères et légumineuses sur plus de 75 % des terres arables"
        : ctx.sauM2 && ctx.grassRiceM2 > 0.75 * ctx.sauM2
          ? "herbe et riz sur plus de 75 % de la SAU"
          : null;
  const baseOk = !!exempt || baseShare >= IAE_BASE_MIN;
  const weightM2 = counted.reduce((s, f) => s + eq(f, false), 0);
  const weightShare = ctx.totalM2 ? (weightM2 / ctx.totalM2) * 100 : 0;
  const families = new Set(counted.map((f) => IAE_BY_CODE[f.type!]!.family));
  const weight = iaeWeightPoints(weightShare);
  const diversity = families.size >= 3 ? IAE_DIVERSITY_POINTS : 0;
  const got = baseOk ? weight + diversity : 0;
  const lacks = pending.map((f) => missing(`validation de l'IAE « ${f.label} » (${IAE_BY_CODE[f.type!]!.label.toLowerCase()})`, "farm", f.id));
  return [
    finding({
      ruleId: "hve.4.1",
      level: "ok",
      message:
        `${counted.length} IAE validée(s). Socle : ${exempt ? `dispensé (${exempt})` : `${pct(baseShare)} des terres arables (minimum ${IAE_BASE_MIN} %)${baseOk ? "" : " : non atteint, 0 point"}`}. ` +
        `Poids : ${n1(weightM2 / 10_000)} ha équivalents, ${pct(weightShare)} de la surface totale : ${weight} pt ; diversité : ${families.size} famille(s) : ${diversity} pt.` +
        (pending.length ? ` ${pending.length} IAE proposée(s) d'après TelePAC, à valider (elles ne comptent qu'une fois validées).` : ""),
      value: round(weightShare),
      unit: "%",
      points: { got, max: 9 },
      missing: lacks.length ? lacks : undefined,
      source: `${SOURCE("§4.1 p. 26-30", "onglet Biodiversité, W41, T48, W53, W56")} ; ${cite(IAE_SOURCE)}`,
    }),
  ];
}

/** 4.2 : part de la SAU en PP ou en unités culturales de moins de 6 ha. */
export function plotSizeFindings(ctx: HveBiodiversityContext): ControlFinding[] {
  if (!ctx.sauM2) return [];
  const small = ctx.plots.filter((p) => p.permanentGrassland || p.areaM2 < 60_000).reduce((s, p) => s + p.areaM2, 0);
  const share = (small / ctx.sauM2) * 100;
  const got = smallPlotsPoints(share);
  return [
    finding({
      ruleId: "hve.4.2",
      level: "ok",
      message: `${pct(share)} de la SAU en prairies permanentes ou en parcelles de moins de 6 ha (parcelles contiguës d'une même culture réunies) : ${got} point(s).`,
      value: round(share),
      unit: "%",
      points: { got, max: 5 },
      source: SOURCE("§4.2 p. 30-31", "onglet Biodiversité, S85"),
    }),
  ];
}

/** 4.3 : part de la culture principale dans la SAU hors PP (prairies temporaires : une culture par tranche de 10 % de SAU). */
export function mainCrop(ctx: HveBiodiversityContext): { label: string; share: number } | null {
  const arable = ctx.crops.filter((c) => !c.permanentGrassland);
  const base = arable.reduce((s, c) => s + c.areaM2, 0);
  if (!base) return null;
  const bySpecies = new Map<string, { label: string; area: number; temporary: boolean }>();
  for (const c of arable) {
    const x = bySpecies.get(c.species) ?? { label: c.label, area: 0, temporary: c.temporaryGrassland };
    x.area += c.areaM2;
    bySpecies.set(c.species, x);
  }
  const effective = [...bySpecies.values()].map((x) => ({ label: x.label, area: x.temporary ? Math.min(x.area, 0.1 * ctx.sauM2) : x.area }));
  const top = effective.sort((a, b) => b.area - a.area)[0]!;
  return { label: top.label, share: (top.area / base) * 100 };
}

export function mainCropFindings(ctx: HveBiodiversityContext): ControlFinding[] {
  const m = mainCrop(ctx);
  if (!m) return [];
  const got = mainCropPoints(m.share);
  return [
    finding({
      ruleId: "hve.4.3",
      level: "ok",
      message: `Culture principale : ${m.label}, ${pct(m.share)} de la SAU hors prairies permanentes : ${got} point(s).`,
      value: round(m.share),
      unit: "%",
      points: { got, max: 5 },
      source: SOURCE("§4.3 p. 31-32", "onglet Biodiversité, Q112"),
    }),
  ];
}

/** 4.4 : nombre d'espèces cultivées, couverts compris ; PP : une espèce par tranche de 10 % de SAU. */
export function speciesFindings(ctx: HveBiodiversityContext): ControlFinding[] {
  if (!ctx.sauM2) return [];
  const species = new Set([...ctx.crops.filter((c) => !c.permanentGrassland).map((c) => c.species), ...ctx.coverSpecies]);
  const pp = ctx.crops.filter((c) => c.permanentGrassland).reduce((s, c) => s + c.areaM2, 0);
  const ppSpecies = pp ? Math.max(1, Math.floor((pp / ctx.sauM2) * 10)) : 0;
  const n = species.size + ppSpecies;
  const main = mainCrop(ctx);
  const dominant = !!main && main.share >= 60;
  const got = speciesCountPoints(n, dominant);
  return [
    finding({
      ruleId: "hve.4.4",
      level: "ok",
      message: `${n} espèce(s) cultivée(s) (couverts d'interculture compris${ppSpecies ? `, ${ppSpecies} pour les prairies permanentes` : ""}) : ${got} point(s). Les mélanges comptent leurs espèces semées : à compléter dans le questionnaire.`,
      value: n,
      points: { got, max: dominant ? 5 : 6 },
      source: SOURCE("§4.4 p. 33-34", "onglet Biodiversité, O154"),
    }),
  ];
}

/** Items déclaratifs : 4.5 espèces animales, 4.6 ruches, 4.7 variétés et races menacées, 4.8 qualité biologique du sol. */
export function declarativeBiodiversityFindings(): ControlFinding[] {
  const items: [string, string, number][] = [
    ["hve.4.5", "4.5 Espèces animales élevées", 3],
    ["hve.4.6", "4.6 Ruches (3 au moins, toute la campagne)", 1],
    ["hve.4.7", "4.7 Variétés, races ou espèces menacées", 6],
    ["hve.4.8", "4.8 Qualité biologique du sol (test bêche, biomasse microbienne)", 1],
  ];
  return items.map(([ruleId, label, max]) =>
    finding({
      ruleId,
      level: "missing",
      message: `${label} : à déclarer dans le questionnaire HVE annuel.`,
      points: { got: 0, max },
      missing: [missing(label, "questionnaire")],
      source: SOURCE(`§${ruleId.slice(4)}`, "onglet Biodiversité"),
    }),
  );
}

export function hveBiodiversityFindings(ctx: HveBiodiversityContext): ControlFinding[] {
  return [...iaeFindings(ctx), ...plotSizeFindings(ctx), ...mainCropFindings(ctx), ...speciesFindings(ctx), ...declarativeBiodiversityFindings()];
}

/** IAE comptées au 5.2 (surfaces non traitées) : jachères, vergers haute-tige, zones humides… sans plafond ; IAE « sous le seuil SAU » plafonnées à 5 % de la SAU. */
export function untreatedIaeM2(ctx: HveBiodiversityContext): number {
  const counted = ctx.iae.filter((f) => f.validated && f.type && IAE_BY_CODE[f.type]);
  const uncapped = new Set(["fallow", "melliferous_fallow", "high_orchard", "wetland", "tree_row", "tree"]);
  // Surface réelle au sol (jamais la surface équivalente, qui la dépasse) ; inconnue : non comptée.
  const real = (f: HveIae) => f.realM2 ?? 0;
  const free = counted.filter((f) => uncapped.has(f.type!)).reduce((s, f) => s + real(f), 0);
  const capped = Math.min(counted.filter((f) => !uncapped.has(f.type!)).reduce((s, f) => s + real(f), 0), 0.05 * ctx.sauM2);
  return free + capped;
}
