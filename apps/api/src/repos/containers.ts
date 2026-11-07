import { sql } from "drizzle-orm";
import { withFarm, type Database } from "@fourmy/db";
import {
  planStateCorrection,
  computeContainerContents,
  resolveComposition,
  buildEvent,
  type DomainCtx,
} from "@fourmy/domain";
import type {
  ContainerAt,
  ContainerContents,
  ContainerCorrectionWrite,
  ContainerPlacementWrite,
  LotLineage,
  Shape3d,
  StockMovement,
} from "@fourmy/contracts";
import { NotFound } from "../routes/helpers.js";

/** Dépôt « cuves » : lecture à une date, contenu, placement 3D, correction tracée. */

type Row = {
  id: string;
  place_id: string;
  name: string;
  version_id: string;
  kind: "tank" | "silo" | "barrel";
  capacity_l: string;
  shape3d: Shape3d | null;
  placement: "auto" | "manual";
  lower: string;
  upper: string | null;
};

const toContainer = (r: Row): ContainerAt => ({
  id: r.id,
  placeId: r.place_id,
  name: r.name,
  version: {
    id: r.version_id,
    containerId: r.id,
    kind: r.kind,
    capacityL: Number(r.capacity_l),
    shape3d: r.shape3d,
    placement: r.placement,
    valid: { lower: r.lower, upper: r.upper },
  },
});

const columns = sql`
  c.id, c.place_id, c.name, v.id AS version_id, v.kind, v.capacity_l, v.shape3d, v.placement,
  lower(v.valid) AS lower, upper(v.valid) AS upper`;

export async function listContainersAt(
  db: Database,
  farmId: string,
  at: string,
): Promise<(ContainerAt & { volumeL: number })[]> {
  return withFarm(db, farmId, async (tx) => {
    const rows = (await tx.execute(sql`
      SELECT ${columns},
             coalesce((SELECT sum(m.quantity) FROM stock_movements m
                        WHERE m.container_id = c.id AND m.occurred_at <= ${at}::timestamptz), 0) AS volume_l
      FROM containers c
      JOIN container_versions v ON v.container_id = c.id AND v.valid @> ${at}::timestamptz
      ORDER BY c.name`)) as unknown as (Row & { volume_l: string })[];
    return rows.map((r) => ({ ...toContainer(r), volumeL: Number(r.volume_l) }));
  });
}

/** Version courante (ouverte) verrouillée pour mise à jour, ou NotFound. */
async function currentForUpdate(tx: Parameters<Parameters<typeof withFarm>[2]>[0], containerId: string) {
  const rows = (await tx.execute(sql`
    SELECT ${columns} FROM containers c
    JOIN container_versions v ON v.container_id = c.id AND upper(v.valid) IS NULL
    WHERE c.id = ${containerId}
    FOR UPDATE OF v`)) as unknown as Row[];
  const row = rows[0];
  if (!row) throw new NotFound(`Cuve ${containerId} introuvable ou sans version courante.`);
  return row;
}

/**
 * Contenu d'une cuve à une date (US-9) : calcul par les fonctions pures du
 * domaine, enrichi des codes et attributs de lots, et de la composition
 * d'origine (assemblages dépliés via lot_lineage).
 */
