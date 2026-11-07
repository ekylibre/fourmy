import { describe, it, expect } from "vitest";
import { tankDimensions, autoPlaceTanks, toLocal, fromLocal, circleInside, type Pt } from "../src/index.js";

const rect = (w: number, h: number, angleDeg = 0): Pt[] => {
  const a = (angleDeg * Math.PI) / 180;
  return ([[0, 0], [w, 0], [w, h], [0, h], [0, 0]] as Pt[]).map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)]);
};
const noOverlap = (placed: { x: number; y: number }[], r: number) =>
  placed.every((p, i) => placed.every((q, j) => i === j || Math.hypot(p.x - q.x, p.y - q.y) >= 2 * r));

describe("dimensions d'une cuve", () => {
  it("conserve la capacité (π r² h) avec un rapport hauteur/diamètre de 1,6", () => {
    const { radius, height } = tankDimensions(5000); // 50 hL
    expect(Math.PI * radius ** 2 * height).toBeCloseTo(5, 1);
    expect(height / (2 * radius)).toBeCloseTo(1.6, 1);
  });
  it("s'élargit sous un toit bas, à capacité constante", () => {
    const free = tankDimensions(100_000);
    const low = tankDimensions(100_000, 4);
    expect(low.height).toBe(4);
    expect(low.radius).toBeGreaterThan(free.radius);
    expect(Math.PI * low.radius ** 2 * low.height).toBeCloseTo(100, 0);
  });
});

describe("placement automatique", () => {
  it("place 4 cuves dans un chai de 20 × 10 m, à l'intérieur, sans chevauchement", () => {
    const ring = rect(20, 10);
    const tanks = ["a", "b", "c", "d"].map((id) => ({ id, radius: 1 }));
    const { placed, unplaced } = autoPlaceTanks(ring, tanks);
    expect(unplaced).toEqual([]);
    expect(placed.every((p) => circleInside([p.x, p.y], 1, ring.slice(0, -1)))).toBe(true);
    expect(noOverlap(placed, 1)).toBe(true);
  });
  it("suit l'axe d'un bâtiment orienté à 35°", () => {
    const ring = rect(24, 6, 35);
    const tanks = Array.from({ length: 6 }, (_, i) => ({ id: `t${i}`, radius: 1.2 }));
    const { placed, unplaced } = autoPlaceTanks(ring, tanks);
    expect(unplaced).toEqual([]);
    expect(placed.every((p) => circleInside([p.x, p.y], 1.2, ring.slice(0, -1)))).toBe(true);
  });
  it("signale les cuves qui ne tiennent pas au lieu de les forcer", () => {
    const { placed, unplaced } = autoPlaceTanks(rect(4, 4), [{ id: "grande", radius: 3 }, { id: "petite", radius: 0.5 }]);
    expect(placed.map((p) => p.id)).toEqual(["petite"]);
    expect(unplaced).toEqual(["grande"]);
  });
});

describe("repère local", () => {
  it("aller-retour lon/lat ↔ mètres", () => {
    const origin: Pt = [-0.0728, 44.626];
    const local = toLocal([-0.0718, 44.627], origin);
    expect(local[0]).toBeCloseTo(79.2, 0); // ~79 m à l'est
    expect(local[1]).toBeCloseTo(111.3, 0); // ~111 m au nord
    const back = fromLocal(local, origin);
    expect(back[0]).toBeCloseTo(-0.0718, 9);
    expect(back[1]).toBeCloseTo(44.627, 9);
  });
});

import { ringCentroid, outerRing } from "../src/index.js";

describe("référence d'un bâtiment", () => {
  it("même centre, anneau fermé ou non ; anneau extérieur d'un MultiPolygon", () => {
    const open: Pt[] = [[0, 0], [4, 0], [4, 2], [0, 2]];
    expect(ringCentroid(open)).toEqual([2, 1]);
    expect(ringCentroid([...open, [0, 0]])).toEqual([2, 1]);
    expect(outerRing({ type: "MultiPolygon", coordinates: [[open]] })).toBe(open);
    expect(outerRing({ type: "Point", coordinates: [0, 0] })).toBeNull();
  });
});
