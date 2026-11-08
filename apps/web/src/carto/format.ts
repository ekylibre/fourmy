/** Surfaces et longueurs pour l'affichage (mesure, aperçu). */
export function formatArea(m2: number): string {
  if (m2 < 10_000) return `${Math.round(m2).toLocaleString("fr-FR")} m²`;
  return `${(m2 / 10_000).toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })} ha`;
}

export function formatLength(m: number): string {
  if (m < 1000) return `${m.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} m`;
  return `${(m / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 3 })} km`;
}
