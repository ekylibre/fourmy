import {
  cerealsB,
  cerealsCau,
  cerealsMh,
  cerealsRf,
  durumWheatSudOuestDefaultBq14,
  durumWheatSudOuestVarietyNeeds2026,
  maizeB,
  maizeCau,
  maizeMh,
  maizeRf,
  mhp as mhpTable,
  mr as mrTable,
  mrci as mrciTable,
  naMethods,
  naOtherCeilings,
  nirr as nirrTable,
  piTillers,
  precedentsApl,
  riAfterCover,
  riCerealsApl,
  riMaizeApl,
  softWheatVarietyNeeds2026,
  valueA as valueADefaults,
  valueAAnnual,
  type CoverBiomassClass,
  type CoverFamily,
  type CropGroup,
  type GrasslandAgeClass,
  type GrasslandMode,
  type GrasslandProductionType,
  type Method,
  type NaSoilType,
  type Opening,
  type RfRow,
} from "@fourmy/fertilization-refs";
import { aplKeyOf, isMaizeOrSorghum, isStrawCereal, mrKeyOf, SPRING_CROPS } from "./crops.js";

/**
 * Dose prévisionnelle d'azote (lot AG, docs/fertilisation-design.md §3.3),
 * selon le référentiel régional Nouvelle-Aquitaine du 29/07/2025 :
 * - maïs et sorgho (annexe 2.2.b, départements 19 23 24 33 40 47 64 87) :
 *   X = [(Pf + Rf) − (Ri + Mh + Mhp + Mr + MrCi + Nirr + 0,6 × N avant 4 f.)] / 0,8 − Xa,
 *   la dose avant 4 feuilles s'ajoutant ;
 * - céréales à paille (2.1.b) : X = [(Pf + Rf) − (Ri + Pi + Mh + Mhp + Mr + MrCi + Nirr)] / CAU − Xa ;
 * - autres cultures : dose plafond (annexe 4), X + Nirr + Xa ≤ plafond.
 * Chaque terme dit d'où il vient. Un terme sans valeur rend le calcul
 * incomplet : rien n'est supposé en silence.
 */

export type Term = "Pf" | "Rf" | "Ri" | "Pi" | "Mh" | "Mhp" | "Mr" | "MrCi" | "Nirr" | "Xa" | "CAU" | "Nbefore4";
export type TermOrigin = "computed" | "measured" | "reference" | "entered" | "override";
export interface TermValue {
  value: number;
  origin: TermOrigin;
  /** Table ou donnée d'où vient la valeur. */
  source: string;
  /** Calcul ou précision, pour l'écran. */
  detail?: string;
}
export interface TermMissing {
  missing: string;
}
export type TermResult = TermValue | TermMissing;
export const isMissing = (t: TermResult | undefined): t is TermMissing => !!t && "missing" in t;

