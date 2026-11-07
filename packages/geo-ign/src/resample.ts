import { tileBounds, type Bounds } from "./tiles.js";

/** Ancêtre d'une tuile à un niveau donné (schéma géographique Cesium). */
export function ancestor(z: number, x: number, y: number, level: number): { z: number; x: number; y: number } {
  if (level >= z) return { z, x, y };
  const shift = z - level;
  return { z: level, x: x >> shift, y: y >> shift };
}

/**
 * Grille d'une tuile fille interpolée (bilinéaire) dans celle de son ancêtre.
 * Les grilles sont échantillonnées sur les bords (convention Cesium) :
 * l'échantillon (i, j) est à west + j·Δx, north − i·Δy.
 */
export function resampleChild(parent: Float32Array, parentBounds: Bounds, child: Bounds, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const pw = parentBounds.east - parentBounds.west;
  const ph = parentBounds.north - parentBounds.south;
  const at = (i: number, j: number) => parent[Math.min(Math.max(i, 0), size - 1) * size + Math.min(Math.max(j, 0), size - 1)]!;
  for (let i = 0; i < size; i++) {
    const lat = child.north - (i * (child.north - child.south)) / (size - 1);
    const fi = ((parentBounds.north - lat) / ph) * (size - 1);
    const i0 = Math.floor(fi);
    const di = fi - i0;
    for (let j = 0; j < size; j++) {
      const lon = child.west + (j * (child.east - child.west)) / (size - 1);
      const fj = ((lon - parentBounds.west) / pw) * (size - 1);
      const j0 = Math.floor(fj);
      const dj = fj - j0;
      out[i * size + j] =
        at(i0, j0) * (1 - di) * (1 - dj) + at(i0, j0 + 1) * (1 - di) * dj + at(i0 + 1, j0) * di * (1 - dj) + at(i0 + 1, j0 + 1) * di * dj;
    }
  }
  return out;
}

/** Tuile fille tirée de la grille de son ancêtre. */
export function childFromAncestor(parent: Float32Array, a: { z: number; x: number; y: number }, z: number, x: number, y: number, size: number) {
  return resampleChild(parent, tileBounds(a.z, a.x, a.y), tileBounds(z, x, y), size);
}
