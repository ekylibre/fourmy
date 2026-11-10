import { describe, expect, it } from "vitest";
import { applicatorsOf, isSprayer } from "../src/applicators.js";

/**
 * FR-ATT-12 : les mêmes cas sont rejoués en SQL contre
 * `fourmy_input_applicators` (apps/api/test/phyto-applicators.integration.test.ts).
 */
const P = [{ startedAt: "2026-05-02T08:00:00Z", stoppedAt: "2026-05-02T10:00:00Z" }];
const crew = (tools: string[], doers: string[]) => ({ tools: tools.map((equipmentId) => ({ equipmentId })), doers: doers.map((personId) => ({ personId })), periods: P });
const kinds: Record<string, { kind?: string; avatarTemplate?: string }> = {
  tractorA: { kind: "tractor" },
  tractorB: { kind: "tractor" },
  sprayer: { kind: "trailed_equipment", avatarTemplate: "trailed_sprayer" },
  harrow: { kind: "trailed_equipment" },
};
const eq = (id: string) => kinds[id];

describe("applicatorsOf", () => {
  it("1. mode libre : tous les intervenants", () => {
    expect(applicatorsOf({ staffing: "free", doers: [{ personId: "ann" }, { personId: "bob" }] }, {}, eq)).toEqual({ personIds: ["ann", "bob"], rule: "free", crewIndex: null });
    expect(applicatorsOf({ doers: [] }, {}, eq).personIds).toEqual([]);
  });

  it("2. le matériel saisi sur l'intrant désigne l'attelage", () => {
    const body = { staffing: "crews" as const, crews: [crew(["tractorA", "sprayer"], ["ann"]), crew(["tractorB", "harrow"], ["bob"])] };
    expect(applicatorsOf(body, { equipmentId: "harrow" }, eq)).toEqual({ personIds: ["bob"], rule: "input", crewIndex: 1 });
  });

  it("3. sinon l'unique attelage qui porte un pulvérisateur", () => {
    const body = { staffing: "crews" as const, crews: [crew(["tractorB", "harrow"], ["bob"]), crew(["tractorA", "sprayer"], ["ann"])] };
    expect(applicatorsOf(body, {}, eq)).toEqual({ personIds: ["ann"], rule: "sprayer", crewIndex: 1 });
    // Matériel saisi absent des attelages : on passe à la règle suivante.
    expect(applicatorsOf(body, { equipmentId: "ailleurs" }, eq).rule).toBe("sprayer");
  });

  it("4. un seul attelage : celui-là, même sans pulvérisateur connu", () => {
    expect(applicatorsOf({ staffing: "crews", crews: [crew(["tractorA", "harrow"], ["ann", "ann"])] }, {}, eq)).toEqual({ personIds: ["ann"], rule: "single", crewIndex: 0 });
  });

  it("5. plusieurs attelages sans indice : tous, applicateur ambigu", () => {
    const body = { staffing: "crews" as const, crews: [crew(["tractorA"], ["ann"]), crew(["tractorB"], ["bob", "ann"])] };
    expect(applicatorsOf(body, {}, eq)).toEqual({ personIds: ["ann", "bob"], rule: "ambiguous", crewIndex: null });
    const two = { staffing: "crews" as const, crews: [crew(["sprayer"], ["ann"]), crew(["tractorB", "sprayer"], ["bob"])] };
    expect(applicatorsOf(two, {}, eq).rule).toBe("ambiguous");
  });

  it("attelage du pulvérisateur sans intervenant : non renseigné (liste vide)", () => {
    const body = { staffing: "crews" as const, crews: [crew(["tractorA", "sprayer"], []), crew(["tractorB"], ["bob"])] };
    expect(applicatorsOf(body, {}, eq)).toEqual({ personIds: [], rule: "sprayer", crewIndex: 0 });
  });

  it("reconnaît un pulvérisateur", () => {
    expect(isSprayer({ kind: "self_propelled_sprayer" })).toBe(true);
    expect(isSprayer({ kind: "trailed_equipment", avatarTemplate: "trailed_sprayer" })).toBe(true);
    expect(isSprayer({ kind: "trailed_equipment" })).toBe(false);
    expect(isSprayer(undefined)).toBe(false);
  });
});
