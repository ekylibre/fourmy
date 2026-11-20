import type { ControlFinding, HveAnswers } from "@fourmy/contracts";
import { declaredItem, given } from "./declared.js";
import {
  cite,
  HVE_GRID_SOURCE,
  interRowPoints,
  legumePoints,
  minorOadPoints,
  soilCoverPoints,
  MINOR_CROPS_THRESHOLD,
  NITROGEN_EXPORTS_SOURCE,
  nitrogenBalancePoints,
  organicNitrogenPoints,
  pointsBySlices,
  type NitrogenExport,
} from "@fourmy/certification-refs";
import { finding, missing } from "../report.js";
import type { HveParcel } from "./phyto.js";

/**
 * Indicateur HVE « Gestion de la fertilisation » (lot CT3b, plan de contrôle
 * V4.4 §6) : 6.1 bilan azoté (BGA en azote total), 6.3 part de l'azote
 * organique, 6.4 outils d'aide à la décision, 6.5 SAU non fertilisée,
 * 6.6 légumineuses ; 6.7 couverture des sols et les items horticoles en
 * attente de déclaration.
 */

export interface HveFertParcel extends HveParcel {
  /** Lignes de la table des exportations ; vide : culture mineure. */
  exports: NitrogenExport[];
  /** Légumineuse comptée au 6.6 (protéagineux, légumes secs, luzerne, trèfle, mélanges). */
  legume: boolean;
}

/** Apport d'azote sur une parcelle, ramené à l'hectare. */
export interface HveNitrogenInput {
  interventionId: string;
  parcelId: string;
  articleId: string;
  product: string;
  /** Azote total (kg/ha) ; null : composition ou dose inconnue. */
  nTotalKgHa: number | null;
  /** Engrais organique (effluent, compost, produit organique) ; faux : minéral. */
  organic: boolean;
}

/** Récolte sur une parcelle (part de la quantité de l'intervention). */
export interface HveHarvest {
  interventionId: string;
  parcelId: string;
  product: string;
  /** Tonnes récoltées sur la parcelle ; null : unité non convertible en masse (hl…). */
  tonnes: number | null;
  /** Paille exportée (l'article récolté est de la paille). */
  straw: boolean;
}

export interface HveFertilizationContext {
  parcels: HveFertParcel[];
  inputs: HveNitrogenInput[];
  harvests: HveHarvest[];
  /** Élevage sur l'exploitation (rejets des animaux, pâturage) : null si non déclaré. */
  livestock: boolean | null;
  /** Parcelles avec un plan prévisionnel de fumure établi, une analyse de reliquat (RSH), une mesure de pilotage. */
  planParcelIds: string[];
  rshParcelIds: string[];
  steeringParcelIds: string[];
  /** Réponses du questionnaire annuel : azote des animaux, OPI, OAD des cultures mineures, couverture des sols. */
  answers?: HveAnswers["fertilization"];
}

/** Azote des animaux déclaré (kg N) ; null : non déclaré alors qu'il y a de l'élevage (ou que ce n'est pas dit). */
const livestockN = (ctx: HveFertilizationContext): number | null =>
  ctx.livestock === false ? 0 : given(ctx.answers?.livestockNitrogenKg) ? ctx.answers!.livestockNitrogenKg! : null;

const ha = (m2: number) => m2 / 10_000;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
const n1 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
const pct = (n: number) => `${n1(n)} %`;
const SOURCE = (item: string, at: string) => `Plan de contrôle HVE niveau 3 V4.4 (2024), ${item} ; ${cite({ ...HVE_GRID_SOURCE, at })}`;
const sau = (ps: { areaM2: number }[]) => ps.reduce((s, p) => s + p.areaM2, 0);

/** Ligne de la table pour une récolte : la paille si c'en est, sinon le produit principal. */
export function exportRowFor(rows: NitrogenExport[], straw: boolean): NitrogenExport | null {
  if (straw) return rows.find((r) => r.organ === "paille") ?? null;
  return rows.find((r) => r.n !== null && r.unit !== "kg N/ha" && !/paille|résidus|fanes/.test(r.organ ?? "")) ?? null;
}

/** Azote exporté par une récolte (kg) ; null : quantité ou référence inutilisable. */
export function exportedNitrogen(rows: NitrogenExport[], h: HveHarvest): number | null {
  const row = exportRowFor(rows, h.straw);
  if (!row || h.tonnes === null) return null;
  const n = h.straw ? (row.exported?.n ?? row.n) : row.n;
  return n === null ? null : h.tonnes * n;
}

/** Part de la SAU en cultures mineures (sans référence d'exportation), en %. */
export function minorShare(ctx: HveFertilizationContext): number {
  const total = sau(ctx.parcels);
  return total ? (sau(ctx.parcels.filter((p) => !p.exports.length)) / total) * 100 : 0;
}

