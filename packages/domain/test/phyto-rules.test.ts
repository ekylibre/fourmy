import { describe, it, expect } from "vitest";
import {
  articleUnitBase,
  checkTreatment,
  productValidAt,
  usageCovers,
  usageDosePerHa,
  usageValidAt,
  type ParcelContext,
  type PhytoProductRef,
  type PhytoUsageRef,
  type TreatmentCheckInput,
} from "../src/index.js";

// Données inspirées du référentiel réel (Lexicon, E-Phy) : GLISTER ULTRA 360
// (AMM 2150140, vendu aussi sous le nom BARBARIAN ST), traitements généraux.
const glister: PhytoProductRef = {
  amm: "2150140",
  name: "GLISTER ULTRA 360",
  state: "authorized",
  startedOn: "2015-08-12",
  stoppedOn: null,
  reentryDelayHours: 6,
  natures: ["Herbicide"],
};
const usage = (patch: Partial<PhytoUsageRef>): PhytoUsageRef => ({
  id: "u",
  cropLabel: "Traitements généraux",
  species: ["plant"],
  targetLabel: "Désherbage",
  doseQuantity: 3,
  doseUnitLabel: "L/ha",
  preHarvestDelayDays: 3,
  applicationsCount: null,
  untreatedBufferAquatic: 5,
  state: "authorized",
  decisionDate: "2020-01-01",
  isDerogation: false,
  derogationStartedOn: null,
  derogationStoppedOn: null,
  ...patch,
});
const MAIZE = ["zea_mays", "zea", "poaceae", "plant", "bioproduct"];
const VINE = ["vitis", "vitaceae", "plant", "bioproduct"];
const parcel = (patch: Partial<ParcelContext> = {}): ParcelContext => ({
  id: "p1",
  name: "Monassut Maïs 2025",
  treatedHa: 12.46,
  lineage: MAIZE,
  cultivationLabel: "Maïs",
  waterLoaded: true,
  waterDistanceM: 156,
  waterName: "Ruisseau Labésiau",
  previousApplications: 0,
  nextHarvestAt: null,
  ...patch,
});
const base = (patch: Partial<TreatmentCheckInput> = {}): TreatmentCheckInput => ({
  at: "2025-09-23T15:00:00.000Z",
  article: { name: "Barbarian ST", amm: "2150140", unit: "Litre" },
  dose: { quantity: 2, per: "hectare" },
  product: glister,
  usages: [usage({ id: "g3", doseQuantity: 3 }), usage({ id: "g6", doseQuantity: 6 })],
  cropsets: { ephy_wheat: ["triticum", "triticosecale"], ephy_corn: ["zea"] },
  parcels: [parcel()],
  ...patch,
});
const byCode = (r: ReturnType<typeof checkTreatment>, code: string) => r.indicators.filter((i) => i.code === code);

describe("unités", () => {
  it("lit les unités des articles repris d'Ekylibre", () => {
    expect(articleUnitBase("Litre")).toEqual({ base: "L", factor: 1 });
    expect(articleUnitBase("Kilogramme")).toEqual({ base: "kg", factor: 1 });
    expect(articleUnitBase("Sac de 12 Kg")).toEqual({ base: "kg", factor: 12 });
    expect(articleUnitBase("liter")).toEqual({ base: "L", factor: 1 });
    expect(articleUnitBase("milliers")).toBeNull();
  });
  it("ne compare que les doses à l'hectare", () => {
    expect(usageDosePerHa({ doseQuantity: 500, doseUnitLabel: "mL/ha" })).toEqual({ base: "L", value: 0.5 });
    expect(usageDosePerHa({ doseQuantity: 2, doseUnitLabel: "kg/ha" })).toEqual({ base: "kg", value: 2 });
    expect(usageDosePerHa({ doseQuantity: 0.5, doseUnitLabel: "L/hL" })).toBeNull();
  });
});

