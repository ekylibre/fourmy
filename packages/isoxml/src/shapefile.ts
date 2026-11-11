/**
 * Shapefile de polygones (ESRI, 1998) en WGS84 : .shp, .shx, .dbf (UTF-8,
 * annoncé par .cpg) et .prj. Anneaux extérieurs dans le sens horaire,
 * intérieurs dans le sens trigonométrique, comme l'exige le format.
 */

export type Ring = [number, number][];
/** Multipolygone GeoJSON : polygones → anneaux (extérieur puis trous) → [lon, lat]. */
export type MultiPolygonCoords = number[][][][];

export interface DbfField {
  name: string;
  type: "C" | "N";
  length: number;
  decimals?: number;
}

export interface ShapeFeature {
  geometry: MultiPolygonCoords;
  attributes: Record<string, string | number>;
}

export const WGS84_PRJ =
  'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';

/** Aire signée (positive : sens trigonométrique). */
export function signedArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i]!;
    const [x2, y2] = ring[(i + 1) % ring.length]!;
    s += x1 * y2 - x2 * y1;
  }
  return s / 2;
}

const closed = (ring: Ring): Ring => {
  const first = ring[0]!;
  const last = ring[ring.length - 1]!;
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
};

function orient(ring: Ring, clockwise: boolean): Ring {
  const r = closed(ring);
  return signedArea(r) < 0 === clockwise ? r : [...r].reverse();
}

function shapeParts(geometry: MultiPolygonCoords): Ring[] {
  const parts: Ring[] = [];
  for (const polygon of geometry) {
    polygon.forEach((ring, i) => {
      if (ring.length >= 3) parts.push(orient(ring.map((p) => [p[0]!, p[1]!] as [number, number]), i === 0));
    });
  }
  return parts;
}

function header(view: DataView, words: number, box: [number, number, number, number]) {
  view.setInt32(0, 9994, false);
  view.setInt32(24, words, false);
  view.setInt32(28, 1000, true);
  view.setInt32(32, 5, true);
  box.forEach((v, i) => view.setFloat64(36 + i * 8, v, true));
}

function bbox(rings: Ring[]): [number, number, number, number] {
  let [xmin, ymin, xmax, ymax] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const r of rings) for (const [x, y] of r) {
    xmin = Math.min(xmin, x);
    ymin = Math.min(ymin, y);
    xmax = Math.max(xmax, x);
    ymax = Math.max(ymax, y);
  }
  return Number.isFinite(xmin) ? [xmin, ymin, xmax, ymax] : [0, 0, 0, 0];
}

function dbf(fields: DbfField[], features: ShapeFeature[], now: Date): Uint8Array {
  const enc = new TextEncoder();
  const recordLength = 1 + fields.reduce((s, f) => s + f.length, 0);
  const headerLength = 32 + 32 * fields.length + 1;
  const out = new Uint8Array(headerLength + recordLength * features.length + 1);
  const view = new DataView(out.buffer);
  out[0] = 0x03;
  out[1] = now.getFullYear() - 1900;
  out[2] = now.getMonth() + 1;
  out[3] = now.getDate();
  view.setUint32(4, features.length, true);
  view.setUint16(8, headerLength, true);
  view.setUint16(10, recordLength, true);
  out[29] = 0x00;
  fields.forEach((f, i) => {
    const at = 32 + i * 32;
    out.set(enc.encode(f.name.slice(0, 10)), at);
    out[at + 11] = f.type.charCodeAt(0);
    out[at + 16] = f.length;
    out[at + 17] = f.decimals ?? 0;
  });
  out[headerLength - 1] = 0x0d;
  features.forEach((feature, r) => {
    let at = headerLength + r * recordLength;
    out[at++] = 0x20;
    for (const f of fields) {
      const v = feature.attributes[f.name];
      let text: string;
      if (f.type === "N") {
        const n = typeof v === "number" && Number.isFinite(v) ? v.toFixed(f.decimals ?? 0) : "";
        text = n.length > f.length ? "*".repeat(f.length) : n.padStart(f.length, " ");
      } else {
        // Coupe sur un caractère entier : l'UTF-8 ne doit pas déborder du champ.
        let s = String(v ?? "");
        while (enc.encode(s).length > f.length) s = s.slice(0, -1);
        text = s + " ".repeat(f.length - enc.encode(s).length);
      }
      out.set(enc.encode(text), at);
      at += f.length;
    }
  });
  out[out.length - 1] = 0x1a;
  return out;
}

/** Fichiers d'un Shapefile, nommés `${base}.shp`, etc. */
export function shapefile(base: string, fields: DbfField[], features: ShapeFeature[], now = new Date()): Record<string, Uint8Array | string> {
  const shapes = features.map((f) => shapeParts(f.geometry));
  const contents = shapes.map((parts) => 44 + 4 * parts.length + 16 * parts.reduce((s, p) => s + p.length, 0));
  const shpLength = 100 + contents.reduce((s, c) => s + 8 + c, 0);
  const shp = new Uint8Array(shpLength);
  const shx = new Uint8Array(100 + 8 * features.length);
  const sv = new DataView(shp.buffer);
  const xv = new DataView(shx.buffer);
  const all = bbox(shapes.flat());
  header(sv, shpLength / 2, all);
  header(xv, shx.length / 2, all);
  let at = 100;
  shapes.forEach((parts, r) => {
    xv.setInt32(100 + r * 8, at / 2, false);
    xv.setInt32(104 + r * 8, contents[r]! / 2, false);
    sv.setInt32(at, r + 1, false);
    sv.setInt32(at + 4, contents[r]! / 2, false);
    at += 8;
    sv.setInt32(at, 5, true);
    bbox(parts).forEach((v, i) => sv.setFloat64(at + 4 + i * 8, v, true));
    const points = parts.reduce((s, p) => s + p.length, 0);
    sv.setInt32(at + 36, parts.length, true);
    sv.setInt32(at + 40, points, true);
    let index = 0;
    parts.forEach((p, i) => {
      sv.setInt32(at + 44 + i * 4, index, true);
      index += p.length;
    });
    let pt = at + 44 + 4 * parts.length;
    for (const p of parts) for (const [x, y] of p) {
      sv.setFloat64(pt, x, true);
      sv.setFloat64(pt + 8, y, true);
      pt += 16;
    }
    at = pt;
  });
  return {
    [`${base}.shp`]: shp,
    [`${base}.shx`]: shx,
    [`${base}.dbf`]: dbf(fields, features, now),
    [`${base}.prj`]: WGS84_PRJ,
    [`${base}.cpg`]: "UTF-8",
  };
}
