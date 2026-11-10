import { crewsBody, duplicate, newCrew } from "../src/features/interventions/Crews";

describe("attelages du formulaire", () => {
  it("dupliquer : même composition, sur une période de même durée qui suit la dernière", () => {
    const c = newCrew({ id: "x", label: "A", tools: ["t1"], doers: ["p1"], periods: [{ startedAt: "2026-09-15T08:00", stoppedAt: "2026-09-15T10:30" }] });
    const d = duplicate(c);
    expect(d).toMatchObject({ label: "", tools: ["t1"], doers: ["p1"], periods: [{ startedAt: "2026-09-15T10:30", stoppedAt: "2026-09-15T13:00" }] });
    expect(d.id).toBeUndefined();
    expect(d.key).not.toBe(c.key);
  });

  it("corps écrit : id conservé, libellé vide omis, périodes en ISO", () => {
    const [body] = crewsBody([newCrew({ id: "x", label: "  ", tools: ["t1"], periods: [{ startedAt: "2026-09-15T08:00", stoppedAt: "2026-09-15T10:00" }] })]);
    expect(body).toEqual({
      id: "x",
      tools: [{ equipmentId: "t1" }],
      doers: [],
      periods: [{ startedAt: new Date("2026-09-15T08:00").toISOString(), stoppedAt: new Date("2026-09-15T10:00").toISOString() }],
    });
  });
});
