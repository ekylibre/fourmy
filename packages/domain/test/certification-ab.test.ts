import { describe, it, expect } from "vitest";
import { DEFAULT_CERTIFICATION_SETTINGS } from "@fourmy/contracts";
import {
  abParcelStatuses,
  conversionFindings,
  copperFindings,
  evaluateCampaign,
  evaluateIntervention,
  fertilizerFindings,
  harvestStatus,
  nitrogenFindings,
  phytoFindings,
  type AbApplication,
  type CertificationContext,
} from "../src/index.js";

const P = { id: "p1", name: "Le Champ", areaM2: 10_000, startedOn: "2024-03-01", declaredLevel: "conversion" };
const names = new Map([["p1", "Le Champ"]]);
const app = (extra: Partial<AbApplication>): AbApplication => ({ interventionId: "i1", day: "2026-05-01", parcelId: "p1", articleId: "a1", product: "Produit", kind: "phyto", organicAllowed: true, ...extra });

describe("conversion AB (déduite)", () => {
  it("bornes : C1 avant 12 mois, AB pour une annuelle semée 24 mois après, une pérenne récoltée 36 mois après", () => {
    expect(harvestStatus("2024-03-01", "annual", "2024-04-01", "2025-02-28")).toBe("C1");
    expect(harvestStatus("2024-03-01", "annual", "2024-04-01", "2025-03-01")).toBe("C2");
    expect(harvestStatus("2024-03-01", "annual", "2026-02-28", "2026-07-15")).toBe("C2");
    expect(harvestStatus("2024-03-01", "annual", "2026-03-01", "2026-07-15")).toBe("AB");
    expect(harvestStatus("2024-03-01", "semi_perennial", "2026-03-01", "2026-07-15")).toBe("AB");
    expect(harvestStatus("2024-03-01", "perennial", "2010-01-01", "2027-02-28")).toBe("C2");
    expect(harvestStatus("2024-03-01", "perennial", "2010-01-01", "2027-03-01")).toBe("AB");
  });

  it("un produit interdit fait redémarrer la conversion ; certifiée à tort → orange", () => {
    const prods = [{ id: "x", parcelId: "p1", label: "Blé", cycle: "annual" as const, sownOn: "2026-10-15", harvestOn: "2027-07-10" }];
    const ok = abParcelStatuses([P], prods, [], "2027-12-31");
    expect(ok[0]).toMatchObject({ conversionStart: "2024-03-01", status: "AB" });
    const reset = abParcelStatuses([P], prods, [app({ day: "2025-06-01", organicAllowed: false, product: "Interdit" })], "2027-12-31");
    expect(reset[0]).toMatchObject({ conversionStart: "2025-06-01", status: "C2", resetBy: { product: "Interdit" } });
    const [f] = conversionFindings([{ ...reset[0]!, declaredLevel: "certified" }]);
    expect(f).toMatchObject({ level: "warning", breach: { inao: "28" } });
    expect(conversionFindings(ok)[0]!.message).toMatch(/peut passer en AB/);
  });
});

describe("traitements AB", () => {
  it("phyto non utilisable en AB : rouge (manquement n° 4, majeur) ; statut inconnu : données manquantes", () => {
    const [bad] = phytoFindings([app({ organicAllowed: false, product: "ACTI" })], names);
    expect(bad).toMatchObject({ level: "danger", breach: { inao: "4", class: "major" } });
    expect(bad!.message).toMatch(/conversion de la parcelle redémarre/);
    expect(phytoFindings([app({ organicAllowed: null })], names)[0]!.level).toBe("missing");
    expect(phytoFindings([app({})], names)).toEqual([]);
  });

  it("cuivre : 28 kg sur 7 ans glissants ; orange à 80 % ; au-delà, n° 328 à confirmer ; teneur inconnue : pas de vert", () => {
    const cu = (day: string, kgHa: number | null) => app({ day, copperKgHa: kgHa });
    expect(copperFindings([P], [cu("2026-05-01", 4)], "2026-12-31")[0]).toMatchObject({ level: "ok", value: 4 });
    expect(copperFindings([P], [cu("2020-05-01", 10), cu("2026-05-01", 12.4)], "2026-12-31")[0]).toMatchObject({ level: "warning", value: 22.4 });
    // Hors fenêtre : 2019 ne compte plus en 2026.
    expect(copperFindings([P], [cu("2019-12-31", 10), cu("2026-05-01", 4)], "2026-12-31")[0]!.value).toBe(4);
    const over = copperFindings([P], [cu("2022-05-01", 20), cu("2026-05-01", 8.1)], "2026-12-31")[0]!;
    expect(over).toMatchObject({ level: "warning", value: 28.1, breach: { inao: "328", unconfirmed: true } });
    expect(copperFindings([P], [cu("2026-05-01", null)], "2026-12-31")[0]!.level).toBe("missing");
    expect(copperFindings([P], [app({})], "2026-12-31")).toEqual([]);
  });
});

