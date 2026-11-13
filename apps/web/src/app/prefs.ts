import { useFarm } from "./farm";
import { useFarmPrefs } from "./queries";

/**
 * Surface dans l'unité choisie pour la ferme (E21 bis). Écrans de travail
 * seulement : les documents réglementaires gardent l'hectare.
 */
export function useArea(): (m2: number) => string {
  return useFarmPrefs(useFarm().id).area;
}

/** Fond de carte par défaut de la ferme (E9) et point du siège (E10). */
export function useMapPrefs() {
  const { basemap, home } = useFarmPrefs(useFarm().id);
  return { basemap, home };
}
