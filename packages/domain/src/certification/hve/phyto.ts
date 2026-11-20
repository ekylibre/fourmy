import type { ControlFinding, HveAnswers } from "@fourmy/contracts";
import { declaredItem, given } from "./declared.js";
import {
  alternativeMethodsPoints,
  cite,
  CMR_MAX,
  interRowPoints,
  leakEquipmentPoints,
  surveillancePoints,
  cmrClassOf,
  HVE_FAMILY_LABELS,
  HVE_GRID_SOURCE,
  IFT_FIELD_CROPS_SOURCE,
  IFT_MAX,
  iftPoints,
  pointsBySlices,
  speciesDiversityPoints,
  vineDiversityPoints,
  type HveFamily,
  type IftReference,
} from "@fourmy/certification-refs";
import { finding, missing } from "../report.js";

/**
 * Indicateur HVE « Stratégie phytosanitaire » (lot CT3, plan de contrôle
 * V4.4 §5) : items 5.1 CMR, 5.2 surfaces non traitées, 5.3 IFT, 5.8 diversité
 * variétale ; items déclaratifs (5.5, 5.6, 5.7, 5.9) en attente du
 * questionnaire (lot CT4).
 */

/** Parcelle de la SAU pendant la période HVE, avec la famille de sa culture. */
export interface HveParcel {
  id: string;
  name: string;
  areaM2: number;
  /** Famille de cultures ; prairie permanente : hors IFT ; null : culture inconnue. */
  family: HveFamily | "permanent_grassland" | null;
  /** Espèce (taxonomie) et variété ou cépage. */
  species: string | null;
  variety: string | null;
  potato?: boolean;
  /** Arboriculture : type de verger des références. */
  orchard?: string | null;
}

/** Produit phytopharmaceutique appliqué sur une parcelle. */
export interface HveTreatment {
  interventionId: string;
  day: string;
  parcelId: string;
  articleId: string;
  product: string;
  /** N° d'autorisation (E-Phy, PCP compris). */
  authorization: string | null;
  biocontrol: boolean | null;
  /** Surface traitée (m²), pour une prairie permanente traitée localement. */
  treatedM2: number | null;
  /** Classe déduite des mentions de danger E-Phy (H340/350/360 → 1, H341/351/361 → 2), pour la cohérence. */
  hazardCmr?: 1 | 2 | null;
}

/** Ligne d'IFT (API du ministère) d'un produit sur une parcelle. */
export interface HveIftLine {
  interventionId: string;
  parcelId: string;
  segmentCode: string | null;
  /** IFT corrigé de la part traitée ; null : non calculé. */
  ift: number | null;
  signed: boolean;
}

export interface HveYear {
  campaign: number;
  parcels: HveParcel[];
  treatments: HveTreatment[];
  ift: HveIftLine[];
  /** Interventions dont l'IFT n'est pas encore calculé (API indisponible). */
  iftPending: string[];
}

export interface HvePhytoContext {
  /** Campagne contrôlée en premier, puis n-1 et n-2 si la moyenne est choisie. */
  years: HveYear[];
  average: boolean;
  /** Références IFT par famille ; null : région ou bassin à préciser. */
  references: Partial<Record<HveFamily, IftReference | null>>;
  /** Pourquoi une référence manque (réglage à faire). */
  referenceIssues: Partial<Record<HveFamily, string>>;
  /** Semences traitées semées pendant la période (produit de traitement non connu). */
  treatedSeeds: { interventionId: string; articleId: string; product: string }[];
  /** 5.2 : surface des IAE comptées comme non traitées (lot CT4 ; plafond déjà appliqué). */
  untreatedIaeM2?: number;
  /** Réponses du questionnaire annuel (5.5, 5.6, 5.7, 5.9). */
  answers?: HveAnswers["phyto"];
}

const pct = (n: number) => `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} %`;
const n2 = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 2 });
const round = (n: number) => Math.round(n * 100) / 100;
const fr = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
const SOURCE = (item: string, at: string) => `Plan de contrôle HVE niveau 3 V4.4 (2024), ${item} ; ${cite({ ...HVE_GRID_SOURCE, at })}`;

