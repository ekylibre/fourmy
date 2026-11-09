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
