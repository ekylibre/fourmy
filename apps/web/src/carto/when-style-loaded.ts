import type { Map as MlMap } from "maplibre-gl";

/**
 * Lance `fn` quand le style de la carte est chargé (sources et couches
 * prêtes), sans attendre les premières tuiles comme l'événement « load » :
 * une orthophoto IGN lente (CI, réseau faible) ne bloque plus les outils.
 */
export function whenStyleLoaded(map: MlMap, fn: () => void) {
  if (map.isStyleLoaded()) fn();
  else map.once("style.load", fn);
}