/** 5.1 : CMR1 (éliminatoire) et CMR2 (1 point herbicides, 1 point autres). */
export function cmrFindings(treatments: HveTreatment[], seeds: HvePhytoContext["treatedSeeds"]): { findings: ControlFinding[]; cmr1: boolean } {
  const classified = treatments.map((t) => ({ t, c: cmrClassOf(t.authorization, t.day) }));
  const cmr1 = classified.filter((x) => x.c?.cmr === 1);
  const cmr2 = classified.filter((x) => x.c?.cmr === 2);
  const herb2 = cmr2.filter((x) => x.c!.herbicide);
  const other2 = cmr2.filter((x) => !x.c!.herbicide);
  const list = (xs: typeof classified) => [...new Set(xs.map((x) => `${x.t.product} (${fr(x.t.day)}, liste du ${fr(x.c!.list)})`))].join(", ");
  const findings: ControlFinding[] = [];
  const source = SOURCE("§5.1 p. 40-41", "onglet Phyto, P22:P25 ; liste ministérielle des PPP classés CMR");
  if (cmr1.length) {
    findings.push(
      finding({
        ruleId: "hve.5.1",
        level: "danger",
        message: `Produit classé CMR1 utilisé : ${list(cmr1)}. L'indicateur phytosanitaire n'est pas validé (certification refusée), sauf dérogation par arrêté.`,
        points: { got: 0, max: CMR_MAX },
        refs: { interventionIds: [...new Set(cmr1.map((x) => x.t.interventionId))], articleIds: [...new Set(cmr1.map((x) => x.t.articleId))] },
        source,
      }),
    );
  } else {
    const got = (herb2.length ? 0 : 1) + (other2.length ? 0 : 1);
    findings.push(
      finding({
        ruleId: "hve.5.1",
        level: "ok",
        message:
          got === CMR_MAX
            ? "Aucun produit classé CMR utilisé : 2 points."
            : `${got} point(s) : ${[herb2.length ? `herbicide(s) CMR2 : ${list(herb2)}` : "", other2.length ? `autre(s) produit(s) CMR2 : ${list(other2)}` : ""].filter(Boolean).join(" ; ")}.`,
        points: { got, max: CMR_MAX },
        refs: { articleIds: [...new Set(cmr2.map((x) => x.t.articleId))] },
        source,
      }),
    );
  }
  // Cohérence avec les mentions de danger E-Phy (D9) : la liste ministérielle fait foi.
  const discordant = classified.filter((x) => x.t.hazardCmr && x.t.hazardCmr !== x.c?.cmr);
  for (const x of discordant) {
    findings.push(
      finding({
        ruleId: "hve.5.1.hazards",
        level: "warning",
        message: `${x.t.product} : les mentions de danger E-Phy indiquent un classement CMR${x.t.hazardCmr}, la liste ministérielle ${x.c ? `CMR${x.c.cmr}` : "aucun"}. La liste fait foi ; à vérifier.`,
        refs: { articleIds: [x.t.articleId] },
        source: "FAQ HVE v2022 Q127-Q128 ; règlement (CE) 1272/2008",
      }),
    );
  }
  if (seeds.length) {
    findings.push(
      finding({
        ruleId: "hve.5.1.seeds",
        level: "warning",
        message: `Semences traitées semées : ${[...new Set(seeds.map((s) => s.product))].join(", ")}. Vérifiez que le produit de traitement n'est pas classé CMR (FAQ Q129).`,
        refs: { articleIds: [...new Set(seeds.map((s) => s.articleId))] },
        source: "FAQ HVE v2022 Q129",
      }),
    );
  }
  return { findings, cmr1: cmr1.length > 0 };
}

const sau = (parcels: HveParcel[]) => parcels.reduce((s, p) => s + p.areaM2, 0);

