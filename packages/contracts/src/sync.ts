import { z } from "zod";
import { isoDateTime, uuid } from "./primitives.js";
import {
  interventionTarget,
  interventionInput,
  interventionOutput,
  interventionTool,
  interventionDoer,
  workPeriod,
} from "./entities/interventions.js";
import { treatmentPurpose } from "./procedures.js";

/**
 * Protocole de synchronisation mobile (ADR-13), au format WatermelonDB :
 * `pull` renvoie les changements depuis `lastPulledAt` ; `push` applique les
 * interventions saisies hors-ligne, idempotentes par identifiant client
 * (UUID v7). Enregistrements **plats** (snake_case), proches du schéma local
 * de zero-mobile ; instants en millisecondes (WatermelonDB).
 */

/** Collections synchronisées dans la première tranche. */
export const syncCollection = z.enum(["land_parcels", "articles", "equipments", "people", "interventions"]);
export type SyncCollection = z.infer<typeof syncCollection>;

/** Jeu de changements WatermelonDB pour une collection. */
const changeSet = z.object({
  created: z.array(z.record(z.unknown())),
  updated: z.array(z.record(z.unknown())),
  deleted: z.array(z.string()),
});
export type ChangeSet = z.infer<typeof changeSet>;

export const syncChanges = z.record(syncCollection, changeSet);
export type SyncChanges = z.infer<typeof syncChanges>;

// --- Enregistrements tirés (pull) -------------------------------------------

/** Parcelle (version courante), prête pour la carte mobile. */
export const syncLandParcel = z.object({
  id: uuid,
  name: z.string(),
  geometry_geojson: z.string(),
  /** Tracé SVG (PostGIS ST_AsSVG), pour l'aperçu dans le détail. */
  shape_svg: z.string(),
  area_hectares: z.number(),
  valid_from: z.number(),
  valid_to: z.number().nullable(),
  updated_at_server: z.number(),
});

export const syncArticle = z.object({
  id: uuid,
  name: z.string(),
  kind: z.string(),
  unit: z.string(),
  amm: z.string().nullable(),
  updated_at_server: z.number(),
});

export const syncEquipment = z.object({
  id: uuid,
  name: z.string(),
  kind: z.string(),
  state: z.string().nullable(),
  updated_at_server: z.number(),
});

export const syncPerson = z.object({
  id: uuid,
  name: z.string(),
  role: z.string().nullable(),
  active: z.boolean(),
  updated_at_server: z.number(),
});

export const syncInterventionPulled = z.object({
  id: uuid,
  procedure: z.string(),
  status: z.enum(["planned", "done", "cancelled"]),
  started_at: z.number().nullable(),
  stopped_at: z.number().nullable(),
  origin: z.string(),
  client_id: z.string().nullable(),
  /** Corps structuré (périodes, cibles, intrants, sorties, matériels, personnes, motifs) sérialisé. */
  body_json: z.string(),
  updated_at_server: z.number(),
});

export const syncPullQuery = z.object({ lastPulledAt: isoDateTime.optional() });

export const syncPullResponse = z.object({
  changes: syncChanges,
  /** Instant du serveur au début du pull : prochain `lastPulledAt`. */
  timestamp: isoDateTime,
});
export type SyncPullResponse = z.infer<typeof syncPullResponse>;

// --- Enregistrements poussés (push) -----------------------------------------

/** Intervention saisie sur le mobile. `id` = UUID client, clé d'idempotence. */
export const syncInterventionPushed = z.object({
  id: uuid,
  procedure: z.string().min(1),
  status: z.enum(["planned", "done"]),
  periods: z.array(workPeriod).default([]),
  targets: z.array(interventionTarget).default([]),
  inputs: z.array(interventionInput).default([]),
  outputs: z.array(interventionOutput).default([]),
  tools: z.array(interventionTool).default([]),
  doers: z.array(interventionDoer).default([]),
  purposes: z.array(treatmentPurpose).default([]),
  notes: z.string().max(2000).optional(),
});
export type SyncInterventionPushed = z.infer<typeof syncInterventionPushed>;

export const syncPushRequest = z.object({
  changes: z.object({
    interventions: z.object({
      created: z.array(z.record(z.unknown())).default([]),
      updated: z.array(z.record(z.unknown())).default([]),
      deleted: z.array(z.string()).default([]),
    }),
  }),
  lastPulledAt: isoDateTime,
});
export type SyncPushRequest = z.infer<typeof syncPushRequest>;

/**
 * Résultat par intervention (zero-mobile tient un état de synchro par
 * intervention) : appliquées (ou déjà présentes), échouées avec motif.
 */
export const syncPushResult = z.object({
  applied: z.array(z.object({ id: uuid, outcome: z.enum(["created", "completed", "unchanged"]) })),
  failed: z.array(z.object({ id: z.string(), error: z.string() })),
});
export type SyncPushResult = z.infer<typeof syncPushResult>;