export interface BalanceInput {
  department: string;
  crop: CropGroup;
  /** Variété (besoin par quintal des blés, classement de la campagne). */
  variety?: string | null;
  soilType: NaSoilType | null;
  irrigated: boolean;
  /** Classe d'ouverture du bilan (tables Mr, MrCi) ; par défaut : avril pour une culture de printemps. */
  opening?: Opening;
  /** Objectif de rendement (q/ha, t MS/ha selon la culture). */
  yieldTarget: number | null;
  /** Reliquat mesuré à l'ouverture (kg N/ha). */
  rshMeasured?: { kgNHa: number; sampledOn: string } | null;
  /** Céréales : nombre de talles à l'ouverture (Pi quand le reliquat est mesuré). */
  tillers?: number | null;
  previous?: {
    crop: CropGroup;
    strawReturned: boolean | null;
    /** Rendement réalisé du précédent (même unité que bp). */
    yieldRealized: number | null;
    /** Azote minéral apporté au précédent (kg N/ha). */
    xMineral: number | null;
    /** Équivalent minéral des organiques apportés au précédent (Keq cycle, kg N/ha). */
    xaCycle?: number;
    mhp?: number;
    mrci?: number;
  } | null;
  /** Culture intermédiaire avant la culture. */
  cover?: { family: CoverFamily; biomass: CoverBiomassClass; destruction: "nov_dec" | "after_january" } | null;
  /** Prairie retournée dans l'historique. */
  grassland?: { destruction: "spring" | "autumn"; rank: 1 | 2; productionType: GrasslandProductionType; mode: GrasslandMode | null; ageClass: GrasslandAgeClass } | null;
  /** Pluie du 1er octobre au 1er mai (céréales : au jour d'ouverture), mm. */
  rainMm?: number | null;
  /** Valeur A de l'année précédente (Arvalis) ; sinon la table annuelle, sinon la valeur moyenne. */
  valueA?: number | null;
  /** Équivalent minéral des produits organiques apportés avant l'ouverture (Keq Ri, kg N/ha), pour l'APL. */
  xaBeforeOpening?: number;
  /** Produits organiques après l'ouverture : Xa (Keq bilan), kg N/ha. */
  xa?: { value: number; detail: string } | null;
  irrigation?: { plannedMm: number; no3MgL: number | null; origin: "surface" | "groundwater" | null } | null;
  /** Maïs : azote minéral apporté avant 4 feuilles (kg N/ha), plafonné par le PAR. */
  nBefore4Leaves?: number;
  /** Céréales : CAU 0,8 en conditions défavorables, sur justificatif. */
  unfavourable?: boolean;
  /** Valeurs remplacées par la ferme ou le conseiller, avec leur motif. */
  overrides?: Partial<Record<Term, { value: number; reason: string }>>;
  /** Campagne (année de récolte) : version des tables annuelles. */
  campaign: number;
}

export interface BalanceResult {
  method: Method | "ceiling" | "unsupported";
  annex: string | null;
  equation: string;
  terms: Partial<Record<Term, TermResult>>;
  /** Dose d'azote minéral à apporter (kg N/ha), arrondie ; null si incomplet. */
  dose: number | null;
  /** Dose plafond (kg N efficace/ha) quand la méthode en a une. */
  ceiling: number | null;
  /** Dose calculée inférieure à 30 kg : le forfait de 30 kg est possible (article 12). */
  floor30: boolean;
  /** Dose calculée négative : aucun apport de type II ou III. */
  negative: boolean;
  warnings: string[];
  /** Termes qui manquent pour conclure. */
  missing: string[];
}

const ref = (table: { id: string; source: { ref?: string } }) => `${table.source.ref ?? table.id}`;
/** Arrondi à l'unité, sans l'erreur des flottants (95 × 2,3 = 218,4999… doit donner 219). */
const round = (v: number) => Math.round(Math.round(v * 1e6) / 1e6);

function methodOf(crop: CropGroup, department: string): { method: Method; annex: string } | null {
  const rows = naMethods.rows.filter((r) => r.crops.includes(crop) && (r.departments === "all" || (r.departments as string[]).includes(department)));
  // Départements 16, 17, 79, 86 : bilan additif ou CAU au choix ; l'écriture CAU est retenue, comme pour le reste de la région.
  const row = rows.find((r) => r.method !== "bilan_additive") ?? rows[0];
  return row ? { method: row.method, annex: row.annex } : null;
}

function rfOf(table: { rows: RfRow[] }, soil: NaSoilType): number | null {
  const r = table.rows.find((x) => x.soil === soil);
  if (!r) return null;
  if (r.rfKgNHa !== null) return r.rfKgNHa;
  return r.sameAs ? (table.rows.find((x) => x.soil === r.sameAs)?.rfKgNHa ?? null) : null;
}

const inBand = (v: number, min: number | null, minInc: boolean, max: number | null, maxInc: boolean) =>
  (min === null || (minInc ? v >= min : v > min)) && (max === null || (maxInc ? v <= max : v < max));

