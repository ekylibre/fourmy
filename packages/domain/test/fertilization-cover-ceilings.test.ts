import { describe, expect, it } from "vitest";
import { coverSpreading, type CoverSpreadingInput } from "../src/fertilization/index.js";

const base: CoverSpreadingInput = {
  date: "2025-09-10",
  type: "II",
  cover: { kind: "sown", pureLegumes: false, exported: false, sownOn: "2025-09-01", destroyedOn: "2025-12-20" },
  interculture: "long",
  zar: false,
  west: false,
};

describe("épandage sur couvert d'interculture (PAR 7 NA, tableau 4)", () => {
  it("CINE : 50 kg hors ZAR pour les types I et II ; type III et ZAR interdits", () => {
    expect(coverSpreading(base)).toMatchObject({ allowed: true, ceiling: 50, cumulates: "organic" });
    expect(coverSpreading({ ...base, type: "III" })).toMatchObject({ allowed: false, reason: expect.stringContaining("non exporté") });
    expect(coverSpreading({ ...base, zar: true })).toMatchObject({ allowed: false });
  });
  it("repousses, légumineuses pures, période de 15 jours avant le semis à 30 jours avant la destruction", () => {
    expect(coverSpreading({ ...base, cover: { ...base.cover, kind: "regrowth_cereal" } })).toMatchObject({ allowed: false, reason: expect.stringContaining("repousses de céréales") });
    expect(coverSpreading({ ...base, cover: { ...base.cover, pureLegumes: true } })).toMatchObject({ allowed: false });
    expect(coverSpreading({ ...base, date: "2025-08-10" })).toMatchObject({ allowed: false, reason: expect.stringContaining("15 jours avant son semis (17/08/2025)") });
    expect(coverSpreading({ ...base, date: "2025-11-25" })).toMatchObject({ allowed: false, reason: expect.stringContaining("à partir du 21/11/2025") });
  });
  it("CIE : 70 kg hors ZAR ; en ZAR 30 (courte) ou 50 (longue) ; zone ouest avant culture d'automne : 50", () => {
    const cie = { ...base, cover: { ...base.cover, exported: true } };
    expect(coverSpreading(cie)).toMatchObject({ ceiling: 70, cumulates: "organic" });
    expect(coverSpreading({ ...cie, zar: true })).toMatchObject({ ceiling: 50 });
    expect(coverSpreading({ ...cie, zar: true, interculture: "short" })).toMatchObject({ ceiling: 30 });
    expect(coverSpreading({ ...cie, interculture: "short", west: true })).toMatchObject({ ceiling: 50, label: expect.stringContaining("zone ouest") });
    // Type III : 70 kg en cumulant ; interdit à partir du 15/10 si le couvert est exporté avant la fin de l'année.
    expect(coverSpreading({ ...cie, type: "III" })).toMatchObject({ ceiling: 70, cumulates: "all" });
    expect(coverSpreading({ ...cie, type: "III", date: "2025-10-20" })).toMatchObject({ allowed: false });
    // Exporté l'année suivante : 70 kg en cumulant ; en ZAR, type III interdit avant le 1er février.
    const next = { ...cie, cover: { ...cie.cover, destroyedOn: "2026-04-15" }, date: "2025-10-20" };
    expect(coverSpreading({ ...next, type: "III" })).toMatchObject({ allowed: true, ceiling: 70, cumulates: "all" });
    expect(coverSpreading({ ...next, type: "III", zar: true })).toMatchObject({ allowed: false });
  });
});