describe("validité à la date", () => {
  it("un produit retiré depuis était autorisé à la date du traitement", () => {
    const withdrawn = { ...glister, state: "withdrawn", stoppedOn: "2018-12-21" };
    expect(productValidAt(withdrawn, "2016-05-01T08:00:00Z").valid).toBe(true);
    expect(productValidAt(withdrawn, "2019-05-01T08:00:00Z")).toEqual({ valid: false, reason: "retiré le 21/12/2018" });
    expect(productValidAt(glister, "2014-05-01T08:00:00Z").valid).toBe(false);
  });
  it("un usage retiré vaut avant sa décision ; une dérogation dans sa fenêtre", () => {
    expect(usageValidAt(usage({ state: "withdrawn", decisionDate: "2021-01-01" }), "2020-06-01")).toBe(true);
    expect(usageValidAt(usage({ state: "withdrawn", decisionDate: "2021-01-01" }), "2022-06-01")).toBe(false);
    const derog = usage({ state: "authorized", isDerogation: true, derogationStartedOn: "2025-03-01", derogationStoppedOn: "2025-06-29" });
    expect(usageValidAt(derog, "2025-04-01")).toBe(true);
    expect(usageValidAt(derog, "2025-07-01")).toBe(false);
  });
  it("un usage couvre une culture par sa lignée ou un ensemble E-Phy", () => {
    const sets = { ephy_wheat: ["triticum", "triticosecale"], ephy_corn: ["zea"] };
    expect(usageCovers(usage({ species: ["plant"] }), MAIZE, sets)).toBe(true);
    expect(usageCovers(usage({ species: ["ephy_corn"] }), MAIZE, sets)).toBe(true);
    expect(usageCovers(usage({ species: ["ephy_wheat"] }), ["x_triticosecale", "poaceae", "plant"], sets)).toBe(true);
    expect(usageCovers(usage({ species: ["vitis"] }), MAIZE, sets)).toBe(false);
  });
});

