import { formatDays } from "../src/app/labels";

describe("libellés", () => {
  it("période connue au jour près : le jour, ou du premier au dernier jour", () => {
    // Minuit local au minuit qui suit le dernier jour (interventions importées).
    expect(formatDays(new Date(2026, 3, 1).toISOString(), new Date(2026, 3, 2).toISOString())).toBe("le 01/04/2026");
    expect(formatDays(new Date(2026, 0, 15).toISOString(), new Date(2026, 0, 17).toISOString())).toBe("du 15/01/2026 au 16/01/2026");
  });
});
