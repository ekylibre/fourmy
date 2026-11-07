/**
 * Tuiles du schéma géographique de Cesium (GeographicTilingScheme) :
 * niveau 0 = 2 × 1 tuiles de 180°, y compté depuis le nord.
 */
export interface Bounds {
  west: number;
  south: number;
  east: number;
  north: number;
}

export function tileBounds(z: number, x: number, y: number): Bounds {
  if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 22) {
    throw new RangeError(`tuile invalide ${z}/${x}/${y}`);
  }
  const size = 180 / 2 ** z;
  if (x < 0 || x >= 2 ** (z + 1) || y < 0 || y >= 2 ** z) throw new RangeError(`tuile hors schéma ${z}/${x}/${y}`);
  const west = -180 + x * size;
  const north = 90 - y * size;
  return { west, south: north - size, east: west + size, north };
}

/**
 * Cesium attend des échantillons **sur les bords** de la tuile (le premier à
 * l'ouest/nord, le dernier à l'est/sud). Un GetMap WMS renvoie des valeurs au
 * **centre** des pixels : on élargit donc la BBOX d'un demi-pas de chaque côté.
 */
export function samplingBbox(b: Bounds, size: number): Bounds {
  const dx = (b.east - b.west) / (size - 1);
  const dy = (b.north - b.south) / (size - 1);
  return { west: b.west - dx / 2, south: b.south - dy / 2, east: b.east + dx / 2, north: b.north + dy / 2 };
}

export function intersects(a: Bounds, b: Bounds): boolean {
  return a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
}

/** Élargit une emprise d'une marge en mètres (approximation locale). */
export function expand(b: Bounds, meters: number): Bounds {
  const lat = (b.north + b.south) / 2;
  const dLat = meters / 111_320;
  const dLon = meters / (111_320 * Math.cos((lat * Math.PI) / 180));
  return { west: b.west - dLon, south: b.south - dLat, east: b.east + dLon, north: b.north + dLat };
}
