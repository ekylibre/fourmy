import { NDVI_PALETTE } from "@fourmy/contracts";

/**
 * Evalscripts Sentinel Hub (V3), versionnés : la version est stockée avec
 * chaque valeur (`parcel_indices.method`). Changer un script = nouvelle version.
 */

/** Classes SCL exclues : pas de donnée, saturé, ombre de nuage, nuages, cirrus, neige. */
export const EXCLUDED_SCL = [0, 1, 3, 8, 9, 10, 11] as const;

export const INDEX_METHOD = "s2-idx-v1";

const ok = `const EXCLUDED = ${JSON.stringify(EXCLUDED_SCL)};
function ok(s) { return s.dataMask === 1 && EXCLUDED.indexOf(s.SCL) < 0; }
function nd(a, b) { return (a + b) === 0 ? 0 : (a - b) / (a + b); }`;

/** Statistiques par parcelle : NDVI (B08/B04), NDRE (B8A/B05), NDMI (B08/B11), masque SCL. */
export const INDICES_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B05", "B08", "B8A", "B11", "SCL", "dataMask"] }],
    output: [
      { id: "idx", bands: ["ndvi", "ndre", "ndmi"], sampleType: "FLOAT32" },
      { id: "dataMask", bands: 1 }
    ]
  };
}
${ok}
function evaluatePixel(s) {
  return { idx: [nd(s.B08, s.B04), nd(s.B8A, s.B05), nd(s.B08, s.B11)], dataMask: [ok(s) ? 1 : 0] };
}`;

/** Part de la ferme sans nuage : un seul octet par pixel, le moins cher. */
export const VALIDITY_EVALSCRIPT = `//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }],
    output: [{ id: "valid", bands: 1, sampleType: "UINT8" }, { id: "dataMask", bands: 1 }]
  };
}
${ok}
function evaluatePixel(s) {
  const v = ok(s) ? 1 : 0;
  return { valid: [v], dataMask: [v] };
}`;

const rgb = (hex: string) => [1, 3, 5].map((i) => +(parseInt(hex.slice(i, i + 2), 16) / 255).toFixed(4));

/** NDVI colorié (palette partagée), transparent hors parcelles et sous les nuages. */
export const NDVI_IMAGE_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B04", "B08", "SCL", "dataMask"] }], output: { bands: 4 } };
}
${ok}
const VALUES = ${JSON.stringify(NDVI_PALETTE.map((p) => p.value))};
const COLORS = ${JSON.stringify(NDVI_PALETTE.map((p) => rgb(p.color)))};
function evaluatePixel(s) {
  if (!ok(s)) return [0, 0, 0, 0];
  const c = colorBlend(nd(s.B08, s.B04), VALUES, COLORS);
  return [c[0], c[1], c[2], 0.85];
}`;

/** Couleurs naturelles (B04, B03, B02, gain 2,5), même masque. */
export const RGB_IMAGE_EVALSCRIPT = `//VERSION=3
function setup() {
  return { input: [{ bands: ["B02", "B03", "B04", "SCL", "dataMask"] }], output: { bands: 4 } };
}
${ok}
function evaluatePixel(s) {
  if (!ok(s)) return [0, 0, 0, 0];
  return [2.5 * s.B04, 2.5 * s.B03, 2.5 * s.B02, 1];
}`;
