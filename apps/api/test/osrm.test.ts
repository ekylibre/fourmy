import { describe, it, expect } from "vitest";
import type { TrackReplay } from "@fourmy/contracts";
import { distanceM, snapTransit, timeMatching } from "../src/osrm.js";

type Sample = TrackReplay["samples"][number];
const at = (min: number) => new Date(Date.UTC(2026, 9, 5, 12, min)).toISOString();

describe("recalage des déplacements sur la route (OSRM)", () => {
  it("instant des sommets : proportionnel à la distance entre deux ancres", () => {
    // Route en L : 0 → 100 m vers l'est, puis 100 m vers le nord ; ancres aux deux bouts.
    const east = 100 / (111_320 * Math.cos((43.4 * Math.PI) / 180));
    const north = 100 / 111_320;
    const g: [number, number][] = [[0, 43.4], [east, 43.4], [east, 43.4 + north]];
    const legs = [{ distance: distanceM(g[0]!, g[1]!) + distanceM(g[1]!, g[2]!) }];
    const t0 = Date.parse(at(0));
    const out = timeMatching({ geometry: { coordinates: g }, legs }, [t0, t0 + 200_000]);
    expect(out).toHaveLength(3);
    expect(out[1]![0] - t0).toBeCloseTo(100_000, -3); // à mi-chemin, à mi-temps
    expect(out[2]![0]).toBe(t0 + 200_000);
  });

  it("seuls les déplacements passent par OSRM ; le travail reste tel quel", async () => {
    const samples: Sample[] = [
      [at(0), 0, 43.4, false],
      [at(5), 0.01, 43.4, false],
      [at(10), 0.02, 43.4, true],
      [at(15), 0.03, 43.4, true],
    ];
    const calls: string[] = [];
    const fake = async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({
          code: "Ok",
          matchings: [{ geometry: { coordinates: [[0, 43.4], [0.005, 43.401], [0.01, 43.4]] }, legs: [{ distance: 2 * distanceM([0, 43.4], [0.005, 43.401]) }] }],
          tracepoints: [{ matchings_index: 0, waypoint_index: 0 }, { matchings_index: 0, waypoint_index: 1 }],
        }),
      );
    };
    const r = await snapTransit(samples, "http://osrm", fake);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain("/match/v1/driving/0.000000,43.400000;0.010000,43.400000?");
    expect(r).toMatchObject({ runs: 1, snapped: 1 });
    expect(r.samples.map((s) => [s[1], s[2], s[3]])).toEqual([
      [0, 43.4, false],
      [0.005, 43.401, false], // virage de la route, absent de la trace brute
      [0.01, 43.4, false],
      [0.02, 43.4, true],
      [0.03, 43.4, true],
    ]);
    expect(r.samples[1]![0]).toBe(new Date(Date.UTC(2026, 9, 5, 12, 2, 30)).toISOString()); // à mi-distance, à mi-temps
  });

  it("service absent ou en erreur : la trace reste brute", async () => {
    const samples: Sample[] = [
      [at(0), 0, 43.4, false],
      [at(5), 0.01, 43.4, null],
    ];
    expect(await snapTransit(samples, null)).toEqual({ samples, runs: 0, snapped: 0 });
    const down = async () => {
      throw new Error("ECONNREFUSED");
    };
    expect(await snapTransit(samples, "http://osrm", down)).toEqual({ samples, runs: 1, snapped: 0 });
  });
});
