import { describe, it, expect } from "vitest";
import { AB_UNCONTROLLED, equipmentFindings, rotationFindings, uncontrolledFindings, type AbEquipmentEvent, type AbRotationYear } from "../src/index.js";

const ev = (at: string, kind: AbEquipmentEvent["kind"], organic: boolean): AbEquipmentEvent => ({ equipmentId: "e1", equipment: "Semoir", interventionId: `i-${at}`, at, kind, organic, parcelIds: ["p1"] });

describe("AB matériel à usage mixte (R27)", () => {
  it("usage hors AB puis AB sans nettoyage : orange (n° 19) ; avec nettoyage : rien", () => {
    const without = equipmentFindings([ev("2026-04-01T08:00:00Z", "use", false), ev("2026-04-02T08:00:00Z", "use", true)], "2026-01-01", "2026-12-31");
    expect(without[0]).toMatchObject({ ruleId: "ab.R27", level: "warning", breach: { inao: "19" } });
    const cleaned = equipmentFindings(
      [ev("2026-04-01T08:00:00Z", "use", false), ev("2026-04-01T17:00:00Z", "cleaning", true), ev("2026-04-02T08:00:00Z", "use", true)],
      "2026-01-01",
      "2026-12-31",
    );
    expect(cleaned).toEqual([]);
    // AB puis hors AB : pas de risque pour la parcelle AB.
    expect(equipmentFindings([ev("2026-04-01T08:00:00Z", "use", true), ev("2026-04-02T08:00:00Z", "use", false)], "2026-01-01", "2026-12-31")).toEqual([]);
  });
});

describe("AB rotation (R11)", () => {
  const y = (campaign: number, species: string | null, extra: Partial<AbRotationYear> = {}): AbRotationYear => ({ campaign, species, label: species, legume: false, coverLegume: false, vegetable: false, perennial: false, ...extra });
  const run = (years: AbRotationYear[]) => rotationFindings(new Map([["p1", { name: "Le Champ", years }]]), 2026, 5, 2);

  it("diversifiée avec légumineuse : conforme", () => {
    expect(run([y(2022, "blé"), y(2023, "féverole", { legume: true }), y(2024, "maïs"), y(2025, "orge"), y(2026, "blé")])[0]!.level).toBe("ok");
  });

  it("sans légumineuse, ou même espèce plus de K ans : orange (n° 39) ; un couvert de légumineuses compte", () => {
    const f = run([y(2022, "blé"), y(2023, "blé"), y(2024, "blé"), y(2025, "maïs"), y(2026, "orge")])[0]!;
    expect(f).toMatchObject({ level: "warning", breach: { inao: "39" } });
    expect(f.message).toMatch(/aucune légumineuse.*même espèce 3 années de suite/);
    expect(run([y(2022, "blé"), y(2023, "maïs", { coverLegume: true }), y(2024, "blé"), y(2025, "maïs"), y(2026, "orge")])[0]!.level).toBe("ok");
  });

  it("maraîchage : 3 espèces au moins ; historique incomplet : données manquantes ; pérenne : hors rotation", () => {
    const veg = (c: number, s: string) => y(c, s, { vegetable: true });
    expect(run([veg(2022, "tomate"), veg(2023, "salade"), y(2024, "pois", { legume: true, vegetable: true }), veg(2025, "tomate"), veg(2026, "salade")])[0]!.level).toBe("ok");
    expect(run([veg(2022, "tomate"), veg(2023, "salade"), veg(2024, "tomate"), y(2025, "trèfle", { coverLegume: true, vegetable: true, species: "salade" }), veg(2026, "tomate")])[0]!.message).toMatch(/2 espèce\(s\) légumière/);
    expect(run([y(2025, "blé"), y(2026, "maïs")])[0]!.level).toBe("missing");
    expect(run([y(2026, "vigne", { perennial: true })])).toEqual([]);
  });
});

describe("AB règles non contrôlées", () => {
  it("chaque règle hors contrôle a un constat « sans objet » explicite", () => {
    const f = uncontrolledFindings();
    expect(f).toHaveLength(AB_UNCONTROLLED.length);
    expect(f.every((x) => x.level === "na" && /non contrôlé par Fourmy/.test(x.message))).toBe(true);
    // R1 à R34 : contrôlées par les sections, ou listées ici.
    const controlled = ["R1", "R2", "R5", "R7", "R10", "R11", "R13", "R14", "R15", "R16", "R17", "R20", "R21", "R24", "R25", "R27"];
    const all = new Set([...controlled, ...AB_UNCONTROLLED.map(([r]) => r)]);
    expect([...Array(34)].map((_, i) => `R${i + 1}`).filter((r) => !all.has(r))).toEqual([]);
  });
});
