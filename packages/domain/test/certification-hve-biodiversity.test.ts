import { describe, it, expect } from "vitest";
import { iaeFindings, mainCropFindings, plotSizeFindings, speciesFindings, untreatedIaeM2, type HveBiodiversityContext, type HveIae } from "../src/index.js";

const iae = (type: string | null, quantity: number, extra: Partial<HveIae> = {}): HveIae => ({ id: `${type}-${quantity}`, label: type ?? "bois", type, validated: true, shared: false, quantity, onArable: true, realM2: null, ...extra });
const ctx = (extra: Partial<HveBiodiversityContext> = {}): HveBiodiversityContext => ({
  sauM2: 1_000_000,
  totalM2: 1_000_000,
  arableM2: 1_000_000,
  arableGrassFallowLegumeM2: 0,
  grassRiceM2: 0,
  iae: [],
  plots: [],
  crops: [],
  coverSpecies: [],
  ...extra,
});

describe("HVE 4.1 IAE", () => {
  it("socle ≥ 4 % des terres arables, poids, diversité de 3 familles", () => {
    // 100 ha de terres arables : 2 000 m de haie (40 000 m²) = 4 % → socle atteint ; poids 4 % → 1 pt ; 1 famille → 0.
    expect(iaeFindings(ctx({ iae: [iae("hedge", 2000)] }))[0]).toMatchObject({ value: 4, points: { got: 1, max: 9 } });
    // Mitoyen : moitié au socle (2 %) → socle manqué → 0 point.
    expect(iaeFindings(ctx({ iae: [iae("hedge", 2000, { shared: true })] }))[0]!.points!.got).toBe(0);
    // Trois familles (haie, mare, mur) → + 2.
    const three = [iae("hedge", 2000), iae("pond", 1000), iae("stone_wall", 100)];
    expect(iaeFindings(ctx({ iae: three }))[0]!.points!.got).toBe(3);
  });

  it("dispense du socle sous 10 ha de terres arables ; IAE proposées non validées : à valider", () => {
    const small = ctx({ sauM2: 80_000, totalM2: 80_000, arableM2: 80_000, iae: [iae("tree", 20)] });
    expect(iaeFindings(small)[0]!.message).toMatch(/dispensé/);
    const pending = iaeFindings(ctx({ iae: [iae("hedge", 2000, { validated: false })] }))[0]!;
    expect(pending).toMatchObject({ level: "missing", points: { got: 0 } });
  });

  it("5.2 : surface réelle des IAE validées, plafond de 5 % de la SAU hors jachères et vergers", () => {
    expect(untreatedIaeM2(ctx({ iae: [iae("hedge", 2000, { realM2: 80_000 }), iae("fallow", 30_000, { realM2: 30_000 })] }))).toBe(50_000 + 30_000);
  });
});

describe("HVE 4.2 à 4.4", () => {
  it("parcelles de moins de 6 ha et prairies permanentes ; culture principale ; espèces", () => {
    const c = ctx({
      plots: [{ areaM2: 50_000, permanentGrassland: false }, { areaM2: 700_000, permanentGrassland: false }, { areaM2: 250_000, permanentGrassland: true }],
      crops: [
        { species: "triticum_aestivum", label: "Blé tendre", areaM2: 500_000, permanentGrassland: false, temporaryGrassland: false },
        { species: "zea_mays", label: "Maïs", areaM2: 250_000, permanentGrassland: false, temporaryGrassland: false },
        { species: "meadow", label: "Prairie", areaM2: 250_000, permanentGrassland: true, temporaryGrassland: false },
      ],
      coverSpecies: ["phacelia", "avena", "vicia"],
    });
    expect(plotSizeFindings(c)[0]).toMatchObject({ value: 30, points: { got: 0 } });
    // Blé : 50 ha sur 75 ha hors PP = 66,7 % → 0.
    expect(mainCropFindings(c)[0]).toMatchObject({ value: 66.7, points: { got: 0 } });
    // 2 cultures + 3 couverts + 2 pour la PP (25 % de SAU) = 7 ; culture principale ≥ 60 % → 2.
    expect(speciesFindings(c)[0]).toMatchObject({ value: 7, points: { got: 2, max: 5 } });
  });
});