/** 6.1 : BGA en azote total, ramené à l'ha de SAU. */
export function nitrogenBalanceFindings(ctx: HveFertilizationContext): ControlFinding[] {
  const total = sau(ctx.parcels);
  if (!total) return [];
  const principal = ctx.parcels.filter((p) => p.exports.length);
  const ids = new Set(principal.map((p) => p.id));
  const area = new Map(ctx.parcels.map((p) => [p.id, p.areaM2]));
  const inputs = ctx.inputs.filter((i) => ids.has(i.parcelId));
  const animals = livestockN(ctx);
  const entered = inputs.reduce((s, i) => s + (i.nTotalKgHa ?? 0) * ha(area.get(i.parcelId)!), 0) + (animals ?? 0);
  const harvests = ctx.harvests.filter((h) => ids.has(h.parcelId));
  const rowsOf = new Map(principal.map((p) => [p.id, p.exports]));
  let exported = 0;
  const unusable: HveHarvest[] = [];
  for (const h of harvests) {
    const n = exportedNitrogen(rowsOf.get(h.parcelId)!, h);
    if (n === null) unusable.push(h);
    else exported += n;
  }
  const notHarvested = principal.filter((p) => !harvests.some((h) => h.parcelId === p.id));
  const b = (entered - exported) / ha(total);
  const minor = minorShare(ctx);
  const raw = nitrogenBalancePoints(b);
  const corrected = minor >= MINOR_CROPS_THRESHOLD ? round(raw * (1 - minor / 100)) : raw;
  const lacks = [
    ...inputs.filter((i) => i.nTotalKgHa === null).map((i) => missing(`teneur en azote ou dose de ${i.product}`, "article", i.articleId)),
    ...unusable.map((h) => missing(`récolte de ${h.product} en masse (t), ou sa référence d'exportation`, "intervention", h.interventionId)),
    ...(animals === null ? [missing("élevage : azote des animaux (rejets, pâturage), questionnaire ou réglage « pas d'élevage »", "questionnaire")] : []),
  ];
  const out = [
    finding({
      ruleId: "hve.6.1",
      level: "ok",
      message:
        `Balance globale azotée : ${n1(entered)} kg N apportés${animals ? ` (dont ${n1(animals)} kg des animaux)` : ""}, ${n1(exported)} kg N exportés sur les cultures principales, ` +
        `soit ${n1(b)} kg N/ha de SAU : ${raw} point(s)` +
        (minor >= MINOR_CROPS_THRESHOLD ? `, × (1 − ${pct(minor)} de cultures mineures) = ${n1(corrected)}` : "") +
        `. Récoltes comptées à la MS de référence de la table.`,
      value: round(b, 1),
      unit: "kg N/ha",
      points: { got: corrected, max: 8 },
      missing: lacks.length ? lacks : undefined,
      refs: { parcelIds: principal.map((p) => p.id) },
      source: `${SOURCE("§6.1 p. 58-68", "onglet Fertilisation, AD55, AF55, P64")} ; ${cite(NITROGEN_EXPORTS_SOURCE)}`,
    }),
  ];
  if (notHarvested.length) {
    out.push(
      finding({
        ruleId: "hve.6.1.harvests",
        level: "warning",
        message: `Aucune récolte enregistrée sur ${notHarvested.map((p) => p.name).join(", ")} : exportation comptée nulle.`,
        refs: { parcelIds: notHarvested.map((p) => p.id) },
        source: SOURCE("§6.1", "onglet Fertilisation"),
      }),
    );
  }
  return out;
}

/** 6.3 : part de l'azote organique dans l'azote total apporté sur la SAU. */
export function organicNitrogenFindings(ctx: HveFertilizationContext): ControlFinding[] {
  const area = new Map(ctx.parcels.map((p) => [p.id, p.areaM2]));
  const known = ctx.inputs.filter((i) => i.nTotalKgHa !== null && area.has(i.parcelId));
  const animals = livestockN(ctx);
  const totalN = known.reduce((s, i) => s + i.nTotalKgHa! * ha(area.get(i.parcelId)!), 0) + (animals ?? 0);
  if (!totalN && animals !== null) {
    return [
      finding({
        ruleId: "hve.6.3",
        level: "ok",
        message: "Aucun apport d'azote : part organique nulle, 0 point.",
        points: { got: 0, max: 4 },
        source: SOURCE("§6.3 p. 69-71", "onglet Fertilisation, P122"),
      }),
    ];
  }
  const organic = known.filter((i) => i.organic).reduce((s, i) => s + i.nTotalKgHa! * ha(area.get(i.parcelId)!), 0) + (animals ?? 0);
  const share = totalN ? (organic / totalN) * 100 : 0;
  const got = organicNitrogenPoints(share);
  return [
    finding({
      ruleId: "hve.6.3",
      level: "ok",
      message: `${n1(organic)} kg d'azote organique sur ${n1(totalN)} kg apportés (${pct(share)}) : ${got} point(s).`,
      value: round(share, 1),
      unit: "%",
      points: { got, max: 4 },
      missing: [
        ...ctx.inputs.filter((i) => i.nTotalKgHa === null).map((i) => missing(`teneur en azote ou dose de ${i.product}`, "article", i.articleId)),
        ...(animals === null ? [missing("élevage : azote produit par les animaux (Q1), restitutions au pâturage", "questionnaire")] : []),
      ],
      source: SOURCE("§6.3 p. 69-71", "onglet Fertilisation, P122"),
    }),
  ];
}

