/**
 * glTF binaire de la bande travaillée (rejeu 3D, conception §6.2) : un
 * maillage de triangles, avec par sommet sa position (m, repère local
 * est/nord/haut), sa couleur (COLOR_0) et l'instant de passage (_TIME, en
 * secondes depuis le début de la trace). Un CustomShader Cesium n'en montre
 * que la partie déjà parcourue. Pur : testable sans navigateur 3D.
 */

export interface SwathMesh {
  /** x, y, z par sommet. */
  positions: Float32Array;
  /** r, g, b linéaires par sommet. */
  colors: Float32Array;
  /** Secondes depuis le début de la trace, par sommet. */
  times: Float32Array;
  indices: Uint32Array;
}

const pad4 = (n: number) => (n + 3) & ~3;

/** sRGB (#RRGGBB) → composantes linéaires, comme l'attend glTF. */
export function linearRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
}

/**
 * Maillage des bandes : chaque paire (gauche, droite) d'une bande est reliée
 * à la suivante par deux triangles. `point` donne la position locale d'un bord.
 */
export function swathMesh(
  strips: readonly { color: string; times: number[]; left: [number, number][]; right: [number, number][] }[],
  point: (lonLat: [number, number], strip: number, index: number, side: 0 | 1) => [number, number, number],
  t0: number,
): SwathMesh {
  const pairs = strips.reduce((a, s) => a + s.times.length, 0);
  const positions = new Float32Array(pairs * 2 * 3);
  const colors = new Float32Array(pairs * 2 * 3);
  const times = new Float32Array(pairs * 2);
  const indices: number[] = [];
  let v = 0;
  strips.forEach((s, si) => {
    const rgb = linearRgb(s.color);
    s.times.forEach((t, i) => {
      for (const side of [0, 1] as const) {
        positions.set(point(side ? s.right[i]! : s.left[i]!, si, i, side), (v + side) * 3);
        colors.set(rgb, (v + side) * 3);
        times[v + side] = (t - t0) / 1000;
      }
      if (i > 0) indices.push(v - 2, v - 1, v + 1, v - 2, v + 1, v);
      v += 2;
    });
  });
  return { positions, colors, times, indices: Uint32Array.from(indices) };
}

/** glTF binaire d'un maillage de bande (un nœud, une primitive, matériau sans éclairage). */
export function swathGlb(mesh: SwathMesh): Uint8Array {
  const count = mesh.times.length;
  if (count === 0) throw new Error("Bande vide");
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < count; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, mesh.positions[i * 3 + k]!);
      max[k] = Math.max(max[k]!, mesh.positions[i * 3 + k]!);
    }
  }
  const chunks = [mesh.positions, mesh.colors, mesh.times, mesh.indices];
  const views: { byteOffset: number; byteLength: number; target: number }[] = [];
  let offset = 0;
  chunks.forEach((c, i) => {
    views.push({ byteOffset: offset, byteLength: c.byteLength, target: i === 3 ? 34963 : 34962 });
    offset = pad4(offset + c.byteLength);
  });
  const binLength = offset;
  const FLOAT = 5126;
  const json = {
    asset: { version: "2.0", generator: "Fourmy bande travaillée" },
    extensionsUsed: ["KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, COLOR_0: 1, _TIME: 2 }, indices: 3, material: 0 }] }],
    materials: [
      {
        pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 0.35], metallicFactor: 0, roughnessFactor: 1 },
        alphaMode: "BLEND",
        doubleSided: true,
        extensions: { KHR_materials_unlit: {} },
      },
    ],
    buffers: [{ byteLength: binLength }],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    accessors: [
      { bufferView: 0, componentType: FLOAT, count, type: "VEC3", min, max },
      { bufferView: 1, componentType: FLOAT, count, type: "VEC3" },
      { bufferView: 2, componentType: FLOAT, count, type: "SCALAR" },
      { bufferView: 3, componentType: 5125, count: mesh.indices.length, type: "SCALAR" },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + binLength;
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 0x46546c67, true); // « glTF »
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonLength, true);
  dv.setUint32(16, 0x4e4f534a, true); // « JSON »
  out.set(jsonBytes, 20);
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength);
  const bin = 20 + jsonLength;
  dv.setUint32(bin, binLength, true);
  dv.setUint32(bin + 4, 0x004e4942, true); // « BIN »
  chunks.forEach((c, i) => out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), bin + 8 + views[i]!.byteOffset));
  return out;
}