/** 5.2 : part de la SAU sans traitement phytosanitaire hors biocontrôle. */
export function untreatedFindings(year: HveYear, iaeM2 = 0): ControlFinding[] {
  const total = sau(year.parcels);
  if (!total) return [];
  const chemical = year.treatments.filter((t) => t.biocontrol !== true);
  const unknown = year.treatments.filter((t) => t.biocontrol === null);
  let treated = 0;
  for (const p of year.parcels) {
    const ts = chemical.filter((t) => t.parcelId === p.id);
    if (!ts.length) continue;
    // Prairie permanente traitée localement : seule la surface traitée est exclue.
    treated += p.family === "permanent_grassland" ? Math.min(p.areaM2, Math.max(...ts.map((t) => t.treatedM2 ?? p.areaM2))) : p.areaM2;
  }
  const share = Math.min(((total - treated + iaeM2) / total) * 100, 100);
  const got = pointsBySlices(share);
  return [
    finding({
      ruleId: "hve.5.2",
      level: "ok",
      message: `${pct(share)} de la SAU sans traitement phytosanitaire hors biocontrôle${iaeM2 ? `, IAE validées comprises (${n2(iaeM2 / 10_000)} ha)` : ""} : ${got} point(s).`,
      value: round(share),
      unit: "%",
      points: { got, max: 10 },
      missing: unknown.length ? [...new Set(unknown.map((t) => t.articleId))].map((id) => missing("biocontrôle ou non (produit hors E-Phy)", "article", id)) : undefined,
      source: SOURCE("§5.2 p. 41-42", "onglet Phyto, P55"),
    }),
  ];
}

const HERBICIDE = new Set(["S3"]);
const OTHER = new Set(["S4", "S5", "S6"]);

/** IFT d'une famille sur une année : herbicides et hors herbicides, par ha de la famille. */
function familyIft(year: HveYear, family: HveFamily) {
  const parcels = year.parcels.filter((p) => p.family === family);
  const area = sau(parcels);
  const ids = new Set(parcels.map((p) => p.id));
  const lines = year.ift.filter((l) => ids.has(l.parcelId));
  const areaOf = new Map(parcels.map((p) => [p.id, p.areaM2]));
  const sum = (codes: Set<string>) => lines.filter((l) => l.segmentCode && codes.has(l.segmentCode) && l.ift !== null).reduce((s, l) => s + l.ift! * areaOf.get(l.parcelId)!, 0) / (area || 1);
  const pendingTreatments = year.treatments.filter((t) => ids.has(t.parcelId) && year.iftPending.includes(t.interventionId));
  const missingLines = lines.filter((l) => l.ift === null || !l.segmentCode);
  return {
    area,
    herbicide: sum(HERBICIDE),
    other: sum(OTHER),
    unsigned: lines.filter((l) => l.ift !== null && !l.signed),
    incomplete: [...new Set([...pendingTreatments.map((t) => t.interventionId), ...missingLines.map((l) => l.interventionId)])],
  };
}

