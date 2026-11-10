import { sql, type SQL } from "drizzle-orm";
import { withFarm, type Database, type Tx } from "@fourmy/db";
import { DomainError, type DomainCtx } from "@fourmy/domain";
import {
  syncInterventionPushed,
  syncMeterReadingPushed,
  type SyncChanges,
  type SyncPullResponse,
  type SyncPushRequest,
  type SyncPushResult,
} from "@fourmy/contracts";
import { planInTx, completeInTx, readInterventionsWhere } from "./interventions.js";
import { addReadingInTx } from "./equipments.js";
import { BadRequest, Conflict, NotFound } from "../routes/helpers.js";

/**
 * Synchro mobile (ADR-13), protocole WatermelonDB.
 * Pull : changements depuis `lastPulledAt`, dans une seule transaction ; son
 * instant de début devient le prochain `lastPulledAt` (rien ne se perd entre
 * deux pulls ; au pire un enregistrement revient deux fois).
 * Push : interventions et relevés de compteur, idempotents par UUID client.
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
      sql`SELECT id, name, kind, state, brand, model, meter_unit, updated_at FROM equipments WHERE updated_at > ${since}::timestamptz`,
    );
    const people = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, name, role, active, user_id, updated_at FROM people WHERE updated_at > ${since}::timestamptz`,
    );
    // Lieux et cuves : destinations des récoltes. « current » = encore en service aujourd'hui.
    const places = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT p.id, p.name, p.updated_at,
                 EXISTS (SELECT 1 FROM place_versions v WHERE v.place_id = p.id AND v.valid @> now()) AS current
          FROM places p WHERE p.updated_at > ${since}::timestamptz`,
    );
    const containers = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT c.id, c.name, c.place_id, c.updated_at, v.capacity_l, v.id IS NOT NULL AS current
          FROM containers c
          LEFT JOIN container_versions v ON v.container_id = c.id AND v.valid @> now()
          WHERE c.updated_at > ${since}::timestamptz`,
    );
    const readings = await rows<Record<string, unknown>>(
      tx,
      sql`SELECT id, equipment_id, read_at, value, origin, correction, updated_at FROM meter_readings
          WHERE updated_at > ${since}::timestamptz ${first ? sql`AND read_at > now() - interval '365 days'` : sql``}`,
    );
    const interventions = await readInterventionsWhere(
      tx,
      sql`i.updated_at > ${since}::timestamptz
          ${first ? sql`AND coalesce(i.started_at, i.stopped_at, i.created_at) > now() - interval '365 days'` : sql``}`,
      5000,
    );

    const bucket = () => ({ created: [] as Record<string, unknown>[], updated: [] as Record<string, unknown>[], deleted: [] as string[] });
    const changes: SyncChanges = {
      land_parcels: bucket(),
      articles: bucket(),
      equipments: bucket(),
      people: bucket(),
      places: bucket(),
      containers: bucket(),
      interventions: bucket(),
      meter_readings: bucket(),
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
      put("equipments", {
        id: e.id,
        name: e.name,
        kind: e.kind,
        state: e.state ?? null,
        brand: e.brand ?? null,
        model: e.model ?? null,
        meter_unit: e.meter_unit ?? null,
        updated_at_server: ms(e.updated_at),
      });
    }
    for (const r of readings) {
      put("meter_readings", {
        id: r.id,
        equipment_id: r.equipment_id,
        read_at: ms(r.read_at),
        value: Number(r.value),
        origin: r.origin,
        correction: r.correction ?? null,
        updated_at_server: ms(r.updated_at),
      });
    }
    for (const p of people) {
      put("people", {
        id: p.id,
        name: p.name,
        role: p.role ?? null,
        active: p.active,
        user_id: p.user_id ?? null,
        updated_at_server: ms(p.updated_at),
      });
    }
    for (const p of places) {
      if (!p.current) {
        if (!first) changes.places!.deleted.push(p.id as string);
        continue;
      }
      put("places", { id: p.id, name: p.name, updated_at_server: ms(p.updated_at) });
    }
    for (const c of containers) {
      if (!c.current) {
        if (!first) changes.containers!.deleted.push(c.id as string);
        continue;
      }
      put("containers", {
        id: c.id,
        name: c.name,
        place_id: c.place_id ?? null,
        capacity_l: c.capacity_l === null ? null : Number(c.capacity_l),
        updated_at_server: ms(c.updated_at),
      });
    }
    for (const i of interventions) {
      // Forme aplatie (anciennes versions, en lecture seule si attelages), plus le mode et les attelages.
      const { periods, targets, inputs, outputs, tools, doers, purposes, notes, staffing, crews } = i;
      put("interventions", {
        id: i.id,
        procedure: i.procedure,
        status: i.status,
        started_at: ms(i.startedAt),
        stopped_at: ms(i.stoppedAt),
        origin: i.origin,
        client_id: i.clientId,
        body_json: JSON.stringify({ periods, targets, inputs, outputs, tools, doers, purposes, notes, staffing, crews }),
        updated_at_server: ms(i.updatedAt),
      });
    }
    return { changes, timestamp: new Date(now).toISOString() };
  });
}

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

export const CREWS_NEED_RECENT_CLIENT = "Intervention à attelages : à modifier sur le web ou avec une version récente.";

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
        const [current] = await rows<{ status: string; staffing: string }>(tx, sql`SELECT status, staffing FROM interventions WHERE id = ${r.id}`);
        if (current?.status === "done") return "unchanged" as const; // re-push idempotent
        // Version mobile sans attelages : elle ne doit pas aplatir en silence (FR-ATT-8).
        if (current?.staffing === "crews" && !r.staffing) throw new DomainError(CREWS_NEED_RECENT_CLIENT);
        const { id, procedure, status, staffing, crews, ...pushed } = r;
        const body = staffing === "crews" ? { ...pushed, staffing, crews: crews ?? [], tools: [], doers: [], periods: [] } : { ...pushed, staffing: "free" as const, crews: [] };
        if (!current) {
          // Réalisée d'emblée : on planifie à vide puis on réalise avec le corps complet.
          await planInTx(
            tx,
            farmId,
            ctx,
            status === "planned"
              ? { id, procedure, ...body }
              : { id, procedure, staffing: "free", crews: [], periods: [], targets: [], inputs: [], outputs: [], tools: [], doers: [], purposes: [] },
            id,
          );
        }
        if (status === "done") {
          await completeInTx(tx, farmId, ctx, id, body);
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

  // Relevés de compteur saisis hors ligne : un par transaction, idempotents.
  const readings = body.changes.meter_readings;
  for (const raw of [...(readings?.created ?? []), ...(readings?.updated ?? [])]) {
    const parsed = syncMeterReadingPushed.safeParse(raw);
    if (!parsed.success) {
      result.failed.push({ id: String(raw.id ?? "?"), error: parsed.error.issues.map((i) => `${i.path.join(".")} : ${i.message}`).join(" ; ") });
      continue;
    }
    const r = parsed.data;
    try {
      await withFarm(db, farmId, (tx) =>
        addReadingInTx(tx, farmId, ctx, r.equipment_id, {
          id: r.id,
          readAt: new Date(r.read_at).toISOString(),
          value: r.value,
          correction: r.correction ?? null,
          correctionReason: r.correction_reason ?? null,
          note: r.note ?? null,
          origin: "manual",
        }),
      );
      result.applied.push({ id: r.id, outcome: "created" });
    } catch (e) {
      if (e instanceof BadRequest || e instanceof NotFound || e instanceof Conflict) result.failed.push({ id: r.id, error: e.message });
      else throw e;
    }
  }
  for (const id of readings?.deleted ?? []) {
    result.failed.push({ id, error: "Suppression de relevé non autorisée depuis le mobile." });
  }
  return result;
}
