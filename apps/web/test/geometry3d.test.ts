import { initialView, placementFromClick, splitRuns, type Sample } from "../src/3d/geometry";

describe("géométrie du plan 3D", () => {
  it("découpe la trace en tronçons travail / transport continus", () => {
    const s: Sample[] = [
      ["t0", 0, 0, false],
      ["t1", 1, 0, false],
      ["t2", 2, 0, true],
      ["t3", 3, 0, true],
      ["t4", 4, 0, null],
    ];
    expect(splitRuns(s)).toEqual([
      { working: false, coords: [[0, 0], [1, 0]] },
      { working: true, coords: [[1, 0], [2, 0], [3, 0]] },
      { working: false, coords: [[3, 0], [4, 0]] },
    ]);
  });

  const chai = {
    type: "Polygon",
    // ~ 20 m × 11 m autour de (-0.0728, 44.626)
    coordinates: [[[-0.07293, 44.62595], [-0.07267, 44.62595], [-0.07267, 44.62605], [-0.07293, 44.62605], [-0.07293, 44.62595]]],
  } as const;

  it("place une cuve cliquée au centre du chai (repère local en mètres)", () => {
    const r = placementFromClick([-0.0728, 44.626], chai, 0.8);
    expect(r).toEqual({ x: expect.closeTo(0, 0), y: expect.closeTo(0, 0) });
  });

  it("refuse une cuve qui déborderait du bâtiment", () => {
    expect(placementFromClick([-0.07292, 44.626], chai, 0.8)).toEqual({ error: expect.stringMatching(/tenir entièrement/) });
    expect(placementFromClick([-0.071, 44.626], chai, 0.8)).toHaveProperty("error");
  });

  it("point de vue initial au sud de l'emprise, incliné à 40°", () => {
    const v = initialView({ west: -0.0767, south: 44.6234, east: -0.0732, north: 44.6281 });
    expect(v.lat).toBeLessThan(44.6234);
    expect(v.pitchDeg).toBe(-40);
    expect(v.altitude).toBeGreaterThan(400);
  });
});

import { behind, bearing, headings } from "../src/3d/geometry";

describe("avatar dans la vue 3D", () => {
  it("cap le long d'une trace, conservé à l'arrêt", () => {
    expect(bearing(0.5, 44.8, 0.5, 44.81)).toBeCloseTo(0); // nord
    expect(bearing(0.5, 44.8, 0.51, 44.8)).toBeCloseTo(90); // est
    const s = [
      ["2026-11-03T08:00:00Z", 0.5, 44.8, true],
      ["2026-11-03T08:01:00Z", 0.5, 44.8, true], // à l'arrêt
      ["2026-11-03T08:02:00Z", 0.5, 44.801, true],
      ["2026-11-03T08:03:00Z", 0.501, 44.801, true],
      ["2026-11-03T08:04:00Z", 0.501, 44.801, true], // arrêt : garde l'est
    ] as [string, number, number, boolean][];
    const h = headings(s).map(Math.round);
    expect(h).toEqual([0, 0, 90, 90, 90]);
  });

  it("l'outil se place derrière le tracteur", () => {
    const [lon, lat] = behind(0.5, 44.8, 0, 111.32); // cap nord, 111 m derrière
    expect(lon).toBeCloseTo(0.5, 6);
    expect(lat).toBeCloseTo(44.799, 5);
    const [lon2] = behind(0.5, 44.8, 90, 10); // cap est : l'outil à l'ouest
    expect(lon2).toBeLessThan(0.5);
  });
});