/** 5.3 : IFT herbicides et hors herbicides comparés aux références, par famille, × part de SAU. */
export function iftFindings(ctx: HvePhytoContext): ControlFinding[] {
  const [year] = ctx.years;
  if (!year) return [];
  const total = sau(year.parcels);
  const out: ControlFinding[] = [];
  for (const family of ["field_crops", "vine", "orchard"] as const) {
    const parcels = year.parcels.filter((p) => p.family === family);
    if (!parcels.length) continue;
    const max = IFT_MAX[family]!;
    const share = sau(parcels) / total;
    const ref = ctx.references[family];
    const years = ctx.average ? ctx.years.filter((y) => y.parcels.some((p) => p.family === family)) : [year];
    const per = years.map((y) => familyIft(y, family));
    const herbicide = per.reduce((s, x) => s + x.herbicide, 0) / per.length;
    const other = per.reduce((s, x) => s + x.other, 0) / per.length;
    const incomplete = per.flatMap((x) => x.incomplete);
    const unsigned = per.flatMap((x) => x.unsigned);
    const label = HVE_FAMILY_LABELS[family];
    const period = ctx.average && years.length > 1 ? ` (moyenne de ${years.length} campagnes)` : "";
    if (!ref) {
      out.push(
        finding({
          ruleId: "hve.5.3",
          level: "missing",
          message: `${label} : IFT herbicides ${n2(herbicide)}, hors herbicides ${n2(other)}${period} ; références à préciser : ${ctx.referenceIssues[family] ?? "région inconnue"}.`,
          points: { got: 0, max: round(max * share) },
          missing: [missing(ctx.referenceIssues[family] ?? "région ou bassin des références IFT", "settings")],
          source: SOURCE("§5.3 p. 42-47", "onglets Scoring_GC, Scoring_Viticulture, Scoring_Arboriculture"),
        }),
      );
      continue;
    }
    const scale = family === "orchard" ? "orchard" : "standard";
    const ph = iftPoints(herbicide, ref[0], ref[1], scale);
    const po = iftPoints(other, ref[2], ref[3], scale);
    const got = round((ph + po) * share);
    out.push(
      finding({
        ruleId: "hve.5.3",
        level: "ok",
        message: `${label}${period} : IFT herbicides ${n2(herbicide)} (plancher ${n2(ref[0])}, plafond ${n2(ref[1])}) : ${ph} pt ; hors herbicides ${n2(other)} (plancher ${n2(ref[2])}, plafond ${n2(ref[3])}) : ${po} pt ; × ${pct(share * 100)} de la SAU = ${n2(got)} point(s). Biocontrôle et semences exclus.`,
        value: round(herbicide + other),
        points: { got, max: round(max * share) },
        missing: incomplete.length ? [...new Set(incomplete)].map((id) => missing("IFT non calculé (API du ministère)", "intervention", id)) : undefined,
        refs: { parcelIds: parcels.map((p) => p.id) },
        source: SOURCE("§5.3 p. 42-47", `onglet ${family === "field_crops" ? "Scoring_GC" : family === "vine" ? "Scoring_Viticulture" : "Scoring_Arboriculture"} ; ${IFT_FIELD_CROPS_SOURCE.text}`),
      }),
    );
    if (unsigned.length) {
      out.push(
        finding({
          ruleId: "hve.5.3.signature",
          level: "warning",
          message: `${label} : ${unsigned.length} IFT sans signature de l'API du ministère (calculés avant le lot CT3) : l'auditeur les recalculera. Recalculez-les depuis la fiche des interventions.`,
          refs: { interventionIds: [...new Set(unsigned.map((l) => l.interventionId))] },
          source: "Plan de contrôle HVE niveau 3 V4.4, §5.3.4 p. 47",
        }),
      );
    }
  }
  return out;
}

/** 5.8 : diversité spécifique et variétale (vigne, arboriculture, légumes, horticulture), × part de SAU. */
export function diversityFindings(year: HveYear): ControlFinding[] {
  const total = sau(year.parcels);
  const out: ControlFinding[] = [];
  for (const family of ["vine", "orchard", "vegetables", "horticulture"] as const) {
    const parcels = year.parcels.filter((p) => p.family === family);
    if (!parcels.length) continue;
    const share = sau(parcels) / total;
    const max = family === "vine" ? 2 : 6;
    const noVariety = parcels.filter((p) => !p.variety);
    let raw: number;
    let detail: string;
    if (family === "vine") {
      const varieties = new Set(parcels.flatMap((p) => (p.variety ? [p.variety.toLowerCase()] : [])));
      raw = vineDiversityPoints(varieties.size);
      detail = `${varieties.size} cépage(s)${varieties.size === 2 ? " (les clones ne sont pas enregistrés : 3 clones valent 2 points)" : ""}`;
    } else {
      const bySpecies = new Map<string, Set<string>>();
      for (const p of parcels) if (p.species && p.variety) bySpecies.set(p.species, (bySpecies.get(p.species) ?? new Set()).add(p.variety.toLowerCase()));
      raw = speciesDiversityPoints([...bySpecies.values()].map((s) => s.size));
      detail = `${bySpecies.size} espèce(s), ${[...bySpecies.values()].reduce((s, v) => s + v.size, 0)} variété(s)`;
    }
    const got = round(raw * share);
    out.push(
      finding({
        ruleId: "hve.5.8",
        level: "ok",
        message: `${HVE_FAMILY_LABELS[family]} : ${detail} : ${raw} pt × ${pct(share * 100)} de la SAU = ${n2(got)} point(s).`,
        points: { got, max: round(max * share) },
        missing: noVariety.length ? noVariety.map((p) => missing(`variété ou cépage de ${p.name}`, "production", p.id)) : undefined,
        source: SOURCE("§5.8 p. 53-54", "onglet Phyto, L275:L299"),
      }),
    );
  }
  return out;
}

