import { describe, it, expect } from "vitest";
import { buildPreview, emptyBundle, isBlocked, type BundleParcel, type BundleWorkUnit, type ImportBundle } from "../src/index.js";

const parcel = (key: string, areaM2: number, aeeUsage: string | null): BundleParcel => ({
  key,
  landKey: key,
  secondary: false,
  campaign: 2026,
  name: `Parcelle ${key}`,
  shape: null,
  areaM2,
  islet: null,
  inseeCode: null,
  crop: { aeeCode: "ZAR", aeeComplement: null, aeeSowingPeriod: "ZFB", aeeUsage, capCode: null, label: "Blé tendre d'hiver", variety: null, sownOn: null, harvestedOn: null, destination: null },
  soil: null,
  yield: null,
  advice: null,
  spreadable: null,
  sourceIds: {},
});

const unit = (guid: string, parcelKey: string, aeeCode: string, status: "done" | "planned", label: string): BundleWorkUnit => ({
  guid,
  groupKey: null,
  parcelKey,
  campaign: 2026,
  operation: { aeeCode, label, category: null },
  status,
  on: "2026-04-01",
  until: null,
  workedAreaM2: null,
  inputs: [],
  outputs: [],
  waterL: null,
  weather: null,
  purpose: null,
  notes: null,
  doerKeys: [],
  modifiedBy: null,
});

function bundle(): ImportBundle {
  const b = emptyBundle("geofolia");
  b.farm.siret = "40000000000003";
  b.campaigns = [2026];
  b.parcels = [parcel("143", 14_568, "ZLD"), parcel("94", 5_758.4, "ZEQ")];
  b.workUnits = [
    unit("A", "143", "SEX", "done", "Traitement phytosanitaire"),
    unit("B", "94", "SEX", "done", "Traitement phytosanitaire"),
    unit("C", "143", "SEM", "planned", "Fertilisation minérale"),
    unit("D", "143", "SER", "done", "Récolte"),
    unit("E", "94", "SER", "done", "Récolte"),
  ];
  b.notImported = [{ kind: "animals", label: "Volailles (AV)", count: 13_200 }];
  return b;
}

const ctx = { fileName: "export.zip", farmSiret: "40000000000003", decisions: {} };

describe("aperçu d'un fichier", () => {
  it("compte le contenu, propose les procédures et la récolte de grains d'après l'usage", () => {
    const p = buildPreview({ format: "geofolia", bundle: bundle() }, ctx);
    expect(p.readable).toBe(true);
    expect(p.counts).toMatchObject({ parcels: 2, productions: 2, areaHa: 2.03, workUnits: 5 });
    expect(p.farm.siretMatches).toBe(true);
    expect(p.operations).toEqual([
      { code: "SEX", label: "Traitement phytosanitaire", procedure: "spraying", done: 2, planned: 0 },
      { code: "SEM", label: "Fertilisation minérale", procedure: "mineral_fertilizing", done: 0, planned: 1 },
      { code: "SER", label: "Récolte", procedure: "grains_harvest", done: 1, planned: 0 },
      { code: "SER", label: "Récolte", procedure: "harvesting", done: 1, planned: 0 },
    ]);
    expect(p.notImported).toEqual([{ kind: "animals", label: "Volailles (AV)", count: 13_200 }]);
    expect(isBlocked(p)).toBe(false);
  });

  it("bloque un SIRET différent, sauf confirmation", () => {
    const other = { ...ctx, farmSiret: "12345678901234" };
    const blocked = buildPreview({ format: "geofolia", bundle: bundle() }, other);
    expect(blocked.farm.siretMatches).toBe(false);
    expect(isBlocked(blocked)).toBe(true);
    const confirmed = buildPreview({ format: "geofolia", bundle: bundle() }, { ...other, decisions: { confirmSiret: true } });
    expect(isBlocked(confirmed)).toBe(false);
    expect(confirmed.warnings[0]?.level).toBe("info");
  });

  it("sans SIRET dans la ferme, aucun contrôle", () => {
    expect(buildPreview({ format: "geofolia", bundle: bundle() }, { ...ctx, farmSiret: null }).farm.siretMatches).toBeNull();
  });

  it("format reconnu sans lecteur : lisible plus tard, bloquant", () => {
    const p = buildPreview({ format: "telepac", bundle: null }, ctx);
    expect(p.readable).toBe(false);
    expect(isBlocked(p)).toBe(true);
    expect(p.warnings[0]?.message).toMatch(/TelePAC/);
  });
});