/** 6.4 : outils d'aide à la décision sur les cultures principales (plan, reliquat, pilotage), plafond 3. */
export function decisionToolFindings(ctx: HveFertilizationContext): ControlFinding[] {
  const principal = ctx.parcels.filter((p) => p.exports.length);
  if (!principal.length) return [];
  const minor = minorShare(ctx);
  const covered = (ids: string[], ps: HveFertParcel[]) => (sau(ps) ? sau(ps.filter((p) => ids.includes(p.id))) / sau(ps) : 0);
  const fieldCrops = principal.filter((p) => p.family === "field_crops");
  const grassland = principal.filter((p) => p.family === "permanent_grassland");
  const perennial = principal.filter((p) => p.family === "vine" || p.family === "orchard" || p.family === "vegetables");
  const parts: string[] = [];
  let got = 0;
  if (fieldCrops.length) {
    const ppf = covered(ctx.planParcelIds, fieldCrops) > 0 ? 1 : 0;
    const aj = covered(ctx.rshParcelIds, fieldCrops) >= 0.5 ? 1 : 0;
    const odp = covered(ctx.steeringParcelIds, fieldCrops) >= 0.5 ? 1 : 0;
    got = Math.max(got, ppf + aj + odp);
    parts.push(`grandes cultures : plan de fumure ${ppf}, reliquat sortie d'hiver sur ≥ 50 % ${aj}, outil de pilotage sur ≥ 50 % ${odp}`);
    // OPI (blé) déclaré : 3 × part des grandes cultures principales en blé sous OPI.
    const opi = ctx.answers?.opiWheatPercent;
    if (given(opi) && opi > 0) {
      got = Math.max(got, round((3 * opi) / 100));
      parts.push(`OPI sur ${pct(opi)} des grandes cultures (déclaré)`);
    }
  }
  if (grassland.length && covered(ctx.planParcelIds, grassland) > 0) {
    got = Math.max(got, 1);
    parts.push("prairies : plan de fumure 1");
  }
  const perShare = sau(perennial) / sau(principal);
  if (perennial.length && perShare >= 0.5) {
    const v = 1.5 * covered(ctx.planParcelIds, perennial) + 1.5 * Math.max(covered(ctx.rshParcelIds, perennial), covered(ctx.steeringParcelIds, perennial));
    got = Math.max(got, round(v));
    parts.push(`cultures pérennes et légumes : ${n1(v)}`);
  }
  got = Math.min(got, 3);
  const corrected = minor >= MINOR_CROPS_THRESHOLD ? round(got * (1 - minor / 100)) : got;
  const out = [
    finding({
      ruleId: "hve.6.4",
      level: "ok",
      message: `Outils d'aide à la décision (${parts.join(" ; ") || "aucun"}) : ${n1(got)} point(s)${minor >= MINOR_CROPS_THRESHOLD ? `, × (1 − ${pct(minor)}) = ${n1(corrected)}` : ""}.`,
      points: { got: corrected, max: 3 },
      source: SOURCE("§6.4 p. 71-73", "onglet Fertilisation, P168:P191"),
    }),
  ];
  if (minor >= MINOR_CROPS_THRESHOLD) {
    const a = ctx.answers ?? {};
    const share = minor / 100;
    out.push(
      declaredItem(
        "hve.6.4.minor",
        `6.4 OAD des cultures mineures (${pct(minor)} de la SAU)`,
        round(7 * share),
        given(a.minorOadPercent) ? { points: minorOadPoints(a.minorOadPercent, !!a.minorPpf) * share, detail: `${pct(a.minorOadPercent)} sous PPF ajusté ou pilotage${a.minorPpf ? ", PPF sur plus de 50 %" : ""}, × ${pct(minor)}` } : null,
        "onglet Fertilisation, P191",
      ),
    );
  }
  return out;
}

