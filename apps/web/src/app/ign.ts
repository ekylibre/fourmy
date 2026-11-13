export type Basemap = "plan" | "ortho";

const IGN_WMTS: Record<Basemap, [string, string]> = {
  ortho: ["ORTHOIMAGERY.ORTHOPHOTOS", "image/jpeg"],
  plan: ["GEOGRAPHICALGRIDSYSTEMS.PLANIGNV2", "image/png"],
};

/**
 * Fonds IGN Géoplateforme (souverains, à jour). Dans une ferme, les tuiles
 * passent par le relais de l'API, qui les garde en cache sur le serveur
 * (« Ma ferme », F4) ; hors d'une ferme, directement depuis l'IGN.
 */
export function ignTiles(farmId: string | null, layer: Basemap): string {
  if (farmId) return `${globalThis.location?.origin ?? ""}/api/v1/farms/${farmId}/ign/tiles/${layer}/{z}/{x}/{y}`;
  const [name, format] = IGN_WMTS[layer];
  return `https://data.geopf.fr/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${name}&STYLE=normal&TILEMATRIXSET=PM&TILEMATRIX={z}&TILEROW={y}&TILECOL={x}&FORMAT=${format}`;
}

/** Sources raster des fonds IGN, pour le style MapLibre. */
export function ignSource(farmId: string | null, layer: Basemap) {
  return { type: "raster" as const, tiles: [ignTiles(farmId, layer)], tileSize: 256, attribution: "© IGN — Géoplateforme", maxzoom: 19 };
}
