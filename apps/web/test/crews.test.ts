import { crewsBody, duplicate, fromTemplate, newCrew } from "../src/features/interventions/Crews";

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

  it("attelage type : composition et origine copiées, périodes et nom saisi gardés", () => {
    const t = { id: "tpl", name: "Arion + charrue", active: true, equipmentIds: ["t1", "t2"], personIds: ["p1"], updatedAt: "2026-11-10T00:00:00.000Z" };
    const periods = [{ startedAt: "2026-09-15T08:00", stoppedAt: "2026-09-15T10:00" }];
    const filled = fromTemplate(newCrew({ id: "c", tools: ["x"], periods }), t);
    expect(filled).toMatchObject({ id: "c", label: "Arion + charrue", templateId: "tpl", tools: ["t1", "t2"], doers: ["p1"], periods });
    expect(fromTemplate(newCrew({ label: "Labour nord" }), t).label).toBe("Labour nord");
    t.equipmentIds.push("t3");
    expect(filled.tools).toEqual(["t1", "t2"]); // copie, pas de lien
  });
});
