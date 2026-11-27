import { describe, expect, it } from "vitest";
import { capGrant, FULL_GRANT, intersectGrants, isEmptyGrant, levelAllows, memberGrant, normalizeGrant } from "../src/access/grants.js";

const VIGNE = "00000000-0000-4000-8000-000000000001";
const BLE = "00000000-0000-4000-8000-000000000002";
const ORGE = "00000000-0000-4000-8000-000000000003";

describe("droits d'accès (AM1)", () => {
  it("droits des rôles existants", () => {
    expect(memberGrant("owner")).toEqual(FULL_GRANT);
    expect(memberGrant("worker")).toEqual(FULL_GRANT);
    const reader = memberGrant("reader");
    expect(Object.values(reader.modules).every((l) => l === "read")).toBe(true);
    expect(reader.activities).toBe("all");
  });

  it("un invité sans droits enregistrés n'a rien", () => {
    const g = memberGrant("guest", null);
    expect(isEmptyGrant(g)).toBe(true);
  });

  it("un module absent vaut « aucun »", () => {
    const g = normalizeGrant({ modules: { interventions: "read" }, activities: [VIGNE] });
    expect(g.modules.interventions).toBe("read");
    expect(g.modules.stocks).toBe("none");
  });

  it("intersection : niveau le plus faible, activités communes", () => {
    const a = normalizeGrant({ modules: { interventions: "write", phyto: "read" }, activities: [VIGNE, BLE] });
    const b = normalizeGrant({ modules: { interventions: "read", phyto: "write", stocks: "read" }, activities: [BLE, ORGE] });
    const i = intersectGrants(a, b);
    expect(i.modules).toMatchObject({ interventions: "read", phyto: "read", stocks: "none" });
    expect(i.activities).toEqual([BLE]);
    expect(intersectGrants(FULL_GRANT, a).activities).toEqual([BLE, VIGNE].sort());
    expect(intersectGrants(a, FULL_GRANT)).toEqual(a);
  });

  it("activités sans recoupement : accès vide", () => {
    const a = normalizeGrant({ modules: { interventions: "read" }, activities: [VIGNE] });
    const b = normalizeGrant({ modules: { interventions: "read" }, activities: [BLE] });
    expect(isEmptyGrant(intersectGrants(a, b))).toBe(true);
  });

  it("niveau et méthode HTTP", () => {
    expect(levelAllows("read", "GET")).toBe(true);
    expect(levelAllows("read", "HEAD")).toBe(true);
    expect(levelAllows("read", "POST")).toBe(false);
    expect(levelAllows("write", "POST")).toBe(true);
    expect(levelAllows("none", "GET")).toBe(false);
  });

  it("plafond : un lecteur ne crée qu'un accès en lecture (Q4)", () => {
    const r = capGrant(memberGrant("reader"), { modules: { interventions: "write", stocks: "read" }, activities: "all" });
    expect(r.grant.modules).toMatchObject({ interventions: "read", stocks: "read" });
    expect(r.reduced).toEqual(["interventions"]);
    expect(r.activitiesReduced).toBe(false);
  });

  it("plafond : un invité « Vigne » ne donne pas plus que la vigne (API-4)", () => {
    const guest = memberGrant("guest", { modules: { interventions: "read" }, activities: [VIGNE] });
    const r = capGrant(guest, { modules: { interventions: "read", phyto: "read" }, activities: "all" });
    expect(r.grant.activities).toEqual([VIGNE]);
    expect(r.activitiesReduced).toBe(true);
    expect(r.reduced).toEqual(["phyto"]);
  });
});
