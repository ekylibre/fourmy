/**
 * Paysage du plan 3D (conception §7.3, §7.4) : modèles unitaires d'arbre
 * (feuillu, conifère, haie, fruitier) et de pylône en treillis, répétés par
 * EXT_mesh_gpu_instancing (translation, lacet, échelle). Repère z en haut,
 * hauteur unitaire (échelle z = hauteur), couronne de diamètre 1 (échelle x, y).
 * Pur : testable sans navigateur 3D.
 */

export type TreeKind = "deciduous" | "conifer" | "hedge" | "orchard";

export interface Geometry {
  positions: number[];
  normals: number[];
  colors: number[];
  indices: number[];
}

export interface Instance {
  x: number;
  y: number;
  z: number;
  /** Lacet autour de z (radians). */
  yaw: number;
  sx: number;
  sy: number;
  sz: number;
}

const empty = (): Geometry => ({ positions: [], normals: [], colors: [], indices: [] });

type V3 = [number, number, number];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Triangle à facettes (normale de la face), couleur linéaire. */
function tri(g: Geometry, a: V3, b: V3, c: V3, rgb: V3) {
  const n = unit(cross(sub(b, a), sub(c, a)));
  const base = g.positions.length / 3;
  for (const v of [a, b, c]) {
    g.positions.push(...v);
    g.normals.push(...n);
    g.colors.push(...rgb);
  }
  g.indices.push(base, base + 1, base + 2);
}

/** Ellipsoïde à facettes : centre, rayons, `seg` méridiens, `rings` parallèles. */
function ellipsoid(g: Geometry, c: V3, r: V3, rgb: V3, seg = 6, rings = 3) {
  const at = (i: number, j: number): V3 => {
    const th = (Math.PI * j) / rings;
    const ph = (2 * Math.PI * i) / seg;
    return [c[0] + r[0] * Math.sin(th) * Math.cos(ph), c[1] + r[1] * Math.sin(th) * Math.sin(ph), c[2] + r[2] * Math.cos(th)];
  };
  for (let j = 0; j < rings; j++) {
    for (let i = 0; i < seg; i++) {
      const [a, b, cc, d] = [at(i, j), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)];
      if (j > 0) tri(g, a, cc, b, rgb);
      if (j < rings - 1) tri(g, a, d, cc, rgb);
    }
  }
}

/** Prisme vertical (tronc) ou cône si r1 = 0 : `seg` côtés, de z0 à z1. */
function prism(g: Geometry, c: [number, number], r0: number, r1: number, z0: number, z1: number, rgb: V3, seg = 4) {
  const p = (i: number, r: number, z: number): V3 => [c[0] + r * Math.cos((2 * Math.PI * i) / seg), c[1] + r * Math.sin((2 * Math.PI * i) / seg), z];
  for (let i = 0; i < seg; i++) {
    const [a, b, cc, d] = [p(i, r0, z0), p(i + 1, r0, z0), p(i + 1, r1, z1), p(i, r1, z1)];
    tri(g, a, b, cc, rgb);
    if (r1 > 0) tri(g, a, cc, d, rgb);
  }
}