/** Lecture bilinéaire d'une grille APL × pluie ; la pluie au-delà de la dernière colonne prend la dernière (les valeurs y plafonnent). */
function gridLookup(rows: { soil: NaSoilType; aplKgNHa: number; rainMm: number; v: number }[], soil: NaSoilType, apl: number, rain: number): { value: number; detail: string } | { missing: string } {
  const own = rows.filter((r) => r.soil === soil);
  if (!own.length) return { missing: "pas d'estimation du référentiel pour ce sol : reliquat à mesurer" };
  const apls = [...new Set(own.map((r) => r.aplKgNHa))].sort((a, b) => a - b);
  const rains = [...new Set(own.map((r) => r.rainMm))].sort((a, b) => a - b);
  if (apl > apls[apls.length - 1]!) return { missing: `APL de ${round(apl)} kg au-delà de la grille (${apls[apls.length - 1]} kg) : reliquat à mesurer` };
  if (rain < rains[0]!) return { missing: `pluie de ${round(rain)} mm en deçà de la grille (${rains[0]} mm) : reliquat à mesurer` };
  const a = Math.max(apl, apls[0]!);
  const r = Math.min(rain, rains[rains.length - 1]!);
  const bracket = (xs: number[], x: number) => {
    let i = xs.findIndex((v) => v >= x);
    if (i <= 0) i = 1;
    return [xs[i - 1]!, xs[i]!] as const;
  };
  const [a0, a1] = bracket(apls, a);
  const [r0, r1] = bracket(rains, r);
  const at = (x: number, y: number) => own.find((o) => o.aplKgNHa === x && o.rainMm === y)!.v;
  const ta = a1 === a0 ? 0 : (a - a0) / (a1 - a0);
  const tr = r1 === r0 ? 0 : (r - r0) / (r1 - r0);
  const v = at(a0, r0) * (1 - ta) * (1 - tr) + at(a1, r0) * ta * (1 - tr) + at(a0, r1) * (1 - ta) * tr + at(a1, r1) * ta * tr;
  const exact = ta === 0 && tr === 0;
  return {
    value: round(v),
    detail: `APL ${round(apl)} kg, pluie ${round(rain)} mm${rain > rains[rains.length - 1]! ? ` (lue à ${rains[rains.length - 1]} mm, dernière colonne)` : ""}${exact ? "" : " : interpolé entre les cases voisines"}`,
  };
}

