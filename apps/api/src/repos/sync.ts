import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { DomainError, type DomainCtx } from "@fourmy/domain";
import {
  syncInterventionPushed,
  type SyncChanges,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResult,
} from "@fourmy/contracts";
import { planInTx, completeInTx } from "./interventions.js";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Synchro mobile (ADR-13), protocole WatermelonDB.
 * Pull : changements depuis `lastPulledAt`, dans une seule transaction ; son
 * instant de début devient le prochain `lastPulledAt` (rien ne se perd entre
 * deux pulls ; au pire un enregistrement revient deux fois).
 * Push : interventions seulement en v1, idempotentes par UUID client.
 */

const rows = async <T>(tx: Tx, q: SQL) => (await tx.execute(q)) as unknown as T[];
const ms = (v: unknown) => (v === null || v === undefined ? null : new Date(v as string).getTime());

export async function pull(db: Database, farmId: string, lastPulledAt: string | null): Promise<SyncPullResponse> {
  return withFarm(db, farmId, async (tx) => {
    // Le pilote peut rendre un timestamptz en chaîne ou en Date : on normalise.
    const [{ now }] = (await rows<{ now: Date | string }>(tx, sql`SELECT now() AS now`)) as [{ now: Date | string }];
    const since = lastPulledAt ?? "-infinity";
    const first = lastPulledAt === null;

    const parcels = await rows<Record<string, unknown>>(
      tx,
      sql`
        SELECT p.id, p.name, p.updated_at,
               ST_AsGeoJSON(v.shape) AS geometry_geojson, ST_AsSVG(v.shape, 0, 7) AS shape_svg,
               v.area_m2 / 10000 AS area_hectares, lower(v.valid) AS valid_from, upper(v.valid) AS valid_to,
               v.id IS NOT NULL AS current
        FROM land_parcels p
        LEFT JOIN land_parcel_versions v ON v.land_parcel_id = p.id AND v.valid @> now()
        WHERE p.updated_at > ${since}::timestamptz`,
    );
    const articles = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, name, kind, unit, amm, updated_at FROM articles WHERE updated_at > ${since}::timestamptz`,
    );
    const equipments = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, name, kind, state, updated_at FROM equipments WHERE updated_at > ${since}::timestamptz`,
    );
    const interventions = await rows<Record<string, unknown>>(
      tx,
      sql`
        SELECT i.id, i.procedure, i.status, i.started_at, i.stopped_at, i.origin, i.client_id, i.updated_at,
               coalesce(json_agg(json_build_object('role', p.role, 'refType', p.ref_type, 'refId', p.ref_id,
                 'quantity', p.quantity, 'unit', p.unit)) FILTER (WHERE p.id IS NOT NULL), '[]') AS parameters
        FROM interventions i LEFT JOIN intervention_parameters p ON p.intervention_id = i.id
        WHERE i.updated_at > ${since}::timestamptz
          ${first ? sql`AND coalesce(i.started_at, i.stopped_at, i.created_at) > now() - interval '365 days'` : sql``}
        GROUP BY i.id`,
    );

    const bucket = () => ({ created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[], deleted: [] as string[] });
    const changes: SyncChanges = {
      land_parcels: bucket(),
      articles: bucket(),
      equipments: bucket(),
      interventions: bucket(),
    };
    const put = (collection: keyof SyncChanges, record: Record<string, unknown>) =>
      changes[collection]![first ? "created" : "updated"].push(record);

    for (const p of parcels) {
      if (!p.current) {
        if (!first) changes.land_parcels!.deleted.push(p.id as string); // plus de version courante
        continue;
      }
      put("land_parcels", {
        id: p.id,
        name: p.name,
        geometry_geojson: p.geometry_geojson,
        shape_svg: p.shape_svg,
        area_hectares: Number(p.area_hectares),
        valid_from: ms(p.valid_from),
        valid_to: ms(p.valid_to),
        updated_at_server: ms(p.updated_at),
      });
    }
    for (const a of articles) {
      put("articles", { id: a.id, name: a.name, kind: a.kind, unit: a.unit, amm: a.amm ?? null, updated_at_server: ms(a.updated_at) });
    }
    for (const e of equipments) {
      put("equipments", { id: e.id, name: e.name, kind: e.kind, state: e.state ?? null, updated_at_server: ms(e.updated_at) });
    }
    for (const i of interventions) {
      put("interventions", {
        id: i.id,
        procedure: i.procedure,
        status: i.status,
        started_at: ms(i.started_at),
        stopped_at: ms(i.stopped_at),
        origin: i.origin,
        client_id: i.client_id ?? null,
        parameters_json: JSON.stringify(i.parameters),
        updated_at_server: ms(i.updated_at),
      });
    }
    return { changes, timestamp: new Date(now).toISOString() };
  });
}