/** 6.5 : part de la SAU sans aucun apport d'azote. */
export function unfertilizedFindings(ctx: HveFertilizationContext): ControlFinding[] {
  const total = sau(ctx.parcels);
  if (!total) return [];
  const fertilized = new Set(ctx.inputs.filter((i) => i.nTotalKgHa === null || i.nTotalKgHa > 0).map((i) => i.parcelId));
  const share = (sau(ctx.parcels.filter((p) => !fertilized.has(p.id))) / total) * 100;
  const got = pointsBySlices(share);
  return [
    finding({
      ruleId: "hve.6.5",
      level: "ok",
      message: `${pct(share)} de la SAU sans apport d'azote : ${got} point(s).`,
      value: round(share, 1),
      unit: "%",
      points: { got, max: 10 },
      source: SOURCE("§6.5 p. 74", "onglet Fertilisation, L215"),
    }),
  ];
}

/** 6.6 : part de la SAU en légumineuses. */
export function legumeFindings(ctx: HveFertilizationContext): ControlFinding[] {
  const total = sau(ctx.parcels);
  if (!total) return [];
  const legumes = ctx.parcels.filter((p) => p.legume);
  const share = (sau(legumes) / total) * 100;
  const got = legumePoints(share);
  return [
    finding({
      ruleId: "hve.6.6",
      level: "ok",
      message: `${pct(share)} de la SAU en légumineuses${legumes.length ? ` (${legumes.map((p) => p.name).join(", ")})` : ""} : ${got} point(s). Les mélanges et les couverts d'interculture ne sont pas reconnus automatiquement.`,
      value: round(share, 1),
      unit: "%",
      points: { got, max: 4 },
      refs: { parcelIds: legumes.map((p) => p.id) },
      source: SOURCE("§6.6 p. 74-75", "onglet Fertilisation, P243"),
    }),
  ];
}

/**
 * 6.7 couverture des sols (déclarée) : terres arables (durée des couverts)
 * et cultures pérennes (inter-rang, réponse du 5.9), pondérées par la SAU ;
 * items horticoles (6.2, 6.8) en attente.
 */
export function declarativeFertilizationFindings(ctx: HveFertilizationContext, interRowCoverPercent?: number | null): ControlFinding[] {
  const total = sau(ctx.parcels);
  const perennial = total ? sau(ctx.parcels.filter((p) => p.family === "vine" || p.family === "orchard")) / total : 0;
  const arable = 1 - perennial;
  const a = ctx.answers ?? {};
  const arableAnswered = arable === 0 || (given(a.coverRegulatory) && given(a.coverWeeks) && given(a.coverPercent));
  const perennialAnswered = perennial === 0 || given(interRowCoverPercent);
  const max = round(4 * arable + 3 * perennial);
  const arablePts = arable && arableAnswered ? soilCoverPoints(!!a.coverRegulatory, a.coverWeeks!, a.coverPercent!, !!a.vulnerableZone) * arable : 0;
  const perennialPts = perennial && perennialAnswered ? interRowPoints(interRowCoverPercent!) * perennial : 0;
  const out = [
    declaredItem(
      "hve.6.7",
      "6.7 Couverture des sols",
      max,
      arableAnswered && perennialAnswered
        ? {
            points: arablePts + perennialPts,
            detail: [
              arable ? `terres arables : ${a.coverRegulatory ? "durée réglementaire respectée" : "durée réglementaire non respectée"}, ${a.coverWeeks} semaines sur ${pct(a.coverPercent ?? 0)}${a.vulnerableZone ? " en zone vulnérable" : ""}` : "",
              perennial ? `inter-rang couvert ${pct(interRowCoverPercent ?? 0)}` : "",
            ]
              .filter(Boolean)
              .join(" ; "),
          }
        : null,
      "onglet Fertilisation, AI288:AJ289, Q300",
    ),
  ];
  if (!ctx.parcels.some((p) => p.family === "horticulture")) return out;
  const items: [string, string, number][] = [
    ["hve.6.2", "6.2 Quantité d'azote (horticulture)", 5],
    ["hve.6.8", "6.8 Matériels optimisant les fertilisants (horticulture)", 6],
  ];
  return [...out, ...items.map(([ruleId, label, max]) =>
    finding({
      ruleId,
      level: "missing",
      message: `${label} : à déclarer dans le questionnaire HVE annuel.`,
      points: { got: 0, max },
      missing: [missing(label, "questionnaire")],
      source: SOURCE(`§${ruleId.slice(4)}`, "onglet Fertilisation"),
    }),
  )];
}

export function hveFertilizationFindings(ctx: HveFertilizationContext, interRowCoverPercent?: number | null): ControlFinding[] {
  return [
    ...nitrogenBalanceFindings(ctx),
    ...organicNitrogenFindings(ctx),
    ...decisionToolFindings(ctx),
    ...unfertilizedFindings(ctx),
    ...legumeFindings(ctx),
    ...declarativeFertilizationFindings(ctx, interRowCoverPercent),
  ];
}
