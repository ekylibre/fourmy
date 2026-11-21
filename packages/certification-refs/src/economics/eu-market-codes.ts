import type { RefSource } from "../source.js";

/**
 * Codes produits des prix de marché des céréales de l'API agrifood de la
 * Commission européenne (`/api/cereal/prices`), avec l'espèce Lexicon et le
 * débouché (lot E3, claudedocs/conception_assolement.md §9.1). Correspondance
 * reprise de Lexicon (`lib/datasources/eu_market_prices.rb`).
 */
export interface EuMarketCode {
  code: string;
  specie: string;
  label: string;
  /** Débouché : panification, alimentation animale, brasserie… */
  outlet: string;
}

export const EU_MARKET_CODES_SOURCE: RefSource = {
  text: "Commission européenne, API agrifood (prix des céréales) ; correspondance des codes de Lexicon (eu_market_prices)",
  version: "2026",
  at: "GET https://api.tech.ec.europa.eu/agrifood/api/cereal/prices",
};

export const EU_MARKET_CODES: readonly EuMarketCode[] = [
  { code: "BLTPAN", specie: "triticum_aestivum", label: "Blé tendre panifiable", outlet: "meunerie" },
  { code: "BLTFOUR", specie: "triticum_aestivum", label: "Blé tendre fourrager", outlet: "alimentation animale" },
  { code: "DUR", specie: "triticum_durum", label: "Blé dur", outlet: "semoulerie" },
  { code: "MAI", specie: "zea_mays", label: "Maïs", outlet: "alimentation animale" },
  { code: "ORGBRAS", specie: "hordeum_vulgare", label: "Orge brassicole", outlet: "brasserie" },
  { code: "ORGFOUR", specie: "hordeum_vulgare", label: "Orge fourragère", outlet: "alimentation animale" },
  { code: "AVO", specie: "avena_sativa", label: "Avoine fourragère", outlet: "alimentation animale" },
  { code: "AVOMILL", specie: "avena_sativa", label: "Avoine meunière", outlet: "meunerie" },
  { code: "SEGPAN", specie: "secale_cereale", label: "Seigle panifiable", outlet: "meunerie" },
  { code: "SEGFOUR", specie: "secale_cereale", label: "Seigle fourrager", outlet: "alimentation animale" },
  { code: "TRI", specie: "x_triticosecale", label: "Triticale", outlet: "alimentation animale" },
];

/** Code proposé par défaut pour une production Lexicon (débouché le plus courant). */
export const PRODUCTION_MARKET_CODE: Record<string, string> = {
  winter_common_wheat: "BLTPAN",
  spring_common_wheat: "BLTPAN",
  winter_hard_wheat: "DUR",
  spring_hard_wheat: "DUR",
  winter_barley: "ORGFOUR",
  spring_barley: "ORGBRAS",
  grain_corn: "MAI",
  winter_oat: "AVO",
  spring_oat: "AVO",
  winter_triticale: "TRI",
  spring_triticale: "TRI",
  winter_rye: "SEGFOUR",
};

const BY_CODE = new Map(EU_MARKET_CODES.map((c) => [c.code, c]));
export const euMarketCode = (code: string): EuMarketCode | null => BY_CODE.get(code) ?? null;

/** Codes d'une espèce ; celui de la production en premier quand il est connu. */
export function marketCodesFor(specie: string | null, production: string | null): EuMarketCode[] {
  const preferred = production ? PRODUCTION_MARKET_CODE[production] : undefined;
  return EU_MARKET_CODES.filter((c) => c.specie === specie).sort((a, b) => Number(b.code === preferred) - Number(a.code === preferred));
}
