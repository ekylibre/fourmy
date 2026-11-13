import type { Polygon } from "geojson";
import { areaM2, clipToParcel, type Area } from "@fourmy/carto";

/**
 * Zones de travail partielles (exigence INT-UI-6) : une zone dessinée sur la
 * carte est découpée sur chaque parcelle qu'elle touche ; chaque morceau
 * devient la `workingZone` de sa parcelle, sa surface (géodésique, identique
 * à PostGIS) le `workedAreaM2`. Fonctions pures, testées sans carte.
 */

export interface ParcelShape {
  id: string;
  shape: Area;
  areaM2: number;
}

export interface WorkingZone {
  parcelId: string;
  zone: Area;
  areaM2: number;
}

/** Parcelles touchées par la zone dessinée, avec la partie de la zone dans chacune. */
export function zonesFor(drawn: Polygon, parcels: ParcelShape[]): WorkingZone[] {
  return parcels.flatMap((p) => {
    const zone = clipToParcel(drawn, p.shape);
    return zone ? [{ parcelId: p.id, zone, areaM2: Math.round(areaM2(zone) * 100) / 100 }] : [];
  });
}

/**
 * Parcelles touchées par le rectangle « Maj + glisser » (ses 4 coins en
 * longitude/latitude). Calcul géométrique, indépendant de ce que la carte a
 * déjà dessiné : un glisser juste après l'ouverture prend toutes les parcelles.
 */
export function parcelsInBox(corners: [number, number][], parcels: ParcelShape[]): string[] {
  const box: Polygon = { type: "Polygon", coordinates: [[...corners, corners[0]!]] };
  return parcels.filter((p) => clipToParcel(box, p.shape) !== null).map((p) => p.id);
}

/** Surface traitée (m²) : zone de travail si dessinée, sinon parcelle entière. */
export function treatedAreaM2(selected: string[], parcels: Map<string, ParcelShape>, zones: Map<string, { workedAreaM2?: number }>): number {
  return selected.reduce((sum, id) => sum + (zones.get(id)?.workedAreaM2 ?? parcels.get(id)?.areaM2 ?? 0), 0);
}

