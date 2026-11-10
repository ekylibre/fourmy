import { describe, it, expect } from "vitest";
import {
  uuidv5,
  idsFor,
  toLiters,
  articleKind,
  productionNature,
  interventionStatus,
  parameterRole,
  containerKind,
  capacityFromLabel,
  hasHourMeter,
  samsysId,
  equipmentExternalIds,
  commissionedAt,
  crewsOf,
  isMotorised,
  mergeSpans,
} from "../src/index.js";

describe("uuidv5", () => {
  it("respecte le vecteur de test RFC 4122 (espace DNS)", () => {
    expect(uuidv5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
  });
  it("est déterministe et distingue les instances", () => {
    const a = idsFor("ekylibre:phaurigot");
    const b = idsFor("ekylibre:entredeuxterres");
    expect(a("products", 12)).toBe(a("products", 12));
    expect(a("products", 12)).not.toBe(b("products", 12));
    expect(a("products", 12)).not.toBe(a("interventions", 12));
  });
});

describe("règles de correspondance", () => {
  it("convertit les volumes en litres", () => {
    expect(toLiters(50, "hectoliter")).toBe(5000);
    expect(toLiters(500, "liter")).toBe(500);
    expect(toLiters(2, "cubic_meter")).toBe(2000);
    expect(toLiters(3, "kilogram")).toBeNull();
    expect(toLiters(null, "liter")).toBeNull();
  });

  it("un AMM vide ou blanc ne fait pas un phyto", () => {
    expect(articleKind({ variety: "preparation", france_maaid: "2100093" })).toBe("phyto");
    expect(articleKind({ variety: "preparation", france_maaid: "" })).toBe("fertilizer");
    expect(articleKind({ variety: "preparation", france_maaid: "  " })).toBe("fertilizer");
    expect(articleKind({ variety: "seed", france_maaid: null })).toBe("seed");
    expect(articleKind({ variety: "equipment_part", france_maaid: null })).toBe("other");
  });

  it("classe productions, statuts, rôles et contenants", () => {
    expect(productionNature("vine_farming")).toBe("vine");
    expect(productionNature("plant_farming")).toBe("field_crop");
    expect(productionNature("administering")).toBeNull();
    expect(interventionStatus("validated")).toBe("done");
    expect(interventionStatus("rejected")).toBeNull();
    expect(parameterRole("InterventionInput")).toBe("input");
    expect(parameterRole("InterventionGroupParameter")).toBeNull();
    expect(containerKind("tank")).toBe("tank");
    expect(containerKind("tractor")).toBeNull();
  });

  it("lit la capacité annoncée par un libellé", () => {
    expect(capacityFromLabel("Cuve 50 hl")).toBe(5000);
    expect(capacityFromLabel("Garde vin 5hl")).toBe(500);
    expect(capacityFromLabel("Barrique 225 L")).toBe(225);
    expect(capacityFromLabel("Cuve inox")).toBeNull();
  });
});

describe("culture des productions", () => {
  it("reprend la variété cultivée (taxonomie), une vigne sans variété reste de la vigne", async () => {
    const { cultivationOf } = await import("../src/rules.js");
    expect(cultivationOf("zea_mays", "field_crop")).toBe("zea_mays");
    expect(cultivationOf(" Vitis ", "vine")).toBe("vitis");
    expect(cultivationOf(null, "vine")).toBe("vitis");
    expect(cultivationOf("plant", "field_crop")).toBeNull();
    expect(cultivationOf("DKC5196", "field_crop")).toBeNull(); // une variété commerciale n'est pas une culture
  });
});

describe("matériels", () => {
  it("donne un compteur d'heures aux tracteurs et automoteurs seulement", () => {
    expect(hasHourMeter("tractor")).toBe(true);
    expect(hasHourMeter("self_propelled_equipment")).toBe(true);
    expect(hasHourMeter("trailed_equipment")).toBe(false);
    expect(hasHourMeter(null)).toBe(false);
  });
  it("reconnaît les recopies Samsys et garde le n° de travail", () => {
    expect(samsysId("SAMSYS_63f63f5dc5a720c514eb1c39")).toBe("63f63f5dc5a720c514eb1c39");
    expect(samsysId("MF_140")).toBeNull();
    expect(equipmentExternalIds({ work_number: "SAMSYS_594726C1" })).toEqual({ samsys: "594726C1" });
    expect(equipmentExternalIds({ work_number: "AC308VA" })).toEqual({ ekylibre_work_number: "AC308VA" });
    expect(equipmentExternalIds({ work_number: null })).toEqual({});
  });
  it("ignore la date de naissance par défaut (époque Unix)", () => {
    expect(commissionedAt(new Date("1970-01-01T00:00:00Z"))).toBeNull();
    expect(commissionedAt(null)).toBeNull();
    expect(commissionedAt(new Date("2013-11-30T00:00:00Z"))?.toISOString()).toBe("2013-11-30T00:00:00.000Z");
  });
});

describe("attelages repris (FR-ATT-10)", () => {
  const S = (from: string, to: string) => ({ startedAt: `2020-04-09T${from}:00.000Z`, stoppedAt: `2020-04-09T${to}:00.000Z` });
  const tool = (paramId: number, productId: number, motorised = false) => ({ paramId, role: "tool" as const, productId, motorised });
  const doer = (paramId: number, productId: number | null) => ({ paramId, role: "doer" as const, productId, motorised: false });
  const none = new Map<number, ReturnType<typeof S>[]>();

  it("motorisé : tracteurs et automoteurs", () => {
    expect(isMotorised("tractor")).toBe(true);
    expect(isMotorised("self_propelled_equipment")).toBe(true);
    expect(isMotorised("trailed_equipment")).toBe(false);
    expect(isMotorised(null)).toBe(false);
  });

  it("fusionne les périodes qui se recouvrent, garde celles qui se touchent, retire les vides", () => {
    expect(mergeSpans([S("10:00", "11:00"), S("08:00", "09:30"), S("09:00", "10:00"), S("12:00", "12:00")])).toEqual([S("08:00", "10:00"), S("10:00", "11:00")]);
  });

  it("règle 2 : un tracteur et plusieurs outils et personnes → un attelage, périodes de l'intervention", () => {
    const plan = crewsOf({ members: [tool(1, 10, true), tool(2, 20), doer(3, 30), doer(4, 31)], periods: [S("08:00", "10:00")], participations: none });
    expect(plan).toEqual({ staffing: "crews", rule: 2, crews: [{ paramIds: [1, 2, 3, 4], periods: [S("08:00", "10:00")] }] });
  });

  it("règle 2 : deux tracteurs mais une seule personne (ou intervenant inconnu)", () => {
    const plan = crewsOf({ members: [tool(1, 10, true), tool(2, 11, true), doer(3, null)], periods: [S("08:00", "10:00")], participations: none });
    expect(plan).toMatchObject({ staffing: "crews", rule: 2 });
  });

  it("règle 3 : deux tracteurs et deux personnes sans participations → libre, ambigu", () => {
    expect(crewsOf({ members: [tool(1, 10, true), tool(2, 11, true), doer(3, 30), doer(4, 31)], periods: [S("08:00", "10:00")], participations: none })).toEqual({
      staffing: "free",
      ambiguous: true,
    });
  });

  it("sans matériel ou sans période : libre, non ambigu", () => {
    expect(crewsOf({ members: [doer(1, 30)], periods: [S("08:00", "10:00")], participations: none })).toEqual({ staffing: "free", ambiguous: false });
    expect(crewsOf({ members: [tool(1, 10, true)], periods: [], participations: none })).toEqual({ staffing: "free", ambiguous: false });
  });

  it("règle 1 : un attelage par tracteur participant, membres placés par recouvrement, reste au premier", () => {
    const participations = new Map([
      [10, [S("08:00", "10:00")]],
      [11, [S("13:00", "15:00"), S("14:00", "16:00")]],
      [20, [S("13:30", "14:00")]], // outil de l'après-midi
      [30, [S("08:00", "09:00")]], // personne du matin
      [31, [S("15:00", "16:00")]],
    ]);
    const plan = crewsOf({
      members: [tool(1, 11, true), tool(2, 10, true), tool(3, 20), tool(4, 21), doer(5, 30), doer(6, 31)],
      periods: [S("08:00", "16:00")],
      participations,
    });
    expect(plan).toEqual({
      staffing: "crews",
      rule: 1,
      crews: [
        { paramIds: [2, 4, 5], periods: [S("08:00", "10:00")] }, // le plus tôt d'abord ; l'outil 21 sans participation y va
        { paramIds: [1, 3, 6], periods: [S("13:00", "16:00")] },
      ],
    });
  });

  it("participations des seules personnes : on passe à la règle 2", () => {
    const plan = crewsOf({ members: [tool(1, 10, true), tool(2, 20), doer(3, 30)], periods: [S("08:00", "10:00")], participations: new Map([[30, [S("08:00", "09:00")]]]) });
    expect(plan).toMatchObject({ staffing: "crews", rule: 2 });
  });
});
