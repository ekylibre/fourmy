import { Document, WebIO } from "@gltf-transform/core";
import type { AvatarParams } from "./params.js";

/**
 * Avatar 3D (glTF binaire) d'un matériel, à l'échelle réelle, en formes
 * simples (quelques centaines de triangles) : silhouette et proportions, pas
 * le dessin du constructeur. Repère local : x vers l'avant, y à gauche, z en
 * haut, en mètres ; converti dans le repère glTF (y en haut, avant = +z), que
 * Cesium oriente sans correction (cap 0 = est). Origine : au sol, sous
 * l'essieu arrière (tracteur, automoteur) ou au point d'attelage (outil).
 */

type V3 = [number, number, number];
type Part = { positions: number[]; normals: number[]; uvs?: number[]; indices: number[] };
type MaterialKey = "body" | "cab" | "wheels" | "accent" | "logo";

/** Local (x avant, y gauche, z haut) → glTF (X = gauche, Y = haut, Z = avant). */
const toGltf = ([x, y, z]: V3): V3 => [y, z, x];

class Mesh {
  parts: Record<MaterialKey, Part> = {
    body: { positions: [], normals: [], indices: [] },
    cab: { positions: [], normals: [], indices: [] },
    wheels: { positions: [], normals: [], indices: [] },
    accent: { positions: [], normals: [], indices: [] },
    logo: { positions: [], normals: [], uvs: [], indices: [] },
  };

