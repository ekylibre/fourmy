import { describe, it, expect } from "vitest";
import { computedSoilCover, coverWeeks, type HveSoilCoverParcel } from "../src/index.js";

const p = (id: string, extra: Partial<HveSoilCoverParcel>): HveSoilCoverParcel => ({
  id,
  name: id,
  areaM2: 10_000,
  vulnerable: false,
  alwaysCovered: false,
  previousHarvest: "2025-08-01",
  sownOn: "2026-04-15",
  cover: { kind: "sown", sownOn: "2025-09-01", destroyedOn: null, destructionMode: "mechanical" },
  mineralDuringCover: false,
  canesWorked: false,
  regulatoryOk: null,
  ...extra,
});
const cover = (sownOn: string, destroyedOn: string, destructionMode = "mechanical") => ({ kind: "sown" as const, sownOn, destroyedOn, destructionMode });

describe("HVE 6.7 couverture des sols calculée", () => {
  it("semaines entières de couvert ; destruction chimique ou engrais minéral : 0 ; prairie : continu ; dates manquantes : non calculable", () => {
    expect(coverWeeks(p("a", { cover: cover("2025-09-01", "2025-10-29") }))).toBe(8);
    expect(coverWeeks(p("a", { cover: cover("2025-09-01", "2025-10-26") }))).toBe(7);
    expect(coverWeeks(p("a", { cover: cover("2025-09-01", "2025-12-01", "chemical") }))).toBe(0);
    expect(coverWeeks(p("a", { mineralDuringCover: true }))).toBe(0);
    expect(coverWeeks(p("a", { alwaysCovered: true }))).toBe(Number.POSITIVE_INFINITY);
    expect(coverWeeks(p("a", { previousHarvest: null }))).toBeNull();
    expect(coverWeeks(p("a", { cover: null }))).toBe(0);
    // Repousses de céréales : 20 % de l'interculture (01/08/2025 → 15/04/2026 : 36 semaines → 7).
    expect(coverWeeks(p("a", { cover: { kind: "regrowth_cereal", sownOn: "2025-08-05", destroyedOn: "2026-01-15", destructionMode: "mechanical" } }))).toBe(7);
  });

  it("FAQ Q237 : 2 ha à 7 sem. 2 j, 4 ha à 8 sem. 1 j, 4 ha de PP → 100 % à 7 sem. ou 80 % à 8 sem. : 1 point", () => {
    const r = computedSoilCover([
      p("a", { areaM2: 20_000, cover: cover("2025-09-01", "2025-10-22") }),
      p("b", { areaM2: 40_000, cover: cover("2025-09-01", "2025-10-28") }),
      p("pp", { areaM2: 40_000, alwaysCovered: true }),
    ]);
    expect(r.points).toBe(1);
  });

  it("socle hors zone vulnérable : moins de 6 semaines quelque part → 0 ; zone vulnérable : programme d'actions et points au-delà de 8 semaines ; zones pondérées", () => {
    expect(computedSoilCover([p("a", { cover: cover("2025-09-01", "2025-10-06") }), p("b", { alwaysCovered: true })]).points).toBe(0);
    // Zone vulnérable : conforme au PAR, 12 semaines partout → 4 ; hors zone : 10 semaines partout → 4.
    const zv = p("zv", { vulnerable: true, regulatoryOk: true, cover: cover("2025-09-01", "2025-11-24") });
    const hz = p("hz", { cover: cover("2025-09-01", "2025-11-10") });
    expect(computedSoilCover([zv, hz]).points).toBe(4);
    // Zone vulnérable non conforme : 0 sur sa moitié → 2 au total.
    expect(computedSoilCover([{ ...zv, regulatoryOk: false }, hz]).points).toBe(2);
    // Conformité au PAR inconnue : données manquantes.
    const unknown = computedSoilCover([{ ...zv, regulatoryOk: null }]);
    expect(unknown.points).toBeNull();
    expect(unknown.lacks[0]!.what).toMatch(/programme d'actions/);
  });
});
