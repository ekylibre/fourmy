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
