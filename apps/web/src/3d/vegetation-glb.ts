/**
 * glTF binaire instancié (EXT_mesh_gpu_instancing) pour la végétation du plan
 * 3D (lot AA) : un seul pavé unitaire, répété une fois par tronçon de rang.
 * Repère z en haut (x est, y nord), sans correction d'axes côté Cesium
 * (`upAxis: Axis.Z, forwardAxis: Axis.X`). Pur : testable sans navigateur 3D.
 */

export interface BoxInstance {
  /** Pied du pavé, au milieu du tronçon (m, repère local est/nord/haut). */
  x: number;
  y: number;
  z: number;
  /** Angle du rang depuis l'est, sens trigonométrique (radians). */
  yaw: number;
  /** Pente le long du rang (radians, positive si le bout +x monte). */
  pitch?: number;
  length: number;
  width: number;
  height: number;
}

// Pavé unitaire : x ∈ [−0,5 ; 0,5] (le long du rang), y ∈ [−0,5 ; 0,5], z ∈ [0 ; 1].
const FACES: { n: [number, number, number]; v: [number, number, number][] }[] = [
  { n: [1, 0, 0], v: [[0.5, -0.5, 0], [0.5, 0.5, 0], [0.5, 0.5, 1], [0.5, -0.5, 1]] },
  { n: [-1, 0, 0], v: [[-0.5, 0.5, 0], [-0.5, -0.5, 0], [-0.5, -0.5, 1], [-0.5, 0.5, 1]] },
  { n: [0, 1, 0], v: [[0.5, 0.5, 0], [-0.5, 0.5, 0], [-0.5, 0.5, 1], [0.5, 0.5, 1]] },
  { n: [0, -1, 0], v: [[-0.5, -0.5, 0], [0.5, -0.5, 0], [0.5, -0.5, 1], [-0.5, -0.5, 1]] },
  { n: [0, 0, 1], v: [[-0.5, -0.5, 1], [0.5, -0.5, 1], [0.5, 0.5, 1], [-0.5, 0.5, 1]] },
  { n: [0, 0, -1], v: [[-0.5, 0.5, 0], [0.5, 0.5, 0], [0.5, -0.5, 0], [-0.5, -0.5, 0]] },
];

function boxGeometry() {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  FACES.forEach((f, i) => {
    for (const v of f.v) {
      positions.push(...v);
      normals.push(...f.n);
    }
    const o = i * 4;
    indices.push(o, o + 1, o + 2, o, o + 2, o + 3);
  });
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint16Array(indices) };
}

const pad4 = (n: number) => (n + 3) & ~3;

/** glTF binaire : un nœud, un pavé, N instances (translation, rotation, échelle). */
export function instancedBoxGlb(instances: BoxInstance[]): Uint8Array {
  if (instances.length === 0) throw new Error("Aucune instance");
  const box = boxGeometry();
  const n = instances.length;
  const t = new Float32Array(n * 3);
  const r = new Float32Array(n * 4);
  const s = new Float32Array(n * 3);
  instances.forEach((it, i) => {
    t.set([it.x, it.y, it.z], i * 3);
    // Lacet autour de z puis tangage autour du y local (le bout +x monte si pitch > 0) : q = q_lacet · q_tangage.
    const [sy, cy] = [Math.sin(it.yaw / 2), Math.cos(it.yaw / 2)];
    const [sp, cp] = [Math.sin(-(it.pitch ?? 0) / 2), Math.cos(-(it.pitch ?? 0) / 2)];
    r.set([-sy * sp, cy * sp, sy * cp, cy * cp], i * 4);
    s.set([Math.max(it.length, 0.01), Math.max(it.width, 0.01), Math.max(it.height, 0.01)], i * 3);
  });
  const chunks = [box.positions, box.normals, box.indices, t, r, s];
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  let offset = 0;
  chunks.forEach((c, i) => {
    views.push({ byteOffset: offset, byteLength: c.byteLength, ...(i === 2 ? { target: 34963 } : i < 2 ? { target: 34962 } : {}) });
    offset = pad4(offset + c.byteLength);
  });
  const binLength = offset;
  const FLOAT = 5126;
  const json = {
    asset: { version: "2.0", generator: "Fourmy végétation 3D" },
    extensionsUsed: ["EXT_mesh_gpu_instancing"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 3, ROTATION: 4, SCALE: 5 } } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 } }],
    buffers: [{ byteLength: binLength }],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: 24, type: "VEC3", min: [-0.5, -0.5, 0], max: [0.5, 0.5, 1] },
      { bufferView: 1, componentType: FLOAT, count: 24, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: 36, type: "SCALAR" },
      { bufferView: 3, componentType: FLOAT, count: n, type: "VEC3" },
      { bufferView: 4, componentType: FLOAT, count: n, type: "VEC4" },
      { bufferView: 5, componentType: FLOAT, count: n, type: "VEC3" },
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
  out.fill(0x20, 20 + jsonBytes.length, 20 + jsonLength); // remplissage JSON : espaces
  const bin = 20 + jsonLength;
  dv.setUint32(bin, binLength, true);
  dv.setUint32(bin + 4, 0x004e4942, true); // « BIN »
  chunks.forEach((c, i) => out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), bin + 8 + views[i]!.byteOffset));
  return out;
}