export async function containerContentsAt(
  db: Database,
  farmId: string,
  containerId: string,
  at: string,
): Promise<ContainerContents & { origins: Record<string, number> }> {
  return withFarm(db, farmId, async (tx) => {
    const exists = (await tx.execute(sql`SELECT 1 FROM containers WHERE id = ${containerId}`)) as unknown[];
    if (exists.length === 0) throw new NotFound(`Cuve ${containerId} introuvable.`);
    const movements = (await tx.execute(sql`
      SELECT id, farm_id AS "farmId", lot_id AS "lotId", place_id AS "placeId", container_id AS "containerId",
             quantity::float8 AS quantity, unit, occurred_at AS "occurredAt", cause,
             intervention_id AS "interventionId", created_at AS "createdAt"
      FROM stock_movements WHERE container_id = ${containerId} AND occurred_at <= ${at}::timestamptz`)) as unknown as StockMovement[];
    const normalized = movements.map((m) => ({
      ...m,
      occurredAt: new Date(m.occurredAt).toISOString(),
      createdAt: new Date(m.createdAt).toISOString(),
    }));
    const contents = computeContainerContents(containerId, normalized, at);

    const lotIds = contents.composition.map((p) => p.lotId);
    const lots = lotIds.length
      ? ((await tx.execute(sql`
          SELECT id, code, attrs FROM lots WHERE id IN (${sql.join(lotIds.map((id) => sql`${id}`), sql`, `)})`)) as unknown as {
          id: string;
          code: string;
          attrs: Record<string, unknown> | null;
        }[])
      : [];
    const lineage = (await tx.execute(sql`
      SELECT id, child_lot_id AS "childLotId", parent_lot_id AS "parentLotId", share::float8 AS share
      FROM lot_lineage`)) as unknown as LotLineage[];

    const byId = new Map(lots.map((l) => [l.id, l]));
    const origins: Record<string, number> = {};
    for (const part of contents.composition) {
      const lot = byId.get(part.lotId);
      part.lotCode = lot?.code ?? part.lotId;
      part.attrs = lot?.attrs ?? undefined;
      for (const [root, share] of Object.entries(resolveComposition(part.lotId, lineage))) {
        const code = byId.get(root)?.code ?? root;
        origins[code] = (origins[code] ?? 0) + share * part.share;
      }
    }
    return { ...contents, origins };
  });
}

/**
 * Placement 3D d'une cuve dans son bâtiment (ADR-10) : met à jour la version
 * courante (placement « manual »), trace l'opération et publie
 * `container.placed`.
 */
export async function placeContainer(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  containerId: string,
  input: ContainerPlacementWrite,
): Promise<ContainerAt> {
  return withFarm(db, farmId, async (tx) => {
    const row = await currentForUpdate(tx, containerId);
    await tx.execute(sql`
      UPDATE container_versions SET shape3d = ${JSON.stringify(input.shape3d)}::jsonb, placement = 'manual'
      WHERE id = ${row.version_id}`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
      VALUES (${ctx.newId()}, ${farmId}, ${ctx.actor}, ${ctx.origin}, 'container_versions', ${row.version_id},
              'placed', ${JSON.stringify({ before: row.shape3d, after: input.shape3d })}::jsonb, ${ctx.now}::timestamptz)`);
    const event = buildEvent(ctx, farmId, "container.placed", { containerId, shape3d: input.shape3d });
    await tx.execute(sql`
      INSERT INTO outbox_events (id, farm_id, type, payload)
      VALUES (${event.id}, ${farmId}, ${event.type}, ${JSON.stringify(event)}::jsonb)`);
    return toContainer({ ...row, shape3d: input.shape3d, placement: "manual" });
  });
}

/**
 * Corrige la version courante d'une cuve (erreur de saisie) : mise à jour en
 * place + entrée d'audit (avant/après/motif), dans une seule transaction.
 */
export async function correctContainer(
  db: Database,
  farmId: string,
  ctx: DomainCtx,
  containerId: string,
  input: ContainerCorrectionWrite,
): Promise<ContainerAt> {
  return withFarm(db, farmId, async (tx) => {
    const row = await currentForUpdate(tx, containerId);
    const plan = planStateCorrection(ctx, {
      farmId,
      entity: "container_versions",
      entityId: row.version_id,
      before: { capacityL: Number(row.capacity_l), kind: row.kind },
      patch: { capacityL: input.capacityL, kind: input.kind },
      reason: input.reason,
    });
    await tx.execute(sql`
      UPDATE container_versions SET capacity_l = ${plan.after.capacityL}, kind = ${plan.after.kind}
      WHERE id = ${row.version_id}`);
    await tx.execute(sql`
      INSERT INTO audit_log (id, farm_id, actor, origin, entity, entity_id, action, diff, at)
      VALUES (${plan.audit.id}, ${farmId}, ${plan.audit.actor}, ${plan.audit.origin},
              ${plan.audit.entity}, ${plan.audit.entityId}, ${plan.audit.action},
              ${JSON.stringify(plan.audit.diff)}::jsonb, ${plan.audit.at}::timestamptz)`);
    return toContainer({ ...row, capacity_l: String(plan.after.capacityL), kind: plan.after.kind });
  });
}