export function computeBalance(input: BalanceInput): BalanceResult {
  const terms: Partial<Record<Term, TermResult>> = {};
  const warnings: string[] = [];
  const o = input.overrides ?? {};
  const set = (t: Term, v: TermResult) => {
    const ov = o[t];
    terms[t] = ov ? { value: ov.value, origin: "override", source: "valeur de la ferme", detail: ov.reason } : v;
  };
  const opening: Opening = input.opening ?? (SPRING_CROPS.has(input.crop) ? "april" : "end_of_winter");
  const m = methodOf(input.crop, input.department);
  const maize = isMaizeOrSorghum(input.crop);
  const cereal = isStrawCereal(input.crop);

  // --- Méthodes sans bilan : dose plafond -------------------------------------
  if (!m || m.method === "ceiling" || (!maize && !cereal)) {
    const ceilingRows = naOtherCeilings.rows.filter((r) => r.crops.includes(input.crop));
    const generic = naOtherCeilings.rows.find((r) => r.crops.includes("other") && r.cropLabel.startsWith("Autres cultures"));
    // Plusieurs plafonds pour un même groupe (pommiers 100, arboriculture 120 ; sarrasin 50, autres 210…) : l'espèce décide.
    const annualRows = input.crop === "other" ? (generic ? [generic] : []) : ceilingRows.filter((r) => r.period === "year");
    const distinct = [...new Set(annualRows.map((r) => r.doseKgNHa))];
    const supported = !m || m.method === "ceiling";
    const ceiling = annualRows.length === 0 ? (generic?.doseKgNHa ?? null) : distinct.length === 1 ? distinct[0]! : null;
    if (supported && ceiling === null) {
      return {
        method: "ceiling",
        annex: m?.annex ?? "4.4",
        equation: "X + Nirr + Xa ≤ dose plafond",
        terms,
        dose: null,
        ceiling: null,
        floor30: false,
        negative: false,
        warnings: [`Plusieurs plafonds pour ce groupe de cultures : ${annualRows.map((r) => `${r.cropLabel} ${r.doseKgNHa} kg`).join(" ; ")}.`],
        missing: ["espèce : plusieurs doses plafond possibles"],
      };
    }
    if (!supported) warnings.push(`Méthode « ${m!.method} » (annexe ${m!.annex}) pas encore calculée par Fourmy : saisissez la dose d'un outil ou d'un conseiller.`);
    for (const r of ceilingRows.filter((x) => x.period === "3_years")) warnings.push(`${r.cropLabel} : ${r.doseKgNHa} kg N sur trois ans.`);
    return {
      method: supported ? "ceiling" : "unsupported",
      annex: m?.annex ?? "4.4",
      equation: "X + Nirr + Xa ≤ dose plafond",
      terms,
      dose: supported ? ceiling : null,
      ceiling,
      floor30: false,
      negative: false,
      warnings,
      missing: supported ? [] : ["méthode"],
    };
  }

  // --- Pf -------------------------------------------------------------------
  const y = input.yieldTarget;
  if (y === null || !(y > 0)) set("Pf", { missing: "objectif de rendement" });
  else if (maize) {
    const row = maizeB.rows.find((r) => r.crop === input.crop && inBand(y, r.yieldMin, r.yieldMinInclusive, r.yieldMax, r.yieldMaxInclusive));
    set("Pf", row ? { value: round(row.b * y), origin: "reference", source: ref(maizeB), detail: `${y} × b ${row.b} (${row.label})` } : { missing: "besoin par unité de production (b) de cette culture" });
  } else {
    const variety = input.variety?.trim().toUpperCase() ?? "";
    const soft = ["soft_wheat", "improver_wheat"].includes(input.crop) ? softWheatVarietyNeeds2026.rows.find((r) => r.variety.toUpperCase() === variety) : undefined;
    const durum = input.crop === "durum_wheat" ? durumWheatSudOuestVarietyNeeds2026.rows.find((r) => r.variety.toUpperCase() === variety) : undefined;
    const def = cerealsB.rows.find((r) => r.crops.includes(input.crop));
    const b = soft?.b ?? durum?.bq14 ?? (input.crop === "durum_wheat" ? durumWheatSudOuestDefaultBq14 : def?.b);
    const src = soft ? ref(softWheatVarietyNeeds2026) : durum ? ref(durumWheatSudOuestVarietyNeeds2026) : ref(cerealsB);
    set("Pf", b ? { value: round(b * y), origin: "reference", source: src, detail: `${y} q × b ${b}${soft || durum ? ` (variété ${variety})` : ""}` } : { missing: "besoin par quintal (b)" });
  }

  // --- Rf, Mh ------------------------------------------------------------------
  const soil = input.soilType;
  if (!soil) {
    set("Rf", { missing: "type de sol" });
    set("Mh", { missing: "type de sol" });
  } else {
    const rf = rfOf(maize ? maizeRf : cerealsRf, soil);
    set("Rf", rf === null ? { missing: "valeur absente du référentiel pour ce sol" } : { value: rf, origin: "reference", source: ref(maize ? maizeRf : cerealsRf) });
    if (maize) {
      const row = maizeMh.rows.find((r) => r.soil === soil);
      const v = !row ? null : input.crop === "maize_sweet" || input.crop === "maize_seed" ? row.sweetSeedKgNHa : input.irrigated ? row.irrigatedKgNHa : row.dryKgNHa;
      set("Mh", v === null || v === undefined ? { missing: "valeur absente du référentiel pour ce sol" } : { value: v, origin: "reference", source: ref(maizeMh), detail: input.irrigated ? "irrigué" : "en sec" });
    } else {
      const v = cerealsMh.rows.find((r) => r.soil === soil)?.mhKgNHa ?? null;
      set("Mh", v === null ? { missing: "valeur absente du référentiel pour ce sol" } : { value: v, origin: "reference", source: ref(cerealsMh) });
    }
  }

  // --- Mr, MrCi, Mhp ----------------------------------------------------------------
  const prev = input.previous;
  if (!prev) set("Mr", { missing: "culture précédente" });
  else {
    const key = mrKeyOf(prev.crop, prev.strawReturned);
    const row = key ? mrTable.rows.find((r) => r.key === key) : undefined;
    const v = row ? (opening === "april" ? row.aprilKgNHa : row.endOfWinterKgNHa) : null;
    set(
      "Mr",
      v === null || v === undefined
        ? { missing: isStrawCereal(prev.crop) && prev.strawReturned === null ? "gestion des pailles du précédent (enfouies ou enlevées)" : "précédent absent de la table Mr" }
        : { value: v, origin: "reference", source: ref(mrTable), detail: `${row!.label}, ouverture ${opening === "april" ? "en avril" : "en sortie d'hiver"}` },
    );
  }
  if (cereal && !SPRING_CROPS.has(input.crop)) set("MrCi", { value: 0, origin: "reference", source: ref(mrciTable), detail: "céréale d'hiver : pas de culture intermédiaire" });
  else if (!input.cover) set("MrCi", { value: 0, origin: "computed", source: "historique", detail: "pas de culture intermédiaire avant la culture" });
  else {
    const c = input.cover;
    const row = mrciTable.rows.find((r) => r.family === c.family && r.biomass === c.biomass && r.destruction === c.destruction && r.opening === opening);
    set("MrCi", row ? { value: row.mrciKgNHa, origin: "reference", source: ref(mrciTable) } : { missing: "couvert absent de la table MrCi" });
  }
  if (!input.grassland) set("Mhp", { value: 0, origin: "computed", source: "historique", detail: "pas de prairie retournée" });
  else {
    const g = input.grassland;
    const row = mhpTable.rows.find(
      (r) => r.destruction === g.destruction && r.rank === g.rank && (r.productionType === g.productionType || r.productionType === "any") && r.mode === g.mode && r.ageClass === g.ageClass,
    );
    set("Mhp", row ? { value: row.mhpKgNHa, origin: "reference", source: ref(mhpTable) } : { missing: "retournement de prairie absent de la table Mhp" });
  }

  // --- Ri (et Pi des céréales) --------------------------------------------------------
  if (input.rshMeasured) {
    set("Ri", { value: round(input.rshMeasured.kgNHa), origin: "measured", source: "reliquat mesuré", detail: `prélevé le ${input.rshMeasured.sampledOn}` });
    if (cereal) {
      const t = input.tillers;
      const row = t === null || t === undefined ? undefined : piTillers.rows.find((r) => t >= r.tillersMin && (r.tillersMax === null || t <= r.tillersMax));
      set("Pi", row ? { value: row.piKgNHa, origin: "reference", source: ref(piTillers), detail: `${t} talles` } : { missing: "nombre de talles à l'ouverture" });
    }
  } else if (input.cover && maize && soil) {
    const v = riAfterCover.rows.find((r) => r.soil === soil)?.riKgNHa ?? null;
    set("Ri", v === null ? { missing: "reliquat à mesurer (pas d'estimation pour ce sol)" } : { value: v, origin: "reference", source: ref(riAfterCover), detail: "après une culture intermédiaire" });
  } else {
    const est = estimateRi(input, soil, maize);
    set("Ri", est);
    if (cereal && !isMissing(est)) set("Pi", { value: 0, origin: "computed", source: ref(riCerealsApl), detail: "compris dans Ri + Pi de la grille" });
  }

  // --- Nirr ----------------------------------------------------------------------------
  const nirrParams = nirrTable.rows.find((r) => r.scope === (maize ? "maize_sorghum" : "straw_cereals"))!;
  if (!input.irrigated) set("Nirr", { value: 0, origin: "computed", source: "parcelle en sec" });
  else if (!input.irrigation) set("Nirr", { missing: "volume d'irrigation prévu" });
  else {
    const { plannedMm, no3MgL, origin } = input.irrigation;
    const no3 = no3MgL ?? (origin === "surface" ? nirrParams.surfaceNo3MgL : origin === "groundwater" ? nirrParams.groundNo3MgL : null);
    if (no3 === null) set("Nirr", { missing: "origine de l'eau d'irrigation (surface ou souterraine) ou teneur en nitrates mesurée" });
    else if (plannedMm <= nirrParams.thresholdMm)
      set("Nirr", { value: 0, origin: "computed", source: ref(nirrTable), detail: `${round(plannedMm)} mm prévus, pas au-delà de ${nirrParams.thresholdMm} mm : négligeable` });
    else
      set("Nirr", {
        value: round((plannedMm * no3) / nirrParams.divisor),
        origin: no3MgL !== null ? "measured" : "reference",
        source: ref(nirrTable),
        detail: `${round(plannedMm)} mm × ${no3} mg NO3/L ÷ ${nirrParams.divisor}${no3MgL === null ? " (teneur de référence)" : ""}`,
      });
  }

  // --- Xa, CAU ---------------------------------------------------------------------------
  set("Xa", input.xa ? { value: round(input.xa.value), origin: "computed", source: "apports organiques", detail: input.xa.detail } : { value: 0, origin: "computed", source: "apports organiques", detail: "aucun produit organique après l'ouverture" });
  let cauAfter: number;
  let cauBefore = 0;
  if (maize) {
    const after = maizeCau.rows.find((r) => r.crops.includes(input.crop) && r.stage !== "before_4_leaves" && (y === null || r.yieldMaxQ === undefined || inBand(y, r.yieldMinQ ?? null, r.yieldMinInclusive ?? true, r.yieldMaxQ, r.yieldMaxInclusive ?? true)));
    const before = maizeCau.rows.find((r) => r.crops.includes(input.crop) && r.stage === "before_4_leaves");
    cauAfter = after?.cau ?? 0.8;
    cauBefore = before?.cau ?? 0.6;
    set("CAU", { value: cauAfter, origin: "reference", source: ref(maizeCau), detail: `${cauBefore} avant 4 feuilles, ${cauAfter} ensuite` });
    const n4 = Math.max(0, input.nBefore4Leaves ?? 0);
    set("Nbefore4", { value: n4, origin: "entered", source: "apports prévus", detail: n4 ? `${n4} kg N × CAU ${cauBefore} = ${round(n4 * cauBefore)} kg utiles` : "aucun apport avant 4 feuilles" });
    if (n4 > 50) warnings.push("Premier apport sur maïs semé avant le 1er mai plafonné à 50 kg N (PAR 7 Nouvelle-Aquitaine).");
  } else {
    const row = cerealsCau.rows.find((r) => r.condition === (input.unfavourable ? "unfavourable" : "standard"))!;
    cauAfter = row.cau;
    set("CAU", { value: cauAfter, origin: "reference", source: ref(cerealsCau), detail: row.conditionText });
    if (input.unfavourable) warnings.push("CAU 0,8 : sur justificatif, avec un objectif de rendement revu à la baisse.");
  }

  // --- Résultat ---------------------------------------------------------------------------
  const missing = (Object.entries(terms) as [Term, TermResult][]).filter(([, t]) => isMissing(t)).map(([k, t]) => `${k} : ${(t as TermMissing).missing}`);
  const v = (t: Term) => {
    const x = terms[t];
    return x && !isMissing(x) ? x.value : 0;
  };
  const equation = maize
    ? "X = [(Pf + Rf) − (Ri + Mh + Mhp + Mr + MrCi + Nirr + 0,6 × N avant 4 feuilles)] / 0,8 − Xa, plus l'apport avant 4 feuilles"
    : "X = [(Pf + Rf) − (Ri + Pi + Mh + Mhp + Mr + MrCi + Nirr)] / CAU − Xa";
  let dose: number | null = null;
  let negative = false;
  if (!missing.length) {
    const supplies = v("Ri") + v("Pi") + v("Mh") + v("Mhp") + v("Mr") + v("MrCi") + v("Nirr") + (maize ? v("Nbefore4") * cauBefore : 0);
    const raw = (v("Pf") + v("Rf") - supplies) / cauAfter - v("Xa") + (maize ? v("Nbefore4") : 0);
    negative = raw < 0;
    dose = Math.max(0, round(raw));
    if (negative) warnings.push("Dose calculée négative : aucun apport de fertilisant de type II ou III n'est permis.");
  }
  return {
    method: m.method,
    annex: m.annex,
    equation,
    terms,
    dose,
    ceiling: null,
    floor30: dose !== null && dose > 0 && dose < 30,
    negative,
    warnings,
    missing,
  };
}

