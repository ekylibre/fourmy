import { z } from "zod";

/**
 * Parcours GPS (docs/parcours-attelages-design.md §2.4, §3). Réglages du
 * découpage des traces en sessions, propres à chaque ferme (FR-GPS-16).
 */

export const trackSettings = z.object({
  /** Arrêt ou absence de positions (min) qui coupe une session. */
  stopMin: z.number().int().min(2).max(180),
  /** Durée minimale d'un parcours listé (min). */
  minDurationMin: z.number().min(0).max(120),
  /** Distance minimale d'un parcours listé (m). */
  minDistanceM: z.number().min(0).max(10_000),
  /** Vitesse « en mouvement » quand le boîtier ne dit pas s'il travaille (km/h). */
  movingKmh: z.number().min(0.5).max(15),
  /** Part minimale d'une parcelle couverte pour la compter (0..1). */
  parcelMinShare: z.number().min(0).max(1),
  /** Surface minimale couverte dans une parcelle pour la compter (m²). */
  parcelMinAreaM2: z.number().min(0),
});
export type TrackSettings = z.infer<typeof trackSettings>;

export const DEFAULT_TRACK_SETTINGS: TrackSettings = {
  stopMin: 15,
  minDurationMin: 3,
  minDistanceM: 200,
  movingKmh: 2,
  parcelMinShare: 0.05,
  parcelMinAreaM2: 500,
};

export const trackSessionKind = z.enum(["work", "transit"]);
export type TrackSessionKind = z.infer<typeof trackSessionKind>;

/** Un parcours tel que listé (FR-GPS-12). */
export const trackSession = z.object({
  id: z.string().uuid(),
  /** Matériel suivi (porteur du boîtier). */
  equipmentId: z.string().uuid(),
  kind: trackSessionKind,
  startedAt: z.string(),
  stoppedAt: z.string(),
  durationS: z.number(),
  distanceM: z.number(),
  /** Travail seulement. */
  coveredAreaM2: z.number().nullable(),
  /** Parcelles travaillées à la date, avec la surface couverte dans chacune. */
  parcels: z.array(z.object({ landParcelId: z.string().uuid(), name: z.string(), areaM2: z.number(), share: z.number() })),
  /** Attribut `tool` de Traccar le plus fréquent. */
  toolHint: z.string().nullable(),
  /** Outil résolu (attelage déclaré, lien Traccar, intervention). */
  tool: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Onglet d'un outil (FR-GPS-17) : le matériel tracteur. */
  tracker: z.object({ id: z.string().uuid(), name: z.string() }).nullable(),
  /** Rattaché : l'intervention (figé) ; libre sinon. */
  intervention: z.object({ id: z.string().uuid(), procedure: z.string(), status: z.string() }).nullable(),
  /** FR-GPS-15 : bornes recalculées si la trace a changé depuis le rattachement. */
  drift: z.object({ startedAt: z.string(), stoppedAt: z.string() }).nullable(),
});
export type TrackSession = z.infer<typeof trackSession>;

export interface TrackSessionList {
  items: TrackSession[];
  /** Page suivante (plus anciens), null à la fin. */
  nextCursor: string | null;
}

/** Détail d'un parcours : trace simplifiée [instant, lon, lat, au travail] et couverture (GeoJSON). */
export interface TrackSessionDetail extends TrackSession {
  samples: [string, number, number, boolean | null][];
  coverage: unknown | null;
}

export const trackSessionState = z.enum(["free", "linked"]);
export type TrackSessionState = z.infer<typeof trackSessionState>;

/** Brouillon d'intervention depuis des parcours (FR-GPS-20, 21) : POST /track-sessions/draft. */
export const trackDraftRequest = z.object({ sessionIds: z.array(z.string().uuid()).min(1).max(50) });
export type TrackDraftRequest = z.infer<typeof trackDraftRequest>;

/** Ajout de parcours à une intervention existante (FR-GPS-24). */
export const trackAttachRequest = trackDraftRequest.extend({ crewId: z.string().uuid().optional() });
export type TrackAttachRequest = z.infer<typeof trackAttachRequest>;

/** Brouillon : un corps d'intervention réalisée en attelages, jamais enregistré tel quel (FR-GPS-22). */
export interface TrackDraft {
  /** Corps de réalisation (sans procédure) : un attelage, ses périodes, les cibles, `trackSessionIds`. */
  body: {
    staffing: "crews";
    crews: { tools: { equipmentId: string }[]; doers: { personId: string }[]; periods: { startedAt: string; stoppedAt: string }[] }[];
    periods: never[];
    tools: never[];
    doers: never[];
    targets: { kind: "land_parcel"; id: string; workedAreaM2?: number; workingZone?: unknown }[];
    inputs: never[];
    outputs: never[];
    purposes: never[];
    trackSessionIds: string[];
  };
  /** Procédures suggérées d'après l'outil (ou le matériel suivi), les plus fréquentes d'abord. */
  procedureSuggestions: string[];
  /** Ce qui a été déduit ou manque : « outil déduit de l'habitude », « aucun conducteur connu »… */
  hints: string[];
  /** Noms des parcelles des cibles (affichage). */
  parcelNames: Record<string, string>;
}

/** Synthèse des parcours d'une ferme sur une période (tableau de bord, retours du 10/11/2026). */
export interface TrackSummaryItem {
  equipment: { id: string; name: string };
  work: { count: number; durationS: number; distanceM: number; coveredAreaM2: number };
  transit: { count: number; durationS: number; distanceM: number };
  /** Parcours de travail non rattachés à une intervention. */
  freeWork: number;
  /** Parcelles travaillées, surface couverte cumulée (décroissante). */
  parcels: { landParcelId: string; name: string; areaM2: number }[];
  firstAt: string;
  lastAt: string;
}

export interface TrackSummary {
  /** Intégration Traccar active sur la ferme. */
  enabled: boolean;
  from: string;
  to: string;
  items: TrackSummaryItem[];
}