/** Items déclaratifs (questionnaire annuel) : 5.5, 5.6, 5.7 ; 5.9 pour les cultures pérennes, × leur part de SAU. */
export function declarativePhytoFindings(year: HveYear, a: HveAnswers["phyto"] = {}): ControlFinding[] {
  const total = sau(year.parcels);
  const perennialShare = total ? sau(year.parcels.filter((p) => p.family === "vine" || p.family === "orchard")) / total : 0;
  const out = [
    declaredItem(
      "hve.5.5",
      "5.5 Surveillance active des bioagresseurs",
      3,
      given(a.diagnosticTool) || given(a.collectiveProspection) || given(a.bsvObserverPercent)
        ? {
            points: surveillancePoints(!!a.diagnosticTool, !!a.collectiveProspection, a.bsvObserverPercent ?? 0),
            detail: `outil de diagnostic ${a.diagnosticTool ? "oui" : "non"}, prospection collective ${a.collectiveProspection ? "oui" : "non"}, observateur BSV ${pct(a.bsvObserverPercent ?? 0)}`,
          }
        : null,
      "onglet Phyto, R199:R200",
    ),
    declaredItem(
      "hve.5.6",
      "5.6 Méthodes alternatives",
      3,
      given(a.alternativeMethodsPercent) ? { points: alternativeMethodsPoints(a.alternativeMethodsPercent), detail: `${pct(a.alternativeMethodsPercent)} de la SAU` } : null,
      "onglet Phyto, P239:P242",
    ),
    declaredItem("hve.5.7", "5.7 Limitation des fuites (équipements du pulvérisateur)", 2, given(a.leakEquipment) ? { points: leakEquipmentPoints(a.leakEquipment), detail: `${a.leakEquipment} équipement(s)` } : null, "onglet Phyto ; plan V4.4 annexe 6"),
  ];
  if (perennialShare > 0) {
    out.push(
      declaredItem(
        "hve.5.9",
        "5.9 Couvert de l'inter-rang",
        round(3 * perennialShare),
        given(a.interRowCoverPercent) ? { points: interRowPoints(a.interRowCoverPercent) * perennialShare, detail: `${pct(a.interRowCoverPercent)} de l'inter-rang × ${pct(perennialShare * 100)} de la SAU` } : null,
        "onglet Phyto",
      ),
    );
  }
  return out;
}

/** Indicateur complet ; avec un CMR1, tous les items valent 0 (« audit non valide »). */
export function hvePhytoFindings(ctx: HvePhytoContext): ControlFinding[] {
  const [year] = ctx.years;
  if (!year) return [];
  const cmr = cmrFindings(year.treatments, ctx.treatedSeeds);
  const items = [...cmr.findings, ...untreatedFindings(year, ctx.untreatedIaeM2 ?? 0), ...iftFindings(ctx), ...diversityFindings(year), ...declarativePhytoFindings(year, ctx.answers)];
  return cmr.cmr1 ? items.map((f) => (f.points ? { ...f, points: { ...f.points, got: 0 } } : f)) : items;
}

/** Saisie : CMR1 rouge, CMR2 orange, à la date du traitement. */
export function cmrInterventionFindings(day: string, products: { articleId: string; product: string; authorization: string | null }[]): ControlFinding[] {
  return products.flatMap((p) => {
    const c = cmrClassOf(p.authorization, day);
    if (!c) return [];
    return [
      finding({
        ruleId: "hve.5.1",
        level: c.cmr === 1 ? "danger" : "warning",
        message:
          c.cmr === 1
            ? `${p.product} est classé CMR1 (liste du ${fr(c.list)}) : son usage invalide l'indicateur phytosanitaire HVE.`
            : `${p.product} est classé CMR2 (liste du ${fr(c.list)}) : 1 point HVE perdu (${c.herbicide ? "herbicides" : "autres produits"}).`,
        refs: { articleIds: [p.articleId] },
        source: SOURCE("§5.1 p. 40-41", "liste ministérielle des PPP classés CMR"),
      }),
    ];
  });
}
