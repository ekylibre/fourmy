import type { FertilizerComposition } from "@fourmy/contracts";

/**
 * Composition proposée d'un fertilisant (FR-FERT-6), d'après son nom puis son
 * code Lexicon. La proposition reste « proposée » tant que l'utilisateur ne
 * l'a pas confirmée ; une teneur reprise d'Ekylibre ou une analyse prime.
 * Engrais minéraux seulement : les produits organiques viennent du
 * référentiel régional (annexe 5, lot AF).
 */

export type Proposal = FertilizerComposition & { source: string };

const num = (s: string) => Number(s.replace(",", "."));
const mineral = (n: number, extra: Partial<FertilizerComposition> = {}): FertilizerComposition => ({
  basis: "mass_percent",
  nTotal: n,
  nMineralShare: 1,
  p2o5: null,
  k2o: null,
  so3: null,
  density: null,
  nitrateType: "III",
  foliar: false,
  ...extra,
});

/** Solutions azotées : densité usuelle selon la teneur (UAN 30 % : 1,28 à 1,30 ; 39 % : 1,32). */
const UAN_DENSITY = 1.3;

/** Engrais simples reconnus par leur nom, avec la teneur par défaut si le nom n'en porte pas. */
const SIMPLE: { pattern: RegExp; label: string; n?: number; k2o?: number; p2o5?: number; so3?: number; uan?: boolean; amendment?: boolean }[] = [
  { pattern: /\bur[ée]e\b/i, label: "urée", n: 46 },
  { pattern: /ammonitrate|nitrate d'ammonium/i, label: "ammonitrate", n: 33.5 },
  { pattern: /solution azot[ée]e|\buan\b|\bn ?39\b|\bn ?30\b/i, label: "solution azotée", n: 30, uan: true },
  { pattern: /sulfate d'ammoni/i, label: "sulfate d'ammoniaque", n: 21, so3: 60 },
  { pattern: /nitrate de (chaux|calcium)/i, label: "nitrate de calcium", n: 15.5 },
  { pattern: /chlorure de potass|\bkcl\b/i, label: "chlorure de potasse", n: 0, k2o: 60 },
  { pattern: /sulfate de potass/i, label: "sulfate de potasse", n: 0, k2o: 50, so3: 45 },
  { pattern: /superphosphate triple|\btsp\b/i, label: "superphosphate triple", n: 0, p2o5: 45 },
  { pattern: /phosphate (di)?ammoni|\bdap\b/i, label: "phosphate diammonique", n: 18, p2o5: 46 },
  { pattern: /\bchaux\b|carbonate de calcium|calcaire|dolomie/i, label: "amendement calcique", n: 0, amendment: true },
];

/** « 9,5-15-30 », « 4-7-28 », « 15 15 15 » : N-P2O5-K2O en % de la masse. */
const NPK = /(?:^|[^\d,.])(\d{1,2}(?:[.,]\d)?)\s*[-–/ ]\s*(\d{1,2}(?:[.,]\d)?)\s*[-–/ ]\s*(\d{1,2}(?:[.,]\d)?)(?![\d,.])/;

export function proposeFromName(name: string): Proposal | null {
  const npk = NPK.exec(name);
  if (npk) {
    const [n, p, k] = [num(npk[1]!), num(npk[2]!), num(npk[3]!)];
    if (n + p + k > 0 && n + p + k <= 100) {
      return { ...mineral(n, { p2o5: p, k2o: k, nMineralShare: n > 0 ? 1 : null, nitrateType: n > 0 ? "III" : null }), source: `nom « ${name} » (N-P-K)` };
    }
  }
  for (const s of SIMPLE) {
    if (!s.pattern.test(name)) continue;
    const digits = /(\d{1,3}(?:[.,]\d)?)/.exec(name.replace(/\b(19|20)\d{2}\b/g, ""));
    let n = s.n ?? 0;
    let density: number | null = null;
    let basis: FertilizerComposition["basis"] = "mass_percent";
    if (s.uan) {
      density = UAN_DENSITY;
      const v = digits ? num(digits[1]!) : null;
      // « Solution azotée 390 » : 390 kg N/m³ ; « Solution azotée 30 » : 30 %.
      if (v !== null && v >= 100 && v <= 500) {
        basis = "kg_per_m3";
        n = v;
      } else if (v !== null && v > 0 && v <= 50) n = v;
    } else if (digits && s.n && s.n > 0) {
      const v = num(digits[1]!);
      if (v > 0 && v <= 60) n = v;
    }
    const c = mineral(n, {
      basis,
      density,
      p2o5: s.p2o5 ?? null,
      k2o: s.k2o ?? null,
      so3: s.so3 ?? null,
      nMineralShare: n > 0 ? 1 : null,
      nitrateType: n > 0 ? "III" : null,
    });
    return { ...c, source: `nom « ${name} » (${s.label})` };
  }
  return null;
}

/** Codes Lexicon d'Ekylibre : `urea_46`, `ammonitrate_33`, `liquid_nitrogen_30_d1.3`, `potassium_chloride`… */
export function proposeFromLexicon(ref: string | null | undefined): Proposal | null {
  if (!ref) return null;
  const m = /^([a-z_]+?)(?:_(\d+(?:\.\d+)?))?(?:_d(\d(?:\.\d+)?))?$/.exec(ref);
  if (!m) return null;
  const [, base, value, d] = m;
  const v = value ? Number(value) : null;
  const density = d ? Number(d) : null;
  const source = `Lexicon ${ref}`;
  switch (base) {
    case "urea":
      return { ...mineral(v ?? 46), source };
    case "ammonitrate":
      return { ...mineral(v ?? 33.5), source };
    case "liquid_nitrogen":
      return { ...mineral(v ?? 30, { density: density ?? UAN_DENSITY }), source };
    case "ammonium_sulfate":
      return { ...mineral(v ?? 21, { so3: 60 }), source };
    case "potassium_chloride":
      return { ...mineral(0, { k2o: v ?? 60, nMineralShare: null, nitrateType: null }), source };
    case "quick_lime":
    case "lime":
      return { ...mineral(0, { nMineralShare: null, nitrateType: null }), source };
    default:
      return null;
  }
}

/** Proposition : d'après le nom (plus précis, propre à la ferme), sinon d'après le code Lexicon. */
export function proposeComposition(article: { name: string; lexiconRef?: string | null }): Proposal | null {
  return proposeFromName(article.name) ?? proposeFromLexicon(article.lexiconRef);
}