  private quad(m: MaterialKey, a: V3, b: V3, c: V3, d: V3, n: V3, uv?: [number, number][]) {
    const p = this.parts[m];
    const base = p.positions.length / 3;
    for (const v of [a, b, c, d]) p.positions.push(...toGltf(v));
    for (let i = 0; i < 4; i++) p.normals.push(...toGltf(n));
    if (uv && p.uvs) for (const [u, w] of uv) p.uvs.push(u, w);
    p.indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** Pavé : centre (x, y, z bas), dimensions (longueur x, largeur y, hauteur z). */
  box(m: MaterialKey, cx: number, cy: number, z0: number, lx: number, ly: number, lz: number) {
    if (lx <= 0 || ly <= 0 || lz <= 0) return;
    const [x0, x1, y0, y1, z1] = [cx - lx / 2, cx + lx / 2, cy - ly / 2, cy + ly / 2, z0 + lz];
    this.quad(m, [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1], [1, 0, 0]); // avant
    this.quad(m, [x0, y1, z0], [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [-1, 0, 0]); // arrière
    this.quad(m, [x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [0, 1, 0]); // gauche
    this.quad(m, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [0, -1, 0]); // droite
    this.quad(m, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [0, 0, 1]); // dessus
    this.quad(m, [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [x1, y0, z0], [0, 0, -1]); // dessous
  }

  /** Roue : cylindre d'axe y, centre (x, y), diamètre, largeur. */
  wheel(cx: number, cy: number, diameter: number, width: number, segments = 18) {
    if (diameter <= 0) return;
    const r = diameter / 2;
    const p = this.parts.wheels;
    const [ya, yb] = [cy - width / 2, cy + width / 2];
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * Math.PI * 2;
      const a1 = ((i + 1) / segments) * Math.PI * 2;
      const pt = (a: number, y: number): V3 => [cx + r * Math.cos(a), y, r + r * Math.sin(a)];
      const nm = (a: number): V3 => [Math.cos(a), 0, Math.sin(a)];
      // bande de roulement
      const base = p.positions.length / 3;
      for (const [v, n] of [
        [pt(a0, ya), nm(a0)],
        [pt(a1, ya), nm(a1)],
        [pt(a1, yb), nm(a1)],
        [pt(a0, yb), nm(a0)],
      ] as [V3, V3][]) {
        p.positions.push(...toGltf(v));
        p.normals.push(...toGltf(n));
      }
      p.indices.push(base, base + 2, base + 1, base, base + 3, base + 2);
      // flancs (jante en couleur d'accent)
      for (const [y, ny] of [
        [ya, -1],
        [yb, 1],
      ] as [number, number][]) {
        const side = ny > 0 ? this.parts.accent : p;
        const b = side.positions.length / 3;
        for (const v of [[cx, y, r] as V3, pt(a0, y), pt(a1, y)]) {
          side.positions.push(...toGltf(v));
          side.normals.push(...toGltf([0, ny, 0]));
        }
        // Face vers l'extérieur de la roue (y > 0 : sens inverse des angles croissants).
        side.indices.push(...(ny > 0 ? [b, b + 2, b + 1] : [b, b + 1, b + 2]));
      }
    }
  }

  /** Logo plaqué sur un flanc (y = ±side), centré en (x, z), hauteur h, proportions du logo. */
  logo(cx: number, side: number, cz: number, h: number, ratio: number) {
    const w = Math.min(h * ratio, 1.2);
    const hh = w / ratio;
    const [x0, x1, z0, z1] = [cx - w / 2, cx + w / 2, cz - hh / 2, cz + hh / 2];
    if (side > 0) this.quad("logo", [x1, side, z0], [x0, side, z0], [x0, side, z1], [x1, side, z1], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    else this.quad("logo", [x0, side, z0], [x1, side, z0], [x1, side, z1], [x0, side, z1], [0, -1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
}

/** Formes du gabarit (repère local). Renvoie aussi la zone du logo. */
function shape(p: AvatarParams, m: Mesh): { logo?: { x: number; side: number; z: number; h: number } } {
  const { lengthM: L, widthM: W, heightM: H } = p;
  switch (p.template) {
    case "tractor": {
      const wb = p.wheelbaseM;
      const dr = p.rearWheelDiameterM;
      const df = p.frontWheelDiameterM;
      const front = Math.max(0.3, (L - wb) * 0.6); // porte-à-faux avant
      const rear = Math.max(0.2, L - wb - front);
      const tr = Math.min(0.6, W * 0.22); // largeur des pneus arrière
      const tf = tr * 0.8;
      m.wheel(0, W / 2 - tr / 2, dr, tr);
      m.wheel(0, -(W / 2 - tr / 2), dr, tr);
      const yf = W * 0.42 - tf / 2;
      m.wheel(wb, yf, df, tf);
      m.wheel(wb, -yf, df, tf);
      const hoodW = Math.min(1, W * 0.4);
      const hoodZ = Math.max(df * 0.45, 0.45);
      const hoodTop = Math.max(dr * 0.85, hoodZ + 0.6);
      m.box("body", (wb + front + 0.3) / 2, 0, hoodZ, wb + front - 0.3, hoodW, hoodTop - hoodZ); // capot
      m.box("accent", (wb + front) / 2 - 0.2, 0, Math.max(df * 0.3, 0.3), wb + front - 0.4, hoodW * 0.8, 0.25); // châssis
      const cabW = Math.min(W - 2 * tr - 0.05, 1.9);
      const cabL = Math.min(1.8, wb * 0.65);
      const cabX = cabL / 2 - 0.35;
      const cabZ = dr * 0.6;
      m.box("cab", cabX, 0, cabZ, cabL, cabW, H - cabZ - 0.12);
      m.box("body", cabX, 0, H - 0.12, cabL + 0.15, cabW + 0.15, 0.12); // toit
      for (const s of [1, -1]) m.box("body", -0.05, s * (W / 2 - tr / 2), dr + 0.02, dr * 0.75, tr + 0.08, 0.06); // ailes
      m.box("accent", -rear / 2 - 0.1, 0, dr * 0.3, rear, 0.6, 0.2); // attelage arrière
      return { logo: { x: wb * 0.75 + 0.1, side: hoodW / 2 + 0.005, z: (hoodZ + hoodTop) / 2, h: Math.min(0.32, (hoodTop - hoodZ) * 0.5) } };
    }
    case "self_propelled": {
      const wb = p.wheelbaseM;
      const t = Math.min(0.7, W * 0.22);
      m.wheel(wb, W / 2 - t / 2, p.frontWheelDiameterM, t);
      m.wheel(wb, -(W / 2 - t / 2), p.frontWheelDiameterM, t);
      m.wheel(0, W / 2 - t / 2, p.rearWheelDiameterM, t * 0.8);
      m.wheel(0, -(W / 2 - t / 2), p.rearWheelDiameterM, t * 0.8);
      const z0 = Math.max(p.rearWheelDiameterM, p.frontWheelDiameterM) * 0.5;
      m.box("body", wb / 2, 0, z0, L * 0.8, W - 2 * t, H * 0.62 - z0);
      m.box("cab", wb + 0.3, 0, H * 0.62, 1.6, Math.min(1.8, W - 2 * t), H * 0.38 - 0.1);
      m.box("body", wb + 0.3, 0, H - 0.1, 1.7, Math.min(1.9, W - 2 * t + 0.1), 0.1);
      return { logo: { x: wb / 2, side: (W - 2 * t) / 2 + 0.005, z: (z0 + H * 0.62) / 2, h: 0.5 } };
    }
    case "trailed_tool": {
      const ww = p.workingWidthM || W;
      const hitch = p.hitchOffsetM;
      m.box("accent", -hitch / 2, 0, 0.45, hitch, 0.12, 0.12); // flèche
      const depth = Math.max(0.6, L - hitch);
      m.box("body", -hitch - depth / 2, 0, 0.35, depth, ww, Math.max(0.2, H * 0.25)); // châssis
      m.box("accent", -hitch - depth / 2, 0, 0.05, depth * 0.9, ww, 0.3); // organes de travail
      m.wheel(-hitch - depth * 0.6, ww / 2 + 0.15, p.rearWheelDiameterM, 0.25);
      m.wheel(-hitch - depth * 0.6, -(ww / 2 + 0.15), p.rearWheelDiameterM, 0.25);
      return { logo: { x: -hitch - depth / 2, side: ww / 2 + 0.005, z: 0.35 + Math.max(0.2, H * 0.25) / 2, h: 0.15 } };
    }
    case "trailed_sprayer": {
      const hitch = p.hitchOffsetM;
      const body = Math.max(1.5, L - hitch);
      m.box("accent", -hitch / 2, 0, 0.6, hitch, 0.14, 0.14);
      m.wheel(-hitch - body * 0.55, W / 2 - 0.2, p.rearWheelDiameterM, 0.35);
      m.wheel(-hitch - body * 0.55, -(W / 2 - 0.2), p.rearWheelDiameterM, 0.35);
      const tankZ = p.rearWheelDiameterM * 0.55;
      m.box("body", -hitch - body / 2, 0, tankZ, body * 0.85, W - 0.8, H - tankZ - 0.3); // cuve
      // rampe dépliée (largeur de travail), à l'arrière
      m.box("accent", -hitch - body - 0.15, 0, 0.9, 0.1, p.workingWidthM || 12, 0.12);
      return { logo: { x: -hitch - body / 2, side: (W - 0.8) / 2 + 0.005, z: (tankZ + H - 0.3) / 2, h: 0.35 } };
    }
    case "mounted_tool": {
      const ww = p.workingWidthM || W;
      m.box("body", -L / 2, 0, 0.3, L, ww, Math.max(0.2, H * 0.3));
      m.box("accent", -L / 2, 0, 0.02, L * 0.8, ww, 0.28);
      m.box("accent", -0.1, 0, 0.3, 0.2, 0.8, H - 0.3); // tour d'attelage
      return { logo: { x: -L / 2, side: ww / 2 + 0.005, z: 0.3 + Math.max(0.2, H * 0.3) / 2, h: 0.15 } };
    }
    case "trailer": {
      const hitch = p.hitchOffsetM;
      const body = Math.max(1.5, L - hitch);
      m.box("accent", -hitch / 2, 0, 0.7, hitch, 0.15, 0.15);
      m.wheel(-hitch - body * 0.6, W / 2 - 0.25, p.rearWheelDiameterM, 0.4);
      m.wheel(-hitch - body * 0.6, -(W / 2 - 0.25), p.rearWheelDiameterM, 0.4);
      const z0 = p.rearWheelDiameterM * 0.7;
      m.box("body", -hitch - body / 2, 0, z0, body, W, H - z0);
      return { logo: { x: -hitch - body / 2, side: W / 2 + 0.005, z: (z0 + H) / 2, h: 0.4 } };
    }
    default:
      m.box("body", 0, 0, 0, L, W, H);
      return { logo: { x: 0, side: W / 2 + 0.005, z: H * 0.6, h: Math.min(0.5, H * 0.3) } };
  }
}

/** Proportions d'une image PNG (largeur / hauteur), lues dans son en-tête ; 3 par défaut. */
export function pngRatio(png: Uint8Array | null | undefined): number {
  if (!png || png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) return 3;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  return w > 0 && h > 0 ? Math.min(8, Math.max(0.5, w / h)) : 3;
}

const rgb = (hex: string, a = 1): [number, number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  // Couleur sRGB → linéaire (glTF)
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return [lin((n >> 16) & 255), lin((n >> 8) & 255), lin(n & 255), a];
};

export interface AvatarModel {
  glb: Uint8Array;
  triangles: number;
  /** Boîte englobante dans le repère local (x avant, y gauche, z haut), en mètres. */
  bounds: { min: V3; max: V3 };
}

/** Construit l'avatar (GLB). `logoPng` : logo du matériel ou de sa marque, en PNG. */
export async function buildAvatarGlb(p: AvatarParams, logoPng?: Uint8Array | null): Promise<AvatarModel> {
  const m = new Mesh();
  const zone = shape(p, m);
  const withLogo = p.logo === "sides" && !!logoPng && !!zone.logo;
  if (withLogo && zone.logo) {
    const ratio = pngRatio(logoPng);
    for (const s of [1, -1]) m.logo(zone.logo.x, s * zone.logo.side, zone.logo.z, zone.logo.h, ratio);
  }
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh("avatar");
  const materials: Record<MaterialKey, [string, number, number]> = {
    body: [p.colors.body, 0.2, 0.55],
    cab: [p.colors.cab, 0, 0.15],
    wheels: [p.colors.wheels, 0, 0.9],
    accent: [p.colors.accent, 0.6, 0.45],
    logo: ["#FFFFFF", 0, 0.6],
  };
  let triangles = 0;
  for (const key of Object.keys(m.parts) as MaterialKey[]) {
    const part = m.parts[key];
    if (!part.indices.length || (key === "logo" && !withLogo)) continue;
    const [color, metal, rough] = materials[key];
    const mat = doc
      .createMaterial(key)
      .setBaseColorFactor(rgb(color, key === "cab" ? 0.75 : 1))
      .setMetallicFactor(metal)
      .setRoughnessFactor(rough);
    if (key === "cab") mat.setAlphaMode("BLEND");
    if (key === "logo") {
      mat.setBaseColorTexture(doc.createTexture("logo").setImage(logoPng!).setMimeType("image/png")).setAlphaMode("BLEND").setDoubleSided(false);
    }
    const prim = doc
      .createPrimitive()
      .setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(part.positions)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(part.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(part.indices)).setBuffer(buffer));
    if (part.uvs?.length) prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(part.uvs)).setBuffer(buffer));
    mesh.addPrimitive(prim);
    triangles += part.indices.length / 3;
  }
  const node = doc.createNode("avatar").setMesh(mesh);
  doc.createScene("scene").addChild(node);
  doc.getRoot().getAsset().generator = "Fourmy equipment-3d";
  const glb = await new WebIO().writeBinary(doc);
  // Boîte englobante (repère local) : contrôle d'échelle.
  const all = (Object.values(m.parts) as Part[]).flatMap((part) => part.positions);
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < all.length; i += 3) {
    const local: V3 = [all[i + 2]!, all[i]!, all[i + 1]!]; // glTF → local
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k]!, local[k]!);
      max[k] = Math.max(max[k]!, local[k]!);
    }
  }
  return { glb, triangles, bounds: { min, max } };
}

/** Contrôle d'un GLB importé (FR-MAT-83) : en-tête, taille, nombre de triangles. */
export async function inspectGlb(bytes: Uint8Array, limits = { maxBytes: 5 * 1024 * 1024, maxTriangles: 100_000 }): Promise<{ triangles: number }> {
  if (bytes.length > limits.maxBytes) throw new Error("Modèle trop lourd (5 Mo au plus).");
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF") throw new Error("Fichier GLB (glTF binaire) attendu.");
  const doc = await new WebIO().readBinary(bytes);
  let triangles = 0;
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      triangles += Math.floor((idx ? idx.getCount() : (prim.getAttribute("POSITION")?.getCount() ?? 0)) / 3);
    }
  }
  if (triangles > limits.maxTriangles) throw new Error(`Modèle trop détaillé (${triangles.toLocaleString("fr-FR")} triangles, 100 000 au plus).`);
  return { triangles };
}