/** Poutre de section carrée (w) entre deux points (treillis des pylônes). */
function beam(g: Geometry, a: V3, b: V3, w: number, rgb: V3) {
  const ex = unit(sub(b, a));
  const up: V3 = Math.abs(ex[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const ey = unit(cross(up, ex));
  const ez = cross(ex, ey);
  const corner = (p: V3, sy: number, sz: number): V3 => [p[0] + (ey[0] * sy + ez[0] * sz) * (w / 2), p[1] + (ey[1] * sy + ez[1] * sz) * (w / 2), p[2] + (ey[2] * sy + ez[2] * sz) * (w / 2)];
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    tri(g, A[i]!, A[j]!, B[j]!, rgb);
    tri(g, A[i]!, B[j]!, B[i]!, rgb);
  }
}

/** sRGB (#RRGGBB) → linéaire. */
export function linear(hex: string): V3 {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as V3;
}

/** Hiver (novembre à mars) : feuillus et haies dégarnis, brun-gris ; conifères inchangés. */
export const isLeafless = (date: string) => {
  const m = Number(date.slice(5, 7));
  return m >= 11 || m <= 3;
};

const BARK = linear("#5B4636");

/** Arbre unitaire (hauteur 1, couronne de diamètre 1) d'un type, selon la saison. */
export function treeGeometry(kind: TreeKind, leafless: boolean): Geometry {
  const g = empty();
  const bare = kind !== "conifer" && leafless;
  const leaves = linear(bare ? "#8A7F70" : kind === "conifer" ? "#2F4F3A" : kind === "hedge" ? "#4F6B3A" : kind === "orchard" ? "#6E8B45" : "#4A6B35");
  // Dégarni : houppier plus petit (on voit à travers dans la réalité).
  const k = bare ? 0.75 : 1;
  switch (kind) {
    case "conifer":
      prism(g, [0, 0], 0.07, 0.05, 0, 0.18, BARK);
      prism(g, [0, 0], 0.5, 0, 0.12, 1, leaves, 6);
      break;
    case "hedge":
      ellipsoid(g, [0, 0, 0.5], [0.5 * k, 0.5 * k, 0.5], leaves);
      break;
    case "orchard":
      prism(g, [0, 0], 0.08, 0.06, 0, 0.45, BARK);
      ellipsoid(g, [0, 0, 0.68], [0.5 * k, 0.5 * k, 0.32], leaves);
      break;
    default:
      prism(g, [0, 0], 0.06, 0.04, 0, 0.5, BARK);
      ellipsoid(g, [0, 0, 0.66], [0.5 * k, 0.5 * k, 0.34], leaves);
  }
  return g;
}

/** Pylône unitaire (hauteur 1) : quatre montants qui s'effilent, croisillons, deux consoles. */
export function pylonGeometry(): Geometry {
  const g = empty();
  const steel = linear("#9AA0A3");
  const w = 0.012;
  const half = (z: number) => 0.09 * (1 - z) + 0.02 * z; // demi-largeur du fût à la hauteur z
  const corners = (z: number): V3[] => [
    [half(z), half(z), z],
    [-half(z), half(z), z],
    [-half(z), -half(z), z],
    [half(z), -half(z), z],
  ];
  const levels = [0, 0.2, 0.4, 0.55, 0.7, 0.85, 1];
  for (let l = 0; l + 1 < levels.length; l++) {
    const [a, b] = [corners(levels[l]!), corners(levels[l + 1]!)];
    for (let i = 0; i < 4; i++) {
      beam(g, a[i]!, b[i]!, w * 1.4, steel); // montant
      beam(g, a[i]!, b[(i + 1) % 4]!, w * 0.7, steel); // croisillon
      beam(g, b[i]!, b[(i + 1) % 4]!, w * 0.7, steel); // ceinture
    }
  }
  // Consoles de part et d'autre (y), à deux hauteurs ; la plus haute plus courte.
  for (const [z, len] of [
    [0.7, 0.32],
    [0.85, 0.24],
  ] as const) {
    for (const s of [1, -1]) {
      beam(g, [0, s * half(z), z], [0, s * len, z], w, steel);
      beam(g, [0, s * half(z + 0.06), z + 0.06], [0, s * len, z], w * 0.7, steel);
    }
  }
  return g;
}

const pad4 = (n: number) => (n + 3) & ~3;

/** glTF binaire : une géométrie (sans éclairage, couleurs par sommet), N instances. */
export function instancedGlb(geometry: Geometry, instances: readonly Instance[], generator = "Fourmy paysage 3D"): Uint8Array {
  if (instances.length === 0) throw new Error("Aucune instance");
  const n = instances.length;
  const vcount = geometry.positions.length / 3;
  const pos = new Float32Array(geometry.positions);
  const nor = new Float32Array(geometry.normals);
  const col = new Float32Array(geometry.colors);
  const idx = new Uint32Array(geometry.indices);
  const t = new Float32Array(n * 3);
  const r = new Float32Array(n * 4);
  const s = new Float32Array(n * 3);
  instances.forEach((it, i) => {
    t.set([it.x, it.y, it.z], i * 3);
    r.set([0, 0, Math.sin(it.yaw / 2), Math.cos(it.yaw / 2)], i * 4);
    s.set([Math.max(it.sx, 0.01), Math.max(it.sy, 0.01), Math.max(it.sz, 0.01)], i * 3);
  });
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < vcount; i++) {
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, pos[i * 3 + k]!);
      max[k] = Math.max(max[k]!, pos[i * 3 + k]!);
    }
  }
  const chunks = [pos, nor, col, idx, t, r, s];
  const views: { byteOffset: number; byteLength: number; target?: number }[] = [];
  let offset = 0;
  chunks.forEach((c, i) => {
    views.push({ byteOffset: offset, byteLength: c.byteLength, ...(i === 3 ? { target: 34963 } : i < 3 ? { target: 34962 } : {}) });
    offset = pad4(offset + c.byteLength);
  });
  const FLOAT = 5126;
  const json = {
    asset: { version: "2.0", generator },
    extensionsUsed: ["EXT_mesh_gpu_instancing", "KHR_materials_unlit"],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0, extensions: { EXT_mesh_gpu_instancing: { attributes: { TRANSLATION: 4, ROTATION: 5, SCALE: 6 } } } }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1, COLOR_0: 2 }, indices: 3, material: 0 }] }],
    // Aplats teintés par face (comme les matériels) : la lumière vient des normales à facettes.
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [1, 1, 1, 1], metallicFactor: 0, roughnessFactor: 1 }, doubleSided: true }],
    buffers: [{ byteLength: offset }],
    bufferViews: views.map((v) => ({ buffer: 0, ...v })),
    accessors: [
      { bufferView: 0, componentType: FLOAT, count: vcount, type: "VEC3", min, max },
      { bufferView: 1, componentType: FLOAT, count: vcount, type: "VEC3" },
      { bufferView: 2, componentType: FLOAT, count: vcount, type: "VEC3" },
      { bufferView: 3, componentType: 5125, count: idx.length, type: "SCALAR" },
      { bufferView: 4, componentType: FLOAT, count: n, type: "VEC3" },
      { bufferView: 5, componentType: FLOAT, count: n, type: "VEC4" },
      { bufferView: 6, componentType: FLOAT, count: n, type: "VEC3" },
    ],
  };
  const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
  const jsonLength = pad4(jsonBytes.length);
  const total = 12 + 8 + jsonLength + 8 + offset;
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
  dv.setUint32(bin, offset, true);
  dv.setUint32(bin + 4, 0x004e4942, true); // « BIN »
  chunks.forEach((c, i) => out.set(new Uint8Array(c.buffer, c.byteOffset, c.byteLength), bin + 8 + views[i]!.byteOffset));
  return out;
}

/**
 * Câble entre deux sommets d'une ligne, avec sa flèche (parabole, 3 % de la
 * portée au milieu) : `n` + 1 points [x, y, z] dans un repère local en mètres.
 */
export function catenary(a: V3, b: V3, n = 10, sag = 0.03): V3[] {
  const span = Math.hypot(b[0] - a[0], b[1] - a[1]);
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t - 4 * sag * span * t * (1 - t)] as V3;
  });
}
