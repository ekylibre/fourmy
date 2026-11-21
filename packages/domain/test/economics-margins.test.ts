import { describe, it, expect } from "vitest";
import { itkContent, type EcoContext, type ItkArticleInfo, type ItkInputsContext, type ItkWorkContext, type Price } from "@fourmy/contracts";
import { cropPlanMargins, type MarginItem } from "../src/index.js";

/**
 * Marges de l'assolement (lot E4) sur un exemple chiffré à la main : 10 ha de
 * blé, 70 q/ha à 200 €/t ; semis (semoir au barème, 30 €/ha, 2 ha/h),
 * fertilisation (épandeur à son prix, 10 €/ha, 5 ha/h saisi), récolte en
 * prestation (150 €/ha), traitement « si besoin » non compté.
 */
const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SEED = ID(1);
const AMMO = ID(2);
const DRILL = ID(3);
const SPREADER = ID(4);
const WHEAT = ID(5);
const art = (id: string, a: Partial<ItkArticleInfo>): ItkArticleInfo => ({ id, name: id, kind: "other", unit: "kilogram", density: null, tgwG: null, grainsPerDose: null, fertilizer: null, ...a });

const content = itkContent.parse({
  schema: 1,
  steps: [
    { id: ID(11), procedure: "sowing", anchor: { kind: "sowing", offsetDays: 0 }, staffing: { equipmentIds: [DRILL], personIds: [] }, inputs: [{ articleId: SEED, kind: "seed", label: "Blé", dose: 180, unit: "kilogram_per_hectare" }] },
    { id: ID(12), procedure: "mineral_fertilizing", anchor: { kind: "date", monthDay: "02-15", yearOffset: 0 }, workRateHaH: 5, staffing: { equipmentIds: [SPREADER], personIds: [] }, inputs: [{ articleId: AMMO, kind: "fertilizer", label: "Ammo", dose: 200, unit: "kilogram_per_hectare" }] },
    { id: ID(13), procedure: "harvesting", anchor: { kind: "harvest", offsetDays: 0 } },
    { id: ID(14), procedure: "spraying", anchor: { kind: "sowing", offsetDays: 30 }, optional: true, staffing: { equipmentIds: [SPREADER], personIds: [] } },
  ],
});

const work: ItkWorkContext = {
  year: 2027,
  itineraries: { itk: { id: "itk", name: "Blé", revision: 1, activityId: WHEAT, content } },
  equipments: [
    { id: DRILL, name: "Semoir 3 m", widthM: 3, machineryRateId: "bcma-semoir", suggestedRateId: null, carrier: false },
    { id: SPREADER, name: "Épandeur", widthM: 24, machineryRateId: null, suggestedRateId: null, carrier: false },
  ],
  people: [],
  crewTemplates: {},
  observed: [],
  machineryRates: { "bcma-semoir": { id: "bcma-semoir", label: "Semoir 3 m", family: "Semis", widthM: 3, haH: 2, unit: "hectares", costPerUnit: 30, costPerHour: 60 } },
  familyPerMeter: {},
  routes: {},
  site: null,
  settings: { workdayHours: 8, weeklyHoursPerPerson: 45, defaultSiteId: null },
  rateSource: "test",
};
const inputs: ItkInputsContext = {
  year: 2027,
  at: "2026-11-21",
  articles: { [SEED]: art(SEED, { name: "Blé Chevignon", kind: "seed" }), [AMMO]: art(AMMO, { name: "Ammonitrate", kind: "fertilizer" }) },
  stock: {},
  reserved: {},
  plans: {},
};
const price = (p: Partial<Price>): Price => ({
  id: crypto.randomUUID(),
  kind: "article",
  articleId: null,
  equipmentId: null,
  activityId: null,
  product: null,
  procedure: null,
  unit: "kilogram",
  amount: 0,
  validFrom: "2026-01-01",
  source: "farm",
  sourceRef: null,
  sourceDate: null,
  note: null,
  createdAt: "2026-01-01T00:00:00Z",
  ...p,
});
const prices = [
  price({ articleId: SEED, unit: "kilogram", amount: 0.6 }),
  price({ articleId: AMMO, unit: "ton", amount: 500 }),
  price({ kind: "equipment", equipmentId: SPREADER, unit: "hectare", amount: 10 }),
  price({ kind: "service", procedure: "harvesting", unit: "hectare", amount: 150 }),
  price({ kind: "labour", unit: "hour", amount: 20 }),
];
const eco: EcoContext = { year: 2027, department: "44", labour: null, activities: [] };
const item: MarginItem = {
  id: "a1",
  parcelKey: "p:A",
  routeKey: null,
  areaM2: 100_000,
  activityId: WHEAT,
  itineraryId: "itk",
  sowingOn: "2026-10-15",
  harvestOn: "2027-07-10",
  year: 2027,
  forecasts: [{ product: "principal", yield: 70, unit: "quintal_per_hectare", price: 200, priceUnit: "ton" }],
};

