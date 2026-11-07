import postgres, { type Sql } from "postgres";
import { buildEvent, type DomainCtx } from "@fourmy/domain";
import type { TraccarClient } from "./client.js";
import { toPositionRecord, dedupeByTime, matchDevices, type PositionRecord } from "./parse.js";

/**
 * Synchronisation Traccar → Fourmy (docs/architecture.md §6.2).
 * - rattache chaque boîtier à un matériel de la ferme (par nom) ;
 * - reprend après la dernière position connue (sinon `since`) ;
 * - récupère par fenêtres (7 j par défaut) et insère en masse sous RLS,
 *   sans doublon sur (rattachement, instant) ;
 * - publie `tracker.positions_ingested` dans l'outbox.
 */
export interface SyncOptions {
  targetUrl: string;
  farmId: string;
  client: TraccarClient;
  /** Début de l'historique pour un boîtier jamais synchronisé. */
  since: Date;
  until?: Date;
  windowDays?: number;
  /** Repartir de `since` même si des positions existent (réingestion). */
  full?: boolean;
}

export interface DeviceReport {
  deviceId: number;
  name: string;
  equipmentId: string;
  bindingId: string;
  from: string;
  fetched: number;
  inserted: number;
  updated: number;
  invalid: number;
}

export interface SyncReport {
  devices: DeviceReport[];
  unmatched: { deviceId: number; name: string; reason: string }[];
  inserted: number;
  updated: number;
}

async function inFarm<T>(sql: Sql, farmId: string, fn: (tx: Sql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    await tx`SET LOCAL ROLE fourmy_app`;
    await tx`SELECT set_config('fourmy.farm_id', ${farmId}, true)`;
    return fn(tx as unknown as Sql);
  }) as Promise<T>;
}

async function insertPositions(
  tx: Sql,
  farmId: string,
  bindingId: string,
  records: PositionRecord[],
): Promise<{ inserted: number; updated: number }> {
  if (records.length === 0) return { inserted: 0, updated: 0 };
  const rows = await tx<{ inserted: boolean }[]>`
    INSERT INTO positions (farm_id, binding_id, time, point, speed, heading, attrs)
    SELECT ${farmId}, ${bindingId}, u.t, ST_SetSRID(ST_MakePoint(u.lon, u.lat), 4326), u.s, u.h, u.a::jsonb
    FROM unnest(
      ${tx.array(records.map((r) => r.time))}::timestamptz[],
      ${tx.array(records.map((r) => r.lon))}::float8[],
      ${tx.array(records.map((r) => r.lat))}::float8[],
      ${tx.array(records.map((r) => r.speedKmh))}::float8[],
      ${tx.array(records.map((r) => r.heading))}::float8[],
      ${tx.array(records.map((r) => JSON.stringify(r.attrs)))}::text[]
    ) AS u(t, lon, lat, s, h, a)
    ON CONFLICT (binding_id, time) DO UPDATE
      SET point = excluded.point, speed = excluded.speed, heading = excluded.heading, attrs = excluded.attrs
      WHERE positions.attrs IS DISTINCT FROM excluded.attrs
         OR positions.speed IS DISTINCT FROM excluded.speed
    RETURNING (xmax = 0) AS inserted`;
  const inserted = rows.filter((r) => r.inserted).length;
  return { inserted, updated: rows.length - inserted };
}

export async function syncTraccar(opts: SyncOptions): Promise<SyncReport> {
  const sql = postgres(opts.targetUrl, { max: 1, onnotice: () => {} });
  const windowMs = (opts.windowDays ?? 7) * 86_400_000;
  const until = opts.until ?? new Date();
  const ctx: DomainCtx = {
    now: new Date().toISOString(),
    newId: () => crypto.randomUUID(),
    actor: "connector-traccar",
    origin: "plugin",
  };
  try {
    const devices = await opts.client.devices();
    const equipments = await inFarm(sql, opts.farmId, (tx) =>
      tx<{ id: string; name: string }[]>`SELECT id, name FROM equipments`,
    );
    const { matched, unmatched } = matchDevices(devices, equipments);
    const report: SyncReport = {
      devices: [],
      unmatched: unmatched.map((u) => ({ deviceId: u.device.id, name: u.device.name, reason: u.reason })),
      inserted: 0,
      updated: 0,
    };

    for (const { device, equipment } of matched) {
      // Rattachement ouvert du boîtier (créé au besoin), et reprise.
      const { bindingId, resumeFrom } = await inFarm(sql, opts.farmId, async (tx) => {
        let [binding] = await tx<{ id: string }[]>`
          SELECT id FROM tracker_bindings
          WHERE source = 'traccar' AND device_id = ${String(device.id)} AND upper(valid) IS NULL`;
        if (!binding) {
          [binding] = await tx<{ id: string }[]>`
            INSERT INTO tracker_bindings (id, farm_id, equipment_id, source, device_id, valid)
            VALUES (${ctx.newId()}, ${opts.farmId}, ${equipment.id}, 'traccar', ${String(device.id)},
                    tstzrange(${opts.since.toISOString()}::timestamptz, NULL))
            RETURNING id`;
        }
        const [last] = await tx<{ t: Date | null }[]>`
          SELECT max(time) AS t FROM positions WHERE binding_id = ${binding!.id}`;
        return {
          bindingId: binding!.id,
          resumeFrom: last?.t && !opts.full ? new Date(last.t.getTime() + 1) : opts.since,
        };
      });

      const dr: DeviceReport = {
        deviceId: device.id,
        name: device.name,
        equipmentId: equipment.id,
        bindingId,
        from: resumeFrom.toISOString(),
        fetched: 0,
        inserted: 0,
        updated: 0,
        invalid: 0,
      };
      for (let start = resumeFrom.getTime(); start < until.getTime(); start += windowMs) {
        const end = new Date(Math.min(start + windowMs, until.getTime()));
        const raw = await opts.client.positions(device.id, new Date(start), end);
        dr.fetched += raw.length;
        const records = raw.map(toPositionRecord);
        dr.invalid += records.filter((r) => r === null).length;
        const clean = dedupeByTime(records.filter((r): r is PositionRecord => r !== null));
        const written = await inFarm(sql, opts.farmId, (tx) =>
          insertPositions(tx, opts.farmId, bindingId, clean),
        );
        dr.inserted += written.inserted;
        dr.updated += written.updated;
      }
      report.devices.push(dr);
      report.inserted += dr.inserted;
      report.updated += dr.updated;
    }

    if (report.inserted + report.updated > 0) {
      await sql`ANALYZE positions`;
      const event = buildEvent(ctx, opts.farmId, "tracker.positions_ingested", {
        inserted: report.inserted,
        updated: report.updated,
        devices: report.devices.map((d) => ({ equipmentId: d.equipmentId, inserted: d.inserted, updated: d.updated })),
      });
      await inFarm(sql, opts.farmId, (tx) => tx`
        INSERT INTO outbox_events (id, farm_id, type, payload)
        VALUES (${event.id}, ${opts.farmId}, ${event.type}, ${tx.json(event as never)})`);
    }
    return report;
  } finally {
    await sql.end();
  }
}
