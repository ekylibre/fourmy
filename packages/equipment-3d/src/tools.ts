import type { Mesh } from "./glb.js";
import type { AvatarParams } from "./params.js";

/**
 * Outils attelés au tracteur, en low-poly à aplats (même style que le
 * tracteur). Repère local : x vers l'avant du tracteur, y à gauche, z en
 * haut ; l'origine est le point d'attelage (relevage trois points ou
 * chape), l'outil s'étend vers les x négatifs. Les dimensions viennent des
 * paramètres de l'avatar : profondeur (longueur), largeur hors tout,
 * hauteur, largeur de travail.
 */

type V3 = [number, number, number];
export type Zone = { x: number; side: number; z: number; h: number };

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const unit = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Face plane, sommets remis dans le sens direct vu de l'extérieur (normale n). */
function quad(m: Mesh, mat: string, verts: V3[], n: V3) {
  const c = cross(sub(verts[1]!, verts[0]!), sub(verts[2]!, verts[0]!));
  m.face(mat, dot(c, n) < 0 ? [...verts].reverse() : verts, unit(n));
}

/** Poutre de section rectangulaire (w × h) entre deux points quelconques. */
export function beam(m: Mesh, mat: string, a: V3, b: V3, w: number, h: number) {
  const ex = unit(sub(b, a));
  const up: V3 = Math.abs(ex[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
  const ey = unit(cross(up, ex));
  const ez = cross(ex, ey);
  const corner = (p: V3, sy: number, sz: number) => add(p, add(mul(ey, (sy * w) / 2), mul(ez, (sz * h) / 2)));
  const A = [corner(a, -1, -1), corner(a, 1, -1), corner(a, 1, 1), corner(a, -1, 1)];
  const B = [corner(b, -1, -1), corner(b, 1, -1), corner(b, 1, 1), corner(b, -1, 1)];
  quad(m, mat, A, mul(ex, -1));
  quad(m, mat, B, ex);
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const mid = mul(add(add(A[i]!, A[j]!), add(B[i]!, B[j]!)), 0.25);
    const centre = mul(add(a, b), 0.5);
    quad(m, mat, [A[i]!, A[j]!, B[j]!, B[i]!], sub(mid, centre));
  }
}

/** Disque ou roue d'axe y, centre (x, z), rayon r, épaisseur t, centré en y. */
function disc(m: Mesh, mat: string, x: number, y: number, z: number, r: number, t: number, segments = 12) {
  m.cylinderY(mat, x, z, r, y - t / 2, y + t / 2, segments, true);
}

/** Roue avec pneu et jante. */
function wheel(m: Mesh, x: number, y: number, d: number, t: number) {
  disc(m, "tyre", x, y, d / 2, d / 2, t, 18);
  disc(m, "rim", x, y, d / 2, d * 0.3, t + 0.02, 12);
}

/** Chevalet trois points : deux points bas, un point haut (largeur catégorie 2). */
function headstock(m: Mesh, x: number, top = 1.05) {
  for (const s of [1, -1]) {
    beam(m, "chassis", [x, s * 0.43, 0.42], [x - 0.08, s * 0.16, top], 0.08, 0.08);
    m.box("dark", x + 0.02, s * 0.45, 0.38, 0.1, 0.06, 0.1); // axe d'attelage bas
  }
  m.box("chassis", x - 0.06, 0, top - 0.06, 0.16, 0.36, 0.12);
}

/** Rouleau arrière (packer, émietteur) : cylindre à anneaux, bras de liaison. */
function roller(m: Mesh, x: number, width: number, r: number, armFrom: { x: number; z: number }) {
  const rings = Math.max(4, Math.round(width / 0.25));
  for (let i = 0; i < rings; i++) {
    const y = -width / 2 + (i + 0.5) * (width / rings);
    disc(m, i % 2 ? "dark" : "chassis", x, y, r, r, width / rings - 0.02, 10);
  }
  disc(m, "chassis", x, 0, r, r * 0.35, width, 8);
  for (const s of [1, -1]) beam(m, "chassis", [armFrom.x, s * (width / 2 - 0.05), armFrom.z], [x, s * (width / 2 - 0.05), r], 0.08, 0.1);
}

/** Semoir monograine porté : poutre porte-outils, éléments semeurs avec trémie, traceurs repliés. */
export function sower(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || p.widthM;
  const rows = Math.max(2, Math.round(ww / 0.75));
  const spacing = ww / rows;
  headstock(m, -0.05, 1.0);
  m.box("body", -0.3, 0, 0.55, 0.2, ww + 0.2, 0.18); // poutre porte-outils
  // Trémie centrale d'engrais (fertiliseur) au-dessus de la poutre.
  m.prism("body", [[-0.75, 0.85], [-0.15, 0.85], [-0.1, 1.35], [-0.8, 1.35]], -Math.min(1.1, ww * 0.3), Math.min(1.1, ww * 0.3));
  m.box("bodyLight", -0.45, 0, 1.35, 0.72, Math.min(2.25, ww * 0.62), 0.04);
  for (let i = 0; i < rows; i++) {
    const y = -ww / 2 + (i + 0.5) * spacing;
    beam(m, "chassis", [-0.38, y, 0.62], [-0.85, y, 0.5], 0.07, 0.05); // parallélogramme
    beam(m, "chassis", [-0.38, y, 0.42], [-0.85, y, 0.32], 0.07, 0.05);
    m.box("body", -1.05, y, 0.25, 0.45, 0.22, 0.32); // corps de l'élément
    m.prism("body", [[-1.25, 0.6], [-0.85, 0.6], [-0.8, 1.05], [-1.3, 1.05]], y - 0.17, y + 0.17); // trémie à graines
    m.box("bodyLight", -1.05, y, 1.05, 0.52, 0.36, 0.03);
    disc(m, "dark", -0.92, y, 0.17, 0.17, 0.04); // disque ouvreur
    disc(m, "tyre", -1.4, y - 0.05, 0.13, 0.13, 0.06, 10); // roues plombeuses en V
    disc(m, "tyre", -1.4, y + 0.05, 0.13, 0.13, 0.06, 10);
  }
  // Traceurs repliés aux deux bouts.
  for (const s of [1, -1]) {
    beam(m, "dark", [-0.32, s * (ww / 2 + 0.05), 0.7], [-0.4, s * (ww / 2 + 0.05), 1.55], 0.06, 0.06);
    disc(m, "dark", -0.42, s * (ww / 2 + 0.05), 1.6, 0.16, 0.03);
  }
  return { x: -0.45, side: Math.min(1.1, ww * 0.3) + 0.005, z: 1.1, h: 0.18 };
}

/** Herse rotative : caisson bas, dents, rouleau packer, boîtier central. */
export function rotaryHarrow(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || p.widthM;
  headstock(m, -0.05, 1.1);
  m.box("body", -0.65, 0, 0.25, 0.75, ww, 0.3); // caisson
  m.prism("bodyLight", [[-1.02, 0.55], [-0.28, 0.55], [-0.38, 0.62], [-0.92, 0.62]], -ww / 2, ww / 2);
  m.box("body", -0.6, 0, 0.55, 0.45, 0.45, 0.35); // boîtier central
  m.box("dark", -0.35, 0, 0.75, 0.3, 0.12, 0.12); // arbre de transmission vers la prise de force
  beam(m, "dark", [-0.2, 0, 0.82], [-0.02, 0, 0.6], 0.09, 0.09);
  const rotors = Math.max(4, Math.round(ww / 0.25));
  for (let i = 0; i < rotors; i++) {
    const y = -ww / 2 + (i + 0.5) * (ww / rotors);
    m.box("dark", -0.5, y - 0.06, 0.02, 0.05, 0.05, 0.24);
    m.box("dark", -0.8, y + 0.06, 0.02, 0.05, 0.05, 0.24);
  }
  for (const s of [1, -1]) m.box("bodyDark", -0.65, s * (ww / 2 + 0.03), 0.0, 0.85, 0.04, 0.62); // déflecteurs
  roller(m, -1.35, ww - 0.1, 0.26, { x: -0.95, z: 0.5 });
  return { x: -0.65, side: ww / 2 + 0.006, z: 0.4, h: 0.16 };
}

/** Charrue réversible portée : tête d'attelage, retournement, age en diagonale, corps dessus et dessous. */
export function plough(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || 1.6;
  const bodies = Math.max(2, Math.round(ww / 0.4));
  const L = Math.max(p.lengthM, bodies * 0.85 + 0.8);
  headstock(m, -0.05, 1.05);
  m.box("body", -0.4, 0, 0.55, 0.45, 0.4, 0.45); // retournement
  const start: V3 = [-0.6, 0, 0.75];
  const end: V3 = [-L, -ww + 0.2, 0.75];
  beam(m, "body", start, end, 0.18, 0.18); // age
  for (let i = 0; i < bodies; i++) {
    const t = (i + 0.5) / bodies;
    const at = add(start, mul(sub(end, start), t));
    for (const side of [1, -1]) {
      // Étançon, puis versoir en coin (dessous), et son jumeau retourné (dessus).
      const zFoot = side > 0 ? 0.05 : 1.45;
      beam(m, "body", at, [at[0] - 0.05, at[1], zFoot + side * 0.25], 0.1, 0.06);
      const x0 = at[0] + 0.15;
      const zA = zFoot;
      const zB = zFoot + side * 0.35;
      m.face("light", [
        [x0, at[1] + 0.05, zA],
        [x0 - 0.6, at[1] - 0.4, zA],
        [x0 - 0.65, at[1] - 0.42, zB],
        [x0 - 0.1, at[1] + 0.02, zB],
      ]);
      m.face("light", [
        [x0 - 0.1, at[1] + 0.02, zB],
        [x0 - 0.65, at[1] - 0.42, zB],
        [x0 - 0.6, at[1] - 0.4, zA],
        [x0, at[1] + 0.05, zA],
      ]);
    }
  }
  wheel(m, -L + 0.1, -ww + 0.55, 0.6, 0.18); // roue de jauge
  beam(m, "chassis", [-L + 0.3, -ww + 0.25, 0.75], [-L + 0.1, -ww + 0.55, 0.35], 0.07, 0.07);
  return { x: -0.4, side: 0.205, z: 0.78, h: 0.14 };
}

/** Pulvérisateur porté : cuve à pans coupés, rampe dépliée à la largeur de travail. */
export function mountedSprayer(p: AvatarParams, m: Mesh): Zone {
  // Cuve au gabarit routier : la largeur de travail ne déploie que la rampe.
  const W = Math.min(p.widthM, SPRAYER_BODY_MAX_M);
  const H = p.heightM;
  const depth = Math.max(0.9, p.lengthM - 0.4);
  headstock(m, -0.05, 1.2);
  m.box("chassis", -0.15 - depth / 2, 0, 0.3, depth + 0.1, W - 0.3, 0.12); // châssis
  const x0 = -0.2;
  const x1 = -0.2 - depth;
  const zb = 0.45;
  const zt = Math.max(zb + 0.9, H - 0.15);
  const c = 0.22;
  m.prism("body", [[x1 + c, zb], [x0 - c, zb], [x0, zb + c], [x0, zt - c], [x0 - c, zt], [x1 + c, zt], [x1, zt - c], [x1, zb + c]], -(W - 0.4) / 2, (W - 0.4) / 2);
  m.cylinderZ("bodyLight", (x0 + x1) / 2, 0, 0.18, zt, zt + 0.08, 12); // couvercle de cuve
  // Rampe dépliée : tronçon central et bras en treillis.
  const ww = p.workingWidthM || 12;
  const xb = x1 - 0.25;
  m.box("dark", xb, 0, 0.55, 0.2, 1.4, 0.8); // cadre de levage
  for (const s of [1, -1]) {
    beam(m, "dark", [xb, s * 0.6, 1.1], [xb, s * (ww / 2), 0.95], 0.08, 0.08);
    beam(m, "dark", [xb, s * 0.6, 0.65], [xb, s * (ww / 2), 0.9], 0.06, 0.06);
  }
  beam(m, "light", [xb - 0.05, -ww / 2, 0.62], [xb - 0.05, ww / 2, 0.62], 0.03, 0.03); // porte-buses
  return { x: (x0 + x1) / 2, side: (W - 0.4) / 2 + 0.006, z: (zb + zt) / 2, h: Math.min(0.35, (zt - zb) * 0.3) };
}

/** Largeur maximale d'une cuve de pulvérisateur (gabarit routier), même si la largeur saisie est celle de la rampe. */
export const SPRAYER_BODY_MAX_M = 3;

/** Distributeur d'engrais porté : trémie en V, deux disques d'épandage. */
export function fertilizerSpreader(p: AvatarParams, m: Mesh): Zone {
  const W = p.widthM;
  const H = p.heightM;
  const depth = Math.max(0.9, p.lengthM - 0.3);
  headstock(m, -0.05, 1.0);
  const x0 = -0.15;
  const x1 = -0.15 - depth;
  const zt = H;
  m.prism("body", [[x1 + depth * 0.3, 0.75], [x0 - depth * 0.3, 0.75], [x0, zt - 0.1], [x0, zt], [x1, zt], [x1, zt - 0.1]], -W / 2 + 0.05, W / 2 - 0.05);
  m.box("bodyLight", (x0 + x1) / 2, 0, zt, depth + 0.04, W - 0.06, 0.04);
  m.box("chassis", (x0 + x1) / 2, 0, 0.55, depth * 0.5, 1.0, 0.2);
  for (const s of [1, -1]) {
    m.cylinderZ("dark", (x0 + x1) / 2 - 0.15, s * 0.35, 0.32, 0.45, 0.48, 16); // disque
    for (let k = 0; k < 4; k++) {
      const t = (k / 4) * Math.PI * 2 + (s > 0 ? 0 : 0.4);
      beam(m, "light", [(x0 + x1) / 2 - 0.15, s * 0.35, 0.5], [(x0 + x1) / 2 - 0.15 + 0.3 * Math.cos(t), s * 0.35 + 0.3 * Math.sin(t), 0.5], 0.03, 0.05);
    }
  }
  m.box("dark", x1 - 0.12, 0, 0.35, 0.06, W * 0.8, 0.35); // protection arrière
  return { x: (x0 + x1) / 2, side: W / 2 - 0.045, z: zt - 0.3, h: 0.2 };
}

/** Déchaumeur à disques traîné : timon, deux trains de disques croisés, roues de transport, rouleau. */
export function discHarrow(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || p.widthM;
  const hitch = Math.max(0.8, p.hitchOffsetM);
  const L = Math.max(p.lengthM, hitch + 2.2);
  beam(m, "body", [0, 0, 0.45], [-hitch, 0, 0.7], 0.14, 0.14); // timon
  m.box("dark", 0, 0, 0.38, 0.18, 0.1, 0.12); // anneau
  const fx = -hitch;
  m.box("body", fx - 0.1, 0, 0.7, 0.2, ww, 0.16); // poutre avant du châssis
  m.box("body", fx - 1.2, 0, 0.7, 0.2, ww, 0.16); // poutre arrière
  for (const s of [1, -1]) m.box("body", fx - 0.65, s * (ww / 2 - 0.1), 0.7, 1.3, 0.14, 0.14);
  const n = Math.max(6, Math.round(ww / 0.25));
  for (let row = 0; row < 2; row++) {
    const x = fx - 0.4 - row * 0.65;
    for (let i = 0; i < n; i++) {
      const y = -ww / 2 + (i + 0.5) * (ww / n) + (row ? 0.08 : 0);
      disc(m, "light", x, y, 0.28, 0.28, 0.02, 12);
      beam(m, "chassis", [x, y, 0.7], [x, y, 0.32], 0.05, 0.04);
    }
  }
  wheel(m, fx - 0.65, 0.55, 0.8, 0.28); // roues de transport (repliées entre les trains)
  wheel(m, fx - 0.65, -0.55, 0.8, 0.28);
  roller(m, -L + 0.3, ww - 0.15, 0.27, { x: fx - 1.25, z: 0.7 });
  return { x: fx - 0.1, side: ww / 2 + 0.005, z: 0.78, h: 0.12 };
}

/** Rouleau porté ou traîné : cadre et rouleau à anneaux. */
export function rollerTool(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || p.widthM;
  headstock(m, -0.05, 0.95);
  m.box("body", -0.45, 0, 0.6, 0.25, ww, 0.16);
  for (const s of [1, -1]) beam(m, "body", [-0.1, s * 0.4, 0.6], [-0.45, s * (ww / 2 - 0.2), 0.68], 0.1, 0.1);
  roller(m, -0.95, ww, 0.3, { x: -0.5, z: 0.6 });
  return { x: -0.45, side: ww / 2 + 0.005, z: 0.68, h: 0.1 };
}

/** Cultivateur à dents porté (vibroculteur, chisel) : cadre, rangées de dents, émietteur. */
export function tineCultivator(p: AvatarParams, m: Mesh): Zone {
  const ww = p.workingWidthM || p.widthM;
  headstock(m, -0.05, 1.0);
  const rowsX = [-0.35, -0.75, -1.15];
  for (const x of rowsX) m.box("body", x, 0, 0.55, 0.14, ww, 0.12);
  for (const s of [1, -1]) m.box("body", -0.75, s * (ww / 2 - 0.07), 0.55, 1.0, 0.12, 0.12);
  rowsX.forEach((x, r) => {
    const n = Math.max(4, Math.round(ww / 0.3));
    for (let i = 0; i < n; i++) {
      const y = -ww / 2 + (i + 0.5 + (r % 2 ? 0.5 : 0)) * (ww / (n + 0.5));
      // Dent en S : trois segments.
      beam(m, "dark", [x, y, 0.55], [x - 0.12, y, 0.32], 0.04, 0.025);
      beam(m, "dark", [x - 0.12, y, 0.32], [x + 0.02, y, 0.12], 0.04, 0.025);
      beam(m, "light", [x + 0.02, y, 0.12], [x + 0.12, y, 0.02], 0.06, 0.02);
    }
  });
  roller(m, -1.6, ww - 0.1, 0.2, { x: -1.2, z: 0.6 });
  return { x: -0.75, side: ww / 2 + 0.005, z: 0.6, h: 0.08 };
}
