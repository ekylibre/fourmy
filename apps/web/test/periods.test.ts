import { durationMinutes, formatDuration, parseDuration, withDuration, withStart } from "../src/features/interventions/periods";

describe("durée des périodes de travail", () => {
  const p = { startedAt: "2026-06-15T08:00", stoppedAt: "2026-06-15T10:30" };
  it("calcule la durée et la fin", () => {
    expect(durationMinutes(p)).toBe(150);
    expect(withDuration(p, 45).stoppedAt).toBe("2026-06-15T08:45");
    expect(withDuration({ ...p, startedAt: "2026-06-15T23:00" }, 120).stoppedAt).toBe("2026-06-16T01:00");
    expect(durationMinutes({ ...p, stoppedAt: "2026-06-15T07:00" })).toBeNull();
  });
  it("déplacer le début garde la durée", () => {
    expect(withStart(p, "2026-06-15T14:00")).toEqual({ startedAt: "2026-06-15T14:00", stoppedAt: "2026-06-15T16:30" });
  });
  it("lit et écrit les durées", () => {
    expect(formatDuration(150)).toBe("2 h 30");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(180)).toBe("3 h");
    for (const [t, m] of [["2", 120], ["2,5", 150], ["2h30", 150], ["2 h 30", 150], ["1:15", 75], ["45 min", 45]] as const) expect(parseDuration(t)).toBe(m);
    expect(parseDuration("abc")).toBeNull();
  });
});