describe("fertilisation AB", () => {
  const fert = (extra: Partial<AbApplication>) => app({ kind: "fertilizer", organicAllowed: undefined, categories: ["manure"], effluentOrigin: "conventional", nTotalKgHa: 50, ...extra });

  it("azote minéral et matière hors annexe II : rouge ; élevage industriel : orange (n° 364, mineur) ; catégorie absente : données manquantes", () => {
    expect(fertilizerFindings([fert({ syntheticNitrogen: true, categories: null })], names)[0]).toMatchObject({ ruleId: "ab.R15", level: "danger", breach: { inao: "4" } });
    expect(fertilizerFindings([fert({ categories: ["sewage_sludge"] })], names)[0]).toMatchObject({ ruleId: "ab.R14", level: "danger" });
    expect(fertilizerFindings([fert({ effluentOrigin: "industrial" })], names)[0]).toMatchObject({ ruleId: "ab.R17", level: "warning", breach: { inao: "364", class: "minor" } });
    expect(fertilizerFindings([fert({ effluentOrigin: "unknown" })], names)[0]).toMatchObject({ ruleId: "ab.R17", level: "warning" });
    expect(fertilizerFindings([fert({ categories: null })], names)[0]!.level).toBe("missing");
    expect(fertilizerFindings([fert({}), fert({ categories: ["guano"] })], names)).toEqual([]);
  });

  it("170 kg N des effluents : orange à 80 %, orange avec n° 40 au-delà ; les autres matières ne comptent pas", () => {
    const n = (nTotalKgHa: number | null, categories: string[] | null = ["manure"]) => fert({ nTotalKgHa, categories });
    expect(nitrogenFindings([P], [n(100), n(80, ["guano"])], "2026-01-01", "2026-12-31")[0]).toMatchObject({ level: "ok", value: 100 });
    expect(nitrogenFindings([P], [n(100), n(36)], "2026-01-01", "2026-12-31")[0]).toMatchObject({ level: "warning", value: 136 });
    expect(nitrogenFindings([P], [n(100), n(71)], "2026-01-01", "2026-12-31")[0]).toMatchObject({ level: "warning", value: 171, breach: { inao: "40" } });
    expect(nitrogenFindings([P], [n(100), n(null)], "2026-01-01", "2026-12-31")[0]!.level).toBe("missing");
    expect(nitrogenFindings([P], [n(100, null)], "2026-01-01", "2026-12-31")[0]!.level).toBe("missing");
  });
});

describe("rapport et saisie AB", () => {
  it("rapport : sections Conversion, Traitements, Fertilisation ; verdict rouge sur un produit interdit", () => {
    const ctx: CertificationContext = {
      kind: "ab",
      campaign: 2026,
      period: { from: "2026-01-01", to: "2026-12-31" },
      parcels: [P],
      certifications: [{ parcelId: "p1", kind: "ab", level: "conversion", startedOn: "2024-03-01", stoppedOn: null }],
      settings: DEFAULT_CERTIFICATION_SETTINGS,
      ab: { parcels: [P], productions: [], applications: [app({ organicAllowed: false })] },
    };
    const r = evaluateCampaign(ctx);
    expect(r.sections.map((s) => s.id)).toEqual(["perimeter", "conversion", "treatments", "seeds", "production", "fertilization"]);
    expect(r.verdict).toBe("danger");
    expect(r.sections.find((s) => s.id === "fertilization")!.level).toBe("na");
  });

  it("saisie : cumul du cuivre avec l'historique, et seulement sur les parcelles AB", () => {
    const r = evaluateIntervention({
      procedure: "spraying",
      day: "2026-06-01",
      parcelIds: ["p1"],
      certifications: [{ parcelId: "p1", kind: "ab", level: "certified", startedOn: "2020-01-01", stoppedOn: null }],
      inputs: [],
      equipmentIds: [],
      justification: null,
      ab: { parcels: [P], current: [app({ day: "2026-06-01", copperKgHa: 3 })], history: [app({ day: "2023-06-01", copperKgHa: 21 })] },
    });
    expect(r).toMatchObject({ level: "warning", findings: [{ ruleId: "ab.R21", value: 24 }] });
    expect(evaluateIntervention({ procedure: "spraying", day: "2026-06-01", parcelIds: ["p1"], certifications: [], inputs: [], equipmentIds: [], justification: null })).toBeNull();
  });
});