describe("marges de l'assolement", () => {
  it("exemple chiffré : produit, charges, marges brute et directe, à l'hectare", () => {
    const m = cropPlanMargins([item], { work, inputs, eco, prices, day: "2026-11-21" });
    // Produit 70 q × 10 ha × 20 €/q = 14 000 ; intrants 1 800 kg × 0,6 + 2 t × 500 = 2 080.
    // Mécanisation 300 (barème) + 100 (prix propre) + 1 500 (prestation) ; main-d'œuvre (5 h + 2 h) × 20 = 140.
    expect(m.activities).toEqual([
      {
        activityId: WHEAT,
        areaHa: 10,
        product: 14_000,
        operational: 2_080,
        grossMargin: 11_920,
        mechanisation: 1_900,
        labour: 140,
        directMargin: 9_880,
        perHa: { product: 1_400, operational: 208, grossMargin: 1_192, mechanisation: 190, labour: 14, directMargin: 988 },
        incomplete: [],
        withoutItinerary: 0,
      },
    ]);
    expect(m.total).toMatchObject({ areaHa: 10, directMargin: 9_880 });
    expect(m.missing).toEqual([]);
  });

  it("prix manquants : postes incomplets listés, jamais comptés pour zéro sans le dire", () => {
    const m = cropPlanMargins([{ ...item, forecasts: [{ product: "principal", yield: 70, unit: "quintal_per_hectare" }] }], {
      work,
      inputs,
      eco,
      prices: prices.filter((p) => p.articleId !== AMMO && p.kind !== "labour" && p.kind !== "service"),
      day: "2026-11-21",
    });
    expect(m.activities[0]!.incomplete.sort()).toEqual(["labour", "mechanisation", "operational", "product"]);
    expect(m.missing.map((x) => [x.post, x.label, x.tab, x.areaHa])).toEqual([
      ["product", "Prix de vente", "product", 10],
      ["operational", "Prix de Ammonitrate", "article", 10],
      ["labour", "Coût horaire de la main-d'œuvre", "labour", 10],
      ["mechanisation", "Matériel ou prestation : Récolte", "service", 10],
      // Récolte sans matériel ni prestation : pas de débit, donc heures inconnues.
      ["labour", "Débit de chantier inconnu", null, 10],
    ]);
  });

  it("défauts du contexte économique et culture sans itinéraire", () => {
    const withDefaults: EcoContext = {
      ...eco,
      activities: [
        {
          activityId: WHEAT,
          production: "winter_common_wheat",
          specie: "triticum_aestivum",
          farmYields: [],
          agreste: [],
          suggestions: [],
          farmPrice: null,
          yield: { value: 68, unit: "quintal_per_hectare", source: "agreste", label: "Agreste" },
          price: { value: 196.37, unit: "ton", source: "lexicon", label: "La Pallice" },
        },
      ],
    };
    const m = cropPlanMargins([{ ...item, itineraryId: null, forecasts: undefined }], { work, inputs, eco: withDefaults, prices, day: "2026-11-21" });
    // 68 q × 10 ha × 19,637 €/q = 13 353,16 ; sans itinéraire, ni charges ni main-d'œuvre.
    expect(m.activities[0]).toMatchObject({ product: 13_353.16, operational: 0, mechanisation: 0, labour: 0, directMargin: 13_353.16, withoutItinerary: 1, incomplete: [] });
  });
});