/**
 * Ri estimé (cas n° 1 des annexes : précédent ordinaire, sans culture
 * intermédiaire) : APL = [(A + X préc. + Xa préc. + Mhp préc. + MrCi préc.) − Pf préc.] × coef RPR
 * + Xa avant ouverture, puis lecture dans la grille sol × APL × pluie.
 */
function estimateRi(input: BalanceInput, soil: NaSoilType | null, maize: boolean): TermResult {
  const prev = input.previous;
  if (!soil) return { missing: "type de sol (ou reliquat mesuré)" };
  if (!prev) return { missing: "culture précédente (ou reliquat mesuré)" };
  const key = aplKeyOf(prev.crop, prev.strawReturned);
  const row = key ? precedentsApl.rows.find((r) => r.key === key) : undefined;
  if (!row || row.bpBase === null) return { missing: "précédent sans référence pour l'estimation : reliquat à mesurer" };
  if (prev.yieldRealized === null || prev.xMineral === null) return { missing: "rendement et fertilisation réalisés du précédent (ou reliquat mesuré)" };
  if (input.rainMm === null || input.rainMm === undefined) return { missing: "pluie depuis le 1er octobre" };
  const annual = valueAAnnual.rows.find((r) => r.year === input.campaign - 1);
  const a = input.valueA ?? annual?.aKgNHa ?? valueADefaults.rows.find((r) => r.key === "moyenne")!.aKgNHa;
  const bp = row.bpBase + row.strawReturnedBonus;
  const pfPrev = prev.yieldRealized * bp;
  const apl = Math.max(0, (a + prev.xMineral + (prev.xaCycle ?? 0) + (prev.mhp ?? 0) + (prev.mrci ?? 0) - pfPrev) * row.coefRpr + (input.xaBeforeOpening ?? 0));
  const grid = maize
    ? riMaizeApl.rows.map((r) => ({ soil: r.soil, aplKgNHa: r.aplKgNHa, rainMm: r.rainMm, v: r.riKgNHa }))
    : riCerealsApl.rows.map((r) => ({ soil: r.soil, aplKgNHa: r.aplKgNHa, rainMm: r.rainMm, v: r.riPlusPiKgNHa }));
  const found = gridLookup(grid, soil, apl, input.rainMm);
  if ("missing" in found) return found;
  return {
    value: found.value,
    origin: "computed",
    source: ref(maize ? riMaizeApl : riCerealsApl),
    detail: `APL = [(A ${a} + X ${round(prev.xMineral)} + Xa ${round(prev.xaCycle ?? 0)} + Mhp ${round(prev.mhp ?? 0)} + MrCi ${round(prev.mrci ?? 0)}) − Pf préc. ${round(pfPrev)} (${prev.yieldRealized} × ${bp})] × ${row.coefRpr}${input.xaBeforeOpening ? ` + ${round(input.xaBeforeOpening)}` : ""} ; ${found.detail}`,
  };
}

