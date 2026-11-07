import { describe, it, expect } from "vitest";
import { bool, frNumber, knotsToKmh, toPositionRecord, dedupeByTime, matchDevices } from "../src/index.js";

describe("lecture Traccar", () => {
  it("lit les booléens envoyés en chaîne (« True »/« False »)", () => {
    expect(bool("True")).toBe(true);
    expect(bool("False")).toBe(false);
    expect(bool(true)).toBe(true);
    expect(bool("peut-être")).toBeNull();
    expect(bool(undefined)).toBeNull();
  });

  it("lit les nombres au format français", () => {
    expect(frNumber("2,8 m")).toBe(2.8);
    expect(frNumber("15,56 ha")).toBe(15.56);
    expect(frNumber("18 m")).toBe(18);
    expect(frNumber(5.5)).toBe(5.5);
    expect(frNumber("n/a")).toBeNull();
  });

  it("convertit les nœuds en km/h", () => {
    expect(knotsToKmh(10)).toBeCloseTo(18.52);
  });

  it("convertit une position et écarte les fixes invalides", () => {
    const base = { id: 1, deviceId: 3, fixTime: "2026-10-05T12:00:00.000+00:00", latitude: 43.38, longitude: -0.19 };
    const r = toPositionRecord({
      ...base,
      speed: 3.02,
      course: 90,
      valid: true,
      attributes: { isWorking: "True", workingWidth: "18 m", tool: "Arion UF1201", field: "7,63 ha" },
    });
    expect(r).toMatchObject({ time: "2026-10-05T12:00:00.000Z", speedKmh: 5.59 });
    expect(r?.attrs).toEqual({ working: true, widthM: 18, tool: "Arion UF1201", fieldHa: 7.63, appliedHa: null });
    expect(toPositionRecord({ ...base, valid: false })).toBeNull();
    expect(toPositionRecord({ ...base, latitude: 0, longitude: 0 })).toBeNull();
  });

  it("déduplique par instant et trie", () => {
    const p = (time: string) => ({ time, lon: 0, lat: 0, speedKmh: null, heading: null,
      attrs: { working: null, widthM: null, tool: null, fieldHa: null, appliedHa: null } });
    const out = dedupeByTime([p("2026-01-01T00:00:02Z"), p("2026-01-01T00:00:01Z"), p("2026-01-01T00:00:01Z")]);
    expect(out.map((x) => x.time)).toEqual(["2026-01-01T00:00:01Z", "2026-01-01T00:00:02Z"]);
  });

  it("apparie boîtiers et matériels par nom normalisé, refuse l'ambiguïté", () => {
    const { matched, unmatched } = matchDevices(
      [{ id: 3, name: "Claas Arion 430" }, { id: 7, name: "Zétor  6211" }, { id: 9, name: "Inconnu" }, { id: 4, name: "Vicon" }],
      [{ id: "a", name: "claas arion 430" }, { id: "b", name: "Zetor 6211" }, { id: "c", name: "Vicon" }, { id: "d", name: "VICON" }],
    );
    expect(matched.map((m) => [m.device.id, m.equipment.id])).toEqual([[3, "a"], [7, "b"]]);
    expect(unmatched.map((u) => [u.device.id, u.reason])).toEqual([
      [9, "aucun matériel de ce nom"],
      [4, "plusieurs matériels de ce nom"],
    ]);
  });
});
