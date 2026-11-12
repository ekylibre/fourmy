import { Document, WebIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS, KHRMaterialsUnlit } from "@gltf-transform/extensions";
import type { AvatarParams } from "./params.js";

/**
 * Avatar 3D (glTF binaire) d'un matériel, à l'échelle réelle. Repère local :
 * x vers l'avant, y à gauche, z en haut, en mètres ; converti dans le repère
 * glTF (y en haut, avant = +z), que Cesium oriente sans correction (cap 0 =
 * est). Origine : au sol, sous l'essieu arrière (tracteur, automoteur) ou au
 * point d'attelage (outil).
 *
 * Le tracteur reprend le dessin « tracteur bleu » du kit Ekylibre
 * (illustration isométrique) : toit blanc et gyrophare, vitres teintées,
 * capot effilé au dessus plus clair, liseré blanc, calandre sombre et phares,
 * ailes galbées, échappement, rétroviseurs, pneus à crampons, jantes
 * orangées. Les dimensions et les couleurs viennent de l'avatar.
 */

type V3 = [number, number, number];
type V2 = [number, number];
type Part = { positions: number[]; normals: number[]; uvs: number[]; tones: number[]; indices: number[] };

/**
 * Teinte d'une face selon son orientation, comme l'illustration isométrique
 * du kit (lumière en haut à gauche, devant) : dessus plus clairs, flanc droit
 * et arrière plus sombres, dessous dans l'ombre. Rendu sans éclairage.
 */
export function faceTone([nx, ny, nz]: V3): number {
  return 0.2 * Math.max(nz, 0) - 0.4 * Math.max(-nz, 0) - 0.16 * Math.max(-ny, 0) - 0.06 * Math.max(nx, 0) - 0.22 * Math.max(-nx, 0);
}

export interface MaterialDef {
  color: string;
  alpha?: number;
  metal?: number;
  rough?: number;
}

/** Local (x avant, y gauche, z haut) → glTF (X = gauche, Y = haut, Z = avant). */
const toGltf = ([x, y, z]: V3): V3 => [y, z, x];
const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

/** Maillage par matériau ; toutes les faces sont visibles des deux côtés (matériaux double face). */
export class Mesh {
  parts = new Map<string, Part>();

  private part(m: string): Part {
    let p = this.parts.get(m);
    if (!p) {
      p = { positions: [], normals: [], uvs: [], tones: [], indices: [] };
      this.parts.set(m, p);
    }
    return p;
  }

  /** Polygone plan convexe (triangulé en éventail), normale calculée ou imposée. */
  face(m: string, verts: V3[], n?: V3, uv?: V2[]) {
    if (verts.length < 3) return;
    const p = this.part(m);
    const normal = n ?? norm(cross(sub(verts[1]!, verts[0]!), sub(verts[2]!, verts[0]!)));
    const base = p.positions.length / 3;
    const tone = faceTone(normal);
    verts.forEach((v, i) => {
      p.positions.push(...toGltf(v));
      p.normals.push(...toGltf(normal));
      p.tones.push(tone);
      if (uv) p.uvs.push(...uv[i]!);
    });
    for (let i = 1; i < verts.length - 1; i++) p.indices.push(base, base + i, base + i + 1);
  }

  /** Pavé aligné : centre (x, y), bas z0, dimensions (x, y, z). */
  box(m: string, cx: number, cy: number, z0: number, lx: number, ly: number, lz: number) {
    if (lx <= 0 || ly <= 0 || lz <= 0) return;
    this.prism(m, [[cx - lx / 2, z0], [cx + lx / 2, z0], [cx + lx / 2, z0 + lz], [cx - lx / 2, z0 + lz]], cy - ly / 2, cy + ly / 2);
  }

  /** Profil convexe dans le plan (x, z), extrudé entre y0 et y1. */
  prism(m: string, profile: V2[], y0: number, y1: number) {
    const at = ([x, z]: V2, y: number): V3 => [x, y, z];
    this.face(m, profile.map((q) => at(q, y1)), [0, 1, 0]);
    this.face(m, [...profile].reverse().map((q) => at(q, y0)), [0, -1, 0]);
    for (let i = 0; i < profile.length; i++) {
      const a = profile[i]!;
      const b = profile[(i + 1) % profile.length]!;
      const n = norm([b[1] - a[1], 0, -(b[0] - a[0])]);
      this.face(m, [at(a, y0), at(b, y0), at(b, y1), at(a, y1)], [-n[0], 0, -n[2]]);
    }
  }