/**
 * Objectif de rendement (article 2 du référentiel) : moyenne des 5 dernières
 * campagnes successives de l'exploitation pour la culture, sans la plus haute
 * ni la plus basse ; une année manquante fait remonter à la 6e. À défaut,
 * la référence départementale.
 */
export function yieldTarget(
  history: { campaign: number; yield: number }[],
  campaign: number,
  fallback: { value: number; source: string } | null,
): { value: number; origin: "computed" | "reference"; detail: string } | { missing: string } {
  const years = new Map<number, number>();
  for (const h of history) if (h.campaign < campaign && h.yield > 0) years.set(h.campaign, Math.max(years.get(h.campaign) ?? 0, h.yield));
  const recent = [...years.entries()].filter(([c]) => c >= campaign - 6).sort((a, b) => b[0] - a[0]).slice(0, 5);
  if (recent.length === 5) {
    const values = recent.map(([, v]) => v).sort((a, b) => a - b);
    const kept = values.slice(1, -1);
    const mean = kept.reduce((s, v) => s + v, 0) / kept.length;
    return {
      value: Math.round(mean * 10) / 10,
      origin: "computed",
      detail: `moyenne de ${recent.map(([c, v]) => `${c} : ${v}`).join(", ")}, sans ${values[0]} ni ${values[values.length - 1]}`,
    };
  }
  if (fallback) return { value: fallback.value, origin: "reference", detail: `${recent.length} campagne(s) seulement sur la ferme : ${fallback.source}` };
  return { missing: "pas assez de récoltes sur la ferme, ni de référence départementale" };
}
