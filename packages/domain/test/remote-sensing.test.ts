import { describe, expect, it } from "vitest";
import { ndviColor, copernicusAttribution } from "@fourmy/contracts";
import { addDays, imageSize, isUsable, minusYears, parcelIndexStatus, referenceCurve, smoothDaily, utmEpsg, whittaker } from "../src/index.js";

describe("télédétection : règles", () => {
  it("choisit la zone UTM nord", () => {
    expect(utmEpsg(-0.19, 43.38)).toBe(32630); // Béarn
    expect(utmEpsg(2.35, 48.85)).toBe(32631); // Paris
    expect(utmEpsg(7.26, 43.7)).toBe(32632); // Nice
  });

  it("juge exploitable à 80 % des pixels et refuse les parcelles de moins de 30 pixels", () => {
    expect(isUsable(80, 100)).toBe(true);
    expect(isUsable(79, 100)).toBe(false);
    expect(isUsable(3, 3)).toBe(false);
    expect(parcelIndexStatus(3, "2026-06-26", "2026-06-30")).toEqual({ status: "too_small", ageDays: null });
    expect(parcelIndexStatus(100, null, "2026-06-30")).toEqual({ status: "none", ageDays: null });
    expect(parcelIndexStatus(100, "2026-06-26", "2026-06-30")).toEqual({ status: "ok", ageDays: 4 });
    expect(parcelIndexStatus(100, "2026-06-01", "2026-06-30")).toEqual({ status: "stale", ageDays: 29 });
  });

  it("calcule les dates", () => {
    expect(addDays("2026-02-27", 2)).toBe("2026-03-01");
    expect(minusYears("2028-02-29", 1)).toBe("2027-02-28");
  });

  it("dimensionne l'image à environ 10 m et plafonne à 2 500 px", () => {
    const s = imageSize([-0.2137, 43.3361, -0.1648, 43.3962]);
    expect(s.width).toBeGreaterThan(380);
    expect(s.width).toBeLessThan(420);
    expect(s.height).toBeGreaterThan(650);
    expect(s.height).toBeLessThan(680);
    expect(Math.max(...Object.values(imageSize([0, 40, 5, 45])))).toBe(2500);
  });

  it("colore le NDVI et cite Copernicus", () => {
    expect(ndviColor(-0.2)).toBe("#a50026");
    expect(ndviColor(0.9)).toBe("#006837");
    expect(ndviColor(0.85)).toMatch(/^#[0-9a-f]{6}$/);
    expect(copernicusAttribution([2026, 2025, 2026])).toBe("Contient des données Copernicus Sentinel modifiées 2025–2026");
  });
});

describe("télédétection : lissage", () => {
  it("Whittaker conserve une droite et interpole les trous", () => {
    const y = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const w = y.map((_, i) => (i % 3 === 0 ? 1 : 0));
    const z = whittaker(y, w, 100);
    z.forEach((v, i) => expect(v).toBeCloseTo(i, 6));
  });

  it("Whittaker atténue un point aberrant (nuage résiduel)", () => {
    const y = Array.from({ length: 30 }, () => 0.7);
    y[15] = 0.2;
    const z = whittaker(y, y.map(() => 1), 50);
    expect(z[15]).toBeGreaterThan(0.55);
  });

  it("lisse au jour près entre la première et la dernière mesure", () => {
    const pts = [
      { date: "2026-05-21", value: 0.21 },
      { date: "2026-06-03", value: 0.48 },
      { date: "2026-06-13", value: 0.74 },
      { date: "2026-06-26", value: 0.79 },
    ];
    const s = smoothDaily(pts, { from: "2026-01-01", to: "2026-12-31" });
    expect(s[0]!.date).toBe("2026-05-21");
    expect(s[s.length - 1]!.date).toBe("2026-06-26");
    expect(s).toHaveLength(37);
    expect(smoothDaily(pts.slice(0, 2), { from: "2026-01-01", to: "2026-12-31" })).toEqual([]);
  });

  it("référence : médiane des années précédentes, alignée sur la fenêtre", () => {
    const year = (y: number, base: number) =>
      ["03-01", "04-01", "05-01", "06-01", "07-01"].map((md, i) => ({ date: `${y}-${md}`, value: base + i * 0.1 }));
    const pts = [...year(2023, 0.1), ...year(2024, 0.2), ...year(2025, 0.3), ...year(2026, 0.9)];
    const { curve, years } = referenceCurve(pts, { from: "2026-01-01", to: "2026-12-31" });
    expect(years).toEqual([2023, 2024, 2025]);
    const june = curve.find((p) => p.date === "2026-06-01")!;
    expect(june.years).toBe(3);
    expect(june.median).toBeCloseTo(0.5, 2); // 2024 : 0,2 + 3 × 0,1
    expect(curve.every((p) => p.date >= "2026-01-01" && p.date <= "2026-12-31")).toBe(true);
  });
});