const toIso = (v: number | string | null | undefined) =>
  v === null || v === undefined ? undefined : new Date(v).toISOString();

/**
 * Conflit (WatermelonDB) : l'intervention a été modifiée sur le serveur, par
 * autre chose que le mobile, depuis le dernier pull de ce client.
 */
async function modifiedElsewhereSince(db: Database, farmId: string, id: string, since: string): Promise<boolean> {
  const found = await withFarm(db, farmId, (tx) =>
    rows(tx, sql`
      SELECT 1 FROM audit_log
      WHERE entity = 'intervention' AND entity_id = ${id} AND origin <> 'mobile' AND at > ${since}::timestamptz
      LIMIT 1`),
  );
  return found.length > 0;
}

export async function push(db: Database, farmId: string, ctx: DomainCtx, body: SyncPushRequest): Promise<SyncPushResult> {
  const result: SyncPushResult = { applied: [], failed: [] };
  const { created, updated, deleted } = body.changes.interventions;

  // Conflits d'abord : WatermelonDB attend un refus global, puis re-pull.
  for (const raw of updated) {
    const id = String(raw.id ?? "");
    if (id && (await modifiedElsewhereSince(db, farmId, id, body.lastPulledAt))) {
      throw new Conflict(`Intervention ${id} modifiée sur le serveur depuis le dernier pull : refaire un pull.`);
    }
  }

  for (const raw of [...created, ...updated]) {
    const parsed = syncInterventionPushed.safeParse(raw);
    if (!parsed.success) {
      result.failed.push({ id: String(raw.id ?? "?"), error: parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; ") });
      continue;
    }
    const r = parsed.data;
    try {
      // Tout ou rien par intervention : planification et réalisation partagent
      // une transaction (un enregistrement rejeté ne laisse aucune trace).
      const outcome = await withFarm(db, farmId, async (tx) => {
        const [current] = await rows<{ status: string }>(tx, sql`SELECT status FROM interventions WHERE id = ${r.id}`);
        if (current?.status === "done") return "unchanged" as const; // re-push idempotent
        if (!current) {
          await planInTx(tx, farmId, ctx, {
            id: r.id,
            procedure: r.procedure,
            startedAt: toIso(r.started_at),
            parameters: r.status === "planned" ? r.parameters : [],
          }, r.id);
        }
        if (r.status === "done") {
          const startedAt = toIso(r.started_at);
          const stoppedAt = toIso(r.stopped_at);
          if (!startedAt || !stoppedAt) throw new BadRequest("started_at et stopped_at requis pour une intervention réalisée.");
          await completeInTx(tx, farmId, ctx, r.id, { startedAt, stoppedAt, parameters: r.parameters });
          return "completed" as const;
        }
        return current ? ("unchanged" as const) : ("created" as const);
      });
      result.applied.push({ id: r.id, outcome });
    } catch (e) {
      if (e instanceof DomainError || e instanceof BadRequest || e instanceof NotFound || e instanceof Conflict) {
        result.failed.push({ id: r.id, error: e.message });
      } else {
        throw e;
      }
    }
  }

  for (const id of deleted) {
    result.failed.push({ id, error: "Suppression d'intervention non autorisée depuis le mobile (v1)." });
  }
  return result;
}
