import { describe, it, expect } from "vitest";
import type { ControlFinding } from "@fourmy/contracts";
import { finding, missing, section, verdictOf, worstControlLevel } from "../src/certification/index.js";

const f = (level: ControlFinding["level"], extra: Partial<ControlFinding> = {}): ControlFinding => ({ ruleId: "t", level, message: "", refs: {}, source: "test", ...extra });

describe("agrégation des contrôles HVE et AB", () => {
  it("gravité : non conforme > données manquantes > à vérifier > conforme > sans objet", () => {
    expect(worstControlLevel(["ok", "warning", "missing"])).toBe("missing");
    expect(worstControlLevel(["missing", "danger"])).toBe("danger");
    expect(worstControlLevel(["na", "ok"])).toBe("ok");
    expect(worstControlLevel([])).toBe("na");
  });

  it("pas de faux vert : des données manquantes empêchent « conforme »", () => {
    expect(finding(f("ok", { missing: [missing("teneur en cuivre", "article", "a1")] })).level).toBe("missing");
    expect(finding(f("danger", { missing: [missing("x", "farm")] })).level).toBe("danger");
    expect(finding(f("ok")).level).toBe("ok");
  });

  it("indicateur HVE : seuil de points, constat éliminatoire, données manquantes", () => {
    const pts = (got: number, level: ControlFinding["level"] = "ok") => f(level, { points: { got, max: 10 } });
    expect(section("phyto", "Phyto", [pts(6), pts(5)], { min: 10, max: 63 })).toMatchObject({ level: "ok", points: { got: 11 } });
    expect(section("phyto", "Phyto", [pts(6), pts(3)], { min: 10, max: 63 }).level).toBe("danger");
    expect(section("phyto", "Phyto", [pts(6), pts(0, "missing")], { min: 10, max: 63 }).level).toBe("missing");
    // CMR1 : éliminatoire même avec assez de points.
    expect(section("phyto", "Phyto", [pts(20), pts(0, "danger")], { min: 10, max: 63 }).level).toBe("danger");
    expect(section("bio", "Biodiversité", [pts(12), pts(0, "missing")], { min: 10, max: 36 }).level).toBe("warning");
  });

  it("règles AB : la pire ; verdict : la pire section", () => {
    const s1 = section("ab", "Règles", [f("ok"), f("warning")]);
    const s2 = section("ab2", "Parcelles", [f("danger")]);
    expect(s1.level).toBe("warning");
    expect(verdictOf([s1, s2])).toBe("danger");
    expect(verdictOf([])).toBe("na");
  });
});
