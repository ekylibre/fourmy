import { z } from "zod";
import { geoJsonGeometry, uuid, type GeoJsonGeometry } from "./primitives.js";

/**
 * Parcelles (lot H des retours du 08/11/2026) : création depuis la carte
 * (parcelle PAC ou cadastrale du point cliqué, comme l'identificateur de
 * parcelle de Lexicon), fiche de la parcelle.
 */

/** Ce qu'il y a au point cliqué (GET /land-parcels/identify). */
export interface ParcelIdentify {
  /** Parcelle PAC (RPG) de la campagne demandée, ou de la dernière publiée (`capYear`). */
  cap: {
    id: string;
    year: number;
    cropCode: string;
    cropLabel: string | null;
    /** Production de référence Lexicon du code PAC. */
    production: string | null;
    /** Activité de la ferme sur cette production de référence. */
    suggestedActivity: { id: string; name: string } | null;
    areaM2: number;
    geometry: GeoJsonGeometry;
  } | null;
  cadastre: { idu: string; label: string; areaM2: number | null; geometry: GeoJsonGeometry }[];
  capYear: number;
  /** API Carto injoignable (en partie) : rien n'est proposé pour cette source. */
  unavailable: boolean;
  /** Parcelle de la ferme déjà présente au point. */
  existing: { id: string; name: string } | null;
}

export const parcelCreateFromMap = z.object({
  name: z.string().trim().min(1).max(200),
  shape: geoJsonGeometry,
  year: z.number().int().min(1900).max(2200),
  activityId: uuid.nullable().optional(),
  /** Identifiant RPG de la parcelle PAC reprise, s'il y a lieu. */
  capRef: z.string().max(40).nullable().optional(),
});
export type ParcelCreateFromMap = z.infer<typeof parcelCreateFromMap>;

/** Fiche d'une parcelle (GET /land-parcels/:id/sheet). */
export interface ParcelSheet {
  id: string;
  name: string;
  shape: GeoJsonGeometry;
  areaM2: number;
  center: [number, number];
  pacIslet: string | null;
  since: string;
  until: string | null;
  productions: { year: number; activity: { id: string; name: string; color: string | null; pictureUrl: string | null } | null }[];
  cadastre: { idu: string; label: string | null; areaM2: number | null; overlapM2: number | null; geometry: GeoJsonGeometry }[];
  /** Parcelles PAC : RPG anonyme (recherche), ou dossier PAC importé (TelePAC : îlot et n° de parcelle). */
  cap: {
    id: string;
    year: number;
    cropCode: string | null;
    cropLabel: string | null;
    areaM2: number | null;
    overlapM2: number | null;
    source?: "rpg" | "telepac";
    islet?: string | null;
    parcelNumber?: string | null;
  }[];
  /** Îlots PAC du dossier importé qui recouvrent la parcelle. */
  islets?: { ref: string; number: string | null; year: number; overlapM2: number | null }[];
  referencesFetchedAt: string | null;
  water: { id: string; name: string | null; kind: string; permanent: boolean | null; ditch: boolean; distanceM: number; geometry: GeoJsonGeometry }[];
  interventions: { id: string; procedure: string; status: string; at: string | null }[];
}
