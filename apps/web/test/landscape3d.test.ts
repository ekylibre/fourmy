import { describe, expect, it } from "vitest";
import { catenary, instancedGlb, isLeafless, pylonGeometry, treeGeometry } from "../src/3d/landscape-glb";

const json = (glb: Uint8Array) => {
  const dv = new DataView(glb.buffer);
  expect(dv.getUint32(0, true)).toBe(0x46546c67);
  return JSON.parse(new TextDecoder().decode(glb.slice(20, 20 + dv.getUint32(12, true))));
};

describe("paysage 3D", () => {
  it("arbres unitaires : hauteur 1, couronne de diamètre 1, peu de facettes", () => {
    for (const kind of ["deciduous", "conifer", "hedge", "orchard"] as const) {
      const g = treeGeometry(kind, false);
      const zs = g.positions.filter((_, i) => i % 3 === 2);
      const xs = g.positions.filter((_, i) => i % 3 === 0);
      expect(Math.max(...zs)).toBeLessThanOrEqual(1.0001);
      expect(Math.min(...zs)).toBeGreaterThanOrEqual(0);
      expect(Math.max(...xs)).toBeLessThanOrEqual(0.5001);
      expect(g.indices.length / 3).toBeLessThan(60);
    }
  });

  it("saison : feuillus dégarnis de novembre à mars, conifères inchangés", () => {
    expect(isLeafless("2026-01-15")).toBe(true);
    expect(isLeafless("2026-10-05")).toBe(false);
    expect(treeGeometry("conifer", true).colors).toEqual(treeGeometry("conifer", false).colors);
    expect(treeGeometry("deciduous", true).colors).not.toEqual(treeGeometry("deciduous", false).colors);
  });

  it("glTF instancié : translation, lacet et échelle par instance", () => {
    const glb = instancedGlb(pylonGeometry(), [
      { x: 1, y: 2, z: 3, yaw: Math.PI / 2, sx: 45, sy: 45, sz: 45 },
      { x: 4, y: 5, z: 6, yaw: 0, sx: 30, sy: 30, sz: 30 },
    ]);
    const j = json(glb);
    expect(j.extensionsUsed).toContain("EXT_mesh_gpu_instancing");
    expect(j.nodes[0].extensions.EXT_mesh_gpu_instancing.attributes).toEqual({ TRANSLATION: 4, ROTATION: 5, SCALE: 6 });
    expect(j.accessors[4].count).toBe(2);
    expect(j.accessors[0].max[2]).toBeCloseTo(1, 1); // pylône unitaire
  });

  it("câble : flèche de 3 % de la portée au milieu, bouts accrochés", () => {
    const pts = catenary([0, 0, 40], [300, 0, 40]);
    expect(pts).toHaveLength(11);
    expect(pts[0]).toEqual([0, 0, 40]);
    expect(pts[10]![2]).toBeCloseTo(40);
    expect(pts[5]![2]).toBeCloseTo(40 - 9);
  });
});