describe("contrôle d'un traitement", () => {
  it("cas conforme : autorisé, dose sous le maximum, ZNT respectée, délais indiqués", () => {
    const r = checkTreatment(base());
    expect(r.level).toBe("info");
    expect(byCode(r, "authorization")[0]).toMatchObject({ level: "ok", message: expect.stringMatching(/autorisé sur Maïs/) });
    expect(byCode(r, "dose")[0]).toMatchObject({ level: "ok", message: expect.stringMatching(/Dose 2 L\/ha, maximum 6 L\/ha \(cible non précisée/) });
    expect(byCode(r, "znt")[0]).toMatchObject({ level: "ok", message: expect.stringMatching(/156 m/) });
    expect(r.harvestAllowedFrom).toBe("2025-09-26T15:00:00.000Z");
    expect(r.reentryAllowedFrom).toBe("2025-09-23T21:00:00.000Z");
    expect(r.usages.map((u) => u.id)).toEqual(["g3", "g6"]);
  });

  it("dose au-dessus du maximum de l'usage choisi → feu rouge", () => {
    const r = checkTreatment(base({ usageId: "g3", dose: { quantity: 4, per: "hectare" } }));
    expect(byCode(r, "dose")[0]).toMatchObject({ level: "danger", message: "Dose 4 L/ha au-dessus du maximum autorisé (3 L/ha)." });
    expect(r.level).toBe("danger");
  });

  it("dose saisie au total : ramenée à l'hectare sur la surface traitée", () => {
    // 80 L sur 12,46 ha = 6,42 L/ha > 6 L/ha.
    expect(byCode(checkTreatment(base({ dose: { quantity: 80, per: "total" } })), "dose")[0]!.level).toBe("danger");
    expect(byCode(checkTreatment(base({ dose: { quantity: 70, per: "total" } })), "dose")[0]!.level).toBe("ok");
  });

  it("aucun usage sur la culture → feu rouge ; culture inconnue → orange", () => {
    const vineOnly = [usage({ id: "v", species: ["vitis"], cropLabel: "Vigne" })];
    const r = checkTreatment(base({ usages: vineOnly }));
    expect(byCode(r, "authorization")[0]).toMatchObject({ level: "danger", message: expect.stringMatching(/Aucun usage autorisé de GLISTER ULTRA 360 sur Maïs/) });
    const unknown = checkTreatment(base({ parcels: [parcel({ lineage: null, cultivationLabel: null })] }));
    expect(byCode(unknown, "authorization")[0]).toMatchObject({ level: "warning", message: expect.stringMatching(/Culture inconnue/) });
  });

  it("produit retiré à la date → feu rouge", () => {
    const r = checkTreatment(base({ product: { ...glister, state: "withdrawn", stoppedOn: "2024-01-31" } }));
    expect(byCode(r, "authorization")[0]).toMatchObject({ level: "danger", message: expect.stringMatching(/retiré le 31\/01\/2024/) });
  });

  it("ZNT : distance réelle à l'eau sous la ZNT → feu rouge avec le cours d'eau ; données absentes → orange", () => {
    const near = checkTreatment(base({ parcels: [parcel({ waterDistanceM: 3.4 })] }));
    expect(byCode(near, "znt")[0]).toMatchObject({ level: "danger", message: "ZNT de 5 m non respectée : Monassut Maïs 2025 à 3 m de « Ruisseau Labésiau »." });
    const crossing = checkTreatment(base({ parcels: [parcel({ waterDistanceM: 0, waterName: null })] }));
    expect(byCode(crossing, "znt")[0]!.message).toBe("ZNT de 5 m non respectée : Monassut Maïs 2025 touche un point d'eau (cours d'eau qui traverse ou borde la zone traitée).");
    const noData = checkTreatment(base({ parcels: [parcel({ waterLoaded: false, waterDistanceM: null })] }));
    expect(byCode(noData, "znt")[0]!.level).toBe("warning");
    const noWater = checkTreatment(base({ parcels: [parcel({ waterDistanceM: null, waterName: null })] }));
    expect(byCode(noWater, "znt")[0]).toMatchObject({ level: "ok", message: expect.stringMatching(/pas d'eau à proximité/) });
  });

  it("nombre d'applications dépassé → feu rouge", () => {
    const limited = [usage({ id: "l", applicationsCount: 2 })];
    expect(byCode(checkTreatment(base({ usages: limited, parcels: [parcel({ previousApplications: 1 })] })), "applications")[0]!.level).toBe("ok");
    const over = checkTreatment(base({ usages: limited, parcels: [parcel({ previousApplications: 2 })] }));
    expect(byCode(over, "applications")[0]).toMatchObject({ level: "danger", message: expect.stringMatching(/Plus de 2 application\(s\).*\(3e\)/) });
  });

  it("récolte avant la fin du délai avant récolte → feu rouge", () => {
    const r = checkTreatment(base({ usageId: "g3", parcels: [parcel({ nextHarvestAt: "2025-09-25T08:00:00.000Z" })] }));
    expect(byCode(r, "dar")[0]).toMatchObject({ level: "danger", message: expect.stringMatching(/Délai avant récolte de 3 j non respecté : récolte le 25\/09\/2025/) });
  });

  it("produit sans AMM ou absent du référentiel : orange, rien d'autre", () => {
    const noAmm = checkTreatment(base({ article: { name: "Huile maison", amm: null, unit: "Litre" } }));
    expect(noAmm.indicators).toEqual([expect.objectContaining({ level: "warning", message: expect.stringMatching(/pas de n° AMM/) })]);
    const absent = checkTreatment(base({ product: null }));
    expect(absent.indicators).toEqual([expect.objectContaining({ level: "warning", message: expect.stringMatching(/absent du référentiel/) })]);
  });

  it("vigne et maïs dans le même traitement : seuls les usages communs aux deux", () => {
    const usages = [usage({ id: "all", species: ["plant"] }), usage({ id: "vine", species: ["vitis"], doseQuantity: 1 })];
    const r = checkTreatment(base({ usages, parcels: [parcel(), parcel({ id: "p2", name: "Vigne", lineage: VINE, cultivationLabel: "Vigne" })] }));
    expect(r.usages.map((u) => u.id)).toEqual(["all"]);
    // Un seul usage possible : retenu d'office (dose, ZNT, délais de cet usage).
    expect(r.usageId).toBe("all");
  });

  it("jachère (activité) : seuls les usages « Jachères et cultures intermédiaires » et « Traitements généraux »", () => {
    const usages = [
      usage({ id: "fallow", cropLabel: "Jachères et cultures intermédiaires", doseQuantity: 2 }),
      usage({ id: "jevi", cropLabel: "Jevi" }),
      usage({ id: "general", cropLabel: "Traitements généraux", doseQuantity: 4 }),
    ];
    const fallow = parcel({ name: "Monassut Jachère 2023", lineage: ["plant", "bioproduct"], cultivationLabel: "Jachère", cropLabels: ["Jachères et cultures intermédiaires", "Traitements généraux"] });
    const r = checkTreatment(base({ usages, parcels: [fallow] }));
    expect(r.usages.map((u) => u.id).sort()).toEqual(["fallow", "general"]);
    expect(r.indicators.find((i) => i.code === "authorization")).toMatchObject({ level: "ok", message: "GLISTER ULTRA 360 autorisé sur Jachère." });
    expect(r.usageId).toBeNull(); // deux usages : à préciser
    // Sur du maïs, les usages des jachères et des Jevi ne valent pas.
    const maize = checkTreatment(base({ usages }));
    expect(maize.usages.map((u) => u.id)).toEqual(["general"]);
  });
});

describe("pictogrammes de danger (CLP)", () => {
  it("déduits des mentions H, préséances comprises", async () => {
    const { hazardPictograms } = await import("../src/index.js");
    // Callisto : H319, H361d, H400, H410.
    expect(hazardPictograms(["H319", "H361d", "H400", "H410"])).toEqual(["SGH07", "SGH08", "SGH09"]);
    // Toxicité aiguë : pas de point d'exclamation en plus.
    expect(hazardPictograms(["H301", "H319"])).toEqual(["SGH06"]);
    // Corrosif : l'irritation des yeux ne donne pas SGH07, une autre mention si.
    expect(hazardPictograms(["H314", "H319"])).toEqual(["SGH05"]);
    expect(hazardPictograms(["H314", "H302"])).toEqual(["SGH05", "SGH07"]);
    // Sans pictogramme (H412, EUH401) ; table Lexicon en complément.
    expect(hazardPictograms(["H412", "EUH401"], ["SGH09"])).toEqual(["SGH09"]);
  });
});

describe("mélanges (arrêté de 2015, règle d'Ekylibre)", () => {
  it("catégorie 5 seule ; deux produits d'une même catégorie 2, 3 ou 4 interdits", async () => {
    const { checkMixture, dangerMessages } = await import("../src/index.js");
    const a = { articleId: "a", name: "Callisto", mixCodes: [1, 3] };
    const b = { articleId: "b", name: "Dimba", mixCodes: [1] };
    const c = { articleId: "c", name: "Lotryne", mixCodes: [1, 3] };
    const d = { articleId: "d", name: "Seul", mixCodes: [5] };
    expect(checkMixture([a, b])).toEqual({ level: "ok", issues: [] });
    expect(checkMixture([a, c]).issues.map((i) => i.message)).toEqual(["Mélange interdit : Callisto et Lotryne sont tous de catégorie 3."]);
    expect(checkMixture([b, d]).issues.map((i) => i.message)).toEqual(["Seul ne se mélange avec aucun autre produit (catégorie 5)."]);
    expect(checkMixture([d])).toEqual({ level: "ok", issues: [] });
    expect(dangerMessages({ checks: [{ indicators: [{ level: "danger", message: "Dose" }] }], mixture: checkMixture([a, c]) })).toHaveLength(2);
  });
});

describe("agriculture biologique", () => {
  it("parcelle AB : produit non utilisable en AB → feu rouge ; utilisable → vert", () => {
    const abParcel = parcel({ organic: true });
    const r = checkTreatment(base({ parcels: [abParcel] }));
    expect(r.indicators.find((i) => i.code === "organic")).toMatchObject({ level: "danger", message: expect.stringMatching(/n'est pas utilisable en agriculture biologique/) });
    expect(r.level).toBe("danger");
    const ok = checkTreatment(base({ parcels: [abParcel], product: { ...glister, organic: true } }));
    expect(ok.indicators.find((i) => i.code === "organic")).toMatchObject({ level: "ok" });
    expect(checkTreatment(base()).indicators.some((i) => i.code === "organic")).toBe(false);
  });
});