  /** Secteur d'anneau (aile) autour d'un axe y : centre (x, z), rayons, angles (radians, 0 = avant). */
  arcBand(m: string, cx: number, cz: number, r0: number, r1: number, a0: number, a1: number, y0: number, y1: number, segments = 10) {
    for (let i = 0; i < segments; i++) {
      const t0 = a0 + ((a1 - a0) * i) / segments;
      const t1 = a0 + ((a1 - a0) * (i + 1)) / segments;
      const pt = (r: number, t: number): V2 => [cx + r * Math.cos(t), cz + r * Math.sin(t)];
      this.prism(m, [pt(r0, t0), pt(r1, t0), pt(r1, t1), pt(r0, t1)], y0, y1);
    }
  }

  /** Cylindre d'axe y (roue, disque) : centre (x, z), rayon, de y0 à y1, avec ses faces. */
  cylinderY(m: string, cx: number, cz: number, r: number, y0: number, y1: number, segments = 24, caps = true) {
    const ring = (y: number) => Array.from({ length: segments }, (_, i): V3 => [cx + r * Math.cos((i / segments) * Math.PI * 2), y, cz + r * Math.sin((i / segments) * Math.PI * 2)]);
    const a = ring(y0);
    const b = ring(y1);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const t = ((i + 0.5) / segments) * Math.PI * 2;
      this.face(m, [a[i]!, a[j]!, b[j]!, b[i]!], [Math.cos(t), 0, Math.sin(t)]);
    }
    if (caps) {
      this.face(m, b, [0, 1, 0]);
      this.face(m, [...a].reverse(), [0, -1, 0]);
    }
  }

  /** Cylindre vertical (échappement, gyrophare) : centre (x, y), de z0 à z1. */
  cylinderZ(m: string, cx: number, cy: number, r: number, z0: number, z1: number, segments = 12) {
    const ring = (z: number) => Array.from({ length: segments }, (_, i): V3 => [cx + r * Math.cos((i / segments) * Math.PI * 2), cy + r * Math.sin((i / segments) * Math.PI * 2), z]);
    const a = ring(z0);
    const b = ring(z1);
    for (let i = 0; i < segments; i++) {
      const j = (i + 1) % segments;
      const t = ((i + 0.5) / segments) * Math.PI * 2;
      this.face(m, [a[i]!, a[j]!, b[j]!, b[i]!], [Math.cos(t), Math.sin(t), 0]);
    }
    this.face(m, b, [0, 0, 1]);
  }

  /** Logo plaqué sur un flanc (y = side), centré en (x, z), hauteur h, proportions du logo. */
  logo(cx: number, side: number, cz: number, h: number, ratio: number) {
    const w = Math.min(h * ratio, 1.2);
    const hh = w / ratio;
    const [x0, x1, z0, z1] = [cx - w / 2, cx + w / 2, cz - hh / 2, cz + hh / 2];
    // Lu de l'extérieur : de l'arrière vers l'avant à gauche, l'inverse à droite.
    if (side > 0) this.face("logo", [[x1, side, z0], [x0, side, z0], [x0, side, z1], [x1, side, z1]], [0, 1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
    else this.face("logo", [[x0, side, z0], [x1, side, z0], [x1, side, z1], [x0, side, z1]], [0, -1, 0], [[0, 1], [1, 1], [1, 0], [0, 0]]);
  }
}

// ---------------------------------------------------------------------------
// Couleurs
// ---------------------------------------------------------------------------

const hexToRgb = (hex: string): V3 => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbToHex = (c: V3) => `#${c.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("")}`;
/** Éclaircit (f > 0, vers le blanc) ou assombrit (f < 0, vers le noir). */
export const shade = (hex: string, f: number) => rgbToHex(hexToRgb(hex).map((v) => (f >= 0 ? v + (255 - v) * f : v * (1 + f))) as V3);

const rgba = (hex: string, a = 1): [number, number, number, number] => {
  // Couleur sRGB → linéaire (glTF)
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexToRgb(hex);
  return [lin(r), lin(g), lin(b), a];
};
const linCache = new Map<string, [number, number, number, number]>();
const linear = (hex: string) => {
  let c = linCache.get(hex);
  if (!c) linCache.set(hex, (c = rgba(hex)));
  return c;
};

/** Palette du dessin « tracteur bleu » (kit Ekylibre), hors couleurs de l'avatar. */
export const TRACTOR_SVG_PALETTE = {
  body: "#3FBEE0",
  glass: "#5C2930",
  tyre: "#4F1F26",
  rim: "#E89E00",
  hub: "#BF5300",
  roof: "#E5E5E5",
  roofRim: "#6EA3AA",
  beacon: "#FF8D36",
  dark: "#332D28",
  chassis: "#481018",
  exhaust: "#615851",
  light: "#F4F4F4",
};

// ---------------------------------------------------------------------------
// Gabarits
// ---------------------------------------------------------------------------

type Zone = { x: number; side: number; z: number; h: number };

/**
 * Tracteur d'après le dessin du kit : proportions de l'illustration, mises à
 * l'échelle de l'avatar (longueur, largeur, hauteur, empattement, roues).
 */
function tractor(p: AvatarParams, m: Mesh): Zone {
  const { lengthM: L, widthM: W, heightM: H, wheelbaseM: wb } = p;
  const dr = p.rearWheelDiameterM;
  const df = p.frontWheelDiameterM;
  const front = Math.max(0.35, (L - wb) * 0.62);
  const rear = Math.max(0.25, L - wb - front);
  const tr = Math.min(0.62, Math.max(0.3, W * 0.21)); // largeur des pneus arrière
  const tf = tr * 0.88;
  const yr = W / 2 - tr / 2;
  const yf = Math.max(W * 0.4 - tf / 2, 0.45);

  // Roues : bande à crampons, flancs, jante et moyeu (des deux côtés).
  const wheel = (cx: number, cy: number, d: number, w: number) => {
    const r = d / 2;
    const [y0, y1] = [cy - w / 2, cy + w / 2];
    m.cylinderY("tyre", cx, r, r - 0.04, y0, y1, 28, false);
    // Crampons en chevron, alternés de part et d'autre du milieu.
    const lugs = Math.max(16, Math.round(d * 14));
    for (let i = 0; i < lugs; i++) {
      const t = (i / lugs) * Math.PI * 2;
      const half = i % 2 ? [cy, y1] : [y0, cy];
      const rr0 = r - 0.045;
      const pt = (rad: number, a: number): V2 => [cx + rad * Math.cos(a), r + rad * Math.sin(a)];
      const da = Math.min(0.09 / r, 0.12);
      m.prism("tyre", [pt(rr0, t - da), pt(r, t - da * 0.7), pt(r, t + da * 0.7), pt(rr0, t + da)], half[0]! + 0.01, half[1]! - 0.01);
    }
    for (const [y, s] of [
      [y1, 1],
      [y0, -1],
    ] as [number, number][]) {
      m.cylinderY("tyreSide", cx, r, r - 0.05, y - 0.005 * s, y + 0.001 * s, 28, true);
      m.cylinderY("rim", cx, r, r * 0.58, y - 0.03 * s, y + 0.004 * s, 24, true);
      m.cylinderY("hub", cx, r, r * 0.2, y - 0.01 * s, y + 0.03 * s, 16, true);
    }
  };
  wheel(0, yr, dr, tr);
  wheel(0, -yr, dr, tr);
  wheel(wb, yf, df, tf);
  wheel(wb, -yf, df, tf);

  // Proportions d'un tracteur standard (Claas Arion, John Deere 6R…) :
  // capot étroit et haut, au niveau du haut des roues arrière, cabine posée
  // au-dessus du pont arrière, grandes vitres, masse de lestage à l'avant.
  const cabL = Math.min(1.85, Math.max(1.4, wb * 0.66));
  const cx0 = -cabL * 0.25; // lunette arrière, un peu derrière l'essieu
  const cx1 = cx0 + cabL; // pare-brise
  const cabW = Math.min(1.75, W * 0.72);
  const innerW = Math.max(0.8, 2 * (yr - tr / 2) - 0.06); // entre les pneus arrière
  const zf = Math.max(dr * 0.62, 0.8); // plancher
  const zr = H - 0.14; // sous le toit
  const zw = Math.min(Math.max(dr * 1.02, zf + 0.3), zr - 0.8); // bas des vitres

  // Châssis et pont avant.
  const hoodW = Math.min(0.95, W * 0.42);
  const zb = Math.max(df * 0.6, 0.55); // bas du capot
  const ztRear = Math.min(Math.max(dr * 1.1, zb + 0.75), zw + 0.15); // haut du capot côté cabine
  const ztFront = ztRear - Math.min(0.14, (ztRear - zb) * 0.15);
  const xf = Math.max(wb + front * 0.8, wb + 0.6); // nez
  m.box("chassis", (0.2 + xf) / 2, 0, Math.max(0.3, df * 0.25), xf - 0.2, hoodW * 0.75, zb - Math.max(0.3, df * 0.25));
  m.box("chassis", wb, 0, df / 2 - 0.08, 0.22, 2 * yf - tf, 0.16); // essieu avant
  m.box("chassis", 0, 0, dr / 2 - 0.1, 0.3, 2 * yr - tr, 0.2); // pont arrière
  // Masse de lestage et son support, devant le nez.
  const xw = xf + Math.min(0.3, Math.max(0.15, L - wb - front * 0.8 - rear * 0.5));
  m.box("dark", (xf + xw) / 2 + 0.02, 0, zb - 0.32, xw - xf + 0.04, hoodW * 1.05, 0.36);

  // Capot effilé : côtés teinte de base, dessus plus clair, nez arrondi.
  const x0 = cx1 - 0.04;
  const hood: V2[] = [
    [x0, zb],
    [xf, zb],
    [xf + 0.04, zb + (ztFront - zb) * 0.45],
    [xf - 0.08, ztFront],
    [x0, ztRear],
  ];
  m.prism("body", hood, -hoodW / 2, hoodW / 2);
  const topT = 0.035;
  m.prism(
    "bodyLight",
    [
      [x0, ztRear],
      [xf - 0.08, ztFront],
      [xf - 0.12, ztFront + topT],
      [x0, ztRear + topT],
    ],
    -hoodW / 2 + 0.06,
    hoodW / 2 - 0.06,
  );
  // Liseré blanc le long des flancs.
  const stripeZ = zb + (ztRear - zb) * 0.32;
  for (const s of [1, -1]) m.box("light", (x0 + xf) / 2, s * (hoodW / 2 + 0.004), stripeZ, xf - x0 - 0.1, 0.008, 0.05);
  // Calandre sombre et phares.
  const grilleH = (ztFront - zb) * 0.7;
  m.box("dark", xf + 0.02, 0, zb + 0.02, 0.06, hoodW * 0.86, grilleH);
  for (const s of [1, -1]) m.box("light", xf + 0.055, s * hoodW * 0.28, zb + grilleH * 0.45, 0.02, hoodW * 0.18, grilleH * 0.22);

  // Cabine : caisson entre les pneus, puis montants et grandes vitres au-dessus des ailes.
  m.box("body", (cx0 + cx1) / 2, 0, zf, cabL, Math.min(cabW, innerW), zw - zf);
  m.box("body", (cx0 + cx1) / 2, 0, zw - 0.06, cabL, cabW, 0.06); // ceinture de caisse
  const post = 0.07;
  for (const x of [cx0 + post / 2, cx1 - post / 2]) for (const s of [1, -1]) m.box("body", x, s * (cabW / 2 - post / 2), zw, post, post, zr - zw);
  m.box("glass", cx1 - 0.02, 0, zw, 0.02, cabW - 2 * post, zr - zw); // pare-brise
  m.box("glass", cx0 + 0.02, 0, zw, 0.02, cabW - 2 * post, zr - zw); // lunette
  for (const s of [1, -1]) m.box("glass", (cx0 + cx1) / 2, s * (cabW / 2 - 0.01), zw, cabL - 2 * post, 0.02, zr - zw); // portes
  m.box("roofRim", (cx0 + cx1) / 2, 0, zr, cabL + 0.16, cabW + 0.14, 0.05);
  m.prism(
    "roof",
    [
      [cx0 - 0.1, zr + 0.05],
      [cx1 + 0.12, zr + 0.05],
      [cx1 + 0.06, H],
      [cx0 - 0.06, H],
    ],
    -(cabW + 0.18) / 2,
    (cabW + 0.18) / 2,
  );
  m.cylinderZ("beacon", cx1 - 0.35, cabW * 0.18, 0.08, H, H + 0.14);

  // Ailes arrière galbées (dessus plus clair) et ailes avant.
  for (const s of [1, -1]) {
    const yIn = s * (yr - tr / 2 - 0.03);
    const yOut = s * (yr + tr / 2 + 0.04);
    m.arcBand("body", 0, dr / 2, dr / 2 + 0.06, dr / 2 + 0.13, Math.PI * 0.08, Math.PI * 0.92, Math.min(yIn, yOut), Math.max(yIn, yOut), 12);
    m.box("bodyLight", -0.05, s * yr, dr / 2 + dr / 2 + 0.12, dr * 0.42, tr + 0.07, 0.03);
    const fIn = s * (yf - tf / 2 - 0.02);
    const fOut = s * (yf + tf / 2 + 0.03);
    m.arcBand("body", wb, df / 2, df / 2 + 0.05, df / 2 + 0.1, Math.PI * 0.2, Math.PI * 0.85, Math.min(fIn, fOut), Math.max(fIn, fOut), 8);
  }

  // Échappement vertical (à droite, contre le montant avant) et rétroviseurs.
  m.cylinderZ("exhaust", cx1 + 0.12, -(cabW / 2 - 0.1), 0.06, ztRear - 0.1, zr);
  for (const s of [1, -1]) {
    m.box("dark", cx1 - 0.05, s * (cabW / 2 + 0.17), zr - 0.18, 0.03, 0.34, 0.03); // bras
    m.box("dark", cx1 - 0.02, s * (cabW / 2 + 0.36), zr - 0.55, 0.05, 0.13, 0.32); // miroir
  }
  // Marchepied et attelage arrière.
  m.box("dark", cx0 + cabL * 0.55, Math.min(cabW, innerW) / 2 - 0.05, zf - 0.32, 0.35, 0.2, 0.06);
  m.box("chassis", -rear / 2 - 0.15, 0, dr * 0.32, rear, 0.62, 0.2);
  return { x: x0 + (xf - x0) * 0.55, side: hoodW / 2 + 0.006, z: zb + (ztRear - zb) * 0.62, h: Math.min(0.26, (ztRear - zb) * 0.32) };
}

function simpleWheel(m: Mesh, cx: number, cy: number, d: number, w: number) {
  if (d <= 0) return;
  m.cylinderY("tyre", cx, d / 2, d / 2, cy - w / 2, cy + w / 2, 20, true);
  m.cylinderY("rim", cx, d / 2, d * 0.3, cy - w / 2 - 0.01, cy + w / 2 + 0.01, 16, true);
}

/** Formes du gabarit (repère local). Renvoie la zone du logo. */
function shape(p: AvatarParams, m: Mesh): Zone | undefined {
  const { lengthM: L, widthM: W, heightM: H } = p;
  switch (p.template) {
    case "tractor":
      return tractor(p, m);
    case "self_propelled": {
      const wb = p.wheelbaseM;
      const t = Math.min(0.7, W * 0.22);
      simpleWheel(m, wb, W / 2 - t / 2, p.frontWheelDiameterM, t);
      simpleWheel(m, wb, -(W / 2 - t / 2), p.frontWheelDiameterM, t);
      simpleWheel(m, 0, W / 2 - t / 2, p.rearWheelDiameterM, t * 0.8);
      simpleWheel(m, 0, -(W / 2 - t / 2), p.rearWheelDiameterM, t * 0.8);
      const z0 = Math.max(p.rearWheelDiameterM, p.frontWheelDiameterM) * 0.5;
      m.box("body", wb / 2, 0, z0, L * 0.8, W - 2 * t, H * 0.62 - z0);
      m.box("glass", wb + 0.3, 0, H * 0.62, 1.6, Math.min(1.8, W - 2 * t), H * 0.38 - 0.1);
      m.box("roof", wb + 0.3, 0, H - 0.1, 1.7, Math.min(1.9, W - 2 * t + 0.1), 0.1);
      return { x: wb / 2, side: (W - 2 * t) / 2 + 0.005, z: (z0 + H * 0.62) / 2, h: 0.5 };
    }
    case "trailed_tool": {
      const ww = p.workingWidthM || W;
      const hitch = p.hitchOffsetM;
      m.box("chassis", -hitch / 2, 0, 0.45, hitch, 0.12, 0.12);
      const depth = Math.max(0.6, L - hitch);
      m.box("body", -hitch - depth / 2, 0, 0.35, depth, ww, Math.max(0.2, H * 0.25));
      m.box("dark", -hitch - depth / 2, 0, 0.05, depth * 0.9, ww, 0.3);
      simpleWheel(m, -hitch - depth * 0.6, ww / 2 + 0.15, p.rearWheelDiameterM, 0.25);
      simpleWheel(m, -hitch - depth * 0.6, -(ww / 2 + 0.15), p.rearWheelDiameterM, 0.25);
      return { x: -hitch - depth / 2, side: ww / 2 + 0.005, z: 0.35 + Math.max(0.2, H * 0.25) / 2, h: 0.15 };
    }
    case "trailed_sprayer": {
      const hitch = p.hitchOffsetM;
      const body = Math.max(1.5, L - hitch);
      m.box("chassis", -hitch / 2, 0, 0.6, hitch, 0.14, 0.14);
      simpleWheel(m, -hitch - body * 0.55, W / 2 - 0.2, p.rearWheelDiameterM, 0.35);
      simpleWheel(m, -hitch - body * 0.55, -(W / 2 - 0.2), p.rearWheelDiameterM, 0.35);
      const tankZ = p.rearWheelDiameterM * 0.55;
      m.box("body", -hitch - body / 2, 0, tankZ, body * 0.85, W - 0.8, H - tankZ - 0.3);
      m.box("dark", -hitch - body - 0.15, 0, 0.9, 0.1, p.workingWidthM || 12, 0.12); // rampe dépliée
      return { x: -hitch - body / 2, side: (W - 0.8) / 2 + 0.005, z: (tankZ + H - 0.3) / 2, h: 0.35 };
    }
    case "mounted_tool": {
      const ww = p.workingWidthM || W;
      m.box("body", -L / 2, 0, 0.3, L, ww, Math.max(0.2, H * 0.3));
      m.box("dark", -L / 2, 0, 0.02, L * 0.8, ww, 0.28);
      m.box("chassis", -0.1, 0, 0.3, 0.2, 0.8, H - 0.3);
      return { x: -L / 2, side: ww / 2 + 0.005, z: 0.3 + Math.max(0.2, H * 0.3) / 2, h: 0.15 };
    }
    case "trailer": {
      const hitch = p.hitchOffsetM;
      const body = Math.max(1.5, L - hitch);
      m.box("chassis", -hitch / 2, 0, 0.7, hitch, 0.15, 0.15);
      simpleWheel(m, -hitch - body * 0.6, W / 2 - 0.25, p.rearWheelDiameterM, 0.4);
      simpleWheel(m, -hitch - body * 0.6, -(W / 2 - 0.25), p.rearWheelDiameterM, 0.4);
      const z0 = p.rearWheelDiameterM * 0.7;
      m.box("body", -hitch - body / 2, 0, z0, body, W, H - z0);
      return { x: -hitch - body / 2, side: W / 2 + 0.005, z: (z0 + H) / 2, h: 0.4 };
    }
    default:
      m.box("body", 0, 0, 0, L, W, H);
      return { x: 0, side: W / 2 + 0.005, z: H * 0.6, h: Math.min(0.5, H * 0.3) };
  }
}

/** Matériaux : couleurs de l'avatar (carrosserie, vitres, pneus, jantes) + palette du dessin. */
function materials(p: AvatarParams): Record<string, MaterialDef> {
  const c = p.colors;
  const pal = TRACTOR_SVG_PALETTE;
  return {
    body: { color: c.body, metal: 0.15, rough: 0.5 },
    bodyLight: { color: shade(c.body, 0.3), metal: 0.15, rough: 0.5 },
    bodyDark: { color: shade(c.body, -0.35), metal: 0.1, rough: 0.6 },
    glass: { color: c.cab, alpha: 0.72, rough: 0.1 },
    tyre: { color: c.wheels, rough: 0.95 },
    tyreSide: { color: shade(c.wheels, -0.2), rough: 0.95 },
    rim: { color: c.accent, rough: 0.5 },
    hub: { color: shade(c.accent, -0.25), rough: 0.5 },
    roof: { color: pal.light, rough: 0.35 },
    roofRim: { color: pal.roofRim, rough: 0.6 },
    beacon: { color: pal.beacon, rough: 0.3 },
    dark: { color: pal.dark, rough: 0.7 },
    chassis: { color: shade(c.wheels, -0.1), rough: 0.7 },
    exhaust: { color: pal.exhaust, metal: 0.5, rough: 0.4 },
    light: { color: pal.light, rough: 0.3 },
    logo: { color: "#FFFFFF", rough: 0.6 },
  };
}

/** Proportions d'une image PNG (largeur / hauteur), lues dans son en-tête ; 3 par défaut. */
export function pngRatio(png: Uint8Array | null | undefined): number {
  if (!png || png.length < 24 || png[0] !== 0x89 || png[1] !== 0x50) return 3;
  const dv = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const w = dv.getUint32(16);
  const h = dv.getUint32(20);
  return w > 0 && h > 0 ? Math.min(8, Math.max(0.5, w / h)) : 3;
}

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
  const withLogo = p.logo === "sides" && !!logoPng && !!zone;
  if (withLogo && zone) {
    const ratio = pngRatio(logoPng);
    for (const s of [1, -1]) m.logo(zone.x, s * zone.side, zone.z, zone.h, ratio);
  }
  const defs = materials(p);
  const doc = new Document();
  const buffer = doc.createBuffer();
  const mesh = doc.createMesh("avatar");
  const unlit = doc.createExtension(KHRMaterialsUnlit);
  let triangles = 0;
  for (const [key, part] of m.parts) {
    if (!part.indices.length || (key === "logo" && !withLogo)) continue;
    const def = defs[key] ?? { color: "#888888" };
    // Aplats sans éclairage (KHR_materials_unlit) : la teinte de chaque face est précalculée (COLOR_0).
    const mat = doc
      .createMaterial(key)
      .setBaseColorFactor([1, 1, 1, def.alpha ?? 1])
      .setMetallicFactor(0)
      .setRoughnessFactor(1)
      .setDoubleSided(true)
      .setExtension("KHR_materials_unlit", unlit.createUnlit());
    if ((def.alpha ?? 1) < 1) mat.setAlphaMode("BLEND");
    if (key === "logo") mat.setBaseColorTexture(doc.createTexture("logo").setImage(logoPng!).setMimeType("image/png")).setAlphaMode("BLEND");
    const prim = doc
      .createPrimitive()
      .setMaterial(mat)
      .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setArray(new Float32Array(part.positions)).setBuffer(buffer))
      .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setArray(new Float32Array(part.normals)).setBuffer(buffer))
      .setIndices(doc.createAccessor().setType("SCALAR").setArray(new Uint32Array(part.indices)).setBuffer(buffer));
    if (key === "logo") prim.setAttribute("TEXCOORD_0", doc.createAccessor().setType("VEC2").setArray(new Float32Array(part.uvs)).setBuffer(buffer));
    else {
      const colors = new Float32Array(part.tones.length * 3);
      part.tones.forEach((t, i) => colors.set(linear(shade(def.color, t)).slice(0, 3), i * 3));
      prim.setAttribute("COLOR_0", doc.createAccessor().setType("VEC3").setArray(colors).setBuffer(buffer));
    }
    mesh.addPrimitive(prim);
    triangles += part.indices.length / 3;
  }
  doc.createScene("scene").addChild(doc.createNode("avatar").setMesh(mesh));
  doc.getRoot().getAsset().generator = "Fourmy equipment-3d";
  const glb = await new WebIO().registerExtensions([KHRMaterialsUnlit]).writeBinary(doc);
  // Boîte englobante (repère local) : contrôle d'échelle.
  const min: V3 = [Infinity, Infinity, Infinity];
  const max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const part of m.parts.values()) {
    for (let i = 0; i < part.positions.length; i += 3) {
      const local: V3 = [part.positions[i + 2]!, part.positions[i]!, part.positions[i + 1]!]; // glTF → local
      for (let k = 0; k < 3; k++) {
        min[k] = Math.min(min[k]!, local[k]!);
        max[k] = Math.max(max[k]!, local[k]!);
      }
    }
  }
  return { glb, triangles, bounds: { min, max } };
}

/** Contrôle d'un GLB importé (FR-MAT-83) : en-tête, taille, nombre de triangles. */
export async function inspectGlb(bytes: Uint8Array, limits = { maxBytes: 5 * 1024 * 1024, maxTriangles: 100_000 }): Promise<{ triangles: number }> {
  if (bytes.length > limits.maxBytes) throw new Error("Modèle trop lourd (5 Mo au plus).");
  if (bytes.length < 12 || new TextDecoder().decode(bytes.subarray(0, 4)) !== "glTF") throw new Error("Fichier GLB (glTF binaire) attendu.");
  const doc = await new WebIO().registerExtensions(ALL_EXTENSIONS).readBinary(bytes);
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
